import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { decodeCityData, decodeCityRows, type Manifest } from '../sim/park/source.ts'
import { readJson, rel } from './io.ts'

// Geometry hashes of the city export, area by area (tests/city-areas.json). A city phase that adds
// a far-away area must leave every other area exactly as it was: the export works on a fixed 1 mm
// grid with canonical rings (the skatepark repo's city/plan.py), so nothing it does in one corner can
// move a curb, a triangle or a parked car in another. Each area hashes what lies wholly inside its
// box: the solid triangles (ground and walls), the drawn-only ones, the grind lines, and the parked
// cars, street lights and trees. Triangles are compared as sorted corner triples on the 1 mm grid,
// so their order in the file does not matter.

export type AreaBox = [number, number, number, number]   // x0, y0, x1, y1 (site metres)
export type AreaHash = { solid: string; look: string; lines: string; props: string; counts: [number, number, number, number] }

const mm = (v: number) => Math.round(v * 1000)
const digest = (parts: string[]) => createHash('sha256').update(parts.sort().join('\n')).digest('hex').slice(0, 16)

/** The hashes of each named area in the sf city export (assets/park/sf.city.*, or another export's folder). */
export function cityAreaHashes(areas: Record<string, AreaBox>, dir = rel('assets/park')): Record<string, AreaHash> {
  const m = readJson<Manifest>(join(dir, 'sf.city.json'))
  const b = readFileSync(join(dir, 'sf.city.bin'))
  const bin = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  const pos = new Float32Array(bin, 0, m.vertexCount * 3)
  const idx = new Uint32Array(bin, m.vertexCount * 12, m.triangleCount * 3)
  const d = readFileSync(join(dir, m.data!.binary))
  const data = d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength) as ArrayBuffer
  const { rails } = decodeCityData(m.data!, data)
  const rows = decodeCityRows(m.data!, data)
  const names = Object.keys(areas)
  const acc = names.map(() => ({ solid: [] as string[], look: [] as string[], lines: [] as string[], props: [] as string[] }))
  const inside = (x: number, y: number, a: AreaBox) => x >= a[0] && x <= a[2] && y >= a[1] && y <= a[3]
  for (const e of m.elements) {
    const solid = e.role !== 'visual'
    for (let t = e.tris[0]; t < e.tris[0] + e.tris[1]; t++) {
      const c: [number, number, number][] = []
      for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k] * 3; c.push([mm(pos[v]), mm(pos[v + 1]), mm(pos[v + 2])]) }
      for (let ai = 0; ai < names.length; ai++) {
        const a = areas[names[ai]]
        if (!c.every((p) => inside(p[0] / 1000, p[1] / 1000, a))) continue
        c.sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2])
        ;(solid ? acc[ai].solid : acc[ai].look).push(`${e.collection} ${c.map((p) => p.join(',')).join(' ')}`)
      }
    }
  }
  for (const r of rails) {
    for (let ai = 0; ai < names.length; ai++) {
      if (r.points.every((p) => inside(p[0], p[1], areas[names[ai]]))) acc[ai].lines.push(`${r.id} ${r.kind} ${r.points.map((p) => p.map(mm).join(',')).join(' ')}`)
    }
  }
  for (const [kind, list] of [['tree', rows.trees], ['car', rows.cars], ['light', rows.lights]] as const) {
    for (const row of list) {
      for (let ai = 0; ai < names.length; ai++) if (inside(row[0], row[1], areas[names[ai]])) acc[ai].props.push(`${kind} ${row.map(mm).join(',')}`)
    }
  }
  return Object.fromEntries(names.map((n, ai) => [n, {
    solid: digest(acc[ai].solid), look: digest(acc[ai].look), lines: digest(acc[ai].lines), props: digest(acc[ai].props),
    counts: [acc[ai].solid.length, acc[ai].look.length, acc[ai].lines.length, acc[ai].props.length] as [number, number, number, number],
  }]))
}
