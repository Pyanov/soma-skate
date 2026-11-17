import { atan2, clamp, headingDir, v3 } from '../math.ts'
import { raycast } from '../park/park.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { Kind, makeThing, State, type ActorRun, type Thing } from '../thing.ts'
import { vehicleAt } from './vehicles.ts'
import { carFrame } from './traffic.ts'

// How the characters a story moves go (docs/mechanics/missions.md, docs/mechanics/driving.md; numbers
// in data/movers.json). They are Things of kind 'actor', actor.who a cast id (the view draws who they
// are). escort: along a path at a pace, easing in and out of it; it stops for you when you fall wait
// metres behind it along the way and goes on once you are within resume, and notices when you get lead
// metres past it (and when you drop back behind). A mission's follow step moves its character this way
// (game/missions.ts), from the moment it sets off. follow: after you, as fast as holds gap metres at your
// speed; lost far behind, it comes round near you. No physics: it rides the ground (a ray down each
// tick), never bails and never blocks. The player is the skater (in a vehicle, where the vehicle is).
// Actors started by command (`actor spawn`) take ids of their own (ACTOR_ID up), so starting one never
// moves another Thing's id.

export const ACTOR_ID = 3_000_000
const DOWN = v3(0, 0, -1)

/** What an actor's movement needs; the numbers left out are data/movers.json's. */
export type ActorSpec = {
  who: string                   // a cast id (data/cast.json): who the view draws
  mode: 'escort' | 'follow' | 'ride'
  pace: number                  // m/s
  path?: [number, number][]     // escort: its route, two points or more (x, y)
  car?: number                  // ride: the vehicle it rides in (a carry step's passenger)
  at?: [number, number]         // follow: where it starts (default: catchBack metres behind the player)
  wait?: number; resume?: number; lead?: number   // escort: metres (data movers.wait, resume, lead)
  gap?: number                  // follow: metres it keeps behind you (data movers.gap)
}

/** A change moveActor reports (each also an event): the mission engine barks on some. */
export type ActorChange = 'wait' | 'go' | 'overtaken' | 'behind' | 'done' | 'catchUp'

const player = (sim: Sim) => sim.world.things.find((t) => t.kind === Kind.skater && t.alive && t.player !== 2)
/** The actor the mission on moves (game/missions.ts); stepActors leaves it to the mission. */
const missionActor = (sim: Sim) => sim.world.things.find((t) => t.kind === Kind.session && t.player !== 2)?.mission?.actor ?? -1
export const actors = (sim: Sim) => sim.world.things.filter((t) => t.kind === Kind.actor && t.alive && t.actor)

/** An actor's movement from a spec. state: hold (an escort that has not set off: a mission's, until you come close) or go. */
export function actorRun(sim: Sim, spec: ActorSpec, state: 'hold' | 'go'): ActorRun {
  const M = sim.data.movers
  if (spec.mode === 'escort' && (!spec.path || spec.path.length < 2)) throw new Error(`actor ${spec.who}: an escort needs a path of two points or more`)
  if (!(spec.pace > 0)) throw new Error(`actor ${spec.who}: pace must be above 0`)
  return { who: spec.who, s: 0, mode: spec.mode, path: spec.path ? spec.path.map((p) => [p[0], p[1]]) : [], i: 1, pace: spec.pace, speed: 0,
    state, wait: spec.wait ?? M.wait, resume: spec.resume ?? M.resume, lead: spec.lead ?? M.lead, gap: spec.gap ?? M.gap, ahead: false, ticks: 0, ...(spec.car !== undefined ? { car: spec.car } : {}) }
}

/** On the ground at (x, y) (its middle a skater's radius up, as the view draws a skater), facing heading (radians clockwise from north). */
export function placeActor(sim: Sim, t: Thing, x: number, y: number, heading: number) {
  const z0 = Number.isFinite(t.pos.z) ? t.pos.z : 0
  const h = raycast(sim.park, v3(x, y, z0 + 3), DOWN, 30) ?? raycast(sim.park, v3(x, y, 2000), DOWN, 4000)
  t.pos = v3(x, y, h ? h.point.z + sim.data.physics.skater.radius : z0)
  t.fwd = headingDir(heading)
  t.up = v3(0, 0, 1)
}

/** `actor spawn`: an actor of its own (one with that who, not the mission's, replaced): an escort at its path's start, a follower behind you. */
export function spawnActor(sim: Sim, spec: ActorSpec, events: SimEvent[] = []): Thing {
  if (!sim.data.cast.cast.some((c) => c.id === spec.who)) throw new Error(`actor ${spec.who}: not in data/cast.json`)
  if (spec.mode === 'ride') throw new Error(`actor ${spec.who}: spawn escort or follow (a passenger boards in a carry step)`)
  const run = actorRun(sim, spec, 'go')
  clearActors(sim, spec.who)
  let id = ACTOR_ID
  while (sim.world.things.some((t) => t.id === id)) id++
  const t = makeThing(id, Kind.actor)
  sim.world.things.push(t)
  t.state = State.ground
  t.actor = run
  const p = player(sim)
  t.pos = v3(0, 0, p ? p.pos.z : 0)   // the ground is looked for from about the player's height
  if (run.mode === 'escort') placeActor(sim, t, run.path[0][0], run.path[0][1], atan2(run.path[1][0] - run.path[0][0], run.path[1][1] - run.path[0][1]))
  else {
    const at = spec.at ?? (p ? behind(p, sim.data.movers.catchBack) : [0, 0] as [number, number])
    placeActor(sim, t, at[0], at[1], p ? atan2(p.pos.x - at[0], p.pos.y - at[1]) : 0)
  }
  events.push({ t: 'actorStart', tick: sim.world.tick, id: t.id, who: run.who, mode: run.mode === 'follow' ? 'follow' : 'escort' })
  return t
}

/** `actor clear [who]`: the actors started by command (that one, or all); the mission's stays with its mission. */
export function clearActors(sim: Sim, who?: string) {
  const own = missionActor(sim)
  sim.world.things = sim.world.things.filter((t) => !(t.kind === Kind.actor && t.id !== own && (!who || t.actor?.who === who)))
}

/** A point d metres behind the skater (behind its heading on the ground; its travel when moving). */
function behind(p: Thing, d: number): [number, number] {
  const v = Math.hypot(p.vel.x, p.vel.y)
  const hx = v > 0.5 ? p.vel.x / v : p.fwd.x, hy = v > 0.5 ? p.vel.y / v : p.fwd.y, l = Math.hypot(hx, hy) || 1
  return [p.pos.x - (hx / l) * d, p.pos.y - (hy / l) * d]
}

/** Where along an escort's path the player is: metres from its start to the nearest point of the segments round the actor's. */
function alongOf(a: ActorRun, x: number, y: number): number {
  let best = Infinity, at = 0, cum = 0
  for (let k = 1; k < a.path.length; k++) {
    const p = a.path[k - 1], q = a.path[k], ex = q[0] - p[0], ey = q[1] - p[1], L = Math.hypot(ex, ey) || 1
    if (k >= a.i - 3 && k <= a.i + 6) {
      const u = clamp(((x - p[0]) * ex + (y - p[1]) * ey) / (L * L), 0, 1), d = Math.hypot(p[0] + ex * u - x, p[1] + ey * u - y)
      if (d < best) { best = d; at = cum + u * L }
    }
    cum += L
  }
  return at
}

/** The path's point s metres along it, and the segment's heading there. */
function pointAt(a: ActorRun, s: number): { x: number; y: number; h: number; i: number; end: boolean } {
  let cum = 0
  for (let k = 1; k < a.path.length; k++) {
    const p = a.path[k - 1], q = a.path[k], L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1e-9
    if (s <= cum + L || k === a.path.length - 1) {
      const u = clamp((s - cum) / L, 0, 1)
      return { x: p[0] + (q[0] - p[0]) * u, y: p[1] + (q[1] - p[1]) * u, h: atan2(q[0] - p[0], q[1] - p[1]), i: k, end: k === a.path.length - 1 && s >= cum + L }
    }
    cum += L
  }
  const z = a.path[a.path.length - 1]
  return { x: z[0], y: z[1], h: 0, i: a.path.length - 1, end: true }
}

/**
 * One tick of an actor's movement against the player p (the skater; undefined: nobody): an escort along
 * its path (holding still until it is set off), a follower after p. The changes, each also an event.
 */
export function moveActor(sim: Sim, t: Thing, p: Thing | undefined, events: SimEvent[]): ActorChange[] {
  const a = t.actor!, M = sim.data.movers, dt = 1 / sim.data.physics.tickHz, tick = sim.world.tick, out: ActorChange[] = []
  const say = (c: ActorChange, extra: { behind?: number; ahead?: number } = {}) => {
    out.push(c)
    a.ticks = 0
    const e = { tick, id: t.id, who: a.who }
    if (c === 'wait') events.push({ t: 'actorWait', ...e, behind: extra.behind ?? 0 })
    else if (c === 'overtaken') events.push({ t: 'actorOvertaken', ...e, ahead: extra.ahead ?? 0 })
    else events.push({ t: c === 'go' ? 'actorGo' : c === 'behind' ? 'actorBehind' : c === 'done' ? 'actorDone' : 'actorCatchUp', ...e })
  }
  a.ticks++
  t.stateTicks++
  if (a.mode === 'ride') {
    // A passenger (a carry step): at the passenger seat, the seat's height up and passenger metres right
    // of the middle, moving with the vehicle; state drive, so the view does not draw them standing.
    const car = sim.world.things.find((x) => x.id === a.car && x.alive)
    if (!car) return out
    const V = sim.data.vehicles, { l, u } = carFrame(car)
    t.pos = v3(car.pos.x + u.x * V.seat - l.x * V.passenger, car.pos.y + u.y * V.seat - l.y * V.passenger, car.pos.z + u.z * V.seat - l.z * V.passenger)
    t.vel = v3(car.vel.x, car.vel.y, car.vel.z)
    t.fwd = headingDir(car.car!.drive?.heading ?? 0)
    t.state = State.drive
    return out
  }
  if (a.mode === 'escort') {
    if (a.state === 'done') { t.vel = v3(); return out }
    // How far along its path you are, against it: behind it, it waits; past it, it notices (ahead of
    // it before it has moved is where you started, not a pass).
    if (p && a.state !== 'hold') {
      const behindBy = a.s - alongOf(a, p.pos.x, p.pos.y)
      if (a.s === 0) a.ahead = -behindBy > a.lead
      if (a.state === 'go' && behindBy > a.wait) { a.state = 'wait'; say('wait', { behind: round(behindBy) }) }
      else if (a.state === 'wait' && behindBy <= a.resume) { a.state = 'go'; say('go') }
      if (!a.ahead && -behindBy > a.lead) { a.ahead = true; say('overtaken', { ahead: round(-behindBy) }) }
      else if (a.ahead && behindBy > 0) { a.ahead = false; say('behind') }
    }
    const want = a.state === 'go' ? a.pace : 0
    a.speed += clamp(want - a.speed, -M.decel * dt, M.accel * dt)
    if (a.speed <= 0) { a.speed = 0; t.vel = v3(); return out }
    const q = pointAt(a, a.s + a.speed * dt)
    // A vehicle in the way (the crew van parked across its path): it holds until the way is clear.
    if (vehicleAt(sim, q.x, q.y, t.pos.z, sim.data.vehicles.reactions.body)) { a.speed = 0; t.vel = v3(); return out }
    a.s += a.speed * dt
    a.i = q.i
    const x0 = t.pos.x, y0 = t.pos.y
    placeActor(sim, t, q.x, q.y, q.h)
    t.vel = v3((t.pos.x - x0) / dt, (t.pos.y - y0) / dt, 0)
    if (q.end) { a.state = 'done'; a.speed = 0; t.vel = v3(); say('done') }
    return out
  }
  // Follow: after the player, gap metres off; lost far behind, round again behind them.
  if (!p) return out
  const dx = p.pos.x - t.pos.x, dy = p.pos.y - t.pos.y, d = Math.hypot(dx, dy)
  if (d > M.catchUp) {
    const at = behind(p, M.catchBack)
    t.pos = v3(at[0], at[1], p.pos.z)
    placeActor(sim, t, at[0], at[1], atan2(p.pos.x - at[0], p.pos.y - at[1]))
    a.speed = Math.min(a.pace, Math.hypot(p.vel.x, p.vel.y))
    t.vel = v3()
    say('catchUp')
    return out
  }
  // As fast as it takes to hold the gap (up to its pace), easing to a stop inside it.
  const want = d > a.gap ? Math.min(a.pace, Math.hypot(p.vel.x, p.vel.y) + (d - a.gap)) : 0
  a.speed += clamp(want - a.speed, -M.decel * dt, M.accel * dt)
  const step = Math.min(a.speed * dt, Math.max(0, d - a.gap * 0.9))
  const x0 = t.pos.x, y0 = t.pos.y
  if (step > 0 && vehicleAt(sim, x0 + (d > 1e-6 ? dx / d : 0) * step, y0 + (d > 1e-6 ? dy / d : 0) * step, t.pos.z, sim.data.vehicles.reactions.body)) { a.speed = 0; t.vel = v3(); return out }
  placeActor(sim, t, t.pos.x + (d > 1e-6 ? dx / d : 0) * step, t.pos.y + (d > 1e-6 ? dy / d : 0) * step, d > 0.3 ? atan2(dx, dy) : atan2(t.fwd.x, t.fwd.y))
  t.vel = v3((t.pos.x - x0) / dt, (t.pos.y - y0) / dt, 0)
  return out
}

/** One tick for the actors started by command (the mission's moves with its step, game/missions.ts). */
export function stepActors(sim: Sim, events: SimEvent[]) {
  let any = false
  for (const t of sim.world.things) if (t.kind === Kind.actor) { any = true; break }
  if (!any) return
  const own = missionActor(sim), p = player(sim)
  for (const t of sim.world.things) if (t.kind === Kind.actor && t.alive && t.actor && t.id !== own) moveActor(sim, t, p, events)
}

const round = (x: number) => Math.round(x * 100) / 100
