import { describe, expect, it } from 'vitest'
import { loadData, loadPark, readJson, rel } from '../src/harness/io.ts'
import { streetWay } from '../src/sim/game/escape.ts'

// The map's waypoint route (the minimap, client story.ts) on the city's street graph (game/escape.ts streetWay).
// From the park gate it reaches every place in the map's list (data/story.json travel.places): the route ends within
// NEAR metres of the place's spot. A spot in a plaza or a park stands off the street, and its route ends at the
// street point nearest it that the streets reach: the farthest is Duboce Park's lawn, 78 m from Duboce Ave. The route
// starts within GATE metres of the gate (2.5 m), so no place counts as reached from a street network of its own.
const NEAR = 100, GATE = 10

describe('waypoint route', () => {
  it('reaches every map place from the park gate', () => {
    const data = loadData(), park = loadPark('sf', data)
    const places = readJson<{ travel: { places: { spot: string }[] } }>(rel('data/story.json')).travel.places
    const at = new Map(park.spots.map((s) => [s.id, s.pos]))
    const gate = at.get('park_gate')!
    const missed: string[] = []
    for (const { spot } of places) {
      const p = at.get(spot)
      expect(p, spot).toBeDefined()
      const way = streetWay(park, data.run.escape, gate.x, gate.y, p!.x, p!.y)
      const start = way?.[0], end = way?.[way.length - 1]
      if (!start || !end || Math.hypot(start[0] - gate.x, start[1] - gate.y) > GATE || Math.hypot(end[0] - p!.x, end[1] - p!.y) > NEAR) missed.push(spot)
    }
    expect(missed).toEqual([])
  })
})
