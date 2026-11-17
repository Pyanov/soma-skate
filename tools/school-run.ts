// node tools/school-run.ts: builds scenarios/school-run.skate: each lesson's keys from its start, placed after the last lesson's done
// line (School's doneSeconds) so the clip's School sees every lesson in order. Prints the done ticks.
import { readFileSync, writeFileSync } from 'node:fs'
import { loadData, rel } from '../src/harness/io.ts'
import { parseScenario, runScenario } from '../src/harness/scenario.ts'
import { School, type SchoolData } from '../src/client/school.ts'
const data = loadData()
const S = JSON.parse(readFileSync(rel('data/school.json'), 'utf8')) as SchoolData
const gap = Math.ceil(S.doneSeconds * data.physics.tickHz) + 2
// Each lesson's keys from its teleport (tick 0); the gust is a push at 30 and the speed the tick after (as the game queues it).
const seg: Record<string, string[]> = {
  push: ['hold up 0..160', 'hold left 110..330'],
  ollie: ['hold up 0..60', 'hold ollie 70..108'],
  flip: ['hold up 0..60', 'hold ollie 70..90', 'tap flip+left 93'],
  grab: ['hold up 0..100', 'hold ollie 166..196', 'hold grab+right 204..206', 'hold grab 206..285'],
  grind: ['hold up 0..116', 'hold ollie 120..132', 'tap grind 142'],
  manual: ['hold up 0..140', 'tap up 160', 'tap down 164'],
  combo: ['hold up 0..116', 'hold ollie 120..132', 'tap grind 142', 'tap up 251', 'tap down 255', 'hold ollie 290..304', 'hold slide 412..560'],
  revert: ['hold up 30..34', 'cmd 31 speed 9.5', 'hold grab+right 158..159', 'hold grab 159..210', 'tap revert 300'],
  special: ['hold up 0..48', 'hold ollie 50..64', 'tap flip+left 66', 'hold up 160..205', 'hold ollie 205..235', 'tap right 238', 'tap down 241', 'tap flip 243'],
  powerslide: ['hold up 0..150', 'hold slide 160..330'],
  walk: ['tap walk 30', 'hold up 50..250'],
}
const shift = (line: string, at: number) => line.replace(/^(hold|tap) (\S+) (\d+)(?:\.\.(\d+))?$/, (_m, k, b, f, t) => `${k} ${b} ${Number(f) + at}${t ? `..${Number(t) + at}` : ''}`).replace(/^cmd (\d+) /, (_m, t) => `cmd ${Number(t) + at} `)
const lines: string[] = []
const done: number[] = []
let at = 0
const run = (ticks: number) => {
  const sc = parseScenario(`park soma\nbot balance\nrun ${ticks}\n${lines.join('\n')}`, 'school-run')
  const res = runScenario(sc, data)
  const school = new School(S, data)
  school.start()
  const by = new Map<number, typeof res.events>()
  for (const e of res.events) { const a = by.get(e.rel) ?? []; a.push(e); by.set(e.rel, a) }
  const marks: { kind: string; t: number; i: number }[] = []
  for (let t = 0; t < res.ticks; t++) for (const s of school.tick(by.get(t + 1) ?? [], res.rows[t + 1].thing)) marks.push({ kind: s.kind, t: t + 1, i: school.i })
  return { res, marks }
}
for (const [i, L] of S.lessons.entries()) {
  lines.push(`# ${i + 1}. ${L.title}`)
  for (const c of [`cmd ${at} teleport ${L.spot}`, ...(L.setup ?? []).map((x) => `cmd ${at} ${x}`)]) lines.push(c)
  for (const l of seg[L.id]) lines.push(shift(l, at))
  const { marks, res } = run(at + 700)
  const d = marks.find((m) => m.kind === 'done' && m.i === i)
  const bad = marks.filter((m) => m.kind === 'hint' || m.kind === 'redo')
  if (!d) { console.log(`${L.id}: NOT DONE from ${at}`, marks, res.events.filter((e) => e.rel > at && !/^npc|^ped|^car/.test(e.t)).map((e) => `${e.rel}:${e.t}`).join(' ')); process.exit(1) }
  console.log(`${i + 1}. ${L.id}: start ${at}, done ${d.t} (+${d.t - at})${bad.length ? ` [${bad.map((b) => `${b.kind}@${b.t}`).join(' ')}]` : ''}`)
  done.push(d.t)
  at = d.t + gap
}
const end = at + Math.round(3.2 * data.physics.tickHz)
const { res, marks } = run(end)
const grad = marks.find((m) => m.kind === 'graduated')
console.log(`graduated at ${grad?.t}, run ${end}, bails ${res.events.filter((e) => e.t === 'bail').length}`)
const head = [
  '# Skate School with Karl the Fog (data/school.json, src/client/school.ts): a scripted run through every',
  '# lesson in order, for the clip (skate clip school-run --school) and tests/school.test.ts. Each lesson starts',
  "# with its own teleport (and setup) once Karl's done line for the last one has shown (doneSeconds); the",
  "# revert's push and the speed the tick after it are Karl's gust (boost). Built by tools/school-run.ts (node tools/school-run.ts).",
  'park soma',
  'bot balance',
  `run ${end}`,
]
const ex = [
  ...done.map((t, i) => `# ${S.lessons[i].id} done at ${t}`),
  'expect no event bail',
  'expect event comboLanded{name=FS 50-50 + Manual} within ' + `${done[6] - 1}..${done[6] + 1}`,
  'expect event revert within ' + `${done[7] - 1}..${done[7] + 1}`,
]
writeFileSync(rel('scenarios/school-run.skate'), [...head, ...lines, ...ex, ''].join('\n'))
console.log('wrote scenarios/school-run.skate')
