import { z } from 'zod'
import type { SimEvent } from '../sim/sim.ts'

// The Sticker Book: stickers earned once for milestones (data/stickers.json), matched against the
// sim's events and kept in this browser. Client only.

const value = z.union([z.number(), z.string(), z.boolean(), z.object({ max: z.number() }).strict()])
export const stickersSchema = z.object({
  _doc: z.string().optional(),
  stickers: z.array(z.object({ id: z.string(), name: z.string(), line: z.string(), art: z.string(), rule: z.object({ on: z.string() }).catchall(value), count: z.number().int().positive().optional(), distinct: z.string().optional() }).strict()),
}).strict()
export type StickerData = z.infer<typeof stickersSchema>
export type Sticker = StickerData['stickers'][number]

const KEY = 'soma-skate:stickers'

/** Does this event satisfy the rule (ignoring count)? */
export function matches(rule: Sticker['rule'], e: SimEvent): boolean {
  if (e.t !== rule.on) return false
  const ev = e as unknown as Record<string, unknown>
  for (const [k, want] of Object.entries(rule)) {
    if (k === 'on') continue
    const got = ev[k]
    if (typeof want === 'number') { if (typeof got !== 'number' || got < want) return false }
    else if (typeof want === 'object') { if (typeof got !== 'number' || got > (want as { max: number }).max) return false }
    else if (got !== want) return false
  }
  return true
}

export class StickerBook {
  private d: StickerData
  private got: Record<string, number> = {}     // earned (count reached) = -1; else progress
  private seen: Record<string, string[]> = {}  // distinct values counted so far, per sticker
  onEarn: (s: Sticker) => void = () => {}

  constructor(d: StickerData) {
    this.d = d
    try { this.got = JSON.parse(localStorage.getItem(KEY) ?? '{}'); this.seen = JSON.parse(localStorage.getItem(KEY + ':seen') ?? '{}') } catch { this.got = {}; this.seen = {} }
  }

  static async load(): Promise<StickerBook | null> {
    try { return new StickerBook(stickersSchema.parse(await (await fetch('data/stickers.json', { cache: 'no-store' })).json())) } catch { return null }
  }

  get all() { return this.d.stickers.map((s) => ({ ...s, earned: this.got[s.id] === -1, progress: this.got[s.id] === -1 ? s.count ?? 1 : this.got[s.id] ?? 0 })) }
  get earnedCount() { return this.d.stickers.filter((s) => this.got[s.id] === -1).length }

  event(e: SimEvent) {
    let changed = false
    for (const s of this.d.stickers) {
      if (this.got[s.id] === -1 || !matches(s.rule, e)) continue
      // distinct: count different values of that field only (12 different places, not one place 12 times).
      if (s.distinct) {
        const ev = e as unknown as Record<string, unknown>, v = s.distinct.split('+').map((k) => String(ev[k])).join('|'), seen = (this.seen[s.id] ??= [])   // 'level+id': a pair
        if (seen.includes(v)) continue
        seen.push(v)
      }
      const n = (this.got[s.id] ?? 0) + 1
      this.got[s.id] = n >= (s.count ?? 1) ? -1 : n
      changed = true
      if (this.got[s.id] === -1) this.onEarn(s)
    }
    if (changed) try { localStorage.setItem(KEY, JSON.stringify(this.got)); localStorage.setItem(KEY + ':seen', JSON.stringify(this.seen)) } catch { /* private window */ }
  }
}
