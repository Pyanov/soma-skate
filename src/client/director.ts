import { raycast, type Park } from '../sim/park/park.ts'
import { lineAt } from '../sim/park/grindlines.ts'
import type { SimEvent } from '../sim/sim.ts'
import type { Thing } from '../sim/thing.ts'
import { Cam, type CamPose, type V } from './camera.ts'

// The trick director (data/moments.json): slow motion and a cinematic camera at the big moments (a big air
// with a flip or grab, a special, a long grind's start, a gap). The sim never changes: slow motion is a time
// scale the frame loop applies (fewer of the sim's 120 Hz ticks per real second), so replays, hashes and the
// sim's clocks are untouched. The director steps once per sim tick from the skater and the tick's events,
// like the cameras, so play, the instant replay, the share clip and `skate clip` pick the same moments and
// shots: a swing to the open side, low, for a flip or grab (a slow orbit at a big air's peak), a push-in
// along the rail for a grind (from the side, tracking along, down a handrail or a hubba: from ahead, below,
// it filmed up the stairs and the grind read as going up), eased in and back to the chase camera by a
// critically damped spring.

export type SlowmoLevel = 'off' | 'big' | 'every'
type Thresholds = { air: { minAir: number; minHeight: number }; bigAir: { minAir: number; minHeight: number }; grind: { minSeconds: number; minSpeed: number }; gap: { minPoints: number }; special: boolean; cooldown: number }
type Shot = { deg: number; dist: number; height: number; look: number; fov: number }
export type MomentsData = {
  slowmo: { speed: number; easeIn: number; hold: number; easeOut: number; pitch: number; lowpass: number }
  levels: Record<'big' | 'every', Thresholds>
  noSlowmo: string[]
  shots: { spring: { in: number; out: number }; hold: number; swing: Shot; orbit: Shot & { turn: number }; push: { from: number; to: number; side: number; height: number; look: number; fov: number; seconds: number }; track?: { minDeg: number; dist: number; back: number; lead: number; height: number; look: number; fov: number } }
  talk?: { spring: number; angle: number; dist: number; spread: number; height: number; look: number; fov: number }
}

export type MomentKind = 'air' | 'bigAir' | 'special' | 'grind' | 'gap'
/** A moment: when it was seen, its slow motion (eased in from a0 to a1, held to b0, out by b1; ticks) and its shot. */
export type Moment = {
  kind: MomentKind; at: number
  a0: number; a1: number; b0: number; b1: number
  shot: 'swing' | 'orbit' | 'push' | 'track' | null; shotEnd: number
  dir: { x: number; y: number }; side: 1 | -1
  line: number; sign: 1 | -1
}

const smooth = (u: number) => { const t = Math.min(1, Math.max(0, u)); return t * t * (3 - 2 * t) }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

export class Director {
  /** Settings > Camera > Slow motion. */
  level: SlowmoLevel = 'big'
  /** Settings > Camera > Trick cameras (off with Reduce motion). */
  cameras = true
  /** The moment on now (its slow motion and shot), or null. */
  moment: Moment | null = null
  /** Every moment seen (tests, clip notes). */
  readonly seen: Moment[] = []
  pose: CamPose | null = null
  prev: CamPose | null = null
  /** Where the one speaking to the skater stands while a line shows (main.ts from story.ts), or null: the conversation camera. */
  talkAt: V | null = null
  private tw = 0
  private twv = 0
  private talkSide = 0
  /** How far into its shot the camera is (0 the chase camera, 1 the shot). */
  get weight() { return this.w }
  private shotM: Moment | null = null   // the last moment with a shot (it swings back after the moment ends)
  private w = 0
  private wv = 0
  private quietUntil = -Infinity
  private airFrom = -1
  private readonly hz: number
  private readonly g: number
  private readonly radius: number
  private readonly park: Park | null
  private readonly D: MomentsData

  constructor(park: Park | null, D: MomentsData, physics: { tickHz: number; gravity: number; skater: { radius: number } }) {
    this.park = park; this.D = D
    this.hz = physics.tickHz; this.g = physics.gravity; this.radius = physics.skater.radius
  }

  /** Slow motion and trick cameras run in this game: not where time matters against someone (data noSlowmo), not with two players. */
  allowed(game: string, twoPlayers: boolean) { return !twoPlayers && !this.D.noSlowmo.includes(game) }

  /** A cut (a teleport, a new run): no moment, the chase camera as it is. */
  reset() { this.moment = null; this.shotM = null; this.w = 0; this.wv = 0; this.pose = this.prev = null; this.airFrom = -1; this.quietUntil = -Infinity }

  /** The time scale at a (fractional) tick: 1, or the moment's slow motion. */
  speed(tick: number): number {
    const m = this.moment
    if (!m || m.b1 <= m.a0 || tick <= m.a0 || tick >= m.b1) return 1
    const s = this.D.slowmo.speed
    if (tick < m.a1) return 1 - (1 - s) * smooth((tick - m.a0) / Math.max(1, m.a1 - m.a0))
    if (tick <= m.b0) return s
    return s + (1 - s) * smooth((tick - m.b0) / Math.max(1, m.b1 - m.b0))
  }

  /** The effects' sound at a time scale (sound.ts slowmo): their playback rate and low-pass cutoff (Hz). */
  sound(speed: number): { rate: number; cutoff: number } {
    const S = this.D.slowmo, u = Math.min(1, Math.max(0, (1 - speed) / (1 - S.speed)))
    return { rate: 1 - (1 - S.pitch) * u, cutoff: 20000 * Math.pow(S.lowpass / 20000, u) }
  }

  /**
   * One sim tick: the skater after it, its events, the tick, the chase camera's pose this tick (and that camera,
   * whose collision keeps the shots out of walls and cars), and whether this game allows it.
   */
  step(t: Thing, ev: readonly SimEvent[], tick: number, chase: CamPose | null, cam: Cam | null, allowed: boolean) {
    for (const e of ev) {
      if (e.t === 'teleport') { this.reset(); break }
      if (e.t === 'air' || e.t === 'pop') this.airFrom = e.tick
      if (e.t === 'bail') this.cut(tick)
    }
    const m = this.moment
    if (m && (m.shot === 'push' || m.shot === 'track') && t.state !== 'grind') m.shotEnd = Math.min(m.shotEnd, tick)   // off the rail early
    if (m && tick > Math.max(m.b1, m.shotEnd)) { this.moment = null; this.quietUntil = tick + this.thresholds().cooldown * this.hz }
    const driving = t.state === 'drive'   // at the wheel of a vehicle (game/vehicles.ts): no moments, and none carried in
    if (driving) this.cut(tick)
    const slow = allowed && !driving && this.level !== 'off', cams = allowed && !driving && this.cameras && !Cam.calm
    if (!this.moment && (slow || cams) && tick >= this.quietUntil) {
      for (const e of ev) { const n = this.detect(e, t, tick, slow, cam); if (n) { this.moment = n; this.seen.push(n); if (n.shot) this.shotM = n; break } }
    }
    this.camera(t, tick, chase, cam, cams)
    this.talk(t, chase, cam)
  }

  /**
   * The conversation camera: while a line shows, both the skater and the speaker in frame at a three-quarter angle from
   * the skater's side of the pair (the side the camera already is on, so the move is short), aimed low so both stand
   * clear of the lower third where the line sits; eased in and out by a critically damped spring. Kept out of walls.
   */
  private talk(t: Thing, chase: CamPose | null, cam: Cam | null) {
    const T = this.D.talk, base = this.pose
    if (!T || !base || !chase) { this.tw = 0; this.twv = 0; return }
    const want = this.talkAt ? 1 : 0, om = T.spring, dt = 1 / this.hz
    this.twv += (-2 * om * this.twv - om * om * (this.tw - want)) * dt; this.tw += this.twv * dt
    if (want === 0 && this.tw < 1e-3 && Math.abs(this.twv) < 1e-2) { this.tw = 0; this.twv = 0; this.talkSide = 0; this.lastTalk = null }
    const S = this.talkAt ?? this.lastTalk
    if (!S || this.tw <= 0) return
    this.lastTalk = S
    const p = t.pos, ax = S.x - p.x, ay = S.y - p.y, d = Math.max(1.2, Math.hypot(ax, ay)), ux = ax / d, uy = ay / d
    if (!this.talkSide) { const cx = chase.pos.x - p.x, cy = chase.pos.y - p.y; this.talkSide = -uy * cx + ux * cy >= 0 ? 1 : -1 }
    const a = (T.angle * Math.PI) / 180, s = this.talkSide, back = T.dist + T.spread * d
    const mx = (p.x + S.x) / 2, my = (p.y + S.y) / 2, ground = Math.min(p.z, S.z)
    // From the middle of the pair: back along the line past the skater, swung angle degrees to the side.
    const dx = -ux * Math.cos(a) + s * -uy * Math.sin(a), dy = -uy * Math.cos(a) + s * ux * Math.sin(a)
    let pos: V = { x: mx + dx * back, y: my + dy * back, z: ground + T.height }
    if (cam) pos = cam.clearFor(t, pos)
    const look: V = { x: mx + ux * 0.1 * d, y: my + uy * 0.1 * d, z: ground + T.look }
    const w = Math.min(1, Math.max(0, this.tw)), lp = (q: V, r: V) => ({ x: q.x + (r.x - q.x) * w, y: q.y + (r.y - q.y) * w, z: q.z + (r.z - q.z) * w })
    this.pose = { pos: lp(base.pos, pos), look: lp(base.look, look), fov: base.fov + (T.fov - base.fov) * w, lens: (base.lens ?? 0) * (1 - w) }
  }
  private lastTalk: V | null = null

  /** The pose between the last two ticks (as Cam.at). */
  at(k: number): CamPose | null {
    if (!this.pose) return null
    const a = this.prev ?? this.pose, b = this.pose
    const lp = (p: V, q: V) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k, z: p.z + (q.z - p.z) * k })
    return { pos: lp(a.pos, b.pos), look: lp(a.look, b.look), fov: a.fov + (b.fov - a.fov) * k, lens: (a.lens ?? 0) + ((b.lens ?? 0) - (a.lens ?? 0)) * k }
  }

  private thresholds(): Thresholds { return this.D.levels[this.level === 'every' ? 'every' : 'big'] }

  /** A bail ends the moment: out of the slow motion now, the shot swings back. */
  private cut(tick: number) {
    const m = this.moment
    if (!m) return
    const eout = Math.round(this.D.slowmo.easeOut * this.hz)
    if (tick < m.b0) { m.a1 = Math.min(m.a1, tick); m.a0 = Math.min(m.a0, m.a1); m.b0 = tick; m.b1 = tick + eout }
    m.shotEnd = Math.min(m.shotEnd, tick)
  }

  /** Slow motion centred on a peak tick, never past latest (ticks); none when slow is off. */
  private envelope(at: number, peak: number, latest: number, slow: boolean, holdScale = 1) {
    if (!slow) return { a0: at, a1: at, b0: at, b1: at }
    const S = this.D.slowmo, hz = this.hz
    const ein = Math.round(S.easeIn * hz), eout = Math.round(S.easeOut * hz), hold = Math.round(S.hold * holdScale * S.speed * hz)
    let a1 = Math.round(peak - hold / 2), a0 = a1 - ein
    if (a0 < at) { a0 = at; a1 = at + ein }
    let b0 = a1 + hold, b1 = b0 + eout
    if (b1 > latest) { b1 = Math.max(a1 + eout, latest); b0 = Math.max(a1, b1 - eout) }
    return { a0, a1, b0, b1 }
  }

  /** The ground's height under a point (the park), or null. */
  private groundBelow(p: V): number | null {
    if (!this.park) return null
    const h = raycast(this.park, { x: p.x, y: p.y, z: p.z }, { x: 0, y: 0, z: -1 }, 80)
    return h ? h.point.z : null
  }

  private detect(e: SimEvent, t: Thing, tick: number, slow: boolean, cam: Cam | null): Moment | null {
    const L = this.thresholds(), hz = this.hz
    const hv = Math.hypot(t.vel.x, t.vel.y), fl = Math.hypot(t.fwd.x, t.fwd.y) || 1
    const dir = hv > 0.5 ? { x: t.vel.x / hv, y: t.vel.y / hv } : { x: t.fwd.x / fl, y: t.fwd.y / fl }
    const base = { at: tick, dir, line: -1, sign: 1 as 1 | -1 }
    if (e.t === 'trickStart' && t.state === 'air') {
      // The air ahead: ballistic from now (the sim's air is), sampled until it meets the ground under its path
      // (off the big 3 the ground drops away under the stairs), its highest point over that ground.
      const vz = t.vel.z, dts = 1 / 30
      let tLand = 0, height = 0
      for (let s = dts; s <= 3; s += dts) {
        const q = { x: t.pos.x + t.vel.x * s, y: t.pos.y + t.vel.y * s, z: t.pos.z + vz * s - 0.5 * this.g * s * s }
        const zg = this.groundBelow({ x: q.x, y: q.y, z: q.z + 0.5 })
        const over = q.z - this.radius - (zg ?? q.z - this.radius - 1)
        tLand = s
        if (over <= 0 && vz - this.g * s < 0) break
        height = Math.max(height, over)
      }
      const tUp = Math.max(0, vz / this.g)
      const air = (this.airFrom >= 0 ? (tick - this.airFrom) / hz : 0) + tLand
      const special = L.special && !!t.trick && Cam.specials.has(t.trick.id)
      const big = air >= L.bigAir.minAir && height >= L.bigAir.minHeight
      if (!special && !big && !(air >= L.air.minAir && height >= L.air.minHeight)) return null
      const peak = tick + Math.round(tUp * hz), land = tick + Math.round(tLand * hz)
      const env = this.envelope(tick, peak, land - 2, slow)
      const shot = big ? 'orbit' : 'swing'
      return { ...base, kind: special ? 'special' : big ? 'bigAir' : 'air', ...env, shot, shotEnd: Math.max(env.b1, land) + Math.round(this.D.shots.hold * hz), side: this.openSide(t, dir, shot, cam, tick) }
    }
    if (e.t === 'trickStart' && L.special && !!t.trick && Cam.specials.has(t.trick.id)) {
      const env = this.envelope(tick, tick + Math.round(0.3 * hz), tick + Math.round(1.2 * hz), slow)
      return { ...base, kind: 'special', ...env, shot: 'swing', shotEnd: env.b1 + Math.round(this.D.shots.hold * hz), side: this.openSide(t, dir, 'swing', cam, tick) }
    }
    if (e.t === 'grindStart' && t.state === 'grind' && t.grind && t.grind.car < 0 && this.park) {
      const g = t.grind, line = this.park.grind[g.line], v = Math.abs(g.speed)
      if (!line || v < L.grind.minSpeed) return null
      const secs = (g.speed >= 0 ? line.length - g.s : g.s) / v
      if (secs < L.grind.minSeconds) return null
      const end = tick + Math.round(secs * hz)
      const env = this.envelope(tick, tick, end, slow)
      const P = this.D.shots.push, K = this.D.shots.track
      // Down a sloped line (a handrail, a hubba) steeper than track.minDeg over its next 3 m (a handrail's level
      // stub at the top does not count): the tracking shot from the side.
      const p0 = lineAt(line, g.s).pos, p1 = lineAt(line, g.s + (g.speed >= 0 ? 3 : -3)).pos
      const down = (Math.atan2(p0.z - p1.z, Math.hypot(p1.x - p0.x, p1.y - p0.y)) * 180) / Math.PI
      // The tracking shot stands on the approach side (g.far: the far side is left of the line's point order; the
      // travel may run against it), where a handrail's stairs are, not in the wall beyond it.
      const sign = g.speed >= 0 ? 1 : -1, track = !!K && down >= K.minDeg
      return { ...base, kind: 'grind', ...env, shot: track ? 'track' : 'push', shotEnd: Math.min(tick + Math.round(P.seconds * hz), end - Math.round(0.1 * hz)), side: track ? (g.far * sign > 0 ? 1 : -1) : g.far > 0 ? -1 : 1, line: g.line, sign }
    }
    if (e.t === 'gap' && e.points >= L.gap.minPoints && slow) {
      const env = this.envelope(tick, tick, tick + Math.round(1.5 * hz), slow, 0.7)
      return { ...base, kind: 'gap', ...env, shot: null, shotEnd: tick, side: 1 }
    }
    return null
  }

  /** The side the swing goes to: the one the camera can see the skater from (a wall on one side), else by the tick. */
  private openSide(t: Thing, dir: { x: number; y: number }, shot: 'swing' | 'orbit', cam: Cam | null, tick: number): 1 | -1 {
    const pref: 1 | -1 = tick % 2 === 0 ? 1 : -1
    if (!cam) return pref
    const S = shot === 'orbit' ? this.D.shots.orbit : this.D.shots.swing
    for (const side of [pref, -pref as 1 | -1]) if (!cam.blockedFrom(t, this.around(t.pos, dir, side, S.deg, S.dist, S.height))) return side
    return pref
  }

  /** A point deg round from behind the skater toward side, dist out and height up. */
  private around(p: V, dir: { x: number; y: number }, side: 1 | -1, deg: number, dist: number, height: number): V {
    const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a)
    const nx = side * dir.y, ny = side * -dir.x   // side +1: right of the way it goes
    return { x: p.x + (-dir.x * c + nx * s) * dist, y: p.y + (-dir.y * c + ny * s) * dist, z: p.z + height }
  }

  /** The shot's own pose this tick, for the skater as it is now. */
  private shotPose(m: Moment, t: Thing, tick: number): CamPose {
    const S = this.D.shots, p = t.pos
    if ((m.shot === 'push' || m.shot === 'track') && this.park) {
      const P = S.push, L = this.park.grind[m.line]
      // The rail's way at the skater (its nearest segment), the way the grind goes.
      let tx = m.dir.x, ty = m.dir.y
      if (L) {
        let best = Infinity
        for (let i = 0; i + 1 < L.points.length; i++) {
          const a = L.points[i], b = L.points[i + 1], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey
          if (l2 < 1e-9) continue
          const u = Math.max(0, Math.min(1, ((p.x - a.x) * ex + (p.y - a.y) * ey) / l2)), dx = a.x + ex * u - p.x, dy = a.y + ey * u - p.y, d2 = dx * dx + dy * dy
          if (d2 < best) { best = d2; const l = Math.sqrt(l2); tx = (ex / l) * m.sign; ty = (ey / l) * m.sign }
        }
      }
      const nx = m.side * ty, ny = m.side * -tx
      if (m.shot === 'track' && S.track) {
        // Beside the rail on the approach side, a little behind, the look a little ahead: the rail runs down
        // across the frame, the way the filmer running alongside a handrail sees it.
        const K = S.track
        return { pos: { x: p.x - tx * K.back + nx * K.dist, y: p.y - ty * K.back + ny * K.dist, z: p.z + K.height }, look: { x: p.x + tx * K.lead, y: p.y + ty * K.lead, z: p.z + K.look }, fov: K.fov }
      }
      const u = smooth((tick - m.at) / (P.seconds * this.hz)), d = P.from + (P.to - P.from) * u
      return { pos: { x: p.x + tx * d + nx * P.side, y: p.y + ty * d + ny * P.side, z: p.z + P.height }, look: { x: p.x, y: p.y, z: p.z + P.look }, fov: P.fov }
    }
    const orbit = m.shot === 'orbit', sh = orbit ? S.orbit : S.swing
    const turn = orbit ? S.orbit.turn * smooth((tick - m.at) / Math.max(1, m.shotEnd - m.at)) : 0
    return { pos: this.around(p, m.dir, m.side, sh.deg + turn, sh.dist, sh.height), look: { x: p.x, y: p.y, z: p.z + sh.look }, fov: sh.fov }
  }

  /** This tick's camera: the chase camera, swung into the shot by the spring (round the skater, not through it). */
  private camera(t: Thing, tick: number, chase: CamPose | null, cam: Cam | null, cams: boolean) {
    const m = this.shotM
    // Into the shot as the slow motion starts (so the swing plays slowed), out after the shot's end.
    const target = cams && m && m === this.moment && tick >= m.a0 && tick <= m.shotEnd ? 1 : 0
    const om = target > this.w ? this.D.shots.spring.in : this.D.shots.spring.out, dt = 1 / this.hz
    this.wv += (-2 * om * this.wv - om * om * (this.w - target)) * dt
    this.w += this.wv * dt
    if (target === 0 && this.w < 1e-3 && Math.abs(this.wv) < 1e-2) { this.w = 0; this.wv = 0; if (m !== this.moment || (m && tick > m.shotEnd)) this.shotM = null }
    this.prev = this.pose
    if (!chase) { this.pose = null; return }
    const copy = (c: CamPose): CamPose => ({ pos: { ...c.pos }, look: { ...c.look }, fov: c.fov })
    if (!m || this.w <= 0) { this.pose = copy(chase); if (!this.prev) this.prev = this.pose; return }
    const shot = this.shotPose(m, t, tick)
    if (cam) shot.pos = cam.clearFor(t, shot.pos)
    const w = Math.min(1, Math.max(0, this.w)), S = t.pos
    const polar = (c: V) => ({ th: Math.atan2(c.y - S.y, c.x - S.x), r: Math.hypot(c.x - S.x, c.y - S.y), h: c.z - S.z })
    const A = polar(chase.pos), B = polar(shot.pos)
    const th = A.th + wrap(B.th - A.th) * w, r = A.r + (B.r - A.r) * w, h = A.h + (B.h - A.h) * w
    let pos: V = { x: S.x + Math.cos(th) * r, y: S.y + Math.sin(th) * r, z: S.z + h }
    // Kept out of walls and cars on the way round (the chase camera already is: eased in, so leaving it never jumps).
    if (cam) { const c = cam.clearFor(t, pos), k = Math.min(1, w * 4); pos = { x: pos.x + (c.x - pos.x) * k, y: pos.y + (c.y - pos.y) * k, z: pos.z + (c.z - pos.z) * k } }
    const lp = (a: V, b: V) => ({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w, z: a.z + (b.z - a.z) * w })
    // lens: the renderer's fisheye leans toward the trick cameras' as the shot swings in.
    this.pose = { pos, look: lp(chase.look, shot.look), fov: chase.fov + (shot.fov - chase.fov) * w, lens: w }
    if (!this.prev) this.prev = this.pose
  }
}

/** For each output frame at fps, the tick it shows, through the slow motion (frames repeat where it is slow). */
export function stretchFrames(speeds: ArrayLike<number>, from: number, to: number, hz: number, fps: number): number[] {
  const out: number[] = []
  for (let f = from; f < to;) { const i = Math.floor(f); out.push(i); f += (hz / fps) * (speeds[i] ?? 1) }
  return out
}

/** Each tick's time (seconds) in the stretched clip from `from` (the sound plays its events there). */
export function stretchTimes(speeds: ArrayLike<number>, from: number, to: number, hz: number): Float64Array {
  const out = new Float64Array(Math.max(0, to - from) + 1)
  for (let i = from; i < to; i++) out[i - from + 1] = out[i - from] + 1 / (hz * Math.max(0.05, speeds[i] ?? 1))
  return out
}
