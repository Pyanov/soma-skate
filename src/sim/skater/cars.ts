import type { CarDims, GameData } from '../data.ts'
import type { InputFrame } from '../input.ts'
import { abs, add, dot, madd, rotateAround, scale, sub, v3, type Vec3 } from '../math.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { sphereContacts, type Contact } from '../park/park.ts'
import { Kind, State, type Thing } from '../thing.ts'
import { loseCombo } from '../tricks/tricks.ts'
import { carFrame } from '../game/traffic.ts'
import { stepBoard } from './board.ts'
import { groundCombo, startBail, takeoff, touchDown } from './skater.ts'

// The skater meets the city's cars (docs/mechanics/traffic.md). A car is two boxes in its own
// frame (body and cabin, the sizes the view draws). Its roof and hood are rideable: land on them
// and the board rides along, relative to the car. Hitting its side or ends hard is a bail; a
// gentle touch slides off. Only cars within traffic.collideRange are tested. Streetcars (car.tram)
// are cars with their own boxes (traffic.tram); one never stops for you: its front shoves you aside,
// off its track, to a side clear of the park (its rear is a bump like any car's).

const Z = v3(0, 0, 1)

/**
 * A car's boxes and the range it is tested within: a streetcar's (car.tram: traffic.tram), a vehicle's
 * (car.drive: its type's dims in data/vehicles.json, named for its edges), else every car's.
 */
export function dimsOf(data: Pick<GameData, 'traffic' | 'vehicles'>, c: Thing): CarDims & { collideRange: number; name?: string } {
  const T = data.traffic
  if (c.car?.tram) return T.tram
  const v = c.car?.drive ? data.vehicles.types[c.car.drive.type] : undefined
  if (v) return { body: v.dims.body, cabin: v.dims.cabin, name: v.name, collideRange: Math.max(T.collideRange, v.dims.body.length / 2 + 3) }
  return T
}

type Box = { cx: number; hx: number; hy: number; z0: number; z1: number }
const boxes = (D: CarDims): [Box, Box] => [
  { cx: 0, hx: D.body.length / 2, hy: D.body.width / 2, z0: D.body.bottom, z1: D.body.top },
  { cx: D.cabin.offset, hx: D.cabin.length / 2, hy: D.cabin.width / 2, z0: D.body.top, z1: D.cabin.top },
]

/** A world point in the car's frame (x forward, y left, z up from the road under its middle). */
function toCar(c: Thing, p: Vec3) {
  const { f, l, u } = carFrame(c)
  const d = sub(p, c.pos)
  return { x: dot(d, f), y: dot(d, l), z: dot(d, u), f, l, u }
}
const fromCar = (c: Thing, k: ReturnType<typeof toCar>, x: number, y: number, z: number) => madd(madd(madd(c.pos, k.f, x), k.l, y), k.u, z)

/** Height of the roof or hood over a point in the car's frame, or null off the car. */
export function carTop(D: CarDims, x: number, y: number): number | null {
  const [body, cabin] = boxes(D)
  if (abs(x - cabin.cx) <= cabin.hx && abs(y) <= cabin.hy) return cabin.z1
  if (abs(x - body.cx) <= body.hx && abs(y) <= body.hy) return body.z1
  return null
}

/** The deepest touch of a sphere (centre in the car's frame) with the car's boxes: normal (car frame) and depth. */
function touch(D: CarDims, x: number, y: number, z: number, r: number): { n: Vec3; depth: number } | null {
  let best: { n: Vec3; depth: number } | null = null
  for (const b of boxes(D)) {
    const qx = Math.max(b.cx - b.hx, Math.min(b.cx + b.hx, x)), qy = Math.max(-b.hy, Math.min(b.hy, y)), qz = Math.max(b.z0, Math.min(b.z1, z))
    const dx = x - qx, dy = y - qy, dz = z - qz, d = Math.sqrt(dx * dx + dy * dy + dz * dz)
    if (d >= r || dz < 0) continue   // never from below: a car does not push anyone down through the road
    let n: Vec3, depth: number
    if (d > 1e-9) { n = v3(dx / d, dy / d, dz / d); depth = r - d }
    else {
      // Centre inside the box: out through the nearest side, end or top (never the bottom).
      const faces: [number, Vec3][] = [[b.cx + b.hx - x, v3(1, 0, 0)], [x - (b.cx - b.hx), v3(-1, 0, 0)], [b.hy - y, v3(0, 1, 0)], [y + b.hy, v3(0, -1, 0)], [b.z1 - z, v3(0, 0, 1)]]
      let k = 0
      for (let i = 1; i < faces.length; i++) if (faces[i][0] < faces[k][0]) k = i
      n = faces[k][1]; depth = faces[k][0] + r
    }
    if (!best || depth > best.depth) best = { n, depth }
  }
  return best
}

/** The side (left or right of the car, the nearer first) the skater can be put out to, dist metres, clear of the park; null if neither is. */
function clearSide(sim: Sim, t: Thing, k: ReturnType<typeof toCar>, dist: number, r: number): Vec3 | null {
  const near = k.y >= 0 ? 1 : -1
  for (const s of [near, -near]) {
    const side = scale(k.l, s)
    if (sphereContacts(sim.park, madd(t.pos, side, dist), r * 0.9, touching).length === 0) return side
  }
  return null
}
const touching: Contact[] = []

/** After the skater's step: land on a roof, slide off a car, or get hit by one. */
export function meetCars(sim: Sim, t: Thing, events: SimEvent[]) {
  if (t.state !== State.ground && t.state !== State.air && t.state !== State.walk && t.state !== State.bail) return
  const T = sim.data.traffic, r = sim.data.physics.skater.radius, tick = sim.world.tick
  for (const c of sim.world.things) {
    if (c.kind !== Kind.car || !c.car || c.id === t.carRide) continue
    const D = dimsOf(sim.data, c)
    if (abs(c.pos.x - t.pos.x) > D.collideRange || abs(c.pos.y - t.pos.y) > D.collideRange || abs(c.pos.z - t.pos.z) > D.collideRange) continue
    const k = toCar(c, t.pos)
    const hit = touch(D, k.x, k.y, k.z, r)
    if (!hit) continue
    const n = madd(madd(scale(k.f, hit.n.x), k.l, hit.n.y), k.u, hit.n.z)
    const rel = sub(t.vel, c.vel)
    const top = carTop(D, k.x, k.y)
    if (t.state === State.air && hit.n.z > 0.7 && top !== null && dot(rel, k.u) <= 0.5) {
      // Down onto the roof or hood: a landing, judged against the car's motion; then ride it.
      t.pos = fromCar(c, k, k.x, k.y, top + r)
      t.vel = rel
      const ok = touchDown(sim, t, rel, k.u, events)
      t.vel = add(t.vel, c.vel)
      if (ok) { t.carRide = c.id; t.groundTri = -1; events.push({ t: 'carLand', tick, car: c.id }) }
      return
    }
    const shove = c.car.tram && hit.n.x > 0.5 && hit.n.z < 0.7 ? clearSide(sim, t, k, D.body.width / 2 + r - abs(k.y), r) : null
    if (shove) {
      // A streetcar's front: it does not stop. Out to the nearer clear side, off its track; coming hard,
      // a hit. (Its rear, or no side clear of the park: a bump like any car's.)
      const side = shove, vn = dot(rel, n)
      t.pos = madd(t.pos, side, D.body.width / 2 + r - abs(k.y))
      if (vn >= 0) continue
      if ((t.state === State.ground || t.state === State.air) && -vn > T.hitSpeed) {
        loseCombo(sim, t, events)
        startBail(t, 'hit by a streetcar', tick, events)
        t.carRide = -1
        events.push({ t: 'carHit', tick, car: c.id, robo: false, speed: Math.round(-vn * 1000) / 1000, reason: 'hit by a streetcar' })
        t.vel = madd(madd(t.vel, n, -vn), side, T.knock)
      } else t.vel = madd(t.vel, n, -vn)
      continue
    }
    t.pos = madd(t.pos, n, hit.depth)
    const vn = dot(rel, n)
    if (vn >= 0) continue
    if ((t.state === State.ground || t.state === State.air) && -vn > T.hitSpeed) {
      const reason = abs(dot(t.vel, n)) >= abs(dot(c.vel, n)) ? 'ran into a car' : 'hit by a car'
      loseCombo(sim, t, events)
      startBail(t, reason, tick, events)
      t.carRide = -1
      events.push({ t: 'carHit', tick, car: c.id, robo: c.car.robo, speed: Math.round(-vn * 1000) / 1000, reason })
      t.vel = madd(madd(t.vel, n, -vn), n, T.knock)   // the part into the car is gone; knocked away
    } else t.vel = madd(t.vel, n, -vn)                 // slide off it
  }
}

/**
 * A ground tick on a car's roof or hood. The board's physics run relative to the car (its grip,
 * rolling, braking, powerslides); the skater moves with the car. Rolling off an edge (or off the
 * roof onto the hood) is a takeoff. Returns false if the car is gone (back to the park ground).
 */
export function rideCar(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]): boolean {
  const c = sim.world.things.find((x) => x.id === t.carRide && x.kind === Kind.car && x.car)
  if (!c) { t.carRide = -1; return false }
  const P = sim.data.physics, T = sim.data.traffic, r = P.skater.radius, dt = 1 / P.tickHz, tick = sim.world.tick
  // The car turned this tick: the board turns with its roof, about its middle.
  const turn = c.car!.turn
  if (turn !== 0) {
    t.pos = add(c.pos, rotateAround(sub(t.pos, c.pos), Z, turn))
    t.fwd = rotateAround(t.fwd, Z, turn)
    t.vel = add(c.vel, rotateAround(sub(t.vel, c.vel), Z, turn))
  }
  const frame = carFrame(c)
  t.up = frame.u
  t.load = 1
  t.groundTri = -1
  t.vel = sub(t.vel, c.vel)
  const thrown = stepBoard(sim, t, input, events)
  if (thrown) { t.vel = add(t.vel, c.vel); t.carRide = -1; loseCombo(sim, t, events); startBail(t, thrown, tick, events); return true }
  // The car has already moved this tick (traffic steps first): ride along, plus the board's own motion.
  t.pos = madd(madd(t.pos, t.vel, dt), c.vel, dt)
  const k = toCar(c, t.pos)
  const top = carTop(dimsOf(sim.data, c), k.x, k.y)
  t.vel = add(t.vel, c.vel)
  if (top === null || abs(k.z - r - top) > 0.25) {
    t.carRide = -1
    takeoff(t, P)
    events.push({ t: 'air', tick, speed: Math.round(Math.hypot(t.vel.x, t.vel.y, t.vel.z) * 1000) / 1000, z: Math.round(t.pos.z * 1000) / 1000, vert: false })
    return true
  }
  t.pos = fromCar(c, k, k.x, k.y, top + r)
  groundCombo(sim, t, input, events)
  return true
}
