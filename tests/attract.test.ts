import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseScript, playableIn, runScript, type AttractData } from '../src/client/attract.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { runReplay } from '../src/sim/replay.ts'

// The title's attract mode (attract.ts): each demo is a scenario run in the page. The page's runner
// has to ride it exactly as the harness does (same keys, autopilot and balance bot), in its own world
// and, for the park, in the city world around it.

const data = loadData()
const A = JSON.parse(readFileSync(rel('data/attract.json'), 'utf8')) as AttractData
const keep = /comboLanded|grindStart|bail|gap|letter|levelGoal|wallrideStart|tapeFound/
const key = (e: { tick: number; t: string; name?: string; trick?: string }) => `${e.tick}:${e.t}:${e.name ?? e.trick ?? ''}`

describe('attract mode', () => {
  it('cycles the park, Dolores, Twin Peaks, Clarion, City Hall and the Embarcadero', () => {
    expect(A.idleSeconds).toBe(30)
    expect(A.runs.map((r) => r.label).join(' | ')).toMatch(/SoMa.*Dolores.*Twin Peaks.*Clarion.*City Hall.*Ferry Building.*EMB/)
  })

  it('each demo plays as the harness runs its scenario, over its window, with something landed in it', { timeout: 180000 }, () => {
    for (const run of A.runs) {
      const sc = parseScript(readFileSync(rel(`scenarios/${run.scenario}.skate`), 'utf8'), run.scenario)
      const theirs = runScenario(loadScenario(rel(`scenarios/${run.scenario}.skate`)), data).events.filter((e) => e.rel > run.from && e.rel <= run.to && keep.test(e.t)).map(key)
      for (const world of ['sf', sc.park]) {
        if (!playableIn(sc.park, world)) continue
        const park = loadPark(world, data)
        const replay = runScript(sc, park, data, run.from, run.to, run.label)
        expect(replay.ticks, run.scenario).toBe(run.to - run.from)
        const mine: string[] = []
        runReplay(replay, park, { onTick: (_s, ev) => { for (const e of ev) if (keep.test(e.t)) mine.push(key(e as never)) } })
        expect(mine, `${run.scenario} in ${world}`).toEqual(theirs)
        if (run.scenario !== 'sf-bomb-twinpeaks') expect(mine.some((k) => k.includes('comboLanded')), run.scenario).toBe(true)
      }
    }
  })

  it('a demo window past its script, or a keyword demos cannot ride, is an error', () => {
    const sc = parseScript('park soma\nhold up 0..10\nrun 100')
    expect(() => runScript(sc, loadPark('soma', data), data, 200, 300)).toThrow(/past the script/)
    expect(() => parseScript('park soma\nbot skate')).toThrow(/cannot use bot skate/)
    expect(() => parseScript('load scenarios/x.snap.json')).toThrow(/cannot use "load"/)
  })
})
