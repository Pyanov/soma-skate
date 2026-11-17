import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { raycast, type Park } from '../sim/park/park.ts'

// Street life that never touches the sim: pigeons that peck around the park and the sidewalks and
// burst into the air when a skater comes through, then drift back; in the city, seagulls at the bay
// edge, the piers and EMB, some standing on the Ferry Building's roof, its clock tower and the street
// lights, that scatter crying and circle before they glide back (data/birds.json). Seeded placement;
// updated with the frame's time, so clips show them too. Drawn instanced: each kind of bird is three
// instanced meshes (body, head, wings), a handful of draw calls for a hundred birds; density (the
// quality preset) leaves some out.

type Kind = 'pigeon' | 'gull'
type Bird = { kind: Kind; perch: boolean; home: THREE.Vector3; pos: THREE.Vector3; heading: number; state: 'peck' | 'walk' | 'fly' | 'land'; t: number; vel: THREE.Vector3; turn: number; tint: THREE.Color; flock: number; shown: boolean }
/** One kind's instanced meshes: the body (merged static parts), the head (it pecks and turns), the wings (two per bird); where the head and wings sit on the body. */
type Kit = { body: THREE.InstancedMesh; head: THREE.InstancedMesh; wings: THREE.InstancedMesh; headAt: THREE.Vector3; wingAt: THREE.Vector3; size: number }

export type PigeonData = { flocks: number; perFlock: number; spread: number; ahead: number; scatter: number; scatterPerSpeed: number }
export type GullData = {
  seed: number; size: number
  areas: { label?: string; at: [number, number]; r: number; n: number; edge?: boolean }[]
  edgeDist: number
  roofs: { label?: string; centre: [number, number]; axis: [number, number]; length: number; width: number; z: number; n: number; inset: number }[]
  ledges: [number, number, number][]
  lamps: { near: [number, number, number][]; max: number; lift: number }
  scatter: number; scatterPerSpeed: number; perchReach: number; flight: [number, number]; turn: number; speed: number; cry: number; cryFar: number
}
export type BirdsData = { pigeons: PigeonData; gulls?: GullData }

const PIGEON_DEFAULTS: PigeonData = { flocks: 9, perFlock: 5, spread: 4, ahead: 6, scatter: 2.2, scatterPerSpeed: 0.35 }

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

function pigeonMesh(r: () => number): { g: THREE.Group; wings: THREE.Mesh[]; head: THREE.Mesh } {
  const g = new THREE.Group()
  const grey = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.62, 0.06, 0.42 + r() * 0.12), roughness: 0.85 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x2b2d33, roughness: 0.8 })
  const neck = new THREE.MeshStandardMaterial({ color: 0x5a6f62, roughness: 0.35, metalness: 0.3, emissive: 0x2a1840, emissiveIntensity: 0.25 })
  const orange = new THREE.MeshStandardMaterial({ color: 0xd8692e, roughness: 0.6 })
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), grey)
  body.scale.set(1.5, 0.9, 0.85); body.position.set(0, 0, 0.12)
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 6), dark)
  tail.rotation.z = Math.PI / 2; tail.position.set(-0.18, 0, 0.13)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), grey)
  head.position.set(0.13, 0, 0.23)
  const collar = new THREE.Mesh(new THREE.SphereGeometry(0.058, 8, 6), neck)
  collar.position.set(0.1, 0, 0.18)
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 5), dark)
  beak.rotation.z = -Math.PI / 2; beak.position.set(0.045, 0, -0.005); head.add(beak)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 5, 4), orange)
  eye.position.set(0.025, 0.035, 0.012); head.add(eye)
  const eye2 = eye.clone(); eye2.position.y = -0.035; head.add(eye2)
  const wings: THREE.Mesh[] = []
  for (const side of [1, -1]) {
    const w = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.09).translate(0, 0.045, 0), grey)
    w.material = grey.clone(); (w.material as THREE.MeshStandardMaterial).side = THREE.DoubleSide
    w.position.set(-0.02, side * 0.06, 0.16); w.rotation.x = side > 0 ? 0.2 : Math.PI - 0.2
    w.userData.side = side
    g.add(w); wings.push(w)
  }
  for (const y of [0.03, -0.03]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.07, 4), orange); leg.rotation.x = Math.PI / 2; leg.position.set(0.01, y, 0.035); g.add(leg) }
  g.add(body, tail, head, collar)
  body.castShadow = true
  return { g, wings, head }
}

/** A western gull: white head and body, a grey back and wings with black tips, a yellow bill with the red spot, pink legs. */
function gullMesh(r: () => number, size: number): { g: THREE.Group; wings: THREE.Mesh[]; head: THREE.Mesh } {
  const g = new THREE.Group()
  const white = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.1, 0.05, 0.9 + r() * 0.06), roughness: 0.75 })
  const grey = new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(0.6, 0.06, 0.48 + r() * 0.08), roughness: 0.8 })
  const black = new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.7 })
  const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c230, roughness: 0.5 })
  const red = new THREE.MeshStandardMaterial({ color: 0xd8402a, roughness: 0.5 })
  const pink = new THREE.MeshStandardMaterial({ color: 0xe0a0a0, roughness: 0.6 })
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), white)
  body.scale.set(1.75, 0.85, 0.8); body.position.set(0, 0, 0.13)
  const back = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), grey)
  back.scale.set(1.6, 0.8, 0.45); back.position.set(-0.02, 0, 0.17)
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 6), white)
  tail.rotation.z = Math.PI / 2; tail.position.set(-0.22, 0, 0.15)
  const tips = new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.12, 6), black)
  tips.rotation.z = Math.PI / 2; tips.position.set(-0.25, 0, 0.18)
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.052, 10, 8), white)
  head.position.set(0.16, 0, 0.25)
  const bill = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.075, 6), yellow)
  bill.rotation.z = -Math.PI / 2; bill.position.set(0.075, 0, -0.008); head.add(bill)
  const spot = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 4), red)
  spot.position.set(0.075, 0, -0.016); head.add(spot)
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 4), black)
  eye.position.set(0.028, 0.036, 0.014); head.add(eye)
  const eye2 = eye.clone(); eye2.position.y = -0.036; head.add(eye2)
  const wings: THREE.Mesh[] = []
  for (const side of [1, -1]) {
    // A long wing, grey with the black tip painted on by vertex colour (one draw per wing).
    const geo = new THREE.PlaneGeometry(0.26, 0.4, 2, 4).translate(0, 0.2, 0)
    const col: number[] = []
    const p = geo.getAttribute('position')
    for (let i = 0; i < p.count; i++) { const tip = p.getY(i) > 0.3; const c = tip ? new THREE.Color(0x1c1c20) : (grey.color as THREE.Color); col.push(c.r, c.g, c.b) }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const w = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8 }))
    w.position.set(-0.02, side * 0.06, 0.18); w.rotation.x = side > 0 ? 0.1 : Math.PI - 0.1
    w.scale.set(1, 1, 1)
    w.userData.side = side
    w.visible = true
    g.add(w); wings.push(w)
  }
  for (const y of [0.035, -0.035]) { const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.09, 4), pink); leg.rotation.x = Math.PI / 2; leg.position.set(0.01, y, 0.045); g.add(leg) }
  g.add(body, back, tail, tips, head)
  body.castShadow = true
  g.scale.setScalar(size)
  return { g, wings, head }
}

/** A part's geometry in the given frame, coloured by its material (vertex colours times the colour). */
function painted(m: THREE.Mesh, frame: THREE.Matrix4): THREE.BufferGeometry {
  let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
  g = g.applyMatrix4(frame)
  const mat = m.material as THREE.MeshStandardMaterial, n = g.getAttribute('position').count
  const old = g.getAttribute('color'), c = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) { const r = old ? old.getX(i) : 1, gg = old ? old.getY(i) : 1, b = old ? old.getZ(i) : 1; c.set([r * mat.color.r, gg * mat.color.g, b * mat.color.b], i * 3) }
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k)
  g.setAttribute('color', new THREE.BufferAttribute(c, 3))
  return g
}

/** A kind's kit from a sample bird (its parts merged by role), with room for n birds. */
function kitOf(sample: { g: THREE.Group; wings: THREE.Mesh[]; head: THREE.Mesh }, n: number, size: number): Kit {
  const { g, wings, head } = sample
  g.scale.set(1, 1, 1); g.updateMatrixWorld(true)
  const bodyParts: THREE.BufferGeometry[] = [], headParts: THREE.BufferGeometry[] = []
  const headInv = head.matrixWorld.clone().invert()
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || wings.includes(m)) return
    let inHead = false
    for (let q: THREE.Object3D | null = m; q; q = q.parent) if (q === head) inHead = true
    if (inHead) headParts.push(painted(m, headInv.clone().multiply(m.matrixWorld)))
    else bodyParts.push(painted(m, m.matrixWorld))
  })
  const w = wings[0], wingGeo = painted(w, new THREE.Matrix4())
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 })
  const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide })
  const make = (geo: THREE.BufferGeometry, m: THREE.Material, count: number, shadow: boolean) => {
    const im = new THREE.InstancedMesh(geo, m, count)
    im.count = 0; im.frustumCulled = false; im.castShadow = shadow
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    im.setColorAt(0, new THREE.Color(1, 1, 1))
    return im
  }
  return {
    body: make(mergeGeometries(bodyParts)!, mat, n, true), head: make(mergeGeometries(headParts)!, mat, n, false), wings: make(wingGeo, wingMat, n * 2, false),
    headAt: head.position.clone(), wingAt: new THREE.Vector3(w.position.x, Math.abs(w.position.y), w.position.z), size,
  }
}

/** Flocks a few metres ahead of the park's and city's spawn spots (at most `d.flocks`). */
export function flocksFor(park: Park, d: Partial<PigeonData> = {}): { x: number; y: number; n: number; spread: number }[] {
  const D = { ...PIGEON_DEFAULTS, ...d }
  const step = Math.max(1, Math.floor(park.spots.length / D.flocks))
  return park.spots.filter((_, i) => i % step === 0).slice(0, D.flocks).map((s) => ({ x: s.pos.x + Math.sin(s.heading) * D.ahead, y: s.pos.y + Math.cos(s.heading) * D.ahead, n: D.perFlock, spread: D.spread }))
}

/** The ground straight down at x, y (flat enough to stand on), or null. */
function groundAt(park: Park, x: number, y: number): THREE.Vector3 | null {
  const hit = raycast(park, { x, y, z: 60 }, { x: 0, y: 0, z: -1 }, 120)
  if (!hit || hit.normal.z < 0.95) return null
  return new THREE.Vector3(hit.point.x, hit.point.y, hit.point.z)
}

export class Pigeons {
  readonly group = Object.assign(new THREE.Group(), { name: 'birds' })
  private birds: Bird[] = []
  private time = 0
  private pd: PigeonData
  private gd: GullData | null = null
  private flocks = 0
  private kits = new Map<Kind, Kit>()
  private density = 1
  /** A flock of gulls took off (where, and their flock number): the game cries. */
  onScatter: (kind: Kind, at: THREE.Vector3) => void = () => {}

  /** Flocks on open ground near the given centres (site metres). */
  constructor(park: Park, flocks: { x: number; y: number; n: number; spread: number }[], seed = 11, d: Partial<PigeonData> = {}) {
    this.pd = { ...PIGEON_DEFAULTS, ...d }
    const r = rng(seed)
    for (const f of flocks) {
      const flock = this.flocks++
      for (let i = 0; i < f.n; i++) {
        const x = f.x + (r() - 0.5) * f.spread, y = f.y + (r() - 0.5) * f.spread
        const home = groundAt(park, x, y)
        if (!home) continue
        // Each pigeon its own grey (the kit's colours times a tint), as each used to get a material.
        const tint = new THREE.Color(1, 1, 1).multiplyScalar((0.42 + r() * 0.12) / 0.48)
        this.add('pigeon', false, home, r() * Math.PI * 2, r() * 3, tint, flock)
      }
    }
    this.kit('pigeon', () => pigeonMesh(rng(seed)), 1)
    this.layout()
  }

  private add(kind: Kind, perch: boolean, home: THREE.Vector3, heading: number, t: number, tint: THREE.Color, flock: number) {
    this.birds.push({ kind, perch, home, pos: home.clone(), heading, state: 'peck', t, vel: new THREE.Vector3(), turn: 1, tint, flock, shown: true })
  }

  /** The kind's instanced meshes (made once, sized for the birds there are). */
  private kit(kind: Kind, sample: () => { g: THREE.Group; wings: THREE.Mesh[]; head: THREE.Mesh }, size: number) {
    const n = this.birds.filter((b) => b.kind === kind).length
    if (!n || this.kits.has(kind)) return
    const k = kitOf(sample(), n, size)
    this.kits.set(kind, k)
    this.group.add(k.body, k.head, k.wings)
  }

  /** Quality: draw this share of the birds (the same ones each time, spread over the flocks). */
  setDensity(k: number) { this.density = Math.max(0, Math.min(1, k)); this.layout() }

  /** Which birds are drawn (density), and their poses written in at once. */
  private layout() {
    for (const [i, b] of this.birds.entries()) b.shown = ((i * 0.618034) % 1) < this.density
    this.pose()
  }

  /** Seagulls (the city): on the ground at the bay edge, the piers and EMB; on roofs, ledges and street lights. */
  addGulls(park: Park, d: GullData, lamps: number[][] = []) {
    this.gd = d
    const r = rng(d.seed)
    const white = new THREE.Color(1, 1, 1)
    const inRoof = (x: number, y: number) => d.roofs.some((f) => {
      const ax = new THREE.Vector2(...f.axis).normalize(), dx = x - f.centre[0], dy = y - f.centre[1]
      return Math.abs(dx * ax.x + dy * ax.y) < f.length / 2 + 1 && Math.abs(-dx * ax.y + dy * ax.x) < f.width / 2 + 1
    })
    for (const a of d.areas) {
      const flock = this.flocks++
      let placed = 0
      for (let tries = 0; tries < a.n * 25 && placed < a.n; tries++) {
        const ang = r() * Math.PI * 2, rad = Math.sqrt(r()) * a.r
        const home = groundAt(park, a.at[0] + Math.cos(ang) * rad, a.at[1] + Math.sin(ang) * rad)
        if (!home || inRoof(home.x, home.y)) continue   // not inside the Ferry Building (its walls are drawn, not solid)
        // At the bay edge: a sample edgeDist out (any way round) finds no ground, or ground far below (the water).
        if (a.edge && ![0, 1, 2, 3, 4, 5, 6, 7].some((k) => { const q = raycast(park, { x: home.x + Math.cos(k * Math.PI / 4) * d.edgeDist, y: home.y + Math.sin(k * Math.PI / 4) * d.edgeDist, z: home.z + 2 }, { x: 0, y: 0, z: -1 }, 3); return !q })) continue
        this.add('gull', false, home, r() * Math.PI * 2, r() * 3, white, flock)
        placed++
      }
    }
    for (const f of d.roofs) {
      const flock = this.flocks++
      const ax = new THREE.Vector2(...f.axis).normalize(), ay = new THREE.Vector2(-ax.y, ax.x)
      for (let i = 0; i < f.n; i++) {
        const side = i % 2 ? 1 : -1, u = ((Math.floor(i / 2) + 0.5) / Math.ceil(f.n / 2) - 0.5) * f.length * 0.9 + (r() - 0.5) * 4
        const x = f.centre[0] + ax.x * u + ay.x * side * (f.width / 2 - f.inset), y = f.centre[1] + ax.y * u + ay.y * side * (f.width / 2 - f.inset)
        // Facing out over the edge, more or less.
        this.add('gull', true, new THREE.Vector3(x, y, f.z), Math.atan2(ay.y * side, ay.x * side) + (r() - 0.5) * 1.2, r() * 3, white, flock)
      }
    }
    for (const [x, y, z] of d.ledges) this.add('gull', true, new THREE.Vector3(x, y, z), r() * Math.PI * 2, r() * 3, white, this.flocks++)
    let onLamps = 0
    for (const [cx, cy, cr] of d.lamps.near) {
      const near = lamps.filter((l) => Math.hypot(l[0] - cx, l[1] - cy) < cr).sort((p, q) => Math.hypot(p[0] - cx, p[1] - cy) - Math.hypot(q[0] - cx, q[1] - cy))
      for (const l of near) {
        if (onLamps >= d.lamps.max) break
        if (r() < 0.5) continue
        this.add('gull', true, new THREE.Vector3(l[0], l[1], l[2] + d.lamps.lift), r() * Math.PI * 2, r() * 3, white, this.flocks++)
        onLamps++
      }
    }
    this.kit('gull', () => gullMesh(rng(d.seed), 1), d.size)
    this.layout()
  }

  /** How many birds of a kind (for tests and the fps probe). */
  count(kind: Kind): number { return this.birds.filter((b) => b.kind === kind).length }
  /** Where the birds of a kind are now (tests). */
  positions(kind: Kind): THREE.Vector3[] { return this.birds.filter((b) => b.kind === kind).map((b) => b.pos.clone()) }

  /** dt seconds; skater position in site metres. */
  update(dt: number, skater: { x: number; y: number; z: number }, speed: number) {
    this.time += dt
    const s = new THREE.Vector3(skater.x, skater.y, skater.z)
    const flown = new Set<number>()
    for (const b of this.birds) {
      if (!b.shown) continue
      b.t -= dt
      const gull = b.kind === 'gull', G = this.gd, P = this.pd
      const d = b.pos.distanceTo(s)
      const reach = gull && G ? G.scatter + G.scatterPerSpeed * speed : P.scatter + P.scatterPerSpeed * speed
      // A perched gull only minds you up on its level (on the roof, or riding past right under it on a lamp).
      const level = !b.perch || !G || (s.z > b.pos.z - G.perchReach && s.z < b.pos.z + 1)
      if ((b.state === 'peck' || b.state === 'walk') && d < reach && level) {
        // Scatter: up and away from the skater, a little sideways (gulls higher and slower, then circle).
        b.state = 'fly'
        const away = b.pos.clone().sub(s).setZ(0).normalize()
        const side = new THREE.Vector3(-away.y, away.x, 0).multiplyScalar(Math.sin(b.home.y * 3.1))
        if (gull && G) {
          b.t = G.flight[0] + (((b.home.x * 7.3) % 1 + 1) % 1) * (G.flight[1] - G.flight[0])
          b.vel.copy(away.multiplyScalar(G.speed).add(side.multiplyScalar(1.5))).setZ(2.6)
          b.turn = Math.sin(b.home.x * 5.7) > 0 ? 1 : -1
          if (!flown.has(b.flock)) { flown.add(b.flock); this.onScatter('gull', b.pos) }
        } else {
          b.t = 4 + (b.home.x * 7.3 % 1 + 1) * 3
          b.vel.copy(away.multiplyScalar(4.5).add(side.multiplyScalar(2))).setZ(3.2)
        }
      }
      if (b.state === 'fly') {
        if (gull && G) {
          // Circling: the heading turns steadily, climbing a little at first, then holding height.
          const a = G.turn * b.turn * dt, c = Math.cos(a), sn = Math.sin(a)
          const vx = b.vel.x * c - b.vel.y * sn, vy = b.vel.x * sn + b.vel.y * c
          b.vel.x = vx; b.vel.y = vy
          b.vel.z = b.vel.z * (1 - 0.8 * dt)
        } else {
          b.vel.z -= 0.6 * dt
          b.vel.multiplyScalar(1 - 0.15 * dt)
        }
        b.pos.addScaledVector(b.vel, dt)
        b.heading = Math.atan2(b.vel.y, b.vel.x)
        if (b.t <= 0) { b.state = 'land'; b.t = 0 }
      } else if (b.state === 'land') {
        // Glide back home.
        const to = b.home.clone().sub(b.pos)
        const dist = to.length()
        if (dist < 0.15) { b.pos.copy(b.home); b.state = 'peck'; b.t = 1 + (b.home.x * 13.1 % 1 + 1) * 2 }
        else {
          const top = gull ? 6 : 4
          b.vel.lerp(to.normalize().multiplyScalar(Math.min(top, dist * 1.5 + 0.5)), Math.min(1, dt * 2))
          b.pos.addScaledVector(b.vel, dt)
          b.heading = Math.atan2(b.vel.y, b.vel.x)
        }
      } else if (b.t <= 0) {
        // Idle: peck (or, a gull, look about) a while, take a few steps (never off a perch).
        if (b.state === 'peck' && !b.perch) { b.state = 'walk'; b.t = 0.6 + ((b.home.y * 17.7 + this.time) % 1 + 1) % 1 * 1.2; b.heading += (((b.home.x + this.time) * 5.3) % 2) - 1 }
        else { b.state = 'peck'; b.t = 1 + ((b.home.x * 11.9 + this.time) % 1 + 1) % 1 * 2.5; if (b.perch) b.heading += (((b.home.y + this.time) * 3.1) % 1.2) - 0.6 }
      }
      if (b.state === 'walk') {
        const pace = gull ? 0.35 : 0.25
        b.pos.x += Math.cos(b.heading) * pace * dt; b.pos.y += Math.sin(b.heading) * pace * dt
        if (b.pos.distanceTo(b.home) > 1.5) b.heading = Math.atan2(b.home.y - b.pos.y, b.home.x - b.pos.x)
      }
    }
    this.pose()
  }

  /** Every drawn bird's body, head and wings into its kind's instanced meshes. */
  private pose() {
    const fill = new Map<Kind, number>()
    const M = this.tmp
    for (const b of this.birds) {
      const kit = this.kits.get(b.kind)
      if (!kit || !b.shown) continue
      const i = fill.get(b.kind) ?? 0
      fill.set(b.kind, i + 1)
      const gull = b.kind === 'gull', flying = b.state === 'fly' || b.state === 'land'
      // The body: where it is, its heading, a tilt in the air, its size.
      M.euler.set(0, flying ? (gull ? -0.1 + 0.25 * b.turn * (b.state === 'fly' ? 1 : 0) : -0.25) : 0, b.heading)
      M.body.compose(b.pos, M.q.setFromEuler(M.euler), M.s.setScalar(kit.size))
      kit.body.setMatrixAt(i, M.body); kit.body.setColorAt(i, b.tint)
      // The head: pecking (a pigeon) or looking about (a gull).
      const headZ = gull ? kit.headAt.z : b.state === 'peck' ? kit.headAt.z - 0.03 - Math.max(0, Math.sin(this.time * 9 + b.home.y * 5)) * 0.08 : kit.headAt.z
      const look = gull && !flying && b.state === 'peck' ? Math.sin(this.time * 0.7 + b.home.x * 3) * 0.6 : 0
      M.part.compose(M.v.set(kit.headAt.x, kit.headAt.y, headZ), M.q.setFromEuler(M.euler2.set(0, 0, look)), M.s.setScalar(1))
      kit.head.setMatrixAt(i, M.out.multiplyMatrices(M.body, M.part)); kit.head.setColorAt(i, b.tint)
      // The wings: flapping in the air (a gull mostly glides, beating now and then); folded back along a standing gull.
      let flap = 0
      if (flying) flap = gull ? Math.sin(this.time * 12 + b.home.x) * 0.7 * Math.max(0.15, Math.sin(this.time * 0.9 + b.home.y) * 0.5 + 0.5) : Math.sin(this.time * 38 + b.home.x) * 1.1
      for (const side of [1, -1]) {
        const rest = gull ? 0.05 : 0.2
        M.euler2.set(side > 0 ? rest + flap : Math.PI - rest - flap, 0, gull && !flying ? 1.47 : 0)
        M.s.set(gull && !flying ? 0.32 : 1, gull && !flying ? 0.72 : 1, 1)
        M.part.compose(M.v.set(kit.wingAt.x, side * kit.wingAt.y, gull ? (flying ? 0.18 : 0.205) : kit.wingAt.z), M.q.setFromEuler(M.euler2), M.s)
        kit.wings.setMatrixAt(i * 2 + (side > 0 ? 0 : 1), M.out.multiplyMatrices(M.body, M.part)); kit.wings.setColorAt(i * 2 + (side > 0 ? 0 : 1), b.tint)
      }
    }
    for (const [kind, kit] of this.kits) {
      const n = fill.get(kind) ?? 0
      kit.body.count = kit.head.count = n; kit.wings.count = n * 2
      for (const m of [kit.body, kit.head, kit.wings]) { m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true }
    }
  }
  private tmp = { euler: new THREE.Euler(), euler2: new THREE.Euler(), q: new THREE.Quaternion(), s: new THREE.Vector3(), v: new THREE.Vector3(), body: new THREE.Matrix4(), part: new THREE.Matrix4(), out: new THREE.Matrix4() }
}