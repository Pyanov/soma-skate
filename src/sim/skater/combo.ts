import { Btn, has, stick, type InputFrame } from '../input.ts'
import { abs, acos, clamp, DEG, dot, flatten, len, madd, max, norm, scale, v3, type Vec3 } from '../math.ts'
import { lineAt, type GrindLine } from '../park/grindlines.ts'
import { sphereContacts, Surface, type Contact } from '../park/park.ts'
import { nextFloat } from '../rng.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { State, type Thing } from '../thing.ts'
import { bankCombo, comboLinks, dir8 } from '../tricks/tricks.ts'
import { moveSphere } from './move.ts'

// Combo glue: manuals, reverts, lip tricks, wallrides, wallplants.
// Spec: docs/mechanics/combos.md.

const near: Contact[] = []

/** Remember direction presses (edges only) for manuals and specials. */
export function trackDirs(t: Thing, f: InputFrame, tick: number) {
  for (const [b, d] of [[Btn.up, 'up'], [Btn.down, 'down'], [Btn.left, 'left'], [Btn.right, 'right']] as const) {
    if (has(f, b) && (t.prevB & b) === 0) t.dirHist.push({ d, tick })
  }
  while (t.dirHist.length > 4) t.dirHist.shift()
}

/** Up then Down quickly = manual, Down then Up = nose manual (the second press recent). */
export function manualInput(sim: Sim, t: Thing): 'manual' | 'nosemanual' | null {
  if (t.dirHist.length < 2) return null
  const [a, b] = t.dirHist.slice(-2)
  const w = sim.data.physics.combo.manualWindow
  if (b.tick - a.tick > w || sim.world.tick - b.tick > w) return null
  if (a.d === 'up' && b.d === 'down') return 'manual'
  if (a.d === 'down' && b.d === 'up') return 'nosemanual'
  return null
}

export function startManual(sim: Sim, t: Thing, id: string, events: SimEvent[]) {
  const def = sim.data.tricks.manuals.find((x) => x.id === id)!
  const C = sim.data.physics.combo
  const side = nextFloat(sim.world.rng) < 0.5 ? -1 : 1
  t.manual = { id: def.id, name: def.name, ticks: 0, balance: side * (C.manualStart + C.manualComboTilt * comboLinks(sim, t, 'manual')), balanceVel: 0 }
  t.landGrace = 0
  t.dirHist = []
  events.push({ t: 'manualStart', tick: sim.world.tick, trick: def.name })
}

export function endManual(sim: Sim, t: Thing, reason: string, events: SimEvent[]) {
  const m = t.manual!
  const def = sim.data.tricks.manuals.find((x) => x.id === m.id)!
  const points = Math.round(def.points + (def.pointsPerSecond * m.ticks) / sim.data.physics.tickHz)
  t.combo.push({ id: def.id, name: def.name, points })
  t.manual = null
  events.push({ t: 'manualEnd', tick: sim.world.tick, trick: def.name, reason, points })
}

/** Manual balance: W/S correct the pitch. Returns false if the skater fell (caller bails). */
export function stepManual(sim: Sim, t: Thing, f: InputFrame, events: SimEvent[]): boolean {
  const C = sim.data.physics.combo
  const dt = 1 / sim.data.physics.tickHz
  const m = t.manual!
  m.ticks++
  const ramp = 1 + C.manualComboRamp * comboLinks(sim, t, 'manual') + (C.manualRamp * m.ticks) / sim.data.physics.tickHz   // longer manuals get harder (as in the classic games), and more of them in one combo
  const noise = (nextFloat(sim.world.rng) * 2 - 1) * C.manualNoise * ramp
  m.balanceVel += (C.manualInstability * ramp * m.balance + noise + C.manualControl * stick(f).y - C.manualDamping * m.balanceVel) * dt
  m.balance += m.balanceVel * dt
  if (abs(m.balance) >= 1) return false
  if (len(t.vel) < C.manualMinSpeed) { endManual(sim, t, 'stopped', events); bankCombo(sim, t, events) }
  return true
}

/**
 * Revert: on landing on a transition, keeps the combo open for a manual. One per landing. Pressed within
 * the landing grace, or in the air up to combo.revertBufferTicks before touching down (Thing.revertWant).
 * With nothing in the combo (a plain air) it starts one, in as long after the landing as the grace.
 */
export function tryRevert(sim: Sim, t: Thing, f: InputFrame, events: SimEvent[]) {
  const want = (has(f, Btn.revert) && (t.prevB & Btn.revert) === 0) || ((t.revertWant ?? 0) > 0 && t.lastLand.tick === sim.world.tick)
  delete t.revertWant   // a buffered press is for the landing tick only
  if (!want || !t.landSteep) return
  const C = sim.data.physics.combo
  if (t.landGrace <= 0 && !(t.combo.length === 0 && t.stateTicks < C.graceTicks && t.lastLand.quality !== 'stumble')) return
  const pts = sim.data.scoring.revertPoints
  t.combo.push({ id: 'revert', name: 'Revert', points: pts })
  t.landGrace = C.graceTicks
  t.landSteep = false   // the next revert needs another landing (tapping it again was an endless combo)
  t.fwd = scale(t.fwd, -1)   // a revert spins the board around: fakie becomes forward
  events.push({ t: 'revert', tick: sim.world.tick, points: pts })
}

export const steepDeg = (n: Vec3) => acos(clamp(n.z, -1, 1)) / DEG

// ---- lip tricks ----

export function startLip(sim: Sim, t: Thing, line: GrindLine, s: number, f: InputFrame, events: SimEvent[]) {
  const T = sim.data.tricks
  const def = T.lips.find((x) => x.dir === dir8(f)) ?? T.lips[0]
  const side = nextFloat(sim.world.rng) < 0.5 ? -1 : 1
  t.lastLine = line.id
  t.lip = { id: def.id, name: def.name, ticks: 0, balance: side * (sim.data.physics.grind.balanceStart + sim.data.physics.grind.comboTilt * comboLinks(sim, t, 'lip')), balanceVel: 0, line: line.id, s }
  t.state = State.lip
  t.stateTicks = 0
  t.grindPress = 0
  const { pos } = lineAt(line, s)
  t.pos = v3(pos.x, pos.y, pos.z + sim.data.physics.skater.radius)
  t.vel = v3()
  events.push({ t: 'lipStart', tick: sim.world.tick, trick: def.name })
}

/** Stall on the coping while I is held; release drops back in fakie. */
export function stepLip(sim: Sim, t: Thing, f: InputFrame, events: SimEvent[]) {
  const G = sim.data.physics.grind
  const dt = 1 / sim.data.physics.tickHz
  const l = t.lip!
  l.ticks++
  t.stateTicks++
  const ramp = 1 + G.comboRamp * comboLinks(sim, t, 'lip') + (G.balanceRamp * l.ticks) / sim.data.physics.tickHz
  const noise = (nextFloat(sim.world.rng) * 2 - 1) * G.balanceNoise * ramp
  l.balanceVel += (G.balanceInstability * ramp * l.balance + noise + G.balanceControl * stick(f).x - G.balanceDamping * l.balanceVel) * dt
  l.balance += l.balanceVel * dt
  const def = sim.data.tricks.lips.find((x) => x.id === l.id)!
  const points = Math.round(def.points + (def.pointsPerSecond * l.ticks) / sim.data.physics.tickHz)
  if (abs(l.balance) >= 1) {
    t.lip = null
    events.push({ t: 'lipEnd', tick: sim.world.tick, trick: def.name, reason: 'balance', points: 0 })
    t.state = State.bail
    t.stateTicks = 0
    events.push({ t: 'comboLost', tick: sim.world.tick, name: [...t.combo.map((c) => c.name), def.name].join(' + ') })
    events.push({ t: 'bail', tick: sim.world.tick, reason: `lost balance on the ${def.name}` })
    t.combo = []
    t.special = 0
    t.pos = madd(t.pos, norm(v3(t.takeoffN.x, t.takeoffN.y, 0)), 0.4)
    return
  }
  if (has(f, Btn.grind)) return
  // Drop back in: over the ramp, falling, board still facing the wall so it lands fakie.
  t.combo.push({ id: def.id, name: def.name, points })
  t.lip = null
  t.lipped = true   // one lip trick per air: tapping I again at the coping stalled it again and again
  events.push({ t: 'lipEnd', tick: sim.world.tick, trick: def.name, reason: 'drop in', points })
  const nh = norm(v3(t.takeoffN.x, t.takeoffN.y, 0))
  t.pos = madd(t.pos, nh, 0.15)
  t.vel = v3(nh.x * 0.8, nh.y * 0.8, -0.5)
  t.state = State.air
  t.stateTicks = 0
  t.vertAir = true
  t.up = { ...t.takeoffN }
  t.popped = true
  // Turned round on the coping (Disaster, Rock and Roll, Tail Stall): it drops back in forward.
  if (def.out === 'forward') t.fwd = v3(-t.fwd.x, -t.fwd.y, -t.fwd.z)
}

// ---- walls ----

const isWall = (cls: number) => cls === Surface.wall || cls === Surface.vert || cls === Surface.steep

/** Nearest wall within reach: its horizontal normal and distance. */
function wallNear(sim: Sim, t: Thing): { n: Vec3; d: number } | null {
  const C = sim.data.physics.combo, r = sim.data.physics.skater.radius
  sphereContacts(sim.park, t.pos, r + C.wallReach, near)
  for (const c of near) {
    if (!isWall(sim.park.cls[c.tri])) continue
    const n = v3(t.pos.x - c.px, t.pos.y - c.py, 0)
    const l = len(n)
    if (l < 1e-6) continue
    const nz = (t.pos.z - c.pz) / Math.max(c.dist, 1e-9)
    if (abs(nz) > 0.35) continue
    return { n: scale(n, 1 / l), d: c.dist }
  }
  return null
}

/** I in the air beside a wall you are travelling along: wallride. */
export function tryWallride(sim: Sim, t: Thing, events: SimEvent[]): boolean {
  if (t.trick || (t.wallrides ?? 0) >= sim.data.physics.combo.wallridesPerAir) return false
  const w = wallNear(sim, t)
  if (!w) return false
  const along = flatten(v3(t.vel.x, t.vel.y, 0), w.n)
  if (len(along) < sim.data.physics.combo.wallrideMinSpeed || abs(dot(norm(v3(t.vel.x, t.vel.y, 0)), w.n)) > 0.6) return false
  t.wall = { n: w.n, ticks: 0 }
  t.wallrides = (t.wallrides ?? 0) + 1
  t.state = State.wall
  t.stateTicks = 0
  t.grindPress = 0
  // The wheels on the wall carry little of the jump's upward speed: a wallride is an arc along the
  // wall, not a launch up it. Caught on the way down it keeps falling (slower): a wall never lifts
  // you (it used to give at least 0.5 m/s up, and catching it again and again climbed it).
  t.vel = v3(along.x, along.y, Math.min(t.vel.z, sim.data.physics.combo.wallrideMaxUp))
  events.push({ t: 'wallrideStart', tick: sim.world.tick })
  return true
}

export function stepWall(sim: Sim, t: Thing, f: InputFrame, events: SimEvent[], pop: (sim: Sim, t: Thing, events: SimEvent[]) => void) {
  const P = sim.data.physics, C = P.combo
  const dt = 1 / P.tickHz
  const w = t.wall!
  w.ticks++
  t.stateTicks++
  const leave = (reason: string) => {
    const pts = Math.round(sim.data.scoring.wallridePoints + (sim.data.scoring.wallridePointsPerSecond * w.ticks) / P.tickHz)
    t.combo.push({ id: 'wallride', name: 'Wallride', points: pts })
    events.push({ t: 'wallrideEnd', tick: sim.world.tick, reason, points: pts })
    t.wall = null
    t.state = State.air
    t.stateTicks = 0
    t.popped = false
  }
  if ((t.prevB & Btn.ollie) !== 0 && !has(f, Btn.ollie)) {
    leave('ollie')
    t.vel = madd(t.vel, w.n, 2)
    pop(sim, t, events)
    return
  }
  t.vel = madd(t.vel, v3(0, 0, -P.gravity * C.wallrideGravity), dt)
  const into = dot(t.vel, w.n)
  if (into < 0) t.vel = madd(t.vel, w.n, -into)
  t.vel = madd(t.vel, w.n, -0.3)   // lean into the wall to keep contact
  const touches: { n: Vec3; cls: number; tri: number; depth: number }[] = []
  moveSphere(sim.park, t.pos, t.vel, dt, P.skater.radius, P.collision, touches)
  t.up = norm(v3(w.n.x, w.n.y, 0.6))
  t.fwd = norm(flatten(v3(t.vel.x, t.vel.y, 0), w.n), t.fwd)
  if (w.ticks >= C.wallrideTicks || !wallNear(sim, t)) leave(w.ticks >= C.wallrideTicks ? 'timeout' : 'wall ended')
}

/** K tapped in the air with a wall ahead: plant and push off. */
export function tryWallplant(sim: Sim, t: Thing, f: InputFrame, events: SimEvent[]): boolean {
  if (t.wallplanted || !has(f, Btn.ollie) || (t.prevB & Btn.ollie) !== 0) return false
  const w = wallNear(sim, t)
  if (!w) return false
  const h = v3(t.vel.x, t.vel.y, 0)
  if (dot(h, w.n) > -1) return false   // must be moving into the wall
  const C = sim.data.physics.combo
  const inN = dot(h, w.n)
  const reflected = madd(h, w.n, -2 * inN)
  t.vel = v3(reflected.x * C.wallplantKeep, reflected.y * C.wallplantKeep, max(t.vel.z, 0) + C.wallplantPop)
  t.fwd = scale(t.fwd, -1)
  t.wallplanted = true
  const pts = sim.data.scoring.wallplantPoints
  t.combo.push({ id: 'wallplant', name: 'Wallplant', points: pts })
  events.push({ t: 'wallplant', tick: sim.world.tick, points: pts })
  return true
}
