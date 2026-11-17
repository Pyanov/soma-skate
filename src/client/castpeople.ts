import * as THREE from 'three'
import { raycast, type Park } from '../sim/park/park.ts'
import { applyMaterials, toonify } from './look.ts'
import { buildCharacter, type Built, type CharacterSpec, type HookCtx } from './skater/characters.ts'
import { frameFor } from './skater/kitpeople.ts'
import { bakeFarRig, bakeStatue, restSkeleton } from './skater/lod.ts'
import type { Expression } from './skater/face.ts'
import { tagAt, type Tag } from './tags.ts'

// The cast standing about the city (docs/open-world.md): each at its home spot, idling in
// character (Chad taps his tablet, Big Lou rubs his knee, Marisol films, Gloria stamps forms,
// Grandma Wu rocks her cart, Brayden taps an AirPod, Sal works the grip lever, Dolores checks her
// watch), turning to face you when you come near, with a name tag and, close enough, a talk prompt.
// Draw-only: the story's data (data/cast.json; data/cast.preview.json as the older
// shape) says who stands where and as which model. This draws the cast people with their own models
// (data/characters.json people) and Unit 7, the robotaxi, a car with a sticker face on its windshield;
// a member the story still gives a stand-in look (cast.json standIn) is drawn here as their own model
// once it exists, and the skater characters in the cast are the story's own view's. The story can move
// or hide a member (setOverride: a mission's spot, a ride). Nothing beyond drawDistance is drawn or posed.

/**
 * One cast member as the story lists them: id, name, sticker art (a path, or a name in assets/ui), voice,
 * home (a spot id, or a place: x y z and heading, compass degrees), model id (and outfit); standIn: the
 * model is an existing look until theirs is built; stand: metres right of and ahead
 * of a home spot (the preview's own).
 */
export type CastEntry = { id: string; name: string; sticker?: string; voice?: string; home: string | { x: number; y: number; z?: number; heading?: number }; model: string; outfit?: string; standIn?: boolean; stand?: [number, number] }
/** data/characters.json castView: how near before they turn to you, show a tag, offer a talk; how far they are drawn. */
export type CastViewData = { drawDistance: number; turnNear: number; tagNear: number; talkNear: number; turnSpeed: number; nearDetail?: number; faceBeyond?: number; shadowRadius?: number }

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
/**
 * The entries that are one (id, name, home, model); the rest counted, not shown. Both shapes: the
 * preview (home a spot id or { x, y, z, heading }, model an id, sticker a path) and the
 * story's cast.json ({ cast: [...] }, home [x, y, z] with heading beside it, model { id, outfit },
 * standIn, sticker a name in assets/ui). built: the models this view draws; a member whose own id is one
 * of them is drawn as it (their stand-in look dropped).
 */
export function parseCast(v: unknown, built: ReadonlySet<string> = new Set()): { list: CastEntry[]; skipped: number } {
  const arr = Array.isArray(v) ? v : Array.isArray((v as { cast?: unknown })?.cast) ? (v as { cast: unknown[] }).cast : []
  const list: CastEntry[] = []
  let skipped = 0
  for (const e of arr) {
    const o = e as Record<string, unknown> | null
    let home = o?.home as CastEntry['home'] | number[] | undefined
    if (Array.isArray(home)) home = home.length >= 2 && home.every(finite) ? { x: home[0], y: home[1], ...(finite(home[2]) ? { z: home[2] } : {}), ...(finite(o?.heading) ? { heading: o!.heading as number } : {}) } : undefined
    const homeOk = typeof home === 'string' || (!!home && typeof home === 'object' && finite((home as { x: unknown }).x) && finite((home as { y: unknown }).y))
    const mo = o?.model as unknown
    const model = typeof mo === 'string' ? mo : mo && typeof (mo as { id?: unknown }).id === 'string' ? (mo as { id: string }).id : null
    if (!o || typeof o.id !== 'string' || typeof o.name !== 'string' || !model || !homeOk) { skipped++; continue }
    const stand = Array.isArray(o.stand) && o.stand.length === 2 && o.stand.every(finite) ? o.stand as [number, number] : undefined
    const outfit = mo && typeof mo === 'object' && typeof (mo as { outfit?: unknown }).outfit === 'string' ? (mo as { outfit: string }).outfit : undefined
    const own = built.has(o.id) && model !== o.id   // built: their own model, not the stand-in
    const sticker = typeof o.sticker === 'string' ? (o.sticker.includes('/') ? o.sticker : `assets/ui/${o.sticker}.png`) : undefined
    list.push({
      id: o.id, name: o.name, model: own ? o.id : model, home: home as CastEntry['home'],
      ...(outfit && !own ? { outfit } : {}), ...(o.standIn === true && !own ? { standIn: true } : {}),
      ...(sticker ? { sticker } : {}), ...(typeof o.voice === 'string' ? { voice: o.voice } : {}), ...(stand ? { stand } : {}),
    })
  }
  return { list, skipped }
}

type V3 = [number, number, number]
/**
 * A facing with room in front: as given when nothing stands within 1.6 m ahead at chest height, else
 * the clearest of eight ways (the nearest to the given one among those clear for 3 m).
 */
export function openFacing(park: Park, x: number, y: number, z: number, facing: number): number {
  const room = (a: number) => { const h = raycast(park, { x, y, z: z + 1.2 }, { x: Math.cos(a), y: Math.sin(a), z: 0 }, 4); return h ? Math.hypot(h.point.x - x, h.point.y - y) : 4 }
  if (room(facing) >= 1.6) return facing
  let best = facing, bestRoom = -1
  for (let k = 1; k < 8; k++) {
    const a = facing + (k <= 4 ? k : k - 8) * (Math.PI / 4), r = room(a)
    const score = Math.min(r, 3) * 10 - Math.abs(k <= 4 ? k : k - 8)
    if (score > bestRoom) { bestRoom = score; best = a }
  }
  return best
}
/** Ground a person stands on (the city's foot ground and the park's own). */
const FOOT = new Set(['city_sidewalk', 'city_path', 'city_spot', 'city_park', 'city_lot', 'city_stoop', 'city_plaza', 'city_alley', 'ground', 'city_curb'])
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const turnTo = (a: number, b: number, max: number) => { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + Math.max(-max, Math.min(max, d)) }
/** A beat: 0 most of the time, a smooth 0 -> 1 -> 0 lasting `len` seconds every `every` seconds (offset by seed). */
const beat = (t: number, every: number, len: number, seed: number) => { const u = ((t + seed * every) % every + every) % every; return u < len ? Math.sin((u / len) * Math.PI) : 0 }

/** What an idle asks of the body this moment (model space: +x the person's left, +y up, +z ahead). */
type IdlePose = { lw?: V3; rw?: V3; lcurl?: number; rcurl?: number; rhand?: [V3, V3]; lhand?: [V3, V3]; spine?: V3; head?: [number, number]; drop?: number; sway?: number; look?: boolean; mouth?: Expression['mouth']; jaw?: number; busy?: boolean }

type Member = {
  e: CastEntry; spec: CharacterSpec | null; built: Built | null; unit7: Unit7 | null; holder: THREE.Group
  home: THREE.Vector3; facing: number; yaw: number; seed: number; t: number
  greet: number; wasNear: boolean; blinkAt: number; shown: boolean; lever: THREE.Object3D | null
  own: { home: THREE.Vector3; facing: number }; hidden: boolean
  // Detail: every part near, the baked rig (a few skinned meshes) beyond nearDetail, one static mesh
  // beyond simpleBeyond on the low preset.
  lod: { parts: { m: THREE.Mesh; keep: boolean; face: boolean }[]; baked: THREE.Mesh[]; one: THREE.Mesh[]; statue: THREE.Mesh | null; mode: string } | null
}

const HIDE = 31   // a camera layer nothing renders (npcs.ts's)

export class CastPeople {
  readonly group = Object.assign(new THREE.Group(), { name: 'cast' })
  private members: Member[] = []
  private d: CastViewData
  private style = ''
  private inv = new THREE.Matrix4()
  private v = new THREE.Vector3()
  /** The cast member within talking range of the player now (null: none). */
  near: CastEntry | null = null

  constructor(entries: CastEntry[], specs: CharacterSpec[], spotAt: (id: string) => { x: number; y: number; z: number; heading: number } | null, park: Park, gradient: THREE.Texture | null, d: CastViewData) {
    this.d = d
    entries.forEach((e, i) => {
      // Where they stand: the spot (or place), moved stand metres right and ahead; facing the spot.
      let x: number, y: number, z: number | undefined, facing: number
      if (typeof e.home === 'string') {
        const s = spotAt(e.home)
        if (!s) { console.warn(`cast: ${e.id}'s home spot "${e.home}" is not in this world`); return }
        const [right, ahead] = e.stand ?? [2.5, 2.5]
        const fx = Math.sin(s.heading), fy = Math.cos(s.heading)   // spot headings are compass (0 = +y)
        x = s.x + fy * right + fx * ahead; y = s.y - fx * right + fy * ahead
        facing = Math.atan2(s.y - y, s.x - x)
        z = undefined
      } else {
        x = e.home.x; y = e.home.y; z = e.home.z
        facing = e.home.heading !== undefined ? Math.PI / 2 - e.home.heading * Math.PI / 180 : 0
      }
      if (z === undefined) {
        // On foot ground (a sidewalk, a plaza, a park), not in the road: the nearest such point to the
        // stand point within 12 m (a car stands where it is put).
        const groundAt = (px: number, py: number) => raycast(park, { x: px, y: py, z: 80 }, { x: 0, y: 0, z: -1 }, 200)
        const onFoot = (h: ReturnType<typeof groundAt>) => !!h && FOOT.has(park.elements[park.elem[h.tri]]?.collection ?? '') && h.normal.z > 0.9
        let hit = groundAt(x, y)
        if (e.model !== 'unit7' && !onFoot(hit)) {
          let best: { x: number; y: number; h: ReturnType<typeof groundAt> } | null = null
          for (let r = 1; r <= 12 && !best; r += 1) for (let k = 0; k < 16; k++) {
            const a = (k / 16) * Math.PI * 2, qx = x + Math.cos(a) * r, qy = y + Math.sin(a) * r, q = groundAt(qx, qy)
            if (onFoot(q)) { best = { x: qx, y: qy, h: q }; break }
          }
          if (best) { x = best.x; y = best.y; hit = best.h }
        }
        z = hit ? hit.point.z : 0
        if (typeof e.home === 'string') { const s = spotAt(e.home)!; facing = Math.atan2(s.y - y, s.x - x) }
      }
      // Never nose to a wall: a home whose heading looks straight into a facade turns to the most open way.
      if (typeof e.home !== 'string' && e.model !== 'unit7') facing = openFacing(park, x, y, z, facing)
      const holder = new THREE.Group()
      holder.name = `cast:${e.id}`
      holder.position.set(x, y, z)
      let unit7: Unit7 | null = null, spec: CharacterSpec | null = null
      if (e.model === 'unit7') { unit7 = new Unit7(); holder.add(unit7.group) }
      else {
        spec = specs.find((c) => c.id === e.model) ?? null
        if (!spec) { console.warn(`cast: no model "${e.model}" for ${e.id}`); return }
      }
      this.group.add(holder)
      // Built the first time they are drawn (39 people at boot would be seconds of building nobody sees).
      const m: Member = { e, spec, built: null, unit7, holder, home: holder.position.clone(), facing, yaw: facing, seed: (i * 0.618034) % 1, t: 0, greet: -1, wasNear: false, blinkAt: 2 + i, shown: true, lever: null, own: { home: holder.position.clone(), facing }, hidden: false, lod: null }
      this.members.push(m)
      holder.rotation.set(0, 0, (unit7 ? 0 : Math.PI / 2) + facing)
      if (unit7) this.pose(m, null)
    })
    this.gradient = gradient
  }

  private gradient: THREE.Texture | null = null
  /** Metres beyond which a member is one static mesh (the low preset's castSimple; 0: never). */
  simpleBeyond = 0

  /** Build a member's model: the rig, its first pose, and the baked far rig from that pose. */
  private build(m: Member) {
    const built = buildCharacter(m.spec!, m.e.outfit ?? null)
    if (this.gradient) toonify(built.character.root, this.gradient)
    const skel = restSkeleton(built.character.root)
    // The rig is y-up, +z ahead; the world is z-up: stand it up, then turn it to its facing.
    const up = new THREE.Group()
    up.rotation.x = Math.PI / 2
    up.add(built.character.root)
    m.holder.add(up)
    built.character.root.traverse((o) => { if (o.userData.bar) m.lever = o.userData.bar as THREE.Object3D })
    m.built = built
    if (this.style) applyMaterials(built.character.root, (this.style === 'real' || this.style === 'grey' ? this.style : 'cute') as 'grey' | 'cute' | 'real')
    this.pose(m, null)
    const rig = bakeFarRig(built.character.root, skel), one = bakeFarRig(built.character.root, skel, true).meshes
    if (this.gradient) for (const x of one) toonify(x, this.gradient)
    // The parts the bake could not take: the face's moving pieces (on pivots under the head) and the props on
    // the ground. Small parts cast no shadow (every caster is drawn again in the shadow pass).
    const parts: { m: THREE.Mesh; keep: boolean; face: boolean }[] = []
    const onBone = (o: THREE.Object3D) => { for (let q = o.parent; q; q = q.parent) if ((q as THREE.Bone).isBone) return true; return false }
    built.character.root.traverse((o) => {
      const x = o as THREE.Mesh
      if (!x.isMesh) return
      const keep = rig.kept.includes(x), face = keep && onBone(x)
      if (!x.geometry.boundingSphere) x.geometry.computeBoundingSphere()
      if (face || (x.geometry.boundingSphere?.radius ?? 1) < (this.d.shadowRadius ?? 0.09)) x.castShadow = false
      parts.push({ m: x, keep, face })
    })
    for (const x of [...rig.meshes, ...one]) { built.character.root.add(x); x.layers.set(HIDE) }
    if (this.style) applyMaterials(built.character.root, (this.style === 'real' || this.style === 'grey' ? this.style : 'cute') as 'grey' | 'cute' | 'real')
    m.lod = { parts, baked: rig.meshes, one, statue: null, mode: 'near' }
  }

  /** Near (every part), far (the baked rig and what it could not take) or the statue (one mesh). */
  private detail(m: Member, mode: string) {
    const L = m.lod
    if (!L || L.mode === mode) return
    if (mode === 'statue' && !L.statue) {
      const st = bakeStatue(m.built!.character.root)
      if (!st) return
      if (this.gradient) toonify(st, this.gradient)
      if (this.style) applyMaterials(st, (this.style === 'real' || this.style === 'grey' ? this.style : 'cute') as 'grey' | 'cute' | 'real')
      m.built!.character.root.add(st)
      L.statue = st
    }
    // far: the baked rig (a mesh per material) and what it kept; far2: the whole rig as one vertex-coloured
    // mesh and the props on the ground, no face (the eyes are a pixel or two across by then).
    for (const p of L.parts) p.m.layers.set(mode === 'near' || (mode === 'far' && p.keep) || (mode === 'far2' && p.keep && !p.face) ? 0 : HIDE)
    for (const b of L.baked) b.layers.set(mode === 'far' ? 0 : HIDE)
    for (const b of L.one) b.layers.set(mode === 'far2' ? 0 : HIDE)
    if (L.statue) L.statue.layers.set(mode === 'statue' ? 0 : HIDE)
    L.mode = mode
  }

  /** The members' ids and where they stand (tests, the fps probe). */
  get placed(): { id: string; x: number; y: number; z: number }[] { return this.members.map((m) => ({ id: m.e.id, x: m.home.x, y: m.home.y, z: m.home.z })) }
  get count() { return this.members.length }
  /** Whether this view draws that cast member (the story's own view leaves them to it). */
  has(id: string) { return this.members.some((m) => m.e.id === id) }
  /**
   * The story moves a member (a mission puts them somewhere else: x y z and heading in compass degrees),
   * hides them (a ride: the story draws the moving one), or sends them home (null).
   */
  setOverride(id: string, at: { x: number; y: number; z: number; heading: number } | 'hidden' | null) {
    const m = this.members.find((x) => x.e.id === id)
    if (!m) return
    m.hidden = at === 'hidden'
    if (at && at !== 'hidden') { m.home.set(at.x, at.y, at.z); m.facing = Math.PI / 2 - at.heading * Math.PI / 180 }
    else if (!at) { m.home.copy(m.own.home); m.facing = m.own.facing }
    m.holder.position.copy(m.home)
  }
  /** The robotaxi's car model, once traffic has it: Unit 7 becomes one. */
  useCarModel(m: { geometry: THREE.BufferGeometry; material: THREE.Material }) { for (const x of this.members) x.unit7?.useModel(m.geometry, m.material) }

  /** Match the renderer's look (cute toon, real PBR, grey clay). */
  setStyle(style: string) {
    if (style === this.style) return
    this.style = style
    const key = (style === 'real' || style === 'grey' ? style : 'cute') as 'grey' | 'cute' | 'real'
    for (const m of this.members) if (m.built) applyMaterials(m.built.character.root, key)
  }

  /** Built members' draw calls at their current detail (the perf probe). */
  get drawn(): number { let n = 0; for (const m of this.members) if (m.shown && m.lod) for (const o of [...m.lod.parts.map((p) => p.m), ...m.lod.baked, ...m.lod.one, ...(m.lod.statue ? [m.lod.statue] : [])]) if (o.layers.mask & 1 && o.visible) n++; return n }

  /** dt seconds; the player (who they turn to and talk to) and the camera (what is drawn). */
  update(dt: number, player: THREE.Vector3, camera: THREE.Vector3) {
    this.near = null
    let nearest = Infinity
    for (const m of this.members) {
      const far = m.home.distanceTo(camera)
      m.shown = far < this.d.drawDistance && !m.hidden
      m.holder.visible = m.shown
      if (!m.shown) continue
      m.t += dt
      if (!m.built && !m.unit7) this.build(m)
      // Kit people are drawn baked even near: the bake keeps their materials, props and moving face, in a few meshes.
      if (m.lod) this.detail(m, this.simpleBeyond > 0 && far > this.simpleBeyond ? 'statue' : far > (this.d.faceBeyond ?? 18) ? 'far2' : far > (this.d.nearDetail ?? 10) || m.spec?.kit ? 'far' : 'near')
      const dist = Math.hypot(player.x - m.home.x, player.y - m.home.y)
      const near = dist < this.d.turnNear && Math.abs(player.z - m.home.z) < 4
      if (near && !m.wasNear) m.greet = 0   // you walked up: a wave (or a nod)
      m.wasNear = near
      if (m.greet >= 0) { m.greet += dt; if (m.greet > 1.6) m.greet = -1 }
      // Face you while you are near, else turn back to their own way.
      const want = near ? Math.atan2(player.y - m.home.y, player.x - m.home.x) : m.facing
      m.yaw = turnTo(m.yaw, want, this.d.turnSpeed * dt)
      if (dist < this.d.talkNear && dist < nearest) { nearest = dist; this.near = m.e }
      if (m.lod?.mode === 'statue') { m.holder.rotation.set(0, 0, m.yaw + Math.PI / 2); continue }   // one still mesh: turned, not posed
      this.pose(m, near ? player : null)
    }
  }

  /** Name tags over the cast within tagNear of the camera; the one you can talk to says how. */
  tags(camera: THREE.PerspectiveCamera, park: Park, w: number, h: number): Tag[] {
    const out: Tag[] = []
    this.members.forEach((m, i) => {
      if (!m.shown || m.home.distanceTo(camera.position) > this.d.tagNear) return
      const head = { x: m.home.x, y: m.home.y, z: m.home.z + (m.unit7 ? 0.9 : 0.55) }
      const tag = tagAt(-1000 - i, this.near === m.e ? `${m.e.name} · E talk` : m.e.name, head, camera, park, w, h)
      if (tag) out.push(tag)
    })
    return out
  }

  // ---- posing ----

  private pose(m: Member, player: THREE.Vector3 | null) {
    // The holder: at home, turned to its yaw (+z of the rig, after standing it up, points along -y: hence + pi/2).
    m.holder.rotation.set(0, 0, m.yaw + Math.PI / 2)
    if (m.unit7) { m.holder.rotation.z = m.yaw; m.holder.updateMatrixWorld(true); m.unit7.update(m.t, player, m.holder, m.greet); return }
    const B = m.built!
    const c = B.character, D = c.dims
    m.holder.updateMatrixWorld(true)
    // Where the player is in the person's own frame (for the head turn).
    let look: [number, number] | null = null
    if (player) {
      this.inv.copy(B.character.root.matrixWorld).invert()
      const p = this.v.copy(player).add(new THREE.Vector3(0, 0, 1.2)).applyMatrix4(this.inv)
      const headY = c.restPos('Head').y
      look = [Math.max(-1.1, Math.min(1.1, Math.atan2(p.x, Math.max(0.2, p.z)))), Math.max(-0.5, Math.min(0.4, Math.atan2(p.y - headY, Math.hypot(p.x, p.z))))]
    }
    const I = m.spec?.kit ? kitIdle(m.spec.kit.idle, m.t, m.seed, !!player, D) : idleFor(m.e.model, m.t, m.seed, !!player, D)
    // A wave hello as you walk up (the right hand), unless the idle has that hand busy with a prop held high.
    if (m.greet >= 0 && m.e.model !== 'marisol' && !I.busy) {
      const w = Math.sin(Math.min(1, m.greet / 1.6) * Math.PI)
      const wave = Math.sin(m.greet * 14) * 0.08
      I.rw = lerpV(I.rw ?? hang(D, -1), [-(D.shoulderX + 0.12) + wave, D.shoulderY + 0.28, 0.12], w)
    }
    const breath = Math.sin(m.t * 1.6 + m.seed * 6) * 0.006
    c.begin()
    const spine = I.spine ?? [0, 0, 0]
    const headTurn = look && I.look !== false ? look : I.head ?? [0, 0]
    // Rotations down the chain: hips, spine, chest, upper chest, neck, head (model axes: x pitch forward, y yaw left, z roll).
    const q = (x: number, y: number, z: number) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'YXZ'))
    c.setBody(new THREE.Vector3(I.sway ?? 0, D.hipsY + breath - (I.drop ?? 0), (I.drop ?? 0) * -0.35), [
      q(0, spine[1] * 0.3, 0), q(spine[0] * 0.4, spine[1] * 0.3, spine[2] * 0.5), q(spine[0] * 0.35 + breath, spine[1] * 0.2, spine[2] * 0.5),
      q(spine[0] * 0.25, spine[1] * 0.2, 0), q(-headTurn[1] * 0.4, headTurn[0] * 0.4, 0), q(-headTurn[1] * 0.6, headTurn[0] * 0.6, 0),
    ])
    const drop = I.drop ?? 0
    for (const side of ['Left', 'Right'] as const) {
      const k = side === 'Left' ? 1 : -1
      const ankle = new THREE.Vector3(k * (D.hipX + 0.02), D.ankleH, drop > 0.05 ? k * 0.08 : 0)
      const toe = new THREE.Vector3(k * 0.18, 0, 1).normalize()
      c.solveLeg(side, ankle, new THREE.Vector3(k * 0.15, 0, 1), toe, new THREE.Vector3(0, 1, 0))
      const wrist = side === 'Left' ? I.lw ?? hang(D, 1) : I.rw ?? hang(D, -1)
      // A hand frame (fingers, palm) where the idle holds a prop that has to point somewhere (Marisol's lens at the scene).
      const hf = side === 'Left' ? I.lhand : I.rhand
      c.solveArm(side, new THREE.Vector3(...wrist), new THREE.Vector3(k * 0.4, -0.2, -1), hf ? new THREE.Vector3(...hf[0]) : undefined, hf ? new THREE.Vector3(...hf[1]) : undefined, (side === 'Left' ? I.lcurl : I.rcurl) ?? 0.35)
    }
    c.commit()
    // The face: blinking, eyes on you while you are near, their own neutral or the idle's mouth, a smile for a wave.
    if (B.face) {
      if (m.t > m.blinkAt) m.blinkAt = m.t + 2.4 + ((m.seed * 7.3 + m.t) % 1) * 3
      const blink = m.t > m.blinkAt - 0.14 ? 1 : 0
      const neutral = (B.face as unknown as { spec: { mouth: { neutral?: Expression['mouth'] } } }).spec.mouth.neutral ?? 'neutral'
      B.face.set({ mouth: m.greet >= 0 ? 'smile' : I.mouth ?? neutral, lid: blink ? 1 : 0.15, browY: m.greet >= 0 ? 0.6 : 0, browTilt: 0, pupil: 1, look: look ? [look[0] * 0.4, look[1] * 0.6] : [Math.sin(m.t * 0.4 + m.seed * 5) * 0.3, 0], jaw: I.jaw ?? 0 })
    }
    B.hook?.(restCtx(m.t, B.character.root))
    // Sal's grip lever: he hauls it back and lets it go.
    if (m.lever) m.lever.rotation.x = -0.35 * beat(m.t, 6, 2.2, m.seed)
  }
}

const hang = (D: Built['character']['dims'], k: number): V3 => [k * (D.shoulderX + 0.06), D.shoulderY - D.arm * 0.95, 0.05]
const lerpV = (a: V3, b: V3, w: number): V3 => [a[0] + (b[0] - a[0]) * w, a[1] + (b[1] - a[1]) * w, a[2] + (b[2] - a[2]) * w]

/** Each model's idle in character (seconds t, a per-member seed, whether you are near). */
function idleFor(model: string, t: number, seed: number, near: boolean, D: Built['character']['dims']): IdlePose {
  const chestY = D.shoulderY - 0.12, sy = D.shoulderY
  switch (model) {
    case 'chad': {
      // The tablet at chest height, the right forefinger tapping; now and then he looks up and spreads his hands: a pivot.
      const pitch = beat(t, 9, 2.4, seed)
      const tap = Math.max(0, Math.sin(t * 9)) * 0.025 * (1 - pitch)
      return { lw: lerpV([0.08, chestY - 0.06, 0.28], [0.32, chestY - 0.02, 0.22], pitch), rw: lerpV([-0.06, chestY - 0.03 + tap, 0.32], [-0.34, chestY - 0.02, 0.22], pitch), rcurl: 0.6, spine: [0.12 * (1 - pitch), 0, 0], head: [0, near ? 0 : 0.45 * (1 - pitch)], look: true, mouth: pitch > 0.5 ? 'grin' : undefined }
    }
    case 'biglou': {
      // Arms folded over the belly; every so often he bends to rub the bad knee.
      const rub = beat(t, 8, 3, seed)
      const fold: [V3, V3] = [[-0.1, chestY - 0.12, 0.3], [0.12, chestY - 0.1, 0.32]]
      const knee: V3 = [-(D.hipX + 0.02), D.ankleH + D.leg * 0.55 + Math.sin(t * 7) * 0.02, 0.15]
      return { lw: lerpV(fold[0], [0.18, D.hipsY - 0.05, 0.22], rub), rw: lerpV(fold[1], knee, rub), spine: [0.75 * rub, 0, -0.1 * rub], drop: 0.08 * rub, head: [0, -0.4 * rub], look: rub < 0.3, mouth: rub > 0.4 ? 'hurt' : undefined }
    }
    case 'marisol': {
      // The camera up, filming: a slow pan, and a crouch for the low angle now and then.
      const low = beat(t, 11, 3.5, seed)
      const pan = Math.sin(t * 0.5 + seed * 4) * 0.45 * (near ? 0.3 : 1)
      return { rw: [-0.04, sy - 0.02 - low * 0.05, 0.3], lw: [0.07, sy - 0.08 - low * 0.05, 0.27], rhand: [[-Math.cos(pan), 0, Math.sin(pan)], [0, -1, 0]], rcurl: 0.7, lcurl: 0.6, spine: [0.1 + low * 0.25, pan, 0], drop: 0.32 * low, look: false, head: [0.05, pan * 0.4] }
    }
    case 'gloria': {
      // The clipboard at her waist; the stamp rises and comes down hard every few seconds.
      const u = ((t + seed * 3) % 2.6) / 2.6
      const up = u < 0.7 ? smooth(0.1, 0.6, u) : 1 - smooth(0.7, 0.78, u)
      return { lw: [0.1, chestY - 0.16, 0.3], rw: [0.02, chestY - 0.12 + up * 0.18, 0.33], rcurl: 0.8, spine: [0.15, 0.1, 0], head: [0, near ? 0 : 0.35], look: true }
    }
    case 'grandmawu': {
      // Both hands on the cart's handle, rocking it, tapping a foot, impatient.
      const rock = Math.sin(t * 2.2 + seed * 5) * 0.03
      return { lw: [0.17, D.hipsY + 0.13, 0.27 + rock], rw: [-0.17, D.hipsY + 0.13, 0.27 + rock], lcurl: 0.9, rcurl: 0.9, spine: [0.22, 0, 0], sway: rock * 0.5, look: true }
    }
    case 'brayden': {
      // A hand on the scooter's bar; the other taps an AirPod; the head nods to the beat.
      const tap = beat(t, 5, 1.5, seed)
      return { lw: [0.27, 1.07, 0.55], rw: lerpV(hang(D, -1), [-0.1, sy + 0.17, 0.0], tap), lcurl: 0.85, rcurl: tap > 0.5 ? 0.2 : 0.35, spine: [0, 0.15, 0.05], head: [Math.sin(t * 4.2) * 0.06, 0.1], look: true, mouth: 'grin' }
    }
    case 'sal': {
      // The right hand on the lever (hauled back with it), the left on his hip or waving the tourists on.
      const haul = beat(t, 6, 2.2, seed), wave = beat(t, 13, 2.5, seed + 0.4)
      return { rw: [-0.36, 1.08 - haul * 0.03, 0.18 - haul * 0.3], rcurl: 0.9, lw: lerpV([0.25, D.hipsY + 0.02, -0.02], [0.3 + Math.sin(t * 9) * 0.06, sy + 0.25, 0.15], wave), spine: [0.05, -0.15, 0], look: true }
    }
    case 'dolores': {
      // Hands behind her back, calm; every few seconds the watch comes up and she looks at it.
      const watch = beat(t, 7, 2.8, seed)
      return { lw: lerpV([0.08, D.hipsY + 0.02, -0.16], [0.03, chestY + 0.02, 0.3], watch), rw: lerpV([-0.08, D.hipsY + 0.02, -0.16], hang(D, -1), watch * 0.5), spine: [0.05 + 0.1 * watch, 0, 0], head: [0, 0.5 * watch], look: watch < 0.2 }
    }
    default: return {}
  }
}

/**
 * The kit people's idles (data/characters.json people[].kit.idle), each holding its props the way its
 * recipe built them: hands in the kit's frames (grip: fingers ahead, palm in; tray: palm up; stop:
 * fingers up, palm out) so what they hold stays upright (kitpeople.ts gripGroup); busy: both hands on
 * something, no wave hello.
 */
export function kitIdle(name: string, t: number, seed: number, near: boolean, D: Built['character']['dims']): IdlePose {
  const sy = D.shoulderY, cy = sy - 0.12, hy = D.hipsY
  const G = (side: 'Left' | 'Right', f = 'grip') => frameFor(f, side) as [V3, V3]
  const gripR = G('Right'), gripL = G('Left'), trayR = G('Right', 'tray'), trayL = G('Left', 'tray')
  const hip = (k: number): V3 => [k * (D.shoulderX + 0.02), hy + 0.02, -0.04]
  const sip = beat(t, 6, 1.8, seed), nod = Math.sin(t * 4.4) * 0.12
  switch (name) {
    case 'pointBoard': {
      // The board on his right shoulder; the left arm points at you (or jabs about, trash-talking).
      const jab = near ? 1 : 0.5 + 0.5 * Math.sin(t * 1.3 + seed * 4)
      return { rw: [-0.17, sy + 0.1, 0.06], rhand: gripR, rcurl: 0.9, lw: lerpV([0.25, cy - 0.12, 0.25], [0.14, sy - 0.02, 0.52], jab), lhand: [[0, 0.1, 1], [-1, 0, 0]], lcurl: 0.5, mouth: 'grin', look: true, busy: true }
    }
    case 'ponder': {
      // The pencil at his chin, the notebook at his chest; now and then he writes a line, then looks up again.
      const w = beat(t, 9, 2.6, seed)
      return { rw: lerpV([-0.05, sy + 0.1, 0.18], [-0.03, cy - 0.02, 0.3], w), rhand: gripR, rcurl: 0.8, lw: [0.06, cy - 0.06, 0.26], lhand: gripL, lcurl: 0.8, head: [0.15, 0.3 * (1 - w) - 0.35 * w], spine: [0.05 + 0.1 * w, 0, 0], look: w < 0.3, busy: true }
    }
    case 'sipSaucer': case 'sip': {
      // The cup up to the lips every few seconds; the saucer hand (or the other elbow) waits.
      const cup = lerpV([-0.13, cy - 0.04, 0.3], [-0.03, sy + 0.12, 0.17], sip)
      const left: V3 = name === 'sipSaucer' ? hip(1) : [-0.04, cy - 0.12, 0.22]
      return { rw: cup, rhand: name === 'sipSaucer' ? trayR : gripR, rcurl: 0.7, lw: left, lhand: gripL, head: [0, -0.15 * sip], look: sip < 0.3, mouth: sip > 0.5 ? 'focus' : undefined, busy: sip > 0.1 }
    }
    case 'holdUp': return { rw: [-0.22, sy + 0.06, 0.28 + Math.sin(t * 0.8) * 0.02], rhand: [[Math.sin(t * 0.6) * 0.3, 0.15, 1], [1, 0, 0]], rcurl: 0.6, lw: [0.1, hy + 0.1, 0.24], lhand: gripL, mouth: 'grin', look: true }
    case 'showBall': return { rw: [-0.22, sy + 0.04, 0.26 + Math.sin(t * 0.8) * 0.02], rhand: [[Math.sin(t * 0.7) * 0.4, 0, 1], [0, 1, 0]], rcurl: 0.5, lw: [0.06, hy + 0.05, -0.18], lhand: gripL, head: [-0.25, -0.05], look: true }
    case 'brake': {
      const haul = beat(t, 6, 2.2, seed)
      return { rw: [-0.36, 1.05 - haul * 0.04, 0.3 - haul * 0.2], rhand: gripR, rcurl: 0.95, lw: hip(1), lhand: gripL, spine: [0.05, -0.15 + haul * 0.08, 0], look: true, busy: true }
    }
    case 'prune': {
      const snip = Math.max(0, Math.sin(t * 5)) * beat(t, 5, 1.6, seed)
      return { rw: [-0.2, cy + 0.04 + snip * 0.03, 0.3], rhand: gripR, rcurl: 0.85, lw: [0.17, cy - 0.02, 0.28], lhand: gripL, lcurl: 0.85, head: [0, near ? 0 : -0.1], mouth: 'focus', look: true, busy: true }
    }
    case 'statue': {
      // Frozen, palm out; when you come near he moves like a robot (stepped), then freezes again.
      const k = near ? Math.round((0.5 + 0.5 * Math.sin(t * 0.9)) * 4) / 4 : 0
      return { rw: lerpV([-0.24, sy + 0.12, 0.3], [-0.3, sy + 0.32, 0.12], k), rhand: G('Right', 'stop'), rcurl: 0.05, lw: [0.2, hy - 0.02, 0.06], lhand: gripL, head: [0.5 - k * 0.5, -0.05], look: k > 0.5, busy: true }
    }
    case 'fries': {
      const bite = beat(t, 4.5, 1.2, seed)
      return { lw: [0.1, cy - 0.02, 0.3], lhand: trayL, lcurl: 0.5, rw: lerpV([-0.16, cy - 0.04, 0.3], [-0.03, sy + 0.1, 0.24], bite), rhand: gripR, rcurl: 0.8, head: [Math.sin(t * 0.9) * 0.5 * (near ? 0.2 : 1), 0.1 * bite], jaw: bite > 0.7 ? 0.8 : 0, look: true }
    }
    case 'lion': {
      const shake = beat(t, 7, 1.6, seed)
      return { lw: [0.3, hy - 0.02 + Math.sin(t * 12) * 0.02 * shake, 0.24], lhand: gripL, lcurl: 0.9, rw: [-0.26, hy + 0.12, 0.2], rhand: gripR, rcurl: 0.95, spine: [0, 0.12 * Math.sin(t * 6) * shake, 0], mouth: 'grin', look: true, busy: true }
    }
    case 'scold': {
      const wag = Math.sin(t * 7) * 0.04 * (near ? 1 : 0.6)
      return { lw: [0.14, cy - 0.06, 0.3], lhand: trayL, lcurl: 0.4, rw: [-0.12 + wag, sy + 0.12, 0.26], rhand: G('Right', 'stop'), rcurl: 0.6, head: [0, -0.05], look: true, busy: true }
    }
    case 'checkWatch': {
      const watch = beat(t, 4, 1.8, seed)
      return { lw: [0.12, cy - 0.06, 0.24], lhand: gripL, lcurl: 0.8, rw: lerpV([-0.24, hy - 0.02, 0.08], [-0.04, sy - 0.02, 0.34], watch), rhand: [[0, 0, 1], [0, 1, 0]], rcurl: 0.6, head: [0, -0.35 * watch], look: watch < 0.2, mouth: 'scared', busy: true }
    }
    case 'carryCrate': {
      const sway = Math.sin(t * 1.2 + seed * 4) * 0.015
      return { lw: [0.24, hy + 0.02 + sway, 0.33], rw: [-0.24, hy + 0.02 - sway, 0.33], lhand: gripL, rhand: gripR, lcurl: 0.7, rcurl: 0.7, spine: [-0.06, 0, 0], mouth: 'smile', look: true, busy: true }
    }
    case 'strut': return { lw: [0.07, hy + 0.04, -0.2], rw: [-0.07, hy + 0.04, -0.2], lhand: gripL, rhand: gripR, head: [Math.sin(t * 0.6) * 0.3, 0.12 * Math.max(0, Math.sin(t * 5))], spine: [-0.08, 0, 0], look: true }
    case 'shop': {
      const sigh = beat(t, 8, 2.2, seed)
      return { lw: [0.26, hy - 0.06, 0.08], rw: [-0.26, hy - 0.06, 0.08], lhand: gripL, rhand: gripR, lcurl: 0.9, rcurl: 0.9, head: [0.2 * sigh, 0.35 * sigh], spine: [-0.05 * sigh, 0, 0], mouth: sigh > 0.5 ? 'hurt' : undefined, look: sigh < 0.3, busy: true }
    }
    case 'paint': {
      const a = t * 1.7
      return { rw: [-0.16 + Math.cos(a) * 0.08, sy + 0.02 + Math.sin(a * 2) * 0.06, 0.4], rhand: gripR, rcurl: 0.85, lw: [0.17, cy + Math.max(0, Math.sin(t * 14)) * 0.04 * beat(t, 6, 1.5, seed), 0.22], lhand: gripL, lcurl: 0.85, spine: [0.05, -0.1, 0], head: [-0.15, 0.05], look: near, busy: true }
    }
    case 'leanCar': return { lw: [-0.09, cy - 0.07, 0.25], rw: [0.1, cy - 0.05, 0.27], lhand: gripL, rhand: gripR, lcurl: 0.6, rcurl: 0.6, spine: [-0.12, 0, 0], head: [0, 0.1], mouth: 'smile', look: true, busy: true }
    case 'strum': {
      const st = Math.sin(t * 9) * 0.035
      return { lw: [0.26, hy + 0.52, 0.27], lhand: [[0.5, 0.8, 0.2], [0, 0, -1]], lcurl: 0.6, rw: [0.0, hy + 0.2 + st, 0.32], rhand: gripR, rcurl: 0.5, head: [0.15, -0.1], mouth: beat(t, 10, 4, seed) > 0.2 ? 'grin' : undefined, look: true, busy: true }
    }
    case 'pushCart': {
      const fret = beat(t, 5, 1.6, seed)
      return { lw: [0.16, hy + 0.1, 0.34], lhand: gripL, lcurl: 0.9, rw: lerpV([-0.18, sy + 0.02, 0.28], [-0.12, sy + 0.12, 0.24], fret), rhand: gripR, rcurl: 0.8, head: [-0.3 * fret, 0.1], mouth: 'scared', look: fret < 0.4, busy: true }
    }
    case 'chancla': {
      const shake = Math.sin(t * 8) * 0.05 * (near ? 1 : 0.5)
      return { rw: [-0.22 + shake * 0.5, sy + 0.26 + shake, 0.16], rhand: gripR, rcurl: 0.9, lw: hip(1), lhand: gripL, mouth: 'focus', look: true, busy: true }
    }
    case 'leash': {
      const tug = Math.sin(t * 3.1 + seed) * 0.05 + beat(t, 5, 0.6, seed) * 0.08
      return { lw: [0.08 + tug * 0.3, hy - 0.0, 0.32 + tug], rw: [-0.08 + tug * 0.3, hy + 0.02, 0.32 + tug], lhand: gripL, rhand: gripR, lcurl: 0.95, rcurl: 0.95, spine: [0.08 * Math.sign(tug), tug, 0], mouth: 'scared', look: true, busy: true }
    }
    case 'hugJar': return { lw: [0.13, cy - 0.12, 0.34], rw: [-0.12, cy - 0.06, 0.36], lhand: G('Left', 'tray'), rhand: [[0.8, 0, 0.6], [0, 0, -1]], lcurl: 0.4, rcurl: 0.3, head: [0, -0.3 + 0.1 * Math.sin(t * 0.5)], mouth: 'smile', look: false, busy: true }
    case 'inspect': {
      const look2 = beat(t, 7, 3, seed)
      return { lw: [0.12, cy - 0.06, 0.26], lhand: gripL, lcurl: 0.8, rw: [-0.16, sy + 0.1, 0.32], rhand: trayR, rcurl: 0.4, head: [-0.35 * look2, 0.1 * look2], look: look2 < 0.3, mouth: look2 > 0.5 ? 'focus' : undefined, busy: true }
    }
    case 'nod': return { lw: [0.12, cy - 0.04, 0.27], lhand: gripL, lcurl: 0.8, rw: hip(-1), rhand: gripR, head: [0, nod], spine: [0.04, 0, 0], look: true }
    case 'presentSandwich': return { rw: [-0.25, sy - 0.02, 0.27], rhand: trayR, rcurl: 0.4, lw: [0.22, cy - 0.05, 0.3], lhand: G('Left', 'tray'), lcurl: 0.2, mouth: 'grin', look: true, busy: true }
    case 'parcel': return { lw: [0.12, cy - 0.06, 0.25], lhand: gripL, lcurl: 0.8, rw: [-0.58, 0.9, -0.08], rhand: [[0, 0, 1], [0, -1, 0]], rcurl: 0.6, spine: [0, -0.1, -0.06], head: [0.1, 0], look: true, busy: true }
    case 'readFortune': {
      const up = beat(t, 8, 2.5, seed)
      return { rw: [-0.1, cy - 0.02, 0.28], lw: [0.1, cy - 0.02, 0.28], rhand: gripR, lhand: gripL, rcurl: 0.8, lcurl: 0.8, head: [0, -0.35 * (1 - up) + 0.1 * up], spine: [0.08 * (1 - up), 0, 0], look: up > 0.6, mouth: up > 0.5 ? 'hurt' : undefined, busy: true }
    }
    case 'squawk': {
      const flap = beat(t, 6, 1.4, seed)
      const f = flap * (0.5 + 0.5 * Math.sin(t * 22))
      return { lw: lerpV([0.16, hy + 0.05, 0.02], [0.4, sy + 0.12, -0.04], f), rw: lerpV([-0.16, hy + 0.05, 0.02], [-0.4, sy + 0.12, -0.04], f), lhand: gripL, rhand: gripR, jaw: flap > 0.3 ? 1 : 0, head: [Math.sin(t * 0.7) * 0.4, 0.15 * flap], look: flap < 0.2 }
    }
    case 'point': {
      const p = near ? 1 : beat(t, 6, 3, seed)
      return { rw: lerpV([-0.22, hy + 0.0, 0.12], [-0.14, sy - 0.02, 0.52], p), rhand: [[0, 0.1, 1], [1, 0, 0]], rcurl: 0.5, lw: [0.08, hy + 0.12, 0.22], lhand: gripL, mouth: 'grin', look: true }
    }
    case 'flag': {
      const wave = Math.sin(t * 2.2) * 0.12
      return { rw: [-0.2 + wave, sy + 0.34, 0.12], rhand: gripR, rcurl: 0.95, lw: hip(1), lhand: gripL, mouth: 'smile', look: true, busy: true }
    }
    case 'crossBoard': {
      // Arms folded over the board on her chest; now and then a slow, unimpressed look away. Mid.
      const away = beat(t, 9, 3, seed)
      return { lw: [-0.05, cy - 0.13, 0.31], rw: [0.06, cy - 0.07, 0.32], lhand: [[-1, 0, 0.3], [0, 0, -1]], rhand: [[1, 0, 0.3], [0, 0, -1]], lcurl: 0.6, rcurl: 0.6, head: [0.5 * away, -0.05], look: away < 0.2, busy: true }
    }
    case 'shrug': {
      // Has he seen your board? He has not. A shrug every few seconds, palms up.
      const sh = beat(t, 4.5, 1.6, seed)
      return { lw: lerpV([0.2, hy - 0.02, 0.1], [0.32, hy + 0.14, 0.26], sh), rw: lerpV([-0.2, hy - 0.02, 0.1], [-0.32, hy + 0.14, 0.26], sh), lhand: trayL, rhand: trayR, lcurl: 0.2, rcurl: 0.2, head: [0.15 * sh, 0.12 * sh], spine: [-0.03 * sh, 0, 0], mouth: sh > 0.4 ? 'scared' : undefined, look: true }
    }
    case 'film': {
      // The flip phone out at arm's length, panning after whatever is happening; she watches the screen.
      const pan = Math.sin(t * 0.5 + seed * 3)
      return { rw: [-0.1 + pan * 0.08, sy + 0.1, 0.42], rhand: gripR, rcurl: 0.85, lw: [0.1, cy - 0.1, 0.18], lhand: gripL, lcurl: 0.5, head: [-0.1 + pan * 0.15, 0.02], spine: [0, pan * 0.12, 0], mouth: 'focus', look: beat(t, 8, 2, seed) > 0.3, busy: true }
    }
    case 'disco': {
      // The point up at the sky, hips on the beat; the skates swing in the other hand.
      const b = Math.sin(t * 6.3), up = 0.5 + 0.5 * Math.sin(t * 1.05)
      return { rw: [-0.28 - 0.06 * up, sy + 0.42 + 0.04 * b, 0.1], rhand: [[-0.35, 1, 0.15], [1, 0.2, 0]], rcurl: 0.5, lw: [0.24, hy - 0.04, 0.08], lhand: gripL, lcurl: 0.9, sway: 0.03 * b, spine: [0, 0.06 * b, 0.05 * b], mouth: 'grin', look: true, busy: true }
    }
    case 'stop': {
      // The paddle up beside her, the other palm out: stop, sweetie. A runway sway between cars.
      const w = Math.sin(t * 2.4 + seed)
      return { rw: [-0.3, sy - 0.04, 0.16], rhand: gripR, rcurl: 0.95, lw: [0.16, sy + 0.02, 0.4], lhand: G('Left', 'stop'), lcurl: 0.05, sway: 0.025 * w, spine: [0, 0.05 * w, 0], mouth: 'smile', look: true, busy: true }
    }
    case 'selfie': {
      // The selfie stick up in front; every few seconds the peace sign and the face.
      const pose = beat(t, 7, 4, seed)
      return { rw: [-0.2, sy + 0.06, 0.38], rhand: gripR, rcurl: 0.9, lw: lerpV([0.16, hy + 0.02, 0.12], [0.13, sy + 0.2, 0.16], pose), lhand: pose > 0.3 ? G('Left', 'stop') : gripL, lcurl: pose > 0.3 ? 0.15 : 0.5, head: [-0.3, 0.12], mouth: pose > 0.3 ? 'grin' : 'smile', look: pose < 0.1, busy: true }
    }
    case 'guardBowl': {
      // The bread bowl held close, the other hand over it like a lid; she checks the sky for gulls.
      const sky = beat(t, 6, 2.6, seed)
      return { rw: [-0.12, cy - 0.06, 0.3], rhand: trayR, rcurl: 0.4, lw: [-0.03, cy + 0.08, 0.32], lhand: [[-0.6, 0, 0.8], [0, -1, 0]], lcurl: 0.3, head: [0.6 * Math.sin(t * 1.3) * sky, 0.38 * sky], mouth: sky > 0.3 ? 'focus' : undefined, look: sky < 0.15, busy: true }
    }
    case 'gavel': {
      // The binder at her side; the gavel comes down now and then. Order.
      const tap = beat(t, 5, 0.7, seed)
      return { rw: [-0.2, cy + 0.02 + tap * 0.14, 0.3 - tap * 0.04], rhand: gripR, rcurl: 0.9, lw: [0.2, hy + 0.04, 0.12], lhand: gripL, lcurl: 0.8, head: [0, -0.08], spine: [0.03, 0, 0], look: true, busy: true }
    }
    case 'wave': {
      // A shaka at you (he just learned it), the laptop under his other arm.
      const w = Math.sin(t * 5) * 0.05
      return { rw: [-(D.shoulderX + 0.1) + w, sy + 0.18, 0.18], rhand: [[0, 1, 0.2], [0, 0, 1]], rcurl: 0.6, lw: [0.14, cy - 0.08, 0.22], lhand: gripL, lcurl: 0.8, mouth: 'grin', look: true, busy: true }
    }
    case 'balance': {
      // Arms out, finding his balance on nothing; every so often a big wobble.
      const wob = Math.sin(t * 1.6 + seed) * 0.5 + beat(t, 7, 1.4, seed) * Math.sin(t * 9) * 0.9
      return { lw: [0.55, sy + 0.02 + wob * 0.08, 0.06], rw: [-0.55, sy + 0.02 - wob * 0.08, 0.06], lhand: [[1, 0, 0], [0, -1, 0]], rhand: [[-1, 0, 0], [0, -1, 0]], lcurl: 0.15, rcurl: 0.15, spine: [0, 0, wob * 0.12], sway: wob * 0.025, head: [0, -0.1], mouth: Math.abs(wob) > 0.6 ? 'scared' : 'smile', look: Math.abs(wob) < 0.4, busy: true }
    }
    case 'shh': {
      // One hand on the stroller, eyes on the twins; the other finger goes to his lips (more when you are near).
      const sh = near ? 0.5 + 0.5 * Math.sin(t * 0.8) : beat(t, 9, 3, seed)
      return { rw: [-0.17, hy + 0.04, 0.4], rhand: gripR, rcurl: 0.9, lw: lerpV([0.17, hy + 0.04, 0.4], [0.03, sy + 0.16, 0.16], sh), lhand: sh > 0.4 ? [[0, 1, 0.1], [-1, 0, 0]] : gripL, lcurl: sh > 0.4 ? 0.5 : 0.9, head: [0, -0.35 * (1 - sh)], spine: [0.08, 0, 0], mouth: sh > 0.4 ? 'focus' : undefined, look: sh > 0.4, busy: true }
    }
    case 'waitBus': {
      // The sandwich in one hand, the schedule in the other; he looks up the street for the J, and takes a bite.
      const up = beat(t, 7, 3, seed), bite = beat(t, 11, 1.4, seed + 0.4)
      return { rw: lerpV([-0.12, cy - 0.06, 0.3], [-0.04, sy + 0.1, 0.22], bite), rhand: trayR, rcurl: 0.4, lw: [0.2, hy + 0.06, 0.16], lhand: gripL, lcurl: 0.8, head: [-0.9 * up, 0.05 + 0.1 * bite], jaw: bite > 0.6 ? 0.7 : 0, look: up < 0.1 && bite < 0.1, busy: true }
    }
    case 'readMap': {
      // The map held open; he reads it, then looks up and around, delighted, then back down.
      const up = beat(t, 6, 2.4, seed)
      return { lw: [0.3, cy - 0.1, 0.34], rw: [-0.3, cy - 0.1, 0.34], lhand: gripL, rhand: gripR, lcurl: 0.8, rcurl: 0.8, head: [Math.sin(t * 1.1) * 0.7 * up, -0.3 * (1 - up) + 0.1 * up], spine: [0.05 * (1 - up), 0, 0], mouth: up > 0.3 ? 'grin' : 'smile', look: false, busy: true }
    }
    case 'drift': {
      // A cloud: she drifts, arms afloat, and looks at you as if you were the weather.
      const a = t * 0.8 + seed
      return { lw: [0.32, hy + 0.18 + Math.sin(a) * 0.05, 0.12], rw: [-0.32, hy + 0.18 + Math.sin(a + 1.4) * 0.05, 0.12], lhand: trayL, rhand: trayR, lcurl: 0.2, rcurl: 0.2, sway: Math.sin(a * 0.7) * 0.05, spine: [0, Math.sin(a * 0.5) * 0.15, Math.sin(a * 0.7) * 0.06], look: true }
    }
    default: return { lhand: gripL, rhand: gripR }
  }
}

/** A hook context for a person standing still (the skaters' hooks expect one). */
function restCtx(t: number, root: THREE.Object3D): HookCtx {
  return { speed: 0, up: 0, air: false, crouch: 0, landed: -1, squash: 0, ticks: Math.floor(t * 120), mood: 'chill', idle: 1, bail: false, walk: 0, phone: false, special: 0, specialQ: 0, specialT: 0, specialId: '', bailT: -1, idleName: '', idleT: 0, idleK: 0, root, ground: null }
}

// ---- Unit 7: a robotaxi with a sticker face on its windshield screen ----

type Mood = 'idle' | 'curious' | 'happy' | 'blink'

class Unit7 {
  readonly group = new THREE.Group()
  private canvas: HTMLCanvasElement | OffscreenCanvas | null
  private ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
  private tex: THREE.Texture | null = null
  private sensor: THREE.Object3D
  private body: THREE.Group
  private boxes: THREE.Object3D[] = []
  private screen: THREE.Mesh | null = null
  private model = false
  private drawn = ''
  private inv = new THREE.Matrix4()

  constructor() {
    const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.35, metalness: 0.3, ...o })
    this.body = new THREE.Group()
    this.group.add(this.body)
    const add = (g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.body) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; parent.add(o); return o }
    // The traffic robotaxi's shape (src/client/traffic.ts), x forward, z up.
    // (Boxes until the car models arrive: then useModel swaps in the robotaxi's hatchback.)
    this.boxes.push(add(new THREE.BoxGeometry(4.4, 1.8, 0.8), mat(0xf2f2ef), 0, 0, 0.75))
    this.boxes.push(add(new THREE.BoxGeometry(2.4, 1.6, 0.6), mat(0x15191e, { roughness: 0.08, metalness: 0.9 }), -0.2, 0, 1.45))
    for (const x of [1.45, -1.35]) this.boxes.push(add(new THREE.CylinderGeometry(0.34, 0.34, 1.86, 14), mat(0x111111, { roughness: 0.9, metalness: 0 }), x, 0, 0.34, this.group))   // axle along y
    this.sensor = new THREE.Group(); this.sensor.position.set(-0.2, 0, 1.92); this.body.add(this.sensor)
    add(new THREE.CylinderGeometry(0.28, 0.32, 0.32, 14).rotateX(Math.PI / 2), mat(0x2a2d30, { roughness: 0.3 }), 0, 0, 0, this.sensor)
    add(new THREE.BoxGeometry(0.06, 0.3, 0.1), mat(0xff8a00, { roughness: 0.4 }), 0.3, 0, 0, this.sensor)   // a fin to see it spin
    // The windshield screen: a canvas face (sticker style: thick black outlines on a teal glow).
    this.canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(256, 128) : typeof document !== 'undefined' ? Object.assign(document.createElement('canvas'), { width: 256, height: 128 }) : null
    this.ctx = (this.canvas?.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null) ?? null
    if (this.canvas) {
      this.tex = new THREE.CanvasTexture(this.canvas as HTMLCanvasElement)
      this.tex.colorSpace = THREE.SRGBColorSpace
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.58), new THREE.MeshBasicMaterial({ map: this.tex, toneMapped: false }))
      // On the cabin's front (+x), upright; the picture's right is the car's left (+y), as you see it from in front.
      screen.position.set(1.012, 0, 1.45)
      screen.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)))
      this.body.add(screen)
      this.screen = screen
    }
  }

  /**
   * The traffic robotaxi's own model (a white hatchback: assets/cars, the paint flag left white without
   * an instance colour): the face moves onto its windshield (the glass facing forward and up, found in
   * the vertex colours and normals), the sensor onto its roof.
   */
  useModel(geometry: THREE.BufferGeometry, material: THREE.Material) {
    if (this.model) return
    this.model = true
    for (const o of this.boxes) o.removeFromParent()
    const car = new THREE.Mesh(geometry, material); car.castShadow = true; car.receiveShadow = true
    this.body.add(car)
    const P = geometry.getAttribute('position'), N = geometry.getAttribute('normal'), K = geometry.getAttribute('color')
    const glass: THREE.Vector3[] = [], nrm = new THREE.Vector3()
    let top = 0
    for (let i = 0; i < P.count; i++) top = Math.max(top, P.getZ(i))
    let roofX = 0, roofN = 0
    for (let i = 0; i < P.count; i++) {
      if (P.getZ(i) > top - 0.04) { roofX += P.getX(i); roofN++ }
      // The windows' dark blue (the pack's 0x181e30), not painted, facing forward and up.
      const r = K.getX(i), g = K.getY(i), b = K.getZ(i), flag = K.getW(i), nx = N.getX(i), nz = N.getZ(i)
      if (flag < 0.1 && b > r + 0.05 && b < 0.3 && nx > 0.35 && nz > 0.2) { glass.push(new THREE.Vector3(P.getX(i), P.getY(i), P.getZ(i))); nrm.x += nx; nrm.y += N.getY(i); nrm.z += nz }
    }
    this.sensor.position.set(roofN ? roofX / roofN : -0.2, 0, top + 0.15)
    if (!this.screen || glass.length < 3) return
    nrm.y = 0; nrm.normalize()
    const centre = glass.reduce((a, v) => a.add(v), new THREE.Vector3()).divideScalar(glass.length)
    const side = new THREE.Vector3(0, 1, 0), up = new THREE.Vector3().crossVectors(nrm, side)
    let w = 0, h = 0
    for (const v of glass) { const d = v.clone().sub(centre); w = Math.max(w, Math.abs(d.dot(side))); h = Math.max(h, Math.abs(d.dot(up))) }
    this.screen.position.copy(centre).addScaledVector(nrm, 0.012)
    this.screen.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(side, up, nrm))
    // The face keeps its 2.35:1 picture, as big as the glass allows.
    const sw = Math.min(w * 2 * 0.86, h * 2 * 0.86 * (1.36 / 0.58))
    this.screen.scale.set(sw / 1.36, sw / 1.36, 1)
  }

  update(t: number, player: THREE.Vector3 | null, holder: THREE.Object3D, greet: number) {
    this.sensor.rotation.z = t * 6
    // Excited when you come near: a little hop on its springs.
    // (On the model, whose wheels are part of it, it rocks nose up instead, wheels on the ground.)
    const hop = greet >= 0 ? Math.abs(Math.sin(greet * 9)) * (1 - greet / 1.6) : 0
    if (this.model) { this.body.rotation.y = -hop * 0.03; this.body.position.z = hop * 0.066 + Math.sin(t * 1.3) * 0.004 }   // pivots on the rear wheels
    else this.body.position.z = greet >= 0 ? hop * 0.08 : Math.sin(t * 1.3) * 0.006
    // Where you are on its screen: the pupils follow.
    let lx = Math.sin(t * 0.5) * 0.6, ly = Math.sin(t * 0.33) * 0.2
    if (player) {
      const p = player.clone().applyMatrix4(this.inv.copy(holder.matrixWorld).invert())
      lx = Math.max(-1, Math.min(1, Math.atan2(p.y, Math.max(0.5, p.x)) * 1.2)); ly = Math.max(-1, Math.min(1, (p.z - 1.2) * 0.3))
    }
    const blink = (t % 4.3) > 4.15
    const mood: Mood = blink ? 'blink' : greet >= 0 || player ? 'happy' : Math.sin(t * 0.21) > 0.6 ? 'curious' : 'idle'
    this.draw(mood, Math.round(lx * 8) / 8, Math.round(ly * 8) / 8)
  }

  private draw(mood: Mood, lx: number, ly: number) {
    const key = `${mood}:${lx}:${ly}`
    if (key === this.drawn || !this.ctx || !this.tex) return
    this.drawn = key
    const g = this.ctx, W = 256, H = 128
    g.fillStyle = '#0c2629'; g.fillRect(0, 0, W, H)
    const glow = g.createRadialGradient(W / 2, H / 2, 10, W / 2, H / 2, W * 0.6)
    glow.addColorStop(0, 'rgba(31,165,160,0.45)'); glow.addColorStop(1, 'rgba(31,165,160,0)')
    g.fillStyle = glow; g.fillRect(0, 0, W, H)
    g.lineWidth = 7; g.strokeStyle = '#0b0b0d'; g.lineJoin = 'round'; g.lineCap = 'round'
    for (const k of [-1, 1]) {
      const cx = W / 2 + k * 52, cy = 54
      if (mood === 'happy') {
        // ^ ^ : happy eyes.
        g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(cx - 26, cy + 10); g.quadraticCurveTo(cx, cy - 30, cx + 26, cy + 10); g.lineWidth = 14; g.strokeStyle = '#ffffff'; g.stroke()
        g.lineWidth = 6; g.strokeStyle = '#0b0b0d'; g.stroke()
        continue
      }
      g.fillStyle = '#ffffff'
      g.beginPath(); g.ellipse(cx, cy, 26, mood === 'blink' ? 3 : mood === 'curious' && k > 0 ? 30 : 26, 0, 0, Math.PI * 2); g.fill(); g.lineWidth = 7; g.strokeStyle = '#0b0b0d'; g.stroke()
      if (mood !== 'blink') { g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(cx + lx * 11, cy - ly * 9, 11, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx + lx * 11 + 4, cy - ly * 9 - 4, 3.5, 0, Math.PI * 2); g.fill() }
      // Brows: one up when curious.
      g.lineWidth = 7; g.beginPath(); g.moveTo(cx - 20, cy - 36 - (mood === 'curious' && k > 0 ? 8 : 0)); g.lineTo(cx + 20, cy - 38 - (mood === 'curious' && k > 0 ? 10 : 0)); g.stroke()
    }
    // The mouth: a wide smile when happy, a little o when curious, a flat line idle.
    g.lineWidth = 7; g.strokeStyle = '#0b0b0d'; g.beginPath()
    if (mood === 'happy') { g.fillStyle = '#f2f2ef'; g.moveTo(W / 2 - 34, 96); g.quadraticCurveTo(W / 2, 126, W / 2 + 34, 96); g.closePath(); g.fill(); g.stroke() }
    else if (mood === 'curious') { g.arc(W / 2, 104, 7, 0, Math.PI * 2); g.stroke() }
    else { g.moveTo(W / 2 - 20, 104); g.quadraticCurveTo(W / 2, 110, W / 2 + 20, 104); g.stroke() }
    this.tex.needsUpdate = true
  }
}
