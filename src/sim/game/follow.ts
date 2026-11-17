import { Btn } from '../input.ts'
import { atan2, cos, sin, sqrt, tan, PI } from '../math.ts'
import type { Sim } from '../sim.ts'
import type { Thing } from '../thing.ts'
import { cornerSpeed } from '../skater/board.ts'

// The line-following autopilot the NPC skaters, the Hill Bomb racers and the S.K.A.T.E. locals
// share (game/npc.ts, game/skate.ts): steer, push, slow for corners, brake. Its state is passed in,
// so a harness bot can drive the player with it too.

/** Where an autopilot is on its line: the next waypoint and the tick of its last push. */
export type FollowState = { i: number; lastUp: number }

/**
 * Ride a polyline like the rider-line autopilot: waypoints reached within `radius` (or passed),
 * pure pursuit `look` ahead, steer, push up to `target`, slow for corners, and brake (a powerslide,
 * the foot when slow) when more than `margin` over the speed the next corners allow. Null at the end.
 */
export function followLine(sim: Sim, t: Thing, n: FollowState, pts: [number, number][], radius: number, target: number, margin: number): { b: number; err: number } | null {
  const P = sim.data.physics, B = P.board, tick = sim.world.tick
  const px = t.pos.x, py = t.pos.y, speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
  // Follow the line: waypoints reached within its radius (or passed), pure pursuit `look` ahead.
  const seg = (k: number) => Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
  const along = (k: number) => ((px - pts[k - 1][0]) * (pts[k][0] - pts[k - 1][0]) + (py - pts[k - 1][1]) * (pts[k][1] - pts[k - 1][1])) / Math.max(1e-9, seg(k) * seg(k))
  const reach = Math.max(radius, 0.2 * speed)
  while (n.i < pts.length && (Math.hypot(pts[n.i][0] - px, pts[n.i][1] - py) < reach || (n.i > 0 && n.i < pts.length - 1 && along(n.i) >= 1))) n.i++
  if (n.i >= pts.length) return null
  const look = Math.max(1.2, 0.5 * (B.minRadius + (speed * speed) / B.carveAccel))
  let k = n.i, rest = look - Math.hypot(pts[n.i][0] - px, pts[n.i][1] - py)
  let wx = pts[n.i][0], wy = pts[n.i][1]
  while (rest > 0 && k + 1 < pts.length) {
    const d = seg(k + 1), u = Math.min(1, rest / d)
    wx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u; wy = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u
    rest -= d; k++
  }
  let vmax = target
  for (let c = Math.max(1, n.i); c + 1 < pts.length && c <= n.i + 2; c++) {
    const a1 = atan2(pts[c][0] - pts[c - 1][0], pts[c][1] - pts[c - 1][1]), a2 = atan2(pts[c + 1][0] - pts[c][0], pts[c + 1][1] - pts[c][1])
    const a = Math.abs(atan2(sin(a2 - a1), cos(a2 - a1)))
    if (a < 0.2) continue
    const room = 0.9 * Math.min(seg(c + 1), c === n.i ? seg(c) : Math.max(seg(c), 2))
    vmax = Math.min(vmax, Math.max(2, cornerSpeed(B, room / tan(a / 2))))
  }
  const fwd = Math.hypot(t.fwd.x, t.fwd.y) > 0.2 ? atan2(t.fwd.x, t.fwd.y) : 0
  const backward = t.vel.x * t.fwd.x + t.vel.y * t.fwd.y < -0.3
  let err = atan2(wx - px, wy - py) - (backward ? fwd + PI : fwd)
  err = atan2(sin(err), cos(err))
  let b = err > 0.06 ? Btn.right : err < -0.06 ? Btn.left : 0
  if (!backward && speed < vmax && Math.abs(err) < 1.2 && speed < P.ground.maxPushSpeed) b |= Btn.up
  else if (speed > vmax + margin) b |= speed > 9 || (speed > 2 && tick - n.lastUp < P.combo.manualWindow + 2) ? Btn.slide : tick - n.lastUp > P.combo.manualWindow + 2 ? Btn.down : 0
  if (b & Btn.up) n.lastUp = tick
  return { b, err }
}
