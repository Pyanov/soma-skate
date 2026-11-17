import type { Physics } from '../data.ts'
import { Btn, has, stick, type InputFrame } from '../input.ts'
import { abs, clamp, cross, DEG, dot, flatten, len, madd, max, min, norm, PI, rotateAround, scale, signedAngle, sin, v3 } from '../math.ts'
import { nextFloat } from '../rng.ts'
import type { Sim, SimEvent } from '../sim.ts'
import type { Thing } from '../thing.ts'
import { bankCombo } from '../tricks/tricks.ts'

// The board on the ground: truck steering, grip and slip, rolling resistance, air drag,
// pumping, the foot brake, powerslides and speed wobble. Spec: docs/mechanics/board.md.
// Runs before the skater moves; the move and the surface snap stay in skater.ts.

/** Sideways slip (m/s) above which the wheels count as sliding (kinetic friction). */
const SLIDING = 0.02

/** Aerodynamic drag coefficient k in a = k v^2 (per metre). */
export function dragK(P: Physics, tuck: boolean) {
  const A = P.aero
  return (0.5 * A.airDensity * (tuck ? A.cdaTuck : A.cdaStand)) / A.massKg
}

/** Foot brake deceleration at speed v: full when slow, fading toward footBrakeHighFactor at speed. */
export function footBrake(G: Physics['ground'], v: number) {
  if (v <= G.footBrakeFullSpeed) return G.footBrakeDecel
  const k = clamp((v - G.footBrakeFullSpeed) / max(1e-6, G.footBrakeHighSpeed - G.footBrakeFullSpeed), 0, 1)
  return G.footBrakeDecel * (1 - (1 - G.footBrakeHighFactor) * k)
}

/**
 * The carve at speed v: up to board.park.from m/s the park's quick turning (board.park's minRadius,
 * carveAccel and grip), blended out by board.park.to, from where on (bombing speeds) board.minRadius,
 * carveAccel and grip hold as before (feel pass 2026-11-09: the hill and the races keep their numbers).
 */
export function carveAt(B: Physics['board'], v: number) {
  const P = B.park, k = clamp((v - P.from) / max(1e-6, P.to - P.from), 0, 1)
  return { minRadius: P.minRadius + (B.minRadius - P.minRadius) * k, carveAccel: P.carveAccel + (B.carveAccel - P.carveAccel) * k, grip: P.grip + (B.grip - P.grip) * k }
}

/** The tightest circle the trucks carve at speed v, at full lean (m). */
export const fullLeanRadius = (B: Physics['board'], v: number) => { const c = carveAt(B, v); return c.minRadius + (v * v) / c.carveAccel }

/**
 * The fastest speed a full-lean carve holds a circle of radius r at (the autopilots' corner speed,
 * src/sim/game/follow.ts and src/harness/pilot.ts): fullLeanRadius grows with speed, so a bisection.
 */
export function cornerSpeed(B: Physics['board'], r: number) {
  let lo = 0, hi = 25
  for (let i = 0; i < 24; i++) { const m = (lo + hi) / 2; if (fullLeanRadius(B, m) <= r) lo = m; else hi = m }
  return lo
}

/** Path curvature (1/m, + = clockwise) the trucks steer for lean fraction u at speed v. */
export const curvature = (B: Physics['board'], u: number, v: number) => { const c = carveAt(B, v); return u / (c.minRadius + (v * v) / c.carveAccel) }

/**
 * A powerslide ends (let go, stopped, popped out of, rolled off an edge): if it lasted
 * slide.minScoreTicks it goes into the combo, named FS/BS by its turn like a spin (counterclockwise
 * is frontside for a regular rider), a Bert Slide if a hand was down (crouched at speed) for most of
 * it. On the ground the combo then gets the landing grace to link on (manual, ollie) or bank.
 */
export function endPowerslide(sim: Sim, t: Thing, events: SimEvent[]) {
  const S = sim.data.physics.slide
  if (t.powerslide !== 0 && t.slideTicks >= S.minScoreTicks) {
    const def = sim.data.tricks.powerslides.find((x) => x.id === (t.bertTicks * 2 > t.slideTicks ? 'bertslide' : 'powerslide'))!
    const fs = (t.powerslide > 0) === (sim.data.rider.stance === 'regular')
    const name = `${fs ? 'FS' : 'BS'} ${def.name}`
    const points = Math.round(def.points + (def.pointsPerSecond * t.slideTicks) / sim.data.physics.tickHz)
    t.combo.push({ id: def.id, name, points })
    events.push({ t: 'trickEnd', tick: sim.world.tick, trick: name, points })
    if (t.state === 'ground') t.landGrace = sim.data.physics.combo.graceTicks
  } else if (t.powerslide !== 0) bankCombo(sim, t, events)   // too short to count: no link either (a tap held the combo open for free)
  t.powerslide = 0
  t.slideTicks = 0
  t.bertTicks = 0
}

/** One ground tick of board physics. Returns a bail reason, or null. */
export function stepBoard(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]): string | null {
  const P = sim.data.physics, G = P.ground, B = P.board, S = P.slide, W = P.wobble
  const dt = 1 / P.tickHz, g = P.gravity, tick = sim.world.tick
  const up = t.up
  const st = stick(input)
  let v = flatten(t.vel, up)
  const speed = len(v)
  let f = norm(flatten(t.fwd, up), t.fwd)
  const lead = dot(v, f) >= 0 ? 1 : -1          // which end of the board leads
  const vh = speed > 1e-6 ? scale(v, 1 / speed) : scale(f, lead)
  const N = max(0, t.load) * g
  if (t.stumble > 0) t.stumble--

  // ---- powerslide: Shift held at speed swings the board across the direction of travel ----
  const slideHeld = has(input, Btn.slide) && !t.manual && t.stumble === 0
  if (t.powerslide === 0 && slideHeld && speed >= S.minSpeed) {
    // The back foot kicks the tail out toward the toes (the nose swings to the heel side), or
    // the nose swings toward the stick: right = clockwise = -1.
    const heelSide = (sim.data.rider.stance === 'regular' ? 1 : -1) * lead
    t.powerslide = st.x !== 0 ? -st.x : heelSide
    t.slideLead = lead
    t.slideTicks = 0
    t.bertTicks = 0
    // A powerslide links a combo, like a manual: it stays open while you slide. Not to a powerslide
    // just before it, though (slide, let go, slide again was an endless risk-free chain): that banks.
    if (t.landGrace > 0 && sim.data.tricks.powerslides.some((p) => p.id === t.combo.at(-1)?.id)) bankCombo(sim, t, events)
    t.landGrace = 0
    events.push({ t: 'powerslide', tick, on: true, speed: round(speed) })
  } else if (t.powerslide !== 0 && (!slideHeld || speed < 0.5)) {
    endPowerslide(sim, t, events)
    events.push({ t: 'powerslide', tick, on: false, speed: round(speed) })
  }
  if (t.powerslide !== 0) { t.slideTicks++; if (t.crouch && speed > S.bertSpeed) t.bertTicks++ }

  // ---- lean: builds and relaxes at finite rates, so a tap is a small carve ----
  const target = t.powerslide !== 0 ? 0 : st.x * (t.stumble > 0 ? 0.5 : 1)
  const growing = target !== 0 && (t.steer === 0 || Math.sign(target) === Math.sign(t.steer)) && abs(target) > abs(t.steer)
  const rate = (growing ? B.leanIn : B.leanOut) * dt
  const snappy = clamp(target - t.steer, -rate, rate)
  // At bombing speed the lean follows the keys as a smooth lag instead (board.leanAtSpeed: blended
  // in from `from` to `to` m/s): the keys are all-or-nothing, and a held key carves past the grip,
  // so a long street bend is ridden by tapping, and the lag turns the taps into a steady part lean
  // (holding a third of the time is about 0.55) rather than a zigzag. The opposite key still
  // straightens at the snappy rate.
  const K = B.leanAtSpeed, k = clamp((speed - K.from) / max(1e-6, K.to - K.from), 0, 1)
  const countering = target !== 0 && t.steer !== 0 && Math.sign(target) !== Math.sign(t.steer)
  if (k > 0 && !countering) {
    const lag = (target - t.steer) * (dt / ((growing ? K.tauIn : K.tauOut) + dt))
    t.steer += snappy + (lag - snappy) * k
  } else t.steer += snappy

  // ---- speed wobble: above wobble.speed, standing tall, the trucks start to shimmy ----
  // Crouched, the trucks hold out to wobble.tuckSpeed; standing tall, to wobble.speed.
  const thr = t.crouch ? W.tuckSpeed : W.speed
  if (speed > thr && t.powerslide === 0) {
    if (t.wobble < W.seed * 0.5) t.wobble = W.seed * (0.5 + nextFloat(sim.world.rng))
    t.wobble += W.grow * (speed / thr - 1) * dt
  }
  const damp = (speed <= thr ? W.damp + (t.crouch ? W.crouchDamp : 0) : 0) + (abs(t.steer) > 0.3 ? W.carveDamp : 0) + (t.powerslide !== 0 || abs(t.slip) > 0.3 ? W.crouchDamp : 0)
  t.wobble = max(0, t.wobble - damp * dt)
  let shake = 0
  if (t.wobble > 0) {
    t.wobblePhase = (t.wobblePhase + 2 * PI * W.hz * dt) % (2 * PI)
    shake = t.wobble * sin(t.wobblePhase) * (W.leanDeg / max(1e-6, B.leanMaxDeg))
  } else t.wobblePhase = 0
  if (t.wobble >= 1) { t.wobble = 0; return 'speed wobbles' }

  // ---- yaw: trucks, pivot, powerslide, straightening ----
  let yaw = 0
  if (t.powerslide !== 0) {
    const theta = signedAngle(vh, scale(f, t.slideLead), up)   // the board's angle off the travel direction
    const want = t.powerslide * (S.angleDeg + S.steerDeg * -st.x * t.powerslide) * DEG
    yaw = clamp(want - theta, -S.yawRate * dt, S.yawRate * dt)
  } else {
    const pivot = st.x * B.pivotRate * max(0, 1 - speed / B.pivotMaxSpeed) * (t.stumble > 0 ? 0.5 : 1)
    const steerYaw = -(speed * curvature(B, t.steer + shake, speed) + pivot) * dt
    yaw = steerYaw
    if (speed > B.slipMinSpeed) {
      // beta: the travel-aligned board axis, counterclockwise from the velocity.
      const beta = signedAngle(vh, scale(f, lead), up)
      const bmax = B.carveSlipMaxDeg * DEG
      if (abs(beta) > bmax) yaw = clamp(-beta, -B.recoverYawRate * dt, B.recoverYawRate * dt)   // turn it back in line
      else {
        yaw = clamp(beta + steerYaw, -bmax, bmax) - beta                                        // drift at most bmax
        // Not leaning: the rider (and the self-centring trucks) bring the board right back in line,
        // rather than letting friction drag the travel onto a crooked board.
        if (abs(t.steer) < 0.2) yaw += clamp(-(beta + yaw), -B.recoverYawRate * dt, B.recoverYawRate * dt)
      }
    }
  }
  if (yaw !== 0) f = norm(flatten(rotateAround(f, up, yaw), up), f)

  // ---- turning: while gripping, the wheels carry the velocity round with the board ----
  let budget = (abs(t.slip) > SLIDING ? B.slideFriction : carveAt(B, speed).grip) * N * dt
  if (abs(t.slip) <= SLIDING && t.powerslide === 0 && yaw !== 0 && speed > 1e-6) {
    const need = speed * abs(yaw)
    const turn = need <= budget ? yaw : (yaw * budget) / need
    v = rotateAround(v, up, turn)
    budget -= speed * abs(turn)
  }

  // ---- forces along the surface ----
  const gt = flatten(v3(0, 0, -g), up)
  // Pump: crouched through a concave transition (down into it or up out of it), pressing against
  // the extra load turns into speed, like extending the legs about crouchPump x the arc length.
  if (t.crouch && speed > 0.1) v = madd(v, vh, G.crouchPump * max(0, t.load - up.z) * g * dt)
  v = madd(v, gt, dt)
  const fa0 = dot(v, f)
  if (!t.manual && t.powerslide === 0 && t.stumble === 0 && st.y > 0 && fa0 < G.maxPushSpeed && fa0 > -0.5) v = madd(v, f, G.pushAccel * dt)
  // Rolling resistance and the foot brake act along the rolling direction.
  const fa1 = dot(v, f)
  // Rolling resistance by the surface under the wheels: park concrete, city asphalt, sidewalk, grass.
  const crr = t.groundTri >= 0 ? G.rollingByType[sim.park.elements[sim.park.elem[t.groundTri]]?.type ?? ''] ?? G.rollingResistance : G.rollingResistance
  const roll = crr * N + (!t.manual && st.y < 0 && t.powerslide === 0 ? footBrake(G, abs(fa1)) : 0)
  v = madd(v, f, -Math.sign(fa1) * min(abs(fa1), roll * dt))
  const sp = len(v)
  if (sp > 0) v = scale(v, max(0, sp - dragK(P, t.crouch) * sp * sp * dt) / sp)

  // ---- grip: the wheels cancel sideways velocity up to mu * N * dt; the rest slides ----
  const right = cross(f, up)
  const fa = dot(v, f)
  let fl = dot(v, right)
  if (abs(fl) <= budget) fl = 0
  else fl -= Math.sign(fl) * budget
  v = madd(scale(f, fa), right, fl)
  t.slip = fl
  t.lean = (t.steer + shake) * B.leanMaxDeg * DEG * lead
  t.vel = v
  t.fwd = f
  return null
}

const round = (x: number) => Math.round(x * 1000) / 1000
