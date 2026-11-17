import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { raycast, type Park } from '../sim/park/park.ts'
import { applyMaterials, toonify } from './look.ts'
import { LAMP_GLSL_DECL, lampGlsl, lampUniforms } from './real.ts'
import type { VignetteDef } from './vignettes.ts'

// The interiors' dressing (data/interiors.json) over the city's rooms (city.interiors: Fog City Skate Shop, Taqueria
// La Niebla, Suds City Laundromat, Valencia Corner Market, the City Hall lobby). Draw-only and never in the sim: the
// city export's collision is untouched. Each room gets a floor (wood, tiles, marble) and, where it is too dark, a
// ceiling; rugs; light fixtures with their glowing lamps and pools of warm light on the floor (stronger at night, when
// the street-light chunk lights the props too); readable signs and menu boards; small props built here (stickers on the
// shop counter, griptape, a salsa bar, laundry baskets, a fruit display, a velvet rope); and people, who join the crowd
// as small vignettes standing on the room's floor (vignettes()). A room's dressing is merged by material (a dozen draw
// calls) and only drawn within drawDistance of the camera.

export type InteriorRoom = { id: string; name: string; kind: string; door: number[]; inward: number; floor: number; height: number; polygon: number[][]; anchors: Record<string, number[]> }
type Place = { at?: string; frame?: 'room'; off?: [number, number]; z?: number; face?: number; onTop?: boolean; wall?: number; wallZ?: number }
type Sign = Place & { kind: 'neon' | 'board' | 'chalk' | 'led'; w: number; h: number; text: string[]; color: string; bg?: string; stand?: boolean; double?: boolean }
type RoomDress = {
  floor?: { kind: 'wood' | 'checker' | 'marble' | 'terrazzo'; colors: string[]; tile: number }
  ceiling?: { color: string; beams?: string }
  rugs?: (Place & { w: number; h: number; colors: string[]; runner?: boolean })[]
  lights?: (Place & { kind: 'pendant' | 'tube' | 'spot' | 'chandelier' | 'sconce'; color: string })[]
  signs?: Sign[]
  props?: (Place & { kind: string; colors?: string[]; length?: number; spacing?: number })[]
  people?: (Place & { type: string; act: string; seat?: number })[]
}
export type InteriorsData = { drawDistance: number; pool: { day: number; night: number }; lampGain: number; indoorLampReach: number; indoorBloom: number; rooms: Record<string, RoomDress> }

type Mat = THREE.Material
type Placed = { x: number; y: number; z: number; h: number }   // world point and compass heading (degrees)
const DEG = Math.PI / 180
/** The street lights' share of an interior surface's night light (data lampGain): the room's own fixtures carry it. */
const LAMP_GAIN = { value: 0.3 }

/** Whether x, y is inside a polygon ([x, y] points; even-odd). */
export function insidePolygon(P: number[][], x: number, y: number): boolean {
  let c = false
  for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c }
  return c
}

/** A standard material lit by the street lights at night too (the city's chunk), with a Lambert twin for the grey look. */
function surfaceLit(color: string | number, o: { map?: THREE.Texture | null; rough?: number; metal?: number; emissive?: string; emissiveIntensity?: number; side?: THREE.Side; transparent?: boolean; poly?: boolean; vertex?: boolean } = {}): THREE.MeshLambertMaterial {
  const base = { color: o.map ? 0xffffff : color, map: o.map ?? null, side: o.side ?? THREE.FrontSide, transparent: !!o.transparent, vertexColors: !!o.vertex, ...(o.poly ? { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 } : {}) }
  const l = new THREE.MeshLambertMaterial({ ...base, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1 })
  const s = new THREE.MeshStandardMaterial({ ...base, roughness: o.rough ?? 0.8, metalness: o.metal ?? 0, emissive: o.emissive ?? 0x000000, emissiveIntensity: o.emissiveIntensity ?? 1 })
  s.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lampUniforms, { lampGain: LAMP_GAIN })
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vLampPos; varying vec3 vLampNrm;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvLampPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vLampNrm = normalize(mat3(modelMatrix) * objectNormal);')
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>\n${LAMP_GLSL_DECL}\nuniform float lampGain; varying vec3 vLampPos; varying vec3 vLampNrm;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\nvec3 lampNrm = normalize(vLampNrm) * (gl_FrontFacing ? 1.0 : -1.0);\nvec3 preLamp = totalEmissiveRadiance;\n${lampGlsl('vLampPos', 'lampNrm')}\ntotalEmissiveRadiance = preLamp + (totalEmissiveRadiance - preLamp) * lampGain;`)
  }
  s.customProgramCacheKey = () => 'soma-interior-lit'
  l.userData.real = s
  return l
}
/** A glowing material (lamps, neon, the cooler's light): the same in every look. */
const glowing = (color: string, o: { map?: THREE.Texture; transparent?: boolean; additive?: boolean; opacity?: number } = {}) => {
  const m = new THREE.MeshBasicMaterial({ color, map: o.map ?? null, transparent: !!o.transparent || !!o.additive, opacity: o.opacity ?? 1, depthWrite: !(o.transparent || o.additive), blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false, side: THREE.DoubleSide })
  m.userData.glow = true
  return m
}

// ---------------------------------------------------------------- textures

const canvas = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c }
/** Without a page (tests in node) the painted textures are a plain white texel. */
const painted = typeof document !== 'undefined'
const blank = () => new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1)
function hash(i: number) { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x) }

function floorTexture(f: NonNullable<RoomDress['floor']>): THREE.Texture {
  if (!painted) return blank()
  const N = 256, c = canvas(N, N), g = c.getContext('2d')!
  const C = f.colors
  if (f.kind === 'wood') {
    // Planks: rows of boards of random lengths and tints, dark seams, grain streaks.
    const rows = 8, rh = N / rows
    for (let r = 0; r < rows; r++) {
      let x = -hash(r) * 120
      for (let k = 0; x < N; k++) {
        const len = 70 + hash(r * 31 + k) * 110, col = C[Math.floor(hash(r * 7 + k * 3) * C.length)]
        g.fillStyle = col; g.fillRect(x, r * rh, len, rh)
        g.globalAlpha = 0.12
        for (let s = 0; s < 5; s++) { g.fillStyle = s % 2 ? '#000' : '#fff'; g.fillRect(x, r * rh + hash(r + k + s * 5) * rh, len, 1 + hash(s + k) * 1.5) }
        g.globalAlpha = 1
        g.fillStyle = 'rgba(30,18,8,0.55)'; g.fillRect(x, r * rh, 2, rh)
        x += len
      }
      g.fillStyle = 'rgba(30,18,8,0.5)'; g.fillRect(0, r * rh, N, 2)
    }
  } else if (f.kind === 'checker' || f.kind === 'marble') {
    const n = 4, s = N / n
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      g.fillStyle = C[(x + y) % 2]; g.fillRect(x * s, y * s, s, s)
      if (f.kind === 'marble') {
        // Veins: thin pale and dark wandering lines.
        g.strokeStyle = (x + y) % 2 ? 'rgba(255,255,255,0.35)' : 'rgba(80,70,60,0.18)'; g.lineWidth = 1.2
        g.beginPath(); let px = x * s, py = y * s + hash(x * 9 + y) * s
        g.moveTo(px, py)
        for (let k = 1; k <= 8; k++) { px = x * s + (k / 8) * s; py += (hash(x + y * 3 + k) - 0.5) * s * 0.3; g.lineTo(px, py) }
        g.stroke()
      }
    }
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 2
    for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * s, 0); g.lineTo(k * s, N); g.stroke(); g.beginPath(); g.moveTo(0, k * s); g.lineTo(N, k * s); g.stroke() }
  } else {
    g.fillStyle = C[0]; g.fillRect(0, 0, N, N)
    for (let i = 0; i < 900; i++) { g.fillStyle = C[1 + (i % (C.length - 1))]; const r = 1 + hash(i) * 2.2; g.fillRect(hash(i * 3) * N, hash(i * 7) * N, r, r) }
  }
  const t = new THREE.CanvasTexture(c)
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
  return t
}

function rugTexture(colors: string[], runner: boolean): THREE.Texture {
  if (!painted) return blank()
  const W = 256, H = runner ? 1024 : 160, c = canvas(W, H), g = c.getContext('2d')!
  g.fillStyle = colors[0]; g.fillRect(0, 0, W, H)
  g.fillStyle = colors[1]; const b = runner ? 22 : 16
  g.fillRect(b, b, W - 2 * b, 6); g.fillRect(b, H - b - 6, W - 2 * b, 6); g.fillRect(b, b, 6, H - 2 * b); g.fillRect(W - b - 6, b, 6, H - 2 * b)
  g.fillStyle = colors[2] ?? colors[1]
  if (!runner) for (let i = 0; i < 6; i++) { g.save(); g.translate(W * (0.2 + 0.12 * i), H / 2); g.rotate(Math.PI / 4); g.fillRect(-9, -9, 18, 18); g.restore() }
  else for (let y = 60; y < H - 60; y += 70) { g.save(); g.translate(W / 2, y); g.rotate(Math.PI / 4); g.fillRect(-14, -14, 28, 28); g.restore() }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** A sign's face: lines of text on its board (neon glows on nothing; LED digits on black). Null without a page. */
function signCanvas(s: Sign): HTMLCanvasElement | null {
  if (!painted) return null
  const W = 512, H = Math.max(64, Math.round((512 * s.h) / s.w)), c = canvas(W, H), g = c.getContext('2d')!
  if (s.kind !== 'neon') { g.fillStyle = s.bg ?? '#1f1f22'; g.fillRect(0, 0, W, H) }
  if (s.kind === 'chalk') { g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 300; i++) g.fillRect(hash(i) * W, hash(i * 3) * H, 2, 1) }
  if (s.kind === 'board') { g.strokeStyle = s.color; g.lineWidth = 6; g.strokeRect(8, 8, W - 16, H - 16) }
  const n = s.text.length, lh = (H - 24) / n
  const font = s.kind === 'chalk' ? 'italic 500' : s.kind === 'led' ? '700' : 'italic 700'
  s.text.forEach((line, i) => {
    let fs = Math.min(lh * 0.78, 120)
    g.font = `${font} ${fs}px Inter, Helvetica, sans-serif`
    while (g.measureText(line).width > W - 36 && fs > 10) { fs *= 0.92; g.font = `${font} ${fs}px Inter, Helvetica, sans-serif` }
    const y = 12 + lh * (i + 0.5) + fs * 0.33
    g.textAlign = s.kind === 'chalk' && n > 2 ? 'left' : 'center'
    const x = g.textAlign === 'left' ? 24 : W / 2
    if (s.kind === 'neon' || s.kind === 'led') { g.shadowColor = s.color; g.shadowBlur = s.kind === 'neon' ? 22 : 8; g.fillStyle = s.color; g.fillText(line, x, y); g.shadowBlur = 0; g.fillStyle = s.kind === 'neon' ? '#ffffff' : s.color; g.globalAlpha = s.kind === 'neon' ? 0.85 : 1; g.fillText(line, x, y); g.globalAlpha = 1 }
    else { g.fillStyle = s.color; g.fillText(line, x, y) }
  })
  return c
}

/**
 * A room's signs of one kind in one mesh: their faces stacked in one texture (512 wide, scaled down to fit 4096
 * tall), each plane's uvs pointing at its own strip. planes: the sign, its plane's world matrix.
 */
function signAtlas(planes: { s: Sign; m: THREE.Matrix4 }[], material: (t: THREE.Texture) => THREE.Material): THREE.Mesh | null {
  if (!planes.length) return null
  const cs = planes.map(({ s }) => signCanvas(s)), W = 512
  const total = cs.reduce((n, c, i) => n + (c ? c.height : Math.round((W * planes[i].s.h) / planes[i].s.w)), 0), f = Math.min(1, 4096 / total)
  const AH = Math.max(1, Math.ceil(total * f))
  let tex: THREE.Texture = blank()
  if (painted) {
    const a = canvas(Math.ceil(W * f), AH), g = a.getContext('2d')!
    let y = 0
    for (const c of cs) { if (c) { g.drawImage(c, 0, y, W * f, c.height * f); y += c.height * f } }
    const t = new THREE.CanvasTexture(a); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4
    tex = t
  }
  const geos: THREE.BufferGeometry[] = []
  let y0 = 0
  planes.forEach(({ s, m }, i) => {
    const hs = (cs[i]?.height ?? Math.round((W * s.h) / s.w)) * f
    const geo = new THREE.PlaneGeometry(s.w, s.h), uv = geo.attributes.uv as THREE.BufferAttribute
    for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k), 1 - (y0 + (1 - uv.getY(k)) * hs) / AH)
    y0 += hs
    geos.push(geo.applyMatrix4(m))
  })
  const merged = mergeGeometries(geos.map((x) => x.toNonIndexed()))
  return merged ? new THREE.Mesh(merged, material(tex)) : null
}

function stickerTexture(): THREE.Texture {
  if (!painted) return blank()
  const W = 256, H = 128, c = canvas(W, H), g = c.getContext('2d')!
  g.fillStyle = '#a9784a'; g.fillRect(0, 0, W, H)
  const cols = ['#e8642a', '#2a9a9a', '#f2c84a', '#f4efe0', '#d8352a', '#1f1f22', '#f28ab4', '#8fd23a']
  for (let i = 0; i < 46; i++) {
    const x = hash(i) * W, y = hash(i * 5) * H, s = 10 + hash(i * 9) * 22
    g.save(); g.translate(x, y); g.rotate((hash(i * 13) - 0.5) * 1.2)
    g.fillStyle = '#fbfaf3'; g.fillRect(-s / 2 - 2, -s / 3 - 2, s + 4, s * 0.66 + 4)
    g.fillStyle = cols[i % cols.length]
    if (i % 3 === 0) { g.beginPath(); g.arc(0, 0, s / 2.4, 0, Math.PI * 2); g.fill() } else g.fillRect(-s / 2, -s / 3, s, s * 0.66)
    if (i % 4 === 1) { g.fillStyle = '#fbfaf3'; g.font = `700 ${s * 0.35}px Helvetica`; g.textAlign = 'center'; g.fillText(['SK8', 'FOG', 'SF', '415', 'GNAR'][i % 5], 0, s * 0.12) }
    g.restore()
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace
  return t
}

let poolTex: THREE.Texture | null = null
function poolTexture(): THREE.Texture {
  if (poolTex) return poolTex
  if (!painted) return (poolTex = blank())
  const N = 128, c = canvas(N, N), g = c.getContext('2d')!
  const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2)
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = gr; g.fillRect(0, 0, N, N)
  poolTex = new THREE.CanvasTexture(c)
  return poolTex
}

// ---------------------------------------------------------------- the builder

/** Geometry gathered per material for one room, merged at the end. */
class Bin {
  private by = new Map<Mat, THREE.BufferGeometry[]>()
  add(mat: Mat, geo: THREE.BufferGeometry, m: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone()
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv' && k !== 'color') g.deleteAttribute(k)
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2))
    if (!g.attributes.normal) g.computeVertexNormals()
    g = g.applyMatrix4(m)
    if (!this.by.has(mat)) this.by.set(mat, [])
    this.by.get(mat)!.push(g)
  }
  meshes(): THREE.Mesh[] {
    // Plain painted parts (mat(): a colour, a roughness, a metalness) merge across colours: one mesh per finish,
    // the colour per vertex (a room's few dozen colours in a handful of draw calls).
    const paint = new Map<string, THREE.Material>()
    for (const [mat, list] of [...this.by]) {
      const f = mat.userData.paint as { rough: number; metal: number } | undefined
      if (!f && !mat.userData.lamp) continue
      const key = f ? `${f.rough}:${f.metal}` : 'lamp'
      let pm = paint.get(key)
      if (!pm) {
        if (f) pm = surfaceLit(0xffffff, { rough: f.rough, metal: f.metal, vertex: true })
        else { pm = glowing('#ffffff'); (pm as THREE.MeshBasicMaterial).vertexColors = true }
        paint.set(key, pm); this.by.set(pm, [])
      }
      const c = (mat as THREE.MeshLambertMaterial).color
      for (const g of list) { const n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3); g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3)) }
      this.by.get(pm)!.push(...list)
      this.by.delete(mat)
    }
    const out: THREE.Mesh[] = []
    for (const [mat, list] of this.by) {
      const withColor = list.some((g) => g.attributes.color)
      if (withColor) for (const g of list) if (!g.attributes.color) { const n = g.attributes.position.count; g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3)) }
      const geo = mergeGeometries(list)
      if (!geo) continue
      const mesh = new THREE.Mesh(geo, mat)
      mesh.castShadow = false   // under the room's own roof: no sun to cast from (and half the draw calls)
      mesh.receiveShadow = !mat.userData.glow
      out.push(mesh)
    }
    return out
  }
}

/** A room's local frame: a point and heading (compass degrees) to place things from. */
const M = (p: Placed, x: number, y: number, z: number, rotZ = 0, s: [number, number, number] = [1, 1, 1]) => {
  const h = -p.h * DEG, c = Math.cos(h), sn = Math.sin(h)
  return new THREE.Matrix4().compose(new THREE.Vector3(p.x + x * c - y * sn, p.y + x * sn + y * c, p.z + z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), h + rotZ), new THREE.Vector3(...s))
}
const box = (w: number, d: number, h: number) => new THREE.BoxGeometry(w, d, h).translate(0, 0, h / 2)
const cyl = (r: number, h: number, n = 12, r2 = r) => new THREE.CylinderGeometry(r, r2, h, n).rotateX(Math.PI / 2).translate(0, 0, h / 2)
const ball = (r: number, n = 10) => new THREE.SphereGeometry(r, n, Math.max(6, Math.round(n * 0.7)))

/** The props interiors.ts builds (data/interiors.json props[].kind). */
export const INTERIOR_PROPS = ['stickers', 'griptape', 'register', 'wheelDisplay', 'shoeBoxes', 'bench', 'salsaBar', 'aguas', 'papel', 'napkins', 'basket', 'folded', 'changer', 'plant', 'socks', 'fruit', 'cooler', 'snacks', 'portholes', 'apparel', 'chairs', 'wetFloor', 'velvet']

export class Interiors {
  readonly group = Object.assign(new THREE.Group(), { name: 'interiors' })
  private rooms: { r: InteriorRoom; g: THREE.Group; c: THREE.Vector3; pools: THREE.MeshBasicMaterial[] }[] = []
  private d: InteriorsData
  private park: Park
  private style = ''
  private people: VignetteDef[] = []
  private night = -1

  constructor(rooms: InteriorRoom[], d: InteriorsData, park: Park, gradient: THREE.Texture | null) {
    this.d = d; this.park = park
    LAMP_GAIN.value = d.lampGain ?? 0.3
    for (const r of rooms) {
      const dress = d.rooms[r.kind]
      if (!dress) continue
      const g = new THREE.Group(); g.name = `interior:${r.id}`
      const pools: THREE.MeshBasicMaterial[] = []
      this.build(r, dress, g, pools)
      if (gradient) toonify(g, gradient)
      g.traverse((o) => { const m = (o as THREE.Mesh).material as Mat | undefined; if (m?.userData.glow) o.userData.looks = { grey: m, cute: m, real: m } })
      const c = r.polygon.reduce((a, p) => a.add(new THREE.Vector3(p[0], p[1], r.floor)), new THREE.Vector3()).divideScalar(r.polygon.length)
      g.visible = false
      this.group.add(g)
      this.rooms.push({ r, g, c, pools })
    }
  }

  /**
   * The night lamps with those inside a room reaching only indoorLampReach metres: at a street light's reach two
   * ceiling lamps light a small room's walls several times over and the bloom hazes it; the dressing's own fixtures
   * and pools light the room instead.
   */
  indoorLamps<T extends { x: number; y: number; z: number; r: number }>(lamps: T[]): T[] {
    const inRoom = (l: T) => this.rooms.some(({ r }) => l.z > r.floor - 0.5 && l.z < r.floor + r.height + 0.5 && insidePolygon(r.polygon, l.x, l.y))
    return lamps.map((l) => (inRoom(l) ? { ...l, r: Math.min(l.r, this.d.indoorLampReach ?? 5) } : l))
  }

  /** The ceiling's height over a point inside a room (the camera stays under it: the collision has no ceilings), else null. */
  ceilingAt(x: number, y: number, z: number): number | null {
    for (const { r } of this.rooms) if (z > r.floor - 0.5 && z < r.floor + r.height && insidePolygon(r.polygon, x, y)) return r.floor + r.height - 0.05
    return null
  }

  /** The rooms' people, as vignettes for the crowd (on their room's floor). */
  vignettes(): VignetteDef[] { return this.people }

  /** Built rooms (tests, the perf probe): id and the dressing's meshes. */
  get stats(): { id: string; meshes: number; shown: boolean }[] { return this.rooms.map((x) => { let n = 0; x.g.traverse((o) => { if ((o as THREE.Mesh).isMesh) n++ }); return { id: x.r.id, meshes: n, shown: x.g.visible } }) }

  /** A placement in a room: world point (z the floor, or the top of what is below for onTop) and heading. */
  place(r: InteriorRoom, p: Place): Placed {
    const a = p.frame === 'room' || !p.at ? null : r.anchors[p.at]
    const bx = a ? a[0] : r.door[0], by = a ? a[1] : r.door[1], h = a ? a[3] : r.inward
    const fx = Math.sin(h * DEG), fy = Math.cos(h * DEG), [ri, ah] = p.off ?? [0, 0]
    const x = bx + fy * ri + fx * ah, y = by - fx * ri + fy * ah
    let z = r.floor + (p.z ?? 0)
    const face = h + (p.face ?? 0)
    if (p.wall !== undefined) {
      // Back against the wall behind it (the way it faces, reversed), at its own height.
      const bx2 = -Math.sin(face * DEG), by2 = -Math.cos(face * DEG)
      const hit = raycast(this.park, { x, y, z: p.wallZ !== undefined ? r.floor + p.wallZ : z + 0.05 }, { x: bx2, y: by2, z: 0 }, 6)
      if (hit) { const d = Math.hypot(hit.point.x - x, hit.point.y - y) - p.wall; return { x: x + bx2 * d, y: y + by2 * d, z, h: face } }
    }
    if (p.onTop) {
      const hit = raycast(this.park, { x, y, z: r.floor + Math.min(r.height - 0.3, 2.2) }, { x: 0, y: 0, z: -1 }, 3)
      z = hit ? hit.point.z : r.floor + 0.9
    }
    return { x, y, z, h: face }
  }

  private build(r: InteriorRoom, D: RoomDress, g: THREE.Group, pools: THREE.MeshBasicMaterial[]) {
    const bin = new Bin(), mats = new Map<string, THREE.MeshLambertMaterial>()
    // Painted parts: three finishes (matte, satin, metal), merged across colours by Bin.
    const mat = (c: string, rough = 0.8, metal = 0) => { const k = `${c}:${rough}:${metal}`; let m = mats.get(k); if (!m) { m = surfaceLit(c, { rough, metal }); m.userData.paint = metal >= 0.3 ? { rough: 0.35, metal: 0.8 } : rough >= 0.7 ? { rough: 0.85, metal: 0 } : { rough: 0.45, metal: 0 }; mats.set(k, m) } return m }
    const glow = new Map<string, THREE.MeshBasicMaterial>()
    const lamp = (c: string) => { let m = glow.get(c); if (!m) { m = glowing(c); m.userData.lamp = true; glow.set(c, m) } return m }
    // The room's polygon, cleaned (the city's corner store has runs of near-duplicate points).
    const pts: THREE.Vector2[] = []
    for (const p of r.polygon) { const v = new THREE.Vector2(p[0], p[1]); if (!pts.length || pts[pts.length - 1].distanceTo(v) > 0.05) pts.push(v) }
    if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < 0.05) pts.pop()
    const inw = r.inward * DEG, ux = Math.sin(inw), uy = Math.cos(inw)
    const slab = (z: number, down: boolean, material: Mat, tile: number) => {
      const geo = new THREE.ShapeGeometry(new THREE.Shape(pts))
      const P = geo.attributes.position as THREE.BufferAttribute, uv = new Float32Array(P.count * 2)
      for (let i = 0; i < P.count; i++) {
        const X = P.getX(i) - r.door[0], Y = P.getY(i) - r.door[1]
        uv[i * 2] = (X * uy - Y * ux) / tile / 4; uv[i * 2 + 1] = (X * ux + Y * uy) / tile / 4
        P.setZ(i, z)
      }
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
      if (down && geo.index) geo.setIndex(Array.from(geo.index.array).reverse())   // facing down: each triangle wound the other way
      geo.computeVertexNormals()
      const mesh = new THREE.Mesh(geo, material); mesh.receiveShadow = true
      g.add(mesh)
    }
    if (D.floor) slab(r.floor + 0.006, false, surfaceLit(0xffffff, { map: floorTexture(D.floor), rough: D.floor.kind === 'marble' ? 0.35 : 0.75, poly: true }), D.floor.tile)
    if (D.ceiling) {
      slab(r.floor + r.height - 0.03, true, surfaceLit(D.ceiling.color, { rough: 0.9, side: THREE.DoubleSide }), 1)
      if (D.ceiling.beams) {
        // Exposed beams across the room every 1.6 m.
        const depth = Math.max(...r.polygon.map((p) => (p[0] - r.door[0]) * ux + (p[1] - r.door[1]) * uy))
        const sides = r.polygon.map((p) => (p[0] - r.door[0]) * uy - (p[1] - r.door[1]) * ux), r0 = Math.min(...sides), r1 = Math.max(...sides)
        const base: Placed = { x: r.door[0], y: r.door[1], z: r.floor + r.height - 0.03, h: r.inward }
        for (let a = 1.2; a < depth - 0.4; a += 1.6) bin.add(mat(D.ceiling.beams, 0.85), new THREE.BoxGeometry(r1 - r0 - 0.1, 0.14, 0.2).translate((r0 + r1) / 2, 0, -0.1), M(base, 0, a, 0))
      }
    }
    for (const rg of D.rugs ?? []) {
      const p = this.place(r, rg)
      const m = surfaceLit(0xffffff, { map: rugTexture(rg.colors, !!rg.runner), rough: 0.95, poly: true })
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(rg.w, rg.h), m)
      mesh.applyMatrix4(M(p, 0, 0, 0.012)); mesh.receiveShadow = true
      g.add(mesh)
    }
    // Lights: the fixture, its glowing lamp, and a pool of light on the floor under it (and a glow round the lamp).
    const poolGeos: THREE.BufferGeometry[] = []
    for (const L of D.lights ?? []) {
      const p = this.place(r, { ...L, z: Math.min(L.z ?? r.height - 0.4, r.height - 0.05) })
      const dark = mat('#2a2b2e', 0.5, 0.4), brass = mat('#c8a04a', 0.35, 0.8)
      let radius = 1.6, stretch = 1
      if (L.kind === 'pendant') {
        const cord = r.floor + r.height - p.z
        bin.add(dark, cyl(0.006, cord), M(p, 0, 0, 0))
        bin.add(mat('#1f1f22', 0.6), new THREE.ConeGeometry(0.2, 0.22, 16, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.02), M(p, 0, 0, 0))
        bin.add(lamp(L.color), ball(0.07), M(p, 0, 0, -0.12))
        radius = 1.7
      } else if (L.kind === 'tube') {
        bin.add(mat('#d8dadf', 0.4, 0.3), box(0.22, 1.5, 0.05), M(p, 0, 0, 0))
        bin.add(lamp(L.color), box(0.12, 1.4, 0.03), M(p, 0, 0, -0.03))
        radius = 1.5; stretch = 1.8
      } else if (L.kind === 'spot') {
        bin.add(dark, box(0.08, 0.5, 0.05), M(p, 0, 0, 0))
        bin.add(dark, cyl(0.07, 0.16, 12, 0.09), M(p, 0, 0, -0.16, 0, [1, 1, 1]))
        bin.add(lamp(L.color), new THREE.CircleGeometry(0.075, 12).rotateX(Math.PI).translate(0, 0, -0.165), M(p, 0, 0, 0))
        radius = 1.2
      } else if (L.kind === 'chandelier') {
        const cord = r.floor + r.height - p.z
        bin.add(brass, cyl(0.02, cord), M(p, 0, 0, 0))
        bin.add(brass, new THREE.TorusGeometry(0.55, 0.03, 6, 20), M(p, 0, 0, -0.05))
        for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; bin.add(lamp(L.color), ball(0.09), M(p, Math.cos(a) * 0.55, Math.sin(a) * 0.55, 0.06)) }
        bin.add(lamp(L.color), ball(0.16), M(p, 0, 0, -0.1))
        radius = 4.2
      } else if (L.kind === 'sconce') {
        bin.add(brass, box(0.12, 0.06, 0.2), M(p, 0, 0, -0.1))
        bin.add(lamp(L.color), ball(0.08), M(p, 0, 0.08, 0.02))
        radius = 1.3
      }
      // The pool on the floor (vertex-coloured, one mesh for the room), and a small halo round the lamp.
      const c = new THREE.Color(L.color)
      // Clipped to the room: dark past its walls (adds nothing), and no triangles wholly outside.
      const pool = new THREE.PlaneGeometry(radius * 2, radius * 2 * stretch, 12, 12).applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(p.x, p.y, r.floor + 0.03), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -p.h * DEG), new THREE.Vector3(1, 1, 1)))
      const P = pool.attributes.position, n = P.count, col = new Float32Array(n * 3), inside: boolean[] = []
      for (let i = 0; i < n; i++) { inside.push(insidePolygon(r.polygon, P.getX(i), P.getY(i))); if (inside[i]) col.set([c.r, c.g, c.b], i * 3) }
      pool.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
      const idx = Array.from(pool.index!.array), kept: number[] = []
      for (let t = 0; t < idx.length; t += 3) if (inside[idx[t]] || inside[idx[t + 1]] || inside[idx[t + 2]]) kept.push(idx[t], idx[t + 1], idx[t + 2])
      pool.setIndex(kept)
      if (kept.length) poolGeos.push(pool)
    }
    if (poolGeos.length) {
      const pm = glowing('#ffffff', { map: poolTexture(), additive: true, opacity: this.d.pool.day })
      pm.vertexColors = true
      // Over the floor overlay, whose own offset (to beat the city's floor) would hide the pools' far halves at a grazing angle.
      pm.polygonOffset = true; pm.polygonOffsetFactor = -8; pm.polygonOffsetUnits = -8
      const mesh = new THREE.Mesh(mergeGeometries(poolGeos.map((x) => x.index ? x.toNonIndexed() : x)), pm)
      mesh.renderOrder = 2
      g.add(mesh); pools.push(pm)
    }
    // Signs: the lit ones (boards, chalk) in one mesh and the glowing ones (neon, LED) in another (signAtlas).
    const lit: { s: Sign; m: THREE.Matrix4 }[] = [], glows: { s: Sign; m: THREE.Matrix4 }[] = []
    for (const s of D.signs ?? []) {
      const p = this.place(r, s)
      // A plane faces +z; stand it up facing the placement's heading (+y in the local frame). Two-sided: a second
      // face back to back (a sign hanging in the room, read from both ways), and no frame behind it.
      for (const back of s.double ? [0, 1] : [0]) (s.kind === 'neon' || s.kind === 'led' ? glows : lit).push({ s, m: M(p, 0, back ? -0.005 : 0.03, 0, back ? Math.PI : 0).multiply(new THREE.Matrix4().makeRotationZ(Math.PI)).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2)) })
      if (s.double) {
        bin.add(mat('#2a2b2e', 0.6), box(s.w + 0.04, 0.02, 0.03).translate(0, 0.012, s.h / 2), M(p, 0, 0, 0))
        // Hung from the ceiling on two cords (a sign standing on a display has nothing above it to hang from).
        const cord = r.floor + r.height - (p.z + s.h / 2 + 0.03)
        if (cord > 0.15 && cord < 2.5) for (const k of [-0.4, 0.4]) bin.add(mat('#2a2b2e', 0.6), cyl(0.005, cord), M(p, k * s.w, 0.012, s.h / 2 + 0.03))
      }
      else if (s.kind !== 'neon') bin.add(mat(s.kind === 'chalk' ? '#5a3a22' : '#2a2b2e', 0.6), box(s.w + 0.06, 0.03, s.h + 0.06).translate(0, 0, -(s.h + 0.06) / 2), M(p, 0, 0, 0))
      if (s.stand) { bin.add(mat('#c8a04a', 0.35, 0.8), cyl(0.02, p.z - r.floor - s.h / 2), M({ ...p, z: r.floor }, 0, -0.02, 0)); bin.add(mat('#c8a04a', 0.35, 0.8), cyl(0.16, 0.03), M({ ...p, z: r.floor }, 0, -0.02, 0)) }
      if (s.kind === 'neon') bin.add(mat('#2a2b2e', 0.5, 0.4), box(s.w * 0.9, 0.02, s.h * 0.85).translate(0, 0, -s.h * 0.425), M(p, 0, -0.01, 0))
    }
    const litMesh = signAtlas(lit, (t) => surfaceLit(0xffffff, { map: t, rough: 0.7 }))
    if (litMesh) { litMesh.receiveShadow = true; g.add(litMesh) }
    const glowMesh = signAtlas(glows, (t) => glowing('#ffffff', { map: t, transparent: true }))
    if (glowMesh) g.add(glowMesh)
    // Props.
    for (const pr of D.props ?? []) this.prop(r, pr, bin, mat, lamp, g)
    for (const m of bin.meshes()) g.add(m)
    // People: one small vignette each, on this room's floor.
    for (const [i, pp] of (D.people ?? []).entries()) {
      const p = this.place(r, pp)
      this.people.push({ id: `${r.id}-${i}`, name: `${r.name}: ${pp.act}`, area: r.name, at: [p.x, p.y], heading: p.h, near: 6, floor: r.floor, members: [{ type: pp.type, act: pp.act, at: [0, 0], face: 0, ...(pp.seat ? { seat: pp.seat } : {}) }], props: [], react: { pass: 'look', combo: 'cheer' }, lines: [] } as VignetteDef)
    }
  }

  /** One prop of a room: built from primitives into the room's bins. */
  private prop(r: InteriorRoom, pr: NonNullable<RoomDress['props']>[number], bin: Bin, mat: (c: string, rough?: number, metal?: number) => THREE.MeshLambertMaterial, lamp: (c: string) => THREE.MeshBasicMaterial, g: THREE.Group) {
    const p = this.place(r, pr), C = pr.colors ?? []
    const wood = mat('#8a5e36', 0.7), steel = mat('#c9ccd2', 0.35, 0.8), dark = mat('#2a2b2e', 0.6)
    switch (pr.kind) {
      case 'stickers': {
        const m = surfaceLit(0xffffff, { map: stickerTexture(), rough: 0.6, poly: true })
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.5), m); mesh.applyMatrix4(M(p, 0, 0, 0.004)); g.add(mesh)
        break
      }
      case 'griptape': for (let i = 0; i < 3; i++) { bin.add(mat('#1a1a1c', 0.95), cyl(0.07, 0.23, 14).rotateY(Math.PI / 2).translate(0, 0, 0.07), M(p, (i - 1) * 0.02, i * 0.16, 0)); bin.add(mat('#fbfaf3', 0.6), cyl(0.072, 0.05, 14).rotateY(Math.PI / 2).translate(0, 0, 0.07), M(p, (i - 1) * 0.02, i * 0.16, 0)) } break
      case 'register': bin.add(dark, box(0.36, 0.3, 0.14), M(p, 0, 0, 0)); bin.add(mat('#1b1c1f', 0.3), box(0.26, 0.04, 0.2), M(p, 0, 0.1, 0.14, 0)); bin.add(lamp('#7fd1ff'), new THREE.PlaneGeometry(0.22, 0.15).rotateX(Math.PI / 2), M(p, 0, 0.078, 0.25)); break
      case 'wheelDisplay': {
        bin.add(wood, box(0.9, 0.04, 0.65).translate(0, 0, -0.32), M(p, 0, 0, 0))
        const wc = ['#e8642a', '#2a9a9a', '#f2c84a', '#f4efe0', '#d8352a', '#8fd23a']
        for (let i = 0; i < 12; i++) bin.add(mat(wc[i % wc.length], 0.4), cyl(0.04, 0.04, 14).rotateX(-Math.PI / 2), M(p, -0.33 + (i % 4) * 0.22, 0.02, -0.12 - Math.floor(i / 4) * 0.18))
        break
      }
      case 'shoeBoxes': { const bc = ['#e8642a', '#1f1f22', '#2a9a9a', '#f4efe0']; for (let i = 0; i < 7; i++) bin.add(mat(bc[i % 4], 0.8), box(0.36, 0.24, 0.13), M(p, (i % 2) * 0.38 - 0.19, 0, Math.floor(i / 2) * 0.135)); break }
      case 'bench': bin.add(wood, box(1.6, 0.42, 0.06).translate(0, 0, 0.4), M(p, 0, 0, 0)); for (const x of [-0.7, 0.7]) bin.add(dark, box(0.06, 0.38, 0.4), M(p, x, 0, 0)); break
      case 'salsaBar': {
        bin.add(mat('#c8904a', 0.7), box(1.2, 0.55, 0.88), M(p, 0, 0, 0))
        bin.add(steel, box(1.2, 0.55, 0.03), M(p, 0, 0, 0.88))
        const sc = ['#d8352a', '#4a9a3a', '#e8902a', '#f4efe0']
        sc.forEach((c, i) => { bin.add(mat('#fbfaf3', 0.4), cyl(0.11, 0.07, 16, 0.08), M(p, -0.42 + i * 0.28, 0, 0.91)); bin.add(mat(c, 0.6), cyl(0.095, 0.015, 16), M(p, -0.42 + i * 0.28, 0, 0.965)) })
        for (let i = 0; i < 6; i++) bin.add(mat('#fbfaf3', 0.5), cyl(0.04, 0.05, 10, 0.03), M(p, 0.5, -0.15, 0.91 + i * 0.012))
        break
      }
      case 'aguas': ['#c8243a', '#8fd23a', '#f4efe0'].forEach((c, i) => { bin.add(mat(c, 0.15, 0.1), cyl(0.11, 0.36, 18), M(p, (i - 1) * 0.26, 0, 0)); bin.add(steel, cyl(0.115, 0.03, 18), M(p, (i - 1) * 0.26, 0, 0.36)) }); break
      case 'papel': {
        // A string of paper flags across the room's width, sagging in the middle.
        const sides = r.polygon.map((q) => (q[0] - r.door[0]) * Math.cos(r.inward * DEG) - (q[1] - r.door[1]) * Math.sin(r.inward * DEG))
        const r0 = Math.min(...sides) + 0.2, r1 = Math.max(...sides) - 0.2, n = Math.round((r1 - r0) / 0.42)
        for (let i = 0; i <= n; i++) {
          const x = r0 + (i / n) * (r1 - r0) - (pr.off?.[0] ?? 0), sag = -0.25 * (1 - Math.pow((2 * i) / n - 1, 2))
          bin.add(mat(C[i % Math.max(1, C.length)] ?? '#e8642a', 0.9), new THREE.PlaneGeometry(0.3, 0.36).rotateX(Math.PI / 2).translate(0, 0, -0.18), M(p, x, 0, sag))
          if (i < n) bin.add(dark, new THREE.BoxGeometry((r1 - r0) / n, 0.008, 0.008).translate((r1 - r0) / n / 2, 0, 0), M(p, x, 0, sag))
        }
        break
      }
      case 'napkins': bin.add(steel, box(0.12, 0.1, 0.16), M(p, 0, 0, 0)); bin.add(mat('#fbfaf3', 0.9), box(0.1, 0.02, 0.12), M(p, 0, 0.055, 0.02)); bin.add(mat('#d8352a', 0.5), cyl(0.025, 0.12, 10), M(p, 0.15, 0, 0)); break
      case 'basket': {
        const bc = mat(C[0] ?? '#2a9a9a', 0.6)
        for (const [w, d, x, y] of [[0.6, 0.03, 0, -0.21], [0.6, 0.03, 0, 0.21], [0.03, 0.42, -0.3, 0], [0.03, 0.42, 0.3, 0]] as const) bin.add(bc, box(w, d, 0.32), M(p, x, y, 0))
        bin.add(bc, box(0.6, 0.42, 0.03), M(p, 0, 0, 0))
        for (let i = 0; i < 6; i++) bin.add(mat(C[1 + (i % 2)] ?? '#f4efe0', 0.95), ball(0.12, 8).scale(1.2, 0.9, 0.5), M(p, -0.16 + (i % 3) * 0.16, -0.08 + Math.floor(i / 3) * 0.16, 0.3 + (i % 2) * 0.04))
        break
      }
      case 'folded': { const fc = ['#f4efe0', '#2a9a9a', '#e8642a', '#22304a']; for (let i = 0; i < 4; i++) bin.add(mat(fc[i], 0.95), box(0.34, 0.26, 0.05), M(p, (hash(i) - 0.5) * 0.03, 0, i * 0.05, (hash(i * 7) - 0.5) * 0.15)); break }
      case 'changer': bin.add(mat('#8a8e96', 0.4, 0.6), box(0.55, 0.32, 1.55), M(p, 0, 0, 0)); bin.add(lamp('#7fe0a0'), new THREE.PlaneGeometry(0.3, 0.12).rotateX(Math.PI / 2), M(p, 0, 0.162, 1.25)); bin.add(dark, box(0.18, 0.02, 0.06), M(p, 0, 0.165, 0.95)); break
      case 'plant': bin.add(mat('#c86a3a', 0.8), cyl(0.2, 0.35, 14, 0.15), M(p, 0, 0, 0)); for (let i = 0; i < 7; i++) bin.add(mat('#3a8a3a', 0.8), new THREE.ConeGeometry(0.09, 0.7, 6).rotateX(Math.PI / 2).translate(0, 0, 0.35), M(p, Math.cos(i) * 0.08, Math.sin(i) * 0.08, 0.3, 0, [1, 1, 1])); break
      case 'socks': { const sc = ['#f4efe0', '#e8642a', '#2a9a9a', '#f28ab4', '#f2c84a']; for (let i = 0; i < 5; i++) { bin.add(mat(sc[i], 0.9), box(0.06, 0.02, 0.16), M(p, -0.32 + i * 0.16, 0.03, -0.1 - (i % 2) * 0.12)); bin.add(mat(sc[i], 0.9), box(0.1, 0.02, 0.05), M(p, -0.3 + i * 0.16, 0.03, -0.19 - (i % 2) * 0.12)) } break }
      case 'fruit': {
        // A stepped stand of tilted crates: oranges, apples, bananas, limes, mangos.
        // Two-sided (low, high, low), so it reads from the door and from the aisle.
        const fruitC: [string, number, string][] = [['#f08a24', 0.045, 'ball'], ['#c8243a', 0.042, 'ball'], ['#f2d84a', 0.03, 'banana'], ['#6ab03a', 0.032, 'ball'], ['#f2a83a', 0.05, 'ball']]
        const tier = [0.45, 0.73, 0.45]
        for (let k = 0; k < 3; k++) bin.add(wood, box(1.5, 0.42, 0.06).translate(0, 0, -0.03), M(p, 0, -k * 0.38, tier[k], 0))
        for (let k = 0; k < 3; k++) bin.add(wood, box(1.5, 0.38, tier[k] - 0.06), M(p, 0, -k * 0.38, 0))
        for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) {
          const [col, rr, kind] = fruitC[(k * 3 + c) % fruitC.length]
          for (let i = 0; i < 9; i++) {
            const x = -0.66 + c * 0.5 + (i % 3) * 0.12, y = -k * 0.38 - 0.1 + Math.floor(i / 3) * 0.1, z = tier[k] + rr
            if (kind === 'banana') bin.add(mat(col, 0.6), new THREE.CapsuleGeometry(0.02, 0.12, 3, 8).rotateZ(Math.PI / 2).rotateX(0.3), M(p, x, y, z))
            else bin.add(mat(col, 0.55), ball(rr, 8), M(p, x, y, z))
          }
        }
        break
      }
      case 'cooler': {
        bin.add(mat('#e8eaee', 0.4, 0.3), box(2.0, 0.7, 2.0), M(p, 0, 0, 0))
        bin.add(lamp('#eef8ff'), new THREE.PlaneGeometry(1.84, 1.7).rotateX(Math.PI / 2), M(p, 0, 0.356, 1.0))
        const bc = ['#d8352a', '#2a9a9a', '#f2c84a', '#8fd23a', '#f4efe0', '#e8642a', '#22304a']
        for (let sh = 0; sh < 4; sh++) {
          bin.add(steel, box(1.84, 0.4, 0.02), M(p, 0, 0.12, 0.3 + sh * 0.42))
          for (let i = 0; i < 14; i++) bin.add(mat(bc[(i + sh) % bc.length], 0.3), cyl(0.032, 0.2, 8), M(p, -0.84 + i * 0.13, 0.24, 0.32 + sh * 0.42))
        }
        for (const x of [-0.46, 0.46]) bin.add(steel, box(0.03, 0.02, 1.7), M(p, x, 0.37, 0.15))
        break
      }
      case 'snacks': { const sc = ['#d8352a', '#f2c84a', '#2a9a9a', '#e8642a', '#8fd23a']; bin.add(steel, box(0.5, 0.3, 0.02), M(p, 0, 0, 0)); for (let i = 0; i < 10; i++) bin.add(mat(sc[i % 5], 0.4), box(0.09, 0.04, 0.16), M(p, -0.2 + (i % 5) * 0.1, -0.06 + Math.floor(i / 5) * 0.12, 0.02, 0.1)); break }
      case 'portholes': {
        // Round doors on the city's washers and dryers: along the row (across the way it faces), each pushed back
        // onto the machine's front; none where no front is found.
        const len = pr.length ?? 6, sp = pr.spacing ?? 0.76, n = Math.max(1, Math.floor(len / sp))
        const fx = Math.sin(p.h * DEG), fy = Math.cos(p.h * DEG), rx = fy, ry = -fx
        const chrome = mat('#d8dce2', 0.25, 0.9), glass = mat('#2a3a4a', 0.1, 0.4), suds = mat('#e8f0f4', 0.6)
        for (let i = 0; i < n; i++) {
          const o = (i - (n - 1) / 2) * sp, x0 = p.x + rx * o, y0 = p.y + ry * o
          const hit = raycast(this.park, { x: x0, y: y0, z: p.z }, { x: -fx, y: -fy, z: 0 }, 1.8)
          if (!hit) continue
          const d = Math.hypot(hit.point.x - x0, hit.point.y - y0) - 0.012
          const at: Placed = { x: x0 - fx * d, y: y0 - fy * d, z: p.z, h: p.h }
          bin.add(chrome, new THREE.TorusGeometry(0.2, 0.03, 8, 22).rotateX(Math.PI / 2), M(at, 0, 0, 0))
          bin.add(glass, new THREE.CircleGeometry(0.19, 20).rotateX(-Math.PI / 2), M(at, 0, 0.005, 0))
          if (i % 3 !== 1) bin.add(suds, new THREE.CircleGeometry(0.19, 20, Math.PI * 1.1, Math.PI * 0.8).rotateX(-Math.PI / 2), M(at, 0, 0.008, 0))   // laundry tumbling in some
          bin.add(dark, box(0.3, 0.012, 0.06), M(at, 0, 0, 0.3))   // the coin slot strip
        }
        break
      }
      case 'apparel': {
        // A wall rail of tees and hoodies on hangers.
        const len = pr.length ?? 2.4, n = Math.max(2, Math.round(len / 0.16))
        bin.add(steel, cyl(0.012, len).rotateY(Math.PI / 2).translate(-len / 2, 0, 0), M(p, 0, 0.3, 1.7))
        for (const x of [-len / 2, len / 2]) bin.add(steel, box(0.02, 0.32, 0.02), M(p, x, 0.15, 1.69))
        const tc = C.length ? C : ['#1f1f22', '#e8642a', '#f4efe0', '#2a9a9a', '#d8352a', '#f2c84a']
        for (let i = 0; i < n; i++) {
          const x = -len / 2 + 0.08 + (i / (n - 1)) * (len - 0.16), c = mat(tc[i % tc.length], 0.95)
          bin.add(c, box(0.025, 0.42, 0.55), M(p, x, 0.3, 1.1, 0.05 * Math.sin(i * 1.7)))
          bin.add(c, box(0.025, 0.62, 0.16), M(p, x, 0.3, 1.47))   // the shoulders and sleeves
        }
        break
      }
      case 'chairs': {
        // A row of moulded plastic chairs facing the way it faces.
        const n = Math.max(1, Math.round((pr.length ?? 2) / 0.55)), cc = mat(C[0] ?? '#e8642a', 0.5)
        for (let i = 0; i < n; i++) {
          const x = (i - (n - 1) / 2) * 0.55
          bin.add(cc, box(0.44, 0.42, 0.04).translate(0, 0, 0.42), M(p, x, 0, 0))
          bin.add(cc, box(0.44, 0.04, 0.42).translate(0, -0.2, 0.44), M(p, x, 0, 0, 0))
          for (const [a, b] of [[-0.19, -0.17], [0.19, -0.17], [-0.19, 0.17], [0.19, 0.17]]) bin.add(steel, cyl(0.012, 0.42), M(p, x + a, b, 0))
        }
        break
      }
      case 'wetFloor': {
        const y = mat('#f2c62a', 0.4)
        for (const k of [1, -1]) bin.add(y, box(0.32, 0.02, 0.62).translate(0, 0, 0.0), new THREE.Matrix4().multiplyMatrices(M(p, 0, k * 0.1, 0), new THREE.Matrix4().makeRotationX(k * 0.16)))
        bin.add(dark, box(0.2, 0.025, 0.04), M(p, 0, 0.1, 0.4))
        break
      }
      case 'velvet': {
        // Brass stanchions in two rows behind the window, red ropes sagging between them: the queue's lane.
        const len = pr.length ?? 5, n = Math.max(2, Math.round(len / 1.25))
        const brassM = mat('#d8b04a', 0.3, 0.85), rope = mat('#a8242a', 0.8)
        for (const x of [-0.65, 0.65]) for (let i = 0; i <= n; i++) {
          const y = -(i / n) * len
          bin.add(brassM, cyl(0.16, 0.03, 16), M(p, x, y, 0)); bin.add(brassM, cyl(0.025, 0.95, 10), M(p, x, y, 0)); bin.add(brassM, ball(0.045), M(p, x, y, 0.97))
          if (i < n) for (let k = 0; k < 8; k++) { const t = (k + 0.5) / 8, sag = 0.18 * 4 * t * (1 - t); bin.add(rope, cyl(0.018, len / n / 8 + 0.01, 6).rotateX(Math.PI / 2).translate(0, 0, 0), M(p, x, y - t * (len / n), 0.88 - sag, 0)) }
        }
        break
      }
    }
  }

  /** How far the camera is inside a room (0 out .. 1 in, eased frame by frame). */
  indoor = 0
  /** The night bloom's share for the renderer: indoorBloom inside a room, 1 outdoors. */
  get bloomShare() { return 1 - this.indoor * (1 - (this.d.indoorBloom ?? 1)) }

  /** The camera (rooms drawn within drawDistance; inside one, indoor eases to 1); night 0..1 (the pools brighten). */
  update(camera: THREE.Vector3, night: number) {
    let inside = 0
    for (const x of this.rooms) {
      x.g.visible = x.c.distanceTo(camera) < this.d.drawDistance
      if (x.g.visible && camera.z > x.r.floor && camera.z < x.r.floor + x.r.height && insidePolygon(x.r.polygon, camera.x, camera.y)) inside = 1
    }
    this.indoor += (inside - this.indoor) * 0.12
    if (Math.abs(inside - this.indoor) < 0.01) this.indoor = inside
    if (Math.abs(night - this.night) > 0.01) {
      this.night = night
      const o = this.d.pool.day + (this.d.pool.night - this.d.pool.day) * night
      for (const x of this.rooms) for (const m of x.pools) m.opacity = o
    }
  }

  /** Match the renderer's look (cute toon, real PBR, grey clay). */
  setStyle(style: string) {
    if (style === this.style) return
    this.style = style
    applyMaterials(this.group, (style === 'real' || style === 'grey' ? style : 'cute') as 'real' | 'cute' | 'grey')
  }
}
