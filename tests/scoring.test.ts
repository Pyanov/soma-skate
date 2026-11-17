import { describe, expect, it } from 'vitest'
import { loadData, loadPark, readJson, rel } from '../src/harness/io.ts'
import { DATA_FILES, validateGameData } from '../src/data/schema.ts'
import { createSim, skater } from '../src/sim/sim.ts'
import { startManual } from '../src/sim/skater/combo.ts'
import { comboLinks, comboValue } from '../src/sim/tricks/tricks.ts'
import type { ComboEntry } from '../src/sim/thing.ts'

// Combo scoring (scoring integrity): the repetition curve, and balance that gets touchier with
// each grind, lip or manual already in the combo. The farms these close are pinned by scenarios
// (lab-revert-mash, lab-grind-hop-chain, sf-skitch-mash, ...).

const data = loadData()
const sim = () => createSim(loadPark('lab', data), data)
const e = (id: string, points = 100): ComboEntry => ({ id, name: id, points })

describe('repetition curve', () => {
  it('values the n-th repeat of a trick at scoring.repeat[n-1], the last share from then on', () => {
    const v = comboValue(sim(), ['kickflip', 'kickflip', 'kickflip', 'kickflip', 'kickflip', 'kickflip', 'kickflip'].map((id) => e(id)))
    expect(v.values).toEqual([100, 75, 50, 25, 10, 10, 10])
    expect(v.points).toBe(280 * 7)
  })
  it('counts repeats by id and rounds each entry', () => {
    const v = comboValue(sim(), [e('5050', 150), e('gap-bench', 150), e('5050', 162), e('5050', 947)])
    expect(v.values).toEqual([150, 150, 122, 474])
    expect(v.multiplier).toBe(4)
  })
})

describe('combo balance', () => {
  it('counts the grinds (and slides), lips and manuals already in the combo, each kind apart', () => {
    const s = sim(), sk = skater(s)
    sk.combo = [e('5050'), e('boardslide'), e('manual'), e('rocktofakie'), e('nosemanual'), e('kickflip'), e('gap-bench')]
    expect([comboLinks(s, sk, 'grind'), comboLinks(s, sk, 'manual'), comboLinks(s, sk, 'lip')]).toEqual([2, 2, 1])
  })
  it('starts a manual further over for each manual already in the combo', () => {
    const s = sim(), sk = skater(s), C = data.physics.combo
    sk.combo = [e('manual'), e('kickflip'), e('nosemanual'), e('manual')]
    startManual(s, sk, 'manual', [])
    expect(Math.abs(sk.manual!.balance)).toBeCloseTo(C.manualStart + 3 * C.manualComboTilt, 10)
  })
})

describe('overlapping gaps', () => {
  const raw = () => Object.fromEntries(DATA_FILES.map((f) => [f, readJson(rel(`data/${f}.json`))])) as Record<string, any>
  it('lets a specific gap replace the generic one for the same move, and checks what it names', () => {
    const g = data.gaps.gaps
    expect(g.find((x) => x.id === 'patricia_bench')!.replaces).toEqual(['bench'])
    expect(g.find((x) => x.id === 'doloressend')!.replaces).toEqual(['dolorescrest'])
    const unknown = raw(); unknown.gaps.gaps.find((x: { id: string }) => x.id === 'patricia_bench').replaces = ['nope']
    expect(() => validateGameData(unknown)).toThrow(/which is not another gap/)
    const kind = raw(); kind.gaps.gaps.find((x: { id: string }) => x.id === 'patricia_bench').replaces = ['wave']
    expect(() => validateGameData(kind)).toThrow(/only gaps of the same kind/)
  })
})
