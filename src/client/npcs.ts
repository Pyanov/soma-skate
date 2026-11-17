import * as THREE from 'three'
import type { GameData } from '../sim/data.ts'
import type { Thing } from '../sim/thing.ts'
import { applyMaterials, toonify } from './look.ts'
import { buildCharacter } from './skater/characters.ts'
import { bakeBoard, bakeFarRig, restSkeleton } from './skater/lod.ts'
import { cheerTicks, DEFAULT_REACT, pointTicks, type NpcReact, type ReactData } from './skater/react.ts'
import type { SkaterView } from './skater/view.ts'
import type { PopData } from './tags.ts'

// The NPC skaters (sim/game/npc.ts) drawn with the characters: each gets its own SkaterView of one
// character and outfit (picked by its fixed look), posed from its Thing exactly like the player, so
// it pushes, pops, flips, grinds, celebrates a landing and falls apart in a bail the same way.
// Cheap at a distance: off-screen or far NPCs are not drawn or solved, small parts drop out with
// distance (fur shells first), only big parts cast shadows, and far poses update every other frame.
// Park NPCs also react (skater/react.ts): they cheer your big combos, point at you as they set off to
// copy your line, and wait for their turn at a spot standing off the board, watching who rides.

export type NpcViewData = { maxDistance: number; nearDistance: number; detail: number; furDistance: number; shadowRadius: number; halfRateBeyond: number; react?: ReactData; pop?: PopData; locals?: LocalsData }
/** The EMB and Pier 7 locals (data/characters.json npcs.locals): their lines, looks, and what they say (voice line ids). */
export type LocalsData = { lines: string[]; looks: { id: string; outfit: string }[]; range: number; cooldown: number; say: Record<'cheer' | 'bail' | 'copy', string[]> }

type Part = { m: THREE.Mesh; r: number; fur: boolean; shown: boolean; keep: boolean }
type Slot = { id: number; key: string; view: SkaterView; parts: Part[]; baked: THREE.Mesh[]; isFar: boolean; style: string; solved: number; at: THREE.Vector3 }
export type NpcFrame = { cur: Thing; prev?: Thing }

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const HIDE = 31   // a camera layer nothing renders: parts dropped for distance (hooks keep .visible)

export class NpcViews {
  readonly group = new THREE.Group()
  private player: SkaterView
  private gradient: THREE.Texture | null
  private d: NpcViewData
  private slots = new Map<string, Slot>()          // `${npc id}|${character}:${outfit}` -> its view
  private current = new Map<number, Slot>()        // npc id -> the view it shows now
  private free = new Map<string, Slot[]>()         // built ahead, not yet anyone's: `${character}:${outfit}` -> views
  private frame = 0
  private style = 'cute'
  private frustum = new THREE.Frustum()
  private frustum2 = new THREE.Frustum()
  private m = new THREE.Matrix4()
  private sphere = new THREE.Sphere()
  /** You (the player's skater this frame), for the NPCs that cheer you, point at you or watch you ride; null = nobody. */
  you: Thing | null = null
  private waited = new Map<number, { tick: number; w: number; x: number; y: number }>()   // npc id -> when it last stood waiting
  /** Per frame: NPCs drawn, solved, and their parts drawn (for the fps probe). */
  stats = { npcs: 0, drawn: 0, solved: 0, parts: 0, ms: 0 }

  constructor(player: SkaterView, gradient: THREE.Texture | null, d?: NpcViewData) {
    this.player = player
    this.gradient = gradient
    this.d = d ?? player.data.npcs ?? { maxDistance: 90, nearDistance: 10, detail: 0.0012, furDistance: 9, shadowRadius: 0.09, halfRateBeyond: 28 }
    this.group.name = 'npcs'
  }

  /** Every character and outfit, in characters.json order. */
  private looks(): { id: string; outfit: string }[] {
    // Never a secret skater (data unlock): they are earned, not seen around the park.
    return this.player.data.characters.filter((c) => !c.unlock).flatMap((c) => [{ id: c.id, outfit: 'default' }, ...(c.outfits ?? []).map((o) => ({ id: c.id, outfit: o.id }))])
  }

  /** The quality preset: how far NPCs are drawn at all, and within how many metres they are drawn in full (beyond: the baked rig). */
  setLod(maxDistance: number, nearDistance: number) { this.d = { ...this.d, maxDistance, nearDistance } }

  /** The rider line a park NPC rides (index into the park's lines -> its id), for the locals' looks; set by the game. */
  lineId: (i: number) => string = () => ''

  /** Is this NPC one of the EMB and Pier 7 locals now (riding one of their lines)? */
  isLocal(t: Thing): boolean {
    const L = this.d.locals
    return !!L && !!t.npc?.life && L.lines.includes(this.lineId(t.npc.line))
  }

  /** The character and outfit an NPC wears: its look, stepping on to another character than the player's (a local: one of the locals' looks). */
  lookOf(t: Thing): { id: string; outfit: string } {
    const local = this.isLocal(t) ? this.d.locals!.looks.filter((l) => l.id !== this.player.characterId) : null
    if (local?.length) return local[Math.min(local.length - 1, Math.floor(((t.npc?.look ?? t.id) % 1000) * local.length / 1000))]
    const all = this.looks(), n = all.length
    // 0..999 spread evenly over every look; never the player's character (the next character's look instead).
    let i = Math.min(n - 1, Math.floor(((t.npc?.look ?? t.id) % 1000) * n / 1000))
    for (let k = 0; k < n && all[i].id === this.player.characterId; k++) i = (i + 1) % n
    return all[i]
  }

  /** The character id an NPC is drawn as (for its voice). */
  characterOf(id: number): string { return this.current.get(id)?.view.characterId ?? '' }

  private build(t: Thing, key: string, look: { id: string; outfit: string }, tick: number, data: GameData): Slot {
    const spec = this.player.data.characters.find((c) => c.id === look.id)!
    const built = buildCharacter(spec, look.outfit === 'default' ? null : look.outfit)
    if (this.gradient) toonify(built.character.root, this.gradient)
    built.character.root.traverse((o) => { const l = o.userData.looks; if (l && l.grey.transparent) (l.cute as THREE.Material).depthWrite = false })
    const skel = restSkeleton(built.character.root)   // before the first pose
    const view = this.player.twin(built, true)   // NPCs ride the character's own deck
    view.root.name = `npc:${t.id}`
    view.ground = this.player.ground
    // The first pose settles the hooks' props; then the cheap far rig is baked from it.
    view.tick = tick
    view.update(t, data, 1)
    view.root.updateMatrixWorld(true)
    const rig = bakeFarRig(built.character.root, skel), deck = bakeBoard(view.board)
    const parts: Part[] = []
    const ws = new THREE.Vector3()
    view.root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return
      if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
      m.getWorldScale(ws)
      const r = (m.geometry.boundingSphere?.radius ?? 1) * Math.max(ws.x, ws.y, ws.z)
      const fur = !!(m.userData.looks && (m.userData.looks.cute as THREE.Material).visible === false)
      if (m.castShadow && r < this.d.shadowRadius) m.castShadow = false
      parts.push({ m, r, fur, shown: true, keep: rig.kept.includes(m) })
    })
    for (const m of rig.meshes) built.character.root.add(m)
    for (const m of deck) view.board.add(m)
    const baked: THREE.Mesh[] = [...rig.meshes, ...deck]
    for (const m of baked) m.layers.set(HIDE)
    const slot: Slot = { id: t.id, key, view, parts, baked, isFar: false, style: '', solved: -10, at: new THREE.Vector3() }
    this.slots.set(key, slot)
    this.group.add(view.root)
    return slot
  }

  /** The reaction numbers (characters.json npcs.react). */
  get reactData(): ReactData { return this.d.react ?? DEFAULT_REACT }
  /** When a cheer's tail taps slap down, seconds from its start (for their clacks). */
  cheerTaps(hz: number): number[] { const R = this.reactData; return [...Array(R.taps)].map((_, i) => (R.tapFrom + (i + 0.6) * R.tapEvery) / hz) }

  /**
   * A park NPC's reactions this frame (null: none): its cheer and its point from the sim's fields,
   * how much it stands waiting (blended out over waitLeave as it sets off), and who it looks at: you
   * while it cheers or points, else the nearest skater riding by.
   */
  private reactOf(cur: Thing, all: NpcFrame[], tick: number, alpha: number): NpcReact | null {
    const L = cur.npc?.life
    if (!L) { this.waited.delete(cur.id); return null }   // hill bomb rivals and S.K.A.T.E. locals
    const RD = this.reactData
    // Picked to copy your line, it points at you instead of cheering (the sim places it at your start).
    const point = pointTicks(cur, alpha, RD), cheer = L.copy ? -1 : cheerTicks(cur, tick, alpha, RD)
    let wait = 0
    if (cur.npc!.act === 'wait') {
      wait = smooth(0, RD.waitBlend, L.wait + alpha)
      this.waited.set(cur.id, { tick: tick + alpha, w: wait, x: cur.pos.x, y: cur.pos.y })
    } else {
      const w = this.waited.get(cur.id)
      const dt = w ? tick + alpha - w.tick : Infinity
      if (w && dt >= 0 && dt < RD.waitLeave && Math.hypot(cur.pos.x - w.x, cur.pos.y - w.y) < 1.5) wait = w.w * (1 - smooth(0, RD.waitLeave, dt))
      else this.waited.delete(cur.id)
    }
    if (cheer < 0 && point < 0 && wait <= 0) return null
    const you = this.you
    let at: NpcReact['at'] = null
    if ((cheer >= 0 || point >= 0) && you) at = { x: you.pos.x, y: you.pos.y, z: you.pos.z + 1 }
    else {
      // Who it watches: the nearest skater rolling by (you, or another NPC not waiting too).
      let best = RD.lookRange
      const look = (o: Thing) => {
        if (o.id === cur.id || !o.alive || o.npc?.act === 'wait' || Math.hypot(o.vel.x, o.vel.y) < RD.lookSpeed) return
        const d = Math.hypot(o.pos.x - cur.pos.x, o.pos.y - cur.pos.y)
        if (d < best) { best = d; at = { x: o.pos.x, y: o.pos.y, z: o.pos.z + 1 } }
      }
      if (you) look(you)
      for (const f of all) look(f.cur)
    }
    return { cheer, point, wait, at }
  }

  /**
   * Build views ahead (while loading) for NPCs that will spawn: the looks of a dry run of the spawn,
   * each posed once from a sample skater. sync hands them out by look, so a spawn costs no frame.
   */
  /** Is this NPC drawn already (it appeared before the prebuild ran)? */
  has(id: number) { return this.current.has(id) }

  prebuild(npcs: Thing[], sample: Thing, tick: number, data: GameData) {
    for (const t of npcs) {
      const look = this.lookOf(t), combo = `${look.id}:${look.outfit}`
      const slot = this.build({ ...sample, id: -1 - this.slots.size }, `free|${combo}|${this.slots.size}`, look, tick, data)
      slot.view.root.visible = false
      this.free.set(combo, [...(this.free.get(combo) ?? []), slot])
    }
  }

  /** The look to draw in (cute, real, grey). */
  setStyle(style: string) { this.style = style }

  /**
   * Draw these NPCs for this frame: tick and alpha as for the player (prev for the in-between
   * position), the camera for culling and detail. buildAll builds every missing view now (shots,
   * clips); otherwise one per frame, so a spawn never stalls a frame.
   */
  /** camera2: split screen's second view (player 2's): an NPC either view sees is drawn and solved, at the nearer view's detail. */
  sync(npcs: NpcFrame[], tick: number, alpha: number, data: GameData, camera: THREE.Camera | null, buildAll = false, camera2: THREE.Camera | null = null) {
    this.frame++
    const t0 = performance.now()
    const seen = new Set<number>()
    let builds = buildAll ? Infinity : 1
    if (camera) { camera.updateMatrixWorld(); this.frustum.setFromProjectionMatrix(this.m.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)) }
    const camPos = camera ? new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld) : null
    if (camera && camera2) { camera2.updateMatrixWorld(); this.frustum2.setFromProjectionMatrix(this.m.multiplyMatrices(camera2.projectionMatrix, camera2.matrixWorldInverse)) }
    const camPos2 = camera && camera2 ? new THREE.Vector3().setFromMatrixPosition(camera2.matrixWorld) : null
    this.stats = { npcs: npcs.length, drawn: 0, solved: 0, parts: 0, ms: 0 }
    for (const [i, { cur, prev }] of npcs.entries()) {
      seen.add(cur.id)
      const look = this.lookOf(cur), key = `${cur.id}|${look.id}:${look.outfit}`
      let slot = this.slots.get(key)
      const ready = slot ? null : this.free.get(`${look.id}:${look.outfit}`)?.pop()
      if (ready) { this.slots.delete(ready.key); ready.id = cur.id; ready.key = key; ready.view.root.name = `npc:${cur.id}`; this.slots.set(key, ready); slot = ready }
      if (!slot) {
        if (builds <= 0) { const old = this.current.get(cur.id); if (old) old.view.root.visible = false; continue }
        builds--
        slot = this.build(cur, key, look, tick, data)
      }
      const was = this.current.get(cur.id)
      if (was && was !== slot) was.view.root.visible = false
      this.current.set(cur.id, slot)
      let t: Thing = prev && alpha < 1 ? {
        ...cur,
        pos: { x: lerp(prev.pos.x, cur.pos.x, alpha), y: lerp(prev.pos.y, cur.pos.y, alpha), z: lerp(prev.pos.z, cur.pos.z, alpha) },
        fwd: { x: lerp(prev.fwd.x, cur.fwd.x, alpha), y: lerp(prev.fwd.y, cur.fwd.y, alpha), z: lerp(prev.fwd.z, cur.fwd.z, alpha) },
        up: { x: lerp(prev.up.x, cur.up.x, alpha), y: lerp(prev.up.y, cur.up.y, alpha), z: lerp(prev.up.z, cur.up.z, alpha) },
      } : cur
      // Waiting for its turn the sim holds it where it was placed (still in the air state, a hair above
      // the ground): drawn standing on the ground.
      if (cur.npc?.act === 'wait') t = { ...t, state: 'ground', stateTicks: cur.npc.life?.wait ?? 0, airTicks: 0, vel: { x: 0, y: 0, z: 0 } }
      // Culling: off screen or far, not drawn and not solved.
      const dist1 = camPos ? camPos.distanceTo(new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z)) : 0
      const dist2 = camPos2 ? camPos2.distanceTo(new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z)) : Infinity
      this.sphere.center.set(t.pos.x, t.pos.y, t.pos.z + 0.6); this.sphere.radius = 1.6
      const seen1 = dist1 <= this.d.maxDistance && this.frustum.intersectsSphere(this.sphere)
      const seen2 = !!camPos2 && dist2 <= this.d.maxDistance && this.frustum2.intersectsSphere(this.sphere)
      if (camera && !seen1 && !seen2) { slot.view.root.visible = false; continue }
      const dist = Math.min(seen1 ? dist1 : Infinity, seen2 ? dist2 : Infinity, camera ? Infinity : 0)
      slot.view.root.visible = true
      this.stats.drawn++
      if (slot.style !== this.style) { applyMaterials(slot.view.root, this.style as 'cute' | 'real' | 'grey'); slot.style = this.style }
      // Far: the pose every other frame (alternating NPCs), the position still every frame.
      const half = camera && dist > this.d.halfRateBeyond && (this.frame + i) % 2 === 1 && this.frame - slot.solved <= 1
      if (!half) {
        slot.view.react = this.reactOf(cur, npcs, tick, alpha)
        slot.view.tick = tick
        slot.view.update(t, data, alpha)
        slot.solved = this.frame
        this.stats.solved++
      } else slot.view.root.position.add(new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z).sub(slot.at))   // last frame's pose, carried along
      slot.at.set(t.pos.x, t.pos.y, t.pos.z)
      // Detail: near, every part (small ones and fur shells drop out with distance); beyond
      // nearDistance, the baked rig (a few skinned meshes on the same bones) instead.
      const isFar = !!camera && dist > this.d.nearDistance
      if (isFar !== slot.isFar) { for (const m of slot.baked) m.layers.set(isFar ? 0 : HIDE); slot.isFar = isFar }
      if (isFar) this.stats.parts += slot.baked.length
      for (const p of slot.parts) {
        const show = isFar ? p.keep : !camera || (p.fur ? dist < this.d.furDistance : p.r > this.d.detail * dist)
        if (show !== p.shown) { p.m.layers.set(show ? 0 : HIDE); p.shown = show }
        if (show && p.m.visible) this.stats.parts++
      }
    }
    // NPCs gone (cleared, a new world): hide their views.
    for (const [id, slot] of this.current) if (!seen.has(id)) { slot.view.root.visible = false; this.current.delete(id) }
    this.stats.ms = performance.now() - t0
  }
}
