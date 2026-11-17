import type { GameData } from '../../sim/data.ts'
import type { Thing } from '../../sim/thing.ts'
import type { Pose, V3 } from './poses.ts'

// On foot (state 'walk'): a walk and run cycle driven by the metres walked (Thing.stride), so
// the feet never slide, in each character's own gait (data/characters.json style.walk);
// jumping and climbing; the board carried (the carry itself is placed by view.ts, which knows
// where the shoulders ended up). Stance space as poses.ts, with the rider frame turned to face
// where the character walks: f = forward, n = the character's left.

export type Gait = {
  carry: 'truck' | 'underArm' | 'head'   // by the deck's edge at the side, pinned under the arm nose down, or on the head
  hand: 'lead' | 'rear'         // which hand carries the board
  stride: number                // metres per full cycle (two steps) when walking
  lift: number                  // foot lift in the swing, metres
  bob: number                   // hips drop between steps, metres
  bounce: number                // extra hop of the whole body each step (the blob)
  sway: number                  // hips over the standing foot, metres
  roll: number                  // side-to-side tilt each step, degrees (the can's waddle)
  yaw: number                   // pelvis turn with the stride, degrees
  arms: number                  // free arm swing, metres
  lean: number                  // forward lean walking, degrees
  runLean: number               // more at a run
  width: number                 // feet apart, metres
  phone: boolean                // the free hand holds a phone, head down (the tech bro)
  out?: number                  // the carried board out from the shoulder, metres (wide bodies)
  glide?: number                // 0..1: the feet barely step and slide instead (the vampire)
}

export const DEFAULT_GAIT: Gait = { carry: 'truck', hand: 'rear', stride: 1.4, lift: 0.08, bob: 0.03, bounce: 0, sway: 0.015, roll: 0, yaw: 6, arms: 0.16, lean: 3, runLean: 12, width: 0.11, phone: false }

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }

/** Hanging from a ledge or pulling up from it: the ledge top's height over the feet, pull-up progress, the top in world space. */
export type HangInfo = { top: number; pull: number; at: { x: number; y: number; z: number } }
export type WalkInfo = { phase: number; move: number; run: number; step: number; pickup: number; climb: number; tag: string; hang: HangInfo | null }

/**
 * The on-foot pose. phase: the cycle angle (radians); move: 0 standing .. 1 walking; run: 0..1;
 * step: a 0..1 pulse at each foot strike (for squash, clacks); pickup: 0 at the step-off .. 1 once
 * the board is carried.
 */
export function walkPose(base: Pose, t: Thing, data: GameData, alpha: number, g: Gait): { pose: Pose; info: WalkInfo } {
  const W = data.physics.walk
  const p = base
  const v = Math.hypot(t.vel.x, t.vel.y)
  const move = clamp01(v / W.walkSpeed)
  const run = smooth(W.walkSpeed * 1.05, W.runSpeed, v)
  const L = g.stride * (1 + 0.45 * run)
  const phase = (2 * Math.PI * (t.stride ?? 0)) / L
  const ticks = t.stateTicks + alpha
  const pickup = smooth(3, 22, ticks)
  // Feet: each swings forward with the foot lifted, then plants and slides back under the body.
  const A = (L / 4) * move * (1 - (g.glide ?? 0))
  for (const [f, side, off] of [[p.front, 1, 0], [p.back, -1, Math.PI]] as const) {
    const psi = phase + off
    const swing = Math.max(0, Math.cos(psi))
    f.board = 0
    f.toe = 0
    f.pos = [side * g.width, A * Math.sin(psi), g.lift * (1 + 1.4 * run) * Math.pow(swing, 1.2) * move * (1 - (g.glide ?? 0))]
    f.tilt = 16 * Math.sin(psi) * move * (1 - 0.4 * run)
    f.knee = [side * 0.1, 1, 0.3]
  }
  // Hips: down between steps, a hop for the bouncy, over the standing foot, turning with the stride.
  const c = Math.cos(phase), s = Math.sin(phase)
  const between = 1 - Math.abs(c)
  const step = Math.pow(Math.max(0, 1 - Math.abs(Math.sin(phase)) * 3), 2) * move   // feet apart: a strike
  p.hips = [p.hips[0] - g.sway * c * move, p.hips[1], p.hips[2] - (g.bob * (1 + run)) * between * move + g.bounce * Math.abs(c) * move]
  p.hipsRot = [g.yaw * s * move, g.lean + g.runLean * run, g.roll * c * move]
  p.spine = [-g.yaw * 1.4 * s * move, 2 + 6 * run, 0]
  p.head = [0, g.phone ? 38 : 4, -g.roll * 0.3 * c * move]
  // The free arm swings against its leg; bent and pumping at a run; or holds the phone.
  const free = g.hand === 'rear' ? p.lead : p.rear
  const fs = g.hand === 'rear' ? 1 : -1                 // the free hand's side (+n = lead)
  if (g.phone) {
    free.pos = [fs * 0.04, 0.3, -0.2]
    free.elbow = [fs * 0.6, -0.4, -0.6]
    free.curl = 0.6
  } else {
    const legSin = fs > 0 ? s : -s                        // the same side's leg
    free.pos = [fs * (0.2 - 0.06 * run), -g.arms * (1 + 0.6 * run) * legSin * move, -0.5 + 0.22 * run]
    free.elbow = [fs * 0.3, -0.6, -0.4 + 0.3 * run]
    free.curl = 0.3 + 0.5 * run
  }
  free.board = 0
  // Picking the board up: bend down to it, then stand.
  const bendDown = 1 - pickup
  p.hips[2] -= 0.16 * bendDown
  p.spine[1] += 30 * bendDown
  p.head[1] += 10 * bendDown
  let tag = v > W.walkSpeed * 1.5 ? 'run' : v > 0.3 ? 'walk' : 'stand'
  if (t.footAir) {
    // Jump: knees up, the free arm up.
    p.front.pos = [g.width, 0.08, 0.2]; p.back.pos = [-g.width, -0.05, 0.26]
    p.front.knee = [0.1, 1, 0.5]; p.back.knee = [-0.1, 1, 0.5]
    p.hips[2] -= 0.04
    free.pos = [fs * 0.28, 0.12, 0.22]
    free.elbow = [fs * 1, 0, -0.2]
    tag = 'jump'
  }
  if (t.climb > 0) {
    // Climb: the leading foot up onto the ledge, the free hand pressing on its top, then over.
    const k = 1 - t.climb / (t.climbLen || W.climbTicks)   // a pull-up from a hang is longer
    const feet = t.pos.z - data.physics.skater.radius
    const h = Math.max(0, Math.min(0.6, t.climbTo.z - feet))
    p.front.pos = [g.width, 0.28 * (1 - k * 0.5), h * (1 - smooth(0.6, 1, k))]
    p.front.knee = [0.1, 1, 0.6]
    p.back.pos = [-g.width, -0.12, 0.02 + 0.1 * smooth(0.5, 1, k)]
    p.hips[2] -= 0.1 * (1 - k)
    p.hipsRot[1] += 25 * (1 - k)
    p.spine[1] += 20 * (1 - k)
    free.pos = [fs * 0.12, 0.3, -0.55 + 0.25 * k]
    free.elbow = [fs * 0.5, -0.8, 0]
    free.curl = 0.1
    tag = 'climb'
  }
  // Hanging from a ledge, or pulling up from one (a climb longer than a plain climb): the view hangs
  // the body from both hands on the lip (it knows the character's reach) and puts the board on the ledge.
  // (hangTop and climbTo are where the feet's sphere ends up: radius + 1 cm over the ledge surface.)
  const r = data.physics.skater.radius
  const feet = t.pos.z - r
  const surface = (p: { x: number; y: number; z: number }) => ({ x: p.x, y: p.y, z: p.z - r - 0.01 })
  let hang: HangInfo | null = null
  if (t.hang) { const at = surface(t.hangTop); hang = { top: at.z - feet, pull: 0, at }; tag = 'hang' }
  else if (t.climb > 0 && (t.climbLen || 0) > W.climbTicks) { const at = surface(t.climbTo); hang = { top: at.z - feet, pull: 1 - t.climb / t.climbLen, at }; tag = 'pull up' }
  const climb = t.climb > 0 && !hang ? Math.sin(Math.PI * (1 - t.climb / (t.climbLen || W.climbTicks))) * 0.6 + 0.4 : 0
  return { pose: p, info: { phase, move, run, step, pickup, climb, tag, hang } }
}

/** A carry for the view: [n, f, u] offsets of the board centre from the carrying shoulder. */
export const CARRY = {
  truck: { grip: [0, 0.1, 0.088] as V3, out: 0.075, fwd: 0.02, drop: 0.96 },
  underArm: { grip: [0.3, -0.1, 0.088] as V3, out: 0.06, fwd: 0.07, drop: 0.95 },
}
