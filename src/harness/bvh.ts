import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { bvhDiff, bvhFileFor, bvhFrom, bvhKey, encodeBvh, readBvhHeader } from '../data/bvhfile.ts'
import { buildPark } from '../sim/park/park.ts'
import { WORLDS } from '../sim/park/source.ts'
import { loadData, loadParkSource, rel } from './io.ts'

// The pre-built BVH beside each world's files (src/data/bvhfile.ts): written by ./skate park, ./skate city
// and ./skate bvh; compared with the builder by ./skate check; refreshed by ./skate build if stale.

const fileOf = (world: string) => rel('assets/park', bvhFileFor(world)!)
const readBuf = (path: string) => { const b = readFileSync(path); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }

/** The worlds with exported files: every <name>.park.json, and the multi-file worlds whose city is there. */
export function bvhWorlds(): string[] {
  const parks = readdirSync(rel('assets/park')).filter((f) => f.endsWith('.park.json')).map((f) => f.slice(0, -'.park.json'.length))
  const worlds = Object.entries(WORLDS).filter(([, w]) => parks.includes(w.park) && existsSync(rel('assets/park', `${w.city}.json`))).map(([n]) => n)
  return [...parks.sort(), ...worlds.sort()]
}

/** Build a world's tree with the sim's builder and write it. Returns a line for the console. */
export function writeBvh(world: string): string {
  const physics = loadData().physics
  const src = loadParkSource(world)
  const t0 = performance.now()
  const park = buildPark(src, physics)
  const ms = performance.now() - t0
  const file = encodeBvh(park.bvh, park.tv, park.triCount, bvhKey(src.hash, physics.surfaces, park.tv, park.triCount), src.hash)
  writeFileSync(fileOf(world), file)
  return `${bvhFileFor(world)}  ${park.triCount} triangles, ${park.bvh.nodes} nodes, ${(file.length / 1048576).toFixed(2)} MB (the park built in ${(ms / 1000).toFixed(1)} s)`
}

/** Is a world's file there and for its current triangles? (A cheap look: the key, not the whole tree.) */
export function bvhFresh(world: string): boolean {
  const path = fileOf(world)
  if (!existsSync(path)) return false
  const physics = loadData().physics
  const src = loadParkSource(world)
  let used = false
  const from = bvhFrom(readBuf(path), src.hash, physics.surfaces)
  buildPark(src, physics, { bvh: (tv, n) => { const b = from(tv, n); used = b !== null; return b } })
  return used
}

/**
 * The check: each world's shipped tree against the builder's from the triangles, to the bit. Fails on a
 * missing file, a stale one (another park export, other surface classes or triangles) or any difference.
 */
export function checkBvh(): { ok: boolean; detail: string } {
  const physics = loadData().physics
  const bad: string[] = [], good: string[] = []
  for (const world of bvhWorlds()) {
    const name = bvhFileFor(world)!, path = fileOf(world)
    if (!existsSync(path)) { bad.push(`${name}: missing (run ./skate bvh)`); continue }
    const src = loadParkSource(world)
    const park = buildPark(src, physics)
    const buf = readBuf(path)
    const loaded = bvhFrom(buf, src.hash, physics.surfaces)(park.tv, park.triCount)
    if (!loaded) {
      const h = readBvhHeader(buf)
      bad.push(`${name}: stale (${!h ? 'not a bvh file of this format' : h.park !== src.hash ? `built for park ${h.park}, the park is ${src.hash}` : h.triCount !== park.triCount ? `built for ${h.triCount} triangles, the park has ${park.triCount}` : 'the collision triangles or surface classes changed'}; run ./skate bvh)`)
      continue
    }
    const diff = bvhDiff(loaded, park.bvh)
    if (diff.length) bad.push(`${name}: differs from the builder's tree: ${diff.join('; ')} (run ./skate bvh)`)
    else good.push(`${world} ${park.bvh.nodes} nodes`)
  }
  return { ok: bad.length === 0, detail: bad.length ? bad.join('\n') : `${good.join(', ')}: same as the builder's to the bit` }
}
