import { Btn } from '../sim/input.ts'
import { Recorder } from '../sim/replay.ts'
import { nextFloat, seedRng } from '../sim/rng.ts'
import { createSim, skater } from '../sim/sim.ts'
import { applyCommand, parseCommand } from '../sim/commands.ts'
import { loadData, loadPark, rel, writeJson } from './io.ts'
import { checkInvariants, flicker } from './scenario.ts'

// Seeded random-input bots across every spot, checking invariants each tick.
// The bot's randomness is the harness's own; the world RNG is untouched.

export function fuzz(o: { park: string; ticks: number; seed: number; spots?: string[] }) {
  const data = loadData()
  const park = loadPark(o.park, data)
  const sim = createSim(park, data, { seed: o.seed })
  // NPC skaters ride along where the world has them, and are checked too.
  if (data.npc.parks[o.park]) applyCommand(sim, parseCommand('npc spawn'))
  const spots = o.spots ? park.spots.filter((s) => o.spots!.includes(s.id)) : park.spots
  const rng = seedRng(o.seed ^ 0x5eed)
  const segment = 2400
  const rec = new Recorder(segment)
  const violations: string[] = []
  let b = 0, nextChange = 0, segStart = 0
  const recent: { t: string; rel: number; airTicks?: number }[] = []
  for (let t = 0; t < o.ticks; t++) {
    const cmds: string[] = []
    if (t % segment === 0) { cmds.push(`teleport ${spots[(t / segment) % spots.length].id}`); segStart = t }
    if (t >= nextChange) {
      const r = nextFloat(rng)
      b = (r < 0.65 ? Btn.up : r < 0.75 ? Btn.down : 0) | (nextFloat(rng) < 0.35 ? (nextFloat(rng) < 0.5 ? Btn.left : Btn.right) : 0)
      for (const k of [Btn.ollie, Btn.flip, Btn.grab, Btn.grind, Btn.revert, Btn.slide, Btn.walk]) if (nextFloat(rng) < 0.1) b |= k
      nextChange = t + 20 + Math.floor(nextFloat(rng) * 100)
    }
    for (const e of rec.tick(sim, { b }, cmds)) { recent.push({ t: e.t, rel: t, airTicks: e.t === 'land' ? e.airTicks : undefined }); if (recent.length > 64) recent.shift() }
    const sk = skater(sim)
    let bad = checkInvariants(sim, sk) ?? flicker(recent, t)
    for (const n of sim.world.things) if (!bad && n.kind === 'npc') { const v = checkInvariants(sim, n); if (v) bad = `NPC ${n.id}: ${v}` }
    if (bad) {
      const file = rel('out/fuzz', `${o.park}-${violations.length + 1}.replay.json`)
      writeJson(file, rec.replay(t - segStart + 1, `fuzz: ${bad}`), false)
      violations.push(`tick ${t} after spot ${sk.spot}: ${bad}  (replay out/fuzz/${o.park}-${violations.length + 1}.replay.json)`)
      if (violations.length >= 10) break
      t = segStart + segment - 1   // skip to the next spot
    }
  }
  return { park: o.park, ticks: o.ticks, seed: o.seed, spots: spots.length, violations }
}
