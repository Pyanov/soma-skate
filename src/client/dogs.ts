import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { raycast, type Park } from '../sim/park/park.ts'

// Off-leash dogs in the city's parks (data/dogs.json), view only like the pigeons: client side,
// seeded, never in the sim or the replays. Each dog belongs to an owner standing on the lawn (a
// crowd pedestrian, pedestrians.json type dogOwner) and roams round them, sniffing, now and then
// doing the zoomies. A skater riding past gets chased: the dog runs alongside a little way off,
// barking, then loses interest and trots back to its owner. Updated with the frame's time like
// the pigeons (so clips show them); a --life shot settles them a few seconds first. Drawn as
// instanced parts in the characters' style (round head, googly eyes), one draw per part.

export type DogData = {
  seed: number; parks: { name: string; at: [number, number]; radius: number }[]; perOwner: [number, number]
  roam: number; notice: number; minSpeed: number; side: [number, number]; lead: [number, number]; maxRun: number; trot: number
  chase: [number, number]; leash: number; lost: number; cooldown: number; bark: [number, number]; size: [number, number]
  coats: string[]; collars: string[]; lod: { drawDistance: number }
}
export type DogSkater = { x: number; y: number; z: number; vx: number; vy: number }
/** A bark this frame: where, and how big the dog is (small dogs yap higher). */
export type Bark = { x: number; y: number; z: number; size: number }

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const between = (r: () => number, [a, b]: [number, number]) => a + (b - a) * r()
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

type State = 'roam' | 'sniff' | 'zoom' | 'chase' | 'back'
type Dog = {
  ox: number; oy: number; oz: number                  // the owner
  x: number; y: number; z: number; h: number; v: number
  state: State; t: number; tx: number; ty: number; side: number; lead: number; cool: number; barkIn: number; barkAge: number
  phase: number; size: number; coat: THREE.Color; collar: THREE.Color; seed: number; ears: number
  zoomA: number; zoomC: [number, number]
}

// The dog's parts, in its own frame (x forward, y left, z up; a medium dog, ~0.55 m at the shoulder).
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const SH = V(0.2, 0, 0.42), HIP = V(-0.2, 0, 0.42), LEG = 0.36, NECK = V(0.27, 0, 0.5), TAIL = V(-0.31, 0, 0.5)
function parts() {
  const sph = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h)
  const M = (g: THREE.BufferGeometry[]) => mergeGeometries(g.map((x) => (x.index ? x.toNonIndexed() : x)).map((x) => { for (const n of Object.keys(x.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') x.deleteAttribute(n); return x }))!
  return {
    body: M([new THREE.CapsuleGeometry(0.15, 0.36, 4, 10).rotateZ(Math.PI / 2).scale(1, 0.85, 1).translate(0, 0, 0.47), sph(0.15).scale(1, 0.9, 1.05).translate(0.2, 0, 0.5)]),
    // Head frame: at the neck.
    head: M([sph(0.13, 12, 10).translate(0.1, 0, 0.1), new THREE.CapsuleGeometry(0.065, 0.1, 3, 8).rotateZ(Math.PI / 2).translate(0.24, 0, 0.06)]),
    nose: sph(0.03, 6, 5).translate(0.32, 0, 0.075),
    eyes: M([1, -1].map((s) => sph(0.04, 8, 6).scale(0.6, 1, 1.15).translate(0.19, s * 0.055, 0.15))),
    pupils: M([1, -1].map((s) => sph(0.019, 6, 5).translate(0.215, s * 0.052, 0.145))),
    tongue: new THREE.BoxGeometry(0.06, 0.045, 0.012).translate(0.27, 0, 0.0),
    collar: new THREE.TorusGeometry(0.11, 0.022, 6, 14).rotateY(Math.PI / 2 - 0.4).translate(0.03, 0, 0.0),
    // An ear (floppy or pricked: scaled per dog), hanging from its pivot on the head.
    ear: sph(0.05, 7, 5).scale(0.5, 0.35, 1.3).translate(0, 0, -0.05),
    // A leg from its hip or shoulder, down (-z); the paw at the end.
    leg: M([new THREE.CylinderGeometry(0.04, 0.032, LEG, 6).rotateX(Math.PI / 2).translate(0, 0, -LEG / 2), sph(0.042, 6, 5).scale(1.3, 1, 0.7).translate(0.015, 0, -LEG)]),
    tail: new THREE.CapsuleGeometry(0.025, 0.22, 3, 6).translate(0, 0, 0.12),
  }
}
type Part = keyof ReturnType<typeof parts>

export class Dogs {
  readonly group = new THREE.Group()
  readonly dogs: Dog[] = []
  private d: DogData
  private park: Park
  private meshes = new Map<Part, THREE.InstancedMesh>()
  private looks = new Map<Part, Record<'grey' | 'cute' | 'real', THREE.Material>>()
  private style = ''
  private n = new Map<Part, number>()
  private time = 0
  private r: () => number
  private lastBarkAt = -1

  /** Dogs for the owners standing in the parks (crowd positions of type dogOwner). */
  constructor(park: Park, d: DogData, owners: { x: number; y: number; z: number }[], gradient: THREE.Texture | null) {
    this.d = d; this.park = park
    this.r = rng(d.seed)
    const r = this.r
    const parksHere = d.parks.filter((p) => this.ground(p.at[0], p.at[1], 300) !== null)
    for (const o of owners) {
      if (!parksHere.some((p) => Math.hypot(p.at[0] - o.x, p.at[1] - o.y) < p.radius)) continue
      const n = Math.round(between(r, d.perOwner))
      for (let i = 0; i < n; i++) {
        const a = r() * Math.PI * 2, rr = 1.5 + r() * d.roam * 0.6
        const x = o.x + Math.cos(a) * rr, y = o.y + Math.sin(a) * rr
        this.dogs.push({
          ox: o.x, oy: o.y, oz: o.z, x, y, z: this.ground(x, y, o.z) ?? o.z, h: r() * Math.PI * 2, v: 0,
          state: 'roam', t: r() * 3, tx: x, ty: y, side: 1, lead: 0, cool: 0, barkIn: 0, barkAge: 9,
          phase: r() * 6, size: between(r, d.size), coat: new THREE.Color(d.coats[Math.floor(r() * d.coats.length)]), collar: new THREE.Color(d.collars[Math.floor(r() * d.collars.length)]),
          seed: r(), ears: r() < 0.55 ? 1 : 0, zoomA: 0, zoomC: [x, y],
        })
      }
    }
    const geo = parts()
    const cap = (k: Part) => Math.max(1, this.dogs.length * (k === 'leg' ? 4 : k === 'ear' ? 2 : 1))
    for (const [k, g] of Object.entries(geo) as [Part, THREE.BufferGeometry][]) {
      const shiny = k === 'eyes' || k === 'pupils' || k === 'nose'
      const looks = {
        grey: new THREE.MeshLambertMaterial({ color: 0xffffff }),
        cute: gradient ? new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: gradient }) : new THREE.MeshLambertMaterial({ color: 0xffffff }),
        real: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: shiny ? 0.25 : 0.9 }),
      }
      const mesh = new THREE.InstancedMesh(g, looks.cute, cap(k))
      mesh.count = 0
      mesh.castShadow = k === 'body' || k === 'head' || k === 'leg'
      mesh.frustumCulled = false
      mesh.name = `dogs:${k}`
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap(k) * 3).fill(1), 3)
      this.meshes.set(k, mesh); this.looks.set(k, looks)
      this.group.add(mesh)
    }
    this.group.name = 'dogs'
    this.draw(null)
  }

  private ground(x: number, y: number, z: number): number | null {
    const h = raycast(this.park, { x, y, z: z + 3 }, { x: 0, y: 0, z: -1 }, 400)
    return h ? h.point.z : null
  }

  /** Match the renderer's look. */
  setStyle(style: string) {
    if (style === this.style) return
    this.style = style
    const key = (style === 'real' || style === 'grey' ? style : 'cute') as 'grey' | 'cute' | 'real'
    for (const [k, mesh] of this.meshes) mesh.material = this.looks.get(k)![key]
  }

  /**
   * Step the dogs dt seconds with the skater where it is (null: none), and draw them for the
   * camera. Returns the barks this step (for the sound).
   */
  update(dt: number, skater: DogSkater | null, camera: THREE.Camera | null): Bark[] {
    const D = this.d, r = this.r, barks: Bark[] = []
    this.time += dt
    dt = Math.min(dt, 0.1)
    const sp = skater ? Math.hypot(skater.vx, skater.vy) : 0
    for (const g of this.dogs) {
      g.t -= dt; g.cool -= dt; g.barkAge += dt
      const dsk = skater ? Math.hypot(skater.x - g.x, skater.y - g.y) : 1e9
      const farFromOwner = skater ? Math.hypot(skater.x - g.ox, skater.y - g.oy) : 1e9
      // A skater rolling by: the chase is on.
      if (skater && g.state !== 'chase' && g.cool <= 0 && sp > D.minSpeed && dsk < D.notice && farFromOwner < D.leash * 0.8 && Math.abs(skater.z - g.z) < 3) {
        g.state = 'chase'; g.t = between(r, D.chase); g.barkIn = 0.15 + r() * 0.3
        const sx = -skater.vy / (sp || 1), sy = skater.vx / (sp || 1)
        g.side = (g.x - skater.x) * sx + (g.y - skater.y) * sy > 0 ? 1 : -1
        g.lead = between(r, D.lead)
      }
      let tx = g.tx, ty = g.ty, want = 0
      if (g.state === 'chase' && skater) {
        // Alongside the skater, a little off to the side, ahead or behind.
        const ux = skater.vx / (sp || 1), uy = skater.vy / (sp || 1)
        const off = lerp(D.side[0], D.side[1], g.seed)
        tx = skater.x + ux * g.lead - uy * off * g.side; ty = skater.y + uy * g.lead + ux * off * g.side
        const gap = Math.hypot(tx - g.x, ty - g.y)
        want = Math.min(D.maxRun * (0.8 + g.size * 0.2), sp + gap * 2.2)
        g.barkIn -= dt
        if (g.barkIn <= 0) { g.barkIn = between(r, D.bark); g.barkAge = 0; barks.push({ x: g.x, y: g.y, z: g.z + 0.5, size: g.size }) }
        if (g.t <= 0 || Math.hypot(g.x - g.ox, g.y - g.oy) > D.leash || dsk > D.lost) { g.state = 'back'; g.cool = D.cooldown; g.t = 0 }
      } else if (g.state === 'back') {
        tx = g.ox + Math.cos(g.seed * 9) * 2; ty = g.oy + Math.sin(g.seed * 9) * 2
        want = D.trot * 1.4
        if (Math.hypot(tx - g.x, ty - g.y) < 1.2) { g.state = 'roam'; g.t = 0 }
      } else if (g.state === 'zoom') {
        // The zoomies: fast laps round a spot on the lawn.
        g.zoomA += dt * 2.4
        tx = g.zoomC[0] + Math.cos(g.zoomA) * 4; ty = g.zoomC[1] + Math.sin(g.zoomA) * 4
        want = 6
        if (g.t <= 0) { g.state = 'roam'; g.t = 0 }
      } else {
        // Roaming: trot to a spot near the owner, sniff a while, again; the zoomies now and then.
        const at = Math.hypot(g.tx - g.x, g.ty - g.y) < 0.4
        if (g.state === 'sniff' && g.t <= 0) g.state = 'roam'
        if (g.state === 'roam' && (at || g.t <= -8)) {
          if (r() < 0.12) { g.state = 'zoom'; g.t = 3 + r() * 3; g.zoomA = r() * 6; g.zoomC = [g.ox + (r() - 0.5) * 8, g.oy + (r() - 0.5) * 8] }
          else {
            g.state = 'sniff'; g.t = 1 + r() * 3.5
            const a = r() * Math.PI * 2, rr = 1.5 + r() * D.roam
            g.tx = g.ox + Math.cos(a) * rr; g.ty = g.oy + Math.sin(a) * rr
          }
        }
        tx = g.tx; ty = g.ty
        want = g.state === 'sniff' ? 0 : D.trot * (0.8 + g.seed * 0.4)
      }
      // Run toward the target, turning at a dog's rate; slow to a stop on arrival.
      const dx = tx - g.x, dy = ty - g.y, dist = Math.hypot(dx, dy)
      if (dist > 0.05) {
        const turn = (g.state === 'chase' ? 7 : 4) * dt
        g.h += Math.max(-turn, Math.min(turn, wrap(Math.atan2(dy, dx) - g.h)))
      }
      if (dist < 0.5 && g.state !== 'chase' && g.state !== 'zoom') want = Math.min(want, dist * 2)
      g.v = lerp(g.v, want, Math.min(1, dt * (g.state === 'chase' ? 5 : 3)))
      g.x += Math.cos(g.h) * g.v * dt; g.y += Math.sin(g.h) * g.v * dt
      const gz = this.ground(g.x, g.y, g.z)
      if (gz !== null && Math.abs(gz - g.z) < 2) g.z = gz
      g.phase += (g.v * dt) / (0.55 * g.size + (g.v > 3 ? 0.4 : 0)) * Math.PI
    }
    // Dogs keep a little apart (a pack running alongside spreads out instead of piling up).
    for (let i = 0; i < this.dogs.length; i++) for (let j = i + 1; j < this.dogs.length; j++) {
      const a = this.dogs[i], b = this.dogs[j], dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy), min = 0.45 * (a.size + b.size)
      if (dd < min && dd > 1e-4) { const push = (min - dd) / 2, ux = dx / dd, uy = dy / dd; a.x -= ux * push; a.y -= uy * push; b.x += ux * push; b.y += uy * push }
    }
    // Not too many barks at once (a pack chasing barks over each other, but not as a wall of sound).
    const out = this.time - this.lastBarkAt > 0.12 ? barks.slice(0, 2) : []
    if (out.length) this.lastBarkAt = this.time
    this.draw(camera)
    return out
  }

  /** A shot of one moment: the dogs' last few seconds played out (the skater coming along its line). */
  settle(skater: DogSkater | null, seconds = 4) {
    const steps = Math.round(seconds * 30)
    for (let i = 0; i < steps; i++) {
      const back = (steps - i) / 30
      this.update(1 / 30, skater ? { ...skater, x: skater.x - skater.vx * back, y: skater.y - skater.vy * back } : null, null)
    }
  }

  private m = new THREE.Matrix4()
  private q = new THREE.Quaternion()
  private put(k: Part, m: THREE.Matrix4, c: THREE.Color) {
    const mesh = this.meshes.get(k)!, i = this.n.get(k)!
    if (i >= mesh.instanceMatrix.count) return
    mesh.setMatrixAt(i, m); mesh.instanceColor!.setXYZ(i, c.r, c.g, c.b)
    this.n.set(k, i + 1)
  }

  private draw(camera: THREE.Camera | null) {
    for (const k of this.meshes.keys()) this.n.set(k, 0)
    const cam = camera ? new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld) : null
    const T = this.time
    for (const g of this.dogs) {
      if (cam && Math.hypot(g.x - cam.x, g.y - cam.y) > this.d.lod.drawDistance) continue
      const gallop = Math.min(1, Math.max(0, (g.v - 2.5) / 2)), move = Math.min(1, g.v / 1.2)
      const ph = g.phase
      const bob = move * Math.abs(Math.sin(ph)) * (0.02 + gallop * 0.04)
      const pitch = gallop * Math.sin(ph) * 0.12
      const sniff = g.state === 'sniff' ? 1 : 0
      const B = new THREE.Matrix4().compose(V(g.x, g.y, g.z + bob * g.size), this.q.setFromAxisAngle(V(0, 0, 1), g.h), V(g.size, g.size, g.size)).multiply(new THREE.Matrix4().makeRotationY(pitch))
      this.put('body', B, g.coat)
      // Legs: a trot swings diagonal pairs, a gallop the front pair then the back pair.
      const legs: [THREE.Vector3, number, number][] = [[SH, 1, 0], [SH, -1, Math.PI], [HIP, 1, Math.PI], [HIP, -1, 0]]
      for (const [at, side, off] of legs) {
        const front = at === SH
        const o = gallop > 0.5 ? (front ? 0 : Math.PI * 0.8) + (side > 0 ? 0 : 0.35) : off
        const swing = Math.sin(ph + o) * (0.35 + gallop * 0.45) * move
        this.m.copy(B).multiply(new THREE.Matrix4().makeTranslation(at.x, side * 0.085, at.z)).multiply(new THREE.Matrix4().makeRotationY(-swing))
        this.put('leg', this.m, g.coat)
      }
      // Head: down sniffing, up and snapping when it barks; it looks at what it chases.
      const bark = Math.max(0, 1 - g.barkAge / 0.25)
      const hp = sniff * (0.7 + Math.sin(T * 9 + g.seed * 7) * 0.08) - bark * 0.35 - gallop * 0.1
      const hy = g.state === 'roam' || g.state === 'sniff' ? Math.sin(T * 0.7 + g.seed * 9) * 0.35 : 0
      const H = new THREE.Matrix4().copy(B).multiply(new THREE.Matrix4().makeTranslation(NECK.x, 0, NECK.z)).multiply(new THREE.Matrix4().makeRotationZ(hy)).multiply(new THREE.Matrix4().makeRotationY(hp))
      this.put('head', H, g.coat)
      this.put('nose', H, DARK)
      this.put('eyes', H, WHITE)
      this.put('pupils', H, DARK)
      this.put('collar', H, g.collar)
      if (move > 0.6 || bark > 0) this.put('tongue', new THREE.Matrix4().copy(H).multiply(new THREE.Matrix4().makeRotationY(bark * 0.4)), TONGUE)
      for (const side of [1, -1]) {
        // Floppy ears flap with the run; pricked ones stand up.
        const flap = Math.sin(ph * 2 + side) * 0.3 * move
        const e = new THREE.Matrix4().copy(H).multiply(new THREE.Matrix4().makeTranslation(0.06, side * 0.1, 0.2))
        if (g.ears) e.multiply(new THREE.Matrix4().makeRotationX(side * (0.5 + flap))).multiply(new THREE.Matrix4().makeScale(1, 1, 1))
        else e.multiply(new THREE.Matrix4().makeRotationX(Math.PI + side * 0.25)).multiply(new THREE.Matrix4().makeScale(1.1, 1.2, 0.8))
        this.put('ear', e, g.coat)
      }
      // Tail: wagging hard roaming and coming back, up and still in the chase.
      const wag = g.state === 'chase' ? Math.sin(T * 6) * 0.15 : Math.sin(T * (14 + g.seed * 6)) * 0.7
      const lift = g.state === 'chase' ? 0.5 : 0.9
      this.m.copy(B).multiply(new THREE.Matrix4().makeTranslation(TAIL.x, 0, TAIL.z)).multiply(new THREE.Matrix4().makeRotationZ(wag)).multiply(new THREE.Matrix4().makeRotationY(-lift))
      this.put('tail', this.m, g.coat)
    }
    for (const [k, mesh] of this.meshes) { mesh.count = this.n.get(k)!; mesh.visible = mesh.count > 0; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true }
  }
}

const WHITE = new THREE.Color('#ffffff'), DARK = new THREE.Color('#141414'), TONGUE = new THREE.Color('#e86a7a')
