import { Btn, has, stick, type InputFrame } from '../input.ts'
import { clamp, copy, cos, DEG, dot, len, madd, min, norm, rotateAround, scale, v3, type Vec3 } from '../math.ts'
import { raycast, sphereContacts, Surface, type Contact } from '../park/park.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { State, type Thing } from '../thing.ts'
import { bankCombo } from '../tricks/tricks.ts'
import { endManual } from './combo.ts'
import { moveSphere, type Touch } from './move.ts'

// Off the board (THUG style): step off and carry the board, walk or run, turn, jump, climb
// low ledges, drop down, drop the board and ride off. Spec: docs/mechanics/walk.md.
// The skater's sphere stays the feet: pos is its centre, radius skater.radius above the ground.

const Z = v3(0, 0, 1)
const touches: Touch[] = []
const near: Contact[] = []

const pressed = (t: Thing, f: InputFrame, b: number) => has(f, b) && (t.prevB & b) === 0
/** Anything solid you can stand on (walls' flat tops included, not the invisible boundary). */
const standable = (sim: Sim, tri: number, n: Vec3) => sim.park.cls[tri] !== Surface.none && n.z >= cos(sim.data.physics.walk.maxSlopeDeg * DEG)
const free = (sim: Sim, p: Vec3, r: number) => sphereContacts(sim.park, p, r * 0.95, near).length === 0

/** E on the board (ground only): step off and carry it. Too fast and it is a bail. Returns a bail reason or null. */
export function stepOff(sim: Sim, t: Thing, events: SimEvent[]): string | null {
  const W = sim.data.physics.walk
  const speed = len(t.vel)
  if (speed > W.maxStepOffSpeed) return `stepped off at ${(speed * 3.6).toFixed(0)} km/h`
  if (t.manual) endManual(sim, t, 'step off', events)
  if (t.combo.length || t.landGrace > 0) bankCombo(sim, t, events)
  // Face the way you were going (fakie: the board's tail end).
  const h = v3(t.vel.x, t.vel.y, 0)
  const face = len(h) > 0.3 ? norm(h) : norm(v3(t.fwd.x, t.fwd.y, 0), v3(0, 1, 0))
  t.fwd = face
  t.vel = scale(face, min(len(h), W.runSpeed + 1))
  t.up = copy(Z)
  t.state = State.walk
  t.stateTicks = 0
  t.footAir = false
  t.climb = 0
  t.hang = false
  t.crouch = false
  t.charge = 0
  t.steer = 0; t.lean = 0; t.slip = 0; t.powerslide = 0; t.wobble = 0; t.stumble = 0
  events.push({ t: 'stepOff', tick: sim.world.tick, speed: round(speed) })
  return null
}

/** One tick on foot. */
export function stepWalk(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]) {
  const P = sim.data.physics, W = P.walk, r = P.skater.radius
  const dt = 1 / P.tickHz, tick = sim.world.tick
  t.stateTicks++
  if (t.stumble > 0) t.stumble--

  // Hanging from a ledge, facing the wall: a fresh press of W pulls up (a slower climb), S or K lets
  // go. (W is usually still held from walking off, so holding it does nothing.)
  if (t.hang && t.climb === 0) {
    t.vel = v3()
    if (pressed(t, input, Btn.up)) {
      t.hang = false
      t.climb = t.climbLen = W.pullUpTicks
      t.climbFrom = copy(t.pos)
      t.climbTo = copy(t.hangTop)
      events.push({ t: 'hangEnd', tick, how: 'pull up' })
    } else if (pressed(t, input, Btn.down) || pressed(t, input, Btn.ollie)) {
      t.hang = false
      t.footAir = true
      events.push({ t: 'hangEnd', tick, how: 'let go' })
    }
    return
  }
  // Climbing onto a ledge: up first, then over the edge.
  if (t.climb > 0) {
    t.climb--
    const u = 1 - t.climb / t.climbLen
    const upPart = clamp(u / 0.55, 0, 1), overPart = clamp((u - 0.55) / 0.45, 0, 1)
    t.pos = v3(t.climbFrom.x + (t.climbTo.x - t.climbFrom.x) * overPart, t.climbFrom.y + (t.climbTo.y - t.climbFrom.y) * overPart, t.climbFrom.z + (t.climbTo.z - t.climbFrom.z) * upPart)
    t.vel = v3()
    if (t.climb === 0) { t.pos = copy(t.climbTo); t.footAir = false }
    return
  }

  // Drop the board and ride off (in the air too: a caveman, tricks and grinds open).
  if (pressed(t, input, Btn.walk)) {
    t.state = t.footAir ? State.air : State.ground
    t.stateTicks = 0
    t.popped = false
    t.spin = 0; t.spinVel = 0
    t.up = copy(Z)
    t.load = 1
    t.airPeakZ = t.pos.z
    t.takeoffN = copy(Z)
    events.push({ t: 'boardDrop', tick, speed: round(len(t.vel)), air: t.footAir })
    t.footAir = false
    return
  }

  const st = stick(input)
  const control = t.stumble > 0 ? 0 : 1
  // Turn on the spot or on the move.
  if (st.x !== 0 && control) t.fwd = norm(rotateAround(v3(t.fwd.x, t.fwd.y, 0), Z, -st.x * W.turnRate * dt), t.fwd)
  t.fwd = norm(v3(t.fwd.x, t.fwd.y, 0), v3(0, 1, 0))
  // Run (W), walk (W + Shift), back up (S); feet do not drift sideways.
  const want = !control ? 0 : st.y > 0 ? (has(input, Btn.slide) ? W.walkSpeed : W.runSpeed) : st.y < 0 ? -W.backSpeed : 0
  let s = dot(v3(t.vel.x, t.vel.y, 0), t.fwd)
  if (!t.footAir) {
    const rate = (want !== 0 && Math.sign(want) === Math.sign(s || want) && Math.abs(want) > Math.abs(s) ? W.accel : W.decel) * dt
    s += clamp(want - s, -rate, rate)
  }
  const vz = t.footAir ? t.vel.z - P.gravity * dt : 0
  t.vel = v3(t.fwd.x * s, t.fwd.y * s, vz)
  if (!t.footAir && control && pressed(t, input, Btn.ollie)) {
    t.vel.z = W.jumpSpeed
    t.footAir = true
    events.push({ t: 'jump', tick })
  }

  const start = copy(t.pos)
  const want3 = copy(t.vel)
  moveSphere(sim.park, t.pos, t.vel, dt, r, P.collision, touches)
  if (!t.footAir) {
    // Blocked by a step no higher than stepHeight: lift the feet, move, and let them down onto it.
    const wantMove = len(v3(want3.x, want3.y, 0)) * dt
    const moved = len(v3(t.pos.x - start.x, t.pos.y - start.y, 0))
    if (wantMove > 1e-4 && moved < wantMove * 0.5) {
      const up = v3(start.x, start.y, start.z + W.stepHeight)
      if (free(sim, up, r)) {
        const p = copy(up)
        moveSphere(sim.park, p, v3(want3.x, want3.y, 0), dt, r, P.collision, touches)
        if (len(v3(p.x - start.x, p.y - start.y, 0)) > moved + 1e-4 && settle(sim, p, W.stepHeight + 0.05)) t.pos = p
      }
    }
    // Feet down onto whatever is within a step below them (step edges hold them too).
    if (!settle(sim, t.pos, W.stepHeight)) {   // walked off an edge
      t.footAir = true
      t.vel.z = 0
      if (tryHang(sim, t, start, len(v3(want3.x, want3.y, 0)), events)) return
    }
    // A wall stops the feet, not the runner's intent: keep the running speed (the next tick slides
    // along the wall again, or steps up, or climbs).
    t.vel = v3(want3.x, want3.y, t.vel.z)
  } else {
    // In the air: land on anything standable met from above.
    const land = touches.find((k) => k.n.z >= cos(W.maxSlopeDeg * DEG) && sim.park.cls[k.tri] !== Surface.none)
    if (land && want3.z <= 0) {
      t.footAir = false
      const impact = -want3.z
      t.vel.z = 0
      if (impact > W.hardLandSpeed) { t.stumble = W.stumbleTicks; t.vel = v3() }
      events.push({ t: 'footLand', tick, impact: round(impact) })
    }
  }
  // Climb: pressing forward into a ledge whose top is within climbMax of the feet (a jump reaches higher).
  if (st.y > 0 && control) {
    const wantMove = len(v3(want3.x, want3.y, 0)) * dt
    const moved = len(v3(t.pos.x - start.x, t.pos.y - start.y, 0))
    if (wantMove > 1e-4 && moved < wantMove * 0.5) tryClimb(sim, t, events)
  }
  // Never end a step wedged into geometry (pressing into an acute corner every tick can out-push the
  // push-out): if this tick's move left the feet inside something, stay where they were.
  if (sphereContacts(sim.park, t.pos, r * 0.8, near).length > 0) t.pos = start
  t.stride += len(v3(t.pos.x - start.x, t.pos.y - start.y, 0)) * (t.footAir ? 0 : 1)
  if (!t.footAir) t.safe = copy(t.pos)
}

/**
 * Let the feet sphere down at this spot by up to `drop` metres; true (and p.z set) when it comes to
 * rest on something: a walkable face (within maxSlopeDeg), or an edge or corner (the lip of a
 * step). Straight down, in 1 cm steps refined by bisection, so a step's lip holds the feet
 * (a push-out sweep would slide them back off it).
 */
function settle(sim: Sim, p: Vec3, drop: number): boolean {
  const P = sim.data.physics, r = P.skater.radius, tn = sim.park.tn
  const solid = (z: number) => { sphereContacts(sim.park, v3(p.x, p.y, z), r, near); return near.some((c) => sim.park.cls[c.tri] !== Surface.none) }
  const top = p.z + 0.02
  if (solid(top)) return true   // already pressed against something here: stay
  let free = top, hit = NaN
  for (let z = top - 0.01; z >= p.z - drop - 1e-9; z -= 0.01) { if (solid(z)) { hit = z; break } free = z }
  if (Number.isNaN(hit)) return false
  for (let i = 0; i < 6; i++) { const m = (free + hit) / 2; if (solid(m)) hit = m; else free = m }
  sphereContacts(sim.park, v3(p.x, p.y, hit), r, near)
  const minZ = cos(P.walk.maxSlopeDeg * DEG)
  const ok = near.some((c) => {
    if (sim.park.cls[c.tri] === Surface.none) return false
    const d = Math.max(c.dist, 1e-9), nx = (p.x - c.px) / d, ny = (p.y - c.py) / d, nz = (hit - c.pz) / d
    if (nz < 0.3) return false
    const face = Math.abs(nx * tn[c.tri * 3] + ny * tn[c.tri * 3 + 1] + nz * tn[c.tri * 3 + 2]) > 0.9999
    return !face || nz >= minZ
  })
  if (ok) p.z = free
  return ok
}

/**
 * Walking (not running) off an edge with more than walk.hangMinDrop below: grab it and hang by the
 * hands, turned round to face the wall, the feet walk.hangDepth under the top (or just above the
 * ground on a lower ledge, knees bent). Running off it, you drop. `start` is where the feet were
 * before this tick's move, on or at the lip of the ledge.
 */
function tryHang(sim: Sim, t: Thing, start: Vec3, speed: number, events: SimEvent[]): boolean {
  const W = sim.data.physics.walk, r = sim.data.physics.skater.radius
  const mx = t.pos.x - start.x, my = t.pos.y - start.y, m = Math.hypot(mx, my)
  if (m < 1e-6 || speed > W.hangMaxSpeed) return false
  const dx = mx / m, dy = my / m   // the way off the edge (walking backwards off it works too)
  // The ledge top, a little back from the lip, is where pulling up puts the feet.
  const back = v3(start.x - dx * 0.15, start.y - dy * 0.15, start.z)
  const deck = raycast(sim.park, v3(back.x, back.y, start.z + 0.3), v3(0, 0, -1), 0.6)
  if (!deck || !standable(sim, deck.tri, deck.normal)) return false
  const topZ = deck.point.z, to = v3(back.x, back.y, topZ + r + 0.01)
  // Out from the edge until the hanging body is clear of the wall, with ground below it (not the
  // edge of the world) and a clear way up and back over the lip.
  for (let out = r + 0.02; out < r + 0.6; out += 0.04) {
    const hx = start.x + dx * out, hy = start.y + dy * out
    const below = raycast(sim.park, v3(hx, hy, topZ - 0.05), v3(0, 0, -1), 30)
    if (!below) return false
    const drop = topZ - below.point.z
    if (drop < W.hangMinDrop) return false
    const p = v3(hx, hy, topZ - Math.min(W.hangDepth, drop - 0.1) + r)
    if (!free(sim, p, r)) continue
    // Sampled no further apart than 0.8 r, so a thin sheet (a sidewalk with nothing under it) cannot
    // sit between two samples: with 8 samples a 1.9 m hang checked every 0.24 m, and the pull-up rose
    // through the lab hill's sidewalk (fuzz lab seed 3).
    let clear = true
    const n = Math.max(8, Math.ceil(Math.max(to.z - p.z, Math.hypot(to.x - p.x, to.y - p.y)) / (r * 0.8)))
    for (let k = 1; k <= n && clear; k++) {
      const u = k / n
      clear = free(sim, v3(p.x, p.y, p.z + (to.z - p.z) * u), r) && free(sim, v3(p.x + (to.x - p.x) * u, p.y + (to.y - p.y) * u, to.z), r)
    }
    if (!clear) return false
    t.pos = p
    t.vel = v3()
    t.fwd = v3(-dx, -dy, 0)
    t.hang = true
    t.footAir = false
    t.hangTop = to
    events.push({ t: 'hang', tick: sim.world.tick, drop: round(drop) })
    return true
  }
  return false
}

function tryClimb(sim: Sim, t: Thing, events: SimEvent[]) {
  const W = sim.data.physics.walk, r = sim.data.physics.skater.radius
  const feet = t.pos.z - r
  const ahead = madd(t.pos, t.fwd, r + 0.25)
  const hit = raycast(sim.park, v3(ahead.x, ahead.y, feet + W.climbMax + 0.05), v3(0, 0, -1), W.climbMax + 0.05)
  if (!hit || !standable(sim, hit.tri, hit.normal)) return
  const height = hit.point.z - feet
  if (height <= W.stepHeight * 0.5 || height > W.climbMax) return
  const to = v3(hit.point.x, hit.point.y, hit.point.z + r + 0.01)
  // The whole path must be clear: straight up, then over the edge (a rail overhead blocks it).
  for (let k = 1; k <= 8; k++) {
    const u = k / 8
    if (!free(sim, v3(t.pos.x, t.pos.y, t.pos.z + (to.z - t.pos.z) * u), r)) return
    if (!free(sim, v3(t.pos.x + (to.x - t.pos.x) * u, t.pos.y + (to.y - t.pos.y) * u, to.z), r)) return
  }
  t.climb = t.climbLen = W.climbTicks
  t.climbFrom = copy(t.pos)
  t.climbTo = to
  t.footAir = false
  t.vel = v3()
  events.push({ t: 'climb', tick: sim.world.tick, height: round(height) })
}

const round = (x: number) => Math.round(x * 1000) / 1000
