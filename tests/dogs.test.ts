import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Crowd, type CrowdData } from '../src/client/crowd.ts'
import { Dogs, type DogData } from '../src/client/dogs.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { raycast } from '../src/sim/park/park.ts'

// The park dogs (view only): one or more per dog owner on the Dolores Park lawn; they chase a
// skater riding by, bark, then go back to their owners.

const data = loadData()
const sf = loadPark('sf', data)
const crowd = new Crowd(sf, JSON.parse(readFileSync(rel('data/pedestrians.json'), 'utf8')) as CrowdData, null)
const d = JSON.parse(readFileSync(rel('data/dogs.json'), 'utf8')) as DogData

describe('park dogs', () => {
  it('belong to the dog owners in the park, chase a skater riding past, bark, and go back', { timeout: 60000 }, () => {
    const owners = crowd.dogOwners()
    expect(owners.length).toBeGreaterThanOrEqual(6)
    const dogs = new Dogs(sf, d, owners, null)
    expect(dogs.dogs.length).toBeGreaterThanOrEqual(owners.length)
    for (let i = 0; i < 300; i++) dogs.update(1 / 30, null, null)
    expect(dogs.dogs.every((g) => Math.hypot(g.x - g.ox, g.y - g.oy) < d.roam + 4)).toBe(true)
    // A skater on the park-side lane of Dolores St at 9 m/s, north past the lawn (on the ground there).
    let barks = 0, chased = 0
    for (let i = 0; i < 30 * 14; i++) {
      const x = -228, y = -315 + (i / 30) * 9, z = raycast(sf, { x, y, z: 300 }, { x: 0, y: 0, z: -1 }, 600)!.point.z + 0.12
      barks += dogs.update(1 / 30, { x, y, z, vx: 0, vy: 9 }, null).length
      chased = Math.max(chased, dogs.dogs.filter((g) => g.state === 'chase').length)
    }
    expect(chased).toBeGreaterThan(0)
    expect(barks).toBeGreaterThan(0)
    // Gone: they lose interest and trot back to their owners.
    for (let i = 0; i < 30 * 25; i++) dogs.update(1 / 30, null, null)
    expect(dogs.dogs.filter((g) => g.state === 'chase' || g.state === 'back').length).toBe(0)
    expect(dogs.dogs.every((g) => Math.hypot(g.x - g.ox, g.y - g.oy) < d.roam + 6)).toBe(true)
  })
})
