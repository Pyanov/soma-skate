import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { CharactersData } from '../src/client/skater/characters.ts'
import { Unlocks, type CareerCounts } from '../src/client/unlocks.ts'
import { rel } from '../src/harness/io.ts'

// The secret skaters (data/characters.json unlock): the Robotaxi after 3 secret tapes or Unit 7's story,
// the Cable Car after 20 Tour goals or Sal's Turntable, the Sea Lion after Captain Barnacle's story
// (data/missions.json); the card comes once; a dev override locks or unlocks them for shots.

const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData
/** A career with these goals done per level. */
const career = (levels: Record<string, string[]>): CareerCounts => ({
  get total() { return Object.values(levels).reduce((n, g) => n + g.length, 0) },
  count: (goal: string) => Object.values(levels).filter((g) => g.includes(goal)).length,
})

describe('secret skaters', () => {
  it('are the Robotaxi, the Cable Car and the Sea Lion, lazy, with an unlock hint', () => {
    const secret = chars.characters.filter((c) => c.unlock)
    expect(secret.map((c) => c.id)).toEqual(['robotaxi', 'cablecar', 'sealion'])
    for (const c of secret) { expect(c.lazy).toBe(true); expect(c.unlock!.hint.length).toBeGreaterThan(5) }
  })

  it('the Robotaxi opens at 3 secret tapes, the Cable Car at 20 goals; nobody else is ever locked', () => {
    const levels: Record<string, string[]> = { soma: ['tape', 'pro'], mission: ['tape'] }
    const u = () => new Unlocks(chars.characters, career(levels))
    expect(u().locked('robotaxi')).toBe(true)
    expect(u().hint('robotaxi')).toBe('Find 3 secret tapes, or finish Unit 7 Learns to Ollie (2 / 3)')
    expect(u().locked('can')).toBe(false)
    levels.castro = ['tape']
    expect(u().locked('robotaxi')).toBe(false)
    expect(u().locked('cablecar')).toBe(true)
    levels.hills = Array.from({ length: 16 }, (_, i) => `g${i}`)
    expect(u().locked('cablecar')).toBe(false)
  })

  it('announces each unlock once (fresh), quietly at startup', () => {
    const levels: Record<string, string[]> = { soma: ['tape'], mission: ['tape'], castro: ['tape'] }
    const un = new Unlocks(chars.characters, career(levels))
    expect(un.fresh().map((c) => c.id)).toEqual(['robotaxi'])
    expect(un.fresh()).toEqual([])
    const quiet = new Unlocks(chars.characters, career(levels))
    expect(quiet.fresh(true)).toEqual([])
    expect(quiet.fresh()).toEqual([])
  })

  it('the Sea Lion opens with Captain Barnacle\'s story done (the story\'s save)', () => {
    const done = new Set<string>()
    const withStory: CareerCounts = { ...career({ embarcadero: ['pro', 'sick', 'skate', 'tape', 'a', 'b', 'c'] }), story: (id: string) => done.has(id) }
    expect(new Unlocks(chars.characters, withStory).locked('sealion')).toBe(true)
    expect(new Unlocks(chars.characters, withStory).hint('sealion')).toBe("Finish Captain Barnacle's story at Pier 39")
    done.add('chowder')
    expect(new Unlocks(chars.characters, withStory).locked('sealion')).toBe(true)
    done.add('barnacle')
    expect(new Unlocks(chars.characters, withStory).locked('sealion')).toBe(false)
    expect(new Unlocks(chars.characters, career({}), 'all').locked('sealion')).toBe(false)
  })

  it('the Robotaxi and the Cable Car open with their stories too (orStory), whatever the Tour', () => {
    const done = new Set<string>()
    const c: CareerCounts = { ...career({}), story: (id: string) => done.has(id) }
    expect(new Unlocks(chars.characters, c).locked('robotaxi')).toBe(true)
    expect(new Unlocks(chars.characters, c).locked('cablecar')).toBe(true)
    done.add('unit7')
    expect(new Unlocks(chars.characters, c).locked('robotaxi')).toBe(false)
    expect(new Unlocks(chars.characters, c).locked('cablecar')).toBe(true)
    done.add('turntable')
    expect(new Unlocks(chars.characters, c).locked('cablecar')).toBe(false)
    // The missions that give them say so (data/missions.json reward unlock), for the results card.
    const missions = JSON.parse(readFileSync(rel('data/missions.json'), 'utf8')).missions as { id: string; reward?: { unlock?: string } }[]
    for (const ch of chars.characters.filter((x) => x.unlock?.story || x.unlock?.orStory)) {
      const id = ch.unlock!.story ?? ch.unlock!.orStory
      expect(missions.find((m) => m.id === id)?.reward?.unlock, ch.id).toBe(ch.id)
    }
  })

  it('the dev override (?unlock=) shows them locked or unlocked whatever the career', () => {
    const none = career({})
    expect(new Unlocks(chars.characters, none, 'all').locked('cablecar')).toBe(false)
    expect(new Unlocks(chars.characters, career({ a: Array(30).fill('tape') }), 'none').locked('robotaxi')).toBe(true)
    const some = new Unlocks(chars.characters, none, 'cablecar')
    expect(some.locked('cablecar')).toBe(false)
    expect(some.locked('robotaxi')).toBe(true)
  })
})
