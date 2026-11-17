import { mkdirSync, writeFileSync } from 'node:fs'
import { applyCommand, parseCommand } from '../sim/commands.ts'
import { Btn } from '../sim/input.ts'
import { advance } from '../sim/replay.ts'
import { nextFloat, seedRng } from '../sim/rng.ts'
import { createSim, skater } from '../sim/sim.ts'
import type { Thing } from '../sim/thing.ts'
import { comboValue } from '../sim/tricks/tricks.ts'
import { loadData, loadPark, rel } from './io.ts'

// Farm search (scoring integrity): random button patterns played at every spot of a park, each
// button pressed for `on` ticks every `period` from a phase, a balance bot on top, traffic cleared.
// The best combos are printed with their pattern, to read by hand: a combo far above what a line on
// that spot should pay is a farm (the revert, lip, skitch, slide-tap and regrind farms were found
// this way and by scripted mashing). Each hit can be written out as a scenario to replay and pin.

const BUTTONS: [string, number][] = [['up', Btn.up], ['down', Btn.down], ['left', Btn.left], ['right', Btn.right], ['ollie', Btn.ollie], ['flip', Btn.flip], ['grab', Btn.grab], ['grind', Btn.grind], ['revert', Btn.revert], ['slide', Btn.slide]]

export type FarmKey = { name: string; b: number; on: number; period: number; phase: number }
export type FarmHit = { best: number; multiplier: number; banked: number; name: string; open: boolean; spot: string; speed: number; keys: FarmKey[] }

const balance = (sk: Thing) => {
  const g = sk.grind ?? sk.lip ?? sk.skitch
  if (g) return g.balance > 0.03 ? Btn.left : g.balance < -0.03 ? Btn.right : 0
  if (sk.manual) return sk.manual.balance > 0.03 ? Btn.down : sk.manual.balance < -0.03 ? Btn.up : 0
  return 0
}

export function farmSearch(o: { park: string; trials: number; seed: number; ticks: number }): FarmHit[] {
  const data = loadData(), park = loadPark(o.park, data), rng = seedRng(o.seed)
  const R = (a: number, b: number) => a + (b - a) * nextFloat(rng)
  const hits: FarmHit[] = []
  for (let n = 0; n < o.trials; n++) {
    const spot = park.spots[Math.floor(R(0, park.spots.length))]
    const speed = Math.round(R(0, 10) * 10) / 10
    const keys: FarmKey[] = BUTTONS.filter(() => nextFloat(rng) < 0.35).map(([name, b]) => ({ name, b, on: 0, period: Math.round(R(2, 90)), phase: Math.round(R(0, 90)) }))
    for (const k of keys) k.on = Math.max(1, Math.round(R(1, k.period)))
    const sim = createSim(park, data, { seed: 1, spot: spot.id })
    applyCommand(sim, parseCommand('traffic clear'))
    const hit: FarmHit = { best: 0, multiplier: 0, banked: 0, name: '', open: false, spot: spot.id, speed, keys }
    for (let t = 0; t < o.ticks; t++) {
      if (t === 6) applyCommand(sim, parseCommand(`speed ${speed}`))
      let b = 0
      for (const k of keys) if ((t + k.phase) % k.period < k.on) b |= k.b
      const g = balance(skater(sim))
      if (g && (b & (Btn.left | Btn.right | Btn.grind)) === 0) b |= g
      for (const e of advance(sim, { b })) {
        if (e.t !== 'comboLanded') continue
        hit.banked += e.points
        if (e.points > hit.best) Object.assign(hit, { best: e.points, multiplier: e.multiplier, name: e.name, open: false })
      }
    }
    const sk = skater(sim)
    if (sk.combo.length) { const v = comboValue(sim, sk.combo); if (v.points > hit.best) Object.assign(hit, { best: v.points, multiplier: v.multiplier, name: v.name, open: true }) }
    hits.push(hit)
  }
  return hits.sort((a, b) => b.best - a.best)
}

/** A hit as a scenario (the same spot, speed and presses, the balance bot): out/farm/<park>-<rank>.skate. */
export function farmScenario(park: string, rank: number, h: FarmHit, ticks: number): string {
  const L = [`# farm search hit #${rank}: best combo ${h.best} x${h.multiplier}${h.open ? ' (still open)' : ''}: ${h.name}`, `park ${park}`, `spawn ${h.spot}`, 'cmd 0 traffic clear', `cmd 6 speed ${h.speed}`, 'bot balance']
  for (const k of h.keys) {
    let from = -1
    for (let t = 0; t <= ticks; t++) {
      const on = t < ticks && (t + k.phase) % k.period < k.on
      if (on && from < 0) from = t
      if (!on && from >= 0) { L.push(`hold ${k.name} ${from}..${t}`); from = -1 }
    }
  }
  L.push(`run ${ticks}`)
  mkdirSync(rel('out/farm'), { recursive: true })
  const path = rel(`out/farm/${park}-${rank}.skate`)
  writeFileSync(path, L.join('\n') + '\n')
  return path
}
