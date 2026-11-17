import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { deckMaps } from './decks.ts'
import { fbm, hash2, img, mix, normalFromHeight, rgb, roughMap, smooth, texture, vnoise } from './tex.ts'

// The skateboard, modelled in code with real proportions and physically based materials.
// Origin at the board centre on the ground contact plane; +X = nose, +Z = up.
// Deck 0.81 x 0.21 m, 7-ply maple with kicked nose and tail and concave, black grip tape,
// a graphic on the bottom (worn at the tips and scraped by slides); two trucks
// (wheelbase = inner bolt holes, 0.36 m): baseplate, kingpin, bushings, hanger, axle;
// four 53 mm urethane wheels with bearings. Every material is a flat Lambert for the
// grey and cute looks carrying its PBR twin (procedural maps from tex.ts) as userData.real.

const IN = 0.0254
export const BOARD = {
  length: 0.81,
  width: 0.21,
  thickness: 0.012,
  wheelR: 0.0265,                 // 53 mm wheels
  wheelW: 0.032,
  wheelY: 0.089,                  // wheel centre across the board
  innerBolt: 0.18,                // wheelbase / 2
  outerBolt: 0.18 + 2.125 * IN,   // 54 mm hole pattern along the board
  boltY: (1.625 * IN) / 2,        // 41 mm across
  axleX: 0.207,                   // under the baseplate centre
  truckH: 0.055,                  // axle centre to deck bottom
  kickStart: 0.24,                // nose/tail bend starts just past the outer bolts
  kickBend: 0.06,                 // length of the curved part of the kick
  kickDeg: 20,
  concave: 0.005,                 // rail height over the centre line
  pivotZ: 0.07,                   // flip tricks spin about this height (deck centre of mass)
} as const

export const DECK_BOTTOM = BOARD.wheelR + BOARD.truckH        // 0.0815 at the trucks
export const DECK_TOP = DECK_BOTTOM + BOARD.thickness
/** Lowest point of the hanger, for grinds (the hanger sits on the rail). */
export const HANGER_BOTTOM = BOARD.wheelR - 0.011
const HALF = BOARD.length / 2

/** Half width of the outline at x: straight sides, rounded superellipse nose and tail. */
export function halfWidth(x: number): number {
  const ax = Math.abs(x), round = 0.115, x0 = HALF - round
  if (ax <= x0) return BOARD.width / 2
  const u = Math.min(1, (ax - x0) / round)
  return (BOARD.width / 2) * Math.pow(Math.max(0, 1 - Math.pow(u, 2.6)), 1 / 2.6)
}

/** Height the kick adds at x (0 between the trucks). */
export function kick(x: number): number {
  const s = Math.abs(x) - BOARD.kickStart
  if (s <= 0) return 0
  const th = (BOARD.kickDeg * Math.PI) / 180, b = BOARD.kickBend
  if (s < b) return (th * s * s) / (2 * b)
  return (th * b) / 2 + Math.tan(th) * (s - b)
}

/** Top of the grip at (x, y), board space. Foot targets sit on this. */
export function deckTopZ(x: number, y: number): number {
  const hw = Math.max(halfWidth(x), 1e-3)
  const v = Math.min(1, Math.abs(y) / hw)
  const fade = 1 - Math.min(1, Math.max(0, (Math.abs(x) - BOARD.kickStart) / 0.12)) * 0.6
  return DECK_TOP + kick(x) + BOARD.concave * v * v * fade
}

/** Kick angle (radians) at x: the surface slope, for feet standing on the tail or nose. */
export function deckSlope(x: number): number {
  const e = 0.004
  return Math.atan2(deckTopZ(x + e, 0) - deckTopZ(x - e, 0), 2 * e)
}

export const TAIL_TIP = { x: -HALF, z: DECK_TOP + kick(HALF) }
export const NOSE_TIP = { x: HALF, z: DECK_TOP + kick(HALF) }

/** Bolt heads on the grip (board space): foot reference points. */
export const BOLTS = {
  front: [BOARD.innerBolt, BOARD.outerBolt].flatMap((x) => [-1, 1].map((s) => new THREE.Vector3(x, s * BOARD.boltY, deckTopZ(x, s * BOARD.boltY)))),
  back: [-BOARD.innerBolt, -BOARD.outerBolt].flatMap((x) => [-1, 1].map((s) => new THREE.Vector3(x, s * BOARD.boltY, deckTopZ(x, s * BOARD.boltY)))),
}

// ---------------------------------------------------------------- materials

/** Flat colours for the grey and cute looks (the cute toon twin is made from these). */
const FLAT = { grip: 0x26272b, ply: 0xd9b98c, alu: 0xb9bec5, steel: 0x8d9299, bushing: 0xe8b73a, wheel: 0xf1ede2, shield: 0x9aa0a8, seal: 0x2a2b2e, bolt: 0x55595f }
const GRIP_TILE = 0.16          // metres of grip per texture repeat
const PLY_TILE = 0.12

type Mats = Record<keyof typeof FLAT | 'bottom', THREE.MeshLambertMaterial>
type BaseMats = Omit<Mats, 'bottom' | 'wheel'>

function twin(name: string, flat: THREE.MeshLambertMaterialParameters, real: THREE.MeshStandardMaterialParameters): THREE.MeshLambertMaterial {
  const l = new THREE.MeshLambertMaterial(flat)
  l.name = name
  const s = new THREE.MeshStandardMaterial(real)
  s.name = name
  l.userData.real = s
  return l
}

/** Grip tape: black silicon-carbide grit, matte, with a faint lighter wear haze. */
function gripMaps() {
  const N = 512
  const h = new Float32Array(N * N), r = new Float32Array(N * N)
  const a = img(N, N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const g = hash2(x, y, 11), g2 = vnoise(x / 2.2, y / 2.2, N / 2.2, 3)
    const grain = 0.55 * g + 0.45 * g2
    const i = y * N + x
    h[i] = grain
    const dust = fbm(x / 64, y / 64, N / 64, 3, 7)
    const sparkle = hash2(x, y, 29) > 0.985 ? 0.12 : 0
    const v = 0.16 + grain * 0.08 + smooth(0.55, 0.85, dust) * 0.06 + sparkle   // sRGB: charcoal, not pure black
    a.d.set([v, v, v * 1.02, 1], i * 4)
    r[i] = 0.82 + (1 - grain) * 0.16
  }
  return { map: texture(a, true), normal: texture(normalFromHeight(h, N, N, 2.2), false), rough: texture(roughMap(r, N, N), false) }
}

/** The deck's edge: seven maple plies with glue lines, one dyed ply, wood grain along the board. */
function plyMaps() {
  const W = 256, H = 64
  const plies = [0, 0, 0, 1, 0, 0, 0]                   // 1 = dyed (dark blue)
  const maple = rgb(0xd8b382), dyed = rgb(0x24304a)
  const a = img(W, H), h = new Float32Array(W * H), r = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = (y / H) * 7, k = Math.floor(p), f = p - k
    const glue = smooth(0.0, 0.08, f) * (1 - smooth(0.92, 1, f))
    const grain = fbm(x / 6, y / 1.2 + k * 13, W / 6, 3, 5 + k)
    const base = plies[k] ? dyed : maple
    const tone = 0.82 + grain * 0.3
    const g = mix(0.45, 1, glue)
    const i = y * W + x
    a.d.set([base[0] * tone * g, base[1] * tone * g, base[2] * tone * g, 1], i * 4)
    h[i] = glue * 0.6 + grain * 0.4
    r[i] = 0.7 + (1 - glue) * 0.2
  }
  return { map: texture(a, true), normal: texture(normalFromHeight(h, W, H, 1.5), false), rough: texture(roughMap(r, W, H), false) }
}

/** Brushed and cast aluminium: fine streaks along u, a little pitting. */
function metalRough(base: number, spread: number, seed: number) {
  const N = 128
  const r = new Float32Array(N * N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) r[y * N + x] = base + (vnoise(x / 24, y * 1.3, N / 24, seed) - 0.5) * spread + (hash2(x, y, seed) > 0.97 ? spread : 0)
  return texture(roughMap(r, N, N, 1), false)
}

/** Urethane in a colour, the riding surface (middle of the profile, v ~ 0.25..0.75) dirtier and rougher. */
function wheelMaps(color = 0xf2eee3) {
  const W = 64, H = 64
  const a = img(W, H), r = new Float32Array(W * H)
  const white = rgb(color)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / (H - 1)
    const tread = smooth(0.18, 0.3, v) * (1 - smooth(0.7, 0.82, v))
    const n = fbm(x / 6, y / 6, W / 6, 3, 31)
    // A printed logo on each sidewall, twice round the wheel, so you can see it spin.
    const u = x / W, side = 1 - smooth(0.1, 0.16, v) * (1 - smooth(0.84, 0.9, v))
    const logo = side * Math.max(1 - smooth(0.1, 0.13, Math.abs(u - 0.12)), 1 - smooth(0.1, 0.13, Math.abs(u - 0.62)))
    const k = mix(1, 0.62 + n * 0.12, tread) * (1 - 0.45 * logo)
    a.d.set([white[0] * k, white[1] * k * 0.98, white[2] * k * 0.94, 1], (y * W + x) * 4)
    r[y * W + x] = mix(0.42, 0.68, tread) + n * 0.05
  }
  return { map: texture(a, true), rough: texture(roughMap(r, W, H), false) }
}

/** A character's board: its bottom graphic (decks.ts) and wheel colour; everything else is shared. */
export type BoardDesign = { graphic: string; wheel: string }

let cache: BaseMats | null = null
const designCache = new Map<string, Pick<Mats, 'bottom' | 'wheel'>>()
function designMats(d: BoardDesign): Pick<Mats, 'bottom' | 'wheel'> {
  const key = `${d.graphic}|${d.wheel}`
  let m = designCache.get(key)
  if (!m) {
    const bottom = deckMaps(d.graphic), wheel = wheelMaps(new THREE.Color(d.wheel).getHex())
    m = {
      bottom: twin('deck bottom', { map: bottom.map }, { map: bottom.map, normalMap: bottom.normal, roughnessMap: bottom.rough, roughness: 1, metalness: 0 }),
      wheel: twin('urethane', { map: wheel.map }, { map: wheel.map, roughnessMap: wheel.rough, roughness: 1, metalness: 0 }),
    }
    designCache.set(key, m)
  }
  return m
}

function materials(design: BoardDesign = { graphic: 'sunset', wheel: '#f2eee3' }): Mats {
  if (cache) return { ...cache, ...designMats(design) }
  const grip = gripMaps(), ply = plyMaps()
  const lam = (c: number, extra: THREE.MeshLambertMaterialParameters = {}) => ({ color: c, ...extra })
  cache = {
    grip: twin('grip', lam(FLAT.grip), { map: grip.map, normalMap: grip.normal, roughnessMap: grip.rough, roughness: 1, metalness: 0 }),
    ply: twin('maple plies', { map: ply.map }, { map: ply.map, normalMap: ply.normal, roughnessMap: ply.rough, roughness: 1, metalness: 0 }),
    alu: twin('aluminium', lam(FLAT.alu), { color: 0xc4c8cd, roughnessMap: metalRough(0.36, 0.18, 51), metalnessMap: metalRough(0.36, 0.18, 51), roughness: 1, metalness: 1 }),
    steel: twin('steel', lam(FLAT.steel), { color: 0xb8bcc2, roughness: 0.28, metalness: 1 }),
    bushing: twin('bushings', lam(FLAT.bushing), { color: 0xe8b73a, roughness: 0.55, metalness: 0 }),
    shield: twin('bearing shield', lam(FLAT.shield), { color: 0xa9aeb5, roughness: 0.3, metalness: 1 }),
    seal: twin('bearing seal', lam(FLAT.seal), { color: 0x1e1f22, roughness: 0.6, metalness: 0 }),
    bolt: twin('bolt heads', lam(FLAT.bolt), { color: 0x6a6e74, roughness: 0.35, metalness: 1 }),
  }
  return { ...cache, ...designMats(design) }
}

// ---------------------------------------------------------------- geometry

/** Deck surfaces: grip on top, the graphic underneath, the plies round the edge (with uvs). */
function deckGeometry(): { top: THREE.BufferGeometry; bottom: THREE.BufferGeometry; side: THREE.BufferGeometry } {
  // Columns along x, denser in the kicks and round tips; rows across.
  const xs: number[] = []
  const n = 48
  for (let i = 0; i <= n; i++) {
    const u = i / n * 2 - 1
    xs.push(Math.sign(u) * Math.pow(Math.abs(u), 0.8) * HALF)
  }
  const rows = 10
  const T = BOARD.thickness
  const P = (x: number, v: number, lift: number) => {
    const y = v * halfWidth(x)
    return [x, y, deckTopZ(x, y) + lift]
  }
  type G = { p: number[]; uv: number[] }
  const top: G = { p: [], uv: [] }, bot: G = { p: [], uv: [] }, side: G = { p: [], uv: [] }
  const quad = (g: G, q: number[][], uv: number[][]) => {
    for (const k of [0, 1, 2, 0, 2, 3]) { g.p.push(...q[k]); g.uv.push(...uv[k]) }
  }
  // Arc length along the outline, for the plies' u.
  const arc: number[] = [0]
  for (let i = 1; i < xs.length; i++) arc.push(arc[i - 1] + Math.hypot(xs[i] - xs[i - 1], halfWidth(xs[i]) - halfWidth(xs[i - 1]), kick(xs[i]) - kick(xs[i - 1])))
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < rows; j++) {
      const v0 = j / rows * 2 - 1, v1 = (j + 1) / rows * 2 - 1
      const x0 = xs[i], x1 = xs[i + 1]
      const q = [P(x0, v0, 0.001), P(x1, v0, 0.001), P(x1, v1, 0.001), P(x0, v1, 0.001)]
      quad(top, q, q.map((p) => [p[0] / GRIP_TILE, p[1] / GRIP_TILE]))
      const b = [P(x0, v0, -T), P(x0, v1, -T), P(x1, v1, -T), P(x1, v0, -T)]
      quad(bot, b, b.map((p) => [(p[0] + HALF) / BOARD.length, 0.5 - p[1] / BOARD.width]))
    }
    // Side walls along both rails (u along the outline, v down through the plies).
    for (const s of [-1, 1]) {
      const a = P(xs[i], s, 0.001), b = P(xs[i + 1], s, 0.001), c = P(xs[i + 1], s, -T), d = P(xs[i], s, -T)
      const u0 = arc[i] / PLY_TILE, u1 = arc[i + 1] / PLY_TILE
      if (s > 0) quad(side, [a, b, c, d], [[u0, 1], [u1, 1], [u1, 0], [u0, 0]])
      else quad(side, [a, d, c, b], [[u0, 1], [u0, 0], [u1, 0], [u1, 1]])
    }
  }
  const g = (x: G) => {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(x.p, 3))
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(x.uv, 2))
    geo.computeVertexNormals()
    return geo
  }
  return { top: g(top), bottom: g(bot), side: g(side) }
}

const place = (geo: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) => {
  const mesh = new THREE.Mesh(geo, m)
  mesh.position.set(...pos)
  mesh.rotation.set(...rot)
  return mesh
}

/** A tapered rod from a to b (radii r0 at a, r1 at b). */
function rod(a: [number, number, number], b: [number, number, number], r0: number, r1: number, m: THREE.Material): THREE.Mesh {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), 10), m)
  mesh.position.copy(A).add(B).multiplyScalar(0.5)
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize())
  return mesh
}

/** A rounded-rectangle slab (x by y, thickness z), corners of radius r. */
function slab(x: number, y: number, z: number, r: number): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const hx = x / 2 - r, hy = y / 2 - r
  s.moveTo(-hx, -y / 2); s.lineTo(hx, -y / 2); s.absarc(hx, -hy, r, -Math.PI / 2, 0, false)
  s.lineTo(x / 2, hy); s.absarc(hx, hy, r, 0, Math.PI / 2, false)
  s.lineTo(-hx, y / 2); s.absarc(-hx, hy, r, Math.PI / 2, Math.PI, false)
  s.lineTo(-x / 2, -hy); s.absarc(-hx, -hy, r, Math.PI, Math.PI * 1.5, false)
  const g = new THREE.ExtrudeGeometry(s, { depth: z, bevelEnabled: true, bevelThickness: 0.0008, bevelSize: 0.0008, bevelSegments: 1, curveSegments: 4 })
  g.translate(0, 0, -z / 2)
  return g
}

/** The hanger's cast body in the across-board (y) / up (z) plane, extruded along x. */
function hangerGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape()
  const w = 0.066, hb = 0.011, top = 0.034
  s.moveTo(-w, -hb)
  s.lineTo(w, -hb)
  s.quadraticCurveTo(w + 0.006, 0, w, hb)
  s.bezierCurveTo(0.03, hb + 0.002, 0.016, top - 0.006, 0.012, top)
  s.lineTo(-0.012, top)
  s.bezierCurveTo(-0.016, top - 0.006, -0.03, hb + 0.002, -w, hb)
  s.quadraticCurveTo(-w - 0.006, 0, -w, -hb)
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2, curveSegments: 8 })
  g.translate(0, 0, -0.009)
  g.rotateY(Math.PI / 2)        // extrusion along x
  g.rotateX(Math.PI / 2)        // shape (y, z) -> board (y, z)
  return g
}

/** Where a truck's hanger pivots (the pivot cup, outboard of the kingpin), board space. */
export function truckPivot(x: number): THREE.Vector3 { return new THREE.Vector3(x + Math.sign(x) * 0.024, 0, DECK_BOTTOM - 0.0095) }

/** The part of a truck fixed to the deck: baseplate with its bolts' nuts, kingpin, bushings, pivot cup. */
function truckBase(x: number, m: Mats): THREE.Group {
  const g = new THREE.Group()
  const inward = -Math.sign(x)   // towards the board centre
  // Baseplate against the deck, its four bolts' nuts underneath.
  g.add(place(slab(0.066, 0.056, 0.005, 0.008), m.alu, [x, 0, DECK_BOTTOM - 0.0033]))
  const nut = new THREE.CylinderGeometry(0.0042, 0.0042, 0.004, 6)
  for (const bx of [BOARD.innerBolt, BOARD.outerBolt]) for (const s of [-1, 1]) g.add(place(nut, m.steel, [Math.sign(x) * bx, s * BOARD.boltY, DECK_BOTTOM - 0.0078], [Math.PI / 2, 0, 0]))
  // Kingpin on the inboard side, leaning down toward the board centre, bushings and washers
  // on it; the pivot on the outboard side, its arm reaching up into the cup.
  const kp = new THREE.Group()
  kp.position.set(x + inward * 0.01, 0, DECK_BOTTOM - 0.006)
  kp.rotation.y = -inward * 0.62
  const down = (geo: THREE.BufferGeometry, mat: THREE.Material, z: number) => kp.add(place(geo, mat, [0, 0, z], [Math.PI / 2, 0, 0]))
  down(new THREE.CylinderGeometry(0.009, 0.011, 0.012, 12), m.alu, -0.006)
  down(new THREE.CylinderGeometry(0.0042, 0.0042, 0.052, 8), m.steel, -0.024)
  down(new THREE.CylinderGeometry(0.0105, 0.0105, 0.0075, 14), m.bushing, -0.0165)
  down(new THREE.CylinderGeometry(0.0105, 0.0095, 0.0075, 14), m.bushing, -0.0335)
  down(new THREE.CylinderGeometry(0.0118, 0.0118, 0.0012, 14), m.steel, -0.0124)
  down(new THREE.CylinderGeometry(0.0118, 0.0118, 0.0012, 14), m.steel, -0.038)
  down(new THREE.CylinderGeometry(0.0066, 0.0066, 0.006, 6), m.steel, -0.0425)
  g.add(kp)
  g.add(place(new THREE.CylinderGeometry(0.0075, 0.0085, 0.012, 12), m.alu, [x - inward * 0.024, 0, DECK_BOTTOM - 0.0095], [Math.PI / 2, 0, 0]))
  return g
}

/** The part of a truck that turns: the hanger with its pivot arm, the axle, speed washers and nuts. */
function truckHanger(x: number, m: Mats): THREE.Group {
  const g = new THREE.Group()
  const inward = -Math.sign(x)
  g.add(place(hangerGeometry(), m.alu, [x, 0, BOARD.wheelR]))
  g.add(rod([x - inward * 0.002, 0, BOARD.wheelR + 0.03], [x - inward * 0.024, 0, DECK_BOTTOM - 0.012], 0.0075, 0.0055, m.alu))
  const len = 2 * BOARD.wheelY + BOARD.wheelW + 0.014
  g.add(place(new THREE.CylinderGeometry(0.004, 0.004, len, 8), m.steel, [x, 0, BOARD.wheelR]))
  for (const s of [-1, 1]) {
    g.add(place(new THREE.CylinderGeometry(0.0055, 0.0055, 0.0055, 6), m.steel, [x, s * (BOARD.wheelY + BOARD.wheelW / 2 + 0.004), BOARD.wheelR]))
    g.add(place(new THREE.CylinderGeometry(0.0062, 0.0062, 0.001, 12), m.steel, [x, s * (BOARD.wheelY + BOARD.wheelW / 2 + 0.0008), BOARD.wheelR]))
  }
  return g
}

/** A wheel: rounded urethane lathe (axis along board Y); v runs along the profile. */
function wheelGeometry(): THREE.BufferGeometry {
  const r = BOARD.wheelR, w = BOARD.wheelW / 2, e = 0.007, core = 0.0115
  const pts: THREE.Vector2[] = [
    new THREE.Vector2(core, -w + 0.002), new THREE.Vector2(r - e, -w), new THREE.Vector2(r - e * 0.35, -w + e * 0.3),
    new THREE.Vector2(r - e * 0.05, -w + e * 0.75), new THREE.Vector2(r, -w + e * 1.3), new THREE.Vector2(r, w - e * 1.3),
    new THREE.Vector2(r - e * 0.05, w - e * 0.75), new THREE.Vector2(r - e * 0.35, w - e * 0.3), new THREE.Vector2(r - e, w), new THREE.Vector2(core, w - 0.002),
  ]
  return new THREE.LatheGeometry(pts, 24)
}

/**
 * The whole board as a group (board space): the deck with what is bolted to it ('deck', its meshes
 * carrying a flex morph: the middle bows down between the trucks, the kicks flick up), and per
 * truck a hanger that turns about its pivot ('truck:back', 'truck:front') carrying its two wheels
 * ('wheels:back', 'wheels:front', spinning about the axle). About sixteen draw calls.
 */
export function buildBoard(design?: BoardDesign): THREE.Group {
  const m = materials(design)
  const deck = new THREE.Group()
  const d = deckGeometry()
  deck.add(new THREE.Mesh(d.top, m.grip), new THREE.Mesh(d.bottom, m.bottom), new THREE.Mesh(d.side, m.ply))
  // Countersunk bolt heads on the grip.
  const boltG = new THREE.CylinderGeometry(0.0048, 0.0042, 0.0016, 12)
  for (const p of [...BOLTS.front, ...BOLTS.back]) deck.add(place(boltG, m.bolt, [p.x, p.y, p.z + 0.0012], [Math.PI / 2, 0, 0]))
  for (const x of [-BOARD.axleX, BOARD.axleX]) deck.add(truckBase(x, m))
  const board = new THREE.Group()
  board.name = 'board'
  const deckPart = mergeByMaterial(deck, new THREE.Vector3(), 'deck')
  for (const mesh of deckPart.children as THREE.Mesh[]) { addFlex(mesh.geometry); mesh.updateMorphTargets() }
  board.add(deckPart)
  const wg = wheelGeometry()
  const shield = new THREE.RingGeometry(0.0046, 0.0112, 20), seal = new THREE.RingGeometry(0.0112, 0.0122, 20), bore = new THREE.CircleGeometry(0.0046, 12)
  for (const x of [-BOARD.axleX, BOARD.axleX]) {
    const pivot = truckPivot(x), end = x < 0 ? 'back' : 'front'
    const hanger = mergeByMaterial(truckHanger(x, m), pivot, `truck:${end}`)
    const wheels = new THREE.Group()
    for (const s of [-1, 1]) {
      const w = new THREE.Mesh(wg, m.wheel)
      w.position.set(x, s * BOARD.wheelY, BOARD.wheelR)
      wheels.add(w)
      // Bearings in both faces of the wheel: steel shield, black seal ring, the axle hole.
      for (const f of [-1, 1]) {
        const yy = s * BOARD.wheelY + f * (BOARD.wheelW / 2 - 0.0016)
        for (const [geo, mat] of [[shield, m.shield], [seal, m.seal], [bore, m.seal]] as const) {
          const b = new THREE.Mesh(geo, mat)
          b.position.set(x, yy, BOARD.wheelR)
          b.rotation.x = -f * Math.PI / 2
          wheels.add(b)
        }
      }
    }
    // The wheels' group sits on the axle (in the hanger's frame), so turning it about y spins them.
    const axle = new THREE.Vector3(x, 0, BOARD.wheelR)
    const wheelPart = mergeByMaterial(wheels, axle, `wheels:${end}`)
    wheelPart.position.sub(pivot)
    hanger.add(wheelPart)
    board.add(hanger)
  }
  return board
}

/** The deck's flex (a relative morph target, metres per unit): down between the trucks, the kicks up. */
function addFlex(g: THREE.BufferGeometry) {
  const pos = g.getAttribute('position'), d = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const ax = Math.abs(pos.getX(i))
    d[i * 3 + 2] = ax <= BOARD.innerBolt ? -(1 - (ax / BOARD.innerBolt) ** 2) : 0.35 * (ax - BOARD.innerBolt) / (HALF - BOARD.innerBolt)
  }
  g.morphAttributes.position = [new THREE.Float32BufferAttribute(d, 3)]
  g.morphTargetsRelative = true
}

/** One mesh per material, in a group placed at origin (its meshes are offset by -origin). */
function mergeByMaterial(src: THREE.Group, origin: THREE.Vector3, name: string): THREE.Group {
  src.updateMatrixWorld(true)
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const back = new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z)
  src.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(back.clone().multiply(m.matrixWorld))
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name)
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2))
    const mat = m.material as THREE.Material
    byMat.set(mat, [...(byMat.get(mat) ?? []), g])
  })
  const out = new THREE.Group()
  out.name = name
  out.position.copy(origin)
  for (const [mat, gs] of byMat) {
    const mesh = new THREE.Mesh(gs.length === 1 ? gs[0] : mergeGeometries(gs), mat)
    mesh.castShadow = true
    mesh.receiveShadow = true
    out.add(mesh)
  }
  return out
}
