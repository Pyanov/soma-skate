import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { raycast, type Park } from '../sim/park/park.ts'

// Spectators: a few skaters and watchers sitting on the park's ledges, legs over the edge, heads
// following the skater, who throw their arms up when a big combo lands near them. View only:
// seats come from the park's ledges and copings (the same every load), the figures are instanced
// low-poly parts in the characters' kit (googly eyes, round heads), and the pose is a pure function
// of the tick, the skater and the last landed combo, so shots and clips show the same thing as play.

export type SpectatorData = {
  max: number            // at most this many
  spacing: number        // metres between any two
  kinds: string[]        // park rail kinds they sit on (the city's ledges and curbs are not in the list)
  step: number           // metres between the seats tried along a rail
  depth: number          // metres of flat top a seat needs behind the edge
  drop: [number, number] // how far the legs hang over the edge, metres (min, max)
  cheer: { points: number; near: number; bigPoints: number; bigNear: number; ticks: number }
  seed: number
  shirts: string[]; pants: string[]; skins: string[]; hairs: string[]; hats: string[]; decks: string[]
  /** More watchers on steps somewhere (the city's EMB steps): seats found in a circle, facing one way. */
  areas?: SeatArea[]
}
/** Steps to sit on: within r metres of at, facing (down the steps), a tread depth metres deep with the next one drop metres lower; up to max, spacing apart. */
export type SeatArea = { label?: string; at: [number, number]; r: number; facing: [number, number]; depth: number; drop: [number, number]; max: number; spacing: number }

export type Seat = { x: number; y: number; z: number; heading: number; drop: number; rail: string }
/** The last landed combo: when, how big, and where the skater was. */
export type Landed = { tick: number; points: number; x: number; y: number; z: number }

const down = { x: 0, y: 0, z: -1 }
const groundAt = (park: Park, x: number, y: number, z: number) => raycast(park, { x, y, z: z + 2.5 }, down, 6)

/**
 * Seats along the park's ledges and copings: a flat top on one side (the seat, depth metres of it)
 * and a drop on the other (feet on the ground below a low ledge, legs hanging over a high one); then
 * the seats furthest from each other are kept, up to max. Ledges are grind lines too: a fan leans
 * back out of the way when the skater comes through (update).
 */
export function spectatorSeats(park: Park, d: SpectatorData): Seat[] {
  const cands: Seat[] = []
  for (const r of park.rails) {
    if (!d.kinds.includes(r.kind)) continue
    let along = 0
    for (let i = 1; i < r.points.length; i++) {
      const a = r.points[i - 1], b = r.points[i]
      const len = Math.hypot(b.x - a.x, b.y - a.y)
      if (len < 1e-3) continue
      const tx = (b.x - a.x) / len, ty = (b.y - a.y) / len, nx = -ty, ny = tx
      for (let s = (d.step - (along % d.step)) % d.step; s <= len; s += d.step) {
        const px = a.x + tx * s, py = a.y + ty * s, pz = a.z + (b.z - a.z) * (s / len)
        const near = [1, -1].map((side) => groundAt(park, px + nx * side * 0.3, py + ny * side * 0.3, pz))
        const far = [1, -1].map((side) => groundAt(park, px + nx * side * d.depth, py + ny * side * d.depth, pz))
        for (const side of [1, -1]) {
          const k = side > 0 ? 0 : 1, top = near[k], back = far[k], low = near[1 - k]
          // The seat: flat ground level with the edge for a body's depth behind it.
          if (!top || !back || top.normal.z < 0.92 || back.normal.z < 0.92) continue
          if (Math.abs(top.point.z - pz) > 0.12 || Math.abs(back.point.z - pz) > 0.15) continue
          const drop = pz - (low ? low.point.z : pz - 9)
          if (drop < d.drop[0] || drop > d.drop[1]) continue
          // In front: flat ground for the feet (not a ramp under the legs), and more park beyond
          // (an outer edge with nothing past it faces out of the park).
          const feet = groundAt(park, px - nx * side * 0.6, py - ny * side * 0.6, pz), beyond = groundAt(park, px - nx * side * 2.5, py - ny * side * 2.5, pz)
          if (!low || low.normal.z < 0.9 || !feet || feet.normal.z < 0.9 || Math.abs(feet.point.z - low.point.z) > 0.1 || !beyond) continue
          cands.push({ x: px + nx * side * 0.08, y: py + ny * side * 0.08, z: top.point.z, heading: Math.atan2(-ny * side, -nx * side), drop, rail: r.id })
        }
      }
      along += len
    }
  }
  if (!cands.length) return []
  // Spread them out: start nearest the middle of all the seats, then keep taking the furthest.
  const cx = cands.reduce((s, c) => s + c.x, 0) / cands.length, cy = cands.reduce((s, c) => s + c.y, 0) / cands.length
  let first = 0
  for (let i = 1; i < cands.length; i++) if (Math.hypot(cands[i].x - cx, cands[i].y - cy) < Math.hypot(cands[first].x - cx, cands[first].y - cy)) first = i
  const out = [cands[first]]
  const dist = cands.map((c) => Math.hypot(c.x - cands[first].x, c.y - cands[first].y))
  while (out.length < d.max) {
    let best = -1
    for (let i = 0; i < cands.length; i++) if (dist[i] >= d.spacing && (best < 0 || dist[i] > dist[best])) best = i
    if (best < 0) break
    out.push(cands[best])
    for (let i = 0; i < cands.length; i++) dist[i] = Math.min(dist[i], Math.hypot(cands[i].x - cands[best].x, cands[i].y - cands[best].y))
  }
  return out
}

/**
 * Seats on steps in the data's areas (no rails there): a grid of points, each a flat tread with flat
 * ground depth metres behind it and the next step drop metres lower in front; the seat sits at the
 * tread's edge (found by halving), the seats spread out up to the area's max.
 */
export function areaSeats(park: Park, d: SpectatorData): Seat[] {
  const top = (x: number, y: number) => raycast(park, { x, y, z: 60 }, down, 120)
  const out: Seat[] = []
  for (const a of d.areas ?? []) {
    const fl = Math.hypot(a.facing[0], a.facing[1]) || 1, fx = a.facing[0] / fl, fy = a.facing[1] / fl, nx = -fy, ny = fx
    const cands: Seat[] = []
    for (let u = -a.r; u <= a.r; u += 0.2) for (let v = -a.r; v <= a.r; v += 0.5) {
      if (Math.hypot(u, v) > a.r) continue
      const px = a.at[0] + fx * u + nx * v, py = a.at[1] + fy * u + ny * v
      const t = top(px, py), back = top(px - fx * a.depth, py - fy * a.depth), low = top(px + fx * 0.3, py + fy * 0.3)
      if (!t || !back || !low || t.normal.z < 0.92 || back.normal.z < 0.92 || low.normal.z < 0.9) continue
      if (Math.abs(back.point.z - t.point.z) > 0.05) continue
      const drop = t.point.z - low.point.z
      if (drop < a.drop[0] || drop > a.drop[1]) continue
      // The edge: halve between here (on the tread) and the point in front (below it).
      let s0 = 0, s1 = 0.3
      for (let k = 0; k < 6; k++) { const s = (s0 + s1) / 2, q = top(px + fx * s, py + fy * s); if (q && q.point.z > t.point.z - 0.03) s0 = s; else s1 = s }
      cands.push({ x: px + fx * (s0 - 0.04), y: py + fy * (s0 - 0.04), z: t.point.z, heading: Math.atan2(fy, fx), drop, rail: a.label ?? 'steps' })
    }
    // Spread: from the middle, then the furthest from those kept, never closer than spacing.
    const kept: Seat[] = []
    const mid = cands.sort((p, q) => Math.hypot(p.x - a.at[0], p.y - a.at[1]) - Math.hypot(q.x - a.at[0], q.y - a.at[1]))[0]
    if (mid) kept.push(mid)
    while (mid && kept.length < a.max) {
      let best: Seat | null = null, bestD = a.spacing
      for (const c of cands) { const dd = Math.min(...kept.map((k) => Math.hypot(c.x - k.x, c.y - k.y))); if (dd >= bestD) { best = c; bestD = dd } }
      if (!best) break
      kept.push(best)
    }
    out.push(...kept)
  }
  return out
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// The figure, in its own frame: x forward (facing the drop), y left, z up, the origin on the seat at the edge.
const along = (g: THREE.BufferGeometry, from: THREE.Vector3, to: THREE.Vector3) => {
  // A cylinder (along y) laid from one point to another.
  const dir = to.clone().sub(from), len = dir.length()
  g.scale(1, len, 1)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()))
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
  return g
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const NECK = V(-0.04, 0, 0.66)
const SHOULDER = (side: number) => V(-0.06, side * 0.19, 0.56)
const ARM = 0.5
const KNEE = V(0.13, 0, 0.08)
const SHIN = 0.43
const HIP = V(-0.1, 0, 0.1)

function parts() {
  const torso = mergeGeometries([
    new THREE.CapsuleGeometry(0.16, 0.3, 3, 10).rotateX(Math.PI / 2).scale(0.78, 1, 1).translate(-0.08, 0, 0.36),
  ])!
  const legs = mergeGeometries([1, -1].flatMap((s) => [
    along(new THREE.CylinderGeometry(0.075, 0.07, 1, 7), V(-0.1, s * 0.09, 0.1), V(KNEE.x - 0.01, s * 0.1, KNEE.z)),
    new THREE.SphereGeometry(0.072, 7, 5).translate(KNEE.x, s * 0.1, KNEE.z),
  ]))!
  // One shin per instance, from the knee down; its shoe stays flat (own matrix).
  const shins = along(new THREE.CylinderGeometry(0.065, 0.055, 1, 7), V(0, 0, 0), V(0.0, 0, -SHIN))
  const shoes = new THREE.BoxGeometry(0.24, 0.11, 0.09).translate(0.06, 0, -0.04)
  // The head and what sits on it turn about the neck.
  const head = new THREE.SphereGeometry(0.15, 12, 9).translate(0.02, 0, 0.17)
  const hair = new THREE.SphereGeometry(0.157, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.4).rotateX(Math.PI / 2).rotateY(-0.45).translate(0.015, 0, 0.175)
  const eyes = mergeGeometries([1, -1].map((s) => new THREE.SphereGeometry(0.047, 9, 7).scale(0.7, 1, 1.12).translate(0.148, s * 0.055, 0.195)))!
  const pupils = mergeGeometries([1, -1].map((s) => new THREE.SphereGeometry(0.024, 7, 5).translate(0.18, s * 0.052, 0.195)))!
  const mouth = new THREE.SphereGeometry(0.04, 8, 5).scale(0.5, 1, 0.55)   // scaled open in a cheer
  const beanie = mergeGeometries([
    new THREE.SphereGeometry(0.16, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(Math.PI / 2).scale(1, 1, 1.2),
    new THREE.CylinderGeometry(0.163, 0.163, 0.06, 12).rotateX(Math.PI / 2).translate(0, 0, 0.02),
    new THREE.SphereGeometry(0.04, 6, 5).translate(0, 0, 0.2),
  ])!.rotateY(-0.3).translate(0.0, 0, 0.245)
  const cap = mergeGeometries([
    new THREE.SphereGeometry(0.158, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(Math.PI / 2),
    new THREE.CylinderGeometry(0.11, 0.11, 0.015, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2).scale(1.3, 1, 1).translate(0.1, 0, 0.005),
  ])!.rotateY(-0.18).translate(0.005, 0, 0.245)
  // The arm hangs from the shoulder along -z; the hand at its end.
  const arm = new THREE.CylinderGeometry(0.055, 0.045, ARM, 7).rotateX(Math.PI / 2).translate(0, 0, -ARM / 2)
  const hand = new THREE.SphereGeometry(0.06, 7, 5).translate(0, 0, -ARM - 0.02)
  // A board lying on the deck beside them: the deck with kicked tips, four wheels.
  const deck = mergeGeometries([
    new THREE.BoxGeometry(0.56, 0.2, 0.018).translate(0, 0, 0.075),
    ...[1, -1].map((s) => new THREE.BoxGeometry(0.14, 0.2, 0.018).rotateY(s * 0.32).translate(s * 0.345, 0, 0.097)),
  ])!
  const wheels = mergeGeometries([0.21, -0.21].flatMap((x) => [0.085, -0.085].map((y) => new THREE.CylinderGeometry(0.027, 0.027, 0.03, 8).translate(x, y, 0.027))))!
  return { torso, legs, shins, shoes, head, hair, eyes, pupils, mouth, beanie, cap, arm, hand, deck, wheels }
}

type Part = keyof ReturnType<typeof parts>
const PAIRED: Part[] = ['arm', 'hand', 'shins', 'shoes']   // one per side
const HEAD_PARTS: Part[] = ['head', 'hair', 'eyes', 'pupils', 'beanie', 'cap']
const BODY_PARTS: Part[] = ['torso', 'legs']

type Fan = { seat: Seat; seed: number; hat: number; board: number; phase: number; scale: number }

export class Spectators {
  readonly group = new THREE.Group()
  readonly seats: Seat[]
  private d: SpectatorData
  private fans: Fan[] = []
  private meshes = new Map<Part, THREE.InstancedMesh>()
  private looks = new Map<Part, Record<'grey' | 'cute' | 'real', THREE.Material>>()
  private style = ''
  private m = new THREE.Matrix4()
  private base = new THREE.Matrix4()
  private q = new THREE.Quaternion()

  constructor(park: Park, d: SpectatorData, gradient: THREE.Texture | null) {
    this.d = d
    this.seats = [...spectatorSeats(park, d), ...areaSeats(park, d)]
    const r = rng(d.seed)
    const pickC = (list: string[]) => new THREE.Color(list[Math.floor(r() * list.length) % list.length])
    const n = this.seats.length
    const geo = parts()
    const colors = new Map<Part, THREE.Color[]>()
    for (const [i, seat] of this.seats.entries()) {
      const hat = r() < 0.38 ? 1 : r() < 0.55 ? 2 : 0   // 1 beanie, 2 cap
      const fan: Fan = { seat, seed: i, hat, board: r() < 0.55 ? (r() < 0.5 ? 1 : -1) : 0, phase: r() * Math.PI * 2, scale: 0.92 + r() * 0.14 }
      this.fans.push(fan)
      const skin = pickC(d.skins), shirt = pickC(d.shirts), hatC = pickC(d.hats)
      const pants = pickC(d.pants), shoe = pickC(['#f2efe6', '#1c1c20', '#c8372d', '#f2efe6'])
      const per: Partial<Record<Part, THREE.Color>> = { torso: shirt, legs: pants, head: skin, hair: pickC(d.hairs), eyes: new THREE.Color('#ffffff'), pupils: new THREE.Color('#141414'), mouth: new THREE.Color('#3a1416'), beanie: hatC, cap: hatC, deck: pickC(d.decks), wheels: new THREE.Color('#efe6c8') }
      for (const [k, c] of Object.entries(per) as [Part, THREE.Color][]) { if (!colors.has(k)) colors.set(k, []); colors.get(k)![i] = c }
      colors.set('arm', [...(colors.get('arm') ?? []), shirt, shirt])
      colors.set('hand', [...(colors.get('hand') ?? []), skin, skin])
      colors.set('shins', [...(colors.get('shins') ?? []), pants, pants])
      colors.set('shoes', [...(colors.get('shoes') ?? []), shoe, shoe])
    }
    for (const [k, g] of Object.entries(geo) as [Part, THREE.BufferGeometry][]) {
      const count = PAIRED.includes(k) ? n * 2 : n
      const shiny = k === 'eyes' || k === 'pupils'
      const looks = {
        grey: new THREE.MeshLambertMaterial({ color: 0xffffff }),
        cute: gradient ? new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient }) : new THREE.MeshLambertMaterial({ color: 0xffffff }),
        real: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: shiny ? 0.25 : k === 'wheels' ? 0.5 : 0.85 }),
      }
      const mesh = new THREE.InstancedMesh(g, looks.cute, Math.max(1, count))
      mesh.count = count
      mesh.castShadow = k !== 'pupils' && k !== 'mouth' && k !== 'eyes'
      mesh.receiveShadow = k === 'torso' || k === 'legs'
      mesh.frustumCulled = false
      mesh.name = `spectators:${k}`
      const cs = colors.get(k) ?? []
      for (let i = 0; i < count; i++) mesh.setColorAt(i, cs[i] ?? new THREE.Color('#ffffff'))
      this.meshes.set(k, mesh)
      this.looks.set(k, looks)
      this.group.add(mesh)
    }
    this.group.name = 'spectators'
    this.update(0, null, null)
  }

  /** Match the renderer's look (cute toon, real PBR, grey clay). */
  setStyle(style: string) {
    if (style === this.style) return
    this.style = style
    const key = (style === 'real' || style === 'grey' ? style : 'cute') as 'grey' | 'cute' | 'real'
    for (const [k, mesh] of this.meshes) mesh.material = this.looks.get(k)![key]
  }

  /** How many fans see this landed combo and cheer it (the same rule the poses use). */
  fansFor(landed: Landed): number {
    const c = this.d.cheer
    if (landed.points < c.points || !this.group.visible) return 0
    const near = landed.points >= c.bigPoints ? c.bigNear : c.near
    return this.fans.filter((f) => Math.hypot(landed.x - f.seat.x, landed.y - f.seat.y) < near).length
  }

  /**
   * Pose everyone for this moment: tick (with the frame's fraction), the skater's position, and the
   * last landed combo. A big one near a fan gets arms up and a bounce for a couple of seconds; the
   * skater coming right past makes them lean back, legs up, out of the way.
   */
  update(tick: number, skater: { x: number; y: number; z: number } | null, landed: Landed | null) {
    const c = this.d.cheer
    const T = tick / 120
    for (const [i, f] of this.fans.entries()) {
      const s = f.seat
      // Cheer: this fan saw it if it landed close enough for its size; each starts a beat apart.
      let cheer = 0, since = 0
      if (landed && landed.points >= c.points) {
        const dd = Math.hypot(landed.x - s.x, landed.y - s.y)
        since = tick - landed.tick - (f.phase * 3) % 14
        if (dd < (landed.points >= c.bigPoints ? c.bigNear : c.near) && since >= 0) cheer = smooth(0, 10, since) * (1 - smooth(c.ticks - 50, c.ticks, since))
      }
      const close = skater ? Math.hypot(skater.x - s.x, skater.y - s.y, (skater.z - s.z) * 1.5) : 99
      const duck = 1 - smooth(1.4, 2.8, close)
      cheer *= 1 - duck
      const hop = cheer * Math.abs(Math.sin(since * 0.16 + f.phase)) * 0.09
      this.base.compose(new THREE.Vector3(s.x, s.y, s.z + hop), this.q.setFromAxisAngle(new THREE.Vector3(0, 0, 1), s.heading), new THREE.Vector3(f.scale, f.scale, f.scale))
      // Leaning back about the hips (legs come up with the body).
      if (duck > 0) this.base.multiply(new THREE.Matrix4().makeTranslation(HIP.x, HIP.y, HIP.z).multiply(new THREE.Matrix4().makeRotationY(-1.15 * duck)).multiply(new THREE.Matrix4().makeTranslation(-HIP.x, -HIP.y, -HIP.z)))
      for (const k of BODY_PARTS) this.meshes.get(k)!.setMatrixAt(i, this.base)
      // The head follows the skater (within a turn of the neck), else looks about.
      let yaw = Math.sin(T * 0.35 + f.phase) * 0.55, nod = Math.sin(T * 0.5 + f.phase * 2) * 0.06
      if (skater) {
        const dx = skater.x - s.x, dy = skater.y - s.y, dist = Math.hypot(dx, dy)
        if (dist < 40) {
          let a = Math.atan2(dy, dx) - s.heading
          a = Math.atan2(Math.sin(a), Math.cos(a))
          yaw = Math.max(-1.25, Math.min(1.25, a))
          nod = Math.max(-0.35, Math.min(0.25, Math.atan2((s.z + 0.8) - (skater.z + 0.5), Math.max(dist, 0.5)) * 0.7))
        }
      }
      nod -= cheer * 0.25 - duck * 0.5
      const headM = new THREE.Matrix4().makeTranslation(NECK.x, NECK.y, NECK.z)
        .multiply(new THREE.Matrix4().makeRotationZ(yaw)).multiply(new THREE.Matrix4().makeRotationY(nod))
      this.m.multiplyMatrices(this.base, headM)
      for (const k of HEAD_PARTS) {
        const show = k === 'beanie' ? f.hat === 1 : k === 'cap' ? f.hat === 2 : true
        this.meshes.get(k)!.setMatrixAt(i, show ? this.m : ZERO)
      }
      // Mouth: a line, open wide in a cheer.
      const open = 0.35 + Math.max(cheer, duck) * 0.9
      this.meshes.get('mouth')!.setMatrixAt(i, new THREE.Matrix4().multiplyMatrices(this.m, new THREE.Matrix4().makeTranslation(0.155, 0, 0.1).multiply(new THREE.Matrix4().makeScale(1, 1 - cheer * 0.2, open))))
      // Arms: hands on the knees, or up and waving.
      for (const side of [1, -1]) {
        const rest = V(0.24, side * -0.08, -0.42).normalize()
        const wave = Math.sin(since * 0.22 + f.phase + (side > 0 ? 0 : 1.3)) * 0.35
        const up = V(0.1 + Math.sin(wave) * 0.15, side * (0.42 + wave * 0.3), 1).normalize()
        const idle = V(Math.sin(T * 0.7 + f.phase + side) * 0.03, 0, 0)
        const guard = V(0.55, side * 0.25, 0.8).normalize()   // hands up in front: whoa
        const dir = rest.clone().add(idle).lerp(up, cheer).lerp(guard, duck).normalize()
        this.q.setFromUnitVectors(V(0, 0, -1), dir)
        this.m.multiplyMatrices(this.base, new THREE.Matrix4().compose(SHOULDER(side), this.q, V(1, 1, 1)))
        const j = i * 2 + (side > 0 ? 0 : 1)
        this.meshes.get('arm')!.setMatrixAt(j, this.m)
        this.meshes.get('hand')!.setMatrixAt(j, this.m)
      }
      // Shins: down to the ground below a low ledge (feet forward), hanging and kicking over a high one.
      const reach = SHIN + 0.08                              // knee to sole, straight down
      const need = s.drop / f.scale + KNEE.z                 // knee to the ground below
      const rest = need < reach ? Math.acos(Math.min(1, need / reach)) : 0
      for (const side of [1, -1]) {
        const kick = need > reach ? Math.sin(T * 2.2 + f.phase + side * 1.1) * (0.12 + cheer * 0.35) : cheer * 0.25 * Math.sin(since * 0.3 + side)
        const a = rest + Math.max(-0.2, kick) + duck * 0.6
        const knee = new THREE.Matrix4().makeTranslation(KNEE.x, side * 0.1, KNEE.z).multiply(new THREE.Matrix4().makeRotationY(-a))
        const j = i * 2 + (side > 0 ? 0 : 1)
        this.m.multiplyMatrices(this.base, knee)
        this.meshes.get('shins')!.setMatrixAt(j, this.m)
        this.m.multiply(new THREE.Matrix4().makeTranslation(0, 0, -SHIN).multiply(new THREE.Matrix4().makeRotationY(a * 0.85)))
        this.meshes.get('shoes')!.setMatrixAt(j, this.m)
      }
      // The board beside them on the deck, nose along the edge.
      if (f.board) {
        this.m.compose(new THREE.Vector3(s.x, s.y, s.z), new THREE.Quaternion().setFromAxisAngle(V(0, 0, 1), s.heading + Math.PI / 2 + 0.12 * f.board), V(1, 1, 1))
        this.m.premultiply(new THREE.Matrix4().makeTranslation(-Math.sin(s.heading) * 0.42 * f.board - Math.cos(s.heading) * 0.12, Math.cos(s.heading) * 0.42 * f.board - Math.sin(s.heading) * 0.12, 0))
      }
      for (const k of ['deck', 'wheels'] as Part[]) this.meshes.get(k)!.setMatrixAt(i, f.board ? this.m : ZERO)
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true
  }
}

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0)
