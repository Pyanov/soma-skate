import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { basename } from 'node:path'
import { isMainThread, parentPort, Worker } from 'node:worker_threads'
import { loadData } from './io.ts'
import { loadScenario, readPath, runScenario, type ScenarioResult } from './scenario.ts'

// Scenarios run by a pool of worker threads (`skate check`): each worker loads the data and the parks once and takes
// the next scenario from a shared queue, the longest first, so the long city routes (scenarios/squeeze-routes) do
// not end the step alone. Results come back in file order. A worker that dies, or a scenario that throws, is a
// failure, and so is any scenario without a result.

/** A scenario's result as the lines `skate run` prints (all expectations when verbose, else only the failing ones). */
export function resultLines(r: ScenarioResult, verbose: boolean): { ok: boolean; lines: string[] } {
  const ok = r.expects.every((e) => e.pass) && r.invariants.length === 0
  const last = r.rows[r.rows.length - 1].thing
  const lines = [`${ok ? 'PASS' : 'FAIL'}  ${r.name}  park ${r.park}  ${r.ticks} ticks (${(r.ticks / 120).toFixed(2)} s)  end ${last.state} at ${last.pos.x.toFixed(2)} ${last.pos.y.toFixed(2)} ${last.pos.z.toFixed(2)}  speed ${Number(readPath(last, 'speed')).toFixed(2)}`]
  if (verbose) for (const e of r.events) lines.push(`  t=${e.rel}  ${e.t}  ${Object.entries(e).filter(([k]) => !['t', 'tick', 'rel'].includes(k)).map(([k, v]) => `${k} ${v}`).join('  ')}`)
  for (const e of r.expects) if (verbose || !e.pass) lines.push(`  ${e.pass ? 'ok  ' : 'FAIL'}  ${e.text}  (got ${e.detail})`)
  for (const v of r.invariants) lines.push(`  INVARIANT  ${v}`)
  return { ok, lines }
}

type Done = { file: string; ok: boolean; lines: string[] }

/** The default pool size: most of the machine, at most 8 (each worker holds the city, about 0.6 GB). */
export const defaultJobs = () => Math.max(1, Math.min(8, availableParallelism() - 2))

/** Runs every file in `jobs` workers; the results in the order of `files`. */
export async function runPool(files: string[], jobs = defaultJobs()): Promise<Done[]> {
  // longest first: the scenario's run ticks, a city tick counting three of the lab's or the park's
  const cost = (f: string) => { const t = existsSync(f) ? readFileSync(f, 'utf8') : ''; return Number(/^run (\d+)/m.exec(t)?.[1] ?? 0) * (/^park sf\b/m.test(t) ? 3 : 1) }
  const queue = files.map((f) => [f, cost(f)] as const).sort((a, b) => b[1] - a[1]).map(([f]) => f)
  const done = new Map<string, Done>()
  await Promise.all(Array.from({ length: Math.max(1, Math.min(jobs, files.length)) }, () => new Promise<void>((resolve, reject) => {
    const w = new Worker(new URL(import.meta.url))
    let current: string | undefined
    const next = () => { current = queue.shift(); if (current === undefined) { void w.terminate(); resolve() } else w.postMessage(current) }
    w.on('message', (m: Done) => { done.set(m.file, m); next() })
    w.on('error', (e: Error) => reject(new Error(`scenario worker died${current ? ` on ${basename(current)}` : ''}: ${e.stack ?? e}`)))
    w.on('exit', (code) => { if (current !== undefined) reject(new Error(`scenario worker exited (${code}) on ${basename(current)}`)) })
    next()
  })))
  const missing = files.filter((f) => !done.has(f))
  if (missing.length) throw new Error(`no result for ${missing.length} scenarios: ${missing.map((f) => basename(f)).join(', ')}`)
  return files.map((f) => done.get(f)!)
}

if (!isMainThread && parentPort) {
  const port = parentPort, data = loadData()
  port.on('message', (file: string) => {
    let out: Done
    try { out = { file, ...resultLines(runScenario(loadScenario(file), data), false) } }
    catch (e) { out = { file, ok: false, lines: [`FAIL  ${basename(file, '.skate')}  threw: ${String((e as Error).stack ?? e)}`] } }
    port.postMessage(out)
  })
}
