import * as THREE from 'three'
import { freeGeometryAfterUpload, freeTextureAfterUpload, release } from './memory.ts'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import type { ElementInfo, ParkSource } from '../sim/park/source.ts'
import type { Look } from '../data/schema.ts'
import { lampUniforms, lampGlsl, LAMP_GLSL_DECL } from './real.ts'
import { Skyline, type SkylineData } from './skyline.ts'
import { CityDetail, type MuralPiece, type CastroData, type FlagData, type ShopSign } from './citydetail.ts'
import { fetchBin } from './fetchbin.ts'
import { ParkedCars } from './carmodels.ts'

// The city around the park (world "sf"): streets, sidewalks, curbs, lots, parks,
// buildings with San Francisco facades, street trees. Draw-only, like the rest of the
// client. Geometry comes from the world source (assets/park/sf.city.bin, made by
// the world generator's city/build.py); a per-vertex look record (sf.city.look.bin: u, v in
// cm, kind, style, palette, flags) drives the procedural facades. Three styles like the
// park: real (PBR, CC0 Poly Haven textures in assets/real/city, procedural windows,
// storefronts, siding, bays), cute (toon pastels) and grey (flat by kind).

export type CityLook = {
  vertexCount: number
  u: Float32Array; v: Float32Array; info: Uint8Array   // per city vertex
  kinds: string[]; styles: string[]
  trees: number[][]                                    // x, y, z, height, crown, kind (0 broadleaf, 1 palm, 2 plane, 3 box-like, 4 ficus, 5 plum), trunk diameter
  cars: number[][]                                     // x, y, z, heading (deg), colour index, length
  lowriders?: number[][]                               // 24th St's lowriders (city.lowriders): rows like cars'
  horizon?: { bbox: number[][]; edge: number[][]; core?: number[][] }      // the city's extent and its edge heights (x, y, z), for the ring beyond it; core: where the plain context fills it all
  skyline?: SkylineData                                // far hills and Sutro Tower (draw-only)
  murals?: MuralPiece[]; castro?: CastroData | null; flag?: FlagData | null; papel?: number[][]; lanterns?: number[][]; shopsigns?: ShopSign[]   // src/client/citydetail.ts
  sealions?: unknown                                   // the K-dock's sea lions (src/client/sealions.ts parses them)
}

type CityManifest = { vertexCount: number; look?: { binary: string; stride: number; kinds: string[] }; city?: { trees?: number[][]; cars?: number[][]; kinds: string[]; styles: string[]; horizon?: { bbox: number[][]; edge: number[][]; core?: number[][] }; skyline?: SkylineData; murals?: MuralPiece[]; castro?: CastroData | null; flag?: FlagData | null; papel?: number[][]; lanterns?: number[][]; sealions?: unknown; shopsigns?: ShopSign[]; lowriders?: number[][] } }

export async function loadCityLook(base: string, m: CityManifest, _triStart: number, rows: { trees: number[][]; cars: number[][] } | null = null): Promise<CityLook | null> {
  if (!m.look) return null
  let buf: ArrayBuffer
  try { buf = await fetchBin(`${base}/${m.look.binary}`) } catch { return null }
  const n = m.vertexCount
  if (buf.byteLength !== n * 8) throw new Error('city look binary does not match the city vertices')
  // 8 bytes per vertex: u, v (uint16 cm, little endian like the export and every machine we run on), kind, style, palette, flags.
  const w = new Uint16Array(buf), b = new Uint8Array(buf)
  const u = new Float32Array(n), v = new Float32Array(n), info = new Uint8Array(n * 4)
  for (let i = 0; i < n; i++) {
    u[i] = w[i * 4] / 100
    v[i] = w[i * 4 + 1] / 100
    info[i * 4] = b[i * 8 + 4]; info[i * 4 + 1] = b[i * 8 + 5]; info[i * 4 + 2] = b[i * 8 + 6]; info[i * 4 + 3] = b[i * 8 + 7]
  }
  release(b)   // the binary is decoded: its memory goes now, not at the next garbage collection
  return { vertexCount: n, u, v, info, kinds: m.look.kinds, styles: m.city?.styles ?? [], trees: rows?.trees ?? m.city?.trees ?? [], cars: rows?.cars ?? m.city?.cars ?? [], horizon: m.city?.horizon, skyline: m.city?.skyline, murals: m.city?.murals, castro: m.city?.castro, flag: m.city?.flag, papel: m.city?.papel, lanterns: m.city?.lanterns, sealions: m.city?.sealions, shopsigns: m.city?.shopsigns, lowriders: m.city?.lowriders }
}

export const isCity = (e: ElementInfo) => e.collection.startsWith('city_') || e.id === 'city_boundary_wall'

// city_context and city_massing: the plain DEM ground and footprint massing around the corridors (draw-only).
// city_spot: the skate spots' stairs, wells, ledges and planters (concrete, like curbs); their rails and benches are built.
// city_squeeze_*: a squeezed city's retaining walls, their stairs and caps (ground) and railings (built).
const GROUND = new Set(['city_road', 'city_sidewalk', 'city_median', 'city_lot', 'city_park', 'city_curb', 'city_path', 'city_context', 'city_spot', 'city_stoop', 'city_alley', 'city_green', 'city_squeeze_stairs'])
const BUILT = new Set(['city_water', 'city_building', 'city_roof', 'city_detail', 'city_prop', 'city_pole', 'city_furniture', 'city_freeway', 'city_column', 'city_shelter_top', 'city_massing', 'city_spot_rail', 'city_spot_furniture', 'city_stoop_wall', 'city_play', 'city_roof_high', 'city_squeeze_wall', 'city_squeeze_railing'])
const MARK = new Set(['city_marking'])

// Facade palettes per style (sRGB hex), 8 each: Victorian pastels, Edwardian muted,
// stucco apartments, modern panels, industrial brick and concrete, sheds, landmark.
const PALETTES: string[][] = [
  ['#e8c4a0', '#b9d3c2', '#f2e2b6', '#c7d0e0', '#e9b7b2', '#d9c3e0', '#f4efe4', '#9fb8ad'],
  ['#d9d4c7', '#c8c1b0', '#b8c3c8', '#e2dccd', '#a9b3a2', '#d6c6ad', '#9aa7b0', '#efe8da'],
  ['#e9e4da', '#dcd3c4', '#cfd2cc', '#e8dcc6', '#d7cfc9', '#f1ece2', '#c9c2b4', '#e3d9cc'],
  ['#bfc4c8', '#d8d8d4', '#8e979e', '#e6e3dc', '#6f7a80', '#c9c6be', '#a3a8a6', '#dadcd9'],
  ['#8e4a3a', '#7a5546', '#9b5a45', '#a8a49c', '#8b8f8f', '#a5634c', '#6f6a64', '#b9b2a6'],
  ['#d9d2c5', '#c4b9a8', '#b3b9b5', '#cdbfa8', '#a9a39a', '#d8cfc0', '#bcb3a3', '#c7c9c1'],
  ['#f2ece0', '#efe6d4', '#f4efe6', '#ece2cf', '#f2ece0', '#efe6d4', '#f4efe6', '#ece2cf'],
]
// The bike lanes' thermoplastic green and the transit red are the real paints' dull, greyed tones (they sit in the film grade, not on it).
const PAINT = ['#dcdad2', '#d6a419', '#7d7f82', '#4a4640', '#4f7656', '#7c3a31', '#d8382f', '#ec8a2a', '#f0cf3a', '#3a9a4a', '#2f62b5', '#76399b', '#3e6e78', '#b0573c', '#d6c497']
// The Painted Ladies (710-722 Steiner St), one row per house: body, trim, accent (sRGB).
const LADIES = [
  ['#b9d7e8', '#fbf8f1', '#2d4a7a'], ['#f1dfa6', '#fbf8f1', '#7d3b2a'], ['#c9dcc0', '#f5f0e1', '#8a2f45'], ['#e9c7c0', '#fbf8f1', '#3e5a3a'],
  ['#d9cde6', '#f7f3ea', '#b08326'], ['#bfe0d8', '#fbf8f1', '#b4543f'], ['#f3e6cf', '#6f7d5a', '#7a2735'],
]
const TRIMS = ['#fbf8f1', '#f3eee3', '#2f3a3f', '#5b2e2a', '#f7f3ea', '#3d4a3a', '#efe9dc', '#7a5c3e']
const AWNINGS = ['#9e2a2b', '#1f4e3d', '#1e2f4f', '#222222', '#6b2c3e', '#c58b2a', '#2b5f75', '#5a4632']
// Shop signs: fictional names with local humour, in data/signs.json (no real businesses, brands or logos).
const SIGN_COLS = 4, SIGN_W = 512, SIGN_H = 96
async function loadSignNames(): Promise<string[]> {
  try {
    const d = await (await fetch('data/signs.json', { cache: 'no-store' })).json() as { names?: string[] }
    if (d.names?.length) return d.names
  } catch { /* fall back below */ }
  return ['Cafe', 'Taqueria', 'Books', 'Bikes', 'Laundry', 'Pizza', 'Records', 'Bakery']
}

// Cute colours by kind (pastel) and grey colours by kind.
const CUTE_KIND: Record<string, string> = { water: '#7cc4e0', road: '#a9adbd', sidewalk: '#ece6da', median: '#a8dc8c', lot: '#e3dccd', park: '#9fdc86', curb: '#f4efe6', roof: '#c9c3d6', cornice: '#fbf8f1', awning: '#f29ab2', path: '#f3ead8', shelter: '#7d8fd8', tram: '#8fd6b4', freeway: '#d6d1ea', prop: '#6c7086' }
const GREY_KIND: Record<string, number> = { water: 0xa9adb0, road: 0xb6b8bb, sidewalk: 0xcfccc5, median: 0xb9c4b0, lot: 0xc8c4bc, park: 0xb9c4b0, curb: 0xd9d6cf, wall: 0xa9a8a4, roof: 0x9a9894, bay: 0xb1afaa, cornice: 0xc4c2bc, awning: 0x9a9894, path: 0xcfccc5, shelter: 0x8c8f94, tram: 0xa6aaa9 }

const TEX_LAYERS = ['asphalt_02', 'concrete_floor_worn_001', 'white_planks_clean', 'white_stucco', 'red_brick_03', 'leafy_grass', 'tarred_gravel'] as const

type Tex = { diff: THREE.DataArrayTexture; nor: THREE.DataArrayTexture; avg: number[] }

async function pixels(url: string, size: number): Promise<Uint8ClampedArray> {
  const img = await createImageBitmap(await (await fetch(url)).blob())
  const c = new OffscreenCanvas(size, size)
  const g = c.getContext('2d')!
  g.drawImage(img, 0, 0, size, size)
  return g.getImageData(0, 0, size, size).data
}

async function loadTextures(): Promise<Tex> {
  const S = 512
  const dir = (n: string) => (n === 'asphalt_02' || n === 'concrete_floor_worn_001' ? 'assets/real' : 'assets/real/city')
  const sets = await Promise.all(TEX_LAYERS.map((n) => Promise.all(['diffuse', 'nor_gl'].map((m) => pixels(`${dir(n)}/${n}_${m}.jpg`, S)))))
  const arr = (i: number, srgb: boolean) => {
    const data = new Uint8Array(S * S * 4 * TEX_LAYERS.length)
    sets.forEach((s, l) => data.set(s[i], l * S * S * 4))
    const t = new THREE.DataArrayTexture(data, S, S, TEX_LAYERS.length)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter
    t.generateMipmaps = true; t.anisotropy = 8
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace
    t.needsUpdate = true
    freeTextureAfterUpload(t)
    return t
  }
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }
  const avg = sets.map(([d]) => { let s = 0, n = 0; for (let i = 0; i < d.length; i += 64) { s += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]); n++ } return s / n })
  return { diff: arr(0, true), nor: arr(1, false), avg }
}

/** The sign atlas: one board per name, SIGN_COLS across, in Inter (the game's UI face). */
async function signAtlas(names: string[]): Promise<THREE.CanvasTexture> {
  try { await Promise.all([document.fonts.load('500 48px Inter'), document.fonts.load('400 48px Inter')]) } catch { /* system fallback */ }
  const rows = Math.ceil(names.length / SIGN_COLS)
  const c = document.createElement('canvas')
  c.width = SIGN_COLS * SIGN_W; c.height = rows * SIGN_H
  const g = c.getContext('2d')!
  // Board and letter colours that read at a distance: dark boards with light letters, or the reverse.
  const pairs = [['#14171a', '#f4efe2'], ['#f4efe2', '#14171a'], ['#6e1c1c', '#f7e7ce'], ['#1c3554', '#f4efe2'], ['#f2c94c', '#1a1a1a'], ['#24543a', '#f4efe2'],
    ['#ece4d4', '#7a1f1f'], ['#33244a', '#f2c94c'], ['#0f4c5c', '#f7e7ce'], ['#c75b39', '#fff6e8'], ['#f7e7ce', '#24543a'], ['#262a33', '#ff9a3c']]
  names.forEach((w, i) => {
    const x = (i % SIGN_COLS) * SIGN_W, y = Math.floor(i / SIGN_COLS) * SIGN_H
    const [bg, fg] = pairs[(i * 5) % pairs.length]
    g.fillStyle = '#0b0b0b'; g.fillRect(x, y, SIGN_W, SIGN_H)                 // the board's edge
    g.fillStyle = bg; g.fillRect(x + 5, y + 5, SIGN_W - 10, SIGN_H - 10)
    if (i % 3 === 1) { g.strokeStyle = fg; g.lineWidth = 3; g.strokeRect(x + 14, y + 13, SIGN_W - 28, SIGN_H - 26) }
    g.fillStyle = fg
    const upper = i % 4 !== 3
    const text = upper ? w.toUpperCase() : w
    let size = 54
    g.font = `500 ${size}px Inter, Helvetica, Arial, sans-serif`
    while (size > 18 && g.measureText(text).width > SIGN_W - 44) { size -= 2; g.font = `500 ${size}px Inter, Helvetica, Arial, sans-serif` }
    g.textAlign = 'center'; g.textBaseline = 'middle'
    g.fillText(text, x + SIGN_W / 2, y + SIGN_H / 2 + 2)
  })
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** The export's prop style for its sea lions (city.ts draws prop styles in the shader; sealions.ts draws these). */
const SEA_LION_STYLE = 9
const KIND_IDS = (kinds: string[]) => Object.fromEntries(kinds.map((k, i) => [k, i])) as Record<string, number>

const GLSL_NOISE = `
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y); }
float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }
`

export class CityView {
  readonly park = new THREE.Group()       // rideable ground (park layer)
  readonly context = new THREE.Group()    // buildings, trees (context layer)
  private groundMeshes: THREE.Mesh[] = []
  private builtMeshes: THREE.Mesh[] = []
  private markMeshes: THREE.Mesh[] = []
  private treeMeshes: THREE.InstancedMesh[] = []
  private carMeshes: THREE.InstancedMesh[] = []
  private parked: ParkedCars | null = null   // near the camera the parked cars are the traffic's car models (carmodels.ts)
  private skyline: Skyline | null = null
  private detail: CityDetail | null = null
  private realOk = false
  private style: 'real' | 'cute' | 'grey' | null = null
  /** The quality preset: do buildings, trees and cars cast shadows (real look)? */
  private shadows = true
  private culledAt = { eye: new THREE.Vector3(1e9, 0, 0), dir: new THREE.Vector3(), far: NaN }
  setShadows(on: boolean) { if (on === this.shadows) return; this.shadows = on; if (this.style) this.setStyle(this.style) }
  private horizon: { boxes: THREE.InstancedMesh; skirt: THREE.Mesh; mats: Record<'real' | 'cute' | 'grey', [THREE.Material, THREE.Material]> } | null = null
  private mats: Record<'real' | 'cute' | 'grey', { ground: THREE.Material; built: THREE.Material; mark: THREE.Material; car: THREE.Material; crown: THREE.Material; trunk: THREE.Material; palm: THREE.Material }> | null = null
  private tex: Tex | null = null
  private signs: THREE.CanvasTexture | null = null
  private signNames: string[] = ['Cafe']
  private kid: Record<string, number>
  private gradient: THREE.Texture | null = null
  private src: ParkSource
  private look: CityLook

  private constructor(src: ParkSource, look: CityLook, _styleLook: Look) {
    this.src = src; this.look = look
    this.kid = KIND_IDS(look.kinds)
  }

  static async create(src: ParkSource, look: CityLook, styleLook: Look, gradient: THREE.Texture): Promise<CityView> {
    const v = new CityView(src, look, styleLook)
    v.gradient = gradient
    v.tex = await loadTextures()
    performance.mark('city:tex')
    v.signNames = await loadSignNames()
    v.signs = await signAtlas(v.signNames)
    performance.mark('city:signs')
    v.build()
    performance.mark('city:build')
    // The per-vertex look (u, v, info) went into the meshes' attributes: the source arrays are done with.
    if (import.meta.env.PROD) { look.u = release(look.u); look.v = release(look.v); look.info = release(look.info) }
    v.mats = { real: v.realMaterials(), cute: v.cuteMaterials(gradient), grey: v.greyMaterials() }
    v.realOk = true
    performance.mark('city:mats')
    return v
  }

  /** Same build, synchronous (no textures): cute and grey only, real falls back to cute. */
  static plain(src: ParkSource, look: CityLook, styleLook: Look, gradient: THREE.Texture): CityView {
    const v = new CityView(src, look, styleLook)
    v.gradient = gradient
    v.build()
    const cute = v.cuteMaterials(gradient)
    v.mats = { real: cute, cute, grey: v.greyMaterials() }
    return v
  }

  private build() {
    const src = this.src, L = this.look
    const base = src.positions.length / 3 - L.vertexCount   // city vertices follow the park's
    const tiles = new Map<string, { ground: number[]; built: number[]; mark: number[] }>()
    src.elements.forEach((e, ei) => {
      if (!isCity(e)) return
      const cls = GROUND.has(e.collection) ? 'ground' : BUILT.has(e.collection) ? 'built' : MARK.has(e.collection) ? 'mark' : null
      if (!cls) return
      const key = e.id.split('_').slice(-2).join('_')
      let t = tiles.get(key)
      if (!t) { t = { ground: [], built: [], mark: [] }; tiles.set(key, t) }
      t[cls].push(ei)
    })
    // One mesh per tile and class, filled straight into typed arrays (the city has about two
    // million vertices: plain arrays and per-vertex objects cost a noticeable part of the load).
    const remap = new Int32Array(L.vertexCount).fill(-1)
    const P = src.positions, IX = src.indices
    // The export's sea lions on the K-dock (prop style 9) are drawn by src/client/sealions.ts, alive: not here.
    const propKind = this.kid.prop ?? -1
    const pal = PAINT.map((h) => new THREE.Color(h))
    for (const [, t] of tiles) {
      for (const cls of ['ground', 'built', 'mark'] as const) {
        if (!t[cls].length) continue
        let tris = 0
        for (const ei of t[cls]) tris += src.elements[ei].tris[1]
        const cap = tris * 3
        const pos = new Float32Array(cap * 3), uv = new Float32Array(cap * 2), info = new Uint8Array(cap * 4), idx = new Uint32Array(cap), touched = new Int32Array(cap)
        let nv = 0, ni = 0
        for (const ei of t[cls]) {
          const [start, count] = src.elements[ei].tris
          for (let tri = start; tri < start + count; tri++) {
            const c0 = IX[tri * 3] - base
            if (L.info[c0 * 4] === propKind && L.info[c0 * 4 + 1] === SEA_LION_STYLE) continue
            for (let k = 0; k < 3; k++) {
              const gv = IX[tri * 3 + k]
              const cv = gv - base
              let lv = remap[cv]
              if (lv < 0) {
                lv = remap[cv] = nv
                touched[nv] = cv
                pos[nv * 3] = P[gv * 3]; pos[nv * 3 + 1] = P[gv * 3 + 1]; pos[nv * 3 + 2] = P[gv * 3 + 2]
                uv[nv * 2] = L.u[cv]; uv[nv * 2 + 1] = L.v[cv]
                info[nv * 4] = L.info[cv * 4]; info[nv * 4 + 1] = L.info[cv * 4 + 1]; info[nv * 4 + 2] = L.info[cv * 4 + 2]; info[nv * 4 + 3] = L.info[cv * 4 + 3]
                nv++
              }
              idx[ni++] = lv
            }
          }
        }
        for (let i = 0; i < nv; i++) remap[touched[i]] = -1
        if (!ni) continue
        const used = ni < cap ? idx.slice(0, ni) : idx   // without the sea lions' triangles
        const g = new THREE.BufferGeometry()
        const posA = pos.slice(0, nv * 3)
        g.setAttribute('position', new THREE.BufferAttribute(posA, 3))
        g.setAttribute('cuv', new THREE.BufferAttribute(uv.slice(0, nv * 2), 2))
        const infoA = info.slice(0, nv * 4)
        g.setAttribute('cinfo', new THREE.BufferAttribute(infoA, 4))
        if (cls === 'mark') {
          // Paint by style: 0 worn white, 1 centre-line yellow, 2 rail steel, 3 ballast, 4 bike-lane green,
          // 5 transit-lane red, 6-11 the rainbow crosswalks (red to violet), 12-14 playground rubber, terracotta, sand.
          const col = new Float32Array(nv * 3)
          for (let i = 0; i < nv; i++) { const c = pal[infoA[i * 4 + 1]] ?? pal[0]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
          g.setAttribute('color', new THREE.BufferAttribute(col, 3))
        }   // ground and built get their colour attribute only for the cute and grey looks (paint)
        g.setIndex(new THREE.BufferAttribute(nv > 65535 ? used : Uint16Array.from(used), 1))
        g.setAttribute('normal', new THREE.BufferAttribute(vertexNormals(posA, used, nv), 3))
        g.computeBoundingSphere()
        // Drawn from the GPU after the first frame; only cinfo is read again (the cute and grey colours).
        freeGeometryAfterUpload(g, ['cinfo'])
        const m = new THREE.Mesh(g)
        m.receiveShadow = true
        m.castShadow = cls === 'built'
        ;(cls === 'built' ? this.context : this.park).add(m)
        ;(cls === 'ground' ? this.groundMeshes : cls === 'built' ? this.builtMeshes : this.markMeshes).push(m)
      }
    }
  }

  private decorated = false
  /**
   * The draw-only decoration: street trees, parked cars, the skyline, the horizon ring, and the
   * murals, the Castro Theatre's sign and the flag. main calls it once the first frame is up (the
   * world is playable before it; it pops in a frame or two later), and before headless shots.
   */
  async decorate() {
    if (this.decorated) return
    this.decorated = true
    this.buildTrees()
    this.buildCars()
    const H = this.look.horizon
    if (this.look.skyline && H) {
      const core = H.core ? { x0: H.core[0][0], y0: H.core[0][1], x1: H.core[1][0], y1: H.core[1][1] } : undefined
      this.skyline = new Skyline(this.look.skyline, { x0: H.bbox[0][0], y0: H.bbox[0][1], x1: H.bbox[1][0], y1: H.bbox[1][1] }, 'real', core)
      this.context.add(this.skyline.group)
    }
    this.buildHorizon()
    if (this.realOk) {
      try {
        this.detail = await CityDetail.create({ murals: this.look.murals, castro: this.look.castro, flag: this.look.flag, papel: this.look.papel, lanterns: this.look.lanterns, shopsigns: this.look.shopsigns }, lampLit)
        this.context.add(this.detail.group)
      } catch (e) { console.warn('city detail', e) }
    }
    this.cullList = null
    if (this.style) this.setStyle(this.style)
  }

  /**
   * Beyond the city box: a plain ring of low blocks on flat ground out to 420 m, so streets
   * do not end in the void (draw-only, no data; the fog swallows most of it at street level).
   */
  private buildHorizon() {
    const src = this.src
    // The export's extent and its edge heights (city.horizon); older exports: the boundary wall,
    // which stood 3 m into the ground around a plain box, gives them from its low vertices.
    let pts: number[][] = this.look.horizon?.edge ?? []
    if (!pts.length) {
      const e = src.elements.find((x) => x.id === 'city_boundary_wall')
      if (!e) return
      const edge: number[][] = []
      const [start, count] = e.tris
      for (let t = start; t < start + count; t++) for (let k = 0; k < 3; k++) {
        const v = src.indices[t * 3 + k] * 3
        edge.push([src.positions[v], src.positions[v + 1], src.positions[v + 2]])
      }
      const low = new Map<string, number[]>()
      for (const [x, y, z] of edge) { const key = `${Math.round(x)}_${Math.round(y)}`; const o = low.get(key); if (!o || z < o[2]) low.set(key, [x, y, z]) }
      pts = [...low.values()].map(([x, y, z]) => [x, y, z + 3])
    }
    const x0 = Math.min(...pts.map((p) => p[0])), x1 = Math.max(...pts.map((p) => p[0])), y0 = Math.min(...pts.map((p) => p[1])), y1 = Math.max(...pts.map((p) => p[1]))
    const edgeZ = (x: number, y: number) => {
      const cx = Math.min(Math.max(x, x0), x1), cy = Math.min(Math.max(y, y0), y1)
      let best = pts[0], bd = Infinity
      for (const p of pts) { const d = (p[0] - cx) ** 2 + (p[1] - cy) ** 2; if (d < bd) { bd = d; best = p } }
      return best[2]
    }
    let seed = 5
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
    const R = 420, step = 24
    const items: number[][] = []
    // Not in the bay (the skyline knows the water line).
    const water = this.look.skyline?.bridge?.water
    const wet = (x: number, y: number) => water !== undefined && !!this.skyline && this.skyline.heightAt(x, y) <= water + 0.8
    for (let gx = x0 - R; gx < x1 + R; gx += step) for (let gy = y0 - R; gy < y1 + R; gy += step) {
      if (gx > x0 - 10 && gx < x1 + 10 && gy > y0 - 10 && gy < y1 + 10) continue
      if (wet(gx, gy)) continue
      const ix = Math.round(gx / step), iy = Math.round(gy / step)
      if (ix % 5 === 0 || iy % 4 === 0) continue   // streets
      const w = 10 + rnd() * 9, d = 12 + rnd() * 10, h = rnd() < 0.08 ? 18 + rnd() * 14 : 6 + rnd() * 8
      items.push([gx + (rnd() - 0.5) * 5, gy + (rnd() - 0.5) * 5, w, d, h])
    }
    const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0, 0.5)
    const boxes = new THREE.InstancedMesh(geo, undefined, items.length)
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color()
    items.forEach(([x, y, w, d, h], i) => {
      const gz = this.skyline ? this.skyline.heightAt(x, y) : edgeZ(x, y)   // on the real hills where the export has them
      m.compose(p.set(x, y, gz - 1), q.identity(), s.set(w, d, h + 1))
      boxes.setMatrixAt(i, m)
      boxes.setColorAt(i, col.set(PALETTES[i % 3][Math.floor(rnd() * 8)]).multiplyScalar(0.72))
    })
    boxes.computeBoundingSphere()
    // Ground skirt: strips from the city edge straight out to the ring's end, at the edge's own
    // height every few metres (the west edge climbs Dolores Heights), plus the four corners.
    const pos: number[] = []
    const sides: [number, number, number, number][] = [[0, y0, 0, -1], [0, y1, 0, 1], [x0, 0, -1, 0], [x1, 0, 1, 0]]
    for (const [ex, ey, nx, ny] of sides) {
      const along = (p: number[]) => (nx === 0 ? p[0] : p[1])
      const on = pts.filter((p) => (nx === 0 ? Math.abs(p[1] - ey) < 1.5 : Math.abs(p[0] - ex) < 1.5)).sort((a, b) => along(a) - along(b))
      for (let i = 0; i < on.length - 1; i++) {
        if (water !== undefined && on[i][2] <= water + 1.0 && on[i + 1][2] <= water + 1.0) continue   // the bay: the skyline's water shows
        const A = [on[i][0], on[i][1], on[i][2] - 0.25], B = [on[i + 1][0], on[i + 1][1], on[i + 1][2] - 0.25]
        const Ao = [A[0] + nx * R, A[1] + ny * R, A[2]], Bo = [B[0] + nx * R, B[1] + ny * R, B[2]]
        pos.push(...A, ...Ao, ...Bo, ...A, ...Bo, ...B)
      }
    }
    for (const [cx, cy, sx, sy] of [[x0, y0, -1, -1], [x1, y0, 1, -1], [x1, y1, 1, 1], [x0, y1, -1, 1]]) {
      const z = edgeZ(cx, cy) - 0.25
      pos.push(cx, cy, z, cx + sx * R, cy, z, cx + sx * R, cy + sy * R, z, cx, cy, z, cx + sx * R, cy + sy * R, z, cx, cy + sy * R, z)
    }
    const sg = new THREE.BufferGeometry()
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
    sg.computeVertexNormals()
    const skirt = new THREE.Mesh(sg)
    skirt.receiveShadow = true
    const std = (c: number) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, side: THREE.DoubleSide })
    const grad = this.gradient ?? new THREE.Texture()
    this.horizon = {
      boxes, skirt,
      mats: {
        real: [new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), std(0x55574f)],
        cute: [new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: grad }), new THREE.MeshToonMaterial({ color: 0xd8d2c4, gradientMap: grad, side: THREE.DoubleSide })],
        grey: [new THREE.MeshLambertMaterial({ color: 0xffffff }), new THREE.MeshLambertMaterial({ color: 0xb6b8bb, side: THREE.DoubleSide })],
      },
    }
    // With the skyline's real ground out there, the flat skirt would only hide it.
    this.context.add(...(this.skyline ? [boxes] : [boxes, skirt]))
  }

  /** Parked cars: one instanced low-poly car per tile, painted per instance; the lowriders (city.lowriders,
   *  24th St) instanced meshes of their own model and candy paint. */
  private buildCars() {
    const C = this.look.cars
    if (!C.length) return
    const geo = carGeometry()
    const tile = 200
    const groups = new Map<string, number[][]>()
    if (this.look.lowriders?.length) this.buildLowriders(this.look.lowriders)
    for (const c of C) {
      const k = `${Math.floor(c[0] / tile)}_${Math.floor(c[1] / tile)}`
      let g = groups.get(k)
      if (!g) groups.set(k, (g = []))
      g.push(c)
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), z = new THREE.Vector3(0, 0, 1)
    const tiles: { mesh: THREE.InstancedMesh; cars: number[][] }[] = []
    for (const [, cs] of groups) {
      const im = new THREE.InstancedMesh(geo, undefined, cs.length)
      tiles.push({ mesh: im, cars: cs })
      cs.forEach((c, i) => {
        const [x, y, zz, heading, ci, len] = c
        // Geometry runs along +x; heading is clockwise from north (+y).
        q.setFromAxisAngle(z, Math.PI / 2 - (heading * Math.PI) / 180)
        m.compose(p.set(x, y, zz), q, s.set(len / 4.4, 1, 1))
        im.setMatrixAt(i, m)
        im.setColorAt(i, col.set(CAR_COLOURS[ci % CAR_COLOURS.length]))
      })
      im.castShadow = true; im.receiveShadow = true
      im.computeBoundingSphere()
      this.context.add(im)
      this.carMeshes.push(im)
    }
    this.parked = new ParkedCars(this.context, tiles, CAR_COLOURS)
  }

  private buildLowriders(cs: number[][]) {
    // Two instanced meshes: the paint (coloured per car) and the trim (chrome, glass, tyres: its own colours).
    const geo = lowriderGeometry()
    for (const part of ['paint', 'trim'] as const) {
      const im = new THREE.InstancedMesh(geo[part], undefined, cs.length)
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), z = new THREE.Vector3(0, 0, 1)
      cs.forEach((c, i) => {
        const [x, y, zz, heading, ci, len] = c
        q.setFromAxisAngle(z, Math.PI / 2 - (heading * Math.PI) / 180)
        m.compose(p.set(x, y, zz), q, s.set(len / 5.6, 1, 1))
        im.setMatrixAt(i, m)
        if (part === 'paint') im.setColorAt(i, col.set(LOWRIDER_COLOURS[ci % LOWRIDER_COLOURS.length]))
      })
      im.castShadow = true; im.receiveShadow = true
      im.computeBoundingSphere()
      im.name = `lowriders ${part}`
      this.context.add(im)
      this.carMeshes.push(im)
    }
  }

  private buildTrees() {
    const T = this.look.trees
    if (!T.length) return
    const tile = 200
    const groups = new Map<string, number[][]>()
    for (const t of T) {
      const k = `${Math.floor(t[0] / tile)}_${Math.floor(t[1] / tile)}`
      let g = groups.get(k)
      if (!g) groups.set(k, (g = []))
      g.push(t)
    }
    const trunkGeo = new THREE.CylinderGeometry(0.5, 0.62, 1, 7, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5)
    trunkGeo.userData.kind = 'trunk'
    const classes = [0, 2, 3, 4, 5]
    const crownGeo = new Map(classes.map((k) => [k, leafCrown(k)]))
    const branchGeo = crownBranches()
    const palmGeo = palmCrown()
    // Shadows come from a plain proxy per crown (drawn into the shadow map only), not from the cards.
    const shadowGeo = new THREE.IcosahedronGeometry(0.78, 1)
    shadowGeo.userData.kind = 'shadow'
    const shadowMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false })
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), col = new THREE.Color(), Z = new THREE.Vector3(0, 0, 1)
    const fr = (v: number) => ((v % 1) + 1) % 1
    for (const [, ts] of groups) {
      const palms = ts.filter((t) => t[5] === 1), broad = ts.filter((t) => t[5] !== 1)
      const trunks = new THREE.InstancedMesh(trunkGeo, undefined, ts.length)
      ts.forEach((t, i) => {
        const [x, y, z, h, c, kind, d] = t
        const trunkH = kind === 1 ? h : h - c * 1.1
        const r = Math.min(Math.max(0.12, d * 0.8), kind === 1 ? 0.8 : 0.55)
        m.compose(p.set(x, y, z - 0.2), q.identity(), s.set(r, r, Math.max(1.2, trunkH) + 0.2))
        trunks.setMatrixAt(i, m)
        trunks.setColorAt(i, col.set(kind === 1 ? 0x9a8a70 : kind === 2 ? 0x8a8070 : 0x56473a))   // planes: pale mottled bark
      })
      const meshes: THREE.InstancedMesh[] = [trunks]
      for (const k of classes) {
        const list = broad.filter((t) => (t[5] === k) || (k === 0 && !classes.includes(t[5])))
        if (!list.length) continue
        const crowns = new THREE.InstancedMesh(crownGeo.get(k)!, undefined, list.length)
        const branches = new THREE.InstancedMesh(branchGeo, undefined, list.length)
        const shadows = new THREE.InstancedMesh(shadowGeo, shadowMat, list.length)
        list.forEach((t, i) => {
          const [x, y, z, h, c] = t
          q.setFromAxisAngle(Z, fr(x * 7.13 + y * 3.71) * Math.PI * 2)
          const sq = 0.88 + fr(x * 13.7 + y * 5.3) * 0.24
          const cz = z + h - c * sq
          m.compose(p.set(x, y, cz), q, s.set(c, c * (0.92 + fr(y * 3.1) * 0.16), c * sq))
          crowns.setMatrixAt(i, m); shadows.setMatrixAt(i, m)
          m.compose(p.set(x, y, cz - c * 0.85 * sq), q, s.set(c, c, c * sq))
          branches.setMatrixAt(i, m)
          // A little variety in each tree's green (or purple).
          col.setHSL(0, 0, 0.72 + fr(x * 1.37 + y * 2.11) * 0.28)
          crowns.setColorAt(i, col)
          branches.setColorAt(i, col.set(0x4d3f33))
        })
        crowns.castShadow = false; branches.castShadow = false
        shadows.castShadow = true; shadows.receiveShadow = false
        meshes.push(crowns, branches, shadows)
      }
      if (palms.length) {
        const fronds = new THREE.InstancedMesh(palmGeo, undefined, palms.length)
        palms.forEach((t, i) => {
          const [x, y, z, h] = t
          q.setFromAxisAngle(Z, (x * 3.3 + y * 1.7) % 6.28)
          m.compose(p.set(x, y, z + h), q, s.set(1, 1, 1))
          fronds.setMatrixAt(i, m)
          fronds.setColorAt(i, col.setHSL(0.22, 0.4, 0.28))
        })
        fronds.castShadow = true
        meshes.push(fronds)
      }
      for (const im of meshes) {
        im.receiveShadow = im.geometry.userData.kind !== 'shadow'
        im.computeBoundingSphere()
        this.context.add(im)
        this.treeMeshes.push(im)
      }
      trunks.castShadow = true
    }
  }

  setStyle(style: 'real' | 'cute' | 'grey') {
    this.style = style
    this.culledAt.far = NaN   // cull again on the next frame (visibility below may change)
    const M = this.mats![style]
    for (const g of this.groundMeshes) {
      g.material = M.ground
      this.paint(g, style)
    }
    for (const g of this.builtMeshes) {
      g.material = M.built
      g.castShadow = style === 'real' && this.shadows
      this.paint(g, style)
    }
    for (const g of this.markMeshes) g.material = M.mark
    for (const c of this.carMeshes) { c.material = M.car; c.castShadow = style === 'real' && this.shadows }
    if (this.horizon) { const [b, s] = this.horizon.mats[style]; this.horizon.boxes.material = b; this.horizon.skirt.material = s }
    for (const t of this.treeMeshes) {
      const geo = t.geometry
      if (geo.userData.kind === 'shadow') { t.visible = true; t.castShadow = style === 'real' && this.shadows; continue }
      t.material = geo.userData.kind === 'crown' ? M.crown : geo.userData.kind === 'palm' ? M.palm : M.trunk
      t.castShadow = style === 'real' && this.shadows && geo.userData.kind !== 'crown' && geo.userData.kind !== 'branch'
    }
  }

  /** Vertex colours for cute and grey (real computes its colours in the shader). */
  private paint(mesh: THREE.Mesh, style: 'real' | 'cute' | 'grey') {
    if (style === 'real') return
    const g = mesh.geometry
    const info = g.getAttribute('cinfo') as THREE.BufferAttribute
    if (!g.getAttribute('color')) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(info.count * 3), 3))
    const colAttr = g.getAttribute('color') as THREE.BufferAttribute
    const arr = colAttr.array as Float32Array
    const c = new THREE.Color()
    const kinds = this.look.kinds
    for (let i = 0; i < info.count; i++) {
      const kind = kinds[info.getX(i)] ?? 'lot', st = info.getY(i) & 15, pal = info.getZ(i)
      const civic = (info.getY(i) & 128) !== 0   // City Hall's granite, its dome's lead (roof 7) and gold (roof 8)
      if (style === 'grey') c.setHex(GREY_KIND[kind] ?? 0xa9a8a4)
      else if (civic && (kind === 'wall' || kind === 'cornice')) c.set('#f3efe6')
      else if (kind === 'roof' && st === 7) c.set('#79a99e')
      else if (kind === 'roof' && st === 8) c.set('#f0c048')
      else if (kind === 'wall' || kind === 'bay') c.set(PALETTES[Math.min(st, 6)][pal % 8]).offsetHSL(0, 0.12, 0.04)
      else if (kind === 'awning') c.set(AWNINGS[pal % 8]).offsetHSL(0, 0, 0.15)
      else if (kind === 'kit') c.setRGB(info.getY(i) / 255, info.getZ(i) / 255, info.getW(i) / 255, THREE.SRGBColorSpace)   // kit models carry their own colour
      else c.set(CUTE_KIND[kind] ?? '#e3dccd')
      arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b
    }
    colAttr.needsUpdate = true
  }

  private greyMaterials() {
    const lam = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })
    return { ground: lam, built: lam, mark: paintMaterial(THREE.MeshLambertMaterial), car: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), crown: new THREE.MeshLambertMaterial({ color: 0x9aa59a, map: leaves(), alphaTest: 0.45, side: THREE.DoubleSide }), trunk: new THREE.MeshLambertMaterial({ color: 0x8c8780 }), palm: new THREE.MeshLambertMaterial({ color: 0x9aa59a, side: THREE.DoubleSide }) }
  }

  private cuteMaterials(gradient: THREE.Texture) {
    const toon = (o: THREE.MeshToonMaterialParameters) => new THREE.MeshToonMaterial({ gradientMap: gradient, ...o })
    const K = this.kid
    // Buildings: toon paint with simple sky-blue windows, tagged as context for the ink pass
    // (alpha 0.5: fewer, fainter outlines than the park).
    const built = toon({ vertexColors: true, side: THREE.DoubleSide })
    built.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 cinfo; attribute vec2 cuv; varying vec4 vInfo; varying vec2 vCuv;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvInfo = cinfo; vCuv = cuv;')
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vInfo; varying vec2 vCuv;')
        .replace('#include <color_fragment>', `#include <color_fragment>
int kind = int(vInfo.x + 0.5), style = int(vInfo.y + 0.5) & 15, flags = int(vInfo.w + 0.5);
if (kind == ${K.wall} || kind == ${K.bay}) {
  bool street = (flags & 1) != 0, shop = (flags & 2) != 0;
  float u = vCuv.x, v = vCuv.y - 20.0, height = kind == ${K.wall} ? float(flags >> 2) : 0.0;
  float gf = shop ? 3.7 : 3.0;
  bool win = false;
  if (kind == ${K.wall} && v > gf && (height == 0.0 || v < height - 0.9) && (street || style >= 2 && style != 5)) {
    float fv = mod(v - gf, 3.2), cu = mod(u + 1.15, 2.3) - 1.15;
    win = abs(cu) < 0.5 && fv > 0.8 && fv < 2.5;
  }
  if (kind == ${K.bay} && v > 0.0) { float fv = mod(v, 3.3); win = fv > 0.8 && fv < 2.6 && abs(fract(u / 0.85) - 0.5) < 0.36; }
  if (kind == ${K.wall} && shop && street && v > 0.4 && v < 2.9) win = abs(mod(u, 1.5) - 0.75) > 0.05;
  if (win) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.55, 0.72), 0.8);
}`)
        .replace('#include <opaque_fragment>', '#include <opaque_fragment>\ngl_FragColor.a = 0.5;')
    }
    built.customProgramCacheKey = () => 'soma-city-built-cute'
    return {
      ground: toon({ vertexColors: true, side: THREE.DoubleSide }),
      built,
      crown: toon({ color: 0xffffff, map: leaves(), alphaTest: 0.45, side: THREE.DoubleSide }),
      trunk: toon({ color: 0xffffff }),
      palm: toon({ color: 0xffffff, side: THREE.DoubleSide }),
      mark: paintMaterial(THREE.MeshToonMaterial, { gradientMap: gradient }),
      car: toon({ vertexColors: true, side: THREE.DoubleSide }),
    }
  }

  private realMaterials() {
    const tex = this.tex!, K = this.kid
    const L = (n: (typeof TEX_LAYERS)[number]) => TEX_LAYERS.indexOf(n).toFixed(1)
    const common = {
      cityDiff: { value: tex.diff }, cityNor: { value: tex.nor }, cityAvg: { value: tex.avg },
    }
    // ---- ground: asphalt, sidewalk concrete with score lines, curbs, grass, lots ----
    const ground = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
    ground.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, common, lampUniforms)
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 cinfo; attribute vec2 cuv; varying vec4 vInfo; varying vec3 vWPos; varying vec3 vWNrm; varying vec2 vCuv;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
vInfo = cinfo; vCuv = cuv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);`)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform highp sampler2DArray cityDiff, cityNor; uniform float cityAvg[${TEX_LAYERS.length}];
${LAMP_GLSL_DECL}
varying vec4 vInfo; varying vec3 vWPos; varying vec3 vWNrm; varying vec2 vCuv;
${GLSL_NOISE}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }`)
        .replace('#include <map_fragment>', `
int kind = int(vInfo.x + 0.5);
vec2 p = vWPos.xy;
// The Mission street grid runs about 4.4 degrees west of north.
vec2 g = vec2(p.x * 0.99705 + p.y * 0.07672, -p.x * 0.07672 + p.y * 0.99705);
vec3 alb = vec3(0.5); float rough = 0.9; float layer = ${L('concrete_floor_worn_001')}; vec2 tuv = p / 2.2;
float big = fbm(p * 0.045), mid = fbm(p * 0.31 + 7.0);
float detail = 1.0;   // how strongly the tiling texture's light and dark shows
bool green = kind == ${K.median} || kind == ${K.park};
if (kind == ${K.road}) {
  layer = ${L('asphalt_02')}; tuv = p / 7.0; detail = 0.45;
  // Patched asphalt: big soft patches, tyre-darkened lanes are left to the lighting.
  float patches = smoothstep(0.52, 0.56, fbm(p * 0.06 + 11.0));
  alb = vec3(0.20, 0.20, 0.205) * (0.86 + 0.28 * big) * (0.94 + 0.12 * mid) * mix(1.0, 0.82, patches);
  rough = 0.86;
} else if (kind == ${K.path}) {
  alb = vec3(0.6, 0.58, 0.53) * (0.85 + 0.25 * big) * (0.92 + 0.12 * mid); detail = 0.6;
  if ((int(vInfo.y + 0.5) & 15) == 1) {
    // Brick (Embarcadero Plaza and its banks): running bond on the grid, each brick its own red, mortar between.
    vec2 b = g / vec2(0.21, 0.105); float row = floor(b.y); b.x += 0.5 * mod(row, 2.0);
    vec2 f = fract(b), id = vec2(floor(b.x), row);
    float shade = fbm(id * 1.37 + 3.1);
    alb = mix(vec3(0.30, 0.15, 0.11), vec3(0.42, 0.23, 0.16), shade) * (0.86 + 0.22 * big);
    alb = mix(alb, vec3(0.36, 0.34, 0.31), clamp(step(f.x, 0.035) + step(f.y, 0.07), 0.0, 1.0));
    detail = 0.35;
  }
  int pst = int(vInfo.y + 0.5) & 15;
  if (pst == 2) {
    // Pier 7's deck (city/pier7.py): weathered planks along the pier (u, v = s, t on its frame), each board its
    // own brown, a dark gap between boards, butt joints staggered board to board.
    float bi = floor(vCuv.x / 0.2), fx = fract(vCuv.x / 0.2);
    float h = hash12(vec2(bi, 3.7));
    float jl = 3.6 + 2.4 * h, jf = fract((vCuv.y + h * 11.0) / jl);
    alb = mix(vec3(0.33, 0.25, 0.17), vec3(0.47, 0.37, 0.26), h) * (0.82 + 0.3 * fbm(vec2(vCuv.x * 0.6, vCuv.y * 0.08) + bi));
    alb *= 0.9 + 0.12 * vnoise(vec2(bi * 5.0, vCuv.y * 2.5));   // grain along the board
    alb = mix(alb, vec3(0.07, 0.06, 0.05), step(fx, 0.07));
    alb = mix(alb, alb * 0.55, step(jf, 0.003));
    detail = 0.3; rough = 0.85;
  } else if (pst == 3) {
    // Pier 7's plaza: sawn concrete panels 1.5 m square on the pier's frame, each panel its own grey, stains.
    vec2 q = vCuv / 1.5, id = floor(q), f = abs(fract(q) - 0.5) * 1.5;
    float pan = hash12(id * 1.31 + 0.7);
    alb = vec3(0.43, 0.43, 0.42) * (0.95 + 0.06 * pan) * (0.88 + 0.2 * big) * (0.94 + 0.1 * mid);
    alb *= 1.0 - 0.14 * smoothstep(0.55, 0.75, fbm(vCuv * 0.7 + 4.0));       // old spills and gum
    alb *= 1.0 - 0.06 * smoothstep(0.6, 0.9, vnoise(vCuv * 9.0));             // grit
    float joint = 1.0 - smoothstep(0.006, 0.014, 0.75 - max(f.x, f.y));
    alb *= 1.0 - 0.45 * joint;
    detail = 0.3;
  } else if (pst == 4) {
    // The landing's edge band: light granite, speckled.
    alb = vec3(0.7, 0.69, 0.66) * (0.9 + 0.1 * hash12(floor(vWPos.xy * 60.0))) * (0.92 + 0.1 * mid); detail = 0.3; rough = 0.6;
  }
} else if (kind == ${K.sidewalk} || kind == ${K.curb}) {
  alb = vec3(0.56, 0.548, 0.52) * (0.88 + 0.22 * big); detail = 0.8;
  if (kind == ${K.sidewalk}) {
    // Score lines every 5 ft, both ways, on the grid.
    vec2 j = abs(fract(g / 1.524) - 0.5) * 1.524;
    float line = 1.0 - smoothstep(0.004, 0.012, min(0.762 - j.x, 0.762 - j.y));
    alb *= 1.0 - 0.28 * line;
    alb *= 0.93 + 0.12 * mid;
  }
  if (kind == ${K.curb}) { tuv = vec2(vCuv.x, vWPos.z) / 1.5; alb = vec3(0.62, 0.61, 0.58) * (0.9 + 0.15 * mid); }
  int cst = int(vInfo.y + 0.5) & 15;
  if (kind == ${K.curb} && cst == 1) {
    // Pier 7's block caps: concrete worn smooth and pale, wax and filled knob holes in white smears, scuffs.
    vec2 w = vec2(vWPos.x + vWPos.z * 0.7, vWPos.y - vWPos.z * 0.7);
    alb = vec3(0.44, 0.445, 0.44) * (0.9 + 0.14 * fbm(w * 1.3));
    alb = mix(alb, vec3(0.74, 0.74, 0.72), 0.7 * smoothstep(0.52, 0.68, fbm(w * 0.9 + 9.0)));
    alb *= 1.0 - 0.25 * smoothstep(0.62, 0.8, fbm(w * 3.1 + 2.0));
    tuv = w / 1.2; detail = 0.35; rough = 0.55;
  } else if (kind == ${K.curb} && cst == 2) {
    // Their bases: exposed-aggregate concrete, warmer, grimy toward the ground.
    vec2 w = vec2(vWPos.x + vWPos.y, vWPos.z);
    float agg = vnoise(vec2((vWPos.x + vWPos.y) * 34.0, vWPos.z * 34.0)) * 0.6 + vnoise(vec2((vWPos.x - vWPos.y) * 71.0, vWPos.z * 71.0 + 3.0)) * 0.4;
    alb = vec3(0.44, 0.43, 0.4) * (0.84 + 0.3 * agg) * (0.9 + 0.12 * fbm(w * 1.7));
    tuv = w / 1.5; detail = 0.6; rough = 0.9;
  }
} else if (kind == ${K.kit ?? -1}) {
  // Colours of their own on rideable ground (the interiors' floors and stairs): r, g, b in the info bytes.
  alb = pow(vec3(vInfo.y, vInfo.z, vInfo.w) / 255.0, vec3(2.2)) * (0.94 + 0.08 * mid); detail = 0.3;
} else if (kind == ${K.lot}) {
  // Block interiors: mostly paving (yards, lots, parking), with weedy and planted patches.
  float garden = fbm(p * 0.16 + 3.0);
  float paving = fbm(p * 0.05 + 17.0);
  if (garden > 0.6) { green = true; layer = ${L('leafy_grass')}; tuv = p / 2.0; }
  else alb = mix(vec3(0.27, 0.27, 0.27), vec3(0.48, 0.47, 0.44), smoothstep(0.4, 0.6, paving)) * (0.88 + 0.24 * mid);
}
if (green) { layer = ${L('leafy_grass')}; tuv = p / 2.0; rough = 0.95; }
vec3 tx = texture(cityDiff, vec3(tuv, layer)).rgb;
// The grass texture is late-summer; SF lawns in the fog are greener.
vec3 grass = mix(vec3(lum(tx)), tx, 1.35) * vec3(0.66, 1.0, 0.5) * (0.7 + 0.45 * big);
vec3 albedo = green ? grass : alb * mix(1.0, lum(tx) / cityAvg[int(layer + 0.5)], detail);
// Under the park's freeway deck: in its shade (the deck casts no shadow of its own).
if (kind != ${K.kit ?? -1}) albedo *= mix(1.0, 0.42, clamp(vInfo.w / 200.0, 0.0, 1.0));
diffuseColor.rgb *= clamp(albedo, 0.0, 1.0);
vec3 nm = texture(cityNor, vec3(tuv, layer)).xyz * 2.0 - 1.0;
vec3 wn = normalize(vWNrm) * (gl_FrontFacing ? 1.0 : -1.0);
vec3 dn = normalize(wn + vec3(nm.xy * (kind == ${K.road} ? 0.5 : 0.35), 0.0) * step(0.6, wn.z));
float cityRough = rough;`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = cityRough;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(dn, 0.0)).xyz);')
        // Night: the nearest street lights light the ground (src/client/real.ts lampGlsl).
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
${lampGlsl('vWPos', 'wn')}`)
    }
    ground.customProgramCacheKey = () => 'soma-city-ground'

    // ---- buildings: walls, bays, cornices, awnings, roofs ----
    const pal = PALETTES.flat().map((h) => new THREE.Color(h))
    const trims = TRIMS.map((h) => new THREE.Color(h))
    const awn = AWNINGS.map((h) => new THREE.Color(h))
    const lady = LADIES.flat().map((h) => new THREE.Color(h))
    const built = new THREE.MeshStandardMaterial({ side: THREE.DoubleSide })
    built.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, common, lampUniforms, { palette: { value: pal }, trims: { value: trims }, awnings: { value: awn }, ladies: { value: lady }, signs: { value: this.signs } })
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', `#include <common>
attribute vec4 cinfo; attribute vec2 cuv; varying vec4 vInfo; varying vec2 vCuv; varying vec3 vWPos; varying vec3 vWNrm;`)
        .replace('#include <project_vertex>', `#include <project_vertex>
vInfo = cinfo; vCuv = cuv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);`)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform highp sampler2DArray cityDiff, cityNor; uniform float cityAvg[${TEX_LAYERS.length}];
uniform vec3 palette[56]; uniform vec3 trims[8]; uniform vec3 awnings[8]; uniform vec3 ladies[21]; uniform sampler2D signs;
${LAMP_GLSL_DECL}
varying vec4 vInfo; varying vec2 vCuv; varying vec3 vWPos; varying vec3 vWNrm;
${GLSL_NOISE}
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float box2(vec2 q, vec2 h) { vec2 d = abs(q) - h; return max(d.x, d.y); }
vec3 room0(float s) { return mix(vec3(0.05, 0.055, 0.06), vec3(0.16, 0.13, 0.1), step(0.6, fract(s * 0.618))); }
// A recessed opening (window, door) of half size h; p is the point on the wall face from the
// opening's centre (m, u right, v up). The glass or door sits D behind the face and par is how far
// the view ray slides in (u, v) per metre of depth, so the opening shows real reveals as the camera
// moves. Returns 0 off the opening, 1 on a reveal (sh = its shade: sill lit, head dark, jambs
// between, darker deeper in), 2 on the glass (g = the point on it, from the centre).
float opening(vec2 p, vec2 h, float D, vec2 par, out vec2 g, out float sh) {
  g = p; sh = 1.0;
  if (box2(p, h) > 0.0) return 0.0;
  g = p - D * par;
  if (box2(g, h) < 0.0) return 2.0;
  vec2 m = -par;
  m = vec2(abs(m.x) < 1e-4 ? 1e-4 : m.x, abs(m.y) < 1e-4 ? 1e-4 : m.y);
  vec2 s = (sign(m) * h - p) / m;
  sh = s.y < s.x ? (m.y < 0.0 ? 1.08 : 0.42) : 0.7;
  sh *= 1.0 - 0.3 * clamp(min(s.x, s.y) / D, 0.0, 1.0);
  return 1.0;
}
// Trim round an opening on the wall face: casing cw wide, a hood hd tall over it (its shadow on
// the casing), and a projecting sill with its shadow on the wall below (no sill on doors).
bool surround(vec2 p, vec2 h, float cw, float hd, bool sill, vec3 tc, inout vec3 albedo, inout float rough) {
  float d = box2(p, h), ax = abs(p.x);
  if (d < 0.0) return false;
  if (sill && p.y < -h.y && p.y > -h.y - 0.09 && ax < h.x + cw + 0.06) { albedo = tc * (p.y > -h.y - 0.035 ? 1.06 : 0.86); rough = 0.55; return true; }
  if (sill && p.y < -h.y - 0.09 && p.y > -h.y - 0.25 && ax < h.x + cw + 0.06) { albedo *= mix(0.6, 1.0, (-h.y - 0.09 - p.y) / 0.16); return false; }
  if (hd > 0.0 && p.y > h.y + cw && p.y < h.y + cw + hd && ax < h.x + cw + 0.09) {
    float t = (p.y - h.y - cw) / hd;
    albedo = tc * (t > 0.78 ? 1.08 : t < 0.2 ? 0.8 : 0.95); rough = 0.55; return true;
  }
  if (d < cw) { albedo = tc * (d < cw * 0.3 ? 0.86 : 1.0) * (hd > 0.0 && p.y > h.y + cw * 0.3 ? 0.78 : 1.0); rough = 0.55; return true; }
  return false;
}
// Painted lap siding (6-inch boards): the shadow under each board's lower edge on the board below,
// staggered end joints. Fades to its average where boards get under about two pixels (no shimmer).
float lapSiding(float u, float v, float seed, float pw, out float lip) {
  float bh = 0.152, row = floor(v / bh), bv = fract(v / bh), aw = pw / bh;
  float fade = smoothstep(0.3, 0.8, aw);
  float shadow = smoothstep(0.55, 0.97, bv) * 0.24 + smoothstep(0.97 - aw, 0.97 + aw, bv) * 0.22;
  float f = fract(u / 3.66 + hash12(vec2(row, seed)));
  float joint = (1.0 - smoothstep(0.004, 0.004 + 1.5 * pw, min(f, 1.0 - f) * 3.66)) * 0.16;
  float jit = (hash12(vec2(row * 1.37, seed + 4.0)) - 0.5) * 0.06;
  lip = smoothstep(0.8, 0.97, bv) * (1.0 - fade);
  return mix(1.0 - shadow - joint + jit, 0.95, fade);
}
// Fish-scale shingles (Queen Anne friezes and gables): rows offset by half a shingle, round butts.
float fishScale(float u, float v, float seed, float pw) {
  float sw = 0.16, sh = 0.14, row = floor(v / sh);
  vec2 q = vec2(u / sw + 0.5 * mod(row, 2.0), fract(v / sh) * sh / sw);
  float cx = fract(q.x) - 0.5, r = length(vec2(cx, q.y - 0.5));
  bool below = q.y < 0.5 && r > 0.5;
  float edge = below ? smoothstep(0.5, 0.64, r) : 1.0;
  float id = hash12(vec2(floor(q.x + (below ? 0.5 : 0.0)), row - (below ? 1.0 : 0.0)) + seed);
  float s = (0.7 + 0.3 * edge) * (0.93 + 0.1 * id) * (below ? 1.0 : 0.95 + 0.07 * (1.0 - q.y));
  return mix(s, 0.9, smoothstep(0.25, 0.7, pw / sh));
}
// Storefront paint (frames, bulkheads, fascia), one per shop front: deep SF shop colours.
const vec3 SHOPC[8] = vec3[8](vec3(0.10, 0.22, 0.16), vec3(0.36, 0.08, 0.07), vec3(0.09, 0.13, 0.26), vec3(0.06, 0.06, 0.06),
  vec3(0.08, 0.28, 0.30), vec3(0.62, 0.45, 0.10), vec3(0.75, 0.73, 0.68), vec3(0.42, 0.18, 0.30));`)
        .replace('#include <map_fragment>', `
int kind = int(vInfo.x + 0.5), style = int(vInfo.y + 0.5), pal = int(vInfo.z + 0.5), flags = int(vInfo.w + 0.5);
bool stoop = (style & 16) != 0, mural = (style & 32) != 0, lady = (style & 64) != 0, civic = (style & 128) != 0; style = style & 15;   // bit 16: doors up a stoop; 32: a mural alley wall; 64: a Painted Lady; 128: City Hall's granite
vec3 wn = normalize(vWNrm) * (gl_FrontFacing ? 1.0 : -1.0);
vec3 base = palette[min(style, 6) * 8 + pal % 8];
vec3 trim = trims[(pal / 8) % 8];
if (style == 0 && (pal / 8) % 8 > 5) trim = trims[(pal / 3) % 3];   // most Victorians: white trim
vec3 accent = trim * 0.55;
if (lady) { int li = (pal % 7) * 3; base = ladies[li]; trim = ladies[li + 1]; accent = ladies[li + 2]; }
vec3 albedo = base; float rough = 0.85; float metal = 0.0; vec3 bump = vec3(0.0);
float lit = 0.0;   // night: warm light from inside (windows, shops, ad panels, lamp heads)
float layer = ${L('white_stucco')}; vec2 tuv = vCuv / 2.0;
float u = vCuv.x, v = vCuv.y - 20.0;
bool street = (flags & 1) != 0, shop = (flags & 2) != 0;
// The back of a facade (the camera inside a footprint: Pier 39's one DataSF outline takes in its inner
// walkways) is a plain wall: no shop fronts or signs, which read mirrored from there.
if (!gl_FrontFacing && kind == ${K.wall}) { street = false; shop = false; }
float height = float(flags >> 2);
float seed = float(pal);
vec3 shopCol = vec3(0.0);
float signGlow = 0.0;   // night: shop signs are lit from behind
if (kind == ${K.wall} || kind == ${K.bay}) {
  bool bay = kind == ${K.bay};
  // The view ray across the wall, for recessed windows and doors: how far it slides in (u, v) per
  // metre of depth behind the face.
  vec3 Vd = normalize(cameraPosition - vWPos);
  vec3 wt = normalize(vec3(-wn.y, wn.x, 0.0) + vec3(1e-5));
  vec2 par = vec2(dot(Vd, wt), Vd.z) / max(dot(Vd, wn), 0.12);
  float pw = max(fwidth(u), fwidth(v));   // metres per pixel on the wall
  // A bay face carries its face (flags & 3: side, front, side), its width (flags >> 2, in 5 cm) and
  // the bay's floor height (u in 5 m slots); u and v start at the face's lower left corner.
  float fw = 0.0, fhb = 3.3;
  if (bay) { float bq = floor(u / 5.0); u -= bq * 5.0; fhb = 2.5 + bq * 0.02; fw = float(flags >> 2) * 0.05; }
  float top = (!bay && height > 0.0) ? height : 99.0;
  float gf = shop ? 3.7 : (style <= 1 ? 3.0 : 3.1);
  float bfl = floor(max(v, 0.0) / fhb), bfv = v - bfl * fhb;   // bay floor and height in it
  // Material: 0 painted clapboard, 1 fish-scale shingle, 2 stucco, 3 brick.
  int mat = 2;
  if (style <= 1 || style == 5) mat = 0;
  if (style == 4 && (pal % 8 < 3 || pal % 8 == 5 || pal % 8 == 7)) mat = 3;               // industrial: brick, some painted
  if (shop && (style == 2 && pal % 3 == 0 || style <= 1 && pal % 5 == 0)) mat = 3;        // older commercial blocks
  if (mat == 0 && style == 1 && pal % 7 == 2 && v > gf) mat = 1;                          // a shingled Edwardian
  if (mat == 0 && style == 0 && (pal % 3 != 2 || lady) && (bay ? bfv > fhb - 0.5 : v > top - 1.35)) mat = 1;   // Queen Anne frieze under the cornice
  bool gableZone = lady && !bay && height > 0.0 && v > height + 0.02;   // the Painted Ladies' front gables (u centred on 50)
  if (gableZone) mat = 1;
  float lip = 0.0;
  vec3 paint = base;
  if (mat == 0) { paint = base * lapSiding(u, v, seed, pw, lip); rough = 0.7; bump = vec3(0.0, -0.35 * lip, 0.0); }
  else if (mat == 1) { paint = (lady ? mix(base, accent, gableZone ? 0.28 : 0.18) : base) * fishScale(u, v, seed, pw); rough = 0.75; }
  else {
    layer = mat == 3 ? ${L('red_brick_03')} : ${L('white_stucco')};
    tuv = mat == 3 ? vec2(u, v) : vec2(u, v) / 2.0;
    vec3 tx = texture(cityDiff, vec3(tuv, layer)).rgb;
    bool painted = mat == 3 && (style == 4 ? pal % 8 == 7 : pal % 4 == 1);
    vec3 bb = style == 4 ? base : palette[32 + (pal % 2 == 0 ? pal % 3 : 5)];   // commercial brick: the industrial reds
    paint = mat == 3 && !painted ? tx * (bb / max(lum(bb), 0.05)) * 0.55 : base * (lum(tx) / cityAvg[int(layer + 0.5)]);
    vec3 nm = texture(cityNor, vec3(tuv, layer)).xyz * 2.0 - 1.0;
    bump = vec3(nm.xy, 0.0) * 0.6;
  }
  float stain = fbm(vec2(u * 0.3, v * 0.6) + seed);
  albedo = paint * (0.9 + 0.14 * stain);
  vec3 revealC = mat <= 1 ? trim : albedo;   // wood jambs are painted trim; masonry shows its own face
  float glass = 0.0;
  int sash = 0;   // 0 none, 1 double-hung, 2 steel grid, 3 one mullion
  vec2 wid = floor(vec2(u / 1.3, v / 3.2));   // which window (room) for the lights at night
  vec2 g = vec2(0.0), h = vec2(1.0), p = vec2(0.0);
  float sh = 1.0;
  // Belt courses: painted trim along each floor line of the wooden houses' street walls.
  if (!bay && street && !mural && mat <= 1 && style <= 1 && !shop && v > gf - 0.12) {
    float fh0 = 3.3, fb = v - gf - floor((v - gf + 0.12) / fh0) * fh0;
    if (fb > -0.12 && fb < 0.06 && v < top - 0.6) { albedo = lady && fb < -0.03 ? accent : trim * (fb > 0.02 ? 1.05 : 0.9); rough = 0.55; bump = vec3(0.0); }
  }
  if (!bay) {
    // Upper floors: windows on a grid, each recessed with its own casing, hood and sill.
    float fh = style == 3 ? 3.5 : style <= 1 ? 3.3 : 3.0;
    float sp = style == 3 ? 1.7 : style == 2 ? 2.9 : style == 4 ? 3.2 : 2.3;
    float ww = style == 3 ? 1.5 : style == 4 ? 2.2 : style == 2 ? 1.5 : 1.05;
    float wh = style == 3 ? 2.6 : style == 4 ? 2.0 : style == 2 ? 1.75 : 1.85;
    bool windows = (street || style >= 2 && style != 5) && style != 6;   // the mission is plain white stucco
    if (!street) sp *= 1.6;
    float fl = floor((v - gf) / fh), fv = v - gf - fl * fh;
    float ci = floor(u / sp + 0.5);
    bool fits = gf + fl * fh + 0.8 + wh + (style <= 1 ? 0.45 : 0.25) < top - 0.45;
    if (windows && fl >= 0.0 && fits && !(mural && gf + fl * fh < 7.4) && abs(u - ci * sp) < ww * 0.5 + 0.3) {
      p = vec2(u - ci * sp, fv - 0.8 - wh * 0.5); h = vec2(ww, wh) * 0.5;
      wid = vec2(ci, fl);
      float o = opening(p, h, style == 3 ? 0.07 : style == 4 ? 0.24 : mat == 2 ? 0.2 : 0.15, par, g, sh);
      sash = style == 4 ? 2 : style == 3 || style == 2 && pal % 2 == 1 ? 3 : 1;   // apartments: wide double-hung or a casement pair
      if (o > 1.5) glass = 1.0;
      else if (o > 0.5) { albedo = revealC * sh; rough = 0.7; bump = vec3(0.0); }
      else if (style == 3) {}
      else if (mat == 3) {
        // Brick: a soldier-course lintel over the window and a stone sill.
        if (p.y > h.y && p.y < h.y + 0.23 && abs(p.x) < h.x + 0.12) { albedo *= 0.8 * (0.9 + 0.1 * step(0.5, fract(p.x / 0.095))); bump = vec3(0.0); }
        else if (p.y < -h.y && p.y > -h.y - 0.1 && abs(p.x) < h.x + 0.1) { albedo = vec3(0.62, 0.6, 0.56) * (p.y > -h.y - 0.04 ? 1.05 : 0.85); rough = 0.7; bump = vec3(0.0); }
      } else if (surround(p, h, mat <= 1 ? (style == 0 ? 0.14 : 0.11) : 0.07, mat <= 1 ? (style == 0 ? 0.2 : 0.1) : 0.0, true, mat <= 1 ? trim : albedo * 1.12, albedo, rough)) bump = vec3(0.0);
    }
  } else if (v > 0.0) {
    // Bay faces: one window per side face, one to three on the front, every floor, between posts;
    // a panelled apron under the sills, a frieze over the heads (fish-scale on Queen Annes).
    int face = flags & 3;
    int nw = face == 1 ? max(1, int(fw / 0.95)) : 1;
    float post = 0.13;
    float cwid = max((fw - post * float(nw + 1)) / float(nw), 0.2);
    float k = clamp(floor((u - post * 0.5) / (cwid + post)), 0.0, float(nw - 1));
    float cx = post + cwid * 0.5 + k * (cwid + post);
    float sl = 0.7, hd = fhb - 0.55;
    p = vec2(u - cx, bfv - (sl + hd) * 0.5); h = vec2(cwid * 0.5, (hd - sl) * 0.5);
    wid = vec2(k + float(face) * 3.0 + 50.0, bfl + 50.0);
    float o = opening(p, h, 0.08, par, g, sh);
    sash = 1;
    if (o > 1.5) glass = 1.0;
    else if (o > 0.5) { albedo = trim * sh; rough = 0.6; bump = vec3(0.0); }
    else {
      bump = vec3(0.0); rough = 0.55;
      if (bfv < 0.12 || bfv > fhb - 0.08) albedo = trim * 0.92;                      // floor line
      else if (bfv > hd + 0.06) { if (mat != 1) albedo = trim * (bfv < hd + 0.14 ? 0.85 : 1.0); }   // frieze (fish-scale stays)
      else if (bfv < sl - 0.06) {
        float pd = box2(vec2(u - cx, bfv - sl * 0.5 - 0.03), vec2(cwid * 0.5 - 0.05, sl * 0.5 - 0.2));
        albedo = pd < 0.0 ? (lady ? accent : base * 0.93) : trim * (pd < 0.03 ? 0.8 : 1.0);           // apron panel
      } else albedo = trim * (box2(p, h) < 0.025 ? 0.85 : 1.0);                        // posts and frames
    }
  }
  if (street && !bay && !mural && v < gf + 0.6 && v > -0.5) {
    if (shop) {
      float seg = floor(u / 6.0), su = mod(u, 6.0) - 3.0;
      // The signboard over the shop front and its door: 3.8 m by 0.7 m, the atlas cell's shape.
      float sign = (v > 2.96 && v < 3.66 && abs(su - 0.4) < 1.9) ? 1.0 : 0.0;
      bool sf = v > 0.35 && v < 2.9;
      float mull = step(abs(mod(u, 1.5) - 0.75), 0.04) * (sf ? 1.0 : 0.0);
      // Each shop front paints its own frames, bulkhead and fascia; a narrow pilaster between fronts.
      shopCol = SHOPC[int(mod(seg * 5.0 + seed * 3.0, 8.0))];
      if (sf && v < gf) { glass = 1.0 - mull; if (mull > 0.5) { albedo = shopCol; rough = 0.55; bump = vec3(0.0); } }
      if (v <= 0.35 && v > -0.5) { albedo = shopCol * (0.85 + 0.15 * step(0.5, fract(u / 0.75))); rough = 0.5; bump = vec3(0.0); }
      if ((v > 2.9 && v < 3.7 && sign < 0.5) || abs(su) > 2.85) { albedo = shopCol; rough = 0.5; glass = 0.0; bump = vec3(0.0); }
      if (v >= 2.9 && v <= 3.0) { albedo = shopCol; glass = 0.0; }
      // The door, in a recessed entry with display glass either side.
      p = vec2(su - 2.2, v - 1.2);
      if (abs(p.x) < 0.56 && v < 2.4 && v > 0.0) {
        float o = opening(p, vec2(0.55, 1.2), 0.9, par, g, sh);
        glass = 0.0;
        if (o > 1.5) { albedo = box2(g - vec2(0.0, 0.1), vec2(0.36, 0.9)) < 0.0 ? vec3(0.05, 0.05, 0.05) : shopCol * 0.8; rough = 0.3; }
        else { albedo = vec3(0.07, 0.07, 0.075) * sh; rough = 0.08; }
        bump = vec3(0.0);
      }
      if (sign > 0.5) {
        int si = int(mod(seg * 7.0 + seed * 3.0, ${this.signNames.length}.0));
        // u runs to the right as seen from the street; the atlas is a canvas (flipY: row 0 on top).
        vec2 suv = vec2((su - 0.4 + 1.9) / 3.8, (v - 2.96) / 0.7);
        vec2 cell = vec2(float(si % ${SIGN_COLS}), float(si / ${SIGN_COLS}));
        float rows = ${Math.ceil(this.signNames.length / SIGN_COLS)}.0;
        albedo = texture2D(signs, vec2((cell.x + suv.x) / ${SIGN_COLS}.0, (rows - 1.0 - cell.y + suv.y) / rows)).rgb;
        glass = 0.0; rough = 0.45; signGlow = 1.0; bump = vec3(0.0);
      }
      sash = 0; h = vec2(0.75, 1.3); g = vec2(0.0, v - 1.6);
    } else if (style <= 1) {
      // House fronts on the lot rhythm: a garage at street level, the front door (up the stoop
      // where there is one), a garden-level window.
      float lu = mod(u, 7.6);
      if (lu < 3.75 && v < 2.6) {
        p = vec2(lu - 2.0, v - 1.15); h = vec2(1.4, 1.15);
        float o = opening(p, h, 0.16, par, g, sh);
        if (o > 1.5) {
          // Sectional door: four rows of raised panels.
          vec2 c = vec2(fract((g.x + h.x) / 0.7), fract((g.y + h.y) / 0.575));
          float joint = min(c.y, 1.0 - c.y) * 0.575;                                   // to the nearest section joint (m)
          float pd = box2((c - 0.5) * vec2(0.7, 0.575), vec2(0.26, 0.18));              // the raised panel's edge
          vec3 dc = pal % 3 == 0 ? trim * 0.85 : pal % 3 == 1 ? vec3(0.4, 0.29, 0.2) : trims[(pal / 5) % 8] * 0.8;
          albedo = dc * (1.0 - 0.4 * (1.0 - smoothstep(0.008, 0.008 + pw, joint))) * (abs(pd) < 0.012 + pw * 0.5 ? (c.y > 0.5 ? 0.84 : 1.08) : 1.0);
          rough = 0.6; bump = vec3(0.0);
        } else if (o > 0.5) { albedo = revealC * sh; bump = vec3(0.0); }
        else if (box2(p, h) < 0.13) { albedo = trim; rough = 0.55; bump = vec3(0.0); }
      }
      float dz = stoop ? 1.05 : 0.0;
      p = vec2(lu - 5.1, v - dz - 1.2);
      if (abs(p.x) < 0.75 && p.y > -1.25 && p.y < 1.6) {
        h = vec2(0.5, 1.2);
        float o = opening(p, h, stoop ? 0.5 : 0.35, par, g, sh);
        if (o > 1.5) {
          if (g.y > h.y - 0.34) { glass = 1.0; wid = vec2(floor(u / 7.6), -3.0); sash = 0; }   // transom
          else if (g.y > h.y - 0.42) { albedo = trim; rough = 0.55; }
          else {
            // Panelled door with a glazed upper lite.
            vec3 dc = trims[2 + pal % 2] * 0.75;
            float y = g.y + h.y, ax = abs(g.x);
            bool lite = box2(vec2(g.x, y - 1.5), vec2(0.3, 0.28)) < 0.0;
            float pd = min(box2(vec2(ax - 0.2, y - 0.62), vec2(0.12, 0.4)), 9.0);
            albedo = lite ? vec3(0.08, 0.07, 0.06) : dc * (pd < 0.0 ? 0.88 : pd < 0.025 ? 1.1 : 1.0);
            if (lite) lit = 0.5 * step(0.5, hash12(vec2(floor(u / 7.6), seed)));
            rough = lite ? 0.1 : 0.5;
          }
          bump = vec3(0.0);
        } else if (o > 0.5) { albedo = revealC * sh; bump = vec3(0.0); }
        else if (surround(p, h, stoop ? 0.1 : 0.14, stoop ? 0.0 : (style == 0 ? 0.24 : 0.14), false, trim, albedo, rough)) bump = vec3(0.0);
      }
      p = vec2(lu - 6.7, v - 1.75);
      if (abs(p.x) < 0.66 && abs(p.y) < 1.15) {
        vec2 hw = vec2(0.45, 0.8);
        float o = opening(p, hw, 0.15, par, g, sh);
        if (o > 1.5) { glass = 1.0; h = hw; sash = 1; wid = vec2(floor(u / 7.6), -2.0); }
        else if (o > 0.5) { albedo = revealC * sh; bump = vec3(0.0); }
        else if (surround(p, hw, 0.12, style == 0 ? 0.16 : 0.0, true, trim, albedo, rough)) bump = vec3(0.0);
      }
    } else if (style == 3) {
      // Modern: a glazed ground floor behind slim mullions, set back a little.
      p = vec2(mod(u, 2.0) - 1.0, v - (gf - 0.2) * 0.5); h = vec2(0.96, (gf - 0.6) * 0.5);
      if (abs(p.y) < h.y + 0.05) {
        float o = opening(p, h, 0.12, par, g, sh);
        if (o > 1.5) { glass = 1.0; sash = 0; wid = vec2(floor(u / 2.0), -2.0); }
        else { albedo = vec3(0.16, 0.17, 0.18) * (o > 0.5 ? sh : 1.0); rough = 0.4; metal = 0.5; bump = vec3(0.0); }
      }
    } else if (style == 4) {
      // Industrial: a roll-up door in a deep opening, steel lintel over it.
      float lu = mod(u, 9.0);
      p = vec2(lu - 3.0, v - 1.8); h = vec2(2.0, 1.8);
      if (abs(p.x) < 2.15 && v < 3.8) {
        float o = opening(p, h, 0.25, par, g, sh);
        if (o > 1.5) { albedo = vec3(0.42, 0.43, 0.42) * (0.82 + 0.18 * smoothstep(0.3, 0.7, fract(g.y / 0.12))); rough = 0.5; metal = 0.4; }
        else if (o > 0.5) albedo = revealC * sh;
        else if (p.y > h.y && p.y < h.y + 0.15) { albedo = vec3(0.2, 0.2, 0.21); metal = 0.5; rough = 0.4; }
        bump = abs(p.x) < h.x && p.y < h.y + 0.15 ? vec3(0.0) : bump;
      }
    } else if (style != 6) {
      // Apartments and sheds: a recessed entry with a glass door, windows either side.
      float lu = mod(u, 8.0);
      p = vec2(lu - 3.8, v - 1.25);
      if (abs(p.x) < 0.95 && v < 2.7) {
        h = vec2(0.8, 1.25);
        float o = opening(p, h, 0.7, par, g, sh);
        if (o > 1.5) { bool gl = box2(g - vec2(0.0, 0.1), vec2(0.6, 0.95)) < 0.0 && abs(g.x) > 0.03; albedo = gl ? vec3(0.06, 0.06, 0.065) : vec3(0.2, 0.17, 0.14); rough = gl ? 0.08 : 0.5; if (gl) lit = 0.6; }
        else if (o > 0.5) albedo = revealC * sh;
        else if (box2(p, h) < 0.08) albedo = albedo * 1.12;
        bump = vec3(0.0);
      } else {
        float cu = mod(u + 1.35, 2.7) - 1.35;
        p = vec2(cu, v - 1.8);
        if (abs(p.x) < 0.7 && abs(p.y) < 1.1) {
          vec2 hw = vec2(0.5, 0.8);
          float o = opening(p, hw, mat == 3 ? 0.22 : 0.18, par, g, sh);
          if (o > 1.5) { glass = 1.0; h = hw; sash = 1; wid = vec2(floor((u + 1.35) / 2.7), -2.0); }
          else if (o > 0.5) { albedo = revealC * sh; bump = vec3(0.0); }
          else if (surround(p, hw, 0.07, 0.0, true, albedo * 1.12, albedo, rough)) bump = vec3(0.0);
        }
      }
    }
  }
  // Commercial blocks (shop fronts below) get a painted cornice and a string course above the shops.
  if (shop && !bay && height > 6.0) {
    if (v > height - 0.75 && v < height) { albedo = trim * (0.9 + 0.1 * step(0.5, fract(u / 0.35)) * step(v, height - 0.45)); rough = 0.6; glass = 0.0; bump = vec3(0.0); }
    else if (v > gf + 0.05 && v < gf + 0.3) { albedo = trim * 0.95; rough = 0.6; glass = 0.0; bump = vec3(0.0); }
  }
  // Mission Dolores (landmark): pilasters, tall round-headed windows, a string course and arched doors.
  if (style == 6 && !bay && v > 0.0) {
    float cu = mod(u, 3.4) - 1.7, bay6 = floor(u / 3.4);
    if (abs(cu) > 1.45) albedo *= 0.86;
    if (abs(v - 5.6) < 0.18 || (height > 3.0 && v > height - 0.6)) albedo *= 0.82;
    bool win = abs(cu) < 0.55 && v > 6.4 && (v < 9.2 || length(vec2(cu, v - 9.2)) < 0.55) && v < height - 1.2;
    bool door = mod(bay6, 3.0) == 1.0 && abs(cu) < 0.8 && (v < 3.4 || length(vec2(cu, v - 3.4)) < 0.8);
    if (win) { albedo = vec3(0.06, 0.07, 0.08); rough = 0.1; lit = 0.6; }
    if (door) { albedo = vec3(0.24, 0.15, 0.09) * (0.85 + 0.15 * step(0.5, fract(cu * 3.0))); rough = 0.7; }
  }
  // City Hall (civic): granite, a rusticated base with arched openings, giant pilasters with two rows
  // of tall windows between them (round-headed above), an entablature and a plain attic.
  if (civic && !bay && v > 0.0) {
    albedo = vec3(0.80, 0.79, 0.76) * (0.93 + 0.07 * fbm(vWPos.xy * 0.3 + vWPos.z * 0.2));
    rough = 0.7; glass = 0.0; bump = vec3(0.0);
    lit = 0.12;   // floodlit at night
    float cu = mod(u, 4.6) - 2.3, cb = floor(u / 4.6);
    if (v < 6.6) {
      if (fract(v / 0.62) < 0.09) albedo *= 0.8;
      if (abs(cu) < 0.95 && v > 1.0 && (v < 4.2 || length(vec2(cu, v - 4.2)) < 0.95)) { albedo = vec3(0.06, 0.07, 0.08); rough = 0.1; lit = 0.5 * step(0.35, hash12(vec2(cb, 1.0) + seed)); }
    } else if (v < height - 4.2) {
      if (abs(cu) > 1.7) albedo *= 1.05;
      if (abs(abs(cu) - 1.7) < 0.07) albedo *= 0.78;
      bool w1 = abs(cu) < 0.85 && v > 7.8 && v < 12.4;
      bool w2 = abs(cu) < 0.85 && v > 13.8 && (v < 17.6 || length(vec2(cu, v - 17.6)) < 0.85);
      if (w1 || w2) { albedo = vec3(0.06, 0.07, 0.08); rough = 0.08; lit = 0.55 * step(0.4, hash12(vec2(cb, w1 ? 2.0 : 3.0) + seed)); }
    } else {
      if (v < height - 2.8) albedo *= 0.86 + 0.06 * step(0.5, fract(u / 0.4));
      else if (abs(cu) < 0.55 && v > height - 2.2 && v < height - 0.9) { albedo = vec3(0.07, 0.08, 0.09); rough = 0.1; }
    }
  }
  if (glass > 0.5) {
    // Glass: the sky reflects in it (low roughness); behind it a dim room, curtains or blinds in
    // some, a warm light in a few. Storefronts show more of the shop. The reveal shades its edges.
    float n = hash12(wid + seed), m = hash12(wid * 1.7 + seed + 3.1);
    float gy = clamp((g.y + h.y) / (2.0 * h.y), 0.0, 1.0);
    vec3 room = mix(vec3(0.05, 0.055, 0.06), vec3(0.16, 0.13, 0.1), step(0.75, n));
    if (n > 0.45 && n < 0.75) room = mix(room, trim * 0.55, step(1.0 - 0.6 * m, gy) * step(0.3, m));
    if (shop && v < gf) room = mix(vec3(0.05, 0.045, 0.04), vec3(0.2, 0.16, 0.11), m * m) * (0.6 + 0.6 * fbm(vec2(u, v) * 1.3));
    float ed = -box2(g, h);
    albedo = room * (sash > 0 ? (0.6 + 0.4 * smoothstep(0.0, 0.12, ed)) * (1.0 - 0.3 * smoothstep(0.35, 0.0, h.y - g.y)) : 1.0);
    // At night about a third of the rooms have a light on (curtained ones dimmer); shops are lit.
    lit = step(0.62, hash12(wid * 2.3 + seed + 9.7)) * (0.5 + 0.5 * m);
    // Shop glass at night: lit from inside, brighter toward the ceiling lights, not a flat sheet (it blew out to cream).
    if (shop && v < gf) lit = (0.38 + 0.3 * m) * (0.55 + 0.6 * fbm(vec2(u, v) * 1.3)) * (0.6 + 0.4 * smoothstep(0.2, gf, v));
    rough = 0.05; metal = 0.0; bump = vec3(0.0);
    // Sashes: painted frames round the glass, a meeting rail (double-hung), steel muntins, a mullion.
    float sw = max(0.035, pw * 1.2);
    bool fr = sash > 0 && ed < 0.045;
    if (sash == 1) fr = fr || abs(g.y - h.y * 0.08) < sw;
    if (sash == 2) fr = fr || abs(fract((g.x + h.x) / (2.0 * h.x / 5.0) + 0.5) - 0.5) * (2.0 * h.x / 5.0) < sw * 0.6 || abs(fract((g.y + h.y) / (2.0 * h.y / 4.0) + 0.5) - 0.5) * (2.0 * h.y / 4.0) < sw * 0.6;
    if (sash == 3) fr = fr || abs(g.x) < sw;
    if (fr) { albedo = sash == 2 || sash == 3 ? vec3(0.13, 0.14, 0.15) : lady ? accent : (mat <= 1 ? trim : vec3(0.86, 0.85, 0.82)); rough = 0.5; lit = 0.0; metal = sash >= 2 ? 0.4 : 0.0; }
  }
  if (gableZone) {
    // An arched attic window in the middle of the gable, its casing in trim and accent, and a trim
    // band along the gable's foot.
    float gx = u - 50.0, gy = v - height;
    vec2 q = vec2(gx, gy - 1.55);
    float arch = gy > 1.55 ? length(vec2(gx, (gy - 1.55) * 1.0)) - 0.42 : max(abs(gx) - 0.42, 0.75 - gy);
    if (arch < 0.0) { albedo = mix(vec3(0.04, 0.05, 0.06), room0(seed), 0.4); rough = 0.08; lit = 0.45 * step(0.5, hash12(vec2(seed, 7.0))); bump = vec3(0.0); }
    else if (arch < 0.09) { albedo = trim; rough = 0.55; bump = vec3(0.0); }
    else if (arch < 0.16) { albedo = accent; rough = 0.55; bump = vec3(0.0); }
    if (gy < 0.28) { albedo = gy < 0.12 ? accent : trim; rough = 0.55; bump = vec3(0.0); }
  }
  // A darker band at the foot of the wall (splash), basement concrete below the sidewalk.
  if (v < 0.0 && !bay) { albedo = vec3(0.5, 0.49, 0.47) * (0.9 + 0.1 * stain); bump = vec3(0.0); }
} else if (kind == ${K.cornice}) {
  albedo = (style == 2 || style == 3) ? base * 0.9 : trim;
  if (civic) { albedo = vec3(0.82, 0.81, 0.78) * (0.92 + 0.08 * fbm(vWPos.xy * 0.4 + vWPos.z * 0.3)); lit = 0.14; }   // City Hall's granite: columns, drum, porch (floodlit at night)
  if (lady) albedo = mix(trim, accent, step(0.55, fract(vCuv.x / 0.3)) * 0.85);   // dentils and brackets picked out
  albedo *= 0.88 + 0.12 * step(0.5, fract(vCuv.x / 0.3));
  rough = 0.6;
} else if (kind == ${K.awning}) {
  vec3 c = awnings[pal % 8];
  if (pal % 3 == 0) c = mix(c, vec3(0.93, 0.9, 0.84), step(0.5, fract(vCuv.x / 0.6)));
  albedo = c * (style == 1 ? 0.8 : 1.0);
  rough = 0.8;
} else if (kind == ${K.kit ?? -1}) {
  // Kit models (CC0, baked by city/kits.py): the colour rides in the style, palette and flags bytes (r, g, b).
  albedo = pow(vec3(vInfo.y, vInfo.z, vInfo.w) / 255.0, vec3(2.2)); rough = 0.7; metal = 0.0; bump = vec3(0.0);
} else if (kind == ${K.prop}) {
  // 0 poles and racks (painted steel), 1 lamp heads, 2 bench wood, 3 hydrants, 4-7 playground red, yellow, blue, green,
  // 10 the K-dock floats' weathered decking, 11 the cable car turntable's timber (the sea lions are data: city.sealions).
  albedo = style == 0 ? vec3(0.22, 0.24, 0.24) : style == 1 ? vec3(0.75, 0.74, 0.7) : style == 2 ? vec3(0.36, 0.25, 0.16) : style == 3 ? vec3(0.86, 0.85, 0.8)
    : style == 4 ? vec3(0.62, 0.1, 0.07) : style == 5 ? vec3(0.85, 0.6, 0.08) : style == 6 ? vec3(0.08, 0.28, 0.58) : style == 8 ? vec3(0.42, 0.2, 0.09) * (0.8 + 0.4 * fbm(vWPos.xy * 1.7 + vWPos.z)) : vec3(0.12, 0.42, 0.18);
  if (style == 10) albedo = vec3(0.47, 0.45, 0.41) * (0.8 + 0.12 * step(0.5, fract(vWPos.x * 3.0 + vWPos.y * 0.4)) + 0.15 * fbm(vWPos.xy * 0.9));
  if (style == 11) albedo = vec3(0.4, 0.27, 0.15) * (0.82 + 0.1 * step(0.5, fract(vWPos.x * 2.2)) + 0.15 * fbm(vWPos.xy * 1.3));
  // Pier 7 (city/pier7.py): 12 the railings', lamps' and benches' green cast iron, 13 the PIER 7 pillar's cream stone, 14 the toilet kiosk's green.
  if (style == 12) albedo = vec3(0.13, 0.2, 0.18) * (0.9 + 0.2 * fbm(vWPos.xy * 2.0 + vWPos.z));
  if (style == 13) albedo = vec3(0.84, 0.81, 0.73) * (0.92 + 0.1 * fbm(vWPos.xy * 3.0 + vWPos.z * 2.0));
  if (style == 14) albedo = vec3(0.11, 0.25, 0.19) * (0.9 + 0.12 * fbm(vec2(vWPos.x + vWPos.y, vWPos.z) * 0.8));
  if (style == 1) lit = 10.0;   // lamp heads: the lens glows like the park's
  rough = style == 2 || style == 10 || style == 11 || style == 13 ? 0.8 : 0.45; metal = style == 0 || style == 12 ? 0.5 : 0.0;
} else if (kind == ${K.shelter}) {
  // Muni shelter: 0 frame, 1 glass, 2 roof, 3 lit ad panel, 4 MUNI sign, 5 stop pole (yellow band).
  if (style == 0 || style == 2) { albedo = vec3(0.16, 0.17, 0.18); rough = 0.4; metal = 0.6; }
  else if (style == 1) { albedo = vec3(0.05, 0.06, 0.065); rough = 0.04; }
  else if (style == 3) { albedo = vec3(0.92, 0.9, 0.85) * (0.75 + 0.25 * step(0.5, fract(vCuv.y * 1.3))); rough = 0.3; lit = 1.2; }
  else if (style == 4) { albedo = mix(vec3(0.75, 0.2, 0.08), vec3(0.95, 0.93, 0.88), step(0.55, fract(vCuv.y / 0.6))); rough = 0.4; }
  else { albedo = (vCuv.y > 1.9 && vCuv.y < 2.25) ? vec3(0.95, 0.75, 0.1) : vec3(0.22, 0.24, 0.24); rough = 0.5; metal = 0.4; }
} else if (kind == ${K.water ?? -1}) {
  // The bay inside the city's extent (city_water, at the water line): dark, glassy, the sky in it.
  albedo = vec3(0.05, 0.10, 0.12) * (0.9 + 0.1 * fbm(vWPos.xy * 0.05)); rough = 0.06; metal = 0.0;
  bump = vec3(sin(vWPos.x * 0.9 + vWPos.y * 0.3), cos(vWPos.y * 0.7 - vWPos.x * 0.2), 0.0) * 0.03;
} else if (kind == ${K.tram}) {
  // Streetcars: 0 PCC in the 1940s green and cream, 1 LRV silver with a red band, 2 a Powell St cable car
  // (maroon below, cream above, the roof dark); windows and doors.
  float zv = vCuv.y, uu = vCuv.x;
  vec3 body = style == 0 ? (zv > 1.3 ? vec3(0.86, 0.82, 0.68) : vec3(0.2, 0.36, 0.25)) : (abs(zv - 1.25) < 0.12 ? vec3(0.72, 0.12, 0.1) : vec3(0.72, 0.73, 0.74));
  if (style == 2) body = zv > 1.25 ? (zv > 2.75 ? vec3(0.42, 0.1, 0.08) : vec3(0.88, 0.84, 0.7)) : vec3(0.48, 0.08, 0.07);
  float win = step(1.45, zv) * step(zv, 2.55) * step(0.18, abs(fract(uu / 1.25) - 0.5));
  albedo = mix(body, vec3(0.04, 0.05, 0.06), win);
  lit = win * 0.5;   // parked for the night, cabin lights on
  if (abs(wn.z) > 0.5) albedo = vec3(0.3, 0.31, 0.32);
  rough = win > 0.5 ? 0.05 : 0.35; metal = style == 1 && win < 0.5 ? 0.5 : 0.1;
} else if (kind == ${K.freeway}) {
  // Deck concrete (0 top, 1 underside, 2 sides and barriers, 3 columns and caps).
  layer = ${L('white_stucco')}; tuv = (abs(wn.z) > 0.5 ? vWPos.xy : vec2(vWPos.x + vWPos.y, vWPos.z)) / 3.0;
  vec3 tx = texture(cityDiff, vec3(tuv, layer)).rgb;
  albedo = vec3(0.52, 0.51, 0.49) * (lum(tx) / cityAvg[int(layer + 0.5)]) * (0.85 + 0.25 * fbm(vWPos.xy * 0.05 + vWPos.z));
  if (style == 1) albedo *= 0.55;
  rough = 0.9;
} else if (kind == ${K.roof}) {
  layer = ${L('tarred_gravel')}; tuv = vWPos.xy / 3.0;
  vec3 tx = texture(cityDiff, vec3(tuv, layer)).rgb;
  albedo = vec3(0.30, 0.30, 0.31) * (lum(tx) / cityAvg[int(layer + 0.5)]) * (0.8 + 0.4 * fbm(vWPos.xy * 0.1 + seed));
  if (style == 6) albedo = vec3(0.55, 0.28, 0.2) * (0.85 + 0.2 * fract(vWPos.y / 0.4));
  rough = 0.92;
  // City Hall's dome: lead-coated copper (7) and its gilded lantern, ribs and bands (8).
  if (style == 7) { albedo = vec3(0.27, 0.32, 0.31) * (0.85 + 0.2 * fbm(vWPos.xy * 0.4 + vWPos.z * 0.3)); rough = 0.45; metal = 0.35; lit = 0.3; }
  if (style == 8) { albedo = vec3(0.86, 0.64, 0.22); rough = 0.28; metal = 0.9; lit = 0.8; }
  if (style == 9) { albedo = vec3(0.93, 0.91, 0.84); rough = 0.4; lit = 1.6; }   // the Ferry Building's clock faces, lit at night
}
// Grounding: walls darken toward the pavement (the dirt and the sky they cannot see), so blocks sit on the street.
if (kind == ${K.wall} || kind == ${K.bay}) albedo *= 0.74 + 0.26 * smoothstep(-0.1, 1.6, v);
diffuseColor.rgb *= clamp(albedo, 0.0, 1.0);
float cityRough = rough, cityMetal = metal;
vec3 tang = normalize(vec3(-wn.y, wn.x, 0.0) + vec3(1e-5));
vec3 dn = normalize(wn + tang * bump.x + vec3(0.0, 0.0, 1.0) * bump.y * (1.0 - abs(wn.z)));`)
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = cityRough;')
        .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = cityMetal;')
        .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize((viewMatrix * vec4(dn, 0.0)).xyz);')
        // Night: lit windows and lenses glow (times glow, 0 by day), and the street lights light the walls.
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1.0, 0.8, 0.55) * lit * glow * 0.7;
totalEmissiveRadiance += diffuseColor.rgb * signGlow * glow * 1.6;
${lampGlsl('vWPos', 'wn')}`)
    }
    built.customProgramCacheKey = () => 'soma-city-built'

    const crown = lampLit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, map: leaves(), alphaTest: 0.45, side: THREE.DoubleSide }), 'soma-city-crown')
    const trunk = lampLit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), 'soma-city-trunk')   // colour per instance
    const palm = lampLit(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide }), 'soma-city-palm')
    const car = lampLit(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.35, side: THREE.DoubleSide }), 'soma-city-car')
    // Road paint is worn: scuffed toward the asphalt in soft patches and fine grit, and a little less saturated.
    const mark = lampLit(paintMaterial(THREE.MeshStandardMaterial, { roughness: 0.7 }), 'soma-city-mark', `
float wh(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float wn(vec2 x) { vec2 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(mix(wh(i), wh(i + vec2(1.0, 0.0)), f.x), mix(wh(i + vec2(0.0, 1.0)), wh(i + vec2(1.0, 1.0)), f.x), f.y); }`, `
float wear = smoothstep(0.45, 0.85, 0.65 * wn(vLampPos.xy * 0.7) + 0.35 * wn(vLampPos.xy * 3.1 + 5.0)) * 0.55 + 0.25 * wh(floor(vLampPos.xy * 40.0));
diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722))), diffuseColor.rgb, 0.8);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.045, 0.045, 0.047), clamp(wear, 0.0, 0.7));`)
    return { ground, built, mark, car, crown, trunk, palm }
  }

  private cullList: THREE.Mesh[] | null = null
  private fwd = new THREE.Vector3()

  /**
   * Hide tiles (and their trees and cars) whose nearest point is deeper than the fog's far end.
   * three.js fogs by view depth, so this only drops what is already pure fog colour; things
   * behind or beside the camera keep drawing (the frustum and the shadow camera handle those).
   */
  cull(camera: THREE.Camera, far: number, fog: THREE.Fog | null = null, heightFog = 0) {
    this.skyline?.update(fog, lampUniforms.glow.value, performance.now() / 1000, (camera as THREE.PerspectiveCamera).far ?? 600, heightFog)
    this.detail?.update(performance.now() / 1000, lampUniforms.glow.value)
    this.parked?.update(camera.position)
    const list = (this.cullList ??= [...this.groundMeshes, ...this.builtMeshes, ...this.markMeshes, ...this.treeMeshes, ...this.carMeshes])
    if (!Number.isFinite(far)) { for (const m of list) m.visible = true; this.culledAt.far = NaN; return }
    camera.getWorldDirection(this.fwd)
    const eye = camera.position, f = this.fwd
    // Only when the camera has moved a metre, turned a couple of degrees or the fog moved: it rarely does in a frame.
    const C = this.culledAt
    if (eye.distanceToSquared(C.eye) < 1 && f.dot(C.dir) > 0.9994 && Math.abs(far - C.far) < 0.5) return
    C.eye.copy(eye); C.dir.copy(f); C.far = far
    for (const m of list) {
      const s = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh).boundingSphere : m.geometry.boundingSphere
      if (!s) continue
      const depth = (s.center.x - eye.x) * f.x + (s.center.y - eye.y) * f.y + (s.center.z - eye.z) * f.z
      m.visible = depth - s.radius < far + 10
    }
  }

  dispose() {
    for (const m of [...this.groundMeshes, ...this.builtMeshes]) m.geometry.dispose()
  }
}

/** Smooth vertex normals (area-weighted face normals, as three's computeVertexNormals) straight on typed arrays. */
function vertexNormals(pos: Float32Array, idx: Uint32Array, nv: number): Float32Array {
  const acc = new Float64Array(nv * 3)
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3
    const cbx = pos[c] - pos[b], cby = pos[c + 1] - pos[b + 1], cbz = pos[c + 2] - pos[b + 2]
    const abx = pos[a] - pos[b], aby = pos[a + 1] - pos[b + 1], abz = pos[a + 2] - pos[b + 2]
    const nx = cby * abz - cbz * aby, ny = cbz * abx - cbx * abz, nz = cbx * aby - cby * abx
    acc[a] += nx; acc[a + 1] += ny; acc[a + 2] += nz
    acc[b] += nx; acc[b + 1] += ny; acc[b + 2] += nz
    acc[c] += nx; acc[c + 1] += ny; acc[c + 2] += nz
  }
  const out = new Float32Array(nv * 3)
  for (let v = 0; v < nv * 3; v += 3) {
    const l = Math.hypot(acc[v], acc[v + 1], acc[v + 2]) || 1
    out[v] = acc[v] / l; out[v + 1] = acc[v + 1] / l; out[v + 2] = acc[v + 2] / l
  }
  return out
}

const CAR_COLOURS = ['#e8e8e6', '#b9bcbf', '#6d7176', '#1c1d20', '#1f2f4f', '#8e1c1c', '#7d9bb5', '#2f4a3a', '#c9b99a', '#283550', '#3d4044', '#5a1f27']

// Candy paint: deep red, purple, teal, gold, midnight blue (24th St's lowriders, city.lowriders).
const LOWRIDER_COLOURS = ['#a3122a', '#5a2386', '#0e7d78', '#c08a1e', '#1b2d72']

/** A lowrider, 5.6 m long along +x, origin on the ground at its middle: a long low body (0.72 m),
 *  a low cabin set back (1.16 m), chrome trim along the sides and at both ends, small wheels with
 *  white walls. Vertex colours: the body white (painted per instance), glass dark, chrome light. */
function lowriderGeometry(): { paint: THREE.BufferGeometry; trim: THREE.BufferGeometry } {
  const parts = { paint: { pos: [] as number[], colr: [] as number[] }, trim: { pos: [] as number[], colr: [] as number[] } }
  let cur = parts.paint
  const pos = { push: (...v: number[]) => cur.pos.push(...v) }, colr = { push: (...v: number[]) => cur.colr.push(...v) }
  const quad = (a: number[], b: number[], c: number[], d: number[], k: number) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) colr.push(k, k, k) }
  const body = [[-2.8, 0.2], [2.8, 0.2], [2.8, 0.58], [2.25, 0.72], [-2.55, 0.74], [-2.8, 0.64]]
  const cab = [[0.7, 0.73], [0.0, 1.15], [-1.3, 1.16], [-1.75, 0.75]]
  const prism = (prof: number[][], w0: number, w1: number, k: number, kSide: number) => {
    const n = prof.length
    for (let i = 0; i < n; i++) {
      const [x0, z0] = prof[i], [x1, z1] = prof[(i + 1) % n]
      quad([x0, -w0, z0], [x1, -w0, z1], [x1, w0, z1], [x0, w0, z0], k)
    }
    for (const sy of [-1, 1]) {
      const w = sy * w1
      for (let i = 1; i < n - 1; i++) {
        const a = [prof[0][0], w, prof[0][1]], b = [prof[i][0], w, prof[i][1]], c = [prof[i + 1][0], w, prof[i + 1][1]]
        if (sy > 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c)
        for (let j = 0; j < 3; j++) colr.push(kSide, kSide, kSide)
      }
    }
  }
  prism(body, 1.0, 1.0, 1, 1)
  quad([0.0, -0.8, 1.155], [-1.25, -0.8, 1.165], [-1.25, 0.8, 1.165], [0.0, 0.8, 1.155], 1)   // the roof panel
  cur = parts.trim
  prism(cab, 0.86, 0.88, 0.07, 0.07)   // glass
  // Chrome: a strip down each side, the bumpers.
  for (const sy of [-1, 1]) {
    const y = sy * 1.005
    const a = [-2.75, y, 0.42], b = [2.75, y, 0.42], c = [2.75, y, 0.47], d = [-2.75, y, 0.47]
    if (sy > 0) quad(a, d, c, b, 0.85); else quad(a, b, c, d, 0.85)
  }
  for (const ex of [-2.81, 2.81]) {
    const sx = Math.sign(ex)
    const a = [ex, -1.02, 0.24], b = [ex, 1.02, 0.24], c = [ex, 1.02, 0.36], d = [ex, -1.02, 0.36]
    if (sx > 0) quad(a, b, c, d, 0.85); else quad(b, a, d, c, 0.85)
  }
  // Wheels: small, tucked under (the body sits low), white walls on their outer faces.
  for (const wx of [-1.85, 1.85]) for (const wy of [-0.86, 0.86]) {
    const x0 = wx - 0.32, x1 = wx + 0.32, y0 = wy - 0.1, y1 = wy + 0.1, z0 = 0.0, z1 = 0.6
    const out = wy > 0 ? y1 : y0
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], wy < 0 ? 0.04 : 0.04); quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], 0.04)
    quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], 0.04); quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 0.04)
    const r0 = 0.1, r1 = 0.22, cz = 0.3, yo = out + (wy > 0 ? 0.004 : -0.004)
    for (let k = 0; k < 8; k++) {
      const a0 = (k / 8) * Math.PI * 2, a1 = ((k + 1) / 8) * Math.PI * 2
      const p = (r: number, a: number) => [wx + r * Math.cos(a), yo, cz + r * Math.sin(a)]
      if (wy > 0) quad(p(r0, a0), p(r1, a0), p(r1, a1), p(r0, a1), 0.92); else quad(p(r0, a0), p(r0, a1), p(r1, a1), p(r1, a0), 0.92)
    }
  }
  // Lamps.
  for (const sy of [-0.7, 0.7]) {
    quad([2.805, sy - 0.18, 0.5], [2.805, sy + 0.18, 0.5], [2.805, sy + 0.18, 0.57], [2.805, sy - 0.18, 0.57], 0.92)
    quad([-2.805, sy + 0.18, 0.52], [-2.805, sy - 0.18, 0.52], [-2.805, sy - 0.18, 0.6], [-2.805, sy + 0.18, 0.6], 0.35)
  }
  const geo = (q: { pos: number[]; colr: number[] }) => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(q.pos, 3))
    g.setAttribute('color', new THREE.Float32BufferAttribute(q.colr, 3))
    g.computeVertexNormals()
    return g
  }
  return { paint: geo(parts.paint), trim: geo(parts.trim) }
}

/** A low-poly parked car, 4.4 m long along +x, origin on the ground at its middle. Vertex
 *  colours: white body (painted per instance), dark glass and tyres, light lamps. */
function carGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], colr: number[] = []
  const quad = (a: number[], b: number[], c: number[], d: number[], k: number) => { pos.push(...a, ...b, ...c, ...a, ...c, ...d); for (let i = 0; i < 6; i++) colr.push(k, k, k) }
  // Side profile (x, z) of the body and cabin, extruded across the width with sloped sides.
  const body = [[-2.2, 0.28], [2.2, 0.28], [2.2, 0.7], [1.6, 0.92], [-2.0, 0.95], [-2.2, 0.8]]
  const cab = [[1.05, 0.95], [0.25, 1.45], [-1.15, 1.47], [-1.75, 0.97]]
  const prism = (prof: number[][], w0: number, w1: number, k: number, kSide: number) => {
    const n = prof.length
    for (let i = 0; i < n; i++) {
      const [x0, z0] = prof[i], [x1, z1] = prof[(i + 1) % n]
      quad([x0, -w0, z0], [x1, -w0, z1], [x1, w0, z1], [x0, w0, z0], k)   // around the profile (top, ends)
    }
    for (const sy of [-1, 1]) {
      const w = sy * w1
      for (let i = 1; i < n - 1; i++) {   // side caps
        const a = [prof[0][0], w, prof[0][1]], b = [prof[i][0], w, prof[i][1]], c = [prof[i + 1][0], w, prof[i + 1][1]]
        if (sy > 0) pos.push(...a, ...c, ...b); else pos.push(...a, ...b, ...c)
        for (let j = 0; j < 3; j++) colr.push(kSide, kSide, kSide)
      }
    }
  }
  prism(body, 0.9, 0.9, 1, 1)
  prism(cab, 0.78, 0.8, 0.06, 0.06)
  // Roof panel over the glass, a little inset.
  quad([0.2, -0.72, 1.475], [-1.1, -0.72, 1.49], [-1.1, 0.72, 1.49], [0.2, 0.72, 1.475], 1)
  // Wheels: dark boxes under the body.
  for (const wx of [-1.4, 1.4]) for (const wy of [-0.8, 0.8]) {
    const x0 = wx - 0.33, x1 = wx + 0.33, y0 = wy - 0.11, y1 = wy + 0.11, z0 = 0.0, z1 = 0.62
    quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], 0.04); quad([x1, y1, z0], [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], 0.04)
    quad([x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], 0.04); quad([x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], 0.04)
  }
  // Lamps.
  for (const sy of [-0.6, 0.6]) {
    quad([2.205, sy - 0.2, 0.62], [2.205, sy + 0.2, 0.62], [2.205, sy + 0.2, 0.7], [2.205, sy - 0.2, 0.7], 0.95)
    quad([-2.205, sy + 0.2, 0.68], [-2.205, sy - 0.2, 0.68], [-2.205, sy - 0.2, 0.76], [-2.205, sy + 0.2, 0.76], 0.35)
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3))
  g.computeVertexNormals()
  return g
}

/**
 * Night: a plain standard material (instanced or not) lit by the nearest street lights too,
 * through the park's shared lamp chunk and the same uniform objects (src/client/real.ts).
 */
/** decl and color: extra GLSL (functions, then lines after the colour is known: diffuseColor, vLampPos) for this material. */
function lampLit(m: THREE.MeshStandardMaterial, key: string, decl = '', color = ''): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lampUniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampPos; varying vec3 vLampNrm;')
      .replace('#include <project_vertex>', `#include <project_vertex>
vec4 lampP = vec4(transformed, 1.0); vec3 lampN = objectNormal;
#ifdef USE_INSTANCING
lampP = instanceMatrix * lampP; lampN = mat3(instanceMatrix) * lampN;
#endif
vLampPos = (modelMatrix * lampP).xyz; vLampNrm = normalize(mat3(modelMatrix) * lampN);`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${LAMP_GLSL_DECL}
varying vec3 vLampPos; varying vec3 vLampNrm;
${decl}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
${color}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 lampNrm = normalize(vLampNrm) * (gl_FrontFacing ? 1.0 : -1.0);
${lampGlsl('vLampPos', 'lampNrm')}`)
  }
  m.customProgramCacheKey = () => key
  return m
}

/** Road paint: vertex colours, pulled toward the camera so it never fights the asphalt. */
function paintMaterial<T extends THREE.Material>(Ctor: new (p: Record<string, unknown>) => T, params: Record<string, unknown> = {}): T {
  return new Ctor({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, ...params })
}

/**
 * The leaf atlas (canvas, made once): one sprig per crown class, 3 x 2 tiles of 256 px on a
 * transparent ground (alpha-tested): twigs with leaves along them. 0 other broadleaf, 2 plane
 * (big lobed, light), 3 box-like evergreens (small, dark, glossy), 4 ficus (small oval, darkest),
 * 5 purple-leaf plum and cherries; tile 1 (palms use their own fronds) is a spare broadleaf.
 */
let leafTex: THREE.CanvasTexture | null = null
const LEAF_TILES = 3, LEAF_ROWS = 2
function leaves(): THREE.CanvasTexture {
  if (leafTex) return leafTex
  const T = 256
  const c = document.createElement('canvas')
  c.width = T * LEAF_TILES; c.height = T * LEAF_ROWS
  const g = c.getContext('2d')!
  let seed = 11
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  type Spec = { leaves: number; len: number; wid: number; base: number[]; lobed?: boolean; twigs: number }
  const specs: Record<number, Spec> = {
    0: { leaves: 120, len: 13, wid: 6, base: [74, 112, 50], twigs: 5 },
    1: { leaves: 120, len: 12, wid: 6, base: [82, 118, 56], twigs: 5 },
    2: { leaves: 46, len: 24, wid: 22, base: [112, 142, 62], lobed: true, twigs: 4 },
    3: { leaves: 190, len: 9, wid: 4.5, base: [52, 86, 42], twigs: 6 },
    4: { leaves: 210, len: 8, wid: 4.5, base: [40, 78, 38], twigs: 6 },
    5: { leaves: 130, len: 11, wid: 6, base: [112, 46, 62], twigs: 5 },
  }
  for (const [k, sp] of Object.entries(specs)) {
    const ox = (Number(k) % LEAF_TILES) * T, oy = Math.floor(Number(k) / LEAF_TILES) * T
    const cx = ox + T / 2, cy = oy + T / 2
    // Twigs from the tile's centre outwards, leaves along and around them.
    const twigs: number[][] = []
    for (let t = 0; t < sp.twigs; t++) {
      const a = (t / sp.twigs) * Math.PI * 2 + rnd() * 0.6, L = T * (0.3 + rnd() * 0.15)
      twigs.push([a, L])
      g.strokeStyle = 'rgba(70, 52, 38, 0.95)'; g.lineWidth = 2.2
      g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * L, cy + Math.sin(a) * L); g.stroke()
    }
    for (let n = 0; n < sp.leaves; n++) {
      const [a, L] = twigs[n % twigs.length]
      const along = 0.15 + rnd() * 0.85
      const off = (rnd() - 0.5) * T * 0.16
      const x = cx + Math.cos(a) * L * along - Math.sin(a) * off, y = cy + Math.sin(a) * L * along + Math.cos(a) * off
      if (Math.hypot(x - cx, y - cy) > T * 0.47) continue
      const shade = 0.72 + 0.5 * rnd()
      const [r0, g0, b0] = sp.base
      g.fillStyle = `rgb(${Math.min(255, Math.round(r0 * shade))}, ${Math.min(255, Math.round(g0 * shade))}, ${Math.min(255, Math.round(b0 * shade))})`
      const rot = a + (rnd() - 0.5) * 1.6
      g.save(); g.translate(x, y); g.rotate(rot)
      if (sp.lobed) {
        // A plane leaf: three to five pointed lobes.
        g.beginPath()
        for (let q = 0; q <= 10; q++) {
          const t = (q / 10) * Math.PI * 2, rr = sp.len * 0.5 * (0.55 + 0.45 * Math.abs(Math.cos(t * 2.5)))
          g.lineTo(Math.cos(t) * rr, Math.sin(t) * rr * (sp.wid / sp.len))
        }
        g.closePath(); g.fill()
      } else {
        g.beginPath(); g.ellipse(0, 0, sp.len * (0.7 + 0.5 * rnd()) / 2, sp.wid * (0.7 + 0.5 * rnd()) / 2, 0, 0, Math.PI * 2); g.fill()
        // A glossy highlight on the evergreens.
        if (Number(k) === 3 || Number(k) === 4) { g.fillStyle = 'rgba(210, 230, 190, 0.18)'; g.beginPath(); g.ellipse(-1, -1, sp.len * 0.22, sp.wid * 0.18, 0, 0, Math.PI * 2); g.fill() }
      }
      g.restore()
    }
  }
  leafTex = new THREE.CanvasTexture(c)
  leafTex.colorSpace = THREE.SRGBColorSpace
  leafTex.anisotropy = 4
  return leafTex
}

/**
 * A crown of leaf cards for crown class k (radius 1, centred): sprig cards through an
 * ellipsoid, denser at the shell, each card facing roughly outwards; normals lean to the
 * radial direction so the crown shades as a volume, not as flat cards.
 */
function leafCrown(k: number): THREE.BufferGeometry {
  const shape: Record<number, { cards: number; z: number; size: number; flat?: number }> = {
    0: { cards: 64, z: 0.9, size: 0.66 }, 2: { cards: 56, z: 0.82, size: 0.84 }, 3: { cards: 72, z: 1.0, size: 0.6 },
    4: { cards: 74, z: 0.66, size: 0.62, flat: 0.25 }, 5: { cards: 52, z: 0.85, size: 0.66 },
  }
  const sp = shape[k] ?? shape[0]
  const pos: number[] = [], uv: number[] = [], nrm: number[] = []
  let seed = 101 + k * 17
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 }
  const tile = k === 1 ? 1 : k
  const u0 = (tile % LEAF_TILES) / LEAF_TILES, v0 = 1 - (Math.floor(tile / LEAF_TILES) + 1) / LEAF_ROWS
  const du = 1 / LEAF_TILES, dv = 1 / LEAF_ROWS
  for (let i = 0; i < sp.cards; i++) {
    // A point in the crown, mostly near the shell.
    const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1)
    const r = 0.45 + 0.55 * Math.pow(rnd(), 0.5)
    let c = [Math.sin(ph) * Math.cos(th) * r, Math.sin(ph) * Math.sin(th) * r, Math.cos(ph) * r * sp.z]
    if (sp.flat && c[2] > sp.z * 0.45) c[2] = sp.z * 0.45 + (c[2] - sp.z * 0.45) * sp.flat   // ficus: a flat top
    const radial = (() => { const l = Math.hypot(c[0], c[1], c[2] / sp.z) || 1; return [c[0] / l, c[1] / l, c[2] / sp.z / l] })()
    // Card axes: across the radial direction, with a random twist and tilt.
    const up = Math.abs(radial[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1]
    let ax = [radial[1] * up[2] - radial[2] * up[1], radial[2] * up[0] - radial[0] * up[2], radial[0] * up[1] - radial[1] * up[0]]
    let al = Math.hypot(ax[0], ax[1], ax[2]) || 1; ax = ax.map((v) => v / al)
    let ay = [radial[1] * ax[2] - radial[2] * ax[1], radial[2] * ax[0] - radial[0] * ax[2], radial[0] * ax[1] - radial[1] * ax[0]]
    const tw = rnd() * Math.PI * 2, ct = Math.cos(tw), st = Math.sin(tw)
    const ax2 = ax.map((v, q) => v * ct + ay[q] * st), ay2 = ax.map((v, q) => -v * st + ay[q] * ct)
    const sz = sp.size * (0.8 + rnd() * 0.45)
    const n = radial.map((v, q) => v * 0.75 + (ax2[(q + 1) % 3] * ay2[(q + 2) % 3] - ax2[(q + 2) % 3] * ay2[(q + 1) % 3]) * 0.25)
    const nl = Math.hypot(n[0], n[1], n[2]) || 1
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, -1], [1, 1], [-1, 1]]) {
      pos.push(c[0] + (ax2[0] * a + ay2[0] * b) * sz, c[1] + (ax2[1] * a + ay2[1] * b) * sz, c[2] + (ax2[2] * a + ay2[2] * b) * sz)
      uv.push(u0 + ((a + 1) / 2) * du, v0 + ((b + 1) / 2) * dv)
      nrm.push(n[0] / nl, n[1] / nl, n[2] / nl)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  g.userData.kind = 'crown'
  return g
}

/** Three branches from the top of the trunk up into the crown (unit crown space, trunk top at 0). */
function crownBranches(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = []
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.4
    const b = new THREE.CylinderGeometry(0.035, 0.07, 0.95, 5, 1, true).translate(0, 0.475, 0)
    b.rotateZ(-0.7).rotateY(a)   // leaning out
    b.rotateX(Math.PI / 2)       // y up -> z up
    parts.push(b)
  }
  const g = mergeGeometries(parts)
  g.userData.kind = 'branch'
  return g
}

/** Palm fronds: eighteen blades around the top of the trunk, some up, some drooping. */
function palmCrown(): THREE.BufferGeometry {
  const pos: number[] = []
  const N = 18
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + (i % 2) * 0.17
    const tilt = (i % 3) * 0.25   // some fronds stand up, some droop
    const dx = Math.cos(a), dy = Math.sin(a), sx = -dy * 0.42, sy = dx * 0.42
    const pts = [[0, 0, 0], [1.5, 0, 0.6 + tilt], [3.0, 0, 0.35 + tilt], [4.3, 0, -0.7 + tilt * 0.5]]
    for (let k = 0; k < pts.length - 1; k++) {
      const [r0, , z0] = pts[k], [r1, , z1] = pts[k + 1]
      const w0 = k === 0 ? 0.05 : 1 - k / 3, w1 = 1 - (k + 1) / 3
      const A = [dx * r0 - sx * w0, dy * r0 - sy * w0, z0], B = [dx * r0 + sx * w0, dy * r0 + sy * w0, z0]
      const C = [dx * r1 + sx * w1, dy * r1 + sy * w1, z1], D = [dx * r1 - sx * w1, dy * r1 - sy * w1, z1]
      pos.push(...A, ...B, ...C, ...A, ...C, ...D)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.computeVertexNormals()
  g.userData.kind = 'palm'
  return g
}
