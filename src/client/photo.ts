import * as THREE from 'three'
import type { GameData } from '../sim/data.ts'
import { makeThing } from '../sim/thing.ts'
import type { Thing } from '../sim/thing.ts'
import { applyMaterials } from './look.ts'
import type { Renderer } from './render.ts'
import { buildCharacter, type CharacterSpec } from './skater/characters.ts'
import type { NpcReact } from './skater/react.ts'
import type { SkaterView } from './skater/view.ts'

// The loading and menu photographs (docs/art-direction.md, house treatment): the engine's own scene,
// staged by tools/photos.ts from data/photos.json (a skater from a scenario, more of the cast placed
// about), lit by a flash at the camera, then developed in 2D: a fisheye from the wide render, black
// and white through a contrast curve onto ink to paper, dark corners, film grain. No image model and
// no real people anywhere in the path. Draw-only, dev and headless only (the __skate api's photo()).

/** One more figure in the picture: a character standing, on its board or sat down, where the tool placed it. */
export type PhotoFigure = {
  model: string; outfit?: string | null
  /** walk: on foot (board carried), ground: stood on the board. */
  state: 'walk' | 'ground'
  pos: [number, number, number]; fwd: [number, number]
  /** stateTicks (how long it has stood: the idle fidgets come with time), the view's tick (which fidget). */
  ticks?: number; tick?: number
  /** Ticks since an emote began (its own celebration), or none. */
  emote?: number
  react?: NpcReact | null
  /** A pose of its own (poses.json keyframe fields over base): sat on a curb, leant on a wall. */
  pose?: Record<string, unknown> | null
  /** board: only the board is shown (the deck on the ground); hideBoard: the figure without it. */
  only?: 'board'; hideBoard?: boolean
}

export type Develop = {
  width: number; height: number
  /** The lens: horizontal field of view in degrees of the equidistant fisheye; inFov: the (rectilinear) render's, a little wider. */
  fov: number; inFov: number
  /** Image circle radius (1 = the half width) and its soft edge; corners past it go to ink. */
  circle: number; circleSoft: number
  /** Light falloff toward the edge (r^2), the share of the picture lost at the circle. */
  vignette: number
  /** Linear gain before the levels, then the levels from the picture's own histogram (low and high percentiles), a gamma and an S-curve. */
  exposure: number; lo: number; hi: number; gamma: number; contrast: number
  /** Film grain: amount (0..1 of full range at mid grey) and the seed. */
  grain: number; seed: number
  /** Highlights bleeding a little (halation), 0 = none. */
  glow: number
}

export type PhotoJob = {
  figures: PhotoFigure[]
  /** The flash: a point light (three's units) held up and to the side of the lens (the tool puts it at flashAt); ambient scales the sun, sky and environment. */
  flash: { intensity: number; up: number; side: number; ambient: number }
  develop: Develop
  flashAt: [number, number, number]
}

const INK = [11, 11, 12], PAPER = [242, 239, 232]

let rawPoses: Record<string, unknown> | null = null

/** A small seeded hash: the same grain on every run. */
const hash = (i: number, seed: number) => { let h = (i * 374761393 + seed * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296 }

/** Stage the job's figures and flash in the scene the last render set up, render it again, develop it. */
export async function shootPhoto(r: Renderer, data: GameData, job: PhotoJob): Promise<string> {
  rawPoses ??= await fetch('data/poses.json', { cache: 'no-store' }).then((x) => x.json()) as Record<string, unknown>
  const player = r.skater
  const specs = [...player.data.characters, ...(player.data.people ?? [])] as CharacterSpec[]
  const added: THREE.Object3D[] = []
  for (const f of job.figures) {
    const spec = specs.find((x) => x.id === f.model)
    if (!spec) throw new Error(`photo: no character ${f.model}`)
    const view: SkaterView = player.twin(buildCharacter(spec, f.outfit ?? null), true)
    if (f.pose) {
      const raw = rawPoses as { poses: Record<string, Record<string, unknown>> }
      view.setPoses({ ...raw, poses: { ...raw.poses, base: { ...raw.poses.base, ...f.pose } } } as never)
    }
    applyMaterials(view.root, r.style as 'real' | 'cute' | 'grey')
    view.ground = player.ground
    const t: Thing = makeThing(-1, 'npc')
    t.state = f.state as Thing['state']
    t.pos = { x: f.pos[0], y: f.pos[1], z: f.pos[2] }
    const fl = Math.hypot(f.fwd[0], f.fwd[1]) || 1
    t.fwd = { x: f.fwd[0] / fl, y: f.fwd[1] / fl, z: 0 }
    t.up = { x: 0, y: 0, z: 1 }
    t.vel = { x: 0, y: 0, z: 0 }
    t.stateTicks = f.ticks ?? 0
    view.tick = f.tick ?? 0
    view.emoteTick = f.emote !== undefined ? view.tick - f.emote : -1
    view.react = f.react ?? null
    view.update(t, data, 1)
    if (f.only === 'board' || f.hideBoard) {
      const board = view.board
      view.root.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return
        let inBoard = false
        for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === board) { inBoard = true; break }
        if (f.only === 'board' ? !inBoard : inBoard) o.visible = false
      })
    }
    view.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true } })
    r.scene.add(view.root)
    added.push(view.root)
  }
  // The flash, and the ambient light turned down so it reads (restored after).
  const flash = new THREE.PointLight(0xffffff, job.flash.intensity, 0, 2)
  flash.position.set(job.flashAt[0], job.flashAt[1], job.flashAt[2])
  r.scene.add(flash)
  const dimmed: [THREE.Light, number][] = []
  r.scene.traverse((o) => { const l = o as THREE.Light; if ((l as THREE.DirectionalLight).isDirectionalLight || (l as THREE.HemisphereLight).isHemisphereLight || (l as THREE.AmbientLight).isAmbientLight) { dimmed.push([l, l.intensity]); l.intensity *= job.flash.ambient } })
  const env = r.scene.environmentIntensity
  r.scene.environmentIntensity = env * job.flash.ambient
  try {
    r.render()
    return develop(r.renderer.domElement, job.develop)
  } finally {
    r.scene.remove(flash); flash.dispose()
    for (const [l, i] of dimmed) l.intensity = i
    r.scene.environmentIntensity = env
    for (const o of added) r.scene.remove(o)
  }
}

/**
 * The darkroom: the render (rectilinear, the lens's full width of view across it) bent into an equidistant
 * fisheye, black and white, levels from its own histogram, a gamma and an S-curve, the lens's falloff and
 * image circle, a little halation, clumped grain, onto ink to paper. Pure: the same render gives the same JPEG.
 */
export function develop(src: HTMLCanvasElement, o: Develop): string {
  const sw = src.width, sh = src.height, W = o.width, H = o.height
  const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh
  const sg = sc.getContext('2d', { willReadFrequently: true })!
  sg.drawImage(src, 0, 0)
  const sp = sg.getImageData(0, 0, sw, sh).data
  // Luminance (a panchromatic film: a touch more red than the eye), and a half-size copy for where the lens squeezes the render.
  const L = new Float32Array(sw * sh)
  for (let i = 0, j = 0; i < L.length; i++, j += 4) L[i] = (0.36 * sp[j] + 0.52 * sp[j + 1] + 0.12 * sp[j + 2]) / 255
  const hw = sw >> 1, hh = sh >> 1, L2 = new Float32Array(hw * hh)
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) { const i = 2 * y * sw + 2 * x; L2[y * hw + x] = (L[i] + L[i + 1] + L[i + sw] + L[i + sw + 1]) / 4 }
  const sample = (buf: Float32Array, bw: number, bh: number, x: number, y: number) => {
    x = Math.min(bw - 1.001, Math.max(0, x)); y = Math.min(bh - 1.001, Math.max(0, y))
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * bw + x0
    return (buf[i] * (1 - fx) + buf[i + 1] * fx) * (1 - fy) + (buf[i + bw] * (1 - fx) + buf[i + bw + 1] * fx) * fy
  }
  const th = (o.fov / 2) * Math.PI / 180, tIn = Math.tan(((o.inFov || o.fov) / 2) * Math.PI / 180)
  const out = new Float32Array(W * H), rad = new Float32Array(W * H)
  const half = W / 2, sHalf = sw / 2
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const nx = (x + 0.5 - half) / half, ny = (y + 0.5 - H / 2) / half, r = Math.hypot(nx, ny), i = y * W + x
    rad[i] = r
    const a = r * th
    if (a >= Math.PI / 2 * 0.985) { out[i] = 0; continue }
    const s = r > 1e-6 ? Math.tan(a) / tIn / r : th / tIn
    const ix = sHalf + nx * s * sHalf - 0.5, iy = sh / 2 + ny * s * sHalf - 0.5
    if (ix < -1 || iy < -1 || ix > sw || iy > sh) { out[i] = 0; continue }
    // Where the render is squeezed more than about 1.7 to 1, read the half-size copy (no shimmer at the edges).
    const k = (th / tIn) / (Math.cos(a) ** 2) * (sw / W)
    out[i] = k > 1.7 ? sample(L2, hw, hh, ix / 2, iy / 2) : sample(L, sw, sh, ix, iy)
  }
  // Levels from the picture's own histogram, inside the image circle.
  const hist = new Uint32Array(1024)
  let n = 0
  for (let i = 0; i < out.length; i++) if (rad[i] < o.circle - o.circleSoft) { hist[Math.min(1023, Math.max(0, (out[i] * o.exposure * 1023) | 0))]++; n++ }
  const pct = (p: number) => { let c = 0; for (let b = 0; b < 1024; b++) { c += hist[b]; if (c >= p * n) return b / 1023 } return 1 }
  const lo = pct(o.lo), hi = Math.max(lo + 0.05, pct(o.hi))
  for (let i = 0; i < out.length; i++) {
    let v = (out[i] * o.exposure - lo) / (hi - lo)
    v = Math.min(1, Math.max(0, v))
    v = Math.pow(v, o.gamma)
    const sv = v * v * (3 - 2 * v)
    v = v + (sv - v) * o.contrast
    out[i] = v
  }
  // Halation: the brightest parts bleed a little (a blurred copy of what is over 0.75, added back).
  if (o.glow > 0) {
    const g = new Float32Array(W * H), t = new Float32Array(W * H), R = Math.round(W / 160)
    for (let i = 0; i < out.length; i++) g[i] = Math.max(0, out[i] - 0.75)
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < H; y++) { let acc = 0; for (let x = -R; x < W + R; x++) { if (x + R < W) acc += g[y * W + Math.min(W - 1, x + R)]; if (x - R - 1 >= 0) acc -= g[y * W + x - R - 1]; if (x >= 0 && x < W) t[y * W + x] = acc / (2 * R + 1) } }
      for (let x = 0; x < W; x++) { let acc = 0; for (let y = -R; y < H + R; y++) { if (y + R < H) acc += t[Math.min(H - 1, y + R) * W + x]; if (y - R - 1 >= 0) acc -= t[(y - R - 1) * W + x]; if (y >= 0 && y < H) g[y * W + x] = acc / (2 * R + 1) } }
    }
    for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] + g[i] * o.glow)
  }
  // Grain: seeded noise, clumped by a small blur, strongest in the mid greys; then the lens's falloff and circle.
  const nz = new Float32Array(W * H), nb = new Float32Array(W * H)
  for (let i = 0; i < nz.length; i++) nz[i] = hash(i, o.seed) - 0.5
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x
    nb[i] = (4 * nz[i] + 2 * (nz[i - 1] + nz[i + 1] + nz[i - W] + nz[i + W]) + nz[i - W - 1] + nz[i - W + 1] + nz[i + W - 1] + nz[i + W + 1]) / 16 * 2.6
  }
  const img = new ImageData(W, H), p = img.data
  for (let i = 0; i < out.length; i++) {
    let v = out[i]
    v += nb[i] * o.grain * (0.35 + 0.65 * (1 - Math.abs(2 * v - 1)))
    const r = rad[i]
    v *= 1 - o.vignette * Math.min(1, (r / o.circle) ** 2)
    v *= 1 - smooth(o.circle - o.circleSoft, o.circle, r)
    v = Math.min(1, Math.max(0, v))
    const j = i * 4
    for (let k = 0; k < 3; k++) p[j + k] = Math.round(INK[k] + (PAPER[k] - INK[k]) * v)
    p[j + 3] = 255
  }
  const oc = document.createElement('canvas'); oc.width = W; oc.height = H
  oc.getContext('2d')!.putImageData(img, 0, 0)
  return oc.toDataURL('image/jpeg', 0.86)
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
