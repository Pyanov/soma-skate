import * as THREE from 'three'
import type { CamPose } from './camera.ts'
import { raycast, type Park } from '../sim/park/park.ts'
import { player2, session, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import type { Thing } from '../sim/thing.ts'
import { v3 } from '../sim/math.ts'

// The two-player games in the client (the games are the sim's: game/twoplayer.ts; numbers and words in
// data/split.json twoPlayer): the 2 Players lobby (player 2 joins from its keys or the second pad,
// each picks a skater, player 1 picks the game), each half's game panel (the clock, both scores,
// HORSE's letters, Graffiti's tag counts), Graffiti's tags painted on the obstacles in each owner's
// colour, and the results card with the winner.

export type TwoPlayerData = {
  colors: [string, string]
  modes: { id: string; name: string; line: string }[]
  join: string; win: string; draw: string
  lines: Record<string, string>
  tint: { lift: number; radius: number; halo: number; gapOpacity: number }
}
export const TWO_PLAYER_DEFAULTS: TwoPlayerData = {
  colors: ['#ff4f00', '#6fd6ff'],
  modes: [{ id: 'trickattack2p', name: 'Trick Attack', line: '' }, { id: 'horse2p', name: 'HORSE', line: '' }, { id: 'graffiti2p', name: 'Graffiti', line: '' }, { id: 'free', name: 'Free Skate', line: '' }],
  join: 'Player 2: press Num 5', win: 'PLAYER {n} WINS', draw: 'DRAW', lines: {}, tint: { lift: 0.03, radius: 0.06, halo: 0.17, gapOpacity: 0.32 },
}

/** Whose event: player 2's carry player: 2 (only while two play); everything else is player 1's or the world's. */
export const playerOf = (e: SimEvent): 1 | 2 => ((e as { player?: number }).player === 2 ? 2 : 1)
/** The two-player games' own end events. */
export const isOver2p = (e: SimEvent) => e.t === 'trickAttackOver' || e.t === 'horseOver' || (e.t === 'graffitiOver' && e.counts.length === 2)   // solo Graffiti ends with one count
const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!)
const fmt = (n: number) => Math.round(n).toLocaleString('en-US')

/**
 * One half's game panel (the HUD's top right, as the one-player games have): the clock and both
 * players' scores (Trick Attack), letters (HORSE) or tags (Graffiti); me: whose half.
 */
export function twoPlayerPanel(sim: Sim, me: 1 | 2): { timer: string; hurry: boolean; html: string } | null {
  const s = session(sim), p2 = player2(sim)
  if (!p2) return null
  const hz = sim.data.physics.tickHz, over = s.mode === 'ending' || s.mode === 'over'
  const clock = (ticks: number) => { const secs = Math.max(0, Math.ceil(ticks / hz)); return `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` }
  const who = (n: 1 | 2) => (n === me ? 'You' : `P${n}`)
  const rows = (vals: [string, string], lead: 0 | 1 | 2) => [1, 2].map((n) => `<div class="vs-row p${n}${lead === n ? ' lead' : ''}"><i>${who(n as 1 | 2)}</i><b>${vals[n - 1]}</b></div>`).join('')
  const lead = (a: number, b: number): 0 | 1 | 2 => (a > b ? 1 : b > a ? 2 : 0)
  if (s.game === 'trickattack2p') {
    const sc: [number, number] = [skater(sim).score, p2.sk.score]
    return { timer: over ? "TIME'S UP" : clock(s.timeLeft), hurry: !over && s.timeLeft / hz <= 10, html: `<div class="mode-title">TRICK ATTACK</div><div class="mode-card vs">${rows([fmt(sc[0]), fmt(sc[1])], lead(sc[0], sc[1]))}</div>` }
  }
  if (s.game === 'graffiti2p') {
    const n: [number, number] = [s.owned ?? 0, p2.s.owned ?? 0]
    return { timer: over ? "TIME'S UP" : clock(s.timeLeft), hurry: !over && s.timeLeft / hz <= 10, html: `<div class="mode-title">GRAFFITI · TAGS</div><div class="mode-card vs">${rows([String(n[0]), String(n[1])], lead(n[0], n[1]))}</div>` }
  }
  if (s.game === 'horse2p') {
    const word = s.horseWord ?? 'HORSE', got = [s.horseLetters ?? '', p2.s.horseLetters ?? '']
    const row = (n: 1 | 2) => `<div class="sk-row p${n}"><i>${who(n)}</i>${[...word].map((l, i) => `<b class="${i < got[n - 1].length ? 'got' : ''}">${l}</b>`).join('')}</div>`
    const turn = s.horseTurn ?? 1, set = s.horseRole !== 'match', name = s.horseTrickName ?? ''
    const what = turn === me ? (set ? 'Your set: land a trick at the mark' : `Match it: ${name}`) : (set ? `P${turn} is setting…` : `P${turn} tries your ${name}`)
    const paused = (s.horsePause ?? 0) > 0
    return { timer: s.mode === 'over' ? 'GAME' : paused ? 'READY' : clock(s.timeLeft), hurry: turn === me && !paused && s.mode === 'horse2p' && s.timeLeft / hz <= 4, html: `<div class="mode-title">${esc(word)}</div><div class="mode-card sk">${row(1)}${row(2)}<b>${esc(what)}</b></div>` }
  }
  return null
}

/** A mode event as a pop in a half (whose half: the player it is about). */
export function twoPlayerPops(e: SimEvent): { player: 1 | 2 | 0; title: string; sub: string; kind: string }[] {
  const r = e as unknown as Record<string, unknown>
  switch (e.t) {
    case 'horseSet': return [{ player: 0, title: 'SET', sub: String(r.name), kind: 'letter' }]
    case 'horseMatch': return r.ok ? [{ player: r.by as 1 | 2, title: 'MATCHED', sub: String(r.name), kind: 'goal' }] : []
    case 'horseLetter': return [{ player: r.who as 1 | 2, title: `LETTER ${String(r.letters).slice(-1)}`, sub: String(r.letters).split('').join(' '), kind: 'letter' }]
    case 'tagged': return [{ player: r.player as 1 | 2, title: !r.from ? 'TAGGED' : r.from === r.player ? 'RETAGGED' : 'STOLEN', sub: r.from === r.player ? fmt(Number(r.points)) : `+1 · ${fmt(Number(r.points))}`, kind: 'goal' }]
    default: return []
  }
}

/**
 * Graffiti's tags in the world: each tagged grind line drawn over in its owner's colour, each tagged
 * gap's takeoff and landing areas tinted. Rebuilt only where an owner changes.
 */
export class TagPaint {
  readonly group = new THREE.Group()
  private shown = new Map<string, { player: 1 | 2; obj: THREE.Object3D }>()
  private mats: THREE.Material[][]
  private park: Park
  private gaps: Map<string, { from?: number[]; to?: number[] }>
  private d: TwoPlayerData
  constructor(park: Park, gaps: { id: string; from?: number[]; to?: number[] }[], d: TwoPlayerData) {
    this.park = park; this.d = d
    this.gaps = new Map(gaps.map((g) => [g.id, g]))
    this.mats = d.colors.map((c) => [
      new THREE.MeshBasicMaterial({ color: c, toneMapped: false }),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: d.tint.gapOpacity, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    ])
    this.group.name = 'graffiti-tags'
  }
  /** The tags now (player 1's session's tags; undefined: none). */
  update(tags: Record<string, { player: 1 | 2 }> | undefined) {
    const want = tags ?? {}
    for (const [id, s] of this.shown) if (want[id]?.player !== s.player) { this.group.remove(s.obj); dispose(s.obj); this.shown.delete(id) }
    for (const [id, t] of Object.entries(want)) {
      if (this.shown.has(id)) continue
      const obj = this.build(id, t.player)
      if (obj) { this.group.add(obj); this.shown.set(id, { player: t.player, obj }) }
    }
  }
  get count() { return this.shown.size }
  /** New colours for the players (Settings > Colours): the paint already down changes with them. */
  setColors(c: [string, string]) { this.mats.forEach((pair, i) => { for (const m of pair) (m as THREE.MeshBasicMaterial).color.set(c[i]) }) }
  private build(id: string, player: 1 | 2): THREE.Object3D | null {
    const [kind, key] = [id.slice(0, id.indexOf(':')), id.slice(id.indexOf(':') + 1)]
    const [solid, glass] = this.mats[player - 1]
    if (kind === 'line') {
      const line = this.park.grind[Number(key)]
      if (!line || line.points.length < 2) return null
      const pts = line.points.map((p) => new THREE.Vector3(p.x, p.y, p.z + this.d.tint.lift))
      const curve = new THREE.CurvePath<THREE.Vector3>()
      for (let i = 1; i < pts.length; i++) curve.add(new THREE.LineCurve3(pts[i - 1], pts[i]))
      // A bright core and a soft halo round it, so a tag reads from across the park.
      const segs = Math.max(2, (pts.length - 1) * 4), grp = new THREE.Group()
      const core = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, this.d.tint.radius, 6, false), solid)
      const halo = new THREE.Mesh(new THREE.TubeGeometry(curve, segs, this.d.tint.halo, 8, false), glass)
      core.renderOrder = halo.renderOrder = 2
      grp.add(core, halo)
      return grp
    }
    if (kind === 'gap') {
      const g = this.gaps.get(key)
      if (!g) return null
      const grp = new THREE.Group()
      for (const b of [g.from, g.to]) {
        if (!b || b.length < 4) continue
        const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2
        const hit = raycast(this.park, v3(cx, cy, 60), v3(0, 0, -1), 120)
        const q = new THREE.Mesh(new THREE.PlaneGeometry(Math.abs(b[2] - b[0]), Math.abs(b[3] - b[1])), glass)
        q.position.set(cx, cy, (hit ? hit.point.z : 0) + this.d.tint.lift)
        q.renderOrder = 2
        grp.add(q)
      }
      return grp
    }
    return null
  }
}
function dispose(o: THREE.Object3D) { o.traverse((x) => { if (x instanceof THREE.Mesh) x.geometry.dispose() }) }

/** The lobby's camera: in front of the two skaters (or player 1 alone), framing them side by side. */
export function lobbyCam(p1: Thing, p2: Thing | null): CamPose {
  const m = p2 ? { x: (p1.pos.x + p2.pos.x) / 2, y: (p1.pos.y + p2.pos.y) / 2, z: (p1.pos.z + p2.pos.z) / 2 } : p1.pos
  const f = p1.fwd, fl = Math.hypot(f.x, f.y) || 1, fx = f.x / fl, fy = f.y / fl
  const dist = p2 ? 3.9 : 3.0
  return { pos: { x: m.x + fx * dist, y: m.y + fy * dist, z: m.z + 1.15 }, look: { x: m.x, y: m.y, z: m.z + 0.55 }, fov: 44 }
}

type Pick = { id: string; name: string }
type KeyText = { up: string; down: string; left: string; right: string; ollie: string; grab: string }
/**
 * The 2 Players lobby: player 2 joins (its ollie: Num 5 or ✕ on the second pad), each player turns
 * through the skaters (left and right), player 1 picks the game (up and down) and starts it (ollie or
 * Enter); grab or Esc goes back. Driven by both players' buttons each frame (poll).
 */
export class Lobby {
  private el: HTMLElement
  private d: TwoPlayerData
  private sel = 0
  private last: [number, number] = [0, 0]
  joined = false
  picks: [number, number] = [0, 0]
  private p2pref: string | null = null
  cast: Pick[] = []
  onJoin: () => void = () => {}
  onLeave: () => void = () => {}
  onPick: (player: 1 | 2, id: string) => void = () => {}
  onStart: (mode: string) => void = () => {}
  onBack: () => void = () => {}
  /** keys: each player's key names for the actions the lobby uses (they follow rebinds). */
  constructor(d: TwoPlayerData, keys: () => [KeyText, KeyText]) {
    this.d = d
    this.el = document.createElement('div')
    this.el.className = 'lobby'
    document.body.appendChild(this.el)
    this.keys = keys
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return
      if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.onBack() }
      else if (e.code === 'Enter') { e.preventDefault(); e.stopImmediatePropagation(); this.start() }
    }, true)
  }
  private keys: () => [KeyText, KeyText]
  get isOpen() { return this.el.classList.contains('on') }
  get mode() { return this.d.modes[this.sel].id }
  /** p2: player 2's skater when it is in; p2pref: the one it rode last time (picked when it joins). */
  open(cast: Pick[], p1: string, p2: string | null, p2pref: string | null = null) {
    this.cast = cast
    this.p2pref = p2pref
    this.picks = [Math.max(0, cast.findIndex((c) => c.id === p1)), Math.max(0, cast.findIndex((c) => c.id === (p2 ?? p1)))]
    this.joined = p2 !== null
    this.last = [~0, ~0]   // buttons held when it opens do nothing until let go
    this.el.classList.add('on')
    document.body.classList.add('in-lobby')
    this.draw()
  }
  close() { this.el.classList.remove('on'); document.body.classList.remove('in-lobby') }
  /** Both players' buttons this frame (Btn bits). */
  poll(b1: number, b2: number, bits: { up: number; down: number; left: number; right: number; ollie: number; grab: number }) {
    if (!this.isOpen) return
    const e1 = b1 & ~this.last[0], e2 = b2 & ~this.last[1]
    this.last = [b1, b2]
    const n = this.d.modes.length
    if (e1 & bits.up) { this.sel = (this.sel + n - 1) % n; this.draw() }
    if (e1 & bits.down) { this.sel = (this.sel + 1) % n; this.draw() }
    if (e1 & (bits.left | bits.right)) this.turn(1, e1 & bits.left ? -1 : 1)
    if (e1 & bits.ollie) this.start()
    if (e1 & bits.grab) this.onBack()
    if (!this.joined && e2 & bits.ollie) {
      // Player 2 joins on the skater it rode last time, else the one after player 1's.
      const k = this.cast.length, last = this.cast.findIndex((c) => c.id === this.p2pref)
      this.picks[1] = last >= 0 ? last : (this.picks[0] + 1) % Math.max(1, k)
      this.joined = true; this.onJoin()
      if (k) this.onPick(2, this.cast[this.picks[1]].id)
      this.draw(); return
    }
    if (this.joined) {
      if (e2 & (bits.left | bits.right)) this.turn(2, e2 & bits.left ? -1 : 1)
      if (e2 & bits.grab) { this.joined = false; this.onLeave(); this.draw() }
    }
  }
  private turn(p: 1 | 2, by: number) {
    const k = this.cast.length
    if (!k) return
    this.picks[p - 1] = (this.picks[p - 1] + by + k) % k
    this.onPick(p, this.cast[this.picks[p - 1]].id)
    this.draw()
  }
  private start() {
    if (!this.joined) { this.flash(); return }
    this.onStart(this.mode)
  }
  private flash() { const w = this.el.querySelector('.lobby-p.p2'); w?.classList.remove('nudge'); void (w as HTMLElement | null)?.offsetWidth; w?.classList.add('nudge') }
  private draw() {
    const [K, K2] = this.keys(), c = this.d.colors
    const card = (p: 1 | 2) => {
      const on = p === 1 || this.joined
      const name = on ? this.cast[this.picks[p - 1]]?.name ?? '' : ''
      return `<div class="lobby-p p${p}${on ? '' : ' waiting'}" style="--pc:var(--p${p})"><small>PLAYER ${p}</small>${on ? `<b>${esc(name)}</b><i>${p === 1 ? `<kbd>${K.left}</kbd><kbd>${K.right}</kbd> skater` : `<kbd>${K2.left}</kbd><kbd>${K2.right}</kbd> skater · <kbd>${K2.grab}</kbd> leave`}</i>` : `<b class="join">${esc(this.d.join).replace('{ollie}', `<kbd>${K2.ollie}</kbd>`)}</b>`}</div>`
    }
    this.el.innerHTML = `<div class="lobby-left">
        <div class="res-title">2 PLAYERS</div>
        <div class="lobby-modes">${this.d.modes.map((m, i) => `<div class="lobby-mode${i === this.sel ? ' sel' : ''}" data-i="${i}"><b>${esc(m.name)}</b><span>${esc(m.line)}</span></div>`).join('')}</div>
        <div class="lobby-help"><kbd>${K.up} ${K.down}</kbd>game&emsp;<kbd>${K.ollie}</kbd>start&emsp;<kbd>Esc</kbd>back</div>
      </div>
      <div class="lobby-players">${card(1)}${card(2)}</div>`
    this.el.querySelectorAll<HTMLElement>('.lobby-mode').forEach((row) => {
      row.onclick = () => { const i = Number(row.dataset.i); if (i === this.sel) this.start(); else { this.sel = i; this.draw() } }
    })
  }
}

/**
 * The two-player results card: the winner in their colour, both players' scores, letters or tags,
 * Enter again, Esc to the menu.
 */
export class Results2p {
  private el: HTMLElement
  private d: TwoPlayerData
  onAgain: () => void = () => {}
  onMenu: () => void = () => {}
  constructor(d: TwoPlayerData) {
    this.d = d
    this.el = document.createElement('div')
    this.el.className = 'results2p'
    document.body.appendChild(this.el)
    this.el.addEventListener('click', () => { if (this.isOpen) { this.close(); this.onAgain() } })   // a tap plays again (touch screens)
    window.addEventListener('keydown', (e) => {
      if (!this.isOpen) return
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'KeyK') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); this.onAgain() }
      else if (e.code === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); this.close(); this.onMenu() }
    }, true)
  }
  get isOpen() { return this.el.classList.contains('on') }
  close() { this.el.classList.remove('on') }
  show(e: SimEvent, names: [string, string], word = 'HORSE') {
    const r = e as unknown as Record<string, unknown>, winner = Number(r.winner ?? 0) as 0 | 1 | 2
    const mode = e.t === 'trickAttackOver' ? 'trickattack2p' : e.t === 'horseOver' ? 'horse2p' : 'graffiti2p'
    const title = this.d.modes.find((m) => m.id === mode)?.name ?? mode
    const vals: [string, string] = e.t === 'trickAttackOver' ? (r.scores as number[]).map(fmt) as [string, string]
      : e.t === 'horseOver' ? (r.letters as string[]).map((l) => [...word].map((c, i) => (i < l.length ? c : '·')).join(' ')) as [string, string]
        : (r.counts as number[]).map((n) => `${n} tag${n === 1 ? '' : 's'}`) as [string, string]
    const head = winner ? this.d.win.replace('{n}', String(winner)) : this.d.draw
    const line = (this.d.lines[mode] ?? '').replace('{loser}', String(winner === 1 ? 2 : 1)).replace('{word}', word)
    const c = this.d.colors
    this.el.innerHTML = `<div class="res-card r2p">
      <div class="res-title">${esc(title.toUpperCase())}</div>
      <div class="r2p-win" style="color:${winner ? 'var(--accent)' : 'var(--paper)'}">${esc(head)}</div>
      <div class="res-line">${esc(line)}</div>
      ${[1, 2].map((n) => `<div class="r2p-row${winner === n ? ' won' : ''}" style="--pc:var(--p${n})"><i>P${n}</i><span>${esc(names[n - 1])}</span><b>${esc(vals[n - 1])}</b></div>`).join('')}
      <div class="res-again"><kbd>Enter</kbd> again <kbd>Esc</kbd> menu</div>
    </div>`
    this.el.classList.add('on')
  }
}
