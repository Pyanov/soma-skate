import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { Btn } from '../src/sim/input.ts'
import { advance } from '../src/sim/replay.ts'
import { createSim } from '../src/sim/sim.ts'

// Hill Bomb racers on a route without a rider line (Hayes St) keep to a lane down its gates: never
// more than bomb.gateLane (and up to 1.15 m of steering) off the gate line between the first and the
// last gate, and never stopped (a racer following the gates themselves drifted into the parking lane
// and stopped against a parked car).

describe('Hayes St racers', () => {
  it('stay in their lanes and keep rolling all the way down', () => {
    const data = loadData(), sim = createSim(loadPark('sf', data), data)
    applyCommand(sim, parseCommand('traffic clear'))
    applyCommand(sim, parseCommand('run bomb hayes'))
    const g = data.run.bomb.routes.find((r) => r.id === 'hayes')!.gates, lane = data.run.bomb.gateLane
    let worst = 0, slowest = Infinity, seen = 0
    for (let t = 0; t < 8600; t++) {
      advance(sim, { b: t >= 10 && t < 300 ? Btn.up : t >= 300 && t < 1200 ? Btn.down : 0 })
      for (const r of sim.world.things) {
        if (!r.npc?.racer?.go || r.pos.x < g[0].pos[0] + 30 || r.pos.x > g[g.length - 1].pos[0]) continue
        let k = 1
        while (k < g.length - 1 && g[k].pos[0] < r.pos.x) k++
        const [ax, ay] = g[k - 1].pos, [bx, by] = g[k].pos, d = Math.hypot(bx - ax, by - ay)
        worst = Math.max(worst, Math.abs(((r.pos.x - ax) * -(by - ay) + (r.pos.y - ay) * (bx - ax)) / d))
        slowest = Math.min(slowest, Math.hypot(r.vel.x, r.vel.y))
        seen++
      }
    }
    expect(seen).toBeGreaterThan(10000)
    expect(worst).toBeLessThan(lane + 1.15)   // 2.39-2.51 m on the city exports up to phase 10, 2.52 m on phase 11's (its curbs moved once), 2.62 m on the squeezed city (the barista past Fillmore; the ground under her is today's)
    expect(slowest).toBeGreaterThan(5)
  })
})
