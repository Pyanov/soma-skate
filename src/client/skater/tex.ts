import * as THREE from 'three'

// Procedural textures for the skater, board and characters: drawn into typed arrays (no DOM,
// no canvas), so they are the same in Node tests, headless shots and play. Everything is
// seeded; nothing reads the clock or Math.random.

export type Img = { w: number; h: number; d: Float32Array }   // RGBA, 0..1, rows top-down

export const img = (w: number, h: number, rgba: [number, number, number, number] = [0, 0, 0, 1]): Img => {
  const d = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) d.set(rgba, i * 4)
  return { w, h, d }
}

/** Integer hash -> [0, 1). */
export function hash2(x: number, y: number, seed = 0): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/** Smooth value noise, tiling with period p (cells). */
export function vnoise(x: number, y: number, p: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y)
  const fx = x - xi, fy = y - yi
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy)
  const m = (a: number) => ((a % p) + p) % p
  const a = hash2(m(xi), m(yi), seed), b = hash2(m(xi + 1), m(yi), seed)
  const c = hash2(m(xi), m(yi + 1), seed), d = hash2(m(xi + 1), m(yi + 1), seed)
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/** Fractal noise in [0, 1), tiling over a w-pixel image when scale divides w. */
export function fbm(x: number, y: number, period: number, octaves: number, seed = 0): number {
  let s = 0, amp = 0.5, tot = 0, f = 1
  for (let o = 0; o < octaves; o++) {
    s += vnoise(x * f, y * f, period * f, seed + o * 17) * amp
    tot += amp; amp *= 0.5; f *= 2
  }
  return s / tot
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
export const mix = (a: number, b: number, t: number) => a + (b - a) * t

/** Height field -> tangent-space normal map (OpenGL convention: +v is up the image). */
export function normalFromHeight(h: Float32Array, w: number, hh: number, strength: number): Img {
  const out = img(w, hh)
  for (let y = 0; y < hh; y++) {
    for (let x = 0; x < w; x++) {
      const at = (xx: number, yy: number) => h[((yy + hh) % hh) * w + ((xx + w) % w)]
      const dx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * strength
      const dy = (at(x, y - 1) - at(x, y + 1)) * 0.5 * strength   // rows run down, v runs up
      const l = Math.hypot(dx, dy, 1)
      out.d.set([(-dx / l) * 0.5 + 0.5, (-dy / l) * 0.5 + 0.5, (1 / l) * 0.5 + 0.5, 1], (y * w + x) * 4)
    }
  }
  return out
}

/** Roughness (and metalness) in a glTF-style metallicRoughness map: G rough, B metal. */
export function roughMap(r: Float32Array, w: number, h: number, metal = 0): Img {
  const out = img(w, h)
  for (let i = 0; i < w * h; i++) out.d.set([1, r[i], metal, 1], i * 4)
  return out
}

/** Upload an image as a texture: sRGB colour or linear data, repeating, mipmapped. */
export function texture(im: Img, color: boolean, repeat = true): THREE.DataTexture {
  const n = im.w * im.h * 4
  const u8 = new Uint8Array(n)
  // Rows are drawn top-down; textures read bottom-up (flipY is off for data textures).
  for (let y = 0; y < im.h; y++) {
    const src = (im.h - 1 - y) * im.w * 4, dst = y * im.w * 4
    for (let i = 0; i < im.w * 4; i++) u8[dst + i] = Math.round(clamp01(im.d[src + i]) * 255)
  }
  const t = new THREE.DataTexture(u8, im.w, im.h, THREE.RGBAFormat)
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace
  t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping
  t.magFilter = THREE.LinearFilter
  t.minFilter = THREE.LinearMipmapLinearFilter
  t.generateMipmaps = true
  t.anisotropy = 4
  t.needsUpdate = true
  return t
}

/** sRGB hex -> [r, g, b] in 0..1 (sRGB, as drawn into colour images). */
export const rgb = (hex: number | string): [number, number, number] => {
  const c = typeof hex === 'string' ? parseInt(hex.replace('#', ''), 16) : hex
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255]
}

/** A 5x7 block font for the few labels we print (upper case and a few marks). */
const FONT: Record<string, string> = {
  '&': '01100100101010001000101011001001101',
  A: '01110100011000111111100011000110001', B: '11110100011000111110100011000111110', C: '01110100011000010000100001000101110',
  D: '11110100011000110001100011000111110', E: '11111100001000011110100001000011111', I: '01110001000010000100001000010001110',
  L: '10000100001000010000100001000011111', M: '10001110111010110101100011000110001', O: '01110100011000110001100011000101110',
  P: '11110100011000111110100001000010000', S: '01111100001000001110000010000111110', T: '11111001000010000100001000010000100',
  R: '11110100011000111110101001001010001', N: '10001110011010110011100011000110001', K: '10001100101010011000101001001010001',
  '.': '00000000000000000000000000110001100', ' ': '00000000000000000000000000000000000', '-': '00000000000000011111000000000000000',
  G: '01110100011000010111100011000101111', U: '10001100011000110001100011000101110', V: '10001100011000110001100010101000100',
  Y: '10001100010101000100001000010000100', H: '10001100011000111111100011000110001', F: '11111100001000011110100001000010000',
  W: '10001100011000110101101011010101010', X: '10001100010101000100010101000110001', Z: '11111000010001000100010001000011111',
  '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110', '2': '01110100010000100010001000100011111',
  '!': '00100001000010000100001000000000100',
}

/** Coverage (0..1) of text at (u, v): u in characters from the left, v 0..1 top to bottom. */
export function textCoverage(text: string, u: number, v: number, soft = 0.08): number {
  if (u < 0 || u >= text.length || v < 0 || v >= 1) return 0
  const k = Math.floor(u), ch = FONT[text[k]] ?? FONT[' ']
  const cx = (u - k) * 6 - 0.5, cy = v * 7          // 5 columns + 1 gap
  let best = 0
  for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) {
    if (ch[r * 5 + c] !== '1') continue
    const dx = Math.max(Math.abs(cx - c - 0.5) - 0.5, 0), dy = Math.max(Math.abs(cy - r - 0.5) - 0.5, 0)
    best = Math.max(best, smooth(soft * 6, 0, Math.hypot(dx, dy)))
  }
  return best
}
