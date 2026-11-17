import { readFileSync } from 'node:fs'
import { driveKeys, laned, type DriveBot } from './drivebot.ts'
import { basename, dirname, isAbsolute, join } from 'node:path'
import type { GameData } from '../sim/data.ts'
import { pilotKeys, type PilotState } from './lines.ts'
import { Btn, parseButtons } from '../sim/input.ts'
import { headingOf, len } from '../sim/math.ts'
import { Recorder, replayInputs, runReplay, type Replay } from '../sim/replay.ts'
import { sphereContacts, type Contact } from '../sim/park/park.ts'
import { createSim, player2, session, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import { loadSnapshot, type Snapshot } from '../sim/snapshot.ts'
import type { Thing, TrickPilot, TrickPlan } from '../sim/thing.ts'
import { freshPilot, onSkateLane, trickKeys } from '../sim/game/skate.ts'
import { npcSpot } from '../sim/game/npc.ts'
import { DEG } from '../sim/math.ts'
import { loadPark, readJson, rel, ROOT } from './io.ts'

// Scenario scripts (scenarios/*.skate): a starting point, input over time, and
// expectations on numbers and events. Plain text, so no compile is needed.

type Expect = { text: string; check: (r: RunData) => { pass: boolean; detail: string } }
type RunData = { rows: Row[]; events: (SimEvent & { rel: number })[]; startTick: number }
export type Row = { t: number; thing: Thing; session?: Thing; car?: Thing; npcs?: NpcCounts; peds?: PedCounts; thing2?: Thing; session2?: Thing; van?: Thing; actor?: Thing; npc?: Thing }   // actor: the story character on the move nearest the skater (game/movers.ts); npc: the NPC skater nearest it; car: the one nearest the skater (city traffic, not the drivable vehicles); thing2, session2: player 2's, while it is in; van: the vehicle the skater drives, else the nearest one (game/vehicles.ts)
/** peds.<field>: pedestrians in the world (out of it: not counted), within 100 m of the skater, stepping aside now. */
export type PedCounts = { alive: number; near: number; aside: number }
/** npcs.<field>: park NPC skaters (not racers or the S.K.A.T.E. local) on the S.K.A.T.E. lane, watching it, riding; waiting their turn at a spot; spots with two or more riding them; pairs of waiters closer than 1 m. */
export type NpcCounts = { onlane: number; watching: number; riding: number; waiting: number; crowded: number; stacked: number }

export type Scenario = {
  name: string
  park: string
  seed: number
  spawn?: string
  load?: string
  replay?: string
  holds: { b: number; from: number; to: number; p: 1 | 2 }[]
  cmds: Map<number, string[]>
  ticks: number
  bots: Set<string>        // 'balance': press A/D against the grind (or skitch) balance meter, W/S against a manual's ('balance2': player 2's)
  drives: (DriveBot & { p: 1 | 2 })[]   // bot drive x,y x,y ... [from t] [speed v] [corner v] [lane m] [stop]: the driving autopilot (harness/drivebot.ts) for whoever is in a vehicle
  pilots: { line: string; from: number; nobrake: boolean; p: 1 | 2; path?: [number, number][]; speed?: number; cars: boolean }[]   // bot line <id> [from] [nobrake]: the rider-line autopilot drives from that tick (nobrake: never the foot brake or a powerslide); a later one takes over. bot path x,y x,y ... [from t] [speed v] [nobrake] [nocars]: the same along these points (nocars: not holding back for cars)
  skateBot?: { sets: string[]; sketchy: boolean }   // bot skate [trick,trick,...] [sketchy]: plays your S.K.A.T.E. turns (game/skate.ts trick autopilot)
  horseBots: { 1?: HorseBot; 2?: HorseBot }   // bot horse [tricks] [sketchy] (p2 bot horse ...): plays that player's HORSE turns (game/twoplayer.ts)
  two: boolean             // the script drives player 2 (p2 lines): every tick's input carries b2
  expects: Expect[]
}
type HorseBot = { sets: string[]; sketchy: boolean }

export function parseScenario(text: string, name = 'inline', baseDir = ROOT): Scenario {
  const sc: Scenario = { name, park: 'lab', seed: 1, holds: [], cmds: new Map(), ticks: 0, expects: [], bots: new Set(), pilots: [], drives: [], horseBots: {}, two: false }
  let maxTick = 0
  const resolvePath = (p: string) => (isAbsolute(p) ? p : p.startsWith('scenarios/') || p.startsWith('replays/') || p.startsWith('inbox/') || p.startsWith('out/') ? rel(p) : join(baseDir, p))
  text.split('\n').forEach((raw, i) => {
    // spaces inside {...} belong to the value (e.g. comboLanded{name=BS 180})
    const line = raw.replace(/#.*/, '').trim().replace(/\{[^}]*\}/g, (m) => m.replace(/ /g, '\u0001'))
    if (!line) return
    let [kw, ...a] = line.split(/\s+/)
    // p2 hold|tap|bot ...: the same for player 2 (game/twoplayer.ts; join it with cmd <t> player2 join [spot]).
    const p: 1 | 2 = kw === 'p2' ? 2 : 1
    if (p === 2) {
      ;[kw, ...a] = a
      if (kw !== 'hold' && kw !== 'tap' && kw !== 'bot') throw new Error(`${name}:${i + 1}: p2 hold | tap | bot in "${line}"`)
      sc.two = true
    }
    const err = (m: string) => new Error(`${name}:${i + 1}: ${m} in "${line}"`)
    const range = (s: string | undefined) => {
      const m = /^(\d+)\.\.(\d+)$/.exec(s ?? '')
      if (!m) throw err('expected a tick range like 10..40')
      return [Number(m[1]), Number(m[2])] as const
    }
    switch (kw) {
      case 'park': sc.park = a[0]; break
      case 'seed': sc.seed = Number(a[0]); break
      case 'spawn': sc.spawn = a[0]; break
      case 'load': sc.load = resolvePath(a[0]); break
      case 'replay': sc.replay = resolvePath(a[0]); break
      case 'cmd': {
        const t = Number(a[0])
        sc.cmds.set(t, [...(sc.cmds.get(t) ?? []), a.slice(1).join(' ').replace(/\u0001/g, ' ')]); maxTick = Math.max(maxTick, t + 1); break   // spaces inside {...} back (a setData JSON value)
      }
      case 'hold': { const [f, t] = range(a[1]); sc.holds.push({ b: parseButtons(a[0]), from: f, to: t, p }); maxTick = Math.max(maxTick, t); break }
      case 'tap': {
        // tap <btn> <tick>, or tap <btn> <from>..<to> every <n>: one tick at from, from + n, ... before to.
        if (a[2] === 'every') {
          const [f, to] = range(a[1]), n = Number(a[3])
          if (!(n >= 2)) throw err('tap ... every <n>: n of 2 or more (a press needs a tick off between)')
          for (let t = f; t < to; t += n) sc.holds.push({ b: parseButtons(a[0]), from: t, to: t + 1, p })
          maxTick = Math.max(maxTick, to); break
        }
        const t = Number(a[1]); sc.holds.push({ b: parseButtons(a[0]), from: t, to: t + 1, p }); maxTick = Math.max(maxTick, t + 1); break
      }
      case 'run': sc.ticks = Number(a[0]); break
      case 'bot':
        if (a[0] === 'line') { if (!a[1]) throw err('bot line <id> [from tick] [nobrake]'); sc.pilots.push({ line: a[1], from: Number(a[2] ?? 0), nobrake: a.includes('nobrake'), p, cars: true }); break }
        if (a[0] === 'drive') {
          // bot drive x,y x,y ... [from t] [speed v] [corner v] [lane m] [stop]: the driving autopilot once in a vehicle (harness/drivebot.ts).
          const pts = a.slice(1).filter((x) => /^-?[\d.]+,-?[\d.]+$/.test(x)).map((x) => x.split(',').map(Number) as [number, number])
          if (pts.length < 2) throw err('bot drive x,y x,y ... [from t] [speed v] [corner v] [lane m] [stop]')
          const opt = (k: string, d: number) => { const i = a.indexOf(k); return i >= 0 ? Number(a[i + 1]) : d }
          sc.drives.push({ path: laned(pts, opt('lane', 0)), from: opt('from', 0), speed: opt('speed', 12), corner: opt('corner', 7), lane: opt('lane', 0), stop: a.includes('stop'), i: 0, done: false, p }); break
        }
        if (a[0] === 'path') {
          // bot path x,y x,y ... [from t] [speed v] [nobrake] [nocars]: the rider-line autopilot along these points.
          const pts = a.slice(1).filter((x) => /^-?[\d.]+,-?[\d.]+$/.test(x)).map((x) => x.split(',').map(Number) as [number, number])
          if (pts.length < 2) throw err('bot path x,y x,y ... [from t] [speed v] [nobrake] [nocars]')
          const opt = (k: string) => { const i = a.indexOf(k); return i >= 0 ? Number(a[i + 1]) : undefined }
          sc.pilots.push({ line: 'path', path: pts, from: opt('from') ?? 0, speed: opt('speed'), nobrake: a.includes('nobrake'), p, cars: !a.includes('nocars') }); break
        }
        // bot skate: your S.K.A.T.E. turns: match the local's trick, set from the list (else data sets), never one already set; sketchy: land every try crooked.
        if (a[0] === 'skate' && p === 1) { sc.skateBot = { sets: tricksOf(a), sketchy: a.includes('sketchy') }; break }
        // bot horse: that player's HORSE turns, the same way.
        if (a[0] === 'horse') { sc.horseBots[p] = { sets: tricksOf(a), sketchy: a.includes('sketchy') }; break }
        if (a[0] !== 'balance') throw err('bots: balance, line <id> [from], skate [tricks] [sketchy], horse [tricks] [sketchy]'); sc.bots.add(p === 2 ? 'balance2' : 'balance'); break
      case 'expect': sc.expects.push(parseExpect(a, line, err)); break
      default: throw err(`unknown keyword "${kw}"`)
    }
  })
  if (!sc.ticks) sc.ticks = Math.max(1, maxTick)
  return sc
}

const tricksOf = (a: string[]) => a.slice(1).filter((x) => x !== 'sketchy').join(',').split(',').filter(Boolean)

export function loadScenario(path: string): Scenario {
  return parseScenario(readFileSync(path, 'utf8'), basename(path).replace(/\.skate$/, ''), dirname(path))
}

const OPS: Record<string, (a: number, b: number) => boolean> = {
  '<': (a, b) => a < b, '<=': (a, b) => a <= b, '>': (a, b) => a > b, '>=': (a, b) => a >= b,
  '==': (a, b) => Math.abs(a - b) < 1e-9, '!=': (a, b) => Math.abs(a - b) >= 1e-9,
}

/** skater.pos.z, skater.speed, skater.hspeed, skater.heading, skater.state, ...; skater2.*, session2.*: player 2's. */
export function readPath(t: Thing, path: string, sess?: Thing, car?: Thing, npcs?: NpcCounts, peds?: PedCounts, t2?: Thing, sess2?: Thing, van?: Thing, actor?: Thing, npc?: Thing): number | string {
  if (path.startsWith('session.')) { if (!sess) throw new Error('no session'); return readPath(sess, path.slice(8)) }
  // players: 2 while player 2 is in, else 1. Its paths without it (not yet, or no more): NaN, so a comparison fails rather than the scenario.
  if (path === 'players') return t2 ? 2 : 1
  if (path.startsWith('skater2.')) return t2 ? readPath(t2, `skater.${path.slice(8)}`) : NaN
  if (path.startsWith('session2.')) return sess2 ? readPath(sess2, path.slice(9)) : NaN
  if (path.startsWith('peds.')) { const v = peds?.[path.slice(5) as keyof PedCounts]; if (v === undefined) throw new Error(`unknown path ${path} (peds.alive, peds.near, peds.aside)`); return v }
  if (path.startsWith('npcs.')) { const v = npcs?.[path.slice(5) as keyof NpcCounts]; if (v === undefined) throw new Error(`unknown path ${path} (npcs.onlane, npcs.watching, npcs.riding, npcs.waiting, npcs.crowded, npcs.stacked)`); return v }
  // car.gap: metres from the skater to the nearest car; car.<field>: that car's fields (car.car.speed, car.car.hazard)
  if (path === 'car.gap') return car ? Math.hypot(car.pos.x - t.pos.x, car.pos.y - t.pos.y) : Infinity
  if (path.startsWith('car.')) { if (!car) return NaN; return readPath(car, `skater.${path.slice(4)}`) }
  // van.gap: metres from the skater to that vehicle; van.<field>: its fields (van.speed, van.heading, van.car.drive.steer)
  if (path === 'van.gap') return van ? Math.hypot(van.pos.x - t.pos.x, van.pos.y - t.pos.y) : Infinity
  if (path.startsWith('van.')) { if (!van) return NaN; return readPath(van, `skater.${path.slice(4)}`) }
  // actor.gap: metres from the skater to the nearest actor (the story's characters on the move); actor.<field>: its fields (actor.actor.state, actor.actor.s)
  if (path === 'actor.gap') return actor ? Math.hypot(actor.pos.x - t.pos.x, actor.pos.y - t.pos.y) : Infinity
  if (path.startsWith('actor.')) { if (!actor) return NaN; return readPath(actor, `skater.${path.slice(6)}`) }
  // npc.gap: metres from the skater (in a vehicle: its middle) to the nearest NPC skater; npc.<field>: its fields (npc.pos.x, npc.state)
  if (path === 'npc.gap') return npc ? Math.hypot(npc.pos.x - t.pos.x, npc.pos.y - t.pos.y) : Infinity
  if (path.startsWith('npc.')) { if (!npc) return NaN; return readPath(npc, `skater.${path.slice(4)}`) }
  const p = path.replace(/^skater\./, '')
  if (p === 'speed') return len(t.vel)
  if (p === 'hspeed') return Math.hypot(t.vel.x, t.vel.y)
  if (p === 'heading') return ((headingOf(t.fwd) * 180) / Math.PI + 360) % 360
  let v: unknown = t
  for (const k of p.split('.')) v = (v as Record<string, unknown>)?.[k]
  if (typeof v !== 'number' && typeof v !== 'string' && typeof v !== 'boolean') throw new Error(`unknown path ${path}`)
  return typeof v === 'boolean' ? (v ? 1 : 0) : v
}

const fmt = (v: number | string) => (typeof v === 'number' ? (Math.round(v * 1000) / 1000).toString() : v)

function parseExpect(a: string[], line: string, err: (m: string) => Error): Expect {
  const text = line.replace(/^expect\s+/, '').replace(/\u0001/g, ' ')
  const atRow = (r: RunData, at: string) => (at === 'end' ? r.rows[r.rows.length - 1] : r.rows.find((x) => x.t === Number(at)))
  if (a[0] === 'no' && a[1] === 'event') {
    // no event name or name{field=value,...} (it used to read the braces as part of the name, so a
    // filtered "no event" could never fail)
    const m = /^([a-zA-Z][a-zA-Z0-9]*)(?:\{(.*)\})?$/.exec(a[2] ?? '')
    if (!m) throw err('expected an event name like bail or gap{id=big3}')
    const want = (m[2] ?? '').split(',').filter(Boolean).map((kv) => kv.replace(/\u0001/g, ' ').split('='))
    const name = m[1]
    const win = a[3] === 'within' ? a[4].split('..').map(Number) : [-Infinity, Infinity]
    return { text, check: (r) => {
      const hit = r.events.find((e) => e.t === name && want.every(([k, v]) => String((e as Record<string, unknown>)[k]) === v) && e.rel >= win[0] && e.rel <= win[1])
      return { pass: !hit, detail: hit ? `${name} at ${hit.rel}` : 'none' }
    } }
  }
  if (a[0] === 'event') {
    // event name or name{field=value,...}: fields must match (numbers, true/false, strings)
    const m = /^([a-zA-Z][a-zA-Z0-9]*)(?:\{(.*)\})?$/.exec(a[1] ?? '')
    if (!m) throw err('expected an event name like land or land{fakie=true}')
    const want = (m[2] ?? '').split(',').filter(Boolean).map((kv) => kv.replace(/\u0001/g, ' ').split('='))
    const name = m[1]
    const matches = (e: Record<string, unknown>) => e.t === name && want.every(([k, v]) => String(e[k]) === v)
    if (a[2] === 'within') {
      const [lo, hi] = a[3].split('..').map(Number)
      return { text, check: (r) => {
        const hit = r.events.find((e) => matches(e) && e.rel >= lo && e.rel <= hi)
        const any = r.events.filter((e) => e.t === name).map((e) => `${e.rel}${want.length ? ' ' + JSON.stringify(Object.fromEntries(want.map(([k]) => [k, (e as Record<string, unknown>)[k]]))) : ''}`)
        return { pass: !!hit, detail: hit ? `at ${hit.rel}` : any.length ? `at ${any.join(', ')}` : 'never' }
      } }
    }
    if (a[2] === 'count' && OPS[a[3]]) {
      const op = OPS[a[3]], n = Number(a[4])
      return { text, check: (r) => { const c = r.events.filter((e) => matches(e)).length; return { pass: op(c, n), detail: `${c}` } } }
    }
    throw err('expected "event <name> within a..b" or "event <name> count <op> n"')
  }
  if (a[0] === 'state') {
    const want = a[1], at = a[3] ?? 'end'
    if (a[2] !== 'at') throw err('expected "state <name> at <tick|end>"')
    return { text, check: (r) => { const row = atRow(r, at); const got = row ? row.thing.state : 'no such tick'; return { pass: got === want, detail: String(got) } } }
  }
  if (a[0] === 'max' || a[0] === 'min') {
    const which = a[0], path = a[1], op = OPS[a[2]], val = Number(a[3])
    if (!op || !Number.isFinite(val)) throw err('expected "max|min <path> <op> <number> [over a..b]"')
    const win = a[4] === 'over' ? a[5].split('..').map(Number) : [-Infinity, Infinity]
    return { text, check: (r) => {
      const vals = r.rows.filter((x) => x.t >= win[0] && x.t <= win[1]).map((x) => Number(readPath(x.thing, path, x.session, x.car, x.npcs, x.peds, x.thing2, x.session2, x.van, x.actor, x.npc))).filter((v) => !Number.isNaN(v))   // rows without the thing (no van yet) do not count
      const got = !vals.length ? NaN : which === 'max' ? Math.max(...vals) : Math.min(...vals)
      return { pass: op(got, val), detail: fmt(got) }
    } }
  }
  const path = a[0], op = OPS[a[1]], at = a[4] ?? 'end'
  if (!op || a[3] !== 'at' && a[3] !== undefined) throw err('expected "<path> <op> <value> at <tick|end>"')
  return { text, check: (r) => {
    const row = atRow(r, at)
    if (!row) return { pass: false, detail: `no tick ${at}` }
    const got = readPath(row.thing, path, row.session, row.car, row.npcs, row.peds, row.thing2, row.session2, row.van, row.actor, row.npc)
    if (typeof got === 'string') return { pass: a[1] === '==' ? got === a[2] : got !== a[2], detail: got }
    return { pass: op(got, Number(a[2])), detail: fmt(got) }
  } }
}

export type ScenarioResult = {
  name: string
  park: string
  ticks: number
  rows: Row[]
  events: (SimEvent & { rel: number })[]
  expects: { text: string; pass: boolean; detail: string }[]
  invariants: string[]
  replay: Replay
  sim: Sim
}

/**
 * Hooks for runs that are not checks (skate feel --tour): lite skips the per-tick rows, invariants and
 * expects; keys sees player 1's buttons last, after the script and the bots (a human balance in place of
 * the bot's); pilot filters the rider-line autopilot's keys; until stops the run early; start begins it
 * from a snapshot held in memory (as load does from a file).
 */
export type RunHooks = { lite?: boolean; until?: number; start?: Snapshot; keys?: (t: number, sim: Sim, b: number) => number; pilot?: (t: number, keys: number) => number }

export function runScenario(sc: Scenario, data: GameData, hooks: RunHooks = {}): ScenarioResult {
  const park = loadPark(sc.park, data)
  let sim: Sim
  let inputs: ((rel: number) => number) | null = null
  let inputs2: ((rel: number) => number) | null = null
  let replayCmds = new Map<number, string[]>()
  let ticks = sc.ticks
  if (sc.replay) {
    const rp = readJson<Replay>(sc.replay)
    sim = loadSnapshot(rp.start, park, data)
    const { b: flat, b2: flat2 } = replayInputs(rp)
    inputs = (t) => flat[t] ?? 0
    if (flat2) inputs2 = (t) => flat2[t] ?? 0
    for (const c of rp.commands) replayCmds.set(c.tick - rp.start.world.tick, [...(replayCmds.get(c.tick - rp.start.world.tick) ?? []), c.text])
    ticks = Math.max(ticks, flat.length)
  } else if (hooks.start || sc.load) {
    sim = loadSnapshot(hooks.start ?? readJson<Snapshot>(sc.load!), park, data)
  } else {
    sim = createSim(park, data, { seed: sc.seed, spot: sc.spawn })
  }
  const rec = new Recorder()
  const startTick = sim.world.tick
  // bot line: the rider-line autopilot (lines.ts) presses the keys from its tick until the line ends
  // (or the next bot line's tick: that one takes over, fresh).
  const pilots = [...sc.pilots].sort((p, q) => p.from - q.from).map((p) => {
    const line = p.path ? { id: 'path', points: p.path, maxSlopeDeg: 0, radius: 2 } : sim.park.lines.find((l) => l.id === p.line)
    if (!line) throw new Error(`${sc.name}: no rider line "${p.line}" in ${sc.park}`)
    return { ...p, line, st: { i: 1, lastUp: -1000, maxSpeed: 0 } as PilotState, done: false }
  })
  const drives = sc.drives.map((d) => ({ ...d, path: d.path.map((q) => [q[0], q[1]] as [number, number]), i: 0, done: false }))
  let skatePilot: TrickPilot | null = null, skatePlan: TrickPlan | null = null
  const horse: Record<1 | 2, { pilot: TrickPilot; plan: TrickPlan } | null> = { 1: null, 2: null }
  const rows: Row[] = []
  const events: (SimEvent & { rel: number })[] = []
  const invariants: string[] = []
  if (!hooks.lite) rows.push({ t: 0, thing: structuredClone(skater(sim)), npcs: countNpcs(sim), peds: countPeds(sim) })
  for (let t = 0; t < Math.min(ticks, hooks.until ?? Infinity); t++) {
    const p2 = player2(sim)
    let b = inputs ? inputs(t) : 0, b2 = inputs2 ? inputs2(t) : 0
    for (const h of sc.holds) if (t >= h.from && t < h.to) { if (h.p === 2) b2 |= h.b; else b |= h.b }
    for (const n of [1, 2] as const) {
      const who = n === 1 ? skater(sim) : p2?.sk
      const p = pilots.findLast((q) => q.p === n && t >= q.from)
      if (!who || !p || p.done) continue
      let keys = pilotKeys(sim, p.line, p.st, t, p.speed ?? (p.line.maxSlopeDeg >= 4 ? 16 : 5), who, p.cars)
      if (keys === null) { p.done = true; continue }
      if (p.nobrake) keys &= ~(Btn.slide | Btn.down)
      if (n === 1 && hooks.pilot) keys = hooks.pilot(t, keys)
      if (n === 1) b |= keys; else b2 |= keys
    }
    // bot drive: the driving autopilot, the latest started, for whoever is in a vehicle.
    for (const n of [1, 2] as const) {
      const who = n === 1 ? skater(sim) : p2?.sk, dv = drives.findLast((q) => q.p === n && t >= q.from)
      if (!who || !dv) continue
      const keys = driveKeys(sim, who, dv)
      if (keys !== null) { if (n === 1) b |= keys; else b2 |= keys }
    }
    // bot horse: a player's HORSE turn with the clock running: the trick autopilot rides the try, fresh each turn.
    for (const n of [1, 2] as const) {
      const bot = sc.horseBots[n], s = session(sim), who = n === 1 ? skater(sim) : p2?.sk
      if (!bot || !who) continue
      const mine = s.mode === 'horse2p' && s.horseTurn === n && (s.horsePause ?? 0) === 0
      if (mine && !horse[n]) {
        const used = s.horseUsed ?? [], sets = [...bot.sets, ...sim.data.run.skate.sets]
        const trick = s.horseRole === 'match' ? s.horseTrick ?? 'ollie' : sets.find((x) => !used.includes(x)) ?? 'ollie'
        horse[n] = { pilot: freshPilot(), plan: { trick, make: !bot.sketchy, miss: 'twist', twist: (sim.data.physics.land.cleanDeg + 10) * DEG, failAt: 0 } }
      }
      if (!mine) horse[n] = null
      const h = horse[n]
      if (h) { const keys = trickKeys(sim, who, h.pilot, h.plan); if (n === 1) b |= keys; else b2 |= keys }
    }
    if (sc.skateBot) {
      // Your turn and the clock running: the trick autopilot rides the try, fresh each turn.
      const s = session(sim), mine = s.mode === 'skate' && s.skateTurn === 'player' && (s.skatePause ?? 0) === 0
      if (mine && !skatePilot) {
        const used = s.skateUsed ?? [], sets = [...sc.skateBot.sets, ...sim.data.run.skate.sets]
        const trick = s.skateRole === 'match' ? s.skateTrick ?? 'ollie' : sets.find((x) => !used.includes(x)) ?? 'ollie'
        skatePilot = freshPilot()
        skatePlan = { trick, make: !sc.skateBot.sketchy, miss: 'twist', twist: (sim.data.physics.land.cleanDeg + 10) * DEG, failAt: 0 }   // sketchy: 10 degrees past the clean band
      }
      if (!mine) skatePilot = null
      if (skatePilot && skatePlan) b |= trickKeys(sim, skater(sim), skatePilot, skatePlan)
    }
    b = balanceBot(sc.bots.has('balance'), skater(sim), b)
    if (hooks.keys) b = hooks.keys(t, sim, b)
    if (p2) b2 = balanceBot(sc.bots.has('balance2'), p2.sk, b2)
    const cmds = [...(replayCmds.get(t) ?? []), ...(sc.cmds.get(t) ?? [])]
    // Player 2's buttons ride along while it is in, or whenever the script or the replay drives it.
    const ev = rec.tick(sim, sc.two || inputs2 || p2 ? { b, b2 } : { b }, cmds)
    for (const e of ev) events.push({ ...e, rel: t + 1 })
    if (hooks.lite) continue
    const sk = skater(sim), after2 = player2(sim)
    let car: Thing | undefined, gap = Infinity
    let van: Thing | undefined, vgap = Infinity
    for (const c of sim.world.things) {
      if (c.kind !== 'car') continue
      const d = Math.hypot(c.pos.x - sk.pos.x, c.pos.y - sk.pos.y)
      if (c.car?.drive) { if (c.id === sk.drive) { van = c; vgap = -1 } else if (d < vgap) { vgap = d; van = c } } else if (d < gap) { gap = d; car = c }
    }
    const row: Row = { t: t + 1, thing: structuredClone(sk), session: structuredClone(session(sim)), car: car && structuredClone(car), npcs: countNpcs(sim), peds: countPeds(sim) }
    if (van) row.van = structuredClone(van)
    let actor: Thing | undefined, agap = Infinity
    for (const m of sim.world.things) if (m.kind === 'actor' && m.alive) { const d = Math.hypot(m.pos.x - sk.pos.x, m.pos.y - sk.pos.y); if (d < agap) { agap = d; actor = m } }
    if (actor) row.actor = structuredClone(actor)
    let npc: Thing | undefined, ngap = Infinity
    for (const m of sim.world.things) if (m.kind === 'npc' && m.alive) { const d = Math.hypot(m.pos.x - sk.pos.x, m.pos.y - sk.pos.y); if (d < ngap) { ngap = d; npc = m } }
    if (npc) row.npc = { ...npc, npc: null } as Thing   // its place and state (not its autopilot's life: rows are many)
    if (after2) { row.thing2 = structuredClone(after2.sk); row.session2 = structuredClone(after2.s) }
    rows.push(row)
    let bad = checkInvariants(sim, sk) ?? flicker(events, t + 1, after2 ? 1 : undefined)
    if (!bad && after2) { const b2bad = checkInvariants(sim, after2.sk) ?? flicker(events, t + 1, 2); if (b2bad) bad = `player 2: ${b2bad}` }
    if (bad && invariants.length < 5) invariants.push(`tick ${t + 1}: ${bad}`)
  }
  const run: RunData = { rows, events, startTick }
  return {
    name: sc.name, park: sc.park, ticks, rows, events,
    expects: hooks.lite ? [] : sc.expects.map((e) => ({ text: e.text, ...e.check(run) })),
    invariants, replay: rec.replay(), sim,
  }
}

/** The balance bot: on a grind or lip, A/D against the meter (not on ticks the script presses grind: a switch reads it); in a manual, up/down against it. */
function balanceBot(on: boolean, sk: Thing, b: number): number {
  if (!on) return b
  const g = sk.grind ?? sk.lip ?? sk.skitch   // a skitch balances on left and right as a grind (physics phase 32)
  if (g && (b & (Btn.left | Btn.right | Btn.grind)) === 0) b |= g.balance > 0.03 ? Btn.left : g.balance < -0.03 ? Btn.right : 0
  if (sk.manual) b = (b & ~(Btn.up | Btn.down)) | (sk.manual.balance > 0.03 ? Btn.down : sk.manual.balance < -0.03 ? Btn.up : 0)
  return b
}

/** Park NPC skaters (not racers, not the S.K.A.T.E. local): watching a game, riding, and riding on its lane. */
function countNpcs(sim: Sim): NpcCounts {
  const c: NpcCounts = { onlane: 0, watching: 0, riding: 0, waiting: 0, crowded: 0, stacked: 0 }
  const spots = new Map<string, number>()
  for (const n of sim.world.things) {
    if (n.kind !== 'npc' || !n.npc || n.npc.racer || n.npc.skate) continue
    if (n.npc.watch !== undefined) c.watching++
    else { c.riding++; if (onSkateLane(sim, n.pos.x, n.pos.y)) c.onlane++ }
    if (n.npc.act === 'wait') c.waiting++
    const spot = npcSpot(sim, n)
    if (spot) spots.set(spot, (spots.get(spot) ?? 0) + 1)
  }
  for (const k of spots.values()) if (k > 1) c.crowded++
  const waiters = sim.world.things.filter((n) => n.kind === 'npc' && n.npc?.act === 'wait')
  for (let i = 0; i < waiters.length; i++) for (let j = i + 1; j < waiters.length; j++) if (Math.hypot(waiters[i].pos.x - waiters[j].pos.x, waiters[i].pos.y - waiters[j].pos.y) < 1) c.stacked++
  return c
}

/** Pedestrians: in the world, within 100 m of the skater, stepping aside now. */
function countPeds(sim: Sim): PedCounts {
  const c: PedCounts = { alive: 0, near: 0, aside: 0 }
  const sk = skater(sim)
  for (const p of sim.world.things) {
    if (p.kind !== 'ped' || !p.ped || !p.alive) continue
    c.alive++
    if (Math.hypot(p.pos.x - sk.pos.x, p.pos.y - sk.pos.y) <= 100) c.near++
    if (p.ped.to !== 0) c.aside++
  }
  return c
}

/**
 * More than 6 hops of 4 ticks or less within one second means the skater is stuck flickering on
 * something (losing the ground and finding it again). Rolling down stairs is longer drops, one a step.
 * player: count only that player's landings (with player 2 in, events carry their player).
 */
export function flicker(events: { t: string; rel: number; airTicks?: number; player?: unknown }[], now: number, player?: 1 | 2): string | null {
  let n = 0
  for (let i = events.length - 1; i >= 0 && events[i].rel > now - 120; i--) if (events[i].t === 'land' && (events[i].airTicks ?? 0) <= 4 && (player === undefined || (events[i].player ?? 1) === player)) n++
  return n > 6 ? `air/land flicker (${n} hops of 4 ticks or less in 1 s)` : null
}

/** Per-tick invariants shared by scenarios and fuzzing. Returns a problem or null. */
export function checkInvariants(sim: Sim, t: Thing): string | null {
  const vals = [t.pos.x, t.pos.y, t.pos.z, t.vel.x, t.vel.y, t.vel.z]
  if (!vals.every(Number.isFinite)) return 'NaN or infinite position/velocity'
  const p = sim.park, m = 5
  if (t.pos.x < p.boundsMin.x - m || t.pos.x > p.boundsMax.x + m || t.pos.y < p.boundsMin.y - m || t.pos.y > p.boundsMax.y + m || t.pos.z < p.boundsMin.z - m)
    return `outside park bounds at ${t.pos.x.toFixed(2)} ${t.pos.y.toFixed(2)} ${t.pos.z.toFixed(2)}`
  if (len(t.vel) > sim.data.physics.limits.maxSpeed + 1e-6) return `speed ${len(t.vel).toFixed(2)} over cap`
  const r = sim.data.physics.skater.radius
  if (sphereContacts(p, t.pos, r * 0.7, inside).length > 0) return `inside geometry (${(r - inside[0].dist).toFixed(3)} m deep, triangle ${inside[0].tri})`
  return null
}
const inside: Contact[] = []
