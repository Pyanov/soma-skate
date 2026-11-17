import { cos, v3, type Vec3 } from '../math.ts'
import type { ElementInfo, ParkSource } from './source.ts'

// Grind lines derived from the park's own geometry, so they sit exactly on real
// corners: convex edges where a near-level top meets a steep side (ledges, pads,
// coping on quarterpipes, terrace edges, platform drops), plus round rails from
// the export. Rebuilt on every park load, so park fixes carry over automatically.

export type GrindLine = {
  id: number
  element: string
  kind: 'ledge' | 'coping' | 'rail'
  points: Vec3[]
  cum: number[]          // arc length at each point
  length: number
  lo: Vec3; hi: Vec3     // bounding box of the points (a quick reject before closestOnLine)
  feature?: string       // the export's feature for its own lines ('car roof', 'handrail'), for gaps
}

export type GrindOpts = { topMaxDeg: number; sideMinDeg: number; minDrop: number; minLength: number; mergeDeg: number }

const NO_GRIND = new Set(['stairs'])
const GRIND_COLLECTIONS = new Set(['obstacles'])   // perimeter walls sit on the fence line: not grindable

export function deriveGrindLines(src: ParkSource, o: GrindOpts): GrindLine[] {
  const p = src.positions, ix = src.indices
  const topCos = cos((o.topMaxDeg * Math.PI) / 180), sideCos = cos((o.sideMinDeg * Math.PI) / 180)
  const lines: GrindLine[] = []
  const typeOf = new Map(src.elements.filter((e) => e.role === 'body').map((e) => [e.feature, e.type]))
  for (const e of src.elements) {
    if (!GRIND_COLLECTIONS.has(e.collection) || e.role === 'edge_steel' || e.role === 'guardrail') continue
    if (NO_GRIND.has(e.type) || e.type.includes('rail')) continue
    const segs = elementEdges(p, ix, e, topCos, sideCos, o.minDrop)
    const kind = /quarterpipe|transition/.test(typeOf.get(e.feature) ?? e.type) ? 'coping' : 'ledge'
    for (const chain of chainSegments(segs, o.mergeDeg)) {
      const line = makeLine(lines.length, e.id, kind, chain)
      if (line.length >= o.minLength) lines.push(line)
    }
  }
  for (const r of src.rails) {
    // Round rails, plus edges the export lists itself (city curbs and ledges), which grind like ledges, and its
    // copings (Potrero del Sol's pool coping, the DIY spot's quarter: physics phase 32; dropped before, so no
    // city bowl or quarter had a coping to grind or stall on).
    const kind = r.kind === 'rail' ? 'rail' : r.kind === 'curb' || r.kind === 'ledge' ? 'ledge' : r.kind === 'coping' && r.feature === 'coping' ? 'coping' : null   // the park's own coping edges are derived from its bodies above
    if (!kind || r.id.endsWith('_midrail')) continue   // the bar under a rail is not reachable from above
    const line = makeLine(lines.length, r.id, kind, r.points.map(([x, y, z]) => v3(x, y, z)))
    if (r.feature) line.feature = r.feature
    if (line.length >= o.minLength) lines.push(line)
  }
  return lines
}

type Seg = [Vec3, Vec3]
const key = (x: number, y: number, z: number) => `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`

/** Edges of one element shared by a top face and a steep face, where the solid is convex. */
function elementEdges(p: Float32Array, ix: Uint32Array, e: ElementInfo, topCos: number, sideCos: number, minDrop: number): Seg[] {
  const [start, count] = e.tris
  type Face = { n: Vec3; c: Vec3 }
  const faces: Face[] = []
  const edges = new Map<string, { a: Vec3; b: Vec3; faces: number[] }>()
  for (let t = start; t < start + count; t++) {
    const vs: Vec3[] = [0, 1, 2].map((k) => { const i = ix[t * 3 + k] * 3; return v3(p[i], p[i + 1], p[i + 2]) })
    const u = sub(vs[1], vs[0]), w = sub(vs[2], vs[0])
    let n = v3(u.y * w.z - u.z * w.y, u.z * w.x - u.x * w.z, u.x * w.y - u.y * w.x)
    const l = Math.hypot(n.x, n.y, n.z)
    if (l < 1e-9) continue
    n = v3(n.x / l, n.y / l, n.z / l)
    const fi = faces.push({ n, c: v3((vs[0].x + vs[1].x + vs[2].x) / 3, (vs[0].y + vs[1].y + vs[2].y) / 3, (vs[0].z + vs[1].z + vs[2].z) / 3) }) - 1
    for (let k = 0; k < 3; k++) {
      const a = vs[k], b = vs[(k + 1) % 3]
      const ka = key(a.x, a.y, a.z), kb = key(b.x, b.y, b.z)
      const kk = ka < kb ? ka + '|' + kb : kb + '|' + ka
      const rec = edges.get(kk)
      if (rec) rec.faces.push(fi)
      else edges.set(kk, { a, b, faces: [fi] })
    }
  }
  const out: Seg[] = []
  for (const { a, b, faces: fs } of edges.values()) {
    if (fs.length !== 2) continue
    const [f0, f1] = [faces[fs[0]], faces[fs[1]]]
    // Orientation-agnostic: one face reads as a top (|nz| high), the other as a side (|nz| low).
    const top = Math.abs(f0.n.z) >= topCos ? f0 : Math.abs(f1.n.z) >= topCos ? f1 : null
    const side = top === f0 ? f1 : f0
    if (!top || Math.abs(side.n.z) > sideCos) continue
    // Convex: the side face's centroid lies below the edge (the drop is under the top).
    const mz = (a.z + b.z) / 2
    if (side.c.z > mz - minDrop / 3) continue
    if (Math.abs(a.z - b.z) > Math.hypot(a.x - b.x, a.y - b.y) * 1.2) continue   // near-vertical edge
    out.push([a, b])
  }
  return out
}

/** Join segments that share endpoints and turn less than mergeDeg into polylines. */
function chainSegments(segs: Seg[], mergeDeg: number): Vec3[][] {
  const cosMax = cos((mergeDeg * Math.PI) / 180)
  const at = new Map<string, number[]>()
  const k = (q: Vec3) => key(q.x, q.y, q.z)
  segs.forEach(([a, b], i) => { for (const q of [a, b]) at.set(k(q), [...(at.get(k(q)) ?? []), i]) })
  const used = new Uint8Array(segs.length)
  const chains: Vec3[][] = []
  const dir = (a: Vec3, b: Vec3) => { const d = sub(b, a); const l = Math.hypot(d.x, d.y, d.z) || 1; return v3(d.x / l, d.y / l, d.z / l) }
  const extend = (chain: Vec3[]) => {
    for (;;) {
      const end = chain[chain.length - 1], prev = chain[chain.length - 2]
      const d0 = dir(prev, end)
      const next = (at.get(k(end)) ?? []).filter((i) => !used[i]).map((i) => ({ i, far: k(segs[i][0]) === k(end) ? segs[i][1] : segs[i][0] }))
        .map((c) => ({ ...c, cos: dot3(d0, dir(end, c.far)) })).filter((c) => c.cos >= cosMax).sort((x, y) => y.cos - x.cos)[0]
      if (!next) return
      used[next.i] = 1
      chain.push(next.far)
    }
  }
  segs.forEach(([a, b], i) => {
    if (used[i]) return
    used[i] = 1
    const chain = [a, b]
    extend(chain)
    chain.reverse()
    extend(chain)
    chains.push(chain)
  })
  return chains
}

export function makeLine(id: number, element: string, kind: GrindLine['kind'], points: Vec3[]): GrindLine {
  const cum = [0]
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y, points[i].z - points[i - 1].z))
  const lo = v3(Infinity, Infinity, Infinity), hi = v3(-Infinity, -Infinity, -Infinity)
  for (const p of points) { lo.x = Math.min(lo.x, p.x); lo.y = Math.min(lo.y, p.y); lo.z = Math.min(lo.z, p.z); hi.x = Math.max(hi.x, p.x); hi.y = Math.max(hi.y, p.y); hi.z = Math.max(hi.z, p.z) }
  return { id, element, kind, points, cum, length: cum[cum.length - 1], lo, hi }
}

/** Point and unit tangent at arc length s along a line (clamped). */
export function lineAt(l: GrindLine, s: number): { pos: Vec3; tan: Vec3; seg: number } {
  const c = Math.max(0, Math.min(l.length, s))
  let i = 1
  while (i < l.cum.length - 1 && l.cum[i] < c) i++
  const a = l.points[i - 1], b = l.points[i]
  const segLen = l.cum[i] - l.cum[i - 1] || 1
  const t = (c - l.cum[i - 1]) / segLen
  return { pos: v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t), tan: v3((b.x - a.x) / segLen, (b.y - a.y) / segLen, (b.z - a.z) / segLen), seg: i - 1 }
}

/** Closest point on a line to q: arc length and distance. */
export function closestOnLine(l: GrindLine, q: Vec3): { s: number; d: number; pos: Vec3 } {
  let best = { s: 0, d: Infinity, pos: l.points[0] }
  for (let i = 1; i < l.points.length; i++) {
    const a = l.points[i - 1], b = l.points[i]
    const ab = sub(b, a), aq = sub(q, a)
    const len2 = dot3(ab, ab) || 1
    const t = Math.max(0, Math.min(1, dot3(aq, ab) / len2))
    const pos = v3(a.x + ab.x * t, a.y + ab.y * t, a.z + ab.z * t)
    const d = Math.hypot(q.x - pos.x, q.y - pos.y, q.z - pos.z)
    if (d < best.d) best = { s: l.cum[i - 1] + Math.sqrt(len2) * t, d, pos }
  }
  return best
}

const sub = (a: Vec3, b: Vec3) => v3(a.x - b.x, a.y - b.y, a.z - b.z)
const dot3 = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z

/**
 * A uniform grid over x and y of the lines' bounding boxes (compressed rows: cell c holds
 * items[start[c] .. start[c + 1]]), so a capture looks only at lines near the feet however many the
 * park has. Built once per park load; deterministic (lines go in by id).
 */
export type GrindGrid = { cell: number; x0: number; y0: number; nx: number; ny: number; start: Int32Array; items: Int32Array; stamp: Int32Array; query: number }

export function buildGrindGrid(lines: GrindLine[], cell: number): GrindGrid {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const l of lines) { x0 = Math.min(x0, l.lo.x); y0 = Math.min(y0, l.lo.y); x1 = Math.max(x1, l.hi.x); y1 = Math.max(y1, l.hi.y) }
  if (!lines.length) { x0 = y0 = x1 = y1 = 0 }
  const nx = Math.floor((x1 - x0) / cell) + 1, ny = Math.floor((y1 - y0) / cell) + 1
  const cx = (x: number) => Math.min(nx - 1, Math.max(0, Math.floor((x - x0) / cell)))
  const cy = (y: number) => Math.min(ny - 1, Math.max(0, Math.floor((y - y0) / cell)))
  const count = new Int32Array(nx * ny + 1)
  for (const l of lines) for (let j = cy(l.lo.y); j <= cy(l.hi.y); j++) for (let i = cx(l.lo.x); i <= cx(l.hi.x); i++) count[j * nx + i + 1]++
  for (let c = 0; c < nx * ny; c++) count[c + 1] += count[c]
  const start = count.slice(), fill = count.slice(0, nx * ny), items = new Int32Array(start[nx * ny])
  for (const l of lines) for (let j = cy(l.lo.y); j <= cy(l.hi.y); j++) for (let i = cx(l.lo.x); i <= cx(l.hi.x); i++) items[fill[j * nx + i]++] = l.id
  return { cell, x0, y0, nx, ny, start, items, stamp: new Int32Array(lines.length), query: 0 }
}

/**
 * Ids of the lines whose bounding box may reach the box [minX, maxX] x [minY, maxY], in ascending
 * id order (the order a full scan would meet them), each once. Written into `out`.
 */
export function grindNear(g: GrindGrid, minX: number, minY: number, maxX: number, maxY: number, out: number[]): number[] {
  out.length = 0
  const i0 = Math.max(0, Math.floor((minX - g.x0) / g.cell)), i1 = Math.min(g.nx - 1, Math.floor((maxX - g.x0) / g.cell))
  const j0 = Math.max(0, Math.floor((minY - g.y0) / g.cell)), j1 = Math.min(g.ny - 1, Math.floor((maxY - g.y0) / g.cell))
  if (i0 > i1 || j0 > j1) return out
  const q = ++g.query
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const c = j * g.nx + i
    for (let k = g.start[c]; k < g.start[c + 1]; k++) { const id = g.items[k]; if (g.stamp[id] !== q) { g.stamp[id] = q; out.push(id) } }
  }
  return out.sort((a, b) => a - b)
}
