import { BOARD, DECK_BOTTOM, HANGER_BOTTOM, kick, NOSE_TIP, TAIL_TIP } from './board.ts'
import type { BoardXf } from './poses.ts'

// Where the board touches what it grinds: the pose's board transform (the same as view.ts placeBoard,
// without the flip) applied to points on the board's underside, wheels and hangers, in stance space
// ([x toward the nose, y toward the heel side, z up], metres; the rider frame's origin is the contact
// point on the grind line). tests/trickcontact.test.ts checks every grind and slide pose with it: on
// the edge, not floating, not through the ledge or rail.

export type P3 = [number, number, number]
export type BoardPoint = { p: P3; part: 'deck' | 'wheel' | 'hanger'; x: number }

const D2R = Math.PI / 180
const rz = (p: P3, a: number): P3 => [p[0] * Math.cos(a) - p[1] * Math.sin(a), p[0] * Math.sin(a) + p[1] * Math.cos(a), p[2]]
const ry = (p: P3, a: number): P3 => [p[0] * Math.cos(a) + p[2] * Math.sin(a), p[1], -p[0] * Math.sin(a) + p[2] * Math.cos(a)]
const rx = (p: P3, a: number): P3 => [p[0], p[1] * Math.cos(a) - p[2] * Math.sin(a), p[1] * Math.sin(a) + p[2] * Math.cos(a)]

/** The pitch pivot (view.ts pivotAt): -1 tail tip, -0.5 rear axle, 0 centre, 0.5 front axle, 1 nose tip, as [x, z]. */
export function pivotAt(k: number): [number, number] {
  const pts: [number, number, number][] = [[-1, TAIL_TIP.x, TAIL_TIP.z - BOARD.thickness], [-0.5, -BOARD.axleX, 0], [0, 0, BOARD.pivotZ], [0.5, BOARD.axleX, 0], [1, NOSE_TIP.x, NOSE_TIP.z - BOARD.thickness]]
  const kk = Math.max(-1, Math.min(1, k))
  let i = 0
  while (i < pts.length - 2 && kk > pts[i + 1][0]) i++
  const u = (kk - pts[i][0]) / (pts[i + 1][0] - pts[i][0])
  return [pts[i][1] + (pts[i + 1][1] - pts[i][1]) * u, pts[i][2] + (pts[i + 1][2] - pts[i][2]) * u]
}

/** A board-space point through the pose's board transform (view.ts placeBoard, no flip). */
export function placed(b: BoardXf, p: P3): P3 {
  const [px, pz] = pivotAt(b.pivot)
  let q: P3 = [p[0], p[1], p[2]]
  // Roll (+ lifts the heel edge) about the deck's long axis at pivotZ, as the flip block does.
  q = [q[0], q[1], q[2] - BOARD.pivotZ]
  q = rx(q, b.roll * D2R)
  q = [q[0] - px, q[1], q[2] + BOARD.pivotZ - pz]
  q = ry(q, -b.pitch * D2R)
  q = rz(q, -b.yaw * D2R)
  return [q[0] + px + b.n, q[1] - b.f, q[2] + pz + b.lift]
}

/** The board's underside (centre line and both rails), wheel bottoms and hanger bottoms, placed. */
export function boardPoints(b: BoardXf): BoardPoint[] {
  const out: BoardPoint[] = []
  const half = BOARD.length / 2
  for (let i = 0; i <= 40; i++) {
    const x = -half + (BOARD.length * i) / 40
    for (const y of [-BOARD.width / 2 + 0.01, 0, BOARD.width / 2 - 0.01]) out.push({ p: placed(b, [x, y, DECK_BOTTOM + kick(x)]), part: 'deck', x })
  }
  for (const x of [-BOARD.axleX, BOARD.axleX]) {
    out.push({ p: placed(b, [x, 0, HANGER_BOTTOM]), part: 'hanger', x })
    // A wheel's lowest point and its inner and outer bottom edges (round enough for a contact check).
    for (const s of [-1, 1]) for (const w of [-BOARD.wheelW / 2, 0, BOARD.wheelW / 2]) {
      const c = placed(b, [x, s * (BOARD.wheelY + w), BOARD.wheelR])
      out.push({ p: [c[0], c[1], c[2] - BOARD.wheelR], part: 'wheel', x })
    }
  }
  return out
}

/**
 * The obstacle under a grind or slide, in stance space: the line runs along `along` (x for grinds, y
 * for slides); `far` is the unit direction across it to the far side ([0, -1] = the toe side, as [x, y]).
 * A ledge (or coping, a curb, a car's roof) is solid on the far side below the line; a rail is a bar
 * `rail` wide and deep under it, open on both sides.
 */
export type Obstacle = { kind: 'ledge' | 'rail'; far: [number, number]; rail?: number }

/** How the board meets it: the gap under the lowest point over the line (+ floating), the deepest point inside the solid. */
export function contactOf(points: BoardPoint[], o: Obstacle) {
  const across = (p: P3) => p[0] * o.far[0] + p[1] * o.far[1]
  const w = o.rail ?? 0.05
  let gap = Infinity, deepest = 0, deepWhat = ''
  for (const bp of points) {
    const s = across(bp.p), z = bp.p[2]
    if (Math.abs(s) < 0.02) gap = Math.min(gap, z)
    const inside = o.kind === 'ledge' ? s > 0.004 && z < -0.004 : Math.abs(s) < w / 2 - 0.004 && z < -0.004 && z > -w
    if (inside && z < deepest) { deepest = z; deepWhat = `${bp.part} x${bp.x.toFixed(2)}` }
  }
  return { gap, deepest, deepWhat }
}
