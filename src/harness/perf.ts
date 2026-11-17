import { spawnSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { Btn } from '../sim/input.ts'
import { advance } from '../sim/replay.ts'
import { nextFloat, seedRng } from '../sim/rng.ts'
import { createSim } from '../sim/sim.ts'
import { applyCommand, parseCommand } from '../sim/commands.ts'
import { warmStreets } from '../sim/game/escape.ts'
import { loadData, loadPark, rel } from './io.ts'

// Sim cost per tick as text. --profile re-runs under node --cpu-prof and prints
// the top functions by self time, so it reads as plain text.

export function perf(o: { park: string; ticks: number; profile?: boolean; quiet?: boolean; race?: string; repeats?: number; peds?: boolean; two?: boolean; mode?: string; van?: boolean }) {
  if (o.profile) return profile(o)
  if (o.race !== undefined) return racePerf({ ...o, race: o.race })
  const data = loadData()
  const park = loadPark(o.park, data)
  const sim = createSim(park, data, { seed: 3 })
  warmStreets(park, data.run.escape)   // as the client does while loading (main.ts)
  if (data.npc.parks[o.park]) applyCommand(sim, parseCommand('npc spawn'))   // the NPC skaters count against the budget
  const peds = withPeds(data, o.park, o.peds)
  if (peds) applyCommand(sim, parseCommand('ped spawn'))   // and the pedestrians
  if (o.two) applyCommand(sim, parseCommand('player2 join'))   // --two: a second player (game/twoplayer.ts), on its own keys
  const rng = seedRng(99), rng2 = seedRng(98)
  const times = new Float64Array(o.ticks)
  let b: number = Btn.up, b2: number = Btn.up
  const keysOf = (r: typeof rng) => (nextFloat(r) < 0.7 ? Btn.up : 0) | (nextFloat(r) < 0.4 ? Btn.left : nextFloat(r) < 0.4 ? Btn.right : 0)
  for (let t = 0; t < o.ticks; t++) {
    if (t % 90 === 0) b = keysOf(rng)
    if (o.two && t % 90 === 45) b2 = keysOf(rng2)
    const n = park.spots.length, k = t / 2400
    const cmds = t % 2400 === 0 ? [`teleport ${park.spots[k % n].id}`, ...(o.two ? [`player2 teleport ${park.spots[(k + Math.floor(n / 2)) % n].id}`] : [])] : []
    // --van: in the crew van, summoned to the street nearest each spot, driven on the same keys through the traffic.
    if (o.van && cmds.length) { if (t > 0) cmds.unshift('vehicle exit'); cmds.push('van summon', 'vehicle enter') }
    if (o.mode && t % 9600 === 0) cmds.push(`run ${o.mode}`)   // --mode: a game with its own vehicles (muni j, escape), started again every 80 s
    const t0 = performance.now()
    advance(sim, o.two ? { b, b2 } : { b }, cmds)
    times[t] = performance.now() - t0
  }
  const sorted = Array.from(times).sort((x, y) => x - y)
  const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
  const r = { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1] }
  if (!o.quiet) console.log(`perf ${o.park}: ${o.ticks} ticks  p50 ${r.p50.toFixed(4)} ms  p95 ${r.p95.toFixed(4)}  p99 ${r.p99.toFixed(4)}  max ${r.max.toFixed(3)}  (budget p99 < 0.5 ms; ${(1000 / 120).toFixed(2)} ms per tick available${peds ? '; pedestrians on' : ''}${o.two ? '; two players' : ''}${o.mode ? `; run ${o.mode}` : ''}${o.van ? '; driving the crew van' : ''})`)
  return r
}

/** The race's tick budget: p99 of each tick's best run (checked by `check --full`). */
export const RACE_BUDGET = 0.3

/**
 * A hill bomb race in sf with everything on: the city traffic, the park NPCs and the route's racers,
 * the player pushing then tucked; the race restarts every 1500 ticks so every tick is a race tick.
 * The same race runs `repeats` times (it is deterministic: every run does the same work tick for
 * tick) and each tick keeps its fastest time, so the numbers are the sim's work, not the other
 * programs on the machine; the last (warm) run's raw numbers are printed beside them.
 */
function racePerf(o: { ticks: number; quiet?: boolean; race: string; repeats?: number; peds?: boolean }) {
  const data = loadData()
  const park = loadPark('sf', data)
  const runs = Math.max(1, o.repeats ?? 3)
  const last = new Float64Array(o.ticks), best = new Float64Array(o.ticks).fill(Infinity)
  for (let run = 0; run < runs; run++) {
    const sim = createSim(park, data, { seed: 3 })
    applyCommand(sim, parseCommand('npc spawn'))
    if (withPeds(data, 'sf', o.peds)) applyCommand(sim, parseCommand('ped spawn'))
    for (let t = 0; t < o.ticks; t++) {
      const k = t % 1500
      const b = k >= 20 && k < 200 ? Btn.up : k >= 200 ? Btn.ollie : 0
      const cmds = k === 0 ? [`run bomb ${o.race}`.trim()] : []
      const t0 = performance.now()
      advance(sim, { b }, cmds)
      const ms = performance.now() - t0
      if (run === runs - 1) last[t] = ms
      if (ms < best[t]) best[t] = ms
    }
  }
  const stats = (times: Float64Array) => {
    const sorted = Array.from(times).sort((x, y) => x - y)
    const q = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
    return { p50: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1] }
  }
  const r = { ...stats(best), raw: stats(last) }
  if (!o.quiet) console.log(`perf race ${o.race || 'dolores'}: ${o.ticks} ticks, best of ${runs} per tick  p50 ${r.p50.toFixed(4)} ms  p95 ${r.p95.toFixed(4)}  p99 ${r.p99.toFixed(4)}  max ${r.max.toFixed(3)}  (budget p99 < ${RACE_BUDGET}; last run raw: p50 ${r.raw.p50.toFixed(4)} p99 ${r.raw.p99.toFixed(4)}; traffic, park NPCs, racers${withPeds(data, 'sf', o.peds) ? ', pedestrians' : ''})`)
  return r
}

/** Pedestrians on in a perf run: where the data has them, unless the run says no (--no-peds). */
const withPeds = (data: ReturnType<typeof loadData>, park: string, want?: boolean) => want !== false && data.peds.enabled && data.peds.parks.includes(park)

type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; hitCount?: number }

function profile(o: { park: string; ticks: number; race?: string; two?: boolean; mode?: string }) {
  const dir = rel('out/prof')
  mkdirSync(dir, { recursive: true })
  spawnSync(process.execPath, ['--no-warnings', '--cpu-prof', `--cpu-prof-dir=${dir}`, rel('src/harness/cli.ts'), 'perf', '--park', o.park, '--ticks', String(o.ticks), ...(o.race !== undefined ? ['--race', o.race || 'dolores', '--repeats', '1'] : []), ...(o.two ? ['--two'] : []), ...(o.mode ? ['--mode', o.mode] : [])], { stdio: 'inherit' })
  const newest = readdirSync(dir).filter((f) => f.endsWith('.cpuprofile')).map((f) => `${dir}/${f}`).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
  const prof = JSON.parse(readFileSync(newest, 'utf8')) as { nodes: Node[]; startTime: number; endTime: number; samples: number[] }
  const total = prof.nodes.reduce((s, n) => s + (n.hitCount ?? 0), 0)
  const msPerHit = (prof.endTime - prof.startTime) / 1000 / Math.max(1, total)
  const self = new Map<string, number>()
  for (const n of prof.nodes) {
    const f = n.callFrame
    const where = f.url ? `${f.url.replace(/^file:\/\//, '').replace(rel(''), '')}:${f.lineNumber + 1}` : ''
    const key = `${f.functionName || '(anonymous)'}  ${where}`
    self.set(key, (self.get(key) ?? 0) + (n.hitCount ?? 0))
  }
  console.log(`top functions by self time (${newest.replace(rel(''), '')}):`)
  for (const [k, hits] of [...self].sort((a, b) => b[1] - a[1]).slice(0, 24)) console.log(`  ${((100 * hits) / total).toFixed(1).padStart(5)}%  ${(hits * msPerHit).toFixed(0).padStart(6)} ms  ${k}`)
  return { p50: 0, p95: 0, p99: 0, max: 0 }
}
