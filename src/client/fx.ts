import * as THREE from 'three'
import type { Park } from '../sim/park/park.ts'
import type { Thing } from '../sim/thing.ts'

// Juice around the board (view only; numbers in data/effects.json): sparks off metal grinds, concrete
// dust on hard landings, bails and powerslides, wheel smoke on long powerslides, and grit off slides. Particles live in two instanced pools (one draw call each):
// each particle is written once when it is born (where, its velocity, birth time, life, size,
// colour) and the vertex shader moves, grows and fades it, so the CPU only spawns. Both materials
// are transparent, so the real look's AO pass leaves them out, and they keep the frame's alpha (the
// cute look's outline tags) and write no depth (no outlines round them). Everything spawned comes
// from the skaters' Things and a seeded random stream, so clips get the same effects as play.

type Range = [number, number]
export type FxData = {
  sparks: { max: number; perMetre: number; minSpeed: number; drag: number; life: Range; speed: Range; back: number; up: Range; spread: number; gravity: number; size: number; stretch: number; colors: string[]; metalRange: number; npcRange: number }
  dust: { max: number; life: Range; size: Range; minImpact: number; impactFull: number; count: Range; bail: number; slidePerSecond: number; spread: Range; rise: number; drag: number; color: string; opacity: number
    smoke: { afterTicks: number; perSecond: number; life: Range; size: Range; color: string; opacity: number }
    grind?: { perMetre: number; minSpeed: number; life: Range; size: Range; color: string; opacity: number } }
}

const VERT = /* glsl */ `
attribute vec3 aP0, aV0;
attribute vec4 aT;      // birth, life, size0, size1
attribute vec4 aColor;
uniform float uTime, uGravity, uDrag, uStretch;
varying vec4 vColor;
varying vec2 vUv;
varying float vAge;
void main() {
  float age = uTime - aT.x;
  vUv = uv;
  if (age < 0.0 || age > aT.y) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float u = age / aT.y;
  // Drag: the velocity decays (k), integrated; gravity on top.
  float k = uDrag > 0.0 ? (1.0 - exp(-uDrag * age)) / uDrag : age;
  vec3 p = aP0 + aV0 * k + vec3(0.0, 0.0, -0.5 * uGravity * age * age);
  vec3 vel = aV0 * exp(-uDrag * age) + vec3(0.0, 0.0, -uGravity * age);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  float size = mix(aT.z, aT.w, u);
  vec2 corner = uv - 0.5;
  // Sparks stretch along their motion on screen; puffs are round billboards.
  vec3 vv = (modelViewMatrix * vec4(vel, 0.0)).xyz;
  vec2 dir = length(vv.xy) > 1e-4 ? normalize(vv.xy) : vec2(1.0, 0.0);
  vec2 side = vec2(-dir.y, dir.x);
  float len = size + uStretch * length(vel);
  mv.xy += uStretch > 0.0 ? dir * corner.x * len + side * corner.y * size : corner * size;
  gl_Position = projectionMatrix * mv;
  vColor = aColor;
  vAge = u;
}`

const SPARK_FRAG = /* glsl */ `
varying vec4 vColor; varying vec2 vUv; varying float vAge;
void main() {
  vec2 d = (vUv - 0.5) * 2.0;
  // A hot core going orange as it cools; drawn over (not added), so it shows on pale concrete too.
  float r = length(d);
  float a = smoothstep(1.0, 0.55, r) * (1.0 - vAge * vAge);
  vec3 c = mix(mix(vec3(1.0, 0.98, 0.78), vColor.rgb, smoothstep(0.15, 0.7, r)), vColor.rgb * 0.8, vAge);
  gl_FragColor = vec4(c * 1.15, a * vColor.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

const DUST_FRAG = /* glsl */ `
varying vec4 vColor; varying vec2 vUv; varying float vAge;
void main() {
  vec2 d = (vUv - 0.5) * 2.0;
  float r = length(d);
  // A soft puff with a lumpy edge, fading as it spreads.
  float lump = 0.12 * sin(atan(d.y, d.x) * 5.0 + vColor.a * 40.0);
  float a = smoothstep(1.0, 0.35 + lump, r) * (1.0 - smoothstep(0.35, 1.0, vAge)) * smoothstep(0.0, 0.08, vAge);
  gl_FragColor = vec4(vColor.rgb, a * vColor.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`

/** One instanced pool of particles; a ring buffer written as they are born. */
class Pool {
  readonly mesh: THREE.Mesh
  private p0: THREE.InstancedBufferAttribute
  private v0: THREE.InstancedBufferAttribute
  private tt: THREE.InstancedBufferAttribute
  private col: THREE.InstancedBufferAttribute
  private next = 0
  private dirty = false
  readonly mat: THREE.ShaderMaterial

  constructor(max: number, frag: string, additive: boolean, drag: number, gravity: number, stretch: number) {
    const g = new THREE.InstancedBufferGeometry()
    const quad = new THREE.PlaneGeometry(1, 1)
    g.index = quad.index
    g.setAttribute('position', quad.getAttribute('position'))
    g.setAttribute('uv', quad.getAttribute('uv'))
    this.p0 = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
    this.v0 = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
    this.tt = new THREE.InstancedBufferAttribute(new Float32Array(max * 4).fill(-1e6), 4)
    this.col = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4)
    for (const a of [this.p0, this.v0, this.tt, this.col]) a.setUsage(THREE.DynamicDrawUsage)
    g.setAttribute('aP0', this.p0); g.setAttribute('aV0', this.v0); g.setAttribute('aT', this.tt); g.setAttribute('aColor', this.col)
    g.instanceCount = max
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uGravity: { value: gravity }, uDrag: { value: drag }, uStretch: { value: stretch } },
      vertexShader: VERT, fragmentShader: frag,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false,
      // Colour adds or blends over; the frame's alpha is kept, so the cute look's outline tags stay.
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: additive ? THREE.OneFactor : THREE.SrcAlphaFactor, blendDst: additive ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor,
    })
    this.mesh = new THREE.Mesh(g, this.mat)
    this.mesh.frustumCulled = false
    this.mesh.renderOrder = 5
  }

  spawn(p: THREE.Vector3, v: THREE.Vector3, birth: number, life: number, s0: number, s1: number, c: THREE.Color, alpha: number) {
    const i = this.next
    this.next = (this.next + 1) % this.tt.count
    this.p0.setXYZ(i, p.x, p.y, p.z); this.v0.setXYZ(i, v.x, v.y, v.z)
    this.tt.setXYZW(i, birth, life, s0, s1); this.col.setXYZW(i, c.r, c.g, c.b, alpha)
    this.dirty = true
  }

  flush(time: number) {
    this.mat.uniforms.uTime.value = time
    if (!this.dirty) return
    for (const a of [this.p0, this.v0, this.tt, this.col]) a.needsUpdate = true
    this.dirty = false
  }

  clear() { (this.tt.array as Float32Array).fill(-1e6); this.tt.needsUpdate = true }
}

/** A small seeded random stream (mulberry32): effects repeat between play and clips. */
function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

type Seen = { land: number; bail: number; carry: number; smokeCarry: number; dustCarry: number; gritCarry: number }

export class Fx {
  readonly group = new THREE.Group()
  private d: FxData
  private park: Park
  private sparks: Pool
  private dust: Pool
  private time = 0
  private rand = rng(7)
  private seen = new Map<number, Seen>()
  private metal = new Map<number, boolean>()   // grind line id -> metal (a rail, coping, or a ledge with angle iron or a flat bar)
  private sparkColors: THREE.Color[]
  private dustColor: THREE.Color
  private smokeColor: THREE.Color
  private gritColor: THREE.Color
  /** Per frame: particles spawned (for the fps probe). */
  stats = { sparks: 0, dust: 0 }

  /** overlay: unused now (the speed lines' canvas went after it); kept so callers need not change. */
  constructor(d: FxData, park: Park, overlay: HTMLElement | null) {
    this.d = d
    this.park = park
    this.group.name = 'fx'
    this.sparks = new Pool(d.sparks.max, SPARK_FRAG, false, d.sparks.drag, d.sparks.gravity, d.sparks.stretch)
    this.dust = new Pool(d.dust.max, DUST_FRAG, false, d.dust.drag, -d.dust.rise, 0)
    this.group.add(this.sparks.mesh, this.dust.mesh)
    this.sparkColors = d.sparks.colors.map((c) => new THREE.Color(c))
    this.dustColor = new THREE.Color(d.dust.color)
    this.smokeColor = new THREE.Color(d.dust.smoke.color)
    this.gritColor = new THREE.Color(d.dust.grind?.color ?? d.dust.color)
    void overlay   // the speed lines' canvas went (round 4 of the look: speed reads from the lens, the field of view, the camera and the sound)
  }

  /** Forget everything in flight (a new world, a clip from the start). */
  reset() { this.sparks.clear(); this.dust.clear(); this.seen.clear(); this.time = 0; this.rand = rng(7) }

  /**
   * Advance by dt seconds: spawn for each skater (you first, then the NPCs near the camera) from its
   * Thing. tick is the world tick (landings and bails are
   * spotted by when they happened, so each spawns once).
   */
  update(dt: number, skaters: readonly Thing[], camera: THREE.Camera, radius: number) {
    this.time += dt
    this.stats = { sparks: 0, dust: 0 }
    const cam = camera.position, far = (t: Thing, c: { x: number; y: number; z: number }) => Math.hypot(t.pos.x - c.x, t.pos.y - c.y, t.pos.z - c.z) > this.d.sparks.npcRange
    for (const [i, t] of skaters.entries()) {
      if (!t.alive) continue
      if (i > 0 && far(t, cam) && (!this.camera2 || far(t, this.camera2))) continue
      this.skater(t, dt, radius)
    }
    this.sparks.flush(this.time); this.dust.flush(this.time)
  }
  /** Settings > Camera > Reduce motion (kept for callers; the speed lines it turned off are gone). */
  calm = false
  /** Split screen: player 2's camera (its skaters get effects too). */
  camera2: { x: number; y: number; z: number } | null = null

  private skater(t: Thing, dt: number, radius: number) {
    let s = this.seen.get(t.id)
    if (!s) { s = { land: t.lastLand?.tick ?? -1, bail: t.state === 'bail' ? 1 : 0, carry: 0, smokeCarry: 0, dustCarry: 0, gritCarry: 0 }; this.seen.set(t.id, s) }
    const r = this.rand, up = new THREE.Vector3(t.up.x, t.up.y, t.up.z)
    const contact = new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z).addScaledVector(up, -radius)
    const fwd = new THREE.Vector3(t.fwd.x, t.fwd.y, t.fwd.z)
    const vel = new THREE.Vector3(t.vel.x, t.vel.y, t.vel.z), speed = vel.length()
    // Sparks: trucks grinding metal, streaming back off the rail with the grind's speed.
    const S = this.d.sparks
    if (t.state === 'grind' && t.grind && !t.grind.slide && Math.abs(t.grind.speed) > S.minSpeed && this.isMetal(t)) {
      s.carry += S.perMetre * Math.abs(t.grind.speed) * dt
      const back = vel.clone().normalize().multiplyScalar(-1)
      const trucks = truckOffsets(t.grind.id)
      while (s.carry >= 1) {
        s.carry--
        const at = contact.clone().addScaledVector(fwd, trucks[Math.floor(r() * trucks.length)] + (r() - 0.5) * 0.04)
        const v = back.clone().multiplyScalar(speed * S.back * (0.6 + 0.6 * r()))
        v.x += (r() - 0.5) * 2 * S.spread; v.y += (r() - 0.5) * 2 * S.spread
        v.addScaledVector(up, S.up[0] + (S.up[1] - S.up[0]) * r())
        v.addScaledVector(back, S.speed[0] + (S.speed[1] - S.speed[0]) * r())
        const c = this.sparkColors[Math.floor(r() * this.sparkColors.length)]
        this.sparks.spawn(at, v, this.time - r() * dt, S.life[0] + (S.life[1] - S.life[0]) * r(), S.size, S.size * 0.6, c, 1)
        this.stats.sparks++
      }
    } else s.carry = 0
    const D = this.d.dust
    // Grit: a slide (the deck on the edge) or trucks on bare concrete scrape off a fine pale dust behind the board.
    const G = D.grind
    if (G && t.state === 'grind' && t.grind && t.grind.car < 0 && Math.abs(t.grind.speed) > G.minSpeed && (t.grind.slide || !this.isMetal(t))) {
      s.gritCarry += G.perMetre * Math.abs(t.grind.speed) * dt
      const back = vel.clone().normalize().multiplyScalar(-1)
      while (s.gritCarry >= 1) {
        s.gritCarry--
        const at = contact.clone().addScaledVector(fwd, (r() - 0.5) * (t.grind.slide ? 0.5 : 0.4)).addScaledVector(up, 0.02)
        const v = back.clone().multiplyScalar(speed * (0.12 + 0.18 * r())).addScaledVector(up, 0.15 + 0.35 * r())
        v.x += (r() - 0.5) * 0.5; v.y += (r() - 0.5) * 0.5
        this.dust.spawn(at, v, this.time - r() * dt, G.life[0] + (G.life[1] - G.life[0]) * r(), G.size[0], G.size[1], this.gritColor, G.opacity * (0.6 + 0.4 * r()))
        this.stats.dust++
      }
    } else s.gritCarry = 0
    // Dust: a puff on a hard landing (bigger with the impact) ...
    const land = t.lastLand?.tick ?? -1
    if (land !== s.land) {
      s.land = land
      const imp = t.lastLand?.impact ?? 0
      if (imp >= D.minImpact && t.state === 'ground') {
        const k = Math.min(1, (imp - D.minImpact) / (D.impactFull - D.minImpact))
        this.puff(contact, up, Math.round(D.count[0] + (D.count[1] - D.count[0]) * k), 0.6 + 0.8 * k, vel)
      }
    }
    // ... and on a bail, once as it starts.
    if (t.state === 'bail') { if (!s.bail) { s.bail = 1; this.puff(contact, up, D.bail, 1.2, vel) } } else s.bail = 0
    // Powerslide: grit off the wheels while it scrubs, wheel smoke once it has gone on a while.
    if (t.state === 'ground' && t.powerslide && speed > 1) {
      s.dustCarry += D.slidePerSecond * Math.min(1.5, speed / 8) * dt
      while (s.dustCarry >= 1) {
        s.dustCarry--
        const at = contact.clone().addScaledVector(fwd, (r() < 0.5 ? -1 : 1) * 0.2).addScaledVector(up, 0.03)
        const v = vel.clone().multiplyScalar(-0.15 + 0.1 * r()).addScaledVector(up, 0.3 + 0.5 * r())
        v.x += (r() - 0.5) * 0.6; v.y += (r() - 0.5) * 0.6
        this.dust.spawn(at, v, this.time, D.life[0] + (D.life[1] - D.life[0]) * r() * 0.7, D.size[0] * 0.8, D.size[1] * 0.8, this.dustColor, D.opacity * (0.6 + 0.4 * r()))
        this.stats.dust++
      }
      const M = D.smoke
      if ((t.slideTicks ?? 0) > M.afterTicks) {
        s.smokeCarry += M.perSecond * dt
        while (s.smokeCarry >= 1) {
          s.smokeCarry--
          const at = contact.clone().addScaledVector(fwd, (r() < 0.5 ? -1 : 1) * 0.2).addScaledVector(up, 0.05)
          const v = vel.clone().multiplyScalar(0.1 * r()).addScaledVector(up, 0.4 + 0.3 * r())
          this.dust.spawn(at, v, this.time, M.life[0] + (M.life[1] - M.life[0]) * r(), M.size[0], M.size[1], this.smokeColor, M.opacity)
          this.stats.dust++
        }
      }
    } else { s.dustCarry = 0; s.smokeCarry = 0 }
  }

  /** A ring of dust round a point, thrown outward (and a little along the way it was going). */
  private puff(at: THREE.Vector3, up: THREE.Vector3, n: number, scale: number, vel: THREE.Vector3) {
    const D = this.d.dust, r = this.rand
    const a = new THREE.Vector3(1, 0, 0).cross(up).normalize(), b = up.clone().cross(a).normalize()
    for (let i = 0; i < n; i++) {
      const th = (i / n) * Math.PI * 2 + r() * 0.6, sp = D.spread[0] + (D.spread[1] - D.spread[0]) * r()
      const v = a.clone().multiplyScalar(Math.cos(th) * sp).addScaledVector(b, Math.sin(th) * sp).addScaledVector(up, 0.35 + 0.8 * r()).addScaledVector(vel, 0.12)
      const p = at.clone().addScaledVector(a, Math.cos(th) * 0.12).addScaledVector(b, Math.sin(th) * 0.12).addScaledVector(up, 0.04)
      this.dust.spawn(p, v.multiplyScalar(scale), this.time, (D.life[0] + (D.life[1] - D.life[0]) * r()) * Math.min(1.4, scale), D.size[0] * scale, D.size[1] * scale, this.dustColor, D.opacity * (0.7 + 0.3 * r()))
      this.stats.dust++
    }
  }

  /** Grinding metal: a car's edge, a rail or coping, or a ledge whose edge carries angle iron or a flat bar. */
  private isMetal(t: Thing): boolean {
    const g = t.grind!
    if (g.car >= 0) return true
    const line = this.park.grind[g.line]
    if (!line) return false
    let m = this.metal.get(line.id)
    if (m === undefined) {
      m = line.kind === 'rail' || line.kind === 'coping' || this.alongRail(line.points)
      this.metal.set(line.id, m)
    }
    return m
  }

  /** Most of a ledge's points within metalRange of one of the park's metal edges. */
  private alongRail(pts: { x: number; y: number; z: number }[]): boolean {
    const R = this.d.sparks.metalRange
    let near = 0
    for (const p of pts) {
      let best = Infinity
      for (const r of this.park.rails ?? []) for (let i = 0; i + 1 < r.points.length; i++) best = Math.min(best, segDist(p, r.points[i], r.points[i + 1]))
      if (best < R) near++
    }
    return near * 2 > pts.length
  }
}

/** Where a grind's sparks come from along the board: the trucks on the rail (back, front or both). */
function truckOffsets(id: string): number[] {
  if (id === '5-0' || id === 'smith' || id === 'feeble') return [-0.2]
  if (id === 'nosegrind' || id === 'crooked' || id === 'overcrook') return [0.2]
  return [-0.2, 0.2]
}

function segDist(p: { x: number; y: number; z: number }, a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z, L = abx * abx + aby * aby + abz * abz
  const u = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / L)) : 0
  return Math.hypot(p.x - a.x - abx * u, p.y - a.y - aby * u, p.z - a.z - abz * u)
}
