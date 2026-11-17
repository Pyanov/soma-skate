import { describe, expect, it } from 'vitest'
import { vetCommands } from '../src/client/commandqueue.ts'
import { loadData, loadPark } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { createSim, session } from '../src/sim/sim.ts'

// The client's command queue (commandqueue.ts, main.ts tick): a frame's commands are tried in order on
// one copy of the world. Found by the first-hour playtest on a loaded machine: two presses in one slow
// frame queued `mission accept` twice; each passed alone, and the second threw inside the frame loop.

const data = loadData()
const soma = loadPark('soma', data)

describe('command queue', () => {
  it('vets a frame\'s commands in order: the second accept of one offer fails, the world untouched', () => {
    const sim = createSim(soma, data)
    for (const c of ['mission start ch1', 'mission next all']) applyCommand(sim, parseCommand(c))
    expect(session(sim).mission?.offer).toBe(true)
    const v = vetCommands(sim, soma, ['mission accept', 'mission accept', 'mission next'])
    expect(v.map((r) => r.ok)).toEqual([true, false, false])
    expect(v[1].text).toMatch(/no offer waiting/)
    expect(session(sim).mission?.offer).toBe(true)   // the dry run never touches the world
    expect(vetCommands(sim, soma, [])).toEqual([])
  })
  it('a failed command leaves the copy as the ones before it left it', () => {
    const sim = createSim(soma, data)
    const v = vetCommands(sim, soma, ['mission start ch1', 'mission start nope', 'mission next all', 'mission accept'])
    expect(v.map((r) => r.ok)).toEqual([true, false, true, true])
  })
})
