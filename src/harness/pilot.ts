import { Btn } from '../sim/input.ts'
import { skater, type Sim } from '../sim/sim.ts'
import type { LineInfo } from '../sim/park/source.ts'
import type { Thing } from '../sim/thing.ts'

// The rider-line autopilot (bot line in scenarios, the rider-line check in lines.ts). Pure: no Node
// imports, so the game's title attract mode (src/client/attract.ts) rides scenarios with it too.

/** The autopilot's state on a line: the next waypoint, the tick of the last push, the top speed. */
export type PilotState = { i: number; lastUp: number; maxSpeed: number; lastDown?: number }   // lastDown: the last tick S was held

/**
 * The keys the autopilot presses this tick on a rider line (null once the line is done). Shared by
 * the rider-line check and scenarios (`bot line <id>`). `target` is the cruising speed (a street
 * hill steeper than 4 degrees: 16 m/s), `t` the tick count it uses to keep S away from W.
 */
export function pilotKeys(sim: Sim, line: LineInfo, st: PilotState, t: number, target: number, who?: Thing, cars = true): number | null {
  const data = sim.data, pts = line.points, sk = who ?? skater(sim)   // who: another skater to ride it (player 2)
  let i = st.i, lastUp = st.lastUp, lastDown = st.lastDown ?? -1000
    const px = sk.pos.x, py = sk.pos.y
    const speed = Math.hypot(sk.vel.x, sk.vel.y, sk.vel.z)
    // Ride it like a person: a point reached within 1.2 m (or passed: projected past its end),
    // aim at a point `look` metres further along the line (pure pursuit, so corners are turned
    // into early), and slow for corners tighter than this speed can turn (docs/mechanics/board.md:
    // the full-lean radius is minRadius + v^2 / carveAccel).
    const B = data.physics.board
    const seg = (k: number) => Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1])
    const along = (k: number) => ((px - pts[k - 1][0]) * (pts[k][0] - pts[k - 1][0]) + (py - pts[k - 1][1]) * (pts[k][1] - pts[k - 1][1])) / Math.max(1e-9, seg(k) ** 2)
    const reach = Math.max(line.radius ?? 1.2, 0.2 * speed)   // reached within the line's radius or 0.2 s of travel
    while (i < pts.length && (Math.hypot(pts[i][0] - px, pts[i][1] - py) < reach || (i < pts.length - 1 && along(i) >= 1))) i++
    if (i >= pts.length) { st.i = i; return null }
    const look = Math.max(1.2, 0.5 * (B.minRadius + (speed * speed) / B.carveAccel))
    let k = i, rest = look - Math.hypot(pts[i][0] - px, pts[i][1] - py)
    let [wx, wy] = pts[i]
    while (rest > 0 && k + 1 < pts.length) {
      const d = seg(k + 1), u = Math.min(1, rest / d)
      wx = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * u; wy = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * u
      rest -= d; k++
    }
    let vmax = target
    for (let c = i; c + 1 < pts.length && c <= i + 2; c++) {
      const a1 = Math.atan2(pts[c][0] - pts[c - 1][0], pts[c][1] - pts[c - 1][1]), a2 = Math.atan2(pts[c + 1][0] - pts[c][0], pts[c + 1][1] - pts[c][1])
      const a = Math.abs(Math.atan2(Math.sin(a2 - a1), Math.cos(a2 - a1)))
      if (a < 0.2) continue
      const room = 0.9 * Math.min(seg(c + 1), c === i ? seg(c) : Math.max(seg(c), 2))
      const r = room / Math.tan(a / 2)
      vmax = Math.min(vmax, Math.sqrt(Math.max(4, (r - B.minRadius) * B.carveAccel)))
    }
    // City traffic: hold back behind a car in the path (no faster than it within 12 m, stop short of it).
    const hv = Math.hypot(sk.vel.x, sk.vel.y)
    if (hv > 0.5 && cars) {
      const ux = sk.vel.x / hv, uy = sk.vel.y / hv
      for (const c of sim.world.things) {
        if (c.kind !== 'car') continue
        const ox = c.pos.x - px, oy = c.pos.y - py, ahead = ox * ux + oy * uy, side = Math.abs(-ox * uy + oy * ux)
        if (Math.abs(c.pos.z - sk.pos.z) > 3) continue
        if (ahead > 0 && ahead < 12 && side < 2.2) vmax = Math.min(vmax, ahead < 5.5 ? 0 : Math.hypot(c.vel.x, c.vel.y))
        // Crossing traffic: will we meet within 1.5 s? Then wait for it.
        for (let k = 0.25; k <= 1.5; k += 0.25) if (Math.hypot(ox + (c.vel.x - sk.vel.x) * k, oy + (c.vel.y - sk.vel.y) * k) < 3.2) { vmax = 0; break }
      }
    }
    st.maxSpeed = Math.max(st.maxSpeed, speed)
    const fwd = Math.hypot(sk.fwd.x, sk.fwd.y) > 0.2 ? Math.atan2(sk.fwd.x, sk.fwd.y) : 0
    const backward = sk.vel.x * sk.fwd.x + sk.vel.y * sk.fwd.y < -0.3
    const travel = backward ? fwd + Math.PI : fwd
    let err = Math.atan2(wx - px, wy - py) - travel
    err = Math.atan2(Math.sin(err), Math.cos(err))   // positive: target is clockwise (to the right)
    let b = 0
    // Steer on the ground only: left/right in the air would spin the board.
    if (sk.state === 'ground' && err > 0.06) b |= Btn.right
    else if (sk.state === 'ground' && err < -0.06) b |= Btn.left
    const braking = sk.state === 'ground' && speed > vmax + 0.4
    // Never W right after S either: down-then-up is a nose manual (stopped behind a car, then pushing
    // off as it pulled away, it rode one into a bail on Valencia).
    const sQuiet = data.physics.combo.manualWindow + 2   // ticks after S before W
    if (!backward && speed < vmax && Math.abs(err) < 1.2 && speed < data.physics.ground.maxPushSpeed && t - lastDown > sQuiet) b |= Btn.up
    // Brake: a powerslide (a foot brake does little at speed), the foot when slow. Never S right
    // after W: up-then-down is a manual.
    else if (braking) b |= speed > 9 || (speed > 2 && t - lastUp < data.physics.combo.manualWindow + 2) ? Btn.slide : t - lastUp > data.physics.combo.manualWindow + 2 ? Btn.down : 0
    // Bombing (faster than any park line): tuck, as a rider does; it also keeps the wobble away. Kept
    // through a slide and over a crest: letting go of K (even a tick in the air) would pop an ollie.
    if (speed > 10 && (sk.state === 'ground' || (sk.state === 'air' && (sk.prevB & Btn.ollie) !== 0))) b |= Btn.ollie
    if (b & Btn.up) lastUp = t
    if (b & Btn.down) lastDown = t
    st.i = i; st.lastUp = lastUp; st.lastDown = lastDown
    return b
}
