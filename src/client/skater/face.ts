import * as THREE from 'three'
import { patch, pivot, rigid, spherePatch, surface, type Rig, type V3 } from './kit.ts'
import { clamp01, img, smooth, texture } from './tex.ts'

// Faces: 3D eyes (sclera, pupil, optional lids) and brows the expression moves, and a mouth
// decal whose texture is a drawn atlas of mouth shapes (the cell is picked with the texture's
// offset, so the grey, cute and real twins, which share the texture, all follow).

export const MOUTHS = ['neutral', 'smile', 'grin', 'ecstatic', 'scared', 'dizzy', 'focus', 'hurt'] as const
export type MouthShape = (typeof MOUTHS)[number]

export type Expression = {
  mouth: MouthShape
  lid: number          // upper lid, 0 open .. 1 shut
  browY: number        // -1 low .. +1 raised
  browTilt: number     // + inner ends down (cross), - inner ends up (worried)
  pupil: number        // pupil scale
  look: [number, number]   // pupil offset, -1..1 (x toward the character's left, y up)
  jaw: number          // jaw open 0..1 (characters with a jaw)
}

export type FaceSpec = {
  bone: string                     // the bone carrying the face
  eyes: { at: V3; r: number; squash?: V3; white?: number | string; iris: number | string; irisR?: number; pupilR?: number; glow?: boolean; spread?: number }
  lids?: { color: number | string; rest?: number } | null   // rest: how far the lids hang at the neutral expression (heavy-lidded), opening fully when wide-eyed
  brows?: { color: number | string; size: [number, number, number]; up: number; tilt?: number } | null
  mouth: { bone?: string; at: V3; size: [number, number]; bend?: number; sphere?: number; colors: { line: number | string; inside: number | string; teeth: number | string; tongue: number | string; lip?: number | string }; tilt?: number; neutral?: MouthShape }
  jaw?: { at: V3; mesh: THREE.Object3D; open: number } | null
}

const CELL_W = 128, CELL_H = 64, COLS = 4, ROWS = 2

type RGB = [number, number, number]
const toRgb = (c: number | string): RGB => { const k = new THREE.Color(c); return [k.r, k.g, k.b].map((v) => Math.pow(v, 1 / 2.2)) as RGB }

/** Draw the mouth atlas: each cell a shape from signed distances (x in -1..1, y in -0.5..0.5, y up). */
function mouthAtlas(cols: FaceSpec['mouth']['colors']): THREE.DataTexture {
  const W = CELL_W * COLS, H = CELL_H * ROWS
  const im = img(W, H, [0, 0, 0, 0])
  const line = toRgb(cols.line), inside = toRgb(cols.inside), teeth = toRgb(cols.teeth), tongue = toRgb(cols.tongue)
  const px = 2 / CELL_W
  const put = (x: number, y: number, c: RGB, a: number) => {
    if (a <= 0) return
    const i = (y * W + x) * 4
    const k = Math.min(1, a)
    for (let j = 0; j < 3; j++) im.d[i + j] = im.d[i + j] * (1 - k) + c[j] * k
    im.d[i + 3] = Math.max(im.d[i + 3], k)
  }
  // Stroke: distance to the curve y = f(x) for |x| < half, by sampling.
  // Only samples within 0.08 of x can come closer than that, and every stroke has faded out by
  // 0.06, so the window gives the same pixels as scanning the whole curve (about 10x fewer steps).
  const curveDist = (f: (x: number) => number, half: number, x: number, y: number) => {
    let d = 1e9
    const k0 = Math.max(0, Math.ceil((x - 0.08 + half) / 0.01 - 1e-9)), k1 = Math.floor((Math.min(half, x + 0.08) + half) / 0.01 + 1e-9)
    for (let k = k0; k <= k1; k++) { const s = -half + k * 0.01; if (s > half + 1e-9) break; d = Math.min(d, Math.hypot(x - s, y - f(s))) }
    return d
  }
  const shapes: ((x: number, y: number) => [RGB, number][])[] = [
    // neutral: a slight line
    (x, y) => [[line, smooth(0.055, 0.035, curveDist((s) => 0.06 * s * s - 0.02, 0.36, x, y))]],
    // smile
    (x, y) => [[line, smooth(0.06, 0.04, curveDist((s) => 0.55 * s * s - 0.12, 0.48, x, y))]],
    // grin: open smile with the top teeth
    (x, y) => {
      const top = 0.12 * x * x + 0.04, bot = 0.75 * x * x - 0.28
      const inMouth = Math.abs(x) < 0.56 && y < top && y > bot ? 1 : 0
      const out: [RGB, number][] = [[inside, inMouth], [teeth, inMouth * (y > top - 0.09 ? 1 : 0)]]
      out.push([line, smooth(0.05, 0.03, Math.min(curveDist((s) => 0.12 * s * s + 0.04, 0.58, x, y), curveDist((s) => 0.75 * s * s - 0.28, 0.58, x, y)))])
      return out
    },
    // ecstatic: a big open D, teeth on top, tongue below
    (x, y) => {
      const top = 0.1, bot = 1.0 * x * x - 0.42
      const inMouth = Math.abs(x) < 0.62 && y < top && y > bot ? 1 : 0
      const tng = Math.hypot((x) / 0.3, (y + 0.3) / 0.14) < 1 ? 1 : 0
      return [[inside, inMouth], [teeth, inMouth * (y > top - 0.09 ? 1 : 0)], [tongue, inMouth * tng],
        [line, smooth(0.05, 0.03, Math.min(curveDist(() => 0.1, 0.62, x, y), curveDist((s) => 1.0 * s * s - 0.42, 0.62, x, y)))]]
    },
    // scared: an O
    (x, y) => {
      const e = Math.hypot(x / 0.17, (y + 0.03) / 0.27)
      return [[inside, e < 1 ? 1 : 0], [line, smooth(0.16, 0.08, Math.abs(e - 1))]]
    },
    // dizzy: a wobbly line
    (x, y) => [[line, smooth(0.055, 0.035, curveDist((s) => 0.07 * Math.sin(s * 15) - 0.03, 0.42, x, y))]],
    // focus: tight line, tongue poking out of one corner
    (x, y) => {
      const tng = Math.hypot((x - 0.24) / 0.09, (y + 0.08) / 0.1) < 1 ? 1 : 0
      return [[tongue, tng], [line, smooth(0.05, 0.03, curveDist((s) => 0.18 * s - 0.03, 0.26, x, y))]]
    },
    // hurt: clenched teeth grimace
    (x, y) => {
      const box = Math.abs(x) < 0.42 && Math.abs(y + 0.02) < 0.12 - 0.25 * Math.max(0, Math.abs(x) - 0.3) ? 1 : 0
      const gap = Math.abs(y + 0.02) < 0.012 || (Math.abs(((x + 0.42) % 0.14) - 0.07) > 0.064) ? 1 : 0
      return [[teeth, box], [line, box * gap], [line, smooth(0.05, 0.03, Math.abs(Math.max(Math.abs(x) - 0.42, Math.abs(y + 0.02) - 0.12)))]]
    },
  ]
  shapes.forEach((shape, k) => {
    const cx = (k % COLS) * CELL_W, cy = Math.floor(k / COLS) * CELL_H
    for (let j = 0; j < CELL_H; j++) for (let i = 0; i < CELL_W; i++) {
      const x = (i + 0.5) * px - 1, y = 0.5 - (j + 0.5) / CELL_H
      for (const [c, a] of shape(x, y)) put(cx + i, cy + j, c, a)
    }
  })
  const t = texture(im, true, false)
  t.repeat.set(1 / COLS, 1 / ROWS)
  t.generateMipmaps = false
  t.minFilter = THREE.LinearFilter
  return t
}

const ATLASES = new Map<string, THREE.DataTexture>()

export class Face {
  private eyes: { root: THREE.Object3D; pupil: THREE.Object3D; lid: THREE.Object3D | null; side: number }[] = []
  private brows: { o: THREE.Object3D; side: number; y0: number }[] = []
  private atlas: THREE.DataTexture
  private spec: FaceSpec

  constructor(rig: Rig, spec: FaceSpec) {
    this.spec = spec
    const E = spec.eyes
    const white = surface('eye white', { color: E.white ?? 0xf6f4ef, roughness: 0.15, clearcoat: 1 })
    const iris = surface('iris', E.glow ? { color: E.iris, emissive: E.iris, emissiveIntensity: 2.2, roughness: 0.3 } : { color: E.iris, roughness: 0.2, clearcoat: 1 })
    const dark = surface('pupil', { color: 0x0b0b0d, roughness: 0.1, clearcoat: 1 })
    const lidMat = spec.lids ? surface('eyelid', { color: spec.lids.color, roughness: 0.6 }) : null
    for (const side of [1, -1]) {
      const at: V3 = [E.at[0] * side, E.at[1], E.at[2]]
      const root = pivot(rig, spec.bone, at, [0, side * (E.spread ?? 0), 0])
      const sq = E.squash ?? [1, 1, 1]
      const ball = new THREE.Mesh(new THREE.SphereGeometry(E.r, 20, 14), white)
      ball.scale.set(...sq)
      root.add(ball)
      const pupil = new THREE.Object3D()
      root.add(pupil)
      const ir = new THREE.Mesh(new THREE.SphereGeometry(E.irisR ?? E.r * 0.5, 16, 10), iris)
      ir.scale.set(1, 1, 0.3)
      ir.position.z = E.r * sq[2] * 0.93
      pupil.add(ir)
      if (!E.glow) {
        const pp = new THREE.Mesh(new THREE.SphereGeometry(E.pupilR ?? E.r * 0.24, 12, 8), dark)
        pp.scale.set(1, 1, 0.3)
        pp.position.z = E.r * sq[2] * 0.97
        pupil.add(pp)
      }
      let lid: THREE.Object3D | null = null
      if (lidMat) {
        lid = new THREE.Object3D()
        const cap = new THREE.Mesh(new THREE.SphereGeometry(E.r * 1.07, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), lidMat)
        cap.scale.set(...sq)
        lid.add(cap)
        root.add(lid)
      }
      for (const m of [ball, ...pupil.children, ...(lid ? lid.children : [])]) m.castShadow = false
      this.eyes.push({ root, pupil, lid, side })
    }
    if (spec.brows) {
      const B = spec.brows
      const browMat = surface('brow', { color: B.color, roughness: 0.8 })
      for (const side of [1, -1]) {
        const y0 = E.at[1] + B.up
        const o = pivot(rig, spec.bone, [E.at[0] * side, y0, E.at[2] + E.r * 0.7], [0, 0, 0])
        const g = new THREE.CapsuleGeometry(B.size[1] / 2, B.size[0], 3, 8)
        const m = new THREE.Mesh(g, browMat)
        m.rotation.z = Math.PI / 2
        m.scale.set(1, 1, B.size[2] / B.size[1])
        m.castShadow = false
        o.add(m)
        this.brows.push({ o, side, y0: o.position.y })
      }
    }
    const Mo = spec.mouth
    // The atlas pixels depend only on the colours: draw them once per palette, and give each face its
    // own Texture (its own offset picks the cell) over the same source, so the GPU holds one copy.
    const key = JSON.stringify(Mo.colors)
    let base = ATLASES.get(key)
    if (!base) { base = mouthAtlas(Mo.colors); ATLASES.set(key, base) }
    this.atlas = base.clone()
    const mouthMat = surface('mouth', { color: 0xffffff, map: this.atlas, alphaTest: 0.5, roughness: 0.5 })
    const geo = Mo.sphere ? spherePatch(Mo.size[0], Mo.size[1], Mo.sphere) : patch(Mo.size[0], Mo.size[1], Mo.bend ?? 0)
    const mesh = rigid(rig, Mo.bone ?? spec.bone, geo, mouthMat, Mo.at, [Mo.tilt ?? 0, 0, 0])
    mesh.castShadow = false
    this.set({ mouth: Mo.neutral ?? 'neutral', lid: 0.2, browY: 0, browTilt: 0, pupil: 1, look: [0, 0], jaw: 0 })
  }

  set(e: Expression) {
    const k = MOUTHS.indexOf(e.mouth)
    this.atlas.offset.set((k % COLS) / COLS, 1 - (Math.floor(k / COLS) + 1) / ROWS)
    const E = this.spec.eyes
    // A resting lid: the neutral expression's lid (0.18) hangs at rest, wide eyes (0) still open fully, a blink shuts.
    const L = clamp01(e.lid), rest = this.spec.lids?.rest
    const lid = rest === undefined ? L : L <= 0.18 ? (L / 0.18) * rest : rest + ((L - 0.18) / 0.82) * (1 - rest)
    for (const eye of this.eyes) {
      const lx = Math.max(-1, Math.min(1, e.look[0])), ly = Math.max(-1, Math.min(1, e.look[1]))
      eye.pupil.rotation.set(-ly * 0.45, lx * 0.5 * (E.squash?.[0] ?? 1), 0)
      eye.pupil.scale.setScalar(e.pupil)
      // Lid: rotated up and back when open, down over the front when shut.
      if (eye.lid) eye.lid.rotation.x = -Math.PI / 2 + lid * Math.PI
    }
    for (const b of this.brows) {
      const B = this.spec.brows!
      b.o.position.y = b.y0 + e.browY * B.size[1] * 1.6
      b.o.rotation.z = -b.side * e.browTilt * 0.45 + b.side * (B.tilt ?? 0)
    }
    const J = this.spec.jaw
    if (J) J.mesh.rotation.x = clamp01(e.jaw) * J.open
  }
}
