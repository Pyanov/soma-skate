import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { matches, stickersSchema } from '../src/client/stickers.ts'
import type { SimEvent } from '../src/sim/sim.ts'

// The Sticker Book's rules against real event shapes.
const data = stickersSchema.parse(JSON.parse(readFileSync(new URL('../data/stickers.json', import.meta.url), 'utf8')))
const rule = (id: string) => data.stickers.find((s) => s.id === id)!.rule
const ev = (o: Record<string, unknown>) => o as unknown as SimEvent

describe('stickers', () => {
  it('match on type, minimums, maximums and equal fields', () => {
    expect(matches(rule('combo-5k'), ev({ t: 'comboLanded', points: 5200 }))).toBe(true)
    expect(matches(rule('combo-5k'), ev({ t: 'comboLanded', points: 4999 }))).toBe(false)
    expect(matches(rule('beat-kevin'), ev({ t: 'bombFinish', route: 'dolores', place: 1, of: 4 }))).toBe(true)
    expect(matches(rule('beat-kevin'), ev({ t: 'bombFinish', route: 'dolores', place: 2, of: 4 }))).toBe(false)
    expect(matches(rule('beat-kevin'), ev({ t: 'bombFinish', route: 'twinpeaks', place: 1, of: 4 }))).toBe(false)
    expect(matches(rule('skate-kenji'), ev({ t: 'skateOver', winner: 'player', name: 'Kenji' }))).toBe(true)
    expect(matches(rule('skate-kenji'), ev({ t: 'skateOver', winner: 'local', name: 'Kenji' }))).toBe(false)
    expect(matches(rule('robotaxi'), ev({ t: 'carHit', robo: false }))).toBe(false)
  })
  it('every milestone has its words (the UI shows them as type: docs/art-direction.md)', () => {
    for (const s of data.stickers) { expect(s.name.length, s.id).toBeGreaterThan(0); expect(s.line.length, s.id).toBeGreaterThan(0) }
  })
})

describe('stickers: distinct counts', () => {
  it('counts different places once each', async () => {
    const store = new Map<string, string>()
    ;(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) } } as Storage
    const { StickerBook } = await import('../src/client/stickers.ts')
    const b = new StickerBook({ stickers: [{ id: 't', name: 'T', line: '', art: 'karl', rule: { on: 'placeVisit' }, count: 3, distinct: 'name' }] })
    const got: string[] = []; b.onEarn = (s) => got.push(s.id)
    for (const n of ['A', 'A', 'B', 'A', 'B']) b.event({ t: 'placeVisit', name: n } as never)
    expect(got).toEqual([])
    b.event({ t: 'placeVisit', name: 'C' } as never)
    expect(got).toEqual(['t'])
  })

  it('Every Tour goal means every goal: tour-complete counts all of data/tour.json', () => {
    const tour = JSON.parse(readFileSync(new URL('../data/tour.json', import.meta.url), 'utf8')) as { levels: { goals: unknown[] }[] }
    const all = tour.levels.reduce((n, L) => n + 4 + L.goals.length, 0)   // pro, sick, S-K-A-T-E, the tape and the level's own (career.ts goalIds)
    expect(data.stickers.find((s) => s.id === 'tour-complete')!.count).toBe(all)
  })
})
