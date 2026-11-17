import type { Pose, V3 } from './poses.ts'
import { lerpPose } from './poses.ts'

// Bail personalities: each character falls apart in its own way, from the bail state's timer
// (the sim's bail: a stumble, the fall at ~10 ticks, lying from ~26, getting up from ~136, back
// on the board at 150). The pose part is here; dents, splats, popped heads, bats and bone piles
// move in each character's hook (characters.ts). Pure functions of the timer: shots match play.

export type BailStyle = 'dent' | 'splat' | 'ball' | 'headPop' | 'bats' | 'pile' | 'slowmo' | 'mist' | 'spill' | 'feathers' | 'pullover' | 'derail' | 'flop'

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
const smooth = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t) }

/**
 * The bail timer as each style plays it: the tech bro's dramatic fall is slow (the sim's first
 * 26 ticks stretched over 70), then he lies a shorter while before sitting up to check his phone.
 */
export function bailClock(ticks: number, style: BailStyle | undefined): number {
  if (style !== 'slowmo') return ticks
  if (ticks < 70) return (ticks / 70) * 26
  if (ticks < 136) return 26 + ((ticks - 70) / 66) * 92
  return ticks
}

const add = (a: V3, b: V3, k: number): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k]

export function bailPose(p: Pose, ticks: number, style: BailStyle | undefined, phone: Pose | null): Pose {
  if (!style) return p
  const T = ticks
  if (style === 'dent') {
    // Lying on its side the can rolls a turn and a half, slowing, across the ground.
    const k = smooth(24, 34, T) * (1 - smooth(128, 140, T))
    const turns = 1.5 * (1 - Math.pow(1 - clamp01((T - 26) / 70), 2))
    p.hipsRot = add(p.hipsRot, [turns * 360, 0, 0], k)
    p.hips = add(p.hips, [0.2 * turns * 2 * Math.PI * 0.6, 0, 0.05], k)
  } else if (style === 'splat') {
    // Upright and flattened into a puddle on the ground (the hook squashes the body), reforming
    // with a wobble before it gets up.
    const k = smooth(18, 28, T) * (1 - smooth(112, 136, T))
    p.hipsRot = [p.hipsRot[0], p.hipsRot[1] * (1 - k), p.hipsRot[2] * (1 - k)]
    p.spine = [p.spine[0], p.spine[1] * (1 - k), p.spine[2] * (1 - k)]
    p.hips = [p.hips[0], p.hips[1] * (1 - k), p.hips[2] + (0.12 - p.hips[2]) * k]
    for (const h of [p.lead, p.rear]) h.pos = add(h.pos, [Math.sign(h.pos[0]) * 0.25, 0, -0.1], k)
  } else if (style === 'ball') {
    // A fuzzy ball: knees to the chest, arms round them, tumbling over and over, then unrolling.
    const k = smooth(6, 16, T) * (1 - smooth(96, 116, T))
    const ball: Partial<Pose> = {
      hips: [p.hips[0], p.hips[1] + 0.6 * clamp01((T - 10) / 80), 0.32],
      spine: [0, 40, 0], head: [0, 35, 0],
      front: { pos: [0.1, 0.18, 0.42], board: 0, toe: 0, tilt: 20, knee: [0.2, 1, 0.6] },
      back: { pos: [-0.1, 0.18, 0.42], board: 0, toe: 0, tilt: 20, knee: [-0.2, 1, 0.6] },
      lead: { pos: [0.1, 0.32, -0.3], board: 0, elbow: [0.6, -0.2, -0.6], curl: 0.9 },
      rear: { pos: [-0.1, 0.32, -0.3], board: 0, elbow: [-0.6, -0.2, -0.6], curl: 0.9 },
    }
    const target = { ...p, ...ball, hipsRot: [p.hipsRot[0], 30 + (T - 6) * 9, 0] as V3 } as Pose
    return lerpPose(p, target, k)
  } else if (style === 'mist') {
    // Karl stays upright and low while he thins out into puffs (the hook), and rises as he gathers.
    const k = smooth(16, 30, T) * (1 - smooth(104, 132, T))
    p.hipsRot = [p.hipsRot[0] * (1 - k), p.hipsRot[1] * (1 - k), p.hipsRot[2] * (1 - k)]
    p.spine = [p.spine[0] * (1 - k), p.spine[1] * (1 - k), p.spine[2] * (1 - k)]
    p.hips = [p.hips[0], p.hips[1] * (1 - k), p.hips[2] + (0.32 - p.hips[2]) * k]
    for (const h of [p.lead, p.rear]) h.pos = add(h.pos, [Math.sign(h.pos[0]) * 0.2, 0.05, 0.1], k)
  } else if (style === 'spill') {
    // The burrito lands on its side and rocks while the filling spills (the hook), then rights itself.
    const k = smooth(24, 34, T) * (1 - smooth(126, 140, T))
    p.hipsRot = add(p.hipsRot, [Math.sin((T - 26) * 0.12) * 18 * Math.exp(-(T - 26) / 50), 0, 0], k)
  } else if (style === 'feathers') {
    // Sitting up dazed in a cloud of feathers, shaking the head.
    const k = smooth(60, 76, T) * (1 - smooth(128, 142, T))
    p.spine = add(p.spine, [Math.sin(T * 0.3) * 10, -30, 0], k)
    p.head = add(p.head, [Math.sin(T * 0.45) * 30, 10, 0], k)
  } else if (style === 'pullover') {
    // The robotaxi does not fall: it stops dead, steps off the board to the curb side and stands
    // there with its hazards on (the hook) while somebody cones it, then gets back on.
    const k = smooth(4, 16, T) * (1 - smooth(132, 146, T))
    const parked: Pose = {
      ...p,
      hips: [0, 0.32, 0.6], hipsRot: [0, 0, 0], spine: [0, 0, 0], head: [0, 4, 0],
      front: { pos: [0.16, 0.34, 0], board: 0, toe: 0, tilt: 0, knee: [0.2, 1, 0] },
      back: { pos: [-0.16, 0.34, 0], board: 0, toe: 0, tilt: 0, knee: [-0.2, 1, 0] },
      lead: { pos: [0.22, 0.04, -0.46], board: 0, elbow: [0.4, -0.5, -0.4], curl: 0.3 },
      rear: { pos: [-0.22, 0.04, -0.46], board: 0, elbow: [-0.4, -0.5, -0.4], curl: 0.3 },
    }
    return lerpPose(p, parked, k)
  } else if (style === 'derail') {
    // The cable car jumps the slot: tips over onto its side, rocks there (the bell clangs, in the
    // hook), and rights itself.
    const k = smooth(8, 24, T) * (1 - smooth(118, 138, T))
    const rock = Math.sin((T - 24) * 0.18) * 6 * Math.exp(-Math.max(0, T - 24) / 40)
    const tipped: Pose = {
      ...p,
      hips: [0, 0.3, 0.26], hipsRot: [0, 78 + rock, 0], spine: [0, 0, 0], head: [0, 0, 0],
      front: { pos: [0.16, -0.2, 0.05], board: 0, toe: 0, tilt: 0, knee: [0.2, 1, 0.4] },
      back: { pos: [-0.16, -0.22, 0.08], board: 0, toe: 0, tilt: 0, knee: [-0.2, 1, 0.4] },
      lead: { pos: [0.3, 0.2, -0.2], board: 0, elbow: [0.5, -0.4, -0.5], curl: 0.4 },
      rear: { pos: [-0.3, 0.2, -0.2], board: 0, elbow: [-0.5, -0.4, -0.5], curl: 0.4 },
    }
    return lerpPose(p, tipped, k)
  } else if (style === 'flop') {
    // The sea lion belly-flops: face down along the ground, the head up, front flippers slapping
    // (slower and slower), the rear flippers up behind, then it pushes itself up (spray in the hook).
    const k = smooth(8, 22, T) * (1 - smooth(122, 142, T))
    const slap = Math.sin(T * 0.55) * (1 - smooth(50, 110, T))
    const prone: Pose = {
      ...p,
      hips: [0, -0.05, 0.3], hipsRot: [0, 72, 0], spine: [0, 12, 0], head: [0, -50, 0],
      front: { pos: [0.12, -0.42, 0.14], board: 0, toe: 0, tilt: 0, knee: [0.2, -1, 0.4] },
      back: { pos: [-0.12, -0.42, 0.16], board: 0, toe: 0, tilt: 0, knee: [-0.2, -1, 0.4] },
      lead: { pos: [0.4, 0.12, -0.05 + slap * 0.12], board: 0, elbow: [0.6, 0, 0.3], curl: 0 },
      rear: { pos: [-0.4, 0.12, -0.05 - slap * 0.12], board: 0, elbow: [-0.6, 0, 0.3], curl: 0 },
    }
    return lerpPose(p, prone, k)
  } else if (style === 'slowmo' && phone) {
    // Sat up after the fall, checking the phone for damage.
    const k = smooth(84, 98, T) * (1 - smooth(138, 148, T))
    return lerpPose(p, phone, k)
  }
  return p
}
