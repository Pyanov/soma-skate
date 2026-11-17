// The park's BVH, pre-built at export time (./skate park, ./skate city, ./skate bvh) and loaded
// instead of built (the city's took 3 s on a phone, and its scratch arrays were the biggest thing in
// memory while loading). The sim's own buildBvh stays the reference and the fallback: a file that does
// not match the park it is loaded for is ignored, and `./skate check` builds every shipped tree from
// the triangles and compares it with the file, to the bit (docs/decisions.md, 2026-10-17).
//
// What the file holds is the part of the tree that costs time to find: each node's triangle count
// (0 = an inner node) in build order, and the triangle order. The rest follows in one pass over the
// nodes: nodes are numbered in pre-order, so a leaf's first index is the running sum of the leaf
// counts before it and an inner node's right child is the node after its left subtree; a leaf's box
// is its triangles' bounds, read in the same order the builder reads them, and an inner node's box
// is its children's union. min and max are exact, so that union equals the builder's own pass over
// the whole range, except that it may pick the other zero of a +0/-0 tie; the encoder compares the
// derived boxes with the builder's and stores any number that differs, which the decoder puts back.
// About 6 MB for the city instead of 60 (a third of the city's own geometry, gzipped).
//
// Layout (little endian): "SKATEBVH", u32 header length, the JSON header (padded to 8 bytes), then
// u8 count[nodes] (padded to 4), i32 order[triCount] (padded to 8), i32 fix index[k] (padded to 8),
// f64 fix value[k].

import type { Bvh } from '../sim/park/bvh.ts'
import type { Physics } from '../sim/data.ts'
import { hashString } from '../sim/hash.ts'
import { WORLDS } from '../sim/park/source.ts'

const MAGIC = 'SKATEBVH'
const FORMAT = 1

export type BvhHeader = { format: number; key: string; park: string; triCount: number; nodes: number; fixups: number }

/** The file beside a world's files in assets/park: soma.park.bvh.bin for the park, sf.city.bvh.bin for the park plus the city; none for the generated lab. */
export const bvhFileFor = (world: string): string | null => world === 'lab' ? null : `${WORLDS[world]?.city ?? `${world}.park`}.bvh.bin`

/** buildPark's opts.bvh for a world's file (null: none, or not for these triangles; buildPark then builds it). */
export const bvhFrom = (file: ArrayBuffer | null | undefined, parkHash: string, surfaces: Physics['surfaces']) =>
  (tv: Float64Array, triCount: number): Bvh | null => file ? decodeBvh(file, bvhKey(parkHash, surfaces, tv, triCount), tv, triCount) : null

/**
 * What a tree is valid for: the park's hash (the export), the surface classes (they choose which
 * triangles collide), the triangle count, and a hash of every collision triangle's numbers (so a
 * change the park hash does not see, such as the classifier's, still makes the file stale). The
 * hash reads the city's 88 MB of triangles in about 15 ms (60 on a throttled phone).
 */
export function bvhKey(parkHash: string, surfaces: Physics['surfaces'], tv: Float64Array, triCount: number): string {
  const w = new Uint32Array(tv.buffer, tv.byteOffset, triCount * 18)
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995
  for (let i = 0; i < w.length; i += 2) {
    h1 = Math.imul(h1 ^ w[i], 0x01000193)
    h2 = Math.imul(h2 ^ w[i + 1], 0x01000195)
  }
  const hex = (h: number) => (h >>> 0).toString(16).padStart(8, '0')
  return `${parkHash}|${hashString(JSON.stringify(surfaces))}|${triCount}|${hex(h1)}${hex(h2)}`
}

/** The header alone (for messages: which park a stale file was built for). */
export function readBvhHeader(file: ArrayBuffer): BvhHeader | null {
  if (file.byteLength < 12) return null
  const b = new Uint8Array(file, 0, 8)
  for (let i = 0; i < 8; i++) if (b[i] !== MAGIC.charCodeAt(i)) return null
  const n = new DataView(file).getUint32(8, true)
  if (12 + n > file.byteLength) return null
  let s = ''
  const hb = new Uint8Array(file, 12, n)
  for (let i = 0; i < hb.length; i += 8192) s += String.fromCharCode(...hb.subarray(i, i + 8192))
  try {
    const h = JSON.parse(s) as BvhHeader
    return h && h.format === FORMAT ? h : null
  } catch { return null }
}

const pad = (n: number, a: number) => Math.ceil(n / a) * a

/**
 * The tree the file holds, for these collision triangles; null when the file is not for them (another
 * park, other surface classes, a corrupt or old file): the caller builds it then.
 */
export function decodeBvh(file: ArrayBuffer, key: string, tv: Float64Array, triCount: number): Bvh | null {
  const h = readBvhHeader(file)
  if (!h || h.key !== key || h.triCount !== triCount) return null
  const { nodes, fixups } = h
  let off = pad(12 + new DataView(file).getUint32(8, true), 8)
  const countOff = off; off = pad(off + nodes, 4)
  const orderOff = off; off = pad(off + triCount * 4, 8)
  const fixIdxOff = off; off = pad(off + fixups * 4, 8)
  const fixValOff = off; off += fixups * 8
  if (off > file.byteLength || nodes > 2 * triCount || (triCount > 0 && nodes < 1)) return null
  const cap = Math.max(1, 2 * triCount)
  const start = new Int32Array(cap), count = new Int32Array(cap)
  count.set(new Uint8Array(file, countOff, nodes))
  const order = new Int32Array(triCount)
  order.set(new Int32Array(file, orderOff, triCount))
  const box = new Float64Array(Math.max(1, nodes) * 6)
  if (nodes > 0 && !derive(tv, box, start, count, order, nodes, triCount)) return null
  const fi = new Int32Array(file, fixIdxOff, fixups), fv = new Float64Array(file, fixValOff, fixups)
  for (let i = 0; i < fixups; i++) {
    if (fi[i] < 0 || fi[i] >= box.length) return null
    box[fi[i]] = fv[i]
  }
  return { box, start, count, order, nodes }
}

/**
 * Leaf starts, right children and boxes from the counts and the order (see the top of the file).
 * False when the counts do not make a tree over exactly these triangles.
 */
function derive(tv: Float64Array, box: Float64Array, start: Int32Array, count: Int32Array, order: Int32Array, nodes: number, triCount: number): boolean {
  let leafStart = 0, ok = true
  const walk = (n: number, depth: number): number => {
    if (n >= nodes || depth > 200) { ok = false; return nodes }
    const c = count[n], o = n * 6
    if (c > 0) {
      const s = leafStart, e = s + c
      if (e > triCount) { ok = false; return nodes }
      start[n] = s
      leafStart = e
      // The builder's loop, over the builder's order (a leaf's range is never reordered after its box).
      let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity
      for (let i = s; i < e; i++) {
        const t = order[i], q = t * 9
        if (t < 0 || t >= triCount) { ok = false; return nodes }
        for (let v = 0; v < 9; v += 3) {
          const x = tv[q + v], y = tv[q + v + 1], z = tv[q + v + 2]
          if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z
          if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z
        }
      }
      box[o] = mnx; box[o + 1] = mny; box[o + 2] = mnz; box[o + 3] = mxx; box[o + 4] = mxy; box[o + 5] = mxz
      return n + 1
    }
    const r = walk(n + 1, depth + 1)
    if (!ok) return nodes
    start[n] = r
    const end = walk(r, depth + 1)
    if (!ok) return nodes
    const a = (n + 1) * 6, b = r * 6
    for (let k = 0; k < 3; k++) {
      box[o + k] = box[b + k] < box[a + k] ? box[b + k] : box[a + k]
      box[o + 3 + k] = box[b + 3 + k] > box[a + 3 + k] ? box[b + 3 + k] : box[a + 3 + k]
    }
    return end
  }
  const end = walk(0, 0)
  return ok && end === nodes && leafStart === triCount
}

/** The file for a tree buildBvh made over these triangles. Throws if the tree is not one the decoder can rebuild exactly. */
export function encodeBvh(bvh: Bvh, tv: Float64Array, triCount: number, key: string, parkHash: string): Uint8Array {
  const { nodes } = bvh
  for (let n = 0; n < nodes; n++) if (bvh.count[n] > 255 || bvh.count[n] < 0) throw new Error(`bvh node ${n} has ${bvh.count[n]} triangles (the file stores up to 255)`)
  // Derive as the decoder will, then keep every box number that differs from the builder's (by bits).
  const cap = Math.max(1, 2 * triCount)
  const start = new Int32Array(cap), count = new Int32Array(cap), box = new Float64Array(Math.max(1, nodes) * 6)
  count.set(bvh.count.subarray(0, nodes))
  if (nodes > 0 && !derive(tv, box, start, count, bvh.order, nodes, triCount)) throw new Error('the bvh counts do not make a tree over its triangles')
  for (let n = 0; n < nodes; n++) if (start[n] !== bvh.start[n]) throw new Error(`bvh node ${n}: derived start ${start[n]} != built ${bvh.start[n]}`)
  const a = new Uint32Array(box.buffer), b = new Uint32Array(bvh.box.buffer, bvh.box.byteOffset, bvh.box.length * 2)
  const fix: number[] = []
  for (let i = 0; i < box.length; i++) if (a[i * 2] !== b[i * 2] || a[i * 2 + 1] !== b[i * 2 + 1]) fix.push(i)
  const header: BvhHeader = { format: FORMAT, key, park: parkHash, triCount, nodes, fixups: fix.length }
  let json = JSON.stringify(header)
  json += ' '.repeat(pad(12 + json.length, 8) - 12 - json.length)
  let off = 12 + json.length
  const countOff = off; off = pad(off + nodes, 4)
  const orderOff = off; off = pad(off + triCount * 4, 8)
  const fixIdxOff = off; off = pad(off + fix.length * 4, 8)
  const fixValOff = off; off += fix.length * 8
  const out = new Uint8Array(off)
  for (let i = 0; i < 8; i++) out[i] = MAGIC.charCodeAt(i)
  new DataView(out.buffer).setUint32(8, json.length, true)
  for (let i = 0; i < json.length; i++) out[12 + i] = json.charCodeAt(i)
  for (let n = 0; n < nodes; n++) out[countOff + n] = bvh.count[n]
  new Int32Array(out.buffer, orderOff, triCount).set(bvh.order)
  new Int32Array(out.buffer, fixIdxOff, fix.length).set(fix)
  const fv = new Float64Array(out.buffer, fixValOff, fix.length)
  fix.forEach((i, k) => { fv[k] = bvh.box[i] })
  return out
}

/** Where two trees differ (empty when they are the same to the bit): the check's comparison. */
export function bvhDiff(a: Bvh, b: Bvh): string[] {
  const out: string[] = []
  if (a.nodes !== b.nodes) out.push(`nodes ${a.nodes} != ${b.nodes}`)
  const bytes = (x: ArrayBufferView) => new Uint8Array(x.buffer, x.byteOffset, x.byteLength)
  for (const k of ['box', 'start', 'count', 'order'] as const) {
    const x = bytes(a[k]), y = bytes(b[k])
    if (a[k].length !== b[k].length) { out.push(`${k}: length ${a[k].length} != ${b[k].length}`); continue }
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) { out.push(`${k}: first difference at byte ${i}`); break }
  }
  return out
}
