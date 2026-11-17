import * as THREE from 'three'

// World markers for the story (story.ts): a soft light column over each character with a story to
// give, each neighbourhood's challenges and each gig board, a flat mark floating above it (a triangle pointing
// down for a story, a diamond for challenges, a square for a gig board; the accent for the main story, paper
// for the rest), and small bobbing tokens for a mission's items (crumbs, paperwork). Seen from far away, faded
// with distance, never casting shadows or writing depth.

export type Marker = { key: string; kind: 'story' | 'side' | 'challenge' | 'item' | 'job'; x: number; y: number; z: number; sticker?: string }

/** The house colours (docs/art-direction.md): the accent for the story, paper for the rest (a gig board too). */
const COLORS: Record<Marker['kind'], number> = { story: 0xff4f1f, side: 0xf2efe8, challenge: 0xf2efe8, item: 0xff4f1f, job: 0xf2efe8 }

type Slot = { g: THREE.Group; col: THREE.Mesh; face: THREE.Sprite | null; kind: Marker['kind'] }

/** A flat mark drawn once: a triangle pointing down, or a diamond. */
function markTexture(shape: 'down' | 'diamond' | 'square', color: string): THREE.Texture {
  const c = document.createElement('canvas'); c.width = c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = color
  g.beginPath()
  if (shape === 'down') { g.moveTo(8, 14); g.lineTo(56, 14); g.lineTo(32, 54) } else if (shape === 'square') { g.rect(14, 14, 36, 36) } else { g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32) }
  g.closePath(); g.fill()
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

export class Markers {
  readonly group = new THREE.Group()
  private slots = new Map<string, Slot>()
  private tex = new Map<string, THREE.Texture>()
  private colGeo = new THREE.CylinderGeometry(0.55, 0.55, 26, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, 13)
  private tokenGeo = new THREE.OctahedronGeometry(0.28, 0)
  /** Metres beyond which a column is not drawn. */
  far = 650

  constructor() { this.group.name = 'story-markers'; this.group.renderOrder = 5 }

  private texture(kind: Marker['kind']) {
    let t = this.tex.get(kind)
    if (!t) { t = markTexture(kind === 'challenge' ? 'diamond' : kind === 'job' ? 'square' : 'down', kind === 'story' ? '#ff4f1f' : '#f2efe8'); this.tex.set(kind, t) }
    return t
  }

  private build(m: Marker): Slot {
    const g = new THREE.Group()
    const color = COLORS[m.kind]
    let col: THREE.Mesh
    if (m.kind === 'item') {
      col = new THREE.Mesh(this.tokenGeo, new THREE.MeshBasicMaterial({ color, fog: false }))
      col.position.z = 0.9
    } else {
      col = new THREE.Mesh(this.colGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }))
    }
    g.add(col)
    let face: THREE.Sprite | null = null
    if (m.kind !== 'item') {
      face = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture(m.kind), transparent: true, depthWrite: false, fog: false }))
      face.position.z = 3.1
      face.scale.set(0.6, 0.6, 1)
      g.add(face)
    }
    this.group.add(g)
    return { g, col, face, kind: m.kind }
  }

  /** This frame's markers, the camera and the time (seconds): adds, moves and drops columns to match. */
  set(list: Marker[], cam: THREE.Vector3, t: number) {
    const keep = new Set<string>()
    for (const m of list) {
      keep.add(m.key)
      let s = this.slots.get(m.key)
      if (s && s.kind !== m.kind) { this.drop(m.key); s = undefined }
      if (!s) { s = this.build(m); this.slots.set(m.key, s) }
      const d = Math.hypot(m.x - cam.x, m.y - cam.y)
      s.g.visible = d < (m.kind === 'item' ? 160 : this.far)
      if (!s.g.visible) continue
      s.g.position.set(m.x, m.y, m.z)
      if (m.kind === 'item') { s.col.rotation.z = t * 2; s.col.position.z = 0.9 + Math.sin(t * 3 + m.x) * 0.15 }
      else {
        // Thinner and fainter up close (it would fill the screen), brighter far away.
        // Close by (you are at it: the talk prompt says so) the column goes; the mark stays.
        const mat = s.col.material as THREE.MeshBasicMaterial
        mat.opacity = Math.min(0.32, 0.06 + d / 300)
        const w = Math.max(0.3, Math.min(1.4, d / 130))
        s.col.scale.set(w, w, 1)
        s.col.visible = d > 14
        if (s.face) { s.face.position.z = 3.1 + Math.sin(t * 1.6 + m.y) * 0.08; const k = Math.max(0.5, Math.min(2.2, d / 50)); s.face.scale.set(k, k, 1) }
      }
    }
    for (const k of [...this.slots.keys()]) if (!keep.has(k)) this.drop(k)
  }

  private drop(key: string) {
    const s = this.slots.get(key)
    if (!s) return
    this.group.remove(s.g)
    ;(s.col.material as THREE.Material).dispose()
    if (s.face) (s.face.material as THREE.Material).dispose()
    this.slots.delete(key)
  }
}
