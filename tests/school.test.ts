import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { keyRows, School, type SchoolData, type SchoolSignal } from '../src/client/school.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, parseScenario, runScenario, type ScenarioResult } from '../src/harness/scenario.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { createSim } from '../src/sim/sim.ts'

// Skate School (school.ts, data/school.json): the lessons judged from the sim's events and the skater,
// as the game and the clips do it. The scripted run graduates in order; failed tries bring the hint
// and, where a lesson resets, its start again; skip, restart and the keys shown with the player's own.

const data = loadData()
const S = JSON.parse(readFileSync(rel('data/school.json'), 'utf8')) as SchoolData
const controls = JSON.parse(readFileSync(rel('data/controls.json'), 'utf8')) as { keyboard: Record<string, string[]>; gamepad: { buttons: Record<string, number[]> } }
const lessonAt = (id: string) => S.lessons.findIndex((l) => l.id === id)

/** Feed a scenario's ticks to a School started at a lesson; every signal with the tick it came on. */
function watch(res: ScenarioResult, at = 0) {
  const school = new School(S, data)
  const sig: (SchoolSignal & { at: number })[] = school.start(at).map((s) => ({ ...s, at: 0 }))
  const by = new Map<number, ScenarioResult['events']>()
  for (const e of res.events) by.set(e.rel, [...(by.get(e.rel) ?? []), e])
  for (let t = 0; t < res.ticks; t++) for (const s of school.tick(by.get(t + 1) ?? [], res.rows[t + 1].thing)) sig.push({ ...s, at: t + 1 })
  return { school, sig }
}
const snippet = (body: string, ticks: number) => runScenario(parseScenario(`park soma\nrun ${ticks}\n${body}`, 'school-snippet'), data)

describe('skate school', () => {
  it('the scripted run takes every lesson in order and graduates, no hints, no do-overs', { timeout: 120000 }, () => {
    const res = runScenario(loadScenario(rel('scenarios/school-run.skate')), data)
    const { school, sig } = watch(res)
    const starts = sig.filter((s) => s.kind === 'start').map((s) => (s.kind === 'start' ? s.lesson.id : ''))
    const dones = sig.filter((s) => s.kind === 'done').map((s) => (s.kind === 'done' ? s.lesson.id : ''))
    expect(starts).toEqual(S.lessons.map((l) => l.id))
    expect(dones).toEqual(S.lessons.map((l) => l.id))
    expect(sig.filter((s) => s.kind === 'hint' || s.kind === 'redo')).toEqual([])
    expect(sig.at(-1)?.kind).toBe('graduated')
    expect(school.finished).toBe(true)
    // Each lesson's own teleport comes after the School has moved on to it (the clip shows the right card).
    const tele = res.events.filter((e) => e.t === 'teleport').map((e) => e.rel)
    const startAt = sig.filter((s) => s.kind === 'start').map((s) => s.at)
    expect(tele.length).toBe(S.lessons.length)
    tele.forEach((t, i) => expect(t, S.lessons[i].id).toBeGreaterThan(startAt[i]))
    // The whole school in well under the 2 minutes the first-launch question promises.
    expect(res.ticks / data.physics.tickHz).toBeLessThan(60)
  })

  it('tiny ollies are failed tries: the hint after hintTries of them', () => {
    const res = snippet('cmd 0 teleport stevenson_clear_runway\nhold up 0..60\ntap ollie 80\ntap ollie 220\ntap ollie 360\ntap ollie 500', 640)
    const { sig, school } = watch(res, lessonAt('ollie'))
    expect(sig.some((s) => s.kind === 'done')).toBe(false)
    expect(school.tries).toBeGreaterThanOrEqual(S.hintTries)
    const hint = sig.find((s) => s.kind === 'hint')!
    expect(hint).toBeDefined()
    expect(hint.at).toBeLessThan(S.hintSeconds * data.physics.tickHz)   // from the tries, not the clock
    expect(sig.some((s) => s.kind === 'redo')).toBe(false)   // the flat lessons leave you where you are
  })

  it('the hint also comes with time, for a lesson not even tried', () => {
    const res = snippet('cmd 0 teleport manual_approach', Math.ceil(S.hintSeconds * data.physics.tickHz) + 5)
    const { sig } = watch(res, lessonAt('manual'))
    expect(sig.find((s) => s.kind === 'hint')?.at).toBe(Math.ceil(S.hintSeconds * data.physics.tickHz))
  })

  it('a lesson that resets puts you back at its start after a failed try, setup and all', () => {
    // Off Big 3 without a grab: the landing is a failed try; resetSeconds later the lesson starts over.
    const res = snippet('cmd 0 teleport big3\nhold up 0..100\nhold ollie 166..196', 700)
    const { sig } = watch(res, lessonAt('grab'))
    const land = res.events.find((e) => e.t === 'land' && e.rel > 300)!
    const redo = sig.find((s) => s.kind === 'redo')!
    expect(redo && redo.kind === 'redo' && redo.commands).toEqual(['teleport big3'])
    const judged = land.rel + Math.round(S.landGraceSeconds * data.physics.tickHz)
    expect(redo.at).toBe(judged + Math.round(S.resetSeconds * data.physics.tickHz))
    // The special lesson's redo fills the meter again (a bail empties it).
    const sp = new School(S, data); sp.start(lessonAt('special'))
    const r = sp.restart()[0]
    expect(r.kind === 'redo' && r.commands).toEqual(['teleport big3', 'set skater.special 0.97'])
  })

  it('a revert counts though the landing comes just before it', () => {
    const L = S.lessons[lessonAt('revert')]
    const res = snippet(`cmd 0 teleport ${L.spot}\nhold up 30..34\ncmd 31 speed ${L.boost}\nhold grab+right 158..159\nhold grab 159..210\ntap revert 300`, 340)
    const { sig, school } = watch(res, lessonAt('revert'))
    expect(sig.filter((s) => s.kind === 'done').length).toBe(1)
    expect(school.tries).toBe(0)
  })

  it('skip moves on, restart keeps the tries, and skipping the last lesson graduates', () => {
    const school = new School(S, data)
    school.start()
    for (let i = 1; i < S.lessons.length; i++) {
      const s = school.skip()
      expect(s[0].kind === 'start' && s[0].lesson.id).toBe(S.lessons[i].id)
    }
    school.tries = 2
    expect(school.restart()[0].kind).toBe('redo')
    expect(school.tries).toBe(2)
    expect(school.skip()).toEqual([{ kind: 'graduated' }])
    expect(school.active).toBe(false)
    expect(school.restart()).toEqual([])
  })

  it('every lesson starts somewhere real, in the park and in the city around it', () => {
    for (const park of S.parks) {
      const p = loadPark(park, data)
      for (const L of S.lessons) {
        const sim = createSim(p, data, {})
        for (const c of new School(S, data).commandsOf(L)) expect(() => applyCommand(sim, parseCommand(c)), `${park}: ${L.id}: ${c}`).not.toThrow()
      }
    }
  })

  it('the keys follow the player: rebinds on the keyboard, the pad by its buttons', () => {
    const flip = S.lessons[lessonAt('flip')]
    const html = keyRows(flip, (a) => controls.keyboard[a], (a) => controls.gamepad.buttons[a])
    expect(html).toContain('<kbd>J</kbd><i>+</i><kbd>A</kbd>')
    expect(html).toContain('□')
    const rebound = keyRows(flip, (a) => (a === 'flip' ? ['KeyF'] : controls.keyboard[a]), (a) => controls.gamepad.buttons[a])
    expect(rebound).toContain('<kbd>F</kbd><i>+</i><kbd>A</kbd>')
    for (const L of S.lessons) for (const r of L.keys) for (const a of r.do) if (a !== '+' && a !== 'then') expect(controls.keyboard[a], `${L.id}: ${a}`).toBeDefined()
  })

  it('graduating earns the Graduate sticker', () => {
    const st = JSON.parse(readFileSync(rel('data/stickers.json'), 'utf8')) as { stickers: { id: string; art: string; rule: { on: string } }[] }
    const g = st.stickers.find((s) => s.rule.on === S.graduate.event)
    expect(g?.art).toBe(S.graduate.sticker)
  })
})
