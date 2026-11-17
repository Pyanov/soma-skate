import { describe, expect, it } from 'vitest'
import { bvhDiff, bvhFrom, bvhKey, decodeBvh, encodeBvh, readBvhHeader } from '../src/data/bvhfile.ts'
import { loadData, loadParkSource, readBvhFile } from '../src/harness/io.ts'
import { buildBvh } from '../src/sim/park/bvh.ts'
import { buildPark } from '../src/sim/park/park.ts'
import { nextFloat, seedRng } from '../src/sim/rng.ts'

// The pre-built BVH file (src/data/bvhfile.ts): what it loads is the builder's tree to the bit, and it
// is refused for any other triangles. (`./skate check` compares the shipped files with the builder.)

const data = loadData()
const S = data.physics.surfaces
const buf = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer

/** Random triangles on a grid of coordinates with many ties, both zeros among them (+0/-0). */
function triangles(n: number, seed: number): Float64Array {
  const rng = seedRng(seed)
  const tv = new Float64Array(n * 9)
  for (let i = 0; i < tv.length; i++) {
    const v = Math.round((nextFloat(rng) * 2 - 1) * 4)
    tv[i] = v === 0 ? (nextFloat(rng) < 0.5 ? -0 : 0) : v + (i % 9 < 3 ? 0 : nextFloat(rng) * 0.5)
  }
  return tv
}

describe('bvh file', () => {
  it('round-trips the builder tree to the bit, zero ties included', () => {
    for (const [n, seed] of [[0, 1], [1, 2], [5, 3], [9, 4], [2000, 5], [20000, 6]] as const) {
      const tv = triangles(n, seed)
      const built = buildBvh(tv, n)
      const key = bvhKey('test', S, tv, n)
      const file = encodeBvh(built, tv, n, key, 'test')
      const loaded = decodeBvh(buf(file), key, tv, n)
      expect(loaded, `n ${n}`).not.toBeNull()
      expect(bvhDiff(loaded!, built), `n ${n}`).toEqual([])
    }
    // The zero ties do make the derived boxes differ somewhere (the file's fixups put them back).
    const tv = triangles(20000, 6)
    const file = encodeBvh(buildBvh(tv, 20000), tv, 20000, 'k', 'test')
    expect(readBvhHeader(buf(file))!.fixups).toBeGreaterThan(0)
  })

  it('is refused for other triangles, another park or other surface classes', () => {
    const tv = triangles(3000, 7), n = 3000
    const file = buf(encodeBvh(buildBvh(tv, n), tv, n, bvhKey('p1', S, tv, n), 'p1'))
    expect(bvhFrom(file, 'p1', S)(tv, n)).not.toBeNull()
    expect(bvhFrom(file, 'p2', S)(tv, n)).toBeNull()
    expect(bvhFrom(file, 'p1', { ...S, flatMaxDeg: S.flatMaxDeg + 1 })(tv, n)).toBeNull()
    expect(bvhFrom(file, 'p1', S)(tv.subarray(0, (n - 1) * 9), n - 1)).toBeNull()
    const moved = tv.slice(); moved[9 * 1500 + 4] += 0.25
    expect(bvhFrom(file, 'p1', S)(moved, n)).toBeNull()
    expect(bvhFrom(new ArrayBuffer(64), 'p1', S)(tv, n)).toBeNull()
    expect(bvhFrom(null, 'p1', S)(tv, n)).toBeNull()
  })

  it('a park loads the shipped tree and it is the builder one', () => {
    const src = loadParkSource('soma')
    const file = readBvhFile('soma')
    expect(file).not.toBeNull()
    let used = false
    const from = bvhFrom(file, src.hash, S)
    const park = buildPark(src, data.physics, { bvh: (tv, n) => { const b = from(tv, n); used = b !== null; return b } })
    expect(used).toBe(true)
    expect(bvhDiff(park.bvh, buildBvh(park.tv, park.triCount))).toEqual([])
  })
})
