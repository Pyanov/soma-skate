import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Rewards } from '../src/client/rewards.ts'
import { UNLOCK_ROWS } from '../src/client/cas.ts'
import type { CharactersData } from '../src/client/skater/characters.ts'
import { loadData, rel } from '../src/harness/io.ts'

// What the story's missions give (data/missions.json reward, src/client/rewards.ts): decks from the
// board shop, outfits from the picker and secret skaters, each once; locked until the mission is done.

const data = loadData()
const json = (f: string) => JSON.parse(readFileSync(rel(f), 'utf8'))
const boards = json('data/boards.json') as { decks: { graphic: string; name: string }[] }
const chars = json('data/characters.json') as CharactersData
const stickers = (json('data/stickers.json') as { stickers: { id: string; name: string; art: string }[] }).stickers

const cas = json('data/cas.json') as Record<string, { id: string; name: string; prop?: string; kind?: string; unlock?: { story?: string } }[]>
const pieces = () => UNLOCK_ROWS.flatMap((k) => cas[k] ?? [])

describe('rewards', () => {
  it('the odd jobs\' decks: real decks no mission gives, locked until so many gigs from their board, on the gig\'s card at that count', () => {
    const count: Record<string, number> = {}
    const R = new Rewards({ missions: data.missions.missions, decks: boards.decks, characters: chars.characters, stickers: () => stickers,
      jobs: { decks: data.jobs.decks, boardName: (id) => data.jobs.boards.find((b) => b.id === id)!.name, count: (b) => count[b] ?? 0 } }, () => new Set())
    const given = new Set(data.missions.missions.map((M) => M.reward?.deck).filter(Boolean))
    for (const g of data.jobs.decks) {
      expect(boards.decks.some((d) => d.graphic === g.deck), g.deck).toBe(true)
      expect(given.has(g.deck), `${g.deck}: a mission gives it too`).toBe(false)
      expect(R.deck(g.deck)).toMatch(new RegExp(`${g.gigs} gigs from the .* \\(0 / ${g.gigs}\\)`))
      count[g.board] = g.gigs - 1
      expect(R.gigDecks(g.board, g.gigs - 1)).toEqual([])
      count[g.board] = g.gigs
      expect(R.deck(g.deck)).toBeNull()
      expect(R.gigDecks(g.board, g.gigs).map((r) => r.id)).toEqual([g.deck])
      const r = R.all().find((x) => x.id === g.deck)!
      expect(r.mission).toBe(`gigs:${g.board}`)
      expect(R.earned(r)).toBe(true)
    }
    const gigStickers = stickers.filter((s) => s.id.startsWith('gig-'))
    expect(gigStickers.length).toBeGreaterThanOrEqual(4)
  })

  it('Create-a-Skater pieces a mission opens name a real mission, are kit parts, and are on its results card', () => {
    const ids = new Set(data.missions.missions.map((M) => M.id))
    const kitProps = new Set(chars.people!.flatMap((p) => ((p as { kit?: { props?: { kind: string }[] } }).kit?.props ?? []).map((x) => x.kind)))
    const story = pieces().filter((p) => p.unlock?.story)
    expect(story.length).toBeGreaterThanOrEqual(22)
    for (const p of story) expect(ids.has(p.unlock!.story!), `${p.id}: ${p.unlock!.story}`).toBe(true)
    for (const p of cas.props.filter((x) => x.unlock?.story && x.prop)) expect(kitProps.has(p.prop!), `${p.id}: a prop the kit builds`).toBe(true)
    const R = new Rewards({ missions: data.missions.missions, decks: boards.decks, characters: chars.characters, stickers: () => stickers, pieces }, () => new Set())
    expect(R.of(data.missions.missions.find((M) => M.id === 'lionluck')!).map((r) => `${r.kind}:${r.name}`)).toContain('piece:Lion dance head')
    expect(R.of(data.missions.missions.find((M) => M.id === 'cartrace')!).map((r) => `${r.kind}:${r.name}`)).toContain("piece:Grandma Wu's visor")
    expect(R.all().filter((r) => r.kind === 'piece').length).toBe(story.length)
  })

  it('every deck and outfit a mission gives exists, is given once, and some of each stay free', () => {
    const decks = new Set<string>(), outfits = new Set<string>()
    for (const M of data.missions.missions) {
      const r = M.reward
      if (r?.deck) {
        expect(boards.decks.some((d) => d.graphic === r.deck), `${M.id} deck ${r.deck}`).toBe(true)
        expect(decks.has(r.deck), `${r.deck} twice`).toBe(false); decks.add(r.deck)
      }
      if (r?.outfit) {
        const [ch, of] = r.outfit.split('/')
        expect(chars.characters.find((c) => c.id === ch)?.outfits?.some((o) => o.id === of), `${M.id} outfit ${r.outfit}`).toBe(true)
        expect(outfits.has(r.outfit), `${r.outfit} twice`).toBe(false); outfits.add(r.outfit)
      }
      if (r?.unlock) expect(chars.characters.find((c) => c.id === r.unlock)?.unlock, `${M.id} unlock ${r.unlock}`).toBeTruthy()
      if (r?.sticker) expect(stickers.some((s) => s.id === r.sticker), `${M.id} sticker`).toBe(true)
    }
    expect(decks.size).toBeGreaterThanOrEqual(10)
    expect(outfits.size).toBeGreaterThanOrEqual(10)
    // The character's own deck and at least five more are free from the start.
    expect(boards.decks.filter((d) => !decks.has(d.graphic)).length).toBeGreaterThanOrEqual(6)
    expect(decks.has('')).toBe(false)
  })

  it('a deck or outfit stays locked until its mission is done; the results card lists what it gave', () => {
    const done = new Set<string>()
    const R = new Rewards({ missions: data.missions.missions, decks: boards.decks, characters: chars.characters, stickers: () => stickers }, () => done)
    expect(R.deck('muni')).toBe("Finish Dolores's Delay")
    expect(R.deck('goldengate')).toBeNull()
    expect(R.outfit('robotaxi', 'coned')).toBe("Finish Chad's Move")
    expect(R.outfit('robotaxi', 'nightshift')).toBeNull()
    done.add('delay'); done.add('ch5')
    expect(R.deck('muni')).toBeNull()
    expect(R.outfit('robotaxi', 'coned')).toBeNull()
    const ch5 = data.missions.missions.find((M) => M.id === 'ch5')!
    expect(R.of(ch5).map((r) => `${r.kind}:${r.name}`)).toEqual(['deck:Karl the Fog', 'outfit:Coned (The Robotaxi)', 'sticker:Tow Order Declined'])
    const unit7 = data.missions.missions.find((M) => M.id === 'unit7')!
    expect(R.of(unit7)[0]).toMatchObject({ kind: 'skater', id: 'robotaxi', name: 'The Robotaxi' })
    // The journal's Rewards page: every skater, deck and outfit, earned or not.
    const all = R.all()
    expect(all.filter((r) => R.earned(r)).map((r) => r.id).sort()).toEqual(['fog', 'muni', 'robotaxi/coned'])
    expect(all.every((r) => r.kind !== 'sticker')).toBe(true)
  })
})
