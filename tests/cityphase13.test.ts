import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { raycast } from '../src/sim/park/park.ts'

// City phase 13 in the export (city.interiors, city.streetspots, the lowriders in city.cars): the
// formats the story reads (characters at anchors, map icons at doors), and the things that make
// them work in play: Big Lou stands at Fog City Skate Shop's door, every anchor stands on the room's
// floor, the Duboce roof is a chain of steps an ollie makes, the lowriders are low enough to ollie.

type Anchor = [number, number, number, number]
type Room = { id: string; name: string; kind: string; door: [number, number, number]; inward: number; floor: number; height: number; polygon: [number, number][]; anchors: Record<string, Anchor> }
type Roof = { id: string; roof: number[]; board: number[]; pallets: number[]; dumpster: number[]; stair_foot: number[]; ground: number }
type Manifest = { city?: { interiors?: Room[]; streetspots?: { rooftops?: Roof[] }; shopsigns?: { text: string }[]; lowriders?: number[][] } }

const url = new URL('../assets/park/sf.city.json', import.meta.url)
const have = existsSync(url)
const M = have ? (JSON.parse(readFileSync(url, 'utf8')) as Manifest) : {}

const inside = (poly: [number, number][], x: number, y: number) => {
  let c = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c
  }
  return c
}

describe('city phase 13 in the export', () => {
  it.skipIf(!have)('has the five interiors, each with its anchors on its floor', () => {
    const R = M.city?.interiors ?? []
    expect(R.map((r) => r.id).sort()).toEqual(['city_hall_lobby', 'corner_store', 'fog_city_skate_shop', 'laundromat', 'taqueria'])
    const need: Record<string, string[]> = { skateshop: ['counter', 'clerk', 'deck_wall', 'ramp', 'deck'], taqueria: ['counter', 'cook', 'menu', 'table'],
      laundromat: ['counter', 'bench', 'washers'], store: ['counter', 'clerk', 'fruit'], cityhall: ['window', 'clerk', 'rotunda', 'bench'] }
    for (const r of R) {
      for (const k of [...need[r.kind], 'inside', 'door']) expect(r.anchors[k], `${r.id} ${k}`).toBeDefined()
      for (const [k, a] of Object.entries(r.anchors)) {
        expect(a.length).toBe(4)
        expect(a[3]).toBeGreaterThanOrEqual(0); expect(a[3]).toBeLessThan(360)
        if (k === 'door' || k === 'deck' || k === 'stair') continue
        expect(inside(r.polygon, a[0], a[1]), `${r.id} ${k} in the room`).toBe(true)
        expect(Math.abs(a[2] - r.floor), `${r.id} ${k} on the floor`).toBeLessThan(0.01)
      }
      expect(inside(r.polygon, r.anchors.door[0], r.anchors.door[1]), `${r.id} door anchor outside`).toBe(false)
      expect(r.height).toBeGreaterThan(3)
    }
  })

  it.skipIf(!have)('puts Fog City Skate Shop\'s door where Big Lou stands', () => {
    const shop = (M.city?.interiors ?? []).find((r) => r.id === 'fog_city_skate_shop')!
    const cast = JSON.parse(readFileSync(new URL('../data/cast.json', import.meta.url), 'utf8')) as { cast: { id: string; home: number[] }[] }
    const lou = cast.cast.find((c) => c.id === 'biglou')
    if (!lou) return
    expect(Math.hypot(lou.home[0] - shop.door[0], lou.home[1] - shop.door[1])).toBeLessThan(3.5)
    expect((M.city?.shopsigns ?? []).some((s) => s.text === 'Fog City Skate Shop')).toBe(true)
  })

  it.skipIf(!have)('has floors you can stand on in every room and the Duboce roof within reach, step by step', () => {
    const data = loadData(), park = loadPark('sf', data)
    const down = (x: number, y: number, z: number) => raycast(park, { x, y, z }, { x: 0, y: 0, z: -1 }, 4)
    // Every anchor stands on bare floor (no counter, shelf or table on the spot), the ramp's deck on the deck.
    for (const r of M.city?.interiors ?? []) {
      for (const [k, a] of Object.entries(r.anchors)) {
        if (k === 'door') continue
        const h = down(a[0], a[1], a[2] + 1.5)
        expect(h, `${r.id} ${k}: ground`).not.toBeNull()
        expect(Math.abs(h!.point.z - a[2]), `${r.id} ${k}: on the floor, nothing on the spot`).toBeLessThan(0.05)
      }
    }
    const roof = (M.city?.streetspots?.rooftops ?? []).find((q) => q.id === 'duboce_roof')!
    expect(roof).toBeDefined()
    // Each step up at most an ollie's height (pop peaks near 1.2 m): ground, pallets, dumpster, roof.
    const steps = [roof.ground, roof.pallets[2], roof.dumpster[2], roof.roof[2]]
    for (let i = 1; i < steps.length; i++) {
      expect(steps[i] - steps[i - 1]).toBeGreaterThan(0.3)
      expect(steps[i] - steps[i - 1]).toBeLessThan(1.0)
    }
    for (const p of [roof.pallets, roof.dumpster, roof.board]) {
      const h = down(p[0], p[1], p[2] + 1)
      expect(h, 'a top you land on').not.toBeNull()
      expect(Math.abs(h!.point.z - p[2])).toBeLessThan(0.05)
    }
  })

  it.skipIf(!have)('parks three lowriders on 24th St, low enough to ollie', () => {
    const lows = M.city?.lowriders ?? []
    expect(lows.length).toBe(3)
    for (const c of lows) expect(Math.abs(c[1] - -205)).toBeLessThan(15)   // on 24th St (the calle24 tile of the squeezed city)
    const data = loadData(), park = loadPark('sf', data)
    for (const c of lows) {
      const h = raycast(park, { x: c[0], y: c[1], z: c[2] + 3 }, { x: 0, y: 0, z: -1 }, 4)
      expect(h).not.toBeNull()
      expect(h!.point.z - c[2]).toBeLessThan(1.25)   // the low cabin's roof
      expect(h!.point.z - c[2]).toBeGreaterThan(0.6)
    }
  })
})
