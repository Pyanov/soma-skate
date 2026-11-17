import { acos, DEG, v3, type Vec3 } from '../math.ts'
import type { Physics } from '../data.ts'
import { buildBvh, queryBox, queryLeaves, queryRay, type Bvh } from './bvh.ts'
import { closestOnTri, rayTri } from './geom.ts'
import type { ElementInfo, InteriorInfo, ParkSource, LineInfo } from './source.ts'
import { buildGrindGrid, deriveGrindLines, type GrindGrid, type GrindLine } from './grindlines.ts'
import { buildTraffic, type TrafficNet } from './traffic.ts'

// The park at runtime: collidable triangles with surface classes, a BVH, grind
// lines and spawn spots. Visual-only triangles stay in the source for the renderer.

export const Surface = { none: 0, flat: 1, bank: 2, steep: 3, vert: 4, stair: 5, wall: 6, rail: 7 } as const
export type SurfaceClass = (typeof Surface)[keyof typeof Surface]
export const surfaceName = (c: number) => (Object.keys(Surface) as (keyof typeof Surface)[]).find((k) => Surface[k] === c) ?? '?'

const VISUAL_ONLY = new Set(['buildings', 'streets', 'freeway_deck', 'freeway_girders', 'freeway_caps', 'freeway_lights', 'context_estimates', 'ground_detail'])
const WALLS = new Set(['fences', 'gates', 'walls', 'freeway_columns', 'fixtures', 'boundary'])

export type Rail = { id: string; feature: string; kind: string; points: Vec3[] }
export type Spot = { id: string; label: string; pos: Vec3; heading: number }

export type Park = {
  name: string
  hash: string
  triCount: number
  tv: Float64Array        // 9 per collidable triangle
  tn: Float64Array        // unit face normal, 3 per triangle (winding as authored)
  cls: Uint8Array         // surface class per triangle
  elem: Uint16Array       // element index per triangle
  srcTri: Int32Array      // index of the triangle in the source
  bvh: Bvh
  elements: ElementInfo[]
  rails: Rail[]
  grind: GrindLine[]       // grindable lines derived from the geometry
  grindGrid: GrindGrid     // a grid over them, for captures (grindNear)
  lines: LineInfo[]        // rider lines (autopilot routes: scenarios, NPC skaters)
  traffic: TrafficNet      // streets the sim's cars drive (empty outside the city)
  spots: Spot[]
  interiors: InteriorInfo[]  // the city's walk-in rooms and their anchors (empty outside the city)
  boundsMin: Vec3
  boundsMax: Vec3
}

export function classify(e: ElementInfo, nz: number, s: Physics['surfaces']): SurfaceClass {
  // City elements say what they are in role: visual (drawn only), wall, or ground (by slope).
  if (VISUAL_ONLY.has(e.collection) || e.role === 'visual') return Surface.none
  if (e.role === 'wall') return Surface.wall
  if (e.role === 'edge_steel' || e.role === 'guardrail' || e.type.includes('rail')) return Surface.rail
  const slope = acos(Math.abs(nz)) / DEG
  // The flat top of a wall, fence rail or post is something you can stand on (a skater can drop
  // onto a retaining wall from a bank and must not hang there "in air"); the sides stay walls, and
  // the invisible boundary is a wall all over.
  if (WALLS.has(e.collection)) return e.collection !== 'boundary' && nz > 0 && slope <= s.flatMaxDeg ? Surface.flat : Surface.wall
  if (slope <= s.flatMaxDeg) return e.type === 'stairs' || e.type === 'terraced_ledge_steps' ? Surface.stair : Surface.flat
  if (slope <= s.bankMaxDeg) return Surface.bank
  if (slope <= s.steepMaxDeg) return Surface.steep
  return Surface.vert
}

/** Surface class for every source triangle (Surface.none for visual-only). Used by the renderer too. */
export function classifySource(src: ParkSource, s: Physics['surfaces']): Uint8Array {
  const out = new Uint8Array(src.indices.length / 3)
  const p = src.positions, ix = src.indices
  for (const e of src.elements) {
    const [start, count] = e.tris
    for (let t = start; t < start + count; t++) {
      const a = ix[t * 3] * 3, b = ix[t * 3 + 1] * 3, c = ix[t * 3 + 2] * 3
      const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2]
      const wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2]
      const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
      const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
      out[t] = classify(e, nz / l, s)
    }
  }
  return out
}

/**
 * opts.bvh: a pre-built tree for these collision triangles (src/data/bvhfile.ts loads it from the
 * export), or null when it has none for them; buildBvh makes it otherwise, and stays the reference.
 */
export function buildPark(src: ParkSource, physics: Physics, opts: { bvh?: (tv: Float64Array, triCount: number) => Bvh | null } = {}): Park {
  const classes = classifySource(src, physics.surfaces)
  const keep: number[] = []
  const elemOf = new Uint16Array(classes.length)
  src.elements.forEach((e, i) => { for (let t = e.tris[0]; t < e.tris[0] + e.tris[1]; t++) elemOf[t] = i })
  for (let t = 0; t < classes.length; t++) if (classes[t] !== Surface.none) keep.push(t)
  const n = keep.length
  const tv = new Float64Array(n * 9), tn = new Float64Array(n * 3)
  const cls = new Uint8Array(n), elem = new Uint16Array(n), srcTri = new Int32Array(n)
  const bmin = v3(Infinity, Infinity, Infinity), bmax = v3(-Infinity, -Infinity, -Infinity)
  const p = src.positions, ix = src.indices
  keep.forEach((t, i) => {
    for (let k = 0; k < 3; k++) {
      const v = ix[t * 3 + k] * 3
      const x = p[v], y = p[v + 1], z = p[v + 2]
      tv[i * 9 + k * 3] = x; tv[i * 9 + k * 3 + 1] = y; tv[i * 9 + k * 3 + 2] = z
      if (x < bmin.x) bmin.x = x; if (y < bmin.y) bmin.y = y; if (z < bmin.z) bmin.z = z
      if (x > bmax.x) bmax.x = x; if (y > bmax.y) bmax.y = y; if (z > bmax.z) bmax.z = z
    }
    const o = i * 9
    const ux = tv[o + 3] - tv[o], uy = tv[o + 4] - tv[o + 1], uz = tv[o + 5] - tv[o + 2]
    const wx = tv[o + 6] - tv[o], wy = tv[o + 7] - tv[o + 1], wz = tv[o + 8] - tv[o + 2]
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx
    const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
    tn[i * 3] = nx / l; tn[i * 3 + 1] = ny / l; tn[i * 3 + 2] = nz / l
    cls[i] = classes[t]; elem[i] = elemOf[t]; srcTri[i] = t
  })
  const park: Park = {
    name: src.name, hash: src.hash, triCount: n, tv, tn, cls, elem, srcTri,
    bvh: opts.bvh?.(tv, n) ?? buildBvh(tv, n), elements: src.elements,
    rails: src.rails.map((r) => ({ id: r.id, feature: r.feature, kind: r.kind, points: r.points.map(([x, y, z]) => v3(x, y, z)) })),
    grind: [], grindGrid: buildGrindGrid([], 1), traffic: buildTraffic(src.traffic ?? []), lines: src.lines ?? [],
    spots: [], interiors: src.interiors ?? [], boundsMin: bmin, boundsMax: bmax,
  }
  // Keep grind lines only where park floor lies somewhere below (not outside the fence).
  park.grind = deriveGrindLines(src, physics.grind.lines).filter((l) => l.points.every((q) => floorBelow(park, q)))
  park.grind.forEach((l, i) => { l.id = i })
  park.grindGrid = buildGrindGrid(park.grind, physics.grind.lines.gridCell)
  park.spots = src.spots.map((s) => {
    const hit = raycast(park, v3(s.xy[0], s.xy[1], bmax.z + 1), v3(0, 0, -1), bmax.z - bmin.z + 2)
    const z = hit ? hit.point.z : 0
    return { id: s.id, label: s.label, pos: v3(s.xy[0], s.xy[1], z + physics.skater.radius + 0.01), heading: s.heading * DEG }
  })
  return park
}

/** Is there ground (the park's slab or catch floor, or city ground) somewhere under p? */
export function floorBelow(park: Park, p: Vec3): boolean {
  if (floorAt(park, p.x, p.y, p.z)) return true
  // A point on a seam between two surfaces (a bowl's rim: the deck and the bowl meet exactly under its
  // coping) can send the ray down the crack between them: a hair to each side (physics phase 32; Potrero
  // del Sol's pool coping was dropped for it).
  for (const [dx, dy] of [[0.02, 0], [-0.02, 0], [0, 0.02], [0, -0.02]]) if (floorAt(park, p.x + dx, p.y + dy, p.z)) return true
  return false
}

function floorAt(park: Park, x: number, y: number, z0: number): boolean {
  let z = z0 + 0.05
  for (let i = 0; i < 8; i++) {
    const h = raycast(park, v3(x, y, z), v3(0, 0, -1), 10)
    if (!h) return false
    const e = park.elements[park.elem[h.tri]]
    if (e.collection === 'ground' || e.role === 'ground') return true
    z = h.point.z - 0.002
  }
  return false
}

export type RayHit = { t: number; point: Vec3; normal: Vec3; tri: number }

/** Closest hit along a unit direction. The normal faces against the ray. */
export function raycast(park: Park, o: Vec3, d: Vec3, maxT: number): RayHit | null {
  let best = -1
  const t = queryRay(park.bvh, o.x, o.y, o.z, d.x, d.y, d.z, maxT, (tri, m) => {
    const h = rayTri(park.tv, tri * 9, o.x, o.y, o.z, d.x, d.y, d.z)
    if (h >= 0 && h < m) { best = tri; return h }
    return m
  })
  if (best < 0) return null
  let nx = park.tn[best * 3], ny = park.tn[best * 3 + 1], nz = park.tn[best * 3 + 2]
  if (nx * d.x + ny * d.y + nz * d.z > 0) { nx = -nx; ny = -ny; nz = -nz }
  return { t, point: v3(o.x + d.x * t, o.y + d.y * t, o.z + d.z * t), normal: v3(nx, ny, nz), tri: best }
}

export type Contact = { tri: number; px: number; py: number; pz: number; dist: number }

/** All triangles within radius of c, with their closest points. */
export function sphereContacts(park: Park, c: Vec3, r: number, out: Contact[]): Contact[] {
  out.length = 0
  SC.cx = c.x; SC.cy = c.y; SC.cz = c.z; SC.r = r; SC.out = out
  // A triangle whose box misses the sphere's box (by more than AABB_EPS, far above the closest
  // point's rounding) cannot be within r: skip closestOnTri for it. Same contacts, fewer sums.
  SC.lx = c.x - r - AABB_EPS; SC.ly = c.y - r - AABB_EPS; SC.lz = c.z - r - AABB_EPS
  SC.hx = c.x + r + AABB_EPS; SC.hy = c.y + r + AABB_EPS; SC.hz = c.z + r + AABB_EPS
  const lx = c.x - r, ly = c.y - r, lz = c.z - r, hx = c.x + r, hy = c.y + r, hz = c.z + r
  const e = r <= NEAR.maxR && Number.isFinite(c.x + c.y + c.z) ? nearFor(park, c, r, lx, ly, lz, hx, hy, hz) : null
  if (e) {
    // The walk's leaves, from the cache: a leaf counts when its box overlaps the query box; its
    // triangles go through the same box test, on bounds worked out when the cache was filled.
    const box = e.leafBox, end = e.leafEnd, tris = e.tris, tb = e.bounds, verts = e.verts
    let k = 0
    for (let j = 0; j < e.leaves; j++) {
      const o = j * 6
      if (box[o] > hx || box[o + 3] < lx || box[o + 1] > hy || box[o + 4] < ly || box[o + 2] > hz || box[o + 5] < lz) { k = end[j]; continue }
      for (; k < end[j]; k++) {
        const b = k * 6
        if (tb[b] > SC.hx || tb[b + 1] < SC.lx || tb[b + 2] > SC.hy || tb[b + 3] < SC.ly || tb[b + 4] > SC.hz || tb[b + 5] < SC.lz) continue
        contactHit(tris[k], verts, k * 9)
      }
    }
  } else {
    SC.tv = park.tv
    queryBox(park.bvh, lx, ly, lz, hx, hy, hz, contactVisit)
  }
  SC.out = NO_CONTACTS
  out.sort((a, b) => a.dist - b.dist || a.tri - b.tri)
  return out
}

const AABB_EPS = 1e-6
const NO_CONTACTS: Contact[] = []
/** sphereContacts' query, set before each search: one visitor for every call, no closure per query. */
const SC = { tv: new Float64Array(0) as Float64Array<ArrayBufferLike>, cx: 0, cy: 0, cz: 0, r: 0, lx: 0, ly: 0, lz: 0, hx: 0, hy: 0, hz: 0, out: NO_CONTACTS, q: { x: 0, y: 0, z: 0 } }
/** A triangle from the BVH walk: the box test on its corners, then the distance. */
function contactVisit(tri: number) {
  const tv = SC.tv, o = tri * 9
  const ax = tv[o], bx = tv[o + 3], cx = tv[o + 6]
  if ((ax > SC.hx && bx > SC.hx && cx > SC.hx) || (ax < SC.lx && bx < SC.lx && cx < SC.lx)) return
  const ay = tv[o + 1], by = tv[o + 4], cy = tv[o + 7]
  if ((ay > SC.hy && by > SC.hy && cy > SC.hy) || (ay < SC.ly && by < SC.ly && cy < SC.ly)) return
  const az = tv[o + 2], bz = tv[o + 5], cz = tv[o + 8]
  if ((az > SC.hz && bz > SC.hz && cz > SC.hz) || (az < SC.lz && bz < SC.lz && cz < SC.lz)) return
  contactHit(tri, tv, o)
}
/** The triangle's closest point (its corners at tv[o..o+9)); a contact if within r. */
function contactHit(tri: number, tv: Float64Array, o: number) {
  const q = SC.q
  closestOnTri(tv, o, SC.cx, SC.cy, SC.cz, q)
  const dx = SC.cx - q.x, dy = SC.cy - q.y, dz = SC.cz - q.z
  const d2 = dx * dx + dy * dy + dz * dz
  if (d2 < SC.r * SC.r) SC.out.push({ tri, px: q.x, py: q.y, pz: q.z, dist: Math.sqrt(d2) })
}

// Sphere queries come in runs: every skater asks several times a tick about nearly the same spot,
// tick after tick (radius 0.12 and 0.18 m, about forty a tick in a race). A few cached
// neighbourhoods answer almost all of them without walking the city's half-million-node tree. One
// holds the BVH leaves overlapping a box a little bigger than the query that made it, in the walk's
// order, and of their triangles the ones whose bounds reach that box (padded by AABB_EPS), with
// corners and bounds copied side by side. A walk reaches a leaf exactly when the leaf's box overlaps
// the query box (every ancestor's box contains it), so a query inside the cached box reaches only
// cached leaves; the triangles left out fail its box test anyway (min of three corners > h is all
// three > h, NaN included); so a cached answer works out the same triangles in the same order, and
// the contacts are the same bit for bit (decisions.md, phase 9). Scratch, per park; never world state.
const NEAR = { entries: 16, pad: 0.25, half: 0.2, maxR: 1 }   // margin and smallest half-size (m); bigger queries walk
type Near = {
  lx: number; ly: number; lz: number; hx: number; hy: number; hz: number
  leaves: number; leafBox: Float64Array; leafEnd: Int32Array
  n: number; tris: Int32Array; verts: Float64Array; bounds: Float64Array   // bounds: min x, max x, min y, max y, min z, max z
  used: number
}
let nearPark: Park | null = null, nearClock = 0, nearLast = 0
const nears: Near[] = []

/** A cached neighbourhood holding the query box (lx..hz around c), made if none does. */
function nearFor(park: Park, c: Vec3, r: number, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number): Near | null {
  if (nearPark !== park) { nearPark = park; nears.length = 0; nearLast = 0 }
  const n = nears.length
  for (let i = 0; i < n; i++) {
    const j = (nearLast + i) % n, e = nears[j]
    if (lx >= e.lx && ly >= e.ly && lz >= e.lz && hx <= e.hx && hy <= e.hy && hz <= e.hz) { e.used = ++nearClock; nearLast = j; return e }
  }
  let e: Near
  if (n < NEAR.entries) {
    e = { lx: 0, ly: 0, lz: 0, hx: 0, hy: 0, hz: 0, leaves: 0, leafBox: new Float64Array(6 * 16), leafEnd: new Int32Array(16), n: 0, tris: new Int32Array(64), verts: new Float64Array(9 * 64), bounds: new Float64Array(6 * 64), used: 0 }
    nears.push(e); nearLast = n
  } else {
    let w = 0
    for (let j = 1; j < n; j++) if (nears[j].used < nears[w].used) w = j
    e = nears[w]; nearLast = w
  }
  const h = Math.max(r, NEAR.half) + NEAR.pad
  e.lx = c.x - h; e.ly = c.y - h; e.lz = c.z - h; e.hx = c.x + h; e.hy = c.y + h; e.hz = c.z + h
  e.leaves = 0; e.n = 0; e.used = ++nearClock
  FILL.park = park; FILL.e = e
  FILL.lx = e.lx - AABB_EPS; FILL.ly = e.ly - AABB_EPS; FILL.lz = e.lz - AABB_EPS
  FILL.hx = e.hx + AABB_EPS; FILL.hy = e.hy + AABB_EPS; FILL.hz = e.hz + AABB_EPS
  queryLeaves(park.bvh, e.lx, e.ly, e.lz, e.hx, e.hy, e.hz, fillLeaf)
  FILL.park = null; FILL.e = null
  return lx >= e.lx && ly >= e.ly && lz >= e.lz && hx <= e.hx && hy <= e.hy && hz <= e.hz ? e : null
}

const FILL: { park: Park | null; e: Near | null; lx: number; ly: number; lz: number; hx: number; hy: number; hz: number } = { park: null, e: null, lx: 0, ly: 0, lz: 0, hx: 0, hy: 0, hz: 0 }
/** One leaf into the neighbourhood being filled, with its triangles that reach the padded box. */
function fillLeaf(node: number) {
  const b = FILL.park!.bvh, tv = FILL.park!.tv, e = FILL.e!
  const s = b.start[node], cnt = b.count[node], n0 = e.n
  if (e.leaves === e.leafEnd.length) {
    const box = new Float64Array(e.leafBox.length * 2); box.set(e.leafBox); e.leafBox = box
    const end = new Int32Array(e.leafEnd.length * 2); end.set(e.leafEnd); e.leafEnd = end
  }
  if (e.n + cnt > e.tris.length) {
    const cap = Math.max(2 * e.tris.length, e.n + cnt)
    const tris = new Int32Array(cap); tris.set(e.tris); e.tris = tris
    const verts = new Float64Array(9 * cap); verts.set(e.verts); e.verts = verts
    const bounds = new Float64Array(6 * cap); bounds.set(e.bounds); e.bounds = bounds
  }
  for (let i = s; i < s + cnt; i++) {
    const t = b.order[i], o = t * 9
    const mnx = Math.min(tv[o], tv[o + 3], tv[o + 6]), mxx = Math.max(tv[o], tv[o + 3], tv[o + 6])
    const mny = Math.min(tv[o + 1], tv[o + 4], tv[o + 7]), mxy = Math.max(tv[o + 1], tv[o + 4], tv[o + 7])
    const mnz = Math.min(tv[o + 2], tv[o + 5], tv[o + 8]), mxz = Math.max(tv[o + 2], tv[o + 5], tv[o + 8])
    if (mnx > FILL.hx || mxx < FILL.lx || mny > FILL.hy || mxy < FILL.ly || mnz > FILL.hz || mxz < FILL.lz) continue
    e.tris[e.n] = t
    e.verts.set(tv.subarray(o, o + 9), e.n * 9)
    const k = e.n * 6
    e.bounds[k] = mnx; e.bounds[k + 1] = mxx; e.bounds[k + 2] = mny; e.bounds[k + 3] = mxy; e.bounds[k + 4] = mnz; e.bounds[k + 5] = mxz
    e.n++
  }
  if (e.n === n0) return   // nothing here any query inside the box could touch
  e.leafBox.set(b.box.subarray(node * 6, node * 6 + 6), e.leaves * 6)
  e.leafEnd[e.leaves++] = e.n
}
