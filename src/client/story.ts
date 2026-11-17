import * as THREE from 'three'
import type { CastMember, GameData, Mission, TourLevel } from '../sim/data.ts'
import { actorPlace, castAt, insideAnchor, missionData, missionWorlds, placeOf, stepLines } from '../sim/game/missions.ts'
import { boardPlace, jobsFor } from '../sim/game/jobs.ts'
import { jobLines } from '../data/schema.ts'
import { sfDay } from './daily.ts'
import { streetWay } from '../sim/game/escape.ts'
import type { Park } from '../sim/park/park.ts'
import { findSpot, session, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import { Btn } from '../sim/input.ts'
import type { Thing } from '../sim/thing.ts'
import { CastViews } from './castview.ts'
import { Dialogue } from './dialogue.ts'
import { Journal, type JournalEntry, type JournalPage } from './journal.ts'
import { MapScreen, type MapIcon, type MapWorld } from './mapscreen.ts'
import { Markers, type Marker } from './markers.ts'
import type { Reward, Rewards } from './rewards.ts'
import type { SkaterView } from './skater/view.ts'
import type { Sound } from './sound.ts'
import type { Hud, MenuItem } from './ui.ts'
import './story.css'

// The story in the client (docs/story.md, docs/open-world.md): the save (which missions are done or
// skipped, the spots visited, the waypoint), the cast standing in the world, the markers over those
// with a story to give and over each neighbourhood's challenges, the talk prompt and the talk key, the
// dialogue box, the mission's objective on the HUD, the minimap's marks and the waypoint's route, and the
// odd jobs' gig boards (today's gigs by the San Francisco date; game/jobs.ts makes them). The sim runs the
// missions (game/missions.ts); everything here is sent as commands or drawn from events.

export type StoryData = {
  interact: { radius: number; challengeRadius: number }
  introDelay: number; introWait: number; visitRadius: number
  travel: { seconds: number; places: { spot: string; name: string }[] }
  route: { every: number; off: number; reached: number }
  map: { zoom: [number, number, number]; pan: number; names: number; streets: { name: string; at: [number, number] }[] }
  minimapIcons: number
  finale: string
  credits: { seconds: number }
  complete: { titles: Record<string, string>; overall: string; line: string }
  pacing: { call: { radius: number; repeat: number; gap: number; afterNo: number; warmup: number }; rim: { range: number; count: number }; post: { radius: number }; check: { seconds: number; speed: number; share: number; walks: number } }
}
/** post: the characters whose post-game line was said (after the finale). */
export type StorySave = { done: string[]; skipped: string[]; visited: string[]; intro: boolean; waypoint: [number, number] | null; post?: string[]
  /** The odd jobs: the gigs done today (their mission ids, of that San Francisco date) and how many from each board ever. */
  jobs?: { day: string; done: string[] }; gigs?: Record<string, number> }
type Target = { x: number; y: number; z: number; label: string; ring?: boolean }   // ring: the beacon's ground ring only (an item has its own token)
type Board = GameData['jobs']['boards'][number]
type Near = { kind: 'mission'; m: Mission; c: CastMember } | { kind: 'chat'; c: CastMember } | { kind: 'challenge'; L: TourLevel; x: number; y: number } | { kind: 'board'; B: Board; x: number; y: number }

const KEY = 'soma-skate:story'
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

/** The cast people view (castpeople.ts): who it draws, and where the mission puts them. */
export type PeopleView = { has(id: string): boolean; setOverride(id: string, at: { x: number; y: number; z: number; heading: number } | 'hidden' | null): void }

export type StoryDeps = {
  data: GameData; park: Park; ui: Hud; sound: Sound; scene: THREE.Scene; root: HTMLElement
  /** The people castpeople.ts draws (the rest are this file's CastViews'). */
  people?: PeopleView | null
  sim: () => Sim; queue: (cmd: string) => Promise<{ ok: boolean; text: string }>
  skater: SkaterView; gradient: THREE.Texture | null
  /** The player's talk key names (for the prompt) and whether a code is one. */
  talkKeys: () => string[]
  touch: () => boolean
  spotLabel: (id: string) => string
  /** A neighbourhood's challenges: start its Tour level run. */
  startChallenge: (level: string) => void
  /** data/ui.json places: the neighbourhoods and landmarks, named on the big map. */
  places: { spots: { name: string; at: number[] }[]; hoods: { name: string; at: number[] }[] }
  /** A neighbourhood's challenge goals done and how many (the Tour career), for the journal and the map. */
  careerProgress: (level: string) => { done: number; of: number } | null
  /** Take Muni to a spot (the transition and the teleport are main's). */
  travel: (spot: string, label: string) => void
  /** The bay's triangles in plan (x, y per corner), for the big map's water. */
  mapWater: number[]
  /** The map or the journal opened (true) or closed (false): main pauses the game meanwhile. */
  onOverlay: (open: boolean) => void
  /** data/ui.json credits (the pause menu's Credits page), rolled after the finale under the cast. */
  credits: { title: string; lines: string[] }[]
  /** The 100% page's categories kept outside the story (stickers, tapes, decks, outfits, Create-a-Skater pieces): got of how many. */
  completion?: () => { id: string; name: string; n: number; of: number; face: string; left?: string }[]
}

export class StoryClient {
  readonly d: StoryData
  private x: StoryDeps
  save: StorySave = { done: [], skipped: [], visited: [], intro: false, waypoint: null }
  readonly dialogue: Dialogue
  readonly markers = new Markers()
  readonly cast: CastViews
  private objEl: HTMLElement
  private resultsEl: HTMLElement
  private resultsTimer = 0
  /** What missions give (rewards.ts; set by main): the results card and the journal's Rewards page. */
  rewards: Rewards | null = null
  private promptEl: HTMLElement
  private talkBtn: HTMLElement
  private near: Near | null = null
  private talkingMission: string | null = null
  private challengeOffer: TourLevel | null = null
  /** A gig board's card: the board, the day and its gigs (a choice starts one). */
  private boardOffer: { board: string; day: string; jobs: Mission[] } | null = null
  /** A failed mission's Try again card: from which step (missions.json retry). */
  private retryOffer: { id: string; step: number } | null = null
  private wrapping = false
  private chatAt = new Map<string, number>()
  // Pacing (data/story.json pacing): when each character last called out, the last call, who said Not now (until when), since when we skate.
  private calledAt = new Map<string, number>()
  /** Who called out and when (page time, ms), in order (post-game lines as id:post), for the playtest bot. */
  readonly callLog: { who: string; at: number }[] = []
  private lastCall = -Infinity
  private mutedUntil = new Map<string, number>()
  private startedAt = -1
  private creditsEl: HTMLElement | null = null
  private afterCredits: (() => void) | null = null
  private route: { to: [number, number]; pts: [number, number][]; at: number } | null = null
  private visitTick = 0
  private lastNow = 0
  private introAt = -1
  /** A mission finished (main: the unlock cards). */
  onDone: (e: Extract<SimEvent, { t: 'missionDone' }>) => void = () => {}

  constructor(d: StoryData, x: StoryDeps) {
    this.d = d
    this.x = x
    try { this.save = { ...this.save, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') } } catch { /* private window */ }
    this.dialogue = new Dialogue(x.root)
    this.dialogue.isTalkKey = (code) => x.talkKeys().includes(code)
    this.dialogue.blocked = () => x.ui.menuOpen
    this.dialogue.foot = () => (x.touch() ? '<span>Tap to go on</span>' : '<span><kbd>Space</kbd>next</span><span><kbd>Esc</kbd>skip</span>')
    this.dialogue.onNext = () => { if (this.talkingMission) void x.queue('mission next') }
    this.dialogue.onSkip = () => { if (this.talkingMission) void x.queue('mission next all') }
    this.dialogue.onChoose = (i) => {
      if (this.challengeOffer) { const L = this.challengeOffer; this.challengeOffer = null; this.dialogue.hide(); if (i === 0) x.startChallenge(L.id); return }
      if (this.boardOffer) { const b = this.boardOffer; this.boardOffer = null; this.dialogue.hide(); x.sound.stopSpeaking(); if (i < b.jobs.length) void x.queue(`mission job ${b.board} ${b.day} ${i}`).then((r) => { if (!r.ok) x.ui.toast(r.text) }); return }
      if (this.retryOffer) { const r = this.retryOffer; this.retryOffer = null; this.dialogue.hide(); x.sound.stopSpeaking(); if (i === 0) void x.queue(`mission start ${r.id} ${r.step}`).then((res) => { if (!res.ok) x.ui.toast(res.text) }); return }
      if (this.talkingMission) void x.queue(i === 0 ? 'mission accept' : 'mission decline')
    }
    this.cast = new CastViews(x.skater, x.gradient)
    if (x.people) { const P = x.people; this.cast.skip = (id) => P.has(id) }
    x.scene.add(this.cast.group, this.markers.group)
    // The story's lines, said by id in their speakers' voices.
    const voice = new Map(x.data.cast.cast.map((c) => [c.id, c.voice]))
    const lines: Record<string, { voice: string; text: string }> = {}
    for (const l of this.allLines()) lines[l.id] = { voice: voice.get(l.who) ?? 'karl', text: l.text }
    x.sound.addLines(lines)
    this.objEl = document.createElement('div'); this.objEl.className = 'story-obj'; x.root.appendChild(this.objEl)
    this.resultsEl = document.createElement('div'); this.resultsEl.className = 'story-results'; x.root.appendChild(this.resultsEl)
    this.resultsEl.addEventListener('pointerdown', () => this.hideResults())
    this.promptEl = document.createElement('div'); this.promptEl.className = 'story-prompt'; x.root.appendChild(this.promptEl)
    this.talkBtn = document.createElement('button'); this.talkBtn.className = 'story-talk'; this.talkBtn.textContent = 'talk'
    this.talkBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.interact() })
    document.body.appendChild(this.talkBtn)
    x.ui.mapOverlay = (g, at, size) => this.drawMinimap(g, at, size)
    // The big map and the journal (each pauses the game while it is open).
    this.map = new MapScreen(x.root)
    this.map.onClose = () => this.closeOverlay()
    this.map.onWaypoint = (p) => { this.setWaypoint(p); this.map.refresh(this.mapIcons(), this.save.waypoint); if (p) x.ui.toast('Waypoint set: the route is on the minimap') }
    this.map.travelFor = (i) => this.travelFor(i)
    this.map.onTravel = (spot, label) => { this.closeOverlay(); x.travel(spot, label) }
    this.journal = new Journal(x.root)
    this.journal.onClose = () => this.closeOverlay()
    this.journal.onWaypoint = (e) => { if (e.at) { this.setWaypoint(e.at); x.ui.toast(`Waypoint: ${e.title}`); this.closeOverlay() } }
    this.journal.onSkip = (e) => { this.skipUnplayed(e.id); this.journal.refresh(this.journalPages()) }
  }

  readonly map: MapScreen
  readonly journal: Journal
  /** The map or the journal is open. */
  get overlay() { return this.map.isOpen || this.journal.isOpen || !!this.creditsEl }
  /** Where the overlay was opened from: back to the pause menu when it closes, or to play. */
  private overlayFrom: 'menu' | 'play' = 'play'
  /** Main: back to the pause menu (the overlay was opened from it). */
  onBackToMenu: () => void = () => {}

  openMap(from: 'menu' | 'play') {
    const sk = skater(this.x.sim())
    this.journal.close()
    this.overlayFrom = from
    // The main places (the map's list): the ones this world has, where they are.
    const spots = new Map(this.x.sim().park.spots.map((sp) => [sp.id, sp.pos] as const))
    this.map.places = this.d.travel.places.flatMap((p) => { const at = spots.get(p.spot); return at ? [{ ...p, x: at.x, y: at.y }] : [] })
    this.map.open(this.mapWorld(), this.mapIcons(), { x: sk.pos.x, y: sk.pos.y, heading: Math.atan2(sk.fwd.x, sk.fwd.y) }, this.save.waypoint, this.d.map.zoom, this.d.map.pan)
    this.x.onOverlay(true)
  }
  openJournal(from: 'menu' | 'play') {
    this.map.close()
    this.overlayFrom = from
    this.journal.open(this.journalPages())
    this.x.onOverlay(true)
  }
  closeOverlay() {
    if (this.creditsEl) { this.endCredits(); return }
    const was = this.overlay
    this.map.close(); this.journal.close()
    if (!was) return
    this.x.onOverlay(false)
    if (this.overlayFrom === 'menu') this.onBackToMenu()
  }

  // ---- the big map ----

  private world: MapWorld | null = null
  /** The big map's world, built once: streets by kind, the parks' green, the water, the park's obstacles, the names. */
  private mapWorld(): MapWorld {
    if (this.world) return this.world
    const m = this.x.ui.mapData, P = this.x.places, park = this.x.park
    const xy = (a: number[]) => [a[0], a[1]] as [number, number]
    const hoods = new Map<string, [number, number]>()
    for (const h of P.hoods) if (!hoods.has(h.name)) hoods.set(h.name, xy(h.at))
    const major = new Set(['primary', 'secondary', 'trunk', 'motorway'])
    const streets = park.traffic.paths.map((p) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const q of p.points) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]) }
      return { pts: p.points, box: [x0, y0, x1, y1], major: major.has(p.kind) }
    })
    // The parks' lawns and paths (the sim's ground triangles of those kinds), the water from the city's source.
    const parks: number[] = []
    for (let t = 0; t < park.triCount; t++) {
      const c = park.elements[park.elem[t]].collection
      if (c === 'city_park' || c === 'city_path') for (let k = 0; k < 3; k++) parks.push(park.tv[t * 9 + k * 3], park.tv[t * 9 + k * 3 + 1])
    }
    // Street names (data/story.json map.streets): each on the street point nearest its seed, along the street there.
    const names: { name: string; x: number; y: number; a: number }[] = []
    for (const n of this.d.map.streets) {
      let best: { x: number; y: number; a: number } | null = null, bd = 40
      for (const st of streets) st.pts.forEach((q, i) => {
        const d = Math.hypot(q[0] - n.at[0], q[1] - n.at[1])
        if (d >= bd) return
        const a = st.pts[Math.max(0, i - 1)], b = st.pts[Math.min(st.pts.length - 1, i + 1)]
        bd = d; best = { x: q[0], y: q[1], a: Math.atan2(b[1] - a[1], b[0] - a[0]) }
      })
      if (best) names.push({ name: n.name, ...(best as { x: number; y: number; a: number }) })
    }
    return (this.world = { streets, park: m?.park ?? null, parkBox: m?.parkBox ?? [0, 0, 0, 0], parks, water: this.x.mapWater, names, namesFrom: this.d.map.names,
      places: [...[...hoods].map(([name, at]) => ({ name, at, big: true })), ...P.spots.map((s) => ({ name: s.name, at: xy(s.at), big: false }))] })
  }

  mapIcons(): MapIcon[] {
    const sim = this.x.sim(), s = session(sim), out: MapIcon[] = []
    const D = this.data
    for (const sp of sim.park.spots) {
      const label = D.spots.labels?.[sp.id]
      if (!label) continue
      const visited = this.save.visited.includes(sp.id)
      out.push({ key: `s:${sp.id}`, kind: 'spot', x: sp.pos.x, y: sp.pos.y, label, sub: 'T goes here', visited, spot: sp.id })
    }
    // Rooms you can roll into (the city's interiors): the door, named; who is inside.
    for (const r of sim.park.interiors) {
      const inside = D.cast.cast.filter((c) => c.inside?.split('/')[0] === r.id).map((c) => c.name)
      out.push({ key: `i:${r.id}`, kind: 'interior', x: r.door[0], y: r.door[1], label: r.name, sub: inside.length ? `Inside: ${inside.join(', ')}` : 'Roll in' })
    }
    if (!s.mission) for (const M of this.available()) {
      const c = this.castOf(M.giver), p = c ? castAt(sim, s, c.id) : null
      if (c && p) out.push({ key: `m:${M.id}`, kind: M.kind, x: p[0], y: p[1], label: M.kind === 'story' ? `Chapter ${M.chapter}: ${M.name}` : M.name, sub: `${c.name}. ${M.blurb}`, face: c.id })
    }
    for (const L of this.challenges()) { const p = this.challengeAt(sim, L); if (p) out.push({ key: `c:${L.id}`, kind: 'challenge', x: p.x, y: p.y, label: `${L.name}: open challenges`, sub: this.careerLine(L.id), spot: L.spot }) }
    for (const { B, at } of this.boards()) { const g = this.gigsToday(B.id); out.push({ key: `b:${B.id}`, kind: 'job', x: at[0], y: at[1], label: B.name, sub: `${g.jobs.length} gigs today, ${g.done} done. ${this.castOf(B.host)?.name ?? ''}` }) }
    const t = this.target(sim)
    if (t) out.push({ key: 'objective', kind: 'objective', x: t.x, y: t.y, label: 'Your objective', sub: s.mission ? missionData(sim, s.mission.id).steps[s.mission.step].text : '' })
    return out
  }

  /** T on the map: a spot itself, else the named spot nearest the mark or the point. Nothing to unlock. */
  private travelFor(i: MapIcon): { spot: string; label: string } | { why: string } {
    const sim = this.x.sim(), labels = this.data.spots.labels ?? {}
    if (i.spot && labels[i.spot]) return { spot: i.spot, label: i.kind === 'spot' ? i.label : labels[i.spot] }
    let best: string | null = null, bd = Infinity
    for (const sp of sim.park.spots) { if (!labels[sp.id]) continue; const d = Math.hypot(sp.pos.x - i.x, sp.pos.y - i.y); if (d < bd) { bd = d; best = sp.id } }
    return best ? { spot: best, label: labels[best] } : { why: 'Nowhere to go near there' }
  }

  private careerLine(level: string) { const g = this.x.careerProgress(level); return g ? `${g.done} / ${g.of} goals done` : '' }

  // ---- the journal ----

  journalPages(): JournalPage[] {
    const sim = this.x.sim(), s = session(sim), S = this.save, past = new Set([...S.done, ...S.skipped])
    const entry = (M: Mission): JournalEntry => {
      const c = this.castOf(M.giver), p = c ? castAt(sim, s, c.id) : null
      const status: JournalEntry['status'] = s.mission?.id === M.id ? 'on' : S.done.includes(M.id) ? 'done' : S.skipped.includes(M.id) ? 'skipped' : (M.after ?? []).every((a) => past.has(a)) ? 'open' : 'later'
      const after = (M.after ?? []).filter((a) => !past.has(a)).map((a) => this.data.missions.missions.find((x) => x.id === a)?.name ?? a)
      return {
        id: M.id, title: M.kind === 'story' ? `Chapter ${M.chapter}: ${M.name}` : M.name, face: c?.id ?? 'karl',
        sub: `${c?.name ?? ''}, ${M.area}`, blurb: status === 'later' ? `After ${after.join(' and ')}. ${M.blurb}` : M.blurb, status,
        at: p ? [p[0], p[1]] : null, skip: status === 'open' || status === 'later',
      }
    }
    // Side stories by neighbourhood, from the park outwards (south, then north to the Wharf).
    const order = ['SoMa', 'The Mission', 'Mission Dolores', 'Noe Valley', 'Calle 24', 'The Castro', 'Twin Peaks', 'Duboce Triangle', 'Lower Haight', 'Hayes Valley', 'Civic Center', 'Downtown',
      'Financial District', 'The Embarcadero', 'Chinatown', 'North Beach', 'Telegraph Hill', 'Russian Hill', "Fisherman's Wharf"]
    const sides = this.data.missions.missions.filter((M) => M.kind === 'side').sort((a, b) => (order.indexOf(a.area) + 99) % 99 - (order.indexOf(b.area) + 99) % 99)
    const ch: JournalEntry[] = this.challenges().map((L) => { const p = this.challengeAt(sim, L), g = this.x.careerProgress(L.id); return { id: `tour:${L.id}`, title: L.name, sub: this.careerLine(L.id), blurb: `Two minutes: S-K-A-T-E, the secret tape, Pro and Sick, and ${L.goals.map((g) => g.name).join(', ')}. Start it at its marker.`, face: 'victorian', status: g && g.done >= g.of ? 'done' : 'open', at: p ? [p.x, p.y] : null } })
    return [
      { id: 'story', title: 'Story', entries: this.data.missions.missions.filter((M) => M.kind === 'story').sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0)).map(entry) },
      { id: 'side', title: 'Side stories', entries: sides.map(entry) },
      { id: 'challenges', title: 'Challenges', entries: ch },
      ...(this.rewards ? [{ id: 'rewards', title: 'Rewards', entries: this.rewardEntries(sim) }] : []),
      { id: 'complete', title: '100%', entries: this.completeEntries() },
    ]
  }

  /** The journal's Rewards page: every skater, deck and outfit the story gives, got or still to get (and from whom). */
  private rewardEntries(sim: Sim): JournalEntry[] {
    const R = this.rewards!, s = session(sim)
    const label: Record<Reward['kind'], string> = { skater: 'Skater', deck: 'Deck', outfit: 'Outfit', piece: 'Create-a-Skater', sticker: 'Milestone' }
    return R.all().map((r) => {
      const got = R.earned(r)
      // An odd jobs' deck: so many gigs from a board.
      if (r.mission.startsWith('gigs:')) {
        const board = r.mission.slice(5), B = this.data.jobs.boards.find((b) => b.id === board), at = this.boards().find((b) => b.B.id === board)?.at
        const need = this.data.jobs.decks.find((d) => d.deck === r.id)?.gigs ?? 0
        return { id: `reward:${r.kind}:${r.id}`, title: `${label[r.kind]}: ${r.name}`, face: this.castOf(B?.host ?? '')?.id ?? 'karl', sub: `${r.missionName}, ${this.castOf(B?.host ?? '')?.name ?? ''}`,
          blurb: got ? 'In the board shop: Skater, then D.' : `${need} gigs from the ${r.missionName} (${Math.min(need, this.gigCount(board))} of ${need}).`, status: got ? 'done' : 'open', at: got || !at ? null : [at[0], at[1]] } as JournalEntry
      }
      const M = this.data.missions.missions.find((x) => x.id === r.mission)!, c = this.castOf(M.giver), p = c ? castAt(sim, s, c.id) : null
      return { id: `reward:${r.kind}:${r.id}`, title: `${label[r.kind]}: ${r.name}`, face: r.art ?? c?.id ?? 'karl', sub: `${M.name}, ${c?.name ?? ''}`,
        blurb: got ? (r.kind === 'deck' ? 'In the board shop: Skater, then D.' : r.kind === 'outfit' ? 'Skater, then left and right.' : r.kind === 'piece' ? 'In Create-a-Skater: Skater, then N.' : 'Skater, or Tab.') : `Finish ${M.name} (${M.area}).`,
        status: got ? 'done' : 'open', at: got || !p ? null : [p[0], p[1]] }
    })
  }

  /** Every category's share, the story's own (chapters, side stories, the Tour's challenge goals) and main's (completion). */
  completion(): { id: string; name: string; n: number; of: number; face: string; left?: string }[] {
    const D = this.data, past = new Set(this.save.done), ms = D.missions.missions
    const story = ms.filter((M) => M.kind === 'story'), sides = ms.filter((M) => M.kind === 'side')
    const nextOf = (L: typeof ms) => L.find((M) => !past.has(M.id) && (M.after ?? []).every((a) => past.has(a) || this.save.skipped.includes(a)))
    const tour = this.challenges().map((L) => this.x.careerProgress(L.id) ?? { done: 0, of: L.goals.length + 4 })
    const nc = nextOf(story), ns = nextOf(sides)
    return [
      { id: 'chapters', name: 'Chapters', n: story.filter((M) => past.has(M.id)).length, of: story.length, face: 'karl', left: nc ? `Next: Chapter ${nc.chapter}, ${nc.name}` : undefined },
      { id: 'sides', name: 'Side stories', n: sides.filter((M) => past.has(M.id)).length, of: sides.length, face: 'pigeon', left: ns ? `Next: ${ns.name} (${this.castOf(ns.giver)?.name ?? ''}, ${ns.area})` : undefined },
      { id: 'challenges', name: 'Challenges', n: tour.reduce((a, g) => a + Math.min(g.done, g.of), 0), of: tour.reduce((a, g) => a + g.of, 0), face: 'victorian', left: 'Every goal of every neighbourhood\'s open challenges.' },
      ...(this.x.completion?.() ?? []),
    ]
  }

  /** The journal's 100% page: the overall share, then each category's, with its title at 100%. */
  private completeEntries(): JournalEntry[] {
    const C = this.d.complete, list = this.completion()
    const pct = (n: number, of: number) => (of ? Math.floor((100 * n) / of) : 100)
    const all = list.reduce((a, c) => a + pct(c.n, c.of), 0) / Math.max(1, list.length), full = list.every((c) => c.n >= c.of)
    const top: JournalEntry = { id: 'complete:all', title: full ? C.overall : 'Overall', value: full ? '100%' : `${Math.floor(all)}%`, sub: full ? 'Everything, everywhere, all of it' : `${list.filter((c) => c.n >= c.of).length} of ${list.length} at 100%`,
      blurb: full ? C.line : 'Chapters, side stories, challenges, milestones, tapes, decks, outfits and Create-a-Skater pieces.', face: '', status: full ? 'done' : 'open', at: null }
    return [top, ...list.map((c) => {
      const p = pct(c.n, c.of), done = c.n >= c.of
      return { id: `complete:${c.id}`, title: c.name, value: `${p}%`, sub: done ? C.titles[c.id] ?? '100%' : `${c.n} of ${c.of}`, blurb: done ? `${C.titles[c.id] ?? 'Done'}. All ${c.of}.` : c.left ?? `${c.of - c.n} to go.`, face: '', status: done ? 'done' : 'open', at: null } as JournalEntry
    })]
  }

  private get data() { return this.x.data }
  private persist() { try { localStorage.setItem(KEY, JSON.stringify(this.save)) } catch { /* private window */ } }
  /** Every line of the story: the missions', the cast's chatter and the odd jobs'. */
  allLines() {
    const D = this.data
    return [...D.cast.cast.flatMap((c) => c.chatter ?? []), ...D.missions.missions.flatMap((M) => [...Object.values(M.fail ?? {}).flat(), ...M.steps.flatMap(stepLines)]), ...jobLines(D.jobs)]
  }
  /** A mission by id: the story's, else one the sim made (an odd job's). */
  missionOf(id: string): Mission | undefined {
    const M = this.data.missions.missions.find((x) => x.id === id)
    if (M) return M
    try { return missionData(this.x.sim(), id) } catch { return undefined }
  }
  private byId: Map<string, ReturnType<StoryClient['allLines']>[number]> | null = null
  line(id: string) { return (this.byId ??= new Map(this.allLines().map((l) => [l.id, l]))).get(id) }
  castOf(id: string) { return this.data.cast.cast.find((c) => c.id === id) }
  isDone(id: string) { return this.save.done.includes(id) }
  /** The missions done (the rewards read it). */
  get doneSet(): ReadonlySet<string> { return new Set(this.save.done) }

  /** A mission done with something to give: the results card (what you got, and where it is), for a few seconds; a click closes it. */
  showResults(M: Mission, got: Reward[]) {
    const where: Record<Reward['kind'], string> = { skater: 'NEW SKATER', deck: 'NEW DECK', outfit: 'NEW OUTFIT', piece: 'CREATE-A-SKATER', sticker: 'MILESTONE' }
    const how: Record<Reward['kind'], string> = { skater: 'Skater, or Tab.', deck: 'Skater, then D for the board.', outfit: 'Skater, then left and right.', piece: 'A new piece: Skater, then N.', sticker: 'Play, then Records.' }
    // A skater it gave turns (its strip); a deck, an outfit, a piece or a milestone is type only (no sticker art).
    const row = (r: Reward) => `<li class="${r.kind}">${r.kind === 'skater' && r.art ? `<span class="turn" style="background-image:url(assets/ui/portrait/turn/${esc(r.art)}.jpg)"></span>` : ''}<span><i>${where[r.kind]}</i><b>${esc(r.name)}</b><em>${how[r.kind]}</em></span></li>`
    this.resultsEl.innerHTML = `<small>${M.kind === 'story' ? `CHAPTER ${M.chapter ?? ''} DONE` : M.kind === 'job' ? 'GIG DONE' : 'STORY DONE'}</small><h3>${esc(M.name)}</h3><ul>${got.map(row).join('')}</ul>`
    this.resultsEl.classList.add('on')
    window.clearTimeout(this.resultsTimer)
    this.resultsTimer = window.setTimeout(() => this.hideResults(), (5 + got.length * 1.2) * 1000)
  }
  hideResults() { this.resultsEl.classList.remove('on') }

  // ---- what is open ----

  /** Missions whose markers show now: not done or skipped, their after missions done or skipped, in this world. */
  available(): Mission[] {
    const S = this.save, past = new Set([...S.done, ...S.skipped]), world = this.x.park.name
    return this.data.missions.missions.filter((M) => M.kind !== 'job' && !past.has(M.id) && (M.after ?? []).every((a) => past.has(a)) && missionWorlds(M).includes(world))
  }
  /** Tour levels played in this world: each neighbourhood's open challenges. */
  challenges(): TourLevel[] { const w = this.x.park.name; return this.data.tour.levels.filter((L) => L.world === w || !!L.worlds?.includes(w)) }
  challengeAt(sim: Sim, L: TourLevel) { const s = findSpot(sim, L.spot); return s ? { x: s.pos.x, y: s.pos.y, z: s.pos.z } : null }

  /** Where each character stands now (home, or where the mission puts them) and the actor Things. */
  private castPlaces(sim: Sim): { c: CastMember; at?: [number, number, number, number]; actor?: Thing }[] {
    const s = session(sim), m = s.mission, M = m ? missionData(sim, m.id) : null
    const actors = sim.world.things.filter((t) => t.kind === 'actor' && t.alive && t.actor)
    return this.data.cast.cast.map((c) => {
      const actor = actors.find((a) => a.actor!.who === c.id)
      if (actor) return { c, actor }
      const at = M && m ? actorPlace(M, m.step, c.id) : null
      if (at) return { c, at }
      // At their anchor inside a city room (cast inside; game/missions.ts insideAnchor), facing the way it does.
      const inside = insideAnchor(sim, c)
      return inside ? { c, at: inside } : { c }
    })
  }

  // ---- the mission's objective ----

  /** Where the mission on wants you (the minimap arrow, the beacon and the route), or null. */
  target(sim: Sim): Target | null {
    const s = session(sim), m = s.mission
    if (!m) return null
    const st = missionData(sim, m.id).steps[m.step], sk = skater(sim)
    const at = (p: [number, number, number] | null, label: string): Target | null => (p ? { x: p[0], y: p[1], z: p[2], label } : null)
    switch (st.kind) {
      case 'talk': return st.phone || m.talk >= 0 ? null : at(castAt(sim, s, st.who), this.castOf(st.who)?.name ?? '')
      case 'go': return at(placeOf(sim, s, st.to), st.text)
      case 'trick': return st.near ? at(placeOf(sim, s, st.near), st.text) : st.box ? { x: (st.box[0] + st.box[2]) / 2, y: (st.box[1] + st.box[3]) / 2, z: sk.pos.z, label: st.text } : null
      case 'collect': {
        const left = st.items.filter((_, i) => !m.got.includes(i)).sort((a, b) => Math.hypot(a[0] - sk.pos.x, a[1] - sk.pos.y) - Math.hypot(b[0] - sk.pos.x, b[1] - sk.pos.y))
        const t = at(left[0] ?? null, st.item)
        return t ? { ...t, ring: true } : null
      }
      case 'deliver': return at(placeOf(sim, s, !m.armed && st.from ? st.from : st.to), st.text)
      case 'follow': { const a = sim.world.things.find((t) => t.id === m.actor); return a ? { x: a.pos.x, y: a.pos.y, z: a.pos.z, label: this.castOf(st.who)?.name ?? '' } : null }
      case 'drive': return at(placeOf(sim, s, st.to), st.text)
      case 'carry': { const a = sim.world.things.find((t) => t.id === m.actor && t.actor?.mode === 'ride'); return a ? at(placeOf(sim, s, st.to), st.text) : at(castAt(sim, s, st.who), this.castOf(st.who)?.name ?? '') }
      case 'race': { const e = st.path[st.path.length - 1], a = sim.world.things.find((t) => t.id === m.actor); return m.armed || !a ? { x: e[0], y: e[1], z: sk.pos.z, label: 'The finish' } : { x: a.pos.x, y: a.pos.y, z: a.pos.z, label: this.castOf(st.who)?.name ?? '' } }
      case 'mode': return null
    }
  }

  // ---- events ----

  event(e: SimEvent) {
    const X = this.x
    switch (e.t) {
      case 'missionStart':
        if (e.mission === this.data.missions.intro && !this.save.intro) { this.save.intro = true; this.persist() }
        break
      case 'talk': {
        const l = this.line(e.line), c = this.castOf(e.character)
        if (!l || !c) break
        if (e.bark) { X.sound.say(e.line); break }
        this.talkingMission = e.mission
        this.challengeOffer = null
        this.dialogue.show({ face: c.id, name: c.name, text: l.text, n: e.n, of: e.of })
        X.sound.speak(e.line)
        break
      }
      case 'missionOffer': {
        // The offer under its last line (the ask), also when Esc skipped there.
        const st = this.data.missions.missions.find((x) => x.id === e.mission)?.steps[0]
        const l = st?.kind === 'talk' ? st.lines[st.lines.length - 1] : null, c = l ? this.castOf(l.who) : null
        if (st?.kind === 'talk' && l && c && this.dialogue.isOpen && !this.dialogue.showing(l.text)) { this.dialogue.offer(['Accept', 'Not now'], { face: c.id, name: c.name, text: l.text, n: st.lines.length - 1, of: st.lines.length }); X.sound.speak(l.id) }
        else this.dialogue.offer(['Accept', 'Not now'])
        break
      }
      case 'missionStep': {
        this.closeTalk()
        this.wrapping = e.kind === 'mode'
        break
      }
      case 'missionDone': {
        this.closeTalk(); this.wrapping = false
        if (e.kind === 'job') { this.gigDone(e); this.onDone(e); break }
        if (!this.save.done.includes(e.mission)) this.save.done.push(e.mission)
        this.save.skipped = this.save.skipped.filter((x) => x !== e.mission)
        this.persist()
        const M = this.data.missions.missions.find((x) => x.id === e.mission)
        const got = M && this.rewards ? this.rewards.of(M) : []
        const results = () => { if (M && got.length) this.showResults(M, got); else X.ui.popUp(M?.kind === 'story' ? `CHAPTER ${M.chapter ?? ''} DONE` : 'STORY DONE', e.name, 'goal') }
        // The finale: the credits roll first, then what it gave.
        if (e.mission === this.d.finale) this.rollCredits(results)
        else results()
        this.onDone(e)
        break
      }
      case 'missionSkipped':
        this.closeTalk(); this.wrapping = false
        if (this.missionOf(e.mission)?.kind === 'job') { X.ui.toast(`Left: ${this.missionOf(e.mission)?.name ?? e.mission}. It stays on the board today.`); break }
        if (!this.save.skipped.includes(e.mission) && !this.save.done.includes(e.mission)) this.save.skipped.push(e.mission)
        this.persist()
        X.ui.toast(`Skipped: ${this.data.missions.missions.find((x) => x.id === e.mission)?.name ?? e.mission}. The story moves on.`)
        break
      case 'missionAbandoned': {
        this.closeTalk(); this.wrapping = false
        const AM = this.missionOf(e.mission), giver = AM?.giver
        if (e.reason === 'declined' && giver) this.mutedUntil.set(giver, performance.now() + this.d.pacing.call.afterNo * 1000)   // Not now: they don't call out again for a while
        if (e.reason !== 'declined') X.ui.toast(AM?.kind === 'job' ? `Left: ${AM.name}. It stays on the board today.` : `Left: ${AM?.name ?? e.mission}. Its marker is still there.`)
        break
      }
      case 'missionFailed': {
        this.closeTalk(); this.wrapping = false
        const M = this.missionOf(e.mission)
        if (!M) break
        const say = M.fail?.[e.reason]?.[0], c = this.castOf(say?.who ?? M.giver)
        X.ui.popUp('MISSION FAILED', M.name, 'ghost-behind')
        // Try again from the latest checkpoint at or before the failed step (retry), else from the first step after the offer.
        const step = M.kind === 'job' ? 0 : Math.max(1, ...(M.retry ?? []).filter((r) => r <= e.step))   // a gig has one step and no offer
        this.retryOffer = { id: M.id, step }
        this.challengeOffer = null
        this.dialogue.show({ face: c?.id ?? 'karl', name: c?.name ?? '', text: say?.text ?? `${M.name}: that did not work out.`, n: 0, of: 1 })
        this.dialogue.offer(['Try again', 'Not now'])
        if (say) X.sound.speak(say.id)
        break
      }
      case 'missionItem': X.ui.popUp(e.item.toUpperCase(), e.of > 1 ? `${e.n} of ${e.of}` : 'picked up', 'goal'); break
    }
  }

  /** Is a game over event part of a mission (no results card: the mission goes on)? */
  get wrapped() { return this.wrapping }

  private closeTalk() {
    if (!this.talkingMission) return
    this.talkingMission = null
    if (!this.challengeOffer) this.dialogue.hide()
    this.x.sound.stopSpeaking()
  }

  /** The dialogue box is up (the player's keys are held; Esc and Space go to it). */
  get talking() { return this.dialogue.isOpen }
  /** Where the one speaking stands (the conversation camera frames them with the skater; director.ts), or null. */
  speakerAt(sim: Sim): { x: number; y: number; z: number } | null {
    const f = this.dialogue.speaker, p = f ? castAt(sim, session(sim), f) : null
    return p ? { x: p[0], y: p[1], z: p[2] } : null
  }

  /** While talking: the skater coasts to a stop (a foot brake when rolling), nothing else. */
  filterInput(b: number, sk: Thing) {
    if (!this.talking) return b
    return sk.state === 'ground' && Math.hypot(sk.vel.x, sk.vel.y) > 0.6 ? Btn.down : 0
  }

  // ---- the odd jobs' gig boards (data/jobs.json, game/jobs.ts) ----

  /** Today, the San Francisco date: the boards' gigs are the same for everyone that day. */
  today() { return sfDay() }
  /** The gig boards open (their after missions done or skipped) in this world's rooms, with where each is. */
  boards(): { B: Board; at: [number, number, number, number] }[] {
    const J = this.data.jobs, past = new Set([...this.save.done, ...this.save.skipped]), sim = this.x.sim()
    if (!J.after.every((a) => past.has(a))) return []
    return J.boards.flatMap((B) => { const at = boardPlace(sim, B); return at ? [{ B, at }] : [] })
  }
  private gigCache = new Map<string, Mission[]>()
  /** A board's gigs today (made once a day) and how many of them are done. */
  gigsToday(board: string): { jobs: Mission[]; done: number; day: string } {
    const day = this.today(), key = `${board}:${day}`, done = this.doneToday()
    let jobs = this.gigCache.get(key)
    if (!jobs) { jobs = jobsFor(this.x.sim(), board, day); this.gigCache.set(key, jobs) }
    return { jobs, done: jobs.filter((M) => done.includes(M.id)).length, day }
  }
  private doneToday(): string[] { const j = this.save.jobs; return j && j.day === this.today() ? j.done : [] }

  /** The board's card: the host's line, today's gigs to pick (done ones ticked; they can be played again), Not now. */
  private openBoard(B: Board) {
    const X = this.x, g = this.gigsToday(B.id), done = this.doneToday(), c = this.castOf(B.host)
    const l = g.done >= g.jobs.length ? B.empty : B.hello
    this.boardOffer = { board: B.id, day: g.day, jobs: g.jobs }
    this.challengeOffer = null
    this.dialogue.show({ face: c?.id ?? 'karl', name: `${B.name}: today`, text: l.text, n: 0, of: 1 })
    X.sound.speak(l.id)
    this.dialogue.offer([...g.jobs.map((M) => `${this.gigLabel(M)}${done.includes(M.id) ? '\u2003done' : ''}`), 'Not now'], undefined, true)
  }
  private gigLabel(M: Mission) {
    const st = M.steps[0]
    if (st.kind === 'deliver' && st.seconds) return `${st.text}, ${Math.floor(st.seconds / 60)}:${String(st.seconds % 60).padStart(2, '0')}`
    if (st.kind === 'carry') return `${st.text}, the van's outside`
    return st.text
  }
  /** A gig done: ticked for today, counted for its board; a deck it opens on the results card, else a pop-up. */
  private gigDone(e: Extract<SimEvent, { t: 'missionDone' }>) {
    const M = this.missionOf(e.mission), day = M?.job?.day ?? this.today(), board = e.board ?? M?.job?.board ?? ''
    const j = this.save.jobs?.day === day ? this.save.jobs : (this.save.jobs = { day, done: [] })
    if (!j.done.includes(e.mission)) j.done.push(e.mission)
    const gigs = (this.save.gigs ??= {}), n = (gigs[board] = (gigs[board] ?? 0) + 1)
    this.persist()
    const got = this.rewards?.gigDecks(board, n) ?? []
    if (M && got.length) this.showResults(M, got)
    else this.x.ui.popUp('GIG DONE', e.name, 'goal')
  }
  /** Gigs done from a board, ever (the decks it opens). */
  gigCount(board: string) { return this.save.gigs?.[board] ?? 0 }

  // ---- the talk key ----

  /** The talk key: the character or the challenge by you, if any. */
  interact() {
    const n = this.near, X = this.x
    if (!n || this.talking) return
    if (n.kind === 'mission') { void X.queue(`mission start ${n.m.id}`).then((r) => { if (!r.ok) X.ui.toast(r.text) }); return }
    if (n.kind === 'board') { this.openBoard(n.B); return }
    if (n.kind === 'challenge') {
      const L = n.L, goals = 4 + L.goals.length
      this.challengeOffer = L
      this.dialogue.show({ face: 'victorian', name: `${L.name}: challenges`, text: `${goals} goals in two minutes: S-K-A-T-E, the secret tape, Pro and Sick scores, and ${L.goals.map((g) => g.name).join(', ')}.`, n: 0, of: 1 })
      this.dialogue.offer(['Start (2:00)', 'Not now'])
      return
    }
    // After the finale: their post-game line first, once.
    if (this.postDue(n.c)) { this.sayPost(n.c); return }
    // Chatter: their next line, said and captioned (no mission to give right now).
    const l = this.nextChatter(n.c)
    if (l) X.sound.say(l)
  }

  private nextChatter(c: CastMember): string | null {
    const ls = c.chatter ?? []
    if (!ls.length) return null
    const i = (this.chatAt.get(c.id) ?? -1) + 1
    this.chatAt.set(c.id, i)
    return ls[i % ls.length].id
  }
  private postDue(c: CastMember) { return !!c.post?.length && this.save.done.includes(this.d.finale) && !(this.save.post ?? []).includes(c.id) }
  private sayPost(c: CastMember) { (this.save.post ??= []).push(c.id); this.persist(); this.x.sound.say(c.post![0].id) }

  /**
   * Pacing (data/story.json pacing): a character with a story to give calls out once as you pass
   * (one of their chatter lines, captioned), each at most every call.repeat seconds, never within
   * call.gap of another call, not after Not now for call.afterNo, not in the first call.warmup seconds,
   * not within talking distance (the prompt is enough there). After the finale, each main character's
   * post-game line, once, as you pass.
   */
  private pace(sim: Sim, places: ReturnType<StoryClient['castPlaces']>, now: number) {
    const P = this.d.pacing, sk = skater(sim)
    if (now - this.startedAt < P.call.warmup * 1000 || now - this.lastCall < P.call.gap * 1000) return
    const open = new Set(this.available().map((M) => M.giver))
    let best: { c: CastMember; post: boolean } | null = null, bd = Infinity
    for (const p of places) {
      const at = p.actor ? [p.actor.pos.x, p.actor.pos.y, p.actor.pos.z] : p.at ?? p.c.home
      const d = Math.hypot(at[0] - sk.pos.x, at[1] - sk.pos.y)
      if (d >= bd || Math.abs(at[2] - sk.pos.z) > 4) continue
      if (d < P.post.radius && this.postDue(p.c)) { best = { c: p.c, post: true }; bd = d; continue }
      if (!open.has(p.c.id) || d > P.call.radius || d < this.d.interact.radius || !p.c.chatter?.length) continue
      if ((this.mutedUntil.get(p.c.id) ?? 0) > now || now - (this.calledAt.get(p.c.id) ?? -Infinity) < P.call.repeat * 1000) continue
      best = { c: p.c, post: false }; bd = d
    }
    if (!best) return
    this.lastCall = now
    if (best.post) { this.callLog.push({ who: `${best.c.id}:post`, at: now }); this.sayPost(best.c); return }
    this.callLog.push({ who: best.c.id, at: now })
    this.calledAt.set(best.c.id, now)
    const l = this.nextChatter(best.c)
    if (l) this.x.sound.say(l)
  }

  /** The finale's credits: the cast, then data/ui.json's credits, rolling for credits.seconds (the game paused); any key or a click ends them. */
  rollCredits(after: () => void) {
    this.endCredits()
    const X = this.x, el = document.createElement('div')
    el.className = 'story-credits'
    const cast = this.data.cast.cast.map((c) => `<div class="cr-cast"><img src="assets/ui/portrait/${esc(c.id)}.jpg" alt="" onerror="this.style.visibility='hidden'"><b>${esc(c.name)}</b><span>${esc(c.trait)}</span></div>`).join('')
    const rest = X.credits.map((c) => `<h2>${esc(c.title)}</h2>${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}`).join('')
    el.innerHTML = `<div class="cr-roll" style="animation-duration:${this.d.credits.seconds}s"><h1>SAVE SOMA WEST</h1><p class="cr-sub">A SoMa Skate story</p><h2>Starring</h2><div class="cr-grid">${cast}</div>${rest}<h1 class="cr-end">The park stays.</h1><p class="cr-sub">The city is still out there. Everybody still needs something.</p></div><div class="cr-skip">any key: back to the city</div>`
    X.root.appendChild(el)
    this.creditsEl = el
    this.afterCredits = after
    this.dialogue.hide()
    X.onOverlay(true)
    const end = () => this.endCredits()
    el.querySelector('.cr-roll')!.addEventListener('animationend', end)
    el.addEventListener('pointerdown', end)
    this.creditsKey = (e: KeyboardEvent) => { e.preventDefault(); e.stopImmediatePropagation(); end() }
    window.setTimeout(() => { if (this.creditsEl === el && this.creditsKey) window.addEventListener('keydown', this.creditsKey, true) }, 600)   // a key still held from the last line does not end them at once
  }
  private creditsKey: ((e: KeyboardEvent) => void) | null = null
  private endCredits() {
    if (!this.creditsEl) return
    this.creditsEl.remove(); this.creditsEl = null
    if (this.creditsKey) window.removeEventListener('keydown', this.creditsKey, true)
    this.creditsKey = null
    this.x.onOverlay(false)
    const after = this.afterCredits; this.afterCredits = null
    after?.()
  }

  /**
   * Start the first mission (chapter 1) by itself the first time the game is played here: introDelay
   * seconds after the first key, click or pad button (when the browser lets the sound start, so Karl's
   * first line is heard: "Oh good, you're up."), or after introWait seconds without any.
   */
  boot(now: number) {
    const intro = this.data.missions.missions.find((M) => M.id === this.data.missions.intro)
    if (!this.save.intro && intro && missionWorlds(intro).includes(this.x.park.name) && !this.save.done.includes(intro.id) && !this.save.skipped.includes(intro.id)) this.introAt = now + this.d.introWait * 1000
  }
  /** The player did something (main: the first key, click or pad button): the intro comes introDelay later. */
  woke(now: number) { if (this.introAt > 0) this.introAt = Math.min(this.introAt, now + this.d.introDelay * 1000) }

  /** Journal: mark a mission skipped without playing it (the story moves on). */
  skipUnplayed(id: string) {
    if (!this.save.skipped.includes(id) && !this.save.done.includes(id)) this.save.skipped.push(id)
    this.persist()
  }

  /** The waypoint has been more than reached metres away since it was set (only then does coming to it clear it). */
  private wpFar = false
  setWaypoint(p: [number, number] | null) { this.save.waypoint = p; this.route = null; this.wpFar = false; this.persist() }

  /** Pause menu entries for the mission on (skip, abandon). */
  menuItems(sim: Sim): MenuItem[] {
    const m = session(sim).mission
    if (!m) return []
    const M = missionData(sim, m.id)
    const face = `assets/ui/portrait/${M.giver}.jpg`
    if (M.kind === 'job') return [{ id: 'story-abandon', label: 'Abandon gig', preview: () => ({ img: face, title: M.name, text: 'It stays on the board today.' }), onSelect: () => void this.x.queue('mission abandon') }]
    return [
      { id: 'story-skip', label: 'Skip mission', preview: () => ({ img: face, title: M.name, text: 'Marked skipped. The story moves on.' }), onSelect: () => void this.x.queue('mission skip') },
      { id: 'story-abandon', label: 'Abandon mission', preview: () => ({ img: face, title: M.name, text: `Start it again from ${this.castOf(M.giver)?.name ?? 'its marker'}.` }), onSelect: () => void this.x.queue('mission abandon') },
    ]
  }
  /** The mission's step now, in a line (the pause menu's preview); '' with none on. */
  get objective(): string {
    const m = session(this.x.sim()).mission
    return m ? missionData(this.x.sim(), m.id).steps[m.step]?.text ?? '' : ''
  }

  // ---- each frame ----

  frame(now: number, cam: THREE.Vector3, style: string, menuOpen: boolean, marksHidden = menuOpen) {
    const X = this.x, sim = X.sim(), s = session(sim), sk = skater(sim), dt = Math.min(0.1, (now - this.lastNow) / 1000)
    this.lastNow = now
    if (this.introAt > 0 && now >= this.introAt && !menuOpen) {
      this.introAt = -1
      if (!s.mission && s.mode === 'free') void X.queue(`mission start ${this.data.missions.intro}`)
    }
    // The cast where they stand, the markers over those with a story to give.
    const places = this.castPlaces(sim)
    // The people castpeople.ts draws: where the mission puts them, hidden while a ride (an actor) is drawn here.
    const P = X.people
    if (P) for (const p of places) if (P.has(p.c.id)) P.setOverride(p.c.id, p.actor ? 'hidden' : p.at ? { x: p.at[0], y: p.at[1], z: p.at[2], heading: p.at[3] } : null)
    this.cast.style = style
    this.cast.update(places, sk.pos, sim.world.tick, sim.data, dt)
    const free = !s.mission && s.mode === 'free'
    const marks: Marker[] = []
    if (free) {
      for (const M of this.available()) {
        const p = places.find((q) => q.c.id === M.giver)
        if (!p) continue
        const at = p.actor ? [p.actor.pos.x, p.actor.pos.y, p.actor.pos.z] : p.at ?? p.c.home
        marks.push({ key: `m:${M.id}`, kind: M.kind, x: at[0], y: at[1], z: at[2], sticker: p.c.sticker })
      }
      for (const L of this.challenges()) { const p = this.challengeAt(sim, L); if (p) marks.push({ key: `c:${L.id}`, kind: 'challenge', x: p.x, y: p.y, z: p.z }) }
      for (const { B, at } of this.boards()) marks.push({ key: `b:${B.id}`, kind: 'job', x: at[0], y: at[1], z: at[2] })
    }
    const m = s.mission
    if (m) {
      const st = missionData(sim, m.id).steps[m.step]
      if (st.kind === 'collect') st.items.forEach((p, i) => { if (!m.got.includes(i)) marks.push({ key: `i:${m.id}:${m.step}:${i}`, kind: 'item', x: p[0], y: p[1], z: p[2] }) })
    }
    this.markers.set(marks, cam, now / 1000)
    this.markers.group.visible = !marksHidden && !this.overlay
    if (this.startedAt < 0) this.startedAt = now
    if (free && !menuOpen && !this.talking && !this.overlay) this.pace(sim, places, now)
    // The talk prompt: the nearest character with something to say, or a neighbourhood's challenges.
    this.near = menuOpen || this.talking ? null : this.findNear(sim, places, free)
    this.drawPrompt()
    this.drawObjective(sim)
    // Visited spots (for Take Muni) and the waypoint reached.
    if (++this.visitTick % 30 === 0) {
      for (const sp of sim.park.spots) if (this.data.spots.labels?.[sp.id] && !this.save.visited.includes(sp.id) && Math.hypot(sp.pos.x - sk.pos.x, sp.pos.y - sk.pos.y) < this.d.visitRadius) { this.save.visited.push(sp.id); this.persist() }
      const w = this.save.waypoint
      const wd = w ? Math.hypot(w[0] - sk.pos.x, w[1] - sk.pos.y) : Infinity
      if (w && wd > this.d.route.reached) this.wpFar = true
      else if (w && this.wpFar && !this.overlay) { this.setWaypoint(null); X.ui.toast('Waypoint reached') }
    }
    this.updateRoute(sim, now)
  }

  private findNear(sim: Sim, places: ReturnType<StoryClient['castPlaces']>, free: boolean): Near | null {
    const sk = skater(sim), R = this.d.interact
    let best: Near | null = null, bd = Infinity
    const open = free ? new Map(this.available().map((M) => [M.giver, M])) : new Map<string, Mission>()
    for (const p of places) {
      const at = p.actor ? [p.actor.pos.x, p.actor.pos.y, p.actor.pos.z] : p.at ?? p.c.home
      const d = Math.hypot(at[0] - sk.pos.x, at[1] - sk.pos.y)
      if (d > R.radius || Math.abs(at[2] - sk.pos.z) > 3 || d >= bd) continue
      const M = open.get(p.c.id)
      if (M) { best = { kind: 'mission', m: M, c: p.c }; bd = d }
      else if (p.c.chatter?.length) { best = { kind: 'chat', c: p.c }; bd = d }
    }
    // A gig board, when it is nearer than anyone.
    if (free) for (const { B, at } of this.boards()) {
      const d = Math.hypot(at[0] - sk.pos.x, at[1] - sk.pos.y)
      if (d <= R.radius && Math.abs(at[2] - sk.pos.z) <= 3 && d < bd) { best = { kind: 'board', B, x: at[0], y: at[1] }; bd = d }
    }
    if (best || !free) return best
    for (const L of this.challenges()) {
      const p = this.challengeAt(sim, L)
      if (p && Math.hypot(p.x - sk.pos.x, p.y - sk.pos.y) < R.challengeRadius) return { kind: 'challenge', L, x: p.x, y: p.y }
    }
    return null
  }

  /** The prompt shows the talk key (or the pad's triangle, or the touch button). */
  get prompting() { return !!this.near }
  private drawPrompt() {
    const n = this.near
    this.promptEl.classList.toggle('on', !!n)
    this.talkBtn.classList.toggle('on', !!n && this.x.touch())
    if (!n) return
    const key = this.x.talkKeys()[0]?.replace(/^Key/, '') ?? 'F'
    const g = n.kind === 'board' ? this.gigsToday(n.B.id) : null
    const what = n.kind === 'mission' ? `Talk to ${n.c.name}` : n.kind === 'chat' ? `Talk to ${n.c.name}` : n.kind === 'board' ? n.B.name : `${n.L.name}: open challenges`
    const sub = n.kind === 'mission' ? n.m.name : n.kind === 'challenge' ? 'S-K-A-T-E, the tape, three goals' : g ? `${g.jobs.length} gigs today${g.done ? `, ${g.done} done` : ''}` : ''
    const html = `${this.x.touch() ? '' : `<kbd>${esc(key)}</kbd>`}<b>${esc(what)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}`
    if (this.promptEl.innerHTML !== html) this.promptEl.innerHTML = html
  }

  private drawObjective(sim: Sim) {
    const s = session(sim), m = s.mission, sk = skater(sim)
    this.objEl.classList.toggle('on', !!m && !this.talking)
    if (!m) return
    const M = missionData(sim, m.id), st = M.steps[m.step], hz = sim.data.physics.tickHz
    const bits: string[] = []
    if (st.kind === 'trick' && (st.count ?? 1) > 1) bits.push(`${m.count} / ${st.count}`)
    if (st.kind === 'collect') bits.push(`${m.got.length} / ${st.items.length}`)
    if (m.clock > 0) { const secs = Math.ceil(m.clock / hz); bits.push(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`) }
    const t = this.target(sim)
    if (t) { const d = Math.hypot(t.x - sk.pos.x, t.y - sk.pos.y); if (d > 15) bits.push(d >= 1000 ? `${(d / 1000).toFixed(1)} km` : `${Math.round(d)} m`) }
    // Mono, spaced, no separators (docs/art-direction.md: no middle dots).
    const head = M.kind === 'story' ? `Chapter ${M.chapter ?? ''} ${M.name}` : M.kind === 'job' ? `Gig ${M.name}` : M.name
    const html = `<b>${esc(head)}</b><span>${esc(st.text)}</span>${bits.length ? `<i class="${m.clock > 0 && m.clock / hz <= 10 ? 'hurry' : ''}">${bits.join(' ')}</i>` : ''}`
    if (this.objEl.innerHTML !== html) this.objEl.innerHTML = html
  }

  // ---- the waypoint's route and the minimap ----

  /** The route's goal: the waypoint, else the mission's objective when it is far. */
  private routeGoal(sim: Sim): [number, number] | null {
    if (this.save.waypoint) return this.save.waypoint
    const t = this.target(sim), sk = skater(sim)
    return t && Math.hypot(t.x - sk.pos.x, t.y - sk.pos.y) > 60 ? [t.x, t.y] : null
  }

  private updateRoute(sim: Sim, now: number) {
    const goal = this.routeGoal(sim), sk = skater(sim)
    if (!goal || !sim.park.traffic.paths.length) { this.route = null; return }
    const r = this.route
    const off = r ? Math.min(...r.pts.map((p) => Math.hypot(p[0] - sk.pos.x, p[1] - sk.pos.y))) : Infinity
    if (r && r.to[0] === goal[0] && r.to[1] === goal[1] && now - r.at < this.d.route.every * 1000 && off < this.d.route.off) return
    if (r && r.to[0] === goal[0] && r.to[1] === goal[1] && now - r.at < 600) return   // at most every 0.6 s
    const pts = streetWay(sim.park, sim.data.run.escape, sk.pos.x, sk.pos.y, goal[0], goal[1])
    this.route = { to: goal, pts: pts ?? [], at: now }
  }


  private drawMinimap(g: CanvasRenderingContext2D, at: (x: number, y: number) => { x: number; y: number; r: number }, size: number) {
    const sim = this.x.sim(), s = session(sim), lim = size / 2 - 7
    // The route: from the street point nearest you on, as far as the minimap shows.
    const R = this.route
    if (R && R.pts.length > 1) {
      const sk = skater(sim)
      let i0 = 0, bd = Infinity
      R.pts.forEach((p, i) => { const d = Math.hypot(p[0] - sk.pos.x, p[1] - sk.pos.y); if (d < bd) { bd = d; i0 = i } })
      g.save(); g.beginPath(); g.rect(0, 0, size, size); g.clip()
      g.strokeStyle = '#ff4f1f'; g.lineWidth = 2; g.lineCap = 'round'; g.lineJoin = 'round'; g.setLineDash([2, 5])
      g.beginPath()
      const first = at(sk.pos.x, sk.pos.y); g.moveTo(first.x, first.y)
      for (let i = i0; i < R.pts.length; i++) { const q = at(R.pts[i][0], R.pts[i][1]); g.lineTo(q.x, q.y); if (q.r > size) break }
      g.stroke(); g.restore()
    }
    // The waypoint: an accent square, or a triangle on the edge when it is off the minimap.
    const w = this.save.waypoint
    if (w) {
      const q = at(w[0], w[1])
      if (q.r > lim) { const k = lim / q.r, px = size / 2 + (q.x - size / 2) * k, py = size / 2 + (q.y - size / 2) * k; g.save(); g.translate(px, py); g.rotate(Math.atan2(q.y - size / 2, q.x - size / 2)); g.fillStyle = '#ff4f1f'; g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -5); g.lineTo(-4, 5); g.closePath(); g.fill(); g.restore() }
      else { g.fillStyle = '#ff4f1f'; g.fillRect(q.x - 4, q.y - 4, 8, 8) }
    }
    if (s.mode !== 'free' && !s.mission) return
    // Simple marks, no faces (docs/art-direction.md): everyone a small paper dot; a story to give a bigger
    // dot (the accent for the main story), on the edge as a triangle when it is off the square; challenges a diamond.
    const dot = (x: number, y: number, r: number, color: string) => { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill() }
    const giving = new Set(s.mission ? [] : this.available().map((M) => M.giver))
    for (const c of this.data.cast.cast) {
      if (giving.has(c.id)) continue
      const p = castAt(sim, s, c.id)
      if (!p) continue
      const q = at(p[0], p[1])
      if (q.r <= lim) dot(q.x, q.y, 2, 'rgba(242,239,232,0.6)')
    }
    if (s.mission) return
    const sk = skater(sim), far: { q: { x: number; y: number; r: number }; kind: string; d: number }[] = []
    for (const M of this.available()) {
      const c = this.castOf(M.giver), p = c ? castAt(sim, s, c.id) : null
      if (!c || !p) continue
      const q = at(p[0], p[1]), d = Math.hypot(p[0] - sk.pos.x, p[1] - sk.pos.y)
      if (q.r <= lim) dot(q.x, q.y, 4, M.kind === 'story' ? '#ff4f1f' : '#f2efe8')
      else if (d < this.d.pacing.rim.range) far.push({ q, kind: M.kind, d })
    }
    // The nearest stories past the edge (within rim.range): triangles on the edge, pointing the way.
    for (const f of far.sort((a, b) => a.d - b.d).slice(0, this.d.pacing.rim.count)) {
      const k = lim / f.q.r, px = size / 2 + (f.q.x - size / 2) * k, py = size / 2 + (f.q.y - size / 2) * k
      g.save(); g.translate(px, py); g.rotate(Math.atan2(f.q.y - size / 2, f.q.x - size / 2))
      g.fillStyle = f.kind === 'story' ? '#ff4f1f' : '#f2efe8'; g.beginPath(); g.moveTo(5, 0); g.lineTo(-3.5, -4); g.lineTo(-3.5, 4); g.closePath(); g.fill()
      g.restore()
    }
    for (const { at: b } of this.boards()) {
      const q = at(b[0], b[1])
      if (q.r > lim) continue
      g.fillStyle = '#5fd17a'; g.strokeStyle = '#111014'; g.lineWidth = 1.5; g.beginPath(); g.roundRect(q.x - 5, q.y - 5, 10, 10, 2); g.fill(); g.stroke()
    }
    for (const L of this.challenges()) {
      const p = this.challengeAt(sim, L)
      if (!p) continue
      const q = at(p.x, p.y)
      if (q.r > lim) continue
      g.save(); g.translate(q.x, q.y); g.rotate(Math.PI / 4); g.fillStyle = '#f2efe8'; g.fillRect(-3, -3, 6, 6); g.restore()
    }
  }
}
