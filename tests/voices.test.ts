import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { readSeconds, VoiceLines, type VoicesData } from '../src/client/voicelines.ts'
import type { SimEvent } from '../src/sim/sim.ts'

// data/voices.json: every rule says lines that exist, every line has its voice and its mp3, and
// the rules match the events the sim sends (the Muni stop names and delay reasons are data too).
const d = JSON.parse(readFileSync(new URL('../data/voices.json', import.meta.url), 'utf8')) as VoicesData
const run = JSON.parse(readFileSync(new URL('../data/run.json', import.meta.url), 'utf8'))

describe('voice lines', () => {
  it('rules name real lines; lines name real voices and have their audio', () => {
    for (const ids of Object.values(d.on)) for (const id of ids) expect(d.lines[id], id).toBeTruthy()
    for (const [id, l] of Object.entries(d.lines)) {
      expect(d.voices[l.voice], id).toBeTruthy()
      expect(existsSync(new URL(`../assets/sound/voice/${id}.mp3`, import.meta.url)), id).toBe(true)
    }
  })

  it('every Muni stop after the first and every delay reason has a line', () => {
    const v = VoiceLines.rulesOnly(d)
    const say = (e: object) => v.lineFor({ tick: 0, ...e } as SimEvent)
    for (const line of run.muni.lines) {
      expect(say({ t: 'muniStart', line: line.id }), line.id).toBeTruthy()
      for (const s of line.stops.slice(1)) expect(say({ t: 'muniStop', name: s.name, you: false }), s.name).toBeTruthy()
    }
    for (const says of run.muni.delay.says) expect(say({ t: 'muniDelay', says }), says).toBeTruthy()
    expect(say({ t: 'muniStop', name: run.muni.lines[0].stops[1].name, you: true })).toBeNull()
    expect(say({ t: 'escapeOver', survived: false })).toBe('taxi-caught')
  })

  it('every shout at a driven vehicle has a voiced line (data/vehicles.json reactions; physics phase 31)', () => {
    const rx = JSON.parse(readFileSync(new URL('../data/vehicles.json', import.meta.url), 'utf8')).reactions as { pedShouts: string[]; npcShouts: string[] }
    const v = VoiceLines.rulesOnly(d)
    for (const line of rx.pedShouts) expect(v.lineFor({ t: 'pedShout', tick: 0, id: 1, car: 2, line, near: true } as SimEvent), line).toBeTruthy()
    for (const line of rx.npcShouts) expect(v.lineFor({ t: 'npcShout', tick: 0, id: 1, car: 2, line } as SimEvent), line).toBeTruthy()
  })

  it('a line said by id with no mp3 yet is captioned alone, booked in its voice, for as long as reading it takes', () => {
    const v = VoiceLines.rulesOnly(structuredClone(d))
    const text = 'One two three four five six seven eight nine ten.'
    v.addLines({ 'test-unvoiced': { voice: 'karl', text } })
    const said: [string, string, number, number, boolean | undefined][] = []
    v.onSay = (who, words, delay, seconds, unvoiced) => said.push([who, words, delay, seconds, unvoiced])
    v.caption('test-unvoiced', 10)
    expect(said).toEqual([[d.voices.karl.name ?? 'karl', text, 0, 10 / d.read!.wordsPerSecond, true]])   // unvoiced: shown with captions off too
    v.caption('test-unvoiced', 11)   // the same voice still has seconds to go (more than wait): dropped, as a spoken line would be
    expect(said).toHaveLength(1)
    v.caption('nope', 30)
    expect(said).toHaveLength(1)
    expect(readSeconds('Go.', d.read!)).toBe(d.read!.min)
  })

  it('timing: a cooldown keeps a line from repeating, and a busy voice drops what would wait too long', () => {
    const v = VoiceLines.rulesOnly(d)
    const at = (e: object, t: number) => v.captionFor({ tick: Math.round(t * 120), ...e } as SimEvent, t)?.at ?? null
    expect(at({ t: 'robotaxiStop' }, 0)).toBe(0)
    expect(at({ t: 'robotaxiStop' }, 10)).toBeNull()
    expect(at({ t: 'robotaxiStop' }, 40)).toBe(40)
    v.reset()
    const start = v.captionFor({ t: 'escapeStart', tick: 0 } as SimEvent, 0)!
    expect(at({ t: 'escapeRecalc' }, 1)).toBeNull()   // the start line still has seconds to go
    expect(at({ t: 'escapeRecalc' }, start.seconds - 1)).toBeCloseTo(start.seconds)   // waits for it to finish
  })
})
