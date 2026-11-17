import type { RailDef, RailDir } from '../data.ts'
import { Btn, has, stick, type InputFrame } from '../input.ts'
import { abs, add, angleBetween, atan2, DEG, dot, max, min, norm, scale, sub, v3, type Vec3 } from '../math.ts'
import { closestOnLine, grindNear, lineAt, type GrindLine } from '../park/grindlines.ts'
import { raycast, sphereContacts, type Contact } from '../park/park.ts'
import { nextFloat } from '../rng.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { Kind, State, type GrindRun, type Thing } from '../thing.ts'
import { carEdges, carLine } from '../game/carlines.ts'
import { dimsOf } from './cars.ts'
import { moveSphere } from './move.ts'
import { dragK } from './board.ts'
import { startLip } from './combo.ts'
import { comboLinks, stanceName, stancePoints } from '../tricks/tricks.ts'

// Grinds and slides on lines derived from the park geometry.
// Spec: docs/mechanics/grinds.md.

const Z = v3(0, 0, 1)
const mm = (x: number) => Math.round(x * 1000) / 1000
const hits: Contact[] = []
const nearIds: number[] = []

/** Something other than the edge itself within 80% of the radius: the grind would run through it. */
const blocked = (sim: Sim, p: Vec3) => sphereContacts(sim.park, p, sim.data.physics.skater.radius * 0.8, hits).length > 0
const sightHits: Contact[] = []

/**
 * The way from the skater to its place on a line is clear: a sphere of grind.sightRadius swept along
 * it touches nothing more than grind.sightSkip from the line (nearer is the rail or ledge itself).
 * A single ray slipped through slots no skater fits through, like the gap between the SoMa park's
 * north wall and the fence on top of it.
 */
function clearWay(sim: Sim, from: Vec3, to: Vec3, at: Vec3): boolean {
  const G = sim.data.physics.grind, rs = G.sightRadius
  const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z, l = Math.hypot(dx, dy, dz)
  const n = Math.max(1, Math.ceil(l / (rs * 0.75)))
  for (let i = 0; i <= n; i++) {
    const p = v3(from.x + (dx * i) / n, from.y + (dy * i) / n, from.z + (dz * i) / n)
    for (const k of sphereContacts(sim.park, p, rs, sightHits)) if (Math.hypot(k.px - at.x, k.py - at.y, k.pz - at.z) > G.sightSkip) return false
  }
  return true
}

/**
 * Stick relative to the rail. Up/down run along the board; left/right become toward (the far
 * side of the rail) or away (back to the approach side). far is +1 when the far side is left of
 * the line direction; sgn is the travel direction along the line.
 */
function railDir(input: InputFrame, far: number, sgn: number): RailDir {
  const s = stick(input)
  const h = s.x === 0 ? '' : s.x * far * sgn < 0 ? 'toward' : 'away'
  if (s.y === 0) return (h || 'none') as RailDir
  return ((s.y > 0 ? 'up' : 'down') + (h ? h[0].toUpperCase() + h.slice(1) : '')) as RailDir
}

/** Definitions for a stick direction: exact, then the up/down part alone, then none, then the default. */
function candidates(list: RailDef[], d: RailDir, defaultId: string): RailDef[] {
  const vertical = d.startsWith('up') ? 'up' : d.startsWith('down') ? 'down' : 'none'
  for (const want of [d, vertical, 'none'] as RailDir[]) {
    const c = list.filter((x) => x.dirs.includes(want))
    if (c.length) return c
  }
  return [list.find((x) => x.id === defaultId)!]
}

/**
 * Pick the grind or slide and set the board for it. Slides that differ only in which end
 * crosses the rail (Boardslide / Lipslide) are told apart by where the nose points; a slide
 * that needs the nose one way (Noseslide over the far side, Tailslide back) turns the board.
 */
function choose(sim: Sim, t: Thing, line: GrindLine, input: InputFrame, taps = 1) {
  const g = t.grind!
  const T = sim.data.tricks
  const { tan } = lineAt(line, g.s)
  const th = norm(v3(tan.x, tan.y, 0), tan)
  const farDir = v3(-th.y * g.far, th.x * g.far, 0)
  const d = railDir(input, g.far, g.speed >= 0 ? 1 : -1)
  const all = candidates(g.slide ? T.slides : T.grinds, d, g.slide ? T.defaults.slide : T.defaults.grind)
  // One press: the plain grind for the direction; a double tap: its variant (taps 2) where there is one.
  const list = (taps === 2 && all.some((x) => x.taps === 2) ? all.filter((x) => x.taps === 2) : all.filter((x) => !x.taps)).concat(all)
  let def = list[0]
  if (g.slide) {
    // Riding switch, the rider's nose is the board's tail (the feet stay on their ends): a switch
    // noseslide slides on the board's tail, a switch boardslide crosses the rail tail first.
    const sw = g.stance === 'switch' ? -1 : 1
    const noseFar = dot(t.fwd, farDir) * sw >= 0
    def = list.find((x) => (x.nose === 'far') === noseFar) ?? def
    t.fwd = scale(farDir, (def.nose === 'near' ? -1 : 1) * sw)
  }
  g.id = def.id
  g.name = railName(t, line, def.name)
}

/**
 * FS / BS: the side the obstacle was on at the approach (g.fs: on the toe side, the chest facing it).
 * The stance it was ridden in (g.stance): the air's (Nollie, Switch, Fakie), else Fakie when it came
 * in tail first (fakie FS 50-50).
 */
function railName(t: Thing, line: GrindLine, name: string): string {
  const g = t.grind!
  return stanceName(g.stance, `${g.fs ? 'FS' : 'BS'} ${name}`)
}

/** A car's edge (a moving line) or a park line; null when the car has gone. */
function carOf(sim: Sim, g: GrindRun) {
  return g.car < 0 ? null : sim.world.things.find((c) => c.id === g.car && c.kind === Kind.car && c.alive && c.car) ?? null
}
function lineOf(sim: Sim, g: GrindRun): GrindLine | null {
  if (g.car < 0) return sim.park.grind[g.line]
  const c = carOf(sim, g)
  return c ? carLine(c, sim.data, g.line) : null
}
/** The velocity the line moves with (a car's), zero for the park. */
const lineVel = (sim: Sim, g: GrindRun): Vec3 => (g.car < 0 ? v3() : carOf(sim, g)?.vel ?? v3())

/** In the air with a buffered grind press: snap to the nearest line in reach (the park's, or a car's edges). */
export function tryCapture(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]): boolean {
  if (t.trick) return false
  const G = sim.data.physics.grind, r = sim.data.physics.skater.radius
  const feet = v3(t.pos.x, t.pos.y, t.pos.z - r)
  type Cand = { line: GrindLine; s: number; d: number; pos: Vec3; car: Thing | null; j: number }
  let best: Cand | null = null
  const reach = G.captureRadius + G.captureAbove + G.captureBelow
  const consider = (line: GrindLine, car: Thing | null, j: number) => {
    // Quick reject: the feet farther than the capture reach from the line's bounding box.
    if (feet.x < line.lo.x - reach || feet.x > line.hi.x + reach || feet.y < line.lo.y - reach || feet.y > line.hi.y + reach || feet.z < line.lo.z - reach || feet.z > line.hi.z + reach) return
    const c = closestOnLine(line, feet)
    if (c.d > G.captureRadius + G.captureAbove) return
    const dz = feet.z - c.pos.z
    const dh = Math.hypot(feet.x - c.pos.x, feet.y - c.pos.y)
    if (dh > G.captureRadius || dz > G.captureAbove || dz < -G.captureBelow) return
    // Still going up after leaving a grind: only a line at least regrabAbove higher (a transfer up).
    // Popping off a rail and catching it, or the ledge's other edge, the next tick was an endless
    // chain of grinds; a regrind comes back down onto it.
    if (t.offZ !== undefined && t.vel.z > 0 && c.pos.z < t.offZ + G.regrabAbove) return
    if (best && c.d >= best.d) return
    if (blocked(sim, v3(c.pos.x, c.pos.y, c.pos.z + r))) return
    // Not reached through something solid (a parked car's side, a wall) on the way from the skater.
    if (!clearWay(sim, t.pos, v3(c.pos.x, c.pos.y, c.pos.z + r), c.pos)) return
    best = { line, ...c, car, j }
  }
  // Only the lines near the feet (a grid over the park's lines), met in id order as a full scan would.
  for (const id of grindNear(sim.park.grindGrid, feet.x - reach, feet.y - reach, feet.x + reach, feet.y + reach, nearIds)) consider(sim.park.grind[id], null, id)
  // The cars near the skater: their roof edges, hood and trunk sides, bumpers.
  const T = sim.data.traffic
  for (const car of sim.world.things) {
    if (car.kind !== Kind.car || !car.alive || !car.car) continue
    const D = dimsOf(sim.data, car)
    if (abs(car.pos.x - t.pos.x) > D.collideRange || abs(car.pos.y - t.pos.y) > D.collideRange || abs(car.pos.z - t.pos.z) > D.collideRange) continue
    const n = carEdges(D).length
    for (let j = 0; j < n; j++) consider(carLine(car, sim.data, j), car, j)
  }
  const pick = best as Cand | null
  if (!pick) return false
  const moving = pick.car ? pick.car.vel : v3()   // a car's edge moves: speeds along it are relative to the car
  const { tan } = lineAt(pick.line, pick.s)
  const fh = norm(v3(t.fwd.x, t.fwd.y, 0), t.fwd)
  const th = norm(v3(tan.x, tan.y, 0), tan)
  const across = angleBetween(fh, th) / DEG
  const slide = across > G.slideAngleDeg && across < 180 - G.slideAngleDeg
  const rel = sub(t.vel, moving)
  let along = dot(rel, tan)
  // Which way along a sloped line: the catch's direction, not its speed (grinds.md). Rising onto a
  // down rail is not travel up it: the climb is the ollie the capture cuts short. Counted, a side
  // approach (a boardslide across a handrail) caught on the way up went UP the rail, the slide's floor
  // speed carrying that sign, and stalled (a playtest report of 2026-11-16, sf-bart-rail-slide-downhill). So when
  // the climb turns the sign, the way it goes along the line horizontally decides, at that speed; and
  // a slide whose catch is too slow for the floor speed goes downhill, as gravity would take it.
  const hAlong = rel.x * tan.x + rel.y * tan.y   // the horizontal travel's share along the line
  const sloped = abs(tan.z) > G.downhillSlope
  if (sloped && rel.z > 0 && along * hAlong < 0) along = hAlong
  // Coming up a vert wall slowly to the coping: a lip trick instead of a grind.
  if (t.vertAir && pick.line.kind === 'coping' && abs(along) < sim.data.physics.combo.lipMaxAlong) {
    if (t.lipped) return false   // one lip trick per air
    startLip(sim, t, pick.line, pick.s, input, events)
    return true
  }
  // Too slow along the line to grind (it would stall on its first tick, a void grind): no grind, the
  // skater comes down on it. Caught and stalled, a late ollie popped them straight up off a ledge's
  // end, a flip, caught again: a combo that never landed (phase 25, sf-ledge-hop-farm).
  if (!slide && abs(along) < G.stallSpeed) return false
  const downhill = tan.z < 0 ? 1 : -1   // the sign of travel down the line
  if (abs(along) < 0.2) along = (sloped ? downhill : dot(t.fwd, tan) >= 0 ? 1 : -1) * 0.2
  if (slide && sloped && along * downhill < 0 && abs(along) < G.slideMinSpeed) along = downhill * abs(along)
  const speed = (along >= 0 ? 1 : -1) * max(abs(along), slide ? G.slideMinSpeed : 0)
  // Which side of the rail the skater came from: where the air started, else where they are
  // now, else the way they are drifting. The far side is the other one.
  const tl = v3(-th.y, th.x, 0)
  const sideOf = (x: number, y: number) => (x - pick.pos.x) * tl.x + (y - pick.pos.y) * tl.y
  // (A car has moved since the takeoff: there, only where the skater is now counts.)
  let near = pick.car ? 0 : sideOf(t.takeoffXY[0], t.takeoffXY[1])
  if (abs(near) < 0.05) near = sideOf(t.pos.x, t.pos.y)
  if (abs(near) < 0.02) near = -dot(sub(t.vel, moving), tl)
  const far = near > 0 ? -1 : 1
  // Board along the line for grinds (keeping which end leads), across it for slides.
  const fwd0 = fh
  if (!slide) t.fwd = scale(th, dot(fh, th) >= 0 ? 1 : -1)
  else t.fwd = scale(tl, dot(fh, tl) >= 0 ? 1 : -1)
  t.up = v3(0, 0, 1)
  // Frontside = the chest faced the rail on the way in. Regular riders face the right of the nose, goofy
  // the left, in every stance (fakie and switch ride with the same body, the feet on the same ends).
  // Grinds: the board as it lands. Slides: the way it slides, which the chest faced if it came in nose
  // first and turned its back to if it came in tail first (fakie, switch: the chest is the other side).
  const tailFirst = slide ? dot(sub(t.vel, moving), fh) < -0.3 : speed * dot(t.fwd, tan) < 0   // a slide caught from (near) standstill is named forward
  const ahead = slide ? scale(th, (speed >= 0 ? 1 : -1) * (tailFirst ? -1 : 1)) : t.fwd
  const chest = sim.data.rider.stance === 'regular' ? v3(ahead.y, -ahead.x, 0) : v3(-ahead.y, ahead.x, 0)
  const fs = dot(chest, scale(tl, far)) > 0
  const side = nextFloat(sim.world.rng) < 0.5 ? -1 : 1
  t.lastLine = pick.car ? -1 : pick.line.id   // no gaps on cars
  const stance = t.stance ?? (tailFirst ? 'fakie' : undefined)
  t.grind = { line: pick.car ? pick.j : pick.line.id, s: pick.s, speed, slide, id: '', name: '', ticks: 0, balance: side * (G.balanceStart + G.comboTilt * comboLinks(sim, t, 'grind')), balanceVel: 0, side, far, fs, car: pick.car ? pick.car.id : -1, lastTap: sim.world.tick, ...(stance ? { stance } : {}) }
  choose(sim, t, pick.line, input, t.grindTaps ?? 1)
  delete t.grindTaps; delete t.stance; delete t.slideTurn; delete t.left
  t.state = State.grind
  t.stateTicks = 0
  t.grindPress = 0
  t.spinVel = 0
  t.vertAir = false
  const before = { ...t.pos }
  place(sim, t, pick.line)
  // The catch moves the skater onto the line at once (up to the capture reach): the view eases that over
  // the first ticks, so the board arrives on the edge instead of teleporting there.
  const snap: [number, number, number] = [mm(before.x - t.pos.x), mm(before.y - t.pos.y), mm(before.z - t.pos.z)]
  if (snap.some((x) => x !== 0)) t.grind.snap = snap
  // And how far it turned the board (a slide's choose() may turn it round): eased in the view too.
  const turn = atan2(fwd0.x * t.fwd.y - fwd0.y * t.fwd.x, fwd0.x * t.fwd.x + fwd0.y * t.fwd.y)
  if (abs(turn) > 0.01) t.grind.turn = Math.round(turn * 1000) / 1000
  events.push({ t: 'grindStart', tick: sim.world.tick, trick: t.grind.name, line: pick.line.element, slide })
  return true
}

function place(sim: Sim, t: Thing, line: GrindLine) {
  const g = t.grind!
  const { pos, tan } = lineAt(line, g.s)
  const r = sim.data.physics.skater.radius
  t.pos = v3(pos.x, pos.y, pos.z + r)
  t.vel = add(scale(tan, g.speed), lineVel(sim, g))
}

/** One grind tick: move along the line, balance, switch, leave. */
export function stepGrind(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[], pop: (sim: Sim, t: Thing, events: SimEvent[]) => void) {
  const P = sim.data.physics, G = P.grind
  const dt = 1 / P.tickHz
  const g = t.grind!
  const line = lineOf(sim, g)
  const tick = sim.world.tick
  if (!line) {
    // The car went away under the grind (respawned out of the bubble): drop into the air.
    endEntry(sim, t, 'end', events)
    t.grind = null
    t.state = State.air
    t.stateTicks = 0
    t.popped = true
    return
  }
  g.ticks++
  t.stateTicks++

  // Switch grinds: I + direction again, into a different grind, after grind.switchTicks on this one
  // (the same one again is no switch: tapping I on a rail must not stack entries).
  const tapped = has(input, Btn.grind) && (t.prevB & Btn.grind) === 0
  // Mashing I through the lock-on (a train of presses a few ticks apart, which players and the Tour's
  // scripts do) is not a switch: only a press after grind.switchTicks without one switches. The train's
  // presses kept switching (50-50, its double-tap variant, back to a 50-50, the variant again), each
  // switch an entry that made the balance touchier: a decent player fell off the 80 m Hyde slot 10 times
  // in 12 (feel pass round 4).
  const train = tapped && tick - (g.lastTap ?? -1e9) < sim.data.physics.grind.switchTicks
  if (tapped) g.lastTap = tick
  // The double tap's second press just after locking on: the variant of this grind (Feeble into Salad,
  // Crooked into Willy), as if it had locked on in it: no entry for the first, nothing else changes.
  if (tapped && g.ticks <= sim.data.tricks.doubleTapTicks && !g.tapped) {
    const was = { id: g.id, name: g.name, fwd: t.fwd }
    choose(sim, t, line, input, 2)
    const def = (g.slide ? sim.data.tricks.slides : sim.data.tricks.grinds).find((x) => x.id === g.id)
    if (def?.taps === 2) { g.tapped = true; g.prev = was.id; events.push({ t: 'grindStart', tick, trick: g.name, line: line.element, slide: g.slide }) }
    else { g.id = was.id; g.name = was.name; t.fwd = was.fwd }
  } else if (tapped && !train && g.ticks >= sim.data.physics.grind.switchTicks) {
    const was = { id: g.id, name: g.name, fwd: t.fwd }
    choose(sim, t, line, input)
    if (g.id === was.id) { g.name = was.name; t.fwd = was.fwd }
    else {
      const now = { id: g.id, name: g.name }
      g.id = was.id; g.name = was.name
      endEntry(sim, t, 'switch', events)
      g.id = now.id; g.name = now.name
      g.ticks = 0; delete g.tapped; g.prev = was.id
      events.push({ t: 'grindStart', tick, trick: g.name, line: line.element, slide: g.slide })
    }
  }

  // Ollie off: crouch charges while grinding, release pops. Released before grind.voidTicks, the pop
  // waits until then: a grind that never happened gives no pop (caught and popped at once, a flip, caught
  // again, on the spot at a ledge's end, was a combo that never landed: sf-ledge-hop-farm).
  const released = (t.prevB & Btn.ollie) !== 0 && !has(input, Btn.ollie)
  if (has(input, Btn.ollie)) t.charge = min(t.charge + 1, P.ollie.chargeTicks)
  if (released && g.ticks < G.voidTicks) g.popLate = true
  else if (released || (g.popLate && g.ticks >= G.voidTicks)) {
    leave(sim, t, line, 'ollie', events)
    t.state = State.air // pop() treats air as a late ollie: keeps along-line speed, adds the pop
    t.popped = false
    t.stateTicks = 0
    pop(sim, t, events)
    return
  }

  // Along the line: gravity along the slope, friction.
  const { tan } = lineAt(line, g.s)
  const a = -P.gravity * tan.z - (G.friction + dragK(P, false) * g.speed * g.speed) * (g.speed >= 0 ? 1 : -1)   // slope, friction, air drag
  const before = g.speed
  g.speed += a * dt
  if (before * g.speed < 0 || abs(g.speed) < G.stallSpeed) return leave(sim, t, line, 'stall', events, 0)
  g.s += g.speed * dt
  if (g.s <= 0 || g.s >= line.length) return leave(sim, t, line, 'end', events, G.exitPop)

  // Balance: unstable, pushed by the world RNG, corrected by A/D.
  const st = stick(input)
  // THPS: the longer the grind, the harder it is to balance (balanceRamp per second), and the more
  // grinds already in the combo (comboRamp each; they also start it further over, comboTilt each).
  const ramp = 1 + G.comboRamp * comboLinks(sim, t, 'grind') + (G.balanceRamp * g.ticks) / P.tickHz
  const noise = (nextFloat(sim.world.rng) * 2 - 1) * G.balanceNoise * ramp
  g.balanceVel += (G.balanceInstability * ramp * g.balance + noise + G.balanceControl * st.x - G.balanceDamping * g.balanceVel) * dt
  g.balance += g.balanceVel * dt
  if (abs(g.balance) >= 1) {
    const name = g.name
    t.grind = null
    t.state = State.bail
    t.stateTicks = 0
    events.push({ t: 'grindEnd', tick, trick: name, reason: 'balance', points: 0 })
    events.push({ t: 'comboLost', tick, name: [...t.combo.map((c) => c.name), name].join(' + ') })
    events.push({ t: 'bail', tick, reason: `lost balance on the ${name}` })
    t.combo = []
    // Fall off the side the balance went: the bail happens beside the ledge, not on it.
    const th = norm(v3(tan.x, tan.y, 0), tan)
    const r = P.skater.radius
    const { pos } = lineAt(line, g.s)
    // The side the balance went, unless that is solid (a platform top): then the other side.
    let side = g.balance > 0 ? -1 : 1
    const at = (k: number) => v3(pos.x - th.y * k * (r + 0.3), pos.y + th.x * k * (r + 0.3), pos.z + r + 0.05)
    // A side is usable if it is clear and has ground under it (not over the fence).
    const usable = (k: number) => !blocked(sim, at(k)) && raycast(sim.park, at(k), v3(0, 0, -1), 6) !== null
    if (!usable(side)) side = -side
    const out = scale(v3(-th.y, th.x, 0), side)
    const mv = lineVel(sim, g)
    t.pos = at(side)
    t.vel = v3(tan.x * g.speed * 0.5 + out.x * 1.5 + mv.x, tan.y * g.speed * 0.5 + out.y * 1.5 + mv.y, 0)
    moveSphere(sim.park, t.pos, t.vel, 0, r, P.collision, [])
    return
  }
  place(sim, t, line)
  if (blocked(sim, t.pos)) {
    // Ran into something on the line (a column, a wall, another piece): fall.
    const name = g.name
    t.grind = null
    t.state = State.bail
    t.stateTicks = 0
    events.push({ t: 'grindEnd', tick, trick: name, reason: 'blocked', points: 0 })
    events.push({ t: 'comboLost', tick, name: [...t.combo.map((c) => c.name), name].join(' + ') })
    events.push({ t: 'bail', tick, reason: `ran into something on the ${name}` })
    t.combo = []
    t.pos = v3(t.pos.x - tan.x * g.speed * dt * 2, t.pos.y - tan.y * g.speed * dt * 2, t.pos.z)
    t.vel = v3()
  }
}

function endEntry(sim: Sim, t: Thing, reason: string, events: SimEvent[]) {
  const g = t.grind!
  const T = sim.data.tricks
  const def = (g.slide ? T.slides : T.grinds).find((x) => x.id === g.id)!
  const points = stancePoints(sim, g.stance, Math.round(def.points + (def.pointsPerSecond * g.ticks) / sim.data.physics.tickHz))
  t.combo.push({ id: def.id, name: g.name, points })
  events.push({ t: 'grindEnd', tick: sim.world.tick, trick: g.name, reason, points })
}

function leave(sim: Sim, t: Thing, line: GrindLine, reason: string, events: SimEvent[], up = 0) {
  const g = t.grind!
  // A grind left before it has run grind.voidTicks never really happened: no entry, no gap (tapping
  // I on a ledge at a standstill, or at a line's end, which catches it again, must not score).
  if (g.ticks < sim.data.physics.grind.voidTicks) events.push({ t: 'grindEnd', tick: sim.world.tick, trick: g.name, reason: 'void', points: 0 })
  else endEntry(sim, t, reason, events)
  const { tan, pos } = lineAt(line, g.s)
  const r = sim.data.physics.skater.radius
  t.vel = add(v3(tan.x * g.speed, tan.y * g.speed, tan.z * g.speed + up), lineVel(sim, g))
  t.pos = v3(pos.x, pos.y, pos.z + r + 0.02)
  // Out of anything the line runs into at this point (a parked car's hood edge ends at its cabin: left
  // there, the skater was 4.5 cm inside the cabin corner; city sweep car-cabin-corner).
  moveSphere(sim.park, t.pos, t.vel, 0, r, sim.data.physics.collision, [])
  // Leaving a slide the skater turns back in line with travel (forward or fakie, whichever is nearer).
  if (g.slide) {
    const th = norm(v3(tan.x, tan.y, 0), tan)
    const way = dot(t.fwd, th) >= 0 ? 1 : -1
    // How far that turns the rider (the view eases it out: the sim's heading is final at once).
    const was = t.fwd, now = scale(th, way)
    const turn = atan2(was.x * now.y - was.y * now.x, was.x * now.x + was.y * now.y)
    t.fwd = now
    if (abs(turn) > 0.01) t.slideTurn = Math.round(turn * 1000) / 1000
  }
  t.offZ = pos.z
  t.left = { id: g.id, slide: g.slide, fs: g.fs, ...(g.stance ? { stance: g.stance } : {}) }
  t.grind = null
  t.state = State.air
  t.stateTicks = 0
  // Rolling off an end still allows a late ollie, but not off a void grind (it never happened: the
  // skater is still in the air they caught it from).
  t.popped = reason === 'ollie' || g.ticks < sim.data.physics.grind.voidTicks
  t.takeoffN = Z
  t.airPeakZ = t.pos.z
}
