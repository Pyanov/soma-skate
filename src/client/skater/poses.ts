import type { FlipDef, GameData } from '../../sim/data.ts'
import { Btn } from '../../sim/input.ts'
import type { Thing } from '../../sim/thing.ts'
import { bailClock, type BailStyle } from './bails.ts'
import { DEFAULT_GAIT, walkPose, type Gait, type WalkInfo } from './gait.ts'
import { BOARD, HANGER_BOTTOM } from './board.ts'
import { boardPoints, placed } from './contact.ts'

// Body poses from sim state. Pose keyframes live in data/poses.json; this file only
// decides which keyframes apply and how strongly, from the Thing's fields (state, crouch,
// charge, trick progress, grind, manual, lip, wall, timers). It is a pure function of the
// Thing and the frame's alpha, so a headless shot of a snapshot shows exactly the pose
// the game shows at that tick.
//
// Stance space (regular stance; goofy is drawn mirrored): vectors are [n, f, u] with
// n toward the nose, f toward the toe side (where the rider faces), u up.
// Rotations are [yaw, pitch, lean] in degrees: yaw turns the chest toward the nose,
// pitch bends forward toward the toes, lean tips the top toward the nose.

/** Degrees the board's nose lifts at the top of a curb roll-up (Thing.bump). */
const BUMP_PITCH = 9

export type V3 = [number, number, number]
export type Foot = { pos: V3; board: number; toe: number; tilt: number; knee: V3 }
export type Hand = { pos: V3; board: number; elbow: V3; curl: number }
export type BoardXf = { lift: number; pitch: number; roll: number; yaw: number; n: number; f: number; pivot: number }
export type Pose = {
  hips: V3; hipsRot: V3; spine: V3; head: V3
  front: Foot; back: Foot          // front foot = the one toward the nose
  lead: Hand; rear: Hand           // lead hand = the front side's hand
  board: BoardXf
}
/** pivot: where board pitch turns about. 0 = board centre, -1 = tail tip, +1 = nose tip, -0.5 / 0.5 = rear / front axle. */

export type GrabSpec = { hand: 'lead' | 'rear'; at: [number, number, number]; pose: string }
export type PoseData = {
  timing: Record<string, number>
  push: { period: number; foot: [number, number, number, number, number][]; dip: number }
  flicks: Record<string, string>
  flipHold?: Record<string, string>   // the pose held between the flick and the catch (specials: superman, 540)
  flipPivot?: Record<string, [number, number]>   // where a flip turns about, [n, u] off the deck centre (the impossible wraps round the back foot)
  flipTurn?: Record<string, [number, number, number]>   // a flip's own turn curve: [from, to, ease] of its progress (default timing.flipTurnFrom/To/Ease)
  flipTilt?: Record<string, number>   // degrees the board stands up end on mid-flip (+ nose up): a hardflip passes near vertical between the legs
  grabs: Record<string, GrabSpec>
  grinds: Record<string, string>
  slides: Record<string, string>
  lipFrame?: Record<string, 'deck' | 'ramp' | 'along'>   // how the rider stands on the coping for a lip trick (default deck: the nose over the deck)
  grindsTop?: Record<string, string>   // on a ledge, coping, a curb (a top on the far side): the pose where it differs (a feeble's front truck rests on the top)
  slidesTop?: Record<string, string>
  lips: Record<string, string>
  bail: [number, string][]
  /** Follow-through (closed-form damped responses from the Thing's own timers, so a shot of a snapshot shows what play shows). */
  follow?: Follow
  poses: Record<string, Pose>
}

/**
 * poses.json follow: weight and follow-through laid over the keyframes. Each is a damped response to an event the
 * Thing times (landing, pop, grind lock-on, the push stroke): the body moves at once (cos), the chest, head and arms a
 * quarter period later (sin), so they keep going after the hips stop and come back past rest. decay: ticks to fall to
 * 1/e; freq: radians per tick; drop: metres; pitch, nod: degrees of the chest and head bending forward; arms: metres
 * the hands sink (or, at the pop, rise) off the shoulders; armsOut: metres they swing apart along the board; jaw: how
 * far a jawed face (the skeleton) drops its jaw on landing (view.ts).
 */
export type Follow = {
  land?: { from: number; base: number; perImpact: number; decay: number; freq: number; drop: number; pitch: number; nod: number; arms: number; armsOut: number; jaw?: number }
  pop?: { decay: number; freq: number; arms: number; nod: number }
  push?: { pitch: number; arms: number; nod: number }
  grind?: { decay: number; freq: number; drop: number; arms: number; nod: number }
}

type Partial2<T> = { [K in keyof T]?: T[K] extends number[] ? T[K] : T[K] extends object ? Partial2<T[K]> : T[K] }
export type RawPoseData = Omit<PoseData, 'poses'> & { poses: Record<string, Partial2<Pose>> & { base: Pose } }

// ---- blending ----

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x))

/** Deep-merge a partial pose over a full one. */
function merge<T>(base: T, over: unknown): T {
  if (over === undefined) return clone(base)
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return clone(over as T)
  const out = clone(base) as Record<string, unknown>
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = k in out ? merge(out[k], v) : clone(v)
  return out as T
}

/** Resolve partial poses against base. A pose may name another to start from with "from". */
export function resolvePoses(raw: RawPoseData): PoseData {
  const out: Record<string, Pose> = {}
  const get = (name: string, seen: string[] = []): Pose => {
    if (out[name]) return out[name]
    const p = raw.poses[name] as Partial2<Pose> & { from?: string }
    if (!p) throw new Error(`poses.json: no pose "${name}"`)
    if (seen.includes(name)) throw new Error(`poses.json: pose cycle ${[...seen, name].join(' -> ')}`)
    const { from, ...rest } = p
    const start = name === 'base' ? (rest as Pose) : get(from ?? 'base', [...seen, name])
    out[name] = name === 'base' ? clone(rest as Pose) : merge(start, rest)
    return out[name]
  }
  for (const n of Object.keys(raw.poses)) get(n)
  return { ...raw, poses: out }
}

/** a + (b - a) * w over every number in a pose (same shape). */
export function lerpPose<T>(a: T, b: T, w: number): T {
  if (w <= 0) return a
  if (typeof a === 'number') return (a + ((b as number) - a) * Math.min(1, w)) as T
  if (Array.isArray(a)) return a.map((x, i) => lerpPose(x, (b as unknown[])[i], w)) as T
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(a as object)) out[k] = lerpPose((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], w)
  return out as T
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }
/** 0 -> 1 over [a, b], then 1 -> 0 over [c, d]. */
const window = (a: number, b: number, c: number, d: number, x: number) => smooth(a, b, x) * (1 - smooth(c, d, x))

const D2R = Math.PI / 180
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]

/** The way it travels in stance space, degrees: 0 = out to the toe side, + toward the nose (null when nearly still). */
function travelYaw(t: Thing, data: GameData): number | null {
  const v = t.vel, f = t.fwd, up = t.up
  if (Math.hypot(v.x, v.y, v.z) < 0.5) return null
  const left = { x: up.y * f.z - up.z * f.y, y: up.z * f.x - up.x * f.z, z: up.x * f.y - up.y * f.x }
  const n = v.x * f.x + v.y * f.y + v.z * f.z, toe = -(v.x * left.x + v.y * left.y + v.z * left.z) * (data.rider.stance === 'goofy' ? -1 : 1)
  return Math.atan2(n, toe) / D2R
}

/** Turn the head (then the shoulders) toward a stance-space yaw, by w. */
function lookTo(p: Pose, yaw: number, w: number) {
  let head = yaw - p.hipsRot[0] - p.spine[0], spine = 0
  if (head > 85) { spine = Math.min(30, head - 85); head = 85 } else if (head < -85) { spine = Math.max(-30, head + 85); head = -85 }
  p.head = [p.head[0] + (head - p.head[0]) * w, p.head[1], p.head[2]]
  p.spine = [p.spine[0] + spine * w, p.spine[1], p.spine[2]]
}

/**
 * Ticks since a revert (-1: none), from the Thing alone: the sim spins the board round at once, adds
 * Revert to the combo and restarts the landing grace, and banks it when the grace runs out.
 */
export function revertTicks(t: Thing, data: GameData, alpha: number): number {
  if (t.state !== 'ground') return -1
  const G = data.physics.combo.graceTicks
  if (t.combo[t.combo.length - 1]?.id === 'revert' && t.landGrace > 0) return G - t.landGrace + alpha
  const L = t.lastLand
  if (L && L.bankTick > L.tick && L.combo.endsWith('Revert')) {
    const age = L.tick + t.stateTicks - (L.bankTick - G) + alpha
    return age >= 0 && age < 120 ? age : -1
  }
  return -1
}

/** The revert's swivel still to go, degrees about the up axis (0 when done): the board and body spin round fast, easing in. */
export function revertSwivel(t: Thing, data: GameData, alpha: number, P: PoseData): number {
  const r = revertTicks(t, data, alpha), n = P.timing.revertTicks ?? 10
  if (r < 0 || r >= n) return 0
  const u = clamp01(r / n)
  return 180 * (1 - u * u * (3 - 2 * u))   // smoothstep: out of the turn and settling square
}

// ---- the evaluator ----

export type Eval = {
  pose: Pose
  flip: { roll: number; yaw: number; pitch: number; pivot: [number, number] }   // board flip, in turns (eased from the sim's progress), about pivot [n, u] off the deck centre
  grab: { hand: 'lead' | 'rear'; at: [number, number, number]; w: number } | null
  tag: string                                          // what the solver picked, for strips and debugging
  walk: WalkInfo | null                                // on foot: the gait's phase and the board pickup
  reach: { hand: 'lead' | 'rear'; at: V3 } | null      // a hand on something off the board (a car's bumper), rider-frame [n, f, u]
  lean: number                                         // the carve's deck roll, degrees (+ = right edge down), for the trucks
}

/** A character's flair on tricks: its flip catch, how it tweaks grabs, where the free arm goes. */
export type Flair = { catch?: string; tweak?: [number, number, number]; free?: V3; bail?: BailStyle }

/**
 * A pose the other way along the board, for a pop off the nose: the foot on the popping end and the one
 * sliding up swap ends (the front foot pops the nose, the back foot slides back toward the tail), the
 * board pitches the other way about the other end.
 */
export function mirrorAlong(p: Pose): Pose {
  const q = clone(p)
  const f = q.front, b = q.back
  q.front = { ...f, pos: [-b.pos[0], b.pos[1], b.pos[2]], board: b.board, tilt: b.tilt }
  q.back = { ...b, pos: [-f.pos[0], f.pos[1], f.pos[2]], board: f.board, tilt: f.tilt }
  q.hips = [-q.hips[0], q.hips[1], q.hips[2]]
  q.hipsRot = [q.hipsRot[0], q.hipsRot[1], -q.hipsRot[2]]
  q.spine = [q.spine[0], q.spine[1], -q.spine[2]]
  q.head = [q.head[0], q.head[1], -q.head[2]]
  q.board = { ...q.board, pitch: -q.board.pitch, yaw: -q.board.yaw, pivot: -q.board.pivot, n: -q.board.n }
  return q
}

/** The flip a double tap makes this one into (a base flip) or made it from (a variant), or null. */
function tapPartner(data: GameData, def: FlipDef): FlipDef | null {
  const F = data.tricks.flips
  if (!F.includes(def)) return null
  // The slot's next tap (a single's double, a double's triple), else the one before it (the same direction, pressed twice or not).
  const same = (x: FlipDef) => x !== def && x.dir === def.dir && !!x.twice === !!def.twice, n = def.taps ?? 1
  return F.find((x) => same(x) && (x.taps ?? 1) === n + 1) ?? F.find((x) => same(x) && (x.taps ?? 1) === n - 1) ?? null
}

/** The far side of what it grinds, a horizontal world direction: grinds, the chest side when frontside (toe side), else the heel side; slides (dir +1 nose over it, -1 back over the approach side), along the board. */
function farSide(t: Thing, data: GameData, slideNose: number, fs: boolean): [number, number] {
  const h = Math.hypot(t.fwd.x, t.fwd.y) || 1, fx = t.fwd.x / h, fy = t.fwd.y / h
  if (slideNose) return [fx * slideNose, fy * slideNose]
  const toe = data.rider.stance === 'goofy' ? -1 : 1
  const k = fs ? toe : -toe
  return [fy * k, -fx * k]
}

/** A surface level with the line 12 cm out on the far side (ground: the park's height under a point). */
function farTop(t: Thing, data: GameData, far: [number, number], ground: Ground): boolean {
  const z = t.pos.z - data.physics.skater.radius
  const h = ground(t.pos.x + far[0] * 0.12, t.pos.y + far[1] * 0.12, z + 0.05)
  return h !== null && Math.abs(h - z) < 0.03
}

/**
 * Put the board on the line (stance space, the line through the origin): grinds, the hanger of the
 * grinding truck (the pivot's end; both for a 50-50) on the edge; slides, the board resting on what it
 * slides (on a ledge or coping the top on the far side holds it too), lowest point on it.
 */
function seat(b: BoardXf, slide: boolean, far: [number, number], top: boolean) {
  if (!slide) {
    const xs = b.pivot < -0.25 ? [-BOARD.axleX] : b.pivot > 0.25 ? [BOARD.axleX] : [-BOARD.axleX, BOARD.axleX]
    let y = 0, z = 0
    for (const x of xs) { const p = placed(b, [x, 0, HANGER_BOTTOM]); y += p[1] / xs.length; z += p[2] / xs.length }
    b.f += y; b.lift -= z
    return
  }
  // Slides: the support under each point (the rail's top, 5 cm wide; a ledge's top on the far side).
  let rise = -Infinity
  for (const bp of boardPoints(b)) {
    const s = bp.p[0] * far[0] + bp.p[1] * far[1]
    if (top ? s > -0.004 : Math.abs(s) < 0.025) rise = Math.max(rise, -bp.p[2])
  }
  if (rise > -Infinity) b.lift += rise
}

/** A grind or slide's pose (g: which kind, side and stance it is ridden in), backside and switch turned to suit, seated on the line. */
function grindPoseOf(t: Thing, data: GameData, P: PoseData, ground: Ground | null, g: { slide: boolean; fs: boolean; stance?: 'fakie' | 'nollie' | 'switch' }, id: string): Pose {
  const pick = (name: string) => P.poses[name] ?? P.poses.base
    const def = (g.slide ? data.tricks.slides : data.tricks.grinds).find((x) => x.id === id)
    // Riding switch the rider's nose and front truck are the board's tail and back truck: the pose the other way along the board.
    const sw = g.stance === 'switch' ? -1 : 1
    const far = farSide(t, data, g.slide ? (def?.nose === 'near' ? -1 : 1) * sw : 0, g.fs)
    const top = !!ground && farTop(t, data, far, ground)
    const name = (top ? (g.slide ? P.slidesTop : P.grindsTop)?.[id] : undefined) ?? (g.slide ? P.slides[id] ?? P.slides.boardslide : P.grinds[id] ?? P.grinds['5050'])
    const pose = sw < 0 ? mirrorAlong(pick(name)) : clone(pick(name))
    // Grind poses are written frontside (the far side of the rail is the toe side). Backside mirrors
    // the board's angle across the rail, and the body's lean and reach over it about the 50-50's.
    if (!g.slide && !g.fs) {
      pose.board.yaw *= -1; pose.board.roll *= -1; pose.board.f *= -1
      // The backside body is its own stance (poses.json gBsBody), not the frontside one mirrored: the back to
      // the obstacle, the hips over the edge behind the heels, bent forward over the toes against it,
      // shoulders open toward travel, the front arm out down the edge and the rear arm back over the toes.
      // The grind keeps its legs, its weight along the board (hips n, height) and its lean.
      const ref = pick(P.grinds['5050']), bs = pick('gBsBody')
      pose.hips = [pose.hips[0], 2 * ref.hips[1] - pose.hips[1] + bs.hips[1], pose.hips[2]]
      pose.hipsRot = [bs.hipsRot[0], bs.hipsRot[1], pose.hipsRot[2]]
      pose.spine = [bs.spine[0], bs.spine[1], pose.spine[2]]
      pose.head = [bs.head[0], bs.head[1], pose.head[2]]
      pose.lead = { ...pose.lead, pos: lerpPose(pose.lead.pos, bs.lead.pos, 0.75), elbow: bs.lead.elbow }
      pose.rear = { ...pose.rear, pos: lerpPose(pose.rear.pos, bs.rear.pos, 0.75), elbow: bs.rear.elbow }
    }
    // Seat the board on the line: the grinding truck's hanger on the edge (both for a 50-50), a slide's
    // underside on it, whatever the pose's roll and yaw did to them.
    seat(pose.board, g.slide, g.slide ? [(def?.nose === 'near' ? -1 : 1) * sw, 0] : [0, g.fs ? -1 : 1], top)
    // Slides face the way they go or slide blind (see the grind branch).
    if (g.slide) {
      const blind = ((def?.nose === 'far') !== (sw < 0)) === g.fs
      if (blind) {
        lookTo(pose, 160, 1)
        pose.spine = [pose.spine[0] + 25, pose.spine[1], pose.spine[2]]
        pose.hipsRot = [pose.hipsRot[0] + 12, pose.hipsRot[1], pose.hipsRot[2]]
        pose.lead.pos = add(pose.lead.pos, [0.06, -0.3, 0.12], 1)
        pose.rear.pos = add(pose.rear.pos, [-0.12, 0.32, 0.04], 1)
      } else {
        lookTo(pose, 0, 0.9)
        pose.lead.pos = add(pose.lead.pos, [0.08, 0.14, 0.1], 1)
        pose.rear.pos = add(pose.rear.pos, [-0.08, 0.14, 0.1], 1)
      }
    }
    return pose
}

export type Ground = (x: number, y: number, z: number) => number | null

export function evaluate(t: Thing, data: GameData, alpha: number, P: PoseData, gait: Gait = DEFAULT_GAIT, flair: Flair = {}, ground: Ground | null = null): Eval {
  const T = P.timing, poses = P.poses
  const pick = (name: string) => poses[name] ?? poses.base
  let pose = clone(poses.base)
  const flip: Eval['flip'] = { roll: 0, yaw: 0, pitch: 0, pivot: [0, 0] }
  let grab: Eval['grab'] = null
  let walk: WalkInfo | null = null
  let reach: Eval['reach'] = null
  let lean = 0
  let tag: string = t.state
  const ticks = t.stateTicks + alpha

  if (t.state === 'ground') {
    const along = t.vel.x * t.fwd.x + t.vel.y * t.fwd.y + t.vel.z * t.fwd.z
    const pushing = !t.manual && !t.crouch && (t.prevB & Btn.up) !== 0 && along < data.physics.ground.maxPushSpeed && along > -0.5
    if (pushing) {
      // The push stroke: back foot steps off, kicks the ground beside the board, steps back on.
      const phase = (ticks % P.push.period) / P.push.period
      pose = lerpPose(pose, pick('push'), smooth(0, 6, ticks))
      const k = P.push.foot
      let i = 0
      while (i < k.length - 2 && phase > k[i + 1][0]) i++
      const u = clamp01((phase - k[i][0]) / Math.max(1e-6, k[i + 1][0] - k[i][0]))
      const s = u * u * (3 - 2 * u)
      const f = k[i].map((v, j) => v + (k[i + 1][j] - v) * s)
      const w = smooth(0, 6, ticks)
      pose.back.pos = lerpPose(pose.back.pos, [f[1], f[2], f[3]] as V3, w)
      pose.back.board = pose.back.board + (f[4] - pose.back.board) * w
      // Stroke: the standing leg dips while the foot is on the ground.
      pose.hips[2] -= P.push.dip * Math.sin(Math.PI * clamp01((phase - k[1][0]) / (k[k.length - 2][0] - k[1][0]))) * w
      // The stroke's weight (follow.push): the chest bends in as the foot drives back, the arms swing against
      // the leg (the lead arm forward as the back foot kicks back), the head steadies the other way.
      const FU = P.follow?.push
      if (FU) {
        const sw = Math.sin(2 * Math.PI * phase) * w, drive = Math.sin(Math.PI * clamp01((phase - k[1][0]) / (k[k.length - 2][0] - k[1][0]))) * w
        pose.spine[1] += FU.pitch * drive
        pose.head[1] -= FU.nod * drive
        if (pose.lead.board === 0) pose.lead.pos = add(pose.lead.pos, [FU.arms, 0, 0], sw)
        if (pose.rear.board === 0) pose.rear.pos = add(pose.rear.pos, [FU.arms, 0, 0], sw)
      }
      tag = 'push'
    }
    if (t.crouch) { pose = lerpPose(pose, pick('crouch'), smooth(0, T.crouchTicks, t.charge + alpha)); tag = 'crouch' }
    if (t.airTicks > T.landMinAir && ticks < T.landTicks) {
      const k = Math.sin(Math.PI * clamp01(ticks / T.landTicks)) * clamp01(t.airTicks / 80 + 0.3)
      pose = lerpPose(pose, pick('land'), k)
      if (!t.manual) tag = ticks < T.landTicks * 0.5 ? 'land' : tag
    }
    // Landing weight (follow.land): the hips sink further the harder it lands and settle back past rest; the chest
    // and head bend in a beat later and the arms keep falling after the body has stopped, then come back.
    const FL = P.follow?.land
    if (FL && t.airTicks > T.landMinAir && ticks < FL.decay * 6) {
      const amp = Math.min(1.3, FL.base + Math.max(0, (t.lastLand?.impact ?? 0) - FL.from) * FL.perImpact) * clamp01(t.airTicks / 60 + 0.4)
      const env = Math.exp(-ticks / FL.decay), wv = ticks * FL.freq
      const body = env * Math.cos(wv) * smooth(0, 2, ticks), lag = env * Math.sin(wv) * smooth(0, 5, ticks)
      pose.hips[2] -= FL.drop * amp * body
      pose.spine[1] += FL.pitch * amp * lag
      pose.head[1] += FL.nod * amp * lag
      if (pose.lead.board === 0) pose.lead.pos = add(pose.lead.pos, [FL.armsOut, 0, -FL.arms], amp * lag)
      if (pose.rear.board === 0) pose.rear.pos = add(pose.rear.pos, [-FL.armsOut, 0, -FL.arms], amp * lag)
    }
    if (t.manual) {
      // Manuals: back over the tail, nose up; nose manuals the other way, over the nose. The balance
      // meter (+ = tipping toward the nose) leans the body and drops the raised end, and the arms work
      // against it: both reach toward the high end, up as it gets worse, windmilling near the edge.
      const nose = t.manual.id === 'nosemanual', b = t.manual.balance, mt = t.manual.ticks + alpha
      const m = lerpPose(pose, pick(nose ? 'nosemanual' : 'manual'), smooth(0, 8, mt))
      m.hipsRot[2] += b * T.manualBalanceLean
      m.spine[2] += b * T.manualBalanceLean * 0.5
      m.board.pitch -= b * T.manualBalancePitch
      const A = T.manualArms ?? 0.26, wm = smooth(0.55, 0.95, Math.abs(b)) * (T.windmill ?? 0.17)
      m.lead.pos = add(m.lead.pos, [-b * A + Math.sin(mt * 0.4) * wm, 0, Math.abs(b) * A * 0.6 + Math.cos(mt * 0.4) * wm])
      m.rear.pos = add(m.rear.pos, [-b * A - Math.sin(mt * 0.4) * wm, 0, Math.abs(b) * A * 0.6 - Math.cos(mt * 0.4) * wm])
      pose = m
      tag = t.manual.id + (Math.abs(b) > 0.6 ? (b > 0 ? ' tipping nose' : ' tipping tail') : '')
    }
    // A curb roll-up (the sim's curbHop; Thing.bump counts down from ground.curbHopBumpTicks): the front
    // wheels lift over the kerb and come down, the board pivoting on its back wheels.
    if (t.bump) { pose.board.pitch += BUMP_PITCH * Math.sin(Math.PI * clamp01(1 - (t.bump - alpha) / data.physics.ground.curbHopBumpTicks)); pose.board.pivot = -0.5 }
    // Revert: crouched, arms out, through the swivel (view.ts turns the board and body round).
    const rv = revertTicks(t, data, alpha)
    if (rv >= 0) {
      const n = T.revertTicks ?? 10, w = window(0, 2, n, n + (T.revertSettle ?? 18), rv)
      if (w > 0) { pose = lerpPose(pose, pick('revert'), w); if (rv < n + 4) tag = 'revert' }
    }
    // Rolling backward the rider looks back over the shoulder, turning to it over the first ticks on the
    // ground (it switched on at the landing tick: a 54 degree head snap after every fakie landing) and as
    // the roll backward picks up.
    const fl = clamp01((-along - 0.3) / 0.8) * smooth(0, T.fakieLookTicks ?? 10, ticks)
    if (fl > 0) pose.head = lerpPose(pose.head, pick('fakieLook').head, fl)
    // Board physics (docs/mechanics/board.md): the deck rolls with the sim's lean (+ = the board's
    // right edge down; poses are written regular, so goofy flips it) and the body tips into the carve.
    const goofy = data.rider.stance === 'goofy' ? -1 : 1
    const leanDeg = ((t.lean ?? 0) * 180) / Math.PI * goofy
    const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
    // A tuck at speed (crouch held on a hill): chest down over the front knee, arms behind, chin up.
    if (t.crouch && !t.manual) pose = lerpPose(pose, pick('bombTuck'), smooth(5, 9, speed))
    pose.board.roll += leanDeg
    lean = leanDeg
    pose.hipsRot[1] += leanDeg * (T.leanBody ?? 0)
    // Carving: knees give with the lean, arms open for balance; a slip shifts the weight against it.
    // (Exaggerated a little so a carve reads from the chase camera.)
    const carve = Math.min(1, Math.abs(leanDeg) / 20)
    if (carve > 0 && !t.manual && !t.crouch) {
      pose = lerpPose(pose, pick('crouch'), carve * 0.5)
      const fw = Math.sign(leanDeg) * 0.12 * carve
      pose.hips = [pose.hips[0], pose.hips[1] + Math.sign(leanDeg) * 0.07 * carve, pose.hips[2]]
      pose.lead.pos = [pose.lead.pos[0] + 0.16 * carve, pose.lead.pos[1] + fw, pose.lead.pos[2] + 0.24 * carve]
      pose.rear.pos = [pose.rear.pos[0] - 0.16 * carve, pose.rear.pos[1] + fw, pose.rear.pos[2] + 0.2 * carve]
      pose.head = [pose.head[0] + Math.sign(leanDeg) * 10 * carve, pose.head[1], pose.head[2]]
    }
    const slipF = Math.max(-1, Math.min(1, (t.slip ?? 0) * goofy / 1.2))
    pose.hips[1] -= 0.05 * slipF
    pose.hipsRot[1] -= 8 * slipF
    if (t.powerslide) {
      // Board across the travel: travelling toward the toes the rider sits back on the heels with
      // the trailing hand down behind; toward the heels, over the toes with a hand down in front.
      const up = t.up, f = t.fwd
      const left = { x: up.y * f.z - up.z * f.y, y: up.z * f.x - up.x * f.z, z: up.x * f.y - up.y * f.x }
      const toToes = -(t.vel.x * left.x + t.vel.y * left.y + t.vel.z * left.z) * goofy > 0
      pose = lerpPose(pose, pick(toToes ? 'slideHeel' : 'slideToe'), smooth(0, 8, ticks))
      // The swivel into it: the shoulders lag the board as it swings across, then catch up.
      const sw = (T.slideTwist ?? 30) * window(0, 2, 5, 16, ticks) * (t.powerslide > 0 ? 1 : -1) * goofy
      pose.spine = [pose.spine[0] - sw, pose.spine[1], pose.spine[2]]
      pose.hipsRot = [pose.hipsRot[0] - sw * 0.5, pose.hipsRot[1], pose.hipsRot[2]]
      tag = toToes ? 'powerslide heelside' : 'powerslide toeside'
      // Bert slide (crouched at speed): lower, the planted hand further out, carving round it.
      if ((t.bertTicks ?? 0) > 0) {
        pose = lerpPose(pose, pick(toToes ? 'bertHeel' : 'bertToe'), smooth(0, 12, t.bertTicks))
        tag = toToes ? 'bert slide heelside' : 'bert slide toeside'
      }
    }
    // Skitching: low, leaning toward the car, one hand on its bumper (toward the leading end of the
    // board), the body tipping with the balance like a grind, the free arm out against it.
    if (t.skitch) {
      const k = t.skitch, lead = k.lead >= 0 ? 1 : -1
      let s = clone(pick('skitch'))
      if (lead < 0) {
        // Towed tail first: the same pose mirrored along the board, the rear hand on the bumper.
        const m = (v: V3): V3 => [-v[0], v[1], v[2]]
        s = { ...s, hips: m(s.hips), hipsRot: [-s.hipsRot[0], s.hipsRot[1], -s.hipsRot[2]], spine: [-s.spine[0], s.spine[1], -s.spine[2]], head: [-s.head[0], s.head[1], -s.head[2]],
          lead: { ...s.rear, pos: m(s.rear.pos), elbow: m(s.rear.elbow) }, rear: { ...s.lead, pos: m(s.lead.pos), elbow: m(s.lead.elbow) } }
      }
      s.front = pose.front; s.back = pose.back; s.board = pose.board
      pose = s
      pose.hipsRot[1] += k.balance * T.grindBalanceLean
      const free = lead > 0 ? pose.rear : pose.lead
      free.pos = [free.pos[0], free.pos[1] - k.balance * 0.25, free.pos[2] + Math.abs(k.balance) * 0.25]
      const B = data.traffic.skitch
      reach = { hand: lead > 0 ? 'lead' : 'rear', at: [lead * (B.behind + 0.04), 0, 0.8] }
      tag = Math.abs(k.balance) > 0.65 ? 'skitch wobbly' : 'skitch'
    }
    // Riding a car roof: knees soft, arms out like surfing; just after landing on it, an uh-oh windmill.
    if ((t.carRide ?? -1) >= 0 && !t.powerslide) {
      pose = lerpPose(pose, pick('carSurf'), smooth(0, 10, ticks))
      const uh = 1 - smooth(25, 70, ticks)
      if (uh > 0) {
        pose.lead.pos = [pose.lead.pos[0] + Math.sin(ticks * 0.45) * 0.2 * uh, pose.lead.pos[1] + 0.1 * uh, pose.lead.pos[2] + (0.25 + Math.cos(ticks * 0.45) * 0.2) * uh]
        pose.rear.pos = [pose.rear.pos[0] + Math.sin(ticks * 0.45 + 2.5) * 0.2 * uh, pose.rear.pos[1] + 0.1 * uh, pose.rear.pos[2] + (0.25 + Math.cos(ticks * 0.45 + 2.5) * 0.2) * uh]
        pose.hipsRot[2] += Math.sin(ticks * 0.3) * 10 * uh
      }
      tag = uh > 0.3 ? 'car roof uh-oh' : 'car surfing'
    }
    // Speed wobble: the arms flail more as it grows, the body sways with the deck.
    const wob = t.wobble ?? 0
    if (wob > 0.02) {
      const ph = t.wobblePhase ?? 0
      pose.lead.pos = [pose.lead.pos[0] + Math.sin(ph) * 0.18 * wob, pose.lead.pos[1] + Math.cos(ph * 1.3) * 0.16 * wob, pose.lead.pos[2] + (0.25 + Math.sin(ph * 0.7) * 0.18) * wob]
      pose.rear.pos = [pose.rear.pos[0] - Math.sin(ph + 1.5) * 0.18 * wob, pose.rear.pos[1] + Math.cos(ph * 1.1 + 2) * 0.16 * wob, pose.rear.pos[2] + (0.25 + Math.cos(ph * 0.8) * 0.18) * wob]
      pose.hipsRot[2] += Math.sin(ph) * 9 * wob
      pose.spine[2] -= Math.sin(ph + 0.6) * 7 * wob
      pose.head[2] += Math.sin(ph * 1.7) * 6 * wob
      if (wob > 0.25) tag = `wobble ${Math.round(wob * 100)}%`
    }
  } else if (t.state === 'walk') {
    // On foot (gait.ts): the character's own walk and run from the metres walked, jumps and climbs;
    // view.ts places the carried board from where the carrying shoulder ends up.
    const r = walkPose(clone(pick('walk')), t, data, alpha, gait)
    pose = r.pose
    walk = r.info
    tag = r.info.tag
  } else if (t.state === 'air') {
    const s = ticks
    // Popped off the nose (nollie, switch): the pop and the flick the other way along the board.
    const nose = t.stance === 'nollie' || t.stance === 'switch'
    const popPose = (name: string) => (nose ? mirrorAlong(pick(name)) : pick(name))
    if (t.popped) {
      // Ollie: pop (tail snaps, front foot slides up), tuck, then reach for the landing.
      pose = lerpPose(pose, pick('crouch'), 1 - smooth(0, 3, s))
      pose = lerpPose(pose, popPose('pop'), window(0, 2, 6, 15, s))
      pose = lerpPose(pose, pick('tuck'), smooth(5, 18, s))
      // follow.pop: the arms keep rising after the snap and float back; the head dips a beat behind the body.
      const FP = P.follow?.pop
      if (FP) {
        const lag = Math.exp(-s / FP.decay) * Math.sin(s * FP.freq)
        if (pose.lead.board === 0) pose.lead.pos = add(pose.lead.pos, [0, 0, FP.arms], lag)
        if (pose.rear.board === 0) pose.rear.pos = add(pose.rear.pos, [0, 0, FP.arms], lag)
        pose.head[1] += FP.nod * lag
      }
      tag = s < 8 ? 'pop' : 'ollie'
    } else {
      pose = lerpPose(pose, pick(t.vertAir ? 'airVert' : 'airDrop'), smooth(0, 10, s))
      tag = t.vertAir ? 'vert air' : 'drop'
    }
    // The reach for the landing grows with the drop from the top of the air (continuous, unlike the fall
    // speed, which stops dead when the board touches a rail or a corner without landing).
    const reach = clamp01((t.airPeakZ - t.pos.z) / (T.landReachDrop ?? 0.35))
    if (!t.trick) pose = lerpPose(pose, pick('airLand'), reach)
    // Just off a rail or ledge (Thing.left: the grind or slide this air left): out of its pose into the air
    // over grindOutTicks (rolling off a slide's end the arms jumped 145 degrees in a tick).
    if (t.left && s < (T.grindOutTicks ?? 8)) {
      const from = grindPoseOf(t, data, P, ground, t.left, t.left.id)
      // Popped off it, the rider was crouched on the rail (the grind's crouch, as K was held).
      pose = lerpPose(t.popped ? lerpPose(from, pick('grindCrouch'), 1) : from, pose, smooth(0, T.grindOutTicks ?? 8, s))
    }
    // Spine transfer: over the ridge the arms open wide and the body twists toward the far side,
    // looking down at the landing, most at the top of the arc.
    if (t.spine) {
      const w = clamp01(1 - Math.abs(t.vel.z) / 4)
      pose.lead.pos = [pose.lead.pos[0] + 0.25 * w, pose.lead.pos[1] - 0.05 * w, pose.lead.pos[2] + 0.4 * w]
      pose.rear.pos = [pose.rear.pos[0] - 0.25 * w, pose.rear.pos[1] - 0.05 * w, pose.rear.pos[2] + 0.4 * w]
      pose.spine = [pose.spine[0] + 45 * w, pose.spine[1], pose.spine[2]]
      pose.head = [pose.head[0] + 20 * w, pose.head[1] + 25 * w, pose.head[2]]
      if (w > 0.5) tag = 'spine transfer'
    }
    // Foot tricks at the pop: Boneless (the front foot plants on the ground, a hand grabs the board,
    // jump off the planted foot) and No Comply (the back foot steps off and down, the front pops it).
    if (t.footTrick === 'boneless') {
      const w = window(0, 2, 9, 20, s)
      pose = lerpPose(pose, pick('boneless'), w)
      grab = { hand: 'rear', at: [-0.02, 0.1, -0.006], w: window(0, 3, 14, 24, s) }
      tag = s < 14 ? 'boneless' : tag
    } else if (t.footTrick === 'nocomply') {
      pose = lerpPose(pose, pick('nocomply'), window(0, 2, 7, 16, s))
      tag = s < 12 ? 'no comply' : tag
    }
    const tr = t.trick
    const airBase = pose   // the air pose without the trick: a flip eases back into it as it ends (no snap when it does)
    if (tr && tr.kind === 'flip') {
      const def = (data.tricks.flips.find((x) => x.id === tr.id) ?? data.tricks.specials.find((x) => x.id === tr.id)) as FlipDef | undefined
      if (def) {
        const q = clamp01((tr.tick + alpha) / def.ticks)   // the sim's trick progress
        // The board turns fastest right off the flick and is round by the time the feet come down on it.
        // (a flip may turn on its own curve: the impossible wraps round the back foot evenly, upside down over it half way)
        const [t0, t1, ease] = P.flipTurn?.[tr.id] ?? [T.flipTurnFrom ?? 0.05, T.flipTurnTo ?? 0.8, T.flipTurnEase ?? 1.7]
        const r = 1 - Math.pow(1 - clamp01((q - t0) / (t1 - t0)), ease)
        // The double tap: until its window closes the flip may still turn into its slot's variant (or just
        // did), so only what the two share is drawn (a kickflip's roll, but not an impossible's pitch that
        // an FS Shove-It would not have), easing into its own turn as the window closes.
        let { roll, yaw, pitch } = def
        let tilt = P.flipTilt?.[tr.id] ?? 0
        const other = tapPartner(data, def)
        if (other) {
          const W = data.tricks.doubleTapTicks, k = (other.taps ?? 1) < (def.taps ?? 1) ? smooth(0, W, tr.tick + alpha) : smooth(W, W + 6, tr.tick + alpha)
          const share = (a: number, b: number) => (Math.sign(a) === Math.sign(b) ? a : 0) + (a - (Math.sign(a) === Math.sign(b) ? a : 0)) * k
          roll = share(def.roll, other.roll); yaw = share(def.yaw, other.yaw); pitch = share(def.pitch, other.pitch)
          tilt = share(tilt, P.flipTilt?.[other.id] ?? 0)
        }
        // Off the nose the board scoops the other way round (a nollie backside shove-it swings the nose
        // behind the rider, an impossible wraps round the front foot); kickflips still dip the heel edge.
        const m = nose ? -1 : 1
        flip.roll = roll * r; flip.yaw = m * yaw * r; flip.pitch = m * pitch * r
        // A 360 shove (360 Shove-It, 360 Flip, Laser Flip) counts the board's turns over the ground: with
        // the body turning the same way (a Bigspin: BS 360 shove-it, BS 180 body) the board turns that
        // much less under the feet, so it goes round 360 while the rider goes round 180.
        const body = (-t.spin / (2 * Math.PI)) * (data.rider.stance === 'goofy' ? -1 : 1)
        if (Math.abs(yaw) >= 1 && Math.sign(body) === Math.sign(flip.yaw)) flip.yaw = Math.sign(flip.yaw) * Math.max(0, Math.abs(flip.yaw) - Math.abs(body))
        const bigspin = Math.abs(yaw) >= 1 && roll === 0 && Math.sign(body) === Math.sign(m * yaw) && Math.abs(body) > 0.04
        flip.pivot = P.flipPivot?.[tr.id] ?? [0, 0]
        if (nose) flip.pivot = [-flip.pivot[0], flip.pivot[1]]
        // Hardflip, inward heelflip: the shove and the flip together stand the board up on end between the
        // legs half way round (tail up), then it comes back flat for the catch.
        flip.pitch += ((m * tilt) / 360) * Math.sin(Math.PI * r)
        const flick = P.flicks[tr.id] ?? (def.roll < 0 ? 'flickHeel' : def.roll > 0 ? 'flickKick' : 'flickShove')
        pose = lerpPose(pose, popPose(flick), window(0, T.flickIn, T.flickOut, T.flickOut + 0.1, q))
        pose = lerpPose(pose, pick(P.flipHold?.[tr.id] ?? 'flipTuck'), window(T.flickOut - 0.05, T.flickOut + 0.1, T.catchAt, T.catchAt + 0.12, q))
        // The catch, in the character's own style: the back foot comes down on the tail first, the front
        // foot a moment later; then the reach for the landing as after any air (so the end of the trick
        // does not snap the board down).
        const before = pose, cp = pick(flair.catch && poses[flair.catch] ? flair.catch : 'catch')
        pose = lerpPose(pose, cp, smooth(T.catchAt, T.catchAt + 0.1, q))
        pose.front = lerpPose(before.front, cp.front, smooth(T.catchAt + 0.05, T.catchAt + 0.16, q))
        pose = lerpPose(pose, pick('airLand'), reach * smooth(T.catchAt + 0.08, 1, q))
        pose.board.lift += T.flipLift * Math.sin(Math.PI * q)
        pose = lerpPose(pose, airBase, smooth(0.86, 1, q))
        tag = `${t.stance ? t.stance[0].toUpperCase() + t.stance.slice(1) + ' ' : ''}${bigspin ? (yaw > 0 ? 'Bigspin' : 'FS Bigspin') : def.name} ${Math.round(q * 100)}%`
      }
    } else if (tr && tr.kind === 'grab') {
      const def = [...data.tricks.grabs, ...data.tricks.specials].find((x) => x.id === tr.id) as { enterTicks: number; exitTicks: number; name: string } | undefined
      const spec = P.grabs[tr.id] ?? P.grabs.indy
      if (def) {
        const w = tr.phase === 'enter' ? smooth(0, def.enterTicks, tr.tick + alpha) : tr.phase === 'hold' ? 1 : 1 - smooth(0, def.exitTicks, tr.tick + alpha)
        pose = lerpPose(pose, pick(spec.pose), w)
        // The character's tweak (board roll, pitch, yaw) and its free arm.
        if (flair.tweak) { pose.board.roll += flair.tweak[0] * w; pose.board.pitch += flair.tweak[1] * w; pose.board.yaw += flair.tweak[2] * w }
        if (flair.free) { const h = spec.hand === 'lead' ? pose.rear : pose.lead; const sx = spec.hand === 'lead' ? -1 : 1; h.pos = lerpPose(h.pos, [flair.free[0] * sx, flair.free[1], flair.free[2]] as V3, w * (1 - h.board)) }
        grab = { hand: spec.hand, at: spec.at, w }
        tag = `${def.name} ${tr.phase}`
      }
    }
    // Spinning: the shoulders lead the turn.
    if (Math.abs(t.spinVel) > 0.5) { pose.spine[0] += Math.sign(t.spinVel) * Math.min(1, Math.abs(t.spinVel) / 8) * T.spinLead; pose.hipsRot[0] += Math.sign(t.spinVel) * Math.min(1, Math.abs(t.spinVel) / 8) * T.spinLead * 0.5 }
  } else if (t.state === 'grind' && t.grind) {
    const g = t.grind, gt = g.ticks + alpha
    // What it grinds: a ledge, coping, a curb or a car's roof has a top on the far side (a dipped truck
    // or a slide's far wheels rest on it); a rail is open on both sides (they hang below it).
    const grindPose = (id: string): Pose => grindPoseOf(t, data, P, ground, g, id)
    pose = grindPose(g.id)
    const def = (g.slide ? data.tricks.slides : data.tricks.grinds).find((x) => x.id === g.id)
    const sw = g.stance === 'switch' ? -1 : 1
    // A switch to another grind on the rail (or the double tap's variant): from the one before over a few ticks.
    if (g.prev && g.prev !== g.id) pose = lerpPose(grindPose(g.prev), pose, smooth(0, T.grindSwitchTicks ?? 6, g.ticks + alpha))
    // Locking on: from the air (the reach for a landing) into the grind over grindInTicks, the board
    // arriving on the edge from just above it rather than teleporting onto it.
    const into = smooth(0, T.grindInTicks ?? 7, t.stateTicks + alpha)
    if (into < 1) {
      // From the air pose it was in as it caught the line: the tuck of an ollie (or a drop's), reaching for
      // the landing as far as it had dropped from the top (where it was: the line plus the catch's jump).
      const preZ = t.pos.z + (g.snap?.[2] ?? 0)
      const air = lerpPose(pick(t.popped ? 'tuck' : 'airDrop'), pick('airLand'), clamp01((t.airPeakZ - preZ) / (T.landReachDrop ?? 0.35)))
      const board = { ...pose.board }
      pose = lerpPose(air, pose, into)
      pose.board = lerpPose({ ...board, lift: air.board.lift + Math.max(0, board.lift), pitch: 0, yaw: 0, roll: 0 }, board, into)
    }
    // Locking on: the knees take it as the trucks bite (on the rail, and at each switch).
    pose.hips[2] -= (T.grindLock ?? 0.07) * Math.sin(Math.PI * clamp01(gt / (T.grindLockTicks ?? 14)))
    // follow.grind: the arms and head carry on down a beat after the knees take it, then come back up past rest.
    const FG = P.follow?.grind
    if (FG && gt < FG.decay * 6) {
      const lag = Math.exp(-gt / FG.decay) * Math.sin(gt * FG.freq)
      pose.hips[2] -= FG.drop * lag
      pose.head[1] += FG.nod * lag
      if (pose.lead.board === 0) pose.lead.pos = add(pose.lead.pos, [0, 0, -FG.arms], lag)
      if (pose.rear.board === 0) pose.rear.pos = add(pose.rear.pos, [0, 0, -FG.arms], lag)
    }
    // Looking where it goes. Grinds: down the rail. Slides face the way they go (BS boardslide, FS
    // lipslide, BS noseslide, FS tailslide: chest and head open toward travel, arms wide) or slide blind
    // (the back leads: shoulders and head turned hard over the front shoulder to look down the
    // obstacle, the trailing arm back); which one is fixed by the slide and the side, not by the speed.
    if (!g.slide) {
      const ty = travelYaw(t, data)
      if (ty !== null) lookTo(pose, Math.max(-115, Math.min(115, ty)), (T.lookAlong ?? 0.85) * into)
    }
    // Balance: grinds tip across the rail (toes/heels), slides tip along it (nose/tail). The arms work
    // against it, out toward the high side, windmilling as it nears the edge.
    // (coming in with the lock-on: the balance's lean and arms grow as the grind does)
    const b = g.balance * into, A = T.grindArms ?? 0.22, wm = smooth(0.55, 0.95, Math.abs(b)) * (T.windmill ?? 0.17), ph = gt * 0.4
    if (g.slide) {
      pose.hipsRot[2] += b * T.grindBalanceLean
      pose.lead.pos = add(pose.lead.pos, [-b * A, 0, b < 0 ? -b * A * 0.8 : 0])
      pose.rear.pos = add(pose.rear.pos, [-b * A, 0, b > 0 ? b * A * 0.8 : 0])
    } else {
      pose.hipsRot[1] += b * T.grindBalanceLean
      pose.lead.pos = add(pose.lead.pos, [0, -b * A, Math.abs(b) * A * 0.5])
      pose.rear.pos = add(pose.rear.pos, [0, -b * A, Math.abs(b) * A * 0.5])
    }
    pose.lead.pos = add(pose.lead.pos, [0, Math.sin(ph) * wm, Math.cos(ph) * wm + g.balanceVel * 0.02 * into])
    pose.rear.pos = add(pose.rear.pos, [0, -Math.sin(ph) * wm, -Math.cos(ph) * wm - g.balanceVel * 0.02 * into])
    if ((t.prevB & Btn.ollie) !== 0) pose = lerpPose(pose, pick('grindCrouch'), smooth(0, T.crouchTicks, t.charge + alpha))
    tag = g.name + (Math.abs(b) > 0.6 ? ' wobbly' : '')
  } else if (t.state === 'lip' && t.lip) {
    // The board on the coping and the deck behind it (a ledge with its top on the far side): the deck is
    // ahead of the nose, behind the tail when turned round, on the heel side along the coping.
    const lp = clone(pick(P.lips[t.lip.id] ?? P.lips.rocktofakie)), lf = P.lipFrame?.[t.lip.id] ?? 'deck'
    seat(lp.board, lf !== 'along', lf === 'along' ? [0, 1] : [lf === 'ramp' ? -1 : 1, 0], true)
    pose = lerpPose(pose, lp, smooth(0, 8, ticks))
    pose.hipsRot[2] += t.lip.balance * T.grindBalanceLean
    tag = t.lip.name
  } else if (t.state === 'wall') {
    pose = lerpPose(pose, pick('wallride'), smooth(0, 8, ticks))
    tag = 'wallride'
  } else if (t.state === 'bail') {
    const keys = P.bail
    const bt = bailClock(ticks, flair.bail)   // the character's own pace through the fall
    let i = 0
    while (i < keys.length - 2 && bt > keys[i + 1][0]) i++
    const u = smooth(keys[i][0], keys[i + 1][0], bt)
    pose = lerpPose(pick(keys[i][1]), pick(keys[i + 1][1]), u)
    // Into the fall from where the rider was (the reach for a landing), over the first few ticks.
    pose = lerpPose(pick('airLand'), pose, smooth(0, T.bailIn ?? 6, ticks))
    tag = `bail ${keys[u < 0.5 ? i : i + 1][1]}`
  }
  return { pose, flip, grab, tag, walk, reach, lean }
}
