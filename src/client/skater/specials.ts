import type { GameData } from '../../sim/data.ts'
import type { Thing } from '../../sim/thing.ts'
import { lerpPose, type Pose, type V3 } from './poses.ts'

// Signature specials: during a special trick (data/tricks.json specials) each character adds
// its own flourish over the trick's pose, matching its signature names in data/ui.json: the
// can shakes and sprays foam, the blob goes to gelatin, the Eucalyptus Monster giggle-spins, the
// mascot's head wobbles, the vampire's cape spreads into bat wings, the skeleton comes apart
// and snaps back, the tech bro films himself, Karl rolls in with his arms out trailing fog, the
// burrito throws a shaka spraying salsa, the pigeon flaps, the sea lion claps in spray. The pose part is here; the meshes (foam, cape,
// bones, phone) move in each character's hook (characters.ts). All from the Thing: shots of a
// snapshot show what play shows.

export type Signature = 'foam' | 'gelatin' | 'giggle' | 'bighead' | 'bat' | 'apart' | 'selfie' | 'mist' | 'salsa' | 'feathers' | 'sensor' | 'bell' | 'splash'

/** The special running now: its id, progress 0..1, an in/out envelope, and ticks into it. */
export type SpecialRun = { id: string; q: number; env: number; ticks: number } | null

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }

export function specialOf(t: Thing, data: GameData, alpha: number): SpecialRun {
  const tr = t.trick
  if (!tr) return null
  const def = data.tricks.specials.find((s) => s.id === tr.id)
  if (!def) return null
  if (def.kind === 'flip') {
    const ticks = tr.tick + alpha
    const q = clamp01(ticks / ((def as { ticks: number }).ticks || 1))
    return { id: tr.id, q, env: smooth(0.06, 0.2, q) * (1 - smooth(0.74, 0.86, q)), ticks }
  }
  const g = def as { enterTicks: number; exitTicks: number }
  const k = tr.tick + alpha
  const env = tr.phase === 'enter' ? smooth(0, g.enterTicks, k) : tr.phase === 'hold' ? 1 : 1 - smooth(0, g.exitTicks, k)
  const ticks = tr.phase === 'enter' ? k : tr.phase === 'hold' ? g.enterTicks + k : g.enterTicks + tr.held + k
  const q = tr.phase === 'enter' ? 0.2 * env : tr.phase === 'hold' ? 0.5 : 0.8 + 0.2 * (1 - env)
  return { id: tr.id, q, env, ticks }
}

const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]

/** The pose side of a character's signature flourish (free hands only: a hand on the board stays). */
export function signaturePose(p: Pose, s: SpecialRun, sig: Signature | undefined): Pose {
  if (!s || !sig || s.env <= 0) return p
  const e = s.env, T = s.ticks
  const freeHands: [Pose['lead'], number][] = ([[p.lead, 1], [p.rear, -1]] as [Pose['lead'], number][]).filter(([h]) => h.board < 0.5)
  if (sig === 'foam') {
    // Shaken: the whole can rattles, the free hand pumps.
    p.hipsRot = add(p.hipsRot, [Math.sin(T * 1.9) * 7, Math.sin(T * 2.3) * 5, Math.sin(T * 2.7) * 8], e)
    p.spine = add(p.spine, [Math.sin(T * 2.1 + 1) * 6, 0, Math.sin(T * 2.5 + 2) * 6], e)
    for (const [h] of freeHands) h.pos = add(h.pos, [0, 0.06, 0.12 + Math.sin(T * 1.6) * 0.12], e)
  } else if (sig === 'giggle') {
    // Giggling: the upper body twists round and back, the head shakes, arms hug the belly.
    p.spine = add(p.spine, [Math.sin(T * 0.45) * 55, Math.sin(T * 0.9) * 10, Math.sin(T * 1.3) * 12], e)
    p.head = add(p.head, [Math.sin(T * 1.1) * 18, Math.sin(T * 1.7) * 14, Math.sin(T * 2.3) * 14], e)
    for (const [h, side] of freeHands) h.pos = lerpPose(h.pos, [side * 0.06, 0.24, -0.34] as V3, e)
  } else if (sig === 'bighead') {
    // The mascot head bobbles on the neck, the arms windmill.
    p.head = add(p.head, [Math.sin(T * 0.42) * 32, Math.sin(T * 0.63 + 1) * 26, Math.sin(T * 0.51 + 2) * 30], e)
    for (const [h, side] of freeHands) h.pos = add(h.pos, [side * Math.cos(T * 0.35) * 0.18, 0.1, 0.25 + Math.sin(T * 0.35) * 0.2], e)
  } else if (sig === 'bat') {
    // Wings: both free arms spread wide and a little back, the head up.
    for (const [h, side] of freeHands) { h.pos = lerpPose(h.pos, [side * 0.58, -0.1, 0.12] as V3, e); h.curl = h.curl + (0.05 - h.curl) * e }
    p.head = add(p.head, [0, -15, 0], e)
    p.spine = add(p.spine, [0, -8, 0], e)
  } else if (sig === 'apart') {
    // The bones fly apart (the hook spreads them); the limbs loosen.
    for (const [h, side] of freeHands) h.pos = add(h.pos, [side * 0.12, 0, 0.18], e * Math.sin(Math.PI * s.q))
  } else if (sig === 'selfie') {
    // Films himself: the free hand (the phone's, on the right) up in front of the face, a pose.
    const rear = p.rear
    if (rear.board < 0.5) { rear.pos = lerpPose(rear.pos, [0.08, 0.42, 0.2] as V3, e); rear.elbow = [-0.6, -0.2, -0.6]; rear.curl = 0.6 }
    if (p.lead.board < 0.5) p.lead.pos = lerpPose(p.lead.pos, [0.36, 0.1, 0.3] as V3, e)
    p.head = add(p.head, [-30, -12, 8], e)
  } else if (sig === 'mist') {
    // Rolling in: free arms wide and slow, the head back, cool (the fog trail is in the hook).
    for (const [h, side] of freeHands) { h.pos = lerpPose(h.pos, [side * 0.5, 0.1 + Math.sin(T * 0.12 + side) * 0.06, 0.08] as V3, e); h.curl = h.curl + (0.1 - h.curl) * e }
    p.head = add(p.head, [0, -10, 0], e)
  } else if (sig === 'salsa') {
    // A free hand up in a shaka (the fingers are set in the hook), salsa spraying from the top.
    const h = freeHands[0]
    if (h) { h[0].pos = lerpPose(h[0].pos, [h[1] * 0.3, 0.55, 0.18] as V3, e); h[0].curl = 0 }
    p.hipsRot = add(p.hipsRot, [0, 0, Math.sin(T * 0.4) * 6], e)
  } else if (sig === 'feathers') {
    // Flapping: both free wings beat up and down, the chest out.
    for (const [h, side] of freeHands) h.pos = lerpPose(h.pos, [side * 0.52, 0.12 + Math.sin(T * 0.7) * 0.22, -0.04] as V3, e)
    p.spine = add(p.spine, [0, -10, 0], e)
  } else if (sig === 'sensor') {
    // The robotaxi: arms straight out like a robot, the whole car scanning left and right (the
    // lidar spins up in the hook).
    for (const [h, side] of freeHands) { h.pos = lerpPose(h.pos, [side * 0.56, 0.02, 0.04] as V3, e); h.curl = h.curl + (0.05 - h.curl) * e }
    p.head = add(p.head, [Math.sin(T * 0.2) * 35, 0, 0], e)
    p.spine = add(p.spine, [Math.sin(T * 0.2) * 12, 0, 0], e)
  } else if (sig === 'bell') {
    // The cable car: a free lever up yanking the bell cord, again and again (the bell swings in the hook).
    const h = freeHands[0]
    if (h) { h[0].pos = lerpPose(h[0].pos, [h[1] * 0.14, 0.1, 0.5 - Math.abs(Math.sin(T * 0.5)) * 0.25] as V3, e); h[0].curl = h[0].curl + (1 - h[0].curl) * e }
    p.spine = add(p.spine, [0, Math.abs(Math.sin(T * 0.5)) * 6, 0], e)
  } else if (sig === 'splash') {
    // The sea lion: free flippers clap in front of the chest, the head thrown back barking (the spray is in the hook).
    const c = Math.abs(Math.sin(T * 0.4))
    for (const [h, side] of freeHands) { h.pos = lerpPose(h.pos, [side * (0.04 + 0.16 * c), 0.34, 0.12] as V3, e); h.curl = h.curl * (1 - e) }
    p.head = add(p.head, [0, -22, 0], e)
  }
  // 'gelatin' is all in the blob's hook (its body morphs).
  return p
}
