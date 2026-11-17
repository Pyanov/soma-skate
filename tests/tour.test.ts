import { describe, expect, it } from 'vitest'
import { loadData, loadPark, readJson, rel } from '../src/harness/io.ts'
import { validateGameData, DATA_FILES } from '../src/data/schema.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { createSim, session, skater, type SimEvent } from '../src/sim/sim.ts'
import { step } from '../src/sim/step.ts'

// The Tour (data/tour.json, game/tour.ts): level data that holds together, `run level` refusing what
// it cannot do, and a run's session fields.

const data = loadData()
const raw = () => Object.fromEntries(DATA_FILES.map((f) => [f, readJson(rel(`data/${f}.json`))])) as Record<(typeof DATA_FILES)[number], unknown>

describe('Tour data', () => {
  it('has eleven levels, every one open from the start (no unlock thresholds: docs/open-world.md)', () => {
    expect(data.tour.levels.map((l) => [l.id, l.world])).toEqual([['soma', 'soma'], ['mission', 'sf'], ['castro', 'sf'], ['hills', 'sf'], ['hayes', 'sf'], ['civic', 'sf'], ['embarcadero', 'sf'], ['chinatown', 'sf'], ['russianhill', 'sf'], ['northbeach', 'sf'], ['wharf', 'sf']])
    for (const L of data.tour.levels) expect('unlock' in L, L.id).toBe(false)
  })
  it('gives each level S-K-A-T-E, a tape, two tiers and three goals, inside its area or one of its extra areas', () => {
    for (const L of data.tour.levels) {
      expect(L.letters.map((l) => l.letter).join('')).toBe('SKATE')
      expect(L.goals.length).toBe(3)
      expect(L.tiers.sick).toBeGreaterThan(L.tiers.pro)
      // Fisherman's Wharf runs from Pier 39 along Jefferson to the turntable at the Wharf's west end: its letters are in its extra area too.
      const inside = ([x, y]: number[]) => [L.area, ...(L.areas ?? [])].some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])
      for (const l of L.letters) expect(inside(l.pos), `${L.id} ${l.letter}`).toBe(true)
      expect(inside(L.tape.pos), `${L.id} tape`).toBe(true)
    }
  })
  it('refuses a goal on an unknown gap and letters out of order', () => {
    const bad = raw() as Record<string, any>
    bad.tour.levels[0].goals[1].gaps = ['nope']
    expect(() => validateGameData(bad)).toThrow(/no gap "nope"/)
    const swapped = raw() as Record<string, any>
    swapped.tour.levels[0].letters.reverse()
    expect(() => validateGameData(swapped)).toThrow(/S, K, A, T, E in order/)
  })
})

describe('run level', () => {
  const sf = loadPark('sf', data), soma = loadPark('soma', data)
  it('starts every level inside its area or one of its extra areas, from each of its starts', () => {
    for (const L of data.tour.levels) {
      const sim = createSim(L.world === 'sf' ? sf : soma, data)
      for (const at of [L.spot, ...(L.starts ?? [])]) {
        applyCommand(sim, parseCommand(`run level ${L.id} ${at}`))
        const { x, y } = skater(sim).pos
        const inside = [L.area, ...(L.areas ?? [])].some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])
        expect(inside, `${L.id} from ${at}`).toBe(true)
      }
    }
  })
  it('refuses an unknown level, the wrong world and a start the level does not have', () => {
    expect(() => applyCommand(createSim(soma, data), parseCommand('run level nowhere'))).toThrow(/no Tour level "nowhere"/)
    expect(() => applyCommand(createSim(soma, data), parseCommand('run level mission'))).toThrow(/in the sf world/)
    expect(() => applyCommand(createSim(sf, data), parseCommand('run level castro twin_peaks_bomb'))).toThrow(/starts at harvey_milk/)
    expect(() => parseCommand('run level')).toThrow(/run level <id>/)
  })
  it('starts at the level spot or another start, with the session fields set, and clears them for another game', () => {
    const sim = createSim(sf, data), ev: SimEvent[] = []
    applyCommand(sim, parseCommand('run level hills twin_peaks_bomb'), ev)
    const s = session(sim), sk = skater(sim)
    expect([Math.round(sk.pos.x), Math.round(sk.pos.y)]).toEqual([-1205, -653])
    expect([s.mode, s.game, s.level, s.levelGoals, s.tape, s.letters, s.timeLeft]).toEqual(['level', 'level', 'hills', [], false, '', 120 * 120])
    expect(ev).toContainEqual(expect.objectContaining({ t: 'levelStart', level: 'hills', seconds: 120 }))
    step(sim, { b: 0 })
    expect(s.timeLeft).toBe(120 * 120 - 1)
    applyCommand(sim, parseCommand('run free'))
    expect([s.level, s.levelGoals, s.tape, s.away]).toEqual([undefined, undefined, undefined, undefined])
  })
})
