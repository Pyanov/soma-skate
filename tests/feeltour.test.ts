import { describe, expect, it } from 'vitest'
import { loadData } from '../src/harness/io.ts'
import { tourFeel } from '../src/harness/feel.ts'

// skate feel --tour (docs/feel-audit.md section 8): its perfect player replays each goal's leg from the
// script's own world and the great run, so it must make every goal; if it does not, a leg is cut wrong.
describe('feel --tour', () => {
  it('the perfect player makes every Embarcadero goal, Pro and Sick', () => {
    const rows = tourFeel(loadData(), 1, 'embarcadero')
    expect(rows.length).toBe(12)
    for (const r of rows) expect(String(r.perfect), String(r.goal)).toMatch(/^100%/)
  }, 30_000) // a whole level's legs and its great run: about 2.5 s alone, more beside the other suites
})
