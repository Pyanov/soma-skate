import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { createSim, session, type Sim, type SimEvent } from '../src/sim/sim.ts'
import { step } from '../src/sim/step.ts'

// No dead ends (the first-hour playtest): at every step of every mission a
// skip always works and an abandon always gives back free roam (no mission, free skate, no actor, no
// game it wrapped still running), and Esc (mission next all) always gets out of a conversation.

const data = loadData()
const sf = loadPark('sf', data)

function fresh(): Sim {
  const sim = createSim(sf, data, { spot: 'big3_runway' })
  applyCommand(sim, parseCommand('traffic clear'))
  for (let i = 0; i < 12; i++) step(sim, { b: 0 })
  return sim
}
const run = (sim: Sim, text: string) => { const ev: SimEvent[] = []; applyCommand(sim, parseCommand(text), ev); ev.push(...step(sim, { b: 0 })); return ev }
const freeRoam = (sim: Sim) => {
  const s = session(sim)
  expect(s.mission, 'no mission').toBeUndefined()
  expect(s.mode, 'free skate').toBe('free')
  expect(s.game).toBe('free')
  expect(sim.world.things.some((t) => t.kind === 'actor'), 'no actor left').toBe(false)
  expect(sim.world.things.some((t) => t.car?.tram && !t.car.tram.roam), 'no race streetcar left').toBe(false)
  expect(sim.world.things.some((t) => t.car?.chase), 'no chasing robotaxi left').toBe(false)
  expect(sim.world.things.some((t) => t.npc?.racer || t.npc?.skate), 'no racers or S.K.A.T.E. locals left').toBe(false)
}

describe('first-hour playtest: no dead ends', () => {
  for (const M of data.missions.missions) {
    it(`${M.id}: at every step a skip works and an abandon gives back free roam`, () => {
      M.steps.forEach((st, i) => {
        for (const how of ['skip', 'abandon'] as const) {
          const sim = fresh()
          const ev = run(sim, `mission start ${M.id} ${i}`)
          expect(ev.some((e) => e.t === 'missionStep' && e.mission === M.id && e.step === i), `${M.id} step ${i} entered`).toBe(true)
          // A few ticks in (a follow step's character sets off, a game's clock runs).
          for (let k = 0; k < 30; k++) step(sim, { b: 0 })
          if (!session(sim).mission) continue   // the step ended by itself (a phone call's game, a place already reached)
          const out = run(sim, `mission ${how}`)
          expect(out.some((e) => e.t === (how === 'skip' ? 'missionSkipped' : 'missionAbandoned') && e.mission === M.id), `${M.id} step ${i} ${how}`).toBe(true)
          freeRoam(sim)
        }
      })
    })
  }

  it('Esc always gets out of a conversation: past it, to the offer, or to the next step', () => {
    for (const M of data.missions.missions) M.steps.forEach((st, i) => {
      if (st.kind !== 'talk') return
      const sim = fresh()
      run(sim, `mission start ${M.id} ${i}`)
      const m = session(sim).mission
      if (!m || m.talk < 0) return   // waits for you to come by (not a conversation yet)
      const out = run(sim, 'mission next all')
      const after = session(sim).mission
      expect(out.some((e) => e.t === 'missionOffer') || !after || after.step !== i, `${M.id} step ${i}: Esc leaves the conversation`).toBe(true)
      if (out.some((e) => e.t === 'missionOffer')) { run(sim, 'mission decline'); freeRoam(sim) }
    })
  })

  it('starting a game from the menu mid-mission abandons it and the game starts clean', () => {
    const sim = fresh()
    run(sim, 'mission start pigeons 1')
    const out = run(sim, 'run combo')
    expect(out.some((e) => e.t === 'missionAbandoned' && e.reason === 'mode')).toBe(true)
    expect(session(sim).mission).toBeUndefined()
    expect(session(sim).mode).toBe('combo')
  })
})
