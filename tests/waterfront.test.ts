import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Pigeons, type BirdsData } from '../src/client/life.ts'
import { NpcViews } from '../src/client/npcs.ts'
import { buildRoster, type CharactersData } from '../src/client/skater/characters.ts'
import type { RawPoseData } from '../src/client/skater/poses.ts'
import { SkaterView } from '../src/client/skater/view.ts'
import { areaSeats } from '../src/client/spectators.ts'
import { loadData, loadPark, loadParkSource, rel } from '../src/harness/io.ts'
import type { Thing } from '../src/sim/thing.ts'

// The waterfront's life (city phase 10's Embarcadero): EMB's and Pier 7's rider lines (data/lines.json)
// in the sf world, the locals who ride them in their own looks, watchers on the EMB steps, and
// seagulls on the ground, the Ferry Building and the street lights.

const data = loadData()
const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData
const birds = JSON.parse(readFileSync(rel('data/birds.json'), 'utf8')) as BirdsData

describe('the waterfront', () => {
  it('EMB and Pier 7 have rider lines in the city world (after the city export\'s own), and NPCs may ride them as a session each', () => {
    const lines = loadParkSource('sf').lines ?? []
    const ids = lines.map((l) => l.id)
    for (const id of ['emb_west_ledges', 'emb_east_rim', 'pier_7_benches']) expect(ids).toContain(id)
    expect(ids.indexOf('emb_west_ledges')).toBeGreaterThan(ids.indexOf('bart_plaza_line'))   // appended
    expect(loadParkSource('soma').lines?.some((l) => l.id.startsWith('emb'))).toBe(false)
    expect(data.npc.parks.sf.lines).toEqual(expect.arrayContaining(['emb_west_ledges', 'emb_east_rim', 'pier_7_benches']))
    expect(data.npc.spots.emb).toEqual(['emb_west_ledges', 'emb_east_rim'])
  })

  it('an NPC on a locals line wears a locals look (never the player\'s character); elsewhere any look', () => {
    const raw = JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData
    const v = new NpcViews(new SkaterView(buildRoster(chars), raw, chars), null)
    const lines = loadParkSource('sf').lines ?? []
    v.lineId = (i) => lines[i]?.id ?? ''
    const L = chars.npcs!.locals!
    const emb = lines.findIndex((l) => l.id === 'emb_west_ledges'), park = lines.findIndex((l) => l.id === 'wave_east_to_west')
    const seen = new Set<string>()
    for (let look = 0; look < 1000; look += 37) {
      const at = v.lookOf({ id: 1, npc: { look, line: emb, life: {} } } as unknown as Thing)
      expect(L.looks.some((l) => l.id === at.id && l.outfit === at.outfit), `${at.id}:${at.outfit}`).toBe(true)
      expect(at.id).not.toBe('can')   // the player's
      seen.add(at.id)
    }
    expect(seen.size).toBeGreaterThanOrEqual(5)
    expect(v.isLocal({ id: 2, npc: { look: 3, line: park, life: {} } } as unknown as Thing)).toBe(false)
    // Every locals look is a real character and outfit.
    for (const l of L.looks) expect(l.outfit === 'default' || chars.characters.find((c) => c.id === l.id)?.outfits?.some((o) => o.id === l.outfit), `${l.id}:${l.outfit}`).toBe(true)
  })

  it('watchers sit on the EMB steps, facing down them, a step apart', () => {
    const seats = areaSeats(loadPark('sf', data), chars.spectators!)
    expect(seats.length).toBeGreaterThanOrEqual(5)
    for (const s of seats) {
      expect(Math.hypot(s.x - 567.7, s.y - 698.1)).toBeLessThan(4.5)
      expect(s.drop).toBeGreaterThan(0.1)
      expect(Math.cos(s.heading - Math.atan2(0.605, 0.796))).toBeGreaterThan(0.99)
    }
    expect(areaSeats(loadPark('soma', data), chars.spectators!)).toEqual([])   // no EMB in the park alone
  })

  it('seagulls stand at the bay edge, EMB and Pier 7, on the Ferry Building, its clock tower and street lights; they scatter and come back', () => {
    const park = loadPark('sf', data)
    const lights = [[600, 710, -4.5], [591, 900, -4.6]]
    const b = new Pigeons(park, [], 11, birds.pigeons)
    b.addGulls(park, birds.gulls!, lights)
    expect(b.count('gull')).toBeGreaterThan(40)
    const gulls = b.positions('gull').map((position) => ({ position }))
    expect(gulls.some((g) => Math.abs(g.position.z - 5.75) < 0.01)).toBe(true)    // the roof
    expect(gulls.filter((g) => Math.abs(g.position.z - 41.7) < 0.01).length).toBe(2)   // the clock tower
    // None inside the Ferry Building (its walls are only drawn): every ground gull is off its box.
    const R = birds.gulls!.roofs[0], ax = R.axis
    for (const g of gulls) if (g.position.z < 0) {
      const dx = g.position.x - R.centre[0], dy = g.position.y - R.centre[1]
      expect(Math.abs(dx * ax[0] + dy * ax[1]) > R.length / 2 || Math.abs(-dx * ax[1] + dy * ax[0]) > R.width / 2).toBe(true)
    }
    // Ride through EMB: the near ones fly off (a flock cries once), then all are home again.
    let cries = 0
    b.onScatter = () => { cries++ }
    const near = gulls.map((g, i) => ({ i, p: g.position })).filter(({ p }) => Math.hypot(p.x - 588.8, p.y - 705.8) < 40 && p.z < 0)
    const now = () => { const all = b.positions('gull'); return near.map(({ i }) => all[i]) }
    for (let t = 0; t < 40; t++) b.update(0.05, { x: 560 + t * 1.5, y: 730 - t * 1.9, z: -9.1 }, 6)
    expect(now().some((q, k) => q.distanceTo(near[k].p) > 1)).toBe(true)
    expect(cries).toBeGreaterThanOrEqual(1)
    for (let t = 0; t < 600; t++) b.update(0.05, { x: 0, y: 0, z: 0 }, 0)
    expect(now().every((q, k) => q.distanceTo(near[k].p) < 1.6)).toBe(true)
    // Drawn instanced: a few meshes for all of them, and the density setting leaves some out.
    expect(b.group.children.length).toBe(3)
    const drawn = () => (b.group.children[0] as unknown as { count: number }).count
    expect(drawn()).toBe(b.count('gull'))
    b.setDensity(0.4)
    expect(drawn()).toBeGreaterThan(b.count('gull') * 0.3)
    expect(drawn()).toBeLessThan(b.count('gull') * 0.5)
  })
})
