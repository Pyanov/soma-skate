import type { Traffic as TrafficData } from '../sim/data.ts'
import type { Thing } from '../sim/thing.ts'
import { raycast, sphereContacts, type Contact, type Park } from '../sim/park/park.ts'

// Cameras step once per sim tick, so the same replay gives the same camera and
// screenshots are repeatable. A camera with no history starts at its target pose.

export type V = { x: number; y: number; z: number }
/** lens: how far into a trick camera's shot (the director's weight, 0..1): the renderer's fisheye goes from the chase camera's to the trick cameras'. */
export type CamPose = { pos: V; look: V; fov: number; lens?: number }
export type CamMode = 'chase' | 'top' | 'side' | 'quarter' | 'orbit'
export const CAM_MODES: CamMode[] = ['chase', 'top', 'side', 'quarter', 'orbit']

/** data/camera.json; main loads it once (Cam.setData) and every camera uses it. */
export type CameraData = {
  chase: { dist: number; height: number; lookAhead: number; lookHeight: number; fov: number; follow: number; aim: number; turn: number
    fast: { from: number; to: number; dist: number; height: number; lookAhead: number; fov: number }; air: { height: number; dist: number } }
  collide: { margin: number; minDist: number; clearance: number; probe: number; lifts: number[]; swing: number[]; cars?: number; carRange?: number; rails?: number }
  kick: { land: number; bail: number; decay: number; dip?: number; dipTicks?: number; stepRate?: number }
  special: { dist: number; height: number; side: number; inRate: number; outRate: number }
  /** Narrow spaces (stairwells, alleys, between columns): how open it is round the skater and the lens. */
  tight?: { probeHeight: number; reach: number; narrow: number; open: number; rate: number; dist: number; height: number; fovKick: number; lookDown: number; openWidth: number }
  /** Long grinds and rails: a slight side angle from the approach side, then back behind. */
  grind?: { after: number; side: number; lift: number; inRate: number; outRate: number; turn: number }
  /** Vert airs: back and up so the landing stays in frame, then recover. */
  vert?: { dist: number; height: number; look: number; inRate: number; outRate: number }
  /** Hill bombs: lower and wider, and less lag, between from and to m/s. */
  bomb?: { from: number; to: number; dist: number; height: number; lookHeight: number; fov: number; follow: number; aim: number; turn: number; rate: number; shake?: [number, number, number] }
  /** A goal: a brief push in toward the skater (dist as a fraction, fov degrees narrower) over ticks. */
  punch?: { ticks: number; dist: number; fov: number }
  /** Driving a vehicle (the skater in state 'drive', at the seat): further back and higher, growing with speed. */
  drive?: { dist: number; height: number; lookAhead: number; lookHeight: number; fov: number; fast: { from: number; to: number; dist: number; height: number; lookAhead: number; fov: number } }
}
let D: CameraData = {
  chase: { dist: 4.6, height: 2.0, lookAhead: 1.5, lookHeight: 0.7, fov: 62, follow: 0.12, aim: 0.25, turn: 0.06,
    fast: { from: 5, to: 15, dist: 0, height: 0, lookAhead: 0, fov: 0 }, air: { height: 0, dist: 0 } },
  collide: { margin: 0.3, minDist: 1.0, clearance: 0.6, probe: 0.12, lifts: [0], swing: [0] },
  kick: { land: 0, bail: 0, decay: 0.86 },
  special: { dist: 1, height: 1, side: 0, inRate: 0.1, outRate: 0.05 },
}

/**
 * A moving box the camera sees past and keeps out of like park geometry (a car): the bottom centre,
 * the heading (unit, horizontal), half length, half width and height.
 */
export type CamBox = { x: number; y: number; z: number; fx: number; fy: number; hl: number; hw: number; h: number }

const RAIL_CELL = 8   // m, the camera's grid of rail segments

/** The sim's cars within collide.carRange of a point, as camera boxes (a robotaxi's roof sensor included). */
export function carBoxes(things: readonly Thing[], T: TrafficData, near: V): CamBox[] {
  const range = D.collide.carRange ?? 30, out: CamBox[] = []
  for (const c of things) {
    // Not the drivable vehicles (their size is theirs, data/vehicles.json): the one you drive has the camera's eye inside it.
    if (c.kind !== 'car' || !c.alive || !c.car || c.car.drive) continue
    if (Math.abs(c.pos.x - near.x) > range || Math.abs(c.pos.y - near.y) > range) continue
    const l = Math.hypot(c.fwd.x, c.fwd.y) || 1
    out.push({ x: c.pos.x, y: c.pos.y, z: c.pos.z + T.body.bottom, fx: c.fwd.x / l, fy: c.fwd.y / l, hl: T.body.length / 2, hw: T.body.width / 2, h: Math.max(T.body.top, T.cabin.top) + (c.car.robo ? 0.35 : 0) - T.body.bottom })
  }
  return out
}

/** Entry distance of a ray into a box grown by pad, within len (null: misses, or starts inside). */
function rayBox(o: V, d: V, b: CamBox, len: number, pad: number): number | null {
  const rx = o.x - b.x, ry = o.y - b.y
  const axes: [number, number, number][] = [
    [rx * b.fx + ry * b.fy, d.x * b.fx + d.y * b.fy, b.hl + pad],
    [-rx * b.fy + ry * b.fx, -d.x * b.fy + d.y * b.fx, b.hw + pad],
    [o.z - b.z - b.h / 2, d.z, b.h / 2 + pad],
  ]
  let t0 = 0, t1 = len
  for (const [p, q, h] of axes) {
    if (Math.abs(q) < 1e-9) { if (Math.abs(p) > h) return null; continue }
    const a = (-h - p) / q, c = (h - p) / q
    t0 = Math.max(t0, Math.min(a, c)); t1 = Math.min(t1, Math.max(a, c))
    if (t0 > t1) return null
  }
  return t0 > 0 ? t0 : null
}

/** Move a point out to r from a box: off its sides or top (never down through the road). */
function outOfBox(c: V, b: CamBox, r: number): V {
  const rx = c.x - b.x, ry = c.y - b.y
  let a = rx * b.fx + ry * b.fy, s = -rx * b.fy + ry * b.fx, z = c.z - b.z
  const qa = Math.max(-b.hl, Math.min(b.hl, a)), qs = Math.max(-b.hw, Math.min(b.hw, s)), qz = Math.max(0, Math.min(b.h, z))
  const ea = a - qa, es = s - qs, ez = z - qz, dist = Math.hypot(ea, es, ez)
  if (dist >= r) return c
  if (dist > 1e-6) { a = qa + (ea / dist) * r; s = qs + (es / dist) * r; z = qz + (ez / dist) * r }
  else {
    // Inside: out through the nearest side or the roof.
    const faces: [number, () => void][] = [
      [b.hl - a, () => { a = b.hl + r }], [a + b.hl, () => { a = -b.hl - r }],
      [b.hw - s, () => { s = b.hw + r }], [s + b.hw, () => { s = -b.hw - r }], [b.h - z, () => { z = b.h + r }],
    ]
    faces.reduce((m, f) => (f[0] < m[0] ? f : m))[1]()
  }
  return { x: b.x + a * b.fx - s * b.fy, y: b.y + a * b.fy + s * b.fx, z: b.z + z }
}

export class Cam {
  static setData(d: CameraData) { D = d }
  /** Player setting: chase distance and height scale (1 = data/camera.json). */
  static zoom = 1
  /** Player setting: the chase camera's height on its own (Settings > Camera > Height). */
  static lift = 1
  /** The ceiling over a point inside a room whose ceiling the collision lacks (interiors.ts: the city's rooms), else null. */
  static ceilingAt: ((x: number, y: number, z: number) => number | null) | null = null
  /** Settings > Camera > Reduce motion: no landing or bail shake, no goal punch-in, no special swing, and only calmFov of the field-of-view changes. */
  static calm = false
  static calmFov = 0.3
  /** Trick ids that get the special cam (data/tricks.json specials). */
  static specials = new Set<string>()
  private specialK = 0
  mode: CamMode = 'chase'
  /** Park to keep the camera out of (optional: no park, no collision). */
  park: Park | null = null
  /** Moving obstacles this tick (the sim's cars near the skater: carBoxes); main and clips fill it before step(). */
  obstacles: CamBox[] = []
  private dir = { x: 0, y: 1 }
  private shake = 0
  private ticks = 0
  private airK = 0
  private tightK = 0   // 0 open .. 1 narrow, round the skater (smoothed)
  private grindK = 0   // the grind's side angle, eased in and out
  private grindSide = 0   // +1: the camera swings right of the way it goes (the approach side), -1 left
  private vertK = 0
  private bombK = 0
  /** This tick's factors (for strips, clips and tests): narrow, grind side, vert pull, bomb. */
  get feel() { return { tight: this.tightK, grind: this.grindK, vert: this.vertK, bomb: this.bombK } }
  pose: CamPose | null = null
  prev: CamPose | null = null

  private punchT = -1   // ticks into a goal's punch-in, -1 none
  /** A goal completed: a brief, subtle push in toward the skater (the camera keeps following; play on). */
  punch() { if (!Cam.calm) this.punchT = 0 }
  /** The punch's strength now: in fast, held, out slower (0 when none). */
  private get punchK() {
    const P = D.punch
    if (!P || this.punchT < 0 || this.punchT >= P.ticks) return 0
    const u = this.punchT / P.ticks
    return u < 0.25 ? Math.sin((u / 0.25) * Math.PI / 2) : 0.5 + 0.5 * Math.cos(((u - 0.25) / 0.75) * Math.PI)
  }

  /**
   * A landing or a bail: a short vertical shake, deterministic per tick; a landing also dips the camera (the filmer's
   * knees taking it: down fast, back up slower; kick.dip metres at scale 1, deepest after dipTicks).
   */
  kick(kind: 'land' | 'bail', scale = 1) {
    if (Cam.calm) return
    this.shake = Math.max(this.shake, D.kick[kind] * scale)
    if (kind === 'land' && D.kick.dip) { const a = D.kick.dip * Math.min(1.5, scale); if (a > this.dipNow()) { this.dipA = a; this.dipT = 0 } }
  }
  private dipA = 0
  private dipT = -1
  private dipApplied = 0
  /** A step the board took in one tick (a curb hop, a kerb): the camera's height eases over it (a spring, ω stepRate). */
  private stepZ = 0
  private stepV = 0
  private lastZ: number | null = null
  /** The dip's depth now (m, positive down): a fast fall to dipA at dipTicks, then an easy return. */
  private dipNow() { const T = D.kick.dipTicks ?? 9; if (this.dipT < 0) return 0; const u = this.dipT / T; return this.dipA * u * Math.exp(1 - u) }

  private target(t: Thing): CamPose {
    const p = t.pos
    if (this.mode === 'top') return { pos: { x: p.x, y: p.y - 0.01, z: p.z + 22 }, look: { ...p }, fov: 55 }
    if (this.mode === 'side') {
      const sx = this.dir.y, sy = -this.dir.x
      return { pos: { x: p.x + sx * 5, y: p.y + sy * 5, z: p.z + 0.8 }, look: { x: p.x, y: p.y, z: p.z + 0.5 }, fov: 50 }
    }
    if (this.mode === 'quarter') {
      // Three-quarter front view: the side camera swung 40 degrees ahead of the skater.
      const sx = this.dir.y, sy = -this.dir.x, c = Math.cos(0.7), s = Math.sin(0.7)
      const vx = sx * c + this.dir.x * s, vy = sy * c + this.dir.y * s
      return { pos: { x: p.x + vx * 4.6, y: p.y + vy * 4.6, z: p.z + 1.3 }, look: { x: p.x, y: p.y, z: p.z + 0.5 }, fov: 50 }
    }
    // Chase: further back, higher and wider as speed builds; lifted in the air; closer, higher and
    // with less of a speed kick in narrow spaces; back and up in a vert air; lower, wider and tighter
    // at bombing speed; swung a little to the side on a long grind.
    const C = D.chase, F = C.fast, T = D.tight, G = D.grind, V = D.vert, B = D.bomb
    const hs = Math.hypot(t.vel.x, t.vel.y)
    // Driving (the seat moves with the vehicle): the drive camera, behind and above it; none of the skating moods.
    const DR = t.state === 'drive' ? D.drive : undefined
    const kd = DR ? Math.max(0, Math.min(1, (hs - DR.fast.from) / (DR.fast.to - DR.fast.from))) : 0
    const k = Math.max(0, Math.min(1, (hs - F.from) / (F.to - F.from)))
    const tk = T ? this.tightK : 0, vk = V ? this.vertK : 0, bk = B ? this.bombK : 0
    // Special cam: in close and a little to the side while a special trick runs.
    const S = D.special, sk = Cam.calm ? 0 : this.specialK
    const pk = this.punchK
    const dist = DR ? (DR.dist + DR.fast.dist * kd) * Cam.zoom : (C.dist + F.dist * k + C.air.dist * this.airK + (V?.dist ?? 0) * vk + (B?.dist ?? 0) * bk) * Cam.zoom * (1 - (1 - S.dist) * sk) * (1 - (T?.dist ?? 0) * tk) * (1 - (D.punch?.dist ?? 0) * pk)
    const height = DR ? (DR.height + DR.fast.height * kd) * (0.5 + Cam.zoom * 0.5) * Cam.lift : (C.height + F.height * k + C.air.height * this.airK + (V?.height ?? 0) * vk + (B?.height ?? 0) * bk + (T?.height ?? 0) * tk + (G?.lift ?? 0) * this.grindK) * (0.5 + Cam.zoom * 0.5) * Cam.lift * (1 - (1 - S.height) * sk)
    const ahead = DR ? DR.lookAhead + DR.fast.lookAhead * kd : (C.lookAhead + F.lookAhead * k) * (1 - sk) * (1 - vk)
    const lookH = DR ? DR.lookHeight : C.lookHeight + (B?.lookHeight ?? 0) * bk - (T?.lookDown ?? 0) * tk + (V?.look ?? 0) * vk
    const look = { x: p.x + this.dir.x * ahead, y: p.y + this.dir.y * ahead, z: p.z + lookH * (1 - sk) + 0.6 * sk }
    // Where round the skater it sits: behind, swung by the special cam and the grind's side angle.
    const baseDeg = DR ? 0 : S.side * sk + (G?.side ?? 0) * this.grindK * this.grindSide
    const at = (lift: number, deg: number) => {
      const a = ((baseDeg + deg) * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
      const bx = -this.dir.x * c + this.dir.y * s, by = -this.dir.y * c - this.dir.x * s
      return { x: p.x + bx * dist, y: p.y + by * dist, z: p.z + height + lift }
    }
    let pos = at(0, 0)
    if (this.park) {
      this.eye = { x: p.x + t.up.x * 0.9, y: p.y + t.up.y * 0.9, z: p.z + t.up.z * 0.9 }
      // Something between camera and skater (a low wall, a ledge behind)? Rise over it first, like
      // THPS, and at each height swing round the skater (a column right behind). Prefer a spot in the
      // open (not down in a stairwell or between two walls): the lowest clear one with room either
      // side; failing that, the lowest clear one; failing that, slide in from the highest try.
      const L = D.collide.lifts
      let found: V | null = null, firstClear: V | null = null
      for (const lift of L) {
        for (const deg of D.collide.swing) {
          const cand = at(lift, deg)
          if (this.blocked(cand)) continue
          if (!firstClear) firstClear = cand
          if (!T || this.widthAt(cand) >= T.openWidth) { found = cand; break }
        }
        if (found) break
      }
      pos = found ?? firstClear ?? this.unblocked(at(L[L.length - 1], 0))
      // A raised camera aims nearer the skater so they stay in frame.
      const rise = Math.max(0, pos.z - (p.z + height))
      const w = rise / (rise + 2.5)
      look.x += (p.x - look.x) * w; look.y += (p.y - look.y) * w; look.z += (p.z + 0.4 - look.z) * w
    }
    const fk = Cam.calm ? Cam.calmFov : 1
    if (DR) return { pos, look, fov: DR.fov + DR.fast.fov * kd * fk }
    return { pos, look, fov: C.fov + (F.fov * k * (1 - (T?.fovKick ?? 0) * tk) + (B?.fov ?? 0) * bk) * fk - (D.punch?.fov ?? 0) * pk }
  }

  /**
   * How wide the space is at a point, across the way the camera looks: the distances to the first
   * wall left and right (each at most tight.reach), so 2 x reach in the open, small between walls.
   */
  private widthAt(c: V): number {
    const R = D.tight?.reach ?? 4, sx = this.dir.y, sy = -this.dir.x
    let w = 0
    for (const sg of [1, -1]) {
      const d = { x: sx * sg, y: sy * sg, z: 0 }
      const hit = this.park ? raycast(this.park, c, d, R) : null
      w += hit && !this.seeThrough(hit.tri) ? hit.t : R
    }
    return w
  }

  private eye: V = { x: 0, y: 0, z: 0 }   // where line-of-sight tests start: 0.9 m off the surface the skater is on

  private blocked(want: V): boolean {
    const o = this.eye
    const dx = want.x - o.x, dy = want.y - o.y, dz = want.z - o.z, len = Math.hypot(dx, dy, dz)
    return this.firstHit(o, { x: dx / len, y: dy / len, z: dz / len }, len + D.collide.margin) !== null
  }

  /**
   * Distance along the line of sight to the first geometry, by a ray (thin walls) and a
   * swept sphere (fences are separate bars a ray slips between).
   */
  private firstHit(o: V, d: V, len: number): number | null {
    const park = this.park!
    // The invisible boundary wall keeps the skater in; the camera may look in over it.
    let from = 0, best: number | null = null
    for (let k = 0; k < 4; k++) {
      const ray = raycast(park, { x: o.x + d.x * from, y: o.y + d.y * from, z: o.z + d.z * from }, d, len - from)
      if (!ray) break
      if (!this.seeThrough(ray.tri)) { best = from + ray.t; break }
      from += ray.t + 0.01
    }
    const r = D.collide.probe
    for (let s = 0.5; s < (best ?? len); s += r * 1.5) {
      if (sphereContacts(park, { x: o.x + d.x * s, y: o.y + d.y * s, z: o.z + d.z * s }, r, this.contacts).some((c) => !this.seeThrough(c.tri))) { best = s; break }
    }
    // Cars: a box grown by the probe radius (the eye on a car's roof starts inside none).
    for (const b of this.obstacles) {
      const t = rayBox(o, d, b, best ?? len, r)
      if (t !== null && (best === null || t < best)) best = t
    }
    // A room's ceiling the collision has no faces for (the city's rooms): the line of sight stops under it, so the
    // camera neither rises through it to clear a wall behind nor sits above the roof.
    const top = Cam.ceilingAt?.(o.x, o.y, o.z)
    if (top != null && d.z > 1e-4) { const t = Math.max(0, (top - 0.3 - o.z) / d.z); if (t < (best ?? len)) best = t }
    return best
  }

  private seeThrough(tri: number) { return this.park!.elements[this.park!.elem[tri]].collection === 'boundary' }

  /** Another camera's spot (the trick director's shots): whether geometry or a car is between it and the skater. */
  blockedFrom(t: Thing, want: V): boolean {
    if (!this.park) return false
    this.eye = { x: t.pos.x + t.up.x * 0.9, y: t.pos.y + t.up.y * 0.9, z: t.pos.z + t.up.z * 0.9 }
    return this.blocked(want)
  }

  /** Another camera's spot kept out of the park, the cars and the rails like this camera's own (slid in toward the skater). */
  clearFor(t: Thing, want: V): V {
    if (!this.park) return want
    this.eye = { x: t.pos.x + t.up.x * 0.9, y: t.pos.y + t.up.y * 0.9, z: t.pos.z + t.up.z * 0.9 }
    return this.unblocked(want)
  }

  /** Slide the camera in toward the skater when park geometry is between them. */
  private unblocked(want: V): V {
    if (!this.park) return want
    const o = this.eye
    const dx = want.x - o.x, dy = want.y - o.y, dz = want.z - o.z
    const len = Math.hypot(dx, dy, dz)
    if (len < 1e-6) return want
    const d = { x: dx / len, y: dy / len, z: dz / len }
    const hit = this.firstHit(o, d, len + D.collide.margin)
    const t = hit !== null ? Math.max(D.collide.minDist, hit - D.collide.margin) : len
    const c = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }
    const top = Cam.ceilingAt?.(o.x, o.y, o.z)
    if (top != null) c.z = Math.min(c.z, top - 0.3)
    // Keep a clearance sphere: a column or wall just beside the lens fills the frame.
    const r = D.collide.clearance
    for (let i = 0; i < 3; i++) {
      const near = sphereContacts(this.park, c, r, this.contacts).filter((x) => !this.seeThrough(x.tri))
      if (!near.length) break
      const q = near[0], ex = c.x - q.px, ey = c.y - q.py, ez = c.z - q.pz, el = Math.hypot(ex, ey, ez) || 1
      c.x = q.px + (ex / el) * r; c.y = q.py + (ey / el) * r; c.z = q.pz + (ez / el) * r
    }
    return this.clearOfCars(c)
  }

  /** Keep collide.cars metres from every car: one beside the lens fills the frame. */
  private clearOfCars(c: V): V {
    const r = D.collide.cars ?? 1.5
    for (let i = 0; i < 2; i++) for (const b of this.obstacles) c = outOfBox(c, b, r)
    return this.clearOfRails(c)
  }

  /**
   * Handrails are draw-only (the skater grinds their lines), so the line of sight never meets
   * them: following a grind down a stair rail, the camera sat a few centimetres under the rail
   * behind the skater and the rail filled the top of the frame. Within collide.rails metres of a
   * rail line (kind rail) sideways, the camera rises to that far above it.
   */
  private clearOfRails(c: V): V {
    const r = D.collide.rails ?? 0
    if (!this.park || r <= 0) return c
    const segs = this.railSegs()
    const key = (x: number, y: number) => `${Math.floor(x / RAIL_CELL)},${Math.floor(y / RAIL_CELL)}`
    const list = segs.get(key(c.x, c.y))
    if (!list) return c
    for (const [a, b] of list) {
      const ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey
      const u = l2 > 1e-9 ? Math.max(0, Math.min(1, ((c.x - a.x) * ex + (c.y - a.y) * ey) / l2)) : 0
      const qx = a.x + ex * u, qy = a.y + ey * u, qz = a.z + (b.z - a.z) * u
      if (Math.hypot(c.x - qx, c.y - qy) < r && c.z < qz + r && c.z > qz - 2.5) c = { ...c, z: qz + r }
    }
    return c
  }

  /** The park's rail segments in a grid of RAIL_CELL m (each listed in every cell it comes within reach of). */
  private railSegs(): Map<string, [V, V][]> {
    if (this.railGrid && this.railGridPark === this.park) return this.railGrid
    const g = new Map<string, [V, V][]>(), pad = (D.collide.rails ?? 0) + 0.01
    for (const rl of this.park!.rails) {
      if (rl.kind !== 'rail') continue
      for (let i = 0; i + 1 < rl.points.length; i++) {
        const a = rl.points[i], b = rl.points[i + 1]
        const x0 = Math.floor((Math.min(a.x, b.x) - pad) / RAIL_CELL), x1 = Math.floor((Math.max(a.x, b.x) + pad) / RAIL_CELL)
        const y0 = Math.floor((Math.min(a.y, b.y) - pad) / RAIL_CELL), y1 = Math.floor((Math.max(a.y, b.y) + pad) / RAIL_CELL)
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`
          const l = g.get(k); if (l) l.push([a, b]); else g.set(k, [[a, b]])
        }
      }
    }
    this.railGrid = g; this.railGridPark = this.park
    return g
  }
  private railGrid: Map<string, [V, V][]> | null = null
  private railGridPark: Park | null = null
  private contacts: Contact[] = []

  /** One tick. Direction follows horizontal velocity when moving, else the board. */
  step(t: Thing, snap = false) {
    const hs = Math.hypot(t.vel.x, t.vel.y)
    const facing = (() => { const l = Math.hypot(t.fwd.x, t.fwd.y); return l > 0.2 ? { x: t.fwd.x / l, y: t.fwd.y / l } : this.dir })()
    // On foot the camera follows where the skater faces (backing up does not swing it round).
    const src = t.state === 'walk' ? facing : hs > 1.2 ? { x: t.vel.x / hs, y: t.vel.y / hs } : facing
    // Only re-aim while rolling on gentle ground, grinding or on foot; on vert walls and in the air the
    // camera holds its direction so it never swings around mid-trick.
    const steady = t.state === 'walk' || t.state === 'grind' ? false : t.state !== 'ground' || t.up.z < 0.5
    this.airK += ((t.state === 'air' ? 1 : 0) - this.airK) * 0.05
    const special = !!t.trick && Cam.specials.has(t.trick.id) && t.state === 'air'
    this.specialK += ((special ? 1 : 0) - this.specialK) * (special ? D.special.inRate : D.special.outRate)
    // The feel: narrow spaces, the grind's side angle, the vert pull, the bomb.
    const T = D.tight, G = D.grind, V = D.vert, B = D.bomb
    const ease = (v: number, want: number, inR: number, outR: number) => v + (want - v) * (want > v ? inR : outR)
    if (this.mode === 'chase' && this.park && T) {
      const h = T.probeHeight, eye = { x: t.pos.x + t.up.x * h, y: t.pos.y + t.up.y * h, z: t.pos.z + t.up.z * h }
      const w = this.widthAt(eye), want = 1 - Math.max(0, Math.min(1, (w - T.narrow) / (T.open - T.narrow)))
      this.tightK = snap ? want : this.tightK + (want - this.tightK) * T.rate
    } else this.tightK = 0
    const g = t.state === 'grind' ? t.grind : null
    const grinding = !!g && g.ticks > (G?.after ?? 30)
    if (g && G) this.grindSide = g.far * (g.speed >= 0 ? 1 : -1) > 0 ? 1 : -1   // the far side left of the way it goes: the camera goes right
    this.grindK = snap ? 0 : G ? ease(this.grindK, grinding ? 1 : 0, G.inRate, G.outRate) : 0
    this.vertK = snap ? (t.state === 'air' && t.vertAir ? 1 : 0) : V ? ease(this.vertK, t.state === 'air' && t.vertAir ? 1 : 0, V.inRate, V.outRate) : 0
    const bombWant = B ? Math.max(0, Math.min(1, (hs - B.from) / (B.to - B.from))) * (t.state === 'ground' || t.state === 'air' ? 1 : 0) : 0
    this.bombK = snap ? bombWant : this.bombK + (bombWant - this.bombK) * (B?.rate ?? 0.05)
    if (snap) this.specialK = 0
    if (snap) this.punchT = -1
    else if (this.punchT >= 0 && ++this.punchT >= (D.punch?.ticks ?? 0)) this.punchT = -1
    if (snap) { this.dir = src; this.airK = t.state === 'air' ? 1 : 0 }
    else if (!steady) {
      const bk = this.bombK
      const k = t.state === 'grind' && G ? G.turn : D.chase.turn + ((B?.turn ?? D.chase.turn) - D.chase.turn) * bk
      const x = this.dir.x + (src.x - this.dir.x) * k, y = this.dir.y + (src.y - this.dir.y) * k
      const l = Math.hypot(x, y) || 1
      this.dir = { x: x / l, y: y / l }
    }
    const want = this.target(t)
    // A sudden small rise or drop on the ground (a curb hop, a kerb: centimetres in a tick) is taken out of the
    // camera's target and let back in by a critically damped spring, so the frame floats over the step.
    const onGround = t.state === 'ground' || t.state === 'air'   // manuals are ground with a manual on; air: the ledge pop sets the skater onto a ledge in one tick
    if (snap || this.lastZ === null || !onGround) { if (snap) { this.stepZ = 0; this.stepV = 0 } }
    else { const dz = t.pos.z - this.lastZ - t.vel.z / 120; if (Math.abs(dz) > 0.03 && Math.abs(dz) < 0.45) this.stepZ += dz }   // beyond what its velocity explains (hills are not steps)
    this.lastZ = t.pos.z
    if (this.stepZ !== 0) {
      const w = D.kick.stepRate ?? 14, dt = 1 / 120
      this.stepV += (-2 * w * this.stepV - w * w * this.stepZ) * dt; this.stepZ += this.stepV * dt
      if (Math.abs(this.stepZ) < 1e-4 && Math.abs(this.stepV) < 1e-3) { this.stepZ = 0; this.stepV = 0 }
      want.pos.z -= this.stepZ; want.look.z -= this.stepZ
    }
    this.prev = this.pose
    this.ticks++
    if (!this.pose || snap) { this.pose = want; this.prev = want; this.shake = 0; this.dipT = -1; this.dipApplied = 0; return }
    const lp = (a: V, b: V, k: number) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z + (b.z - a.z) * k })
    const C = D.chase, bk = this.bombK
    const follow = C.follow + ((B?.follow ?? C.follow) - C.follow) * bk, aim = C.aim + ((B?.aim ?? C.aim) - C.aim) * bk
    // The smoothing runs on the undipped pose (the dip is added on top each tick, not smoothed into the follow).
    const dz = this.dipApplied, base = dz ? { pos: { ...this.pose.pos, z: this.pose.pos.z + dz }, look: { ...this.pose.look, z: this.pose.look.z + dz * 0.75 } } : this.pose
    this.pose = { pos: lp(base.pos, want.pos, follow), look: lp(base.look, want.look, aim), fov: this.pose.fov + (want.fov - this.pose.fov) * (this.punchT >= 0 ? 0.3 : 0.05) }
    // The camera lags its target, and cars move: a car driving into the lagging camera pushes it
    // aside (or up) rather than filling the frame.
    if (this.park) this.pose.pos = this.clearOfCars(this.pose.pos)
    if (this.shake > 0.002) {
      this.pose.pos.z += Math.sin(this.ticks * 1.9) * this.shake
      this.pose.look.z += Math.sin(this.ticks * 1.9 + 0.6) * this.shake * 0.6
      this.shake *= D.kick.decay
    } else this.shake = 0
    // At the top speeds a very slight, quick tremor (bomb.shake: from, to m/s, metres at full): the board on rough asphalt.
    const BS = D.bomb?.shake, ks = BS && !Cam.calm && t.state === 'ground' ? Math.max(0, Math.min(1, (hs - BS[0]) / (BS[1] - BS[0]))) : 0
    const tremor = ks > 0 ? ks * BS![2] * (0.6 * Math.sin(this.ticks * 2.7) + 0.4 * Math.sin(this.ticks * 4.3 + 1.3)) : 0
    this.dipApplied = this.dipNow() + tremor
    if (this.dipApplied) { this.pose.pos.z -= this.dipApplied; this.pose.look.z -= this.dipApplied * 0.75 }
    if (this.dipT >= 0 && ++this.dipT > (D.kick.dipTicks ?? 9) * 8) this.dipT = -1
  }

  /** Pose between the last two ticks for smooth frames. */
  at(alpha: number): CamPose | null {
    if (!this.pose) return null
    const a = this.prev ?? this.pose, b = this.pose
    const lp = (p: V, q: V) => ({ x: p.x + (q.x - p.x) * alpha, y: p.y + (q.y - p.y) * alpha, z: p.z + (q.z - p.z) * alpha })
    // lens 0: the filmer's camera (the renderer's chase fisheye); poses without lens (menus, turntables) get none.
    return { pos: lp(a.pos, b.pos), look: lp(a.look, b.look), fov: b.fov, lens: 0 }
  }
}
