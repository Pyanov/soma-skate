import * as THREE from 'three'
import type { GameData } from '../sim/data.ts'
import { makeThing } from '../sim/thing.ts'
import { applyMaterials } from './look.ts'
import { buildCharacter, type CharacterSpec } from './skater/characters.ts'
import type { SkaterView } from './skater/view.ts'

// Portraits in the house treatment (docs/art-direction.md): each character's in-game model, standing,
// head and shoulders from a little to one side, lit from one side, then near monochrome (ink to paper),
// a little grain, on a flat field (ink, or the accent). tools/portraits.ts asks the dev client for them
// (__skateGame.portraits) and writes assets/ui/portrait/<id>.jpg. Draw-only, never in play.

/** frame: the share of the figure's height in the picture, from its top (default 0.42 for people, 0.36 for the pickable skaters, 0.55 for anyone short). */
/** turn: that many frames side by side, the camera going once round the whole figure (a reward turning: the results card steps through them). */
export type PortraitJob = { id: string; model: string; outfit?: string | null; field: 'ink' | 'accent'; frame?: number; turn?: number }

const INK = [11, 11, 12], PAPER = [242, 239, 232], ACCENT = [255, 79, 31]

/** A small seeded hash: the same grain on every run. */
const grain = (i: number, seed: number) => { let h = (i * 374761393 + seed * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 - 0.5 }

export async function renderPortraits(player: SkaterView, data: GameData, jobs: PortraitJob[], size = 320): Promise<Record<string, string>> {
  const S = size * 2   // drawn at twice the size, then halved: clean edges
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = S
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true })
  renderer.setClearColor(0x000000, 0)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.NeutralToneMapping
  const scene = new THREE.Scene()
  // One side light (key, from camera left and above), a low fill so the far side is not lost.
  const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(-3, 2.2, 2.6); scene.add(key)
  scene.add(new THREE.HemisphereLight(0xffffff, 0x303030, 0.9))
  const cam = new THREE.PerspectiveCamera(24, 1, 0.05, 50); cam.up.set(0, 0, 1)
  const specs = [...player.data.characters, ...(player.data.people ?? [])] as CharacterSpec[]
  const out: Record<string, string> = {}
  const flat = document.createElement('canvas'); flat.width = flat.height = size
  const g = flat.getContext('2d', { willReadFrequently: true })!
  for (const job of jobs) {
    const spec = specs.find((x) => x.id === job.model)
    if (!spec) continue
    let view: SkaterView
    try { view = player.twin(buildCharacter(spec, job.outfit ?? null), true) } catch (e) { console.warn('portrait', job.id, e); continue }
    applyMaterials(view.root, 'real')
    // Standing, on foot, facing +y (the sim's forward), at rest.
    const t = makeThing(-1, 'npc')
    t.state = 'walk'; t.pos = { x: 0, y: 0, z: 0 }; t.fwd = { x: 0, y: 1, z: 0 }; t.vel = { x: 0, y: 0, z: 0 }
    view.tick = 0
    view.update(t, data, 1)
    scene.add(view.root)
    view.root.updateMatrixWorld(true)
    // Hide the board (it is in the hand or on the ground; the portrait is the face).
    view.root.traverse((o) => { if (/board|deck|wheel|truck/i.test(o.name)) o.visible = false })
    // The figure's box from what is drawn (a hidden board or prop must not move the frame).
    const box = new THREE.Box3(), part = new THREE.Box3()
    view.root.traverseVisible((o) => { const m = o as THREE.Mesh; if (!m.isMesh || !m.geometry) return; m.geometry.computeBoundingBox(); part.copy(m.geometry.boundingBox!).applyMatrix4(m.matrixWorld); box.union(part) })
    if (box.isEmpty()) { scene.remove(view.root); continue }
    const h = Math.max(0.3, box.max.z - box.min.z), top = box.max.z
    // Head and shoulders: the top of the figure, seen from 22 degrees to the right.
    // The pickable skaters (a can, a blob, a cloud: faces anywhere) show more of themselves than the people.
    const k = job.frame ?? (h < 1.1 ? 0.55 : job.field === 'accent' ? 0.36 : 0.42)
    const frames = Math.max(1, job.turn ?? 0), whole = frames > 1
    // A turn shows the whole figure (its widest side fits as it goes round); a portrait the head and shoulders.
    const frame = whole ? Math.max(h, box.max.x - box.min.x, box.max.y - box.min.y) * 1.08 : h * k
    const cz = whole ? (box.min.z + box.max.z) / 2 : top - frame * (k > 0.5 ? 0.5 : 0.43), cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2
    const dist = (frame / 2) / Math.tan((cam.fov / 2) * Math.PI / 180) * 1.12
    flat.width = size * frames; flat.height = size
    g.clearRect(0, 0, flat.width, size)
    for (let f = 0; f < frames; f++) {
      const a = (22 + (f * 360) / frames) * Math.PI / 180
      cam.position.set(cx + Math.sin(a) * dist, Math.cos(a) * dist + cy, cz)
      cam.lookAt(cx, cy, cz)
      renderer.render(scene, cam)
      g.drawImage(canvas, f * size, 0, size, size)
    }
    scene.remove(view.root)
    // The treatment: luminance through a contrast curve onto ink to paper, a little grain, over the field.
    const img = g.getImageData(0, 0, flat.width, size), p = img.data, field = job.field === 'accent' ? ACCENT : INK
    let seed = 0; for (const ch of job.id) seed = (seed * 31 + ch.charCodeAt(0)) | 0
    for (let i = 0; i < p.length; i += 4) {
      const a0 = p[i + 3] / 255, al = Math.min(1, Math.max(0, (a0 - 0.3) / 0.4))   // translucent parts cut out cleanly
      let l = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) / 255
      l = Math.min(1, Math.max(0, (l - 0.3) * 1.45 + 0.5))
      l = l * l * (3 - 2 * l)   // smoothstep: deeper shadows, cleaner highlights
      const n = grain(i >> 2, seed) * 0.09
      for (let k = 0; k < 3; k++) {
        const subj = INK[k] + (PAPER[k] - INK[k]) * Math.min(1, Math.max(0, l + n))
        const bg = field[k] + n * 40
        p[i + k] = Math.round(subj * al + bg * (1 - al))
      }
      p[i + 3] = 255
    }
    g.putImageData(img, 0, 0)
    out[job.id] = flat.toDataURL('image/jpeg', 0.86)
  }
  renderer.dispose()
  return out
}
