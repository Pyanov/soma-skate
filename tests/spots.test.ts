import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

// Every spawn spot the menus can show (Go to…, the current spot) has a name for people, not its id.
const spots = JSON.parse(readFileSync(new URL('../data/spots.json', import.meta.url), 'utf8')) as { labels: Record<string, string>; aliases: { id: string; spot: string }[] }

describe('spot names', () => {
  for (const f of ['soma.park.json', 'sf.city.json']) {
    const url = new URL(`../assets/park/${f}`, import.meta.url)
    it.skipIf(!existsSync(url))(`every spot in ${f} has a label or an alias`, () => {
      const park = JSON.parse(readFileSync(url, 'utf8')) as { spots?: { id?: string; name?: string }[] }
      const named = new Set([...Object.keys(spots.labels), ...spots.aliases.flatMap((a) => [a.id, a.spot])])
      const missing = (park.spots ?? []).map((s) => s.id ?? s.name ?? '').filter((id) => !named.has(id))
      expect(missing).toEqual([])
    })
  }
})
