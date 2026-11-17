import * as THREE from 'three'
import { Character } from './character.ts'
import { hand, type CharacterSpec, type Draft, type HookCtx } from './characters.ts'
import { Face } from './face.ts'
import { capsuleBetween, detailMaps, foldMaps, lathe, buildRig, merged, pivot, rigid, surface, tube, type V3 } from './kit.ts'
import { add, faceOf, hairCap, person, type Body } from './people.ts'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { hash2, img, texture, rgb } from './tex.ts'

// The character kit (data/characters.json people[].kit): the story's cast built from a recipe instead
// of a builder each. A recipe names the body (girth, belly, bust; or a bird: pigeon, gull, parrot), the
// hair, beard, hat, glasses and earrings, the top, bottoms and shoes (colours and a pattern: stripes,
// plaid, dots, pinstripe, splatter, floral, bands, zigzag), layers over them (a vest, cardigan, jacket,
// coat, apron, overalls, scarf, tie, bow tie, hi-vis, headphones, lanyard, straps, a bag, fur trim, a
// sash), the props that make them readable from across the street (an accordion of them: a lion dance
// head, a lowrider, a dog pack, a paleta cart...), the face and the idle (castpeople.ts kitIdle). The
// rig (proportions) is the spec's own. Everything is built on the same kit as the skaters and the
// hand-built cast (people.ts), so they pose with the same solver and bake to the same cheap far rig.

type Mat = THREE.MeshLambertMaterial
export type Pattern = { kind: 'stripes' | 'plaid' | 'dots' | 'pinstripe' | 'splatter' | 'floral' | 'bands' | 'zigzag' | 'trim' | 'rainbow' | 'sequin' | 'sunwave'; colors: string[]; scale?: number }
type Paint = string | { color: string; pattern?: Pattern }
export type KitLayer = { kind: string; color: string; color2?: string; pattern?: Pattern; inner?: string }
export type KitProp = { kind: string; colors?: Record<string, string> }
export type KitRecipe = {
  body?: { girth?: number; belly?: number; bust?: number }
  bird?: 'pigeon' | 'gull' | 'parrot'
  feathers?: Record<string, string>
  hair?: { style: string; color: string; bun?: 'top' | 'back' | 'messy'; tie?: string }
  beard?: { style: string; color: string }
  hat?: { kind: string; color: string; band?: string; brim?: string; trim?: string; flower?: string }
  /** up: pushed up on the head. */
  glasses?: { kind: string; color: string; lens?: string; up?: boolean }
  earrings?: { kind: string; color: string }
  top?: { color: string; pattern?: Pattern; sleeves?: Paint; neck?: string; collar?: string }
  bottom?: { kind: 'pants' | 'shorts' | 'skirt'; color: string; pattern?: Pattern; legs?: string }
  /** bare: no shoes (the skin's colour). */
  shoes?: { color: string; sole?: string; bare?: boolean }
  gloves?: string
  layers?: KitLayer[]
  props?: KitProp[]
  face: { iris: string; brow: string; neutral?: 'neutral' | 'smile' | 'grin' }
  idle: string
  /** Every cloth, knit and matte part in one finish instead (silver: the living statue's paint). */
  finish?: 'silver'
  /** A skater's signature prop (a PROPS kind): out standing still, celebrating and in specials (Create-a-Skater). */
  signature?: string
}
export type KitSpec = CharacterSpec & { kit: KitRecipe }

// ---------------------------------------------------------------- materials

/** Detail maps shared by every kit character (cloth weave, knit, skin): made once. */
const DETAIL = new Map<string, { normal: THREE.Texture; rough: THREE.Texture }>()
const detail = (k: string) => {
  let d = DETAIL.get(k)
  if (!d) {
    // Cloth and knit: folds across the length over the weave (kit.ts foldMaps); the knit's weave coarser.
    d = k === 'knit' ? foldMaps(2, { weave: 40, folds: 5, rough: 0.9, strength: 2.2 }) : k === 'puffer' ? detailMaps(37, 3, 0.8, 0.15, 3) : k === 'skin' ? detailMaps(5, 6, 0.55, 0.15, 1.2) : k === 'feather' ? detailMaps(61, 2, 0.85, 0.15, 1.5) : foldMaps(1)
    DETAIL.set(k, d)
  }
  return d
}

const RAINBOW = ['#e0301e', '#e8642a', '#f2c84a', '#5ab04a', '#2a9a9a', '#6a4ab0'].map((c) => rgb(c))
/** A pattern painted into a small texture (u around a body, v up it). */
function patternTex(p: Pattern): THREE.Texture {
  const N = 128, a = img(N, N), cs = p.colors.map((c) => rgb(c)), base = cs[0], s = p.scale ?? 1
  const put = (x: number, y: number, c: number[]) => a.d.set([c[0], c[1], c[2], 1], (y * N + x) * 4)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = 1 - y / N
    let c: number[] = base
    switch (p.kind) {
      case 'stripes': { if (((u * 16 * s) % 2) > 1) c = cs[1]; break }
      case 'pinstripe': { if (((u * 24 * s) % 1) < 0.08) c = cs[1]; break }
      case 'plaid': {
        const a1 = ((u * 8 * s) % 1) < 0.34, b1 = ((v * 5 * s) % 1) < 0.34, a2 = ((u * 8 * s + 0.5) % 1) < 0.08, b2 = ((v * 5 * s + 0.5) % 1) < 0.08
        c = a1 && b1 ? cs[1] : a1 || b1 ? cs[1].map((q, i) => (q + base[i]) / 2) : base
        if (a2 || b2) c = cs[2] ?? cs[1]
        break
      }
      case 'dots': { const fu = (u * 18 * s) % 1, fv = (v * 9 * s + (Math.floor(u * 18 * s) % 2) * 0.5) % 1; if ((fu - 0.5) ** 2 + (fv - 0.5) ** 2 < 0.07) c = cs[1]; break }
      case 'bands': { if ((v > 0.32 && v < 0.4) || (v > 0.56 && v < 0.64)) c = cs[1]; break }
      case 'zigzag': { const z = Math.abs(((u * 10 * s) % 1) - 0.5) * 0.12; if (Math.abs(v - 0.3 - z) < 0.035 || Math.abs(v - 0.62 - z) < 0.035) c = cs[1]; break }
      case 'trim': { const d = Math.min(Math.abs(u - 0.21), Math.abs(u - 0.29)); if (d < 0.012) c = cs[1]; break }
      case 'rainbow': { const R = cs.length > 2 ? cs.slice(1) : RAINBOW; c = R[Math.floor((u + v * 0.5) * 14 * s) % R.length]; break }
      case 'sequin': {
        // Small discs catching the light: every cell its own shade between the base and the second colour.
        const cx = Math.floor(u * 64 * s), cy = Math.floor(v * 40 * s), h = hash2(cx, cy, 5)
        const lit = h > 0.86 ? [1, 0.95, 0.85] : cs[1]
        c = base.map((q, i) => q + (lit[i] - q) * (h > 0.86 ? 0.8 : h * 0.7))
        break
      }
      case 'sunwave': {
        // A tee's graphic on the chest (the front is u 0.25): an orange sun, a teal wave across its lower half.
        const du = (u - 0.25) / 0.075, dv = (v - 0.56) / 0.13, r2 = du * du + dv * dv
        if (r2 < 1) c = cs[1]
        const crest = 0.56 - 0.02 + 0.035 * Math.sin((u - 0.25) * 60)
        if (Math.abs(du) < 1.35 && v < crest && v > 0.4 && (r2 < 1.8 || v > 0.47)) c = cs[2] ?? cs[1]
        if (Math.abs(du) < 1.35 && Math.abs(v - crest) < 0.008) c = [1, 1, 1]
        break
      }
      case 'splatter': case 'floral': break
    }
    put(x, y, c)
  }
  if (p.kind === 'splatter' || p.kind === 'floral') {
    // Blobs: paint splatter (irregular, every colour) or small flowers (a ring of petals round a dot).
    const n = p.kind === 'splatter' ? 46 : 26
    for (let i = 0; i < n; i++) {
      const cx = hash2(i, 1, 9) * N, cy = (p.kind === 'floral' ? 0.15 + hash2(i, 2, 9) * 0.7 : hash2(i, 2, 9)) * N, col = cs[1 + (i % Math.max(1, cs.length - 1))]
      const r = p.kind === 'splatter' ? 1.5 + hash2(i, 3, 9) * 4 : 3.2
      for (let y = Math.floor(cy - r - 2); y <= cy + r + 2; y++) for (let x = Math.floor(cx - r - 2); x <= cx + r + 2; x++) {
        const xx = (x + N) % N, yy = (y + N) % N, d = Math.hypot(x - cx, y - cy)
        const ang = Math.atan2(y - cy, x - cx)
        const inside = p.kind === 'splatter' ? d < r * (0.75 + 0.35 * Math.sin(ang * 5 + i)) : d < r * (0.65 + 0.35 * Math.abs(Math.cos(ang * 2.5)))
        if (inside) put(xx, yy, p.kind === 'floral' && d < 1.2 ? cs[cs.length - 1] : col)
      }
    }
  }
  return texture(a, true)
}

/** The materials one character uses, shared by colour and finish (fewer materials: fewer draw calls once baked). */
class Mats {
  private m = new Map<string, Mat>()
  private over: string | undefined
  constructor(over?: string) { this.over = over }
  get(color: string, finish = 'cloth'): Mat {
    if (this.over && (finish === 'cloth' || finish === 'knit' || finish === 'matte' || finish === 'puffer')) finish = this.over
    const key = `${finish}:${color}`
    let x = this.m.get(key)
    if (!x) {
      if (finish === 'cloth' || finish === 'knit' || finish === 'puffer') { const d = detail(finish); x = surface(`${finish} ${color}`, { color, normalMap: d.normal, roughnessMap: d.rough, roughness: 1, sheen: finish === 'puffer' ? 0.4 : 0.35, sheenColor: '#ffffff' }) }
      else if (finish === 'feather') { const d = detail('feather'); x = surface(`feathers ${color}`, { color, normalMap: d.normal, roughnessMap: d.rough, roughness: 1, sheen: 0.4, sheenColor: '#e8ecf0' }) }
      else if (finish === 'metal') x = surface(`metal ${color}`, { color, roughness: 0.3, metalness: 0.85 })
      else if (finish === 'silver') x = surface(`silver paint ${color}`, { color, roughness: 0.35, metalness: 0.55, clearcoat: 0.3 })
      else if (finish === 'gloss') x = surface(`gloss ${color}`, { color, roughness: 0.25, clearcoat: 0.8 })
      else if (finish === 'glass') x = surface(`glass ${color}`, { color, roughness: 0.05, metalness: 0.3, clearcoat: 1 })
      else if (finish === 'glow') x = surface(`glow ${color}`, { color, emissive: color, emissiveIntensity: 0.8, roughness: 0.3 })
      else if (finish === 'skin') { const d = detail('skin'); x = surface('skin', { color, normalMap: d.normal, roughnessMap: d.rough, roughness: 1, sheen: 0.15, sheenColor: '#ffd0b0' }) }
      else x = surface(`${finish} ${color}`, { color, roughness: finish === 'matte' ? 0.85 : 0.6 })
      this.m.set(key, x)
    }
    return x
  }
  paint(p: Paint, finish = 'cloth'): Mat {
    if (typeof p === 'string' || this.over) return this.get(typeof p === 'string' ? p : p.color, finish)
    if (!p.pattern) return this.get(p.color, finish)
    const key = `pattern:${finish}:${p.color}:${JSON.stringify(p.pattern)}`
    let x = this.m.get(key)
    if (!x) {
      const d = detail(finish === 'knit' ? 'knit' : 'cloth')
      x = surface(`${p.pattern.kind} ${p.color}`, { color: 0xffffff, flat: p.color, map: patternTex({ ...p.pattern, colors: [p.color, ...p.pattern.colors] }), normalMap: d.normal, roughnessMap: d.rough, roughness: 1, sheen: 0.35, sheenColor: '#ffffff' })
      this.m.set(key, x)
    }
    return x
  }
}

// ---------------------------------------------------------------- the body's shape

/** A torso (lathe rows [y, rx, rz, z offset]) the layers follow, and the head's centre and size. */
type Shape = { rows: [number, number, number, number][]; head: { c: THREE.Vector3; r: number; front: number; top: number; ear: number } }

const rowAt = (rows: Shape['rows'], y: number): [number, number, number] => {
  if (y <= rows[0][0]) return [rows[0][1], rows[0][2], rows[0][3]]
  for (let k = 0; k < rows.length - 1; k++) {
    const a = rows[k], b = rows[k + 1]
    if (y <= b[0]) { const t = (y - a[0]) / (b[0] - a[0] || 1); return [a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t] }
  }
  const z = rows[rows.length - 1]
  return [z[1], z[2], z[3]]
}
/** The front of the torso at a height (z of its surface straight ahead). */
const frontAt = (S: Shape, y: number) => { const r = rowAt(S.rows, y); return r[1] + r[2] }

const TORSO = ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck']

/** A shell over the torso from y0 to y1, t thicker; below the hips (to `hem`) it flares like a coat's skirt. */
function shell(B: Body, S: Shape, y0: number, y1: number, t: number, m: Mat, o: { hem?: number; flare?: number } = {}) {
  const rows: [number, number, number, number][] = []
  if (o.hem !== undefined) {
    const h = B.hipsY - 0.04, [rx, rz] = rowAt(S.rows, h), f = o.flare ?? 1.12
    rows.push([o.hem, rx * f + t, rz * f + t * 1.4, 0], [(o.hem + h) / 2, rx * (1 + (f - 1) * 0.6) + t, rz * (1 + (f - 1) * 0.6) + t * 1.2, 0])
  }
  const n = 7
  for (let i = 0; i <= n; i++) {
    const y = y0 + (y1 - y0) * (i / n)
    if (o.hem !== undefined && y < B.hipsY - 0.04) continue
    const [rx, rz, dz] = rowAt(S.rows, y)
    rows.push([y, rx + t, rz + t, dz])
  }
  return lathe(B.rig, rows, TORSO, m, { caps: [false, false], sides: 26 })
}

/** A strip down the front of a garment (the shirt showing through an open jacket, a zip, buttons' placket). */
function frontStrip(B: Body, S: Shape, y0: number, y1: number, t: number, w: number, m: Mat) {
  const n = 4
  for (let i = 0; i < n; i++) {
    const ya = y0 + (y1 - y0) * (i / n), yb = y0 + (y1 - y0) * ((i + 1) / n), za = frontAt(S, ya) + t, zb = frontAt(S, yb) + t
    const bone = ya < B.hipsY + 0.08 ? 'Hips' : ya < B.chestY ? 'Spine' : 'Chest'
    rigid(B.rig, bone, new THREE.BoxGeometry(w, yb - ya + 0.006, 0.004), m, [0, (ya + yb) / 2, (za + zb) / 2], [-Math.atan2(zb - za, yb - ya), 0, 0])
  }
}

/** The person kit's torso, as people.ts person() lathes it. */
function humanRows(B: Body, g: number, b: number, bu: number): Shape['rows'] {
  const { hipsY, chestY, neckY } = B
  return [
    [hipsY - 0.06, 0.15 * g, 0.11 * g, 0], [hipsY + 0.05, 0.16 * g + b * 0.03, 0.115 * g + b, b * 0.6],
    [hipsY + 0.2, 0.165 * g + b * 0.04, 0.11 * g + b * 0.9 + bu * 0.3, b * 0.5], [chestY + 0.06, 0.168 * g, 0.108 * g + bu, b * 0.15 + bu * 0.4],
    [neckY - 0.04, 0.17 * g, 0.105 * g, 0], [neckY + 0.02, 0.06, 0.055, 0],
  ]
}

// ---------------------------------------------------------------- birds

const BIRD: Record<string, Record<string, string>> = {
  pigeon: { body: '#8e959d', dark: '#3c4148', light: '#c2c7cd', neckA: '#3f9a72', neckB: '#74449c', head: '#8e959d', beak: '#2c2e33', cere: '#ece9e2', leg: '#d9667a', iris: '#e8641c', chest: '#9aa1a9' },
  gull: { body: '#f4f4f1', dark: '#4a4f57', light: '#a9b0b8', neckA: '#f4f4f1', neckB: '#f4f4f1', head: '#f6f6f3', beak: '#f2b632', cere: '#f2b632', spot: '#d8352a', leg: '#e8a890', iris: '#f2d24a', chest: '#ffffff' },
  parrot: { body: '#6cbf3a', dark: '#2f8a3a', light: '#3aa8a0', neckA: '#6cbf3a', neckB: '#4aa83a', head: '#6cbf3a', face: '#d8352a', beak: '#ece6d4', cere: '#ece6d4', leg: '#8a8f96', iris: '#f2c230', chest: '#d8dfa0' },
}

/** A bird standing like a person (the cast's gull, pigeon and parrot): plump torso, wings for arms, a head and beak by kind. */
function birdBody(s: KitSpec, M: Mats, clothed: boolean): { B: Body; S: Shape; face: () => Face } {
  const kind = s.kit.bird!, col = { ...BIRD[kind], ...(s.kit.feathers ?? {}) }
  const rig = buildRig(s.rig)
  const hipsY = rig.at('Hips').y, neckY = rig.at('Neck').y, chestY = rig.at('Chest').y, kneeY = rig.at('LeftLeg').y, headY = rig.at('Head').y
  const feathers = M.get(col.body, 'feather'), dark = M.get(col.dark, 'feather'), light = M.get(col.light, 'feather')
  const rows: Shape['rows'] = [[hipsY - 0.11, 0.13, 0.13, -0.02], [hipsY - 0.02, 0.19, 0.2, 0], [hipsY + 0.12, 0.215, 0.24, 0.04], [hipsY + 0.26, 0.225, 0.262, 0.07], [hipsY + 0.38, 0.2, 0.235, 0.065], [neckY - 0.06, 0.15, 0.165, 0.04], [neckY + 0.02, 0.095, 0.1, 0.02]]
  lathe(rig, [[hipsY - 0.13, 0, 0, -0.02], ...rows, [neckY + 0.06, 0, 0, 0.02]], TORSO, feathers, { sides: 32 })
  // The chest: lighter feathers down the front (white on the gull, pale on the parrot).
  rigid(rig, 'Chest', new THREE.SphereGeometry(1, 16, 12), M.get(col.chest, 'feather'), [0, hipsY + 0.18, 0.21], [0, 0, 0], [0.14, 0.2, 0.06])
  // The neck: iridescent on the pigeon, plain on the others.
  const neckM = kind === 'pigeon' ? surface('iridescent neck', { color: col.neckA, roughness: 0.32, iridescence: 1, sheen: 0.5, sheenColor: col.neckB }) : M.get(col.neckA, 'feather')
  lathe(rig, [[neckY - 0.1, 0.16, 0.18, 0.05], [neckY - 0.02, 0.112, 0.122, 0.035], [neckY + 0.05, 0.082, 0.088, 0.02], [headY + 0.01, 0.07, 0.075, 0.015]], ['UpperChest', 'Neck', 'Head'], neckM, { sides: 24, caps: [false, false] })
  // The head and beak.
  const hr = kind === 'parrot' ? 0.104 : 0.094
  const hc = new THREE.Vector3(0, headY + 0.075, 0.02)
  rigid(rig, 'Head', new THREE.SphereGeometry(hr, 22, 16), M.get(col.head, 'feather'), hc.toArray() as V3, [0, 0, 0], kind === 'gull' ? [0.9, 1, 1.18] : [0.94, 1.02, 1.1])
  const beakM = M.get(col.beak, 'gloss')
  let jaw: THREE.Object3D
  if (kind === 'parrot') {
    // The red face, a white eye ring, and the big hooked beak.
    rigid(rig, 'Head', new THREE.SphereGeometry(hr * 0.86, 18, 12, Math.PI * 0.12, Math.PI * 0.76, Math.PI * 0.15, Math.PI * 0.6), M.get(col.face, 'feather'), [0, hc.y, hc.z + 0.03], [0, 0, 0], [1.08, 1.05, 1.08])
    rigid(rig, 'Head', new THREE.SphereGeometry(0.05, 14, 10), beakM, [0, hc.y - 0.005, hc.z + 0.1], [0, 0, 0], [0.75, 0.95, 0.9])
    rigid(rig, 'Head', new THREE.ConeGeometry(0.03, 0.09, 12), beakM, [0, hc.y - 0.05, hc.z + 0.135], [Math.PI * 0.85, 0, 0], [1, 1, 0.75])
    jaw = pivot(rig, 'Head', [0, hc.y - 0.035, hc.z + 0.08])
    const lo = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), beakM); lo.scale.set(0.9, 0.6, 1); lo.position.set(0, -0.01, 0.02); jaw.add(lo)
  } else if (kind === 'gull') {
    rigid(rig, 'Head', new THREE.ConeGeometry(0.021, 0.14, 12), beakM, [0, hc.y - 0.012, hc.z + 0.165], [Math.PI / 2 + 0.08, 0, 0], [1, 1, 0.8])
    rigid(rig, 'Head', new THREE.SphereGeometry(0.012, 8, 6), beakM, [0, hc.y - 0.022, hc.z + 0.228], [0, 0, 0], [1, 1.4, 1])   // the hook
    jaw = pivot(rig, 'Head', [0, hc.y - 0.026, hc.z + 0.1])
    const lo = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.11, 10), beakM); lo.rotation.x = Math.PI / 2 + 0.25; lo.position.set(0, -0.006, 0.05); lo.scale.set(1, 1, 0.6); jaw.add(lo)
    const spot = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), M.get(col.spot, 'gloss')); spot.position.set(0, -0.014, 0.085); jaw.add(spot)
  } else {
    rigid(rig, 'Head', new THREE.ConeGeometry(0.02, 0.075, 12), beakM, [0, hc.y - 0.01, hc.z + 0.125], [Math.PI / 2 + 0.25, 0, 0], [1, 1, 0.75])
    rigid(rig, 'Head', new THREE.SphereGeometry(0.022, 10, 8), M.get(col.cere, 'matte'), [0, hc.y + 0.008, hc.z + 0.092], [0, 0, 0], [1, 0.6, 0.9])
    jaw = pivot(rig, 'Head', [0, hc.y - 0.022, hc.z + 0.088])
    const lo = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.055, 10), beakM); lo.rotation.x = Math.PI / 2 + 0.35; lo.position.set(0, -0.004, 0.024); lo.scale.set(1, 1, 0.6); jaw.add(lo)
  }
  // Wings for arms (bare: the wing feathers; clothed: the sleeves are the layers'), feather hands.
  for (const side of ['Left', 'Right']) {
    const k = side === 'Left' ? 1 : -1
    if (!clothed) {
      tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.052, 0.045, 0.038], feathers, { blend: 0.08 })
      const sh = rig.at(`${side}Arm`), el = rig.at(`${side}ForeArm`), wr = rig.at(`${side}Hand`)
      rigid(rig, `${side}Arm`, new THREE.SphereGeometry(1, 16, 10), light, [(sh.x + el.x) / 2, sh.y - 0.02, sh.z - 0.02], [0, 0, 0], [Math.abs(el.x - sh.x) * 0.55, 0.022, 0.09])
      rigid(rig, `${side}ForeArm`, new THREE.SphereGeometry(1, 16, 10), dark, [el.x + (wr.x - el.x) * 0.62, el.y - 0.02, el.z - 0.025], [0, 0, k * -0.08], [Math.abs(wr.x - el.x) * 0.8, 0.018, 0.085])
    }
    hand(rig, side, dark, { r: 0.012, palm: [1, 0.022, 0.05], fingers: 4 })
    // Feathered thighs, thin bare shins, three toes forward and one back.
    tube(rig, [`${side}UpLeg`, `${side}Leg`], [0.075, 0.05], feathers, { blend: 0.06 })
    const legM = M.get(col.leg, 'matte')
    tube(rig, [`${side}Leg`, `${side}Foot`], [0.024, 0.021], legM, { blend: 0.04 })
    const a = rig.at(`${side}Foot`)
    for (const [dx, len, back] of [[-0.035, 0.12, 0], [0, 0.14, 0], [0.035, 0.12, 0], [0, 0.07, 1]] as const) {
      const dir = back ? -1 : 1
      const c = capsuleBetween([a.x + k * dx * 0.3, 0.02, a.z + 0.01 * dir], [a.x + k * dx * 1.6, 0.014, a.z + dir * len], 0.013)
      rigid(rig, `${side}Foot`, c.geo, legM, c.mid, [c.rot.x, c.rot.y, c.rot.z])
    }
  }
  // The tail: a fan of feathers.
  for (let i = 0; i < 6; i++) {
    const a = (i - 2.5) * 0.16
    rigid(rig, 'Hips', new THREE.CapsuleGeometry(0.045, 0.16, 3, 10), i % 2 ? dark : feathers, [Math.sin(a) * 0.12, hipsY - 0.06, -0.21 - Math.cos(a) * 0.05], [-Math.PI / 2 - 0.55, 0, a], [1, 1, 0.16])
  }
  const B: Body = { rig, skin: feathers, hc, hipsY, neckY, chestY, kneeY, headY }
  const face = () => new Face(rig, {
    bone: 'Head',
    eyes: { at: [kind === 'parrot' ? 0.05 : 0.048, hc.y + 0.018, hc.z + (kind === 'parrot' ? 0.075 : 0.07)], r: kind === 'parrot' ? 0.026 : 0.03, squash: [1, 1, 0.8], iris: s.kit.face.iris || col.iris, irisR: 0.02, pupilR: 0.009, spread: 0.45, ...(kind === 'parrot' ? { white: '#fbfaf3' } : {}) },
    lids: { color: col.head },
    brows: { color: s.kit.face.brow || col.dark, size: [0.04, 0.009, 0.008], up: 0.034, tilt: 0.45 },
    mouth: { at: [0, hc.y - 0.02, hc.z + 0.02], size: [0.02, 0.01], colors: { line: '#000000', inside: '#000000', teeth: '#000000', tongue: '#000000' } },
    jaw: { at: [0, 0, 0], mesh: jaw, open: 0.5 },
  })
  return { B, S: { rows, head: { c: hc, r: hr, front: hr * 1.1, top: hr * 1.02, ear: hr * 0.94 } }, face }
}

// ---------------------------------------------------------------- head: hair, beards, hats, glasses, earrings

function hairOf(B: Body, S: Shape, M: Mats, h: NonNullable<KitRecipe['hair']>, hat: boolean) {
  const { rig } = B, c = S.head.c, m = M.get(h.color, 'matte'), R = rig
  const ball = (r: number, at: V3, sc: V3 = [1, 1, 1]) => rigid(R, 'Head', new THREE.SphereGeometry(r, 10, 8), m, at, [0, 0, 0], sc)
  switch (h.style) {
    case 'none': return
    case 'short': hairCap(B, m); break
    case 'slick': hairCap(B, m, { front: 0.46, scale: [0.99, 1.07, 1.1] }); break
    case 'tousled': hairCap(B, m, { scale: [1.02, 1.12, 1.1] }); for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2; ball(0.034, [Math.cos(a) * 0.055, c.y + 0.1 + (i % 2) * 0.012, c.z + 0.02 + Math.sin(a) * 0.055], [1.2, 0.8, 1.2]) } break
    case 'shaggy': hairCap(B, m, { scale: [1.07, 1.14, 1.14] }); ball(0.1, [0, c.y - 0.02, c.z - 0.045], [1.1, 0.95, 0.75]); for (let i = 0; i < 5; i++) ball(0.03, [-0.06 + i * 0.03, c.y + 0.085, c.z + 0.075], [1, 1.3, 0.8]); for (const k of [1, -1]) ball(0.04, [k * 0.09, c.y - 0.03, c.z - 0.01], [0.6, 1.3, 0.9]); break
    case 'curly': case 'wild': {
      const wild = h.style === 'wild'
      hairCap(B, m, { front: 0.48, scale: [1.03, 1.12, 1.1] })
      const n = wild ? 22 : 20
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2, ring = i % 2, r = wild ? 0.1 + ring * 0.025 : 0.09
        if (!wild && Math.sin(a) > 0.75) continue   // keep the forehead clear
        if (wild && Math.sin(a) > 0.85) continue
        ball(wild ? 0.05 + hash2(i, 1, 3) * 0.015 : 0.034, [Math.cos(a) * r, c.y + (wild ? 0.03 + ring * 0.06 : 0.06 + ring * 0.035), c.z - 0.01 + Math.sin(a) * r])
      }
      if (wild) for (let i = 0; i < 6; i++) ball(0.05, [-0.06 + (i % 3) * 0.06, c.y + 0.12, c.z - 0.04 + Math.floor(i / 3) * 0.05])
      break
    }
    case 'bun': case 'manbun': {
      hairCap(B, m, { scale: [1.0, 1.1, 1.1] })
      const top = h.bun !== 'back', r = h.style === 'manbun' ? 0.04 : 0.052, at: V3 = top ? [0, c.y + 0.125, c.z - 0.035] : [0, c.y + 0.03, c.z - 0.115]
      ball(r, at)
      if (h.bun === 'messy') for (let i = 0; i < 4; i++) ball(0.022, [at[0] + Math.cos(i * 1.7) * 0.04, at[1] + 0.02, at[2] + Math.sin(i * 1.7) * 0.04])
      if (h.tie) rigid(R, 'Head', new THREE.TorusGeometry(r * 0.75, 0.011, 6, 16), M.get(h.tie, 'cloth'), [at[0], at[1] - r * 0.6, at[2]], [Math.PI / 2, 0, 0])
      break
    }
    case 'bob': {
      rigid(R, 'Head', new THREE.SphereGeometry(0.112, 24, 14, Math.PI / 2 + 0.62, Math.PI * 2 - 1.24, 0, Math.PI * 0.66), m, [0, c.y + 0.01, c.z - 0.008], [0, 0, 0], [1.1, 1.14, 1.12])
      rigid(R, 'Head', new THREE.SphereGeometry(0.114, 18, 8, Math.PI / 2 - 0.75, 1.5, Math.PI * 0.12, Math.PI * 0.2), m, [0, c.y + 0.012, c.z - 0.006], [0, 0, 0], [1.02, 1.12, 1.1])   // the bangs
      break
    }
    case 'braid': {
      hairCap(B, m, { scale: [1.03, 1.12, 1.1] })
      for (const k of [1, -1]) ball(0.05, [k * 0.08, c.y + 0.0, c.z - 0.02], [0.6, 1.2, 1])   // waves over the ears
      for (let i = 0; i < 6; i++) ball(0.026, [-0.085 - i * 0.008, c.y - 0.06 - i * 0.045, c.z + 0.01 + i * 0.012])   // the braid over the shoulder
      break
    }
    case 'thin': {
      rigid(R, 'Head', new THREE.TorusGeometry(0.085, 0.026, 8, 24, Math.PI * 1.25), m, [0, c.y + 0.02, c.z - 0.02], [Math.PI / 2 + 0.3, 0, Math.PI * 0.375 + Math.PI])
      for (let i = 0; i < 4; i++) ball(0.02, [-0.03 + i * 0.02, c.y + 0.112, c.z - 0.01 + (i % 2) * 0.02], [1.4, 0.5, 1])
      break
    }
    case 'ponytail': {
      hairCap(B, m)
      const t = capsuleBetween([0, c.y + 0.05, c.z - 0.1], [0, c.y - 0.1, c.z - 0.16], 0.03)
      rigid(R, 'Head', t.geo, m, t.mid, [t.rot.x, t.rot.y, t.rot.z])
      if (h.tie) rigid(R, 'Head', new THREE.TorusGeometry(0.03, 0.01, 6, 14), M.get(h.tie, 'cloth'), [0, c.y + 0.04, c.z - 0.105], [0.6, 0, 0])
      break
    }
    case 'afro': {
      // A big round afro, behind and above the face (the forehead and eyes stay clear), lumpy all over.
      hairCap(B, m, { front: 0.46, scale: [1.02, 1.1, 1.08] })
      const at: V3 = [0, c.y + 0.08, c.z - 0.09]
      ball(0.17, at, [1.25, 1.12, 1.0])
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2, e = (hash2(i, 2, 7) - 0.3) * 1.2
        const x = Math.sin(a) * Math.cos(e), y = Math.sin(e), z = Math.cos(a) * Math.cos(e)
        if (z > 0.55 && y < 0.5) continue
        ball(0.065, [at[0] + x * 0.2, at[1] + y * 0.17, at[2] + z * 0.16])
      }
      break
    }
    case 'long': {
      // Long hair to the shoulders, waves down the back and over the ears.
      hairCap(B, m, { scale: [1.04, 1.12, 1.1] })
      const t = capsuleBetween([0, c.y + 0.02, c.z - 0.08], [0, c.y - 0.2, c.z - 0.11], 0.085)
      rigid(R, 'Head', t.geo, m, t.mid, [t.rot.x, t.rot.y, t.rot.z], [1.25, 1, 0.8])
      for (const k of [1, -1]) for (let i = 0; i < 4; i++) ball(0.042, [k * (0.088 + i * 0.008), c.y + 0.0 - i * 0.06, c.z - 0.02 - i * 0.012], [0.8, 1.1, 0.9])
      for (let i = 0; i < 5; i++) ball(0.05, [-0.08 + i * 0.04, c.y - 0.2, c.z - 0.1], [1, 0.9, 0.8])
      break
    }
    case 'buzz': hairCap(B, m, { front: 0.45, scale: [0.97, 1.04, 1.03] }); break
    case 'wavyShort': hairCap(B, m, { scale: [1.04, 1.1, 1.1] }); for (const k of [1, -1]) ball(0.04, [k * 0.088, c.y + 0.0, c.z - 0.03], [0.7, 1.1, 1.1]); ball(0.07, [0, c.y - 0.01, c.z - 0.075], [1.2, 0.9, 0.6]); break
    default: hairCap(B, m)
  }
  void hat
}

function beardOf(B: Body, S: Shape, M: Mats, b: NonNullable<KitRecipe['beard']>) {
  const R = B.rig, c = S.head.c, m = M.get(b.color, 'matte')
  const roll = (r: number, out: number, drop: number) => { for (const k of [1, -1]) { const q = capsuleBetween([0, c.y - 0.036, c.z + 0.104], [k * out, c.y - 0.036 - drop, c.z + 0.09], r); rigid(R, 'Head', q.geo, m, q.mid, [q.rot.x, q.rot.y, q.rot.z]) } }
  switch (b.style) {
    case 'moustache': roll(0.014, 0.05, 0.014); break
    case 'big': roll(0.02, 0.062, 0.012); break
    case 'curl': roll(0.019, 0.06, -0.004); for (const k of [1, -1]) rigid(R, 'Head', new THREE.TorusGeometry(0.012, 0.007, 6, 10, Math.PI * 1.2), m, [k * 0.068, c.y - 0.03, c.z + 0.088], [0, k * 0.4, k > 0 ? 0 : Math.PI]); break
    case 'thin': roll(0.007, 0.05, 0.025); break
    case 'goatee': roll(0.008, 0.045, 0.012); rigid(R, 'Head', new THREE.ConeGeometry(0.028, 0.07, 10), m, [0, c.y - 0.115, c.z + 0.075], [Math.PI + 0.35, 0, 0]); break
    case 'beard': roll(0.012, 0.048, 0.012); rigid(R, 'Head', new THREE.SphereGeometry(0.1, 20, 14, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), m, [0, c.y - 0.035, c.z + 0.02], [0.25, 0, 0], [0.97, 0.95, 0.98]); break
    case 'stubble': rigid(R, 'Head', new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, Math.PI * 0.58, Math.PI * 0.42), surface('stubble', { color: b.color, roughness: 1, opacity: 0.45 }), [0, c.y - 0.03, c.z + 0.012], [0.2, 0, 0], [0.96, 1.1, 1.04]); break
  }
}

function hatOf(B: Body, S: Shape, M: Mats, h: NonNullable<KitRecipe['hat']>) {
  const R = B.rig, c = S.head.c, k = S.head.r / 0.1, m = M.get(h.color, h.kind === 'straw' ? 'matte' : 'cloth'), brim = M.get(h.brim ?? h.color, 'cloth'), band = M.get(h.band ?? h.color, 'cloth')
  const at = (x: number, y: number, z: number): V3 => [x * k, c.y + y * k, c.z + z * k]
  const put = (g: THREE.BufferGeometry, mat: Mat, p: V3, r: V3 = [0, 0, 0], sc: V3 = [1, 1, 1]) => rigid(R, 'Head', g, mat, p, r, sc)
  const half = (r: number, h2: number, front: boolean) => new THREE.CylinderGeometry(r * k, r * k, h2 * k, 18, 1, false, front ? -Math.PI / 2 : Math.PI / 2, Math.PI)
  switch (h.kind) {
    case 'backcap': case 'cap': {
      put(new THREE.SphereGeometry(0.113 * k, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), m, at(0, 0.035, -0.005), [-0.12, 0, 0], [1, 1.02, 1.06])
      if (h.kind === 'backcap') put(half(0.075, 0.012, false), brim, at(0, 0.045, -0.1), [-0.25, 0, 0], [1.1, 1, 1.15])
      else put(half(0.08, 0.012, true), brim, at(0, 0.045, 0.1), [0.22, 0, 0], [1.1, 1, 1.2])
      put(new THREE.SphereGeometry(0.012 * k, 8, 6), m, at(0, 0.142, -0.01))
      break
    }
    case 'beret': put(new THREE.SphereGeometry(0.122 * k, 22, 12), m, at(0.018, 0.095, -0.005), [-0.1, 0, 0.2], [1.16, 0.4, 1.16]); put(new THREE.CylinderGeometry(0.006 * k, 0.006 * k, 0.025 * k), m, at(0.03, 0.145, 0)); break
    case 'flatcap': put(new THREE.SphereGeometry(0.114 * k, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), m, at(0, 0.04, 0.008), [0.12, 0, 0], [1.04, 0.72, 1.14]); put(half(0.078, 0.012, true), brim, at(0, 0.052, 0.098), [0.4, 0, 0], [1.15, 1, 0.75]); break
    case 'peaked': {
      put(new THREE.CylinderGeometry(0.118 * k, 0.105 * k, 0.075 * k, 22), m, at(0, 0.088, -0.005), [-0.08, 0, 0])
      put(new THREE.CylinderGeometry(0.107 * k, 0.107 * k, 0.016 * k, 22), band, at(0, 0.062, -0.003), [-0.08, 0, 0])
      put(half(0.082, 0.009, true), M.get(h.brim ?? '#141414', 'gloss'), at(0, 0.054, 0.088), [0.28, 0, 0], [1.1, 1, 1])
      break
    }
    case 'sunhat': case 'straw': {
      const r = h.kind === 'straw' ? 0.24 : 0.25
      put(new THREE.CylinderGeometry(0.096 * k, 0.106 * k, 0.09 * k, 20), m, at(0, 0.1, -0.005), [-0.06, 0, 0])
      put(new THREE.CylinderGeometry(r * k, r * k, 0.008 * k, 28), brim, at(0, 0.058, 0), [-0.06, 0, 0])
      put(new THREE.TorusGeometry(r * k, 0.006 * k, 5, 28), brim, at(0, 0.056, 0), [Math.PI / 2 - 0.06, 0, 0])
      put(new THREE.CylinderGeometry(0.108 * k, 0.108 * k, 0.026 * k, 20), band, at(0, 0.074, -0.004), [-0.06, 0, 0])
      if (h.flower) {
        // A big flower on the band at the side.
        const fm = M.get(h.flower, 'matte')
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; put(new THREE.SphereGeometry(0.03 * k, 8, 6), fm, at(0.09 + Math.cos(a) * 0.026, 0.1 + Math.sin(a) * 0.026, 0.035), [0, 0, 0], [1, 1, 0.5]) }
        put(new THREE.SphereGeometry(0.018 * k, 8, 6), M.get('#f2c84a', 'matte'), at(0.092, 0.1, 0.05))
        for (const d of [-1, 1]) put(new THREE.SphereGeometry(0.03 * k, 8, 6), M.get('#3a8a5a', 'matte'), at(0.09 + d * 0.05, 0.075, 0.02), [0, 0, d * 0.6], [1.5, 0.5, 0.4])
      }
      break
    }
    case 'fedora': {
      put(new THREE.CylinderGeometry(0.092 * k, 0.106 * k, 0.11 * k, 20), m, at(0, 0.11, -0.005), [-0.08, 0, 0], [1, 1, 1.12])
      put(new THREE.SphereGeometry(0.092 * k, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.2), m, at(0, 0.13, -0.005), [-0.08, 0, 0], [1, 0.6, 1.12])
      put(new THREE.CylinderGeometry(0.16 * k, 0.16 * k, 0.01 * k, 24), brim, at(0, 0.056, 0), [-0.08, 0, 0], [1, 1, 1.08])
      put(new THREE.CylinderGeometry(0.108 * k, 0.108 * k, 0.024 * k, 20), band, at(0, 0.072, -0.004), [-0.08, 0, 0], [1, 1, 1.12])
      break
    }
    case 'beanie': put(new THREE.SphereGeometry(0.114 * k, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), M.get(h.color, 'knit'), at(0, 0.03, 0), [-0.12, 0, 0], [1, 1.16, 1.08]); put(new THREE.CylinderGeometry(0.118 * k, 0.118 * k, 0.045 * k, 22, 1, true), M.get(h.color, 'knit'), at(0, 0.04, 0), [-0.12, 0, 0], [1, 1, 1.07]); break
    case 'baker': put(new THREE.CylinderGeometry(0.11 * k, 0.106 * k, 0.13 * k, 20), m, at(0, 0.115, -0.005), [-0.06, 0, 0]); put(new THREE.CylinderGeometry(0.108 * k, 0.108 * k, 0.03 * k, 20), band, at(0, 0.062, -0.004), [-0.06, 0, 0]); break
    case 'sombrero': {
      put(new THREE.CylinderGeometry(0.07 * k, 0.102 * k, 0.17 * k, 20), m, at(0, 0.14, -0.01), [-0.05, 0, 0])
      put(new THREE.CylinderGeometry(0.4 * k, 0.4 * k, 0.012 * k, 36), brim, at(0, 0.066, 0), [-0.05, 0, 0])
      put(new THREE.TorusGeometry(0.4 * k, 0.022 * k, 8, 40), brim, at(0, 0.085, 0), [Math.PI / 2 - 0.05, 0, 0])
      const trim = M.get(h.trim ?? '#e8e4da', 'metal')
      put(new THREE.TorusGeometry(0.104 * k, 0.008 * k, 6, 24), trim, at(0, 0.07, -0.01), [Math.PI / 2 - 0.05, 0, 0])
      put(new THREE.TorusGeometry(0.29 * k, 0.006 * k, 6, 36), trim, at(0, 0.074, 0), [Math.PI / 2 - 0.05, 0, 0])
      put(new THREE.TorusGeometry(0.2 * k, 0.005 * k, 6, 30), trim, at(0, 0.074, 0), [Math.PI / 2 - 0.05, 0, 0])
      break
    }
    case 'bandana': {
      const cm = M.paint(h.trim ? { color: h.color, pattern: { kind: 'dots', colors: [h.trim], scale: 0.8 } } : h.color)
      put(new THREE.TorusGeometry(0.106 * k, 0.024 * k, 8, 26), cm, at(0, 0.05, -0.01), [Math.PI / 2 + 0.3, 0, 0], [1, 1.05, 1])
      for (const s2 of [1, -1]) put(new THREE.SphereGeometry(0.03 * k, 10, 8), cm, at(s2 * 0.028, 0.135, 0.035), [0, 0, s2 * -0.6], [0.7, 1.2, 0.45])
      break
    }
    case 'visor': {
      put(new THREE.TorusGeometry(0.104 * k, 0.009 * k, 6, 24), band, at(0, 0.06, 0), [Math.PI / 2 + 0.12, 0, 0], [1, 1.08, 1])
      put(half(0.11, 0.008, true), m, at(0, 0.06, 0.07), [0.2, 0, 0], [1, 1, 0.95])
      break
    }
    case 'captain': {
      put(new THREE.CylinderGeometry(0.122 * k, 0.104 * k, 0.07 * k, 22), m, at(0, 0.088, 0), [-0.1, 0, 0], [1, 1, 1.08])
      put(half(0.08, 0.009, true), m, at(0, 0.054, 0.09), [0.3, 0, 0], [1.1, 1, 1])
      put(new THREE.CylinderGeometry(0.106 * k, 0.106 * k, 0.014 * k, 22), band, at(0, 0.062, 0), [-0.1, 0, 0])
      if (h.trim) put(new THREE.SphereGeometry(0.016 * k, 10, 8), M.get(h.trim, 'metal'), at(0, 0.075, 0.112), [0, 0, 0], [1.3, 1, 0.5])   // the badge
      break
    }
    case 'bucket': {
      put(new THREE.CylinderGeometry(0.1 * k, 0.112 * k, 0.085 * k, 20), m, at(0, 0.1, -0.005), [-0.08, 0, 0])
      put(new THREE.SphereGeometry(0.1 * k, 18, 6, 0, Math.PI * 2, 0, Math.PI * 0.3), m, at(0, 0.125, -0.005), [-0.08, 0, 0], [1, 0.5, 1])
      put(new THREE.CylinderGeometry(0.114 * k, 0.17 * k, 0.05 * k, 22, 1, true), brim, at(0, 0.045, 0), [-0.08, 0, 0])
      put(new THREE.CylinderGeometry(0.113 * k, 0.113 * k, 0.022 * k, 20), band, at(0, 0.072, -0.004), [-0.08, 0, 0])
      break
    }
    case 'feather': {
      // No hat: a feather stuck in the hair (Kenji's).
      put(new THREE.SphereGeometry(0.05 * k, 10, 7), m, at(-0.03, 0.19, -0.03), [0.25, 0, 0.3], [0.24, 1.35, 0.06])
      put(new THREE.CylinderGeometry(0.0035 * k, 0.0035 * k, 0.15 * k, 4), M.get('#4a4640', 'matte'), at(-0.025, 0.18, -0.03), [0.25, 0, 0.3])
      break
    }
    case 'hairnet': {
      // A net over the hair: see-through, a shade lighter, its elastic at the hairline.
      const net = surface('hairnet', { color: h.color, roughness: 1, opacity: 0.45 })
      put(new THREE.SphereGeometry(0.135 * k, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), net, at(0, 0.03, -0.012), [-0.15, 0, 0], [1.08, 1.02, 1.1])
      put(new THREE.TorusGeometry(0.118 * k, 0.005 * k, 4, 26), M.get(h.band ?? h.color, 'cloth'), at(0, 0.03, -0.01), [Math.PI / 2 - 0.15, 0, 0], [1.05, 1.1, 1])
      break
    }
    case 'cone': {
      // A traffic cone worn as a hat: orange, two white reflective bands, the square foot at the brow.
      put(new THREE.ConeGeometry(0.1 * k, 0.32 * k, 20), m, at(0, 0.24, 0), [-0.05, 0, 0])
      const white = M.get('#f4f4f0', 'gloss')
      for (const [y, r] of [[0.2, 0.072], [0.28, 0.048]] as const) put(new THREE.CylinderGeometry(r * k, (r + 0.008) * k, 0.03 * k, 20, 1, true), white, at(0, y, 0), [-0.05, 0, 0])
      put(new THREE.BoxGeometry(0.24 * k, 0.02 * k, 0.24 * k), m, at(0, 0.07, 0), [-0.05, 0, 0])
      break
    }
  }
}

function glassesOf(B: Body, S: Shape, M: Mats, g: NonNullable<KitRecipe['glasses']>, bird: boolean) {
  const R = B.rig, c = S.head.c, f = M.get(g.color, 'gloss'), lens = M.get(g.lens ?? '#15171b', 'glass')
  // Pushed up: on the hair above the forehead.
  const y = c.y + 0.02 + (g.up ? 0.098 : 0), z = c.z + S.head.front + 0.004 - (g.up ? 0.032 : 0), gap = bird ? 0.052 : 0.037
  const parts: THREE.Mesh[] = []
  const put = (geo: THREE.BufferGeometry, m: Mat, at: V3, r: V3 = [0, 0, 0], sc: V3 = [1, 1, 1]) => { const x = rigid(R, 'Head', geo, m, at, r, sc); x.castShadow = false; parts.push(x) }
  const big = g.kind === 'bigsun' ? 1.3 : bird ? 1.35 : 1
  for (const k of [1, -1]) {
    const x = k * gap * (g.kind === 'bigsun' ? 1.12 : 1)
    switch (g.kind) {
      case 'round': put(new THREE.TorusGeometry(0.024, 0.0035, 6, 18), f, [x, y, z]); break
      case 'cateye':
        if (g.lens) put(new THREE.CylinderGeometry(0.023, 0.023, 0.005, 16), lens, [x, y, z - 0.001], [Math.PI / 2, 0, k * 0.25], [1.28, 1, 0.85])   // cat-eye sunglasses
        put(new THREE.TorusGeometry(0.024, 0.0045, 6, 16), f, [x, y, z], [0, 0, k * 0.25], [1.28, 0.85, 1]); put(new THREE.ConeGeometry(0.009, 0.022, 6), f, [k * (gap + 0.027), y + 0.016, z - 0.002], [0, 0, k * -0.9]); break
      case 'star': {
        // Disco star shades: a five-point star each eye, the frame round a dark lens.
        const star = (ro: number, ri: number) => { const sh = new THREE.Shape(); for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + (i / 10) * Math.PI * 2, r = i % 2 ? ri : ro; if (i) sh.lineTo(Math.cos(a) * r, Math.sin(a) * r); else sh.moveTo(Math.cos(a) * r, Math.sin(a) * r) } return new THREE.ShapeGeometry(sh) }
        put(star(0.036, 0.017), f, [x * 1.12, y, z])
        put(star(0.026, 0.012), lens, [x * 1.12, y, z + 0.002])
        break
      }
      case 'square': put(new THREE.TorusGeometry(0.027, 0.006, 4, 4), f, [x, y, z], [0, 0, Math.PI / 4], [1.25, 0.95, 1]); break
      case 'sun': case 'bigsun': case 'roundsun':
        put(new THREE.CylinderGeometry(0.025 * big, 0.025 * big, 0.006, 18), lens, [x, y - 0.002, z], [Math.PI / 2, 0, 0], g.kind === 'roundsun' ? [1, 1, 1] : [1.22, 1, 0.85])
        put(new THREE.TorusGeometry(0.025 * big, 0.0035, 6, 18), f, [x, y - 0.002, z + 0.003], [0, 0, 0], g.kind === 'roundsun' ? [1, 1, 1] : [1.22, 0.85, 1])
        break
      case 'goggles':
        put(new THREE.CylinderGeometry(0.03, 0.032, 0.022, 18), lens, [x, y, z + 0.004], [Math.PI / 2, 0, 0])
        put(new THREE.TorusGeometry(0.031, 0.006, 6, 18), f, [x, y, z + 0.015])
        break
    }
    if (g.kind !== 'goggles') put(new THREE.BoxGeometry(0.006, 0.006, 0.09), f, [k * (gap + 0.03 * big), y + 0.004, z - 0.045])
  }
  put(new THREE.BoxGeometry(g.kind === 'bigsun' ? 0.03 : 0.018, 0.005, 0.005), f, [0, y + 0.004, z + 0.002])
  if (g.kind === 'goggles') put(new THREE.TorusGeometry(S.head.r * 1.02, 0.008, 6, 28), M.get('#2a2b2e', 'matte'), [0, y, c.z], [Math.PI / 2, 0, 0], [1, 1.1, 1])
}

function earringsOf(B: Body, S: Shape, M: Mats, e: NonNullable<KitRecipe['earrings']>) {
  const R = B.rig, c = S.head.c, m = M.get(e.color, e.kind === 'hoop' ? 'metal' : 'gloss')
  for (const k of [1, -1]) {
    const x = k * (S.head.ear + 0.006)
    if (e.kind === 'hoop') rigid(R, 'Head', new THREE.TorusGeometry(0.02, 0.003, 6, 16), m, [x, c.y - 0.06, c.z], [0, Math.PI / 2, 0])
    else if (e.kind === 'geo') rigid(R, 'Head', new THREE.BoxGeometry(0.005, 0.034, 0.022), m, [x, c.y - 0.07, c.z])
    else { rigid(R, 'Head', new THREE.SphereGeometry(e.kind === 'drop' ? 0.013 : 0.01, 8, 6), m, [x, c.y - (e.kind === 'drop' ? 0.058 : 0.036), c.z]) }
  }
}

// ---------------------------------------------------------------- tops and layers

function neckOf(B: Body, S: Shape, M: Mats, kind: string, top: Mat, collar: Mat) {
  const R = B.rig, { neckY } = B
  const fz = frontAt(S, neckY - 0.06)
  switch (kind) {
    case 'turtleneck': rigid(R, 'Neck', new THREE.CylinderGeometry(0.066, 0.075, 0.085, 18), top, [0, neckY + 0.03, 0.005]); break
    case 'collar': for (const k of [1, -1]) rigid(R, 'UpperChest', new THREE.BoxGeometry(0.06, 0.008, 0.045), collar, [k * 0.035, neckY - 0.02, fz - 0.012], [-0.9, k * 0.5, k * -0.5]); break
    case 'hood': rigid(R, 'UpperChest', new THREE.TorusGeometry(0.09, 0.04, 10, 20), top, [0, neckY + 0.01, -0.035], [Math.PI / 2 - 0.4, 0, 0], [1.1, 1, 1]); break
    case 'halfzip': rigid(R, 'UpperChest', new THREE.CylinderGeometry(0.075, 0.082, 0.055, 18), top, [0, neckY + 0.02, 0]); rigid(R, 'UpperChest', new THREE.BoxGeometry(0.008, 0.13, 0.004), collar, [0, neckY - 0.05, fz + 0.004]); break
  }
}

/** The garments over the top: each kind from the torso's own shape. */
function layerOf(B: Body, S: Shape, M: Mats, L: KitLayer, topM: Mat) {
  const R = B.rig, { hipsY, neckY, chestY, kneeY } = B
  const m = M.paint(L.pattern ? { color: L.color, pattern: L.pattern } : L.color, L.kind === 'cardigan' ? 'knit' : L.kind === 'puffer' ? 'puffer' : 'cloth')
  const c2 = M.get(L.color2 ?? L.color, 'cloth')
  const inner = L.inner ? M.get(L.inner, 'cloth') : topM
  switch (L.kind) {
    case 'vest': case 'puffer': case 'hivis': {
      shell(B, S, hipsY - 0.03, neckY - 0.03, L.kind === 'puffer' ? 0.03 : 0.012, m)
      if (L.kind === 'hivis') for (const y of [hipsY + 0.1, chestY + 0.02]) { const [rx, rz, dz] = rowAt(S.rows, y); rigid(R, y < chestY ? 'Spine' : 'Chest', new THREE.CylinderGeometry(1, 1, 0.035, 26, 1, true), c2, [0, y, dz], [0, 0, 0], [rx + 0.016, 1, rz + 0.016]) }
      if (L.inner) frontStrip(B, S, hipsY - 0.02, neckY - 0.06, L.kind === 'puffer' ? 0.03 : 0.012, 0.05, inner)
      break
    }
    case 'cardigan': case 'jacket': case 'denim': {
      shell(B, S, hipsY - (L.kind === 'cardigan' ? 0.06 : 0.1), neckY - 0.03, 0.014, m)
      frontStrip(B, S, hipsY - (L.kind === 'cardigan' ? 0.05 : 0.09), neckY - 0.05, 0.016, 0.06, inner)
      if (L.color2) for (const k of [1, -1]) frontStrip2(B, S, k * 0.038, hipsY - 0.05, neckY - 0.05, 0.017, 0.012, c2)
      if (L.kind === 'cardigan') for (const dy of [0.04, 0.12, 0.2]) rigid(R, 'Spine', new THREE.SphereGeometry(0.008, 8, 6), M.get('#efe8d8', 'gloss'), [0.04, hipsY + dy, frontAt(S, hipsY + dy) + 0.017])
      break
    }
    case 'coat': case 'labcoat': {
      shell(B, S, hipsY - 0.04, neckY - 0.025, 0.016, m, { hem: kneeY - (L.kind === 'labcoat' ? 0.02 : 0.06), flare: 1.18 })
      frontStrip(B, S, hipsY + 0.02, neckY - 0.05, 0.018, L.kind === 'labcoat' ? 0.08 : 0.04, inner)
      if (L.kind === 'labcoat') rigid(R, 'Chest', new THREE.BoxGeometry(0.06, 0.07, 0.006), m, [0.08, chestY - 0.02, frontAt(S, chestY - 0.02) + 0.02])   // the breast pocket
      for (const k of [1, -1]) rigid(R, 'UpperChest', new THREE.BoxGeometry(0.06, 0.12, 0.012), m, [k * 0.07, neckY - 0.07, frontAt(S, neckY - 0.07) + 0.012], [-0.2, 0, k * -0.35])   // lapels
      break
    }
    case 'apron': {
      // A bib on the chest, the skirt from the waist to the knee, a strap round the neck, ties at the back.
      const fz = (y: number) => frontAt(S, y) + 0.014
      const zb = Math.max(fz(hipsY + 0.02), fz(hipsY + 0.12))
      rigid(R, 'Chest', new THREE.PlaneGeometry(0.2, neckY - 0.07 - (hipsY + 0.12)), m, [0, (neckY - 0.07 + hipsY + 0.12) / 2, Math.max(fz(chestY), fz(hipsY + 0.2))], [-0.06, 0, 0])
      rigid(R, 'Hips', new THREE.CylinderGeometry(0.26, 0.29, hipsY + 0.12 - (kneeY - 0.04), 22, 1, true, -0.75, 1.5), m, [0, (hipsY + 0.12 + kneeY - 0.04) / 2, zb - 0.26], [0, 0, 0], [1, 1, 1])
      rigid(R, 'Neck', new THREE.TorusGeometry(0.09, 0.008, 5, 18, Math.PI), m, [0, neckY - 0.03, 0.03], [-0.35, 0, Math.PI])
      const [rx, rz, dz] = rowAt(S.rows, hipsY + 0.08)
      rigid(R, 'Spine', new THREE.CylinderGeometry(1, 1, 0.025, 24, 1, true), m, [0, hipsY + 0.1, dz], [0, 0, 0], [rx + 0.012, 1, rz + 0.012])
      break
    }
    case 'overalls': {
      const y0 = hipsY + 0.05, y1 = chestY + 0.05
      rigid(R, 'Spine', new THREE.PlaneGeometry(0.2, y1 - y0), m, [0, (y0 + y1) / 2, Math.max(frontAt(S, y0), frontAt(S, y1)) + 0.012], [-0.04, 0, 0])
      for (const k of [1, -1]) {
        const c = capsuleBetween([k * 0.085, y1, frontAt(S, y1) + 0.01], [k * 0.1, neckY - 0.02, -0.02], 0.014)
        rigid(R, 'UpperChest', c.geo, m, c.mid, [c.rot.x, c.rot.y, c.rot.z], [1, 1, 0.4])
        rigid(R, 'Chest', new THREE.SphereGeometry(0.012, 8, 6), M.get('#d8b04a', 'metal'), [k * 0.085, y1 - 0.01, frontAt(S, y1) + 0.018])
      }
      const [rx, rz, dz] = rowAt(S.rows, hipsY + 0.04)
      rigid(R, 'Hips', new THREE.CylinderGeometry(1, 1, 0.12, 24, 1, true), m, [0, hipsY + 0.02, dz], [0, 0, 0], [rx + 0.01, 1, rz + 0.01])
      break
    }
    case 'scarf': {
      rigid(R, 'Neck', new THREE.TorusGeometry(0.07, 0.022, 8, 20), m, [0, neckY + 0.0, 0.01], [Math.PI / 2 + 0.25, 0, 0])
      const fz = frontAt(S, neckY - 0.05) + 0.02
      rigid(R, 'UpperChest', new THREE.ConeGeometry(0.04, 0.09, 4), m, [0.0, neckY - 0.07, fz], [Math.PI, Math.PI / 4, 0.1], [1, 1, 0.35])
      for (const k of [1, -1]) rigid(R, 'UpperChest', new THREE.SphereGeometry(0.022, 8, 6), m, [k * 0.022, neckY - 0.03, fz], [0, 0, 0], [1.3, 0.8, 0.6])
      break
    }
    case 'bowtie': case 'tie': {
      const fz = frontAt(S, neckY - 0.05) + 0.012
      if (L.kind === 'bowtie') for (const k of [1, -1]) rigid(R, 'UpperChest', new THREE.ConeGeometry(0.025, 0.05, 4), m, [k * 0.025, neckY - 0.035, fz], [0, 0, k * Math.PI / 2], [1, 1, 0.5])
      else { const y0 = neckY - 0.04, y1 = hipsY + 0.12; rigid(R, 'Chest', new THREE.BoxGeometry(0.045, y0 - y1, 0.008), m, [0, (y0 + y1) / 2, Math.max(frontAt(S, y0), frontAt(S, (y0 + y1) / 2)) + 0.012], [-0.08, 0, 0]) }
      rigid(R, 'UpperChest', new THREE.SphereGeometry(0.014, 8, 6), m, [0, neckY - 0.035, fz + 0.004])
      break
    }
    case 'headphones': {
      rigid(R, 'UpperChest', new THREE.TorusGeometry(0.1, 0.01, 6, 20, Math.PI * 1.2), m, [0, neckY - 0.01, 0.0], [Math.PI / 2 + 0.25, 0, -Math.PI * 0.1 + Math.PI])
      for (const k of [1, -1]) rigid(R, 'UpperChest', new THREE.CylinderGeometry(0.04, 0.04, 0.03, 16), m, [k * 0.085, neckY - 0.06, frontAt(S, neckY - 0.06) + 0.01], [Math.PI / 2 - 0.3, 0, k * 0.4])
      break
    }
    case 'lanyard': {
      const fz = frontAt(S, chestY) + 0.012
      for (const k of [1, -1]) { const c = capsuleBetween([k * 0.06, neckY - 0.01, 0.06], [k * 0.012, chestY - 0.04, fz], 0.005); rigid(R, 'UpperChest', c.geo, m, c.mid, [c.rot.x, c.rot.y, c.rot.z]) }
      rigid(R, 'Chest', new THREE.BoxGeometry(0.06, 0.085, 0.005), c2, [0, chestY - 0.09, fz + 0.004])
      break
    }
    case 'straps': case 'bag': {
      if (L.kind === 'straps') for (const k of [1, -1]) { const c = capsuleBetween([k * 0.09, hipsY + 0.1, frontAt(S, hipsY + 0.1) + 0.008], [k * 0.11, neckY - 0.01, 0.0], 0.014); rigid(R, 'Chest', c.geo, m, c.mid, [c.rot.x, c.rot.y, c.rot.z], [1, 1, 0.4]) }
      else { const c = capsuleBetween([-0.15, hipsY + 0.02, frontAt(S, hipsY + 0.02) + 0.01], [0.12, neckY - 0.02, frontAt(S, neckY - 0.06) + 0.005], 0.016); rigid(R, 'Chest', c.geo, m, c.mid, [c.rot.x, c.rot.y, c.rot.z], [1, 1, 0.4]) }
      const [, rz] = rowAt(S.rows, hipsY + 0.15)
      rigid(R, 'Chest', new THREE.BoxGeometry(L.kind === 'bag' ? 0.32 : 0.28, L.kind === 'bag' ? 0.22 : 0.32, 0.12), c2, L.kind === 'bag' ? [-0.12, hipsY - 0.02, -rz - 0.04] : [0, hipsY + 0.2, -rz - 0.06])
      break
    }
    case 'fur': {
      rigid(R, 'UpperChest', new THREE.TorusGeometry(0.1, 0.045, 10, 22), m, [0, neckY - 0.025, 0.0], [Math.PI / 2 + 0.2, 0, 0], [1.05, 1, 1])
      for (const side of ['Left', 'Right']) { const w = R.at(`${side}Hand`), e = R.at(`${side}ForeArm`); rigid(R, `${side}ForeArm`, new THREE.CylinderGeometry(0.06, 0.06, 0.07, 14), m, [e.x + (w.x - e.x) * 0.8, w.y, w.z], [0, 0, Math.PI / 2]) }
      break
    }
    case 'burrito': {
      // A burrito costume: a fat tortilla wrap from the knees to the chin, the foil it came in round the
      // bottom, and salsa and guacamole showing at the top.
      const tortilla = M.paint({ color: '#e8c890', pattern: { kind: 'splatter', colors: ['#c8904a', '#d8b070'], scale: 1 } }, 'matte')
      const rows: [number, number, number, number][] = []
      for (let i = 0; i <= 8; i++) { const y = kneeY - 0.04 + (neckY - kneeY + 0.02) * (i / 8), w = 0.2 + 0.06 * Math.sin(Math.PI * Math.min(1, (i / 8) * 1.15)); rows.push([y, w, w * 0.92, 0.02]) }
      lathe(R, rows, TORSO, tortilla, { caps: [false, false], sides: 26 })
      lathe(R, [[kneeY - 0.06, 0.205, 0.19, 0.02], [kneeY + 0.12, 0.225, 0.21, 0.02]], TORSO, M.get('#d8dce2', 'metal'), { caps: [false, false], sides: 26 })
      for (const [x, c] of [[-0.06, '#d8352a'], [0.05, '#5ab04a'], [0.0, '#f2f0e6']] as const) rigid(R, 'UpperChest', new THREE.SphereGeometry(0.06, 12, 8), M.get(c, 'matte'), [x, neckY - 0.01, 0.03], [0, 0, 0], [1.3, 0.55, 1.2])
      break
    }
    case 'sash': { const [rx, rz, dz] = rowAt(S.rows, hipsY + 0.04); rigid(R, 'Hips', new THREE.CylinderGeometry(1, 1, 0.06, 24, 1, true), m, [0, hipsY + 0.04, dz], [0, 0, 0], [rx + 0.018, 1, rz + 0.018]); rigid(R, 'Hips', new THREE.SphereGeometry(0.03, 8, 6), m, [0.05, hipsY + 0.03, frontAt(S, hipsY + 0.04) + 0.02], [0, 0, 0], [1.4, 1, 0.6]); break }
    case 'buttons': { for (const k of [1, -1]) for (let i = 0; i < 4; i++) { const y = hipsY + 0.06 + i * 0.07; rigid(R, 'Spine', new THREE.SphereGeometry(0.009, 8, 6), m, [k * 0.07, y, frontAt(S, y) + 0.016]) } break }
    case 'pocketsquare': rigid(R, 'Chest', new THREE.ConeGeometry(0.018, 0.03, 4), m, [0.08, chestY + 0.01, frontAt(S, chestY) + 0.016], [0, Math.PI / 4, 0]); break
    case 'pearls': {
      // A necklace of beads in a U at the collarbone.
      const pm = M.get(L.color, 'gloss')
      for (let i = 0; i <= 16; i++) {
        const a = (i / 16 - 0.5) * 2.4, y = neckY - 0.03 - (1 - Math.abs(a) / 1.2) * 0.06
        rigid(R, 'UpperChest', new THREE.SphereGeometry(0.0095, 8, 6), pm, [Math.sin(a) * 0.075, y, (frontAt(S, y) + 0.008) * Math.cos(a * 0.75)])
      }
      break
    }
    case 'camera': {
      // A camera on its strap round the neck.
      const strap = M.get('#1b1c1f', 'matte'), fz = frontAt(S, chestY - 0.06) + 0.035
      for (const k of [1, -1]) { const c = capsuleBetween([k * 0.07, neckY - 0.01, 0.04], [k * 0.05, chestY - 0.04, fz - 0.01], 0.006, 4); rigid(R, 'UpperChest', c.geo, strap, c.mid, [c.rot.x, c.rot.y, c.rot.z]) }
      rigid(R, 'Chest', new THREE.BoxGeometry(0.13, 0.08, 0.06), M.get(L.color, 'gloss'), [0, chestY - 0.06, fz])
      rigid(R, 'Chest', new THREE.CylinderGeometry(0.03, 0.032, 0.05, 14), strap, [0, chestY - 0.065, fz + 0.05], [Math.PI / 2, 0, 0])
      rigid(R, 'Chest', new THREE.CylinderGeometry(0.022, 0.022, 0.004, 14), M.get('#4a6a8a', 'glass'), [0, chestY - 0.065, fz + 0.076], [Math.PI / 2, 0, 0])
      break
    }
    case 'cloud': {
      // A cloud all over (Karl's cousin): puffs round the body, the arms and the legs, and round the head but not
      // in front of the face.
      const cm = M.get(L.color, 'matte'), puff = (bone: string, at: V3, r: number) => rigid(R, bone, new THREE.SphereGeometry(r, 10, 8), cm, at)
      // Big soft puffs, centred a little inside the body so they billow rather than bead; the top row leaves the
      // collar and scarf showing, the head's puffs ring the sides and back (the face and forehead stay clear).
      for (let j = 0; j < 5; j++) {
        const y = hipsY - 0.1 + (neckY - 0.12 - (hipsY - 0.1)) * (j / 4), [rx, rz, dz] = rowAt(S.rows, y)
        const bone = y < hipsY + 0.05 ? 'Hips' : y < chestY ? 'Spine' : y < neckY - 0.1 ? 'Chest' : 'UpperChest'
        for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + j * 0.55; puff(bone, [Math.sin(a) * rx * 0.85, y + (hash2(i, j, 7) - 0.5) * 0.05, dz + Math.cos(a) * rz * 0.85], 0.1 + hash2(i, j, 4) * 0.045) }
      }
      for (const k of [1, -1]) { const sh = R.at(k > 0 ? 'LeftArm' : 'RightArm'); puff('UpperChest', [sh.x * 0.8, sh.y + 0.02, sh.z - 0.02], 0.1) }
      const c = S.head.c
      for (let i = 0; i < 9; i++) { const a = Math.PI * 0.42 + (i / 8) * Math.PI * 1.16; puff('Head', [Math.sin(a) * 0.115, c.y + 0.0 + (i % 2) * 0.035, c.z + Math.cos(a) * 0.105], 0.075) }
      for (let i = 0; i < 6; i++) { const a = Math.PI * 0.35 + (i / 5) * Math.PI * 1.3; puff('Head', [Math.sin(a) * 0.065, c.y + 0.11, c.z - 0.01 + Math.cos(a) * 0.065], 0.07) }
      for (const side of ['Left', 'Right']) {
        const sh = R.at(`${side}Arm`), el = R.at(`${side}ForeArm`), wr = R.at(`${side}Hand`)
        for (const t of [0.15, 0.6]) puff(`${side}Arm`, [sh.x + (el.x - sh.x) * t, sh.y + (el.y - sh.y) * t, sh.z + (el.z - sh.z) * t], 0.065)
        for (const t of [0.2, 0.65]) puff(`${side}ForeArm`, [el.x + (wr.x - el.x) * t, el.y + (wr.y - el.y) * t, el.z + (wr.z - el.z) * t], 0.058)
        const hp = R.at(`${side}UpLeg`), kn = R.at(`${side}Leg`), an = R.at(`${side}Foot`)
        for (const t of [0.4, 0.9]) puff(`${side}UpLeg`, [hp.x + (kn.x - hp.x) * t, hp.y + (kn.y - hp.y) * t, hp.z + (kn.z - hp.z) * t + 0.02], 0.075)
        puff(`${side}Leg`, [kn.x + (an.x - kn.x) * 0.55, kn.y + (an.y - kn.y) * 0.55, kn.z + 0.02], 0.065)
      }
      break
    }
    case 'belt': { const [rx, rz, dz] = rowAt(S.rows, hipsY - 0.01); rigid(R, 'Hips', new THREE.CylinderGeometry(1, 1, 0.035, 24, 1, true), m, [0, hipsY - 0.01, dz], [0, 0, 0], [rx + 0.012, 1, rz + 0.012]); break }
  }
}

/** A narrow stripe down the front at x (a cardigan's trim each side of the buttons). */
function frontStrip2(B: Body, S: Shape, x: number, y0: number, y1: number, t: number, w: number, m: Mat) {
  const n = 4
  for (let i = 0; i < n; i++) {
    const ya = y0 + (y1 - y0) * (i / n), yb = y0 + (y1 - y0) * ((i + 1) / n), za = frontAt(S, ya) + t, zb = frontAt(S, yb) + t
    rigid(B.rig, ya < B.chestY ? 'Spine' : 'Chest', new THREE.BoxGeometry(w, yb - ya + 0.006, 0.004), m, [x, (ya + yb) / 2, (za + zb) / 2 - Math.abs(x) * 0.2], [-Math.atan2(zb - za, yb - ya), 0, 0])
  }
}

// ---------------------------------------------------------------- props

/**
 * A hand's grip: a group on the hand bone whose axes line up with the body's (x left, y up, z ahead)
 * when the idle holds that hand in the frame (fingers ahead, palm in; tray: palm up; stop: fingers up,
 * palm out). Props built in it read the same whatever the arm does.
 */
export const FRAMES: Record<string, [V3, V3]> = { grip: [[0, 0, 1], [-1, 0, 0]], tray: [[0, 0, 1], [0, 1, 0]], stop: [[0, 1, 0], [0, 0, 1]] }
/** The frame's fingers and palm for one side (the grip's palm faces the midline). */
export function frameFor(name: string, side: 'Left' | 'Right'): [V3, V3] {
  const [f, p] = FRAMES[name] ?? FRAMES.grip, k = side === 'Left' ? 1 : -1
  return [f, name === 'grip' ? [p[0] * k, p[1], p[2]] : p]
}
function gripGroup(B: Body, side: 'Left' | 'Right', frame = 'grip'): THREE.Group {
  const k = side === 'Left' ? 1 : -1
  const [f1, p1] = frameFor(frame, side)
  const basis = (f: THREE.Vector3, p: THREE.Vector3) => new THREE.Matrix4().makeBasis(f, p, new THREE.Vector3().crossVectors(f, p))
  const q = new THREE.Quaternion().setFromRotationMatrix(basis(new THREE.Vector3(...f1), new THREE.Vector3(...p1)).multiply(basis(new THREE.Vector3(k, 0, 0), new THREE.Vector3(0, -1, 0)).transpose()))
  const g = new THREE.Group()
  g.quaternion.copy(q.invert())
  g.userData.prop = true
  g.userData.hold = { side, frame }
  B.rig.bones.get(`${side}Hand`)!.add(g)
  return g
}
/** A group carried by a bone, its axes the body's, at a rest point (model space). */
function boneGroup(B: Body, bone: string, at: V3): THREE.Group {
  const g = new THREE.Group()
  g.position.set(...at).sub(B.rig.at(bone))
  g.userData.prop = true
  B.rig.bones.get(bone)!.add(g)
  return g
}
function groundGroup(B: Body, at: V3, yaw = 0): THREE.Group { const g = new THREE.Group(); g.position.set(...at); g.rotation.y = yaw; g.userData.prop = true; B.rig.root.add(g); return g }

type PropCtx = { B: Body; S: Shape; M: Mats; c: (k: string, d: string) => string; hooks: ((c: HookCtx) => void)[] }
const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d)
const cyl = (r: number, h: number, n = 14, r2 = r) => new THREE.CylinderGeometry(r, r2, h, n)
const ball = (r: number, n = 12) => new THREE.SphereGeometry(r, n, Math.max(6, Math.round(n * 0.7)))
/** The fist's centre in a grip: just ahead of the wrist. */
const FIST = 0.06

/** A dog, built standing, facing +z, in a group at its feet (the dog pack). */
function dog(P: PropCtx, g: THREE.Group, o: { coat: string; patch?: string; size: number; ears: 'flop' | 'point'; tail?: number; tongue?: boolean }) {
  const { M } = P, s = o.size, coat = M.get(o.coat, 'matte'), patch = M.get(o.patch ?? o.coat, 'matte'), dark = M.get('#1d1a18', 'gloss')
  add(g, new THREE.CapsuleGeometry(0.11 * s, 0.26 * s, 4, 10), coat, [0, 0.3 * s, 0], [Math.PI / 2, 0, 0])
  add(g, ball(0.1 * s), coat, [0, 0.43 * s, 0.22 * s])
  add(g, ball(0.06 * s), patch, [0, 0.41 * s, 0.31 * s], [0, 0, 0], ).scale.set(1, 0.8, 1.2)
  add(g, ball(0.022 * s, 8), dark, [0, 0.43 * s, 0.37 * s])
  for (const k of [1, -1]) {
    add(g, ball(0.017 * s, 8), dark, [k * 0.04 * s, 0.47 * s, 0.3 * s])
    if (o.ears === 'flop') add(g, ball(0.05 * s, 8), patch, [k * 0.085 * s, 0.42 * s, 0.2 * s], [0, 0, k * 0.4]).scale.set(0.45, 1.1, 0.8)
    else add(g, new THREE.ConeGeometry(0.035 * s, 0.09 * s, 6), patch, [k * 0.055 * s, 0.53 * s, 0.2 * s], [0, 0, k * -0.25])
    for (const z of [0.13, -0.13]) add(g, cyl(0.026 * s, 0.24 * s, 8), coat, [k * 0.06 * s, 0.12 * s, z * s])
  }
  add(g, cyl(0.018 * s, 0.18 * s, 8), coat, [0, 0.4 * s, -0.22 * s], [-(o.tail ?? 0.8), 0, 0])
  if (o.tongue) add(g, box(0.03 * s, 0.006, 0.05 * s), M.get('#e8607a', 'gloss'), [0, 0.37 * s, 0.33 * s], [0.5, 0, 0])
  add(g, cyl(0.075 * s, 0.025 * s, 12), M.get(P.c('collar', '#2a8a9a'), 'gloss'), [0, 0.38 * s, 0.15 * s], [0.6, 0, 0])
}

const PROPS: Record<string, (P: PropCtx) => void> = {
  skateboard(P) {
    // Over the right shoulder, held at the trucks: the deck runs up and back.
    const { M } = P, g = gripGroup(P.B, 'Right')
    // Behind the shoulder, leaning out to his right, the trucks and wheels toward you (as on his sticker).
    const d = new THREE.Group(); d.position.set(-0.06, 0.16, -0.1); d.rotation.set(-0.3, 0, 0.5); g.add(d)
    add(d, box(0.21, 0.81, 0.018), M.get(P.c('deck', '#e05a2a'), 'gloss'), [0, 0, 0])
    for (const y of [0.27, -0.27]) { add(d, box(0.15, 0.03, 0.04), M.get('#c9ccd2', 'metal'), [0, y, 0.03]); for (const k of [1, -1]) add(d, cyl(0.028, 0.03, 12), M.get(P.c('wheel', '#2a9a9a'), 'gloss'), [k * 0.09, y, 0.055], [0, 0, Math.PI / 2]) }
  },
  notebook(P) {
    const g = gripGroup(P.B, 'Left')
    add(g, box(0.035, 0.21, 0.15), P.M.get(P.c('book', '#d8522a'), 'matte'), [-0.03, 0.02, FIST])
    add(g, box(0.03, 0.2, 0.004), P.M.get('#f4efe0', 'matte'), [-0.03, 0.02, FIST + 0.076])
  },
  pencil(P) { const g = gripGroup(P.B, 'Right'); add(g, cyl(0.005, 0.16, 6), P.M.get(P.c('pencil', '#e88a2a'), 'gloss'), [0, 0.06, FIST], [0.5, 0, 0]) },
  espresso(P) {
    const { M } = P, g = gripGroup(P.B, 'Right', 'tray'), white = M.get('#fbfaf3', 'gloss')
    add(g, cyl(0.055, 0.008, 18), white, [0, 0.03, FIST])
    add(g, cyl(0.03, 0.04, 16, 0.024), white, [0, 0.055, FIST])
    add(g, new THREE.TorusGeometry(0.012, 0.004, 6, 12), white, [0.036, 0.058, FIST], [0, 0, 0])
    add(g, cyl(0.026, 0.004, 14), M.get('#4a2a18', 'gloss'), [0, 0.074, FIST])
    if (P.c('band', '')) add(g, cyl(0.031, 0.008, 16), M.get(P.c('band', '#d8522a'), 'gloss'), [0, 0.06, FIST])
  },
  cup(P) {
    const { M } = P, g = gripGroup(P.B, 'Right'), white = M.get('#fbfaf3', 'gloss')
    add(g, cyl(0.028, 0.04, 16, 0.022), white, [0, 0.03, FIST + 0.03])
    add(g, cyl(0.03, 0.008, 16), M.get(P.c('band', '#d8522a'), 'gloss'), [0, 0.04, FIST + 0.03])
  },
  bocce(P) { const g = gripGroup(P.B, 'Right', 'tray'); add(g, ball(0.055, 16), P.M.get(P.c('ball', '#2a8a7a'), 'gloss'), [0, 0.07, FIST]) },
  lever(P) {
    const { M } = P, g = groundGroup(P.B, [-0.38, 0, 0.22])
    add(g, box(0.3, 0.03, 0.4), M.get('#3a3d42', 'metal'), [0, 0.015, 0])
    add(g, box(0.16, 0.22, 0.2), M.get('#2a2c30', 'metal'), [0, 0.12, 0])
    add(g, cyl(0.022, 0.95, 12, 0.026), M.get('#8a8f96', 'metal'), [0, 0.6, 0.02], [-0.12, 0, 0])
    add(g, cyl(0.036, 0.16, 12), M.get('#2a2b2e', 'matte'), [0, 1.08, 0.08], [-0.12, 0, 0])
  },
  shears(P) {
    const { M } = P, g = gripGroup(P.B, 'Right'), steel = M.get('#c9ccd2', 'metal'), red = M.get(P.c('handle', '#d8352a'), 'gloss')
    for (const k of [1, -1]) { add(g, box(0.012, 0.11, 0.004), steel, [k * 0.008, 0.1, FIST], [0, 0, k * 0.12]); add(g, cyl(0.011, 0.09, 8), red, [k * 0.012, -0.005, FIST], [0, 0, k * 0.2]) }
  },
  hydrangea(P) {
    const { M } = P, g = gripGroup(P.B, 'Left'), blue = M.get(P.c('flower', '#5a8ad8'), 'matte'), pale = M.get('#8ab0ee', 'matte')
    add(g, cyl(0.006, 0.22, 6), M.get('#4a7a3a', 'matte'), [0, 0.08, FIST])
    add(g, ball(0.03, 8), M.get('#4a8a3a', 'matte'), [0.03, 0.12, FIST], [0, 0, 0.5]).scale.set(1.4, 0.3, 0.8)
    for (let i = 0; i < 11; i++) add(g, ball(0.03, 8), i % 3 ? blue : pale, [Math.cos(i * 2.4) * 0.045, 0.22 + Math.sin(i * 1.3) * 0.03, FIST + Math.sin(i * 2.4) * 0.045])
  },
  bucket(P) {
    const { M } = P, g = groundGroup(P.B, [0.0, 0, 0.42])
    add(g, cyl(0.16, 0.28, 18, 0.13), M.get(P.c('bucket', '#b8bcc2'), 'metal'), [0, 0.14, 0])
    add(g, new THREE.TorusGeometry(0.16, 0.012, 6, 20), M.get('#8a8f96', 'metal'), [0, 0.28, 0], [Math.PI / 2, 0, 0])
    const star = M.get(P.c('star', '#e8642a'), 'matte')
    for (let i = 0; i < 5; i++) add(g, new THREE.ConeGeometry(0.018, 0.07, 5), star, [0.06 + Math.cos(i * 1.257) * 0.03, 0.17 + Math.sin(i * 1.257) * 0.03, 0.135], [0, 0, i * 1.257 - Math.PI / 2])
    add(g, new THREE.TorusGeometry(0.15, 0.008, 4, 18), M.get(P.c('net', '#2a9a9a'), 'matte'), [0, 0.2, 0], [Math.PI / 2 + 0.2, 0, 0])
    add(g, ball(0.04, 8), M.get('#f2e4c8', 'gloss'), [-0.06, 0.18, 0.13]).scale.set(1, 0.9, 0.4)
  },
  fries(P) {
    const { M } = P, g = gripGroup(P.B, 'Left', 'tray')
    add(g, box(0.13, 0.05, 0.09), M.paint({ color: '#fbfaf3', pattern: { kind: 'stripes', colors: ['#d8352a'], scale: 0.5 } }, 'matte'), [0, 0.045, FIST])
    const y = M.get(P.c('fries', '#f2c84a'), 'matte')
    for (let i = 0; i < 9; i++) add(g, box(0.012, 0.09, 0.012), y, [-0.05 + (i % 5) * 0.025, 0.09, FIST - 0.02 + Math.floor(i / 5) * 0.035], [0.2 * Math.sin(i), 0, 0.25 * Math.cos(i * 1.7)])
  },
  liondance(P) {
    // The lion's head at his left hip (he holds it by its jaw), and the stick in his right hand.
    const { M, B } = P, g = boneGroup(B, 'Hips', [0.42, B.hipsY + 0.02, 0.12]), red = M.get(P.c('lion', '#d8352a'), 'matte'), fur = M.get('#fbf6e8', 'matte'), gold = M.get(P.c('gold', '#e8b83a'), 'metal')
    g.rotation.y = -0.35
    add(g, ball(0.24, 18), red, [0, 0.1, 0]).scale.set(1.1, 0.95, 1)
    add(g, new THREE.TorusGeometry(0.24, 0.06, 10, 24), fur, [0, 0.08, 0.06], [0, 0, 0], ).scale.set(1.12, 1, 1)
    for (const k of [1, -1]) {
      add(g, ball(0.07, 14), M.get('#fbfaf3', 'gloss'), [k * 0.1, 0.17, 0.2])
      add(g, ball(0.04, 10), M.get('#141414', 'gloss'), [k * 0.1, 0.17, 0.26])
      add(g, ball(0.05, 10), gold, [k * 0.12, 0.27, 0.15]).scale.set(1.3, 0.5, 0.8)
    }
    add(g, cyl(0.04, 0.12, 10, 0.06), M.get(P.c('horn', '#2a9a8a'), 'gloss'), [0, 0.38, 0.0], [-0.3, 0, 0])
    add(g, ball(0.045, 10), gold, [0, 0.45, 0.03])
    add(g, box(0.3, 0.06, 0.16), M.get('#fbfaf3', 'gloss'), [0, -0.04, 0.2])   // the teeth
    add(g, box(0.32, 0.08, 0.18), red, [0, -0.12, 0.16])   // the jaw
    add(g, ball(0.09, 10), fur, [0, -0.18, 0.2]).scale.set(1.6, 0.6, 0.8)   // the beard
    add(g, box(0.36, 0.05, 0.1), gold, [0, 0.01, 0.24])
    const s = gripGroup(B, 'Right'); add(s, cyl(0.014, 0.85, 8), M.get('#7a4e2a', 'gloss'), [0, 0.18, FIST])
  },
  steamer(P) {
    const { M } = P, g = gripGroup(P.B, 'Left', 'tray'), bamboo = M.get(P.c('bamboo', '#d8b06a'), 'matte')
    add(g, cyl(0.1, 0.07, 20), bamboo, [0, 0.06, FIST + 0.03])
    add(g, new THREE.TorusGeometry(0.1, 0.006, 4, 20), M.get('#a8803a', 'matte'), [0, 0.06, FIST + 0.03], [Math.PI / 2, 0, 0])
    for (let i = 0; i < 4; i++) add(g, ball(0.035, 10), M.get('#fbf6ec', 'matte'), [Math.cos(i * 1.6) * 0.05, 0.105, FIST + 0.03 + Math.sin(i * 1.6) * 0.05]).scale.set(1, 0.75, 1)
  },
  laptop(P) {
    const { M } = P, g = gripGroup(P.B, 'Left')
    add(g, box(0.3, 0.22, 0.022), M.get('#b8bcc2', 'metal'), [-0.08, 0.04, FIST + 0.02], [0, 0, 0.1])
  },
  watch(P) { const { B, M } = P, e = B.rig.at('RightForeArm'), w = B.rig.at('RightHand'); rigid(B.rig, 'RightForeArm', new THREE.CylinderGeometry(0.045, 0.045, 0.03, 14, 1, true), M.get('#1a1a1a', 'matte'), [e.x + (w.x - e.x) * 0.88, w.y, w.z], [0, 0, Math.PI / 2]); rigid(B.rig, 'RightForeArm', box(0.012, 0.04, 0.035), M.get('#2a2c30', 'gloss'), [e.x + (w.x - e.x) * 0.88, w.y + 0.04, w.z]) },
  crate(P) {
    const { M, B } = P, g = boneGroup(B, 'Spine', [0, B.hipsY + 0.06, 0.34]), wood = M.get(P.c('wood', '#b8905a'), 'matte')
    add(g, box(0.46, 0.04, 0.3), wood, [0, -0.08, 0])
    for (const z of [0.14, -0.14]) add(g, box(0.46, 0.13, 0.02), wood, [0, -0.02, z])
    for (const x of [0.22, -0.22]) add(g, box(0.02, 0.13, 0.3), wood, [x, -0.02, 0])
    const peach = M.get(P.c('fruit', '#f08a3a'), 'matte'), blush = M.get('#e8603a', 'matte')
    for (let i = 0; i < 12; i++) add(g, ball(0.05, 10), i % 3 ? peach : blush, [-0.16 + (i % 4) * 0.105, 0.05 + Math.floor(i / 4) % 2 * 0.02, -0.09 + Math.floor(i / 4) * 0.09])
    for (let i = 0; i < 3; i++) add(g, ball(0.03, 6), M.get('#4a9a3a', 'matte'), [-0.1 + i * 0.1, 0.1, 0.02], [0, i, 0.5]).scale.set(1.4, 0.3, 0.7)
  },
  crust(P) { const c = P.S.head.c; rigid(P.B.rig, 'Head', ball(0.03, 8), P.M.get('#e8c48a', 'matte'), [0.1, c.y + 0.05, c.z - 0.01], [0.3, 0, 0.6], [0.6, 1.2, 0.9]) },
  bags(P) {
    const { M } = P, cols = [P.c('a', '#e8642a'), P.c('b', '#2a9a9a'), P.c('c', '#f4f2ec'), P.c('d', '#a8acb2')]
    ;(['Left', 'Right'] as const).forEach((side, si) => {
      const g = gripGroup(P.B, side), k = side === 'Left' ? 1 : -1
      for (let i = 0; i < 2; i++) {
        const c = cols[si * 2 + i], dx = k * i * 0.07, dz = i * 0.05
        add(g, box(0.06, 0.28, 0.24), M.get(c, 'matte'), [dx, -0.22, FIST + dz], [0, k * 0.2 * i, 0])
        add(g, new THREE.TorusGeometry(0.05, 0.005, 4, 12, Math.PI), M.get(c, 'matte'), [dx, -0.08, FIST + dz], [0, Math.PI / 2, 0])
      }
    })
  },
  brush(P) {
    const { M } = P, g = gripGroup(P.B, 'Right')
    add(g, cyl(0.011, 0.16, 8), M.get('#d8b06a', 'gloss'), [0, 0.06, FIST], [0.3, 0, 0])
    add(g, box(0.03, 0.04, 0.012), M.get('#c9ccd2', 'metal'), [0, 0.15, FIST + 0.03], [0.3, 0, 0])
    add(g, box(0.03, 0.035, 0.012), M.get(P.c('paint', '#e8642a'), 'gloss'), [0, 0.185, FIST + 0.04], [0.3, 0, 0])
  },
  spray(P) {
    const { M } = P, g = gripGroup(P.B, 'Left')
    add(g, cyl(0.03, 0.15, 14), M.get(P.c('can', '#b8bcc2'), 'metal'), [0, 0.04, FIST])
    add(g, cyl(0.022, 0.03, 12), M.get(P.c('cap', '#2a9a9a'), 'gloss'), [0, 0.13, FIST])
  },
  concha(P) {
    const { M } = P, g = gripGroup(P.B, 'Right')
    add(g, new THREE.SphereGeometry(0.065, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), M.paint({ color: P.c('concha', '#f2a0b4'), pattern: { kind: 'plaid', colors: ['#e88aa0', '#e88aa0'], scale: 0.6 } }, 'matte'), [0, 0.05, FIST + 0.02], [Math.PI / 2 - 0.3, 0, 0])
    add(g, cyl(0.065, 0.02, 16), M.get('#e8c48a', 'matte'), [0, 0.05, FIST], [Math.PI / 2 - 0.3, 0, 0])
  },
  whisk(P) { const { B, S, M } = P, y = B.hipsY + 0.1; rigid(B.rig, 'Spine', cyl(0.01, 0.1, 6), M.get(P.c('whisk', '#2a9a9a'), 'gloss'), [-0.08, y + 0.04, frontAt(S, y) + 0.03]); rigid(B.rig, 'Spine', ball(0.025, 8), M.get('#c9ccd2', 'metal'), [-0.08, y + 0.11, frontAt(S, y) + 0.03], [0, 0, 0], [1, 1.6, 1]) },
  lowrider(P) {
    // His candy-red lowrider behind him, nose to his right; it hops (the hook lifts the front).
    const { M, B } = P, g = groundGroup(B, [0, 0, -1.25], 0), red = M.get(P.c('paint', '#d8352a'), 'gloss'), chrome = M.get('#dfe3e8', 'metal'), dark = M.get('#22303a', 'glass'), tyre = M.get('#141414', 'matte'), wall = M.get('#f4f2ec', 'matte')
    const car = new THREE.Group(); g.add(car)
    const body = new THREE.Group(); body.position.set(-2.0, 0, 0); body.userData.live = true; car.add(body)   // the pivot at the rear axle (x -2, his left); moves on its own
    const o = (x: number) => x + 2.0
    add(body, box(5.2, 0.5, 1.95), red, [o(-0.1), 0.52, 0])
    add(body, box(2.5, 0.42, 1.75), red, [o(-0.4), 0.98, 0])
    add(body, box(2.3, 0.36, 1.78), dark, [o(-0.4), 0.98, 0])
    add(body, box(2.55, 0.06, 1.8), red, [o(-0.4), 1.2, 0])
    for (const x of [2.6, -2.75]) add(body, box(0.12, 0.16, 2.0), chrome, [o(x), 0.38, 0])
    add(body, box(0.08, 0.26, 1.4), chrome, [o(2.62), 0.6, 0])
    for (const k of [1, -1]) for (const dz of [0.55, 0.78]) add(body, cyl(0.08, 0.06, 14), M.get('#fbf6d8', 'glow'), [o(2.62), 0.6, k * dz], [0, 0, Math.PI / 2])
    add(body, box(5.0, 0.04, 2.0), chrome, [o(-0.1), 0.62, 0])
    for (const x of [1.6, -1.75]) for (const k of [1, -1]) {
      add(g, cyl(0.33, 0.22, 18), tyre, [x, 0.33, k * 0.88], [Math.PI / 2, 0, 0])
      add(g, cyl(0.24, 0.23, 18), wall, [x, 0.33, k * 0.88], [Math.PI / 2, 0, 0])
      add(g, cyl(0.17, 0.24, 14), chrome, [x, 0.33, k * 0.88], [Math.PI / 2, 0, 0])
    }
    P.hooks.push((c) => {
      // A hop every few seconds: the nose kicks up and drops, two little bounces.
      const u = ((c.ticks / 120) % 7.5)
      const a = u < 0.35 ? Math.sin((u / 0.35) * Math.PI) * 0.16 : u < 0.8 ? Math.abs(Math.sin(((u - 0.35) / 0.45) * Math.PI * 2)) * 0.04 : 0
      body.rotation.z = a
    })
  },
  guitar(P) {
    const { M, B } = P, g = boneGroup(B, 'Chest', [0.02, B.hipsY + 0.16, frontAt(P.S, B.hipsY + 0.16) + 0.1]), wood = M.get(P.c('wood', '#e0b070'), 'gloss'), dark = M.get('#3a2416', 'gloss')
    g.rotation.set(0, 0, -0.55)
    add(g, cyl(0.17, 0.1, 22), wood, [0, -0.08, 0], [Math.PI / 2, 0, 0])
    add(g, cyl(0.13, 0.1, 20), wood, [0, 0.13, 0], [Math.PI / 2, 0, 0])
    add(g, cyl(0.045, 0.104, 14), M.get('#141414', 'matte'), [0, 0.03, 0], [Math.PI / 2, 0, 0])
    add(g, box(0.055, 0.42, 0.03), dark, [0, 0.45, 0.02])
    add(g, box(0.075, 0.12, 0.025), dark, [0, 0.71, 0.02])
    add(g, box(0.08, 0.025, 0.02), dark, [0, -0.18, 0.055])
  },
  paletacart(P) {
    const { M, B } = P, g = groundGroup(B, [0, 0, 0.62]), white = M.paint({ color: '#f6f4ee', pattern: { kind: 'splatter', colors: [P.c('a', '#e8642a'), P.c('b', '#2a9a9a')], scale: 1 } }, 'gloss'), chrome = M.get('#c9ccd2', 'metal')
    add(g, box(0.72, 0.46, 0.5), white, [0, 0.55, 0.1])
    add(g, box(0.74, 0.04, 0.52), M.get('#d8d8d4', 'gloss'), [0, 0.8, 0.1])
    for (const k of [1, -1]) { add(g, cyl(0.12, 0.05, 16), M.get('#2a2b2e', 'matte'), [k * 0.32, 0.12, 0.25], [0, 0, Math.PI / 2]); add(g, cyl(0.012, 0.34, 8), chrome, [k * 0.3, 0.92, -0.16], [-0.6, 0, 0]) }
    add(g, cyl(0.016, 0.62, 8), chrome, [0, 1.06, -0.28], [0, 0, Math.PI / 2])
    add(g, cyl(0.02, 0.35, 8), chrome, [0, 0.25, -0.1])
    const pg = gripGroup(B, 'Right'); add(pg, box(0.055, 0.1, 0.022), M.get(P.c('paleta', '#f2a03a'), 'gloss'), [0, 0.1, FIST]); add(pg, box(0.012, 0.07, 0.006), M.get('#e8d4a8', 'matte'), [0, 0.03, FIST])
  },
  chancla(P) {
    const { M } = P, g = gripGroup(P.B, 'Right'), m = M.get(P.c('chancla', '#2a9a9a'), 'gloss')
    add(g, new THREE.CapsuleGeometry(0.045, 0.16, 4, 10), m, [0, 0.14, FIST], [0, 0, 0]).scale.set(1, 1, 0.22)
    add(g, new THREE.TorusGeometry(0.035, 0.007, 4, 10, Math.PI), M.get('#f4f2ec', 'matte'), [0, 0.2, FIST + 0.012], [0, 0, 0])
  },
  dogs(P) {
    const { B, M } = P, g = groundGroup(B, [0, 0, 0])
    g.userData.oneMesh = true
    const pack: [number, number, number, Parameters<typeof dog>[2]][] = [
      [0.0, 0.85, 0.1, { coat: '#e8963a', patch: '#fbf6ec', size: 0.75, ears: 'point', tongue: true }],   // the corgi, in front
      [0.55, 0.55, 0.5, { coat: '#e0b060', size: 1, ears: 'flop', tongue: true }], [-0.55, 0.6, -0.4, { coat: '#d8a858', size: 1.05, ears: 'flop' }],
      [0.85, 0.05, 1.3, { coat: '#1d1b1a', size: 1, ears: 'flop' }], [-0.85, 0.15, -1.4, { coat: '#1d1b1a', size: 0.95, ears: 'flop', tongue: true }],
      [0.6, -0.5, 2.2, { coat: '#fbfaf3', patch: '#1d1b1a', size: 0.9, ears: 'flop' }], [-0.6, -0.45, -2.3, { coat: '#1d1b1a', patch: '#fbfaf3', size: 0.9, ears: 'point' }],
      [0.3, 1.25, 0.2, { coat: '#9a9a9a', size: 0.95, ears: 'flop', tongue: true }], [-0.3, 1.2, -0.3, { coat: '#ecdcc0', size: 0.7, ears: 'flop' }],
    ]
    const leash = M.get(P.c('leash', '#2a9a9a'), 'gloss'), hold = new THREE.Vector3(0, 0.95, 0.32)
    for (const [x, z, yaw, o] of pack) {
      const d = new THREE.Group(); d.position.set(x, 0, z); d.rotation.y = yaw; g.add(d); dog(P, d, o)
      const collar = new THREE.Vector3(0, 0.38 * o.size, 0.15 * o.size).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw).add(d.position)
      const c = capsuleBetween(hold.toArray() as V3, collar.toArray() as V3, 0.006, 4)
      add(g, c.geo, leash, c.mid, [c.rot.x, c.rot.y, c.rot.z])
    }
  },
  jar(P) {
    const { M, B } = P, g = boneGroup(B, 'Chest', [0, B.chestY - 0.04, frontAt(P.S, B.chestY - 0.04) + 0.12])
    add(g, cyl(0.11, 0.24, 20), M.get(P.c('brew', '#c87a2a'), 'glass'), [0, 0, 0])
    add(g, cyl(0.105, 0.04, 20), M.get('#e8d4a0', 'matte'), [0, 0.1, 0])
    add(g, cyl(0.075, 0.05, 18), M.get('#c8ccd0', 'glass'), [0, 0.14, 0])
    add(g, cyl(0.09, 0.02, 18), M.paint({ color: '#f2ead8', pattern: { kind: 'dots', colors: ['#d8522a'], scale: 0.5 } }, 'matte'), [0, 0.17, 0])
    add(g, new THREE.TorusGeometry(0.078, 0.005, 4, 16), M.get('#a87a4a', 'matte'), [0, 0.158, 0], [Math.PI / 2, 0, 0])
  },
  clipboard(P) {
    const { M } = P, g = gripGroup(P.B, 'Left')
    add(g, box(0.02, 0.3, 0.22), M.get('#7a5a3a', 'matte'), [-0.03, 0.02, FIST + 0.04], [0, 0, 0.15])
    add(g, box(0.004, 0.26, 0.19), M.get('#fbfaf3', 'matte'), [-0.019, 0.01, FIST + 0.04], [0, 0, 0.15])
    add(g, box(0.02, 0.03, 0.08), M.get('#c9ccd2', 'metal'), [-0.03, 0.17, FIST + 0.04], [0, 0, 0.15])
  },
  apple(P) { const { M } = P, g = gripGroup(P.B, 'Right', 'tray'); add(g, ball(0.045, 14), M.get(P.c('apple', '#d8352a'), 'gloss'), [0, 0.06, FIST]); add(g, cyl(0.004, 0.03, 5), M.get('#5a3a1e', 'matte'), [0, 0.11, FIST]); add(g, ball(0.015, 6), M.get('#4a9a3a', 'matte'), [0.012, 0.115, FIST]).scale.set(1.4, 0.3, 0.8) },
  record(P) {
    const { M } = P, g = gripGroup(P.B, 'Left')
    add(g, box(0.31, 0.31, 0.006), M.get(P.c('sleeve', '#2a9a9a'), 'matte'), [-0.1, 0.08, FIST + 0.02], [0, 0, 0.12])
    add(g, cyl(0.14, 0.004, 24), M.get('#141414', 'gloss'), [-0.18, 0.12, FIST + 0.026], [Math.PI / 2, 0, 0])
    add(g, cyl(0.045, 0.006, 16), M.get(P.c('label', '#e8642a'), 'matte'), [-0.18, 0.12, FIST + 0.028], [Math.PI / 2, 0, 0])
  },
  sandwich(P) {
    const { M } = P, g = gripGroup(P.B, 'Right', 'tray'), bun = M.get('#c8904a', 'matte')
    const s = new THREE.Group(); s.position.set(0, 0.1, FIST + 0.02); g.add(s)
    add(s, ball(0.13, 16), bun, [0, 0.07, 0]).scale.set(1, 0.42, 1)
    add(s, cyl(0.13, 0.03, 18), bun, [0, -0.07, 0])
    for (const [y, c, r] of [[-0.045, '#5ab04a', 0.145], [-0.02, '#e8a0a0', 0.135], [0.0, '#d8352a', 0.13], [0.02, '#f2c84a', 0.14], [0.04, '#5ab04a', 0.14]] as const) add(s, cyl(r, 0.02, 18), M.get(c, 'matte'), [0, y, 0])
    add(s, cyl(0.004, 0.2, 5), M.get('#e8d4a8', 'matte'), [0, 0.18, 0])
    add(s, box(0.07, 0.045, 0.004), M.get('#fbfaf3', 'matte'), [0.036, 0.25, 0])
  },
  pencilear(P) { const c = P.S.head.c; rigid(P.B.rig, 'Head', cyl(0.005, 0.12, 6), P.M.get('#e88a2a', 'gloss'), [-0.1, c.y + 0.03, c.z + 0.01], [1.3, 0, 0.3]) },
  bike(P) {
    const { M, B } = P, g = groundGroup(B, [-0.62, 0, 0.1]), frame = M.get(P.c('frame', '#e8642a'), 'gloss'), black = M.get('#1a1a1c', 'matte'), steel = M.get('#c9ccd2', 'metal')
    for (const z of [0.52, -0.5]) { add(g, new THREE.TorusGeometry(0.33, 0.018, 6, 28), black, [0, 0.34, z], [0, Math.PI / 2, 0]); add(g, cyl(0.03, 0.06, 10), steel, [0, 0.34, z], [0, 0, Math.PI / 2]) }
    const tubeTo = (a: V3, b: V3, r = 0.016, m = frame) => { const c = capsuleBetween(a, b, r, 6); add(g, c.geo, m, c.mid, [c.rot.x, c.rot.y, c.rot.z]) }
    tubeTo([0, 0.34, -0.5], [0, 0.42, 0.02]); tubeTo([0, 0.42, 0.02], [0, 0.82, -0.1]); tubeTo([0, 0.82, -0.1], [0, 0.84, 0.42]); tubeTo([0, 0.42, 0.02], [0, 0.84, 0.42]); tubeTo([0, 0.84, 0.42], [0, 0.34, 0.52]); tubeTo([0, 0.82, -0.1], [0, 0.34, -0.5], 0.012)
    tubeTo([-0.2, 0.96, 0.46], [0.2, 0.96, 0.46], 0.014, black); tubeTo([0, 0.84, 0.42], [0, 0.96, 0.46], 0.014, steel)
    add(g, box(0.1, 0.04, 0.24), black, [0, 0.9, -0.12]); tubeTo([0, 0.82, -0.1], [0, 0.89, -0.12], 0.012, steel)
    add(g, cyl(0.08, 0.02, 14), steel, [0, 0.42, 0.02], [0, 0, Math.PI / 2])
  },
  package(P) {
    const { M } = P, g = gripGroup(P.B, 'Left')
    add(g, box(0.035, 0.3, 0.24), M.get(P.c('paper', '#d8b88a'), 'matte'), [-0.035, 0.05, FIST + 0.02])
    add(g, box(0.038, 0.06, 0.08), M.get(P.c('label', '#2a9a9a'), 'matte'), [-0.035, 0.0, FIST + 0.06])
  },
  fortune(P) {
    const { M } = P, g = gripGroup(P.B, 'Right'), cookie = M.get('#e8a84a', 'matte')
    for (const k of [1, -1]) add(g, ball(0.035, 10), cookie, [k * 0.02, 0.05, FIST + 0.02], [0, 0, k * 0.5]).scale.set(1, 0.6, 1.2)
    const l = gripGroup(P.B, 'Left'); add(l, box(0.004, 0.025, 0.11), M.get('#fbfaf3', 'matte'), [-0.02, 0.04, FIST + 0.04])
  },
  flag(P) {
    const { M } = P, g = gripGroup(P.B, 'Right')
    add(g, cyl(0.012, 1.25, 8), M.get('#2a2b2e', 'gloss'), [0, 0.45, FIST])
    add(g, box(0.004, 0.26, 0.38), M.get(P.c('flag', '#e8642a'), 'matte'), [0, 0.95, FIST + 0.2])
    add(g, ball(0.02, 8), M.get('#c9ccd2', 'metal'), [0, 1.08, FIST])
  },
  phone(P) { const g = gripGroup(P.B, 'Left'); add(g, box(0.012, 0.15, 0.075), P.M.get('#1b1c1f', 'gloss'), [-0.02, 0.05, FIST + 0.01]) },
  boardHug(P) {
    // Her board held upright against her chest, arms folded over it, trucks and wheels out.
    const { M, B, S } = P, y = B.chestY - 0.12, g = boneGroup(B, 'Chest', [0, y, frontAt(S, y) + 0.05])
    add(g, box(0.21, 0.8, 0.018), M.paint({ color: P.c('deck', '#e8642a'), pattern: { kind: 'splatter', colors: ['#f4efe0', '#1f1f22'], scale: 1 } }, 'gloss'), [0, 0.05, 0])
    for (const yy of [0.33, -0.23]) { add(g, box(0.15, 0.03, 0.04), M.get('#c9ccd2', 'metal'), [0, yy, 0.03]); for (const k of [1, -1]) add(g, cyl(0.028, 0.03, 12), M.get(P.c('wheel', '#f4efe0'), 'gloss'), [k * 0.09, yy, 0.055], [0, 0, Math.PI / 2]) }
  },
  feather(P) {
    // A feather stuck in his hair (worn: it stays while he rides).
    const { B, S, M } = P, c = S.head.c
    rigid(B.rig, 'Head', ball(0.05, 10), M.get(P.c('feather', '#ece8e0'), 'matte'), [-0.03, c.y + 0.19, c.z - 0.03], [0.25, 0, 0.3], [0.24, 1.35, 0.06])
    rigid(B.rig, 'Head', cyl(0.0035, 0.15, 4), M.get('#4a4640', 'matte'), [-0.025, c.y + 0.18, c.z - 0.03], [0.25, 0, 0.3])
  },
  bigBurrito(P) {
    // A burrito the size of a baby in its foil, hugged to his chest; the peeled end shows the fillings.
    const { M, B, S } = P, y = B.chestY - 0.1, g = boneGroup(B, 'Chest', [0.02, y, frontAt(S, y) + 0.12])
    const r = new THREE.Group(); r.rotation.set(0.25, 0, -0.75); g.add(r)
    const foil = M.get('#d8dce2', 'metal')
    add(r, cyl(0.1, 0.42, 16), foil, [0, 0, 0]); add(r, ball(0.1, 14), foil, [0, -0.21, 0])
    add(r, cyl(0.1, 0.06, 16), M.get('#e8c890', 'matte'), [0, 0.24, 0])
    add(r, cyl(0.088, 0.01, 16), M.get('#7a3a1e', 'matte'), [0, 0.272, 0])
    for (const [x, z, c] of [[-0.03, 0.02, '#5ab04a'], [0.03, -0.02, '#d8352a'], [0.0, 0.04, '#f2f0e6'], [0.035, 0.035, '#f2c84a']] as const) add(r, ball(0.024, 8), M.get(c, 'matte'), [x, 0.28, z])
  },
  flipPhone(P) {
    // An open flip phone held up, filming: the screen toward her, the lens at the scene.
    const { M } = P, g = gripGroup(P.B, 'Right'), body = M.get(P.c('phone', '#b8bcc2'), 'metal')
    add(g, box(0.05, 0.09, 0.016), body, [0, 0.04, FIST])
    add(g, box(0.05, 0.085, 0.012), body, [0, 0.125, FIST - 0.012], [-0.25, 0, 0])
    add(g, box(0.036, 0.05, 0.003), M.get('#8adcff', 'glow'), [0, 0.127, FIST - 0.02], [-0.25, 0, 0])
  },
  skates(P) {
    // Her roller skates by the laces, swinging at her side.
    const { M } = P, g = gripGroup(P.B, 'Left'), boot = M.get(P.c('boot', '#f4f2ec'), 'gloss'), trim = M.get(P.c('trim', '#2a9a9a'), 'gloss'), wheel = M.get(P.c('wheel', '#e8642a'), 'gloss'), lace = M.get('#f4f2ec', 'matte')
    for (const k of [1, -1]) {
      const sk = new THREE.Group(); sk.position.set(k * 0.05, -0.3, FIST); sk.rotation.set(0, k * 0.3, 0); g.add(sk)
      add(sk, box(0.08, 0.14, 0.1), boot, [0, 0.05, -0.02]); add(sk, box(0.08, 0.06, 0.22), boot, [0, -0.03, 0.03])
      add(sk, box(0.085, 0.02, 0.06), trim, [0, 0.11, -0.02]); add(sk, box(0.06, 0.02, 0.22), M.get('#c9ccd2', 'metal'), [0, -0.07, 0.03])
      for (const z of [-0.05, 0.11]) for (const x of [1, -1]) add(sk, cyl(0.028, 0.025, 12), wheel, [x * 0.045, -0.1, z], [0, 0, Math.PI / 2])
      add(sk, ball(0.02, 8), wheel, [0, -0.07, 0.15])
      const c = capsuleBetween([0, 0.12, -0.02], [-k * 0.05 * Math.cos(k * 0.3), 0.3, 0], 0.004, 4); add(sk, c.geo, lace, c.mid, [c.rot.x, c.rot.y, c.rot.z])
    }
  },
  stopSign(P) {
    // The crossing guard's paddle: a red octagon with a white rim on a pole.
    const { M } = P, g = gripGroup(P.B, 'Right')
    add(g, cyl(0.016, 0.9, 8), M.get('#2a2b2e', 'gloss'), [0, 0.15, FIST])
    const sg = new THREE.Group(); sg.position.set(0, 0.72, FIST); g.add(sg)
    add(sg, cyl(0.22, 0.014, 8), M.get(P.c('sign', '#e0301e'), 'gloss'), [0, 0, 0], [Math.PI / 2, Math.PI / 8, 0])
    for (const z of [0.009, -0.009]) add(sg, new THREE.TorusGeometry(0.2, 0.012, 4, 8), M.get('#fbfaf3', 'gloss'), [0, 0, z], [0, 0, Math.PI / 8])
  },
  selfieStick(P) {
    // A selfie stick up and out in front, the phone at its end turned back at her.
    const { M } = P, g = gripGroup(P.B, 'Right'), black = M.get('#1b1c1f', 'gloss')
    const st = new THREE.Group(); st.position.set(0, 0.02, FIST); st.rotation.set(1.2, 0, 0); g.add(st)
    add(st, cyl(0.012, 0.62, 8), black, [0, 0.3, 0])
    add(st, box(0.04, 0.03, 0.03), black, [0, 0.62, 0])
    add(st, box(0.08, 0.16, 0.012), M.get(P.c('phone', '#f4f2ec'), 'gloss'), [0, 0.68, -0.012], [-1.05, 0, 0])
  },
  breadBowl(P) {
    // A sourdough bread bowl of chowder on her palm, its lid propped on the rim.
    const { M } = P, g = gripGroup(P.B, 'Right', 'tray'), crust = M.get('#b8783a', 'matte')
    add(g, new THREE.SphereGeometry(0.11, 16, 10, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65), crust, [0, 0.13, FIST])
    add(g, cyl(0.094, 0.01, 16), M.get('#f2e8cc', 'matte'), [0, 0.17, FIST])
    for (let i = 0; i < 5; i++) add(g, ball(0.012, 6), M.get(i % 2 ? '#e8b05a' : '#6a9a3a', 'matte'), [Math.cos(i * 1.7) * 0.045, 0.177, FIST + Math.sin(i * 1.7) * 0.045])
    add(g, ball(0.06, 10), crust, [0.1, 0.2, FIST + 0.03], [0, 0, 0.9]).scale.set(1, 0.4, 1)
  },
  gavel(P) {
    const { M } = P, g = gripGroup(P.B, 'Right'), wood = M.get('#7a4a26', 'gloss')
    add(g, cyl(0.011, 0.24, 8), wood, [0, 0.08, FIST])
    add(g, cyl(0.032, 0.12, 12), wood, [0, 0.2, FIST], [Math.PI / 2, 0, 0])
    for (const z of [0.05, -0.05]) add(g, cyl(0.035, 0.012, 12), M.get('#c8a04a', 'metal'), [0, 0.2, FIST + z], [Math.PI / 2, 0, 0])
  },
  binder(P) {
    // Every page of every permit, in a binder under her arm.
    const { M } = P, g = gripGroup(P.B, 'Left')
    add(g, box(0.09, 0.3, 0.25), M.get(P.c('binder', '#26262a'), 'matte'), [-0.04, 0.0, FIST + 0.02])
    add(g, box(0.075, 0.285, 0.25), M.get('#fbfaf3', 'matte'), [-0.04, 0.0, FIST + 0.03])
    for (let i = 0; i < 3; i++) add(g, box(0.07, 0.03, 0.02), M.get(['#e8642a', '#2a9a9a', '#f2c84a'][i], 'matte'), [-0.04, 0.08 - i * 0.07, FIST + 0.16])
  },
  helmet(P) {
    // A skate helmet on her palm, offered to you.
    const { M } = P, g = gripGroup(P.B, 'Right', 'tray')
    add(g, new THREE.SphereGeometry(0.13, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), M.get(P.c('helmet', '#e8642a'), 'gloss'), [0, 0.04, FIST + 0.02]).scale.set(1, 0.9, 1.15)
    add(g, new THREE.TorusGeometry(0.13, 0.012, 6, 24), M.get('#f4f2ec', 'gloss'), [0, 0.045, FIST + 0.02], [Math.PI / 2, 0, 0]).scale.set(1, 1.15, 1)
    for (const x of [-0.05, 0, 0.05]) add(g, box(0.018, 0.02, 0.12), M.get('#1b1c1f', 'matte'), [x, 0.155, FIST + 0.02])
  },
  rope(P) {
    // His slackline: a strap over the right shoulder, the coiled webbing at his left hip.
    const { M, B, S } = P, m = M.get(P.c('rope', '#e8642a'), 'matte')
    const c = capsuleBetween([0.15, B.hipsY + 0.02, frontAt(S, B.hipsY + 0.02) + 0.012], [-0.12, B.neckY - 0.02, frontAt(S, B.neckY - 0.06) + 0.006], 0.018, 4)
    rigid(B.rig, 'Chest', c.geo, m, c.mid, [c.rot.x, c.rot.y, c.rot.z], [1, 1, 0.35])
    const g = boneGroup(B, 'Hips', [0.24, B.hipsY - 0.04, 0.02])
    for (let i = 0; i < 4; i++) add(g, new THREE.TorusGeometry(0.15 - i * 0.01, 0.022, 4, 22), m, [(i - 1.5) * 0.018, 0, 0], [0, Math.PI / 2, 0]).scale.set(1, 1.2, 0.35)
  },
  stroller(P) {
    // The double stroller he pushes, the twins asleep in it; its handlebar is where his hands go.
    const { M, B } = P, g = groundGroup(B, [0, 0, 0.42]), frame = M.get('#2a2b2e', 'gloss'), seat = M.get(P.c('seat', '#2a9a9a'), 'cloth'), hood = M.get(P.c('hood', '#3a4a5a'), 'cloth'), tyre = M.get('#141414', 'matte')
    const hy = B.hipsY + 0.04, tubeTo = (a: V3, b: V3, r = 0.014) => { const c = capsuleBetween(a, b, r, 4); add(g, c.geo, frame, c.mid, [c.rot.x, c.rot.y, c.rot.z]) }
    tubeTo([0.3, hy, 0], [-0.3, hy, 0], 0.017)
    for (const k of [1, -1]) {
      tubeTo([k * 0.29, hy, 0], [k * 0.31, 0.2, 0.62]); tubeTo([k * 0.31, 0.2, 0.62], [k * 0.31, 0.12, 0.82]); tubeTo([k * 0.3, 0.75, 0.15], [k * 0.31, 0.12, 0.08])
      for (const z of [0.08, 0.82]) add(g, cyl(0.1, 0.045, 14), tyre, [k * 0.33, 0.1, z], [0, 0, Math.PI / 2])
      add(g, box(0.27, 0.3, 0.38), seat, [k * 0.14, 0.42, 0.5])
      add(g, new THREE.SphereGeometry(0.16, 14, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), hood, [k * 0.14, 0.58, 0.4], [-0.5, 0, 0]).scale.set(0.85, 0.9, 1)
      add(g, ball(0.06, 10), M.get(P.c('baby', '#f0c8a8'), 'skin'), [k * 0.14, 0.64, 0.54])
      add(g, new THREE.SphereGeometry(0.063, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5), M.get(k > 0 ? '#e8642a' : '#f2c84a', 'knit'), [k * 0.14, 0.652, 0.535], [-0.3, 0, 0])
    }
  },
  schedule(P) { const { M } = P, g = gripGroup(P.B, 'Left'); add(g, box(0.004, 0.22, 0.15), M.paint({ color: '#f4efe0', pattern: { kind: 'bands', colors: ['#d8352a'] } }, 'matte'), [-0.02, 0.06, FIST + 0.02], [0, 0, 0.1]) },
  pug(P) {
    // Mayor Biscuits, out ahead on his leash: a pug in a bow tie.
    const { M, B } = P, g = groundGroup(B, [0, 0, 0])
    g.userData.oneMesh = true
    const d = new THREE.Group(); d.position.set(-0.12, 0, 0.95); d.rotation.y = 0.3; g.add(d)
    dog(P, d, { coat: '#d8b888', patch: '#2a2420', size: 0.62, ears: 'flop', tail: 1.6, tongue: true })
    for (const k of [1, -1]) add(d, new THREE.ConeGeometry(0.028, 0.05, 4), M.get(P.c('bow', '#2a9a9a'), 'gloss'), [k * 0.024, 0.245, 0.12], [0, 0, k * Math.PI / 2])
    const hold = new THREE.Vector3(0, B.hipsY, 0.32), collar = new THREE.Vector3(0, 0.38 * 0.62, 0.15 * 0.62).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.3).add(d.position)
    const c = capsuleBetween(hold.toArray() as V3, collar.toArray() as V3, 0.006, 4); add(g, c.geo, M.get(P.c('leash', '#2a9a9a'), 'gloss'), c.mid, [c.rot.x, c.rot.y, c.rot.z])
  },
  honey(P) {
    const { M } = P, g = gripGroup(P.B, 'Right', 'tray')
    add(g, cyl(0.055, 0.13, 16), M.get('#e8a020', 'glass'), [0, 0.085, FIST])
    add(g, cyl(0.057, 0.03, 16), M.get('#f2ead8', 'matte'), [0, 0.165, FIST])
    add(g, box(0.06, 0.045, 0.004), M.get(P.c('label', '#2a9a9a'), 'matte'), [0, 0.09, FIST + 0.055])
  },
  bee(P) {
    // One of the bees on its field trip, on her shoulder (worn: it stays).
    const { B, M } = P, sh = B.rig.at('LeftArm'), at = (x: number, y: number, z: number): V3 => [sh.x - 0.03 + x, sh.y + 0.06 + y, sh.z + 0.02 + z]
    rigid(B.rig, 'UpperChest', ball(0.02, 8), M.get('#f2c62a', 'matte'), at(0, 0, 0), [0, 0, 0], [0.8, 0.8, 1.3])
    rigid(B.rig, 'UpperChest', cyl(0.017, 0.008, 10), M.get('#1b1c1f', 'matte'), at(0, 0, 0.004), [Math.PI / 2, 0, 0])
    for (const k of [1, -1]) rigid(B.rig, 'UpperChest', ball(0.014, 6), M.get('#f4f6f8', 'glass'), at(k * 0.014, 0.016, -0.004), [0, 0, k * 0.5], [1.2, 0.3, 0.8])
  },
  churros(P) {
    const { M } = P, g = gripGroup(P.B, 'Right'), dough = M.get('#c8843a', 'matte')
    add(g, cyl(0.05, 0.12, 12, 0.03), M.paint({ color: '#f4efe0', pattern: { kind: 'stripes', colors: ['#e8642a'], scale: 0.5 } }, 'matte'), [0, 0.06, FIST])
    for (let i = 0; i < 3; i++) add(g, cyl(0.015, 0.26, 6), dough, [(i - 1) * 0.022, 0.2, FIST + (i % 2) * 0.012], [0.1 * (i - 1), 0, 0.12 * (i - 1)])
  },
  churrocart(P) {
    // Her churro cart beside her: a teal cart, a glass case of churros, a striped awning, two big wheels.
    const { M, B } = P, g = groundGroup(B, [0.95, 0, 0.2]), teal = M.get(P.c('cart', '#2a9a9a'), 'gloss'), chrome = M.get('#c9ccd2', 'metal'), dough = M.get('#c8843a', 'matte')
    add(g, box(1.0, 0.5, 0.55), teal, [0, 0.62, 0])
    add(g, box(1.02, 0.04, 0.57), M.get('#f4f2ec', 'gloss'), [0, 0.89, 0])
    add(g, box(0.9, 0.3, 0.45), M.get('#d8eef0', 'glass'), [0, 1.06, 0])
    for (let i = 0; i < 9; i++) add(g, cyl(0.016, 0.38, 6), dough, [-0.32 + i * 0.08, 0.95, -0.05 + (i % 2) * 0.06], [0, 0, Math.PI / 2 - 0.1 + (i % 3) * 0.08])
    for (const x of [-0.48, 0.48]) for (const z of [-0.25, 0.25]) add(g, cyl(0.012, 0.85, 6), chrome, [x, 1.32, z])
    const awning = M.paint({ color: '#f4efe0', pattern: { kind: 'stripes', colors: [P.c('awning', '#e8642a')], scale: 0.6 } }, 'matte')
    add(g, box(1.15, 0.03, 0.72), awning, [0, 1.76, 0], [0.12, 0, 0])
    for (const k of [1, -1]) { add(g, new THREE.TorusGeometry(0.28, 0.025, 6, 22), M.get('#1b1c1f', 'matte'), [k * 0.56, 0.3, 0], [0, Math.PI / 2, 0]); add(g, cyl(0.03, 0.06, 8), chrome, [k * 0.56, 0.3, 0], [0, 0, Math.PI / 2]) }
    add(g, cyl(0.014, 0.6, 8), chrome, [0, 0.92, -0.42], [0, 0, Math.PI / 2])
  },
  knight(P) {
    // A chess knight (the little horse that moves in an L).
    const { M } = P, g = gripGroup(P.B, 'Left'), black = M.get('#1b1c1f', 'gloss')
    add(g, cyl(0.026, 0.022, 12, 0.03), black, [0, 0.03, FIST])
    add(g, box(0.03, 0.065, 0.05), black, [0, 0.075, FIST], [0.3, 0, 0])
    add(g, box(0.028, 0.03, 0.065), black, [0, 0.105, FIST + 0.018], [-0.5, 0, 0])
    add(g, new THREE.ConeGeometry(0.008, 0.022, 4), black, [0, 0.13, FIST - 0.008])
  },
  map(P) {
    // A paper map from 1987, held open in both hands in front of him.
    const { M, B, S } = P, y = B.chestY - 0.06, g = boneGroup(B, 'Chest', [0, y, frontAt(S, y) + 0.24])
    const paper = M.paint({ color: '#efe4c8', pattern: { kind: 'plaid', colors: ['#7ab8b0', '#e8642a'], scale: 0.7 } }, 'matte')
    for (const k of [1, -1]) add(g, box(0.3, 0.42, 0.004), paper, [k * 0.145, 0, -0.035], [0, -k * 0.25, 0])
  },
}

// ---------------------------------------------------------------- the builder

/** One cast member from their recipe (data/characters.json people[].kit). */
export function kitPerson(spec: CharacterSpec): Draft {
  const s = spec as KitSpec, K = s.kit, M = new Mats(K.finish)
  const topPaint: Paint = K.top ? (K.top.pattern ? { color: K.top.color, pattern: K.top.pattern } : K.top.color) : '#f4f2ec'
  const sleevesOf = (K.layers ?? []).find((l) => ['cardigan', 'jacket', 'denim', 'coat', 'labcoat'].includes(l.kind))
  const sleeves = sleevesOf ? M.paint(sleevesOf.pattern ? { color: sleevesOf.color, pattern: sleevesOf.pattern } : sleevesOf.color, sleevesOf.kind === 'cardigan' ? 'knit' : 'cloth') : K.top?.sleeves ? M.paint(K.top.sleeves) : undefined
  const topM = M.paint(topPaint)
  let B: Body, S: Shape, face: () => Face
  if (K.bird) {
    const r = birdBody(s, M, !!K.top)
    B = r.B; S = r.S; face = r.face
    if (K.top) {
      // A shirt or hoodie over the feathers, and its sleeves over the wings.
      shell(B, S, B.hipsY - 0.06, B.neckY - 0.03, 0.01, topM)
      for (const side of ['Left', 'Right']) tube(B.rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.06, 0.052, 0.044], sleeves ?? topM, { blend: 0.08, caps: [true, false] })
    }
  } else {
    const bod = K.body ?? {}, bottom = K.bottom ?? { kind: 'pants', color: '#3a3d48' }
    const pants = M.paint(bottom.pattern ? { color: bottom.color, pattern: bottom.pattern } : bottom.color)
    B = person(s, {
      top: topM, ...(sleeves ? { sleeves } : {}), pants: bottom.kind === 'skirt' ? M.get(bottom.legs ?? s.colors.skin, bottom.legs ? 'cloth' : 'skin') : pants,
      ...(bottom.kind === 'skirt' ? { skirt: pants } : {}), ...(bottom.kind === 'shorts' ? { shorts: true } : {}),
      shoe: K.shoes?.bare ? M.get(s.colors.skin, 'skin') : M.get(K.shoes?.color ?? '#2a2a2e', 'gloss'), sole: K.shoes?.bare ? M.get(s.colors.skin, 'skin') : M.get(K.shoes?.sole ?? K.shoes?.color ?? '#2a2a2e', 'matte'),
      ...(K.gloves ? { gloves: M.paint(K.gloves.startsWith('#') ? K.gloves : { color: '#f4f0e6', pattern: { kind: 'floral', colors: ['#e8642a', '#2a9a9a', '#f2c84a'] } }) } : {}),
      girth: bod.girth ?? 1, belly: bod.belly ?? 0, bust: bod.bust ?? 0, seed: 11,
    })
    S = { rows: humanRows(B, bod.girth ?? 1, bod.belly ?? 0, bod.bust ?? 0), head: { c: B.hc, r: 0.1, front: 0.105, top: 0.115, ear: 0.095 } }
    const body = B
    face = () => faceOf(body, s, { iris: K.face.iris, brow: K.face.brow, neutral: K.face.neutral ?? 'neutral' })
  }
  if (K.top?.neck) neckOf(B, S, M, K.top.neck, topM, M.get(K.top.collar ?? '#f4f2ec', 'cloth'))
  for (const L of K.layers ?? []) layerOf(B, S, M, L, topM)
  if (K.hair && !K.bird) hairOf(B, S, M, K.hair, !!K.hat)
  if (K.beard && !K.bird) beardOf(B, S, M, K.beard)
  if (K.hat) hatOf(B, S, M, K.hat)
  if (K.glasses) glassesOf(B, S, M, K.glasses, !!K.bird)
  if (K.earrings) earringsOf(B, S, M, K.earrings)
  const hooks: ((c: HookCtx) => void)[] = []
  for (const p of K.props ?? []) {
    const f = PROPS[p.kind]
    if (!f) throw new Error(`characters.json ${s.id}: no kit prop "${p.kind}"`)
    f({ B, S, M, c: (k, d) => p.colors?.[k] ?? d, hooks })
  }
  // Their props (in hand, on the ground beside them) are out standing still and go away while they ride (the
  // story's follow steps draw them on a board; castpeople.ts's people always stand). Worn ones stay.
  const held: THREE.Object3D[] = []
  B.rig.root.traverse((o) => { if (o.userData.prop) held.push(o) })
  if (held.length) {
    let out = true
    hooks.push((c) => { const o = c.idle > 0.4; if (o !== out) { out = o; for (const g of held) g.visible = o } })
  }
  // A skater's signature prop (Create-a-Skater): out only standing still, celebrating and in specials; the
  // skater view holds that hand in the prop's frame while it is out (root userData.signature).
  let sig: { groups: THREE.Object3D[]; hands: Record<string, string>; out: boolean } | null = null
  if (K.signature) {
    const f = PROPS[K.signature]
    if (!f) throw new Error(`${s.id}: no kit prop "${K.signature}"`)
    const before = new Set<THREE.Object3D>()
    for (const side of ['Left', 'Right']) for (const c of B.rig.bones.get(`${side}Hand`)!.children) before.add(c)
    f({ B, S, M, c: (_k, d) => d, hooks })
    const groups: THREE.Object3D[] = [], hands: Record<string, string> = {}
    for (const side of ['Left', 'Right']) for (const c of B.rig.bones.get(`${side}Hand`)!.children) if (!before.has(c) && c.userData.hold) { groups.push(c); hands[side] = c.userData.hold.frame; c.visible = false }
    sig = { groups, hands, out: false }
    const S2 = sig
    hooks.push((c) => {
      const out = c.idleK > 0.4 || (c.landed >= 0 && c.landed < 110) || (c.special > 0.25 && c.specialId !== '')
      if (out !== S2.out) { S2.out = out; for (const g of groups) g.visible = out }
    })
  }
  // Fewer draw calls: each bone's rigid parts and each prop merged by material (the face, built after,
  // keeps its own moving parts).
  mergeBones(B)
  const props: THREE.Object3D[] = []
  B.rig.root.traverse((o) => { if (o.userData.prop) props.push(o) })
  for (const o of props) mergeTree(o)
  const character = new Character(B.rig.root)
  if (sig) character.root.userData.signature = sig   // the skater view reads it (the prop hand's frame)
  return { spec: s, character, face: face(), ...(hooks.length ? { hook: (c: HookCtx) => { for (const h of hooks) h(c) } } : {}) }
}

/** Each bone's own rigid meshes (not the face's pivots, not skinned parts) merged into one per material. */
function mergeBones(B: Body) {
  for (const bone of B.rig.bones.values()) {
    const by = new Map<THREE.Material, THREE.Mesh[]>()
    for (const c of bone.children) { const m = c as THREE.Mesh; if (m.isMesh && !(m as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray(m.material)) { const k = m.material as THREE.Material; if (!by.has(k)) by.set(k, []); by.get(k)!.push(m) } }
    for (const [mat, list] of by) {
      if (list.length < 2) continue
      const geo = merged(list.map((m) => { m.updateMatrix(); return [m.geometry, m.matrix.clone()] as [THREE.BufferGeometry, THREE.Matrix4] }))
      const one = new THREE.Mesh(geo, mat); one.castShadow = list.some((m) => m.castShadow)
      for (const m of list) m.removeFromParent()
      bone.add(one)
    }
  }
}

/** A prop's meshes (the whole group, but parts that move on their own) merged into one per material. */
function mergeTree(g: THREE.Object3D) {
  g.updateMatrixWorld(true)
  const inv = g.matrixWorld.clone().invert()
  const by = new Map<THREE.Material, [THREE.BufferGeometry, THREE.Matrix4][]>()
  const gone: THREE.Object3D[] = []
  const walk = (o: THREE.Object3D) => {
    for (const c of o.children) {
      if (c.userData.live) { mergeTree(c); continue }
      const m = c as THREE.Mesh
      if (m.isMesh && !Array.isArray(m.material)) { const k = m.material as THREE.Material; if (!by.has(k)) by.set(k, []); by.get(k)!.push([m.geometry, inv.clone().multiply(m.matrixWorld)]); gone.push(m) }
      else if (!m.isMesh) { walk(c); if (c.children.every((x) => gone.includes(x))) gone.push(c) }
    }
  }
  walk(g)
  for (const o of gone) o.removeFromParent()
  if (g.userData.oneMesh) {
    // Many small parts in many colours (a pack of dogs): one mesh, coloured per vertex.
    const geos: THREE.BufferGeometry[] = []
    for (const [mat, list] of by) {
      const geo = merged(list), c = (mat as Mat).color, n = geo.attributes.position.count, a = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3)
      geo.setAttribute('color', new THREE.Float32BufferAttribute(a, 3))
      geos.push(geo)
    }
    const m = new THREE.MeshLambertMaterial({ vertexColors: true }); m.name = 'prop colours'
    m.userData.real = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 })
    const one = new THREE.Mesh(mergeGeometries(geos), m); one.castShadow = true; g.add(one)
    return
  }
  for (const [mat, list] of by) { const one = new THREE.Mesh(merged(list), mat); one.castShadow = true; g.add(one) }
}

/** The kit's props (tests, the docs). */
export const KIT_PROPS = Object.keys(PROPS)
