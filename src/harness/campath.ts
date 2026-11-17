import { readFileSync } from 'node:fs'

// A keyframed camera for `skate clip --campath <file.json>`: camera positions and look-at points at
// times (seconds from the clip's start), with an optional vertical field of view per key. Between keys
// each coordinate follows a Catmull-Rom spline whose tangents are taken over time, not key count, so
// the camera's speed does not jump at a key when the keys are unevenly spaced; it starts and ends at
// rest. File: { "fov": 50, "keys": [{ "t": 0, "pos": [x, y, z], "look": [x, y, z], "fov"?: 50 }, ...] }
// (site metres, z up; other fields, such as a key's "at" label, are ignored).

type V = { x: number; y: number; z: number }
export type CamPathPose = { pos: V; look: V; fov: number }
export type CamPath = { seconds: number; ts: number[]; ch: number[][] }   // ch: per key [px, py, pz, lx, ly, lz, fov]

export function parseCamPath(j: unknown, name = 'campath'): CamPath {
  const f = j as { fov?: number; keys?: { t: number; pos: number[]; look: number[]; fov?: number }[] }
  const keys = f?.keys
  if (!Array.isArray(keys) || keys.length < 2) throw new Error(`${name}: needs "keys" with at least two { t, pos, look }`)
  const fov = f.fov ?? 50
  const ts: number[] = [], ch: number[][] = []
  keys.forEach((k, i) => {
    const row = [...(k.pos ?? []), ...(k.look ?? []), k.fov ?? fov]
    if (k.pos?.length !== 3 || k.look?.length !== 3 || !row.every(Number.isFinite) || !Number.isFinite(k.t)) throw new Error(`${name}: key ${i} needs t, pos [x, y, z] and look [x, y, z]`)
    if (i > 0 && !(k.t > ts[i - 1])) throw new Error(`${name}: key ${i}'s t (${k.t}) must come after key ${i - 1}'s (${ts[i - 1]})`)
    ts.push(k.t); ch.push(row)
  })
  if (ts[0] !== 0) throw new Error(`${name}: the first key's t must be 0`)
  return { seconds: ts[ts.length - 1], ts, ch }
}

export const readCamPath = (file: string) => parseCamPath(JSON.parse(readFileSync(file, 'utf8')), file)

/** The camera at t seconds (clamped to the path). */
export function camPathAt(p: CamPath, t: number): CamPathPose {
  const { ts, ch } = p, n = ts.length
  const u = Math.max(0, Math.min(p.seconds, t))
  let i = 0
  while (i < n - 2 && u > ts[i + 1]) i++
  const h = ts[i + 1] - ts[i], s = (u - ts[i]) / h
  const h00 = 2 * s ** 3 - 3 * s * s + 1, h10 = s ** 3 - 2 * s * s + s, h01 = -2 * s ** 3 + 3 * s * s, h11 = s ** 3 - s * s
  // Tangent at key j (units per second): the slope from the key before to the key after; zero at the ends.
  const m = (j: number, c: number) => (j === 0 || j === n - 1 ? 0 : (ch[j + 1][c] - ch[j - 1][c]) / (ts[j + 1] - ts[j - 1]))
  const at = (c: number) => h00 * ch[i][c] + h10 * h * m(i, c) + h01 * ch[i + 1][c] + h11 * h * m(i + 1, c)
  return { pos: { x: at(0), y: at(1), z: at(2) }, look: { x: at(3), y: at(4), z: at(5) }, fov: at(6) }
}
