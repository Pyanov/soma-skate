import type { Thing } from '../../sim/thing.ts'
import { lerpPose, type Hand, type Pose, type PoseData, type V3 } from './poses.ts'

// How a park NPC skater reacts to the session around it, drawn over its riding pose (view only, from
// its Thing and the tick, so a shot or a clip shows what play shows): cheering a big combo of yours
// (arms up, the back foot tapping the kicktail), pointing at you as it sets off to copy your line,
// and standing off its board waiting for its turn at a spot, watching whoever is riding.

/** characters.json npcs.react. */
export type ReactData = {
  cheerTicks: number; tapFrom: number; taps: number; tapEvery: number; tapPitch: number
  pointTicks: number; waitBlend: number; waitLeave: number
  lookRange: number; lookSpeed: number; lookMax: number; lookEase: number
}
/**
 * One NPC's reactions this frame: ticks into its cheer and into its point (-1: none), how much it
 * stands waiting (0..1), and the world point it looks at (who it watches or points at; null: none).
 */
export type NpcReact = { cheer: number; point: number; wait: number; at: { x: number; y: number; z: number } | null }

export const DEFAULT_REACT: ReactData = { cheerTicks: 132, tapFrom: 8, taps: 3, tapEvery: 30, tapPitch: 24, pointTicks: 100, waitBlend: 40, waitLeave: 30, lookRange: 30, lookSpeed: 1.2, lookMax: 125, lookEase: 12 }

const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x)
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t) }
const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const addV = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]
const D2R = Math.PI / 180

/** Ticks into the cheer the sim started at npc.life.cheer (-1 when not cheering). */
export function cheerTicks(t: Thing, tick: number, alpha: number, d: ReactData): number {
  const c = tick + alpha - (t.npc?.life?.cheer ?? -1e9)
  return c >= 0 && c < d.cheerTicks ? c : -1
}

/**
 * Ticks into the point at you as it starts copying your line (-1 when not): the sim places the copier
 * at your start (spot npc_copy) and it sets off from rest, so: on that first stretch of ground.
 */
export function pointTicks(t: Thing, alpha: number, d: ReactData): number {
  if (!t.npc?.life?.copy || t.spot !== 'npc_copy' || t.state !== 'ground' || t.airTicks > 12) return -1
  const p = t.stateTicks + alpha
  return p < d.pointTicks ? p : -1
}

/** How strongly the cheer and the point show (their fades), for the head turn and the face. */
export function reactWeights(r: NpcReact, d: ReactData): { cheer: number; point: number } {
  return {
    cheer: r.cheer >= 0 ? smooth(0, 10, r.cheer) * (1 - smooth(d.cheerTicks - 24, d.cheerTicks, r.cheer)) : 0,
    point: r.point >= 0 ? smooth(0, 8, r.point) * (1 - smooth(d.pointTicks - 20, d.pointTicks, r.point)) : 0,
  }
}

/**
 * The reactions over a styled pose. yaw: where it looks, degrees in stance space (0 = straight out to
 * the toe side, + toward the nose), null for nowhere in particular; T: ticks, for the idle sway.
 */
export function reactPose(pose: Pose, r: NpcReact, yaw: number | null, T: number, P: PoseData, d: ReactData): Pose {
  let p = pose
  const { cheer: ce, point: pe } = reactWeights(r, d)
  // Waiting for its turn: stepped off on the toe side, the back foot resting on the board and rolling
  // it a little back and forth, the weight shifting from foot to foot.
  const stand = P.poses.waitStand
  if (r.wait > 0 && stand) {
    const c: Pose = structuredClone(stand)
    c.board = { ...c.board, n: c.board.n + Math.sin(T * 0.035) * 0.05 }
    c.hipsRot = addV(c.hipsRot, [0, 0, 3], Math.sin(T * 0.017))
    c.hips = addV(c.hips, [0, 0.02, 0.01], Math.sin(T * 0.017))
    p = lerpPose(p, c, r.wait)
  }
  // Cheering your combo: arms up and pumping, the back foot tapping the kicktail so the nose kicks up
  // and slaps down; rolling, the front foot comes off the board for it (waiting, it is off already).
  const up = P.poses.celArmsUp
  if (ce > 0 && up) {
    p = lerpPose(p, { ...p, spine: up.spine, head: up.head, lead: up.lead, rear: up.rear }, ce)
    const pump = Math.sin(r.cheer * 0.4) * ce
    p.lead = { ...p.lead, pos: addV(p.lead.pos, [0, 0, 0.07], pump) }
    p.rear = { ...p.rear, pos: addV(p.rear.pos, [0, 0, 0.07], -pump) }
    p.back = { ...p.back, pos: [lerp(p.back.pos[0], -0.36, ce), p.back.pos[1], p.back.pos[2]], board: lerp(p.back.board, 1, ce) }
    if (r.wait < 0.5) p.front = { ...p.front, pos: addV(p.front.pos, [0.05, 0.12, 0.3], ce), board: p.front.board * (1 - ce) }
    const tc = r.cheer - d.tapFrom
    if (tc >= 0 && tc < d.taps * d.tapEvery) {
      const s = (tc % d.tapEvery) / d.tapEvery
      const lift = s < 0.45 ? smooth(0, 0.45, s) : 1 - smooth(0.45, 0.62, s)
      p.board = { ...p.board, pitch: p.board.pitch + d.tapPitch * lift, pivot: -0.5 }
    }
  }
  // Setting off to copy your line: the nearer hand points at you.
  if (pe > 0 && yaw !== null) {
    const a = clamp(yaw, -135, 135) * D2R, lead = yaw >= 0
    const hand: Hand = { pos: [Math.sin(a) * 0.5 + (lead ? 0.08 : -0.08), Math.cos(a) * 0.5, 0.12], board: 0, elbow: [lead ? 0.7 : -0.7, -0.2, -0.6], curl: 0.15 }
    if (lead) p.lead = lerpPose(p.lead, hand, pe); else p.rear = lerpPose(p.rear, hand, pe)
  }
  // Looking: the head turns toward the point, then the shoulders take what the neck cannot.
  const lw = Math.max(r.wait, ce, pe)
  if (yaw !== null && lw > 0) {
    const want = clamp(yaw, -d.lookMax, d.lookMax)
    let head = want - p.hipsRot[0] - p.spine[0], spine = 0
    if (head > 80) { spine = Math.min(35, head - 80); head = 80 } else if (head < -80) { spine = Math.max(-35, head + 80); head = -80 }
    p.head = [lerp(p.head[0], head, lw), p.head[1], p.head[2]]
    p.spine = [p.spine[0] + spine * lw, p.spine[1], p.spine[2]]
  }
  return p
}
