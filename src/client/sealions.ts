import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// The sea lions on Pier 39's K-dock: draw-only, never in the sim. Basking in piles on the floats, made
// after the Sea Lion skater's body (the same torpedo and colours; no cap, board or skater rig) and
// drawn instanced: one body mesh and one head mesh for all of them, two draw calls. Three resting
// poses (flat, head up, rolled on its side); near the camera they live a little: heads lift and bark
// (sound only with the player within barkFar), now and then one shuffles over or flops into the bay
// and hauls out again. Far off they cost nothing: past the draw distance the group is hidden and
// nothing is updated; low draws fewer (data/sealions.json, presets.sealions).

/**
 * One sea lion as the city export lists it (city.sealions, city phase 12): site metres, z the deck (or the back) under
 * its belly, heading in compass degrees (0 north, +y; 90 east), length in metres (size, the older name), roll in degrees
 * (rolled onto its side), pile the group on one float, layer 0 on the float, 1 and up on another's back.
 */
export type SeaLionRecord = { x: number; y: number; z: number; heading: number; pile: number | string; size?: number; roll?: number; layer?: number }

export type SeaLionData = {
  size: [number, number]
  poses: { flat: number; headUp: number; side: number }
  drawDistance: number; animate: number; barkFar: number
  barkEvery: [number, number]; barks: [number, number]
  shuffleEvery: [number, number]; flopEvery: [number, number]; under: [number, number]
  dive: { reach: number; depth: number }
  colors: { back: string; pelt: string; belly: string; muzzle: string; flipper: string; nose: string; eye: string }
  test?: unknown[]
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

/** The sea lions in a list from the export (or data): the entries that are one; the rest are counted, not drawn. */
export function parseSeaLions(v: unknown): { list: SeaLionRecord[]; skipped: number } {
  if (!Array.isArray(v)) return { list: [], skipped: 0 }
  const list: SeaLionRecord[] = []
  let skipped = 0
  for (const e of v) {
    const o = e as Record<string, unknown> | null
    const size = o?.length ?? o?.size
    if (!o || typeof o !== 'object' || !finite(o.x) || !finite(o.y) || !finite(o.z) || !finite(o.heading) || (size !== undefined && !(finite(size) && size > 0))) { skipped++; continue }
    const pile = typeof o.pile === 'number' || typeof o.pile === 'string' ? o.pile : -1
    list.push({ x: o.x, y: o.y, z: o.z, heading: o.heading, pile, ...(size !== undefined ? { size: size as number } : {}), ...(finite(o.roll) ? { roll: o.roll } : {}), ...(finite(o.layer) ? { layer: o.layer } : {}) })
  }
  return { list, skipped }
}

// ---- the model, authored for a 2.2 m adult: x forward (to the head), y left, z up, the belly on z = 0 ----
const REF = 2.2
/** The body's profile along x (metres): the radius there. */
const PROFILE: [number, number][] = [[-1.1, 0], [-1.03, 0.05], [-0.9, 0.1], [-0.66, 0.16], [-0.36, 0.215], [-0.06, 0.25], [0.2, 0.258], [0.44, 0.235], [0.64, 0.19], [0.8, 0.15], [0.9, 0.125], [0.95, 0]]
/** Where the head turns on the body (the neck), and the body's centre height there. */
const NECK = new THREE.Vector3(0.86, 0, 0.12)

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
/** From angle a toward b the short way round, by f. */
const turn = (a: number, b: number, f: number) => { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * f }
/** The chest's cross-section (half width, half height): how high a body rolled on its side sits. */
const CHEST = { ry: 0.258, rz: 0.21 }

function colored(g: THREE.BufferGeometry, c: THREE.Color | ((p: THREE.Vector3, n: THREE.Vector3) => THREE.Color)): THREE.BufferGeometry {
  const geo = g.index ? g.toNonIndexed() : g
  for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k)
  const p = geo.getAttribute('position'), n = geo.getAttribute('normal'), col = new Float32Array(p.count * 3)
  const P = new THREE.Vector3(), N = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) {
    const cc = typeof c === 'function' ? c(P.fromBufferAttribute(p, i), N.fromBufferAttribute(n, i)) : c
    col[i * 3] = cc.r; col[i * 3 + 1] = cc.g; col[i * 3 + 2] = cc.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
  return geo
}

const ellipsoid = (at: [number, number, number], r: [number, number, number], yaw = 0, pitch = 0, seg: [number, number] = [10, 6]) =>
  new THREE.SphereGeometry(1, seg[0], seg[1]).scale(...r).rotateY(pitch).rotateZ(yaw).translate(...at)

/** The body (torpedo, flippers) and the head (crown, snout, nose, eyes, ears; around the neck point) as vertex-coloured geometries. */
export function seaLionGeometry(C: SeaLionData['colors']): { body: THREE.BufferGeometry; head: THREE.BufferGeometry } {
  const back = new THREE.Color(C.back), pelt = new THREE.Color(C.pelt), belly = new THREE.Color(C.belly)
  const flipper = new THREE.Color(C.flipper), muzzle = new THREE.Color(C.muzzle), nose = new THREE.Color(C.nose), eye = new THREE.Color(C.eye)
  // The torpedo, lying: rings round the x axis, flattened (the belly flatter than the back) with the belly on the deck.
  const sides = 14
  const pos: number[] = [], idx: number[] = []
  for (const [x, r] of PROFILE) {
    const rz = r * 0.82
    for (let k = 0; k <= sides; k++) {
      const a = (k / sides) * Math.PI * 2, s = Math.sin(a)
      pos.push(x, r * Math.cos(a), rz + rz * s * (s < 0 ? 0.62 : 1) - (1 - 0.62) * rz * 0)
    }
  }
  for (let i = 0; i < PROFILE.length - 1; i++) for (let k = 0; k < sides; k++) {
    const a = i * (sides + 1) + k, b = a + sides + 1
    idx.push(a, b, a + 1, b, b + 1, a + 1)
  }
  // The belly rests on the deck: shift each ring so its lowest point is at z = 0.
  for (let i = 0; i < PROFILE.length; i++) {
    let lo = Infinity
    for (let k = 0; k <= sides; k++) lo = Math.min(lo, pos[(i * (sides + 1) + k) * 3 + 2])
    for (let k = 0; k <= sides; k++) pos[(i * (sides + 1) + k) * 3 + 2] -= lo
  }
  const torso = new THREE.BufferGeometry()
  torso.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  torso.setIndex(idx)
  torso.computeVertexNormals()
  // The rings of radius 0 at the tail and the neck end meet in a point: their triangles have no area, so
  // their normals come out zero (NaN once the shader normalizes them). They point along the body there.
  const nrm = torso.getAttribute('normal') as THREE.BufferAttribute
  for (let i = 0; i < nrm.count; i++) if (Math.hypot(nrm.getX(i), nrm.getY(i), nrm.getZ(i)) < 1e-6) nrm.setXYZ(i, pos[i * 3] < 0 ? -1 : 1, 0, 0)
  // The coat: the dark back, brown sides, pale tan underneath and up the throat; the tail darker.
  const coat = (p: THREE.Vector3, n: THREE.Vector3) => {
    const up = n.z, throat = smooth(0.35, 0.8, p.x) * smooth(0.1, -0.5, up)
    const c = pelt.clone().lerp(back, smooth(0.15, 0.75, up)).lerp(belly, Math.max(smooth(-0.15, -0.6, up), throat * 0.8))
    return c.multiplyScalar(1 - 0.18 * smooth(-0.6, -1.05, p.x))
  }
  const parts: THREE.BufferGeometry[] = [colored(torso, coat)]
  // Front flippers splayed back on the deck, rear flippers fanned behind the tail.
  for (const k of [1, -1]) {
    parts.push(colored(ellipsoid([0.3, k * 0.37, 0.022], [0.24, 0.09, 0.022], k * 0.8), flipper))
    parts.push(colored(ellipsoid([-1.1, k * 0.11, 0.022], [0.18, 0.075, 0.02], k * -0.35), flipper))
  }
  const body = mergeGeometries(parts)!
  // The head, around the neck point: a round crown, a dog-like snout, the black nose, glossy eyes, tiny ears.
  const crown = pelt.clone().lerp(back, 0.35)
  const head: THREE.BufferGeometry[] = [
    colored(ellipsoid([0.05, 0, 0.0], [0.15, 0.1, 0.098], 0, 0, [14, 10]), crown),
    colored(ellipsoid([0.2, 0, -0.022], [0.14, 0.066, 0.06], 0, 0.12, [12, 8]), (q) => crown.clone().lerp(muzzle, smooth(0.12, 0.26, q.x))),
    colored(ellipsoid([0.335, 0, -0.03], [0.025, 0.03, 0.022], 0, 0, [8, 6]), nose),
  ]
  for (const k of [1, -1]) head.push(colored(ellipsoid([0.13, k * 0.068, 0.048], [0.02, 0.02, 0.02], 0, 0, [8, 6]), eye))
  return { body, head: mergeGeometries(head)! }
}

// ---- the living dock ----

type Pose = 'flat' | 'headUp' | 'side'
type State = 'rest' | 'bark' | 'shuffle' | 'dive' | 'under' | 'haul'
type Lion = {
  home: THREE.Vector3; yaw: number; scale: number; pose: Pose; roll: number; pile: number; stacked: boolean; shown: boolean
  pos: THREE.Vector3; yawNow: number; yawFrom: number; state: State; t: number; dur: number
  nextShuffle: number; nextFlop: number; barks: number
  from: THREE.Vector3; to: THREE.Vector3; edge: THREE.Vector3; seed: number; tint: number; wet: number
}

/** A seeded random stream (the dock looks the same each visit). */
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const between = (r: () => number, [a, b]: [number, number]) => a + (b - a) * r()

export type SeaLionSound = (kind: 'bark' | 'splash', at: THREE.Vector3, n: number) => void

export class SeaLions {
  readonly group = Object.assign(new THREE.Group(), { name: 'sealions' })
  readonly body: THREE.InstancedMesh
  readonly head: THREE.InstancedMesh
  private rings: THREE.InstancedMesh
  private lions: Lion[] = []
  private time = 0
  private r = rng(39)
  private nextBark = 2
  private active = false
  private density = 1
  private drawScale = 1
  private box = new THREE.Box3()
  private splashes: { at: THREE.Vector3; t: number }[] = []
  /** A sea lion barks or splashes within barkFar of the player (the game plays it, quieter with distance). */
  onSound: SeaLionSound = () => {}

  readonly d: SeaLionData

  constructor(records: SeaLionRecord[], d: SeaLionData) {
    this.d = d
    const g = seaLionGeometry(d.colors)
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0 })   // wet: a soft shine
    const n = Math.max(1, records.length)
    const make = (geo: THREE.BufferGeometry, shadow: boolean) => {
      const im = new THREE.InstancedMesh(geo, mat, n)
      im.count = 0; im.castShadow = shadow; im.receiveShadow = true
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      im.setColorAt(0, new THREE.Color(1, 1, 1))
      return im
    }
    this.body = make(g.body, true)
    this.head = make(g.head, false)
    const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    this.rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.32, 0.5, 24), ringMat, 8)
    this.rings.count = 0; this.rings.frustumCulled = false
    this.rings.setColorAt(0, new THREE.Color(0, 0, 0))
    this.group.add(this.body, this.head, this.rings)
    // Piles: each one's deck (its lowest sea lion), centre and extent, for who lies on whom and where the water is.
    const piles = new Map<string, { deck: number; box: THREE.Box2; n: number; cx: number; cy: number }>()
    for (const s of records) {
      const k = String(s.pile)
      const p = piles.get(k) ?? { deck: Infinity, box: new THREE.Box2(), n: 0, cx: 0, cy: 0 }
      p.deck = Math.min(p.deck, s.z); p.box.expandByPoint(new THREE.Vector2(s.x, s.y)); p.n++; p.cx += s.x; p.cy += s.y
      piles.set(k, p)
    }
    for (const p of piles.values()) { p.cx /= p.n; p.cy /= p.n; p.box.expandByScalar(0.9) }
    const pileIds = [...piles.keys()]
    const P = d.poses, sum = P.flat + P.headUp + P.side
    records.forEach((s, i) => {
      const r = rng(1000 + i * 7919)
      const pile = piles.get(String(s.pile))!
      const u = r() * sum
      // The export's roll says who lies on their side; the rest rest flat or head up. (Without one, the poses' shares.)
      const pose: Pose = s.roll !== undefined ? (Math.abs(s.roll) > 15 ? 'side' : r() * (P.flat + P.headUp) < P.flat ? 'flat' : 'headUp')
        : u < P.flat ? 'flat' : u < P.flat + P.headUp ? 'headUp' : 'side'
      const length = s.size ?? between(r, d.size)
      const yaw = Math.PI / 2 - s.heading * Math.PI / 180   // compass degrees to the angle from +x
      const home = new THREE.Vector3(s.x, s.y, s.z)
      // Into the water: straight out from the middle of its pile, past the pile's edge.
      const out = new THREE.Vector2(s.x - pile.cx, s.y - pile.cy)
      if (out.length() < 0.5) out.set(Math.cos(yaw), Math.sin(yaw))
      out.normalize()
      let t = 0
      while (t < 20 && pile.box.containsPoint(new THREE.Vector2(s.x + out.x * t, s.y + out.y * t))) t += 0.25
      const edge = new THREE.Vector3(s.x + out.x * t, s.y + out.y * t, pile.deck)
      const to = new THREE.Vector3(s.x + out.x * (t + d.dive.reach), s.y + out.y * (t + d.dive.reach), pile.deck - d.dive.depth)
      this.lions.push({
        home, yaw, scale: length / REF, pose, roll: s.roll !== undefined ? s.roll * Math.PI / 180 : pose === 'side' ? (r() < 0.5 ? 1 : -1) * (0.5 + r() * 0.3) : 0,
        pile: pileIds.indexOf(String(s.pile)), stacked: s.layer !== undefined ? s.layer > 0 : s.z > pile.deck + 0.15, shown: true,
        pos: home.clone(), yawNow: yaw, yawFrom: yaw, state: 'rest', t: 0, dur: 0,
        nextShuffle: between(r, d.shuffleEvery), nextFlop: between(r, d.flopEvery), barks: 0,
        from: home.clone(), to, edge, seed: r() * 100, tint: 0.82 + r() * 0.24, wet: 0,
      })
      this.box.expandByPoint(home)
    })
    this.box.expandByScalar(6)
    this.layout()
  }

  /** How many there are, and how many are drawn (tests, the fps probe). */
  get count() { return this.lions.length }
  get drawn() { return this.body.count }

  /** Quality: draw this share of them (the same ones each time) out to drawDistance times this. */
  setQuality(share: number, drawScale = 1) {
    this.density = Math.max(0, Math.min(1, share)); this.drawScale = drawScale
    this.layout()
  }

  private layout() {
    for (const [i, l] of this.lions.entries()) l.shown = ((i * 0.618034) % 1) < this.density
    this.pose()
    this.body.computeBoundingSphere(); this.head.computeBoundingSphere()
    // Room for a shuffle or a dive off the edge.
    for (const m of [this.body, this.head]) if (m.boundingSphere) m.boundingSphere.radius += 5
  }

  /** dt seconds; the camera (what is drawn) and the player (who hears a bark). */
  update(dt: number, camera: THREE.Vector3, player: THREE.Vector3) {
    const far = this.box.distanceToPoint(camera)
    this.group.visible = far < this.d.drawDistance * this.drawScale && this.lions.length > 0
    if (!this.group.visible) return
    if (far > this.d.animate) {
      // Out of sight of the details: everyone back home and still (once), nothing more each frame.
      if (this.active) { for (const l of this.lions) this.rest(l); this.splashes.length = 0; this.pose(); this.active = false }
      return
    }
    this.active = true
    this.time += dt
    const near = this.box.distanceToPoint(player) < this.d.barkFar
    // Every few seconds one of them (awake, at home) lifts its head and barks a few times.
    if (this.time >= this.nextBark) {
      this.nextBark = this.time + between(this.r, this.d.barkEvery)
      const idle = this.lions.filter((l) => l.shown && l.state === 'rest' && l.pose !== 'side')
      const l = idle[Math.floor(this.r() * idle.length)]
      if (l) {
        l.state = 'bark'; l.t = 0; l.barks = Math.round(between(this.r, this.d.barks)); l.dur = 0.35 + l.barks * 0.27 + 0.5
        if (near && l.pos.distanceTo(player) < this.d.barkFar) this.onSound('bark', l.pos, l.barks)
      }
    }
    for (const l of this.lions) {
      if (!l.shown) continue
      l.t += dt
      l.wet = Math.max(0, l.wet - dt / 40)
      if (l.state === 'rest' && !l.stacked && l.pose !== 'side') {
        if (this.time >= l.nextFlop) { l.from.copy(l.pos); l.yawFrom = l.yawNow; this.start(l, 'dive', 1.3) }
        else if (this.time >= l.nextShuffle) {
          // A lurch or two: back toward home when it has wandered, else a little way on, turning a bit.
          l.from.copy(l.pos); l.yawFrom = l.yawNow
          const away = l.pos.distanceTo(l.home)
          if (away > 0.35) l.to.copy(l.home)
          else { l.yawNow += (this.r() - 0.5) * 0.8; l.to.set(l.pos.x + Math.cos(l.yawNow) * 0.45 * l.scale, l.pos.y + Math.sin(l.yawNow) * 0.45 * l.scale, l.home.z) }
          this.start(l, 'shuffle', 1.7)
        }
      }
      if (l.state === 'rest' || l.t < l.dur) continue
      // An action ended: what comes next.
      if (l.state === 'dive') {
        this.splash(l.to, player, near)
        this.start(l, 'under', between(this.r, this.d.under))
      } else if (l.state === 'under') this.start(l, 'haul', 2.6)
      else {
        if (l.state === 'haul') { l.wet = 1; l.nextFlop = this.time + between(this.r, this.d.flopEvery) }
        if (l.state === 'shuffle') l.nextShuffle = this.time + between(this.r, this.d.shuffleEvery)
        this.rest(l, l.state === 'shuffle')
      }
    }
    for (const s of this.splashes) s.t += dt
    this.splashes = this.splashes.filter((s) => s.t < 1.8)
    this.pose()
  }

  private start(l: Lion, s: State, dur: number) { l.state = s; l.t = 0; l.dur = dur }
  private rest(l: Lion, keepPlace = false) {
    l.state = 'rest'; l.t = 0; l.dur = 0
    if (!keepPlace) { l.pos.copy(l.home); l.yawNow = l.yaw }
    else l.pos.copy(l.to)
  }
  private splash(at: THREE.Vector3, player: THREE.Vector3, near: boolean) {
    this.splashes.push({ at: new THREE.Vector3(at.x, at.y, at.z + this.d.dive.depth - 0.33), t: 0 })
    if (this.splashes.length > 8) this.splashes.shift()
    if (near && at.distanceTo(player) < this.d.barkFar) this.onSound('splash', at, 1)
  }

  /** Every drawn sea lion's body and head into the instanced meshes. */
  private pose() {
    const M = this.tmp
    let i = 0
    for (const l of this.lions) {
      if (!l.shown) continue
      let pitch = 0, roll = l.roll, headPitch = l.pose === 'flat' ? -0.42 : l.pose === 'headUp' ? 0.5 : -0.12, headYaw = 0, lift = 0, hidden = false
      const pos = M.p.copy(l.pos)
      let yaw = l.yawNow
      const k = l.dur > 0 ? Math.min(1, l.t / l.dur) : 0
      if (l.pose === 'headUp' && l.state === 'rest') { pitch = -0.13; headYaw = Math.sin(this.time * 0.35 + l.seed) * 0.45 }
      if (l.state === 'bark') {
        // Up on the front flippers, head high, a nod on each "ork".
        const up = smooth(0, 0.3, l.t) * (1 - smooth(l.dur - 0.45, l.dur, l.t))
        const nod = l.t > 0.3 && l.t < 0.3 + l.barks * 0.27 ? Math.max(0, Math.sin(((l.t - 0.3) / 0.27) * Math.PI * 2)) * 0.18 : 0
        pitch = (l.pose === 'headUp' ? -0.13 : 0) * (1 - up) - 0.2 * up
        headPitch = headPitch * (1 - up) + (0.85 - nod) * up
        headYaw = Math.sin(l.seed) * 0.3 * up
      } else if (l.state === 'shuffle') {
        // Two lurches: the front heaves up and forward, then the rear follows.
        const e = smooth(0, 1, k)
        pos.lerpVectors(l.from, l.to, e)
        yaw = turn(l.yawFrom, l.yawNow, smooth(0, 0.4, k))
        const heave = Math.abs(Math.sin(k * Math.PI * 2))
        pitch = -0.16 * heave; lift = 0.05 * heave; headPitch = 0.25
      } else if (l.state === 'dive') {
        // Slide to the edge, then nose first off it into the water.
        if (k < 0.6) { pos.lerpVectors(l.from, l.edge, smooth(0, 0.6, k)); headPitch = 0.2; pitch = -0.08 }
        else {
          const f = (k - 0.6) / 0.4
          pos.lerpVectors(l.edge, l.to, f); pos.z = l.edge.z + (l.to.z - l.edge.z) * f * f
          pitch = 0.9 * f; headPitch = -0.2
        }
        yaw = turn(l.yawFrom, Math.atan2(l.to.y - l.from.y, l.to.x - l.from.x), smooth(0, 0.25, k)); roll = 0
      } else if (l.state === 'under') hidden = true
      else if (l.state === 'haul') {
        // Surface head up off the edge, then heave up onto the float and back to its place.
        yaw = turn(Math.atan2(l.home.y - l.to.y, l.home.x - l.to.x), l.yaw, smooth(0.75, 1, k)); roll = 0
        if (k < 0.3) { const f = k / 0.3; pos.copy(l.to); pos.z = l.to.z + (l.edge.z - 0.3 - l.to.z) * smooth(0, 1, f); headPitch = 0.6; pitch = -0.5 }
        else { const f = (k - 0.3) / 0.7; pos.lerpVectors(l.to, l.home, smooth(0, 1, f)); pos.z = Math.min(l.home.z, l.edge.z - 0.3 + (l.home.z - l.edge.z + 0.3) * smooth(0, 0.35, f)); pitch = -0.3 * (1 - f); headPitch = 0.4 * (1 - f) - 0.1 * f; lift = 0.04 * Math.abs(Math.sin(f * Math.PI * 3)) }
      }
      const s = hidden ? 1e-4 : l.scale
      // Rolled on its side the body turns about its belly line: lift it so its side rests on the deck; front up, it turns about its tail.
      const sr = Math.abs(Math.sin(roll)), cr = Math.cos(roll)
      lift += (Math.sqrt((CHEST.ry * sr) ** 2 + (CHEST.rz * cr) ** 2) - CHEST.rz * cr) * l.scale
      lift += Math.max(0, Math.sin(-pitch)) * 0.95 * l.scale
      M.e.set(roll, pitch, yaw, 'ZYX')
      M.body.compose(M.v.set(pos.x, pos.y, pos.z + lift), M.q.setFromEuler(M.e), M.s.setScalar(s))
      this.body.setMatrixAt(i, M.body)
      M.part.compose(NECK, M.q2.setFromEuler(M.e2.set(0, -headPitch, headYaw, 'ZYX')), M.one)
      this.head.setMatrixAt(i, M.out.multiplyMatrices(M.body, M.part))
      // Each its own shade; darker and glossier straight out of the water.
      const c = M.c.setScalar(l.tint * (1 - 0.3 * l.wet))
      this.body.setColorAt(i, c); this.head.setColorAt(i, c)
      i++
    }
    this.body.count = this.head.count = i
    for (const m of [this.body, this.head]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true }
    // Rings spreading out where one went in.
    this.splashes.forEach((sp, j) => {
      const f = sp.t / 1.8
      M.body.compose(sp.at, M.q.identity(), M.s.setScalar(0.6 + f * 2.6))
      this.rings.setMatrixAt(j, M.body)
      this.rings.setColorAt(j, M.c.setScalar(0.55 * (1 - f)))
    })
    this.rings.count = this.splashes.length
    this.rings.instanceMatrix.needsUpdate = true
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true
  }
  private tmp = { e: new THREE.Euler(), e2: new THREE.Euler(), q: new THREE.Quaternion(), q2: new THREE.Quaternion(), s: new THREE.Vector3(), one: new THREE.Vector3(1, 1, 1), v: new THREE.Vector3(), p: new THREE.Vector3(), body: new THREE.Matrix4(), part: new THREE.Matrix4(), out: new THREE.Matrix4(), c: new THREE.Color() }
}
