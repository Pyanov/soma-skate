import type { GameData } from './data.ts'
import type { Park } from './park/park.ts'
import { dataHashOf, worldHash, type Sim, type World } from './sim.ts'
import { makeThing } from './thing.ts'

// An exact moment: the world plus the data it ran with. Save and load are the
// same path in reverse.

export type Snapshot = {
  format: 'soma-snap/1'
  park: { name: string; hash: string }
  dataHash: string
  data: GameData
  world: World
  hash: string
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

export function saveSnapshot(sim: Sim): Snapshot {
  return {
    format: 'soma-snap/1',
    park: { name: sim.park.name, hash: sim.park.hash },
    dataHash: sim.dataHash,
    data: clone(sim.data),
    world: clone(sim.world),
    hash: worldHash(sim.world),
  }
}

/**
 * Load a snapshot onto a park. `data: 'snapshot'` reproduces the exact moment
 * (replays); passing current data tests today's tuning from that moment (scenarios).
 */
export function loadSnapshot(snap: Snapshot, park: Park, data: GameData | 'snapshot' = 'snapshot'): Sim {
  if (snap.format !== 'soma-snap/1') throw new Error(`unknown snapshot format ${snap.format}`)
  if (snap.park.name !== park.name) throw new Error(`snapshot is for park "${snap.park.name}", not "${park.name}"`)
  const d = data === 'snapshot' ? clone(snap.data) : clone(data)
  const world = clone(snap.world)
  // Things saved before a field existed get that field's default (one load path, one migration).
  world.things = world.things.map((t) => ({ ...makeThing(t.id, t.kind), ...t }))
  return { world, park, data: d, dataHash: dataHashOf(d) }
}

export const parkMatches = (snap: Snapshot, park: Park) => snap.park.hash === park.hash
