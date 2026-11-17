import type * as THREE from 'three'
import { Cam, carBoxes, type CamPose } from './camera.ts'
import type { Hud } from './ui.ts'
import type { ViewRect } from './render.ts'
import type { GameData } from '../sim/data.ts'
import type { Park } from '../sim/park/park.ts'
import type { Sim, SimEvent } from '../sim/sim.ts'
import { Kind, type Thing } from '../sim/thing.ts'
import type { TwoPlayerData } from './twoplayer.ts'

// Split screen for two players (data/split.json): the one canvas drawn twice (Renderer.renderViews),
// top and bottom, or side by side on a wide screen, each half with its own chase camera and its own
// HUD (score, trick string, balance, minimap). Until the sim has a second player, a park NPC stands
// in for player 2 (?split=npc, skate clip --split npc): its camera follows it and its HUD reads its
// Thing (it rides with the same skater physics, so it has a combo, a score and balance meters) and
// its events (npcLand and npcBail, told as the HUD's comboLanded and comboLost).

export type SplitData = {
  /** Side by side when the screen is at least this wide (width / height); top and bottom otherwise. */
  wideAspect: number
  /** The render scale (of the screen's) while split: two views cost more than one. */
  renderScale: number
  /** Ambient occlusion in split screen (real look). */
  ao: boolean
  /** The two-player games' colours, words and lobby (twoplayer.ts). */
  twoPlayer?: TwoPlayerData
}
export const SPLIT_DEFAULTS: SplitData = { wideAspect: 2.2, renderScale: 0.85, ao: false }
export type SplitLayout = 'tb' | 'lr'

/** Top and bottom, or side by side once the screen is wide enough for two wide halves. */
export function splitLayout(w: number, h: number, d: SplitData): SplitLayout { return w / h >= d.wideAspect ? 'lr' : 'tb' }

/** The two halves as viewport rects (CSS px from the bottom left, as WebGL counts): player 1's (top or left) first. */
export function splitRects(w: number, h: number, layout: SplitLayout): [ViewRect, ViewRect] {
  if (layout === 'lr') { const a = Math.floor(w / 2); return [{ x: 0, y: 0, w: a, h }, { x: a, y: 0, w: w - a, h }] }
  const b = Math.floor(h / 2)
  return [{ x: 0, y: h - b, w, h: b }, { x: 0, y: 0, w, h: h - b }]
}

/** The park NPC that stands in for player 2: the one already standing in while it rides, else the first riding one. */
export function pickStandIn(things: readonly Thing[], current: number): number {
  const ok = (t: Thing) => t.kind === Kind.npc && t.alive && !!t.npc && !t.npc.racer && !t.npc.skate && t.npc.watch === undefined
  if (things.some((t) => t.id === current && ok(t))) return current
  let best = -1
  for (const t of things) if (ok(t) && (best < 0 || t.id < best)) best = t.id
  return best
}

/** The stand-in's events as its HUD hears them: a banked combo (comboLanded), a bail (comboLost, with the combo it had). */
export function standInEvents(events: readonly SimEvent[], id: number, comboBefore: string): SimEvent[] {
  const out: SimEvent[] = []
  for (const e of events) {
    if (e.t === 'npcLand' && e.id === id) {
      const c = events.find((x) => x.t === 'npcCombo' && x.id === id) as Extract<SimEvent, { t: 'npcCombo' }> | undefined
      out.push({ t: 'comboLanded', tick: e.tick, name: e.trick, points: e.points, multiplier: c?.multiplier ?? 1, entries: [] } as unknown as SimEvent)
    }
    if (e.t === 'npcBail' && e.id === id) {
      if (comboBefore) out.push({ t: 'comboLost', tick: e.tick, name: comboBefore } as SimEvent)
      out.push({ t: 'bail', tick: e.tick, reason: e.reason } as SimEvent)
    }
  }
  return out
}

/**
 * A thing drawn as a player by a HUD (its own kind, so skater() finds it). own: its own session (the
 * sim's player 2); else (a stand-in) the given one with no game on.
 */
export function asPlayer(t: Thing, session: Thing, data: GameData, park: Park, own = false): Sim {
  // As player 1's, to the HUD (skater() and session() find player 1's: no player field).
  const ss = (own ? { ...session } : { ...session, mode: 'free', game: 'free', letters: '', goalsDone: [], levelGoals: [], burritos: [] }) as unknown as Thing
  const sk = { ...t, kind: Kind.skater, alive: true } as Thing
  delete ss.player; delete sk.player
  return { world: { things: [sk, ss] }, data, park } as unknown as Sim
}

/**
 * Player 2's half: its camera (stepped each tick, interpolated each frame), its HUD (a second Hud in
 * #ui2) and, for the stand-in, which NPC it is. The page's body classes say the layout (CSS puts each
 * HUD in its half).
 */
export class SplitScreen {
  readonly d: SplitData
  readonly hud: Hud
  readonly cam = new Cam()
  standIn = -1
  layout: SplitLayout = 'tb'
  private on = false
  private last: Thing | null = null
  private lastPos: { x: number; y: number; z: number } | null = null
  private comboNames = ''
  private divider: HTMLElement

  /** Who player 2 is: the sim's (real), else an NPC when the dev stand-in is on (npc). */
  real = false
  npc: boolean
  constructor(d: SplitData, ui: Hud, park: Park, npc = false) {
    this.d = d
    this.npc = npc
    this.cam.park = park
    let root = document.getElementById('ui2')
    if (!root) { root = document.createElement('div'); root.id = 'ui2'; document.body.appendChild(root) }
    root.innerHTML = ''
    this.hud = ui.twin(root)
    this.hud.menuOpen = false; this.hud.quiet = true; this.hud.demo = true
    this.hud.showMenu(false)
    this.hud.copyMap(ui)
    tag(document.getElementById('ui')!, 'P1')
    tag(root, 'P2')
    this.divider = document.querySelector('.split-divider') ?? document.body.appendChild(Object.assign(document.createElement('div'), { className: 'split-divider' }))
  }

  get active() { return this.on }
  /** Split on or off (body classes for the HUDs; the layout from the screen's shape). */
  setActive(on: boolean, w = innerWidth, h = innerHeight) {
    this.layout = splitLayout(w, h, this.d)
    const b = document.body.classList
    b.toggle('split', on); b.toggle('split-tb', on && this.layout === 'tb'); b.toggle('split-lr', on && this.layout === 'lr')
    this.divider.style.display = on ? 'block' : 'none'
    this.on = on
  }

  /** Player 2 (or the stand-in) as of the last tick. */
  get thing() { return this.last }
  /** Someone to follow: player 2 is in, or a stand-in rides. */
  get following() { return !!this.last }
  /**
   * One sim tick: keep (or pick) the stand-in, step its camera, and its events as its HUD hears them
   * (told to the HUD now, unless now is null: a clip tells them frame by frame).
   */
  tick(things: readonly Thing[], events: readonly SimEvent[], traffic: GameData['traffic'], now: number | null): SimEvent[] {
    const was = this.standIn
    // The sim's player 2 when it is in; else (dev: ?split=npc) a park NPC standing in.
    const real = things.find((x) => x.player === 2 && x.kind === Kind.skater) ?? null
    this.real = !!real
    this.standIn = real ? real.id : this.npc ? pickStandIn(things, this.standIn) : -1
    const t = real ?? things.find((x) => x.id === this.standIn) ?? null
    if (!t) { this.last = null; this.lastPos = null; return [] }
    // A new stand-in, or this one put back at the start of another line: a cut, not a swing.
    const L = this.lastPos, jump = !L || was !== this.standIn || Math.hypot(t.pos.x - L.x, t.pos.y - L.y, t.pos.z - L.z) > 3
    this.cam.obstacles = carBoxes(things, traffic, t.pos)
    this.cam.step(t, jump)
    const told = real ? [] : standInEvents(events, this.standIn, this.comboNames)   // player 2's own events reach its HUD directly
    if (now !== null) for (const e of told) this.hud.event(e, now)
    this.comboNames = t.combo.map((c) => c.name).join(' + ')
    // A clip keeps every tick's (a copy); the game reads the live Thing.
    this.last = now === null ? structuredClone(t) : t
    this.lastPos = { x: t.pos.x, y: t.pos.y, z: t.pos.z }
    return told
  }

  /** Player 2's camera between the last two ticks. */
  pose(alpha: number): CamPose | null { return this.cam.at(alpha) }

  /** Both halves for Renderer.renderViews, player 1's pose given. */
  views(p1: CamPose, p2: CamPose | null, w: number, h: number) {
    const [a, b] = splitRects(w, h, this.layout)
    return [{ pose: p1, rect: a }, { pose: p2 ?? p1, rect: b }]
  }

  /** Player 2's HUD this frame (heading: its camera's, for the minimap). */
  frameHud(session: Thing, data: GameData, park: Park, now: number, heading: number, t: Thing | null = this.last) {
    if (t) this.hud.frame(asPlayer(t, session, data, park, this.real), now, heading)
  }
}

/** Screen tags (NPC pops, racer names) worked out for one half: the camera at that half's shape, its size. */
export function inHalf<T>(camera: THREE.PerspectiveCamera, rect: ViewRect | null, fn: (w: number, h: number) => T): T {
  if (!rect) return fn(innerWidth, innerHeight)
  const a = camera.aspect
  camera.aspect = rect.w / rect.h; camera.updateProjectionMatrix()
  try { return fn(rect.w, rect.h) } finally { camera.aspect = a; camera.updateProjectionMatrix() }
}

function tag(root: HTMLElement, text: string) {
  const el = root.querySelector('.split-tag') ?? root.appendChild(Object.assign(document.createElement('div'), { className: 'split-tag' }))
  el.textContent = text
}
