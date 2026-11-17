import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { advance } from '../src/sim/replay.ts'
import { createSim, worldHash } from '../src/sim/sim.ts'

// NPC skaters ride lines near the player (data npc.near): a city's rider lines spread over it, and with
// a handful of NPCs drawn from all of them the locals of a far spot rarely showed up where you are.

const MISSION = ['valencia_north', 'clarion_alley_line', 'bart_plaza_line']
const WATERFRONT = ['emb_west_ledges', 'emb_east_rim', 'pier_7_benches']
const linesOf = (sim: ReturnType<typeof createSim>) => sim.world.things.filter((t) => t.kind === 'npc').map((t) => sim.park.lines[t.npc!.line].id)

describe('NPC lines near the player', () => {
  it('in the Mission, the Mission lines mostly; in the park, the park lines', () => {
    const data = loadData()
    data.npc.parks.sf.lines = [...data.npc.parks.sf.lines, ...MISSION]
    const mission = createSim(loadPark('sf', data), data)
    applyCommand(mission, parseCommand('traffic clear'))
    applyCommand(mission, parseCommand('teleport valencia_shops'))
    applyCommand(mission, parseCommand('npc spawn 12'))
    const m = linesOf(mission).filter((id) => MISSION.includes(id)).length
    expect(m).toBeGreaterThanOrEqual(8)
    const park = createSim(loadPark('sf', data), data)
    applyCommand(park, parseCommand('traffic clear'))
    applyCommand(park, parseCommand('npc spawn 12'))
    expect(linesOf(park).filter((id) => MISSION.includes(id)).length).toBeLessThanOrEqual(3)
  })

  it('at EMB, the EMB locals mostly', () => {
    const data = loadData()
    const sim = createSim(loadPark('sf', data), data)
    applyCommand(sim, parseCommand('traffic clear'))
    applyCommand(sim, parseCommand('teleport emb'))
    applyCommand(sim, parseCommand('npc spawn 12'))
    expect(linesOf(sim).filter((id) => id.startsWith('emb_')).length).toBeGreaterThanOrEqual(7)
  })

  it('all lines near (the park) or none: no draw, the NPCs exactly as without the rule', () => {
    const run = (near: boolean, spot?: string) => {
      const data = loadData()
      // The park's lines only: with the waterfront locals' lines (data/lines.json) some lines are near and some far, and the rule draws.
      data.npc.parks.sf.lines = data.npc.parks.sf.lines.filter((id) => !WATERFRONT.includes(id))
      if (!near) delete data.npc.near
      const sim = createSim(loadPark('sf', data), data)
      applyCommand(sim, parseCommand('traffic clear'))
      if (spot) applyCommand(sim, parseCommand(`teleport ${spot}`))
      applyCommand(sim, parseCommand('npc spawn'))
      for (let k = 0; k < 1200; k++) advance(sim, { b: 0 })
      return worldHash(sim.world)
    }
    expect(run(true)).toBe(run(false))
    expect(run(true, 'emb')).toBe(run(false, 'emb'))
  })
})
