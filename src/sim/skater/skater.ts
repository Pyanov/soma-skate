import { acos, angleBetween, clamp, copy, cos, DEG, dot, flatten, len, lerp, madd, max, norm, rotateAround, scale, signedAngle, sub, v3, abs, type Vec3 } from '../math.ts'
import { Btn, has, stick, type InputFrame } from '../input.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { State, type Thing } from '../thing.ts'
import { moveSphere, probeGround, rideable, type Touch } from './move.ts'
import { raycast, sphereContacts, Surface, type Contact } from '../park/park.ts'
import { addSpin, bankCombo, loseCombo, stepAirTricks, trickDef } from '../tricks/tricks.ts'
import { endManual, manualInput, startManual, stepLip, stepManual, stepWall, steepDeg, trackDirs, tryRevert, tryWallplant, tryWallride } from './combo.ts'
import { stepGrind, tryCapture } from './grind.ts'
import { dragK, endPowerslide, stepBoard } from './board.ts'
import { stepOff, stepWalk } from './walk.ts'
import { rideCar } from './cars.ts'
import { endSkitch, stepSkitch, tryStartSkitch } from './skitch.ts'
import { stepSpine } from './spine.ts'

// The skater: ground, air and bail states. Spec: docs/mechanics/rolling.md.

const Z = v3(0, 0, 1)
const touches: Touch[] = []
const near: Contact[] = []

const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => v3(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t))

export function stepSkater(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]) {
  const P = sim.data.physics, G = P.ground
  const dt = 1 / P.tickHz, r = P.skater.radius
  const tick = sim.world.tick
  const g = v3(0, 0, -P.gravity)

  if (t.bump !== undefined && --t.bump <= 0) delete t.bump   // the curb roll-up's front lift, for the view
  if (t.state === State.bail) { stepBail(sim, t, input, events); t.prevB = input.b; return }
  if (t.state === State.walk) { stepWalk(sim, t, input, events); t.prevB = input.b; return }
  trackDirs(t, input, tick)
  if (t.state === State.lip) { stepLip(sim, t, input, events); t.prevB = input.b; return }
  if (t.state === State.wall) { stepWall(sim, t, input, events, pop); t.prevB = input.b; return }
  // A grind press is remembered for a few ticks, so pressing just before the rail works.
  if (has(input, Btn.grind) && (t.prevB & Btn.grind) === 0) {
    if (t.grindPress > 0) t.grindTaps = 2   // pressed again while the first press is buffered: a double tap (grinds.md)
    else delete t.grindTaps
    t.grindPress = P.grind.bufferTicks
  } else if (t.grindPress > 0 && --t.grindPress === 0) delete t.grindTaps
  if (t.state === State.grind) { stepGrind(sim, t, input, events, pop); t.prevB = input.b; return }
  // A buffered grind press catches a line for grind.bufferTicks; a wall only within combo.wallPressTicks
  // of the press (the press for a grind beside a wall should not start a wallride on it).
  if (t.state === State.air && t.grindPress > 0 && (tryCapture(sim, t, input, events) || (P.grind.bufferTicks - t.grindPress < P.combo.wallPressTicks && tryWallride(sim, t, events)))) { t.prevB = input.b; return }
  if (t.state === State.air) {
    tryWallplant(sim, t, input, events)
    // A revert pressed on the way down counts on touching down on a transition (combo.revertBufferTicks):
    // a player presses it as the wheels meet the ramp, often a little before.
    if (has(input, Btn.revert) && (t.prevB & Btn.revert) === 0) t.revertWant = P.combo.revertBufferTicks
    else if (t.revertWant !== undefined && --t.revertWant <= 0) delete t.revertWant
  }
  stepSpine(sim, t, input, events)
  if (t.spine) delete t.revertWant   // the press carried the skater over a spine

  const st = stick(input)
  // Ollie: hold to crouch and charge, release to pop. A release just after rolling
  // off an edge still pops (late ollie).
  const released = (t.prevB & Btn.ollie) !== 0 && !has(input, Btn.ollie)
  if (t.state === State.ground) {
    t.crouch = has(input, Btn.ollie)
    if (t.crouch) t.charge = Math.min(t.charge + 1, P.ollie.chargeTicks)
    if (released) pop(sim, t, events)
  } else if (released && !t.popped && t.stateTicks <= P.ollie.lateTicks) pop(sim, t, events)
  const wasGround = t.state === State.ground
  // Skitching: towed behind a car (skitch.ts).
  if (wasGround && (t.skitch || tryStartSkitch(sim, t, input, events)) && stepSkitch(sim, t, input, events)) { t.stateTicks++; t.prevB = input.b; return }
  // E on the board: step off and carry it (docs/mechanics/walk.md).
  if (wasGround && t.carRide < 0 && has(input, Btn.walk) && (t.prevB & Btn.walk) === 0) {
    const thrown = stepOff(sim, t, events)
    if (thrown) { loseCombo(sim, t, events); startBail(t, thrown, tick, events) }
    t.prevB = input.b
    return
  }

  // On a car's roof or hood: the car carries the ground (cars.ts).
  if (wasGround && t.carRide >= 0 && rideCar(sim, t, input, events)) { t.stateTicks++; t.prevB = input.b; return }
  if (wasGround) {
    // Steering, grip, slopes, drag, braking, powerslides, wobble: board.ts.
    const thrown = stepBoard(sim, t, input, events)
    if (thrown) { loseCombo(sim, t, events); startBail(t, thrown, tick, events); t.stateTicks++; t.prevB = input.b; return }
  } else {
    t.vel = madd(t.vel, g, dt)
    const sp = len(t.vel)
    if (sp > 0) t.vel = scale(t.vel, max(0, sp - dragK(P, false) * sp * sp * dt) / sp)
    // Vert air keeps the wall as the board's up so it comes back down onto the ramp;
    // other air eases the board toward level.
    if (!t.vertAir) t.up = norm(lerp3(t.up, Z, 0.08))
    const spin = stepAirTricks(sim, t, input, events)
    if (spin !== 0) t.fwd = rotateAround(t.fwd, t.up, spin)
    t.fwd = norm(flatten(t.fwd, t.up), t.fwd)
  }
  const sp = len(t.vel)
  if (sp > P.limits.maxSpeed) t.vel = scale(t.vel, P.limits.maxSpeed / sp)

  const before = copy(t.vel)
  moveSphere(sim.park, t.pos, t.vel, dt, r, P.collision, touches, wasGround ? t.up : undefined, cos(G.maxSnapAngleDeg * DEG))
  if (wasGround && t.state === State.ground && t.powerslide === 0) curbHop(sim, t, before, events)
  else if (!wasGround && t.state === State.air) ledgePop(sim, t, before, events)

  const support = wasGround ? groundSupport(sim, t, dt) : landingSupport(sim, t, before, P)

  if (support && !wasGround) {
    if (!touchDown(sim, t, before, support, events)) { t.stateTicks++; t.prevB = input.b; return }
  } else if (support) {
    // Over curvature keep speed.
    const speed = len(t.vel)
    const vt = flatten(t.vel, support)
    const l = len(vt)
    t.vel = l > 1e-9 ? scale(vt, speed / l) : vt
    const upBefore = t.up
    t.up = norm(lerp3(t.up, support, 0.5))
    t.fwd = norm(flatten(t.fwd, t.up), t.fwd)
    // Normal load: gravity's share into the surface plus the centripetal part, from how far the
    // surface normal turned under the velocity this tick (+ in a concave transition, - over a
    // crest). The smoothed up lags the raw contact normal, but turns at the same rate.
    const centripetal = -dot(before, sub(t.up, upBefore)) / dt
    t.load = lerp(t.load, max(0, P.gravity * t.up.z + centripetal) / P.gravity, P.board.loadSmoothing)
  } else if (wasGround) {
    endPowerslide(sim, t, events)   // rolling off an edge mid-slide: it counts, the combo carries on
    takeoff(t, P, launchWall ?? faceUnder(sim, t), launchCoping)
    events.push({ t: 'air', tick, speed: round(len(t.vel)), z: round(t.pos.z), vert: t.vertAir })
  }
  if (t.state === State.ground) groundCombo(sim, t, input, events)
  if (t.state === State.ground && t.up.z > G.safeNormalZ) t.safe = copy(t.pos)
  if (t.state === State.air) t.airPeakZ = max(t.airPeakZ, t.pos.z)
  // Wedged: resting against something it cannot land on (a slot between a fence and a wall) for
  // half a second. Put the skater back where it last stood on solid ground rather than leave it
  // hanging there.
  // The same on the ground on a slope steeper than safe ground (ground.safeNormalZ, about 37 degrees:
  // a steep lot sloping into a building's corner): stopped there for half a second, it is wedged, not
  // riding (gravity never lets a skater stop that long on a slope that steep; stalls are lip tricks).
  if (t.state === State.ground && t.up.z <= G.safeNormalZ && len(t.vel) < 0.1) t.wedged = (t.wedged ?? 0) + 1
  else delete t.wedged
  if (((t.state === State.air && t.stateTicks > 60 && touches.length > 0) || (t.wedged ?? 0) > 60) && len(t.vel) < 0.1 && len(t.safe) > 0) {
    t.pos = copy(t.safe)
    t.vel = v3()
    t.stateTicks = 0
    if (t.wedged) { t.up = copy(Z); t.fwd = norm(v3(t.fwd.x, t.fwd.y, 0), v3(0, 1, 0)) }   // stood up on the safe spot, not still tilted to the slope
    delete t.wedged
    events.push({ t: 'unstuck', tick })
  }
  t.stateTicks++
  t.prevB = input.b
}

/** On the ground: manual balance, starting manuals, reverts, and banking when the grace runs out. */
export function groundCombo(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]) {
  if (t.manual) {
    if (!stepManual(sim, t, input, events)) {
      const name = t.manual.name
      loseCombo(sim, t, events)
      startBail(t, `lost balance on the ${name}`, sim.world.tick, events)
    }
    return
  }
  // A revert first (pressed on the landing or just before it), so a manual pressed with it still links:
  // Revert + Manual.
  tryRevert(sim, t, input, events)
  const m = manualInput(sim, t)
  // Not from walking pace (combo.manualStartSpeed): a manual that stops at once and banks, again and again, paid every few ticks.
  if (m && len(t.vel) >= sim.data.physics.combo.manualStartSpeed) { startManual(sim, t, m, events); return }
  if (t.landGrace > 0 && --t.landGrace === 0) bankCombo(sim, t, events)
}

/**
 * Ground: every rideable surface within snap distance whose normal is near the current one,
 * depth-weighted into one normal (creases come out smooth). Over convex shapes (ledge edges,
 * crests, lips) the skater stays on only while gravity can hold the turn: v^2 * curvature
 * <= g * n.z, with curvature = normal change per metre. Faster than that, it launches.
 */
/** Debug hook for the harness (no effect on the sim): receives each ground decision. */
export const debug: { ground: ((why: string, data: Record<string, number>) => void) | null } = { ground: null }

const pipe: Contact[] = []
/** The wall the last ground tick left as vert air from (its support normal), for takeoff's vert test; else null. */
let launchWall: Vec3 | null = null
/** The last ground tick left from a coping (vert air whatever the wall's angle). */
let launchCoping = false

/** The face the wheels were last on (ground support's nearest rideable triangle): its normal. */
export function faceUnder(sim: Sim, t: Thing): Vec3 | undefined {
  const i = t.groundTri
  return i >= 0 && i < sim.park.triCount ? v3(sim.park.tn[i * 3], sim.park.tn[i * 3 + 1], sim.park.tn[i * 3 + 2]) : undefined
}

function groundSupport(sim: Sim, t: Thing, dt: number): Vec3 | null {
  launchWall = null
  launchCoping = false
  const P = sim.data.physics, G = P.ground, r = P.skater.radius
  const reach = r + G.snapDistance
  sphereContacts(sim.park, t.pos, reach, near)
  const maxCos = cos(G.maxSnapAngleDeg * DEG)
  let nearest = Infinity
  for (const c of near) {
    if (!rideable(sim.park.cls[c.tri])) continue
    const d = Math.max(c.dist, 1e-9)
    const n = v3((t.pos.x - c.px) / d, (t.pos.y - c.py) / d, (t.pos.z - c.pz) / d)
    // Near the current normal, or plain walkable ground (so a crease of two faces more than
    // the snap angle apart still counts both).
    if ((dot(n, t.up) >= maxCos || n.z >= G.groundMinNormalZ) && c.dist < nearest) nearest = c.dist
  }
  if (nearest === Infinity) { debug.ground?.('no surface in reach', { contacts: near.length }); return null }
  for (const c of near) if (c.dist === nearest && rideable(sim.park.cls[c.tri])) { t.groundTri = c.tri; break }
  // Support: the contacts at (about) the nearest distance, depth-weighted, so a crease where
  // two faces meet gives one smooth normal. A contact on a triangle's edge or corner only counts
  // when no contact in the band lies inside its face: next to a face under the wheels, the
  // neighbouring triangle of the same plane touches at the shared edge, up to 3 cm off, and its
  // direction leans up to 13 degrees (on a long straight hill that kinked the normal at every
  // triangle edge and threw the skater into hops). Rounding a convex edge (edge contacts only)
  // keeps the edge directions.
  const inFace = (c: Contact) => {
    const o = c.tri * 9, tn = sim.park.tn
    const plane = abs((t.pos.x - sim.park.tv[o]) * tn[c.tri * 3] + (t.pos.y - sim.park.tv[o + 1]) * tn[c.tri * 3 + 1] + (t.pos.z - sim.park.tv[o + 2]) * tn[c.tri * 3 + 2])
    return c.dist - plane < 1e-6
  }
  let faces = false
  for (const c of near) if (rideable(sim.park.cls[c.tri]) && c.dist <= nearest + 0.003 && inFace(c)) { faces = true; break }
  // Over a convex edge or ridge (edge contacts only) only the nearest point counts: triangles that
  // touch it at a vertex a millimetre further off lean along the slope (riding a street's crown
  // they kicked the skater up at every vertex).
  const band = faces ? 0.003 : 1e-6
  let sx = 0, sy = 0, sz = 0
  for (const c of near) {
    if (!rideable(sim.park.cls[c.tri]) || c.dist > nearest + band) continue
    if (faces && !inFace(c)) continue
    const d = Math.max(c.dist, 1e-9)
    const n = v3((t.pos.x - c.px) / d, (t.pos.y - c.py) / d, (t.pos.z - c.pz) / d)
    if (dot(n, t.up) < maxCos && n.z < G.groundMinNormalZ) continue
    const w = nearest + band - c.dist + 0.001
    sx += n.x * w; sy += n.y * w; sz += n.z * w
  }
  const n = norm(v3(sx, sy, sz))
  // The wheels left the surface by `gap` this tick. Up to stickGap (seams, gentle crests), or
  // what gravity closes in a tick, they snap back. More means the surface fell away faster than
  // we can follow (ledge edge, crest at speed, lip): launch. For a corner that is v^2 > g r cos.
  const gap = nearest - r
  const hold = 0.5 * P.gravity * dt * dt
  // Going up a transition (the board tilted more than ground.transitionDeg, or the surface under the
  // wheels turning up into the path: its normal faces the velocity less than the board's up does), only a
  // real edge launches: up to ground.transitionStickGap the gap is the facets' seams and snaps back. A
  // few millimetres over stickGap (quads split into triangles a few degrees apart) launched a quarter's
  // rider anywhere up its face, even at its foot (phase 27, skate feel --section vert); an edge opens
  // centimetres in a tick, and a crest turns the other way.
  const turningUp = dot(sub(n, t.up), t.vel) < -0.01 * len(t.vel)
  const climbing = t.vel.z > 0.3 && (t.up.z < cos(G.transitionDeg * DEG) || turningUp)
  const stick = Math.max(climbing ? G.transitionStickGap : G.stickGap, hold * 1.5)
  if (gap > stick) { debug.ground?.('surface fell away', { gap, speed: len(t.vel) }); return null }
  // Riding up a transition (the board and the face both steeper than vert.copingMinDeg) into the coping
  // pipe on its lip (rail-class
  // faces above the wheels, within this tick's travel and vert.copingReach beyond them): the next move would run into the
  // pipe, taking most of the air's speed and throwing the skater off the wall, or back down it (phase 27,
  // soma-coping-speed). As in the classic games, a lip with coping is vert: leave the wall now as vert air, the board
  // turned toward it as a ground tick would turn it, and out from the wall by as much as the pipe
  // overhangs the way up (a few centimetres), so the air going up clears it.
  if (Math.max(t.up.z, n.z) < cos(P.vert.copingMinDeg * DEG) && t.vel.z > 0.3) {
    sphereContacts(sim.park, t.pos, r + P.vert.copingReach + len(t.vel) * dt, pipe)
    let over = -1
    const hl = Math.hypot(n.x, n.y), ox = hl > 1e-6 ? n.x / hl : 0, oy = hl > 1e-6 ? n.y / hl : 0
    for (const c of pipe) {
      if (sim.park.cls[c.tri] !== Surface.rail || c.pz <= t.pos.z) continue
      const out = (t.pos.x - c.px) * ox + (t.pos.y - c.py) * oy   // how far out from the pipe the wheels are
      if (out > -0.02) over = max(over, Math.min(r * 1.05 - out, r))   // the pipe on the wall side, overhanging the way up
    }
    if (over > -1) {
      debug.ground?.('into the coping', { speed: len(t.vel), z: t.pos.z, over })
      if (over > 0) t.pos = v3(t.pos.x + ox * over, t.pos.y + oy * over, t.pos.z)
      t.up = norm(lerp3(t.up, n, 0.5))
      launchWall = n
      launchCoping = true
      return null
    }
  }
  // Riding up a vert wall past the height of the deck behind its coping: gravity cannot hold anyone
  // round that edge (it pulls along the wall, not into it), so leave the wall: vert air.
  if (t.up.z < cos(P.vert.minWallDeg * DEG) && t.vel.z > 0.3) {
    for (const c of near) {
      if (!rideable(sim.park.cls[c.tri]) || sim.park.tn[c.tri * 3 + 2] < G.groundMinNormalZ || c.pz > t.pos.z - 0.01) continue
      debug.ground?.('over the coping', { speed: len(t.vel), z: t.pos.z })
      launchWall = n
      return null
    }
  }
  if (gap > 0) {
    t.pos = madd(t.pos, n, -gap)
    moveSphere(sim.park, t.pos, t.vel, 0, r, P.collision, touches)
  }
  return n
}

const riser: Contact[] = []
type Hop = { reach: number; deg: number; minSpeed: number; depth: number; keep: number }
/**
 * Rolling into a low step (a city curb, 14-17 cm, taller than the wheels' sphere): the move stops the
 * skater dead against its face, from any speed, in one tick. A rider pops the front wheels up and rolls
 * on: when the face met is a riser no higher than ground.curbHop above the wheels, met within
 * ground.curbHopDeg of head-on at ground.curbHopMinSpeed or more, with flat rideable ground on top
 * that goes on for ground.curbHopDepth (so a stair's tread does not count: stairs are ollied) and
 * room above, the skater rides up onto it keeping ground.curbHopKeep of its speed. Event bump {height}.
 */
function curbHop(sim: Sim, t: Thing, before: Vec3, events: SimEvent[]) {
  const G = sim.data.physics.ground
  const h = riserHop(sim, t, before, { reach: G.curbHop, deg: G.curbHopDeg, minSpeed: G.curbHopMinSpeed, depth: G.curbHopDepth, keep: G.curbHopKeep })
  if (h === null) return
  t.bump = G.curbHopBumpTicks   // for the view: the front wheels lift over the kerb (counts down in stepSkater)
  events.push({ t: 'bump', tick: sim.world.tick, height: round(h) })
}

/**
 * The late ollie at a ledge (feel pass round 2): popped just before a ledge, the wheels meet its face
 * on the way up and the skater stopped dead in front of it (or caught its edge and bailed). Within
 * air.ledgePop.ticks of an ollie, not in vert air, moving at minSpeed or more within deg of head-on into
 * a face whose top is at most reach above the wheels and at most maxHeight above the ground below,
 * with depth of flat top and room, the skater is moved up past the top's edge with keep of its speed
 * and its ollie's arc carries on from there, as if it had popped a moment sooner: it lands on the top
 * (or past it), and the landing check decides the rest (a flip still turning bails, as on any
 * landing). Not with a grind pressed: that press is for the edge. Event bump {height, air}.
 */
function ledgePop(sim: Sim, t: Thing, before: Vec3, events: SimEvent[]) {
  const L = sim.data.physics.air.ledgePop, r = sim.data.physics.skater.radius
  // Not with a grind pressed (the press is for the ledge's edge), and only after an ollie.
  if (!t.popped || t.vertAir || t.stateTicks > L.ticks || t.grindPress > 0) return
  const floor = raycast(sim.park, t.pos, v3(0, 0, -1), L.maxHeight + 1)
  if (!floor) return
  const feet = t.pos.z - r
  const vz = t.vel.z
  const h = riserHop(sim, t, before, L, L.maxHeight - (feet - floor.point.z))
  if (h === null) return
  t.vel.z = vz   // the ollie's arc carries on from the top's edge (a grind pressed on the way up still catches it)
  events.push({ t: 'bump', tick: sim.world.tick, height: round(h), air: true })
}

/**
 * Up onto the top of the riser the move just stopped the skater against (curbHop, ledgePop): the
 * height risen, or null. cap: the most the top may be above the wheels besides o.reach (ledgePop: the
 * ledge's height over the ground below).
 */
function riserHop(sim: Sim, t: Thing, before: Vec3, o: Hop, cap = Infinity): number | null {
  const P = sim.data.physics, G = P.ground, r = P.skater.radius
  const bh = Math.hypot(before.x, before.y), ah = Math.hypot(t.vel.x, t.vel.y)
  if (bh < o.minSpeed || ah > bh * 0.7) return null   // not stopped against something
  const dir = v3(before.x / bh, before.y / bh, 0)
  // The riser: the touch most against the travel direction, its face near vertical.
  let face: Vec3 | null = null, most = -cos(o.deg * DEG)
  for (const k of touches) {
    if (abs(k.n.z) > 0.5) continue
    const hl = Math.hypot(k.n.x, k.n.y), into = (k.n.x * dir.x + k.n.y * dir.y) / hl
    if (into < most) { most = into; face = v3(-k.n.x / hl, -k.n.y / hl, 0) }
  }
  if (!face) return null
  const f = face, feet = t.pos.z - r, reach = Math.min(o.reach, cap) + 0.02
  // The top, just past the face (the wheels' sphere is r from it), and again o.depth further on.
  const top = (along: number) => {
    const hit = raycast(sim.park, v3(t.pos.x + f.x * along, t.pos.y + f.y * along, feet + reach), v3(0, 0, -1), reach)
    return hit && rideable(sim.park.cls[hit.tri]) && hit.normal.z >= cos(G.maxSnapAngleDeg * DEG) ? hit.point.z : null
  }
  const z0 = top(r * 1.6)
  if (z0 === null || z0 - feet < 0.02 || z0 - feet > Math.min(o.reach, cap)) return null
  const z1 = top(r * 1.6 + o.depth)
  if (z1 === null || abs(z1 - z0) > 0.04) return null
  // Room for the wheels on top (resting on it, past the edge), and straight up to it.
  const onTop = v3(t.pos.x + f.x * r * 1.6, t.pos.y + f.y * r * 1.6, z0 + r)
  if (sphereContacts(sim.park, onTop, r * 0.95, riser).length > 0) return null
  if (sphereContacts(sim.park, v3(t.pos.x, t.pos.y, z0 + r), r * 0.95, riser).length > 0) return null
  t.pos = onTop
  t.vel = scale(dir, (t.state === State.air ? bh : len(before)) * o.keep)
  return z0 - feet
}

/**
 * Touching down from the air on a surface with normal n, `vel` the velocity it met it with (for a
 * moving car's roof: relative to the car). A bad landing bails (returns false); otherwise the
 * skater is on the ground, the board lined up, the combo held open for a manual or revert.
 */
export function touchDown(sim: Sim, t: Thing, vel: Vec3, n: Vec3, events: SimEvent[]): boolean {
  const P = sim.data.physics, tick = sim.world.tick
  const verdict = landing(sim, t, vel, n)
  if (verdict.bail) { loseCombo(sim, t, events); startBail(t, verdict.reason, tick, events); return false }
  t.airTicks = t.stateTicks
  t.footTrick = ''
  t.vel = flatten(t.vel, n)
  t.up = copy(n)
  t.fwd = norm(flatten(t.fwd, t.up), t.fwd)
  t.vertAir = false
  settle(sim, t, verdict)
  t.lastLand = { tick, airTicks: t.stateTicks, quality: verdict.quality, impact: round(verdict.impact), points: 0, multiplier: 0, combo: '', bankTick: -1 }
  events.push({ t: 'land', tick, airTicks: t.stateTicks, peakZ: round(t.airPeakZ), speed: round(len(t.vel)), fakie: verdict.fakie, angleErr: round(verdict.angleErr), quality: verdict.quality, impact: round(verdict.impact) })
  addSpin(sim, t)
  // The combo stays open for a moment: a manual or revert continues it (not out of a stumble).
  if (t.combo.length) t.landGrace = verdict.quality === 'stumble' ? 1 : P.combo.graceTicks
  t.landSteep = steepDeg(n) > P.combo.revertMinDeg
  t.wallplanted = false; delete t.lipped; delete t.wallrides; delete t.offZ; delete t.stance; delete t.slideTurn; delete t.left
  t.state = State.ground
  t.stateTicks = 0
  return true
}

/** Air: a landing is a real impact on rideable ground (or a glancing touch along a ramp). */
function landingSupport(sim: Sim, t: Thing, before: Vec3, P: Sim['data']['physics']): Vec3 | null {
  const G = P.ground
  const bl = len(before)
  // As in groundSupport: a touch on a face (its direction is the face normal) outranks touches on
  // the edges of neighbouring triangles, whose directions lean and bounced landings on slopes.
  const tn = sim.park.tn
  const onFace = (k: Touch) => abs(k.n.x * tn[k.tri * 3] + k.n.y * tn[k.tri * 3 + 1] + k.n.z * tn[k.tri * 3 + 2]) > 0.99999
  const usable = (k: Touch) => rideable(k.cls) && (k.n.z >= G.groundMinNormalZ || (bl > 1 && abs(dot(before, k.n)) < 0.35 * bl))
  const faces = touches.some((k) => usable(k) && onFace(k))
  let sx = 0, sy = 0, sz = 0
  for (const k of touches) {
    if (!usable(k) || (faces && !onFace(k))) continue
    const w = k.depth + 0.002
    sx += k.n.x * w; sy += k.n.y * w; sz += k.n.z * w
  }
  if (sx === 0 && sy === 0 && sz === 0) return null
  const n = norm(v3(sx, sy, sz))
  // Grazing the corner you just rolled off is not a landing.
  if (t.stateTicks < 3 && -dot(before, n) < 0.5) return null
  return n
}

/** Ollie pop. Off a vert wall it pops straight up; elsewhere along a mix of surface normal and up. */
function pop(sim: Sim, t: Thing, events: SimEvent[]) {
  const O = sim.data.physics.ollie
  // Out of a manual the combo continues; an ollie right after landing without one ends it.
  const fromManual = !!t.manual
  if (t.skitch) { endSkitch(sim, t, 'ollie', events); t.landGrace = 0 }   // let go and pop: the combo carries on
  if (t.manual) endManual(sim, t, 'ollie', events)
  else if (t.landGrace > 0) bankCombo(sim, t, events)
  // Popping out of a powerslide, the rider snaps the board back in line with the travel direction;
  // the slide goes into the combo, which carries on into the air.
  if (t.powerslide !== 0) {
    if (len(t.vel) > 0.5) t.fwd = scale(norm(flatten(t.vel, t.up)), t.slideLead)
    endPowerslide(sim, t, events)
    t.landGrace = 0
  }
  const fakie = dot(t.vel, t.fwd) < -0.3
  const k = t.charge / O.chargeTicks
  // A foot trick (data/tricks.json foot): an ollie started with a foot off the board, picked by the
  // direction taps just before the pop (boneless: up, up; no comply: down). Not out of a manual,
  // whose balance taps would read as one.
  const foot = t.state === State.ground && !fromManual ? footTrickFor(sim, t) : null
  const speed = lerp(O.popMin, O.popMax, k) * (foot ? foot.pop : 1)
  if (t.state === State.ground) takeoff(t, sim.data.physics, faceUnder(sim, t))
  else t.vel.z = max(t.vel.z, 0)
  const dir = t.vertAir ? Z : norm(lerp3(t.takeoffN, Z, O.upMix))
  t.vel = madd(t.vel, dir, speed)
  t.popped = true
  t.charge = 0
  t.crouch = false
  // The stance it pops in (tricks.ts airName): off the tail rolling backward is Fakie; off the nose (the nose
  // button, Q, held as K is let go; not a foot trick) is Nollie rolling forward and Switch rolling backward.
  // (or both spin buttons together, which cancel each other: the pad's L1 + R1, the keys U + O)
  const nose = !foot && ((t.prevB & Btn.nose) !== 0 || (t.prevB & (Btn.spinL | Btn.spinR)) === (Btn.spinL | Btn.spinR))
  const stance = nose ? (fakie ? 'switch' : 'nollie') : fakie ? 'fakie' : undefined
  if (stance) t.stance = stance
  else delete t.stance
  events.push({ t: 'pop', tick: sim.world.tick, charge: round(k), fakie, speed: round(speed), ...(nose ? { nose: true } : {}) })
  t.footTrick = foot ? foot.id : ''
  if (foot) {
    t.combo.push({ id: foot.id, name: foot.name, points: foot.points })
    t.dirHist = []
    events.push({ t: 'trickStart', tick: sim.world.tick, trick: foot.name }, { t: 'trickEnd', tick: sim.world.tick, trick: foot.name, points: foot.points })
  }
}

/** The foot trick whose direction taps end the recent history, the last within combo.footWindow of now. */
function footTrickFor(sim: Sim, t: Thing) {
  const W = sim.data.physics.combo.footWindow, now = sim.world.tick, h = t.dirHist
  let best: (typeof sim.data.tricks.foot)[number] | null = null
  for (const f of sim.data.tricks.foot) {
    if (h.length < f.seq.length || (best && best.seq.length >= f.seq.length)) continue
    const tail = h.slice(-f.seq.length)
    if (now - tail[tail.length - 1].tick > W) continue
    if (tail.some((p, i) => p.d !== f.seq[i] || (i > 0 && p.tick - tail[i - 1].tick > W))) continue
    best = f
  }
  return best
}

/**
 * Leaving the ground. Off a vert wall going up, the classic rule: straight up, back down onto the ramp. The
 * wall is the face under the wheels (face: its normal, when known) or the board's up, whichever is
 * steeper, within vert.topToleranceDeg of vert.minWallDeg (phase 27); off a coping (coping), always.
 */
export function takeoff(t: Thing, P: Sim['data']['physics'], face?: Vec3, coping = false) {
  t.state = State.air
  t.stateTicks = 0
  t.popped = false
  t.carRide = -1
  t.spin = 0
  t.spinVel = 0
  t.steer = 0
  t.slip = 0
  t.lean = 0
  t.powerslide = 0
  t.airPeakZ = t.pos.z
  t.takeoffN = copy(t.up)
  t.spine = false
  const steep = max(acos(clamp(t.up.z, -1, 1)), face ? acos(clamp(abs(face.z), 0, 1)) : 0) / DEG
  t.vertAir = (coping || steep >= P.vert.minWallDeg - P.vert.topToleranceDeg) && t.vel.z > 0.5
  if (!t.vertAir) return
  const nh = norm(v3(t.up.x, t.up.y, 0))          // horizontal, out of the wall into the riding area
  const away = dot(t.vel, nh)
  const airtime = (2 * t.vel.z) / P.gravity
  const drift = P.vert.reentry / max(airtime, 0.2)
  t.vel = madd(t.vel, nh, drift - away)
  // The board points up the wall; its up stays the wall normal for the whole air.
  t.fwd = norm(flatten(t.fwd, t.up), t.fwd)
}

type Verdict = { bail: boolean; reason: string; fakie: boolean; angleErr: number; quality: 'clean' | 'sketchy' | 'stumble'; impact: number }

/**
 * Landing check. Bails: a trick still running, the board far off the surface, landing sideways,
 * or coming down too hard. Otherwise the quality: clean, sketchy (angle) or stumble (angle or impact).
 */
function landing(sim: Sim, t: Thing, vel: Vec3, n: Vec3): Verdict {
  const L = sim.data.physics.land
  const impact = max(0, -dot(vel, n))   // speed into the surface, m/s
  const bail = (reason: string, angleErr = 0): Verdict => ({ bail: true, reason, fakie: false, angleErr, quality: 'stumble', impact })
  if (t.trick) return bail(`landed mid-${trickDef(sim, t.trick.id, t.trick.kind)?.name ?? t.trick.id}`)
  const upErr = angleBetween(t.up, n) / DEG
  if (upErr > L.maxUpDeg) return bail(`board ${upErr.toFixed(0)} deg off the surface`, upErr)
  if (impact > L.hardSpeed) return bail(`landed too hard (${impact.toFixed(1)} m/s)`)
  const vt = flatten(vel, n), f = flatten(t.fwd, n)
  let a = 0, fakie = false
  if (len(vt) >= 0.6 && len(f) >= 1e-3) {
    const raw = angleBetween(f, vt) / DEG
    if (raw <= L.toleranceDeg) a = raw
    else if (raw >= 180 - L.toleranceDeg) { a = 180 - raw; fakie = true }
    // Crosswise at walking pace (or a slow drift on a moving car's roof) is sketchy, not a bail.
    else if (len(vt) < L.slowSpeed) a = L.cleanDeg + 1
    else return bail(`landed ${raw.toFixed(0)} deg sideways`, raw)
  }
  const quality = a > L.stumbleDeg || impact > L.stumbleSpeed ? 'stumble' : a > L.cleanDeg ? 'sketchy' : 'clean'
  return { bail: false, reason: '', fakie, angleErr: a, quality, impact }
}

/** After a landing: line the board up with the travel direction (part way when sketchy); a stumble costs speed. */
function settle(sim: Sim, t: Thing, v: Verdict) {
  const L = sim.data.physics.land
  t.load = 1
  t.slip = 0
  t.steer = 0
  if (len(t.vel) >= L.slowSpeed) {   // slower than that, the grip sorts out a drift; the board keeps its heading
    // The board comes down in line with the travel direction. Sketchy: the rider turns it
    // land.straighten of the way and the wheels skid out the rest, which costs that part of the speed.
    const axis = scale(norm(t.vel), v.fakie ? -1 : 1)   // where the board should point
    const off = signedAngle(t.fwd, axis, t.up)
    if (v.quality === 'sketchy') t.vel = scale(t.vel, cos(off * (1 - L.straighten)))
    t.fwd = norm(flatten(rotateAround(t.fwd, t.up, off), t.up), t.fwd)
  }
  if (v.quality === 'stumble') {
    t.vel = scale(t.vel, L.stumbleKeep)
    t.stumble = L.stumbleTicks
  }
}

export function startBail(t: Thing, reason: string, tick: number, events: SimEvent[]) {
  t.state = State.bail
  t.stateTicks = 0
  t.vertAir = false
  t.crouch = false
  t.steer = 0; t.lean = 0; t.slip = 0; t.powerslide = 0; t.wobble = 0; t.stumble = 0; t.carRide = -1; t.skitch = null
  delete t.lipped; delete t.wallrides; delete t.offZ; delete t.stance; delete t.revertWant; delete t.getUp; delete t.slideTurn; delete t.left
  events.push({ t: 'bail', tick, reason })
}

/**
 * Slide to a stop, ignore input, then stand up where it stopped: after bail.ticks, or sooner on a fresh
 * press of ollie or push (up) once bail.getUpTicks have passed and the slide has slowed under
 * bail.getUpSpeed (a player who wants to go again gets up and goes). The get-up then plays the bail's
 * own end, quickly: the clock (stateTicks, which every character's bail animation is a function of)
 * jumps to bail.getUpFrom, where they start getting up, and runs at bail.getUpRate to bail.ticks
 * (Thing.getUp). So the view blends from lying to standing instead of snapping up.
 */
function stepBail(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]) {
  const P = sim.data.physics, B = P.bail
  const dt = 1 / P.tickHz
  t.vel = madd(t.vel, v3(0, 0, -P.gravity), dt)
  const hs = Math.hypot(t.vel.x, t.vel.y)
  if (hs > 0) { const k = max(0, hs - B.friction * dt) / hs; t.vel.x *= k; t.vel.y *= k }
  moveSphere(sim.park, t.pos, t.vel, dt, P.skater.radius, P.collision, touches)
  t.up = norm(lerp3(t.up, Z, 0.1))
  if (t.getUp && t.stateTicks < B.getUpFrom - B.getUpRate) delete t.getUp   // left from an earlier bail (a teleport out of one)
  if (!t.getUp && t.stateTicks + 1 >= B.getUpTicks && hs < B.getUpSpeed && (input.b & ~t.prevB & (Btn.ollie | Btn.up)) !== 0) {
    t.getUp = true
    t.stateTicks = max(t.stateTicks, B.getUpFrom - B.getUpRate)
  }
  t.stateTicks = Math.min(B.ticks, t.stateTicks + (t.getUp ? B.getUpRate : 1))
  if (t.stateTicks < B.ticks) return
  delete t.getUp
  t.vel = v3()
  const hit = probeGround(sim.park, t.pos, Z, P.skater.radius + 0.1)
  t.up = hit ? copy(hit.normal) : copy(Z)
  t.fwd = norm(flatten(v3(t.fwd.x, t.fwd.y, 0), t.up), v3(0, 1, 0))
  t.state = hit ? State.ground : State.air
  t.stateTicks = 0
  events.push({ t: 'recover', tick: sim.world.tick })
}

const round = (x: number) => Math.round(x * 1000) / 1000
