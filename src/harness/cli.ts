import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { HASH_EVERY, runReplay, type Replay } from '../sim/replay.ts'
import { worldHash } from '../sim/sim.ts'
import { loadSnapshot, saveSnapshot } from '../sim/snapshot.ts'
import { WORLDS } from '../sim/park/source.ts'
import { bvhWorlds, checkBvh, writeBvh } from './bvh.ts'
import { fuzz } from './fuzz.ts'
import { cityFuzz } from './cityfuzz.ts'
import { farmScenario, farmSearch } from './farm.ts'
import { loadData, loadPark, loadParkSource as loadParkSourceFor, readJson, rel, writeJson } from './io.ts'
import { lintSim } from './lint.ts'
import { perf, RACE_BUDGET } from './perf.ts'
import { feel } from './feel.ts'
import { loadScenario, parseScenario, readPath, runScenario, type ScenarioResult } from './scenario.ts'
import { defaultJobs, resultLines, runPool } from './scenariopool.ts'

// `skate`: the game, headless, plus tools. Every command prints compact text.

type Args = { _: string[]; [k: string]: string | boolean | string[] }
function parseArgs(argv: string[]): Args {
  const out: Args = { _: [] }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a.startsWith('--')) {
      const [k, v] = a.slice(2).split('=')
      if (v !== undefined) out[k] = v
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') && !/^-[a-z]$/.test(argv[i + 1])) out[k] = argv[++i]   // a flag then -o: the flag is a switch, not -o's
      else out[k] = true
    } else if (a === '-o') out.o = argv[++i]
    else if (/^-[a-z]$/.test(a)) out[a.slice(1)] = true
    else out._.push(a)
  }
  return out
}
const str = (v: unknown, d = '') => (typeof v === 'string' ? v : d)
const num = (v: unknown, d: number) => (typeof v === 'string' && Number.isFinite(Number(v)) ? Number(v) : d)

/** Spots the city adds to the sf world (the park's own are fuzzed as soma). */
const citySpots = () => { const data = loadData(); const soma = new Set(loadPark('soma', data).spots.map((s) => s.id)); return loadPark('sf', data).spots.map((s) => s.id).filter((id) => !soma.has(id)) }

// Every scenario: scenarios/*.skate, and the crew van's street routes to the city's places (scenarios/squeeze-routes,
// written by tools/squeeze/routes.ts; docs/squeeze.md section 6). A name is looked up in each, in this order.
const SCENARIO_DIRS = ['scenarios', 'scenarios/squeeze-routes']
const scenarioFiles = () => SCENARIO_DIRS.filter((d) => existsSync(rel(d))).flatMap((d) => readdirSync(rel(d)).filter((f) => f.endsWith('.skate')).sort().map((f) => rel(d, f)))
function scenarioPath(name: string) {
  if (existsSync(name)) return name
  const file = name.endsWith('.skate') ? name : `${name}.skate`
  const p = SCENARIO_DIRS.map((d) => rel(d, file)).find((q) => existsSync(q))
  if (!p) throw new Error(`no scenario ${name} (have: ${scenarioFiles().map((f) => basename(f, '.skate')).join(', ')})`)
  return p
}

function printResult(r: ScenarioResult, verbose: boolean) {
  const { ok, lines } = resultLines(r, verbose)
  for (const l of lines) console.log(l)
  return ok
}

function runScenarios(names: string[], verbose: boolean) {
  const data = loadData()
  const files = names.length === 0 || names[0] === 'all' ? scenarioFiles() : names.map(scenarioPath)
  let failed = 0
  for (const f of files) if (!printResult(runScenario(loadScenario(f), data), verbose || files.length === 1)) failed++
  return { total: files.length, failed }
}

function trace(target: string, a: Args) {
  const data = loadData()
  const fields = str(a.fields, 'state,pos.x,pos.y,pos.z,speed,vel.z').split(',')
  const every = num(a.every, 6), from = num(a.from, 0), to = num(a.to, Infinity)
  const r = target.endsWith('.json') ? runScenario(parseScenario(`park ${readJson<Replay>(target).start.park.name}\nreplay ${target}`, basename(target)), data) : runScenario(loadScenario(scenarioPath(target)), data)
  console.log(['tick', ...fields].map((f) => f.padStart(9)).join(' '))
  for (const row of r.rows) {
    if (row.t < from || row.t > to || (row.t % every !== 0 && !r.events.some((e) => e.rel === row.t))) continue
    const ev = r.events.filter((e) => e.rel === row.t).map((e) => e.t).join(',')
    console.log([String(row.t).padStart(9), ...fields.map((f) => { const v = readPath(row.thing, f, row.session, row.car, row.npcs, row.peds, row.thing2, row.session2, row.van, row.actor, row.npc); return (typeof v === 'number' ? v.toFixed(3) : v).padStart(9) }), ev ? `  <- ${ev}` : ''].join(' '))
  }
}

/** Fields added to data files after a replay was recorded take today's values; recorded values win. */
function withDefaults<T>(recorded: T, current: T, added: string[] = [], path = ''): T {
  if (typeof recorded !== 'object' || recorded === null || Array.isArray(recorded)) return recorded
  const out: Record<string, unknown> = { ...(recorded as Record<string, unknown>) }
  for (const [k, v] of Object.entries(current as Record<string, unknown>)) {
    if (!(k in out)) { out[k] = v; added.push(path + k) }
    else out[k] = withDefaults(out[k], v, added, `${path}${k}.`)
  }
  return out as T
}

function replayCmd(file: string, a: Args) {
  const rp = readJson<Replay>(file)
  const data = loadData()
  const park = loadPark(rp.start.park.name, data)
  if (rp.start.park.hash !== park.hash) console.log(`note: replay was recorded on park ${rp.start.park.hash}, current is ${park.hash}`)
  const added: string[] = []
  rp.start.data = withDefaults(rp.start.data, data, added)
  if (added.length) console.log(`note: data fields newer than the replay take current values: ${added.join(', ')}`)
  const t0 = performance.now()
  const res = runReplay(rp, park, { data: a.current ? data : 'snapshot' })
  const ms = performance.now() - t0
  if (a.rebaseline) {
    // Store the start migrated (current Thing fields, merged data) so the file is self-consistent.
    rp.start = saveSnapshot(loadSnapshot(rp.start, park))
    const hashes: [number, string][] = []
    const states: [number, typeof rp.states[0][1]][] = []
    runReplay({ ...rp, hashes: [], states: [] }, park, { data: 'snapshot', onTick: (sim) => {
      if (sim.world.tick % HASH_EVERY === 0) hashes.push([sim.world.tick, worldHash(sim.world)])
      if (sim.world.tick % 120 === 0) states.push([sim.world.tick, JSON.parse(JSON.stringify(sim.world))])
    } })
    writeJson(file, { ...rp, hashes, states }, false)
    console.log(`rebaselined ${file}: ${hashes.length} hashes`)
    return true
  }
  const counts = new Map<string, number>()
  for (const e of res.events) counts.set(e.t, (counts.get(e.t) ?? 0) + 1)
  console.log(`${basename(file)}  ${rp.ticks} ticks from tick ${rp.start.world.tick}  ${ms.toFixed(0)} ms  events ${[...counts].map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}${rp.note ? `\n  note: ${rp.note}` : ''}`)
  if (res.divergence) {
    console.log(`DIVERGED at tick ${res.divergence.tick} (${res.checked} hashes checked)  expected ${res.divergence.expected} got ${res.divergence.actual}`)
    for (const f of res.divergence.fields) console.log(`  ${f}`)
    return false
  }
  console.log(`verified: ${res.checked} hashes match`)
  return true
}

function snap(target: string, a: Args) {
  const at = num(a.at, NaN)
  if (!Number.isFinite(at)) throw new Error('snap: give --at <tick> (relative to the replay or scenario start)')
  const data = loadData()
  const out = str(a.o, rel('scenarios', `${basename(target).replace(/\.(replay\.json|json|skate)$/, '')}-t${at}.snap.json`))
  let saved = false
  const grab = (sim: Parameters<typeof saveSnapshot>[0], t: number) => { if (!saved && t === at) { writeJson(out, saveSnapshot(sim), false); saved = true } }
  if (target.endsWith('.json')) {
    const rp = readJson<Replay>(target)
    const park = loadPark(rp.start.park.name, data)
    if (at === 0) { writeJson(out, rp.start, false); saved = true }
    let t = 0
    runReplay(rp, park, { onTick: (sim) => grab(sim, ++t) })
  } else {
    const sc = loadScenario(scenarioPath(target))
    const r = runScenario({ ...sc, ticks: at }, data)
    writeJson(out, saveSnapshot(r.sim), false); saved = true
  }
  console.log(saved ? `wrote ${out}` : `tick ${at} is past the end`)
}

function inbox() {
  const files = readdirSync(rel('inbox')).filter((f) => f.endsWith('.replay.json')).sort()
  if (!files.length) return console.log('inbox is empty')
  for (const f of files) {
    const rp = readJson<Replay>(rel('inbox', f))
    console.log(`${f}  ${(rp.ticks / 120).toFixed(1)} s on ${rp.start.park.name}  note: ${rp.note || '(none)'}`)
  }
}

function promote(file: string, name?: string) {
  const src = existsSync(file) ? file : rel('inbox', file)
  const rp = readJson<Replay>(src)
  const id = name ?? basename(src).replace(/\.replay\.json$/, '')
  mkdirSync(rel('replays'), { recursive: true })
  copyFileSync(src, rel('replays', `${id}.replay.json`))
  const sc = rel('scenarios', `${id}.skate`)
  writeFileSync(sc, `# From an F8 clip. Note: ${rp.note || '(none)'}\n# Replays the clip from its start with current data. Add expectations that\n# describe the correct behavior, so this fails until the fix lands.\npark ${rp.start.park.name}\nreplay replays/${id}.replay.json\n# expect ...\n`)
  console.log(`promoted to replays/${id}.replay.json and scenarios/${id}.skate`)
}

async function check(full: boolean, lines: typeof import('./lines.ts'), jobs: number) {
  let ok = true
  type Step = { ok: boolean; detail?: string }
  const report = (label: string, t0: number, r: Step) => {
    console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(14)} ${((performance.now() - t0) / 1000).toFixed(1)}s${r.detail ? `  ${r.ok ? r.detail : ''}` : ''}`)
    if (!r.ok && r.detail) console.log(r.detail.split('\n').slice(0, 40).map((l) => `      ${l}`).join('\n'))
    ok &&= r.ok
  }
  const fail = (e: unknown): Step => ({ ok: false, detail: String((e as Error).stack ?? e) })
  const stepRun = (label: string, fn: () => Step) => { const t0 = performance.now(); let r: Step; try { r = fn() } catch (e) { r = fail(e) } report(label, t0, r) }
  const stepRunAsync = async (label: string, fn: () => Promise<Step>) => { const t0 = performance.now(); let r: Step; try { r = await fn() } catch (e) { r = fail(e) } report(label, t0, r) }
  const tool = (bin: string, args: string[]) => {
    const p = spawnSync(rel('node_modules/.bin', bin), args, { cwd: rel(), encoding: 'utf8' })
    return { ok: p.status === 0, detail: (p.stdout + p.stderr).trim() }
  }
  stepRun('typecheck sim', () => tool('tsc', ['-p', 'src/sim']))
  stepRun('typecheck all', () => tool('tsc', ['-p', '.']))
  stepRun('sim lint', () => { const p = lintSim(); return { ok: p.length === 0, detail: p.join('\n') } })
  stepRun('unit tests', () => { const r = tool('vitest', ['run', '--reporter=dot']); return { ok: r.ok, detail: r.ok ? r.detail.split('\n').filter((l) => /Tests|Test Files/.test(l)).join(' ').replace(/\s+/g, ' ') : r.detail } })
  // The shipped BVH files against the sim's builder, from the triangles (src/data/bvhfile.ts).
  stepRun('park bvh', () => checkBvh())
  // Every scenario (the street routes too), in a pool of worker threads (scenariopool.ts).
  await stepRunAsync('scenarios', async () => {
    const res = await runPool(scenarioFiles(), jobs), bad = res.filter((r) => !r.ok)
    return { ok: bad.length === 0, detail: bad.length === 0 ? `${res.length} pass (${jobs} workers)` : bad.flatMap((r) => r.lines).join('\n') }
  })
  if (full) {
    stepRun('replays', () => {
      const files = existsSync(rel('replays')) ? readdirSync(rel('replays')).filter((f) => f.endsWith('.replay.json')) : []
      const lines: string[] = []
      const log = console.log
      console.log = (...x: unknown[]) => lines.push(x.join(' '))
      let bad = 0
      try { for (const f of files) if (!replayCmd(rel('replays', f), { _: [] })) bad++ } finally { console.log = log }
      return { ok: bad === 0, detail: bad === 0 ? `${files.length} verified` : lines.join('\n') }
    })
    stepRun('fuzz', () => {
      const lines: string[] = []
      for (const park of ['lab', 'soma', 'sf']) {
        // sf: the park's own spots are fuzzed as soma; here the bots start from the city's.
        const r = fuzz({ park, ticks: park === 'lab' ? 30000 : 60000, seed: 7, spots: park === 'sf' ? citySpots() : undefined })
        lines.push(`${park}: ${r.ticks} ticks, ${r.violations.length} violations`, ...r.violations.slice(0, 3).map((v) => `  ${v}`))
      }
      return { ok: !lines.some((l) => l.startsWith('  ')), detail: lines.join('; ') }
    })
    stepRun('city fuzz', () => {
      // About 10 s of bots dropped all over the city (1,200 segments of 10 s, area by area): any
      // finding not already reported (src/harness/cityfuzz-known.json) fails the check.
      const r = cityFuzz({ segments: 1200, segmentTicks: 1200, seed: 1, quiet: true })
      const fresh = r.findings.filter((f) => !f.known)
      const known = [...new Set(r.findings.filter((f) => f.known).map((f) => f.known))]
      return { ok: fresh.length === 0, detail: `${r.segments} segments over ${r.cells} areas, ${r.findings.length - fresh.length} known (${known.join(', ') || 'none'}), ${fresh.length} new${fresh.length ? ': ' + fresh.slice(0, 3).map((f) => `${f.kind} at ${f.at.map((v) => v.toFixed(1)).join(' ')} (${f.detail}; ${f.scenario})`).join('; ') : ''}` }
    })
    stepRun('rider lines', () => {
      const { rideLines } = lines
      // The park's lines on soma, the city's own lines on sf.
      const soma = new Set((loadParkSourceFor('soma').lines ?? []).map((l) => l.id))
      const res = [...rideLines(), ...rideLines({ park: 'sf', only: (loadParkSourceFor('sf').lines ?? []).map((l) => l.id).filter((id) => !soma.has(id)) }), ...rideLines({ park: 'lab' })]
      const bad = res.filter((r) => !r.pass)
      return { ok: bad.length === 0, detail: bad.length ? bad.map((r) => `${r.id}: ${r.reason}`).join('\n') : `${res.length} ridden` }
    })
    stepRun('perf budget', () => {
      // The park, and the city with its traffic (80 cars stepping every tick) and pedestrians (24); the city again with two players.
      // Each measure gets a second run when the first is over budget, the better one counting: other work on a
      // busy machine (other builds and programs) shows up as p99 spikes that are not the sim's.
      type P = ReturnType<typeof perf>
      const best = (f: () => P): P => { const a = f(); if (a.p99 < 0.5) return a; const b = f(); return b.p99 < a.p99 ? b : a }
      const r = best(() => perf({ park: 'soma', ticks: 12000, quiet: true })), c = best(() => perf({ park: 'sf', ticks: 12000, quiet: true })), d = best(() => perf({ park: 'sf', ticks: 12000, quiet: true, two: true }))
      // The city's games with their own vehicles: the Muni Race (streetcar) and the Robotaxi Escape (its route plans).
      const m = best(() => perf({ park: 'sf', ticks: 9600, quiet: true, mode: 'muni j' })), e = best(() => perf({ park: 'sf', ticks: 9600, quiet: true, mode: 'escape' }))
      // Driving the crew van through the traffic and the pedestrians (game/vehicles.ts).
      const v = best(() => perf({ park: 'sf', ticks: 9600, quiet: true, van: true }))
      return { ok: [r, c, d, m, e, v].every((x) => x.p99 < 0.5), detail: `soma p50 ${r.p50.toFixed(3)} p99 ${r.p99.toFixed(3)} ms, sf with traffic and pedestrians p50 ${c.p50.toFixed(3)} p99 ${c.p99.toFixed(3)} ms, two players p50 ${d.p50.toFixed(3)} p99 ${d.p99.toFixed(3)}, Muni Race p50 ${m.p50.toFixed(3)} p99 ${m.p99.toFixed(3)}, Robotaxi Escape p50 ${e.p50.toFixed(3)} p99 ${e.p99.toFixed(3)}, the crew van p50 ${v.p50.toFixed(3)} p99 ${v.p99.toFixed(3)} ms per tick (budget 0.5)` }
    })
    stepRun('race perf', () => {
      // Both hill bomb races with traffic, park NPCs, racers and pedestrians; each tick's best of three runs.
      const d = perf({ park: 'sf', ticks: 6000, quiet: true, race: '', repeats: 3 }) as { p50: number; p99: number }
      const t = perf({ park: 'sf', ticks: 6000, quiet: true, race: 'twinpeaks', repeats: 3 }) as { p50: number; p99: number }
      return { ok: d.p99 < RACE_BUDGET && t.p99 < RACE_BUDGET, detail: `dolores p50 ${d.p50.toFixed(3)} p99 ${d.p99.toFixed(3)} ms, twinpeaks p50 ${t.p50.toFixed(3)} p99 ${t.p99.toFixed(3)} ms per tick (budget ${RACE_BUDGET}, best of 3)` }
    })
  }
  return ok
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2)
  const a = parseArgs(rest)
  switch (cmd) {
    case 'check': {
      const t0 = performance.now()
      const ok = await check(!!a.full, await import('./lines.ts'), Math.max(1, num(a.jobs, defaultJobs())))
      if (a.full && !a['no-browser']) {
        const { browserChecks } = await import('./browser.ts')
        if (!(await browserChecks())) process.exitCode = 1
      }
      console.log(`${ok && !process.exitCode ? 'CHECK OK' : 'CHECK FAILED'}  ${((performance.now() - t0) / 1000).toFixed(1)}s`)
      if (!ok) process.exitCode = 1
      break
    }
    case 'run': { const r = runScenarios(a._, !!a.v || !!a.verbose); if (r.failed) process.exitCode = 1; if (r.total > 1) console.log(`${r.total - r.failed}/${r.total} pass`); break }
    case 'trace': trace(a._[0], a); break
    case 'replay': if (!replayCmd(a._[0], a)) process.exitCode = 1; break
    case 'snap': snap(a._[0], a); break
    case 'shot': { const { shotCmd } = await import('./browser.ts'); await shotCmd(a._[0], a); break }
    case 'clip': { const { clipCmd } = await import('./clip.ts'); await clipCmd(a._[0], a); break }
    case 'build': { const { buildCmd } = await import('./build.ts'); await buildCmd(a); break }
    case 'photos': { const { photosCmd } = await import('../../tools/photos.ts'); await photosCmd(a); break }
    case 'serve': { const { serveCmd } = await import('./serve.ts'); await serveCmd(a); break }
    case 'monkey': {
      const { withPages, monkey } = await import('./browser.ts')
      const r = await withPages((open) => monkey(open, { seconds: num(a.seconds, 60), park: str(a.park, 'sf'), seed: num(a.seed, 7) }), { width: 1280, height: 720 }, { gpu: !a.soft })
      console.log(`${r.errors.length ? 'FAIL' : 'ok'}  ${r.presses} presses${r.errors.length ? '\n  ' + r.errors.join('\n  ') : ', no errors'}`)
      if (r.errors.length) process.exitCode = 1
      break
    }
    case 'playtest': {
      const { withPages } = await import('./browser.ts'), { playtest } = await import('./playtest.ts')
      const r = await withPages((open) => playtest(open, { park: str(a.park, 'soma') }), { width: 1280, height: 720 }, { gpu: !a.soft })
      for (const s of r.steps) console.log(`  ok  ${s}`)
      console.log(`${r.errors.length ? 'FAIL' : 'ok'}  ${r.steps.length} steps of the first hour${r.errors.length ? '\n  ' + r.errors.join('\n  ') : ', nothing stuck'}`)
      if (r.errors.length) process.exitCode = 1
      break
    }
    case 'strip': { const { stripCmd } = await import('./strip.ts'); await stripCmd(a._[0], a); break }
    case 'diff': { const { diffCmd } = await import('./browser.ts'); await diffCmd(a._[0], a._[1], str(a.o)); break }
    case 'fuzz': {
      const r = fuzz({ park: str(a.park, 'soma'), ticks: num(a.ticks, 100000), seed: num(a.seed, 1), spots: a.city ? citySpots() : undefined })
      console.log(`fuzz ${r.park}: ${r.ticks} ticks over ${r.spots} spots, seed ${r.seed}, ${r.violations.length} violations`)
      for (const v of r.violations) console.log(`  ${v}`)
      if (r.violations.length) process.exitCode = 1
      break
    }
    case 'farm': {
      const park = str(a.park, 'soma'), ticks = Math.round(num(a.seconds, 10) * 120), top = num(a.top, 10)
      const hits = farmSearch({ park, trials: num(a.trials, 300), seed: num(a.seed, 1), ticks })
      console.log(`farm ${park}: ${hits.length} patterns of ${ticks / 120} s, the best combos:`)
      hits.slice(0, top).forEach((h, i) => {
        const keys = h.keys.map((k) => `${k.name} ${k.on}/${k.period}@${k.phase}`).join(', ')
        console.log(`  #${i + 1} ${h.best} x${h.multiplier}${h.open ? ' open' : ''}, banked ${h.banked} | ${h.spot} at ${h.speed} m/s; ${keys} | ${h.name.slice(0, 120)}`)
        if (a.scenarios) console.log(`     -> ${farmScenario(park, i + 1, h, ticks)}`)
      })
      break
    }
    case 'cityfuzz': {
      const near = typeof a.near === 'string' ? a.near.split(',').map(Number) as [number, number, number] : undefined
      const r = cityFuzz({ segments: num(a.segments, 400), segmentTicks: Math.round(num(a.seconds, 10) * 120), seed: num(a.seed, 1), near })
      const kinds = new Map<string, number>()
      for (const f of r.findings) kinds.set(f.kind, (kinds.get(f.kind) ?? 0) + 1)
      const fresh = r.findings.filter((f) => !f.known)
      console.log(`cityfuzz: ${r.segments} segments over ${r.cells} areas (${r.points} start points), ${r.ticks} ticks, ${r.findings.length} findings${kinds.size ? ': ' + [...kinds].map(([k, n]) => `${n} ${k}`).join(', ') : ''} (${fresh.length} new, the rest already reported)`)
      if (fresh.length) process.exitCode = 1
      break
    }
    case 'feel': feel({ section: typeof a.section === 'string' ? a.section : undefined, trials: num(a.trials, a.tour ? 50 : 24), tour: !!a.tour, level: typeof a.level === 'string' ? a.level : undefined }); break
    case 'perf': perf({ park: str(a.park, 'soma'), ticks: num(a.ticks, a.race === undefined ? 36000 : 12000), profile: !!a.profile, race: a.race === undefined ? undefined : a.race === true ? '' : String(a.race) === 'dolores' ? '' : String(a.race), repeats: num(a.repeats, 3), peds: !a['no-peds'], two: !!a.two, mode: typeof a.mode === 'string' ? a.mode : undefined, van: !!a.van }); break
    case 'send': { const { send } = await import('./bridge.ts'); await send(a._.join(' ')); break }
    case 'watch': { const { watch } = await import('./bridge.ts'); await watch(num(a.seconds, 10)); break }
    case 'lines': {
      const { rideLines } = await import('./lines.ts')
      const res = rideLines({ park: str(a.park, 'soma'), only: a._, speed: num(a.speed, 5), save: !!a.save })
      for (const r of res) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.id.padEnd(42)} ${r.seconds.toFixed(1).padStart(5)} s  max ${r.maxSpeed.toFixed(1)} m/s  ${r.reached}/${r.of}${r.reason ? '  ' + r.reason : ''}`)
      console.log(`${res.filter((r) => r.pass).length}/${res.length} lines ridden (failures saved to out/lines/<id>.replay.json)`)
      break
    }
    case 'inbox': inbox(); break
    case 'promote': promote(a._[0], a._[1]); break
    case 'park': {
      // From the world generator's checkout (SOMA_SKATEPARK_DIR, default ~/soma-skatepark; src/harness/paths.ts).
      const { requireParkRepo } = await import('./paths.ts')
      const p = spawnSync('uv', ['run', '--with', 'numpy', '--with', 'pillow', 'python', 'scripts/export_game_park.py', '--out', rel('assets/park')], { cwd: requireParkRepo('./skate park'), encoding: 'utf8' })
      const before = existsSync(rel('assets/park/.last-export.json')) ? readJson<Record<string, number>>(rel('assets/park/.last-export.json')) : null
      console.log((p.stdout + p.stderr).trim().split('\n').slice(-3).join('\n'))
      const m = readJson<{ hash: string; triangleCount: number; rails: unknown[]; spots: unknown[]; elements: unknown[] }>(rel('assets/park/soma.park.json'))
      const now = { triangles: m.triangleCount, rails: m.rails.length, spots: m.spots.length, elements: m.elements.length }
      if (before) console.log('change: ' + Object.entries(now).map(([k, v]) => `${k} ${before[k]} -> ${v}`).join(', '))
      writeJson(rel('assets/park/.last-export.json'), now)
      // The pre-built BVH for the park, and for the city world built on it.
      if (p.status === 0) for (const w of bvhWorlds()) console.log(writeBvh(w))
      break
    }
    case 'city': {
      // The city around the park (world sf): the squeezed city (docs/squeeze.md), made by the world generator from its open
      // data in city/raw (city/fetch.py): city/squeeze.py warps the data by the tile table, then city/build.py builds on it.
      const { requireParkRepo } = await import('./paths.ts')
      const repo = requireParkRepo('./skate city')
      const uv = ['run', '-q', '--no-project', '--with', 'numpy', '--with', 'shapely', '--with', 'scipy', '--with', 'pillow', 'python']
      const work = rel('out/city-squeeze')
      const steps: string[][] = [
        ['city/squeeze.py', '--game', rel(), '--out-raw', `${work}/raw`, '--out-config', `${work}/config.json`],
        ['city/build.py', '--raw', `${work}/raw`, '--config', `${work}/config.json`, '--out', rel('assets/park')],
      ]
      let ok = true
      for (const step of steps) {
        const p = spawnSync('uv', [...uv, ...step], { cwd: repo, encoding: 'utf8' })
        const out = (p.stdout + p.stderr).trim().split('\n')
        // A step that worked: its summary lines (the warp's config line, the build's wrote line with the city's hash); one that failed: its last lines.
        console.log((p.status === 0 ? out.filter((l) => /\b(config|wrote)\b/.test(l)).slice(-1) : out.slice(-6)).join('\n'))
        if (p.status !== 0) { ok = false; break }
      }
      if (!ok) process.exitCode = 1
      else for (const w of bvhWorlds().filter((n) => WORLDS[n])) console.log(writeBvh(w))   // the city world's pre-built BVH
      break
    }
    case 'world': {
      const { worldPack, worldFetch } = await import('./world.ts')
      const repo = typeof a.repo === 'string' ? a.repo : undefined
      if (a._[0] === 'pack') worldPack(!!a.release, repo)
      else if (a._[0] === 'fetch') worldFetch({ repo, file: typeof a.file === 'string' ? a.file : undefined, gh: !!a.gh, force: !!a.force })
      else throw new Error('world: pack [--release] [--repo owner/name] | fetch [--file bundle.tar.gz] [--gh] [--repo owner/name] [--force]')
      break
    }
    case 'bvh': {
      // The pre-built BVH beside a world's files (park and city do this themselves): after a data change to the surface classes.
      for (const w of a._.length ? a._ : bvhWorlds()) console.log(writeBvh(w))
      break
    }
    case 'probe': {
      // probe x,y [x,y ...]: every surface straight down at each point (top first), with element and class
      const data = loadData(); const park = loadPark(str(a.park, 'soma'), data)
      const { raycast, surfaceName } = await import('../sim/park/park.ts')
      for (const xy of a._) {
        const [x, y] = xy.split(',').map(Number)
        const hits: string[] = []
        let z = Math.max(40, park.boundsMax.z + 1)
        for (let i = 0; i < 6; i++) {
          const h = raycast(park, { x, y, z }, { x: 0, y: 0, z: -1 }, z - park.boundsMin.z + 1)
          if (!h) break
          const e = park.elements[park.elem[h.tri]]
          hits.push(`${h.point.z.toFixed(3)} ${e.id}${e.name ? ` "${e.name.slice(0, 40)}"` : ''} [${surfaceName(park.cls[h.tri])}, slope ${(Math.acos(Math.abs(h.normal.z)) * 180 / Math.PI).toFixed(0)}deg]`)
          z = h.point.z - 0.002
        }
        console.log(`${x},${y}: ${hits.join('  |  ') || 'nothing'}`)
      }
      break
    }
    case 'spots': {
      const data = loadData(); const park = loadPark(str(a._[0], 'soma'), data)
      for (const al of data.spots.aliases) console.log(`${al.id.padEnd(16)} -> ${al.spot}  (${al.label})`)
      for (const s of park.spots) console.log(`${s.id.padEnd(40)} ${s.pos.x.toFixed(1)} ${s.pos.y.toFixed(1)} ${s.pos.z.toFixed(2)}  heading ${Math.round((s.heading * 180) / Math.PI)}`)
      break
    }
    default:
      console.log(`skate <command>
  check [--full] [--jobs n]      typecheck, sim lint, unit tests, scenarios with the street routes (in n workers; --full: replays, fuzz, perf, browser checks)
  run [scenario...|all] [-v]     run scenarios headless
  trace <scenario|replay.json>   table of numbers per tick [--fields a,b --every n --from t --to t]
  replay <file> [--current] [--rebaseline]   verify a replay's hash chain
  snap <scenario|replay> --at t  cut a snapshot [-o file]
  shot <target> [--layers --cam --crop --size -o --orbit az,el,dist[,lookUp]]   headless render (target: snap.json | replay.json@t | scenario@t)
  strip <scenario> --ticks a:b:n [--cam side --label t -o]   contact sheet of N cropped frames (out/strips/)
  strip --sheet <file.strips> [-o]   several labelled strips in one sheet (lines: label | scenario | a:b:n | cam)
  clip <replay.json|scenario> [--from s --to s --fps 30 --size WxH --style --cam --orbit az,el,dist[,lookUp] --char --music punk|lofi|hyphy --intro --results s --school --split npc --slowmo off|big|every --no-trickcams --campath path.json --soft -o out.mp4]   the run as a video with its sound (out/clips/); --campath: a keyframed camera for the whole clip (JSON keys { t, pos, look, fov? })
  monkey [--seconds 60 --park sf --seed 7 --soft]   random keys in the real client; fails on page or console errors
  playtest [--park soma|sf --soft]   the first hour in the real client: intro, skip, accept, abandon, talk, Not now, Skip, map, waypoint, Muni, journal; fails where it gets stuck
  photos [id,id...] [--out dir --sheet [file.png] --data file]   the loading and menu photographs from the game itself (data/photos.json; assets/ui/photo/, sheet default out/photos/sheet.png)
  build [--out dist]   the game as a static site (gzipped binaries, build.json, a service worker for offline play; docs/deploy.md)
  serve [dir] [--port 5480]   serve a built site as a plain static host would (no compression), to try it locally
  diff <a.png> <b.png> [-o diff.png]   odiff similarity
  fuzz [--park soma --ticks n --seed s --city]   random-input bots, invariant report (--city: from the city spots of sf)
  farm [--park soma --trials 300 --seconds 10 --seed s --top 10 --scenarios]   farm search: random button patterns at every spot, the best combos with their pattern (a combo far above a line on that spot is a farm; --scenarios writes each to out/farm/)
  cityfuzz [--segments 400 --seconds 10 --seed s --near x,y,r]   random-input bots dropped all over the city's ground, area by area: through the ground, catch floor, stuck, wedged, grinds through walls (a scenario per finding in out/cityfuzz/)
  feel [--section ollie|capture|balance|landing|spin|special|vert|drive|flow] [--trials 24]  the feel audit's numbers (docs/feel-audit.md; vert: every quarter's lip; drive: each vehicle type; flow: revert and manual windows, getting up, turning, curbs)
  feel --tour [--trials 50] [--level id]  every Tour goal played by a decent and a casual human (docs/feel-audit.md section 8)
  perf [--park --ticks --profile --two --mode --van]  ms per tick, top functions as text (--two: with player 2 in, on its own keys; --mode 'muni j' | escape: that game on; --van: driving the crew van)
  perf --race [dolores|twinpeaks] [--repeats 3]  a hill bomb race with traffic, NPCs, racers and pedestrians; each tick's best run (--no-peds: without them)
  send "<commands>"              send commands to the running dev game
  watch [--seconds n]            stream state from the running dev game
  lines [id...] [--speed 5 --park sf|lab --save]   autopilot rides the rider lines (park; the city's in sf; the hill bomb in lab; --save keeps every replay in out/lines/)
  inbox | promote <clip> [name]  F8 clips from play sessions
  park                           re-export the park from the world generator (SOMA_SKATEPARK_DIR, default ~/soma-skatepark)
  city                           regenerate the squeezed city around the park (world sf) with the world generator (SOMA_SKATEPARK_DIR): city/squeeze.py, then city/build.py on its output
  bvh [world...]                 rewrite the pre-built BVH files (park and city do it; needed after a change to physics surfaces)
  world fetch | pack [--release] the derived city + paint as one bundle: fetch it from the GitHub release named in assets/park/world.json (a fresh clone needs this; --file bundle.tar.gz unpacks a local copy, --gh uses the gh CLI), or pack it (and upload it)
  spots [park]                   list spawn spots
  probe x,y [x,y ...] [--park]   surfaces straight down at points (z, element, class, slope)
  shot view:x,y,z@lx,ly,lz       any camera [--park sf --fov 50 --fog off --far 3000]; shot photo:IMG_2932|all (photo vs model sheets); shot pin:N[,M] [--top]`)
  }
}

process.stdout.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(0) })
main().catch((e) => { console.error(String(e?.message ?? e)); process.exitCode = 1 })
