import * as THREE from 'three'
import { raycast, type Park } from '../sim/park/park.ts'
import type { SimEvent } from '../sim/sim.ts'

// Ambient vignettes (data/vignettes.json): small funny scenes around the city: chess on Market, a busker and a
// breakdance crew at the Powell turntable, Dolores Park's sunbathers, tightrope walker, chocolate seller and drum
// circle, cards and tai chi off Grant, roller disco and drag brunch in the Castro, a wedding shoot and a protester at
// City Hall, the Painted Ladies postcard, the silver statue at Pier 39, gulls after a bread bowl, laptop workers on
// Valencia. The people are the crowd's (crowd.ts), each posed by its act here (actPose); this draws their props,
// runs their reactions (a big combo, a trick or a grind near them, skating through them) and says their lines.
// Draw-only, never in the sim.

type Limb = [number, number, number]
/** What an act asks of a crowd figure this moment (crowd.ts pose): every field optional, the type's own otherwise. */
export type ActPose = {
  hipZ?: number; lean?: number; roll?: number; lie?: number; yaw?: number; lift?: number
  head?: [number, number]          // yaw (left +), pitch (down +), radians
  arms?: [Limb, Limb]              // left, right: forward raise, out, elbow (radians)
  legs?: [Limb, Limb]              // left, right: thigh forward, out, knee
  hold?: string                    // a crowd hold ('phone', 'coffee', 'breadbowl', 'map', '' none)
  look?: number                    // how far the head turns to a skater close by (0..1)
  walk?: boolean                   // the walk cycle's legs and arms (one walking a line)
}
export type VigReact = { kind: string; age: number } | null

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
const HIP = 0.86
const SEATED: [Limb, Limb] = [[1.45, 0.1, 1.5], [1.45, 0.1, 1.5]]
const lerpL = (a: Limb, b: Limb, k: number): Limb => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]

/** The acts (data/vignettes.json members' act), each a pose at time t (seconds), seeded per person, reacting to its vignette. */
export const ACTS = ['chess', 'kibitz', 'guitar', 'windmill', 'toprock', 'clap', 'sunbathe', 'sunbatheRead', 'tightrope', 'seller', 'drum', 'cards', 'taichi', 'roller', 'brunch', 'brunchFan', 'couple', 'photographer', 'protest', 'posePeace', 'poseArms', 'phonePhoto', 'statue', 'breadGuard', 'laptop', 'laptopCall', 'cook', 'browse', 'fold', 'sitPhone', 'wait', 'eat', 'clerk'] as const

export function actPose(act: string, t: number, p: { seed: number; seat: number; side?: number }, react: VigReact): ActPose {
  const s = p.seed, seat = p.seat || 0.46, ph = s * 13
  const beat = (every: number, len: number) => { const u = ((t + s * every * 7) % every + every) % every; return u < len ? Math.sin((u / len) * Math.PI) : 0 }
  switch (act) {
    case 'chess': {
      const move = beat(7, 0.9)
      return { hipZ: seat, lean: 0.28, head: [0, 0.38], legs: SEATED, look: 1, arms: [[0.95, 0.12, 1.15], [0.95 + move * 0.45, 0.08, 1.1 - move * 0.75]] }
    }
    case 'kibitz': return { lean: 0.14, head: [Math.sin(t * 0.4 + ph) * 0.3, 0.3], arms: [[-0.45, 0.05, 1.45], [-0.45, 0.05, 1.45]], look: 0.8 }
    case 'guitar': {
      const strum = Math.sin(t * 11 + ph) * 0.14
      return { head: [0.15, 0.18 + Math.max(0, Math.sin(t * 5.5)) * 0.08], arms: [[1.05, 0.38, 1.65], [0.55 + strum, 0.04, 1.3]], lean: 0.04, look: 0.6 }
    }
    case 'windmill': {
      // On his back on the cardboard, spinning, legs split wide; every few seconds a freeze, a hand down, legs up.
      const freeze = beat(6, 1.4)
      return { lie: 1, yaw: t * 6 * (1 - freeze), roll: Math.sin(t * 6) * 0.25 * (1 - freeze), lift: 0.05, arms: [[1.6, 1.1 - freeze * 0.6, 0.2], [1.6 + freeze, 1.1, 0.2]], legs: [[0.9 + freeze * 0.8, 0.75, 0.1], [0.9 + freeze * 0.8, -0.15 + 0.9, 0.1]], look: 0 }
    }
    case 'toprock': {
      const k = t * 4.2 + ph, st = Math.sin(k)
      return { lift: Math.abs(Math.sin(k * 2)) * 0.04, lean: 0.1, arms: [[0.9 + st * 0.5, 0.4, 1.6], [0.9 - st * 0.5, 0.4, 1.6]], legs: [[st * 0.5, 0.1, Math.max(0, st) * 0.9], [-st * 0.5, 0.1, Math.max(0, -st) * 0.9]], look: 0.5 }
    }
    case 'clap': {
      const c = Math.abs(Math.sin(t * 7 + ph))
      return { lift: c * 0.015, arms: [[1.05, 0.05 + c * 0.32, 1.05], [1.05, 0.05 + c * 0.32, 1.05]], head: [0, Math.max(0, Math.sin(t * 3.5)) * 0.1], look: 0.7 }
    }
    case 'sunbathe': return { lie: 1, lift: 0.01, arms: [[2.85, 0.55, 2.2], [2.85, 0.55, 2.2]], legs: [[0.55 + Math.sin(t * 0.2 + ph) * 0.05, 0.05, 1.15], [0, 0.05, 0]], head: [0, -0.1], look: react?.kind === 'look' ? 1 : 0.2 }
    case 'sunbatheRead': return { lie: 1, lift: 0.01, arms: [[1.65, 0.12, 0.7], [1.65, 0.12, 0.7]], legs: [[0, 0.06, 0], [0.4, 0.04, 0.9]], hold: 'map', head: [0, -0.25], look: 0.2 }
    case 'tightrope': {
      const w = Math.sin(t * 2.1 + ph) * 0.16 + (react && react.age < 2 ? Math.sin(react.age * 14) * 0.35 * (1 - react.age / 2) : 0)
      return { walk: true, roll: w, arms: [[0.15, 1.45 + w, 0.15], [0.15, 1.45 - w, 0.15]], head: [0, 0.25], look: 0.3 }
    }
    case 'seller': {
      const wave = Math.sin(t * 5 + ph)
      return { arms: [[-0.25, 0.55, 1.85], [0.95 + beat(5, 1.6) * 0.4, 0.42, 1.0 + wave * 0.35]], head: [Math.sin(t * 0.5 + ph) * 0.5, 0], look: 1 }
    }
    case 'drum': {
      const a = Math.max(0, Math.sin(t * 10 + ph)), b = Math.max(0, Math.sin(t * 10 + ph + Math.PI))
      return { hipZ: 0.28, lean: 0.32, legs: [[1.45, 0.45, 2.2], [1.45, 0.45, 2.2]], arms: [[0.7 + a * 0.3, 0.25, 0.9 - a * 0.4], [0.7 + b * 0.3, 0.25, 0.9 - b * 0.4]], head: [0, 0.2 + Math.max(0, Math.sin(t * 5 + ph)) * 0.12], look: 0.5 }
    }
    case 'cards': {
      const slap = beat(5, 0.5)
      return { hipZ: seat, lean: 0.2, legs: SEATED, arms: [[0.95, 0.15, 1.5], [0.95 + slap * 0.35, 0.1, 1.45 - slap * 1.0]], head: [Math.sin(t * 0.7 + ph) * 0.25, 0.3], look: 0.9 }
    }
    case 'taichi': {
      // The group moves together: the time only, no seed. Skate through and they all turn their heads to you at once,
      // without missing a beat, then flow on.
      const k = t * 0.55, a = Math.sin(k), b = Math.cos(k)
      const turn = react && react.kind === 'look' ? 1 - smooth(2.4, 3.2, react.age) : 0
      return { hipZ: HIP - 0.1 - 0.04 * a, legs: [[0.35 + 0.1 * a, 0.16, 0.65 + 0.15 * a], [0.35 - 0.1 * a, 0.16, 0.65 - 0.15 * a]], arms: [[0.9 + 0.6 * a, 0.35 + 0.3 * b, 0.5 + 0.3 * b], [0.9 - 0.6 * a, 0.35 - 0.3 * b, 0.5 - 0.3 * b]], yaw: 0.35 * Math.sin(k * 0.5), head: [0.2 * Math.sin(k * 0.5), 0.05], look: turn }
    }
    case 'roller': {
      const k = t * 2.4 + ph
      return { roll: -0.18, lean: 0.12, arms: [[0.6 + Math.sin(k) * 0.6, 0.9, 0.5], [0.6 - Math.sin(k) * 0.6, 0.9, 0.5]], legs: [[Math.sin(k) * 0.35, 0.16, 0.35 + Math.max(0, Math.sin(k)) * 0.3], [-Math.sin(k) * 0.35, 0.16, 0.35 + Math.max(0, -Math.sin(k)) * 0.3]], head: [0.2, -0.1], look: 0.4 }
    }
    case 'brunch': {
      const sip = beat(6, 1.4)
      return { hipZ: seat, lean: 0.1, legs: SEATED, hold: 'coffee', arms: [[0.75, 0.15, 1.3], [0.4 + sip * 0.55, 0.06, 1.25 + sip * 0.9]], head: [Math.sin(t * 0.6 + ph) * 0.35, -sip * 0.25], look: 0.8 }
    }
    case 'brunchFan': {
      const fan = Math.sin(t * 9 + ph)
      return { hipZ: seat, lean: -0.08, legs: [[1.45, 0.05, 1.5], [1.65, -0.08, 1.4]], arms: [[1.0, 0.45, 1.9 + fan * 0.2], [0.6 + beat(4, 1) * 1.2, 0.5, 0.8]], head: [Math.sin(t * 0.9 + ph) * 0.4, -0.15], look: 1 }
    }
    case 'couple': return { head: [(p.side ?? 0) * -0.35, -0.05], arms: (p.side ?? 0) < 0 ? [[0.95, 0.05, 1.45], [0.25, -0.35, 0.6]] : [[0.25, -0.35, 0.6], [0.9, 0.06, 1.4]], lean: Math.sin(t * 0.8 + ph) * 0.03, look: react?.kind === 'film' ? 0.8 : 0.2 }
    case 'photographer': return { hipZ: 0.62, lean: 0.2, legs: [[1.55, 0.12, 1.65], [0.15, 0.1, 2.35]], arms: [[1.35, 0.25, 1.95], [1.35, 0.15, 1.95]], hold: 'phone', head: [0, -0.05], look: react?.kind === 'film' ? 1 : 0 }
    case 'protest': {
      const pump = beat(3, 0.6)
      return { lift: pump * 0.05, arms: [[2.85 + pump * 0.15, 0.15, 0.35], [2.85 + pump * 0.15, 0.15, 0.35]], head: [Math.sin(t * 0.5 + ph) * 0.4, -0.15], look: 1 }
    }
    case 'posePeace': return { arms: [[-0.2, 0.55, 1.85], [2.6, 0.32, 0.65]], head: [0.1, -0.1], lean: -0.05, look: 0.3 }
    case 'poseArms': return { arms: [[2.7, 0.7, 0.2], [2.7, 0.7, 0.2]], head: [0, -0.15], lift: Math.abs(Math.sin(t * 2.5)) * 0.02, look: 0.3 }
    case 'phonePhoto': return { hipZ: HIP - 0.08, legs: [[0.3, 0.1, 0.4], [0.05, 0.1, 0.25]], arms: [[1.35, 0.2, 1.6], [1.35, 0.15, 1.6]], hold: 'phone', lean: 0.12, look: 0.2 }
    case 'statue': {
      // Frozen, one arm pointing far off; skate by and he comes alive (a robot's turn to you and a wave), then freezes again.
      const A: { arms: [Limb, Limb]; head: [number, number] } = { arms: [[-0.2, 0.55, 1.9], [1.55, 0.25, 0.05]], head: [0.6, -0.1] }
      const B: { arms: [Limb, Limb]; head: [number, number] } = { arms: [[0.2, 0.2, 0.3], [2.5, 0.5, 1.2 + Math.sin(t * 9) * 0.3]], head: [-0.4, 0.05] }
      const k = react && react.kind === 'statue' ? Math.round(smooth(0, 0.5, react.age) * (1 - smooth(3.2, 3.8, react.age)) * 6) / 6 : 0   // stepped: robot moves
      return { hipZ: HIP, lift: p.seat || 0.42, arms: [lerpL(A.arms[0], B.arms[0], k), lerpL(A.arms[1], B.arms[1], k)], head: [A.head[0] + (B.head[0] - A.head[0]) * k, A.head[1] + (B.head[1] - A.head[1]) * k], look: 0 }
    }
    case 'breadGuard': {
      const swat = beat(2.2, 0.5)
      return { hold: 'breadbowl', arms: [[0.8 + swat * 1.6, 0.55, 0.6], [0.6, 0.06, 1.4]], head: [Math.sin(t * 1.7 + ph) * 0.7, -0.3], lean: -0.06, look: 0.3 }
    }
    case 'laptop': {
      const ty = Math.sin(t * 16 + ph) * 0.04
      return { hipZ: seat, lean: 0.16, legs: SEATED, arms: [[0.85 + ty, 0.18, 1.35], [0.85 - ty, 0.18, 1.35]], head: [0, 0.22], look: 0.5 }
    }
    // Indoors (interiors.ts): the taqueria's cook at the plancha, a browser at the deck wall or the fruit, folding
    // laundry, waiting in line on a phone, eating at a table, the clerk with both hands on the counter.
    case 'cook': { const k = t * 5.5 + ph; return { lean: 0.18, arms: [[1.0 + Math.sin(k) * 0.18, 0.18, 1.2], [0.9 + Math.sin(k + 2) * 0.12, 0.2, 1.3 + beat(4, 0.8) * 0.4]], head: [Math.sin(t * 0.7 + ph) * 0.25, 0.32], look: 0.4 } }
    case 'browse': { const r2 = beat(7, 2.2); return { arms: [[0.15, 0.05, 0.4], [0.3 + r2 * 1.0, 0.1, 0.5 - r2 * 0.3]], head: [Math.sin(t * 0.35 + ph) * 0.45, -0.12 + r2 * 0.1], lean: -0.03, look: 0.5 } }
    case 'fold': { const f = Math.abs(Math.sin(t * 1.8 + ph)); return { lean: 0.22, arms: [[0.95, 0.15 + f * 0.35, 1.35 - f * 0.5], [0.95, 0.15 + f * 0.35, 1.35 - f * 0.5]], head: [0, 0.42], look: 0.3 } }
    case 'sitPhone': return { hipZ: seat, lean: 0.12, legs: SEATED, hold: 'phone', arms: [[0.9, 0.1, 1.45], [0.9, 0.1, 1.45]], head: [0, 0.42 + Math.sin(t * 0.3 + ph) * 0.05], look: 0.4 }
    case 'wait': { const shift = Math.sin(t * 0.45 + ph); return { roll: shift * 0.04, hold: 'phone', arms: [[0.15, 0.06, 0.3], [0.8, 0.1, 1.5]], head: [Math.sin(t * 0.25 + ph * 2) * 0.35, 0.3 * (0.5 + 0.5 * Math.sin(t * 0.2 + ph))], look: 0.6 } }
    case 'eat': { const bite = beat(5, 1.2); return { hipZ: seat, lean: 0.18, legs: SEATED, arms: [[0.9, 0.12, 1.2], [0.6 + bite * 0.6, 0.06, 1.3 + bite * 0.9]], head: [Math.sin(t * 0.5 + ph) * 0.2, 0.25 - bite * 0.15], look: 0.6 } }
    case 'clerk': return { lean: 0.12, arms: [[0.75, 0.1, 0.55], [0.75, 0.1, 0.55]], head: [Math.sin(t * 0.4 + ph) * 0.4, 0.05], look: 0.9 }
    case 'laptopCall': return { hipZ: seat, lean: 0.06, legs: [[1.45, 0.1, 1.5], [1.6, -0.05, 1.3]], hold: 'phone', arms: [[0.85, 0.18, 1.35], [0.3, 0.25, 2.5]], head: [Math.sin(t * 0.8 + ph) * 0.3, -0.05], look: 0.5 }
  }
  return {}
}

// ---------------------------------------------------------------- data

export type VigMember = { type: string; act: string; at: [number, number]; face: number; seat?: number; z?: number; extra?: boolean; path?: [number, number][]; speed?: number; circle?: number }
export type VigProp = { kind: string; at: [number, number]; face: number; z?: number; length?: number; text?: string; held?: boolean }
export type VigLine = { id: string; on: 'combo' | 'trick' | 'grind' | 'pass'; voice: string; text: string }
export type VignetteDef = { id: string; name: string; area: string; at: [number, number]; heading: number; near?: number; floor?: number; sound?: 'guitar' | 'drums' | 'boombox'; members: VigMember[]; props: VigProp[]; react: { combo?: string; trick?: string; grind?: string; pass?: string }; lines: VigLine[] }
export type VignetteData = { drawDistance: number; lineCooldown: number; globalCooldown: number; hear: number; bigPoints: number; passSpeed: number; soundFar: number; vignettes: VignetteDef[] }

/** A point in a vignette's frame (right, ahead metres from its anchor) in site metres; compass heading degrees. */
export function vigPoint(v: { at: [number, number]; heading: number }, right: number, ahead: number): { x: number; y: number } {
  const h = (v.heading * Math.PI) / 180, fx = Math.sin(h), fy = Math.cos(h)
  return { x: v.at[0] + fy * right + fx * ahead, y: v.at[1] - fx * right + fy * ahead }
}
/** The math angle (from +x, the crowd's) of a compass heading plus a turn, degrees. */
export const vigYaw = (heading: number, face = 0) => Math.PI / 2 - ((heading + face) * Math.PI) / 180

/** All the voiced lines (sound.ts addLines: the captions and the mp3 ids). */
export function vignetteLines(d: VignetteData): Record<string, { voice: string; text: string }> {
  const out: Record<string, { voice: string; text: string }> = {}
  for (const v of d.vignettes) for (const l of v.lines) out[l.id] = { voice: l.voice, text: l.text }
  return out
}

// ---------------------------------------------------------------- props

const M = (gs: THREE.BufferGeometry[]) => { const out = mergeGeos(gs); return out }
function mergeGeos(gs: THREE.BufferGeometry[]): THREE.BufferGeometry {
  // Small merges (no index), for the props' few parts.
  const parts = gs.map((g) => (g.index ? g.toNonIndexed() : g))
  let n = 0
  for (const g of parts) n += g.getAttribute('position').count
  const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3)
  let o = 0
  for (const g of parts) {
    const p = g.getAttribute('position'), q = g.getAttribute('normal')
    pos.set(p.array as Float32Array, o * 3); nrm.set(q.array as Float32Array, o * 3); o += p.count
  }
  const out = new THREE.BufferGeometry()
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3)); out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3))
  return out
}
const box = (x: number, y: number, z: number, px = 0, py = 0, pz = 0) => new THREE.BoxGeometry(x, y, z).translate(px, py, pz)
const cyl = (r0: number, r1: number, h: number, px = 0, py = 0, pz = 0, seg = 10) => new THREE.CylinderGeometry(r0, r1, h, seg).rotateX(Math.PI / 2).translate(px, py, pz)

/** The props' shapes (x forward, y left, z up, the ground at z = 0) and their colours. */
function propGeometries(): Record<string, { geo: THREE.BufferGeometry; color: string; colors?: string[]; metal?: number }> {
  const legs = (w: number, d: number, h: number, r = 0.015) => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([a, b]) => cyl(r, r, h, (a * w) / 2, (b * d) / 2, h / 2, 5))
  return {
    chessTable: { geo: M([box(0.62, 0.62, 0.03, 0, 0, 0.72), ...legs(0.56, 0.56, 0.71)]), color: '#7a6a55' },
    chessBoard: { geo: new THREE.PlaneGeometry(0.42, 0.42).translate(0, 0, 0.737), color: '#ffffff' },
    chessPieces: { geo: M([...[-0.15, -0.09, -0.03, 0.03, 0.09, 0.15].flatMap((x) => [cyl(0.014, 0.018, 0.05, x, 0.15, 0.76, 6), cyl(0.014, 0.018, 0.05, x - 0.03, -0.12, 0.76, 6)]), cyl(0.02, 0.022, 0.08, 0.02, 0.08, 0.775, 6)]), color: '#e9e2d0', colors: ['#e9e2d0'] },
    chair: { geo: M([box(0.4, 0.4, 0.03, 0, 0, 0.45), box(0.03, 0.4, 0.4, -0.19, 0, 0.66), ...legs(0.36, 0.36, 0.45)]), color: '#3b3f45', metal: 0.4 },
    stool: { geo: M([cyl(0.17, 0.17, 0.04, 0, 0, 0.4, 14), ...[0, 2.1, 4.2].map((a) => cyl(0.014, 0.014, 0.4, Math.cos(a) * 0.12, Math.sin(a) * 0.12, 0.2, 5))]), color: '#b8322a' },
    guitar: { geo: M([new THREE.SphereGeometry(0.17, 12, 8).scale(0.3, 1, 1.2), new THREE.SphereGeometry(0.13, 12, 8).scale(0.3, 1, 1.1).translate(0, 0, 0.24), box(0.025, 0.05, 0.62, 0, 0, 0.62)]).rotateX(-1.0), color: '#a35a2a' },   // body in front of the chest, the neck up to the left
    guitarCase: { geo: M([box(0.38, 0.95, 0.08, 0, 0, 0.04), box(0.04, 0.95, 0.12, 0.17, 0, 0.1), box(0.04, 0.95, 0.12, -0.17, 0, 0.1)]), color: '#1f1f22' },
    coins: { geo: M([0, 1, 2, 3, 4].map((i) => cyl(0.012, 0.012, 0.004, Math.sin(i * 2.3) * 0.08, Math.cos(i * 1.7) * 0.2, 0.085, 8))), color: '#d8b04a', metal: 0.8 },
    mat: { geo: new THREE.PlaneGeometry(1.7, 1.7).translate(0, 0, 0.012), color: '#a07a4a' },
    boombox: { geo: M([box(0.22, 0.52, 0.28, 0, 0, 0.14), cyl(0.07, 0.07, 0.02, 0.11, 0.15, 0.13, 12), cyl(0.07, 0.07, 0.02, 0.11, -0.15, 0.13, 12), box(0.02, 0.4, 0.02, 0, 0, 0.31)]), color: '#2a2b30' },
    towel: { geo: new THREE.PlaneGeometry(1.75, 0.8).translate(-0.15, 0, 0.012), color: '#e8533a', colors: ['#e8533a', '#3d6fa8', '#f2c230', '#2e7d6a', '#c8372d'] },
    rope: { geo: new THREE.CylinderGeometry(0.012, 0.012, 1, 5).rotateZ(-Math.PI / 2).translate(0.5, 0, 0), color: '#d8cfa8' },   // along +x, 0 to 1 (scaled to its length)
    cooler: { geo: M([box(0.38, 0.58, 0.34, 0, 0, 0.17), box(0.4, 0.6, 0.05, 0, 0, 0.36)]), color: '#2f86c8' },
    djembe: { geo: M([cyl(0.16, 0.13, 0.22, 0, 0, 0.45, 12), cyl(0.07, 0.15, 0.32, 0, 0, 0.17, 12)]), color: '#7a4a26' },
    cardTable: { geo: M([box(0.78, 0.78, 0.03, 0, 0, 0.66), ...legs(0.7, 0.7, 0.65), ...[0, 1, 2, 3, 4, 5].map((i) => box(0.09, 0.06, 0.003, Math.sin(i * 1.9) * 0.18, Math.cos(i * 2.7) * 0.18, 0.677).rotateZ(i * 0.7))]), color: '#4f7a4a' },
    parklet: { geo: M([box(2.2, 3.4, 0.16, 0, 0, 0.08), box(0.3, 3.4, 0.45, -1.0, 0, 0.38), box(2.2, 0.3, 0.45, 0, 1.6, 0.38)]), color: '#8a6a44' },
    brunchTable: { geo: M([box(0.72, 1.3, 0.03, 0, 0, 0.72), cyl(0.04, 0.05, 0.71, 0, 0, 0.36, 8), ...[[0.15, 0.4], [-0.15, 0.35], [0.12, -0.3], [-0.18, -0.4]].map(([x, y]) => cyl(0.03, 0.025, 0.13, x, y, 0.8, 8))]), color: '#f2efe6' },
    bouquet: { geo: M([...[0, 1, 2, 3, 4, 5, 6].map((i) => new THREE.SphereGeometry(0.045, 6, 5).translate(Math.sin(i * 2.4) * 0.05, Math.cos(i * 2.4) * 0.05, 0.08 + (i % 3) * 0.02)), cyl(0.02, 0.012, 0.16, 0, 0, -0.02, 6)]), color: '#f2a0b8' },
    pedestal: { geo: box(0.62, 0.62, 0.42, 0, 0, 0.21), color: '#9aa0a6', metal: 0.5 },
    tipBucket: { geo: cyl(0.11, 0.09, 0.2, 0, 0, 0.1, 12), color: '#c9ccd1', metal: 0.8 },
    gullBody: { geo: M([new THREE.CapsuleGeometry(0.06, 0.18, 3, 8).rotateZ(Math.PI / 2), new THREE.SphereGeometry(0.05, 8, 6).translate(0.15, 0, 0.04), new THREE.ConeGeometry(0.018, 0.07, 5).rotateZ(-Math.PI / 2).translate(0.21, 0, 0.035)]), color: '#f2f2ee' },
    gullWing: { geo: box(0.14, 0.32, 0.012, 0, 0.16, 0), color: '#b9bec4' },
    cafeTable: { geo: M([cyl(0.36, 0.36, 0.03, 0, 0, 0.72, 16), cyl(0.04, 0.04, 0.71, 0, 0, 0.36, 8), cyl(0.22, 0.22, 0.02, 0, 0, 0.01, 12), cyl(0.04, 0.035, 0.1, 0.18, 0.12, 0.79, 8)]), color: '#2e3136', metal: 0.5 },
    laptop: { geo: M([box(0.22, 0.32, 0.015, 0, 0, 0.0075), box(0.012, 0.32, 0.21, -0.11, 0, 0.1).rotateY(-0.25)]), color: '#c9ccd1', metal: 0.6 },
    signBoard: { geo: M([cyl(0.015, 0.015, 1.2, 0, 0, -0.55, 5)]), color: '#8a6a44' },
  }
}

type PropMesh = { mesh: THREE.InstancedMesh; looks: Record<'grey' | 'cute' | 'real', THREE.Material>; n: number; colors: THREE.Color[] }
type VState = {
  d: VignetteDef; cx: number; cy: number; cz: number; near: number
  react: string; at: number; lineAt: number; inside: boolean; lines: number
  props: { kind: string; m: THREE.Matrix4; color: number; prop: VigProp }[]
  signs: THREE.Object3D[]; gulls: { a: number; r: number; h: number; speed: number }[]
}

/** The vignettes: their props (instanced, culled by distance, none past drawDistance), reactions, lines and sound. */
export class Vignettes {
  readonly group = Object.assign(new THREE.Group(), { name: 'vignettes' })
  readonly states: VState[] = []
  private d: VignetteData
  private meshes = new Map<string, PropMesh>()
  private style = ''
  private t = 0
  private lineAt = -1e9
  private scale = 1
  /** Say a line by id (sound.say: captioned). */
  say: (id: string) => void = () => {}
  /** A vignette's loop at a level 0..1 (sound.ts vignetteLoop), each frame for those with one. */
  loop: (id: string, kind: string, level: number) => void = () => {}
  /** A tip in the busker's jar (sound: a coin's clink), at a distance. */
  tip: (dist: number) => void = () => {}

  constructor(d: VignetteData, park: Park, gradient: THREE.Texture | null) {
    this.d = d
    const geos = propGeometries()
    const sky = (x: number, y: number) => raycast(park, { x, y, z: 400 }, { x: 0, y: 0, z: -1 }, 800)?.point.z ?? 0
    const counts = new Map<string, number>()
    for (const v of d.vignettes) {
      const ground = v.floor !== undefined ? () => v.floor! : sky   // indoors: the room's floor (from above, the roof)
      const c = vigPoint(v, 0, 0), st: VState = { d: v, cx: c.x, cy: c.y, cz: ground(c.x, c.y), near: v.near ?? 12, react: '', at: -1e9, lineAt: -1e9, inside: false, lines: 0, props: [], signs: [], gulls: [] }
      for (const pr of v.props) {
        const w = vigPoint(v, pr.at[0], pr.at[1]), z = ground(w.x, w.y) + (pr.z ?? 0)
        const yaw = vigYaw(v.heading, pr.face)
        if (pr.kind === 'gull') { st.gulls.push({ a: (pr.face * Math.PI) / 180, r: 1.4 + st.gulls.length * 0.35, h: 2.2 + st.gulls.length * 0.4, speed: 1.1 + st.gulls.length * 0.25 }); continue }
        if (pr.kind === 'sign') { st.signs.push(this.sign(pr.text ?? '', new THREE.Vector3(w.x, w.y, ground(w.x, w.y) + (pr.z ?? 1.0)), yaw, !!pr.held)); continue }
        const kinds = pr.kind === 'chessTable' ? ['chessTable', 'chessBoard', 'chessPieces'] : pr.kind === 'guitarCase' ? ['guitarCase', 'coins'] : [pr.kind]
        for (const k of kinds) {
          if (!geos[k]) continue
          const len = pr.kind === 'rope' ? pr.length ?? 8 : 1
          const m = new THREE.Matrix4().compose(new THREE.Vector3(w.x, w.y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), pr.kind === 'rope' ? vigYaw(v.heading, pr.face) : yaw), new THREE.Vector3(len, 1, 1))
          st.props.push({ kind: k, m, color: st.props.length, prop: pr })
          counts.set(k, (counts.get(k) ?? 0) + 1)
        }
      }
      if (st.gulls.length) counts.set('gullBody', (counts.get('gullBody') ?? 0) + st.gulls.length), counts.set('gullWing', (counts.get('gullWing') ?? 0) + st.gulls.length * 2)
      this.states.push(st)
    }
    const board = checker()
    for (const [k, def] of Object.entries(geos)) {
      const n = counts.get(k) ?? 0
      if (!n) continue
      const map = k === 'chessBoard' ? board : null
      const looks = {
        grey: new THREE.MeshLambertMaterial({ color: 0xffffff, map, side: k === 'mat' || k === 'towel' || k === 'gullWing' ? THREE.DoubleSide : THREE.FrontSide }),
        cute: gradient ? new THREE.MeshToonMaterial({ color: 0xffffff, map, gradientMap: gradient, side: k === 'mat' || k === 'towel' || k === 'gullWing' ? THREE.DoubleSide : THREE.FrontSide }) : new THREE.MeshLambertMaterial({ color: 0xffffff, map }),
        real: new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: def.metal ? 0.4 : 0.85, metalness: def.metal ?? 0, side: k === 'mat' || k === 'towel' || k === 'gullWing' ? THREE.DoubleSide : THREE.FrontSide }),
      }
      const mesh = new THREE.InstancedMesh(def.geo, looks.cute, n)
      mesh.count = 0; mesh.frustumCulled = false; mesh.castShadow = k !== 'mat' && k !== 'towel' && k !== 'chessBoard'; mesh.receiveShadow = true
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3).fill(1), 3)
      mesh.name = `vignette:${k}`
      this.meshes.set(k, { mesh, looks, n: 0, colors: (def.colors ?? [def.color]).map((c) => new THREE.Color(c)) })
      this.group.add(mesh)
    }
  }

  /** Quality: the draw distance's scale (the preset's). */
  setScale(s: number) { this.scale = s }

  /** Match the renderer's look. */
  setStyle(style: string) {
    if (style === this.style) return
    this.style = style
    const key = (style === 'real' || style === 'grey' ? style : 'cute') as 'grey' | 'cute' | 'real'
    for (const m of this.meshes.values()) m.mesh.material = m.looks[key]
    for (const s of this.states) for (const g of s.signs) g.visible = true
  }

  /** A line's voice and words by its id (clips caption and say them). */
  lineText(id: string): { voice: string; text: string } | null {
    for (const s of this.states) { const l = s.d.lines.find((x) => x.id === id); if (l) return { voice: l.voice, text: l.text } }
    return null
  }

  /** What a vignette is reacting to now and for how long (the crowd's people pose from it). */
  state(i: number): VigReact { const s = this.states[i]; return s && s.react ? { kind: s.react, age: this.t - s.at } : null }

  /** The player's events (main's tick): a big combo, a trick or a grind near a vignette. */
  event(e: SimEvent, x: number, y: number) {
    const on = e.t === 'comboLanded' && e.points >= this.d.bigPoints ? 'combo' : e.t === 'trickStart' ? 'trick' : e.t === 'grindStart' ? 'grind' : null
    if (!on) return
    for (const s of this.states) {
      if (Math.hypot(x - s.cx, y - s.cy) > s.near) continue
      const kind = s.d.react[on]
      if (!kind && !s.d.lines.some((l) => l.on === on)) continue
      this.trigger(s, on, kind ?? '', Math.hypot(x - s.cx, y - s.cy))
    }
  }

  private trigger(s: VState, on: string, kind: string, dist: number) {
    if (kind) { s.react = kind; s.at = this.t }
    if (kind === 'tip') this.tip(dist)
    // A line: this vignette's next for the moment, when the player can hear it and nobody spoke just now.
    const pool = s.d.lines.filter((l) => l.on === on)
    if (!pool.length || dist > this.d.hear || this.t - s.lineAt < this.d.lineCooldown || this.t - this.lineAt < this.d.globalCooldown) return
    const l = pool[s.lines++ % pool.length]
    s.lineAt = this.t; this.lineAt = this.t
    this.say(l.id)
  }

  /**
   * Each frame (crowd.ts update calls it): the time in seconds (the world's, so clips and shots agree); the skater
   * (position and speed, or null) for skating through; the camera for what is drawn and how loud each loop is.
   */
  update(t: number, skater: { x: number; y: number; z: number; speed: number } | null, camera: THREE.Vector3) {
    if (t < this.t - 1) { for (const s of this.states) { s.react = ''; s.at = -1e9; s.lineAt = -1e9; s.inside = false } this.lineAt = -1e9 }   // time went back (a new run, a clip): no reactions carried
    this.t = t
    const far = this.d.drawDistance * this.scale
    for (const m of this.meshes.values()) m.n = 0
    for (const s of this.states) {
      // Skating through: once each time you come in at speed (leave and come back for another).
      if (skater) {
        const d = Math.hypot(skater.x - s.cx, skater.y - s.cy), inside = d < s.near * 0.55 && Math.abs(skater.z - s.cz) < 4
        if (inside && !s.inside && skater.speed > this.d.passSpeed) this.trigger(s, 'pass', s.d.react.pass ?? '', d)
        s.inside = inside
      }
      if (s.react && this.t - s.at > 6) s.react = ''
      const cd = Math.hypot(camera.x - s.cx, camera.y - s.cy)
      if (s.d.sound) this.loop(s.d.id, s.d.sound, 1 - smooth(this.d.soundFar * 0.35, this.d.soundFar, Math.hypot(camera.x - s.cx, camera.y - s.cy, camera.z - s.cz)))
      const shown = cd < far
      for (const g of s.signs) g.visible = shown
      if (!shown) continue
      for (const p of s.props) this.put(p.kind, p.m, p.color)
      if (s.gulls.length) this.drawGulls(s)
    }
    for (const m of this.meshes.values()) {
      m.mesh.count = m.n; m.mesh.visible = m.n > 0
      m.mesh.instanceMatrix.needsUpdate = true
      if (m.mesh.instanceColor) m.mesh.instanceColor.needsUpdate = true
    }
  }

  private put(kind: string, m: THREE.Matrix4, color: number) {
    const P = this.meshes.get(kind)
    if (!P || P.n >= P.mesh.instanceMatrix.count) return
    P.mesh.setMatrixAt(P.n, m)
    const c = P.colors[color % P.colors.length]
    P.mesh.setColorAt(P.n, c)
    P.n++
  }

  /** The gulls round the bread bowl: circling, a swoop at it now and then; skate through and they scatter up and away a while. */
  private drawGulls(s: VState) {
    const t = this.t, scatter = s.react === 'scatter' ? Math.max(0, 1 - Math.abs(this.t - s.at - 2.5) / 2.5) : 0
    s.gulls.forEach((g, i) => {
      const a = g.a + t * g.speed, swoop = Math.pow(Math.max(0, Math.sin(t * 0.7 + i * 2.1)), 12)
      const r = g.r * (1 - swoop * 0.7) + scatter * 9, h = g.h - swoop * 1.0 + scatter * 7
      const x = s.cx + Math.cos(a) * r, y = s.cy + Math.sin(a) * r, z = s.cz + h
      const yaw = a + Math.PI / 2, flap = Math.sin(t * (scatter > 0 ? 18 : 9) + i) * 0.6
      const body = TMP_M.compose(TMP_V.set(x, y, z), TMP_Q.setFromEuler(TMP_E.set(0, 0, yaw)), TMP_S.set(1, 1, 1))
      this.put('gullBody', body, 0)
      for (const side of [1, -1]) this.put('gullWing', TMP_M2.copy(body).multiply(TMP_M3.makeRotationX(side * flap)).multiply(TMP_M4.makeScale(1, side, 1)), 0)
    })
  }

  /** A cardboard sign with its words (a canvas texture): on a stake, or held up (the protester's). */
  private sign(text: string, at: THREE.Vector3, yaw: number, held: boolean): THREE.Object3D {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null
    const g = new THREE.Group()
    let tex: THREE.Texture | null = null
    if (c) {
      c.width = 512; c.height = 320
      const x = c.getContext('2d')!
      x.fillStyle = '#c9a774'; x.fillRect(0, 0, 512, 320)
      x.fillStyle = '#1d1d22'; x.textAlign = 'center'; x.textBaseline = 'middle'
      const rows = text.split('\n'), size = Math.min(84, Math.floor(280 / rows.length))
      x.font = `bold ${size}px "Marker Felt", "Comic Sans MS", sans-serif`
      rows.forEach((r, i) => x.fillText(r, 256, 160 + (i - (rows.length - 1) / 2) * size * 1.05, 480))
      tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace
    }
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.8, 0.5), new THREE.MeshLambertMaterial({ color: 0xc9a774 }))
    // Both faces read the right way round (width along y, facing +x and -x).
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: tex ? 0xffffff : 0xc9a774 })
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0.012, 0, 0), mat)
    const back = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5).rotateX(Math.PI / 2).rotateZ(-Math.PI / 2).translate(-0.012, 0, 0), mat)
    const stake = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, held ? 0.6 : 1.1, 5).rotateX(Math.PI / 2).translate(0, 0, held ? -0.5 : -0.75), new THREE.MeshLambertMaterial({ color: 0x8a6a44 }))
    g.add(board, face, back, stake)
    g.position.copy(at); g.rotation.z = yaw
    g.castShadow = true
    this.group.add(g)
    return g
  }
}

/** A chessboard's squares (a canvas texture). */
function checker(): THREE.Texture | null {
  if (typeof document === 'undefined') return null
  const c = document.createElement('canvas'); c.width = c.height = 128
  const x = c.getContext('2d')!
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? '#3a2a1e' : '#e9dfc8'; x.fillRect(i * 16, j * 16, 16, 16) }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter
  return t
}

const TMP_M = new THREE.Matrix4(), TMP_M2 = new THREE.Matrix4(), TMP_M3 = new THREE.Matrix4(), TMP_M4 = new THREE.Matrix4()
const TMP_V = new THREE.Vector3(), TMP_S = new THREE.Vector3(), TMP_Q = new THREE.Quaternion(), TMP_E = new THREE.Euler()
