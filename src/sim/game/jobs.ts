import type { GigKind, Jobs, Mission, MissionStep } from '../data.ts'
import { atan2, DEG } from '../math.ts'
import { findSpot, type Sim, type SimEvent } from '../sim.ts'
import type { Thing } from '../thing.ts'
import { homeOf, missionCommand, startMission } from './missions.ts'

// Odd jobs (data/jobs.json, docs/story.md Odd jobs): the gig boards at Fog City Skate Shop and Taqueria
// La Niebla, each with perDay gigs a day. A gig is an ordinary one-step mission (kind job) made here
// from the board, the San Francisco date and the slot: a hash of those picks the kind of gig, the client,
// and the target (the item and the clock, the kerb and the spot, the trick and the spot, the course). The
// date comes in the command (`mission job <board> <day> <slot>`), so a replay makes the same gig and the
// client can show the board before any of it starts; nothing here reads world.rng. The mission goes into
// the sim's own data (missions.missions, by id) and starts like any other; which gigs are done is the
// client's save.

type Board = Jobs['boards'][number]
type Vec = [number, number, number]

/** A gig's mission id: the board, the date (YYYY-MM-DD) and the slot. */
export const jobId = (board: string, day: string, slot: number) => `job-${board}-${day}-${slot}`

/** A small deterministic generator from a text seed (FNV-1a, then mulberry32). */
function seeded(seed: string) {
  let h = 2166136261
  for (const c of seed) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  let a = h >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
function shuffled<T>(r: () => number, xs: readonly T[]): T[] {
  const o = xs.slice()
  for (let i = o.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [o[i], o[j]] = [o[j], o[i]] }
  return o
}

export function boardOf(sim: Sim, id: string): Board {
  const B = sim.data.jobs.boards.find((b) => b.id === id)
  if (!B) throw new Error(`no gig board "${id}" (data/jobs.json: ${sim.data.jobs.boards.map((b) => b.id).join(', ')})`)
  return B
}
/** Where a board is (its room's anchor: x y z heading), or null when this world has no such room. */
export function boardPlace(sim: Sim, B: Board): [number, number, number, number] | null {
  const [room, anchor] = B.at.split('/')
  return sim.park.interiors.find((r) => r.id === room)?.anchors[anchor] ?? null
}

/** The street point nearest (x, y) (the streets the cars drive), with its height. */
function kerbNear(sim: Sim, x: number, y: number): Vec | null {
  let best: Vec | null = null, bd = Infinity
  for (const p of sim.park.traffic.paths) for (const q of p.points) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = [q[0], q[1], q[2]] } }
  return best
}

const label = (sim: Sim, spot: string) => sim.data.spots.labels?.[spot] ?? spot
const nameOf = (sim: Sim, who: string) => sim.data.cast.cast.find((c) => c.id === who)?.name ?? who
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/** A board's gigs on a day: perDay missions, each kind of its gigs in turn, no client twice. */
export function jobsFor(sim: Sim, board: string, day: string): Mission[] {
  return Array.from({ length: sim.data.jobs.perDay }, (_, i) => jobMission(sim, board, day, i))
}

/** The gig in a board's slot on a day (YYYY-MM-DD): a one-step mission of kind job. */
export function jobMission(sim: Sim, board: string, day: string, slot: number): Mission {
  const J = sim.data.jobs, B = boardOf(sim, board)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error(`mission job: the day is YYYY-MM-DD, not "${day}"`)
  if (!(Number.isInteger(slot) && slot >= 0 && slot < J.perDay)) throw new Error(`mission job: slots 0..${J.perDay - 1}`)
  const at = boardPlace(sim, B)
  if (!at) throw new Error(`gig board ${board} is in ${B.at.split('/')[0]}, which ${sim.park.name} does not have`)
  // The day's order of kinds and of each kind's clients (the same for every slot), then this slot's own picks.
  const day0 = seeded(`${board}:${day}`), first = Math.floor(day0() * B.gigs.length)
  const kindOf = (i: number) => B.gigs[(first + i) % B.gigs.length]
  const order: Partial<Record<GigKind, number[]>> = {}
  for (const k of B.gigs) order[k] = shuffled(day0, J[k].clients.map((_, i) => i))
  const kind = kindOf(slot), nth = Array.from({ length: slot }, (_, i) => kindOf(i)).filter((k) => k === kind).length
  const ci = order[kind]![nth % order[kind]!.length], r = seeded(`${board}:${day}:${slot}`)
  const base = { id: jobId(board, day, slot), kind: 'job' as const, area: B.area, giver: B.host, world: 'sf' }
  const job = (client: string) => ({ board, gig: kind, client, day, slot })
  if (kind === 'deliver') {
    const c = J.deliver.clients[ci], C = sim.data.cast.cast.find((x) => x.id === c.who)!, home = homeOf(sim, C), item = pick(r, J.deliver.items)
    const seconds = Math.ceil((J.deliver.base + Math.hypot(home[0] - at[0], home[1] - at[1]) / J.deliver.speed) / 5) * 5
    const text = `${cap(item)} to ${C.name}`
    return { ...base, name: `Order for ${C.name}`, blurb: text, job: job(c.who), fail: { time: [c.late] },
      steps: [{ kind: 'deliver', text, item, from: [at[0], at[1], at[2]], to: `cast:${c.who}`, seconds, say: [c.say], done: [c.done] }] }
  }
  if (kind === 'carry') {
    const c = J.carry.clients[ci], C = sim.data.cast.cast.find((x) => x.id === c.who)!, home = homeOf(sim, C)
    // They wait at the kerb by their home (kerb metres from the street's middle, toward it); off to a spot minFrom..maxFrom from there.
    const k = kerbNear(sim, home[0], home[1]) ?? home, d = Math.hypot(home[0] - k[0], home[1] - k[1]), u = d > 0 ? Math.min(1, J.carry.kerb / d) : 0
    const wait: [number, number, number, number] = [k[0] + (home[0] - k[0]) * u, k[1] + (home[1] - k[1]) * u, k[2], atan2(k[0] - home[0], k[1] - home[1]) / DEG]
    const far = (id: string) => { const s = findSpot(sim, id); return s ? Math.hypot(s.pos.x - wait[0], s.pos.y - wait[1]) : -1 }
    const ok = J.carry.to.filter((id) => { const f = far(id); return f >= J.carry.minFrom && f <= J.carry.maxFrom })
    const spot = pick(r, ok.length ? ok : J.carry.to), s = findSpot(sim, spot)
    const to: Vec = s ? kerbNear(sim, s.pos.x, s.pos.y) ?? [s.pos.x, s.pos.y, s.pos.z] : [wait[0], wait[1], wait[2]]
    const text = `Drive ${C.name} to ${label(sim, spot)}`
    return { ...base, name: `A Ride for ${C.name}`, blurb: `${text}, in the van by the taqueria`, job: job(c.who), vehicles: [J.carry.vehicle],
      steps: [{ kind: 'carry', text, who: c.who, to, radius: J.carry.radius, vehicle: J.carry.vehicle.name, lines: [c.ride], every: J.carry.every, say: [c.say], done: [c.done], actors: { [c.who]: wait } }] }
  }
  if (kind === 'photo') {
    const c = J.photo.clients[ci], spot = pick(r, J.photo.spots), t = pick(r, J.photo.tricks), name = nameOf(sim, c.who)
    const text = `${cap(t.text)} at ${label(sim, spot)} for ${name}`
    const step: MissionStep = { kind: 'trick', text, near: spot, radius: J.photo.radius, say: [c.say], done: [c.done],
      ...(t.tricks ? { tricks: t.tricks } : {}), ...(t.air !== undefined ? { air: t.air } : {}), ...(t.points !== undefined ? { points: t.points } : {}) }
    return { ...base, name: `A Photo for ${name}`, blurb: text, job: job(c.who), steps: [step] }
  }
  const c = J.race.clients[ci], course = pick(r, J.race.courses), name = nameOf(sim, c.who)
  const text = `Beat ${name} ${course.text}`
  return { ...base, name: `Race ${name}`, blurb: text, job: job(c.who), fail: { lost: [c.won] },
    steps: [{ kind: 'race', text, who: c.who, path: course.path, speed: c.speed, distance: J.race.distance, finish: J.race.finish, say: [c.say], done: [c.done] }] }
}

/**
 * `mission job <board> <day> <slot>`: that gig made and started (any mission on is left first). Its
 * mission is put in this sim's data by id, replacing an older one of the same id, so `mission start`
 * (Try again) finds it too.
 */
export function startJob(sim: Sim, s: Thing, sk: Thing, events: SimEvent[], board: string, day: string, slot: number): Mission {
  const M = jobMission(sim, board, day, slot)
  if (s.mission) missionCommand(sim, s, sk, events, 'abandon')
  const list = sim.data.missions.missions, i = list.findIndex((x) => x.id === M.id)
  if (i >= 0) list[i] = M
  else list.push(M)
  startMission(sim, s, sk, events, M.id)
  return M
}
