import type { CharacterSpec } from './skater/characters.ts'

// Secret skaters (data/characters.json unlock): locked until the Tour career has that many secret
// tapes (tapes, counted across levels) or goals (goals), or has finished a level (level: every goal
// of that Tour level; a level not in data/tour.json yet keeps it locked, its hint saying so), or the
// story's save has a mission done (story: its id; Captain Barnacle's story unlocks the Sea Lion), or by a story
// instead (orStory: Unit 7's story opens the Robotaxi, Sal's the Cable Car). Client only: the career is the browser's
// (src/client/career.ts, localStorage soma-skate:tour); which unlocks were already announced is
// kept beside it (soma-skate:unlocked), so the card slaps once. A dev override (?unlock=all, none
// or ids) shows them locked or unlocked for shots and tests.

const SEEN = 'soma-skate:unlocked'

/** What the unlocks read from the career (and the story's save: story(id), a mission done). */
export type CareerCounts = { total: number; count(goal: string): number; level?(id: string): { done: number; of: number } | null; story?(id: string): boolean }

export class Unlocks {
  private specs: CharacterSpec[]
  private career: CareerCounts
  private override: Set<string> | 'all' | 'none' | null
  private seen: Set<string>

  /** override: 'all', 'none', or ids (comma separated) to unlock; null or '' reads the career. */
  constructor(specs: CharacterSpec[], career: CareerCounts, override: string | null = null) {
    this.specs = specs
    this.career = career
    const o = (override ?? '').trim()
    this.override = !o ? null : o === 'all' ? 'all' : o === 'none' ? 'none' : new Set(o.split(',').map((x) => x.trim()))
    let seen: string[] = []
    try { seen = JSON.parse(localStorage.getItem(SEEN) ?? '[]') as string[] } catch { seen = [] }
    this.seen = new Set(seen)
  }

  /** The secret skaters (those with an unlock), in data order. */
  get secret(): CharacterSpec[] { return this.specs.filter((c) => c.unlock) }

  /** Is this character locked now? (Only secret skaters ever are.) */
  locked(id: string): boolean {
    const c = this.specs.find((x) => x.id === id)
    if (!c?.unlock) return false
    if (this.override === 'all') return false
    if (this.override === 'none') return true
    if (this.override) return !this.override.has(id)
    const U = c.unlock
    if (U.orStory !== undefined && this.career.story?.(U.orStory)) return false   // or that story done
    if (U.tapes !== undefined && this.career.count('tape') < U.tapes) return true
    if (U.goals !== undefined && this.career.total < U.goals) return true
    if (U.level !== undefined) { const L = this.career.level?.(U.level); if (!L || L.done < L.of) return true }
    if (U.story !== undefined && !this.career.story?.(U.story)) return true
    return false
  }

  /** The unlock hint ("Find 3 secret tapes") and how far along it is ("1 / 3"). */
  hint(id: string): string {
    const U = this.specs.find((x) => x.id === id)?.unlock
    if (!U) return ''
    if (U.story !== undefined) return U.hint
    if (U.level !== undefined) { const L = this.career.level?.(U.level); return L ? `${U.hint} (${Math.min(L.done, L.of)} / ${L.of} goals)` : `${U.hint} (not open yet)` }
    const have = U.tapes !== undefined ? this.career.count('tape') : this.career.total, need = U.tapes ?? U.goals ?? 0
    return `${U.hint} (${Math.min(have, need)} / ${need})`
  }

  /**
   * Secret skaters unlocked and not announced yet (each comes back once): call after a Tour goal.
   * quiet: just remember the ones open now (at startup, so a career earned before this existed does
   * not slap cards on load).
   */
  fresh(quiet = false): CharacterSpec[] {
    const out = this.secret.filter((c) => !this.locked(c.id) && !this.seen.has(c.id))
    if (!out.length) return []
    for (const c of out) this.seen.add(c.id)
    if (!this.override) try { localStorage.setItem(SEEN, JSON.stringify([...this.seen])) } catch { /* private window */ }
    return quiet ? [] : out
  }
}
