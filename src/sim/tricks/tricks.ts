import type { Dir, FlipDef, GrabDef } from '../data.ts'
import { Btn, has, stick, type InputFrame } from '../input.ts'
import { abs, clamp, max, min, PI } from '../math.ts'
import type { Sim, SimEvent } from '../sim.ts'
import type { ComboEntry, Thing } from '../thing.ts'

// Air tricks: flips, grabs, spins, and the combo they add up to.
// Spec: docs/mechanics/air-tricks.md.

export function dir8(f: InputFrame): Dir {
  const s = stick(f)
  const v = s.y > 0 ? 'up' : s.y < 0 ? 'down' : ''
  const h = s.x > 0 ? 'right' : s.x < 0 ? 'left' : ''
  return ((v + h) || 'none') as Dir
}

const pressed = (t: Thing, f: InputFrame, b: number) => has(f, b) && (t.prevB & b) === 0

/** The flip for J + d (one press; twice: the direction pressed twice, the classic games' Right, Right + flip). A double tap turns it into flipVariant(...) below. */
export function flipFor(sim: Sim, d: Dir, twice = false): FlipDef {
  const T = sim.data.tricks
  return (twice ? T.flips.find((x) => x.dir === d && !x.taps && x.twice) : undefined) ?? T.flips.find((x) => x.dir === d && !x.taps && !x.twice) ?? T.flips.find((x) => x.id === T.defaults.flip)!
}
/** The next tap's variant of a flip (same slot, one more J: taps 2, then 3), or null when that slot has none. */
export function flipVariant(sim: Sim, base: FlipDef): FlipDef | null {
  const T = sim.data.tricks
  const dir = base.id === T.defaults.flip ? T.flips.find((x) => x.id === base.id)!.dir : base.dir
  const taps = (base.taps ?? 1) + 1
  return T.flips.find((x) => x.taps === taps && x.dir === dir && !!x.twice === !!base.twice) ?? null
}
/**
 * J with a direction pressed twice (the classic games' double-direction slots: "R, R + Square", Right, then Right
 * and the button together): the last two direction presses the same cardinal direction, close together, the
 * second with J, and only that direction held. Not a special: no meter needed.
 */
function twiceFor(sim: Sim, t: Thing, d: Dir): boolean {
  if (t.dirHist.length < 2 || !['up', 'down', 'left', 'right'].includes(d)) return false
  const [a, b] = t.dirHist.slice(-2)
  // Both in this air: the balance taps on a grind or a manual just before the pop are not the slot's input.
  const airFrom = sim.world.tick - t.stateTicks
  return a.d === d && b.d === d && a.tick >= airFrom && b.tick - a.tick <= 20 && sim.world.tick - b.tick <= 12
}
/**
 * A diagonal's two keys rarely go down on the same tick: within tricks.dirTicks of J (or L) the diagonal a held
 * direction grows into is the trick's (from none only a diagonal: a lone arrow just after J may be a spin).
 */
const DIAG: Record<string, Dir[]> = { none: ['upleft', 'upright', 'downleft', 'downright'], up: ['upleft', 'upright'], down: ['downleft', 'downright'], left: ['upleft', 'downleft'], right: ['upright', 'downright'] }
const STANCE = { fakie: 'Fakie', nollie: 'Nollie', switch: 'Switch' } as const
/** A trick's name in the stance it was popped in (Thing.stance): Fakie Kickflip, Nollie Heelflip, Switch Kickflip. */
export const stanceName = (stance: Thing['stance'], name: string) => (stance ? `${STANCE[stance]} ${name}` : name)
export const airName = (t: Thing, name: string) => stanceName(t.stance, name)
/** Its points in that stance: data tricks.stance (switch and nollie are worth a little more). */
export const stancePoints = (sim: Sim, stance: Thing['stance'], points: number) => Math.round(points * (stance ? sim.data.tricks.stance[stance] : 1))
export function grabFor(sim: Sim, d: Dir): GrabDef {
  const T = sim.data.tricks
  return T.grabs.find((x) => x.dir === d && !x.taps) ?? T.grabs.find((x) => x.id === T.defaults.grab)!
}
export function trickDef(sim: Sim, id: string, kind: 'flip' | 'grab'): FlipDef | GrabDef | undefined {
  const T = sim.data.tricks
  const base = kind === 'flip' ? T.flips.find((x) => x.id === id) : T.grabs.find((x) => x.id === id)
  if (base) return base
  const sp = T.specials.find((x) => x.id === id && x.kind === kind)
  return sp ? ({ ...sp, dir: 'none' } as FlipDef | GrabDef) : undefined
}

/** With the meter full: the last two direction presses (quick, recent) plus this button make a special. */
function specialFor(sim: Sim, t: Thing, kind: 'flip' | 'grab', f: InputFrame) {
  if (t.special < 1 || t.dirHist.length < 2) return null
  const [a, b] = t.dirHist.slice(-2)
  const now = sim.world.tick
  if (b.tick - a.tick > 20 || now - b.tick > 12) return null
  // Two keys gone down within dirTicks of each other and both still held are a diagonal (D and S for down
  // right: the Varial Heelflip), not a sequence (Right, Down: the Kickflip Superman).
  const held = dir8(f)
  if (b.tick - a.tick <= sim.data.tricks.dirTicks && held.length > 5 && held.includes(a.d) && held.includes(b.d)) return null
  return sim.data.tricks.specials.find((x) => x.kind === kind && x.seq[0] === a.d && x.seq[1] === b.d) ?? null
}

/** One air tick: advance the running trick, start new ones, spin. Returns the spin step (radians). */
export function stepAirTricks(sim: Sim, t: Thing, f: InputFrame, events: SimEvent[]): number {
  const tick = sim.world.tick
  const A = sim.data.physics.air
  const dt = 1 / sim.data.physics.tickHz
  if (t.trick) {
    const r = t.trick
    r.tick++
    if (r.kind === 'flip') {
      let def = trickDef(sim, r.id, 'flip') as FlipDef
      // A diagonal's second key a few ticks after J (W, then D with J: keys pressed together land a tick or
      // two apart): within tricks.dirTicks of the press, the flip is the diagonal's (Impossible into Inward
      // Heelflip), before any double tap.
      const dd = dir8(f)
      if (r.dir && r.tick <= sim.data.tricks.dirTicks && !def.taps && !def.twice && DIAG[r.dir]?.includes(dd) && sim.data.tricks.flips.includes(def)) {
        const nd = flipFor(sim, dd)
        r.dir = dd
        if (nd.id !== def.id) { r.id = nd.id; def = nd; events.push({ t: 'trickStart', tick, trick: airName(t, nd.name) }) }
      }
      // Double and triple tap (as in the classic games): J again soon after the last press turns the flip into its slot's next
      // variant (Kickflip into a Double Kickflip, then a Triple Kickflip; Pop Shove-It into a 360 Shove-It),
      // running on from here.
      const v = r.tick - (r.tapAt ?? 0) <= sim.data.tricks.doubleTapTicks && r.tick > 0 && pressed(t, f, Btn.flip) && sim.data.tricks.flips.includes(def) ? flipVariant(sim, def) : null
      if (v) { r.id = v.id; r.tapAt = r.tick; def = v; events.push({ t: 'trickStart', tick, trick: airName(t, v.name) }) }
      // The body turning the named way (a 360 Shove-It with the body going backside): from an eighth of a
      // turn on it is that trick by name (a Bigspin), in the events and in the combo when it ends.
      if (!r.named) {
        const n = sim.data.tricks.named.find((x) => x.of === def.id && x.spin.slice(0, 2) === spinSide(sim, t))
        if (n && abs(t.spin) >= PI / 4) { r.named = n.id; events.push({ t: 'trickStart', tick, trick: airName(t, n.name) }) }
      }
      const nd = r.named ? sim.data.tricks.named.find((x) => x.id === r.named) : undefined
      if (r.tick >= def.ticks) finish(t, nd ? { id: nd.id, name: airName(t, nd.name), points: stancePoints(sim, t.stance, nd.points) } : { id: def.id, name: airName(t, def.name), points: stancePoints(sim, t.stance, def.points) }, tick, events)
    } else {
      let def = trickDef(sim, r.id, 'grab') as GrabDef
      // A diagonal's second key just after L, as for flips.
      const dd = dir8(f)
      if (r.dir && r.phase === 'enter' && r.tick <= sim.data.tricks.dirTicks && !def.taps && DIAG[r.dir]?.includes(dd) && sim.data.tricks.grabs.includes(def)) {
        const nd = grabFor(sim, dd)
        r.dir = dd
        if (nd.id !== def.id) { r.id = nd.id; def = nd; events.push({ t: 'trickStart', tick, trick: airName(t, nd.name) }) }
      }
      // Double tap: L again soon after the first press, its slot's variant grab (Indy into a Mute).
      const v = r.phase === 'enter' && r.tick <= sim.data.tricks.doubleTapTicks && pressed(t, f, Btn.grab) && !def.taps && sim.data.tricks.grabs.includes(def)
        ? sim.data.tricks.grabs.find((x) => x.taps === 2 && x.dir === def.dir) : undefined
      if (v) { r.id = v.id; def = v; events.push({ t: 'trickStart', tick, trick: airName(t, v.name) }) }
      if (r.phase === 'enter' && r.tick >= def.enterTicks) { r.phase = 'hold'; r.tick = 0 }
      if (r.phase === 'hold') {
        if (has(f, Btn.grab)) r.held++
        else { r.phase = 'exit'; r.tick = 0 }
      }
      if (r.phase === 'exit' && r.tick >= def.exitTicks) {
        const pts = Math.round(def.points + (def.pointsPerSecond * r.held) / sim.data.physics.tickHz)
        finish(t, { id: def.id, name: airName(t, def.name), points: stancePoints(sim, t.stance, pts) }, tick, events)
      }
    }
  }
  if (!t.trick) {
    if (pressed(t, f, Btn.flip)) {
      const d = dir8(f), sp = specialFor(sim, t, 'flip', f)
      const def = sp ?? flipFor(sim, d, twiceFor(sim, t, d))
      t.trick = { id: def.id, kind: 'flip', tick: 0, phase: 'run', held: 0, ...(sp ? {} : { dir: d }) }
      events.push({ t: 'trickStart', tick, trick: airName(t, def.name) })
    } else if (pressed(t, f, Btn.grab)) {
      const d = dir8(f), sp = specialFor(sim, t, 'grab', f)
      const def = sp ?? grabFor(sim, d)
      t.trick = { id: def.id, kind: 'grab', tick: 0, phase: 'enter', held: 0, ...(sp ? {} : { dir: d }) }
      events.push({ t: 'trickStart', tick, trick: airName(t, def.name) })
    }
  }
  // Spin: left/right (or the spin keys) accelerate; let go and it eases off.
  const want = (has(f, Btn.left) || has(f, Btn.spinL) ? 1 : 0) - (has(f, Btn.right) || has(f, Btn.spinR) ? 1 : 0)
  if (want !== 0) t.spinVel = clamp(t.spinVel + want * A.spinAccel * dt, -A.spinMax, A.spinMax)
  else t.spinVel = t.spinVel > 0 ? max(0, t.spinVel - A.spinDecay * dt) : min(0, t.spinVel + A.spinDecay * dt)
  const step = t.spinVel * dt
  t.spin += step
  return step
}

function finish(t: Thing, e: ComboEntry, tick: number, events: SimEvent[]) {
  t.combo.push(e)
  t.trick = null
  events.push({ t: 'trickEnd', tick, trick: e.name, points: e.points })
}

/**
 * Name and value of a combo, arcade style: the n-th time a trick (by id) is in the combo it is worth
 * scoring.repeat[n - 1] of its points (the last share from then on), values[i] each entry's worth
 * after that (what the trick string shows); multiplier = trick count.
 */
export function comboValue(sim: Sim, entries: ComboEntry[]) {
  const R = sim.data.scoring.repeat
  const seen = new Map<string, number>()
  let sum = 0
  const values = entries.map((e) => {
    const n = seen.get(e.id) ?? 0
    seen.set(e.id, n + 1)
    const v = Math.round(e.points * R[Math.min(n, R.length - 1)])
    sum += v
    return v
  })
  const multiplier = entries.length
  return { name: entries.map((e) => e.name).join(' + '), points: sum * multiplier, multiplier, values }
}

/**
 * Grinds, lip tricks or manuals already in this combo (by kind). Each makes the next one's balance
 * touchier (the classic games 3+: the meter gets harder as a combo goes on): it starts further over
 * (comboTilt each) and tips faster (comboRamp each), so a chain of the same link cannot go on for ever.
 */
export function comboLinks(sim: Sim, t: Thing, kind: 'grind' | 'lip' | 'manual') {
  const T = sim.data.tricks
  let n = 0
  for (const e of t.combo) {
    if (kind === 'manual' ? T.manuals.some((d) => d.id === e.id) : kind === 'lip' ? T.lips.some((d) => d.id === e.id) : T.grinds.some((d) => d.id === e.id) || T.slides.some((d) => d.id === e.id)) n++
  }
  return n
}

/** The side the body turns this air ('fs' / 'bs'), named in the rider's stance (switch: the other one). */
function spinSide(sim: Sim, t: Thing) {
  const fs = (t.spin > 0) === (sim.data.rider.stance === 'regular')
  return (t.stance === 'switch' ? !fs : fs) ? 'fs' : 'bs'
}

/** Landing: the air's spin becomes a combo entry. Banking waits for the grace window. */
export function addSpin(sim: Sim, t: Thing) {
  const half = Math.round(abs(t.spin) / PI)
  // Positive spin turns left (counterclockwise from above): frontside for a regular rider, who
  // faces the right of the nose and so turns chest-first; backside for goofy. Fakie spins keep
  // the same name for the same turn (half-cab = fakie backside 180).
  const fs = (t.spin > 0) === (sim.data.rider.stance === 'regular')
  if (half >= 1) {
    const key = `${(t.stance === 'switch' ? !fs : fs) ? 'fs' : 'bs'}${half * 180}`   // switch: the other stance's side
    // A flip and the body's turn that skaters call one trick: a 360 Shove-It with a BS 180 is a Bigspin
    // (the last entry is this air's flip: a landing with a trick on bails, and an ollie banks the combo).
    const last = t.combo[t.combo.length - 1]
    const named = last ? sim.data.tricks.named.find((n) => n.of === last.id && n.spin === key) : undefined
    const already = last ? sim.data.tricks.named.find((n) => n.id === last.id) : undefined   // named as the body turned (in the air)
    if (already && already.spin !== key) {
      // It was a Bigspin while the body turned, but the turn did not end a backside 180: the flip and the spin after all.
      const of = sim.data.tricks.flips.find((f) => f.id === already.of)!
      t.combo[t.combo.length - 1] = { id: of.id, name: airName(t, of.name), points: stancePoints(sim, t.stance, of.points) }
    }
    if (named) t.combo[t.combo.length - 1] = { id: named.id, name: airName(t, named.name), points: stancePoints(sim, t.stance, named.points) }
    else if (already && already.spin === key) { /* the named trick has the turn in it */ }
    else {
      // Out of fakie, a backside 180 is a Half Cab and a backside 360 a Full Cab (Caballero's); the
      // rest carry the stance (fakie keeps the side of the same turn: fakie FS 180 turns chest first).
      // Switch is the other stance: its frontside is the other way round (a regular rider's switch FS
      // 180 turns clockwise, as a goofy rider's FS does).
      const deg = half * 180, side = key.slice(0, 2).toUpperCase()
      const name = t.stance === 'fakie' && side === 'BS' && deg === 180 ? 'Half Cab' : t.stance === 'fakie' && side === 'BS' && deg === 360 ? 'Full Cab' : airName(t, `${side} ${deg}`)
      t.combo.push({ id: `spin${half}`, name, points: stancePoints(sim, t.stance, half * sim.data.scoring.spinPer180) })
    }
  }
  t.spin = 0; t.spinVel = 0
}

/** Bank the combo: score, special meter. */
export function bankCombo(sim: Sim, t: Thing, events: SimEvent[]) {
  t.landGrace = 0
  if (t.combo.length === 0) return
  const v = comboValue(sim, t.combo)
  t.score += v.points
  t.lastLand.points = v.points
  t.lastLand.multiplier = v.multiplier
  t.lastLand.combo = v.name
  t.lastLand.bankTick = sim.world.tick
  events.push({ t: 'comboLanded', tick: sim.world.tick, name: v.name, points: v.points, multiplier: v.multiplier, entries: t.combo.map((e, i) => ({ ...e, value: v.values[i] })) })
  const was = t.special
  t.special = Math.min(1, t.special + v.points / sim.data.physics.combo.specialPoints)
  if (was < 1 && t.special >= 1) events.push({ t: 'specialReady', tick: sim.world.tick })
  t.combo = []
}

export function loseCombo(sim: Sim, t: Thing, events: SimEvent[]) {
  t.special = 0
  t.landGrace = 0
  t.manual = null
  const running = t.trick ? trickDef(sim, t.trick.id, t.trick.kind)?.name ?? t.trick.id : ''
  if (t.combo.length || t.trick) events.push({ t: 'comboLost', tick: sim.world.tick, name: [comboValue(sim, t.combo).name, running].filter(Boolean).join(' + ') })
  t.combo = []; t.trick = null; t.spin = 0; t.spinVel = 0
}
