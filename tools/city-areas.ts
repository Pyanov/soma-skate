// The city export's area hashes (tests/city-areas.json): node tools/city-areas.ts [--write] [--dir <another export's folder>]
// Prints each area's hashes against its pins; --write re-pins them (only for an area a phase changed
// on purpose: say which in the commit and in docs/decisions.md).
import { cityAreaHashes, type AreaBox, type AreaHash } from '../src/harness/cityareas.ts'
import { readJson, rel, writeJson } from '../src/harness/io.ts'

type Pins = { _doc: string; areas: Record<string, { box: AreaBox } & Partial<AreaHash>> }
const file = rel('tests/city-areas.json')
const pins = readJson<Pins>(file)
const di = process.argv.indexOf('--dir')
const now = cityAreaHashes(Object.fromEntries(Object.entries(pins.areas).map(([k, v]) => [k, v.box])), di > 0 ? process.argv[di + 1] : undefined)
for (const [k, h] of Object.entries(now)) {
  const p = pins.areas[k]
  const same = p.solid === h.solid && p.look === h.look && p.lines === h.lines && p.props === h.props
  console.log(`${same ? 'same   ' : 'CHANGED'} ${k.padEnd(14)} solid ${h.solid} look ${h.look} lines ${h.lines} props ${h.props}  (${h.counts.join(' / ')})`)
  if (process.argv.includes('--write')) Object.assign(p, h)
}
if (process.argv.includes('--write')) { writeJson(file, pins); console.log('re-pinned', file) }
