import { z } from 'zod'
import type { SimEvent } from '../sim/sim.ts'
import { matches } from './stickers.ts'

// Today's challenge: one per San Francisco day from data/daily.json (the same for everyone),
// progress and a streak of days done, kept in this browser. Client only.

const value = z.union([z.number(), z.string(), z.boolean(), z.object({ max: z.number() }).strict()])
export const dailySchema = z.object({
  _doc: z.string().optional(),
  challenges: z.array(z.object({
    id: z.string(), text: z.string(), rule: z.object({ on: z.string() }).catchall(value), count: z.number().int().positive().optional(),
    spot: z.string().optional(), mode: z.enum(['start', 'courier', 'combo', 'bomb', 'skate', 'muni', 'escape', 'graffiti']).optional(), route: z.string().optional(), local: z.string().optional(),
  }).strict()).min(1),
}).strict()
export type DailyData = z.infer<typeof dailySchema>
export type Challenge = DailyData['challenges'][number]

const KEY = 'soma-skate:daily'
type Saved = { day: string; progress: number; done: boolean; streak: number; lastDone: string }

/** The San Francisco date, YYYY-MM-DD. */
export function sfDay(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}
/** Which challenge a day gets: a hash of the date, so it is stable and the same for everyone. */
export function pickFor(day: string, n: number): number {
  let h = 2166136261
  for (const c of day) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) }
  return (h >>> 0) % n
}
const prevDay = (day: string) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }

export class Daily {
  readonly today: Challenge
  private s: Saved
  onDone: (c: Challenge, streak: number) => void = () => {}

  constructor(d: DailyData, now = new Date()) {
    const day = sfDay(now)
    this.today = d.challenges[pickFor(day, d.challenges.length)]
    let saved: Partial<Saved> = {}
    try { saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') } catch { /* private window */ }
    const streak = saved.lastDone === day || saved.lastDone === prevDay(day) ? saved.streak ?? 0 : 0
    this.s = saved.day === day ? { day, progress: saved.progress ?? 0, done: !!saved.done, streak, lastDone: saved.lastDone ?? '' } : { day, progress: 0, done: false, streak, lastDone: saved.lastDone ?? '' }
  }

  static async load(): Promise<Daily | null> {
    try { return new Daily(dailySchema.parse(await (await fetch('data/daily.json', { cache: 'no-store' })).json())) } catch { return null }
  }

  get progress() { return this.s.progress }
  get done() { return this.s.done }
  get streak() { return this.s.streak }
  get need() { return this.today.count ?? 1 }

  event(e: SimEvent) {
    if (this.s.done || !matches(this.today.rule, e)) return
    this.s.progress++
    if (this.s.progress >= this.need) {
      this.s.done = true
      this.s.streak = this.s.lastDone === prevDay(this.s.day) ? this.s.streak + 1 : 1
      this.s.lastDone = this.s.day
      this.onDone(this.today, this.s.streak)
    }
    try { localStorage.setItem(KEY, JSON.stringify(this.s)) } catch { /* private window */ }
  }
}
