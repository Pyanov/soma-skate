import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { pickStandIn, splitLayout, splitRects, standInEvents, SPLIT_DEFAULTS, type SplitData } from '../src/client/split.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import type { SimEvent } from '../src/sim/sim.ts'

// Split screen (split.ts): the halves for each screen shape, the NPC that stands in for player 2,
// and its events told as a player's to its HUD.

const D = { ...SPLIT_DEFAULTS, ...JSON.parse(readFileSync(rel('data/split.json'), 'utf8')) } as SplitData
const ev = (o: Record<string, unknown>) => o as unknown as SimEvent

describe('split screen', () => {
  it('top and bottom on an ordinary screen, side by side on a wide one; the halves tile the canvas', () => {
    expect(splitLayout(3200, 1800, D)).toBe('tb')
    expect(splitLayout(1280, 720, D)).toBe('tb')
    expect(splitLayout(3440, 1440, D)).toBe('lr')
    const [a, b] = splitRects(1601, 901, 'tb')
    expect(a.y).toBe(b.h)                     // player 1 on top (WebGL counts from the bottom)
    expect(a.h + b.h).toBe(901)
    expect(a.w).toBe(1601); expect(b.y).toBe(0)
    const [l, r] = splitRects(3440, 1440, 'lr')
    expect(l.x).toBe(0); expect(r.x).toBe(l.w); expect(l.w + r.w).toBe(3440); expect(r.h).toBe(1440)
  })

  it('a park NPC stands in for player 2 and stays it while it rides; racers and watchers never do', { timeout: 60000 }, () => {
    const res = runScenario(loadScenario(rel('scenarios/split-npc.skate')), loadData())
    const things = res.sim.world.things
    const id = pickStandIn(things, -1)
    expect(things.find((t) => t.id === id)?.kind).toBe('npc')
    // Sticky: a later pick keeps it even when a lower id rides.
    const other = things.filter((t) => t.kind === 'npc' && t.id !== id).map((t) => t.id)
    for (const o of other) expect(pickStandIn(things, o)).toBe(o)
    expect(pickStandIn(things.map((t) => (t.id === id ? { ...t, npc: { ...t.npc!, racer: { name: 'x' } as never } } : t)), id)).not.toBe(id)
    expect(pickStandIn([], id)).toBe(-1)
  })

  it("the stand-in's banked combos and bails reach its HUD as comboLanded and comboLost; other NPCs' do not", () => {
    const evs = [
      ev({ t: 'npcLand', tick: 5, id: 7, trick: 'Kickflip + BS 50-50', points: 600 }),
      ev({ t: 'npcCombo', tick: 5, id: 7, points: 600, name: 'Kickflip + BS 50-50', multiplier: 2 }),
      ev({ t: 'npcLand', tick: 5, id: 8, trick: 'Ollie', points: 10 }),
      ev({ t: 'npcBail', tick: 9, id: 7, reason: 'landed sideways' }),
    ]
    const out = standInEvents(evs, 7, 'Heelflip')
    expect(out.map((e) => e.t)).toEqual(['comboLanded', 'comboLost', 'bail'])
    expect(out[0]).toMatchObject({ name: 'Kickflip + BS 50-50', points: 600, multiplier: 2 })
    expect(out[1]).toMatchObject({ name: 'Heelflip' })
    expect(standInEvents(evs, 9, '')).toEqual([])
  })
})
