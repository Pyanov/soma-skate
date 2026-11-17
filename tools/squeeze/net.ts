// The street network for the squeeze's route checks (docs/squeeze.md): the sim's own traffic paths, densified to
// 4 m and joined where a path's end meets another path (within 8 m, at the same height) and where two paths
// cross at the same height. Shared by routes.ts and topdown.ts.
import { loadData, loadPark } from '../../src/harness/io.ts'
import { raycast } from '../../src/sim/park/park.ts'

export const park = loadPark('sf', loadData())
export const paths = park.traffic.paths.filter((p) => p.kind !== 'motorway' && p.kind !== 'motorway_link')

// Graph nodes: every path densified to <= 4 m. Node k of path i is id base[i] + k.
export const X: number[] = [], Y: number[] = [], Z: number[] = [], P: number[] = []
export const adj: [number, number][][] = []
// Off-street nodes: a traffic path that leaves the asphalt (an OpenStreetMap way with no right of way drawn under it,
// through a block) is no route. The top surface at a node must be paved (a path may cut a hairpin's sidewalk corner,
// as on Lombard's crooked block, but never a lot, a lawn or a roof).
const ROAD = new Set(['city_road', 'city_median', 'city_alley'])
const PAVED = new Set([...ROAD, 'city_sidewalk'])
export const offStreet: boolean[] = []
const onRoad = (x: number, y: number, z: number): boolean => {
  const h = raycast(park, { x, y, z: z + 6 }, { x: 0, y: 0, z: -1 }, 12)
  return !!h && PAVED.has(park.elements[park.elem[h.tri]].collection) && Math.abs(h.point.z - z) < 1.5
}
/** The straight line between two points is paved all the way, with nothing standing on it (a parked streetcar, a
 *  bench) and no step over 0.25 m in a metre. */
const STEP = Number(process.env.SQUEEZE_STEP ?? 0.45)   // the steepest a metre of route may climb (a steep connector street; the van climbs it, a curb is 0.15)
export function clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, by - ay)))
  let zp = NaN
  for (let k = 0; k <= n; k++) {
    const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n, z = az + ((bz - az) * k) / n
    const h = raycast(park, { x, y, z: z + 6 }, { x: 0, y: 0, z: -1 }, 12)
    if (!h || !PAVED.has(park.elements[park.elem[h.tri]].collection) || Math.abs(h.point.z - z) > 1.5) return false
    if (Number.isFinite(zp) && Math.abs(h.point.z - zp) > STEP) return false
    zp = h.point.z
    // the van's width: nothing taller than half a metre 1.2 m either side
    const L = Math.hypot(bx - ax, by - ay) || 1, ox = (-(by - ay) / L) * 1.2, oy = ((bx - ax) / L) * 1.2
    for (const sgn of [-1, 1]) {
      const hs = raycast(park, { x: x + ox * sgn, y: y + oy * sgn, z: h.point.z + 6 }, { x: 0, y: 0, z: -1 }, 12)
      if (hs && hs.point.z > h.point.z + 0.5) return false
    }
  }
  return true
}
const link = (a: number, b: number) => {
  if (a === b || offStreet[a] || offStreet[b] || !clear(X[a], Y[a], Z[a], X[b], Y[b], Z[b])) return
  const d = Math.hypot(X[a] - X[b], Y[a] - Y[b]); adj[a].push([b, d]); adj[b].push([a, d])
}
export const firstOf: number[] = [], lastOf: number[] = []
paths.forEach((p, i) => {
  let prev = -1
  for (let k = 0; k + 1 < p.points.length; k++) {
    const a = p.points[k], b = p.points[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / 4))
    for (let j = 0; j < n + (k + 2 === p.points.length ? 1 : 0); j++) {
      const u = j / n, id = X.length
      X.push(a[0] + (b[0] - a[0]) * u); Y.push(a[1] + (b[1] - a[1]) * u); Z.push((a[2] ?? 0) + ((b[2] ?? 0) - (a[2] ?? 0)) * u); P.push(i); adj.push([])
      offStreet.push(!onRoad(X[id], Y[id], Z[id]))
      if (prev >= 0) link(prev, id); else firstOf[i] = id
      prev = id
    }
  }
  lastOf[i] = prev
})
// A grid over the nodes.
const G = new Map<string, number[]>(), C = 8
const key = (x: number, y: number) => `${Math.floor(x / C)},${Math.floor(y / C)}`
X.forEach((x, i) => { const k = key(x, Y[i]); (G.get(k) ?? G.set(k, []).get(k)!).push(i) })
const near = (x: number, y: number, r: number): number[] => {
  const out: number[] = []
  for (let gx = Math.floor((x - r) / C); gx <= Math.floor((x + r) / C); gx++) for (let gy = Math.floor((y - r) / C); gy <= Math.floor((y + r) / C); gy++)
    for (const j of G.get(`${gx},${gy}`) ?? []) if (Math.hypot(X[j] - x, Y[j] - y) <= r) out.push(j)
  return out
}
// Joins: a path's end to the nearest node of another path within 8 m (junctions, T-junctions, a street cut at a
// tile edge meeting the gutter), and nodes of two paths within 2.5 m at the same height (crossings).
const ENDJ = 8, CROSS = 2.5, DZ = 1.5
export let endJoins = 0, crossJoins = 0
paths.forEach((_, i) => {
  for (const e of [firstOf[i], lastOf[i]]) {
    const best = new Map<number, [number, number]>()
    for (const j of near(X[e], Y[e], ENDJ)) {
      if (P[j] === i || Math.abs(Z[j] - Z[e]) > DZ) continue
      const d = Math.hypot(X[j] - X[e], Y[j] - Y[e]), b = best.get(P[j])
      if (!b || d < b[1]) best.set(P[j], [j, d])
    }
    for (const [j] of best.values()) { link(e, j); endJoins++ }
  }
})
for (let i = 0; i < X.length; i++) for (const j of near(X[i], Y[i], CROSS)) if (j > i && P[j] !== P[i] && Math.abs(Z[j] - Z[i]) <= DZ) { link(i, j); crossJoins++ }

// Plaza links: a street that ends at a plaza or a carried street's sidewalk (Powell St at the turntable) reaches
// another street of a different component within 60 m when the straight line between them is all paved ground
// (road, median, alley, sidewalk) with no step over 0.25 m in a metre: the van can cross it. Reported by routes.ts.
export const plazaLinks: [number, number][] = []
function comps(): Int32Array {
  const c = new Int32Array(X.length).fill(-1)
  let k = 0
  for (let i = 0; i < X.length; i++) {
    if (c[i] >= 0 || offStreet[i]) continue
    const st = [i]; c[i] = k
    while (st.length) { const u = st.pop()!; for (const [v] of adj[u]) if (c[v] < 0) { c[v] = k; st.push(v) } }
    k++
  }
  return c
}
export const paved = (a: number, b: number): boolean => clear(X[a], Y[a], Z[a], X[b], Y[b], Z[b])
{
  const c = comps()
  const effEnd = (i: number, fromStart: boolean): number => {
    let e = fromStart ? firstOf[i] : lastOf[i]
    for (let k = 0; k < 10 && offStreet[e]; k++) e += fromStart ? 1 : -1
    return offStreet[e] ? -1 : e
  }
  paths.forEach((_, i) => {
    for (const fromStart of [true, false]) {
      const e = effEnd(i, fromStart)
      if (e < 0) continue
      const best = new Map<number, [number, number]>()
      for (const j of near(X[e], Y[e], 60)) {
        if (offStreet[j] || c[j] === c[e] || c[j] < 0) continue
        const d = Math.hypot(X[j] - X[e], Y[j] - Y[e]), b = best.get(c[j])
        if (!b || d < b[1]) best.set(c[j], [j, d])
      }
      for (const [j] of best.values()) if (paved(e, j)) { link(e, j); plazaLinks.push([e, j]) }
    }
  })
}

export function nearest(x: number, y: number): [number, number] {
  let best = -1, bd = Infinity
  for (let r = 16; r <= 512 && best < 0; r *= 2) for (const j of near(x, y, r)) { const d = Math.hypot(X[j] - x, Y[j] - y); if (d < bd) { bd = d; best = j } }
  return [best, bd]
}
export function dijkstra(a: number): { dist: Float64Array; prev: Int32Array } {
  const dist = new Float64Array(X.length).fill(Infinity), prev = new Int32Array(X.length).fill(-1)
  dist[a] = 0
  const heap: [number, number][] = [[0, a]]
  const push = (e: [number, number]) => { heap.push(e); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p } }
  const pop = (): [number, number] => {
    const top = heap[0], last = heap.pop()!
    if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m } }
    return top
  }
  while (heap.length) {
    const [d, u] = pop()
    if (d > dist[u]) continue
    for (const [v, w] of adj[u]) if (d + w < dist[v]) { dist[v] = d + w; prev[v] = u; push([d + w, v]) }
  }
  return { dist, prev }
}

