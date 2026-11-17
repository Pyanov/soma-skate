import { DEG, headingDir, len, norm, scale, v3 } from './math.ts'
import { dataHashOf, findSpot, placeAt, player2, skater, type Sim, type SimEvent, session } from './sim.ts'
import { seedRng } from './rng.ts'
import { raycast } from './park/park.ts'
import type { TwoPlayerMode } from './thing.ts'
import { startRun } from './game/session.ts'
import { isTwoPlayer, joinPlayer2, leavePlayer2 } from './game/twoplayer.ts'
import { clearTraffic, placeCar } from './game/traffic.ts'
import { clearStreetcars, spawnStreetcars } from './game/muni.ts'
import { clearNpcs, spawnNpcs } from './game/npc.ts'
import { clearPeds, placePed, spawnPeds } from './game/peds.ts'
import { clearVehicles, drivenBy, enter, exit, isVehicle, placeVehicle, summonVan } from './game/vehicles.ts'
import { clearActors, spawnActor, type ActorSpec } from './game/movers.ts'
import { missionCommand, startMission } from './game/missions.ts'
import { markerCommand, type MarkerOp } from './skater/marker.ts'
import { startJob } from './game/jobs.ts'

// Dev commands: the typed way to puppet the world between ticks. Scripts, tests,
// the live bridge and hot data reloads all go through applyCommand.

export type Command =
  | { t: 'teleport'; spot?: string; pos?: [number, number, number]; heading?: number; who?: 2 }   // who 2: player 2 (player2 teleport ...)
  | { t: 'speed'; value: number; who?: 2 }
  | { t: 'set'; path: string; value: number | string | boolean }
  | { t: 'setData'; path: string; value: unknown }
  | { t: 'seed'; value: number }
  | { t: 'run'; mode: 'run' | 'free' | 'courier' | 'combo' | 'bomb' | 'skate' | 'level' | 'muni' | 'escape' | 'graffiti' | TwoPlayerMode; route?: string; start?: string }   // route: the hill bomb route, the S.K.A.T.E. local, the Tour level (start: one of its starts), the Muni line, or the HORSE word
  | { t: 'player2'; op: 'join' | 'leave'; spot?: string; pos?: [number, number, number]; heading?: number }   // local two-player (game/twoplayer.ts)
  | { t: 'car'; x: number; y: number; heading: number; speed?: number; robo: boolean }
  | { t: 'traffic'; clear: true }
  | { t: 'streetcars'; on: boolean }   // the free-roam streetcars (game/muni.ts run.muni.roam)
  | { t: 'npc'; spawn: boolean; n?: number }
  | { t: 'ped'; op: 'spawn' | 'clear' | 'at'; n?: number; x?: number; y?: number; heading?: number; phone?: boolean }
  | { t: 'van'; x?: number; y?: number; heading?: number }   // van summon [x y [heading]] (game/vehicles.ts)
  | { t: 'vehicle'; op: 'spawn' | 'enter' | 'exit' | 'clear'; type?: string; name?: string; x?: number; y?: number; heading?: number }
  | { t: 'actor'; op: 'spawn'; spec: ActorSpec } | { t: 'actor'; op: 'clear'; who?: string }   // the story's characters on the move (game/movers.ts)
  | { t: 'mission'; op: 'start'; id: string; step?: number }   // game/missions.ts
  | { t: 'mission'; op: 'next' | 'all' | 'accept' | 'decline' | 'skip' | 'abandon' | 'pass' }   // pass: dev, the current step done as if met
  | { t: 'mission'; op: 'job'; board: string; day: string; slot: number }   // an odd job (game/jobs.ts): that board's gig on that San Francisco date
  | { t: 'marker'; op: MarkerOp }   // the session marker: set | go | clear (skater/marker.ts)

/** "teleport big3", "teleport 10 20 1 90", "speed 8", "set skater.pos.z 2", "setData physics.gravity 12", "seed 3", "player2 join big3", "player2 teleport wave". */
export function parseCommand(text: string): Command {
  const [name, ...a] = text.trim().split(/\s+/)
  const num = (s: string | undefined, what: string) => {
    const v = Number(s)
    if (s === undefined || !Number.isFinite(v)) throw new Error(`${name}: ${what} must be a number`)
    return v
  }
  switch (name) {
    case 'teleport':
      if (a.length >= 3 && a.slice(0, 3).every((s) => Number.isFinite(Number(s))))
        return { t: 'teleport', pos: [num(a[0], 'x'), num(a[1], 'y'), num(a[2], 'z')], heading: a[3] === undefined ? undefined : num(a[3], 'heading') }
      if (!a[0]) throw new Error('teleport: give a spot id or x y z [heading]')
      return { t: 'teleport', spot: a[0], heading: a[1] === undefined ? undefined : num(a[1], 'heading') }
    case 'speed': return { t: 'speed', value: num(a[0], 'value') }
    case 'set': return { t: 'set', path: a[0], value: literal(a.slice(1).join(' ')) }
    case 'setData': return { t: 'setData', path: a[0], value: JSON.parse(a.slice(1).join(' ')) }
    case 'seed': return { t: 'seed', value: num(a[0], 'value') }
    case 'run': {
      const m = a[0] === 'start' ? 'run' : a[0]
      if (isTwoPlayer(m)) return m === 'horse2p' && a[1] ? { t: 'run', mode: m, route: a[1] } : { t: 'run', mode: m }
      if (m !== 'run' && m !== 'free' && m !== 'courier' && m !== 'combo' && m !== 'bomb' && m !== 'skate' && m !== 'level' && m !== 'muni' && m !== 'escape' && m !== 'graffiti') throw new Error('run: start | free | courier | combo | bomb [route] | skate [local] | level <id> | muni [line] | escape | graffiti | trickattack2p | horse2p [word] | graffiti2p')
      if (m === 'level' && !a[1]) throw new Error('run level <id> [start spot] (data/tour.json levels)')
      if (m === 'level') return a[2] ? { t: 'run', mode: m, route: a[1], start: a[2] } : { t: 'run', mode: m, route: a[1] }
      return (m === 'bomb' || m === 'skate' || m === 'muni') && a[1] ? { t: 'run', mode: m, route: a[1] } : { t: 'run', mode: m }
    }
    case 'player2':
      if (a[0] === 'join') {
        const b = a.slice(1)
        if (b.length >= 3 && b.slice(0, 3).every((s) => Number.isFinite(Number(s))))
          return { t: 'player2', op: 'join', pos: [num(b[0], 'x'), num(b[1], 'y'), num(b[2], 'z')], heading: b[3] === undefined ? 0 : num(b[3], 'heading') }
        return b[0] ? { t: 'player2', op: 'join', spot: b[0] } : { t: 'player2', op: 'join' }
      }
      if (a[0] === 'leave') return { t: 'player2', op: 'leave' }
      if (a[0] === 'teleport' || a[0] === 'speed') {
        const c = parseCommand(a.join(' '))
        if (c.t === 'teleport' || c.t === 'speed') return { ...c, who: 2 }
      }
      throw new Error('player2: join [spot | x y z [heading]] | leave | teleport <spot | x y z [heading]> | speed <m/s>')
    case 'car': {
      const robo = a.includes('robo'), nums = a.filter((s) => s !== 'robo')
      return { t: 'car', x: num(nums[0], 'x'), y: num(nums[1], 'y'), heading: num(nums[2], 'heading'), speed: nums[3] === undefined ? undefined : num(nums[3], 'speed'), robo }
    }
    case 'traffic': if (a[0] !== 'clear') throw new Error('traffic: clear'); return { t: 'traffic', clear: true }
    case 'streetcars': if (a[0] !== 'on' && a[0] !== 'off') throw new Error('streetcars: on | off'); return { t: 'streetcars', on: a[0] === 'on' }
    case 'npc': if (a[0] !== 'spawn' && a[0] !== 'clear') throw new Error('npc: spawn [n] | clear'); return { t: 'npc', spawn: a[0] === 'spawn', n: a[1] === undefined ? undefined : num(a[1], 'n') }
    case 'ped':
      if (a[0] === 'at') return { t: 'ped', op: 'at', x: num(a[1], 'x'), y: num(a[2], 'y'), heading: num(a[3], 'heading'), phone: a[4] === 'phone' }
      if (a[0] !== 'spawn' && a[0] !== 'clear') throw new Error('ped: spawn [n] | clear | at x y heading [phone]')
      return { t: 'ped', op: a[0], n: a[1] === undefined ? undefined : num(a[1], 'n') }
    case 'van': {
      // van summon [x y [heading]]: the crew van on the street nearest you, or at x y (data vehicles.summon).
      if (a[0] !== 'summon') throw new Error('van: summon [x y [heading]]')
      if (a.length === 1) return { t: 'van' }
      return { t: 'van', x: num(a[1], 'x'), y: num(a[2], 'y'), heading: a[3] === undefined ? undefined : num(a[3], 'heading') }
    }
    case 'vehicle': {
      // vehicle spawn <type> <x> <y> [heading] [name] | enter [name] | exit | clear [name] (data/vehicles.json types)
      if (a[0] === 'spawn') return { t: 'vehicle', op: 'spawn', type: a[1], x: num(a[2], 'x'), y: num(a[3], 'y'), heading: a[4] === undefined ? 0 : num(a[4], 'heading'), name: a[5] ?? a[1] }
      if (a[0] === 'enter' || a[0] === 'clear') return { t: 'vehicle', op: a[0], name: a[1] }
      if (a[0] === 'exit') return { t: 'vehicle', op: 'exit' }
      throw new Error('vehicle: spawn <type> <x> <y> [heading] [name] | enter [name] | exit | clear [name]')
    }
    case 'actor': {
      // actor spawn <who> escort <pace> x,y x,y ... [wait m] [resume m] [lead m] | actor spawn <who> follow <pace> [gap m] [at x,y] | actor clear [who]
      if (a[0] === 'clear') return { t: 'actor', op: 'clear', who: a[1] }
      const usage = 'actor spawn <who> escort <pace> x,y x,y ... [wait m] [resume m] [lead m] | spawn <who> follow <pace> [gap m] [at x,y] | clear [who]'
      if (a[0] !== 'spawn' || !a[1] || (a[2] !== 'escort' && a[2] !== 'follow')) throw new Error(`actor: ${usage}`)
      const opt = (k: string) => { const i = a.indexOf(k); return i >= 0 ? num(a[i + 1], k) : undefined }
      const pts = a.slice(4).filter((x) => /^-?[\d.]+,-?[\d.]+$/.test(x)).map((x) => x.split(',').map(Number) as [number, number])
      const atI = a.indexOf('at')
      const spec: ActorSpec = { who: a[1], mode: a[2], pace: num(a[3], 'pace'), wait: opt('wait'), resume: opt('resume'), lead: opt('lead'), gap: opt('gap') }
      if (a[2] === 'escort') spec.path = pts
      else if (atI >= 0) spec.at = a[atI + 1].split(',').map(Number) as [number, number]
      return { t: 'actor', op: 'spawn', spec }
    }
    case 'mission':
      // mission start <id> [step] | next [all] | accept | decline | skip | abandon | pass (game/missions.ts) | job <board> <day> <slot> (game/jobs.ts)
      if (a[0] === 'job') { if (!a[1] || !a[2] || a[3] === undefined) throw new Error('mission job <board> <YYYY-MM-DD> <slot>'); return { t: 'mission', op: 'job', board: a[1], day: a[2], slot: num(a[3], 'slot') } }
      if (a[0] === 'start') { if (!a[1]) throw new Error('mission start <id> [step]'); return a[2] === undefined ? { t: 'mission', op: 'start', id: a[1] } : { t: 'mission', op: 'start', id: a[1], step: num(a[2], 'step') } }
      if (a[0] === 'next') return { t: 'mission', op: a[1] === 'all' ? 'all' : 'next' }
      if (a[0] === 'accept' || a[0] === 'decline' || a[0] === 'skip' || a[0] === 'abandon' || a[0] === 'pass') return { t: 'mission', op: a[0] }
      throw new Error('mission: start <id> [step] | next [all] | accept | decline | skip | abandon | pass | job <board> <day> <slot>')
    case 'marker':
      if (a[0] !== 'set' && a[0] !== 'go' && a[0] !== 'clear') throw new Error('marker: set | go | clear')
      return { t: 'marker', op: a[0] }
    default: throw new Error(`unknown command "${name}" (teleport, speed, set, setData, seed, run, car, traffic, streetcars, npc, ped, player2, van, vehicle, actor, mission, marker)`)
  }
}

export const parseCommands = (text: string) => text.split(';').map((s) => s.trim()).filter(Boolean).map(parseCommand)

const literal = (s: string): number | string | boolean => {
  if (s === 'true') return true
  if (s === 'false') return false
  const n = Number(s)
  return s !== '' && Number.isFinite(n) ? n : s
}

/** Applies a command; returns a one-line result. Throws on invalid commands. */
export function applyCommand(sim: Sim, cmd: Command, events?: SimEvent[]): string {
  const p1 = skater(sim)
  // player2 teleport | speed: player 2's skater (game/twoplayer.ts).
  const two = (cmd.t === 'teleport' || cmd.t === 'speed') && cmd.who === 2
  const p2 = two ? player2(sim) : null
  if (two && !p2) throw new Error('no player 2 (player2 join first)')
  const sk = p2 ? p2.sk : p1
  switch (cmd.t) {
    case 'teleport': {
      if (cmd.pos) {
        // Never inside a solid: below the top of a body (a parked car, a planter), seen as an up-facing
        // surface straight above within 4 m, the skater goes on top of it (again, for a body on a body).
        const p = v3(...cmd.pos), r = sim.data.physics.skater.radius
        for (let k = 0; k < 4; k++) {
          const h = raycast(sim.park, p, v3(0, 0, 1), 4)
          if (!h || sim.park.tn[h.tri * 3 + 2] < 0.5) break   // open sky, or the underside of a deck or an awning
          p.z = h.point.z + r + 0.02
        }
        placeAt(sk, { id: 'custom', pos: p, heading: (cmd.heading ?? 0) * DEG })
      } else {
        const spot = findSpot(sim, cmd.spot!)
        if (!spot) throw new Error(`no spot "${cmd.spot}"; known: ${[...sim.data.spots.aliases.map((a) => a.id), ...sim.park.spots.map((s) => s.id)].join(', ')}`)
        placeAt(sk, { ...spot, heading: cmd.heading === undefined ? spot.heading : cmd.heading * DEG })
      }
      events?.push(two ? { t: 'teleport', tick: sim.world.tick, spot: sk.spot, player: 2 } : { t: 'teleport', tick: sim.world.tick, spot: sk.spot })
      return `${two ? 'player 2 ' : ''}teleported to ${sk.spot} at ${fmt(sk.pos.x)} ${fmt(sk.pos.y)} ${fmt(sk.pos.z)}`
    }
    case 'speed': {
      const dir = len(sk.vel) > 1e-6 ? norm(sk.vel) : sk.fwd
      sk.vel = scale(dir, cmd.value)
      return `${two ? 'player 2 ' : ''}speed ${cmd.value} m/s`
    }
    case 'set': {
      if (cmd.path === 'skater.heading') {
        sk.fwd = headingDir(Number(cmd.value) * DEG)
        return `skater.heading = ${cmd.value}`
      }
      const [root, ...rest] = cmd.path.split('.')
      // skater2. and session2.: player 2's (game/twoplayer.ts), when it is in.
      const p2 = root === 'skater2' || root === 'session2' ? player2(sim) : null
      const target = root === 'skater' ? sk : root === 'session' ? session(sim) : root === 'skater2' ? p2?.sk : root === 'session2' ? p2?.s : undefined
      if (!target || rest.length === 0) throw new Error('set: path must start with skater., session. (or skater2., session2. with player 2 in)')
      setPath(target as unknown as Record<string, unknown>, rest, cmd.value)
      return `${cmd.path} = ${cmd.value}`
    }
    case 'setData': {
      const [root, ...rest] = cmd.path.split('.')
      const target = (sim.data as unknown as Record<string, unknown>)[root]
      if (target === undefined || rest.length === 0) throw new Error(`setData: unknown data path ${cmd.path}`)
      setPath(target as Record<string, unknown>, rest, cmd.value)
      sim.dataHash = dataHashOf(sim.data)
      return `${cmd.path} = ${JSON.stringify(cmd.value)}`
    }
    case 'run': {
      startRun(sim, cmd.mode, events ?? [], cmd.route, cmd.start)
      const P = sim.data.run.twoPlayer
      return { run: '2-minute run started', free: 'free skate', courier: 'courier: pick up the order', combo: `combo challenge: ${sim.data.run.combo.seconds} s`, bomb: `hill bomb: ${session(sim).raceRoute}, down through the gates`, skate: `S.K.A.T.E. against ${session(sim).skateName}: the local sets first`, level: `${sim.data.tour.levels.find((l) => l.id === session(sim).level)?.name}: ${sim.data.tour.seconds} s`,
        muni: `Muni Race: beat the ${sim.data.run.muni.lines.find((l) => l.id === session(sim).muniLine)?.name} to ${sim.data.run.muni.lines.find((l) => l.id === session(sim).muniLine)?.stops.at(-1)?.name}`,
        escape: `Robotaxi Escape: ${sim.data.run.escape.seconds} s, keep away from it`,
        graffiti: `Graffiti: ${sim.data.run.graffiti.seconds} s, tag all you can`,
        trickattack2p: `Trick Attack: ${P.trickAttack.seconds} s, the higher score wins`, horse2p: `${session(sim).horseWord}: player 1 sets first`, graffiti2p: `Graffiti: ${P.graffiti.seconds} s, tag the most` }[cmd.mode]
    }
    case 'player2': {
      if (cmd.op === 'leave') { leavePlayer2(sim, session(sim), events ?? []); return 'player 2 left' }
      const p = joinPlayer2(sim, p1, events ?? [], cmd.pos ? { id: 'custom', pos: v3(...cmd.pos), heading: (cmd.heading ?? 0) * DEG } : cmd.spot)
      return `player 2 at ${fmt(p.pos.x)} ${fmt(p.pos.y)} ${fmt(p.pos.z)}`
    }
    case 'car': {
      const c = placeCar(sim, cmd.x, cmd.y, cmd.heading, cmd.speed, cmd.robo)
      return `car ${c.id} at ${fmt(c.pos.x)} ${fmt(c.pos.y)} ${fmt(c.pos.z)}, ${fmt(c.car!.speed)} m/s${cmd.robo ? ' (robotaxi)' : ''}`
    }
    case 'traffic':
      clearTraffic(sim)
      return 'traffic cleared'
    case 'streetcars':
      if (!cmd.on) { clearStreetcars(sim); return 'streetcars off' }
      spawnStreetcars(sim)
      return `${sim.world.things.filter((t) => t.car?.tram?.roam).length} streetcars`
    case 'npc':
      if (!cmd.spawn) { clearNpcs(sim); return 'NPC skaters cleared' }
      return `${spawnNpcs(sim, cmd.n)} NPC skaters`
    case 'ped': {
      if (cmd.op === 'clear') { clearPeds(sim); return 'pedestrians cleared' }
      if (cmd.op === 'at') { const p = placePed(sim, cmd.x!, cmd.y!, cmd.heading!, !!cmd.phone); return `pedestrian ${p.id} at ${fmt(p.pos.x)} ${fmt(p.pos.y)} ${fmt(p.pos.z)}` }
      const n = spawnPeds(sim, cmd.n)
      return sim.data.peds.enabled ? `${n} pedestrians` : 'pedestrians are off (data peds.enabled)'
    }
    case 'van': {
      const c = summonVan(sim, cmd.x === undefined ? undefined : { x: cmd.x, y: cmd.y!, heading: cmd.heading })
      return `${c.car!.drive!.name} at ${fmt(c.pos.x)} ${fmt(c.pos.y)} ${fmt(c.pos.z)}, heading ${fmt(c.car!.drive!.heading / DEG)}`
    }
    case 'vehicle': {
      if (cmd.op === 'spawn') {
        const c = placeVehicle(sim, cmd.type!, cmd.name!, cmd.x!, cmd.y!, cmd.heading ?? 0)
        return `${c.car!.drive!.name} (${c.car!.drive!.type}) at ${fmt(c.pos.x)} ${fmt(c.pos.y)} ${fmt(c.pos.z)}`
      }
      if (cmd.op === 'clear') { clearVehicles(sim, cmd.name, events ?? []); return cmd.name ? `${cmd.name} gone` : 'vehicles gone' }
      if (cmd.op === 'exit') {
        if (!drivenBy(sim, sk)) throw new Error('vehicle exit: not in a vehicle')
        exit(sim, sk, events ?? [], true)
        return `out at ${fmt(sk.pos.x)} ${fmt(sk.pos.y)} ${fmt(sk.pos.z)}`
      }
      // enter [name]: in that vehicle (or the nearest), wherever it is.
      if (drivenBy(sim, sk)) throw new Error('vehicle enter: already in one')
      const all = sim.world.things.filter((c) => isVehicle(c) && c.car!.drive!.driver < 0 && (!cmd.name || c.car!.drive!.name === cmd.name))
      if (!all.length) throw new Error(`vehicle enter: no free vehicle${cmd.name ? ` named ${cmd.name}` : ''}`)
      const c = all.reduce((p, q) => (Math.hypot(q.pos.x - sk.pos.x, q.pos.y - sk.pos.y) < Math.hypot(p.pos.x - sk.pos.x, p.pos.y - sk.pos.y) ? q : p))
      enter(sim, sk, c, events ?? [])
      return `in ${c.car!.drive!.name}`
    }
    case 'actor': {
      if (cmd.op === 'clear') { clearActors(sim, cmd.who); return cmd.who ? `actor ${cmd.who} gone` : 'actors gone' }
      const m = spawnActor(sim, cmd.spec, events ?? [])
      return `actor ${cmd.spec.who} (${cmd.spec.mode}) at ${fmt(m.pos.x)} ${fmt(m.pos.y)} ${fmt(m.pos.z)}`
    }
    case 'mission': {
      if (cmd.op === 'start') { startMission(sim, session(sim), p1, events ?? [], cmd.id, cmd.step); return `mission ${cmd.id}: ${session(sim).mission ? 'on' : 'over'}` }
      if (cmd.op === 'job') { const M = startJob(sim, session(sim), p1, events ?? [], cmd.board, cmd.day, cmd.slot); sim.dataHash = dataHashOf(sim.data); return `${M.id}: ${M.name}` }
      return missionCommand(sim, session(sim), p1, events ?? [], cmd.op)
    }
    case 'marker': return markerCommand(sim, cmd.op, events)
    case 'seed':
      sim.world.seed = cmd.value
      sim.world.rng = seedRng(cmd.value)
      return `seed ${cmd.value}`
  }
}

/**
 * Set obj's field at path to value. In an array a segment that is not a number names the element with
 * that id (missions.missions.boarddrop.steps.1.to), so data can be addressed by id, never by position;
 * a last segment no element has appends value, which must carry that id (a test mission added by id).
 */
function setPath(obj: Record<string, unknown>, path: string[], value: unknown) {
  const byId = (o: unknown, k: string) => (Array.isArray(o) && !/^\d+$/.test(k) ? o.findIndex((x) => (x as { id?: unknown })?.id === k) : null)
  let o = obj
  for (const k of path.slice(0, -1)) {
    const i = byId(o, k)
    if (i === -1) throw new Error(`no element with id ${k} in path ${path.join('.')}`)
    const next = i === null ? o[k] : (o as unknown as unknown[])[i]
    if (typeof next !== 'object' || next === null) throw new Error(`no field ${k} in path ${path.join('.')}`)
    o = next as Record<string, unknown>
  }
  const last = path[path.length - 1], i = byId(o, last)
  if (i !== null) {
    if (i >= 0) { (o as unknown as unknown[])[i] = value; return }
    if ((value as { id?: unknown })?.id !== last) throw new Error(`setData: a new element at ${path.join('.')} must have id ${last}`)
    ;(o as unknown as unknown[]).push(value)
    return
  }
  if (!(last in o)) throw new Error(`no field ${last} in path ${path.join('.')}`)
  o[last] = value
}

const fmt = (x: number) => x.toFixed(2)
