import { Btn, has, stick, type InputFrame } from '../input.ts'
import { abs, clamp, copy, dot, flatten, len, madd, norm, scale, sub, v3 } from '../math.ts'
import { nextFloat } from '../rng.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { Kind, State, type Thing } from '../thing.ts'
import { bankCombo, loseCombo } from '../tricks/tricks.ts'
import { carFrame } from '../game/traffic.ts'
import { startBail } from './skater.ts'
import { probeGround } from './move.ts'
import { dimsOf } from './cars.ts'

const Z = v3(0, 0, 1)

// Skitching (THUG): on the ground right behind a car, the grab button grabs its bumper and the
// car tows you. Balance left/right like a manual; the car turning throws you to the outside, and
// turning hard throws you off. Let go to ride off at the car's speed (an ollie lets go too, the
// combo carrying on into the air). Scores as a Skitch with points per second. Human drivers honk;
// a robotaxi slows politely to a stop, hazards on, and waits until you let go.
// Spec: docs/mechanics/traffic.md.

const byId = (sim: Sim, id: number) => sim.world.things.find((c) => c.id === id && c.kind === Kind.car && c.alive && c.car) ?? null

/** A fresh grab press on the ground behind a car, close to its speed: grab its bumper. */
export function tryStartSkitch(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]): boolean {
  if (t.state !== State.ground || t.skitch || t.carRide >= 0 || t.manual || t.powerslide !== 0) return false
  if (!has(input, Btn.grab) || (t.prevB & Btn.grab) !== 0) return false
  const T = sim.data.traffic, S = T.skitch, r = sim.data.physics.skater.radius
  let best: { c: Thing; behind: number; side: number } | null = null
  for (const c of sim.world.things) {
    if (c.kind !== Kind.car || !c.alive || !c.car) continue
    const D = dimsOf(sim.data, c)
    if (abs(c.pos.x - t.pos.x) > D.collideRange || abs(c.pos.y - t.pos.y) > D.collideRange) continue
    const { f, l, u } = carFrame(c), d = sub(t.pos, c.pos)
    const behind = -D.body.length / 2 - dot(d, f), side = dot(d, l), dz = dot(d, u) - r
    if (behind < -0.1 || behind > S.reach || abs(side) > S.side || abs(dz) > S.height) continue
    if (len(sub(t.vel, c.vel)) > S.maxRel) continue
    if (!best || behind < best.behind) best = { c, behind, side }
  }
  if (!best) return false
  const c = best.c, car = c.car!, tick = sim.world.tick
  const lean = nextFloat(sim.world.rng) < 0.5 ? -1 : 1
  t.skitch = {
    id: 'skitch', name: 'Skitch', ticks: 0, balance: lean * S.balanceStart, balanceVel: 0, car: c.id,
    side: Math.max(-S.hold, Math.min(S.hold, best.side)), lead: dot(t.fwd, carFrame(c).f) >= 0 ? 1 : -1,
    honkAt: tick + Math.round(S.honkFirst * sim.data.physics.tickHz), meters: 0,
  }
  // A combo still open from a landing carries on through the skitch, unless the last thing in it was
  // a skitch: letting go and grabbing again is not a new trick (tapping the grab farmed hundreds).
  if (t.combo.at(-1)?.id === sim.data.tricks.skitch.id) bankCombo(sim, t, events)
  t.landGrace = 0
  events.push({ t: 'skitchStart', tick, car: c.id, robo: car.robo })
  events.push({ t: 'trickStart', tick, trick: 'Skitch' })
  if (car.robo && car.speed > 1) events.push({ t: 'robotaxiStop', tick, car: c.id, x: round(c.pos.x), y: round(c.pos.y) })
  return true
}

/** One tick being towed. False when the skitch ended this tick (let go, or the car is gone). */
export function stepSkitch(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]): boolean {
  const k = t.skitch!, T = sim.data.traffic, S = T.skitch
  const P = sim.data.physics, dt = 1 / P.tickHz, tick = sim.world.tick
  const c = byId(sim, k.car)
  if (!c || !has(input, Btn.grab)) { endSkitch(sim, t, 'let go', events); return false }
  const car = c.car!
  // Only towing counts (and gets harder): hanging on to a stopped car is easy and scores nothing.
  const moving = clamp(car.speed / S.easySpeed, 0, 1)
  if (car.speed > 1) k.ticks++
  k.meters += car.speed * dt   // how far it has towed you (city goals)
  // Balance, as on a grind (left/right, the HUD's side-to-side meter); the car turning pushes you
  // to the outside of the turn (its sideways acceleration speed x yaw rate, + = turning left).
  const lat = car.speed * car.turn * P.tickHz
  const ramp = 1 + (S.ramp * k.ticks) / P.tickHz
  const noise = (nextFloat(sim.world.rng) * 2 - 1) * S.noise * ramp * moving
  k.balanceVel += (S.instability * ramp * moving * k.balance + noise + S.control * stick(input).x + S.turnPush * lat - S.damping * k.balanceVel) * dt
  k.balance += k.balanceVel * dt
  const thrown = abs(lat) > S.turnBail ? 'thrown off: the car turned' : abs(k.balance) >= 1 ? 'lost balance skitching' : ''
  if (thrown) {
    t.skitch = null
    t.vel = scale(c.vel, 0.85)
    loseCombo(sim, t, events)
    events.push({ t: 'skitchEnd', tick, car: c.id, reason: thrown, points: 0 })
    startBail(t, thrown, tick, events)
    return true
  }
  // Towed: just behind the bumper, the board along the car.
  const { f, l, u } = carFrame(c)
  t.pos = madd(madd(madd(c.pos, f, -dimsOf(sim.data, c).body.length / 2 - S.behind), l, k.side), u, P.skater.radius)
  // The wheels on the road under you (the car's frame is the road under its middle).
  const ground = probeGround(sim.park, madd(t.pos, Z, 0.3), Z, 0.3 + P.skater.radius + 0.3)
  if (ground) { t.pos.z = ground.point.z + P.skater.radius; t.groundTri = ground.tri; t.up = copy(ground.normal) } else t.up = copy(u)
  t.vel = copy(c.vel)
  t.fwd = scale(norm(flatten(v3(f.x, f.y, f.z), t.up), t.fwd), k.lead)
  t.steer = 0; t.slip = 0; t.lean = k.balance * 0.2
  // Human drivers honk at the kid on their bumper (a streetcar rings its bell: tram); robotaxis say
  // nothing (they stop: traffic.ts).
  // A vehicle a player drives (game/vehicles.ts) does not: its driver is your co-op partner (split screen), and the horn is theirs.
  if (!car.robo && !car.drive && tick >= k.honkAt) {
    events.push(car.tram
      ? { t: 'honk', tick, car: c.id, robo: false, x: round(c.pos.x), y: round(c.pos.y), tram: true }
      : { t: 'honk', tick, car: c.id, robo: false, x: round(c.pos.x), y: round(c.pos.y) })
    k.honkAt = tick + Math.round(S.honkEvery * P.tickHz)
  }
  return true
}

/** Let go (or ollie off): ride on at the car's speed; the Skitch goes into the combo. */
export function endSkitch(sim: Sim, t: Thing, reason: 'let go' | 'ollie', events: SimEvent[]) {
  const k = t.skitch
  if (!k) return
  const c = byId(sim, k.car)
  if (c) t.vel = copy(c.vel)
  const def = sim.data.tricks.skitch
  t.skitch = null
  t.landGrace = reason === 'ollie' ? 0 : sim.data.physics.combo.graceTicks
  // Towed for less than skitch.minSeconds: it never happened (no Skitch in the combo, no points).
  if (k.ticks < sim.data.traffic.skitch.minSeconds * sim.data.physics.tickHz) {
    events.push({ t: 'skitchEnd', tick: sim.world.tick, car: k.car, reason: 'void', points: 0 })
    return
  }
  const points = Math.round(def.points + (def.pointsPerSecond * k.ticks) / sim.data.physics.tickHz)
  t.combo.push({ id: def.id, name: def.name, points })
  events.push({ t: 'skitchEnd', tick: sim.world.tick, car: k.car, reason, points })
  events.push({ t: 'trickEnd', tick: sim.world.tick, trick: def.name, points })
}

const round = (x: number) => Math.round(x * 1000) / 1000
