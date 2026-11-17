import type { GameData } from '../sim/data.ts'
import type { SimEvent } from '../sim/sim.ts'
import type { Thing } from '../sim/thing.ts'
import type { TouchGlyph } from './touch.ts'

// Skate School with Karl the Fog (data/school.json): the tutorial. The lessons run in order; each
// starts at its spot (the caller teleports there), shows Karl's card with the keys, and is checked
// from the sim's events and the skater (client side, so the game and the clips judge it the same way).
// School is the state machine (no DOM): feed it every tick's events and the skater; it says when a
// lesson starts (its teleport and setup), when it is done, when to show the hint, when a failed try
// puts you back at the start, and when you graduate. SchoolCard draws Karl's card in the HUD;
// SchoolAsk is the one-time question on the first launch and the graduation card.

type Step = { t: string; min?: Record<string, number>; max?: Record<string, number>; is?: Record<string, (string | number | boolean)[]>; tricks?: 'flips' | 'grabs' | 'specials'; has?: ('grind' | 'manual' | 'special')[] }
export type Lesson = {
  id: string; title: string; spot: string; setup?: string[]; boost?: number; reset?: boolean
  say: string; hint: string; done: string
  keys: { do: string[]; label: string }[]
  check: { steps?: Step[]; ride?: { speed: number; turn: number }; walk?: number; air?: boolean }
}
export type SchoolData = {
  parks: string[]; hintTries: number; hintSeconds: number; doneSeconds: number; resetSeconds: number; landGraceSeconds: number
  prompt: { title: string; line: string; yes: string; no: string }
  graduate: { event: string; sticker: string; title: string; line: string; tour: string; modes: string; stay: string }
  lessons: Lesson[]
}
/**
 * What a tick changed: a lesson starts (run its commands: the teleport and setup), one is done, the hint
 * shows, the lesson starts over at its spot (redo: after a failed try where the lesson resets, or R),
 * the school is over.
 */
export type SchoolSignal =
  | { kind: 'start'; lesson: Lesson; index: number; commands: string[] }
  | { kind: 'done'; lesson: Lesson; index: number }
  | { kind: 'hint'; lesson: Lesson }
  | { kind: 'redo'; lesson: Lesson; commands: string[] }
  | { kind: 'graduated' }

const ang = (a: number) => { let x = a % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x }

export class School {
  readonly d: SchoolData
  private hz: number
  /** The lesson now (index into d.lessons); d.lessons.length once graduated, -1 before the start. */
  i = -1
  /** Steps of the check done so far. */
  step = 0
  /** Failed tries this lesson (bails; in the air lessons, landings without it). */
  tries = 0
  /** Ticks into this lesson (counting on while Karl's done line shows). */
  ticks = 0
  doneAt = -1
  hinted = false
  /** Net heading change while rolling (signed, degrees) and its lowest and highest so far: the turn is their spread. */
  private turn = { net: 0, lo: 0, hi: 0 }
  private lastHeading: number | null = null
  private walked = 0
  private lastPos: { x: number; y: number } | null = null
  /** In the air since the last landing (a pop or off a ramp), not just dropped in by a teleport. */
  private flew = false
  /** A landing without the lesson done is judged a moment later (a revert comes just after the landing). */
  private judgeAt = -1
  /** A failed try in a lesson that resets: back to its spot at this tick. */
  private redoAt = -1
  private sets: Record<string, Set<string>>

  constructor(d: SchoolData, data: GameData) {
    this.d = d
    this.hz = data.physics.tickHz
    const T = data.tricks
    this.sets = {
      flips: new Set(T.flips.map((x) => x.name)), grabs: new Set(T.grabs.map((x) => x.name)), specials: new Set(T.specials.map((x) => x.name)),
      grind: new Set([...T.grinds.map((x) => x.id), ...T.slides.map((x) => x.id)]), manual: new Set(T.manuals.map((x) => x.id)), special: new Set(T.specials.map((x) => x.id)),
    }
  }

  get lesson(): Lesson | null { return this.d.lessons[this.i] ?? null }
  get finished() { return this.i >= this.d.lessons.length }
  get active() { return this.i >= 0 && !this.finished }
  /** Karl's done line is showing (this lesson done, the next not started yet). */
  get celebrating() { return this.doneAt >= 0 }
  /** How far it has turned while rolling this lesson (degrees). */
  get turned() { return this.turn.hi - this.turn.lo }
  /** The commands that put you at a lesson's start. */
  commandsOf(L: Lesson) { return [`teleport ${L.spot}`, ...(L.setup ?? [])] }

  /** Start at the first lesson (or another). */
  start(at = 0): SchoolSignal[] { return this.begin(at) }
  /** Skip the lesson now (the pause menu): straight to the next. */
  skip(): SchoolSignal[] { return this.active ? this.begin(this.i + 1) : [] }
  /** Back to this lesson's start (R): its tries and hint stay. */
  restart(): SchoolSignal[] {
    const L = this.lesson
    if (!L || !this.active || this.celebrating) return []
    this.fresh()
    return [{ kind: 'redo', lesson: L, commands: this.commandsOf(L) }]
  }

  private fresh() {
    this.step = 0; this.turn = { net: 0, lo: 0, hi: 0 }; this.lastHeading = null; this.walked = 0; this.lastPos = null
    this.flew = false; this.judgeAt = -1; this.redoAt = -1
  }

  private begin(i: number): SchoolSignal[] {
    this.i = i; this.tries = 0; this.ticks = 0; this.doneAt = -1; this.hinted = false
    this.fresh()
    const L = this.lesson
    if (!L) return [{ kind: 'graduated' }]
    return [{ kind: 'start', lesson: L, index: i, commands: this.commandsOf(L) }]
  }

  /** One sim tick: its events and the skater after it. */
  tick(events: readonly SimEvent[], sk: Thing): SchoolSignal[] {
    const L = this.lesson
    if (!L || this.i < 0) return []
    this.ticks++
    if (this.doneAt >= 0) return this.ticks - this.doneAt >= this.d.doneSeconds * this.hz ? this.begin(this.i + 1) : []
    // A teleport (the lesson's own start, R, or a scripted one) starts the riding checks over.
    if (events.some((e) => e.t === 'teleport')) { this.flew = false; this.turn = { net: 0, lo: 0, hi: 0 }; this.lastHeading = null; this.lastPos = null }
    const C = L.check, steps = C.steps ?? [], n = steps.length
    let failed = false
    for (const e of events) {
      if (e.t === 'bail') { this.step = 0; this.walked = 0; this.judgeAt = -1; failed = true; continue }
      if (e.t === 'pop' || e.t === 'air') this.flew = true
      if (this.step < n && this.matches(steps[this.step], e)) { this.step++; if (e.t === 'land') this.flew = false; continue }
      if (e.t === 'land') { if (C.air && this.flew && this.step < n) this.judgeAt = this.ticks + Math.round(this.d.landGraceSeconds * this.hz); this.flew = false }
    }
    // Riding checks: rolling speed and how far it has turned while rolling; walking distance once the steps are done.
    const speed = Math.hypot(sk.vel.x, sk.vel.y)
    if (C.ride) {
      if (sk.state === 'ground' && speed > 1.5) {
        const h = Math.atan2(sk.vel.y, sk.vel.x) * 180 / Math.PI
        if (this.lastHeading !== null) { const T = this.turn; T.net += ang(h - this.lastHeading); T.lo = Math.min(T.lo, T.net); T.hi = Math.max(T.hi, T.net) }
        this.lastHeading = h
      } else this.lastHeading = null
    }
    if (C.walk && this.step >= n) {
      if (sk.state === 'walk' && this.lastPos) this.walked += Math.hypot(sk.pos.x - this.lastPos.x, sk.pos.y - this.lastPos.y)
      this.lastPos = sk.state === 'walk' ? { x: sk.pos.x, y: sk.pos.y } : null
    }
    const rideOk = !C.ride || (speed >= C.ride.speed && this.turned >= C.ride.turn)
    const walkOk = !C.walk || this.walked >= C.walk
    if (this.step >= n && rideOk && walkOk && !failed) {
      this.doneAt = this.ticks; this.judgeAt = -1; this.redoAt = -1
      return [{ kind: 'done', lesson: L, index: this.i }]
    }
    if (this.judgeAt >= 0 && this.ticks >= this.judgeAt) { this.judgeAt = -1; this.step = 0; failed = true }
    const out: SchoolSignal[] = []
    if (failed) {
      this.tries++
      if (L.reset) this.redoAt = this.ticks + Math.round(this.d.resetSeconds * this.hz)
    }
    if (this.redoAt >= 0 && this.ticks >= this.redoAt) { this.fresh(); out.push({ kind: 'redo', lesson: L, commands: this.commandsOf(L) }) }
    if (!this.hinted && (this.tries >= this.d.hintTries || this.ticks >= this.d.hintSeconds * this.hz)) { this.hinted = true; out.push({ kind: 'hint', lesson: L }) }
    return out
  }

  private matches(s: Step, e: SimEvent): boolean {
    if (e.t !== s.t) return false
    const r = e as unknown as Record<string, unknown>
    for (const [k, v] of Object.entries(s.min ?? {})) if (!(Number(r[k]) >= v)) return false
    for (const [k, v] of Object.entries(s.max ?? {})) if (!(Number(r[k]) <= v)) return false
    for (const [k, vs] of Object.entries(s.is ?? {})) if (!vs.includes(r[k] as string | number | boolean)) return false
    if (s.tricks && !this.sets[s.tricks].has(String(r.trick))) return false
    if (s.has) {
      const entries = (r.entries as { id: string }[] | undefined) ?? []
      for (const kind of s.has) if (!entries.some((x) => this.sets[kind].has(x.id))) return false
    }
    return true
  }
}

/** The pad's button names (PlayStation layout, data/controls.json gamepad buttons); the face buttons keep their colours. */
const PAD: Record<number, string> = { 0: '✕', 1: '○', 2: '□', 3: '△', 4: 'L1', 5: 'R1', 6: 'L2', 7: 'R2', 10: 'L3', 12: '↑', 13: '↓', 14: '←', 15: '→' }
const PAD_CLASS: Record<number, string> = { 0: 'cross', 1: 'circle', 2: 'square', 3: 'triangle' }
/** A key code as the game writes it (the Controls page does the same). */
export const keyName = (c: string) => c.replace(/^Key/, '').replace(/^Digit/, '').replace('ArrowUp', '↑').replace('ArrowDown', '↓').replace('ArrowLeft', '←').replace('ArrowRight', '→').replace('Semicolon', ';').replace(/^Shift(Left|Right)$/, 'Shift').replace('NumpadAdd', 'Num +').replace('NumpadDecimal', 'Num .').replace(/^Numpad/, 'Num ')
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)

/**
 * A lesson's key rows as HTML in the game's kbd style: the keyboard (the player's own keys, rebinds
 * included: keysFor) and the pad, e.g. J + A · □ + ←, "in the air: kickflip". '+' and 'then' are words.
 */
export function keyRows(L: Lesson, keysFor: (action: string) => string[], padFor: (action: string) => number[], touchFor?: (action: string) => TouchGlyph): string {
  const join = (row: string[], f: (a: string) => string) => row.map((a) => (a === '+' ? '<i>+</i>' : a === 'then' ? '<i>then</i>' : f(a))).join('')
  // On a touch screen: the on-screen controls themselves (the stick's way, the diamond's circles, the pills).
  if (touchFor) {
    const tg = (a: string) => { const g = touchFor(a); return g.kind === 'stick' ? `<span class="tk tk-stick">${g.arrow}</span>` : g.kind === 'button' ? `<span class="tk tk-btn">${esc(g.key)}<i>${esc(g.label)}</i></span>` : `<span class="tk tk-pill">${esc(g.label)}</span>` }
    return L.keys.map((r) => `<div class="school-row"><span class="school-kb">${join(r.do, tg)}</span><span></span><b>${esc(r.label)}</b></div>`).join('')
  }
  const kb = (a: string) => `<kbd>${esc(keyName(keysFor(a)[0] ?? a))}</kbd>`
  const pd = (a: string) => { const b = padFor(a)[0]; return `<kbd class="pad ${PAD_CLASS[b] ?? ''}">${esc(PAD[b] ?? a)}</kbd>` }
  return L.keys.map((r) => `<div class="school-row"><span class="school-kb">${join(r.do, kb)}</span><span class="school-pad">${join(r.do, pd)}</span><b>${esc(r.label)}</b></div>`).join('')
}

export type CardState = { index: number; of: number; title: string; say: string; keys: string; hint?: string; done?: string; foot?: string }

/** Karl's card in the HUD: the lesson (n of N), his line, the keys, the hint once it shows, his line when it is done. */
export class SchoolCard {
  private el: HTMLElement
  private last: CardState | null = null
  private lastKey = ''
  constructor(root: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'school-card'
    root.appendChild(this.el)
  }
  show(o: CardState | null) {
    if (!o) { this.el.classList.remove('on', 'done'); this.last = null; this.lastKey = ''; return }
    const key = JSON.stringify(o)
    if (key === this.lastKey) return
    const fresh = !this.last || this.last.index !== o.index || !!this.last.done !== !!o.done
    this.last = o; this.lastKey = key
    const dots = Array.from({ length: o.of }, (_, i) => `<i class="${i < o.index || (i === o.index && o.done) ? 'did' : i === o.index ? 'now' : ''}"></i>`).join('')
    this.el.innerHTML = `<img class="school-karl" src="assets/ui/portrait/karl.jpg" alt="">
      <div class="school-bubble">
        <small>SKATE SCHOOL ${o.index + 1} OF ${o.of}</small>
        <b class="school-title">${esc(o.title)}</b>
        ${o.done ? '<span class="school-nailed">NAILED IT</span>' : ''}
        <p class="school-say">${esc(o.done ?? o.say)}</p>
        ${o.done ? '' : `<div class="school-keys">${o.keys}</div>`}
        ${o.hint && !o.done ? `<p class="school-hint"><b>Karl's tip</b> ${esc(o.hint)}</p>` : ''}
        <div class="school-foot"><span class="school-dots">${dots}</span>${o.foot && !o.done ? `<span class="school-help">${o.foot}</span>` : ''}</div>
      </div>`
    this.el.classList.toggle('done', !!o.done)
    // A new lesson (or the done line) slaps in again; a hint appearing just updates it.
    if (fresh) { this.el.classList.remove('on'); void this.el.offsetWidth }
    this.el.classList.add('on')
  }
}

/**
 * A card over the game that asks one thing (the first launch: Skate School?) or points on (graduation):
 * a title tag, a line, a sticker, and buttons. Arrows (or the pad, through the menu keys) pick; Space,
 * K or Enter chooses; Esc takes the last button.
 */
export class SchoolAsk {
  private el: HTMLElement
  private opts: { label: string; onPick: () => void }[] = []
  private sel = 0
  constructor(root: HTMLElement) {
    this.el = document.createElement('div')
    this.el.className = 'school-ask'
    root.appendChild(this.el)
    window.addEventListener('keydown', (e) => this.key(e), true)
  }
  get isOpen() { return this.el.classList.contains('on') }
  /** line may hold <b> (data, not player text). */
  show(o: { tag: string; title: string; line: string; art: string; earned?: string; options: { label: string; onPick: () => void }[] }) {
    this.opts = o.options
    this.sel = 0
    this.el.innerHTML = `<div class="school-ask-card">
      <div class="res-title">${esc(o.tag)}</div>
      <b class="school-ask-title">${esc(o.title)}</b>
      <p>${o.line}</p>
      ${o.earned ? `<div class="res-best">${esc(o.earned)}</div>` : ''}
      <div class="school-ask-opts"></div>

    </div>`
    const box = this.el.querySelector('.school-ask-opts')!
    o.options.forEach((opt, i) => {
      const b = document.createElement('button')
      b.className = 'school-ask-opt'
      b.textContent = opt.label
      b.onmouseenter = () => { this.sel = i; this.draw() }
      b.onclick = () => this.pick(i)
      box.appendChild(b)
    })
    this.draw()
    this.el.classList.add('on')
  }
  hide() { this.el.classList.remove('on') }
  private draw() { this.el.querySelectorAll('.school-ask-opt').forEach((b, i) => b.classList.toggle('sel', i === this.sel)) }
  private pick(i: number) { const o = this.opts[i]; this.hide(); o?.onPick() }
  private key(e: KeyboardEvent) {
    if (!this.isOpen) return
    const c = e.code, n = this.opts.length
    const move = c === 'ArrowDown' || c === 'ArrowRight' || c === 'KeyS' || c === 'KeyD' ? 1 : c === 'ArrowUp' || c === 'ArrowLeft' || c === 'KeyW' || c === 'KeyA' ? -1 : 0
    if (move) { this.sel = (this.sel + move + n) % n; this.draw() }
    else if (c === 'Space' || c === 'KeyK' || c === 'Enter') this.pick(this.sel)
    else if (c === 'Escape') this.pick(n - 1)
    else return
    e.preventDefault(); e.stopImmediatePropagation()
  }
}
