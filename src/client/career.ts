import type { Tour as TourData } from '../sim/data.ts'

// The Tour career: which goals of which level you have done (data/tour.json), counted across runs
// and kept in this browser. Every level is open (docs/open-world.md: the neighbourhoods' open
// challenges); the goals still count toward the secret skaters (unlocks.ts). Client only.

const KEY = 'soma-skate:tour'
type Level = TourData['levels'][number]

export class Career {
  private done: Record<string, string[]> = {}
  private d: TourData
  constructor(d: TourData) {
    this.d = d
    try { this.done = JSON.parse(localStorage.getItem(KEY) ?? '{}').levels ?? {} } catch { this.done = {} }
  }
  get levels() { return this.d.levels }
  /** Every level's goal ids: pro, sick, skate, tape, then its own. */
  goalIds(L: Level) { return ['pro', 'sick', 'skate', 'tape', ...L.goals.map((g) => g.id)] }
  goalName(L: Level, id: string) { return (this.d.names as Record<string, string>)[id] ?? L.goals.find((g) => g.id === id)?.name ?? id }
  goalLine(L: Level, id: string) {
    if (id === 'pro' || id === 'sick') return `${L.tiers[id].toLocaleString('en-US')} points in one run`
    if (id === 'skate') return 'Collect all five letters in one run'
    if (id === 'tape') return L.tape.hint ?? ''
    return L.goals.find((g) => g.id === id)?.description ?? ''
  }
  doneIn(id: string) { return this.done[id] ?? [] }
  has(level: string, goal: string) { return this.doneIn(level).includes(goal) }
  get total() { return Object.values(this.done).reduce((n, g) => n + g.length, 0) }
  /** In how many levels a goal is done (count('tape'): secret tapes found across the Tour). */
  count(goal: string) { return Object.values(this.done).filter((g) => g.includes(goal)).length }
  get max() { return this.d.levels.reduce((n, L) => n + this.goalIds(L).length, 0) }
  /** A level's goals done and its goal count (null: no such level yet). */
  level(id: string): { done: number; of: number } | null {
    const L = this.d.levels.find((x) => x.id === id)
    if (!L) return null
    const ids = this.goalIds(L)
    return { done: ids.filter((g) => this.has(id, g)).length, of: ids.length }
  }
  /** Record a goal (true: new). */
  add(level: string, goal: string): boolean {
    if (this.has(level, goal)) return false
    this.done[level] = [...this.doneIn(level), goal]
    try { localStorage.setItem(KEY, JSON.stringify({ levels: this.done })) } catch { /* private window */ }
    return true
  }
}
