// A park as it arrives from disk or from a generator: raw triangles plus the
// semantic lists. No IO here; the harness and client read the files.

import { hashString } from '../hash.ts'

export type ElementInfo = {
  id: string; element: string; collection: string; feature: string
  name: string; type: string; role: string; tris: [number, number]
}
export type RailInfo = { id: string; feature: string; kind: string; spec: string; points: number[][] }
export type SpotInfo = { id: string; label: string; xy: [number, number]; heading: number }
export type LineInfo = { id: string; points: [number, number][]; maxSlopeDeg: number; radius?: number; traffic?: boolean }   // radius: how close reaches a waypoint (default 1.2 m); traffic: false rides it with the streets cleared
/** A street axis cars drive (city.traffic in the city manifest): OpenStreetMap kind, xyz points. */
export type TrafficPath = { kind: string; oneway: boolean; lanes: number; points: number[][] }

export type ParkSource = {
  name: string
  hash: string
  positions: Float32Array   // xyz per vertex, meters, z up
  indices: Uint32Array      // 3 per triangle, grouped by element
  elements: ElementInfo[]
  rails: RailInfo[]
  spots: SpotInfo[]
  lines?: LineInfo[]        // rider lines (autopilot routes) from the skatepark project
  traffic?: TrafficPath[]   // street axes for the sim's cars (the city only)
  interiors?: InteriorInfo[]   // the city's walk-in rooms (city.interiors): where the story's characters stand inside
}

/** A room you roll into (the city export's city.interiors): its door on the floor, the way in (compass degrees), and anchors: name -> x y z heading (degrees), where someone stands. */
export type InteriorInfo = { id: string; name: string; kind: string; door: [number, number, number]; inward: number; floor: number; anchors: Record<string, [number, number, number, number]> }

/**
 * Where the city export puts its long numeric lists (<name>.data.bin, little endian, sections at
 * byte offsets): grind lines (ids joined by newlines, a (feature, kind, spec) table index, point
 * counts, float64 xyz points), traffic paths (kind index, oneway, lanes; point counts, float64
 * points) and draw-only rows (trees, cars, street lights: [offset, rows, cols] of float64).
 */
export type DataLayout = {
  binary: string; bytes: number
  rails: { count: number; triples: [string, string, string][]; ids: [number, number]; triple: number; npts: number; pts: [number, number] }
  traffic: { count: number; kinds: string[]; meta: number; npts: number; pts: [number, number] }
  trees: [number, number, number]; cars: [number, number, number]; lights: [number, number, number]
}

export type Manifest = {
  format: string; hash: string; vertexCount: number; triangleCount: number
  elements: ElementInfo[]; rails: RailInfo[]; spots: SpotInfo[]; lines?: LineInfo[]; data?: DataLayout
}

/** The data binary's grind lines and traffic paths as the sim uses them (the export's exact float64s). */
export function decodeCityData(layout: DataLayout, buf: ArrayBuffer): { rails: RailInfo[]; traffic: TrafficPath[] } {
  if (buf.byteLength < layout.bytes) throw new Error('city data binary is shorter than its manifest says')
  const R = layout.rails
  // Ids are ASCII (kind_x_y): read them without a text decoder (the sim has no DOM or web APIs).
  const idBytes = new Uint8Array(buf, R.ids[0], R.ids[1])
  let idText = ''
  for (let i = 0; i < idBytes.length; i += 8192) idText += String.fromCharCode(...idBytes.subarray(i, i + 8192))
  const ids = idText.split('\n')
  const tri = new Uint16Array(buf, R.triple, R.count), np = new Uint32Array(buf, R.npts, R.count), pts = new Float64Array(buf, R.pts[0], R.pts[1] * 3)
  const rails: RailInfo[] = new Array(R.count)
  for (let i = 0, k = 0; i < R.count; i++) {
    const [feature, kind, spec] = R.triples[tri[i]]
    const points: number[][] = new Array(np[i])
    for (let j = 0; j < np[i]; j++, k += 3) points[j] = [pts[k], pts[k + 1], pts[k + 2]]
    rails[i] = { id: R.count ? ids[i] : '', feature, kind, spec, points }
  }
  const T = layout.traffic
  const meta = new Uint8Array(buf, T.meta, T.count * 3), tn = new Uint32Array(buf, T.npts, T.count), tp = new Float64Array(buf, T.pts[0], T.pts[1] * 3)
  const traffic: TrafficPath[] = new Array(T.count)
  for (let i = 0, k = 0; i < T.count; i++) {
    const points: number[][] = new Array(tn[i])
    for (let j = 0; j < tn[i]; j++, k += 3) points[j] = [tp[k], tp[k + 1], tp[k + 2]]
    traffic[i] = { kind: T.kinds[meta[i * 3]], oneway: meta[i * 3 + 1] === 1, lanes: meta[i * 3 + 2], points }
  }
  return { rails, traffic }
}

/** The data binary's draw-only rows: trees, parked cars, street lights. */
export function decodeCityRows(layout: DataLayout, buf: ArrayBuffer): { trees: number[][]; cars: number[][]; lights: number[][] } {
  const rows = ([off, n, cols]: [number, number, number]) => {
    const a = new Float64Array(buf, off, n * cols), out: number[][] = new Array(n)
    for (let i = 0; i < n; i++) out[i] = Array.from(a.subarray(i * cols, i * cols + cols))
    return out
  }
  return { trees: rows(layout.trees), cars: rows(layout.cars), lights: rows(layout.lights) }
}

/** soma.park.json + soma.park.bin (Float32 positions, then Uint32 indices); the city's data binary when its manifest names one. */
export function parseParkFiles(name: string, manifest: Manifest, bin: ArrayBuffer, data?: ArrayBuffer): ParkSource {
  if (manifest.format !== 'soma-park/1') throw new Error(`unknown park format ${manifest.format}`)
  const posBytes = manifest.vertexCount * 3 * 4
  const positions = new Float32Array(bin, 0, manifest.vertexCount * 3)   // views, not copies (composeWorld copies once)
  const indices = new Uint32Array(bin, posBytes, Math.min(manifest.triangleCount * 3, Math.floor((bin.byteLength - posBytes) / 4)))
  if (indices.length !== manifest.triangleCount * 3) throw new Error('park binary is shorter than its manifest says')
  let rails = manifest.rails, traffic = (manifest as { city?: { traffic?: TrafficPath[] } }).city?.traffic ?? []
  if (manifest.data) {
    if (!data) throw new Error(`${name}: the manifest names ${manifest.data.binary} but it was not loaded`)
    const d = decodeCityData(manifest.data, data)
    rails = d.rails; traffic = d.traffic
  }
  const interiors = (manifest as { city?: { interiors?: InteriorInfo[] } }).city?.interiors ?? []
  return { name, hash: manifest.hash, positions, indices, elements: manifest.elements, rails, spots: manifest.spots, lines: manifest.lines ?? [], traffic, interiors }
}

/**
 * Worlds made of more than one file. "sf" = the park plus the city around it
 * (assets/park/sf.city.*, from the world generator's city/). In the city the park opens up:
 * its gates and its invisible boundary wall go, and its own streets, buildings and
 * context estimates give way to the city's, which carry the same surveyed curbs.
 */
export const WORLDS: Record<string, { park: string; city: string; drop: string[] }> = {
  sf: { park: 'soma', city: 'sf.city', drop: ['boundary', 'gates', 'buildings', 'streets', 'context_estimates'] },
}

/** Park source + city source -> one world. keptTris maps each kept park triangle to its index in the park source. */
export function composeWorld(name: string, park: ParkSource, city: ParkSource, drop: string[]): ParkSource & { keptTris: Int32Array; cityTriStart: number } {
  const dropSet = new Set(drop)
  const keep = park.elements.filter((e) => !dropSet.has(e.collection))
  const parkTris = keep.reduce((s, e) => s + e.tris[1], 0)
  const cityTris = city.indices.length / 3
  const parkVerts = park.positions.length / 3
  const positions = new Float32Array(park.positions.length + city.positions.length)
  positions.set(park.positions, 0)
  positions.set(city.positions, park.positions.length)
  const indices = new Uint32Array((parkTris + cityTris) * 3)
  const keptTris = new Int32Array(parkTris)
  const elements: ElementInfo[] = []
  let t = 0
  for (const e of keep) {
    const [start, count] = e.tris
    indices.set(park.indices.subarray(start * 3, (start + count) * 3), t * 3)
    for (let i = 0; i < count; i++) keptTris[t + i] = start + i
    elements.push({ ...e, tris: [t, count] })
    t += count
  }
  for (let i = 0; i < city.indices.length; i++) indices[t * 3 + i] = city.indices[i] + parkVerts
  for (const e of city.elements) elements.push({ ...e, tris: [e.tris[0] + t, e.tris[1]] })
  return {
    name, hash: hashString(`${name}/1:${park.hash}+${city.hash}:${drop.join(',')}`), positions, indices, elements,
    rails: [...park.rails, ...city.rails], spots: [...park.spots, ...city.spots], lines: [...(park.lines ?? []), ...(city.lines ?? [])], traffic: city.traffic ?? [], interiors: city.interiors ?? [],
    keptTris, cityTriStart: t,
  }
}
