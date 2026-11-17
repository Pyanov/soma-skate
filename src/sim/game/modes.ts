import { Btn } from '../input.ts'
import { DEG, v3 } from '../math.ts'
import type { BombRoute } from '../data.ts'
import { clearRacers, spawnRacers } from './npc.ts'
import { placeAt, type Sim, type SimEvent } from '../sim.ts'
import { Kind, State, type Thing } from '../thing.ts'

// Game modes besides the 2-minute run (docs/mechanics/modes.md): Courier, Combo Challenge and the
// Hill Bomb race. Each reads the skater after its step and never changes skating physics.

const secs = (sim: Sim, ticks: number) => Math.round((ticks / sim.data.physics.tickHz) * 100) / 100
const near = (p: { x: number; y: number; z: number }, q: [number, number, number], r: number, h: number) => Math.hypot(p.x - q[0], p.y - q[1]) < r && Math.abs(p.z - q[2]) < h

// ---- Courier: pick up, deliver across the city before the clock runs out, orders chain ----

export function startCourier(sim: Sim, s: Thing, sk: Thing) {
  const C = sim.data.run.courier
  if (!C.parks.includes(sim.park.name)) throw new Error(`courier mode needs a city (${C.parks.join(', ')}), not ${sim.park.name}`)
  placeAt(sk, { id: 'courier_start', pos: v3(...C.start.pos), heading: C.start.heading * DEG })
  s.courierLeg = 0; s.courierDone = 0; s.courierCarrying = false
  s.timeLeft = 0
}

export function stepCourier(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const C = sim.data.run.courier, hz = sim.data.physics.tickHz, tick = sim.world.tick
  if (!s.courierCarrying) {
    // The first order waits at the start: ride up to it (you start there).
    if (!near(sk.pos, C.start.pos, C.pickupRadius, C.dropHeight)) return
    s.courierCarrying = true
    const leg = C.legs[s.courierLeg]
    s.timeLeft = Math.round(leg.seconds * hz)
    events.push({ t: 'courierPickup', tick, leg: s.courierLeg, id: leg.id, place: leg.place, line: leg.line, to: leg.to, seconds: leg.seconds, timeLeft: secs(sim, s.timeLeft) })
    return
  }
  const leg = C.legs[s.courierLeg]
  if (near(sk.pos, leg.to, C.dropRadius, C.dropHeight)) {
    s.courierDone++
    sk.score += C.deliveryPoints
    events.push({ t: 'courierDeliver', tick, n: s.courierDone, id: leg.id, place: leg.place, points: C.deliveryPoints, timeLeft: secs(sim, s.timeLeft) })
    // The customer has the next order ready: its time goes on top of what is left.
    s.courierLeg = (s.courierLeg + 1) % C.legs.length
    const next = C.legs[s.courierLeg]
    const bonus = s.timeLeft
    s.timeLeft += Math.round(next.seconds * hz)
    events.push({ t: 'courierPickup', tick, leg: s.courierLeg, id: next.id, place: next.place, line: next.line, to: next.to, seconds: next.seconds, timeLeft: secs(sim, s.timeLeft), bonus: secs(sim, bonus) })
    return
  }
  if (--s.timeLeft <= 0) {
    s.timeLeft = 0
    s.courierCarrying = false
    events.push({ t: 'courierFail', tick, delivered: s.courierDone, id: leg.id, place: leg.place })
    s.mode = 'ending'
  }
}

// ---- Combo Challenge: the clock runs, only the best single combo counts ----

export function startCombo(sim: Sim, s: Thing, events: SimEvent[]) {
  s.timeLeft = Math.round(sim.data.run.combo.seconds * sim.data.physics.tickHz)
  events.push({ t: 'comboStart', tick: sim.world.tick, seconds: sim.data.run.combo.seconds })
}

export function stepCombo(s: Thing) {
  if (--s.timeLeft <= 0) { s.timeLeft = 0; s.mode = 'ending' }
}

// ---- Hill Bomb race: through the gates down a hill (a route), falls cost time ----

/** A route by id: the default (the top level of data run.bomb, Dolores) or one of bomb.routes. */
export function bombRoute(sim: Sim, id?: string): BombRoute {
  const B = sim.data.run.bomb
  if (!id || id === B.id) return B
  const r = B.routes.find((x) => x.id === id)
  if (!r) throw new Error(`no hill bomb route "${id}" (routes: ${[B.id, ...B.routes.map((x) => x.id)].join(', ')})`)
  return r
}

export function startBomb(sim: Sim, s: Thing, sk: Thing, events: SimEvent[], routeId?: string) {
  const B = sim.data.run.bomb
  if (!B.parks.includes(sim.park.name)) throw new Error(`the hill bomb needs a city (${B.parks.join(', ')}), not ${sim.park.name}`)
  const R = bombRoute(sim, routeId)
  placeAt(sk, { id: `bomb_${R.id}`, pos: v3(...R.start.pos), heading: R.start.heading * DEG })
  s.raceRoute = R.id
  s.raceGate = 0; s.raceTicks = 0; s.racePenalty = 0; s.raceFalls = 0; s.raceBraked = false
  // The locals line up at the start line and go when you cross it.
  spawnRacers(sim, R)
  s.racePlace = 0; s.raceOf = R.racers.length + 1; s.raceFinished = 0
  events.push({ t: 'bombReady', tick: sim.world.tick, route: R.id, name: R.name, gates: R.gates.length })
}

export function stepBomb(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const B = sim.data.run.bomb, R = bombRoute(sim, s.raceRoute), route = R.id, hz = sim.data.physics.tickHz, tick = sim.world.tick
  const racing = s.raceGate > 0
  if (racing) {
    s.raceTicks++
    for (const e of events) if (e.t === 'bail') { s.raceFalls++; s.racePenalty += Math.round(B.fallPenalty * hz) }
    // Brakes: the foot brake (S on the board, not in a manual) or a powerslide.
    if (sk.state === State.ground && !sk.manual && ((sk.prevB & Btn.down) !== 0 || sk.powerslide !== 0)) s.raceBraked = true
  }
  // The racers: their gates, the finish (a place each), and where the player stands among them.
  if (racing) stepRacers(sim, s, sk, R, events)
  // Crossing the next gate: from behind its line to past it this tick, within its width.
  const g = R.gates[s.raceGate]
  const dt = 1 / hz
  const px = sk.pos.x - sk.vel.x * dt, py = sk.pos.y - sk.vel.y * dt
  const along = (x: number, y: number) => (x - g.pos[0]) * g.dir[0] + (y - g.pos[1]) * g.dir[1]
  const across = Math.abs(-(sk.pos.x - g.pos[0]) * g.dir[1] + (sk.pos.y - g.pos[1]) * g.dir[0])
  if (sk.drive === undefined && along(px, py) < 0 && along(sk.pos.x, sk.pos.y) >= 0 && across <= g.halfWidth && Math.abs(sk.pos.z - g.pos[2]) <= g.height) {   // on the board: a vehicle crosses no gate
    s.raceGate++
    if (s.raceGate === 1) {
      events.push({ t: 'bombStart', tick, route, gate: g.name })
      // Go: the locals push off as you pass them, at your speed (a rolling start, so it is a race).
      const v = Math.max(3, Math.hypot(sk.vel.x, sk.vel.y))
      for (const r of racers(sim)) { r.npc!.racer!.go = true; r.vel = v3(g.dir[0] * v, g.dir[1] * v, 0) }
    }
    else if (s.raceGate < R.gates.length) events.push({ t: 'bombCheckpoint', tick, route, n: s.raceGate - 1, of: R.gates.length - 2, gate: g.name, time: secs(sim, s.raceTicks) })
    else {
      s.raceFinished = (s.raceFinished ?? 0) + 1
      s.racePlace = s.raceFinished
      events.push({ t: 'bombFinish', tick, route, time: secs(sim, s.raceTicks), penalty: secs(sim, s.racePenalty), falls: s.raceFalls, total: secs(sim, s.raceTicks + s.racePenalty), braked: s.raceBraked, place: s.racePlace, of: s.raceOf ?? 1 })
      s.mode = 'over'
      clearRacers(sim)   // the race is over
      return
    }
  }
  if (racing && s.raceTicks >= R.maxSeconds * hz) {
    events.push({ t: 'bombFail', tick, route, reason: 'time', gate: s.raceGate - 1, time: secs(sim, s.raceTicks) })
    s.mode = 'over'
    clearRacers(sim)
    return
  }
}

const crossedGate = (g: BombRoute['gates'][number], t: Thing, dt: number) => {
  const along = (x: number, y: number) => (x - g.pos[0]) * g.dir[0] + (y - g.pos[1]) * g.dir[1]
  const across = Math.abs(-(t.pos.x - g.pos[0]) * g.dir[1] + (t.pos.y - g.pos[1]) * g.dir[0])
  return along(t.pos.x - t.vel.x * dt, t.pos.y - t.vel.y * dt) < 0 && along(t.pos.x, t.pos.y) >= 0 && across <= g.halfWidth && Math.abs(t.pos.z - g.pos[2]) <= g.height
}

/** How far along the route: gates crossed, plus the part of the way to the next one. */
function progress(R: BombRoute, gate: number, t: Thing) {
  if (gate <= 0) return 0
  if (gate >= R.gates.length) return R.gates.length
  const a = R.gates[gate - 1].pos, b = R.gates[gate].pos
  const seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
  return gate + Math.max(0, Math.min(1, 1 - Math.hypot(b[0] - t.pos.x, b[1] - t.pos.y) / seg))
}

const racers = (sim: Sim) => sim.world.things.filter((t) => t.kind === Kind.npc && t.npc?.racer)

function stepRacers(sim: Sim, s: Thing, sk: Thing, R: BombRoute, events: SimEvent[]) {
  const dt = 1 / sim.data.physics.tickHz, tick = sim.world.tick
  for (const t of racers(sim)) {
    const k = t.npc!.racer!
    if (k.place || !k.go || k.gate >= R.gates.length) continue
    if (crossedGate(R.gates[k.gate], t, dt) && ++k.gate >= R.gates.length) {
      k.place = s.raceFinished = (s.raceFinished ?? 0) + 1
      events.push({ t: 'racerFinish', tick, route: R.id, id: t.id, name: k.name, place: k.place, time: secs(sim, k.ticks) })
    }
  }
  // The player's place: one behind every racer already home or further down the route.
  const mine = progress(R, s.raceGate, sk)
  s.racePlace = 1 + racers(sim).filter((t) => t.npc!.racer!.place > 0 || progress(R, t.npc!.racer!.gate, t) > mine).length
}

/** The game's results when it is over (the 2-minute run keeps its runOver). */
export function overEvent(sim: Sim, s: Thing, sk: Thing): SimEvent | null {
  const tick = sim.world.tick
  if (s.game === 'courier') return { t: 'courierOver', tick, deliveries: s.courierDone, score: sk.score, bestCombo: s.bestCombo }
  if (s.game === 'combo') return { t: 'comboOver', tick, best: s.bestCombo, score: sk.score }
  return null
}

export const settled = (sk: Thing) => sk.combo.length === 0 && !sk.trick && (sk.state === State.ground || sk.state === State.bail || sk.state === State.walk) && sk.landGrace === 0 && !sk.manual
