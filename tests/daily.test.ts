import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dailySchema, pickFor, sfDay } from '../src/client/daily.ts'

// Today's challenge: picked from the San Francisco date, stable, and every one valid.
const data = dailySchema.parse(JSON.parse(readFileSync(new URL('../data/daily.json', import.meta.url), 'utf8')))

describe('daily challenge', () => {
  it('uses the San Francisco date', () => {
    expect(sfDay(new Date('2026-10-18T06:30:00Z'))).toBe('2026-10-17')   // 11:30 pm in SF
    expect(sfDay(new Date('2026-10-18T08:30:00Z'))).toBe('2026-10-18')
  })
  it('is stable per day and spreads over the list', () => {
    expect(pickFor('2026-10-17', data.challenges.length)).toBe(pickFor('2026-10-17', data.challenges.length))
    const seen = new Set<number>()
    for (let d = 1; d <= 60; d++) seen.add(pickFor(`2026-11-${String(((d - 1) % 30) + 1).padStart(2, '0')}`, data.challenges.length))
    expect(seen.size).toBeGreaterThan(data.challenges.length / 2)
  })
})

describe('daily progress and streak', () => {
  it('counts matching events, finishes once, and keeps a streak over consecutive days', async () => {
    const store = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } } as Storage
    const { Daily } = await import('../src/client/daily.ts')
    const one = { _doc: '', challenges: [{ id: 'g', text: 'Hit 2 gaps', rule: { on: 'gap' }, count: 2 }] }
    const done: number[] = []
    const d1 = new Daily(one, new Date('2026-10-17T20:00:00Z')); d1.onDone = (_c, s) => done.push(s)
    d1.event({ t: 'gap' } as never); expect(d1.done).toBe(false)
    d1.event({ t: 'land' } as never); expect(d1.progress).toBe(1)
    d1.event({ t: 'gap' } as never); d1.event({ t: 'gap' } as never)
    expect(d1.done).toBe(true); expect(done).toEqual([1])
    const d2 = new Daily(one, new Date('2026-10-18T20:00:00Z')); d2.onDone = (_c, s) => done.push(s)
    expect(d2.progress).toBe(0); expect(d2.streak).toBe(1)
    d2.event({ t: 'gap' } as never); d2.event({ t: 'gap' } as never)
    expect(done).toEqual([1, 2])
    const d4 = new Daily(one, new Date('2026-10-20T20:00:00Z'))   // a day skipped
    expect(d4.streak).toBe(0)
  })
})
