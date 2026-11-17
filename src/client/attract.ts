import { pilotKeys, type PilotState } from '../harness/pilot.ts'
import type { GameData } from '../sim/data.ts'
import { Btn, parseButtons } from '../sim/input.ts'
import type { Park } from '../sim/park/park.ts'
import { advance, Recorder, type Replay } from '../sim/replay.ts'
import { createSim, skater } from '../sim/sim.ts'

// The title's attract mode (data/attract.json): after a while idle on the title menu, scripted pro
// runs from the scenarios play as demos, one after another, with the HUD on and PRESS START over
// them; any key goes back to the menu. Each demo is a scenario run here in the page (the same sim,
// so the same run as the harness gets: tests/attract.test.ts) and recorded over its window, then
// shown through the clip machinery (clip.ts load and frame), as clips are.

export type AttractRun = { scenario: string; label: string; from: number; to: number }
export type AttractData = { idleSeconds: number; banner: string; runs: AttractRun[] }

/** A scenario's script: what a demo needs of scenarios/*.skate (expectations are ignored). */
export type Script = {
  park: string; seed: number; spawn?: string; ticks: number
  holds: { b: number; from: number; to: number }[]
  cmds: Map<number, string[]>
  balance: boolean
  pilots: { line: string; from: number; nobrake: boolean }[]
}

/** Parse a scenario the way the harness does (src/harness/scenario.ts) for the keywords demos use. */
export function parseScript(text: string, name = 'script'): Script {
  const sc: Script = { park: 'lab', seed: 1, ticks: 0, holds: [], cmds: new Map(), balance: false, pilots: [] }
  let maxTick = 0
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/#.*/, '').trim().replace(/\{[^}]*\}/g, (m) => m.replace(/ /g, '\u0001'))
    if (!line) return
    const [kw, ...a] = line.split(/\s+/)
    const range = (s: string | undefined) => {
      const m = /^(\d+)\.\.(\d+)$/.exec(s ?? '')
      if (!m) throw new Error(`${name}:${i + 1}: expected a tick range like 10..40`)
      return [Number(m[1]), Number(m[2])] as const
    }
    switch (kw) {
      case 'park': sc.park = a[0]; break
      case 'seed': sc.seed = Number(a[0]); break
      case 'spawn': sc.spawn = a[0]; break
      case 'cmd': { const t = Number(a[0]); sc.cmds.set(t, [...(sc.cmds.get(t) ?? []), a.slice(1).join(' ')]); maxTick = Math.max(maxTick, t + 1); break }
      case 'hold': { const [f, t] = range(a[1]); sc.holds.push({ b: parseButtons(a[0]), from: f, to: t }); maxTick = Math.max(maxTick, t); break }
      case 'tap': {
        if (a[2] === 'every') {
          const [f, to] = range(a[1]), n = Number(a[3])
          for (let t = f; t < to; t += n) sc.holds.push({ b: parseButtons(a[0]), from: t, to: t + 1 })
          maxTick = Math.max(maxTick, to); break
        }
        const t = Number(a[1]); sc.holds.push({ b: parseButtons(a[0]), from: t, to: t + 1 }); maxTick = Math.max(maxTick, t + 1); break
      }
      case 'run': sc.ticks = Number(a[0]); break
      case 'bot':
        if (a[0] === 'balance') sc.balance = true
        else if (a[0] === 'line') sc.pilots.push({ line: a[1], from: Number(a[2] ?? 0), nobrake: a.includes('nobrake') })
        else throw new Error(`${name}:${i + 1}: a demo cannot use bot ${a[0]}`)
        break
      case 'expect': break
      default: throw new Error(`${name}:${i + 1}: a demo cannot use "${kw}"`)
    }
  })
  if (!sc.ticks) sc.ticks = Math.max(1, maxTick)
  return sc
}

/**
 * Run a script on a park and record ticks [from, to) as a replay (the ticks before are only
 * simulated). The keys each tick are the harness's: holds and taps, the rider-line autopilot, the
 * balance bot.
 */
export function runScript(sc: Script, park: Park, data: GameData, from: number, to: number, note = 'demo'): Replay {
  const sim = createSim(park, data, { seed: sc.seed, spot: sc.spawn })
  const pilots = [...sc.pilots].sort((p, q) => p.from - q.from).map((p) => {
    const line = sim.park.lines.find((l) => l.id === p.line)
    if (!line) throw new Error(`no rider line "${p.line}" in ${park.name}`)
    return { ...p, line, st: { i: 1, lastUp: -1000, maxSpeed: 0 } as PilotState, done: false }
  })
  let rec: Recorder | null = null
  const end = Math.min(to, sc.ticks)
  for (let t = 0; t < end; t++) {
    let b = 0
    for (const h of sc.holds) if (t >= h.from && t < h.to) b |= h.b
    const p = pilots.findLast((q) => t >= q.from)
    if (p && !p.done) {
      const keys = pilotKeys(sim, p.line, p.st, t, p.line.maxSlopeDeg >= 4 ? 16 : 5)
      if (keys === null) p.done = true
      else b |= p.nobrake ? keys & ~(Btn.slide | Btn.down) : keys
    }
    const sk = skater(sim), g = sk.grind ?? sk.lip
    if (sc.balance && g && (b & (Btn.left | Btn.right | Btn.grind)) === 0) b |= g.balance > 0.03 ? Btn.left : g.balance < -0.03 ? Btn.right : 0
    if (sc.balance && sk.manual) b = (b & ~(Btn.up | Btn.down)) | (sk.manual.balance > 0.03 ? Btn.down : sk.manual.balance < -0.03 ? Btn.up : 0)
    const cmds = sc.cmds.get(t) ?? []
    if (t === from) rec = new Recorder(Infinity, Infinity)
    if (rec) rec.tick(sim, { b }, cmds)
    else advance(sim, { b }, cmds)
  }
  if (!rec) throw new Error(`demo window ${from}..${to} is past the script's end (${sc.ticks})`)
  return (rec as Recorder).replay(Infinity, note)
}

/** A demo's park: the scenario's own, or the city world (sf) for a park scenario (the park is in it). */
export function playableIn(scriptPark: string, world: string) { return scriptPark === world || (scriptPark === 'soma' && world === 'sf') }

/** The press start line over a demo: the wordmark, the line, and where this run is (with REC). */
export class AttractBanner {
  private el: HTMLElement
  constructor(root: HTMLElement, banner: string) {
    this.el = document.createElement('div')
    this.el.className = 'attract'
    this.el.innerHTML = `<div class="wordmark"><span>SoMa</span><span>Skate</span></div><b></b><span></span>`
    this.el.querySelector(':scope > b')!.textContent = banner
    root.appendChild(this.el)
  }
  show(label: string | null) {
    this.el.classList.toggle('on', label !== null)
    document.body.classList.toggle('attracting', label !== null)
    if (label !== null) this.el.querySelector(':scope > span')!.textContent = label
  }
}
