import type { Mission } from '../sim/data.ts'
import type { CharacterSpec } from './skater/characters.ts'

// What the story's missions give (data/missions.json reward): a sticker (the Sticker Book), a deck for
// the board shop (deck: a data/boards.json graphic), an outfit (outfit: character/outfit) and now and
// then a secret skater (unlock: a data/characters.json id, whose own unlock says when it opens), and the
// Create-a-Skater pieces whose unlock names the mission (data/cas.json, cas.ts keeps their locks). A deck
// or an outfit some mission gives stays locked in the picker until that mission is done (the story's
// save, story.ts); the rest are free from the start. The odd jobs' decks (data/jobs.json decks) open after so
// many gigs from a board (the story's save counts them). Client only.

export type RewardKind = 'skater' | 'deck' | 'outfit' | 'piece' | 'sticker'   // piece: a Create-a-Skater piece (data/cas.json unlock story)
export type Reward = { kind: RewardKind; id: string; name: string; mission: string; missionName: string; art?: string }   // mission gigs:<board>: an odd jobs' deck

export type RewardsData = {
  missions: Mission[]
  decks: { graphic: string; name: string }[]
  characters: CharacterSpec[]
  stickers: () => { id: string; name: string; art: string }[]   // the Sticker Book's (it loads on its own)
  /** Create-a-Skater's pieces a mission opens (data/cas.json, unlock story; none without Create-a-Skater). */
  pieces?: () => { id: string; name: string; unlock?: { story?: string } }[]
  /** The odd jobs' decks (data/jobs.json decks), the boards' names and how many gigs from each are done. */
  jobs?: { decks: { deck: string; board: string; gigs: number }[]; boardName: (id: string) => string; count: (board: string) => number }
}

export class Rewards {
  private d: RewardsData
  private done: () => ReadonlySet<string>
  private byDeck = new Map<string, Mission>()
  private byOutfit = new Map<string, Mission>()
  private byGigs = new Map<string, { deck: string; board: string; gigs: number }>()

  /** done: the missions finished (the story's save). */
  constructor(d: RewardsData, done: () => ReadonlySet<string>) {
    this.d = d
    this.done = done
    for (const M of d.missions) {
      if (M.reward?.deck) this.byDeck.set(M.reward.deck, M)
      if (M.reward?.outfit) this.byOutfit.set(M.reward.outfit, M)
    }
    for (const g of d.jobs?.decks ?? []) this.byGigs.set(g.deck, g)
  }

  /** A mission's rewards, in the order the results card shows them. */
  of(M: Mission): Reward[] {
    const r = M.reward ?? {}, out: Reward[] = []
    const base = { mission: M.id, missionName: M.name }
    if (r.unlock) { const c = this.d.characters.find((x) => x.id === r.unlock); out.push({ ...base, kind: 'skater', id: r.unlock, name: c?.name ?? r.unlock, art: r.unlock }) }
    if (r.deck) out.push({ ...base, kind: 'deck', id: r.deck, name: this.deckName(r.deck) })
    if (r.outfit) out.push({ ...base, kind: 'outfit', id: r.outfit, name: this.outfitName(r.outfit) })
    for (const it of this.d.pieces?.() ?? []) if (it.unlock?.story === M.id) out.push({ ...base, kind: 'piece', id: it.id, name: it.name })
    if (r.sticker) { const s = this.d.stickers().find((x) => x.id === r.sticker); out.push({ ...base, kind: 'sticker', id: r.sticker, name: s?.name ?? r.sticker, art: s?.art }) }
    return out
  }

  /** Every reward the story gives (skaters, decks, outfits, Create-a-Skater pieces; stickers are the Sticker Book's), in mission order. */
  all(): Reward[] {
    const J = this.d.jobs
    return [...this.d.missions.flatMap((M) => this.of(M).filter((x) => x.kind !== 'sticker')),
      ...(J?.decks ?? []).map((g): Reward => ({ kind: 'deck', id: g.deck, name: this.deckName(g.deck), mission: `gigs:${g.board}`, missionName: J!.boardName(g.board) }))]
  }

  /** Is this reward earned (its mission done; an odd jobs' deck: its gigs done)? */
  earned(r: Reward) {
    if (r.mission.startsWith('gigs:')) { const g = this.byGigs.get(r.id); return !!g && (this.d.jobs?.count(g.board) ?? 0) >= g.gigs }
    return this.done().has(r.mission)
  }

  /** The odd jobs' decks a board's gigs open at exactly this count (the gig's results card). */
  gigDecks(board: string, count: number): Reward[] {
    const J = this.d.jobs
    return (J?.decks ?? []).filter((g) => g.board === board && g.gigs === count).map((g) => ({ kind: 'deck', id: g.deck, name: this.deckName(g.deck), mission: `gigs:${g.board}`, missionName: J!.boardName(g.board) }))
  }

  /** A deck's lock: null when it is free or earned, else what earns it ("Finish The Burrito Run"). */
  deck(graphic: string): string | null {
    const M = this.byDeck.get(graphic), g = this.byGigs.get(graphic), J = this.d.jobs
    if (g && J) { const n = J.count(g.board); return n >= g.gigs ? null : `${g.gigs} gigs from the ${J.boardName(g.board)} (${n} / ${g.gigs})` }
    return !M || this.done().has(M.id) ? null : `Finish ${M.name}`
  }

  /** An outfit's lock, as deck. */
  outfit(character: string, outfit: string): string | null {
    const M = this.byOutfit.get(`${character}/${outfit}`)
    return !M || this.done().has(M.id) ? null : `Finish ${M.name}`
  }

  deckName(graphic: string) { return this.d.decks.find((x) => x.graphic === graphic)?.name ?? graphic }
  outfitName(id: string) {
    const [ch, of] = id.split('/'), c = this.d.characters.find((x) => x.id === ch)
    return `${c?.outfits?.find((o) => o.id === of)?.name ?? of} (${c?.name ?? ch})`
  }
}
