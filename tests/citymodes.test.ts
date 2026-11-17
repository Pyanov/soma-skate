import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { muniLine, muniRoute, routeAt } from '../src/sim/game/muni.ts'
import { advance } from '../src/sim/replay.ts'
import { createSim, session, worldHash } from '../src/sim/sim.ts'

// The city's games with their own vehicles: the Muni Race's streetcar on its rails (game/muni.ts)
// and the Robotaxi Escape's robotaxi on its street graph (game/escape.ts).

describe('Muni Race', () => {
  it('builds each line on the middle of its track, its stops in order along it', () => {
    const data = loadData(), sim = createSim(loadPark('sf', data), data)
    for (const line of data.run.muni.lines) {
      const r = muniRoute(sim, muniLine(sim, line.id)!)
      expect(r.stops.length, line.id).toBe(line.stops.length)
      for (let i = 1; i < r.stops.length; i++) expect(r.stops[i]).toBeGreaterThan(r.stops[i - 1])
      // Every stop but the first (OpenStreetMap's Castro stop is off the end of the rail) is on the route.
      line.stops.slice(1).forEach((st, k) => { const { p } = routeAt(r, r.stops[k + 1]); expect(Math.hypot(p.x - st.at[0], p.y - st.at[1]), st.name).toBeLessThan(0.1) })
    }
  })

  it('refuses the park and unknown lines; a new run takes the streetcar away', () => {
    const data = loadData()
    const soma = createSim(loadPark('soma', data), data)
    expect(() => applyCommand(soma, parseCommand('run muni'))).toThrow(/city/)
    const sim = createSim(loadPark('sf', data), data)
    expect(() => applyCommand(sim, parseCommand('run muni x'))).toThrow(/no Muni line "x"/)
    const roam = sim.world.things.filter((t) => t.car?.tram?.roam).length
    expect(roam).toBe(data.run.muni.roam.lines.reduce((n, l) => n + l.cars, 0))
    expect(applyCommand(sim, parseCommand('run muni j'))).toBe('Muni Race: beat the J Church to Right of Way & 18th Street')
    // During a race only its streetcar: the free-roam ones leave, and come back with the next game.
    expect(sim.world.things.filter((t) => t.car?.tram).length).toBe(1)
    applyCommand(sim, parseCommand('run free'))
    expect(sim.world.things.some((t) => t.car?.tram && !t.car.tram.roam)).toBe(false)
    expect(sim.world.things.filter((t) => t.car?.tram?.roam).length).toBe(roam)
    expect(session(sim).muniLine).toBeUndefined()
  })
})

describe('Robotaxi Escape', () => {
  it('refuses the park; replays the same chase tick for tick', () => {
    const data = loadData()
    expect(() => applyCommand(createSim(loadPark('lab', data), data), parseCommand('run escape'))).toThrow(/city/)
    const run = () => {
      const sim = createSim(loadPark('sf', data), data, { spot: 'valencia_shops', seed: 4 })
      applyCommand(sim, parseCommand('run escape'))
      for (let t = 0; t < 1500; t++) advance(sim, { b: t % 300 < 150 ? 1 : 0 }, t === 700 ? ['teleport bart_16th'] : [])
      return worldHash(sim.world)
    }
    expect(run()).toBe(run())
  })
})
