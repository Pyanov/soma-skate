import type { TourLevel } from '../sim/data.ts'
import { raycast, type Park } from '../sim/park/park.ts'
import type { SimEvent } from '../sim/sim.ts'
import type { Thing } from '../sim/thing.ts'
import type { CamPose, V } from './camera.ts'

// Presentation around the runs (view only; numbers in data/presentation.json): the Tour level intro
// (a flyover of the level ending on the chase camera behind the skater, the level card over it, the
// clock held until it ends or is skipped), and the best combo of a timed run, picked from the
// comboLanded events, looped in slow motion behind the results card. Shared by the game and clips.

export type PresentData = {
  intro: { seconds: number; fovFrom: number; spreadHeight: number; minHeight: number; maxHeight: number; clear: number; ceiling: number; behind: number; behindHeight: number; swing: number; samples: number; riseStep: number; riseTries: number; wall: number
    /** A level's own numbers (any of the above), its own key poses, and a height the camera never goes over (ceilingZ: the park's freeway deck is drawn but not solid). */
    levels?: Record<string, Partial<Omit<PresentData['intro'], 'levels'>> & { path?: [number[], number[]][]; ceilingZ?: number }> }
  replay: { speed: number; lead: number; tail: number; pause: number; maxSeconds: number; minPoints: number; shift: number }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k
const lv = (a: V, b: V, k: number): V => ({ x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), z: lerp(a.z, b.z, k) })
const v = (p: number[]): V => ({ x: p[0], y: p[1], z: p[2] })

/** Catmull-Rom through key points at times ts (0..1), evaluated at u. */
function spline(keys: V[], ts: number[], u: number): V {
  let i = 0
  while (i < ts.length - 2 && u > ts[i + 1]) i++
  const s = Math.max(0, Math.min(1, (u - ts[i]) / (ts[i + 1] - ts[i] || 1)))
  const p0 = keys[Math.max(0, i - 1)], p1 = keys[i], p2 = keys[i + 1], p3 = keys[Math.min(keys.length - 1, i + 2)]
  const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * s + (2 * a - 5 * b + 4 * c - d) * s * s + (-a + 3 * b - 3 * c + d) * s * s * s)
  return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) }
}

/**
 * A level's intro flyover: from high over its S-K-A-T-E letters (the camera beyond them, looking back
 * across them), down across toward the start, round behind the skater, onto the chase camera (end).
 * The camera keeps clear of what is below it and under any ceiling over it (the freeway over the
 * park). A level may give its own key poses in data (intro.levels). Returns the pose at u (0..1).
 */
export function introPath(L: TourLevel, park: Park, sk: Thing, end: CamPose, d0: PresentData['intro']): (u: number) => CamPose {
  const d = { ...d0, ...(d0.levels?.[L.id] ?? {}) }, capZ = d0.levels?.[L.id]?.ceilingZ ?? Infinity
  const S = sk.pos, hl = Math.hypot(sk.fwd.x, sk.fwd.y) || 1, h = { x: sk.fwd.x / hl, y: sk.fwd.y / hl }
  let pos: V[], look: V[]
  const own = d0.levels?.[L.id]?.path
  if (own && own.length) {
    pos = [...own.map((k) => v(k[0])), end.pos]
    look = [...own.map((k) => v(k[1])), end.look]
  } else {
    const pts = L.letters.map((l) => v(l.pos))
    const C = pts.reduce((a, p) => ({ x: a.x + p.x / pts.length, y: a.y + p.y / pts.length, z: a.z + p.z / pts.length }), { x: 0, y: 0, z: 0 })
    const spread = Math.max(8, ...pts.map((p) => Math.hypot(p.x - C.x, p.y - C.y)))
    const dx = C.x - S.x, dy = C.y - S.y, dl = Math.hypot(dx, dy)
    const away = dl > 10 ? { x: dx / dl, y: dy / dl } : { x: h.x, y: h.y }   // from the start out across the letters
    const side = { x: -away.y, y: away.x }
    const H = Math.max(d.minHeight, Math.min(d.maxHeight, spread * d.spreadHeight))
    const A = { x: C.x + away.x * spread * 0.7 + side.x * spread * d.swing, y: C.y + away.y * spread * 0.7 + side.y * spread * d.swing, z: C.z + H }
    const M = lv(C, S, 0.55)
    const B = { x: M.x - side.x * spread * d.swing, y: M.y - side.y * spread * d.swing, z: lerp(C.z, S.z, 0.55) + H * 0.45 }
    const P = { x: S.x - h.x * d.behind + side.x * 2, y: S.y - h.y * d.behind + side.y * 2, z: S.z + d.behindHeight }
    pos = [A, B, P, end.pos]
    look = [C, lv(C, S, 0.75), { x: S.x, y: S.y, z: S.z + 0.6 }, end.look]
  }
  // Key times: the derived path lingers a little on the way down onto the chase camera; own paths evenly.
  const ts = !own?.length ? [0, 0.42, 0.78, 1] : pos.map((_, i) => i / (pos.length - 1))
  const clearView = (p: V, q: V) => {
    const dx = q.x - p.x, dy = q.y - p.y, dz = q.z - p.z, len = Math.hypot(dx, dy, dz)
    if (len > 2 && raycast(park, p, { x: dx / len, y: dy / len, z: dz / len }, len - 2)) return false
    for (const [x, y] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (raycast(park, p, { x, y, z: 0 }, d.wall)) return false
    return true
  }
  // Sample, keep each sample clear of the ground and roofs below and under a ceiling above, smooth.
  const N = d.samples, ref = S.z + 1
  const ps: V[] = [], ls: V[] = []
  for (let i = 0; i <= N; i++) {
    const u = i / N
    const p = spline(pos, ts, u), q = spline(look, ts, u)
    if (i < N) {   // the last is the chase camera itself
      // A ceiling is the underside of something (a deck: its face looks down); the inside of a
      // building's roof (its face looks up) is not one: the camera goes over that building instead.
      const up = raycast(park, { x: p.x, y: p.y, z: ref }, { x: 0, y: 0, z: 1 }, 120)
      const top = Math.min(capZ, up && park.tn[up.tri * 3 + 2] < -0.3 ? ref + up.t - d.ceiling : Infinity)
      const from = Math.min(top, ref + 150)
      const down = raycast(park, { x: p.x, y: p.y, z: from }, { x: 0, y: 0, z: -1 }, from - (park.boundsMin.z - 5))
      const floor = down ? from - down.t + d.clear : -Infinity
      p.z = Math.min(Math.max(p.z, floor), top)
      // In the open: rise (under any ceiling) until nothing is between the camera and what it looks at
      // and no wall is right beside the lens.
      for (let k = 0; k < d.riseTries && !clearView(p, q) && p.z + d.riseStep <= top; k++) p.z += d.riseStep
    }
    ps.push(p); ls.push(q)
  }
  for (let pass = 0; pass < 3; pass++) for (let i = 1; i < N; i++) ps[i].z = Math.min(capZ, Math.max(ps[i].z, (ps[i - 1].z + ps[i].z + ps[i + 1].z) / 3))
  const ease = (u: number) => u * u * (3 - 2 * u)
  return (u: number) => {
    const e = ease(Math.max(0, Math.min(1, u))) * N, i = Math.min(N - 1, Math.floor(e)), k = e - i
    return { pos: lv(ps[i], ps[i + 1], k), look: lv(ls[i], ls[i + 1], k), fov: lerp(d.fovFrom, end.fov, ease(Math.max(0, Math.min(1, u)))) }
  }
}

/** Events that start a combo (its first trick, grind, manual, lip, wallride, gap, revert or powerslide). */
const STARTS = new Set(['trickStart', 'grindStart', 'manualStart', 'lipStart', 'wallrideStart', 'wallplant', 'gap', 'revert'])

/** A combo of the run: the ticks it covers (from its pop) and what it scored. */
export type Combo = { from: number; to: number; points: number; name: string }

/**
 * The best combo of a run, from the events: it starts at the pop before its first trick (or the
 * trick), ends where it banks (comboLanded), the highest score kept. Reset when a run starts.
 */
export class BestCombo {
  best: Combo | null = null
  private from: number | null = null
  private lastPop = -1e9
  reset() { this.best = null; this.from = null; this.lastPop = -1e9 }
  /** Feed one event; true when it made a new best. */
  event(e: SimEvent): boolean {
    if (e.t === 'pop') this.lastPop = e.tick
    if ((STARTS.has(e.t) || (e.t === 'powerslide' && e.on)) && this.from === null) this.from = e.tick - this.lastPop < 90 ? this.lastPop : e.tick
    if (e.t === 'comboLost' || e.t === 'bail') this.from = null
    if (e.t === 'comboLanded') {
      const c: Combo = { from: this.from ?? e.tick - 90, to: e.tick, points: e.points, name: e.name }
      this.from = null
      if (!this.best || c.points > this.best.points) { this.best = c; return true }
    }
    return false
  }
}

/** Is this the end of a timed run (the 2-minute run, a Tour level, the Combo Challenge)? */
export const timedRunOver = (e: SimEvent) => e.t === 'runOver' || e.t === 'levelOver' || e.t === 'comboOver'
/** Does this start one (the best combo starts over)? */
export const timedRunStart = (e: SimEvent) => e.t === 'runStart' || e.t === 'levelStart' || e.t === 'comboStart'

/**
 * The replay camera turned a little so the skater sits right of centre, clear of the results card on
 * the left: the aim moves left by shift x the distance to it.
 */
export function besideCard(c: CamPose, shift: number): CamPose {
  const dx = c.look.x - c.pos.x, dy = c.look.y - c.pos.y, d = Math.hypot(dx, dy) || 1
  const lx = -dy / d, ly = dx / d   // left of the view
  return { pos: c.pos, look: { x: c.look.x + lx * shift * d, y: c.look.y + ly * shift * d, z: c.look.z }, fov: c.fov }
}

/** The slow-motion loop's frame at time t (s): index into the combo's frames, or -1 in the pause between loops. */
export function loopIndex(t: number, frames: number, hz: number, d: PresentData['replay']): number {
  const run = frames / (hz * d.speed), period = run + d.pause
  const u = t % period
  return u < run ? Math.min(frames - 1, Math.floor(u * hz * d.speed)) : -1
}
