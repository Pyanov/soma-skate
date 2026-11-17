import type { VehicleType } from '../data.ts'
import { Btn } from '../input.ts'
import { abs, add, atan2, clamp, cos, cross, DEG, dot, flatten, headingDir, madd, max, min, norm, scale, sin, sub, tan, v3, wrapAngle, type Vec3 } from '../math.ts'
import { raycast, sphereContacts, type Contact } from '../park/park.ts'
import { player2, type Sim, type SimEvent } from '../sim.ts'
import { endManual, manualInput, startManual, stepManual, trackDirs } from '../skater/combo.ts'
import { nextFloat } from '../rng.ts'
import { bankCombo } from '../tricks/tricks.ts'
import { Kind, makeThing, State, type Thing } from '../thing.ts'
import { carFrame } from './traffic.ts'

// Driving (docs/mechanics/driving.md; data/vehicles.json): the crew van and the mission vehicles
// are car Things with car.drive, off the street network (path -1), so traffic, the skater's car
// collisions (roof riding, grinding its edges, a hit) and the views all see them as cars. F (the
// use button) next to one gets in; the skater rides in it (state 'drive', its place the
// seat's) and the vehicle reads that player's buttons: up throttle, down brake then reverse, left
// and right steer, slide the handbrake, ollie the horn, use out again. Arcade handling on the
// park's and the city's ground: four wheels raycast down (a curb is climbed, a wall is not), the
// body leans with the ground, slopes pull, speed-sensitive steering, grip that lets go into a slide
// with the handbrake. Spheres along the body bump off walls and props; boxes against the cars. All
// numbers in data. Vehicle Things take ids of their own (VEHICLE_ID up), so adding one never moves
// another Thing's id.

export const VEHICLE_ID = 2_000_000
const Z = v3(0, 0, 1), DOWN = v3(0, 0, -1)
const GROUND_NZ = 0.6     // a wheel stands on a face this flat or flatter (else it is a wall)
const STICK = 0.05        // metres above the ground that still counts as on it
const near: Contact[] = []

export const isVehicle = (c: Thing) => c.kind === Kind.car && c.alive && !!c.car?.drive
export const vehicles = (sim: Sim) => sim.world.things.filter(isVehicle)
export const driving = (t: Thing) => t.drive !== undefined
export const typeOf = (sim: Sim, c: Thing): VehicleType => sim.data.vehicles.types[c.car!.drive!.type]
/** The vehicle a skater drives, or null. */
export const drivenBy = (sim: Sim, t: Thing) => (t.drive === undefined ? null : sim.world.things.find((c) => c.id === t.drive && isVehicle(c)) ?? null)
const byName = (sim: Sim, name: string) => sim.world.things.find((c) => c.kind === Kind.car && c.car?.drive?.name === name) ?? null

/** createSim: the vehicles data/vehicles.json parks in this world from the start. */
export function spawnParked(sim: Sim) {
  for (const p of sim.data.vehicles.parked) if (p.world === sim.park.name) placeVehicle(sim, p.type, p.id, p.x, p.y, p.heading)
}

/**
 * A vehicle of a type at (x, y), heading degrees clockwise from north, standing on the ground there;
 * the one with this name if it exists (moved here, stopped), else a new one. Not while someone drives it.
 */
export function placeVehicle(sim: Sim, type: string, name: string, x: number, y: number, heading: number): Thing {
  const vt = sim.data.vehicles.types[type]
  if (!vt) throw new Error(`no vehicle type "${type}" (data/vehicles.json types: ${Object.keys(sim.data.vehicles.types).join(', ')})`)
  let c = byName(sim, name)
  if (c && c.car!.drive!.driver >= 0) throw new Error(`${name} is being driven`)
  if (!c) {
    let id = VEHICLE_ID
    while (sim.world.things.some((t) => t.id === id)) id++
    c = makeThing(id, Kind.car)
    sim.world.things.push(c)
  }
  c.alive = true
  c.state = State.ground
  c.car = { path: -1, s: 0, dir: 1, speed: 0, cruise: 0, robo: false, paint: 0, wait: 0, honked: false, yielding: false, hazard: false, turn: 0,
    drive: { type, name, driver: -1, heading: heading * DEG, yawRate: 0, steer: 0, ground: true, handbrake: false, throttle: 0, bumpCool: 0, hornAt: -1_000_000 } }
  // A rental scooter starts fully charged, standing.
  if (vt.scooter) c.car.drive!.ride = { charge: Math.round(vt.scooter.battery * sim.data.physics.tickHz), rideTicks: 0, low: false, tipped: false }
  // The ground, looked for from a little above the player (under the freeway the deck is the top), else from the sky.
  const p = sim.world.things.find((t) => t.kind === Kind.skater && t.alive && t.player !== 2)
  const top = (p ? raycast(sim.park, v3(x, y, p.pos.z + 6), DOWN, 30) : null) ?? raycast(sim.park, v3(x, y, 2000), DOWN, 4000)
  c.pos = v3(x, y, top ? top.point.z : 0)
  // Settle onto the wheels: where the ground under them is (twice: the first finds the height).
  let n = Z
  for (let k = 0; k < 3; k++) { const g = groundAt(sim, vt, c.pos, c.car.drive!.heading, n); if (g) { c.pos.z = g.z; n = g.n } }
  c.vel = v3()
  pose(c, n)
  return c
}

/** `vehicle clear [name]`: that vehicle (or every one) goes; whoever drives it is put out first. */
export function clearVehicles(sim: Sim, name?: string, events: SimEvent[] = []) {
  for (const c of vehicles(sim)) {
    if (name && c.car!.drive!.name !== name) continue
    // Whoever drives it gets out by a door (vehicleExit), where it is now; every side blocked: out where they sit.
    const d = sim.world.things.find((t) => t.id === c.car!.drive!.driver && t.drive === c.id)
    if (d && !exit(sim, d, events, true)) leave(sim, d, c, null)
    c.alive = false
  }
  sim.world.things = sim.world.things.filter((t) => !(t.kind === Kind.car && t.car?.drive && !t.alive))
}

/**
 * `van summon [x y [heading]]`: the crew van (data vehicles.summon) on the street lane nearest the
 * skater, summon.near to summon.far metres off, facing along the street; or at (x, y). The map and
 * missions call it. Out of reach of nothing: it stands where it is put.
 */
export function summonVan(sim: Sim, at?: { x: number; y: number; heading?: number }): Thing {
  const S = sim.data.vehicles.summon
  if (at) return placeVehicle(sim, S.type, S.id, at.x, at.y, at.heading ?? 0)
  const sk = sim.world.things.find((t) => t.kind === Kind.skater && t.alive && t.player !== 2)
  if (!sk) throw new Error('van summon: no skater')
  const net = sim.park.traffic
  let best: { x: number; y: number; h: number; d: number } | null = null
  for (const p of net.paths) {
    const b = p.box
    if (b[0] > sk.pos.x + S.far || b[2] < sk.pos.x - S.far || b[1] > sk.pos.y + S.far || b[3] < sk.pos.y - S.far) continue
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1], q = p.points[i], ex = q[0] - a[0], ey = q[1] - a[1], l = Math.hypot(ex, ey) || 1
      // Along the segment in 1 m steps, the right-hand lane (the kerb side): the first point between near and far, nearest.
      for (let u = 0; u <= l; u += 1) {
        const lane = p.oneway ? 0 : p.lanes >= 4 ? sim.data.traffic.lane.wide : sim.data.traffic.lane.twoWay
        const x = a[0] + (ex * u) / l + (ey / l) * lane, y = a[1] + (ey * u) / l - (ex / l) * lane
        const d = Math.hypot(x - sk.pos.x, y - sk.pos.y)
        if (d < S.near || d > S.far || (best && d >= best.d)) continue
        best = { x, y, h: atan2(ex, ey) / DEG, d }
      }
    }
  }
  if (!best) {
    // No street near: beside the skater, facing the way it faces.
    const h = atan2(sk.fwd.x, sk.fwd.y)
    return placeVehicle(sim, S.type, S.id, sk.pos.x + cos(h) * (S.near + 1), sk.pos.y - sin(h) * (S.near + 1), h / DEG)
  }
  return placeVehicle(sim, S.type, S.id, best.x, best.y, best.h)
}

// ---- Getting in and out ----

/** Metres from p to vehicle c's body box in plan (0 inside it). */
function boxDistance(sim: Sim, c: Thing, p: Vec3): number {
  const D = typeOf(sim, c).dims.body, { f, l } = carFrame(c)
  const d = sub(p, c.pos), x = abs(dot(d, f)) - D.length / 2, y = abs(dot(d, l)) - D.width / 2
  return Math.hypot(max(0, x), max(0, y))
}

/** The free vehicle nearest the skater within data vehicles.enter of its body, or null. */
export function vehicleInReach(sim: Sim, t: Thing): Thing | null {
  let best: Thing | null = null, bd = sim.data.vehicles.enter
  for (const c of vehicles(sim)) {
    if (c.car!.drive!.driver >= 0 || abs(c.pos.z - t.pos.z) > 3) continue
    const d = boxDistance(sim, c, t.pos)
    if (d <= bd) { bd = d; best = c }
  }
  return best
}

/**
 * The vehicle use would get skater t into now (null: none): one in reach, with t standing or rolling
 * slowly on the board (up to exit.speed) or on its feet on the ground. For the client's prompt too.
 */
export function canGetIn(sim: Sim, t: Thing): Thing | null {
  if (t.drive !== undefined) return null
  const can = (t.state === State.ground && t.carRide < 0 && !t.skitch && Math.hypot(t.vel.x, t.vel.y) <= sim.data.vehicles.exit.speed) || (t.state === State.walk && !t.footAir && t.climb === 0 && !t.hang)
  return can ? vehicleInReach(sim, t) : null
}

/** The vehicle skater t drives, when it is slow enough to get out of (the client's prompt; a side may still be blocked). */
export function canGetOut(sim: Sim, t: Thing): Thing | null {
  const c = drivenBy(sim, t)
  return c && Math.hypot(c.vel.x, c.vel.y) <= sim.data.vehicles.exit.speed ? c : null
}

/** Skater t gets in vehicle c (from the board standing or rolling slowly, or on foot): the combo banks, it rides in the seat. */
export function enter(sim: Sim, t: Thing, c: Thing, events: SimEvent[]) {
  if (t.manual) endManual(sim, t, 'step off', events)
  if (t.combo.length || t.landGrace > 0) bankCombo(sim, t, events)
  const d = c.car!.drive!
  d.driver = t.id
  if (d.ride) { d.ride.rideTicks = 0; d.ride.tipped = false }   // a scooter's ride starts (picked up, if it lay on its side)
  t.drive = c.id
  t.state = State.drive
  t.stateTicks = 0
  t.skitch = null; t.carRide = -1; t.grind = null; t.lip = null; t.manual = null; t.wall = null
  t.crouch = false; t.charge = 0; t.steer = 0; t.lean = 0; t.slip = 0; t.powerslide = 0; t.wobble = 0; t.stumble = 0
  t.footAir = false; t.climb = 0; t.hang = false
  seat(sim, t, c)
  events.push({ t: 'vehicleEnter', tick: sim.world.tick, car: c.id, name: d.name, type: d.type })
}

/**
 * Skater t gets out of the vehicle it drives: onto its board beside the driver's door (the left; the
 * right, ahead or behind when that is blocked), rolling as the vehicle was. Not above exit.speed, and
 * not with every side blocked: false then (and a vehicleExitBlocked event).
 */
export function exit(sim: Sim, t: Thing, events: SimEvent[], force = false): boolean {
  const c = drivenBy(sim, t)
  if (!c) { t.drive = undefined; if (t.state === State.drive) t.state = State.air; return false }
  const V = sim.data.vehicles, speed = Math.hypot(c.vel.x, c.vel.y)
  if (!force && speed > V.exit.speed) { events.push({ t: 'vehicleExitBlocked', tick: sim.world.tick, car: c.id, reason: 'moving' }); return false }
  const D = typeOf(sim, c).dims.body, { f, l } = carFrame(c), r = sim.data.physics.skater.radius
  const side = D.width / 2 + V.exit.side, end = D.length / 2 + V.exit.side
  for (const off of [scale(l, side), scale(l, -side), scale(f, end), scale(f, -end)]) {
    const p = add(c.pos, off)
    const g = raycast(sim.park, v3(p.x, p.y, c.pos.z + 1.5), DOWN, 4)
    if (!g || g.normal.z < GROUND_NZ) continue
    const at = v3(p.x, p.y, g.point.z + r + 0.01)
    if (sphereContacts(sim.park, at, r * 0.95, near).length) continue
    if (t.manual) { endManual(sim, t, 'step off', events); bankCombo(sim, t, events) }   // off a scooter mid-wheelie: it banks
    leave(sim, t, c, at)
    events.push({ t: 'vehicleExit', tick: sim.world.tick, car: c.id, name: c.car!.drive!.name, type: c.car!.drive!.type })
    return true
  }
  if (force) { if (t.manual) { endManual(sim, t, 'step off', events); bankCombo(sim, t, events) }; leave(sim, t, c, v3(c.pos.x, c.pos.y, c.pos.z + typeOf(sim, c).dims.cabin.top + r)); return true }
  events.push({ t: 'vehicleExitBlocked', tick: sim.world.tick, car: c.id, reason: 'blocked' })
  return false
}

/** Out of c, at p on the board (or standing where it was, p null: the vehicle is going). */
function leave(sim: Sim, t: Thing, c: Thing, p: Vec3 | null) {
  c.car!.drive!.driver = -1
  t.drive = undefined
  t.state = State.ground
  t.stateTicks = 0
  if (p) t.pos = p
  t.vel = v3(c.vel.x, c.vel.y, 0)
  const h = c.car!.drive!.heading
  t.fwd = headingDir(h)
  t.up = v3(0, 0, 1)
  t.groundTri = -1
  t.safe = { ...t.pos }
  t.popped = false
}

/** The driver's place: the seat, up from the ground under the vehicle's middle; moving with it. */
function seat(sim: Sim, t: Thing, c: Thing) {
  const u = carFrame(c).u
  t.pos = madd(c.pos, u, typeOf(sim, c).seat ?? sim.data.vehicles.seat)
  t.vel = { ...c.vel }
  t.fwd = headingDir(c.car!.drive!.heading)
  t.up = v3(0, 0, 1)
}

/**
 * Before each skater's own step (step.ts): use (F, pressed this tick) in reach of a free vehicle
 * gets in; in one, use gets out; a skater in a vehicle rides in its seat and does not skate. True when
 * the skater's own step is over for this tick.
 */
export function getInOrRide(sim: Sim, t: Thing, b: number, events: SimEvent[]): boolean {
  const press = (b & Btn.use) !== 0 && (t.prevB & Btn.use) === 0
  if (t.drive !== undefined) {
    const c0 = drivenBy(sim, t)
    if (press && exit(sim, t, events)) { if (c0) rideEnd(sim, c0, events); t.prevB = b; return true }
    const c = drivenBy(sim, t)
    if (!c) { t.drive = undefined; t.state = State.air; return false }
    t.stateTicks++
    seat(sim, t, c)
    const vt = typeOf(sim, c)
    if (vt.scooter && scooterRider(sim, t, c, vt, b, events)) return true
    t.prevB = b
    return true
  }
  if (!press) return false
  const c = canGetIn(sim, t)
  if (!c) return false
  enter(sim, t, c, events)
  t.prevB = b
  return true
}

// ---- Rental scooters (a type with a scooter block) ----

/**
 * A rider on a rental scooter, after the scooter's own tick: up then down quickly lifts its front into a
 * wheelie (the manual's balance and scoring, Scooter Wheelie: the up and down keys balance it while the
 * motor runs); ollie ditches it; losing the wheelie throws the rider off. True when the rider is off it.
 */
function scooterRider(sim: Sim, t: Thing, c: Thing, vt: VehicleType, b: number, events: SimEvent[]): boolean {
  const f = { b }
  if ((b & Btn.ollie) !== 0 && (t.prevB & Btn.ollie) === 0) { ditch(sim, t, c, vt, events); t.prevB = b; return true }
  trackDirs(t, f, sim.world.tick)
  if (t.manual) {
    if (!stepManual(sim, t, f, events)) { fallOff(sim, t, c, events); t.prevB = b; return true }
  } else if (manualInput(sim, t) === 'manual' && c.car!.drive!.ground && Math.hypot(c.vel.x, c.vel.y) >= sim.data.physics.combo.manualStartSpeed) startManual(sim, t, 'wheelie', events)
  return false
}

/**
 * Ollied off a scooter: the rider pops up off its deck onto the board, with the scooter's speed, the board
 * twisting off its line (a spin of up to ditch.spinMax rad/s, the world's random draw, which the air's
 * spin decay slows), so the landing decides: clean,
 * sketchy, a stumble or a bail. The ditch is a trick in the combo (a wheelie before it too); the scooter
 * falls over where it was.
 */
function ditch(sim: Sim, t: Thing, c: Thing, vt: VehicleType, events: SimEvent[]) {
  const S = vt.scooter!, d = c.car!.drive!, tick = sim.world.tick
  if (t.manual) endManual(sim, t, 'ollie', events)
  const spin = (nextFloat(sim.world.rng) * 2 - 1) * S.ditch.spinMax
  rideEnd(sim, c, events)
  const F = carFrame(c), r = sim.data.physics.skater.radius
  leave(sim, t, c, madd(madd(c.pos, F.l, vt.dims.body.width / 2 + r + 0.05), F.u, vt.dims.body.top + r + 0.02))   // off its left side, clear of the bars
  t.state = State.air
  t.vel = v3(c.vel.x, c.vel.y, S.ditch.pop)
  t.fwd = headingDir(d.heading)
  t.spin = 0; t.spinVel = spin   // (+ = left): spinning against it saves the landing
  t.takeoffXY = [t.pos.x, t.pos.y]
  t.popped = true   // this air is the pop: no late ollie on top of it (the ollie press that ditched it releases next tick)
  t.combo.push({ id: 'scooterditch', name: S.ditch.name, points: S.ditch.points })
  d.ride!.tipped = true; c.vel = v3()   // it falls over where it was left (rolling on, the rider came down on it)
  events.push({ t: 'vehicleExit', tick, car: c.id, name: d.name, type: d.type })
  events.push({ t: 'scooterDitch', tick, car: c.id, spin: round(spin) })
}

/** The wheelie lost: the rider is thrown off beside the scooter (a bail, the combo gone); it lies on its side. */
function fallOff(sim: Sim, t: Thing, c: Thing, events: SimEvent[]) {
  const tick = sim.world.tick, name = t.manual?.name ?? 'Scooter Wheelie'
  t.manual = null
  rideEnd(sim, c, events)
  exit(sim, t, events, true)
  t.state = State.bail
  t.stateTicks = 0
  events.push({ t: 'comboLost', tick, name: [...t.combo.map((e) => e.name), name].join(' + ') })
  events.push({ t: 'bail', tick, reason: 'fell off the scooter' })
  t.combo = []
  c.car!.drive!.ride!.tipped = true; c.vel = v3()
}

/** A scooter ride ends (got off, ditched, thrown off): how long, and the fare it would be, for the view. */
function rideEnd(sim: Sim, c: Thing, events: SimEvent[]) {
  const R = c.car!.drive!.ride, S = typeOf(sim, c).scooter
  if (!R || !S) return
  const seconds = R.rideTicks / sim.data.physics.tickHz
  events.push({ t: 'scooterRideEnd', tick: sim.world.tick, car: c.id, seconds: round(seconds), fare: Math.round((S.fare.unlock + S.fare.perMinute * Math.ceil(seconds / 60)) * 100) })
  R.rideTicks = 0
}

// ---- Each tick ----

/**
 * Ground under the four wheels at pos and heading, each looked for from maxStep above where the
 * ground it stands on now (normal n) would put it: the height under the middle, the normal, wheels on it.
 */
function groundAt(sim: Sim, vt: VehicleType, pos: Vec3, heading: number, n: Vec3 = Z): { z: number; n: Vec3; wheels: number } | null {
  const fx = sin(heading), fy = cos(heading), rx = fy, ry = -fx
  const hb = vt.wheelbase / 2, ht = vt.track / 2, nz = max(n.z, GROUND_NZ)
  const zs: (number | null)[] = []
  let sum = 0, k = 0
  for (const [a, s] of [[hb, -ht], [hb, ht], [-hb, -ht], [-hb, ht]] as const) {   // front left, front right, rear left, rear right
    const ox = fx * a + rx * s, oy = fy * a + ry * s, x = pos.x + ox, y = pos.y + oy
    const z0 = pos.z - (n.x * ox + n.y * oy) / nz
    const h = raycast(sim.park, v3(x, y, z0 + vt.maxStep), DOWN, vt.maxStep + vt.maxDrop)
    if (!h || h.normal.z < GROUND_NZ) { zs.push(null); continue }
    zs.push(h.point.z); sum += h.point.z; k++
  }
  if (k < 2) return null
  const avg = sum / k, at = (i: number) => zs[i] ?? avg
  const sF = (at(0) + at(1) - at(2) - at(3)) / (2 * vt.wheelbase), sR = (at(1) + at(3) - at(0) - at(2)) / (2 * vt.track)
  // Missing wheels sit on the plane of the others: the middle is their mean height.
  const z = (at(0) + at(1) + at(2) + at(3)) / 4
  return { z, n: norm(v3(-fx * sF - rx * sR, -fy * sF - ry * sR, 1), Z), wheels: k }
}

/** The vehicle's frame for everyone who reads it: fwd along the heading on the ground, up the ground's normal. */
function pose(c: Thing, n: Vec3) {
  const h = c.car!.drive!.heading
  c.fwd = norm(flatten(headingDir(h), n), headingDir(h))
  c.up = n
  c.car!.speed = dot(c.vel, c.fwd)
}

/**
 * One tick for every vehicle, after traffic and before the skaters (step.ts): the driver's buttons
 * (buttonsOf its skater), or none for an empty one (it brakes to a stop). Drive on the ground, fly
 * off it, bump off the park and the cars.
 */
export function stepVehicles(sim: Sim, buttonsOf: (t: Thing) => number, events: SimEvent[]) {
  let any = false
  for (const t of sim.world.things) if (t.kind === Kind.car && t.car?.drive) { any = true; break }
  if (!any) return
  for (const c of sim.world.things) {
    if (!isVehicle(c)) continue
    const d = c.car!.drive!
    const driver = d.driver >= 0 ? sim.world.things.find((t) => t.id === d.driver && t.alive && t.drive === c.id) : undefined
    if (d.driver >= 0 && !driver) d.driver = -1
    drive(sim, c, driver ? buttonsOf(driver) : -1, events, !!driver?.manual)
  }
}

/**
 * One vehicle's tick. b: the driver's buttons, -1 with nobody at the wheel. wheelie: its rider is in a
 * wheelie (a scooter): the motor runs and up and down are the rider's balance, not throttle and brake.
 */
function drive(sim: Sim, c: Thing, b: number, events: SimEvent[], wheelie = false) {
  const P = sim.data.physics, vt = typeOf(sim, c), d = c.car!.drive!, S = vt.scooter, R = d.ride
  let E = vt.engine
  const dt = 1 / P.tickHz, g = P.gravity, tick = sim.world.tick
  // Parked and still: nothing to do (an empty vehicle only moves when something moved it).
  if (b < 0 && d.ground && abs(c.vel.x) + abs(c.vel.y) + abs(c.vel.z) < 1e-4) { c.vel = v3(); d.steer = 0; d.yawRate = 0; d.throttle = 0; d.handbrake = false; c.car!.speed = 0; c.car!.turn = 0; if (d.bumpCool > 0) d.bumpCool--; return }
  const has = (bit: number) => b >= 0 && (b & bit) !== 0
  const up = has(Btn.up) || (wheelie && b >= 0), down = has(Btn.down) && !wheelie, steerIn = (has(Btn.right) ? 1 : 0) - (has(Btn.left) ? 1 : 0)
  d.handbrake = !S && has(Btn.slide)
  if (d.bumpCool > 0) d.bumpCool--
  // A scooter's battery runs down while it is ridden: low (said once) holds it to lowTop, empty stops its motor.
  if (S && R) {
    if (b >= 0) {
      R.rideTicks++
      if (R.charge > 0 && --R.charge === 0) events.push({ t: 'scooterBattery', tick, car: c.id, state: 'empty' })
      if (!R.low && R.charge <= S.low * P.tickHz) { R.low = true; events.push({ t: 'scooterBattery', tick, car: c.id, state: 'low' }) }
    }
    if (R.charge === 0) E = { ...E, accel: 0 }
    else if (R.low) E = { ...E, topSpeed: min(E.topSpeed, S.lowTop) }
  }
  // The horn: ollie, now and then (a honk event the views and the cars hear). A scooter has none: ollie ditches it.
  if (!S && has(Btn.ollie) && tick - d.hornAt >= sim.data.vehicles.horn * P.tickHz) {
    d.hornAt = tick
    events.push({ t: 'honk', tick, car: c.id, robo: false, x: round(c.pos.x), y: round(c.pos.y), van: true })
  }
  // Steering: toward the stick's lock, which narrows with speed; back to straight when let go.
  const n0 = c.up
  const fh = headingDir(d.heading)
  const fwd0 = norm(flatten(fh, n0), fh)
  const vf0 = dot(c.vel, fwd0), sp = abs(vf0)
  const lock = vt.steer.maxDeg * DEG * vt.steer.fade / (vt.steer.fade + sp)
  const want = steerIn * lock
  const rate = steerIn === 0 || Math.sign(want) !== Math.sign(d.steer) ? vt.steer.back : vt.steer.rate
  d.steer += clamp(want - d.steer, -rate * dt, rate * dt)

  if (d.ground) {
    // Yaw from the front wheels' angle (a bicycle model), held to what the tyres' grip allows.
    // With the handbrake on the rear lets go: the turn comes from the whole speed, not only the part
    // along the van (it keeps rotating while it slides sideways), the van's way until it is clearly
    // going backwards (past 120 degrees), and the spin has momentum (it builds at grip.yawAccel), so a
    // handbrake turn swings on round; the sideways grip is the handbrake's.
    let yaw = (vf0 * tan(d.steer)) / vt.wheelbase
    if (d.handbrake) {
      const v = Math.hypot(c.vel.x, c.vel.y)
      yaw = ((down && vf0 < -0.5 * v ? -1 : 1) * v * tan(d.steer) * vt.grip.yawBoost) / vt.wheelbase   // backing up under power: the turn the other way
      // The spin builds at yawAccel and dies away only at yawFade: slowing in the slide, it swings on round.
      const k = abs(yaw) < abs(d.yawRate) && yaw * d.yawRate >= 0 ? vt.grip.yawFade : vt.grip.yawAccel
      d.yawRate += clamp(yaw - d.yawRate, -k * dt, k * dt)
    } else {
      const cap = vt.grip.lateral / max(sp, 1)
      d.yawRate = clamp(yaw, -cap, cap)
    }
    d.heading = wrapAngle(d.heading + d.yawRate * dt)
    // The velocity in the new frame: what is sideways now is a slide the grip takes out.
    const fh1 = headingDir(d.heading)
    const fwd = norm(flatten(fh1, n0), fh1), right = norm(cross(fwd, n0), v3(fh1.y, -fh1.x, 0))
    let vf = dot(c.vel, fwd), vs = dot(c.vel, right)
    // Along: the engine, the brakes, reverse; the slope; rolling and drag against the motion.
    let a = -g * fwd.z
    if (b >= 0 && up && !down) a += vf < -0.3 ? E.brake : E.accel * max(0, 1 - vf / E.topSpeed)
    else if (b >= 0 && down && !up) a += vf > 0.3 ? -E.brake : -E.reverseAccel * max(0, 1 - -vf / E.reverseTop)
    d.throttle = b < 0 ? 0 : up && !down ? 1 : down && !up ? -1 : 0
    // Let go of both pedals nearly stopped and the brake holds it (on a hill too); an empty vehicle brakes to a stop.
    const hold = b < 0 ? vt.driverless : !up && !down && abs(vf) < 1 ? E.brake : 0
    // A scooter on low battery: its limiter brakes it down to lowTop.
    const limit = S && R?.low && R.charge > 0 && vf > S.lowTop ? S.limiter : 0
    const resist = E.rolling + E.drag * vf * vf + (d.handbrake ? vt.grip.handbrakeDecel : 0) + hold + limit
    vf += a * dt
    // Resistance stops the van, never turns it round.
    vf = vf > 0 ? max(0, vf - resist * dt) : min(0, vf + resist * dt)
    // Sideways: the slope's pull, then the tyres' grip.
    vs += -g * right.z * dt
    const grip = (d.handbrake ? vt.grip.handbrake : vt.grip.lateral) * dt
    vs -= clamp(vs, -grip, grip)
    c.vel = add(scale(fwd, vf), scale(right, vs))
  } else {
    // In the air: gravity; the yaw it took off with fades; nothing to push on.
    c.vel = v3(c.vel.x, c.vel.y, c.vel.z - g * dt)
    d.yawRate *= 0.98
    d.heading = wrapAngle(d.heading + d.yawRate * dt)
    d.throttle = 0
  }
  c.pos = madd(c.pos, c.vel, dt)
  bumpPark(sim, c, vt, events)
  bumpCars(sim, c, vt, events)
  bumpActors(sim, c, vt, events)
  reactNpcs(sim, c, vt, events)
  // Onto the ground under the wheels where they meet it; off it where it falls away faster than the
  // van follows (a crest at speed, an edge).
  const gr = groundAt(sim, vt, c.pos, d.heading, c.up)
  if (gr && c.pos.z <= gr.z + STICK) {
    if (!d.ground && c.vel.z < -4) events.push({ t: 'vanLand', tick, car: c.id, speed: round(-c.vel.z) })
    c.pos.z = gr.z
    const vn = dot(c.vel, gr.n)
    c.vel = madd(c.vel, gr.n, -vn)   // along the ground now (into it: stopped there; off it: kept on it)
    d.ground = true
    pose(c, gr.n)
  } else {
    if (d.ground && gr) {
      // Leaving the ground: an air only when moving off it; a dip a few centimetres down follows it.
      if (c.vel.z >= -0.5 && c.pos.z - gr.z < 0.25 && Math.hypot(c.vel.x, c.vel.y) < 2) { c.pos.z = gr.z; pose(c, gr.n) }
      else d.ground = false
    } else d.ground = false
    if (!d.ground) pose(c, c.up)
  }
  const turn = d.yawRate * dt
  c.car!.turn = -turn   // car.turn is counterclockwise (riders on its roof turn with it)
}

/** The body's spheres against the park: out of walls and props, the speed into them gone (a bump). */
function bumpPark(sim: Sim, c: Thing, vt: VehicleType, events: SimEvent[]) {
  const D = vt.dims.body, B = vt.body, r = D.width / 2, n = B.spheres, d = c.car!.drive!
  const fh = headingDir(d.heading), u = c.up
  let worst = 0
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < n; i++) {
      const x = n === 1 ? 0 : -D.length / 2 + r + (i * (D.length - 2 * r)) / (n - 1)
      const ctr = madd(madd(c.pos, fh, x), u, B.clearance + r)
      sphereContacts(sim.park, ctr, r, near)
      // The contacts are found once per sphere; each pushes only what the pushes before it have not
      // already done along its normal (many small faces of one wall would otherwise add up), and a
      // sphere moves at most its radius a pass (one spawned inside the ground does not fly off).
      let ox = 0, oy = 0
      for (const k of near) {
        if (k.dist < 1e-6) continue
        const nx = (ctr.x - k.px) / k.dist, ny = (ctr.y - k.py) / k.dist, nz = (ctr.z - k.pz) / k.dist
        if (nz > GROUND_NZ) continue   // the ground and tops under the body are the wheels' business
        const hl = Math.hypot(nx, ny)
        if (hl < 1e-6) continue
        const hx = nx / hl, hy = ny / hl
        let depth = r - k.dist - (ox * hx + oy * hy)
        if (depth <= 0) continue
        const room = r - Math.hypot(ox, oy)
        if (room <= 0) break
        depth = min(depth, room)
        c.pos = v3(c.pos.x + hx * depth, c.pos.y + hy * depth, c.pos.z)
        ctr.x += hx * depth; ctr.y += hy * depth
        ox += hx * depth; oy += hy * depth
        const vn = c.vel.x * hx + c.vel.y * hy
        if (vn >= 0) continue
        // Out of the wall, a little back; along it, rubbed; turned by where along the body it hit.
        const j = -vn * (1 + B.restitution)
        const tx = c.vel.x - hx * vn, ty = c.vel.y - hy * vn
        c.vel = v3(c.vel.x + hx * j - tx * B.friction * min(1, -vn / max(1, Math.hypot(tx, ty))), c.vel.y + hy * j - ty * B.friction * min(1, -vn / max(1, Math.hypot(tx, ty))), c.vel.z)
        // The lever from the middle times the push, counterclockwise; the heading turns clockwise.
        const torque = fh.x * x * hy * j - fh.y * x * hx * j
        d.heading = wrapAngle(d.heading - (torque * B.yawKick) / max(1, (D.length * D.length) / 12) / sim.data.physics.tickHz)
        worst = max(worst, -vn)
      }
    }
  }
  if (worst >= vt.bumpSpeed && d.bumpCool === 0) {
    d.bumpCool = Math.round(vt.bumpCooldown * sim.data.physics.tickHz)
    events.push({ t: 'vanBump', tick: sim.world.tick, car: c.id, what: 'wall', other: -1, speed: round(worst) })
  }
}

/** Overlap of two boxes in plan (centre, heading unit, half length, half width): the push for a, out along n, or null. */
function boxes(ax: number, ay: number, af: [number, number], ahl: number, ahw: number, bx: number, by: number, bf: [number, number], bhl: number, bhw: number): { nx: number; ny: number; depth: number } | null {
  const ar: [number, number] = [af[1], -af[0]], br: [number, number] = [bf[1], -bf[0]]
  const dx = bx - ax, dy = by - ay
  let best: { nx: number; ny: number; depth: number } | null = null
  for (const ax2 of [af, ar, bf, br]) {
    const ra = ahl * abs(af[0] * ax2[0] + af[1] * ax2[1]) + ahw * abs(ar[0] * ax2[0] + ar[1] * ax2[1])
    const rb = bhl * abs(bf[0] * ax2[0] + bf[1] * ax2[1]) + bhw * abs(br[0] * ax2[0] + br[1] * ax2[1])
    const dd = dx * ax2[0] + dy * ax2[1], o = ra + rb - abs(dd)
    if (o <= 0) return null
    if (!best || o < best.depth) best = { nx: dd > 0 ? -ax2[0] : ax2[0], ny: dd > 0 ? -ax2[1] : ax2[1], depth: o }
  }
  return best
}

/**
 * The body box against the other cars (traffic, robotaxis, streetcars, the other vehicles): out of
 * them (they keep to their paths), the speed into them gone. A driver honks; a robotaxi stops and
 * says so; both wait while the van is in their lane (traffic.ts yields to a driven vehicle).
 */
function bumpCars(sim: Sim, c: Thing, vt: VehicleType, events: SimEvent[]) {
  const T = sim.data.traffic, D = vt.dims.body, d = c.car!.drive!, tick = sim.world.tick
  const fh = headingDir(d.heading), reach = D.length / 2 + 9
  for (const o of sim.world.things) {
    if (o === c || o.kind !== Kind.car || !o.alive || !o.car) continue
    if (abs(o.pos.x - c.pos.x) > reach || abs(o.pos.y - c.pos.y) > reach || abs(o.pos.z - c.pos.z) > 2.5) continue
    const OD = o.car.drive ? typeOf(sim, o).dims.body : o.car.tram ? T.tram.body : T.body
    const of = Math.hypot(o.fwd.x, o.fwd.y) || 1
    const hit = boxes(c.pos.x, c.pos.y, [fh.x, fh.y], D.length / 2, D.width / 2, o.pos.x, o.pos.y, [o.fwd.x / of, o.fwd.y / of], OD.length / 2, OD.width / 2)
    if (!hit) continue
    c.pos = v3(c.pos.x + hit.nx * hit.depth, c.pos.y + hit.ny * hit.depth, c.pos.z)
    const rvx = c.vel.x - o.vel.x, rvy = c.vel.y - o.vel.y, vn = rvx * hit.nx + rvy * hit.ny
    if (vn >= 0) continue
    const j = -vn * (1 + vt.body.restitution)
    c.vel = v3(c.vel.x + hit.nx * j, c.vel.y + hit.ny * j, c.vel.z)
    if (-vn < 0.3) continue
    const car = o.car
    const what = car.drive ? 'vehicle' : car.tram ? 'streetcar' : car.robo ? 'robotaxi' : 'car'
    if (!car.drive && !car.tram && !car.chase) {
      car.speed = 0
      if (car.robo) { if (!car.hazard) events.push({ t: 'robotaxiStop', tick, car: o.id, x: round(o.pos.x), y: round(o.pos.y) }); car.hazard = true }
      else if (!car.honked && car.cruise > 0) { car.honked = true; events.push({ t: 'honk', tick, car: o.id, robo: false, x: round(o.pos.x), y: round(o.pos.y) }) }
    }
    if (d.bumpCool === 0) {
      d.bumpCool = Math.round(vt.bumpCooldown * sim.data.physics.tickHz)
      events.push({ t: 'vanBump', tick, car: c.id, what, other: o.id, speed: round(-vn) })
    }
  }
}

/**
 * The story's characters (actors) against the vehicle: solid, a person's radius round (reactions.body). They keep to their
 * paths (game/movers.ts holds them while a vehicle is in the way), so the vehicle is put out of them and
 * the speed into them goes; vanBump {what actor} when it was bumpSpeed or more.
 */
function bumpActors(sim: Sim, c: Thing, vt: VehicleType, events: SimEvent[]) {
  let any = false
  for (const o of sim.world.things) if (o.kind === Kind.actor) { any = true; break }
  if (!any) return
  const D = vt.dims.body, d = c.car!.drive!, r = sim.data.vehicles.reactions.body, tick = sim.world.tick
  const { f, l } = carFrame(c)
  for (const o of sim.world.things) {
    if (o.kind !== Kind.actor || !o.alive || o.actor?.mode === 'ride') continue   // a passenger is inside
    const dx = o.pos.x - c.pos.x, dy = o.pos.y - c.pos.y
    if (abs(dx) > D.length || abs(dy) > D.length || abs(o.pos.z - c.pos.z) > 2.5) continue
    const along = dx * f.x + dy * f.y, across = dx * l.x + dy * l.y
    const px = D.length / 2 + r - abs(along), py = D.width / 2 + r - abs(across)
    if (px <= 0 || py <= 0) continue
    // Out the shallower way: off its nose or tail, or off its side (the normal points from the actor to the vehicle).
    const s = px < py ? (along >= 0 ? -1 : 1) : (across >= 0 ? -1 : 1), ax = px < py ? f : l
    const nx = ax.x * s, ny = ax.y * s, depth = min(px, py)
    c.pos = v3(c.pos.x + nx * depth, c.pos.y + ny * depth, c.pos.z)
    const vn = c.vel.x * nx + c.vel.y * ny
    if (vn >= 0) continue
    const j = -vn * (1 + vt.body.restitution)
    c.vel = v3(c.vel.x + nx * j, c.vel.y + ny * j, c.vel.z)
    if (-vn >= vt.bumpSpeed && d.bumpCool === 0) {
      d.bumpCool = Math.round(vt.bumpCooldown * sim.data.physics.tickHz)
      events.push({ t: 'vanBump', tick, car: c.id, what: 'actor', other: o.id, speed: round(-vn) })
    }
  }
}

/** Is (x, y) inside a vehicle's body grown by r (within 2.5 m of height)? The vehicle, or null (game/movers.ts: an actor holds). */
export function vehicleAt(sim: Sim, x: number, y: number, z: number, r: number): Thing | null {
  for (const c of sim.world.things) {
    if (!isVehicle(c) || abs(c.pos.z - z) > 2.5) continue
    const D = typeOf(sim, c).dims.body, dx = x - c.pos.x, dy = y - c.pos.y
    if (abs(dx) > D.length || abs(dy) > D.length) continue
    const { f, l } = carFrame(c)
    if (abs(dx * f.x + dy * f.y) < D.length / 2 + r && abs(dx * l.x + dy * l.y) < D.width / 2 + r) return c
  }
  return null
}

/**
 * NPC skaters at a vehicle (moving, or stopped with a driver in it): coming at them (within reactions.npcLook seconds of its moving end at
 * its speed, npcLane either side of its body, npcSpeed or faster) they shout (npcShout, once per
 * shoutCooldown); reached (inside its body grown by a person's radius, reactions.body) they jump clear to their side of it,
 * their speed toward it gone (npcDodge).
 */
function reactNpcs(sim: Sim, c: Thing, vt: VehicleType, events: SimEvent[]) {
  const speed = Math.hypot(c.vel.x, c.vel.y)
  let any = false
  for (const o of sim.world.things) if (o.kind === Kind.npc && o.alive) { any = true; break }
  if (!any) return
  const RX = sim.data.vehicles.reactions, D = vt.dims.body, r = RX.body, tick = sim.world.tick, hz = sim.data.physics.tickHz
  const { f, l } = carFrame(c), way = c.vel.x * f.x + c.vel.y * f.y >= 0 ? 1 : -1   // going forward, or backing up
  const look = D.length / 2 + speed * RX.npcLook
  for (const o of sim.world.things) {
    if (o.kind !== Kind.npc || !o.alive || !o.npc) continue
    const dx = o.pos.x - c.pos.x, dy = o.pos.y - c.pos.y
    if (abs(dx) > look + 3 || abs(dy) > look + 3 || abs(o.pos.z - c.pos.z) > 2.5) continue
    const along = dx * f.x + dy * f.y, across = dx * l.x + dy * l.y, ahead = along * way
    const n = o.npc
    if (speed >= RX.npcSpeed && ahead > 0 && ahead < look && abs(across) < D.width / 2 + RX.npcLane && (n.shouted === undefined || tick - n.shouted >= RX.shoutCooldown * hz)) {
      n.shouted = tick
      events.push({ t: 'npcShout', tick, id: o.id, car: c.id, line: RX.npcShouts[(o.id * 7 + tick) % RX.npcShouts.length] })
    }
    if (abs(along) >= D.length / 2 + r || abs(across) >= D.width / 2 + r) continue
    const side = across >= 0 ? 1 : -1, out = D.width / 2 + r + 0.3
    o.pos = v3(c.pos.x + f.x * along + l.x * side * out, c.pos.y + f.y * along + l.y * side * out, o.pos.z)
    const vin = (o.vel.x * l.x + o.vel.y * l.y) * side
    if (vin < 0) o.vel = v3(o.vel.x - l.x * side * vin, o.vel.y - l.y * side * vin, o.vel.z)
    events.push({ t: 'npcDodge', tick, id: o.id, car: c.id })
  }
}

/** For step.ts: the buttons of the skater driving, by player (player 2's skater reads input.b2). */
export function buttonsFor(sim: Sim, input: { b: number; b2?: number }) {
  const p2 = player2(sim)
  return (t: Thing) => (p2 && t === p2.sk ? input.b2 ?? 0 : input.b)
}

const round = (x: number) => Math.round(x * 1000) / 1000
