// A world's files to the sim's park: fetch them (with progress; from the service worker's cache on a
// later visit or offline), parse, compose the park and the city into one world, and build the sim's park
// with the export's pre-built BVH (src/data/bvhfile.ts; the sim's builder when the file is not for these
// triangles). The load worker runs it (loadworker.ts), so the page never holds the downloaded files or a
// second copy of the world: it gets the composed world and the park, moved, not copied (load.ts). Where
// there are no workers the page runs it itself.

import { bvhFileFor, bvhFrom } from '../data/bvhfile.ts'
import { addLines, type ExtraLines } from '../data/extralines.ts'
import type { Physics } from '../sim/data.ts'
import { buildPark, type Park } from '../sim/park/park.ts'
import { composeWorld, decodeCityRows, parseParkFiles, WORLDS, type Manifest, type ParkSource } from '../sim/park/source.ts'
import { expectBins, fetchBin, resolveUrl } from './fetchbin.ts'

export type CityRows = { trees: number[][]; cars: number[][]; lights: number[][] }
/** The composed world (keptTris and cityTriStart when the city is in it), the sim's park, and the city's manifest and rows. */
export type World = {
  src: ParkSource & { keptTris?: Int32Array; cityTriStart?: number }
  park: Park
  city: { manifest: Manifest; rows: CityRows | null } | null
  /** The BVH came from the export's file (false: the builder made it). */
  bvhLoaded: boolean
}

export const getJson = async <T = unknown>(url: string): Promise<T> => {
  const r = await fetch(resolveUrl(url), { cache: 'no-store' })
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`)
  return r.json() as Promise<T>
}

/** The big binaries the world loader fetches (for the loading bar's total). */
export function worldBins(parkName: string): string[] {
  const w = WORLDS[parkName], park = w ? w.park : parkName
  const bvh = bvhFileFor(parkName)
  return [`assets/park/${park}.park.bin`, ...(w ? [`assets/park/${w.city}.bin`, `assets/park/${w.city}.data.bin`] : []), ...(bvh ? [`assets/park/${bvh}`] : [])]
}

/**
 * Load a world (not 'lab': that one is generated). cityReady: the city's manifest and draw-only rows, as
 * soon as they are in (the page builds the city's look from them while the world is composed and the park built).
 */
export async function loadWorld(parkName: string, physics: Physics | Promise<Physics>, cityReady?: (manifest: Manifest, rows: CityRows | null) => void): Promise<World> {
  const world = WORLDS[parkName]
  const parkFile = world ? world.park : parkName
  void expectBins(worldBins(parkName))
  // The downloads are let go as soon as they are composed (the promises would keep them): the files and
  // the world are not held together longer than the copy takes.
  let parkP: Promise<[Manifest, ArrayBuffer]> | null = Promise.all([getJson<Manifest>(`assets/park/${parkFile}.park.json`), fetchBin(`assets/park/${parkFile}.park.bin`)])
  // The city files are derived (./skate city); the data binary (grind lines, traffic, trees, cars, lights) comes alongside.
  let cityP: Promise<[Manifest, ArrayBuffer, ArrayBuffer | undefined] | null> | null = world ? Promise.all([getJson<Manifest>(`assets/park/${world.city}.json`), fetchBin(`assets/park/${world.city}.bin`), fetchBin(`assets/park/${world.city}.data.bin`).catch(() => undefined)]).catch(() => null) : null
  const bvhFile = (name: string) => { const f = bvhFileFor(name); return f ? fetchBin(`assets/park/${f}`).catch(() => null) : Promise.resolve(null) }
  let bvhP: Promise<ArrayBuffer | null> | null = bvhFile(parkName)
  const linesP = world ? getJson<ExtraLines>('data/lines.json').catch(() => null) : Promise.resolve(null)
  const parkFiles = await parkP
  parkP = null
  let src: World['src'] = parseFiles(parkFile, parkFiles)
  let city: World['city'] = null
  if (world && cityP) {
    const files = await cityP
    cityP = null
    if (!files) { console.warn(`no ${world.city} files (run ./skate city); playing the park alone`); bvhP = bvhFile(parkFile) }
    else {
      const rows = files[0].data && files[2] ? decodeCityRows(files[0].data, files[2]) : null
      city = { manifest: files[0], rows }
      cityReady?.(files[0], rows)
      // This game's own rider lines for the world (data/lines.json: EMB, Pier 7) after the city's.
      src = addLines(parkName, composeWorld(parkName, src, parseFiles(parkName, files), world.drop), await linesP)
      // Composed: the downloads were copied out (geometry) or read into lists (the data binary).
      free(parkFiles[1]); free(files[1]); free(files[2])
    }
  }
  const ph = await physics
  const bvhBuf = await bvhP
  bvhP = null
  const from = bvhFrom(bvhBuf, src.hash, ph.surfaces)
  let bvhLoaded = false
  const park = buildPark(src, ph, { bvh: (tv, n) => { const b = from(tv, n); bvhLoaded = b !== null; return b } })
  free(bvhBuf)   // read into the tree's own arrays
  return { src, park, city, bvhLoaded }
}

/** A download read in full: its memory goes now (ArrayBuffer.transfer(0)), not at the next garbage collection. */
function free(b: ArrayBuffer | null | undefined) {
  const buf = b as (ArrayBuffer & { transfer?: (n: number) => ArrayBuffer; detached?: boolean }) | null | undefined
  if (buf && typeof buf.transfer === 'function' && !buf.detached) buf.transfer(0)
}

const parseFiles = (name: string, [m, bin, data]: [Manifest, ArrayBuffer, (ArrayBuffer | undefined)?]) => parseParkFiles(name, m, bin, data)
