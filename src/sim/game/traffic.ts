import { atan2, cos, cross, DEG, len, norm, sin, v3, wrapAngle, type Vec3 } from '../math.ts'
import { nextFloat, seedRng } from '../rng.ts'
import { spawn, type Sim, type SimEvent } from '../sim.ts'
import { Kind, State, type Thing } from '../thing.ts'

// Cars and robotaxis on San Francisco's streets, as Things (docs/mechanics/traffic.md). They
// drive the city's street axes (park.traffic) in the right-hand lane, keep their distance, and
// yield to the skater: human drivers stop and honk, robotaxis stop dead with their hazards on. A
// bubble keeps them near the player: a car too far away comes back on a street nearby. Every
// random choice goes through the cars' own stream (world.trafficRng), so traffic replays exactly and
// a bigger street network (each city phase) never moves the skater's or anyone else's draws. Cheap path-followers; only
// cars near the skater collide (src/sim/skater/cars.ts).

/** A draw from the cars' own stream, started from the world's seed the first time traffic needs it. */
const rand = (sim: Sim) => nextFloat(sim.world.trafficRng ??= seedRng((sim.world.seed * 6869 + 59) >>> 0))

/** The skater cars react to: the first one. */
const player = (sim: Sim) => sim.world.things.find((x) => x.kind === Kind.skater && x.alive && x.player !== 2)

export const cars = (sim: Sim) => sim.world.things.filter((x) => x.kind === Kind.car && x.alive && x.car)

/** Car frame: fwd (travel, with the slope), left, up. */
export function carFrame(c: Thing): { f: Vec3; l: Vec3; u: Vec3 } {
  const f = c.fwd
  const l = norm(v3(-f.y, f.x, 0), v3(0, 1, 0))
  return { f, l, u: cross(f, l) }
}

/** Fill a world with traffic around the skater (sf only: no streets, no cars). */
export function spawnTraffic(sim: Sim) {
  const net = sim.park.traffic, T = sim.data.traffic
  if (!net.paths.length) return
  const sk = player(sim)
  const at = sk ? sk.pos : v3()
  for (let i = 0; i < T.cars + T.robotaxis; i++) {
    const c = spawn(sim, Kind.car)
    c.state = State.ground
    const robo = i >= T.cars
    c.car = { path: 0, s: 0, dir: 1, speed: 0, cruise: 0, robo, paint: robo ? -1 : Math.floor(rand(sim) * 10), wait: 0, honked: false, yielding: false, hazard: false, turn: 0 }
    respawn(sim, c, at, T.bubble.spawnNear, T.bubble.spawnFar)
  }
}

function cruiseFor(sim: Sim, kind: string, robo: boolean) {
  const T = sim.data.traffic
  return (T.cruise[kind] ?? T.cruiseDefault) * (1 - T.cruiseJitter + 2 * T.cruiseJitter * rand(sim)) * (robo ? T.roboCruise : 1)
}

/** Put a car somewhere on the streets between near and far metres from p. */
function respawn(sim: Sim, c: Thing, p: Vec3, near: number, far: number) {
  const net = sim.park.traffic, car = c.car!
  // Only the streets that come within far of p, in their order: a street added somewhere else in the
  // city (each city phase adds some) changes nothing about where the cars round the skater go.
  const local: number[] = []
  for (let i = 0; i < net.paths.length; i++) {
    const b = net.paths[i].box
    if (b[0] <= p.x + far && b[2] >= p.x - far && b[1] <= p.y + far && b[3] >= p.y - far) local.push(i)
  }
  const pool = local.length ? local : null
  for (let k = 0; k < 40; k++) {
    const pi = pool ? pool[Math.floor(rand(sim) * pool.length)] : Math.floor(rand(sim) * net.paths.length), path = net.paths[pi]
    const i = Math.floor(rand(sim) * path.points.length), q = path.points[i]
    const d = Math.hypot(q[0] - p.x, q[1] - p.y)
    if (d < near || d > far) continue
    car.path = pi; car.s = path.cum[i]
    car.dir = path.oneway || rand(sim) < 0.5 ? 1 : -1
    car.cruise = cruiseFor(sim, path.kind, car.robo)
    car.speed = car.cruise; car.wait = 0; car.honked = false; car.yielding = false; car.hazard = false
    place(sim, c)
    return
  }
  place(sim, c)
}

/** Pose from the path: the lane right of travel, the slope, the velocity. */
function place(sim: Sim, c: Thing) {
  const net = sim.park.traffic, car = c.car!, L = sim.data.traffic.lane
  const p = net.paths[car.path]
  // The first segment end at or past s (cum never decreases, so a binary search finds the same
  // index the old linear walk did; long avenues have hundreds of points).
  let i = 1, hi = p.cum.length - 1
  while (i < hi) { const m = (i + hi) >> 1; if (p.cum[m] < car.s) i = m + 1; else hi = m }
  const a = p.points[i - 1], b = p.points[i], seg = p.cum[i] - p.cum[i - 1] || 1
  const k = Math.max(0, Math.min(1, (car.s - p.cum[i - 1]) / seg))
  const dx = ((b[0] - a[0]) / seg) * car.dir, dy = ((b[1] - a[1]) / seg) * car.dir, dz = ((b[2] - a[2]) / seg) * car.dir
  const lane = p.oneway ? (p.lanes > 1 ? L.onewayMulti : L.oneway) : p.lanes >= 4 ? L.wide : L.twoWay
  c.pos = v3(a[0] + (b[0] - a[0]) * k + dy * lane, a[1] + (b[1] - a[1]) * k - dx * lane, a[2] + (b[2] - a[2]) * k)
  c.fwd = norm(v3(dx, dy, dz), v3(1, 0, 0))
  c.vel = v3(dx * car.speed, dy * car.speed, dz * car.speed)
  c.up = carFrame(c).u
}

/** At a path's end: on to a street that meets it, else turn around (or wrap a one-way). */
function next(sim: Sim, c: Thing) {
  const net = sim.park.traffic, car = c.car!
  const p = net.paths[car.path]
  const options = car.dir > 0 ? net.exits[car.path].end : net.exits[car.path].start
  if (options.length) {
    const o = options[Math.floor(rand(sim) * options.length)]
    car.path = o.path; car.dir = o.atStart ? 1 : -1; car.s = o.atStart ? 0 : net.paths[o.path].length
    car.cruise = cruiseFor(sim, net.paths[o.path].kind, car.robo)
  } else {
    // A dead end (a stub in the street data): the car leaves and comes back out of sight,
    // instead of reversing on the spot at full speed (it drove into the skater on Valencia).
    const T = sim.data.traffic, sk = player(sim)
    respawn(sim, c, sk ? sk.pos : c.pos, T.bubble.respawnNear, T.bubble.respawnFar)
    car.turn = 0
  }
}

// Car following without the all-pairs scan: a grid of the cars' tick-start positions, cells
// follow.range + JUMP + 1 wide, plus the cars that jumped more than JUMP metres this tick (a
// respawn, a dead end, a path change). A car within follow.range of c on both axes either moved
// at most JUMP since the tick began, so it sits in c's 3x3 cells, or it jumped and is in `jumped`.
// The candidates are a superset of the old scan's and the same range test picks among them, and
// Math.min ignores order and repeats, so `want` is the same number (decisions.md, phase 9). The
// grid is an open-addressed table of cells, each a list of indices into this tick's cars; all of
// it is scratch, rebuilt every call, never world state.
const JUMP = 4
let slots = 0, cellHead = new Int32Array(0), cellX = new Int32Array(0), cellY = new Int32Array(0), carNext = new Int32Array(0)
const jumped: Thing[] = []
let riderX = new Float64Array(0), riderY = new Float64Array(0), riderW = new Float64Array(0), riderL = new Float64Array(0)

/** The table slot of cell (ix, iy): its own, or the empty one where it would go. */
function slotOf(ix: number, iy: number): number {
  let s = (Math.imul(ix, 0x9e3779b1) ^ Math.imul(iy, 0x85ebca6b)) & (slots - 1)
  while (cellHead[s] >= 0 && (cellX[s] !== ix || cellY[s] !== iy)) s = (s + 1) & (slots - 1)
  return s
}

/** Every car into its cell by its tick-start position. The table stays at most a quarter full. */
function buildGrid(all: Thing[], cell: number) {
  const n = all.length
  if (slots < 4 * n) {
    slots = 1 << (32 - Math.clz32(4 * n - 1))
    cellHead = new Int32Array(slots); cellX = new Int32Array(slots); cellY = new Int32Array(slots)
  }
  if (carNext.length < n) carNext = new Int32Array(2 * n)
  cellHead.fill(-1)
  for (let i = 0; i < n; i++) {
    const ix = Math.floor(all[i].pos.x / cell), iy = Math.floor(all[i].pos.y / cell)
    const s = slotOf(ix, iy)
    if (cellHead[s] < 0) { cellX[s] = ix; cellY[s] = iy }
    carNext[i] = cellHead[s]; cellHead[s] = i
  }
}

/** One tick for every car. Runs before the skater, so the skater meets this tick's cars. */
export function stepTraffic(sim: Sim, events: SimEvent[]) {
  const all = cars(sim)
  if (!all.length) return
  const T = sim.data.traffic, dt = 1 / sim.data.physics.tickHz, hz = sim.data.physics.tickHz, tick = sim.world.tick
  const sk = player(sim)
  const cell = T.follow.range + JUMP + 1
  buildGrid(all, cell)
  jumped.length = 0
  // Drivers yield to every skater on the street: the player and the NPC skaters, and to a vehicle
  // someone drives (game/vehicles.ts), whose lane and stopping room grow by its half width and length
  // (the skater in it does not count twice). Nobody rides during this loop, so their positions are read once.
  const riders = sim.world.things.filter((t) => t.alive && ((t === sk && t.drive === undefined) || (t.kind === Kind.npc && t.npc) || (t.kind === Kind.car && t.car?.drive && t.car.drive.driver >= 0)))
  if (riderX.length < riders.length) { riderX = new Float64Array(2 * riders.length); riderY = new Float64Array(2 * riders.length); riderW = new Float64Array(2 * riders.length); riderL = new Float64Array(2 * riders.length) }
  for (let i = 0; i < riders.length; i++) {
    riderX[i] = riders[i].pos.x; riderY[i] = riders[i].pos.y
    const D = riders[i].car?.drive ? sim.data.vehicles.types[riders[i].car!.drive!.type].dims.body : null
    riderW[i] = D ? D.width / 2 : 0; riderL[i] = D ? D.length / 2 : 0
  }
  const near = T.yield.ahead + 30, half = T.bubble.far / 2
  for (const c of all) {
    const car = c.car!, x0 = c.pos.x, y0 = c.pos.y
    if (car.tram || car.chase || car.drive) continue   // the Muni streetcar, the escape's robotaxi and the vehicles drive themselves (game/muni.ts, escape.ts, vehicles.ts); the others still keep their distance from them
    // Within half the bubble on both axes the distance is under it: no hypot needed for most cars.
    if (sk && !(Math.abs(x0 - sk.pos.x) <= half && Math.abs(y0 - sk.pos.y) <= half) && Math.hypot(c.pos.x - sk.pos.x, c.pos.y - sk.pos.y) > T.bubble.far) { respawn(sim, c, sk.pos, T.bubble.respawnNear, T.bubble.respawnFar); car.turn = 0; noteJump(c, x0, y0); continue }
    const fx = c.fwd.x, fy = c.fwd.y, fl = Math.hypot(fx, fy) || 1
    const hx = fx / fl, hy = fy / fl
    // The skater in the lane ahead: slow, stop short of them.
    let want = car.cruise, blocked = false
    for (let ri = 0; ri < riders.length; ri++) {
      if (Math.abs(riderX[ri] - x0) > near + riderL[ri] || Math.abs(riderY[ri] - y0) > near + riderL[ri]) continue   // far away (cheap with several skaters)
      const sk = riders[ri], wide = riderW[ri], long = riderL[ri]
      if (sk.carRide === c.id) continue
      // Where the skater is, and, if they are in front or beside the lane (crossing), where they will
      // be in yield.look seconds. Not for a skater behind (overtaking) or over the roof.
      const ax = sk.pos.x - c.pos.x, ay = sk.pos.y - c.pos.y
      const inFront = ax * hx + ay * hy > T.body.length / 2 - 0.5 - long, beside = Math.abs(-ax * hy + ay * hx) >= T.yield.side + wide
      for (const k of inFront || beside ? [0, T.yield.look] : [0]) {
        const sx = sk.pos.x + sk.vel.x * k - c.pos.x, sy = sk.pos.y + sk.vel.y * k - c.pos.y
        const ahead = sx * hx + sy * hy, side = Math.abs(-sx * hy + sy * hx)
        // Ahead of the bumper, not over the roof (landing on a car is not a reason to brake).
        if (ahead > T.body.length / 2 - 0.5 - long && ahead < T.yield.ahead + long && side < T.yield.side + wide && Math.abs(sk.pos.z - c.pos.z) < T.yield.height) {
          blocked = true
          // Human drivers brake to stop yield.stop short of you (v = sqrt(2 a d)); robotaxis stop dead.
          want = car.robo ? 0 : Math.min(want, Math.sqrt(2 * T.yield.decel * Math.max(0, ahead - long - T.yield.stop)))
        }
      }
    }
    // Keep the distance to cars ahead in the lane.
    const cx = Math.floor(x0 / cell), cy = Math.floor(y0 / cell)
    for (let ix = cx - 1; ix <= cx + 1; ix++) {
      for (let iy = cy - 1; iy <= cy + 1; iy++) {
        for (let j = cellHead[slotOf(ix, iy)]; j >= 0; j = carNext[j]) want = follow(T, c, all[j], hx, hy, want)
      }
    }
    for (const o of jumped) want = follow(T, c, o, hx, hy, want)
    if (blocked && !car.yielding && car.robo && car.speed > 1) events.push({ t: 'robotaxiStop', tick, car: c.id, x: round(c.pos.x), y: round(c.pos.y) })
    car.yielding = blocked
    // Someone on the bumper: a robotaxi slows politely to a stop and waits, hazards on, until they let go.
    const politeStop = car.robo && sk?.skitch?.car === c.id
    if (politeStop) want = 0
    const brake = politeStop ? T.skitch.roboDecel : car.robo && blocked ? T.roboBrake : T.brake
    car.speed += Math.max(-brake * dt, Math.min(T.accel * dt, want - car.speed))
    if (car.speed < 0.3 && blocked) car.wait++
    else if (car.speed >= 0.3) { car.wait = 0; car.honked = false }
    if (blocked && !car.honked && car.cruise > 0 && car.wait > (car.robo ? T.roboHonkAfter : T.honkAfter) * hz) {   // parked cars have no driver
      car.honked = true
      events.push({ t: 'honk', tick, car: c.id, robo: car.robo, x: round(c.pos.x), y: round(c.pos.y) })
    }
    car.hazard = politeStop || (car.robo && car.wait > T.hazardAfter * hz)
    car.s += car.speed * dt * car.dir
    const p = sim.park.traffic.paths[car.path]
    if (car.s > p.length || car.s < 0) next(sim, c)
    const h0 = atan2(c.fwd.y, c.fwd.x)
    place(sim, c)
    car.turn = wrapAngle(atan2(c.fwd.y, c.fwd.x) - h0)
    noteJump(c, x0, y0)
  }
}

/** Car c (heading hx, hy) behind car o in its lane: the speed that keeps follow.gap, if lower than want. */
export function follow(T: Sim['data']['traffic'], c: Thing, o: Thing, hx: number, hy: number, want: number): number {
  if (o === c) return want
  // An oncoming car is the car ahead for only one of the two. One-way streets drive the centre line
  // (lane.oneway 0), so where two run head-on into the same junction (Duboce at Valencia, both
  // turning there) the first two cars stopped nose to nose for good and the street behind them jammed.
  // The older car (lower id) goes first; the other waits for it as for a car ahead.
  if (c.id < o.id && o.fwd.x * c.fwd.x + o.fwd.y * c.fwd.y < 0) return want
  const ox = o.pos.x - c.pos.x, oy = o.pos.y - c.pos.y
  if (ox > T.follow.range || ox < -T.follow.range || oy > T.follow.range || oy < -T.follow.range) return want
  const oa = ox * hx + oy * hy, os = Math.abs(-ox * hy + oy * hx)
  if (oa > 0 && oa < T.follow.range && os < T.follow.side) return Math.min(want, Math.sqrt(2 * T.yield.decel * Math.max(0, oa - T.follow.gap)) + Math.min(carSpeed(o), c.car!.cruise) * 0.5)
  return want
}

/** A car that moved more than JUMP on either axis this tick (or to or from NaN) leaves the grid's reach. */
function noteJump(c: Thing, x0: number, y0: number) {
  if (!(Math.abs(c.pos.x - x0) <= JUMP && Math.abs(c.pos.y - y0) <= JUMP)) jumped.push(c)
}

/**
 * Dev and test command: a car on the street lane nearest (x, y), driving the way closest to the
 * heading (degrees clockwise from north), at `speed` (its cruise) or the street's own cruise.
 */
export function placeCar(sim: Sim, x: number, y: number, heading: number, speed: number | undefined, robo: boolean): Thing {
  const net = sim.park.traffic
  if (!net.paths.length) throw new Error('car: this world has no streets (try park sf)')
  let best = { path: 0, s: 0, d: Infinity, dir: 1 }
  const hx = sin(heading * DEG), hy = cos(heading * DEG)
  net.paths.forEach((p, pi) => {
    for (let i = 1; i < p.points.length; i++) {
      const a = p.points[i - 1], b = p.points[i], ex = b[0] - a[0], ey = b[1] - a[1], l2 = ex * ex + ey * ey || 1
      const k = Math.max(0, Math.min(1, ((x - a[0]) * ex + (y - a[1]) * ey) / l2))
      const d = Math.hypot(a[0] + ex * k - x, a[1] + ey * k - y)
      const dir = ex * hx + ey * hy >= 0 ? 1 : -1
      // Never against a one-way: on a divided street (two one-way carriageways) take the one the heading drives.
      if (p.oneway && dir < 0) continue
      if (d < best.d) best = { path: pi, s: p.cum[i - 1] + Math.sqrt(l2) * k, d, dir }
    }
  })
  const c = spawn(sim, Kind.car)
  c.state = State.ground
  const cruise = speed ?? cruiseFor(sim, net.paths[best.path].kind, robo)
  c.car = { path: best.path, s: best.s, dir: best.dir, speed: cruise, cruise, robo, paint: robo ? -1 : 0, wait: 0, honked: false, yielding: false, hazard: false, turn: 0 }
  place(sim, c)
  return c
}

/** Dev and test command: no traffic (the drivable vehicles stay: game/vehicles.ts). */
export function clearTraffic(sim: Sim) { sim.world.things = sim.world.things.filter((x) => x.kind !== Kind.car || !!x.car?.drive) }

/** How fast a car moves (m/s): its velocity's length. */
export const carSpeed = (c: Thing) => len(c.vel)

const round = (x: number) => Math.round(x * 1000) / 1000
