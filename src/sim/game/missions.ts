import type { CastMember, DialogueLine, Mission, MissionStep, Place } from '../data.ts'
import { DEG, headingDir, v3 } from '../math.ts'
import { raycast } from '../park/park.ts'
import { findSpot, spawn, type Sim, type SimEvent } from '../sim.ts'
import { Kind, State, type MissionRun, type Thing } from '../thing.ts'
import { startRun } from './session.ts'
import { actorRun, moveActor, placeActor } from './movers.ts'
import { clearVehicles, drivenBy, placeVehicle } from './vehicles.ts'
import { carFrame } from './traffic.ts'

// Missions (docs/mechanics/missions.md, data/missions.json, docs/story.md): the story's chapters and
// the side stories, as steps that reuse what the game already has. A mission is started, advanced and
// ended by commands (mission start <id>, mission next [all], mission accept | decline | skip | abandon),
// and read from the skater's events each tick after the game's own step; it never changes skating.
// Its state is the session's mission field (absent without one); which missions are done is the
// client's save. A follow step's moving character is a Thing of kind 'actor', and so is a carry step's
// passenger once aboard. Drive steps (drive, carry, and collect or deliver with a vehicle) read the
// vehicle the player drives (game/vehicles.ts); the vehicles a mission places go when it ends.

type Vec = [number, number, number]
type Step<K extends MissionStep['kind']> = Extract<MissionStep, { kind: K }>
const inBox = (b: [number, number, number, number], x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]

export function missionData(sim: Sim, id: string): Mission {
  const M = sim.data.missions.missions.find((m) => m.id === id)
  if (!M) throw new Error(`no mission "${id}" (data/missions.json: ${sim.data.missions.missions.map((m) => m.id).join(', ')})`)
  return M
}

/** The world a mission is played in (default sf) and the others with the same ground. */
export const missionWorlds = (M: Mission) => [M.world ?? 'sf', ...(M.worlds ?? [])]

const actorOf = (sim: Sim, m: MissionRun | undefined) => (m && m.actor >= 0 ? sim.world.things.find((t) => t.id === m.actor && t.alive) : undefined)

/** Where a mission puts a character at a step (the latest step up to it that places them, else the mission's actors): x y z heading, or null. */
export function actorPlace(M: Mission, step: number, who: string): [number, number, number, number] | null {
  let at = M.actors?.[who] ?? null
  for (let i = 0; i <= step && i < M.steps.length; i++) at = M.steps[i].actors?.[who] ?? at
  return at
}

/** Where a character stands now: the mission's moving character, the mission's actors (where it puts them), else their home. */
export function castAt(sim: Sim, s: Thing, who: string): Vec | null {
  const a = actorOf(sim, s.mission)
  if (a?.actor?.who === who) return [a.pos.x, a.pos.y, a.pos.z]
  const placed = s.mission ? actorPlace(missionData(sim, s.mission.id), s.mission.step, who) : null
  if (placed) return [placed[0], placed[1], placed[2]]
  const c = sim.data.cast.cast.find((x) => x.id === who)
  return c ? homeOf(sim, c) : null
}

/**
 * Where a character stands when no mission moves them: at their anchor inside a city room (cast inside:
 * "<room>/<anchor>", the city's city.interiors) when the world has that room, else at home (data/cast.json home).
 */
export function homeOf(sim: Sim, c: CastMember): Vec {
  const a = insideAnchor(sim, c)
  return a ? [a[0], a[1], a[2]] : c.home
}
/** The character's anchor in a city room (x y z heading in degrees), if they have one and the world has the room. */
export function insideAnchor(sim: Sim, c: CastMember): [number, number, number, number] | null {
  if (!c.inside) return null
  const [room, anchor] = c.inside.split('/')
  return sim.park.interiors.find((r) => r.id === room)?.anchors[anchor] ?? null
}

/** Every line a step can say (talk lines, barks as it starts and when done, between counts or items, a follower's and a passenger's), for voices and the client. */
export function stepLines(st: MissionStep): DialogueLine[] {
  return [...st.say ?? [], ...st.done ?? [], ...(st.kind === 'talk' ? st.lines : []), ...(st.kind === 'trick' || st.kind === 'collect' ? st.each ?? [] : []),
    ...(st.kind === 'follow' ? [...st.waiting ?? [], ...st.passed ?? []] : []), ...(st.kind === 'carry' ? st.lines ?? [] : [])]
}

/** A place: x y z, 'cast:<id>' (where that character stands now) or a spot id. */
export function placeOf(sim: Sim, s: Thing, p: Place): Vec | null {
  if (Array.isArray(p)) return p
  if (p.startsWith('cast:')) return castAt(sim, s, p.slice(5))
  const spot = findSpot(sim, p)
  return spot ? [spot.pos.x, spot.pos.y, spot.pos.z] : null
}

const near = (sim: Sim, sk: Thing, p: Vec | null, r: number, h = sim.data.missions.height) => !!p && Math.hypot(sk.pos.x - p[0], sk.pos.y - p[1]) < r && Math.abs(sk.pos.z - p[2]) < h

const step = (sim: Sim, m: MissionRun) => missionData(sim, m.id).steps[m.step]

/** The vehicle the player drives, when it is the one a step wants (a type, a name, any; no want: any). */
function driving(sim: Sim, sk: Thing, want: string | undefined): Thing | null {
  const c = drivenBy(sim, sk)
  if (!c) return null
  const d = c.car!.drive!
  return !want || want === 'any' || d.name === want || d.type === want ? c : null
}
const slow = (sim: Sim, c: Thing) => Math.hypot(c.vel.x, c.vel.y) <= sim.data.vehicles.exit.speed
/** Place the vehicles a mission or a step names (moved there if they exist; not one being driven). */
function placeVehicles(sim: Sim, vs: { name: string; type: string; at: [number, number, number] }[] | undefined) {
  for (const v of vs ?? []) {
    const c = sim.world.things.find((t) => t.car?.drive?.name === v.name && t.alive)
    if (c && c.car!.drive!.driver >= 0) continue
    placeVehicle(sim, v.type, v.name, v.at[0], v.at[1], v.at[2])
  }
}

function lines(sim: Sim, m: MissionRun, ls: DialogueLine[] | undefined, events: SimEvent[]) {
  ls?.forEach((l, n) => events.push({ t: 'talk', tick: sim.world.tick, mission: m.id, character: l.who, line: l.id, n, of: ls.length, bark: true }))
}

/** `mission start <id> [step]`: starts it (any mission on is abandoned, any game left for free skate). */
export function startMission(sim: Sim, s: Thing, sk: Thing, events: SimEvent[], id: string, at = 0) {
  const M = missionData(sim, id)
  if (!missionWorlds(M).includes(sim.park.name)) throw new Error(`mission ${id} is played in ${missionWorlds(M).join(' or ')}, not ${sim.park.name}`)
  if (!(at >= 0 && at < M.steps.length)) throw new Error(`mission ${id} has steps 0..${M.steps.length - 1}`)
  if (s.mission) endMission(sim, s, events, { t: 'missionAbandoned', tick: sim.world.tick, mission: s.mission.id, reason: 'abandoned' })
  if (s.game !== 'free' || s.mode !== 'free') startRun(sim, 'free', events)
  s.mission = { id, step: at, ticks: 0, talk: -1, offer: false, count: 0, got: [], clock: -1, armed: false, away: 0, actor: -1, grind: 0, wrap: false }
  events.push({ t: 'missionStart', tick: sim.world.tick, mission: id, name: M.name, kind: M.kind })
  placeVehicles(sim, M.vehicles)
  enter(sim, s, sk, events)
}

/** Into the mission's current step: its fields fresh, its barks, its game or its character set going. */
function enter(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const m = s.mission!, M = missionData(sim, m.id), st = M.steps[m.step], hz = sim.data.physics.tickHz
  Object.assign(m, { ticks: 0, talk: -1, offer: false, count: 0, got: [], clock: st.seconds ? Math.round(st.seconds * hz) : -1, armed: false, away: 0, grind: 0, wrap: false })
  events.push({ t: 'missionStep', tick: sim.world.tick, mission: m.id, step: m.step, of: M.steps.length, kind: st.kind, text: st.text, ...(st.seconds ? { seconds: st.seconds } : {}) })
  lines(sim, m, st.say, events)
  placeVehicles(sim, st.vehicles)
  if (st.kind === 'deliver') { m.armed = !st.from; if (st.from) m.clock = -1 }
  if (st.kind === 'follow' || st.kind === 'race') spawnActor(sim, m, st)
  if (st.kind === 'mode') {
    // The game, started as its own command would (it places you at its start), with the mission kept on.
    delete s.mission
    try { startRun(sim, st.mode, events, st.route) } finally { s.mission = m }
    m.wrap = true
  }
  // The offer starts at once (you pressed the talk key by them), a call wherever you are, the rest once you are by them.
  if (st.kind === 'talk' && (st.offer || st.phone || near(sim, sk, castAt(sim, s, st.who), st.radius ?? sim.data.missions.talkRadius))) say(sim, m, st, 0, events)
}

function say(sim: Sim, m: MissionRun, st: Step<'talk'>, n: number, events: SimEvent[]) {
  m.talk = n
  const l = st.lines[n]
  events.push({ t: 'talk', tick: sim.world.tick, mission: m.id, character: l.who, line: l.id, n, of: st.lines.length })
}

/** The step is done: its barks, then the next step or the mission's end. */
function advance(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const m = s.mission!, M = missionData(sim, m.id), st = M.steps[m.step]
  lines(sim, m, st.done, events)
  if (m.wrap) leaveGame(sim, s, events)
  if (++m.step < M.steps.length) { enter(sim, s, sk, events); return }
  endMission(sim, s, events, { t: 'missionDone', tick: sim.world.tick, mission: m.id, name: M.name, kind: M.kind, ...(M.reward?.sticker ? { sticker: M.reward.sticker } : {}), ...(M.reward?.unlock ? { unlock: M.reward.unlock } : {}), ...(M.job ? { board: M.job.board, gig: M.job.gig } : {}) })
}

/** A wrapped game is over (won, lost or left): back to free skate, the mission kept. */
function leaveGame(sim: Sim, s: Thing, events: SimEvent[]) {
  const m = s.mission!
  m.wrap = false
  delete s.mission
  try { startRun(sim, 'free', events) } finally { s.mission = m }
}

/** The mission ends (done, skipped, abandoned, failed): its game and its character go, then the event. */
function endMission(sim: Sim, s: Thing, events: SimEvent[], e: SimEvent) {
  const m = s.mission!
  if (m.wrap) leaveGame(sim, s, events)
  const a = actorOf(sim, m)
  if (a) sim.world.things.splice(sim.world.things.indexOf(a), 1)
  // The vehicles it placed go (whoever drives one is put out first).
  const M = missionData(sim, m.id)
  for (const v of [...M.vehicles ?? [], ...M.steps.flatMap((st) => st.vehicles ?? [])]) clearVehicles(sim, v.name, events)
  delete s.mission
  events.push(e)
}

const fail = (sim: Sim, s: Thing, events: SimEvent[], reason: 'time' | 'lost' | 'bail' | 'bump' | 'mode') =>
  endMission(sim, s, events, { t: 'missionFailed', tick: sim.world.tick, mission: s.mission!.id, step: s.mission!.step, reason })

/** Abandoned because another game was started (session.ts startRun). */
export function abandonForGame(sim: Sim, s: Thing, events: SimEvent[]) {
  if (s.mission) endMission(sim, s, events, { t: 'missionAbandoned', tick: sim.world.tick, mission: s.mission.id, reason: 'mode' })
}

/** The mission commands besides start: next [all], accept, decline, skip, abandon, pass. Returns a line for the command's result. */
export function missionCommand(sim: Sim, s: Thing, sk: Thing, events: SimEvent[], op: 'next' | 'all' | 'accept' | 'decline' | 'skip' | 'abandon' | 'pass'): string {
  const m = s.mission
  if (!m) throw new Error('no mission on')
  const tick = sim.world.tick
  if (op === 'skip') { endMission(sim, s, events, { t: 'missionSkipped', tick, mission: m.id }); return `${m.id} skipped` }
  if (op === 'abandon') { endMission(sim, s, events, { t: 'missionAbandoned', tick, mission: m.id, reason: 'abandoned' }); return `${m.id} abandoned` }
  const st = step(sim, m)
  // Dev (tests, the whole-story playthrough): the step done as if its condition were met, its done lines said,
  // its game left. Talk steps are read (next all) and offers accepted, never passed.
  if (op === 'pass') {
    if (st.kind === 'talk') throw new Error('mission pass: a talk step is read (mission next all) or accepted')
    advance(sim, s, sk, events)
    return `${m.id}: step ${m.step} passed`
  }
  if (op === 'accept' || op === 'decline') {
    if (!m.offer) throw new Error('no offer waiting')
    if (op === 'decline') { endMission(sim, s, events, { t: 'missionAbandoned', tick, mission: m.id, reason: 'declined' }); return `${m.id} declined` }
    m.offer = false
    advance(sim, s, sk, events)
    return `${m.id} accepted`
  }
  if (st.kind !== 'talk' || m.talk < 0 || m.offer) throw new Error('no conversation on')
  const n = op === 'all' ? st.lines.length : m.talk + 1
  if (n < st.lines.length) { say(sim, m, st, n, events); return `line ${n + 1} of ${st.lines.length}` }
  m.talk = st.lines.length
  if (st.offer) { m.offer = true; events.push({ t: 'missionOffer', tick, mission: m.id }); return 'accept or decline' }
  advance(sim, s, sk, events)
  return 'conversation over'
}

// ---- each tick ----

/** After the game's own step (its over events are in events): the step on now. */
export function stepMission(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const m = s.mission
  if (!m) return
  const st = step(sim, m), D = sim.data.missions, hz = sim.data.physics.tickHz
  m.ticks++
  if (m.clock > 0 && --m.clock === 0) { fail(sim, s, events, 'time'); return }
  switch (st.kind) {
    case 'talk':
      if (m.talk < 0 && near(sim, sk, castAt(sim, s, st.who), st.radius ?? D.talkRadius)) say(sim, m, st, 0, events)
      return
    case 'go':
      if (near(sim, sk, placeOf(sim, s, st.to), st.radius ?? D.goRadius)) advance(sim, s, sk, events)
      return
    case 'trick': return trick(sim, s, sk, st, events)
    case 'collect': {
      const r = st.radius ?? D.collectRadius
      // With a vehicle: picked up driving it (stop: rolling no faster than getting out allows).
      if (st.vehicle) { const c = driving(sim, sk, st.vehicle); if (!c || (st.stop && !slow(sim, c))) return }
      st.items.forEach((p, i) => {
        if (m.got.includes(i) || !near(sim, sk, p, r, st.height)) return   // height: up or down from the item that counts (a roof's item wants you up there)
        m.got.push(i)
        events.push({ t: 'missionItem', tick: sim.world.tick, mission: m.id, n: m.got.length, of: st.items.length, item: st.item })
        if (m.got.length < st.items.length && st.each?.length) lines(sim, m, [st.each[(m.got.length - 1) % st.each.length]], events)   // a bark between items
      })
      if (m.got.length === st.items.length) advance(sim, s, sk, events)
      return
    }
    case 'deliver': {
      const r = st.radius ?? D.deliverRadius
      // With a vehicle: picked up and dropped driving it; noBump: a bump that hard spills the load.
      const c = st.vehicle ? driving(sim, sk, st.vehicle) : null
      if (m.armed && st.noBump && events.some((e) => e.t === 'vanBump' && e.speed >= st.noBump! && (!st.vehicle || e.car === drivenBy(sim, sk)?.id))) { fail(sim, s, events, 'bump'); return }
      if (st.vehicle && !c) return
      if (!m.armed) {
        if (!st.from || !near(sim, sk, placeOf(sim, s, st.from), r)) return
        m.armed = true
        if (st.seconds) m.clock = Math.round(st.seconds * hz)
        events.push({ t: 'missionItem', tick: sim.world.tick, mission: m.id, n: 1, of: 1, item: st.item })
        return
      }
      if (st.noBail && events.some((e) => e.t === 'bail')) { fail(sim, s, events, 'bail'); return }
      if (near(sim, sk, placeOf(sim, s, st.to), r)) advance(sim, s, sk, events)
      return
    }
    case 'follow': return follow(sim, s, sk, st, events)
    case 'drive': {
      const c = driving(sim, sk, st.vehicle)
      if (c && (!st.stop || slow(sim, c)) && near(sim, sk, placeOf(sim, s, st.to), st.radius ?? D.driveRadius)) advance(sim, s, sk, events)
      return
    }
    case 'carry': return carry(sim, s, sk, st, events)
    case 'race': return race(sim, s, sk, st, events)
    case 'mode': return mode(sim, s, sk, st, events)
  }
}

/** A trick step: an air, a grind of so many metres, or a banked combo (points, holding a gap or a trick), in its area, count times. */
function trick(sim: Sim, s: Thing, sk: Thing, st: Step<'trick'>, events: SimEvent[]) {
  const m = s.mission!, hz = sim.data.physics.tickHz
  const c = st.near ? placeOf(sim, s, st.near) : null, r = st.radius ?? 30
  const inArea = (x: number, y: number) => (!st.box || inBox(st.box, x, y)) && (!c || Math.hypot(x - c[0], y - c[1]) < r)
  let hits = 0
  if (st.air !== undefined) {
    for (const e of events) if (e.t === 'land' && e.airTicks >= st.air * hz && inArea(sk.takeoffXY[0], sk.takeoffXY[1])) hits++
  } else if (st.grind !== undefined) {
    if (events.some((e) => e.t === 'grindStart')) m.grind = 0
    if (sk.state === State.grind && sk.grind && sk.grind.car < 0 && (!st.feature || sim.park.grind[sk.grind.line]?.feature === st.feature)) {
      m.grind += Math.abs(sk.grind.speed) / hz
      if (m.grind >= st.grind && inArea(sk.pos.x, sk.pos.y)) { hits++; m.grind = -Infinity }   // once a grind
    }
  } else {
    for (const e of events) {
      if (e.t !== 'comboLanded' || e.points < (st.points ?? 0)) continue
      if (st.gaps && !e.entries.some((x) => st.gaps!.some((g) => x.id === `gap-${g}`))) continue
      if (st.tricks && !e.entries.some((x) => st.tricks!.includes(x.id))) continue
      if (inArea(s.comboFrom[0], s.comboFrom[1]) || inArea(sk.pos.x, sk.pos.y)) hits++
    }
  }
  if (!hits) return
  m.count += hits
  if (m.count >= (st.count ?? 1)) { advance(sim, s, sk, events); return }
  const each = st.each?.[(m.count - 1) % st.each.length]
  if (each) lines(sim, m, [each], events)
}

// ---- follow: a character on a path; stay within distance ----

function groundZ(sim: Sim, x: number, y: number, z: number) {
  // From about z; else from high above (a course far above or below the character's home: an odd job's race).
  const h = raycast(sim.park, v3(x, y, z + 3), v3(0, 0, -1), 12) ?? raycast(sim.park, v3(x, y, 2000), v3(0, 0, -1), 4000)
  return h ? h.point.z + sim.data.physics.skater.radius : z
}

/** Where along a path s metres is, and which way it goes there. */
function along(path: [number, number][], s: number): { x: number; y: number; dx: number; dy: number; end: boolean } {
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], d = Math.hypot(bx - ax, by - ay)
    if (s <= d || i === path.length - 1) {
      const u = d > 0 ? Math.min(1, s / d) : 1
      return { x: ax + (bx - ax) * u, y: ay + (by - ay) * u, dx: d > 0 ? (bx - ax) / d : 0, dy: d > 0 ? (by - ay) / d : 1, end: i === path.length - 1 && s >= d }
    }
    s -= d
  }
  return { x: path[0][0], y: path[0][1], dx: 0, dy: 1, end: true }
}

const pathLength = (path: [number, number][]) => path.reduce((n, q, i) => (i ? n + Math.hypot(q[0] - path[i - 1][0], q[1] - path[i - 1][1]) : 0), 0)

function spawnActor(sim: Sim, m: MissionRun, st: Step<'follow'> | Step<'race'>) {
  const old = actorOf(sim, m)
  if (old) sim.world.things.splice(sim.world.things.indexOf(old), 1)
  const t = spawn(sim, Kind.actor), p = along(st.path, 0), home = sim.data.cast.cast.find((c) => c.id === st.who)
  // A racer never stops for you: its wait is longer than its whole path.
  t.actor = st.kind === 'race'
    ? actorRun(sim, { who: st.who, mode: 'escort', pace: st.speed, path: st.path, wait: pathLength(st.path) + 1 }, 'hold')
    : actorRun(sim, { who: st.who, mode: 'escort', pace: st.speed, path: st.path, wait: st.wait, resume: st.resume, lead: st.lead }, 'hold')
  t.pos = v3(p.x, p.y, groundZ(sim, p.x, p.y, home?.home[2] ?? 0))
  t.fwd = Math.hypot(p.dx, p.dy) > 0 ? v3(p.dx, p.dy, 0) : headingDir((home?.heading ?? 0) * DEG)
  t.state = State.ground
  m.actor = t.id
}

/** How far along a path the point nearest (x, y) is, and how far off the path (metres). */
function progress(path: [number, number][], x: number, y: number): { s: number; off: number } {
  let best = { s: 0, off: Infinity }, run = 0
  for (let i = 1; i < path.length; i++) {
    const [ax, ay] = path[i - 1], [bx, by] = path[i], dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2)
    const u = L2 > 0 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)) : 0
    const off = Math.hypot(ax + dx * u - x, ay + dy * u - y)
    if (off < best.off) best = { s: run + u * L, off }
    run += L
  }
  return best
}

function follow(sim: Sim, s: Thing, sk: Thing, st: Step<'follow'>, events: SimEvent[]) {
  const m = s.mission!, t = actorOf(sim, m), hz = sim.data.physics.tickHz
  if (!t?.actor) return
  const a = t.actor, gap = Math.hypot(t.pos.x - sk.pos.x, t.pos.y - sk.pos.y)
  // It sets off once you are close (so the start is fair), then goes at its pace (game/movers.ts):
  // easing in, stopping for you when you fall behind, noticing when you pass it (a bark each, in turn).
  if (!m.armed && gap < st.distance) { m.armed = true; a.state = 'go' }
  if (!m.armed) return
  for (const c of moveActor(sim, t, sk, events)) {
    const ls = c === 'wait' ? st.waiting : c === 'overtaken' ? st.passed : undefined
    if (ls?.length) lines(sim, m, [ls[m.count++ % ls.length]], events)
  }
  const arrived = a.state === 'done'
  // Lost: more than distance behind it along the way, or that far off the way (ahead of it, and past
  // the way's end, is fine). Done when it arrives with you by it or already there.
  const me = progress(st.path, sk.pos.x, sk.pos.y), end = me.s >= a.s && arrived
  const behind = a.s - me.s > st.distance || (me.off > st.distance && !end && me.s < a.s)
  m.away = behind ? m.away + 1 : 0
  if (m.away > st.lose * hz) { fail(sim, s, events, 'lost'); return }
  if (arrived && (gap < st.distance || me.s >= a.s - st.distance)) advance(sim, s, sk, events)
}

// ---- carry: a passenger to a place ----

/**
 * A carry step: they wait where the mission puts them; the vehicle it wants, stopped (no faster than
 * getting out allows) within radius of them, takes them aboard (an actor at the passenger seat,
 * passengerIn). On the way they say the step's lines, one every `every` seconds of driving. Stopped
 * within radius of the place, they get out beside the passenger door (passengerOut): done.
 */
function carry(sim: Sim, s: Thing, sk: Thing, st: Step<'carry'>, events: SimEvent[]) {
  const m = s.mission!, D = sim.data.missions, hz = sim.data.physics.tickHz, r = st.radius ?? D.carryRadius, tick = sim.world.tick
  const c = driving(sim, sk, st.vehicle), a = actorOf(sim, m)
  if (!a || a.actor?.mode !== 'ride') {
    if (!c || !slow(sim, c) || !near(sim, sk, castAt(sim, s, st.who), r)) return
    if (a) sim.world.things.splice(sim.world.things.indexOf(a), 1)
    const t = spawn(sim, Kind.actor)
    t.actor = actorRun(sim, { who: st.who, mode: 'ride', pace: 1, car: c.id }, 'go')
    m.actor = t.id; m.count = 0; m.away = 0
    moveActor(sim, t, sk, events)
    events.push({ t: 'passengerIn', tick, mission: m.id, who: st.who, car: c.id })
    return
  }
  moveActor(sim, a, sk, events)   // at the passenger seat
  const car = sim.world.things.find((t) => t.id === a.actor!.car && t.alive)
  if (!car) return
  // A line every `every` seconds while the vehicle moves.
  if (st.lines && m.count < st.lines.length && Math.hypot(car.vel.x, car.vel.y) > 1 && ++m.away >= (st.every ?? D.carryEvery) * hz) {
    m.away = 0
    lines(sim, m, [st.lines[m.count++]], events)
  }
  if (c !== car || !slow(sim, car) || !near(sim, sk, placeOf(sim, s, st.to), r)) return
  // Out beside the passenger door (the right), standing there from now on.
  const { l } = carFrame(car), out = car.car!.drive ? sim.data.vehicles.types[car.car!.drive.type].dims.body.width / 2 + 0.6 : 1.6
  a.actor = { ...a.actor!, mode: 'escort', state: 'done', speed: 0, car: undefined }
  delete a.actor.car
  a.state = State.ground
  a.vel = v3()
  placeActor(sim, a, car.pos.x - l.x * out, car.pos.y - l.y * out, car.car!.drive!.heading)
  events.push({ t: 'passengerOut', tick, mission: m.id, who: st.who, car: car.id })
  advance(sim, s, sk, events)
}

// ---- race: a character on a path; get to its end first ----

/** A race: it sets off once you are within distance; you win reaching within finish metres of the path's end before it does (missionFailed lost if it gets there first). */
function race(sim: Sim, s: Thing, sk: Thing, st: Step<'race'>, events: SimEvent[]) {
  const m = s.mission!, t = actorOf(sim, m)
  if (!t?.actor) return
  if (!m.armed && Math.hypot(t.pos.x - sk.pos.x, t.pos.y - sk.pos.y) < st.distance) { m.armed = true; t.actor.state = 'go' }
  if (!m.armed) return
  const end = st.path[st.path.length - 1]
  if (Math.hypot(sk.pos.x - end[0], sk.pos.y - end[1]) < st.finish) { advance(sim, s, sk, events); return }
  // It goes at its pace like an escort (game/movers.ts), never waiting for you.
  moveActor(sim, t, sk, events)
  if (t.actor.state === 'done') fail(sim, s, events, 'lost')
}

// ---- mode: a game the game already has, won or lost ----

function mode(sim: Sim, s: Thing, sk: Thing, st: Step<'mode'>, events: SimEvent[]) {
  const W = st.win
  let won = false, lost = false
  switch (st.mode) {
    case 'courier':
      won = s.courierDone >= (W.deliveries ?? 1)
      lost = events.some((e) => e.t === 'courierFail' || e.t === 'courierOver')
      break
    case 'bomb':
      for (const e of events) {
        if (e.t === 'bombFinish') { if (e.place <= (W.place ?? 99) && e.total <= (W.maxSeconds ?? Infinity)) won = true; else lost = true }
        if (e.t === 'bombFail') lost = true
      }
      break
    case 'muni': for (const e of events) if (e.t === 'muniOver') { if (e.won) won = true; else lost = true } break
    case 'escape': for (const e of events) if (e.t === 'escapeOver') { if (e.survived) won = true; else lost = true } break
    case 'skate': for (const e of events) if (e.t === 'skateOver') { if (e.winner === 'player') won = true; else lost = true } break
    case 'graffiti':
      won = (s.owned ?? 0) >= (W.pieces ?? 1)
      lost = events.some((e) => e.t === 'graffitiOver')
      break
    case 'combo':
      won = s.bestCombo >= (W.best ?? 1)
      lost = events.some((e) => e.t === 'comboOver')
      break
  }
  if (won) advance(sim, s, sk, events)
  else if (lost) fail(sim, s, events, 'mode')
}
