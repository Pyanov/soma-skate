import * as THREE from 'three'
import type { GameData } from '../../sim/data.ts'
import type { Thing } from '../../sim/thing.ts'
import { BOARD, buildBoard, DECK_BOTTOM, DECK_TOP, deckSlope, deckTopZ, NOSE_TIP, TAIL_TIP, type BoardDesign } from './board.ts'
import type { Character } from './character.ts'
import { buildCharacter, buildRoster, type BoardFx, type Built, type CharacterSpec, type CharactersData, type SquashFx } from './characters.ts'
import type { MouthShape } from './face.ts'
import { CARRY, DEFAULT_GAIT, type Gait } from './gait.ts'
import { signaturePose, specialOf } from './specials.ts'
import { bailPose } from './bails.ts'
import { bodyRot } from './ik.ts'
import { EMOTE_TICKS, expression, idleNow, moodOf, steez, type MoodState } from './mood.ts'
import { DEFAULT_REACT, reactPose, reactWeights, type NpcReact } from './react.ts'
import { evaluate, lerpPose, resolvePoses, revertSwivel, type Eval, type Foot, type Hand, type Pose, type PoseData, type RawPoseData, type V3 } from './poses.ts'
import { frameFor } from './kitpeople.ts'

// SkaterView: the skater and board the renderer draws, posed from sim state.
// The board's orientation and trick rotation come from the sim; the body is solved per
// frame (poses from data/poses.json retargeted to the picked character's proportions,
// styled by its steez, two-bone IK for legs and arms) and the face shows a mood read from
// the same state. It only reads the Thing; it never changes the sim.
//
// Frames: root = the rider frame at the ground contact under the board (+X board forward,
// +Y left, +Z up). stance = root, mirrored across X for goofy, so everything inside is
// written for regular stance (heel side = +Y, toe side = -Y). The character sits in its
// own model space (+X left = nose, +Y up, +Z facing = toe side).

const D2R = Math.PI / 180
const Z = new THREE.Vector3(0, 0, 1)
/** Stance-space vector [n, f, u] -> stance coordinates (toe side is -Y). */
const stanceVec = (v: V3) => new THREE.Vector3(v[0], -v[1], v[2])
/** Stance coordinates -> character model space. */
const toModel = (v: THREE.Vector3) => new THREE.Vector3(v.x, v.z, -v.y)
const dirModel = (v: V3) => new THREE.Vector3(v[0], v[2], v[1]).normalize()

/** A board's moving parts (board.ts buildBoard): the deck's meshes (flex), the trucks (back, front) and their wheels. */
type BoardParts = { deck: THREE.Mesh[]; trucks: (THREE.Object3D | undefined)[]; wheels: (THREE.Object3D | undefined)[] }
const partsOf = new WeakMap<THREE.Object3D, BoardParts>()
function boardParts(board: THREE.Object3D): BoardParts {
  let p = partsOf.get(board)
  if (!p) {
    const deck = board.getObjectByName('deck')
    p = { deck: (deck?.children ?? []) as THREE.Mesh[], trucks: ['truck:back', 'truck:front'].map((n) => board.getObjectByName(n)), wheels: ['wheels:back', 'wheels:front'].map((n) => board.getObjectByName(n)) }
    partsOf.set(board, p)
  }
  return p
}

/** The hooks' flourish inputs: a special trick, or an emote whose props are the same ones (foam, gelatin, wings, bones). */
function emoteProps(m: MoodState, kind: string | undefined, sp: { env: number; q: number; ticks: number; id: string } | null) {
  if (m.emote >= 0 && kind && ['foam', 'jiggle', 'hiss', 'rattle', 'coolnod', 'shaka', 'strut', 'arrive', 'bell'].includes(kind)) {
    const e = smooth01(0, 10, m.emote) * (1 - smooth01(EMOTE_TICKS - 30, EMOTE_TICKS, m.emote))
    return { special: kind === 'rattle' ? e * 0.6 : e, specialQ: m.emote / EMOTE_TICKS, specialT: m.emote, specialId: 'emote' }
  }
  return { special: sp?.env ?? 0, specialQ: sp?.q ?? 0, specialT: sp?.ticks ?? 0, specialId: sp?.id ?? '' }
}

/** A copy of a board sharing its geometry, materials and looks (Object3D.clone would deep-copy userData). */
function shareClone(src: THREE.Object3D): THREE.Group {
  // Object3D.clone JSON-copies userData, which turns every texture in it into a data URL (about
  // 0.2 s a board at load): empty it for the clone and give the copies the same references after.
  const a: THREE.Object3D[] = [], saved: Record<string, unknown>[] = []
  src.traverse((o) => { a.push(o); saved.push(o.userData); o.userData = {} })
  const g = src.clone() as THREE.Group
  a.forEach((o, i) => { o.userData = saved[i] })
  const b: THREE.Object3D[] = []
  g.traverse((o) => b.push(o))
  for (let i = 0; i < a.length; i++) {
    b[i].userData = { ...a[i].userData }
    const looks = a[i].userData.looks as { grey: THREE.Material } | undefined
    if (looks) (b[i] as THREE.Mesh).material = looks.grey
  }
  return g
}

const DEFAULT_BOARD: BoardDesign = { graphic: 'sunset', wheel: '#f2eee3' }

/** Which look a model is showing (the first mesh whose material is one of its looks), or null. */
function styleOf(root: THREE.Object3D): 'real' | 'cute' | 'grey' | null {
  let style: 'real' | 'cute' | 'grey' | null = null
  root.traverse((o) => {
    const l = o.userData.looks as Record<string, unknown> | undefined
    if (style || !l) return
    for (const k of ['real', 'cute', 'grey'] as const) if ((o as THREE.Mesh).material === l[k] && l.real !== l.cute) { style = k; break }
  })
  return style
}
/** Put a model in a look. */
function wearStyle(root: THREE.Object3D, style: 'real' | 'cute' | 'grey' | null) {
  if (style) root.traverse((o) => { const l = o.userData.looks; if (l) (o as THREE.Mesh).material = l[style] })
}

const smooth01 = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

function blendXf(a: THREE.Matrix4, b: THREE.Matrix4, k: number): THREE.Matrix4 {
  if (k >= 1) return b.clone()
  const pa = new THREE.Vector3(), qa = new THREE.Quaternion(), pb = new THREE.Vector3(), qb = new THREE.Quaternion(), s = new THREE.Vector3()
  a.decompose(pa, qa, s); b.decompose(pb, qb, s)
  return new THREE.Matrix4().compose(pa.lerp(pb, k), qa.slerp(qb, k), new THREE.Vector3(1, 1, 1))
}

export class SkaterView {
  readonly root = new THREE.Group()
  /** One board per character (its deck graphic and wheels); the current one is `board`. */
  private boards = new Map<string, THREE.Group>()
  get board(): THREE.Group { return this.boardFor(this.current.spec) }
  readonly roster: Built[]
  private current: Built
  private charRoot = new THREE.Group()
  private pruned = false
  private stance = new THREE.Group()
  private boardXf = new THREE.Matrix4()
  private rollFix = 0
  private bendTick = -2
  private pitchFix = 0      // radians: easing a vert landing, the board pitched back onto the face it landed on
  private pitchEase = false
  private boardBase = new THREE.Matrix4()   // without the flip rotation: where the feet leave and catch it
  private P: PoseData
  private chars: CharactersData
  last: Eval | null = null
  mood: MoodState | null = null
  /** The world tick of the Thing being drawn (set by the caller; -1 = unknown). Celebrations time from it. */
  tick = -1
  /** World tick of the last pickup (a burrito) seen in the event stream (play and clips; -1 = none). */
  pickupTick = -1
  /** World tick of the last emote (taunt) key press (play; -1 = none). Shots set it to show one. */
  emoteTick = -1
  /** An NPC's reactions this frame (skater/react.ts: cheering, pointing, waiting and who it watches), set by npcs.ts; null for the player. */
  react: NpcReact | null = null
  private lookSm: { yaw: number; at: number } | null = null
  // A locked secret skater in the picker: drawn as a black silhouette (character and board).
  private silMat = new THREE.MeshBasicMaterial({ color: 0x15141a })
  private silSaved = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>()
  /** Draw the current character (and its board) as a black silhouette, or back to its look. */
  setSilhouette(on: boolean) {
    for (const [m, mat] of this.silSaved) m.material = mat
    this.silSaved.clear()
    if (!on) return
    for (const root of [this.current.character.root, this.board]) root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.material) return
      this.silSaved.set(m, m.material)
      m.material = this.silMat
    })
  }
  get silhouetted() { return this.silSaved.size > 0 }
  // The board's own motion (view only): wheel spin (rad), its rate (rad/s), and the last update's tick.
  private spin = 0
  private spinVel = 0
  private fxAt = -1
  /** Ground height under a world point (the park), for parts that roll away (the mascot's head); null = none. */
  ground: ((x: number, y: number, z: number) => number | null) | null = null
  /**
   * Live play only: ease the body toward each new pose over a few frames, so state changes
   * the pose keys do not blend (starting to push, landing on a rail) do not snap. Headless
   * shots leave it off, so a snapshot always shows the pure pose for its tick.
   */
  smoothing = false
  private shown: { pose: Eval['pose']; at: number } | null = null

  private raw: RawPoseData

  constructor(roster: Built[], raw: RawPoseData, chars: CharactersData, opts: { boardsFrom?: SkaterView; ownBoards?: boolean } = {}) {
    this.roster = roster
    this.chars = chars
    this.raw = raw
    this.current = roster.find((b) => b.spec.id === chars.default) ?? roster[0]
    this.P = resolvePoses(raw)
    this.root.name = 'skater'
    // Only the current character's board now: the others are painted (their decks are drawn pixel by
    // pixel) the first time they are worn (boardFor), which was a second of a phone's load.
    for (const b of roster) {
      if (b !== this.current && !opts.boardsFrom) continue
      const from = opts.ownBoards ? opts.boardsFrom?.ownBoardFor(b.spec) : opts.boardsFrom?.boardFor(b.spec)
      const g = from ? shareClone(from) : buildBoard(b.spec.style.board)
      g.matrixAutoUpdate = false
      g.name = `board:${b.spec.id}`
      this.boards.set(b.spec.id, g)
    }
    this.charRoot.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2)   // model -> stance
    // Every character starts attached, so the renderer's material pass (look.ts toonify) sees
    // them all; the first update keeps only the picked one.
    for (const b of roster) this.charRoot.add(b.character.root)
    this.stance.add(...this.boards.values(), this.charRoot)
    this.root.add(this.stance)
  }

  static async load(posesUrl = 'data/poses.json', charsUrl = 'data/characters.json'): Promise<SkaterView> {
    const [raw, chars] = await Promise.all([posesUrl, charsUrl].map((u) => fetch(u, { cache: 'no-store' }).then((r) => r.json())))
    return new SkaterView(buildRoster(chars as CharactersData), raw as RawPoseData, chars as CharactersData)
  }

  /**
   * Another view of one character (an NPC skater, the race ghost): the same poses and data, the
   * deck sharing this view's geometry and materials. Its looks are the caller's (toonify or a tint).
   */
  twin(built: Built, ownBoard = false): SkaterView {
    return new SkaterView([built], this.raw, { ...this.chars, default: built.spec.id }, { boardsFrom: this, ownBoards: ownBoard })
  }

  /** Every pickable character (data/characters.json order); the roster holds those built at startup. */
  get cast(): CharacterSpec[] { return this.chars.characters }

  /** A character's board: the roster's, or built (with its looks) the first time it is needed. */
  private boardFor(spec: CharacterSpec): THREE.Group {
    let g = this.boards.get(spec.id)
    if (g) return g
    g = this.makeBoard(this.boardDesign(spec.id), spec.id)
    this.boards.set(spec.id, g)
    // Before the first pose every board is attached (the first update keeps the current one). After
    // it, the current character's board must be attached here: a lazy character picked before the
    // first pose (a remembered pick, a shot's character) gets its board only now, after the prune.
    if (!this.pruned) this.stance.add(g)
    else if (spec.id === this.current.spec.id) { this.stance.add(g); wearStyle(g, styleOf(this.current.character.root)) }
    return g
  }

  /** The character's own deck (not the board shop's pick): what other skaters wearing it ride (NPCs). */
  private ownBoards = new Map<string, THREE.Group>()
  private ownBoardFor(spec: CharacterSpec): THREE.Group {
    if (!this.boardOf.has(spec.id)) return this.boardFor(spec)
    let g = this.ownBoards.get(spec.id)
    if (!g) { g = this.makeBoard(spec.style.board ?? DEFAULT_BOARD, spec.id); this.ownBoards.set(spec.id, g) }
    return g
  }

  private makeBoard(d: BoardDesign, id: string): THREE.Group {
    const g = buildBoard(d)
    g.matrixAutoUpdate = false
    g.name = `board:${id}`
    this.prepareLooks(g)
    return g
  }

  // ---- the board shop (picker.ts, data/boards.json): any deck and wheel colour, per character
  private boardOf = new Map<string, BoardDesign>()   // character id -> picked design (absent: its own)
  /** The board a character rides: its own deck unless picked otherwise in the board shop. */
  boardDesign(id: string): BoardDesign {
    const own = this.chars.characters.find((c) => c.id === id)?.style.board ?? DEFAULT_BOARD
    return this.boardOf.get(id) ?? own
  }
  /**
   * Pick a character's deck graphic and wheel colour (empty fields: its own). The new board takes
   * the old one's place, matrix and look; other characters' boards wait until they are worn.
   */
  setBoard(id: string, pick: { graphic?: string; wheel?: string } | null) {
    const own = this.chars.characters.find((c) => c.id === id)?.style.board ?? DEFAULT_BOARD
    const d: BoardDesign = { graphic: pick?.graphic || own.graphic, wheel: pick?.wheel || own.wheel }
    const was = this.boardDesign(id)
    if (d.graphic === own.graphic && d.wheel === own.wheel) this.boardOf.delete(id); else this.boardOf.set(id, d)
    const old = this.boards.get(id)
    if (!old || (was.graphic === d.graphic && was.wheel === d.wheel)) return
    const g = this.makeBoard(d, id)
    g.matrix.copy(old.matrix)
    this.boards.set(id, g)
    if (old.parent) { const p = old.parent; p.remove(old); p.add(g); wearStyle(g, styleOf(old)) }
  }

  /** The board shop's display deck: upright beside the skater, its graphic turned to the camera with a slow sway. */
  private showcaseG: THREE.Group | null = null
  private showcaseKey = ''
  showcase(on: boolean, t = 0, camera?: THREE.Vector3) {
    if (!on) { if (this.showcaseG) this.showcaseG.visible = false; return }
    const d = this.boardDesign(this.characterId), key = `${d.graphic}|${d.wheel}`
    if (!this.showcaseG || key !== this.showcaseKey) {
      if (this.showcaseG) this.root.remove(this.showcaseG)
      this.showcaseG = this.makeBoard(d, 'showcase')
      this.showcaseG.matrixAutoUpdate = true
      this.showcaseKey = key
      this.root.add(this.showcaseG)
    }
    const g = this.showcaseG
    wearStyle(g, styleOf(this.board))
    g.visible = true
    g.position.set(0.15, 0.95, 1.0)
    let face = t
    if (camera) { this.root.updateMatrixWorld(); const c = this.root.worldToLocal(camera.clone()); face = Math.atan2(c.y - 0.95, c.x - 0.15) + Math.sin(t * 0.8) * 0.55 }
    g.rotation.set(0, 0, 0)
    g.rotateZ(face)           // the bottom (the graphic) toward the camera
    g.rotateY(-Math.PI / 2)   // nose up
  }
  /** Where the display deck stands (world space), for the shop's camera. */
  showcaseAt(): THREE.Vector3 { this.root.updateMatrixWorld(); return new THREE.Vector3(0.15, 0.95, 1.0).applyMatrix4(this.root.matrixWorld) }

  /** The character data (data/characters.json): the roster's specs and the NPC and ghost numbers. */
  get data(): CharactersData { return this.chars }

  get character(): Character { return this.current.character }
  /** The park's watchers (data/characters.json spectators), drawn by spectators.ts. */
  get spectatorData() { return this.chars.spectators }
  get characterId(): string { return this.current.spec.id }
  get characterName(): string { return this.current.spec.name }
  /** Standing height of the current character (sole to the top of its head), metres. */
  get characterHeight(): number { return this.character.restPos('Head').y + this.current.headTop }

  /** The current character's outfits: 'default' first, then its alternates (data/characters.json). */
  get outfits(): { id: string; name: string }[] { return [{ id: 'default', name: 'Classic' }, ...(this.current.spec.outfits ?? []).map((o) => ({ id: o.id, name: o.name }))] }
  get outfitId(): string { return this.current.outfit }
  private outfitOf = new Map<string, string>()          // character id -> outfit id
  private variants = new Map<string, Built>()           // `${id}:${outfit}` -> built (the roster holds the defaults)

  // ---- the picker's colours (data/paints.json): colour keys painted on top of the spec and outfit
  private tintOf = new Map<string, Record<string, string>>()
  /** The colour keys a character is painted with (null: its own colours). */
  tintFor(id: string): Record<string, string> | null { return this.tintOf.get(id) ?? null }
  /** Paint a character (null or empty: back to its own colours); the current one is rebuilt in place. */
  setTint(id: string, tint: Record<string, string> | null) {
    if (tint && Object.keys(tint).length) this.tintOf.set(id, tint); else this.tintOf.delete(id)
    if (this.current.spec.id === id) this.setCharacter(id, this.current.outfit)
  }
  /** Painted builds of a character other than the one in use are dropped (each try in the picker is a build). */
  private forgetTinted(id: string, keep: string) {
    for (const [k, b] of this.variants) {
      if (k === keep || !k.startsWith(`${id}:`) || k.endsWith(':') || b === this.current) continue
      b.character.root.parent?.remove(b.character.root)
      b.character.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose())
      this.variants.delete(k)
    }
  }

  /** Pick an outfit for the current character (built the first time it is worn). */
  setOutfit(id: string) { this.setCharacter(this.current.spec.id, id) }

  /**
   * Toon twins for a character built after the renderer's material pass (an outfit worn later),
   * with the gradient the renderer gave the others; its real twins ride on the materials already.
   */
  private prepareLooks(root: THREE.Object3D) {
    let gradient: THREE.Texture | null = null
    this.root.traverse((o) => { const c = o.userData.looks?.cute as THREE.MeshToonMaterial | undefined; if (!gradient && c?.gradientMap) gradient = c.gradientMap })
    if (!gradient) return
    root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.userData.looks || !mesh.material) return
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (!(mats[0] instanceof THREE.MeshLambertMaterial)) return
      const toon = mats.map((m) => { const l = m as THREE.MeshLambertMaterial; return new THREE.MeshToonMaterial({ color: l.color, map: l.map, vertexColors: l.vertexColors, side: l.side, transparent: l.transparent, opacity: l.opacity, depthWrite: l.depthWrite, alphaTest: l.alphaTest, gradientMap: gradient }) })
      const real = mats.map((m) => (m.userData.real as THREE.Material | undefined) ?? new THREE.MeshStandardMaterial({ color: (m as THREE.MeshLambertMaterial).color, map: (m as THREE.MeshLambertMaterial).map, roughness: 0.78 }))
      mesh.userData.looks = { grey: mesh.material, cute: Array.isArray(mesh.material) ? toon : toon[0], real: Array.isArray(mesh.material) ? real : real[0] }
    })
  }

  /**
   * Add or replace a character's spec (a created skater, cas.ts): its old builds are dropped, and if it
   * is the one being drawn it is rebuilt in place.
   */
  setSpec(spec: CharacterSpec) {
    const i = this.chars.characters.findIndex((c) => c.id === spec.id)
    if (i >= 0) this.chars.characters[i] = spec; else this.chars.characters.push(spec)
    for (const [k, b] of this.variants) {
      if (!k.startsWith(`${spec.id}:`) || b === this.current) continue
      b.character.root.parent?.remove(b.character.root)
      this.variants.delete(k)
    }
    if (this.current.spec.id === spec.id) {
      // The one on screen: forget its build, build the new spec and swap it in (the board stays).
      for (const [k, b] of this.variants) if (b === this.current) this.variants.delete(k)
      this.setCharacter(spec.id, this.current.outfit)
    }
  }
  /** Take a created skater out (its slot deleted); the default comes back if it was being drawn. */
  removeSpec(id: string) {
    const i = this.chars.characters.findIndex((c) => c.id === id)
    if (i < 0) return
    if (this.current.spec.id === id) this.setCharacter(this.chars.default)
    this.chars.characters.splice(i, 1)
    for (const [k, b] of this.variants) if (k.startsWith(`${id}:`)) { b.character.root.parent?.remove(b.character.root); this.variants.delete(k) }
  }

  /** Pick the character (and outfit; else the one it last wore) to draw; unknown ids keep the current one. */
  setCharacter(id: string, outfit?: string) {
    // The story's people too (a review sheet or a clip may put one of them on the board: --char rocco).
    const spec = this.chars.characters.find((c) => c.id === id) ?? this.chars.people?.find((c) => c.id === id)
    if (!spec) return
    const def = this.roster.find((b) => b.spec.id === id)   // built at startup (lazy characters are not)
    const want = outfit ?? this.outfitOf.get(id) ?? 'default'
    const valid = want === 'default' || (spec.outfits ?? []).some((o) => o.id === want) ? want : 'default'
    this.outfitOf.set(id, valid)
    const tint = this.tintOf.get(id) ?? null, tk = tint ? Object.entries(tint).sort().map(([k, v]) => `${k}=${v}`).join(',') : ''
    const key = `${id}:${valid}:${tk}`
    let next = valid === 'default' && def && !tk ? def : this.variants.get(key)
    if (!next) {
      next = buildCharacter(spec, valid === 'default' ? null : valid, tint)
      if (tk) this.forgetTinted(id, key)
      this.variants.set(key, next)
      this.prepareLooks(next.character.root)
      if (!this.pruned) this.charRoot.add(next.character.root)
    }
    if (next === this.current) return
    const prev = this.current
    this.current = next
    if (!this.pruned) return
    // Which look is showing: find a mesh whose material is one of its looks.
    let style: 'real' | 'cute' | 'grey' | null = null
    prev.character.root.traverse((o) => {
      const l = o.userData.looks as Record<string, unknown> | undefined
      if (style || !l) return
      for (const k of ['real', 'cute', 'grey'] as const) if ((o as THREE.Mesh).material === l[k] && l.real !== l.cute) { style = k; break }
    })
    const prevBoard = this.boardFor(prev.spec), nextBoard = this.boardFor(next.spec)
    nextBoard.matrix.copy(prevBoard.matrix)
    this.charRoot.remove(prev.character.root)
    this.charRoot.add(next.character.root)
    if (prevBoard !== nextBoard) { this.stance.remove(prevBoard); this.stance.add(nextBoard) }
    for (const root of [next.character.root, nextBoard]) if (style) root.traverse((o) => { const l = o.userData.looks; if (l) (o as THREE.Mesh).material = l[style!] })
  }

  /** Hot reload of data/poses.json. Throws (and keeps the old poses) if it does not resolve. */
  setPoses(raw: RawPoseData) { this.P = resolvePoses(raw) }

  /** Place and pose the skater from an (interpolated) Thing. */
  update(t: Thing, data: GameData, alpha: number) {
    // In a vehicle (src/sim/game/vehicles.ts) the rider is inside it: not drawn (the vehicle's view draws the van).
    this.stance.visible = t.state !== 'drive'
    if (t.state === 'drive') { this.root.position.set(t.pos.x, t.pos.y, t.pos.z); return }
    this.stance.scale.set(1, data.rider.stance === 'goofy' ? -1 : 1, 1)   // data/rider.json, shared with the sim
    const radius = data.physics.skater.radius
    // ---- rider frame from the sim ----
    const up = new THREE.Vector3(t.up.x, t.up.y, t.up.z).normalize()
    const fwd = new THREE.Vector3(t.fwd.x, t.fwd.y, t.fwd.z)
    if (t.state === 'air' && t.vertAir) {
      // Display only: the sim keeps the wall as "up" for the whole vert air; near the
      // peak the skater is drawn turning upright, as real vert airs look.
      const w = Math.max(0, 1 - Math.abs(t.vel.z) / 4)
      const q = new THREE.Quaternion().setFromUnitVectors(up, Z)
      q.slerp(new THREE.Quaternion(), 1 - w)
      up.applyQuaternion(q); fwd.applyQuaternion(q)
    }
    // Out of a slide the sim turns the rider back in line with travel at once (up to 90 degrees); drawn, the
    // body and board turn over the first slideOutTicks of the air.
    if (t.state === 'air' && t.slideTurn) {
      const k = 1 - smooth01(0, this.P.timing.slideOutTicks ?? 9, t.stateTicks + alpha)
      if (k > 0) fwd.applyAxisAngle(up, -t.slideTurn * k)
    }
    // Touchdown from a vert air: the sim switches the rider's up from the wall to the face it lands on at
    // once (up to 30-odd degrees, the hips 40 cm); drawn, the rider turns from the wall's up over the first
    // landEaseTicks while the board is kept on the face (pitchFix below).
    this.pitchFix = 0
    const LE = this.P.timing.landEaseTicks ?? 8
    if (t.state === 'ground' && t.stateTicks < LE && t.airTicks > 20 && Math.abs(t.takeoffN.z) < 0.6) {
      const wall = new THREE.Vector3(t.takeoffN.x, t.takeoffN.y, t.takeoffN.z).normalize()
      if (wall.angleTo(up) > 0.05) {
        const q = new THREE.Quaternion().setFromUnitVectors(up, wall)
        q.slerp(new THREE.Quaternion(), smooth01(0, LE, t.stateTicks + alpha))
        up.applyQuaternion(q); fwd.applyQuaternion(q)
        this.pitchEase = true
      }
    }
    if (t.state === 'walk') {
      // On foot the character faces where it walks: the rider frame's toe side (stance -Y, mirrored
      // for goofy) is the sim's facing, upright.
      const h = new THREE.Vector3(t.fwd.x, t.fwd.y, 0).normalize(), sgn = this.stance.scale.y
      up.copy(Z); fwd.set(-h.y * sgn, h.x * sgn, 0)
    }
    const contact = new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z).addScaledVector(up, -radius)
    // Caught onto a rail or ledge: the sim put the skater on the line at once; drawn, it travels there over
    // the lock-on (poses.json timing.grindInTicks), the board arriving on the edge.
    const sn = t.state === 'grind' ? t.grind?.snap : undefined
    if (sn) { const k = 1 - smooth01(0, this.P.timing.grindInTicks ?? 7, t.stateTicks + alpha); contact.add(new THREE.Vector3(sn[0], sn[1], sn[2]).multiplyScalar(k)) }
    // And the catch's turn of the board onto (or across) the line: the rider turns into it over the lock-on.
    const tu = t.state === 'grind' ? t.grind?.turn : undefined
    if (tu) {
      const k = 1 - smooth01(0, this.P.timing.grindInTicks ?? 7, t.stateTicks + alpha)
      if (k > 0) { fwd.applyAxisAngle(up, -tu * k); fwd.addScaledVector(up, -fwd.dot(up)).normalize() }
    }
    const boardUp = up.clone()
    if (t.state === 'lip') {
      // Stalled on the coping: the sim keeps the wall as "up"; draw the rider upright with the
      // nose out over the deck (away from the riding area).
      const nh = new THREE.Vector3(t.takeoffN.x, t.takeoffN.y, 0).normalize()
      up.copy(Z); boardUp.copy(Z); fwd.copy(nh).negate()
      // The lip trick's own way round (poses.json lipFrame): turned to face down the ramp (disaster,
      // tail stall), or along the coping with the toes to the ramp (axle stall).
      const lf = t.lip ? this.P.lipFrame?.[t.lip.id] : undefined
      if (lf === 'ramp') fwd.copy(nh)
      else if (lf === 'along') fwd.set(-nh.y * this.stance.scale.y, nh.x * this.stance.scale.y, 0)
      contact.set(t.pos.x, t.pos.y, t.pos.z - radius)
    } else if (t.state === 'wall') {
      // Wallride: the board stays on the wall (the sim's up), the body leans out less.
      up.lerp(Z, 0.55).normalize()
    }
    // A revert: the sim turns the board round at once; drawn, board and body swivel round fast.
    const swivel = revertSwivel(t, data, alpha, this.P)
    if (swivel) fwd.applyAxisAngle(up, swivel * D2R * this.stance.scale.y)
    fwd.addScaledVector(up, -fwd.dot(up)).normalize()
    const side = new THREE.Vector3().crossVectors(up, fwd)
    this.root.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fwd, side, up))
    this.root.position.copy(contact)
    // Board roll that brings the board back onto the sim's surface when the body frame differs.
    const bu = boardUp.applyQuaternion(this.root.quaternion.clone().invert())
    this.rollFix = Math.atan2(-bu.y * this.stance.scale.y, bu.z) / D2R
    if (this.pitchEase) { this.pitchFix = Math.atan2(bu.x, bu.z); this.pitchEase = false }

    if (!this.pruned) {
      for (const b of [...this.roster, ...this.variants.values()]) if (b !== this.current) this.charRoot.remove(b.character.root)
      for (const [id, g] of this.boards) if (id !== this.current.spec.id) this.stance.remove(g)
      this.pruned = true
    }
    // ---- pose: keyframes, then the character's steez, then retargeted to its proportions ----
    const gait: Gait = { ...DEFAULT_GAIT, ...(this.current.spec.style.walk ?? {}) }
    const ev = evaluate(t, data, alpha, this.P, gait, this.current.spec.style.flair ?? {}, this.ground)
    const m = moodOf(t, data, alpha, this.tick)
    if (this.tick >= 0 && this.pickupTick >= 0 && this.tick >= this.pickupTick) {
      m.pickup = this.tick + alpha - this.pickupTick
      if (m.pickup < 54 && m.mood === 'neutral') m.mood = 'happy'
    }
    if (this.tick >= 0 && this.emoteTick >= 0 && this.tick >= this.emoteTick && this.tick - this.emoteTick < EMOTE_TICKS) {
      m.emote = this.tick + alpha - this.emoteTick
      const kind = this.current.spec.style.emote?.kind
      m.mood = kind === 'hiss' ? 'scared' : 'ecstatic'
    }
    // An NPC's reactions: no fidgets or phone while it waits, cheers or points; delighted cheering.
    const R = this.react, RD = this.chars.npcs?.react ?? DEFAULT_REACT
    let yaw: number | null = null
    if (R) {
      const w = reactWeights(R, RD)
      m.idle *= 1 - Math.max(R.wait, w.cheer, w.point)
      if (w.cheer > 0.2) m.mood = 'ecstatic'
      else if (w.point > 0.2 && m.mood === 'neutral') m.mood = 'happy'
      yaw = R.at ? this.lookYaw(R.at, contact, fwd, side, this.tick + alpha, RD.lookEase) : null
    }
    if (yaw === null) this.lookSm = null
    this.mood = m
    const spec = this.current.spec
    const sp = specialOf(t, data, alpha)
    const bailT = t.state === 'bail' ? t.stateTicks + alpha : -1
    // Stiff characters still lay out for a special.
    const style = sp ? { ...spec.style, bend: Math.max(spec.style.bend, 0.95) } : spec.style
    let styled = steez(ev.pose, t, m, style, this.P)
    if (R) styled = reactPose(styled, R, yaw, this.tick + alpha + t.id * 131, this.P, RD)
    ev.pose = this.retarget(bailPose(signaturePose(styled, sp, spec.style.signature), bailT, spec.style.flair?.bail, this.P.poses.bailPhone ?? null))
    if (ev.walk?.hang) ev.pose = this.hangPose(ev.pose, ev.walk.hang)
    this.last = ev
    if (this.smoothing) {
      const now = performance.now()
      if (this.shown && now - this.shown.at < 250) ev.pose = lerpPose(this.shown.pose, ev.pose, 1 - Math.exp(-(now - this.shown.at) / 45))
      this.shown = { pose: ev.pose, at: now }
    }
    const pose = ev.pose
    if (!ev.walk) this.placeBoard(ev)
    this.boardMotion(t, data, alpha, ev)
    const c = this.character
    // The elbows and knees keep last tick's side only from one tick to the next (a shot or a jump in time solves fresh).
    if (this.tick < 0 || this.tick !== this.bendTick + 1) c.forgetBends()
    this.bendTick = this.tick
    c.begin()
    const hips = toModel(stanceVec(pose.hips))
    const split = (r: V3, k: number) => bodyRot(r[0] * k, r[1] * k, r[2] * k)
    c.setBody(hips, [
      bodyRot(pose.hipsRot[0], pose.hipsRot[1], pose.hipsRot[2]),
      split(pose.spine, 0.35), split(pose.spine, 0.35), split(pose.spine, 0.3),
      split(pose.head, 0.4), split(pose.head, 0.6),
    ])
    // Dropping the board back under the feet (the ground state began without a landing, faster
    // than pushing from rest could explain, after walking): it falls from the carry to the ground
    // while the rider hops onto it. The feet aim at where it will be.
    const drop = this.dropK(t, data, alpha)
    if (drop < 1) {
      const final = this.boardXf.clone()
      const xf = blendXf(this.carryFrame(gait, 0, 0).xf, final, drop)
      this.board.matrix.copy(xf)
      this.board.matrixWorldNeedsUpdate = true
      const hop = 0.13 * Math.sin(Math.PI * drop)
      pose.front.pos = [pose.front.pos[0], pose.front.pos[1], pose.front.pos[2] + hop]
      pose.back.pos = [pose.back.pos[0], pose.back.pos[1], pose.back.pos[2] + hop]
    }
    const flipping = ev.flip.roll !== 0 || ev.flip.yaw !== 0 || ev.flip.pitch !== 0
    this.solveFoot('Left', pose.front, flipping)
    this.solveFoot('Right', pose.back, flipping)
    const sh = c.joint('LeftShoulder').clone().add(c.joint('RightShoulder')).multiplyScalar(0.5)
    if (ev.walk) {
      // On foot: the board rides in the carrying hand (placed from where that shoulder is now). Hanging
      // from a ledge it lies on the ledge, and comes into the hand at the end of the pull-up.
      const H = ev.walk.hang
      const fromLedge = H ? this.ledgeXf(H.at) : null
      const k = H ? smooth01(0.75, 1, H.pull) : 1
      const held = H && k < 0.5 ? (this.placeXf(fromLedge!, null, 0), [] as string[]) : this.carryBoard(gait, H ? k : ev.walk.pickup, ev.walk.phase * ev.walk.move, ev.walk.climb, fromLedge)
      if (!held.includes('Left')) this.solveHand('Left', pose.lead, sh, null)
      if (!held.includes('Right')) this.solveHand('Right', pose.rear, sh, null)
    } else {
      this.solveHand('Left', pose.lead, sh, ev.grab?.hand === 'lead' ? ev.grab : null)
      this.solveHand('Right', pose.rear, sh, ev.grab?.hand === 'rear' ? ev.grab : null)
      if (ev.reach) {
        // A hand holding on to something off the board (a car's bumper): the wrist on the point,
        // fingers over its top edge.
        const side = ev.reach.hand === 'lead' ? 'Left' : 'Right', k = ev.reach.hand === 'lead' ? 1 : -1
        c.solveArm(side, toModel(stanceVec(ev.reach.at)), dirModel([k * 0.4, -0.6, -0.3]), toModel(new THREE.Vector3(k, 0, -0.6).normalize()), toModel(new THREE.Vector3(0, 0, -1)), 0.95)
      }
    }
    c.commit()
    // ---- face and secondary motion ----
    const expr = expression(sp && sp.env > 0.3 && m.mood !== 'scared' ? { ...m, mood: 'ecstatic' } : m, spec.style.neutral as MouthShape)
    if (ev.walk) expr.jaw = Math.max(expr.jaw, ev.walk.step * 0.7)   // a clack at each footfall (jawed faces)
    // And on a landing: the jaw drops with the impact and snaps shut (poses.json follow.land.jaw).
    const FJ = this.P.follow?.land
    if (FJ?.jaw && t.state === 'ground' && t.airTicks > this.P.timing.landMinAir) {
      const a = t.stateTicks + alpha
      if (a < 30) expr.jaw = Math.max(expr.jaw, FJ.jaw * Math.min(1, 0.4 + Math.max(0, (t.lastLand?.impact ?? 0) - FJ.from) * FJ.perImpact) * Math.sin(Math.PI * Math.min(1, a / 14)) * Math.min(1, a / 2))
    }
    this.current.face?.set(expr)
    if (this.current.hook) {
      const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
      this.root.updateMatrixWorld(true)   // hooks that place parts in world or model space read current matrices
      const idle = m.idle > 0 ? idleNow(m.ticks, spec.style.idles?.length ? spec.style.idles : [spec.style.idle]) : { name: '', t: 0 }
      const crouch = t.crouch ? Math.min(1, (t.charge + alpha) / this.P.timing.crouchTicks) : 0
      const landSquash = m.landed >= 0 ? Math.exp(-m.landed / 8) : t.state === 'ground' && t.airTicks > 20 && t.stateTicks < 12 ? Math.exp(-(t.stateTicks + alpha) / 8) : 0
      this.current.hook({ speed, up: t.vel.z, air: t.state === 'air' || !!t.footAir, crouch, landed: t.state === 'ground' && t.airTicks > 20 ? t.stateTicks + alpha : -1, squash: Math.max(crouch * 0.7, landSquash, (ev.walk?.step ?? 0) * 0.55), ticks: m.ticks, mood: m.mood, idle: m.idle, bail: t.state === 'bail', walk: ev.walk?.move ?? 0, phone: m.idle > 0.3 || (!!ev.walk && gait.phone), ...emoteProps(m, spec.style.emote?.kind, sp), bailT, idleName: idle.name, idleT: idle.t, idleK: m.idle, root: this.character.root, ground: this.ground })
    }
    this.landingSquash(t, alpha)
  }

  /**
   * Landing squash and stretch for the cartoony bodies (style.squash: the blob and Karl most, the can
   * least, people not at all): down onto the board, up past it, settling, scaled by the impact.
   * The whole body scales about the grip, keeping its volume.
   */
  private landingSquash(t: Thing, alpha: number) {
    const Q: SquashFx = this.chars.squash ?? { amount: 0.3, minAir: 30, impact: [2, 6], decay: 7, rate: 0.33 }
    const r = this.character.root, amt = (this.current.spec.style.squash ?? 0) * Q.amount
    let k = 0
    if (amt > 0 && t.state === 'ground' && t.airTicks > Q.minAir) {
      const a = t.stateTicks + alpha, imp = t.lastLand?.impact ?? 0
      const hit = Math.max(0.25, Math.min(1, (imp - Q.impact[0]) / (Q.impact[1] - Q.impact[0])))
      if (a < Q.decay * 6) k = amt * hit * Math.exp(-a / Q.decay) * Math.cos(a * Q.rate - 0.25) * Math.min(1, a / 2)
    }
    if (k === 0) { if (r.scale.y !== 1) { r.scale.set(1, 1, 1); r.position.set(0, 0, 0) } return }
    const sy = 1 - k, sxz = 1 / Math.sqrt(sy)
    r.scale.set(sxz, sy, sxz)
    r.position.set(0, DECK_TOP * (1 - sy), 0)
  }

  /**
   * The board's own motion: the trucks turn with the carve (the hangers stay level while the deck
   * rolls, the front one steering into the turn and the back one out), the wheels spin with the speed
   * (coasting in the air, still on a rail), and the deck flexes as it lands and as it pops.
   */
  private boardMotion(t: Thing, data: GameData, alpha: number, ev: Eval) {
    const B: BoardFx = this.chars.board ?? { truckSteer: 0.6, truckLevel: 1, spinMaxStep: 0.9, flexLand: 0.022, flexPop: 0.014, flexTicks: 16 }
    const parts = boardParts(this.board)
    const lean = (ev.lean ?? 0) * D2R
    for (const [i, tr] of parts.trucks.entries()) if (tr) tr.rotation.set(-lean * B.truckLevel, 0, (i === 0 ? 1 : -1) * lean * B.truckSteer)
    const now = this.tick + alpha, hz = data.physics.tickHz
    const dt = this.fxAt >= 0 && now >= this.fxAt ? Math.min(0.1, (now - this.fxAt) / hz) : 0
    this.fxAt = now
    const along = t.vel.x * t.fwd.x + t.vel.y * t.fwd.y + t.vel.z * t.fwd.z
    if (t.state === 'ground') this.spinVel = along / BOARD.wheelR
    else this.spinVel *= t.state === 'grind' ? Math.exp(-dt / 0.15) : Math.exp(-dt / 2)
    this.spin = (this.spin + Math.max(-B.spinMaxStep, Math.min(B.spinMaxStep, this.spinVel * dt))) % (Math.PI * 2)
    for (const w of parts.wheels) if (w) w.rotation.y = this.spin
    // Flex: bowing down as it lands (harder with the impact), springing the other way at the pop.
    let flex = 0
    const a = t.stateTicks + alpha
    if (t.state === 'ground' && t.airTicks > 12 && a < B.flexTicks * 2) {
      const hit = Math.max(0.3, Math.min(1, ((t.lastLand?.impact ?? 0) - 1.5) / 5))
      flex = B.flexLand * hit * Math.exp(-a / (B.flexTicks / 3)) * Math.cos(a * 0.5) * Math.min(1, a / 1.5)
    } else if (t.state === 'air' && t.popped && a < B.flexTicks) flex = -B.flexPop * Math.exp(-a / 3) * Math.cos(a * 0.6)
    for (const m of parts.deck) if (m.morphTargetInfluences) m.morphTargetInfluences[0] = flex
  }

  /**
   * Where an NPC looks, degrees in stance space (0 = out to the toe side, + toward the nose), eased
   * over `ease` ticks so the head turns rather than snaps when who it watches changes.
   */
  private lookYaw(at: { x: number; y: number; z: number }, contact: THREE.Vector3, fwd: THREE.Vector3, left: THREE.Vector3, now: number, ease: number): number {
    const dx = at.x - contact.x, dy = at.y - contact.y, dz = at.z - contact.z
    const n = dx * fwd.x + dy * fwd.y + dz * fwd.z, f = -(dx * left.x + dy * left.y + dz * left.z) * this.stance.scale.y
    const want = Math.atan2(n, f) / D2R
    const L = this.lookSm
    if (!L || now < L.at || now - L.at > 30) { this.lookSm = { yaw: want, at: now }; return want }
    const d = ((want - L.yaw + 540) % 360) - 180
    L.yaw += d * (1 - Math.exp(-(now - L.at) / Math.max(1, ease)))
    L.at = now
    return L.yaw
  }

  /**
   * Poses are written for one rig (characters.json poseRig). For this character: the hip height
   * keeps each foot's knee bend (the hip joint's reach to the ankle scales with leg length; lying
   * poses keep their height), and hand offsets from the shoulders scale with arm length.
   */
  private retarget(p: Pose): Pose {
    const R = this.chars.poseRig, d = this.character.dims
    const ankle = (f: Foot, a: number, lift: number) => (f.pos[2] + (DECK_TOP + lift) * Math.min(1, f.board)) + a
    const hipN = (side: number, hipX: number) => p.hips[0] + side * hipX
    let sum = 0, n = 0, upright = 0
    for (const [f, side] of [[p.front, 1], [p.back, -1]] as const) {
      const aR = ankle(f, R.ankle, p.board.lift), aN = ankle(f, d.ankleH, p.board.lift)
      const dn = f.pos[0] - hipN(side, R.hipX), df = f.pos[1] - p.hips[1]
      const dz = p.hips[2] + R.hipJoint - aR
      const e = Math.min(0.995, Math.hypot(dn, df, dz) / R.leg)
      const dn2 = f.pos[0] - hipN(side, d.hipX)
      const dz2 = Math.sqrt(Math.max(0, (e * d.leg) ** 2 - dn2 * dn2 - df * df))
      sum += aN + dz2 - d.hipJoint
      upright += dz / R.leg
      n++
    }
    const w = Math.min(1, Math.max(0, (upright / n - 0.25) / 0.2))      // 0 lying, 1 standing
    p.hips = [p.hips[0], p.hips[1], p.hips[2] + (sum / n - p.hips[2]) * w]
    // Hands: re-centred on their own shoulder (wide bodies keep their hands outside), scaled to the arm.
    const k = d.arm / R.arm
    for (const [h, side] of [[p.lead, 1], [p.rear, -1]] as const) {
      if (h.board >= 1) continue
      h.pos = [(h.pos[0] - side * R.shoulderX) * k + side * d.shoulderX, h.pos[1] * k, h.pos[2] * k]
    }
    return p
  }

  /**
   * Where the carried board is and where the hands hold it: by the deck's top edge at the side
   * (truck carry, a little swing with the stride), pinned under the arm nose down (underArm; deck
   * against the body, wheels out), or upside down on top of the head held by both hands (head).
   * While climbing it is lifted clear of the ledge.
   */
  private carryFrame(g: Gait, swingPhase: number, climb: number): { xf: THREE.Matrix4; grips: { bone: 'Left' | 'Right'; at: THREE.Vector3; palm: THREE.Vector3; pole: V3 }[] } {
    const c = this.character, d = c.dims
    const toStance = (m: THREE.Vector3) => new THREE.Vector3(m.x, -m.z, m.y)
    const fwd = new THREE.Vector3(0, -1, 0), down = new THREE.Vector3(0, 0, -1), up = new THREE.Vector3(0, 0, 1)
    if (g.carry === 'head') {
      // Wheels up on the head (or the lid), a hand on each rail.
      const h = c.joint('Head')
      const top = toStance(new THREE.Vector3(h.x, h.y + this.current.headTop, h.z))
      const zb = down.clone(), yb = new THREE.Vector3().crossVectors(zb, fwd)
      const R = new THREE.Matrix4().makeBasis(fwd, yb, zb)
      R.premultiply(new THREE.Matrix4().makeRotationY(Math.sin(swingPhase) * 0.05))
      const xf = R.clone().setPosition(top.clone().addScaledVector(up, DECK_TOP + 0.012))
      const rail = (x: number, y: number) => new THREE.Vector3(x, y, DECK_BOTTOM + 0.004).applyMatrix4(xf)
      return { xf, grips: [
        { bone: 'Left', at: rail(0.12, -BOARD.width / 2), palm: new THREE.Vector3(-1, 0, 0), pole: [0.8, 0, -0.3] },
        { bone: 'Right', at: rail(-0.12, BOARD.width / 2), palm: new THREE.Vector3(1, 0, 0), pole: [-0.8, 0, -0.3] },
      ] }
    }
    const side = g.hand === 'lead' ? 1 : -1                      // stance n of the carrying side
    const bone = side > 0 ? 'Left' : 'Right'
    const S = toStance(c.joint(`${bone}Arm`))
    const C = CARRY[g.carry]
    const nose = g.carry === 'underArm' ? fwd.clone().multiplyScalar(Math.cos(0.45)).addScaledVector(down, Math.sin(0.45)) : fwd.clone()
    const zb = new THREE.Vector3(-side, 0, 0)                    // deck normal toward the body
    const yb = new THREE.Vector3().crossVectors(zb, nose)
    const R = new THREE.Matrix4().makeBasis(nose, yb, zb)
    if (g.carry === 'truck') R.premultiply(new THREE.Matrix4().makeRotationX(Math.sin(swingPhase) * 0.12))
    // Climbing: the board swings up and out, nose high, clear of the ledge.
    if (climb > 0) R.premultiply(new THREE.Matrix4().makeRotationX(-side * 0.5 * climb))
    const grip = new THREE.Vector3(C.grip[0], C.grip[1] * side, C.grip[2])
    const wrist = S.clone().add(new THREE.Vector3(side * ((g.out ?? C.out) + 0.06 * climb), -C.fwd, -d.arm * (C.drop - 0.45 * climb)))
    const xf = R.clone().setPosition(wrist.clone().sub(grip.clone().applyMatrix4(R)))
    return { xf, grips: [{ bone, at: grip.clone().applyMatrix4(xf), palm: zb.clone().transformDirection(xf).negate(), pole: [side * 0.6, -0.5, -0.2] }] }
  }

  /** Put the board at a blend of two stance-space transforms (b null: a alone). */
  private placeXf(a: THREE.Matrix4, b: THREE.Matrix4 | null, k: number): THREE.Matrix4 {
    const xf = b ? blendXf(a, b, k) : a.clone()
    this.boardXf.copy(xf)
    this.boardBase.copy(xf)
    this.board.matrix.copy(xf)
    this.board.matrixWorldNeedsUpdate = true
    return xf
  }

  /** The board lying on a ledge top (a world point), along the wall, in stance space. */
  private ledgeXf(at: { x: number; y: number; z: number }): THREE.Matrix4 {
    this.root.updateMatrixWorld(true)
    const p = this.stance.worldToLocal(new THREE.Vector3(at.x, at.y, at.z))
    return new THREE.Matrix4().makeTranslation(p.x, p.y, p.z + 0.004)
  }

  /**
   * Hanging from a ledge by both hands on the lip, facing the wall: the body hangs from the hands
   * (lifted when the character's reach is short), toes down, looking up. Pulling up: the arms bend
   * as the body rises (the sim lifts the feet), a knee comes up onto the ledge, then the walk pose
   * stands up on top.
   */
  private hangPose(p: Pose, H: { top: number; pull: number; at: { x: number; y: number; z: number } }): Pose {
    const c = this.character, d = c.dims
    const hipJointZ = d.ankleH + d.leg * 0.97
    const stand = hipJointZ - d.hipJoint
    const above = d.shoulderY - d.hipsY
    const reach = d.arm * Math.min(c.stretch, 1.3) * 0.96
    // The lip: hangTop is 15 cm back from it, toward the wall (stance -Y is forward).
    this.root.updateMatrixWorld(true)
    const local = this.stance.worldToLocal(new THREE.Vector3(H.at.x, H.at.y, H.at.z))
    const lipF = Math.max(0.12, -local.y - 0.15)
    const pull = H.pull
    const lean = smooth01(0.1, 0.5, pull)                      // chest in over the lip
    const hipsZ = Math.max(stand - 0.1 * lean, H.top + 0.03 - reach - above)
    const lift = hipsZ - stand
    const knee = smooth01(0.35, 0.65, pull)                     // a knee up onto the ledge
    const handZ = H.top + 0.03 - hipsZ - above
    const hang: Pose = {
      ...p,
      hips: [0, -0.07 + 0.1 * lean, hipsZ], hipsRot: [0, -4 + 22 * lean, 0], spine: [0, -6 + 24 * lean, 0], head: [0, -26 + 20 * lean, 0],
      front: {
        pos: [d.hipX, -0.03 + (lipF + 0.05) * knee, lift + 0.03 + (H.top - lift) * knee], board: 0, toe: 0, tilt: -38 * (1 - knee), knee: [0.1, 1, 0.3 + 0.5 * knee],
      },
      back: { pos: [-d.hipX, -0.05, lift + 0.06], board: 0, toe: 0, tilt: -38, knee: [-0.1, 1, 0.4] },
      lead: { pos: [0.18, lipF + 0.07, handZ], board: 0, elbow: [0.6, -0.4, -0.4], curl: 0.85 },
      rear: { pos: [-0.18, lipF + 0.07, handZ], board: 0, elbow: [-0.6, -0.4, -0.4], curl: 0.85 },
    }
    // A little swing while just hanging.
    if (pull === 0) hang.hipsRot = [Math.sin(this.tick * 0.05) * 4, -4, 0]
    return lerpPose(p, hang, 1 - smooth01(0.8, 1, pull))
  }

  /**
   * 0..1 through a board drop (1 = not dropping). The sim keeps no record of it, so it is read from
   * the state: a ground state that did not begin with the last landing (lastLand and the world tick),
   * after walking (stride > 0), faster than pushing from rest could explain (not a bail recovery).
   */
  private dropK(t: Thing, data: GameData, alpha: number): number {
    if (t.state !== 'ground' || this.tick < 0 || !(t.stride > 0)) return 1
    const since = t.stateTicks + alpha
    if (since > 12) return 1
    const L = t.lastLand
    if (L && L.tick >= 0 && Math.abs(this.tick + alpha - L.tick - since) < 1.5) return 1
    const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
    if (speed < 0.6 + (data.physics.ground.pushAccel * since) / data.physics.tickHz) return 1
    const k = Math.min(1, since / 12)
    return k * k * (3 - 2 * k)
  }

  /** On foot: the board in the carry (from the ground at the feet, or the ledge, while picking it up), hands on it. */
  private carryBoard(g: Gait, pickup: number, swingPhase: number, climb: number, from: THREE.Matrix4 | null = null) {
    const { xf: carry, grips } = this.carryFrame(g, swingPhase, climb)
    const ground = from ?? new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1))
    const xf = this.placeXf(ground, carry, pickup)
    const back = new THREE.Matrix4().copy(carry).invert()
    for (const gr of grips) {
      const at = gr.at.clone().applyMatrix4(back).applyMatrix4(xf)   // the grip, wherever the board is now
      this.character.solveArm(gr.bone, toModel(at), dirModel(gr.pole), toModel(new THREE.Vector3(0, 0, -1)), toModel(gr.palm), 0.9)
    }
    return grips.map((gr) => gr.bone)
  }

  /** Board transform in stance space: offsets, pitch about a contact point, flip about the centre. */
  private placeBoard(ev: Eval) {
    const b = ev.pose.board
    const pivotAt = (k: number): [number, number] => {
      const pts: [number, number, number][] = [[-1, TAIL_TIP.x, TAIL_TIP.z - BOARD.thickness], [-0.5, -BOARD.axleX, 0], [0, 0, BOARD.pivotZ], [0.5, BOARD.axleX, 0], [1, NOSE_TIP.x, NOSE_TIP.z - BOARD.thickness]]
      const kk = Math.max(-1, Math.min(1, k))
      let i = 0
      while (i < pts.length - 2 && kk > pts[i + 1][0]) i++
      const u = (kk - pts[i][0]) / (pts[i + 1][0] - pts[i][0])
      return [pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * u]
    }
    const [px, pz] = pivotAt(b.pivot)
    const m = new THREE.Matrix4().makeRotationY(this.pitchFix).multiply(new THREE.Matrix4().makeTranslation(b.n, -b.f, b.lift))
    // Yaw (+ = nose toward the toe side) and pitch (+ = nose up) about the contact pivot, so a
    // grinding truck stays on the rail when the board angles across it.
    m.multiply(new THREE.Matrix4().makeTranslation(px, 0, pz))
    m.multiply(new THREE.Matrix4().makeRotationZ(-b.yaw * D2R))
    m.multiply(new THREE.Matrix4().makeRotationY(-b.pitch * D2R))
    m.multiply(new THREE.Matrix4().makeTranslation(-px, 0, -pz))
    this.boardBase.copy(m)
    // Flip tricks (turns from the sim) and grab tweaks about the deck centre, or the flip's own pivot
    // (the impossible wraps round the back foot). Kickflip (+roll) dips the heel-side edge first (the
    // front foot flicks off the heel-side corner of the nose), the pose's roll tweak (+) lifts it; +yaw
    // is a backside shove (tail behind the rider); +pitch is nose up.
    const f = ev.flip, [fn, fu] = f.pivot ?? [0, 0]
    m.multiply(new THREE.Matrix4().makeTranslation(fn, 0, BOARD.pivotZ + fu))
    m.multiply(new THREE.Matrix4().makeRotationZ(-f.yaw * 360 * D2R))
    m.multiply(new THREE.Matrix4().makeRotationY(-f.pitch * 360 * D2R))
    m.multiply(new THREE.Matrix4().makeRotationX((-f.roll * 360 + b.roll + this.rollFix) * D2R))
    m.multiply(new THREE.Matrix4().makeTranslation(-fn, 0, -BOARD.pivotZ - fu))
    this.boardXf.copy(m)
    this.board.matrix.copy(m)
    this.board.matrixWorldNeedsUpdate = true
  }

  /** A point on the grip (board space, stance vector [n, f, lift]) and the deck normal there, in stance coordinates. */
  private onBoard(n: number, f: number, lift: number, xf = this.boardXf) {
    const y = -f
    const s = deckSlope(n)
    const p = new THREE.Vector3(n, y, deckTopZ(n, y) + lift).applyMatrix4(xf)
    const nrm = new THREE.Vector3(-Math.sin(s), 0, Math.cos(s)).transformDirection(xf)
    return { p, nrm }
  }

  private solveFoot(side: 'Left' | 'Right', f: Foot, flipping: boolean) {
    const c = this.character
    // During a flip trick the feet aim at the board as it was (and will be at the catch), not
    // at the spinning deck.
    const xf = flipping ? this.boardBase : this.boardXf
    // Toe direction in stance coordinates: 0 deg = across the board to the toe side, + toward the nose.
    const toeFlat = new THREE.Vector3(Math.sin(f.toe * D2R), -Math.cos(f.toe * D2R), 0)
    // On the board: sole on the grip, foot following the deck (kicks included).
    const ob = this.onBoard(f.pos[0], f.pos[1], f.pos[2], xf)
    const toeB = toeFlat.clone().transformDirection(xf)
    // Off the board: position relative to the rider frame's ground.
    const pR = stanceVec(f.pos)
    const w = Math.max(0, Math.min(1, f.board))
    const sole = pR.lerp(ob.p, w)
    const up = Z.clone().lerp(ob.nrm, w).normalize()
    const toe = toeFlat.lerp(toeB, w)
    toe.addScaledVector(up, -toe.dot(up)).normalize()
    if (f.tilt) {
      // Tilt: + lifts the toes (heel down).
      const axis = new THREE.Vector3().crossVectors(toe, up).normalize()
      const q = new THREE.Quaternion().setFromAxisAngle(axis, -f.tilt * D2R)
      toe.applyQuaternion(q); up.applyQuaternion(q)
    }
    const ankle = sole.clone().addScaledVector(up, c.dims.ankleH).addScaledVector(toe, -c.dims.soleFwd)
    c.solveLeg(side, toModel(ankle), dirModel(f.knee), toModel(toe), toModel(up))
  }

  private solveHand(side: 'Left' | 'Right', h: Hand, shoulders: THREE.Vector3, grab: Eval['grab']) {
    const c = this.character
    let wrist = shoulders.clone().add(new THREE.Vector3(h.pos[0], h.pos[2], h.pos[1]))
    if (h.board > 0) {
      const ob = this.onBoard(h.pos[0], h.pos[1], h.pos[2])
      wrist = wrist.lerp(toModel(ob.p), Math.min(1, h.board))
    }
    let fingers: THREE.Vector3 | undefined, palm: THREE.Vector3 | undefined
    let curl = h.curl
    if (grab && grab.w > 0) {
      // Grasp point on the board; the palm faces in toward the board, fingers wrap under.
      const [n, f, u] = grab.at
      const g = this.onBoard(n, f, u)
      const atEnd = Math.abs(n) > 0.3
      const inward = (atEnd ? new THREE.Vector3(-Math.sign(n), 0, 0) : new THREE.Vector3(0, Math.sign(f), 0)).transformDirection(this.boardXf)
      const boardUp = new THREE.Vector3(0, 0, 1).transformDirection(this.boardXf)
      const target = g.p.clone().addScaledVector(inward, -0.04).addScaledVector(boardUp, 0.055)
      wrist = wrist.lerp(toModel(target), grab.w)
      if (grab.w > 0.5) { fingers = toModel(boardUp.clone().negate().addScaledVector(inward, 0.5).normalize()); palm = toModel(inward) }
      curl = curl + (0.9 - curl) * grab.w
    }
    // A signature prop out (a created skater's, kitpeople.ts): that hand holds it in its frame, upright.
    const sig = c.root.userData.signature as { out: boolean; hands: Record<string, string> } | undefined
    if (!fingers && sig?.out && sig.hands[side]) { const [f, pl] = frameFor(sig.hands[side], side); fingers = new THREE.Vector3(...f); palm = new THREE.Vector3(...pl); curl = Math.max(curl, 0.7) }
    c.solveArm(side, wrist, dirModel(h.elbow), fingers, palm, curl)
  }
}
