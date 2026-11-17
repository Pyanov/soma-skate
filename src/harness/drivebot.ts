import { Btn } from '../sim/input.ts'
import type { Sim } from '../sim/sim.ts'
import type { Thing } from '../sim/thing.ts'

// The driving autopilot for scenarios (`bot drive`, docs/mechanics/driving.md): whoever it drives
// for, once they are in a vehicle, it steers along points (pure pursuit), holds a cruise speed,
// slows for the corners ahead and, at the end, brakes to a stop. Keys only, like a player: up,
// down, left, right. Harness code (not the sim): its keys are recorded, so a replay needs none of it.

export type DriveBot = { path: [number, number][]; from: number; speed: number; corner: number; lane: number; stop: boolean; i: number; done: boolean }

/** Points moved lane metres to the right of the way the path goes there (drive the right-hand lane). */
export function laned(path: [number, number][], lane: number): [number, number][] {
  if (!lane) return path
  return path.map((p, k, a) => {
    const q = a[Math.min(a.length - 1, k + 1)], o = a[Math.max(0, k - 1)], dx = q[0] - o[0], dy = q[1] - o[1], L = Math.hypot(dx, dy) || 1
    return [p[0] + (dy / L) * lane, p[1] - (dx / L) * lane]
  })
}

/** This tick's keys for skater `who`'s vehicle; 0 while it is not in one; null once stopped at the end. */
export function driveKeys(sim: Sim, who: Thing, bot: DriveBot): number | null {
  if (bot.done) return null
  const c = who.drive === undefined ? null : sim.world.things.find((t) => t.id === who.drive)
  if (!c || !c.car?.drive) return 0
  const d = c.car.drive, px = c.pos.x, py = c.pos.y, v = Math.hypot(c.vel.x, c.vel.y), pts = bot.path
  while (bot.i < pts.length && Math.hypot(pts[bot.i][0] - px, pts[bot.i][1] - py) < Math.max(4, 0.6 * v)) bot.i++
  if (bot.i >= pts.length) {
    if (!bot.stop || v < 0.2) { bot.done = true; return null }
    return Btn.down
  }
  // The point look metres on along the path.
  const look = 5 + 0.6 * v
  let k = bot.i, rest = look - Math.hypot(pts[k][0] - px, pts[k][1] - py), wx = pts[k][0], wy = pts[k][1]
  while (rest > 0 && k + 1 < pts.length) {
    const sx = pts[k + 1][0] - pts[k][0], sy = pts[k + 1][1] - pts[k][1], L = Math.hypot(sx, sy) || 1, u = Math.min(1, rest / L)
    wx = pts[k][0] + sx * u; wy = pts[k][1] + sy * u; rest -= L; k++
  }
  let e = Math.atan2(wx - px, wy - py) - d.heading
  e = Math.atan2(Math.sin(e), Math.cos(e))
  let b = e > 0.04 ? Btn.right : e < -0.04 ? Btn.left : 0
  // Corner speed for a turn of more than 30 degrees coming up: the way at a point against the way 8 m
  // on (the next segment on a path of long segments; a hairpin on a densely sampled lane).
  let want = bot.speed
  for (let j = Math.max(1, bot.i); j + 1 < pts.length && j < bot.i + 3 + Math.ceil(12 / Math.max(1, Math.hypot(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]))); j++) {
    if (Math.hypot(pts[j][0] - px, pts[j][1] - py) >= 12 + v * 1.5) break
    let k = j + 1, run = Math.hypot(pts[k][0] - pts[j][0], pts[k][1] - pts[j][1])
    while (run < 8 && k + 1 < pts.length) { run += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]); k++ }
    const a1 = Math.atan2(pts[j][0] - pts[j - 1][0], pts[j][1] - pts[j - 1][1]), a2 = Math.atan2(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
    const a = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)))
    if (a > 0.5) want = Math.min(want, bot.corner)
  }
  if (v < want - 0.4) b |= Btn.up
  else if (v > want + 1.2) b |= Btn.down
  return b
}
