import { describe, expect, it } from 'vitest'
import { camPathAt, parseCamPath, readCamPath } from '../src/harness/campath.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { loadScenario } from '../src/harness/scenario.ts'

// The keyframed camera of `skate clip --campath` (src/harness/campath.ts).

const path = parseCamPath({ fov: 50, keys: [
  { t: 0, pos: [0, 0, 50], look: [100, 0, 0] },
  { t: 2, pos: [100, 0, 60], look: [200, 50, 0], fov: 40 },
  { t: 7, pos: [400, 200, 80], look: [500, 300, 0] },
  { t: 8, pos: [450, 260, 80], look: [550, 350, 0] },
] })
const speedAt = (t: number, h = 1e-4) => { const a = camPathAt(path, t - h).pos, b = camPathAt(path, t + h).pos; return Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / (2 * h) }

describe('camera path', () => {
  it('passes through every key at its time, with its field of view', () => {
    expect(camPathAt(path, 2).pos).toEqual({ x: 100, y: 0, z: 60 })
    expect(camPathAt(path, 7).look).toEqual({ x: 500, y: 300, z: 0 })
    expect(camPathAt(path, 2).fov).toBe(40)
    expect(camPathAt(path, 0).fov).toBe(50)
    expect(path.seconds).toBe(8)
  })

  it('keeps its speed through a key between unevenly spaced neighbours, and starts and ends at rest', () => {
    for (const t of [2, 7]) {
      const before = camPathAt(path, t - 1e-3).pos, at = camPathAt(path, t).pos, after = camPathAt(path, t + 1e-3).pos
      const vIn = Math.hypot(at.x - before.x, at.y - before.y) / 1e-3, vOut = Math.hypot(after.x - at.x, after.y - at.y) / 1e-3
      expect(Math.abs(vIn - vOut) / vOut, `t ${t}`).toBeLessThan(0.01)
    }
    expect(speedAt(1e-3)).toBeLessThan(1)
    expect(speedAt(8 - 1e-3)).toBeLessThan(1)
    expect(camPathAt(path, -5)).toEqual(camPathAt(path, 0))
    expect(camPathAt(path, 99)).toEqual(camPathAt(path, 8))
  })

  it('rejects keys out of order, without a look point, or not starting at 0', () => {
    expect(() => parseCamPath({ keys: [{ t: 0, pos: [0, 0, 0], look: [1, 0, 0] }, { t: 0, pos: [1, 0, 0], look: [2, 0, 0] }] })).toThrow(/after key 0/)
    expect(() => parseCamPath({ keys: [{ t: 0, pos: [0, 0, 0] }, { t: 1, pos: [1, 0, 0], look: [2, 0, 0] }] })).toThrow(/key 0 needs/)
    expect(() => parseCamPath({ keys: [{ t: 1, pos: [0, 0, 0], look: [1, 0, 0] }, { t: 2, pos: [1, 0, 0], look: [2, 0, 0] }] })).toThrow(/must be 0/)
  })

  it('the squeeze flythrough fits inside the run it is filmed over', () => {
    const p = readCamPath(rel('scenarios/flythrough/squeeze.json'))
    const sc = loadScenario(rel('scenarios/flythrough/squeeze.skate'))
    expect(sc.park).toBe('sf')
    expect(sc.ticks).toBeGreaterThanOrEqual(Math.ceil((1 + p.seconds) * loadData().physics.tickHz))   // filmed --from 1
  })
})
