// node tools/portraits.ts [id,id,...]: renders the UI's portraits from the in-game 3D models (docs/art-direction.md,
// src/client/portrait.ts) through the dev client in headless Chromium (muted, its own profile, closed after) and writes
// assets/ui/portrait/<id>.jpg: the story's cast (data/cast.json) on an ink field, the pickable skaters
// (data/characters.json) on the accent. Re-run when a model changes.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { rel } from '../src/harness/io.ts'
import { withPages } from '../src/harness/browser.ts'
import type { PortraitJob } from '../src/client/portrait.ts'

// --turn: the pickable skaters' turns (twelve frames each, the whole figure) for the rewards: assets/ui/portrait/turn/<id>.jpg.
const turn = process.argv.includes('--turn')
const args = process.argv.slice(2).filter((a) => a !== '--turn')
const only = args[0] ? new Set(args[0].split(',')) : null
const cast = (JSON.parse(readFileSync(rel('data/cast.json'), 'utf8')) as { cast: { id: string; model: { id: string; outfit?: string } }[] }).cast
const chars = (JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as { characters: { id: string }[] }).characters
// Where a face is not at the top of the figure (a cloud, a blob, a cable car), more of it in the picture.
const FRAME: Record<string, number> = { karl: 0.9, blob: 0.82, robotaxi: 1, cablecar: 0.95, pigeon: 0.75, sealion: 0.8, can: 0.62, burrito: 0.66, unit7: 1 }
const jobs: PortraitJob[] = [
  ...chars.map((c) => ({ id: c.id, model: c.id, field: 'accent' as const, frame: FRAME[c.id] })),
  ...cast.filter((c) => !chars.some((x) => x.id === c.id)).map((c) => ({ id: c.id, model: c.model.id, outfit: c.model.outfit ?? null, field: 'ink' as const, frame: FRAME[c.id] })),
].filter((j) => !only || only.has(j.id)).filter((j) => !turn || j.field === 'accent').map((j) => (turn ? { ...j, turn: 12, frame: undefined } : j))
const dir = rel(turn ? 'assets/ui/portrait/turn' : 'assets/ui/portrait')
mkdirSync(dir, { recursive: true })
await withPages(async (open) => {
  const page = await open('lab', 'nostory=1')
  const got = await page.evaluate(([j, size]) => (window as unknown as { __skateGame: { portraits(j: PortraitJob[], size?: number): Promise<Record<string, string>> } }).__skateGame.portraits(j, size), [jobs, turn ? 160 : 320] as const)
  for (const [id, url] of Object.entries(got)) writeFileSync(`${dir}/${id}.jpg`, Buffer.from(url.split(',')[1], 'base64'))
  const missing = jobs.filter((j) => !got[j.id]).map((j) => j.id)
  console.log(`${Object.keys(got).length} ${turn ? 'turns in assets/ui/portrait/turn/' : 'portraits in assets/ui/portrait/'}${missing.length ? `; no model for ${missing.join(', ')}` : ''}`)
}, { width: 640, height: 480 }, { gpu: true })
