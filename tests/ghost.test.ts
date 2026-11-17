import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { ghostDelta, ghostFrames } from '../src/sim/ghost.ts'
import { pilotKeys, type PilotState } from '../src/harness/lines.ts'
import { Btn } from '../src/sim/input.ts'
import { Recorder } from '../src/sim/replay.ts'
import { createSim, skater, worldHash, type SimEvent } from '../src/sim/sim.ts'

// Ghost racing: a recorded Hill Bomb run re-run as a ghost gives the same skater every tick, its
// gate splits, and leaves the live world alone.

const data = loadData()

describe('ghost', () => {
  const sf = loadPark('sf', data)
  // The race line of sf-bomb-race, recorded from the start command.
  const record = () => {
    const sim = createSim(sf, data, { seed: 1 })
    const rec = new Recorder()
    const events: SimEvent[] = []
    for (let t = 0; t < 1760; t++) {
      const b = (t >= 20 && t < 200 ? Btn.up : 0) | (t >= 200 ? Btn.ollie : 0) | ((t >= 1220 && t < 1290) || (t >= 1560 && t < 1630) ? Btn.slide : 0)
      events.push(...rec.tick(sim, { b }, t === 0 ? ['traffic clear', 'run bomb'] : []))
    }
    return { sim, replay: rec.replay(), events }
  }

  it('replays the run tick for tick, with the gate splits and the finish', () => {
    const { sim, replay, events } = record()
    const g = ghostFrames(replay, sf)
    expect(g.frames.length).toBe(1760)
    expect(g.frames[g.frames.length - 1].pos).toEqual(skater(sim).pos)
    const live = events.filter((e) => e.t === 'bombCheckpoint' || e.t === 'bombFinish').map((e) => (e as { time: number }).time)
    expect(g.splits.map((s) => s.time)).toEqual(live)
    expect(g.splits.map((s) => s.name)).toEqual(['Dolores & 19th', 'Finish'])
    expect(g.finish).toBe(11.97)   // 11.96 in today's city (sf-bomb-race)
    const startTick = events.find((e) => e.t === 'bombStart')!.tick
    expect(g.start).toBe(startTick)   // frames[k] is the skater after tick k
    expect(ghostDelta(g, 1, 12.38)).toBe(0.41)
    expect(ghostDelta(g, 5, 1)).toBe(null)
  })

  it('works per route: a Twin Peaks run gives its route and its own gates', () => {
    const sim = createSim(sf, data, { seed: 1 })
    const line = sf.lines.find((l) => l.id === 'twin_peaks_line')!
    const rec = new Recorder(), st: PilotState = { i: 1, lastUp: -1000, maxSpeed: 0 }
    for (let t = 0; t < 12900; t++) {
      const keys = t >= 6 ? pilotKeys(sim, line, st, t, 16) : 0
      rec.tick(sim, { b: keys ?? 0 }, t === 0 ? ['traffic clear', 'run bomb twinpeaks'] : [])
    }
    const g = ghostFrames(rec.replay(), sf)
    expect(g.route).toBe('twinpeaks')
    expect(g.splits.map((s) => s.name)).toEqual(['Market & Clayton', 'Market & 19th', 'Market & 18th', 'Market & Douglass', 'Finish'])
    expect(g.finish).toBe(103.53)   // 103.6 in today's city, 103.36 before the feel pass's park carve (sf-bomb-twinpeaks)
  })

  it('is deterministic and never touches the live world', () => {
    const { sim, replay } = record()
    const before = worldHash(sim.world)
    const a = ghostFrames(replay, sf), b = ghostFrames(replay, sf)
    expect(worldHash(sim.world)).toBe(before)
    expect(JSON.stringify(a.frames[900])).toBe(JSON.stringify(b.frames[900]))
  })
})
