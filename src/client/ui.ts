import { z } from 'zod'
import { session, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import { airName, comboValue, trickDef } from '../sim/tricks/tricks.ts'
import { bombRoute } from '../sim/game/modes.ts'

// The game's UI: HUD (score, timer, special, S-K-A-T-E, goals, the trick string,
// balance), pops for gaps, letters and goals, landed and slammed callouts with stickers,
// the menu, results, toasts and the radio's now-playing strip. THPS bones, Inter type,
// International Orange, San Francisco jokes from data/ui.json. Draw-only: it reads sim
// state and events and never changes them. Type only (docs/art-direction.md): no stickers, no bursts.

const tier = z.object({ min: z.number().min(0), lines: z.array(z.string()).min(1) }).strict()
export const uiSchema = z.object({
  _doc: z.string().optional(), rent: z.number().positive(), burrito: z.number().positive(), comboHoldSeconds: z.number().positive(),
  praise: z.array(tier).min(1), bail: z.array(z.string()).min(1), taglines: z.array(z.string()).min(1), tips: z.array(z.string()).min(1),
  results: z.array(z.string()).min(1),
  signatures: z.record(z.string(), z.record(z.string(), z.string())).optional(),
  hints: z.array(z.object({ id: z.string(), text: z.string() }).strict()).optional(),
  carHit: z.array(z.string()).optional(), robotaxiHit: z.array(z.string()).optional(), pedHit: z.array(z.string()).optional(),
  credits: z.array(z.object({ title: z.string(), lines: z.array(z.string()) }).strict()).optional(),
  places: z.object({
    holdSeconds: z.number().nonnegative(), cooldownSeconds: z.number().nonnegative(), showSeconds: z.number().positive(),
    spots: z.array(z.object({ name: z.string(), at: z.tuple([z.number(), z.number()]), r: z.number().positive(), box: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(), line: z.string() }).strict()),
    hoods: z.array(z.object({ name: z.string(), at: z.tuple([z.number(), z.number()]), line: z.string() }).strict()),
  }).strict().optional(),
}).strict()
export type UiData = z.infer<typeof uiSchema>

type Trick = { id: string; name: string; dir?: string; points?: number }
type Rail = { id: string; name: string; dirs?: string[]; points?: number }
/** What the menu's preview area shows for the selected item: an image (a portrait, a photograph), a title, a line, a few rows. */
export type Preview = { img?: string; wide?: boolean; title?: string; text?: string; rows?: [string, string][] }
/** value: a short state shown beside the label (mono); hint or preview: what the preview area says; off: drawn dim (not available here). */
export type MenuItem = { id: string; label: string; key?: string; value?: () => string; hint?: string; off?: boolean; preview?: () => Preview | null; onSelect: () => void }
type MenuLevel = { id: string; title: string; items: MenuItem[]; sel: number }

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)]
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')
/** A Muni stop as riders say it: 'Market Street & Sanchez Street' is Sanchez Street. */
const stopName = (n: string) => n.includes(' & ') ? n.slice(n.lastIndexOf(' & ') + 3) : n
const escHtml = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
const EM = '\u2003'   // spacing, not separators (docs/art-direction.md)
const ord = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; if (html) e.innerHTML = html; parent.appendChild(e); return e
}

export class Hud {
  private d: UiData
  private root: HTMLElement
  private scoreN: HTMLElement
  private shownScore = 0
  private special: HTMLElement
  private specialWrap: HTMLElement
  private timer: HTMLElement
  private burritoEl!: HTMLElement
  private modeEl!: HTMLElement
  /** Best Hill Bomb time (seconds) in this browser. */
  bombBest(route = 'dolores'): number | null { try { const v = Number(localStorage.getItem(this.bombKey(route))); return v > 0 ? v : null } catch { return null } }
  private bombKey(route: string) { return route === 'dolores' ? 'soma-skate:bomb-best' : `soma-skate:bomb-best:${route}` }
  /** Hill bomb rivals home so far in this race (racerFinish), for the HUD and the results. */
  private racers: { name: string; place: number; time: number }[] = []
  private racerNames: string[] = []   // this race's rivals, fastest first (data order)
  /** Name tags over the hill bomb rivals: screen positions from main each frame. */
  private tagEls = new Map<number, HTMLElement>()
  racerTags(tags: { id: number; name: string; x: number; y: number; scale: number }[]) {
    const seen = new Set<number>()
    for (const t of tags) {
      let tag = this.tagEls.get(t.id)
      if (!tag) { tag = el('div', `racer-tag${t.id < 0 ? ' ghost-tag' : ''}`, this.root); tag.textContent = t.name; this.tagEls.set(t.id, tag) }
      tag.style.transform = `translate(${t.x.toFixed(1)}px, ${t.y.toFixed(1)}px) translate(-50%, -100%) scale(${t.scale.toFixed(2)})`
      seen.add(t.id)
    }
    for (const [id, tag] of this.tagEls) if (!seen.has(id)) { tag.remove(); this.tagEls.delete(id) }
  }
  /** The floating combos over park NPCs (tags.ts npcPopTags): smaller than yours, in the same style. */
  private popEls = new Map<string, HTMLElement>()
  npcPops(pops: { key: string; name: string; points: number; multiplier: number; x: number; y: number; scale: number; opacity: number }[]) {
    const seen = new Set<string>()
    for (const p of pops) {
      let e = this.popEls.get(p.key)
      if (!e) {
        e = el('div', 'npc-pop', this.root, `<b></b><span>+${fmt(p.points)}${p.multiplier > 1 ? ` <small>×${p.multiplier}</small>` : ''}</span>`)
        e.querySelector('b')!.textContent = p.name
        this.popEls.set(p.key, e)
      }
      e.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%) scale(${p.scale.toFixed(2)})`
      e.style.opacity = p.opacity.toFixed(2)
      seen.add(p.key)
    }
    for (const [k, e] of this.popEls) if (!seen.has(k)) { e.remove(); this.popEls.delete(k) }
  }
  private skateName = 'Local'
  /** The S.K.A.T.E. local's line, in the toast. */
  private localSays(line: string) { if (line) this.toast(`${this.skateName}: “${line}”`) }
  /** Hill bomb route names by id (set from the data). */
  bombNames: Record<string, string> = {}
  /** A game mode's best (muni: fastest win in s; escape: best surviving score). */
  modeBest(k: string): number | null { const v = this.bests()[k]; return v === undefined ? null : v }
  private bests(): Record<string, number> { try { return JSON.parse(localStorage.getItem('soma-skate:mode-bests') ?? '{}') } catch { return {} } }
  private setBest(k: string, v: number) { try { localStorage.setItem('soma-skate:mode-bests', JSON.stringify({ ...this.bests(), [k]: v })) } catch { /* private window */ } }

  /** Results card for the game modes. */
  modeResults(e: SimEvent, again: string) {
    let title = '', big = '', line = '', rows: [string, string][] = [], best = false
    if (e.t === 'courierOver' || e.t === 'courierFail') {
      const n = e.t === 'courierOver' ? e.deliveries : e.delivered
      const prev = this.bests().courier ?? 0; best = n > prev; if (best) this.setBest('courier', n)
      title = 'SHIFT OVER'; big = `${n} deliver${n === 1 ? 'y' : 'ies'}`
      line = n === 0 ? 'The customer gave you one star and a sad emoji.' : n >= 5 ? 'Top Dasher in the Mission. The algorithm loves you.' : 'Tips: one burrito and a "thx".'
      rows = [['Score', fmt(e.t === 'courierOver' ? e.score : 0)], ['Best shift', `${Math.max(n, prev)} deliveries`]]
      if (e.t === 'courierFail') rows.unshift(['Missed', e.place])
    } else if (e.t === 'comboOver') {
      const prev = this.bests().combo ?? 0; best = e.best > prev; if (best) this.setBest('combo', e.best)
      title = 'COMBO CHALLENGE'; big = fmt(e.best); line = e.best >= 20000 ? 'Somebody call the magazines.' : e.best >= 5000 ? 'Hella sick combo.' : 'Link more. Manuals are free.'
      rows = [['Banked in total', fmt(e.score)], ['Best ever', fmt(Math.max(e.best, prev))]]
    } else if (e.t === 'bombFinish') {
      const prev = this.bombBest(e.route); best = prev === null || e.total < prev
      if (best) try { localStorage.setItem(this.bombKey(e.route), String(e.total)) } catch { /* private window */ }
      const where = this.bombNames[e.route] ?? 'the hill'
      title = `Hill bomb${EM}${where}`; big = `${e.total.toFixed(2)} s`; line = e.falls ? 'Fast, but the street won a few rounds.' : `Clean run down ${where}. Karl the Fog is impressed.`
      // Against the locals: your place, and who beat you (or who you beat).
      const winner = this.racers.find((r) => r.place === 1)
      if (e.of > 1) line = e.place === 1 ? `You beat the locals down ${where}.${this.racerNames[0] ? ` ${this.racerNames[0]} wants a rematch.` : ''}` : `${winner?.name ?? 'A local'} got there first. ${e.place === e.of ? 'Last place. The DJ is filming.' : 'So close.'}`
      rows = [...(e.of > 1 ? [['Place', `${ord(e.place)} of ${e.of}`] as [string, string]] : []), ['Riding time', `${e.time.toFixed(2)} s`], ['Falls', `${e.falls} (+${e.penalty.toFixed(0)} s)`], ['Best', `${(best ? e.total : prev!).toFixed(2)} s`],
        ...this.racers.slice(0, 3).map((r) => [`${ord(r.place)} ${r.name}`, `${r.time.toFixed(2)} s`] as [string, string])]
    } else if (e.t === 'bombFail') {
      title = `Hill bomb${EM}${this.bombNames[e.route] ?? ''}`; big = 'DNF'; line = 'Out of time. Even the 22 Fillmore got there first.'; rows = [['Reached', `gate ${e.gate}`]]
    } else if (e.t === 'muniOver') {
      const k = 'muni', prev = this.bests()[k]; best = e.won && (prev === undefined || e.time < prev); if (best) this.setBest(k, e.time)
      title = 'MUNI RACE'; big = e.won ? 'YOU BEAT MUNI' : 'MUNI WON'
      line = e.won ? `By ${Math.round(e.margin)} m. The streetcar is "eight minutes away".` : `It had ${Math.round(e.margin)} m to spare. Even Muni was faster today.`
      rows = [['Time', `${e.time.toFixed(1)} s`], ...(prev !== undefined || best ? [['Best win', `${(best ? e.time : prev!).toFixed(1)} s`] as [string, string]] : [])]
    } else if (e.t === 'escapeOver') {
      const k = 'escape', prev = this.bests()[k] ?? 0; best = e.survived && e.score > prev; if (best) this.setBest(k, e.score)
      title = 'ROBOTAXI ESCAPE'; big = e.survived ? 'ESCAPED' : 'PULLED OVER'
      line = e.survived ? 'The robotaxi has filed a report and given up.' : 'The robotaxi would like to see your license and registration.'
      rows = [['Score', fmt(e.score)], ...((e as { bonus?: number }).bonus ? [['Survival bonus', `+${fmt((e as { bonus?: number }).bonus!)}`] as [string, string]] : []), ['Best escape', fmt(Math.max(prev, e.survived ? e.score : 0))]]
    } else if (e.t === 'graffitiOver' && e.counts.length === 1) {
      const n = e.counts[0], prev = this.bests().graffiti ?? 0; best = n > prev; if (best) this.setBest('graffiti', n)
      title = 'GRAFFITI'; big = `${n} piece${n === 1 ? '' : 's'}`
      line = n >= 20 ? 'The whole park has your name on it. The city is sending a crew.' : n >= 8 ? 'Your tag is all over SoMa West.' : n === 0 ? 'Not one tag. The buff crew is bored.' : 'Grind more. Every rail, ledge and gap counts.'
      rows = [['Tagged', String(n)], ['Best', `${Math.max(n, prev)} pieces`]]
    } else if (e.t === 'skateOver') {
      const won = e.winner === 'player', wins = (this.bests().skateWins ?? 0) + (won ? 1 : 0)
      if (won) this.setBest('skateWins', wins)
      title = 'GAME OF S.K.A.T.E.'; big = won ? 'YOU WIN' : `${e.name.toUpperCase()} WINS`
      line = e.line ? `${e.name}: “${e.line}”` : won ? `${e.name} is buying the burritos.` : 'Practice your flatground. The DMV line is a good place to start.'
      rows = [['You', e.player || '—'], [e.name, e.local || '—'], ['Wins in this browser', String(wins)]]
    } else return
    this.resultsEl.innerHTML = `<div class="res-card">
      <div class="res-title">${title}</div>${this.whoLine()}
      <div class="res-score">${big}</div>
      ${best ? '<div class="res-best">NEW PERSONAL BEST</div>' : ''}
      <div class="res-line">${line}</div>
      ${rows.map(([k, v]) => `<div class="res-row"><span>${k}</span><b>${v}</b></div>`).join('')}
      <div class="res-again">${again}</div>
    </div>`
    this.fillWho()
    this.resultsEl.classList.add('on')
  }
  private letters: HTMLElement
  private goals: HTMLElement
  private trick: HTMLElement
  private trickNames: HTMLElement
  private trickPts: HTMLElement
  private callout: HTMLElement
  private balance: HTMLElement
  private balanceDot: HTMLElement
  private pops: HTMLElement
  private introEl!: HTMLElement
  private replayTag!: HTMLElement
  private toastEl: HTMLElement
  private radioEl: HTMLElement
  private captionEl: HTMLElement
  private captionTimer = 0
  private menuEl: HTMLElement
  private menuList: HTMLElement
  private menuCam: HTMLElement
  private menuBody: HTMLElement
  private menuParent: HTMLElement
  private menuCur: HTMLElement
  private menuPath: HTMLElement
  private menuPreview: HTMLElement
  private menuKeys: HTMLElement
  private menuStamp: HTMLElement
  private recEl!: HTMLElement
  /** The lists open: [0] is the top level, the last is the one with the cursor. */
  private stack: MenuLevel[] = [{ id: 'top', title: '', items: [], sel: 0 }]
  /** The tape's position (s): the timecode in the pause menu's corner. */
  private tape = 0
  private resultsEl: HTMLElement
  private helpEl: HTMLElement
  /** This session's stats (client only), shown in the pause menu's preview of Resume. */
  private stats = { metres: 0, combos: 0, bestCombo: 0, slams: 0, burritos: 0, air: 0 }
  private lastPos: { x: number; y: number } | null = null
  private mapEl: HTMLCanvasElement
  private speedEl: HTMLElement
  private map: { streets: { pts: number[][]; box: number[] }[]; park: HTMLCanvasElement | null; parkBox: number[]; spots: { x: number; y: number; label: string }[] } | null = null
  topSpeed = 0
  private hintEl!: HTMLElement
  private hintsSeen = new Set<string>()
  private hintUntil = 0
  private hintNext = 0
  private hintFlags = { airs: 0, grinds: 0, manuals: 0, fast: 0, combos: 0 }
  /** Skate School is teaching (its own card): no first-time tips meanwhile. */
  quiet = false
  /** A car just ahead of the skater, going the same way (the skitch hint). */
  private nearCarBehind(sim: Sim, sk: { pos: { x: number; y: number }; vel: { x: number; y: number } }) {
    const v = Math.hypot(sk.vel.x, sk.vel.y) || 1
    return sim.world.things.some((c) => c.kind === 'car' && Math.hypot(c.pos.x - sk.pos.x, c.pos.y - sk.pos.y) < 6 &&
      ((c.pos.x - sk.pos.x) * sk.vel.x + (c.pos.y - sk.pos.y) * sk.vel.y) / v > 1)
  }

  /** Show a first-time tip once (remembered in this browser). */
  hint(id: string, now: number) {
    if (this.hintsSeen.has(id) || now < this.hintNext || now < this.hintUntil) return
    const h = this.d.hints?.find((x) => x.id === id)
    if (!h) return
    this.hintsSeen.add(id)
    try { localStorage.setItem('soma-skate:hints', JSON.stringify([...this.hintsSeen])) } catch { /* private window */ }
    this.hintEl.innerHTML = h.text
    this.hintEl.classList.add('on')
    this.hintUntil = now + 5500; this.hintNext = now + 9000
  }
  /** The skater's character id, for its signature special names. */
  character: () => string = () => ''
  private whoEl!: HTMLElement
  private skaterName = ''
  /** A created skater's name (Create-a-Skater) over the score and on the results cards; '' for none. */
  setSkaterName(name: string) { this.skaterName = name; this.whoEl.textContent = name; this.whoEl.classList.toggle('on', !!name) }
  private whoLine() { return this.skaterName ? `<div class="res-who"></div>` : '' }
  private fillWho() { const w = this.resultsEl.querySelector('.res-who'); if (w) w.textContent = this.skaterName }
  private specials: { id: string; name: string }[] = []
  private sig(name: string): { text: string; special: boolean } {
    const mine = this.d.signatures?.[this.character()]
    let special = false
    for (const s of this.specials) {
      if (!name.includes(s.name)) continue
      special = true
      if (mine?.[s.id]) name = name.split(s.name).join(mine[s.id])
    }
    return { text: name, special }
  }
  private holdUntil = 0
  private carHitAt = -1e9
  private toastTimer = 0
  private radioTimer = 0
  menuOpen = true

  /** root: where it draws (#ui; player 2's own HUD in split screen has its own root). */
  constructor(data: UiData, helpHtml: string, root: HTMLElement = document.getElementById('ui')!) {
    this.d = data
    this.root = root
    const R = this.root
    const tl = el('div', 'hud-tl', R)
    this.whoEl = el('div', 'hud-who', tl)
    this.scoreN = el('div', 'hud-score', tl, '0')
    this.specialWrap = el('div', 'hud-special', tl, '<span>SPECIAL</span>')
    const bar = el('div', 'hud-special-bar', this.specialWrap)
    this.special = el('div', 'hud-special-fill', bar)
    const tr = el('div', 'hud-tr', R)
    this.timer = el('div', 'hud-timer', tr)
    this.modeEl = el('div', 'hud-mode', tr)
    this.burritoEl = el('div', 'hud-burritos', tr)
    this.letters = el('div', 'hud-letters', tr)
    this.goals = el('div', 'hud-goals', tr)
    this.pops = el('div', 'hud-pops', R)
    this.introEl = el('div', 'level-intro', R)
    this.replayTag = el('div', 'replay-tag', R)
    this.balance = el('div', 'hud-balance', R)
    this.balanceDot = el('div', 'hud-balance-dot', this.balance)
    this.trick = el('div', 'hud-trick', R)
    this.trickNames = el('div', 'hud-trick-names', this.trick)
    this.trickPts = el('div', 'hud-trick-pts', this.trick)
    this.callout = el('div', 'hud-callout', R)
    this.toastEl = el('div', 'hud-toast', R)
    this.speedEl = el('div', 'hud-speed', R)
    this.hintEl = el('div', 'hud-hint', R)
    try { for (const h of JSON.parse(localStorage.getItem('soma-skate:hints') ?? '[]')) this.hintsSeen.add(h) } catch { /* private window */ }
    this.mapEl = el('canvas', 'hud-map', R)
    // Its CSS size, kept as it changes (never read in the frame: that would force a layout every frame).
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver((es) => { const w = Math.round(es[0]?.contentRect.width ?? 0); if (w > 0) this.mapSize = w }).observe(this.mapEl)
    this.radioEl = el('div', 'hud-radio', R)
    this.recEl = el('div', 'hud-rec', R, '<i></i>REC')
    this.captionEl = el('div', 'hud-caption', R)
    this.placeEl = el('div', 'hud-place', R)
    // The pause menu: the brand and the camcorder corner, the lists (the parent dimmed to the left), the preview, the keys.
    this.menuEl = el('div', 'menu', R)
    el('div', 'menu-brand wordmark', this.menuEl, '<span>SoMa</span><span>Skate</span>')
    this.menuCam = el('div', 'menu-cam', this.menuEl)
    this.menuBody = el('div', 'menu-body', this.menuEl)
    this.menuParent = el('div', 'menu-col parent', this.menuBody)
    const cur = el('div', 'menu-col current', this.menuBody)
    this.menuPath = el('div', 'menu-path', cur)
    this.menuList = el('div', 'menu-list', cur)
    this.menuCur = cur
    this.menuPreview = el('div', 'menu-preview', this.menuBody)
    this.menuKeys = el('div', 'menu-keys', this.menuEl)
    this.menuStamp = el('div', 'menu-stamp', this.menuEl)
    this.resultsEl = el('div', 'results', R)
    // How to skate (index.html #help): its sections become groups, drawn as the pause menu's two lists.
    const tpl = document.createElement('template'); tpl.innerHTML = helpHtml
    this.keysTitle = tpl.content.querySelector('h2')?.textContent ?? 'How to skate'
    this.keyGroups = [...tpl.content.querySelectorAll('section')].map((sec) => ({
      title: sec.dataset.group ?? '', note: sec.dataset.note ?? '',
      rows: [...sec.children].map((d) => [d.querySelector('span')?.innerHTML ?? '', d.querySelector('b')?.innerHTML ?? ''] as [string, string]),
    }))
    this.helpEl = el('div', 'help', R)
    this.drawKeys()
    // Captured first: while How to skate is up, its keys pick and open groups and go no further.
    window.addEventListener('keydown', (e) => this.keysKey(e), true)
    window.addEventListener('keydown', (e) => this.menuKey(e))
  }

  setData(json: unknown) { this.d = uiSchema.parse(json) }
  /**
   * A demo plays through this HUD (the title's attract mode), or it is a second player's: the run is
   * drawn, but the session's stats, top speed, places and first-time tips are left alone.
   */
  demo = false
  /** Settings: speeds in km/h or mph (mph: the factor from km/h); the first-time tips on or off. */
  units: 'kmh' | 'mph' = 'kmh'
  mph = 0.621371
  hintsOn = true
  /** A speed (km/h) in the chosen units: the number and the unit. */
  speedIn(kmh: number) { return this.units === 'mph' ? { n: kmh * this.mph, unit: 'mph' } : { n: kmh, unit: 'km/h' } }
  private speedText(kmh: number) { const v = this.speedIn(kmh); return `${Math.round(v.n)} ${v.unit}` }
  /** A game this HUD has no panel of its own for (the two-player games, twoplayer.ts): its clock and panel. */
  modePanel: ((game: string) => { timer: string; hurry: boolean; html: string } | null) | null = null
  private lastPanel = ''
  /** A pop from outside the sim's events (the two-player games' moments). */
  popUp(title: string, sub: string, kind: string) { this.pop(title, sub, kind) }
  /** A second HUD with the same data, drawing into its own root (player 2's in split screen). */
  twin(root: HTMLElement): Hud { return new Hud(this.d, '', root) }
  /** The same minimap as another HUD (player 2's in split screen). */
  copyMap(from: Hud) { this.map = from.map }

  /**
   * The minimap: street axes (the city's traffic paths), the park's obstacles drawn once
   * from above, and the named spots. Heading-up around the skater.
   */
  setMap(streets: number[][][], parkTris: Float64Array | null, spots: { x: number; y: number; label: string }[]) {
    let park: HTMLCanvasElement | null = null, parkBox = [0, 0, 0, 0]
    if (parkTris && parkTris.length) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (let i = 0; i < parkTris.length; i += 3) { x0 = Math.min(x0, parkTris[i]); x1 = Math.max(x1, parkTris[i]); y0 = Math.min(y0, parkTris[i + 1]); y1 = Math.max(y1, parkTris[i + 1]) }
      const S = 3   // px per metre
      park = document.createElement('canvas'); park.width = Math.ceil((x1 - x0) * S); park.height = Math.ceil((y1 - y0) * S)
      const g = park.getContext('2d')!
      g.fillStyle = 'rgba(255,246,230,0.85)'
      for (let i = 0; i < parkTris.length; i += 9) {
        g.beginPath()
        for (let k = 0; k < 3; k++) { const x = (parkTris[i + k * 3] - x0) * S, y = (y1 - parkTris[i + k * 3 + 1]) * S; if (k) g.lineTo(x, y); else g.moveTo(x, y) }
        g.fill()
      }
      parkBox = [x0, y0, x1, y1]
    }
    // Each street with its bounding box, so long streets that pass by are drawn even when both ends are far.
    const withBox = streets.map((pts) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
      for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]) }
      return { pts, box: [x0, y0, x1, y1] }
    })
    this.map = { streets: withBox, park, parkBox, spots }
  }

  /** The game mode's target (courier stop, next gate): an orange marker or a rim arrow on the minimap. */
  mapTarget: { x: number; y: number } | null = null
  /** Extra marks on the minimap, drawn over it each frame: at(world x, y) gives the minimap pixel and its distance from the middle; size is the minimap's CSS size. */
  mapOverlay: ((g: CanvasRenderingContext2D, at: (x: number, y: number) => { x: number; y: number; r: number }, size: number) => void) | null = null
  /** The minimap's world data (streets, the park's obstacles, named spots), for the big map (mapscreen.ts). */
  get mapData() { return this.map }
  /** Uncollected burritos for the minimap (dots inside, arrows on the rim when far). */
  private mapBurritos: { x: number; y: number }[] = []
  /** Other skaters (the NPCs; hill bomb rivals stand out). */
  private mapSkaters: { x: number; y: number; racer: boolean }[] = []
  private mapSize = 168

  private drawMap(x: number, y: number, heading: number) {
    const m = this.map, c = this.mapEl
    if (!m) { c.style.display = 'none'; return }
    c.style.display = ''
    // A plain square, no frame (docs/art-direction.md): ink ground, streets and the park in paper, simple marks.
    const css = this.mapSize, pr = Math.min(2, window.devicePixelRatio || 1)
    if (c.width !== Math.round(css * pr)) { c.width = c.height = Math.round(css * pr) }
    const g = c.getContext('2d')!, R = 100, k = (css / 2) / R   // metres shown to the edge
    g.setTransform(pr, 0, 0, pr, 0, 0)
    g.clearRect(0, 0, css, css)
    g.save()
    g.beginPath(); g.rect(0, 0, css, css); g.clip()
    g.fillStyle = 'rgba(11,11,12,0.58)'; g.fillRect(0, 0, css, css)
    g.translate(css / 2, css / 2); g.rotate(heading - Math.PI / 2); g.scale(k, -k); g.translate(-x, -y)
    g.lineCap = 'round'; g.lineJoin = 'round'
    g.strokeStyle = 'rgba(242,239,232,0.2)'; g.lineWidth = 6
    const reach = R * 1.5
    for (const s of m.streets) {
      const [x0, y0, x1, y1] = s.box
      if (x1 < x - reach || x0 > x + reach || y1 < y - reach || y0 > y + reach) continue
      g.beginPath(); s.pts.forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke()
    }
    if (m.park) { const [x0, y0, x1, y1] = m.parkBox; g.save(); g.globalAlpha = 0.55; g.translate(x0, y1); g.scale(1, -1); g.drawImage(m.park, 0, 0, x1 - x0, y1 - y0); g.restore() }
    g.fillStyle = 'rgba(242,239,232,0.5)'
    for (const s of m.spots) { g.beginPath(); g.arc(s.x, s.y, 1.8 / k, 0, Math.PI * 2); g.fill() }
    for (const o of this.mapSkaters) { g.fillStyle = o.racer ? '#ff4f1f' : 'rgba(242,239,232,0.75)'; g.beginPath(); g.arc(o.x, o.y, (o.racer ? 3 : 1.8) / k, 0, Math.PI * 2); g.fill() }
    g.restore()
    const rot = heading - Math.PI / 2, lim = css / 2 - 7
    // World to minimap: the pixel, and its distance from the middle along the larger axis (past lim: off the square).
    const at = (wx: number, wy: number) => { const dx = wx - x, dy = wy - y, sx = (dx * Math.cos(rot) + dy * Math.sin(rot)) * k, sy = (dx * Math.sin(rot) - dy * Math.cos(rot)) * k; return { x: css / 2 + sx, y: css / 2 + sy, r: Math.max(Math.abs(sx), Math.abs(sy)) } }
    /** Clamped to the square's edge, with the direction it points. */
    const edge = (q: { x: number; y: number; r: number }) => { const f = q.r > lim ? lim / q.r : 1; return { x: css / 2 + (q.x - css / 2) * f, y: css / 2 + (q.y - css / 2) * f, a: Math.atan2(q.y - css / 2, q.x - css / 2), off: q.r > lim } }
    const tri = (px: number, py: number, a: number, size: number, color: string) => { g.save(); g.translate(px, py); g.rotate(a); g.fillStyle = color; g.beginPath(); g.moveTo(size, 0); g.lineTo(-size * 0.7, -size * 0.75); g.lineTo(-size * 0.7, size * 0.75); g.closePath(); g.fill(); g.restore() }
    // The mode's target: a ring in range, a triangle on the edge with the distance when far.
    if (this.mapTarget) {
      const q = at(this.mapTarget.x, this.mapTarget.y), e = edge(q), d = Math.hypot(this.mapTarget.x - x, this.mapTarget.y - y)
      if (e.off) { tri(e.x, e.y, e.a, 6, '#ff4f1f'); g.fillStyle = '#f2efe8'; g.font = '500 9px "Plex Mono", monospace'; g.textAlign = 'center'; g.fillText(`${Math.round(d)}M`, e.x - Math.cos(e.a) * 14, e.y - Math.sin(e.a) * 14 + 3) }
      else { g.strokeStyle = '#ff4f1f'; g.lineWidth = 2; g.beginPath(); g.arc(q.x, q.y, 6, 0, Math.PI * 2); g.stroke() }
    }
    // Burritos: small paper squares, or a small triangle on the edge pointing the way.
    const drawn: { x: number; y: number }[] = []
    const sorted = [...this.mapBurritos].sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y))
    for (const b of sorted) {
      const e = edge(at(b.x, b.y))
      if (e.off && drawn.some((q) => Math.hypot(q.x - e.x, q.y - e.y) < 12)) continue   // same direction as a nearer one
      drawn.push(e)
      if (e.off) tri(e.x, e.y, e.a, 4, '#f2efe8')
      else { g.fillStyle = '#f2efe8'; g.fillRect(e.x - 2.5, e.y - 2.5, 5, 5) }
    }
    // Others' marks (the story's markers and the waypoint's route: story.ts), with the same projection.
    if (this.mapOverlay) { g.save(); this.mapOverlay(g, at, css); g.restore() }
    // The skater: the accent arrow pointing up (heading-up map).
    g.fillStyle = '#ff4f1f'
    g.beginPath(); g.moveTo(css / 2, css / 2 - 8); g.lineTo(css / 2 + 5.5, css / 2 + 6); g.lineTo(css / 2, css / 2 + 2.5); g.lineTo(css / 2 - 5.5, css / 2 + 6); g.closePath(); g.fill()
    // North on the edge, in mono.
    const nx = -Math.cos(heading), ny = -Math.sin(heading), nf = (css / 2 - 9) / Math.max(Math.abs(nx), Math.abs(ny))
    g.fillStyle = 'rgba(242,239,232,0.7)'; g.font = '500 10px "Plex Mono", monospace'; g.textAlign = 'center'
    g.fillText('N', css / 2 + nx * nf, css / 2 + ny * nf + 3.5)
    if (m.streets.length) { g.fillStyle = 'rgba(242,239,232,0.4)'; g.font = '500 7px "Plex Mono", monospace'; g.textAlign = 'right'; g.fillText('© OPENSTREETMAP', css - 5, css - 5) }
  }

  // ---------------- menu ----------------
  private get level() { return this.stack[this.stack.length - 1] }
  /** The top level's entries (redrawn in place; the lists opened from it stay open). */
  setMenu(items: MenuItem[]) {
    const top = this.stack[0], keep = top.items[top.sel]?.id
    top.items = items; top.sel = Math.max(0, items.findIndex((it) => it.id === keep))
    this.drawMenu(true)
  }
  /** A list opened from the selected entry (drill-down, to the right); the same id again redraws it in place. */
  sub(id: string, title: string, items: MenuItem[]) {
    const L = this.level
    if (L.id === id) { const keep = L.items[L.sel]?.id; L.items = items; L.title = title; L.sel = Math.max(0, items.findIndex((it) => it.id === keep)); this.drawMenu(true); return }
    const at = this.stack.findIndex((x) => x.id === id)
    if (at > 0) this.stack.length = at   // reopened from further up: back to that level first
    this.stack.push({ id, title, items, sel: 0 })
    this.drawMenu()
  }
  /** Back one list (Esc, left, the parent column); false at the top. */
  back(): boolean { if (this.stack.length < 2) return false; this.stack.pop(); this.drawMenu(); return true }
  /** Back to the top level. */
  home() { this.stack.length = 1; this.stack[0].sel = 0; this.drawMenu(true) }
  /** The open list's id (main: the lists that redraw themselves). */
  get menuAt() { return this.level.id }
  /** Other parts of the game add their own entries to the top level. */
  addMenuItem(item: MenuItem, at = this.stack[0].items.length) { this.stack[0].items.splice(at, 0, item); this.drawMenu(true) }

  private itemHtml(it: MenuItem) {
    const v = it.value?.() ?? ''
    return `<span class="mi-label">${it.label}</span>${v ? `<span class="mi-value">${escHtml(v)}</span>` : ''}`
  }
  private drawMenu(quiet = false) {
    const L = this.level, depth = this.stack.length - 1
    this.menuCur.classList.toggle('top', depth === 0)
    // The parent list, dimmed, its chosen entry marked; a click on it goes back, on another opens that instead.
    this.menuParent.innerHTML = ''
    this.menuParent.style.display = depth ? '' : 'none'
    if (depth) {
      const P = this.stack[depth - 1]
      el('div', 'menu-path', this.menuParent, depth > 1 ? escHtml(this.stack.slice(1, depth).map((x) => x.title).join('  /  ')) : '&nbsp;')
      const list = el('div', 'menu-list', this.menuParent)
      P.items.forEach((it, i) => {
        const row = el('button', `menu-item${i === P.sel ? ' chosen' : ''}${it.off ? ' off' : ''}`, list, `<span class="mi-label">${it.label}</span>`)
        row.style.animation = 'none'
        row.onclick = () => { if (i === P.sel) this.back(); else { this.stack.length = depth; P.sel = i; this.drawMenu(true); P.items[i].onSelect() } }
      })
    }
    this.menuPath.innerHTML = depth ? `<button>${escHtml(L.title)}</button>` : '&nbsp;'
    this.menuPath.querySelector('button')?.addEventListener('click', () => this.back())
    this.menuList.innerHTML = ''
    L.items.forEach((it, i) => {
      const row = el('button', `menu-item${i === L.sel ? ' sel' : ''}${it.off ? ' off' : ''}`, this.menuList, this.itemHtml(it))
      if (quiet) row.style.animation = 'none'
      else row.style.animationDelay = `${i * 20}ms`
      row.onmouseenter = () => { if (L.sel !== i) { L.sel = i; this.markSel() } }
      row.onclick = () => { L.sel = i; it.onSelect() }
      if (i === L.sel) requestAnimationFrame(() => row.scrollIntoView({ block: 'nearest' }))
    })
    this.drawPreview()
    this.menuKeys.innerHTML = `<span><b>↑↓</b>select</span><span><b>Enter</b>choose</span><span><b>Esc</b>${depth ? 'back' : 'resume'}</span>`
  }
  /** The cursor moved: the rows' marks and the preview, without rebuilding the list. */
  private markSel() {
    const L = this.level
    this.menuList.querySelectorAll('.menu-item').forEach((row, i) => {
      row.classList.toggle('sel', i === L.sel)
      if (i === L.sel) row.scrollIntoView({ block: 'nearest' })
    })
    this.drawPreview()
  }
  private drawPreview() {
    const it = this.level.items[this.level.sel]
    const p = it?.preview?.() ?? (it?.hint ? { text: it.hint } : null)
    if (!p) { this.menuPreview.innerHTML = ''; return }
    this.menuPreview.innerHTML = `${p.img ? `<img class="pv-img${p.wide ? ' wide' : ''}" alt="">` : ''}${p.title ? '<div class="pv-title"></div>' : ''}${p.text ? '<div class="pv-text"></div>' : ''}${p.rows?.length ? `<div class="pv-rows">${p.rows.map(() => '<span></span><b></b>').join('')}</div>` : ''}`
    const img = this.menuPreview.querySelector<HTMLImageElement>('.pv-img')
    if (img && p.img) { img.onerror = () => img.remove(); img.src = p.img }
    const t = this.menuPreview.querySelector('.pv-title'); if (t) t.textContent = p.title!
    const x = this.menuPreview.querySelector('.pv-text'); if (x) x.innerHTML = p.text!
    const cells = this.menuPreview.querySelectorAll('.pv-rows > *')
    p.rows?.forEach(([k, v], i) => { cells[i * 2].textContent = k; cells[i * 2 + 1].textContent = v })
  }
  /** The camcorder layer: PAUSE with its two bars in one corner; the date and the tape's timecode (hours:minutes:seconds:frames) in the other. */
  private drawCam() {
    const s = Math.max(0, this.tape), f = Math.floor((s % 1) * 30), p = (n: number) => String(Math.floor(n)).padStart(2, '0')
    this.menuCam.innerHTML = `<span>PAUSE<i class="bars"></i></span>`
    // The VX stamp in the opposite corner: the date and the tape's timecode, one line (two camcorder marks on screen, no more).
    const d = new Date(), date = `${d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()} ${d.getDate()} ${d.getFullYear()}`
    this.menuStamp.innerHTML = `<span>${date}</span><span class="tc">${p(s / 3600)}:${p((s / 60) % 60)}:${p(s % 60)}:${p(f)}</span>`
  }

  private menuKey(e: KeyboardEvent) {
    if (!this.menuOpen || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
    // A screen open over the menu (goals, tricks, scores): up/down scroll it instead of moving the menu.
    if (this.helpEl.classList.contains('on')) {
      if (e.code === 'ArrowDown' || e.code === 'ArrowUp' || e.code === 'KeyS' || e.code === 'KeyW') { this.helpEl.scrollBy({ top: (e.code === 'ArrowDown' || e.code === 'KeyS' ? 1 : -1) * 120, behavior: 'smooth' }); e.preventDefault() }
      if (e.code === 'ArrowLeft' || e.code === 'Backspace') { this.hideHelp(); e.preventDefault() }
      return
    }
    const L = this.level, n = L.items.length
    if (!n) return
    if (e.code === 'ArrowDown' || e.code === 'KeyS') { L.sel = (L.sel + 1) % n; this.markSel(); e.preventDefault() }
    if (e.code === 'ArrowUp' || e.code === 'KeyW') { L.sel = (L.sel - 1 + n) % n; this.markSel(); e.preventDefault() }
    if (e.code === 'Space' || e.code === 'KeyK' || e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'ArrowRight' || e.code === 'KeyD') { L.items[L.sel]?.onSelect(); e.preventDefault(); if (e.code === 'Enter') e.stopImmediatePropagation() }   // Enter: the pad's options too (the pause menu's first entry is Resume); it goes no further (it would open the menu again)
    // In a list opened from another, Esc (pad circle), left or Backspace goes back a level instead of closing the menu.
    if ((e.code === 'Escape' || e.code === 'ArrowLeft' || e.code === 'KeyA' || e.code === 'Backspace') && this.stack.length > 1) { this.back(); e.preventDefault(); e.stopImmediatePropagation() }
  }

  showMenu(on: boolean) {
    const was = this.menuOpen
    this.menuOpen = on
    this.menuEl.classList.toggle('on', on)
    this.root.classList.toggle('in-menu', on)
    if (on) { this.drawMenu(); this.drawCam() }
    // The one flourish: two frames of tape tracking as the pause menu opens and closes.
    if (on && !was) { this.menuEl.classList.remove('glitch'); void this.menuEl.offsetWidth; this.menuEl.classList.add('glitch') }
    // And as it closes, over the scene (it also hides the camera's cut back from the pause orbit).
    const view = document.getElementById('view')
    if (!on && was && view && this.root.id === 'ui') { view.classList.remove('tape'); void view.offsetWidth; view.classList.add('tape') }
  }
  /** This session so far, for the preview of Resume: distance, top speed, best combo, time in the air. */
  sessionRows(): [string, string][] {
    const s = this.stats
    if (s.metres < 20 && !s.combos) return []
    const km = s.metres / 1000
    return [['Skated', km >= 1 ? `${km.toFixed(1)} km` : `${Math.round(s.metres)} m`], ['Top speed', this.speedText(this.topSpeed)], ['Best combo', fmt(s.bestCombo)], ['Combos', String(s.combos)], ['Air', `${s.air.toFixed(1)} s`], ['Slams', String(s.slams)]]
  }

  // ---------------- per frame ----------------
  frame(sim: Sim, now: number, heading = Math.PI / 2) {
    const sk = skater(sim), ss = session(sim)
    if (!this.demo) this.tape = sim.world.tick / sim.data.physics.tickHz
    if (!this.menuOpen && !this.demo && sim.park.name === 'sf') this.placeTick(sk.pos.x, sk.pos.y, now)
    if (ss.skateName) this.skateName = ss.skateName
    if (ss.mode === 'bomb') { const names = sim.world.things.filter((t) => t.kind === 'npc' && t.npc?.racer).map((t) => t.npc!.racer!.name); if (names.length) this.racerNames = names }
    // Session stats: distance on the board or on foot (teleports don't count), air time.
    if (!this.menuOpen && !this.demo) {
      if (this.lastPos) { const d = Math.hypot(sk.pos.x - this.lastPos.x, sk.pos.y - this.lastPos.y); if (d < 3) this.stats.metres += d }
      if (sk.state === 'air') this.stats.air += 1 / 60
    }
    this.lastPos = { x: sk.pos.x, y: sk.pos.y }
    if (!this.specials.length) this.specials = (sim.data.tricks as unknown as { specials?: { id: string; name: string }[] }).specials ?? []
    // Speed (km/h) once it gets fast, and the minimap.
    const kmh = Math.hypot(sk.vel.x, sk.vel.y, sk.vel.z) * 3.6
    if (sk.state !== 'bail' && !this.demo) this.topSpeed = Math.max(this.topSpeed, kmh)
    this.speedEl.classList.toggle('on', kmh > 18)
    if (kmh > 18) { const v = this.speedIn(kmh); this.speedEl.innerHTML = `${Math.round(v.n)}<small>${v.unit}</small>` }
    this.speedEl.classList.toggle('fast', kmh > 50)
    const got = ss.burritos ?? []
    this.mapBurritos = sim.data.run.burritoParks.includes(sim.park?.name ?? '') ? sim.data.run.burritos.flatMap((b, i) => (got.includes(i) ? [] : [{ x: b.pos[0], y: b.pos[1] }])) : []
    this.mapSkaters = sim.world.things.filter((t) => t.kind === 'npc' && t.alive).map((t) => ({ x: t.pos.x, y: t.pos.y, racer: !!t.npc?.racer }))
    this.drawMap(sk.pos.x, sk.pos.y, heading)
    // First-time tips, each when its moment comes.
    if (now > this.hintUntil || this.quiet || this.demo || !this.hintsOn) this.hintEl.classList.remove('on')
    if (!this.menuOpen && !this.quiet && !this.demo && this.hintsOn && !document.body.classList.contains('clip')) {   // never in clips, nor in Skate School
      const v = Math.hypot(sk.vel.x, sk.vel.y)
      this.hint('push', now)
      if (v > 2.5) this.hint('ollie', now)
      if (sk.state === 'air' && ++this.hintFlags.airs > 20) this.hint('flip', now)
      if (this.hintFlags.airs > 200) this.hint('grind', now)
      if (sk.state === 'grind' && ++this.hintFlags.grinds > 30) this.hint('manual', now)
      if (v > 9 && ++this.hintFlags.fast > 60) this.hint('brake', now)
      if (this.hintsSeen.has('brake') || this.hintsSeen.has('manual')) this.hint('walk', now)
      if (this.hintsSeen.has('walk')) this.hint('radio', now)
      if (this.hintsSeen.has('radio')) this.hint('goals', now)
      if (this.hintsSeen.has('goals')) this.hint('modes', now)
      if (sk.state === 'ground' && v > 3 && this.nearCarBehind(sim, sk)) this.hint('skitch', now)
      if (sk.state === 'air' && sk.vertAir) this.hint('spine', now)
    }
    // score counts up
    this.shownScore += (sk.score - this.shownScore) * 0.25
    if (Math.abs(sk.score - this.shownScore) < 1) this.shownScore = sk.score
    this.scoreN.textContent = fmt(this.shownScore)
    this.special.style.width = `${Math.round(sk.special * 100)}%`
    this.specialWrap.classList.toggle('full', sk.special >= 1)
    // burritos (any mode, once you have one)
    this.burritoEl.style.display = ss.burritos?.length ? '' : 'none'
    if (ss.burritos?.length) this.burritoEl.innerHTML = `${ss.burritos.length}<small>of ${sim.data.run.burritos.length} burritos</small>`
    // timer, letters, goals (the 2-minute run); the other games have their own panel
    const level = ss.game === 'level' && ss.mode !== 'free' && ss.level ? sim.data.tour.levels.find((L) => L.id === ss.level) ?? null : null
    const run = (ss.game === 'run' || !!level) && ss.mode !== 'free'
    const game = ss.mode !== 'free' && ss.game !== 'run' && ss.game !== 'free' && ss.game !== 'level' ? ss.game : ''
    this.letters.style.display = this.goals.style.display = run ? '' : 'none'
    this.timer.style.display = run || game ? '' : 'none'
    this.modeEl.style.display = game ? '' : 'none'
    const hz = sim.data.physics.tickHz
    const clock = (ticks: number) => { const secs = Math.max(0, Math.ceil(ticks / hz)); return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` }
    if (game === 'courier') {
      const C = (sim.data.run as unknown as { courier: { legs: { place: string; line: string }[]; start: { place: string; line: string } } }).courier
      const leg = ss.courierCarrying ? C.legs[ss.courierLeg] : null
      this.timer.textContent = ss.mode === 'ending' || ss.mode === 'over' ? "TIME'S UP" : clock(ss.timeLeft)
      this.timer.classList.toggle('hurry', ss.timeLeft / hz <= 10 && ss.mode === 'courier')
      this.modeEl.innerHTML = `<div class="mode-title">Courier${EM}${ss.courierDone} delivered</div><div class="mode-card"><b>${leg ? leg.place : C.start.place}</b><span>${leg ? leg.line : C.start.line}</span></div>`
    } else if (game === 'muni') {
      const M = (sim.data.run as unknown as { muni: { lines: { id: string; name: string; stops: { name: string }[] }[] } }).muni, L = M.lines.find((l) => l.id === ss.muniLine)
      const tram = sim.world.things.find((t) => t.id === ss.muniTram)?.car?.tram
      const reached = ss.muniReached ?? [0], mine = Math.max(...reached), next = L ? Math.min(L.stops.length - 1, mine + 1) : 0
      const t = ss.muniFrom !== undefined ? (sim.world.tick - ss.muniFrom) / hz : 0
      this.timer.textContent = ss.mode === 'over' ? 'DONE' : `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`
      this.timer.classList.remove('hurry')
      const tramAt = tram ? (tram.phase === 'done' ? 'at the end' : tram.phase === 'dwell' ? `at ${stopName(L?.stops[tram.n]?.name ?? 'a stop')}` : `heading to ${stopName(L?.stops[tram.n]?.name ?? 'the next stop')}`) : ''
      this.modeEl.innerHTML = `<div class="mode-title">Muni race${EM}${L?.name ?? ''}</div><div class="mode-card"><b>Next stop: ${stopName(L?.stops[next]?.name ?? '')}</b><span>You: ${mine} / ${Math.max(0, (L?.stops.length ?? 1) - 1)} stops, the streetcar is ${tramAt}</span></div>`
    } else if (game === 'escape') {
      const taxis = sim.world.things.filter((t) => t.id === ss.escapeTaxi || t.id === ss.escapeBackup)
      const taxi = taxis.sort((a, b) => Math.hypot(a.pos.x - sk.pos.x, a.pos.y - sk.pos.y) - Math.hypot(b.pos.x - sk.pos.x, b.pos.y - sk.pos.y))[0]
      const d = taxi ? Math.hypot(taxi.pos.x - sk.pos.x, taxi.pos.y - sk.pos.y) : 0
      this.timer.textContent = ss.mode === 'over' ? 'DONE' : clock(ss.timeLeft)
      this.timer.classList.toggle('hurry', d < 15 && ss.mode === 'escape')
      const recalc = taxi?.car?.hazard && ss.mode === 'escape'
      this.modeEl.innerHTML = `<div class="mode-title">Robotaxi escape</div><div class="mode-card ${d < 15 ? 'danger' : ''}"><b>${recalc ? 'Recalculating…' : d < 15 ? 'It is right behind you' : 'Keep moving'}</b><span>${taxis.length > 1 ? `robotaxis ${taxis.map((x) => `${Math.round(Math.hypot(x.pos.x - sk.pos.x, x.pos.y - sk.pos.y))} m`).join(' and ')} away` : `robotaxi ${Math.round(d)} m away`}. Tricks make it recalculate</span></div>`
    } else if (game === 'graffiti') {
      const over = ss.mode === 'ending' || ss.mode === 'over'
      this.timer.textContent = over ? "TIME'S UP" : clock(ss.timeLeft)
      this.timer.classList.toggle('hurry', !over && ss.timeLeft / hz <= 10)
      const n = ss.owned ?? 0, open = (ss.tagging ?? []).filter((id) => !ss.tags?.[id]).length
      this.modeEl.innerHTML = `<div class="mode-title">Graffiti${EM}${n} tagged</div><div class="mode-card"><b>${open ? `+${open} when this combo lands` : 'Tag rails, ledges and gaps'}</b><span>A landed combo paints every piece in it. A bail paints nothing</span></div>`
    } else if (game === 'skate') {
      const word = 'SKATE', mine = ss.skatePlayer ?? '', theirs = ss.skateLocalLetters ?? '', name = ss.skateName ?? 'Local'
      const row = (who: string, got: string) => `<div class="sk-row"><i>${who}</i>${[...word].map((l, i) => `<b class="${i < got.length ? 'got' : ''}">${l}</b>`).join('')}</div>`
      const yours = ss.skateTurn === 'player'
      const what = yours ? (ss.skateRole === 'set' ? 'Your set: land any trick at the mark' : `Match it: ${ss.skateTrickName}`) : (ss.skateRole === 'set' ? `${name} is setting…` : `${name} tries your ${ss.skateTrickName}`)
      this.timer.textContent = ss.mode === 'over' ? 'GAME' : (ss.skatePause ?? 0) > 0 ? 'READY' : clock(ss.timeLeft)
      this.timer.classList.toggle('hurry', yours && ss.timeLeft / hz <= 6 && (ss.skatePause ?? 0) <= 0 && ss.mode === 'skate')
      this.modeEl.innerHTML = `<div class="mode-title">S.K.A.T.E.${EM}vs ${name}</div><div class="mode-card sk">${row('You', mine)}${row(name, theirs)}<b>${what}</b></div>`
    } else if (game === 'combo') {
      this.timer.textContent = ss.mode === 'ending' || ss.mode === 'over' ? "TIME'S UP" : clock(ss.timeLeft)
      this.timer.classList.toggle('hurry', ss.timeLeft / hz <= 10 && ss.mode === 'combo')
      this.modeEl.innerHTML = `<div class="mode-title">Combo challenge</div><div class="mode-card"><b>Best combo ${fmt(ss.bestCombo)}</b><span>Only your best single combo counts.</span></div>`
    } else if (game === 'bomb') {
      const B = bombRoute(sim, ss.raceRoute)
      const t = (ss.raceTicks + ss.racePenalty) / hz
      this.timer.textContent = ss.raceGate === 0 ? 'READY' : `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`
      this.timer.classList.remove('hurry')
      const next = B.gates[Math.min(ss.raceGate, B.gates.length - 1)]
      const best = this.bombBest(B.id)
      const place = ss.racePlace && ss.raceOf && ss.raceOf > 1 ? `<div class="mode-place">${ord(ss.racePlace)}<small> of ${ss.raceOf}</small></div>` : ''
      const home = this.racers.map((r) => `<span class="mode-racer">${ord(r.place)} ${r.name}${EM}${r.time.toFixed(2)} s</span>`).join('')
      this.modeEl.innerHTML = `<div class="mode-title">${B.name}${EM}gate ${Math.min(ss.raceGate, B.gates.length - 1)} of ${B.gates.length - 1}</div>${place}<div class="mode-card"><b>${ss.raceGate === 0 ? 'Roll through the start line' : `Next: ${next.name}`}</b><span>${ss.raceFalls ? `${ss.raceFalls} fall${ss.raceFalls > 1 ? 's' : ''} (+${ss.raceFalls * 3} s)${EM}` : ''}${best ? `best ${best.toFixed(2)} s` : 'no best time yet'}</span>${home}</div>`
    } else if (game && this.modePanel) {
      // Another game's panel (the two-player games: twoplayer.ts).
      const p = this.modePanel(game)
      if (p) { if (this.timer.textContent !== p.timer) this.timer.textContent = p.timer; this.timer.classList.toggle('hurry', p.hurry); if (p.html !== this.lastPanel) { this.modeEl.innerHTML = p.html; this.lastPanel = p.html } }
    }
    if (run) {
      const secs = Math.max(0, Math.ceil(ss.timeLeft / sim.data.physics.tickHz))
      this.timer.textContent = ss.mode === 'ending' || ss.mode === 'over' ? "TIME'S UP" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
      this.timer.classList.toggle('hurry', secs <= 10 && (ss.mode === 'run' || ss.mode === 'level'))
      if (level) {
        // A Tour level: its letters, and its goals (done this run, or before in the career, greyed).
        const T = sim.data.tour, ids = ['pro', 'sick', 'skate', 'tape', ...level.goals.map((g) => g.id)], now = ss.levelGoals ?? []
        const name = (id: string) => (T.names as Record<string, string>)[id] ?? level.goals.find((g) => g.id === id)?.name ?? id
        this.letters.innerHTML = level.letters.map((l) => `<b class="${ss.letters.includes(l.letter) ? 'got' : ''}">${l.letter}</b>`).join('')
        // A dash goal on the clock (left its start box, not yet at the finish): the time so far.
        const dash = level.goals.find((g) => (g as { kind: string }).kind === 'dash' && !now.includes(g.id) && ss.levelMarks?.[g.id] !== undefined) as { id: string; name: string; seconds: number } | undefined
        const dashT = dash ? (sim.world.tick - ss.levelMarks![dash.id]) / hz : 0
        const dashHtml = dash && dashT > 0.5 && dashT < dash.seconds + 5 ? `<div class="lvl-dash ${dashT > dash.seconds ? 'late' : ''}">${dash.name}: ${dashT.toFixed(1)} / ${dash.seconds} s</div>` : ''
        this.goals.innerHTML = `<div class="lvl-name">${level.name}</div>${dashHtml}` + ids.map((id) => `<div class="${now.includes(id) ? 'done' : this.careerHas(level.id, id) ? 'before' : ''}">${name(id)}</div>`).join('')
      } else {
        this.letters.innerHTML = sim.data.run.letters.map((l) => `<b class="${ss.letters.includes(l.letter) ? 'got' : ''}">${l.letter}</b>`).join('')
        this.goals.innerHTML = sim.data.run.goals.map((g) => `<div class="${ss.goalsDone.includes(g.id) ? 'done' : ''}">${g.name}</div>`).join('')
      }
    }
    // the trick string
    // The trick in the air: in the rider's stance (Switch, Nollie, Fakie), named as soon as the body's turn names it (a Bigspin).
    const airTrick = (() => {
      if (!sk.trick) return ''
      const nd = sk.trick.named ? (sim.data.tricks as unknown as { named?: { id: string; name: string }[] }).named?.find((x) => x.id === sk.trick!.named) : undefined
      const name = nd?.name ?? trickDef(sim, sk.trick.id, sk.trick.kind)?.name ?? ''
      return name ? airName(sk, name) : ''
    })()
    const running = sk.grind?.name ?? sk.lip?.name ?? sk.manual?.name ?? sk.skitch?.name ?? (sk.wall ? 'Wallride' : airTrick)
    const names = [...sk.combo.map((c) => c.name), running].filter(Boolean)
    if (names.length) {
      const v = comboValue(sim, sk.combo)
      const named = this.sig(names.join(' + '))
      // Repeats in this combo (worth less each time, THPS style) are drawn faded with their share.
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      const parts = [...sk.combo.map((c, i) => ({ name: this.sig(c.name).text, share: c.points > 0 ? v.values[i] / c.points : 1 })), ...(running ? [{ name: this.sig(running).text, share: 1 }] : [])]
      this.trickNames.innerHTML = parts.map((p) => p.share < 0.99 ? `<span class="tn rep">${esc(p.name)} <small>${Math.round(p.share * 100)}%</small></span>` : `<span class="tn">${esc(p.name)}</span>`).join(' + ')
      this.trickNames.classList.toggle('special', named.special)
      this.trickPts.innerHTML = !sk.combo.length ? '' : v.multiplier > 1 ? `${fmt(v.points / v.multiplier)} <i>×</i> ${v.multiplier}` : fmt(v.points)
      this.trick.className = 'hud-trick live'
      if (this.holdUntil) { this.callout.className = 'hud-callout'; this.holdUntil = 0 }
    } else if (now > this.holdUntil) { this.trick.className = 'hud-trick'; this.callout.className = 'hud-callout'; this.holdUntil = 0 }
    // balance
    const bal = sk.grind ?? sk.lip ?? sk.manual ?? sk.skitch
    this.balance.classList.toggle('on', !!bal)
    // Manuals balance nose-to-tail: the meter stands up, like THPS; grinds and lips side to side.
    this.balance.classList.toggle('vertical', !!sk.manual && !sk.grind && !sk.lip)
    if (bal) {
      const b = Math.max(-1, Math.min(1, bal.balance))
      if (this.balance.classList.contains('vertical')) { this.balanceDot.style.left = ''; this.balanceDot.style.top = `${50 - b * 46}%` }
      else { this.balanceDot.style.top = ''; this.balanceDot.style.left = `${50 + b * 46}%` }
      this.balance.classList.toggle('danger', Math.abs(b) > 0.65)
    }
  }

  // ---------------- events ----------------
  event(e: SimEvent, now: number) {
    if (!this.demo) {
      if (e.t === 'comboLanded') { this.stats.combos++; this.stats.bestCombo = Math.max(this.stats.bestCombo, e.points) }
      if (e.t === 'bail') this.stats.slams++
      if (e.t === 'burrito') this.stats.burritos++
    }
    if (e.t === 'comboLanded') {
      const tierLines = [...this.d.praise].reverse().find((t) => e.points >= t.min) ?? this.d.praise[0]
      const named = this.sig(e.name)
      const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
      this.trickNames.innerHTML = e.entries?.length ? e.entries.map((c) => { const share = c.points > 0 && c.value !== undefined ? c.value / c.points : 1; const n = esc(this.sig(c.name).text); return share < 0.99 ? `<span class="tn rep">${n} <small>${Math.round(share * 100)}%</small></span>` : `<span class="tn">${n}</span>` }).join(' + ') : esc(named.text)
      this.trickNames.classList.toggle('special', named.special)
      this.trickPts.innerHTML = `+${fmt(e.points)}${e.multiplier > 1 ? ` <small>(×${e.multiplier})</small>` : ''}`
      this.trick.className = 'hud-trick landed'
      const big = e.points >= (this.d.praise[2]?.min ?? 5000)
      this.callout.innerHTML = `<span>${pick(tierLines.lines)}</span>`
      this.callout.className = `hud-callout on${big ? ' big' : ''}`
      this.holdUntil = now + this.d.comboHoldSeconds * 1000
    }
    if (e.t === 'comboLost') {
      this.trickNames.textContent = e.name
      this.trickPts.textContent = 'BAILED'
      this.trick.className = 'hud-trick bailed'
      if (now - this.carHitAt > 300) {   // a car hit already said its line
        this.callout.innerHTML = `<span>${pick(this.d.bail)}</span>`
        this.callout.className = 'hud-callout on slam'
      }
      this.holdUntil = now + this.d.comboHoldSeconds * 1000
    }
    if (e.t === 'runStart') this.topSpeed = 0
    if (e.t === 'gap') this.pop(e.gap, `+${fmt(e.points)}`, 'gap')
    if (e.t === 'letter') this.pop(e.letter, e.have.split('').join(' '), 'letter')
    if (e.t === 'carLand') this.pop('Roof', 'car top', 'goal')
    if (e.t === 'goalComplete') {
      const fresh = !this.cityGoalsDone().has(e.id)
      this.markGoal(e.id)
      this.pop(fresh ? 'Goal complete' : 'Goal', e.name, 'goal', true)
    }
    if (e.t === 'courierPickup') this.pop('Order up', `${e.place}${e.bonus ? `${EM}+${Math.round(e.bonus)} s carried` : ''}`, 'letter')
    if (e.t === 'courierDeliver') this.pop('Delivered', `+${fmt(e.points)}${EM}${e.place}`, 'goal')
    if (e.t === 'bombStart') { this.racers = []; this.pop('Go', `down ${this.bombNames[e.route] ?? 'the hill'}`, 'goal') }
    if (e.t === 'racerFinish') this.racers.push({ name: e.name, place: e.place, time: e.time })
    // Game of S.K.A.T.E.: the calls, the letters, and what the local says.
    if (e.t === 'skateStart') { this.skateName = e.name; this.pop('GAME OF S.K.A.T.E.', `vs ${e.name} from ${e.hood}`, 'goal') }
    if (e.t === 'skateSet') { this.pop(e.by === 'player' ? 'YOU SET' : `${this.skateName.toUpperCase()} SETS`, e.name, 'gap'); this.localSays(e.line) }
    if (e.t === 'skateSetMiss') { this.pop(e.by === 'player' ? 'NO SET' : `${this.skateName.toUpperCase()} MISSED`, e.reason, 'ghost-behind'); this.localSays(e.line) }
    if (e.t === 'skateMatch') { this.pop(e.ok ? (e.by === 'player' ? 'MATCHED' : `${this.skateName.toUpperCase()} MATCHED`) : (e.by === 'player' ? 'MISSED' : `${this.skateName.toUpperCase()} MISSED`), e.ok ? e.name : e.reason, e.ok ? 'goal' : 'ghost-behind'); this.localSays(e.line) }
    if (e.t === 'skateLetter') this.pop(e.letters.slice(-1), `${e.who === 'player' ? 'you have' : `${this.skateName} has`} ${e.letters}`, 'letter')
    if (e.t === 'bombCheckpoint') this.pop(e.gate.toUpperCase(), `${e.time.toFixed(2)} s`, 'gap')
    if (e.t === 'comboStart') this.pop('COMBO CHALLENGE', 'best single combo wins', 'special')
    if (e.t === 'carHit') {
      const lines = (e.robo ? this.d.robotaxiHit : this.d.carHit) ?? ['Hit by a car.']
      this.carHitAt = now
      this.callout.innerHTML = `<span>${pick(lines)}</span>`
      this.callout.className = 'hud-callout on slam'
      this.holdUntil = now + this.d.comboHoldSeconds * 1000
    }
    if (e.t === 'muniStart') this.pop('MUNI RACE', `beat the ${e.name} to ${stopName(e.stops[e.stops.length - 1])}`, 'goal')
    if (e.t === 'muniStop') this.pop(e.you ? 'STOP' : 'MUNI', `${e.you ? 'you reached' : 'the streetcar reached'} ${stopName(e.name)}`, e.you ? 'gap' : 'ghost-behind')
    if (e.t === 'escapeStart') this.pop('ROBOTAXI ESCAPE', 'it thinks you are a road hazard', 'special')
    if (e.t === 'escapeRecalc') this.pop('RECALCULATING', `${e.seconds.toFixed(0)} s`, 'gap')
    if (e.t === 'escapeClose') this.toast('Honk. Honk. (Politely.)')
    if (e.t === 'escapeBackup') this.pop('BACKUP', 'a second robotaxi is on its way', 'special')
    if (e.t === 'levelGoal') this.pop('GOAL', e.name, 'goal', true)
    if (e.t === 'tapeFound') this.pop('SECRET TAPE', 'you found it', 'special')
    if (e.t === 'levelWrongWay') { this.hintEl.innerHTML = 'Wrong way: back to the level'; this.hintEl.classList.add('on'); this.hintUntil = now + 1e9 }
    if (e.t === 'levelBack') { this.hintEl.classList.remove('on'); this.hintUntil = 0 }
    if (e.t === 'nearMiss') this.pop('NEAR MISS', `+${fmt(e.points)}`, 'gap')
    if (e.t === 'pedHit' && e.bail) {
      this.carHitAt = now
      this.callout.innerHTML = `<span>${pick(this.d.pedHit ?? ['Sorry.'])}</span>`
      this.callout.className = 'hud-callout on slam'
      this.holdUntil = now + this.d.comboHoldSeconds * 1000
    }
    if (e.t === 'burrito') this.pop('Burrito', `${e.n} of ${e.of}${EM}+${fmt(e.points)}`, 'burrito')
    if (e.t === 'goal') this.pop('GOAL', e.goal, 'goal', true)
    if (e.t === 'specialReady') this.pop('SPECIAL', 'two arrows + flip or grab', 'special')
  }

  private pop(title: string, sub: string, kind: string, freeze = false) {
    const p = el('div', `pop ${kind}`, this.pops, `<b>${title}</b><span>${sub}</span>`)
    p.style.setProperty('--r', `${(Math.random() * 6 - 3).toFixed(1)}deg`)
    // A goal: the pop freezes big for a moment (with the camera's punch-in), then settles and goes.
    const hold = freeze ? 600 : 0
    if (hold) p.classList.add('freeze')
    setTimeout(() => p.classList.add('out'), 1600 + hold)
    setTimeout(() => p.remove(), 2100 + hold)
    while (this.pops.children.length > 3) this.pops.firstElementChild!.remove()
  }

  toast(msg: string) {
    this.toastEl.textContent = msg
    this.toastEl.classList.add('on')
    clearTimeout(this.toastTimer)
    this.toastTimer = window.setTimeout(() => this.toastEl.classList.remove('on'), 2600)
  }

  /** The camcorder's REC with its dot while a clip records (main: the share clip). */
  rec(on: boolean) { this.recEl.classList.toggle('on', on) }

  /** The caption shows or goes; while it shows the talk prompt steps aside (both live at the foot of the screen). */
  private captionOn(on: boolean) { this.captionEl.classList.toggle('on', on); if (this.root.classList.contains('captioning') !== on) this.root.classList.toggle('captioning', on) }

  /** A caption for a spoken line: who is talking and what they say, while they say it. */
  caption(who: string, text: string, seconds: number) {
    this.captionEl.innerHTML = `<b>${escHtml(who)}</b><span>${escHtml(text)}</span>`
    this.captionOn(true)
    clearTimeout(this.captionTimer)
    this.captionTimer = window.setTimeout(() => this.captionOn(false), Math.max(2200, (seconds + 0.6) * 1000))
  }

  /** A caption set and cleared from outside (clips time it by frames, not timers); null hides it. */
  setCaption(who: string | null, text = '') {
    if (!who) { this.captionOn(false); return }
    const html = `<b>${escHtml(who)}</b><span>${escHtml(text)}</span>`
    if (this.captionEl.innerHTML !== html) this.captionEl.innerHTML = html
    this.captionOn(true)
  }

  /** The radio's strip: station and what is playing. */
  // Where you are: a THPS-style banner when you roll into a neighbourhood or a landmark (data/ui.json
  // places; positions from OpenStreetMap). A landmark within its radius wins, else the nearest
  // neighbourhood centre. You must stay holdSeconds before it shows; each place waits cooldownSeconds.
  private placeEl: HTMLElement
  /** Called when you roll into a landmark or neighbourhood (for stickers and the daily). */
  onPlace: (name: string) => void = () => {}
  private placeNow = ''
  private placeCand = ''
  private placeSince = 0
  private placeShown: Record<string, number> = {}
  private placeTimer = 0
  placeAt(x: number, y: number): { name: string; line: string } | null {
    const P = this.d.places
    if (!P) return null
    for (const s of P.spots) if (s.box ? x >= s.box[0] && y >= s.box[1] && x <= s.box[2] && y <= s.box[3] : Math.hypot(x - s.at[0], y - s.at[1]) <= s.r) return s
    let best: { name: string; line: string } | null = null, bd = Infinity
    for (const h of P.hoods) { const d = Math.hypot(x - h.at[0], y - h.at[1]); if (d < bd) { bd = d; best = h } }
    return best
  }
  private placeTick(x: number, y: number, now: number) {
    const P = this.d.places, p = this.placeAt(x, y)
    if (!P || !p) return
    if (p.name !== this.placeCand) { this.placeCand = p.name; this.placeSince = now }
    if (p.name === this.placeNow || now - this.placeSince < P.holdSeconds * 1000) return
    this.placeNow = p.name
    this.onPlace(p.name)
    if (now - (this.placeShown[p.name] ?? -Infinity) < P.cooldownSeconds * 1000) return
    this.placeShown[p.name] = now
    this.placeEl.innerHTML = `<b>${p.name}</b><span>${p.line}</span>`
    this.placeEl.classList.remove('on'); void this.placeEl.offsetWidth; this.placeEl.classList.add('on')
    clearTimeout(this.placeTimer)
    this.placeTimer = window.setTimeout(() => this.placeEl.classList.remove('on'), P.showSeconds * 1000)
  }

  radio(title: string, line: string) {
    this.radioEl.innerHTML = line ? `<b>${title}</b><span>${line}</span>` : `<b>${title}</b>`
    this.radioEl.classList.add('on')
    clearTimeout(this.radioTimer)
    this.radioTimer = window.setTimeout(() => this.radioEl.classList.remove('on'), 6000)
  }

  /** Local high scores (this browser): top 10 runs. Returns the run's rank (1-based) or 0. */
  private scores(): { score: number; combo: number; who: string; when: string; speed: number }[] {
    try { return JSON.parse(localStorage.getItem('soma-skate:scores') ?? '[]') } catch { return [] }
  }
  private record(score: number, combo: number, who: string): number {
    const list = this.scores()
    const entry = { score, combo, who, when: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), speed: Math.round(this.topSpeed) }
    list.push(entry); list.sort((a, b) => b.score - a.score)
    const top = list.slice(0, 10)
    try { localStorage.setItem('soma-skate:scores', JSON.stringify(top)) } catch { /* private window */ }
    return top.indexOf(entry) + 1
  }
  /** City goals completed in any session (this browser). */
  cityGoalsDone(): Set<string> { try { return new Set(JSON.parse(localStorage.getItem('soma-skate:city-goals') ?? '[]')) } catch { return new Set() } }
  private markGoal(id: string) { const s = this.cityGoalsDone(); s.add(id); try { localStorage.setItem('soma-skate:city-goals', JSON.stringify([...s])) } catch { /* private window */ } }

  showGoals(goals: { id: string; name: string; area: string; description: string }[]) {
    const done = this.cityGoalsDone()
    const areas = [...new Set(goals.map((g) => g.area))]
    this.helpEl.dataset.mode = 'tricks'
    this.helpEl.innerHTML = `<h2>Goals <small class="goal-count">${goals.filter((g) => done.has(g.id)).length} of ${goals.length}</small></h2><div class="goals-grid">${areas.map((a) => `<div><h3>${a}</h3>${goals.filter((g) => g.area === a).map((g) => `<div class="goal-row ${done.has(g.id) ? 'done' : ''}"><b>${g.name}</b><span>${g.description}</span></div>`).join('')}</div>`).join('')}</div><small>Goals are always on, in free skate and every mode. Esc closes.</small>`
    this.setHelp(true)
  }

  /** Hill bomb: how you compare with your ghost at a gate. */
  ghostSplit(d: number) { this.pop(d <= 0 ? `${d.toFixed(2)} s` : `+${d.toFixed(2)} s`, d <= 0 ? 'ahead of your ghost' : 'behind your ghost', d <= 0 ? 'goal' : 'ghost-behind') }

  showCredits() {
    this.helpEl.dataset.mode = 'tricks'
    this.helpEl.innerHTML = `<h2>Credits</h2><div class="credits">${(this.d.credits ?? []).map((c) => `<div><h3>${c.title}</h3>${c.lines.map((l) => `<p>${l}</p>`).join('')}</div>`).join('')}</div><small>Esc closes.</small>`
    this.setHelp(true)
  }

  /** Today's challenge done: a card like a sticker, with the streak. */
  dailyDone(text: string, streak: number) {
    this.stickerEarned({ name: streak > 1 ? `Today done${EM}${streak} days in a row` : 'Today done', line: text, art: 'hella' })
  }
  /** The Tour career's goals done before (set by main), for the level checklist. */
  careerHas: (level: string, goal: string) => boolean = () => false
  /** A Tour level's results: score, the goals this run, the career count, a level it opened. */
  levelResults(e: Extract<SimEvent, { t: 'levelOver' }>, levelName: string, goals: { name: string; now: boolean; before: boolean }[], career: { total: number; max: number }, opened: string[], again: string) {
    const nowCount = goals.filter((g) => g.now).length
    this.resultsEl.innerHTML = `<div class="res-card">
      <div class="res-title">${levelName.toUpperCase()}</div>${this.whoLine()}
      <div class="res-score">${fmt(e.score)}</div>
      ${opened.length ? `<div class="res-best">NEW LEVEL: ${opened.join(', ').toUpperCase()}</div>` : ''}
      <div class="res-line">${nowCount ? `${nowCount} goal${nowCount > 1 ? 's' : ''} this run.` : 'No goals this run. The hills are not going anywhere.'} Tour: ${career.total} / ${career.max} goals.</div>
      <div class="res-goals">${goals.map((g) => `<div class="${g.now ? 'done' : g.before ? 'before' : ''}">${g.name}</div>`).join('')}</div>
      <div class="res-again">${again}</div>
    </div>`
    this.fillWho()
    this.resultsEl.classList.add('on')
  }

  /** A milestone or an unlock: its name in type on the right, then gone. */
  stickerEarned(s: { name: string; line: string; art: string }, label = 'MILESTONE') {
    // Two at once (a tape's sticker and the skater it unlocks): the new one stacks above.
    const showing = this.root.querySelectorAll('.sticker-earned:not(.out)').length
    // An unlocked skater turning (its strip from tools/portraits.ts --turn); a milestone is type only.
    const turn = label === 'UNLOCKED' ? `<i class="turn" style="background-image:url(assets/ui/portrait/turn/${escHtml(s.art)}.jpg)"></i>` : ''
    const el2 = el('div', 'sticker-earned', this.root, `${turn}<small>${label}</small><b>${s.name}</b><span>${s.line}</span>`)
    if (showing) el2.style.bottom = `${300 + showing * 132}px`
    window.setTimeout(() => el2.classList.add('out'), 3600)
    window.setTimeout(() => el2.remove(), 4200)
  }
  /** Milestones: every one, earned in paper, the rest dim with what earns them. */
  showStickers(list: { name: string; line: string; art: string; earned: boolean; progress: number; count?: number }[]) {
    const n = list.filter((s) => s.earned).length
    this.helpEl.dataset.mode = 'tricks'
    this.helpEl.innerHTML = `<h2>Milestones <small class="goal-count">${n} of ${list.length}</small></h2><div class="sticker-grid">${list.map((s) => `<div class="sb ${s.earned ? 'got' : ''}">${s.earned ? `<b>${s.name}</b>` : ''}<span>${s.line}${!s.earned && (s.count ?? 1) > 1 ? ` (${s.progress} of ${s.count})` : ''}</span></div>`).join('')}</div><small>Kept in this browser. Esc closes.</small>`
    this.setHelp(true)
  }

  /** The best run in this browser, for the menu's preview. */
  scoresBest(): string | null { const b = this.scores()[0]; return b ? fmt(b.score) : null }
  /** The top runs, for the menu's preview. */
  scoresRows(): [string, string][] { return this.scores().slice(0, 5).map((s, i) => [`${i + 1}  ${s.who}`, fmt(s.score)]) }
  showScores() {
    const list = this.scores()
    this.helpEl.dataset.mode = 'tricks'
    // Game mode bests: courier deliveries, best single combo, each hill bomb route's time, Muni, Escape, Graffiti, S.K.A.T.E. wins.
    const B = this.bests(), modes: [string, string][] = []
    if (B.courier) modes.push(['Courier', `${B.courier} deliveries`])
    if (B.combo) modes.push(['Combo Challenge', fmt(B.combo)])
    for (const [id, name] of Object.entries(this.bombNames)) { const t = this.bombBest(id); if (t) modes.push([`${name} bomb`, `${t.toFixed(2)} s`]) }
    if (B.muni) modes.push(['Muni Race, fastest win', `${B.muni.toFixed(1)} s`])
    if (B.escape) modes.push(['Robotaxi Escape', fmt(B.escape)])
    if (B.graffiti) modes.push(['Graffiti', `${B.graffiti} pieces`])
    if (B.skateWins) modes.push(['Game of S.K.A.T.E.', `${B.skateWins} win${B.skateWins === 1 ? '' : 's'}`])
    const modeHtml = modes.length ? `<h3>Game modes</h3><div class="hs">${modes.map(([k, v]) => `<div class="hs-row"><b>·</b><span>${v}</span><i>${k}</i></div>`).join('')}</div>` : ''
    this.helpEl.innerHTML = `<h2>High scores</h2>${list.length ? `<div class="hs">${list.map((s, i) => `<div class="hs-row"><b>${i + 1}</b><span>${fmt(s.score)}</span><i>${s.who}</i><em>best combo ${fmt(s.combo)}${EM}${this.speedText(s.speed)}${EM}${s.when}</em></div>`).join('')}</div>` : '<p>No runs yet. Start a run from the menu.</p>'}${modeHtml}<small>Kept in this browser. Esc closes.</small>`
    this.setHelp(true)
  }

  results(e: Extract<SimEvent, { t: 'runOver' }>, sim: Sim, again: string, who = '') {
    const d = this.d
    const rank = this.record(e.score, e.bestCombo, who)
    const best = this.scores()[0]
    const line = pick(d.results).replace('{score}', fmt(e.score)).replace('{pct}', (e.score / d.rent / 100).toFixed(1)).replace('{burritos}', (() => { const n = Math.max(1, Math.round(e.score / d.burrito / 10)); return `${fmt(n)} Mission burrito${n === 1 ? '' : 's'}` })())
    const goals = sim.data.run.goals
    this.resultsEl.innerHTML = `<div class="res-card">
      <div class="res-title">RUN OVER</div>${this.whoLine()}
      <div class="res-score">${fmt(e.score)}</div>
      ${rank === 1 ? '<div class="res-best">NEW PERSONAL BEST</div>' : best ? `<div class="res-prev">Your best: ${fmt(best.score)} (${best.who})</div>` : ''}
      <div class="res-line">${line}</div>
      <div class="res-row"><span>Best combo</span><b>${fmt(e.bestCombo)}</b></div>
      <div class="res-row"><span>Top speed</span><b>${this.speedText(this.topSpeed)}</b></div>
      <div class="res-row"><span>Goals</span><b>${e.goals.length} / ${goals.length}</b></div>
      <div class="res-goals">${goals.map((g) => `<div class="${e.goals.includes(g.id) ? 'done' : ''}">${g.name}</div>`).join('')}</div>
      <div class="res-again">${again}</div>
    </div>`
    this.fillWho()
    this.resultsEl.classList.add('on')
  }
  hideResults() { this.resultsEl.classList.remove('on', 'with-replay'); this.replayTag.classList.remove('on') }
  /**
   * The results card with your best combo looping behind it (slow motion): the card moves left and the
   * dim lifts off the right, where a tag names the combo. name '' takes it away.
   */
  resultsReplay(name: string, points: number) {
    this.resultsEl.classList.toggle('with-replay', !!name)
    this.replayTag.classList.toggle('on', !!name)
    if (name) this.replayTag.innerHTML = `<small>BEST COMBO${EM}REPLAY</small><b></b><span>${fmt(points)}</span>`
    if (name) this.replayTag.querySelector('b')!.textContent = name
  }
  /** The Tour level intro card: the level's name and its own goals over the flyover; null hides it. */
  levelIntro(card: { name: string; goals: string[]; skip: string } | null) {
    if (!card) { this.introEl.classList.remove('on'); return }
    this.introEl.innerHTML = `<small>TOUR</small><b></b><ul>${card.goals.map(() => '<li></li>').join('')}</ul><i>${card.skip}</i>`
    this.introEl.querySelector('b')!.textContent = card.name
    this.introEl.querySelectorAll('li').forEach((li, i) => { li.textContent = card.goals[i] })
    this.introEl.classList.add('on')
  }
  get resultsOpen() { return this.resultsEl.classList.contains('on') }

  /** The trick list, built from data/tricks.json so it always matches the game. */
  showTricks(tricks: unknown) {
    const t = tricks as { flips: Trick[]; grabs: Trick[]; grinds: Rail[]; slides: Rail[]; manuals?: Trick[]; specials?: (Trick & { seq: string[]; kind: string })[]; powerslides?: Trick[]; foot?: (Trick & { seq: string[] })[]; lips?: Trick[] }
    const taps = (x: object, k: string) => ((x as { taps?: number }).taps === 2 ? ` <kbd>${k}</kbd> <kbd>${k}</kbd>` : '')
    const arrow: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→', none: '', upleft: '↖', upright: '↗', downleft: '↙', downright: '↘',
      upToward: '↑ + toward', upAway: '↑ + away', downToward: '↓ + toward', downAway: '↓ + away', toward: 'toward', away: 'away' }
    const a = (d: string) => arrow[d] ?? d
    // A flip's keys: the arrow (twice for the double-direction slots, Right, Right + J), then J once per tap (J J double, J J J triple).
    const flipKeys = (f: Trick) => { const x = f as Trick & { taps?: number; twice?: boolean; dir?: string }; return `${x.twice ? a(x.dir ?? '') + ' ' : ''}${a(x.dir ?? '')}${x.taps ? ' ' + Array(x.taps).fill('<kbd>J</kbd>').join(' ') : ''}` }
    const mine = this.d.signatures?.[this.character()] ?? {}
    const col = (title: string, rows: string[]) => `<div class="tl-col"><h3>${title}</h3>${rows.join('')}</div>`
    const row = (name: string, keys: string, pts?: number) => `<div class="tl-row"><span>${name}</span><b>${keys}</b>${pts ? `<i>${pts}</i>` : ''}</div>`
    const html = `<h2>Tricks</h2><div class="tl-grid">
      ${col('Flips&emsp;<kbd>J</kbd>+ arrow, <kbd>J J</kbd>double tap, <kbd>J J J</kbd>triple', [
        ...t.flips.map((f) => row(f.name, flipKeys(f), f.points)),
        ...((tricks as { named?: { name: string; points: number; spin: string; of: string }[] }).named ?? []).map((n) => { const f = t.flips.find((x) => x.id === n.of); return row(n.name, `${f ? flipKeys(f) : ''} + ${n.spin.slice(0, 2).toUpperCase()} ${n.spin.slice(2)}`, n.points) }),
      ])}
      ${col('Grabs&emsp;<kbd>L</kbd>+ arrow, <kbd>L L</kbd>double tap', t.grabs.map((g) => row(g.name, `${a(g.dir ?? '')}${taps(g, 'L')}`, g.points)))}
      ${col('Grinds&emsp;<kbd>I</kbd>+ arrow, <kbd>I I</kbd>double tap', t.grinds.map((g) => row(g.name, ((g.dirs ?? []).map(a).filter(Boolean).join(' / ') || '—') + ((g as Rail & { taps?: number }).taps === 2 ? ' <kbd>I</kbd> <kbd>I</kbd>' : ''), g.points)))}
      ${col('Slides&emsp;<kbd>I</kbd>across', t.slides.map((g) => row(g.name, (g.dirs ?? []).map(a).filter(Boolean).join(' / ') || '—', g.points)))}
      ${col('Lip tricks&emsp;<kbd>I</kbd>at the coping', (t.lips ?? []).map((l) => row(l.name, a(l.dir ?? '') || 'no arrow', l.points)))}
      ${col('Off the nose&emsp;<kbd>Q</kbd>or <kbd>U O</kbd>held, let go of <kbd>K</kbd>', [row('Nollie', 'rolling forward'), row('Switch', 'rolling backward'), row('Fakie', 'riding backward')])}
      ${col('Specials, meter full', (t.specials ?? []).map((s) => row(mine[s.id] ?? s.name, `${s.seq.map(a).join(' ')} + <kbd>${s.kind === 'grab' ? 'L' : 'J'}</kbd>`, s.points)))}
      ${col('On the ground', [
        ...(t.manuals ?? []).map((m) => row(m.name, m.id === 'nosemanual' ? '↓ ↑' : '↑ ↓', m.points)),
        ...(t.powerslides ?? []).map((m) => row(m.name, m.id === 'bertslide' ? '<kbd>Shift</kbd> + <kbd>K</kbd>' : '<kbd>Shift</kbd>', m.points)),
        ...(t.foot ?? []).map((m) => row(m.name, `${m.seq.map(a).join(' ')}, let go <kbd>K</kbd>`, m.points)),
        row('Skitch', 'behind a car: hold <kbd>L</kbd>', 100),
        row('Spine Transfer', 'in the air: <kbd>;</kbd>', 250),
      ])}
    </div><small>Toward and away: to the rail's far side. A double tap: the button twice, quickly. On a pad the nose pop is L1 and R1 together. Esc closes.</small>`
    this.helpEl.dataset.mode = 'tricks'
    this.helpEl.innerHTML = html
    this.setHelp(true)
  }
  // ---- How to skate: groups on the left (display type), the picked group's keys on the right ----
  private keysTitle = ''
  private keyGroups: { title: string; note: string; rows: [string, string][] }[] = []
  private keyGroup = 0
  private keyRow = -1   // -1: picking a group; else the row the cursor is on inside it

  private drawKeys() {
    const G = this.keyGroups[this.keyGroup]
    if (!G) return
    const inside = this.keyRow >= 0
    const groups = this.keyGroups.map((g, i) => `<button class="hk-group${i === this.keyGroup ? ' sel' : ''}" data-g="${i}">${g.title}</button>`).join('')
    const rows = G.rows.map(([l, k], i) => `<div class="hk-row${i === this.keyRow ? ' sel' : ''}"><span>${l}</span><b>${k}</b></div>`).join('')
    // The Esc entry is a button too (touch screens and the mouse have no Esc).
    const foot = inside ? '<span><kbd>↑↓</kbd>pick</span><button data-act="back"><kbd>Esc</kbd>back</button>' : '<span><kbd>↑↓</kbd>pick</span><span><kbd>Enter</kbd>open</span><button data-act="close"><kbd>Esc</kbd>close</button>'
    this.helpEl.innerHTML = `<h2>${this.keysTitle}</h2><div class="hk${inside ? ' in' : ''}"><div class="hk-groups">${groups}</div><div class="hk-rows">${rows}${G.note ? `<p class="hk-note">${G.note}</p>` : ''}</div></div><div class="hk-foot">${foot}</div>`
    this.helpEl.querySelectorAll<HTMLElement>('.hk-group').forEach((b) => { b.onclick = () => { this.keyGroup = Number(b.dataset.g); this.keyRow = -1; this.drawKeys() } })
    const act = this.helpEl.querySelector<HTMLElement>('.hk-foot button')
    if (act) act.onclick = () => { if (act.dataset.act === 'back') { this.keyRow = -1; this.drawKeys() } else this.hideHelp() }
  }
  private keysKey(e: KeyboardEvent) {
    if (!this.helpEl.classList.contains('on') || this.helpEl.dataset.mode || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return
    const c = e.code, n = this.keyGroups.length, rows = this.keyGroups[this.keyGroup]?.rows.length ?? 0
    const up = c === 'ArrowUp' || c === 'KeyW', down = c === 'ArrowDown' || c === 'KeyS'
    const open = c === 'Enter' || c === 'NumpadEnter' || c === 'Space' || c === 'KeyK' || c === 'ArrowRight' || c === 'KeyD'
    const back = c === 'Escape' || c === 'ArrowLeft' || c === 'KeyA' || c === 'Backspace'
    if (!up && !down && !open && !back) return
    e.preventDefault(); e.stopImmediatePropagation()
    if (this.keyRow < 0) {
      if (up || down) { this.keyGroup = (this.keyGroup + (down ? 1 : -1) + n) % n; this.drawKeys() }
      else if (open && rows) { this.keyRow = 0; this.drawKeys() }
      else if (back) this.hideHelp()
      return
    }
    if (up || down) { this.keyRow = (this.keyRow + (down ? 1 : -1) + rows) % rows; this.drawKeys() }
    else if (back) { this.keyRow = -1; this.drawKeys() }
  }
  /** Back to How to skate (from the trick list, goals, scores), Basics open. */
  private resetKeys() { delete this.helpEl.dataset.mode; this.keyGroup = 0; this.keyRow = -1; this.drawKeys() }

  toggleHelp() {
    if (this.helpEl.dataset.mode === 'tricks') { this.resetKeys(); this.setHelp(true); return }
    const on = !this.helpEl.classList.contains('on')
    if (on) this.resetKeys()
    this.setHelp(on)
  }
  /** The help and the other read-only screens over the menu (the root's class hides the menu under them). */
  private setHelp(on: boolean) { this.helpEl.classList.toggle('on', on); this.root.classList.toggle('helping', on) }
  hideHelp() { this.setHelp(false); if (this.helpEl.dataset.mode === 'tricks') this.resetKeys() }
  tip() { return pick(this.d.tips) }
}
