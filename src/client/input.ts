import type { Controls } from '../data/schema.ts'
import { Btn, type BtnName, type InputFrame } from '../sim/input.ts'

// Keyboard and gamepad to InputFrame, read once per tick. Dev keys go to a callback.
// The pad is polled in frame() (the Gamepad API has no events for buttons).

/** A pad button as a key press, sent the way a real key travels (capture down from window, then
 *  bubbling back up). Sent to window itself, every window listener ran in the order it was added,
 *  so the menu opened the character picker and the picker's own listener then closed it on the
 *  same cross press. */
function padKey(code: string) {
  ;(document.activeElement ?? document.body).dispatchEvent(new KeyboardEvent('keydown', { code, key: code === 'Space' ? ' ' : code, bubbles: true, cancelable: true }))
}

/** How long a latched press waits for a tick (ms): a frame or two on a loaded machine, not a pause. */
const LATCH_MS = 200

export class Keyboard {
  private held = new Set<string>()
  private map = new Map<string, number>()
  private devCodes: Map<string, string>
  private pad: Controls['gamepad']
  private padBits: [number, number][] = []   // [button index, Btn bit]
  private startWas = false
  private radioWas = false
  private replayWas = false
  /** While a menu (or the character picker) is open, the pad drives it: d-pad/stick, cross selects, circle backs out. */
  menuOpen: () => boolean = () => false
  /** The character picker is open: the pad's triangle opens its board shop (D). */
  pickerOpen: () => boolean = () => false
  /** Create-a-Skater is open: the pad's triangle randomizes (R). */
  casOpen: () => boolean = () => false
  private menuWas: Record<string, boolean> = {}
  onDev: (action: string) => void = () => {}
  /** Actions that are not skater buttons (data/controls.json keyboard interact: the talk key), pressed. */
  onAction: (action: string) => void = () => {}
  /** The pad's talk button (gamepad.interact) acts only while this says so (a talk prompt is up); it is the grind button otherwise. */
  canInteract: () => boolean = () => false
  private interactWas = false
  enabled = true
  private bindings: Record<string, string[]> = {}
  /** Waiting for a key to bind (Controls page): the next keydown goes here instead of play. */
  capture: ((code: string) => void) | null = null

  /** Current keys for a gameplay action (data/controls.json keyboard, plus the player's rebinds). */
  keysFor(action: string) { return this.bindings[action] ?? [] }
  /** Bind the first key of an action (the other keys stay); an action that had this key loses it. */
  rebind(action: string, code: string) {
    for (const [a, codes] of Object.entries(this.bindings)) if (a !== action) this.bindings[a] = codes.filter((c) => c !== code)
    const cur = this.bindings[action] ?? []
    this.bindings[action] = [code, ...cur.slice(1).filter((c) => c !== code)]
    this.devCodes?.delete(code)   // a gameplay binding takes the key over from a dev key
    this.rebuild()
  }
  /** The player's rebinds, to save; restore with applyRebinds. */
  get rebinds() { return Object.fromEntries(Object.entries(this.bindings).map(([a, c]) => [a, c[0]])) }
  applyRebinds(r: Record<string, string>) { for (const [a, code] of Object.entries(r)) if (this.bindings[a]) this.rebind(a, code) }
  private rebuild() {
    this.map.clear()
    for (const [name, codes] of Object.entries(this.bindings)) {
      const bit = Btn[name as BtnName]
      if (bit !== undefined) for (const c of codes) if (!this.blocked.has(c)) this.map.set(c, (this.map.get(c) ?? 0) | bit)
    }
  }
  /** Keys another player holds (two players on one keyboard): this one leaves them alone. */
  private blocked = new Set<string>()
  /** Buttons held elsewhere (the on-screen touch controls), added each frame. */
  extra = 0
  private yielding: Keyboard | null = null
  /** Two players on one keyboard: give way to the other's keys (player 1's arrows go to player 2); null: all keys again. */
  giveWay(other: Keyboard | null) {
    if (other === this.yielding && !other) return
    this.yielding = other
    this.blocked = new Set(other ? Object.values(other.bindings).flat() : [])
    this.rebuild()
  }
  /** Which player (1 or 2); player 2 has its own keys (data/controls.json player2) and the second pad, no dev keys. */
  readonly player: 1 | 2
  private padIndex = 0

  constructor(controls: Controls, player: 1 | 2 = 1) {
    this.player = player
    this.padIndex = player === 2 ? controls.player2?.pad ?? 1 : 0
    this.pad = controls.gamepad
    for (const [name, idxs] of Object.entries(controls.gamepad.buttons)) {
      const bit = Btn[name as BtnName]
      if (bit !== undefined) for (const i of idxs) this.padBits.push([i, bit])
    }
    const kb = player === 2 ? controls.player2?.keyboard ?? {} : controls.keyboard
    this.bindings = Object.fromEntries(Object.entries(kb).map(([a, c]) => [a, [...c]]))
    this.rebuild()
    this.devCodes = new Map()
    const { layers, ...rest } = controls.dev
    if (player === 1) {
      for (const [action, code] of Object.entries(rest)) this.devCodes.set(code, action)
      for (const [layer, code] of Object.entries(layers)) this.devCodes.set(code, `layer:${layer}`)
    }
    // Capture phase: while binding a key, it reaches nothing else (menus, dev keys, play).
    window.addEventListener('keydown', (e) => {
      if (!this.capture) return
      e.preventDefault(); e.stopImmediatePropagation()
      const f = this.capture; this.capture = null; f(e.code === 'Escape' ? '' : e.code)
    }, true)
    window.addEventListener('keydown', (e) => this.down(e))
    window.addEventListener('keyup', (e) => { this.held.delete(e.code) })
    window.addEventListener('blur', () => { this.held.clear(); this.latched = 0 })
  }

  private down(e: KeyboardEvent) {
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    const dev = this.devCodes.get(e.code)
    if (dev && (!typing || dev === 'clip' || dev === 'tuning') && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      if (!e.repeat) this.onDev(dev)
      return
    }
    if (typing || !this.enabled) return
    // An action that is not a skater button (the talk key): a press, not a hold.
    const act = Object.entries(this.bindings).find(([a, codes]) => Btn[a as BtnName] === undefined && codes.includes(e.code))?.[0]
    if (act && !this.blocked.has(e.code)) { e.preventDefault(); if (!e.repeat) this.onAction(act); return }
    if (this.map.has(e.code)) { e.preventDefault(); this.held.add(e.code); if (!e.repeat && !this.menuOpen()) { this.latched |= this.map.get(e.code)!; this.latchedAt = performance.now() } }
  }

  /**
   * Buttons pressed since the last frame(): a press let go before the next tick (a short tap on a loaded
   * machine, where a frame can take longer than the press) still reaches the sim for one tick. Not in a
   * menu (Space picks an item and is also ollie), and older than LATCH_MS it is dropped (no tick ran:
   * paused), so a press made while play stood still never pops an ollie when it resumes.
   */
  private latched = 0
  private latchedAt = 0

  /** Shake the pad (data/controls.json gamepad.rumble), scaled 0..1. Off in Settings → Rumble. */
  rumbleOn = true
  rumble(kind: 'land' | 'bail' | 'grind' | 'carHit', scale = 1) {
    const r = this.pad.rumble?.[kind], pad = this.gamepad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, p: object) => Promise<unknown> } }) | null
    if (!r || !this.rumbleOn || scale <= 0 || !pad?.vibrationActuator?.playEffect) return
    const k = Math.min(1, scale)
    pad.vibrationActuator.playEffect('dual-rumble', { duration: r.ms, strongMagnitude: r.strong * k, weakMagnitude: r.weak * k }).catch(() => {})
  }
  /** How hard a landing shakes: 0 below rumbleLandImpact[0], 1 at [1]. */
  landRumble(impact: number) { const [a, b] = this.pad.rumbleLandImpact ?? [1.2, 5]; return Math.max(0, Math.min(1, (impact - a) / (b - a))) }

  /** This player's pad: the first connected one for player 1, the second for player 2. */
  private gamepad() { return typeof navigator.getGamepads === 'function' ? [...navigator.getGamepads()].filter((g) => g?.connected)[this.padIndex] ?? null : null }

  /** Every animation frame, paused or not: options/start acts as Enter (menu: start a run). */
  poll() {
    const pad = this.gamepad()
    const start = pad?.buttons[this.pad.start]?.pressed ?? false
    const startWas = this.startWas
    this.startWas = start
    if (start && !startWas) padKey('Enter')
    const radio = this.pad.radio !== undefined && (pad?.buttons[this.pad.radio]?.pressed ?? false)
    if (radio && !this.radioWas) this.onDev('radio')
    this.radioWas = radio
    if (pad && this.menuOpen()) {
      const dz = this.pad.stickDeadzone, x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0
      const now: Record<string, boolean> = {
        ArrowUp: !!pad.buttons[12]?.pressed || y < -dz, ArrowDown: !!pad.buttons[13]?.pressed || y > dz,
        ArrowLeft: !!pad.buttons[14]?.pressed || x < -dz, ArrowRight: !!pad.buttons[15]?.pressed || x > dz,   // the character picker's outfits
        Space: !!pad.buttons[0]?.pressed, Escape: !!pad.buttons[1]?.pressed,
        ...(this.pickerOpen() ? { KeyD: !!pad.buttons[3]?.pressed, KeyC: !!pad.buttons[2]?.pressed, KeyN: !!pad.buttons[4]?.pressed } : {}),   // triangle: the board shop; square: the colours; L1: Create-a-Skater
        ...(this.casOpen() ? { KeyR: !!pad.buttons[3]?.pressed } : {}),   // Create-a-Skater: triangle randomizes
      }
      for (const [code, on] of Object.entries(now)) {
        const was = this.menuWas[code]
        this.menuWas[code] = on
        if (on && !was) padKey(code)
      }
    } else this.menuWas = {}
    this.pollInteract(pad)
    const replay = this.pad.replay !== undefined && (pad?.buttons[this.pad.replay]?.pressed ?? false)
    if (replay && !this.replayWas) this.onDev('replay')
    this.replayWas = replay
  }

  private taps = 0
  /** A button pressed for one tick, the next frame() (drivekey.ts: the interact action's use by a vehicle). */
  tap(bit: number) { this.taps |= bit }

  /**
   * The pad's talk button (gamepad.interact): only while canInteract says so (a talk prompt is up, or a
   * vehicle to get in or out of: drivekey.ts); it is the grind button, and the emote standing still,
   * otherwise. poll() does it for player 1; player 2 (split screen) has only this, each frame.
   */
  pollInteract(pad = this.gamepad()) {
    const talk = this.pad.interact !== undefined && (pad?.buttons[this.pad.interact]?.pressed ?? false)
    if (talk && !this.interactWas && this.canInteract() && !this.menuOpen()) this.onAction('interact')
    this.interactWas = talk
  }

  frame(): InputFrame {
    const pad = this.gamepad(), taps = this.taps, latched = performance.now() - this.latchedAt < LATCH_MS ? this.latched : 0
    this.taps = 0
    this.latched = 0
    if (!this.enabled) return { b: 0 }
    let b = this.extra | taps | latched
    for (const c of this.held) b |= this.map.get(c) ?? 0
    if (pad) {
      for (const [i, bit] of this.padBits) if (pad.buttons[i]?.pressed) b |= bit
      const dz = this.pad.stickDeadzone, x = pad.axes[0] ?? 0, y = pad.axes[1] ?? 0
      if (x < -dz) b |= Btn.left
      if (x > dz) b |= Btn.right
      if (y < -dz) b |= Btn.up
      if (y > dz) b |= Btn.down
    }
    return { b }
  }
}
