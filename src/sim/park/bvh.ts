// Static bounding-volume hierarchy over triangles. Built once per park load;
// deterministic (sorts tie-break on triangle index).

// Nodes are numbered in build (pre-)order, so an inner node's left child is the next node. A node's
// box is six numbers side by side (min x y z, max x y z) so a box test reads one cache line, not
// two: the city's tree is half a million nodes and most of a query's time was waiting on memory.
export type Bvh = {
  box: Float64Array      // 6 per node: min x, y, z, max x, y, z
  start: Int32Array      // leaf: first index into order; inner node: right child (left is n + 1)
  count: Int32Array      // leaf: triangle count (> 0); inner node: 0
  order: Int32Array      // triangle indices, leaf ranges contiguous
  nodes: number
}

const LEAF = 4

export function buildBvh(tv: Float64Array, triCount: number): Bvh {
  const cap = Math.max(1, 2 * triCount)
  const box = new Float64Array(cap * 6)
  const start = new Int32Array(cap), count = new Int32Array(cap)
  const order = new Int32Array(triCount)
  const cen = new Float64Array(triCount * 3)
  for (let t = 0; t < triCount; t++) {
    order[t] = t
    const o = t * 9
    for (let k = 0; k < 3; k++) cen[t * 3 + k] = (tv[o + k] + tv[o + 3 + k] + tv[o + 6 + k]) / 3
  }
  let nodes = 0
  const scratch: number[] = []

  const build = (s: number, e: number): number => {
    const n = nodes++
    let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity
    let cmnx = Infinity, cmny = Infinity, cmnz = Infinity, cmxx = -Infinity, cmxy = -Infinity, cmxz = -Infinity
    for (let i = s; i < e; i++) {
      const t = order[i], o = t * 9
      for (let v = 0; v < 9; v += 3) {
        const x = tv[o + v], y = tv[o + v + 1], z = tv[o + v + 2]
        if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z
        if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z
      }
      const cx = cen[t * 3], cy = cen[t * 3 + 1], cz = cen[t * 3 + 2]
      if (cx < cmnx) cmnx = cx; if (cy < cmny) cmny = cy; if (cz < cmnz) cmnz = cz
      if (cx > cmxx) cmxx = cx; if (cy > cmxy) cmxy = cy; if (cz > cmxz) cmxz = cz
    }
    box[n * 6] = mnx; box[n * 6 + 1] = mny; box[n * 6 + 2] = mnz
    box[n * 6 + 3] = mxx; box[n * 6 + 4] = mxy; box[n * 6 + 5] = mxz
    if (e - s <= LEAF) { start[n] = s; count[n] = e - s; return n }
    const ex = cmxx - cmnx, ey = cmxy - cmny, ez = cmxz - cmnz
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2
    const mid = (s + e) >> 1
    if (e - s <= 2 * LEAF + 1) {
      // A child of this node may be a leaf, whose triangle order is this sort's: sort fully.
      scratch.length = 0
      for (let i = s; i < e; i++) scratch.push(order[i])
      scratch.sort((a, b) => cen[a * 3 + axis] - cen[b * 3 + axis] || a - b)
      for (let i = s; i < e; i++) order[i] = scratch[i - s]
    } else {
      // Both children re-sort their own ranges, so only the split matters: select the
      // median in linear time (same halves as a full sort, so the same tree). Big worlds
      // (the city) build in about a second instead of tens.
      select(order, s, e, mid, cen, axis)
    }
    build(s, mid)   // node n + 1
    const r = build(mid, e)
    start[n] = r
    count[n] = 0
    return n
  }
  if (triCount > 0) build(0, triCount)
  return { box: box.slice(0, Math.max(1, nodes) * 6), start, count, order, nodes }
}

/**
 * Reorder order[s..e) so order[k] holds the element a full sort by (centroid on axis,
 * index) would put there, smaller ones before it and larger after (introselect:
 * median-of-three quickselect, falling back to a sort if it degrades).
 */
function select(order: Int32Array, s: number, e: number, k: number, cen: Float64Array, axis: number) {
  const less = (a: number, b: number) => { const d = cen[a * 3 + axis] - cen[b * 3 + axis]; return d < 0 || (d === 0 && a < b) }
  let lo = s, hi = e - 1, budget = 2 * (32 - Math.clz32(e - s)) + 8   // 2 ceil(log2(n + 1)) + 8, in exact integer ops
  while (hi > lo) {
    if (budget-- <= 0) {
      const sub = Array.from(order.subarray(lo, hi + 1)).sort((a, b) => cen[a * 3 + axis] - cen[b * 3 + axis] || a - b)
      order.set(sub, lo)
      return
    }
    // Median of three as pivot, moved to hi.
    const m = (lo + hi) >> 1
    if (less(order[m], order[lo])) swap(order, m, lo)
    if (less(order[hi], order[lo])) swap(order, hi, lo)
    if (less(order[m], order[hi])) swap(order, m, hi)
    const pivot = order[hi]
    let i = lo
    for (let j = lo; j < hi; j++) if (less(order[j], pivot)) swap(order, i++, j)
    swap(order, i, hi)
    if (i === k) return
    if (k < i) hi = i - 1
    else lo = i + 1
  }
}
const swap = (a: Int32Array, i: number, j: number) => { const t = a[i]; a[i] = a[j]; a[j] = t }

/** Visit triangles whose node boxes overlap the query box. */
export function queryBox(b: Bvh, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, visit: (tri: number) => void) {
  if (b.nodes === 0) return
  const stack = STACK, box = b.box, start = b.start, count = b.count, order = b.order
  let sp = 0
  stack[sp++] = 0
  while (sp > 0) {
    const n = stack[--sp]
    const o = n * 6
    if (box[o] > hx || box[o + 3] < lx || box[o + 1] > hy || box[o + 4] < ly || box[o + 2] > hz || box[o + 5] < lz) continue
    const c = count[n]
    if (c > 0) {
      const s = start[n], e = s + c
      for (let i = s; i < e; i++) visit(order[i])
    } else {
      stack[sp++] = n + 1
      stack[sp++] = start[n]
    }
  }
}

/**
 * Visit the leaves (node indices) whose boxes overlap the query box, in queryBox's order. A walk
 * reaches a leaf exactly when the leaf's own box overlaps (every ancestor's box contains it).
 */
export function queryLeaves(b: Bvh, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, visit: (node: number) => void) {
  if (b.nodes === 0) return
  const stack = STACK, box = b.box, start = b.start, count = b.count
  let sp = 0
  stack[sp++] = 0
  while (sp > 0) {
    const n = stack[--sp]
    const o = n * 6
    if (box[o] > hx || box[o + 3] < lx || box[o + 1] > hy || box[o + 4] < ly || box[o + 2] > hz || box[o + 5] < lz) continue
    if (count[n] > 0) visit(n)
    else {
      stack[sp++] = n + 1
      stack[sp++] = start[n]
    }
  }
}

/** Ray traversal; visit returns the new max t (shrinks the search). */
export function queryRay(b: Bvh, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, visit: (tri: number, maxT: number) => number): number {
  if (b.nodes === 0) return maxT
  const ix = 1 / dx, iy = 1 / dy, iz = 1 / dz
  const stack = STACK, box = b.box, start = b.start, count = b.count, order = b.order
  let sp = 0
  stack[sp++] = 0
  while (sp > 0) {
    const n = stack[--sp]
    const o = n * 6
    let t0 = 0, t1 = maxT
    let a = (box[o] - ox) * ix, c = (box[o + 3] - ox) * ix
    if (a > c) { const s = a; a = c; c = s }
    if (a > t0) t0 = a; if (c < t1) t1 = c
    if (t0 > t1) continue
    a = (box[o + 1] - oy) * iy; c = (box[o + 4] - oy) * iy
    if (a > c) { const s = a; a = c; c = s }
    if (a > t0) t0 = a; if (c < t1) t1 = c
    if (t0 > t1) continue
    a = (box[o + 2] - oz) * iz; c = (box[o + 5] - oz) * iz
    if (a > c) { const s = a; a = c; c = s }
    if (a > t0) t0 = a; if (c < t1) t1 = c
    if (t0 > t1) continue
    const k = count[n]
    if (k > 0) {
      const s = start[n], e = s + k
      for (let i = s; i < e; i++) maxT = visit(order[i], maxT)
    } else {
      stack[sp++] = n + 1
      stack[sp++] = start[n]
    }
  }
  return maxT
}

const STACK = new Int32Array(256)
