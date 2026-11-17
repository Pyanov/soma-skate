import * as THREE from 'three'
import type { GameData } from '../sim/data.ts'
import type { Thing } from '../sim/thing.ts'
import { buildCharacter } from './skater/characters.ts'
import type { SkaterView } from './skater/view.ts'

// The hill bomb race ghost (sim/ghost.ts frames): the player's own character and outfit, posed from
// the ghost's skater state like the player, drawn in one see-through tint so it reads as a ghost and
// not a second rider. No shadow, no depth write (the AO and ink passes skip it), no face decals
// (a tinted decal would be a solid quad), no fur shells.

export type GhostData = { tint: string; opacity: number }

export class GhostView {
  readonly group = new THREE.Group()
  private player: SkaterView
  private d: GhostData
  private view: SkaterView | null = null
  private key = ''
  private mat: THREE.MeshLambertMaterial

  constructor(player: SkaterView, d?: GhostData) {
    this.player = player
    this.d = d ?? player.data.ghost ?? { tint: '#7fdcff', opacity: 0.35 }
    const tint = new THREE.Color(this.d.tint)
    this.mat = new THREE.MeshLambertMaterial({ color: tint, emissive: tint.clone().multiplyScalar(0.35), transparent: true, opacity: this.d.opacity, depthWrite: false, fog: true })
    this.group.name = 'ghost'
    this.group.renderOrder = 4
    this.group.visible = false
  }

  /** The see-through view of the player's current character (rebuilt when the player changes). */
  private ensure(): SkaterView {
    const tint = this.player.tintFor(this.player.characterId)
    const key = `${this.player.characterId}:${this.player.outfitId}:${JSON.stringify(tint)}`
    if (this.view && key === this.key) return this.view
    if (this.view) this.group.remove(this.view.root)
    const spec = this.player.data.characters.find((c) => c.id === this.player.characterId)!
    const built = buildCharacter(spec, this.player.outfitId === 'default' ? null : this.player.outfitId, tint)
    // Painted in the picker: the ghost takes your main colour (lifted toward white so it still reads as a ghost).
    const main = tint ? Object.values(tint)[0] : null
    const c = main ? new THREE.Color(main).lerp(new THREE.Color('#ffffff'), 0.35) : new THREE.Color(this.d.tint)
    this.mat.color.copy(c); this.mat.emissive.copy(c).multiplyScalar(0.35)
    const view = this.player.twin(built)
    view.root.name = 'ghost:rider'
    view.root.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh) return
      const orig = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshLambertMaterial
      const decal = !!orig?.map && (orig.transparent || orig.alphaTest > 0)
      const fur = !!(m.userData.looks && (m.userData.looks.cute as THREE.Material).visible === false)
      m.material = this.mat
      m.userData = { ...m.userData, looks: undefined }   // never swapped back by a style change
      m.castShadow = false; m.receiveShadow = false
      m.renderOrder = 4
      if (decal || fur || orig?.visible === false) m.layers.set(31)   // drawn by nothing
    })
    this.view = view; this.key = key
    this.group.add(view.root)
    return view
  }

  /** The ghost at this frame of its run (null: none); prev and alpha for the in-between position. */
  set(frame: Thing | null, data: GameData, prev?: Thing, alpha = 1) {
    this.group.visible = !!frame
    if (!frame) return
    const view = this.ensure()
    const k = prev ? alpha : 1, l = (a: number, b: number) => a + (b - a) * k
    const t: Thing = prev ? {
      ...frame,
      pos: { x: l(prev.pos.x, frame.pos.x), y: l(prev.pos.y, frame.pos.y), z: l(prev.pos.z, frame.pos.z) },
      fwd: { x: l(prev.fwd.x, frame.fwd.x), y: l(prev.fwd.y, frame.fwd.y), z: l(prev.fwd.z, frame.fwd.z) },
      up: { x: l(prev.up.x, frame.up.x), y: l(prev.up.y, frame.up.y), z: l(prev.up.z, frame.up.z) },
    } : frame
    view.update(t, data, k)
  }
}
