import { existsSync, readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { parseSeaLions, SeaLions, seaLionGeometry, type SeaLionData } from '../src/client/sealions.ts'

// The K-dock's sea lions (src/client/sealions.ts): the export's list parses (bad entries are left out
// and counted), the instanced meshes draw exactly the sea lions shown (all, or low's share), nothing is
// drawn far away, and their idle life (barks, shuffles, dives) stays sound and ends back at home.

const d = JSON.parse(readFileSync(new URL('../data/sealions.json', import.meta.url), 'utf8')) as SeaLionData

describe('sea lions', () => {
  it('has a real normal at every vertex (a zero one is NaN once the shader normalizes it)', () => {
    const g = seaLionGeometry(d.colors)
    for (const geo of [g.body, g.head]) {
      const n = geo.getAttribute('normal')
      for (let i = 0; i < n.count; i++) {
        const l = Math.hypot(n.getX(i), n.getY(i), n.getZ(i))
        expect(l > 0.5 && l < 1.5).toBe(true)
      }
    }
  })

  it('parses the { x, y, z, heading, pile } list and counts what is not one', () => {
    const ok = parseSeaLions([{ x: 1, y: 2, z: -11.9, heading: 90, pile: 3 }, { x: 4, y: 5, z: -11.9, heading: 0, pile: 'a', size: 2.1 }])
    expect(ok.skipped).toBe(0)
    expect(ok.list).toEqual([{ x: 1, y: 2, z: -11.9, heading: 90, pile: 3 }, { x: 4, y: 5, z: -11.9, heading: 0, pile: 'a', size: 2.1 }])
    const bad = parseSeaLions([{ x: 1, y: 2, z: 3 }, null, 'x', { x: 1, y: 2, z: 3, heading: Number.NaN, pile: 0 }, { x: 1, y: 2, z: 3, heading: 0, pile: 0, size: -1 }, { x: 0, y: 0, z: 0, heading: 10 }])
    expect(bad.skipped).toBe(5)
    expect(bad.list).toEqual([{ x: 0, y: 0, z: 0, heading: 10, pile: -1 }])
    expect(parseSeaLions(undefined)).toEqual({ list: [], skipped: 0 })
    const test = parseSeaLions(d.test)
    expect(test.skipped).toBe(0)
    expect(test.list.length).toBe(d.test!.length)
  })

  it('draws every one shown, all or low\'s share', () => {
    const list = parseSeaLions(d.test).list
    const s = new SeaLions(list, d)
    expect(s.count).toBe(list.length)
    expect(s.drawn).toBe(list.length)
    expect(s.head.count).toBe(list.length)
    s.setQuality(0.5)
    const half = list.filter((_, i) => ((i * 0.618034) % 1) < 0.5).length
    expect(s.drawn).toBe(half)
    expect(s.head.count).toBe(half)
    expect(half).toBeGreaterThan(list.length * 0.4)
    expect(half).toBeLessThan(list.length * 0.6)
    s.setQuality(1)
    expect(s.drawn).toBe(list.length)
  })

  it('costs nothing far away and lives near by, ending back home', () => {
    const list = parseSeaLions(d.test).list
    const s = new SeaLions(list, d)
    const c = list.reduce((a, l) => a.add(new THREE.Vector3(l.x, l.y, l.z)), new THREE.Vector3()).divideScalar(list.length)
    const far = new THREE.Vector3(c.x + 5000, c.y, c.z)
    s.update(0.1, far, far)
    expect(s.group.visible).toBe(false)
    // Twenty minutes on the promenade.
    const heard = { bark: 0, splash: 0 }
    s.onSound = (kind) => { heard[kind]++ }
    const near = new THREE.Vector3(c.x + 20, c.y - 30, c.z + 3)
    const m = new THREE.Matrix4(), p = new THREE.Vector3()
    let moved = 0
    for (let t = 0; t < 1200; t += 0.1) {
      s.update(0.1, near, near)
      if (Math.round(t * 10) % 50 === 0) for (let i = 0; i < s.drawn; i++) { s.body.getMatrixAt(i, m); p.setFromMatrixPosition(m); expect(Number.isFinite(p.x + p.y + p.z)).toBe(true) }
    }
    expect(s.group.visible).toBe(true)
    expect(s.drawn).toBe(list.length)
    expect(heard.bark).toBeGreaterThan(100)
    expect(heard.splash).toBeGreaterThan(0)
    // Walk away: past the animation range they are all home and still.
    const mid = new THREE.Vector3(c.x + 180, c.y, c.z)
    s.update(0.1, mid, mid)
    for (let i = 0; i < s.drawn; i++) {
      s.body.getMatrixAt(i, m); p.setFromMatrixPosition(m)
      const l = list[i]
      if (Math.hypot(p.x - l.x, p.y - l.y) > 1e-3) moved++   // (instance matrices are float32)
    }
    expect(moved).toBe(0)
  })
})

// The K-dock's sea lions are data in the city export (city.sealions, city phase 12), for the client to
// draw with the characters' Sea Lion: where each lies on Pier 39's floats, its heading, length, roll,
// the float (pile) it is on and whether it lies on another's back (layer). No sea lion meshes.
type SeaLion = { x: number; y: number; z: number; heading: number; length: number; roll: number; pile: number; layer: number }

const url = new URL('../assets/park/sf.city.json', import.meta.url)

describe('the K-dock sea lions', () => {
  it.skipIf(!existsSync(url))('are data: positions, headings and piles on the floats by Pier 39', () => {
    const m = JSON.parse(readFileSync(url, 'utf8')) as { city?: { sealions?: SeaLion[] }; elements: { id: string; collection: string }[] }
    const L = m.city?.sealions ?? []
    expect(L.length).toBeGreaterThan(100)
    const piles = new Set(L.map((s) => s.pile))
    expect(piles.size).toBeGreaterThanOrEqual(20)
    for (const s of L) {
      expect(Math.hypot(s.x - 230, s.y - 1053)).toBeLessThan(90)   // the West Marina, along Pier 39's west edge (squeezed: the pier39 tile)
      expect(s.heading).toBeGreaterThanOrEqual(0); expect(s.heading).toBeLessThan(360)
      expect(s.length).toBeGreaterThan(1.5); expect(s.length).toBeLessThan(2.5)
      expect(Math.abs(s.roll)).toBeLessThanOrEqual(35)
      expect([0, 1, 2, 3]).toContain(s.layer)
    }
    // On the floats (their tops a little over the water), the ones on another's back higher.
    const bottom = L.filter((s) => s.layer === 0).map((s) => s.z), top = L.filter((s) => s.layer > 0).map((s) => s.z)
    expect(Math.max(...bottom) - Math.min(...bottom)).toBeLessThan(0.01)
    if (top.length) expect(Math.min(...top)).toBeGreaterThan(Math.max(...bottom))
  })
  it.skipIf(!existsSync(url))('are what the renderer draws: every one, length, roll and layer as the export gives them', () => {
    const m = JSON.parse(readFileSync(url, 'utf8')) as { city?: { sealions?: unknown } }
    const p = parseSeaLions(m.city?.sealions)
    expect(p.skipped).toBe(0)
    const L = (m.city!.sealions as SeaLion[])
    expect(p.list.length).toBe(L.length)
    expect(p.list[0]).toMatchObject({ size: L[0].length, roll: L[0].roll, layer: L[0].layer, pile: L[0].pile })
    const d = JSON.parse(readFileSync(new URL('../data/sealions.json', import.meta.url), 'utf8')) as SeaLionData
    const s = new SeaLions(p.list, d)
    expect(s.count).toBe(L.length)
    expect(s.drawn).toBe(L.length)
  })
})
