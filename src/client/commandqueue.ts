import { applyCommand, parseCommands } from '../sim/commands.ts'
import type { Park } from '../sim/park/park.ts'
import type { Sim } from '../sim/sim.ts'
import { loadSnapshot, saveSnapshot } from '../sim/snapshot.ts'

/**
 * Which of a frame's queued commands can run (main.ts tick), each tried in order on one copy of the
 * world after the ones before it, so a bad one never reaches the recorded stream. Two that pass alone
 * can clash together: a double press in a slow frame queues `mission accept` twice, and the second has
 * no offer left to accept. A command that fails may have changed the copy first, so the copy starts
 * again from the world with the ones that passed.
 */
export function vetCommands(sim: Sim, park: Park, texts: string[]): { ok: boolean; text: string }[] {
  if (!texts.length) return []
  const fresh = (passed: string[]) => {
    const test = loadSnapshot(saveSnapshot(sim), park)
    for (const t of passed) for (const c of parseCommands(t)) applyCommand(test, c)
    return test
  }
  const passed: string[] = []
  let test = fresh(passed)
  return texts.map((text) => {
    try {
      const res = parseCommands(text).map((c) => applyCommand(test, c)).join('; ')
      passed.push(text)
      return { ok: true, text: res }
    } catch (e) {
      test = fresh(passed)
      return { ok: false, text: (e as Error).message }
    }
  })
}
