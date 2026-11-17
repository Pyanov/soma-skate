import type { FlipDef, GrabDef, SkateLines, SkateLocal } from '../data.ts'
import { Btn, type InputFrame } from '../input.ts'
import { DEG, PI, v3 } from '../math.ts'
import { raycast, sphereContacts, type Contact } from '../park/park.ts'
import { nextFloat, seedRng } from '../rng.ts'
import { placeAt, spawn, type Sim, type SimEvent, type SkateSide } from '../sim.ts'
import { stepSkater } from '../skater/skater.ts'
import { Kind, State, type ComboEntry, type SkateTry, type Thing, type TrickPilot, type TrickPlan } from '../thing.ts'
import { followLine } from './follow.ts'

// Game of S.K.A.T.E. against a local (docs/mechanics/modes.md; data run.skate). Flat-ground tricks
// at a marked spot in the park: the setter lands a trick there, the other has to land the same one
// there, clean; a miss is a letter; whoever spells the word first loses. The local is an NPC Thing
// that really rides its tries (the same physics, keys from the trick autopilot below); whether it
// means to land one is drawn from its own random stream (world.skateRng), which also feeds its
// physics, so the player's game is the same as without it. It reads the skaters' events; it never
// changes skating physics.

const touching: Contact[] = []
const rand = (sim: Sim) => nextFloat(sim.world.skateRng!)
const pick = <T>(sim: Sim, xs: T[]): T => xs[Math.floor(rand(sim) * xs.length)]
const other = (s: SkateSide): SkateSide => (s === 'player' ? 'local' : 'player')

// ---- Tricks: what a try was, and what a trick is made of ----

/** The banked combo of a try as one S.K.A.T.E. trick: its key and name, or why it is not one. */
export function judgeTrick(sim: Sim, entries: ComboEntry[], manualTicks: number): { ok: boolean; trick: string; name: string; reason: string } {
  const T = sim.data.tricks, S = sim.data.run.skate
  let foot: ComboEntry | null = null, trick: ComboEntry | null = null, manual: ComboEntry | null = null, spin = '', spinName = '', spinDeg = 0
  const got = entries.map((e) => spinKey(e) ?? e.id).join('+') || 'ollie'
  const gotName = entries.map((e) => e.name).join(' ') || 'Ollie'
  const no = (reason: string) => ({ ok: false, trick: got, name: gotName, reason })
  for (const e of entries) {
    const sk = spinKey(e)
    if (sk) { if (spin) return no('two spins'); spin = sk; spinName = e.name; spinDeg = Number(sk.slice(2)); continue }
    if (T.foot.some((f) => f.id === e.id)) { if (foot) return no('two foot tricks'); foot = e; continue }
    if (T.flips.some((f) => f.id === e.id) || T.grabs.some((g) => g.id === e.id)) { if (trick) return no('more than one trick'); trick = e; continue }
    if (T.manuals.some((m) => m.id === e.id)) { if (manual) return no('two manuals'); manual = e; continue }
    return no(`${e.name} is not a flat-ground trick`)
  }
  if (spinDeg > 360) return no('more than a 360')
  if (manual) {
    if (foot || trick || spin) return no('a manual and a trick')
    if (manualTicks < S.manualSeconds * sim.data.physics.tickHz) return no('manual too short')
    return { ok: true, trick: manual.id, name: manual.name, reason: '' }
  }
  return { ok: true, trick: [foot?.id, spin, trick?.id].filter(Boolean).join('+') || 'ollie', name: [foot?.name, spinName, trick?.name].filter(Boolean).join(' ') || 'Ollie', reason: '' }
}

/** A spin entry's key: 'fs180', 'bs360' (the side from its name; out of fakie Fakie FS 180, Half Cab, Full Cab), else null. */
function spinKey(e: ComboEntry): string | null {
  const m = /^spin(\d+)$/.exec(e.id), side = /^(?:Fakie |Nollie |Switch )?(FS|BS) /.exec(e.name)?.[1] ?? (/ Cab$/.test(e.name) ? 'BS' : null)
  return m && side ? `${side.toLowerCase()}${Number(m[1]) * 180}` : null
}

type Parts = { foot: string; spin: number; flip: FlipDef | null; grab: GrabDef | null; manual: string }

/** A trick key's parts, for riding it: foot trick, spin (radians, + = counterclockwise), flip or grab, manual. */
export function trickParts(sim: Sim, key: string): Parts {
  const T = sim.data.tricks
  const p: Parts = { foot: '', spin: 0, flip: null, grab: null, manual: '' }
  for (const k of key.split('+')) {
    const sp = /^(fs|bs)(\d+)$/.exec(k)
    if (k === 'ollie') continue
    if (sp) {
      // Frontside turns the chest first: counterclockwise for a regular rider (tricks.ts addSpin).
      const ccw = (sp[1] === 'fs') === (sim.data.rider.stance === 'regular')
      p.spin = (ccw ? 1 : -1) * (Number(sp[2]) / 180) * PI
    } else if (T.foot.some((f) => f.id === k)) p.foot = k
    else if (T.manuals.some((m) => m.id === k)) p.manual = k
    else if (T.flips.some((f) => f.id === k)) p.flip = T.flips.find((f) => f.id === k)!
    else p.grab = T.grabs.find((g) => g.id === k) ?? null
  }
  return p
}

/** How hard a trick is: the sum of its parts' difficulty (any grab is 'grab'), at most 1. */
export function trickDifficulty(sim: Sim, key: string): number {
  const S = sim.data.run.skate, T = sim.data.tricks
  let d = 0
  for (const k of key.split('+')) if (k !== 'ollie') d += S.difficulty[k] ?? (T.grabs.some((g) => g.id === k) ? S.difficulty.grab ?? 0.3 : 0.5)
  return Math.min(1, d)
}

// ---- A try at the spot: from the skater's own events ----

export const freshTry = (t: Thing): SkateTry => ({ phase: 'ready', ground: t.state === State.ground, manualTicks: 0, ok: false, trick: '', name: '', reason: '', at: -1 })

export const TOO_FAR = 'too far from the mark'

/**
 * Follow a try from a skater's events this tick. It starts with a pop from the ground (or a manual)
 * within spot.near of the mark; a bail, or a landing that is not clean, is a miss; it counts when its
 * combo banks (an ollie with nothing in it, at touchdown), if it started within spot.radius: one
 * further out misses, too far from the mark (the reason the UI shows, not a run-out clock).
 */
export function trackTry(sim: Sim, t: Thing, events: SimEvent[], tr: SkateTry) {
  if (tr.phase === 'done') return
  const S = sim.data.run.skate
  const away = Math.round(Math.hypot(t.pos.x - S.spot.mark[0], t.pos.y - S.spot.mark[1]) * 100) / 100
  const done = (ok: boolean, trick: string, name: string, reason: string) => {
    const far = tr.at > S.spot.radius
    tr.phase = 'done'; tr.ok = ok && !far; tr.trick = trick; tr.name = name; tr.reason = far ? TOO_FAR : reason
  }
  for (const e of events) {
    if ((tr.phase as SkateTry['phase']) === 'done') break   // done() inside the loop
    if (tr.phase === 'ready') {
      if (away > S.spot.near) continue
      if (e.t === 'pop' && tr.ground) { tr.phase = 'air'; tr.at = away }
      else if (e.t === 'manualStart') { tr.phase = 'manual'; tr.at = away }
      continue
    }
    if (e.t === 'bail') done(false, '', '', 'bail')
    else if (e.t === 'comboLost') done(false, '', '', events.some((x) => x.t === 'bail') ? 'bail' : 'lost it')   // a bail drops the combo first
    else if (e.t === 'land' && tr.phase === 'air') {
      // Not clean: a miss, whatever it was (the combo still holds the air's tricks, for `got`).
      if (e.quality !== 'clean') { const j = judgeTrick(sim, t.combo, tr.manualTicks); done(false, j.trick, j.name, e.quality) }
      else tr.phase = 'landed'
    }
    else if (e.t === 'comboLanded' && (tr.phase === 'landed' || tr.phase === 'manual')) { const j = judgeTrick(sim, e.entries, tr.manualTicks); done(j.ok, j.trick, j.name, j.reason) }
    else if (e.t === 'manualStart' && tr.phase === 'landed') tr.phase = 'manual'
    else if (e.t === 'pop' && tr.phase === 'manual') tr.phase = 'air'
  }
  if (t.manual) tr.manualTicks = Math.max(tr.manualTicks, t.manual.ticks)
  // A plain ollie: down clean with nothing to bank.
  if (tr.phase === 'landed' && t.combo.length === 0 && !t.manual && t.landGrace === 0) done(true, 'ollie', 'Ollie', '')
  tr.ground = t.state === State.ground
}

// ---- The trick autopilot: the local's keys (and the harness bot's) ----

export const freshPilot = (): TrickPilot => ({ ride: 'run', count: 0, air: 0, airT: 0, man: 0, i: 1, lastUp: -1000 })

const DIRS: Record<string, number> = { up: Btn.up, down: Btn.down, left: Btn.left, right: Btn.right, upleft: Btn.up | Btn.left, upright: Btn.up | Btn.right, downleft: Btn.down | Btn.left, downright: Btn.down | Btn.right, none: 0 }

/**
 * The keys for a try at the spot: ride the lane from spot.start at runSpeed, lock lockTicks before
 * the mark and count down (crouch for a full ollie, the foot trick's taps, the manual's taps), pop
 * on the mark, then the air (flip, grab, spin to the angle) and a foot brake after. A planned miss
 * flips or grabs too late, lands crooked, or lets the manual go.
 */
export function trickKeys(sim: Sim, t: Thing, p: TrickPilot, plan: TrickPlan): number {
  const S = sim.data.run.skate, P = sim.data.physics, hz = P.tickHz
  if (t.state === State.bail || t.state === State.walk) return 0
  const parts = trickParts(sim, plan.trick)
  if (t.state === State.air) {
    // Off the ground from the countdown (or out of the manual): the try's air. Before it, settling at the start.
    if (p.ride === 'count') { p.ride = 'air'; p.air = 0; p.airT = Math.round(((2 * Math.max(0, t.vel.z)) / P.gravity) * hz) }
    if (p.ride !== 'air') return 0
    p.air++
    return airKeys(sim, t, p, plan, parts)
  }
  if (t.state !== State.ground) return 0
  if (p.ride === 'air') p.ride = 'out'
  if (t.manual) return manualKeys(sim, t, p, plan)
  const speed = Math.hypot(t.vel.x, t.vel.y)
  if (p.ride === 'out') return speed > 0.4 ? Btn.down : 0
  const [ax, ay] = S.spot.start, [ex, ey] = S.spot.end, [mx, my] = S.spot.mark
  const L = Math.hypot(ex - ax, ey - ay), ux = (ex - ax) / L, uy = (ey - ay) / L
  const toMark = (mx - ax) * ux + (my - ay) * uy - ((t.pos.x - ax) * ux + (t.pos.y - ay) * uy)
  const f = followLine(sim, t, p, [[ax, ay], [ex, ey]], 1, S.runSpeed, 0.6)
  if (p.ride === 'run') {
    const ticks = (toMark / Math.max(speed, 0.5)) * hz
    if (speed < 0.8 * S.runSpeed || ticks > S.lockTicks) return f ? f.b : 0
    p.ride = 'count'; p.count = Math.round(ticks)
  }
  // Counting down to the mark: steering only (no pushes or brakes: their taps would read as tricks).
  let b = f ? f.b & (Btn.left | Btn.right) : 0
  const c = p.count--
  if (c < -30) { p.ride = 'out'; return 0 }   // never got off the ground
  if (parts.manual) {
    // Up then down: manual; down then up: nose manual (combo.ts manualInput).
    const [first, second] = parts.manual === 'manual' ? [Btn.up, Btn.down] : [Btn.down, Btn.up]
    if (c === 5) b |= first
    if (c === 0) b |= second
    return b
  }
  if (c > 0 && c <= P.ollie.chargeTicks) b |= Btn.ollie   // crouch: a full charge; letting go at 0 pops
  if (parts.foot === 'boneless' && (c === 14 || c === 7)) b |= Btn.up
  if (parts.foot === 'nocomply' && c === 6) b |= Btn.down
  return b
}

function airKeys(sim: Sim, t: Thing, p: TrickPilot, plan: TrickPlan, parts: Parts): number {
  const A = sim.data.physics.air.spinAccel, hz = sim.data.physics.tickHz
  const late = !plan.make && plan.miss === 'late'
  let b = spinKeys(t, parts.spin + (!plan.make && plan.miss === 'twist' ? plan.twist : 0), A, hz)
  if (parts.flip) {
    const at = late ? Math.max(4, p.airT - Math.round(parts.flip.ticks / 2)) : 3
    if (p.air === at) b |= Btn.flip | DIRS[parts.flip.dir]
    if ((parts.flip.taps ?? 1) >= 2 && p.air === at + 3) b |= Btn.flip   // the double tap's second press
    if ((parts.flip.taps ?? 1) >= 3 && p.air === at + 6) b |= Btn.flip   // the triple tap's third
  }
  if (parts.grab) {
    // The direction only on the press (held, it would spin); then hold the grab and let go in time.
    const hold = late ? 1e9 : Math.max(1, p.airT - parts.grab.enterTicks - parts.grab.exitTicks - 16)
    if (p.air === 3) b |= Btn.grab | DIRS[parts.grab.dir]
    else if (p.air > 3 && p.air < 3 + hold) b |= Btn.grab
  }
  return b
}

/** Spin to `target` radians and stop there: toward it, then the other way to brake in time. */
function spinKeys(t: Thing, target: number, A: number, hz: number): number {
  const rem = target - t.spin, v = t.spinVel
  if (Math.abs(rem) < 0.05) return Math.abs(v) > 0.4 ? (v > 0 ? Btn.spinR : Btn.spinL) : 0
  const toward = rem > 0 ? Btn.spinL : Btn.spinR, against = rem > 0 ? Btn.spinR : Btn.spinL
  if (v * rem > 0 && (v * v) / (2 * A) >= Math.abs(rem) - Math.abs(v) / hz) return against
  return toward
}

/** In a manual: keep the balance (the scenario balance bot's rule), ollie out once it is long enough; a planned fall lets it go. */
function manualKeys(sim: Sim, t: Thing, p: TrickPilot, plan: TrickPlan): number {
  const m = t.manual!, S = sim.data.run.skate, hz = sim.data.physics.tickHz
  p.man++
  if (!plan.make && plan.miss === 'fall' && p.man >= plan.failAt) return m.balance > 0 ? Btn.up : Btn.down
  let b = m.balance > 0.03 ? Btn.down : m.balance < -0.03 ? Btn.up : 0
  const out = Math.round((S.manualSeconds + 0.4) * hz)
  if (p.man >= out && p.man < out + 8) b |= Btn.ollie
  return b
}

// ---- The local ----

const locals = (sim: Sim) => sim.world.things.filter((t) => t.kind === Kind.npc && t.npc?.skate)
export function clearLocals(sim: Sim) { sim.world.things = sim.world.things.filter((t) => !(t.kind === Kind.npc && t.npc?.skate)) }
const localDef = (sim: Sim, t: Thing): SkateLocal => sim.data.run.skate.locals.find((l) => l.id === t.npc!.skate!.id)!

/** One tick for the local: standing by, or riding its try on its own stream; only npc* events reach the world. */
export function stepLocal(sim: Sim, t: Thing, out: SimEvent[]) {
  const L = t.npc!.skate!, tick = sim.world.tick
  if (!L.go) { t.vel = v3(); return }   // waiting: at its watch spot, or at the start before its clock runs
  const b = trickKeys(sim, t, L.pilot, L.plan)
  const keep = sim.world.rng
  sim.world.rng = sim.world.skateRng!
  const ev: SimEvent[] = []
  try { stepSkater(sim, t, { b } as InputFrame, ev) } finally { sim.world.skateRng = sim.world.rng; sim.world.rng = keep }
  trackTry(sim, t, ev, L.try)
  for (const e of ev) {
    if (e.t === 'trickEnd') out.push({ t: 'npcTrick', tick, id: t.id, trick: e.trick, points: e.points })
    else if (e.t === 'comboLanded') out.push({ t: 'npcLand', tick, id: t.id, trick: e.name, points: e.points })
    else if (e.t === 'bail') out.push({ t: 'npcBail', tick, id: t.id, reason: e.reason })
  }
}

/** Put a skater on the ground at a park [x, y], facing heading (degrees), fresh: no combo, nothing running. */
export function place(sim: Sim, t: Thing, at: [number, number], heading: number, id: string) {
  const from = sim.data.npc.castFrom, r = sim.data.physics.skater.radius
  const g = raycast(sim.park, v3(at[0], at[1], from), v3(0, 0, -1), from - sim.park.boundsMin.z + 1)
  const pos = v3(at[0], at[1], (g?.point.z ?? 0) + r + 0.02)
  for (let k = 0; k < 25 && sphereContacts(sim.park, pos, r, touching).length > 0; k++) pos.z += 0.02
  placeAt(t, { id, pos, heading: heading * DEG })
  t.combo = []; t.trick = null; t.grind = null; t.manual = null; t.lip = null; t.wall = null; t.skitch = null
  t.charge = 0; t.crouch = false; t.landGrace = 0; t.powerslide = 0; t.wobble = 0; t.stumble = 0; t.spin = 0; t.spinVel = 0
  t.climb = 0; t.hang = false; t.footAir = false
}

/** The local's plan for its try: the trick (its set, or the one to match), and whether and how it misses. */
function planFor(sim: Sim, s: Thing, def: SkateLocal): TrickPlan {
  const S = sim.data.run.skate
  let trick = s.skateTrick ?? ''
  if (s.skateRole === 'set') {
    const used = s.skateUsed ?? [], fresh = (xs: string[]) => xs.filter((x) => !used.includes(x))
    const favs = fresh(def.favorites), any = fresh(S.sets)
    trick = favs.length && rand(sim) < S.favoriteChance ? pick(sim, favs) : any.length ? pick(sim, any) : pick(sim, S.sets)
  }
  const chance = Math.max(S.minMake, Math.min(S.maxMake, def.skill - S.hardness * trickDifficulty(sim, trick) + (def.favorites.includes(trick) ? S.favoriteBonus : 0)))
  const make = rand(sim) < chance
  const parts = trickParts(sim, trick)
  const miss = parts.manual ? 'fall' : (parts.flip || parts.grab) && rand(sim) < 0.5 ? 'late' : 'twist'
  // A crooked landing: 5-20 degrees past the clean band (land.cleanDeg), so it lands sketchy, a miss, wherever that band is.
  const twist = (rand(sim) < 0.5 ? -1 : 1) * (sim.data.physics.land.cleanDeg + 5 + 15 * rand(sim)) * DEG
  const failAt = Math.round((0.2 + 0.6 * rand(sim)) * S.manualSeconds * sim.data.physics.tickHz)
  return { trick, make, miss, twist, failAt }
}

const say = (sim: Sim, def: SkateLocal, kind: keyof SkateLines, trick = '') => pick(sim, def.lines[kind]).replace('{trick}', trick)

// ---- Keeping the lane clear: park NPCs during a game (game/npc.ts) ----

/** Is (x, y) on the lane: spot.start to spot.end, 2 m longer each way, spot.clear either side? */
export function onSkateLane(sim: Sim, x: number, y: number): boolean {
  const S = sim.data.run.skate.spot, [ax, ay] = S.start, [ex, ey] = S.end
  const L = Math.hypot(ex - ax, ey - ay), ux = (ex - ax) / L, uy = (ey - ay) / L
  const a = (x - ax) * ux + (y - ay) * uy, c = -(x - ax) * uy + (y - ay) * ux
  return a >= -2 && a <= L + 2 && Math.abs(c) <= S.clear
}

/** Does a rider line pass over the lane (its polyline every half metre)? */
export function lineCrossesSkateLane(sim: Sim, pts: [number, number][]): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 0.5))
    for (let k = 0; k <= n; k++) if (onSkateLane(sim, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n)) return true
  }
  return false
}

/** A game of S.K.A.T.E. (or two-player HORSE, game/twoplayer.ts) is on: the park's NPC skaters keep off the lane. */
export function skateGameOn(sim: Sim): boolean {
  return sim.world.things.some((t) => t.kind === Kind.session && (t.mode === 'skate' || t.mode === 'horse2p'))
}

// ---- The game ----

/** `run skate [local]`: the local (named, or one drawn) comes out, you both go to the spot, the local sets first. */
export function startSkate(sim: Sim, s: Thing, sk: Thing, events: SimEvent[], who?: string) {
  const S = sim.data.run.skate
  if (!S.parks.includes(sim.park.name)) throw new Error(`S.K.A.T.E. is played in the park (${S.parks.join(', ')}), not ${sim.park.name}`)
  if (who && !S.locals.some((l) => l.id === who)) throw new Error(`no local "${who}" (locals: ${S.locals.map((l) => l.id).join(', ')})`)
  if (!sim.world.skateRng) sim.world.skateRng = seedRng((sim.world.seed * 104729 + 31) >>> 0)
  clearLocals(sim)
  const def = who ? S.locals.find((l) => l.id === who)! : pick(sim, S.locals)
  const t = spawn(sim, Kind.npc)
  t.npc = { line: 0, i: 1, lastUp: -1000, plan: 0, act: '', actTicks: 0, actEnd: 0, dir: 0, slow: 0, speed: S.runSpeed, look: def.look,
    skate: { id: def.id, name: def.name, go: false, plan: { trick: '', make: true, miss: 'twist', twist: 0, failAt: 0 }, pilot: freshPilot(), try: freshTry(t) } }
  place(sim, t, S.spot.localWatch, S.spot.watchHeading, `skate_${def.id}`)
  place(sim, sk, S.spot.playerWatch, S.spot.watchHeading, 'skate_watch')
  s.skateLocal = t.id; s.skateName = def.name; s.skatePlayer = ''; s.skateLocalLetters = ''; s.skateUsed = []
  events.push({ t: 'skateStart', tick: sim.world.tick, local: def.id, name: def.name, hood: def.hood, word: S.word })
  beginTurn(sim, s, sk, t, 'local', 'set', '', '', events)
}

/** A turn: whoever is up goes to the start; the clock waits pauseSeconds. */
function beginTurn(sim: Sim, s: Thing, sk: Thing, local: Thing, who: SkateSide, role: 'set' | 'match', trick: string, name: string, events: SimEvent[]) {
  const S = sim.data.run.skate, hz = sim.data.physics.tickHz
  s.skateTurn = who; s.skateRole = role; s.skateTrick = trick; s.skateTrickName = name
  const seconds = role === 'set' ? S.setSeconds : S.matchSeconds
  s.timeLeft = Math.round(seconds * hz)
  s.skatePause = Math.max(1, Math.round(S.pauseSeconds * hz))
  if (who === 'player') place(sim, sk, S.spot.start, S.spot.heading, 'skate_start')
  else { place(sim, local, S.spot.start, S.spot.heading, 'skate_start'); local.npc!.skate!.go = false; local.npc!.skate!.try = freshTry(local) }
  s.skateTry = freshTry(sk)
  events.push({ t: 'skateTurn', tick: sim.world.tick, who, role, trick, name, seconds })
}

/** The clock starts: the local makes its plan and rides (the player's try has been watched since the turn began). */
function startClock(sim: Sim, s: Thing, local: Thing) {
  if (s.skateTurn !== 'local') return
  const L = local.npc!.skate!
  L.plan = planFor(sim, s, localDef(sim, local))
  L.pilot = freshPilot()
  L.try = freshTry(local)
  L.go = true
}

/**
 * One tick of the game: the pause, the clock, the try, the turn's outcome. Your try is watched from
 * the turn's start (pushing off at once reaches the mark before the pause is over); the clock only
 * runs after the pause.
 */
export function stepSkate(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const local = locals(sim).find((t) => t.id === s.skateLocal)
  if (!local) { s.mode = 'over'; return }   // the local was sent home (npc clear)
  const pausing = (s.skatePause ?? 0) > 0
  if (pausing) {
    s.skatePause! -= 1
    if (s.skatePause === 0) startClock(sim, s, local)
  }
  const tr = s.skateTurn === 'player' ? s.skateTry! : local.npc!.skate!.try
  if (s.skateTurn === 'player') trackTry(sim, sk, events, tr)
  if (!pausing && s.timeLeft > 0) s.timeLeft--
  if (tr.phase !== 'done') {
    if (pausing || s.timeLeft > 0 || tr.phase !== 'ready') return   // a try under way may finish after the clock
    tr.phase = 'done'; tr.ok = false; tr.reason = 'time'
  }
  endTurn(sim, s, sk, local, tr, events)
}

function endTurn(sim: Sim, s: Thing, sk: Thing, local: Thing, tr: SkateTry, events: SimEvent[]) {
  const S = sim.data.run.skate, tick = sim.world.tick, by = s.skateTurn!, def = localDef(sim, local)
  if (by === 'local') { local.npc!.skate!.go = false; place(sim, local, S.spot.localWatch, S.spot.watchHeading, `skate_${def.id}`) }
  if (s.skateRole === 'set') {
    // A set stands if it was landed clean and has not been set before; either way the other sets next round.
    const again = tr.ok && (s.skateUsed ?? []).includes(tr.trick)
    if (tr.ok && !again) {
      s.skateUsed = [...(s.skateUsed ?? []), tr.trick]
      events.push({ t: 'skateSet', tick, by, trick: tr.trick, name: tr.name, at: tr.at, line: by === 'local' ? say(sim, def, 'set', tr.name) : '' })
      return beginTurn(sim, s, sk, local, other(by), 'match', tr.trick, tr.name, events)
    }
    events.push({ t: 'skateSetMiss', tick, by, reason: again ? 'already set' : tr.reason, got: tr.trick, at: tr.at, line: by === 'local' ? say(sim, def, 'setMiss') : '' })
    return beginTurn(sim, s, sk, local, other(by), 'set', '', '', events)
  }
  const ok = tr.ok && tr.trick === s.skateTrick
  const reason = ok ? '' : tr.ok ? 'different trick' : tr.reason
  const line = say(sim, def, by === 'local' ? (ok ? 'make' : 'miss') : ok ? 'youMake' : 'youMiss', s.skateTrickName)
  events.push({ t: 'skateMatch', tick, by, ok, trick: s.skateTrick ?? '', name: s.skateTrickName ?? '', got: tr.trick, reason, at: tr.at, line })
  if (!ok) {
    const had = (by === 'player' ? s.skatePlayer : s.skateLocalLetters) ?? ''
    const letters = had + S.word[had.length]
    if (by === 'player') s.skatePlayer = letters
    else s.skateLocalLetters = letters
    events.push({ t: 'skateLetter', tick, who: by, letters })
    if (letters.length >= S.word.length) {
      const winner = other(by)
      events.push({ t: 'skateOver', tick, winner, name: def.name, player: s.skatePlayer ?? '', local: s.skateLocalLetters ?? '', line: say(sim, def, winner === 'local' ? 'win' : 'lose') })
      s.mode = 'over'
      clearLocals(sim)
      return
    }
  }
  beginTurn(sim, s, sk, local, by, 'set', '', '', events)   // the matcher sets next
}
