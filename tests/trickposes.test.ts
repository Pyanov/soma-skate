import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { evaluate, resolvePoses, revertSwivel, revertTicks, type RawPoseData } from '../src/client/skater/poses.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater } from '../src/sim/sim.ts'
import type { Thing } from '../src/sim/thing.ts'

// The skating animation (view only, skater/poses.ts): every grind and slide its own pose, flips
// turned round by the catch, manuals following the meter, reverts swivelling round.

const data = loadData()
const P = resolvePoses(JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData)
const at = (name: string, tick: number): Thing => skater(runScenario({ ...loadScenario(rel(`scenarios/${name}.skate`)), ticks: tick }, data).sim)

describe('trick poses', () => {
  it('every grind on the table has its own board angle and body (FS and BS mirror across the rail)', () => {
    const ticks = [190, 212, 234, 256, 278, 300, 322]
    for (const side of ['fs', 'bs']) {
      const seen = new Set<string>()
      for (const tk of ticks) {
        const t = at(`lab-grind-table-${side}`, tk)
        expect(t.state).toBe('grind')
        const e = evaluate(t, data, 0, P), p = e.pose
        const key = [p.board.pitch, p.board.yaw, p.board.roll, p.hips[0], p.hipsRot[2], p.rear.pos[2]].map((x) => x.toFixed(2)).join(',')
        expect(seen.has(key), `${t.grind!.name} looks like another grind`).toBe(false)
        seen.add(key)
      }
    }
    // A crooked turns the board one way frontside, the other backside.
    const fs = evaluate(at('lab-grind-table-fs', 300), data, 0, P).pose.board.yaw, bs = evaluate(at('lab-grind-table-bs', 300), data, 0, P).pose.board.yaw
    expect(Math.sign(fs)).toBe(-Math.sign(bs))
    expect(Math.abs(fs)).toBeGreaterThan(20)
  })

  it('a flip is turned all the way round by the time the feet catch it, fastest off the flick', () => {
    const def = data.tricks.flips.find((f) => f.id === 'kickflip')!
    const T = P.timing, catchTick = 97 + Math.ceil(def.ticks * T.flipTurnTo)   // the trick starts counting the tick after the press
    const early = evaluate(at('lab-kickflip-lands', 96 + Math.round(def.ticks * 0.3)), data, 0, P).flip.roll
    expect(early).toBeGreaterThan(0.4)                     // well ahead of a steady turn (0.3) at 30% of the trick
    expect(evaluate(at('lab-kickflip-lands', catchTick), data, 0, P).flip.roll).toBeCloseTo(1, 5)
    expect(evaluate(at('lab-impossible-lands', 110), data, 0, P).flip.pivot[0]).toBeLessThan(-0.15)   // round the back foot
  })

  it("manuals follow the meter: tipping toward the nose drops a manual's nose and sends the arms back", () => {
    const t = at('lab-manual-from-flat', 150)
    expect(t.manual).not.toBeNull()
    const lean = (b: number) => evaluate({ ...t, manual: { ...t.manual!, balance: b } }, data, 0, P).pose
    expect(lean(0.8).board.pitch).toBeLessThan(lean(-0.8).board.pitch)
    expect(lean(0.8).hipsRot[2]).toBeGreaterThan(lean(-0.8).hipsRot[2])
    expect(lean(0.8).lead.pos[0]).toBeLessThan(lean(-0.8).lead.pos[0])
    // The nose manual leans the other way from the manual.
    expect(evaluate(at('lab-nosemanual-from-flat', 150), data, 0, P).pose.hipsRot[2]).toBeGreaterThan(lean(0).hipsRot[2] + 20)
  })

  it('a revert swivels the board and body round over revertTicks, read from the Thing', () => {
    const before = at('lab-revert', 357), during = at('lab-revert', 360), after = at('lab-revert', 380)
    expect(revertTicks(before, data, 0)).toBe(-1)
    expect(revertSwivel(during, data, 0, P)).toBeGreaterThan(60)
    expect(revertSwivel(after, data, 0, P)).toBe(0)
    expect(revertTicks(after, data, 0)).toBeGreaterThan(P.timing.revertTicks)
  })
})
