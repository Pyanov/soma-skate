import { describe, expect, it } from 'vitest'
import { cityAreaHashes, type AreaBox, type AreaHash } from '../src/harness/cityareas.ts'
import { readJson, rel } from '../src/harness/io.ts'

// The city export, area by area (tests/city-areas.json, src/harness/cityareas.ts): a city phase that
// adds an area somewhere leaves every pinned area exactly as it was, triangle for triangle, grind
// line for grind line, parked car for parked car. An area changed on purpose is re-pinned with
// node tools/city-areas.ts --write, and the commit says which.

type Pins = { areas: Record<string, { box: AreaBox } & AreaHash> }

describe('city areas', () => {
  it('match their pins (a new area elsewhere moves nothing here)', { timeout: 60000 }, () => {
    const pins = readJson<Pins>(rel('tests/city-areas.json'))
    const now = cityAreaHashes(Object.fromEntries(Object.entries(pins.areas).map(([k, v]) => [k, v.box])))
    const changed = Object.entries(now).filter(([k, h]) => {
      const p = pins.areas[k]
      return p.solid !== h.solid || p.look !== h.look || p.lines !== h.lines || p.props !== h.props
    }).map(([k, h]) => `${k}: solid ${h.solid} look ${h.look} lines ${h.lines} props ${h.props} (${h.counts.join(' / ')})`)
    expect(changed, 'areas that changed (if on purpose: node tools/city-areas.ts --write)').toEqual([])
  })
})
