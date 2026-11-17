import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { raycast } from '../src/sim/park/park.ts'
import { v3 } from '../src/sim/math.ts'

// The sf world's invisible boundary wall must hold everywhere: beside it the ground may climb
// (hillside lots), and a wall standing on the street grade under a lot let skaters roll or fly off
// the edge of the world (the city sweep's twin-peaks-lot-void, city phase 10). For every wall piece:
// it reaches at least 1 m under the ground at its foot, and at least 4 m over any ground within
// 6 m inside it.

const data = loadData()

describe('boundary wall', () => {
  it('spans the ground beside it everywhere in sf', { timeout: 120000 }, () => {
    const park = loadPark('sf', data)
    const isWall = (tri: number) => park.elements[park.elem[tri]].collection === 'boundary'
    // The top ground under (x, y): the first hit going down that is not the wall itself.
    // Only the street-level ground a skater rolls on counts (the plain context beyond the region and
    // the roofs are not where anyone rolls toward the wall from).
    const STREET = new Set(['city_road', 'city_sidewalk', 'city_alley', 'city_park', 'city_path', 'city_median', 'city_green', 'city_lot', 'city_spot', 'city_curb'])
    const groundAt = (x: number, y: number): number | null => {
      let z = park.boundsMax.z + 5
      for (let k = 0; k < 12; k++) {
        const h = raycast(park, v3(x, y, z), v3(0, 0, -1), z - park.boundsMin.z + 5)
        if (!h) return null
        const c = park.elements[park.elem[h.tri]].collection
        if (STREET.has(c)) return h.point.z
        if (!isWall(h.tri) && c !== 'city_context' && !c.startsWith('city_roof') && c !== 'city_building') return null   // under something else: skip
        z = h.point.z - 0.01
      }
      return null
    }
    const bad: string[] = []
    let pieces = 0
    for (let t = 0; t < park.triCount; t++) {
      if (!isWall(t)) continue
      const o = t * 9, tv = park.tv
      const xs = [tv[o], tv[o + 3], tv[o + 6]], ys = [tv[o + 1], tv[o + 4], tv[o + 7]], zs = [tv[o + 2], tv[o + 5], tv[o + 8]]
      const x = (Math.max(...xs) + Math.min(...xs)) / 2, y = (Math.max(...ys) + Math.min(...ys)) / 2
      const zLo = Math.min(...zs), zHi = Math.max(...zs)
      // The piece's run along the ground and its sideways normal.
      const dx = Math.max(...xs) - Math.min(...xs), dy = Math.max(...ys) - Math.min(...ys)
      if (Math.hypot(dx, dy) < 0.05) continue
      let ux = tv[o + 3] - tv[o], uy = tv[o + 4] - tv[o + 1]
      if (Math.hypot(ux, uy) < 0.05) { ux = tv[o + 6] - tv[o]; uy = tv[o + 7] - tv[o + 1] }
      const L = Math.hypot(ux, uy), nx = -uy / L, ny = ux / L
      pieces++
      for (const side of [1, -1]) {
        const g1 = groundAt(x + nx * side * 1.0, y + ny * side * 1.0)
        if (g1 === null) continue   // outside the world: nothing to hold up there
        if (zLo > g1 - 1.0) bad.push(`(${x.toFixed(1)}, ${y.toFixed(1)}): foot ${zLo.toFixed(2)} over the ground ${g1.toFixed(2)}`)
        for (const d of [1, 3, 6]) {
          const g = groundAt(x + nx * side * d, y + ny * side * d)
          if (g !== null && zHi < g + 4.0) bad.push(`(${x.toFixed(1)}, ${y.toFixed(1)}): top ${zHi.toFixed(2)} under ${(g + 4).toFixed(2)} (ground ${d} m in)`)
        }
      }
    }
    expect(pieces).toBeGreaterThan(1000)
    expect(bad.slice(0, 12)).toEqual([])
  })
})
