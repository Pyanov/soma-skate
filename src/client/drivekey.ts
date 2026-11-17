import { canGetIn, canGetOut, drivenBy, typeOf } from '../sim/game/vehicles.ts'
import { Btn } from '../sim/input.ts'
import { player2, skater, type Sim } from '../sim/sim.ts'

// The interact action (F, the pad's triangle; data/controls.json interact) and the vehicles
// (docs/mechanics/driving.md). In a vehicle it gets out; otherwise the story's talk prompt goes first
// (story.ts) and, with none up, by a free vehicle, it gets in: the action presses the sim's use button
// for one tick and the sim gets in or out (game/vehicles.ts), so replays carry it. The prompt, "F Get
// in" (and "F Get out" once slow enough), sits where the talk prompt would, in its style; on a touch
// screen a button does it (the talk button's place, the talk button's look). Player 2 (split screen)
// has its own interact key (the numpad's Enter) and pad button, and no talking.

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)
const who = (sim: Sim, player: 1 | 2) => (player === 2 ? player2(sim)?.sk ?? null : skater(sim))

export class VehicleKey {
  private el: HTMLElement
  private btn: HTMLButtonElement | null = null
  /**
   * root: the HUD (player 2's, #ui2, for its half of a split screen); press: the touch button was
   * pressed (main: act unless a menu is open); without press, no touch button (player 2 has none).
   */
  constructor(root: HTMLElement, press?: () => void) {
    this.el = document.createElement('div')
    this.el.className = 'story-prompt vehicle-prompt'
    root.appendChild(this.el)
    if (!press) return
    const btn = (this.btn = document.createElement('button'))
    btn.className = 'story-talk vehicle-talk'
    btn.style.bottom = 'calc(30vh + 64px)'   // above the talk button's place: in a vehicle by a character both can show
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); press() })
    document.body.appendChild(btn)
  }

  /** In a vehicle now (the action is getting out, before any talk prompt). */
  driving(sim: Sim, player: 1 | 2 = 1) { const t = who(sim, player); return !!t && !!drivenBy(sim, t) }

  /** Would the interact action get in or out of a vehicle now (no talk prompt up)? */
  can(sim: Sim, player: 1 | 2 = 1) { const t = who(sim, player); return !!t && (!!canGetIn(sim, t) || !!drivenBy(sim, t)) }

  /** The interact action, the talk prompt not up: use for a tick when it would get in or out. */
  act(sim: Sim, keys: { tap(bit: number): void }, player: 1 | 2 = 1) { if (this.can(sim, player)) keys.tap(Btn.use) }

  /**
   * Each frame: the prompt and, on a touch screen, the button; neither while hidden (the talk prompt, a
   * menu, the dialogue). Player 2's (its own VehicleKey on #ui2, in its half): hidden while it is out.
   */
  frame(sim: Sim, hidden: boolean, key: string | undefined, touch = false, player: 1 | 2 = 1) {
    const sk = who(sim, player), into = hidden || !sk ? null : canGetIn(sim, sk), out = hidden || into || !sk ? null : canGetOut(sim, sk)
    this.rideFrame(sim, sk, hidden)
    const c = into ?? out
    this.el.classList.toggle('on', !!c)
    this.btn?.classList.toggle('on', !!c && touch)
    if (!c) return
    const name = (key ?? (player === 2 ? 'NumpadEnter' : 'KeyF')).replace(/^Key/, '').replace(/^Numpad/, 'Num ')
    const html = `${touch ? '' : `<kbd>${esc(name)}</kbd>`}<b>${into ? 'Get in' : 'Get out'}</b><span>${esc(typeOf(sim, c).label)}</span>`
    if (this.el.innerHTML !== html) this.el.innerHTML = html
    const label = into ? 'get in' : 'get out'
    if (this.btn && this.btn.textContent !== label) this.btn.textContent = label
  }

  /**
   * On a rental scooter (a type with a scooter block): the ride's clock, what it costs so far and the
   * battery, in a strip at the top (physics phase 31). The fare: unlock plus perMinute for every minute
   * started, as scooterRideEnd charges it.
   */
  private rideEl: HTMLElement | null = null
  private rideFrame(sim: Sim, sk: ReturnType<typeof who>, hidden: boolean) {
    const c = sk ? drivenBy(sim, sk) : null, S = c ? typeOf(sim, c).scooter : undefined, R = c?.car?.drive?.ride
    if (!this.rideEl) {
      if (!S) return
      const el = (this.rideEl = document.createElement('div'))
      el.className = 'vehicle-ride'
      Object.assign(el.style, { left: '50%', top: '64px', transform: 'translateX(-50%)', padding: '4px 14px 5px', background: 'rgba(17, 16, 20, 0.82)', border: '1.5px solid #8fd23a', color: '#fff6e6', fontSize: '15px', letterSpacing: '0.04em', whiteSpace: 'nowrap', display: 'none' })
      this.el.parentElement?.appendChild(el)
    }
    const el = this.rideEl
    if (!S || !R || hidden) { el.style.display = 'none'; return }
    const hz = sim.data.physics.tickHz, s = R.rideTicks / hz, fare = S.fare.unlock + S.fare.perMinute * Math.max(1, Math.ceil(s / 60))
    const pct = Math.round((100 * R.charge) / (S.battery * hz))
    const html = `<b style="color:#8fd23a">VANTAGE</b> &nbsp;${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')} &nbsp;$${fare.toFixed(2)} &nbsp;<span style="color:${R.low ? '#ff7a59' : 'inherit'}">battery ${pct}%</span>`
    if (el.innerHTML !== html) el.innerHTML = html
    el.style.display = 'block'
  }
}
