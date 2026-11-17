import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { bvhFileFor, bvhFrom } from '../data/bvhfile.ts'
import { addLines, type ExtraLines } from '../data/extralines.ts'
import { DATA_FILES, validateGameData } from '../data/schema.ts'
import type { GameData } from '../sim/data.ts'
import { labPark } from '../sim/park/lab.ts'
import { buildPark, type Park } from '../sim/park/park.ts'
import { composeWorld, parseParkFiles, WORLDS, type Manifest, type ParkSource } from '../sim/park/source.ts'

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const rel = (...p: string[]) => join(ROOT, ...p)

export const readJson = <T = unknown>(path: string): T => JSON.parse(readFileSync(path, 'utf8'))
export function writeJson(path: string, value: unknown, pretty = true) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, pretty ? JSON.stringify(value, null, 2) + '\n' : JSON.stringify(value))
}

export function loadData(): GameData {
  return validateGameData(Object.fromEntries(DATA_FILES.map((f) => [f, readJson(rel(`data/${f}.json`))])) as Record<(typeof DATA_FILES)[number], unknown>)
}

function readParkFiles(name: string, file: string): ParkSource {
  const manifest = rel(`assets/park/${file}.json`)
  if (!existsSync(manifest)) throw new Error(`no park "${name}" (expected ${manifest}; run: skate park${file.includes('city') ? ' / skate city' : ''})`)
  const bin = readFileSync(rel(`assets/park/${file}.bin`))
  const m = readJson<Manifest>(manifest)
  const buf = (b: Buffer) => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  const data = m.data ? buf(readFileSync(rel(`assets/park/${m.data.binary}`))) : undefined
  return parseParkFiles(name, m, buf(bin), data)
}

export function loadParkSource(name: string): ParkSource {
  if (name === 'lab') return labPark()
  const w = WORLDS[name]
  if (w) return addLines(name, composeWorld(name, readParkFiles(w.park, `${w.park}.park`), readParkFiles(name, w.city), w.drop), existsSync(rel('data/lines.json')) ? readJson<ExtraLines>(rel('data/lines.json')) : null)
  return readParkFiles(name, `${name}.park`)
}

/** The world's pre-built BVH file (src/data/bvhfile.ts), if it has one. */
export function readBvhFile(name: string): ArrayBuffer | null {
  const f = bvhFileFor(name)
  if (!f || !existsSync(rel('assets/park', f))) return null
  const b = readFileSync(rel('assets/park', f))
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

const parks = new Map<string, Park>()
/** Parks are cached per process. The BVH comes from the export's file when it is for these triangles (as in the browser); built otherwise. */
export function loadPark(name: string, data: GameData): Park {
  const key = `${name}:${JSON.stringify(data.physics.surfaces)}:${data.physics.skater.radius}:${JSON.stringify(data.physics.grind.lines)}`
  let p = parks.get(key)
  if (!p) {
    const src = loadParkSource(name)
    p = buildPark(src, data.physics, { bvh: bvhFrom(readBvhFile(name), src.hash, data.physics.surfaces) })
    parks.set(key, p)
  }
  return p
}
