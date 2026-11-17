import { Btn, type BtnName } from '../sim/input.ts'

// On-screen controls for phones and tablets (data/touch.json): a virtual stick on the left (it
// appears where the thumb lands), the I, J, K and L diamond on the right (grind, flip, grab, ollie),
// step off, revert and powerslide beside it, and a menu button. Multi-touch: every finger is its own control, so a flip
// with a direction, or ollie held to crouch while steering, work as on the keyboard. The buttons the
// fingers hold are Btn bits (bits), which the keyboard adds to its own each tick. Shown on a touch
// screen (or ?touch, or Settings > Touch controls: always) and hidden while a pad or keyboard is in
// use; a portrait screen gets smaller controls and a line suggesting landscape.

export type TouchData = {
  stick: { radius: number; dead: number; diagonal: number }
  buttons: { id: string; key: string; label: string; at: 'n' | 'w' | 'e' | 's' }[]
  pills: { id: string; label: string }[]
  menu: string; rotate: string; rotateSeconds: number
}

/** An action as the on-screen controls show it, for cards that teach the controls (Skate School): the stick's way, or a button. */
export type TouchGlyph = { kind: 'stick'; arrow: string } | { kind: 'button'; key: string; label: string } | { kind: 'pill'; label: string }
const ARROWS: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→', spinL: '↶', spinR: '↷' }

/** The stick's buttons for a push (dx, dy in CSS px, y down): up/down/left/right past the dead zone; both on a diagonal. */
export function stickBits(dx: number, dy: number, d: TouchData['stick']): number {
  const len = Math.hypot(dx, dy), r = d.radius
  if (len < d.dead * r) return 0
  const ux = dx / len, uy = dy / len
  let b = 0
  if (uy < -d.diagonal) b |= Btn.up
  if (uy > d.diagonal) b |= Btn.down
  if (ux < -d.diagonal) b |= Btn.left
  if (ux > d.diagonal) b |= Btn.right
  return b
}

type Finger = { kind: 'stick'; ox: number; oy: number } | { kind: 'button'; bit: number }

export class TouchPad {
  readonly el: HTMLElement
  private d: TouchData
  private fingers = new Map<number, Finger>()
  private stickBase: HTMLElement
  private knob: HTMLElement
  private stickNow = 0
  /** Settings > Touch controls: auto (a touch screen, until a pad or keyboard is used), on, off. */
  private mode: 'auto' | 'on' | 'off' = 'auto'
  /** auto: a finger touched last (not a key or a pad). */
  private touched: boolean
  private inMenu = true
  /** The buttons held now (Btn bits); onBits hears every change. */
  bits = 0
  onBits: (b: number) => void = () => {}
  onMenu: () => void = () => {}

  constructor(d: TouchData, forced: boolean) {
    this.d = d
    this.touched = forced || (typeof matchMedia === 'function' && matchMedia('(any-pointer: coarse)').matches) || (navigator.maxTouchPoints ?? 0) > 0
    this.el = document.createElement('div')
    this.el.className = 'tpad'
    const btn = (b: TouchData['buttons'][number]) => `<button class="tp-btn tp-${b.at}" data-b="${b.id}"><b>${b.key}</b><small>${b.label}</small></button>`
    this.el.innerHTML = `<div class="tp-zone"><div class="tp-base"><div class="tp-knob"></div></div></div>
      <div class="tp-pad">${d.buttons.map(btn).join('')}</div>
      <div class="tp-pills">${d.pills.map((q) => `<button class="tp-btn tp-pill" data-b="${q.id}"><small>${q.label}</small></button>`).join('')}</div>
      <button class="tp-menu" aria-label="${d.menu}"><i></i><i></i><i></i></button>
      <div class="tp-rotate"><span>${d.rotate}</span><button>OK</button></div>`
    document.body.appendChild(this.el)
    this.stickBase = this.el.querySelector('.tp-base')!
    this.knob = this.el.querySelector('.tp-knob')!
    const zone = this.el.querySelector<HTMLElement>('.tp-zone')!
    zone.addEventListener('pointerdown', (e) => this.stickDown(e))
    for (const b of this.el.querySelectorAll<HTMLElement>('.tp-btn')) b.addEventListener('pointerdown', (e) => this.buttonDown(e, b))
    this.el.addEventListener('pointermove', (e) => this.move(e))
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) this.el.addEventListener(t, (e) => this.up(e as PointerEvent))
    this.el.querySelector<HTMLElement>('.tp-menu')!.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.onMenu() })
    // The landscape suggestion (portrait, while skating; never over a menu): OK sends it away for good;
    // unanswered, it fades a few seconds after it first shows.
    this.el.querySelector<HTMLElement>('.tp-rotate button')!.addEventListener('click', () => { this.el.classList.add('rotate-ok'); try { localStorage.setItem('soma-skate:rotate-ok', '1') } catch { /* private window */ } })
    try { if (localStorage.getItem('soma-skate:rotate-ok')) this.el.classList.add('rotate-ok') } catch { /* private window */ }
    // A key or a pad hides them (auto); a finger brings them back.
    window.addEventListener('keydown', (e) => { if (e.isTrusted) this.otherInput() }, true)
    window.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') { this.touched = true; this.show() } }, true)
    this.show()
  }

  setMode(m: 'auto' | 'on' | 'off') { this.mode = m; this.show() }
  /** The buttons' letters: the player's rebound key where it is a letter or digit (label returns it), else the diamond's own I, J, K, L. */
  setLabels(label: (action: string) => string | null) {
    this.labelOf = label
    for (const b of this.d.buttons) { const el = this.el.querySelector(`.tp-btn[data-b="${b.id}"] b`); if (el) el.textContent = label(b.id) ?? b.key }
  }
  private labelOf: (action: string) => string | null = () => null
  /** How an action shows on these controls (for Skate School's cards on a touch screen). */
  glyph(action: string): TouchGlyph {
    if (ARROWS[action]) return { kind: 'stick', arrow: ARROWS[action] }
    const b = this.d.buttons.find((x) => x.id === action)
    if (b) return { kind: 'button', key: this.labelOf(action) ?? b.key, label: b.label }
    const q = this.d.pills.find((x) => x.id === action)
    return { kind: 'pill', label: q?.label ?? action }
  }
  /** Shown or hidden (cards that teach the controls redraw). */
  onShow: (on: boolean) => void = () => {}
  /** A pad button or a key: in auto, the on-screen controls step aside. */
  otherInput() { if (this.touched) { this.touched = false; this.release(); this.show() } }
  /** Menus and cards open: only the menu button is left (menus are tapped). */
  setMenu(open: boolean) { if (open === this.inMenu) return; this.inMenu = open; if (open) this.release(); this.show() }
  get visible() { return this.el.classList.contains('on') }

  private show() {
    const on = this.mode === 'on' || (this.mode === 'auto' && this.touched)
    const was = this.el.classList.contains('on')
    this.el.classList.toggle('on', on)
    if (was !== on) this.onShow(on)
    this.el.classList.toggle('menu-open', this.inMenu)
    document.body.classList.toggle('touch', on)
    if (on && !this.inMenu && !this.rotateFade) this.rotateFade = window.setTimeout(() => this.el.classList.add('rotate-ok'), this.d.rotateSeconds * 1000)
  }
  private rotateFade = 0

  private stickDown(e: PointerEvent) {
    e.preventDefault()
    if ([...this.fingers.values()].some((f) => f.kind === 'stick')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)   // its moves and lifting come here wherever the finger goes
    this.fingers.set(e.pointerId, { kind: 'stick', ox: e.clientX, oy: e.clientY })
    this.stickBase.style.left = `${e.clientX}px`; this.stickBase.style.top = `${e.clientY}px`
    this.stickBase.classList.add('on')
    this.knob.style.transform = 'translate(-50%, -50%)'
  }
  private buttonDown(e: PointerEvent, b: HTMLElement) {
    e.preventDefault(); e.stopPropagation()
    b.setPointerCapture?.(e.pointerId)
    this.fingers.set(e.pointerId, { kind: 'button', bit: this.bitOf(b) })
    this.refresh()
  }
  private move(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId)
    if (!f) return
    e.preventDefault()
    if (f.kind === 'stick') {
      const r = this.d.stick.radius, dx = e.clientX - f.ox, dy = e.clientY - f.oy, len = Math.hypot(dx, dy), k = len > r ? r / len : 1
      this.knob.style.transform = `translate(calc(-50% + ${dx * k}px), calc(-50% + ${dy * k}px))`
      this.stickNow = stickBits(dx, dy, this.d.stick)
    } else {
      // A thumb sliding from one button onto the next presses that one instead.
      const under = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.tpad .tp-btn')
      if (under) f.bit = this.bitOf(under)
    }
    this.refresh()
  }
  private up(e: PointerEvent) {
    const f = this.fingers.get(e.pointerId)
    if (!f) return
    this.fingers.delete(e.pointerId)
    if (f.kind === 'stick') { this.stickNow = 0; this.stickBase.classList.remove('on') }
    this.refresh()
  }
  private release() { this.fingers.clear(); this.stickNow = 0; this.stickBase.classList.remove('on'); this.refresh() }
  private bitOf(b: HTMLElement) { return Btn[(b.dataset.b ?? '') as BtnName] ?? 0 }
  private refresh() {
    let b = this.stickNow
    for (const f of this.fingers.values()) if (f.kind === 'button') b |= f.bit
    const held = new Set([...this.fingers.values()].flatMap((f) => (f.kind === 'button' ? [f.bit] : [])))
    for (const el of this.el.querySelectorAll<HTMLElement>('.tp-btn')) el.classList.toggle('held', held.has(this.bitOf(el)))
    if (b !== this.bits) { this.bits = b; this.onBits(b) }
  }
}
