import { atan2, cos, sin, v3, DEG } from '../math.ts'
import { raycast, type Park } from '../park/park.ts'
import { nextFloat, seedRng } from '../rng.ts'
import { spawn, type Sim, type SimEvent } from '../sim.ts'
import { startBail } from '../skater/skater.ts'
import { loseCombo } from '../tricks/tricks.ts'
import { Kind, State, type Thing } from '../thing.ts'
import { drivenBy, typeOf } from './vehicles.ts'
import { carFrame } from './traffic.ts'

// Pedestrians (docs/mechanics/peds.md; data/peds.json): Things of kind 'ped' walking the city's
// sidewalks near the player. They walk lines offset from the curbs onto the sidewalk, come back
// near the player when left far behind, block like a soft cylinder (a bail if you hit one fast,
// a swerve when slow), step aside when they see you coming, and a close pass at speed is a NEAR
// MISS. Every random choice is on their own stream (world.pedRng), so with no walkers the player's
// game is exactly as before. Started by the command `ped spawn [n]`.

const rand = (sim: Sim) => nextFloat(sim.world.pedRng!)
const CELL = 40   // the curb-point grid for finding sidewalks near a place
const MOVES = 3   // walkers sent back near the player per tick, at most

/** A walk line: a curb's points moved onto its sidewalk side; x, y, z per point and the arc length. */
type Walk = { xyz: Float64Array; cum: Float64Array; length: number }
/** A park's sidewalks, worked out on first use (scratch, not world state: a pure function of the park). */
type PedNet = { curbs: number[]; walks: (Walk | null | undefined)[]; grid: Map<number, number[]>; offset: number }
const nets = new WeakMap<Park, PedNet>()
const cellKey = (ix: number, iy: number) => ix * 65536 + iy

function netOf(sim: Sim): PedNet {
  const park = sim.park, offset = sim.data.peds.offset
  let net = nets.get(park)
  if (net && net.offset === offset) return net
  // The curbs are the export's own lines (curb_*); the grid holds [curb, point] pairs per cell.
  const curbs = park.grind.filter((l) => l.element.startsWith('curb_')).map((l) => l.id)
  const grid = new Map<number, number[]>()
  curbs.forEach((id, k) => park.grind[id].points.forEach((p, i) => {
    const key = cellKey(Math.floor(p.x / CELL), Math.floor(p.y / CELL))
    let b = grid.get(key)
    if (!b) grid.set(key, (b = []))
    b.push(k, i)
  }))
  net = { curbs, walks: [], grid, offset }
  nets.set(park, net)
  return net
}

/** The sidewalk side of curb k (ground there is sidewalk, at a few points along it) and its walk line, or null. */
function walkOf(sim: Sim, net: PedNet, k: number): Walk | null {
  const known = net.walks[k]
  if (known !== undefined) return known
  const pts = sim.park.grind[net.curbs[k]].points, n = pts.length
  const side = (x: number, y: number, z: number) => {
    const h = raycast(sim.park, v3(x, y, z + 2), v3(0, 0, -1), 5)
    return h ? sim.park.elements[sim.park.elem[h.tri]].collection : ''
  }
  let sign = 0
  for (const f of [0.5, 0.25, 0.75]) {
    const i = Math.min(n - 2, Math.max(0, Math.floor(f * (n - 1)))), a = pts[i], b = pts[i + 1]
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / L, ny = (b.x - a.x) / L
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, mz = (a.z + b.z) / 2
    const left = side(mx + nx * net.offset, my + ny * net.offset, mz) === 'city_sidewalk'
    const right = side(mx - nx * net.offset, my - ny * net.offset, mz) === 'city_sidewalk'
    if (left !== right) { sign = left ? 1 : -1; break }
  }
  if (!sign || n < 2) return (net.walks[k] = null)
  // Each point moved off the curb along the averaged normal of its segments.
  const xyz = new Float64Array(n * 3), cum = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)]
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1
    xyz[i * 3] = pts[i].x - ((b.y - a.y) / L) * net.offset * sign
    xyz[i * 3 + 1] = pts[i].y + ((b.x - a.x) / L) * net.offset * sign
    xyz[i * 3 + 2] = pts[i].z
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(xyz[i * 3] - xyz[i * 3 - 3], xyz[i * 3 + 1] - xyz[i * 3 - 2])
  }
  const w = { xyz, cum, length: cum[n - 1] }
  return (net.walks[k] = w.length >= 5 ? w : null)
}

/** Sidewalk points between near and far metres of (x, y), in a fixed order: [curb, point] pairs. */
function candidates(sim: Sim, net: PedNet, x: number, y: number, near: number, far: number): number[] {
  const out: number[] = []
  for (let ix = Math.floor((x - far) / CELL); ix <= Math.floor((x + far) / CELL); ix++) {
    for (let iy = Math.floor((y - far) / CELL); iy <= Math.floor((y + far) / CELL); iy++) {
      const b = net.grid.get(cellKey(ix, iy))
      if (!b) continue
      for (let j = 0; j < b.length; j += 2) {
        const p = sim.park.grind[net.curbs[b[j]]].points[b[j + 1]], d = Math.hypot(p.x - x, p.y - y)
        if (d >= near && d <= far) out.push(b[j], b[j + 1])
      }
    }
  }
  return out
}

// ---- Spawning ----

const player = (sim: Sim) => sim.world.things.find((t) => t.kind === Kind.skater && t.alive && t.player !== 2)

/** `ped spawn [n]`: walkers on sidewalks around the player (data peds.count). Returns how many. */
export function spawnPeds(sim: Sim, n?: number): number {
  const P = sim.data.peds
  if (!P.parks.includes(sim.park.name)) throw new Error(`no pedestrians in ${sim.park.name} (data/peds.json parks: ${P.parks.join(', ')})`)
  if (!P.enabled) return 0
  if (!sim.world.pedRng) sim.world.pedRng = seedRng((sim.world.seed * 6151 + 101) >>> 0)
  const sk = player(sim), at = sk ? sk.pos : v3()
  const count = n ?? P.count
  for (let k = 0; k < count; k++) {
    const t = spawn(sim, Kind.ped)
    t.state = State.walk
    t.ped = { curb: -1, s: 0, dir: 1, speed: 0, look: Math.floor(rand(sim) * 1000), side: 0, to: 0, stagger: 0, close: 99, cool: 0, phone: false, act: 'walk', since: sim.world.tick }
    respawn(sim, t, at.x, at.y)
  }
  return count
}

export function clearPeds(sim: Sim) { sim.world.things = sim.world.things.filter((t) => t.kind !== Kind.ped) }

/** Onto a sidewalk between spawnNear and spawnFar of (x, y); none there: out of the world until there is. */
function respawn(sim: Sim, t: Thing, x: number, y: number) {
  const P = sim.data.peds, net = netOf(sim), n = t.ped!
  const pairs = candidates(sim, net, x, y, P.spawnNear, P.spawnFar)
  for (let tries = 0; tries < 8 && pairs.length; tries++) {
    const j = Math.floor(rand(sim) * (pairs.length / 2)) * 2
    const w = walkOf(sim, net, pairs[j])
    if (!w) continue
    n.curb = pairs[j]; n.s = w.cum[pairs[j + 1]]
    n.dir = rand(sim) < 0.5 ? 1 : -1
    n.speed = P.walk[0] + (P.walk[1] - P.walk[0]) * rand(sim)
    n.phone = rand(sim) < P.phone
    n.side = 0; n.to = 0; n.stagger = 0; n.close = 99; n.cool = 0; n.act = 'walk'; n.since = sim.world.tick
    t.alive = true
    place(sim, t, w)
    return
  }
  n.curb = -1
  t.alive = false
}

/** Dev and test command `ped at x y heading [phone]`: a walker on the sidewalk nearest (x, y), walking the way nearest heading. */
export function placePed(sim: Sim, x: number, y: number, heading: number, phone: boolean): Thing {
  const P = sim.data.peds
  if (!P.parks.includes(sim.park.name)) throw new Error(`no pedestrians in ${sim.park.name}`)
  if (!sim.world.pedRng) sim.world.pedRng = seedRng((sim.world.seed * 6151 + 101) >>> 0)
  const net = netOf(sim)
  let best = { k: -1, s: 0, d: Infinity, dir: 1 }
  const hx = sin(heading * DEG), hy = cos(heading * DEG)
  const pairs = candidates(sim, net, x, y, 0, 30)
  const seen = new Set<number>()
  for (let j = 0; j < pairs.length; j += 2) {
    if (seen.has(pairs[j])) continue
    seen.add(pairs[j])
    const w = walkOf(sim, net, pairs[j])
    if (!w) continue
    for (let i = 1; i < w.cum.length; i++) {
      const ax = w.xyz[i * 3 - 3], ay = w.xyz[i * 3 - 2], ex = w.xyz[i * 3] - ax, ey = w.xyz[i * 3 + 1] - ay, l2 = ex * ex + ey * ey || 1
      const u = Math.max(0, Math.min(1, ((x - ax) * ex + (y - ay) * ey) / l2)), d = Math.hypot(ax + ex * u - x, ay + ey * u - y)
      if (d < best.d) best = { k: pairs[j], s: w.cum[i - 1] + Math.sqrt(l2) * u, d, dir: ex * hx + ey * hy >= 0 ? 1 : -1 }
    }
  }
  if (best.k < 0) throw new Error(`ped: no sidewalk within 30 m of ${x} ${y}`)
  const t = spawn(sim, Kind.ped)
  t.state = State.walk
  t.ped = { curb: best.k, s: best.s, dir: best.dir, speed: (P.walk[0] + P.walk[1]) / 2, look: Math.floor(rand(sim) * 1000), side: 0, to: 0, stagger: 0, close: 99, cool: 0, phone, act: 'walk', since: sim.world.tick }
  place(sim, t, walkOf(sim, net, best.k)!)
  return t
}

/** Pose from the walk line: the point at s, side metres to the left of the walking direction, feet on it. */
function place(sim: Sim, t: Thing, w: Walk) {
  const n = t.ped!
  const m = w.cum.length
  let i = 1, hi = m - 1
  while (i < hi) { const mid = (i + hi) >> 1; if (w.cum[mid] < n.s) i = mid + 1; else hi = mid }
  const seg = w.cum[i] - w.cum[i - 1] || 1, u = Math.max(0, Math.min(1, (n.s - w.cum[i - 1]) / seg))
  const ax = w.xyz[i * 3 - 3], ay = w.xyz[i * 3 - 2], az = w.xyz[i * 3 - 1]
  const tx = ((w.xyz[i * 3] - ax) / seg) * n.dir, ty = ((w.xyz[i * 3 + 1] - ay) / seg) * n.dir
  t.pos = v3(ax + (w.xyz[i * 3] - ax) * u - ty * n.side, ay + (w.xyz[i * 3 + 1] - ay) * u + tx * n.side, az + (w.xyz[i * 3 + 2] - az) * u)
  t.fwd = v3(tx, ty, 0)
  t.up = v3(0, 0, 1)
  t.vel = n.stagger > 0 ? v3() : v3(tx * n.speed, ty * n.speed, 0)
}

// ---- Each tick ----

/** One tick for every walker: walk, see the player coming, step aside, meet the player. After the skaters. */
export function stepPeds(sim: Sim, events: SimEvent[]) {
  let any = false
  for (const t of sim.world.things) if (t.kind === Kind.ped) { any = true; break }
  if (!any) return
  const P = sim.data.peds, hz = sim.data.physics.tickHz, dt = 1 / hz, tick = sim.world.tick, r = sim.data.physics.skater.radius
  const sk = player(sim), net = netOf(sim)
  // Driving (game/vehicles.ts): they see the vehicle coming and give it room for its half width more.
  const van = sk ? drivenBy(sim, sk) : null, half = van ? typeOf(sim, van).dims.body.width / 2 : 0, long = van ? typeOf(sim, van).dims.body.length / 2 : 0
  let moves = 0   // at most MOVES walkers come back near the player per tick (a teleport sends them all at once)
  for (const t of sim.world.things) {
    if (t.kind !== Kind.ped || !t.ped) continue
    const n = t.ped
    if (!t.alive) {
      // Out of the world (no sidewalk near the player when it last looked): look again now and then.
      if (sk && (tick + t.id) % 60 === 0 && moves++ < MOVES) respawn(sim, t, sk.pos.x, sk.pos.y)
      continue
    }
    if (sk && Math.hypot(t.pos.x - sk.pos.x, t.pos.y - sk.pos.y) > P.despawn && moves++ < MOVES) { respawn(sim, t, sk.pos.x, sk.pos.y); continue }
    const w = walkOf(sim, net, n.curb)!
    if (n.cool > 0) n.cool--
    if (n.stagger > 0) {
      if (--n.stagger === 0) { n.act = 'walk'; n.since = tick }   // back up
      place(sim, t, w)
      continue
    }
    if (sk) see(sim, t, sk, events, half, long)
    // Walk on (back the other way at a line's end), and step toward the side they want to be on.
    n.s += n.speed * dt * n.dir
    if (n.s > w.length) { n.s = w.length; n.dir = -1; n.side = -n.side; n.to = -n.to }
    else if (n.s < 0) { n.s = 0; n.dir = 1; n.side = -n.side; n.to = -n.to }
    const step = P.see.stepSpeed * dt
    n.side += Math.max(-step, Math.min(step, n.to - n.side))
    place(sim, t, w)
    if (van) meetVehicle(sim, t, van, events)
    else if (sk) meet(sim, t, sk, r, events)
  }
}

/**
 * Coming at them fast, closing within see.time and passing within see.clear, in their view: step aside;
 * once you are by, back. half: half the width of the vehicle you drive (0 on the board): they see it
 * pass that much wider and see.vehicle more, and step that much further; long: half its length (it
 * is by once that much further off).
 */
function see(sim: Sim, t: Thing, sk: Thing, events: SimEvent[], half = 0, long = 0) {
  const P = sim.data.peds, n = t.ped!
  const rx = t.pos.x - sk.pos.x, ry = t.pos.y - sk.pos.y, vx = sk.vel.x, vy = sk.vel.y, v2 = vx * vx + vy * vy
  const tca = v2 > 1e-6 ? (rx * vx + ry * vy) / v2 : -1   // seconds to the closest approach (negative: going away)
  if (n.to !== 0) {
    if (tca < 0 && Math.hypot(rx, ry) > 3 + long) { n.to = 0; n.act = 'walk'; n.since = sim.world.tick }   // you are by (a vehicle's length by): back onto the line
    return
  }
  if (n.phone || sk.state === State.bail || sk.state === State.walk || v2 < P.see.speed * P.see.speed || tca <= 0 || tca > P.see.time) return
  const cx = rx - vx * tca, cy = ry - vy * tca
  if (Math.hypot(cx, cy) > P.see.clear + (half ? half + P.see.vehicle : 0)) return
  // In their view: the skater within fov/2 of where they face (from right behind they do not see you).
  const ang = Math.abs(atan2(t.fwd.x * -ry - t.fwd.y * -rx, t.fwd.x * -rx + t.fwd.y * -ry)) / DEG
  if (ang > P.see.fov / 2) return
  // Away from your path: the side of it they are on (straight ahead of you: their left).
  const lx = -t.fwd.y, ly = t.fwd.x
  const away = (Math.abs(cx) + Math.abs(cy) > 1e-3 ? cx * lx + cy * ly : 1) >= 0 ? 1 : -1
  n.to = Math.max(-P.see.maxSide - half, Math.min(P.see.maxSide + half, n.side + away * (P.see.aside + half)))
  n.act = 'aside'; n.since = sim.world.tick
  events.push({ t: 'pedStep', tick: sim.world.tick, id: t.id, side: Math.round(n.to * 100) / 100 })
}

/** The player against a walker: a hit (a bail when fast, a swerve when slow), or a close pass at speed (a near miss). */
function meet(sim: Sim, t: Thing, sk: Thing, r: number, events: SimEvent[]) {
  const P = sim.data.peds, n = t.ped!, tick = sim.world.tick
  const dx = sk.pos.x - t.pos.x, dy = sk.pos.y - t.pos.y, d = Math.hypot(dx, dy)
  if (d > P.nearMiss.distance + 2) { if (n.close < 99) nearMiss(sim, t, sk, events); return }
  if (sk.state === State.bail || n.cool > 0) return
  const feet = sk.pos.z - r, over = feet > t.pos.z + P.height, under = sk.pos.z + r < t.pos.z
  const speed = Math.hypot(sk.vel.x, sk.vel.y)
  if (d < P.radius + r && !over && !under) {
    n.close = 99
    n.cool = Math.round(P.cooldown * sim.data.physics.tickHz)
    if (speed > P.hitSpeed && sk.state !== State.walk) {
      loseCombo(sim, sk, events)
      startBail(sk, 'ran into a pedestrian', tick, events)
      n.stagger = Math.round(P.stagger * sim.data.physics.tickHz)
      n.act = 'down'; n.since = tick
      events.push({ t: 'pedHit', tick, id: t.id, speed: Math.round(speed * 1000) / 1000, bail: true })
      return
    }
    // Slow: swerve off them, out of the cylinder, the speed into them gone and some of the rest.
    const ux = d > 1e-6 ? dx / d : -t.fwd.x, uy = d > 1e-6 ? dy / d : -t.fwd.y
    sk.pos = v3(t.pos.x + ux * (P.radius + r), t.pos.y + uy * (P.radius + r), sk.pos.z)
    const into = sk.vel.x * ux + sk.vel.y * uy
    const keep = sk.state === State.walk ? 1 : P.swerveKeep
    sk.vel = v3((sk.vel.x - (into < 0 ? into : 0) * ux) * keep, (sk.vel.y - (into < 0 ? into : 0) * uy) * keep, sk.vel.z)
    events.push({ t: 'pedHit', tick, id: t.id, speed: Math.round(speed * 1000) / 1000, bail: false })
    return
  }
  if (sk.state === State.walk) return
  if (speed >= P.nearMiss.speed && d < P.nearMiss.distance) n.close = Math.min(n.close, d)
  else if (n.close < 99 && d > P.nearMiss.distance + 0.3) nearMiss(sim, t, sk, events)
}

/**
 * The player's vehicle at a walker (game/vehicles.ts): within its body (grown by the walker's radius),
 * the walker jumps clear to the side of it they are on, at once, as far as it takes, and keeps clear
 * while they walk past it. Nobody is hurt and nothing scores: no near miss, no hit.
 */
function meetVehicle(sim: Sim, t: Thing, c: Thing, events: SimEvent[]) {
  const P = sim.data.peds, n = t.ped!, D = typeOf(sim, c).dims.body, RX = sim.data.vehicles.reactions
  const { f, l } = carFrame(c), dx = t.pos.x - c.pos.x, dy = t.pos.y - c.pos.y
  const along = dx * f.x + dy * f.y, across = dx * l.x + dy * l.y
  if (Math.abs(t.pos.z - c.pos.z) > 2.5) return
  const ox = Math.abs(along) - (D.length / 2 + P.radius), oy = Math.abs(across) - (D.width / 2 + P.radius)
  if (ox > 0 || oy > 0) {
    // Clear of it: a close pass at speed is a near miss, and they say so.
    if (Math.hypot(Math.max(0, ox), Math.max(0, oy)) < RX.nearMiss && Math.hypot(c.vel.x, c.vel.y) >= RX.nearMissSpeed) shout(sim, t, c, true, events)
    return
  }
  // Their own left (the walk line's): the side of the van's middle line they are on, measured in theirs.
  const lx = -t.fwd.y, ly = t.fwd.x, side = (across >= 0 ? 1 : -1) * (l.x * lx + l.y * ly >= 0 ? 1 : -1)
  const need = D.width / 2 + P.radius + 0.2 - Math.abs(across)
  n.to = n.side = Math.max(-P.see.maxSide - D.width / 2, Math.min(P.see.maxSide + D.width / 2, n.side + side * need))
  place(sim, t, walkOf(sim, netOf(sim), n.curb)!)
  shout(sim, t, c, false, events)
  // Every tick they are in its way they stay clear of it (walking round it); the step itself is news once.
  if (n.act === 'aside') return
  n.act = 'aside'; n.since = sim.world.tick
  events.push({ t: 'pedStep', tick: sim.world.tick, id: t.id, side: Math.round(n.to * 100) / 100 })
}

/** A walker shouts at a vehicle (near: a near miss; else it jumped clear of it): a line by its id and the tick, once per shoutCooldown. */
function shout(sim: Sim, t: Thing, c: Thing, near: boolean, events: SimEvent[]) {
  const RX = sim.data.vehicles.reactions, n = t.ped!, tick = sim.world.tick
  if (n.shouted !== undefined && tick - n.shouted < RX.shoutCooldown * sim.data.physics.tickHz) return
  n.shouted = tick
  events.push({ t: 'pedShout', tick, id: t.id, car: c.id, line: RX.pedShouts[(t.id * 7 + tick) % RX.pedShouts.length], near })
}

/** A close pass is over: NEAR MISS, into the combo like a gap (it banks on its own if nothing else is open). */
function nearMiss(sim: Sim, t: Thing, sk: Thing, events: SimEvent[]) {
  const P = sim.data.peds, n = t.ped!
  const close = n.close
  n.close = 99
  n.cool = Math.round(P.cooldown * sim.data.physics.tickHz)
  if (sk.state === State.bail || sk.state === State.walk) return
  // The same walker pays again only after nearMiss.again seconds (circling one was a farm).
  const tick = sim.world.tick
  if (n.missed !== undefined && tick - n.missed < P.nearMiss.again * sim.data.physics.tickHz) return
  n.missed = tick
  sk.combo.push({ id: 'nearmiss', name: 'NEAR MISS', points: P.nearMiss.points })
  if (sk.state === State.ground && sk.landGrace === 0 && !sk.manual) sk.landGrace = sim.data.physics.combo.graceTicks
  events.push({ t: 'nearMiss', tick: sim.world.tick, id: t.id, points: P.nearMiss.points, distance: Math.round(close * 100) / 100 })
}
