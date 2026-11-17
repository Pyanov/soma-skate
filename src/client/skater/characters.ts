import * as THREE from 'three'
import { Character } from './character.ts'
import { Face, type FaceSpec } from './face.ts'
import type { Gait } from './gait.ts'
import type { BoardDesign } from './board.ts'
import type { Flair } from './poses.ts'
import type { Signature } from './specials.ts'
import { hash2 } from './tex.ts'
import { PEOPLE_BUILDERS } from './people.ts'
import { kitPerson, type KitRecipe } from './kitpeople.ts'
import { ARM_SHAPE, bindMesh, bone2bone, buildRig, capsuleBetween, detailMaps, foldMaps, fur, furSurface, humanHead, lathe, LEG_SHAPE, M, merged, pivot, rigid, softBox, surface, tube, type Rig, type RigSpec, type V3 } from './kit.ts'
import { clamp01, fbm, img, mix, normalFromHeight, rgb, roughMap, smooth, textCoverage, texture } from './tex.ts'

// The roster: funny, pickable skaters built in code on the kit (kit.ts), proportions and
// colours from data/characters.json. Each builder returns the rig as a Character (so the
// shared pose solver and IK drive it), its Face, and an optional per-frame hook for
// secondary motion (blob squash and jiggle, the cape, the skeleton's jaw). Hooks are pure
// functions of the frame's context, so shots of a snapshot stay deterministic.

/** style.secondary: damped follow-through of a character's loose parts (the mascot's ears, the cape), from the hook's timers. */
export type Secondary = { land?: number; decay?: number; freq?: number; air?: number; fall?: number; speed?: number; idle?: number }
export type Style = { bend: number; arms: number; stretch: number; swing: number; squash?: number; wings?: number; secondary?: Secondary; bailSay?: string; celebrate: string[]; idle: string; neutral: string; walk?: Partial<Gait>; flair?: Flair; signature?: Signature; idles?: string[]; board?: BoardDesign; emote?: { kind: string; say: string } }
/** An alternate outfit: colour overrides and optional parts the builder adds (data/characters.json outfits). */
export type Outfit = { id: string; name: string; colors?: Record<string, string>; parts?: string[] }
/** A secret skater's unlock: Tour secret tapes found (across levels), Tour goals done, a Tour level finished, or a story mission done (story: data/missions.json id; src/client/unlocks.ts). */
export type Unlock = { tapes?: number; goals?: number; level?: string; story?: string; orStory?: string; hint: string }   // orStory: that story mission done unlocks it too
export type CharacterSpec = { id: string; name: string; lazy?: boolean; unlock?: Unlock; bio?: string[]; rig: RigSpec; style: Style; colors: Record<string, string>; outfits?: Outfit[]; parts?: string[]; kit?: KitRecipe }
/** characters.json board: the trucks turning with the carve, the wheels spinning, the deck flexing. */
export type BoardFx = { truckSteer: number; truckLevel: number; spinMaxStep: number; flexLand: number; flexPop: number; flexTicks: number }
/** characters.json squash: landing squash and stretch (each character's style.squash scales it). */
export type SquashFx = { amount: number; minAir: number; impact: [number, number]; decay: number; rate: number }
export type CharactersData = { board?: BoardFx; squash?: SquashFx; spectators?: import('../spectators.ts').SpectatorData; npcs?: import('../npcs.ts').NpcViewData; ghost?: import('../ghostview.ts').GhostData; people?: CharacterSpec[]; castView?: import('../castpeople.ts').CastViewData; default: string; poseRig: { leg: number; ankle: number; hipJoint: number; hipX: number; shoulderX: number; arm: number }; characters: CharacterSpec[] }

/** What a hook sees each frame (all derived from the Thing). */
export type HookCtx = { speed: number; up: number; air: boolean; crouch: number; landed: number; squash: number; ticks: number; mood: string; idle: number; bail: boolean; walk: number; phone: boolean; special: number; specialQ: number; specialT: number; specialId: string; bailT: number; idleName: string; idleT: number; idleK: number; root: THREE.Object3D; ground: ((x: number, y: number, z: number) => number | null) | null }

export type Built = { spec: CharacterSpec; character: Character; face: Face | null; hook?: (c: HookCtx) => void; headTop: number; outfit: string }
export type Draft = Omit<Built, 'headTop' | 'outfit'>

const C = (s: CharacterSpec, k: string) => s.colors[k]
const has = (s: CharacterSpec, part: string) => (s.parts ?? []).includes(part)
const sRGB = (hex: string): [number, number, number] => rgb(hex)

// ---------------------------------------------------------------- shared parts

/** Arms and legs as skinned tubes; rubber-hose limbs blend along the whole segment. */
function limbs(rig: Rig, arm: THREE.Material, leg: THREE.Material, r: { arm: [number, number, number]; leg: [number, number, number] }, hose = false) {
  for (const side of ['Left', 'Right']) {
    // Rubber hose stays a hose; a body's limbs get their shape (shoulder, elbow, forearm; thigh, knee, calf).
    tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], r.arm, arm, { blend: hose ? 0.3 : 0.045, per: hose ? 10 : 6, ...(hose ? {} : { bulge: ARM_SHAPE }) })
    tube(rig, [`${side}UpLeg`, `${side}Leg`, `${side}Foot`], r.leg, leg, { blend: hose ? 0.3 : 0.06, per: hose ? 10 : 6, ...(hose ? {} : { bulge: LEG_SHAPE }) })
  }
}

/**
 * A hand: a soft palm block with the knuckles' ridge across its back and the thumb's pad under it (one mesh),
 * fingers in three tapering segments on their bones with round tips, the thumb in two.
 */
export function hand(rig: Rig, side: string, mat: THREE.Material, o: { r: number; palm: [number, number, number]; fingers?: number }) {
  const k = side === 'Left' ? 1 : -1
  const w = rig.at(`${side}Hand`)
  const len = rig.at(`${side}HandMiddle1`).x - w.x, L = Math.abs(len)
  const names = (o.fingers ?? 4) === 4 ? ['Index', 'Middle', 'Ring', 'Pinky'] : ['Index', 'Middle', 'Ring']
  const palm: [THREE.BufferGeometry, THREE.Matrix4?][] = [[softBox(0.5, 2), M([w.x + len * 0.53, w.y, w.z], [0, 0, 0], [L * 0.56 * o.palm[0], o.palm[1], o.palm[2]])]]
  if (o.palm[1] > 0.015) {
    // A flesh hand (not the skeleton's): the knuckles and the ball of the thumb.
    const f0 = rig.at(`${side}Hand${names[0]}1`), f1 = rig.at(`${side}Hand${names[names.length - 1]}1`)
    palm.push([new THREE.CapsuleGeometry(o.r * 1.05, Math.max(0.001, Math.abs(f0.z - f1.z)), 2, 6), M([f0.x - k * o.r * 0.7, w.y + o.palm[1] * 0.2, (f0.z + f1.z) / 2], [Math.PI / 2, 0, 0])])
    palm.push([new THREE.SphereGeometry(1, 8, 6), M([w.x + len * 0.32, w.y - o.palm[1] * 0.3, w.z + o.palm[2] * 0.5], [0, 0, 0], [L * 0.3, o.palm[1] * 0.75, o.palm[2] * 0.48])])
  }
  rigid(rig, `${side}Hand`, merged(palm), mat)
  for (const f of names) for (let j = 1; j <= 3; j++) {
    const b = `${side}Hand${f}${j}`
    const a = rig.at(b)
    const end = j < 3 ? rig.at(`${side}Hand${f}${j + 1}`) : a.clone().add(new THREE.Vector3(k * o.r * 2.6, 0, 0))
    const r = o.r * (f === 'Pinky' ? 0.86 : 1) * (j === 1 ? 1.05 : j === 2 ? 0.94 : 0.84)
    bone2bone(rig, b, a.toArray() as V3, end.toArray() as V3, r, mat)
  }
  const t1 = rig.at(`${side}HandThumb1`), t2 = rig.at(`${side}HandThumb2`)
  bone2bone(rig, `${side}HandThumb1`, t1.toArray() as V3, t2.toArray() as V3, o.r * 1.18, mat)
  bone2bone(rig, `${side}HandThumb2`, t2.toArray() as V3, t2.clone().add(new THREE.Vector3(k * o.r * 2.2, 0, o.r * 1.2)).toArray() as V3, o.r * 0.95, mat)
}

/** The shoe's plan: half width at s (0 heel .. 1 toe) as a share of the widest, the toe and heel rounded off. */
const shoePlan = (s: number) => { const e = Math.min(1, Math.abs(2 * Math.min(0.999, Math.max(0.001, s)) - 1)); return (0.8 + 0.2 * smooth(0.1, 0.6, s)) * Math.pow(Math.max(0, 1 - e ** 5), 1 / 5) }

/**
 * A skate shoe on the Foot bone: a cup sole (the plan extruded with rounded edges), the upper from its side
 * profile (heel counter, padded collar, tongue, laced vamp, toe box) rounded by a bevel and narrowed to the plan,
 * laces across the vamp and a rubber toe cap. Upper and sole the same material (bare feet, dress shoes): neither.
 * The sole, laces and cap are one mesh, the upper another.
 */
export function shoe(rig: Rig, side: string, upper: THREE.Material, sole: THREE.Material, o: { len: number; w: number; h: number; heel?: number; puffy?: number }) {
  const a = rig.at(`${side}Foot`)
  const heel = o.heel ?? o.len * 0.28
  const z0 = a.z - heel, L = o.len, W = o.w * (o.puffy ?? 1)
  const sh = 0.026, H = 0.026 + o.h * 0.97
  const at = (s: number) => z0 + s * L
  // Sole: the plan (x across, shape y = model z), extruded down from the top of the sole.
  const plan = new THREE.Shape(), n = 14
  for (let i = 0; i <= n; i++) { const s = i / n, x = (W / 2) * shoePlan(s); if (i === 0) plan.moveTo(x, at(s)); else plan.lineTo(x, at(s)) }
  for (let i = n; i >= 0; i--) { const s = i / n; plan.lineTo(-(W / 2) * shoePlan(s), at(s)) }
  const soleGeo = new THREE.ExtrudeGeometry(plan, { depth: sh - 0.008, bevelEnabled: true, bevelThickness: 0.004, bevelSize: 0.004, bevelSegments: 1, curveSegments: 4 })
  soleGeo.rotateX(Math.PI / 2)
  soleGeo.translate(a.x, sh - 0.004, 0)
  // Upper: the side profile (z along from the heel, y up), extruded across, rounded by the bevel, narrowed to the plan.
  const B = 0.012, D = W - 2 * 0.018
  const P: [number, number][] = [
    [0.012, sh - 0.002], [0.97, sh - 0.002], [0.995, sh + 0.012], [0.975, sh + 0.03], [0.9, sh + 0.045],
    [0.62, H * 0.6], [0.44, H * 0.83], [0.34, H * 0.99], [0.28, H * 0.9], [0.15, H * 0.86], [0.03, H * 0.96], [0.0, H * 0.78], [0.0, sh + 0.02],
  ]
  const prof = new THREE.Shape()
  P.forEach(([s, y], i) => { const Z = B + s * (L - 2 * B), Y = y > sh + 0.02 ? y - B : y; if (i === 0) prof.moveTo(Z, Y); else prof.lineTo(Z, Y) })
  const up = new THREE.ExtrudeGeometry(prof, { depth: D, bevelEnabled: true, bevelThickness: 0.018, bevelSize: B, bevelSegments: 3, curveSegments: 4 })
  up.translate(0, 0, -D / 2)
  up.rotateY(-Math.PI / 2)
  const pos = up.getAttribute('position')
  for (let i = 0; i < pos.count; i++) { const z = pos.getZ(i); pos.setX(i, pos.getX(i) * shoePlan(z / L) * 0.96 + a.x); pos.setZ(i, z + z0) }
  up.computeVertexNormals()
  rigid(rig, `${side}Foot`, up, upper)
  const rubber: [THREE.BufferGeometry, THREE.Matrix4?][] = [[soleGeo]]
  if (upper !== sole) {
    const p0 = new THREE.Vector2(at(0.62), H * 0.6 + 0.002), p1 = new THREE.Vector2(at(0.44), H * 0.83 + 0.002)
    const ang = Math.atan2(p1.y - p0.y, p0.x - p1.x)
    for (let j = 0; j < 4; j++) { const q = p0.clone().lerp(p1, 0.12 + j * 0.25); rubber.push([new THREE.BoxGeometry(W * 0.42, 0.005, 0.009), M([a.x, q.y, q.x], [ang, 0, 0])]) }
    rubber.push([new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2), M([a.x, sh - 0.004, at(0.9)], [0, 0, 0], [W * 0.4, 0.024, L * 0.1])])
  }
  rigid(rig, `${side}Foot`, merged(rubber), sole)
}

/**
 * A label texture wrapped round a can (u around from the back, v up): Hella Fría, a made-up Mission lager.
 * The colour keys are slots (paints.json and the outfits paint them): gold is the bare can, navy the band
 * round the middle (the face sits on it), red the badge's sun, cream the rules and the name. The badge above
 * the face is a sun going down behind two bars of fog on a horizon line; HELLA in big letters under the
 * face, FRIA under it, LAGER round the foot.
 */
function canLabel(s: CharacterSpec): { map: THREE.Texture; rough: THREE.Texture } {
  const W = 512, H = 256
  const gold = sRGB(C(s, 'gold')), navy = sRGB(C(s, 'navy')), red = sRGB(C(s, 'red')), cream = sRGB(C(s, 'cream'))
  const a = img(W, H), r = new Float32Array(W * H)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = 1 - y / H                 // v: 0 at the can's foot, 1 at the lid
    let c = [...gold]
    if (v > 0.16 && v < 0.8) c = [...navy]
    if (Math.abs(v - 0.16) < 0.006 || Math.abs(v - 0.8) < 0.006) c = [...cream]
    const fu = -((u - 0.25 + 1.5) % 1 - 0.5) * 6.28  // radians from the front (the face side), left to right
    // The badge: a half sun on a horizon, two fog bars across it.
    const sun = Math.hypot(fu / 0.34, (v - 0.852) / 0.085)
    if (sun < 1 && v > 0.852) c = Math.abs(v - 0.882) < 0.008 || Math.abs(v - 0.906) < 0.007 ? [...gold] : [...red]
    if (Math.abs(v - 0.846) < 0.006 && Math.abs(fu) < 0.46) c = [...navy]
    const t = textCoverage('HELLA', (0.74 - fu) / 1.48 * 5, (0.45 - v) / 0.16)
    if (t > 0) c = c.map((q, i) => mix(q, cream[i], t))
    const t1 = textCoverage('FRIA', (0.34 - fu) / 0.68 * 4, (0.262 - v) / 0.07)
    if (t1 > 0) c = c.map((q, i) => mix(q, red[i], t1))
    const t2 = textCoverage('LAGER', (0.5 - fu) / 1.0 * 5, (0.125 - v) / 0.055)
    if (t2 > 0) c = c.map((q, i) => mix(q, navy[i], t2))
    const n = fbm(x / 20, y / 20, W / 20, 2, 4)
    a.d.set([c[0] * (0.95 + n * 0.1), c[1] * (0.95 + n * 0.1), c[2] * (0.95 + n * 0.1), 1], (y * W + x) * 4)
    r[y * W + x] = 0.32 + n * 0.12
  }
  const rough = img(W, H)
  for (let i = 0; i < W * H; i++) rough.d.set([1, r[i], 0.75, 1], i * 4)
  return { map: texture(a, true), rough: texture(rough, false) }
}

export const skinDetail = (seed: number) => detailMaps(seed, 6, 0.55, 0.15, 1.2)

/** A baseball jersey for the made-up SoMa Fog (the mascot's team): navy with orange piping down the front and FOG on the chest (u around, v up). */
function jerseyMaterial(): THREE.MeshLambertMaterial {
  const W = 256, H = 128
  const a = img(W, H)
  const black = rgb('#1f2c52'), orange = rgb('#f08a1c'), cream = rgb('#f2ece0')
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = 1 - y / H
    let c: number[] = [...black]
    const fu = -((u - 0.25 + 1.5) % 1 - 0.5) * 6.28
    if (Math.abs(fu) < 0.035) c = [...orange]
    const t = textCoverage('FOG', (0.75 - fu) / 1.5 * 3, (0.78 - v) / 0.3)
    if (t > 0) c = c.map((q, i) => mix(q, orange[i], t))
    if (v > 0.93) c = [...cream]
    a.d.set([c[0], c[1], c[2], 1], (y * W + x) * 4)
  }
  return surface('jersey', { color: 0xffffff, flat: '#1f2c52', map: texture(a, true), roughness: 0.85, sheen: 0.4, sheenColor: '#444444' })
}

// ---------------------------------------------------------------- the roster

function can(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const label = canLabel(s)
  // The flat looks show the label as printed (multiplied by the gold it turned dark green, and black once the trim is painted black).
  const body = surface('can label', { color: 0xffffff, map: label.map, roughnessMap: label.rough, roughness: 1, metalness: 1, clearcoat: 0.6, clearcoatRoughness: 0.2 })
  const alu = surface('can aluminium', { color: 0xc9ccd0, roughness: 0.22, metalness: 1 })
  const limb = surface('rubber hose', { color: C(s, 'limb'), roughness: 0.5, clearcoat: 0.3 })
  const glove = surface('glove', { color: C(s, 'glove'), roughness: 0.6 })
  const shoeM = surface('shoe', { color: C(s, 'shoe'), roughness: 0.45, clearcoat: 0.5 })
  const soleM = surface('sole', { color: C(s, 'sole'), roughness: 0.6 })
  const hipsY = rig.at('Hips').y, R = 0.2, top = hipsY + 0.74
  // The can: rolled bottom rim, label body, neck taper, lid; skinned up the spine so it bends a little.
  const prof: [number, number, number][] = [[hipsY - 0.02, 0.0, 0.0], [hipsY - 0.02, R * 0.78, R * 0.78], [hipsY, R * 0.93, R * 0.93], [hipsY + 0.03, R, R]]
  for (let k = 1; k <= 10; k++) { const y = hipsY + 0.03 + (k / 10) * 0.6; prof.push([y, R, R]) }
  prof.push([top - 0.08, R * 0.97, R * 0.97], [top - 0.03, R * 0.84, R * 0.84], [top, R * 0.84, R * 0.84], [top, 0, 0])
  const canBody = lathe(rig, prof, ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], body, {
    sides: 40,
    // A dent in the front for the bails (pops back out on recovery).
    morphs: {
      dent: (p, f) => { const k = Math.exp(-(((f - 0.55) / 0.13) ** 2)) * Math.max(0, p.z / R) ** 3; return new THREE.Vector3(p.x * (1 + 0.08 * k), p.y, p.z - 0.075 * k) },
      // Crushed (the retro can): folds round the middle, a slight twist, the body squeezed in.
      crush: (p, f) => {
        const a = Math.atan2(p.z, p.x), mid = Math.sin(Math.PI * Math.min(1, Math.max(0, (f - 0.12) / 0.8)))
        const k = 1 - mid * (0.15 + 0.13 * Math.abs(Math.sin(a * 3 + f * 9)))
        const tw = mid * 0.3
        return new THREE.Vector3((p.x * Math.cos(tw) - p.z * Math.sin(tw)) * k, p.y, (p.x * Math.sin(tw) + p.z * Math.cos(tw)) * k)
      },
    },
  })
  if (has(s, 'crushed')) canBody.morphTargetInfluences![1] = 1
  // Aluminium rims and lid with the pull tab.
  rigid(rig, 'Neck', new THREE.TorusGeometry(R * 0.84, 0.012, 8, 40), alu, [0, top, 0], [Math.PI / 2, 0, 0])
  rigid(rig, 'Neck', new THREE.CylinderGeometry(R * 0.82, R * 0.82, 0.008, 40), alu, [0, top - 0.004, 0])
  // The pull-tab on its rivet (it opens in the can's idle: pssht).
  const tab = pivot(rig, 'Neck', [0, top + 0.006, 0])
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.008, 6, 20), alu)
  ring.position.set(0, 0, -0.03); ring.rotation.x = Math.PI / 2; ring.scale.set(1, 1.5, 1)
  const lever = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.006, 0.06), alu)
  lever.position.set(0, -0.001, 0.03)
  tab.add(ring, lever)
  rigid(rig, 'Hips', new THREE.TorusGeometry(R * 0.8, 0.014, 8, 40), alu, [0, hipsY - 0.012, 0], [Math.PI / 2, 0, 0])
  limbs(rig, limb, limb, { arm: [0.03, 0.028, 0.026], leg: [0.034, 0.03, 0.028] }, true)
  for (const side of ['Left', 'Right']) {
    hand(rig, side, glove, { r: 0.014, palm: [1, 0.035, 0.05], fingers: 4 })
    rigid(rig, `${side}Hand`, new THREE.TorusGeometry(0.036, 0.014, 8, 16), glove, rig.at(`${side}Hand`).toArray() as V3, [0, Math.PI / 2, 0])
    shoe(rig, side, shoeM, soleM, { len: 0.27, w: 0.12, h: 0.11, puffy: 1.15 })
  }
  // Foam for the signature specials: blobs spraying from the opened tab (hidden otherwise).
  const foamM = surface('foam', { color: '#fbf6e8', roughness: 0.85 })
  const foamAt = pivot(rig, 'Neck', [0, top + 0.01, 0.03])
  const foam = Array.from({ length: 40 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.022 + hash2(i, 1, 5) * 0.02, 1), foamM)
    m.castShadow = false
    m.scale.setScalar(1e-4)
    foamAt.add(m)
    return { m, dir: new THREE.Vector3((hash2(i, 2, 5) - 0.5) * 0.8, 1, 0.3 + (hash2(i, 3, 5) - 0.5) * 0.7).normalize(), born: (i / 40) * 52, speed: 2 + hash2(i, 4, 5) * 1.2 }
  })
  const hook = (c: HookCtx) => {
    // Opening itself standing still: the tab lifts, a puff of foam (pssht), and later closes.
    const opening = c.idleName === 'canOpen' ? c.idleK * smooth(20, 34, c.idleT) * (1 - smooth(400, 460, c.idleT)) : 0
    tab.rotation.x = 1.05 * opening
    const puff = c.idleName === 'canOpen' && c.idleT > 30 && c.idleT < 330
    for (const f of foam) {
      // Opening: a puff, then foam keeps welling up over the rim while it is open.
      const age = puff ? (c.idleT - 32 - f.born * 0.6) % 70 : c.specialT - f.born
      const life = puff ? 60 : 24
      const on = puff ? opening : c.special
      if (on < 0.05 || age < 0 || age > life) { f.m.scale.setScalar(1e-4); continue }
      const s = age / 120
      f.m.position.copy(f.dir).multiplyScalar(f.speed * s * (puff ? 0.35 : 1)).add(new THREE.Vector3(0, -4.9 * s * s * (puff ? 0.3 : 1), 0))
      f.m.scale.setScalar((1 + age / life * 1.5) * (1 - smooth(life * 0.7, life, age)) * on * (puff ? 0.7 : 1) + 1e-4)
    }
    // Bails dent the can; it pops back out as it gets up.
    const inf = canBody.morphTargetInfluences!
    inf[0] = c.bailT >= 0 ? smooth(22, 30, c.bailT) * (1 - smooth(138, 149, c.bailT)) : 0
  }
  const face = new Face(rig, {
    bone: 'UpperChest',
    eyes: { at: [0.07, top - 0.2, R * 0.86], r: 0.052, squash: [0.9, 1.15, 0.6], iris: '#3b2a1a', irisR: 0.03, pupilR: 0.018 },
    lids: { color: C(s, 'gold') },
    brows: { color: C(s, 'gold'), size: [0.06, 0.016, 0.012], up: 0.075 },
    mouth: { bone: 'Chest', at: [0, top - 0.33, R + 0.005], size: [0.16, 0.08], bend: R + 0.005, colors: { line: C(s, 'cream'), inside: '#2a0a0c', teeth: '#fbfbf6', tongue: '#e15467' } },
  } satisfies FaceSpec)
  return { spec: s, character: new Character(rig.root), face, hook }
}

function blob(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  // No transmission: one transmissive material makes three render the whole scene again every frame
  // (about 6 ms at 3200x1800 whenever a blob is on screen); clearcoat and a soft sheen read as gel.
  const gel = surface('gel', { color: C(s, 'gel'), roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05, sheen: 0.55, sheenColor: '#e6ffdc' })
  const hipsY = rig.at('Hips').y
  const prof: [number, number, number][] = []
  const H = 0.95, y0 = hipsY - 0.08
  for (let k = 0; k <= 22; k++) {
    const t = k / 22, y = y0 + t * H
    // Teardrop: wide bottom, a soft shoulder, a rounded top.
    const r = 0.37 * (1 - 0.3 * t) * Math.pow(Math.sin(Math.PI * t), 0.55)
    prof.push([y, Math.max(0.0, r), Math.max(0.0, r * 0.92)])
  }
  prof.push([y0 + H + 0.005, 0, 0])
  const body = lathe(rig, prof, ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], gel, {
    sides: 36,
    morphs: {
      squash: (p, f) => new THREE.Vector3(p.x * (1 + 0.28 * (1 - f * 0.4)), y0 + (p.y - y0) * 0.72, p.z * (1 + 0.28 * (1 - f * 0.4))),
      stretch: (p, f) => new THREE.Vector3(p.x * (1 - 0.16 * f), y0 + (p.y - y0) * 1.22, p.z * (1 - 0.16 * f)),
      wobble: (p, f) => new THREE.Vector3(p.x + 0.06 * f * f, p.y, p.z),
      splat: (p, f) => new THREE.Vector3(p.x * (1.9 - 0.6 * f), p.y, p.z * (1.9 - 0.6 * f)),
    },
  })
  limbs(rig, gel, gel, { arm: [0.045, 0.04, 0.035], leg: [0.06, 0.055, 0.05] }, true)
  for (const side of ['Left', 'Right']) {
    hand(rig, side, gel, { r: 0.016, palm: [1, 0.035, 0.05], fingers: 3 })
    const a = rig.at(`${side}Foot`)
    rigid(rig, `${side}Foot`, new THREE.SphereGeometry(1, 16, 12), gel, [a.x, 0.035, a.z + 0.04], [0, 0, 0], [0.065, 0.04, 0.11])
  }
  const top = y0 + H
  const face = new Face(rig, {
    bone: 'UpperChest',
    eyes: { at: [0.085, top - 0.2, 0.2], r: 0.065, iris: '#151515', irisR: 0.04, pupilR: 0.022, spread: 0.25 },
    lids: { color: C(s, 'deep') },
    brows: null,
    mouth: { bone: 'Chest', at: [0, top - 0.36, 0.272], size: [0.22, 0.11], bend: 0.3, colors: { line: '#164a28', inside: '#123d22', teeth: '#e9ffe9', tongue: '#ff6f8a' } },
  })
  const dict = body.morphTargetDictionary!
  const spineRest = (['Spine', 'Chest', 'UpperChest', 'Neck'] as const).map((n) => [rig.bones.get(n)!, rig.bones.get(n)!.position.y] as const)
  const gelReal = gel.userData.real as THREE.MeshPhysicalMaterial
  const gelFlat = new THREE.MeshStandardMaterial({ color: C(s, 'gel'), roughness: 0.18, metalness: 0 })
  const hook = (c: HookCtx) => {
    const inf = body.morphTargetInfluences!
    // Squash on crouch and landing, stretch on the pop; a damped jiggle after landing.
    const jig = c.landed > 0 ? Math.sin(c.landed * 0.45) * Math.exp(-c.landed / 28) : 0
    inf[dict.squash] = clamp01(c.squash * 0.9 + Math.max(0, jig) * 0.6)
    inf[dict.stretch] = clamp01((c.air ? clamp01(c.up / 5) * 0.8 : 0) + Math.max(0, -jig) * 0.5)
    inf[dict.wobble] = Math.sin(c.ticks * 0.11) * (c.idle > 0 ? 0.35 : 0.12) + jig * 0.4
    // Idle shapes: jiggling tall, then wide.
    if (c.idleName === 'jiggleTall') { inf[dict.stretch] = Math.max(inf[dict.stretch], c.idleK * (0.55 + 0.1 * Math.sin(c.idleT * 0.2))); inf[dict.wobble] += Math.sin(c.idleT * 0.31) * 0.3 * c.idleK }
    if (c.idleName === 'jiggleWide') { inf[dict.squash] = Math.max(inf[dict.squash], c.idleK * (0.5 + 0.1 * Math.sin(c.idleT * 0.23))); inf[dict.wobble] += Math.sin(c.idleT * 0.17) * 0.6 * c.idleK }
    // Bails splat it flat; it reforms with a wobble before getting up.
    const splat = c.bailT >= 0 ? smooth(18, 28, c.bailT) * (1 - smooth(110, 134, c.bailT)) : 0
    inf[dict.splat] = splat
    // Flattening: the spine bones come down (translation keeps the normals), the morph spreads it,
    // so the face and arms end up in the puddle. A puddle that thin refracts as a dark hole, so the
    // gel turns opaque while flat.
    if (splat > 0) for (const [b, y] of spineRest) b.position.y = y * (1 - 0.82 * splat)
    if (body.material === gelReal || body.material === gelFlat) body.material = splat > 0.2 ? gelFlat : gelReal
    if (c.bailT > 110 && c.bailT < 150) inf[dict.wobble] += Math.sin(c.bailT * 0.6) * 0.5 * (1 - smooth(130, 150, c.bailT))
    if (c.special > 0) {
      // Gelatin: the whole blob stretches and squashes in a fast wobble.
      const g = Math.sin(c.specialT * 0.75)
      inf[dict.stretch] = inf[dict.stretch] * (1 - c.special) + clamp01(0.55 + 0.55 * g) * c.special
      inf[dict.squash] = inf[dict.squash] * (1 - c.special) + clamp01(0.45 - 0.55 * g) * c.special
      inf[dict.wobble] += Math.sin(c.specialT * 1.3) * 0.9 * c.special
    }
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

/**
 * The Eucalyptus Monster (id redmonster, kept for saves): a shaggy sage-green monster from the Sutro Forest
 * eucalyptus. A wide low head with pointed tufted ears, heavy-lidded oval eyes under thick brows, a pale muzzle
 * with a small dark nose, a small mouth with two little fangs over the lip, big feet.
 */
function redMonster(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const furM = furSurface('monster fur', new THREE.Color(C(s, 'fur')).getHex(), { tip: new THREE.Color(C(s, 'tip')).getHex() })
  const nose = surface('nose', { color: C(s, 'nose'), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.08 })
  const muzzleM = surface('muzzle', { color: C(s, 'muzzle'), roughness: 0.9, sheen: 0.8, sheenColor: '#ffffff' })
  const fang = surface('fang', { color: '#f4efe2', roughness: 0.3, clearcoat: 0.6 })
  const hipsY = rig.at('Hips').y, neckY = rig.at('Neck').y
  const torso = lathe(rig, [
    [hipsY - 0.1, 0, 0], [hipsY - 0.08, 0.12, 0.1], [hipsY, 0.17, 0.14], [hipsY + 0.12, 0.18, 0.15], [hipsY + 0.26, 0.17, 0.14], [neckY - 0.04, 0.15, 0.12], [neckY + 0.03, 0.09, 0.08], [neckY + 0.06, 0, 0],
  ], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], furM)
  const parts: THREE.Mesh[] = [torso]
  for (const side of ['Left', 'Right']) {
    parts.push(tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.05, 0.045, 0.042], furM, { blend: 0.08 }))
    parts.push(tube(rig, [`${side}UpLeg`, `${side}Leg`, `${side}Foot`], [0.075, 0.06, 0.055], furM, { blend: 0.08 }))
    hand(rig, side, furM, { r: 0.017, palm: [1, 0.035, 0.055], fingers: 4 })
    const a = rig.at(`${side}Foot`)
    parts.push(rigid(rig, `${side}Foot`, new THREE.SphereGeometry(1, 16, 12), furM, [a.x, 0.05, a.z + 0.06], [0, 0, 0], [0.085, 0.06, 0.165]))
  }
  const hc = new THREE.Vector3(0, rig.at('Head').y + 0.14, 0.02)
  const head = rigid(rig, 'Head', new THREE.SphereGeometry(0.19, 28, 20), furM, hc.toArray() as V3, [0, 0, 0], [1.1, 0.92, 0.96])
  parts.push(head)
  // Pointed ears with a tuft at the tip, out to the sides and a little back.
  for (const k of [1, -1]) {
    parts.push(rigid(rig, 'Head', new THREE.ConeGeometry(0.06, 0.15, 12), furM, [k * 0.17, hc.y + 0.11, hc.z - 0.02], [-0.2, 0, -k * 0.75], [1, 1, 0.55]))
    parts.push(rigid(rig, 'Head', new THREE.ConeGeometry(0.02, 0.07, 8), furM, [k * 0.235, hc.y + 0.185, hc.z - 0.035], [-0.2, 0, -k * 0.55]))
  }
  // The face sits turned up on the head by LIFT (he stands hunched, head bowed; so the face still meets the camera):
  // face(x, dy, dz) is a point dy up and dz forward of the head's centre, turned up with it.
  const LIFT = 0.28, cl = Math.cos(LIFT), sl = Math.sin(LIFT)
  const face = (x: number, dy: number, dz: number): V3 => [x, hc.y + dy * cl + dz * sl, hc.z - dy * sl + dz * cl]
  // The muzzle: a pale pad low on the face, a small glossy nose on its top, two fangs up over the lower lip.
  rigid(rig, 'Head', new THREE.SphereGeometry(1, 20, 14), muzzleM, face(0, -0.055, 0.135), [-LIFT, 0, 0], [0.105, 0.068, 0.075])
  rigid(rig, 'Head', new THREE.SphereGeometry(1, 14, 10), nose, face(0, -0.012, 0.2), [0.3 - LIFT, 0, 0], [0.034, 0.02, 0.022])
  for (const k of [1, -1]) rigid(rig, 'Head', new THREE.ConeGeometry(0.009, 0.026, 6), fang, face(k * 0.032, -0.09, 0.198), [0.25 - LIFT, 0, 0])
  // Outfits: a SoMa Fog jersey and cap, or a yellow slicker for Karl the Fog (over the fur, which stays below).
  if (has(s, 'jersey') || has(s, 'slicker')) {
    const slicker = has(s, 'slicker')
    const cloth = slicker ? surface('slicker', { color: '#f2c230', roughness: 0.3, clearcoat: 0.8 }) : jerseyMaterial()
    const trim = surface('trim', { color: slicker ? '#e0a910' : '#f08a1c', roughness: 0.6 })
    lathe(rig, [[hipsY - 0.12, 0.13, 0.11], [hipsY - 0.02, 0.2, 0.17], [hipsY + 0.12, 0.205, 0.172], [hipsY + 0.26, 0.195, 0.162], [neckY - 0.03, 0.17, 0.14], [neckY + 0.03, 0.105, 0.095]], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], cloth, { caps: [false, false] })
    for (const side of ['Left', 'Right']) {
      tube(rig, [`${side}Arm`, `${side}ForeArm`], [0.07, 0.064], cloth, { caps: [false, false], to: rig.at(`${side}ForeArm`).clone().lerp(rig.at(`${side}Hand`), slicker ? 0.8 : 0.1).toArray() as V3 })
    }
    rigid(rig, 'Hips', new THREE.TorusGeometry(0.2, 0.012, 6, 24), trim, [0, hipsY - 0.11, 0], [Math.PI / 2, 0, 0], [1, 0.85, 1])
    if (slicker) rigid(rig, 'Head', new THREE.SphereGeometry(0.205, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), cloth, [0, hc.y + 0.02, hc.z - 0.03], [-0.5, 0, 0])
    else {
      // The cap sits high and wide on the wide head, the brim above the brows (the face is turned up).
      rigid(rig, 'Head', new THREE.SphereGeometry(0.196, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.42), surface('cap', { color: '#1f2c52', roughness: 0.8 }), [0, hc.y + 0.065, hc.z - 0.035], [-0.3, 0, 0], [1.13, 1, 1])
      rigid(rig, 'Head', new THREE.CylinderGeometry(0.11, 0.11, 0.012, 16, 1, false, Math.PI / 2, Math.PI), trim, [0, hc.y + 0.2, hc.z + 0.115], [-0.1, 0, 0], [1.1, 1, 1.3])
    }
  }
  for (const p of parts) fur(p, { color: C(s, 'fur'), tip: C(s, 'tip'), length: p === head ? 0.03 : 0.026, density: p === head ? 14 : 10 })
  const faceRig = new Face(rig, {
    bone: 'Head',
    eyes: { at: face(0.078, 0.06, 0.14), r: 0.047, squash: [1.15, 0.85, 0.7], iris: '#6a4724', irisR: 0.026, pupilR: 0.012, spread: 0.3 },
    lids: { color: C(s, 'fur'), rest: 0.3 },
    brows: { color: C(s, 'brow'), size: [0.065, 0.02, 0.02], up: 0.064, tilt: 0.18 },
    mouth: { at: face(0, -0.08, 0.214), size: [0.12, 0.065], bend: 0.12, tilt: 0.35 - LIFT, colors: { line: C(s, 'mouth'), inside: C(s, 'mouth'), teeth: '#f4efe2', tongue: C(s, 'tongue') }, neutral: 'smile' },
  })
  return { spec: s, character: new Character(rig.root), face: faceRig }
}

function mascot(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const furM = furSurface('orange fur', new THREE.Color(C(s, 'fur')).getHex(), { tip: new THREE.Color(C(s, 'tip')).getHex() })
  const sneaker = surface('sneaker', { color: C(s, 'sneaker'), roughness: 0.6 })
  const soleM = surface('sole', { color: C(s, 'sole'), roughness: 0.7 })
  const hipsY = rig.at('Hips').y, neckY = rig.at('Neck').y
  const parts: THREE.Mesh[] = []
  parts.push(lathe(rig, [
    [hipsY - 0.12, 0, 0], [hipsY - 0.1, 0.13, 0.11], [hipsY, 0.2, 0.17], [hipsY + 0.15, 0.22, 0.18], [hipsY + 0.3, 0.21, 0.17], [neckY - 0.03, 0.17, 0.13], [neckY + 0.04, 0.1, 0.09], [neckY + 0.08, 0, 0],
  ], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], furM))
  for (const side of ['Left', 'Right']) {
    parts.push(tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.065, 0.058, 0.052], furM, { blend: 0.06 }))
    parts.push(tube(rig, [`${side}UpLeg`, `${side}Leg`, `${side}Foot`], [0.09, 0.075, 0.07], furM, { blend: 0.07, to: [rig.at(`${side}Foot`).x, 0.1, rig.at(`${side}Foot`).z] }))
    hand(rig, side, furM, { r: 0.02, palm: [1, 0.04, 0.06], fingers: 4 })
    shoe(rig, side, sneaker, soleM, { len: 0.29, w: 0.105, h: 0.09 })
  }
  // The mascot head: big, a little crooked on the neck.
  const hc = new THREE.Vector3(0.0, rig.at('Head').y + 0.2, 0.03)
  const head = rigid(rig, 'Head', new THREE.SphereGeometry(0.26, 30, 22), furM, hc.toArray() as V3, [0.05, 0, 0.08], [1, 0.95, 0.92])
  parts.push(head)
  // The ears on pivots at their roots (they flop: style.secondary); their fur shells ride the same pivot.
  const ears: { p: THREE.Object3D; side: number }[] = []
  for (const side of [1, -1]) {
    const up = new THREE.Vector3(side * Math.sin(0.5), Math.cos(0.5), 0), root = new THREE.Vector3(side * 0.21, hc.y + 0.2, hc.z - 0.02).addScaledVector(up, -0.07)
    const p = pivot(rig, 'Head', root.toArray() as V3)
    const ear = new THREE.Mesh(new THREE.SphereGeometry(0.075, 14, 10), furM)
    ear.position.copy(up).multiplyScalar(0.07); ear.rotation.set(0, 0, -side * 0.5); ear.scale.set(1, 1.3, 0.6); ear.castShadow = true
    p.add(ear)
    parts.push(ear)
    ears.push({ p, side })
  }
  for (const p of parts) fur(p, { color: C(s, 'fur'), tip: C(s, 'tip'), length: 0.028, density: 9, shells: 8 })
  // The costume's snout: a plush muzzle in the lighter tip colour (felt, no shells), a glossy plastic nose on it,
  // and the mouth stitched across its front.
  const muzzleM = furSurface('muzzle plush', new THREE.Color(C(s, 'tip')).getHex(), { tip: new THREE.Color('#fff1d8').getHex() })
  const noseM = surface('costume nose', { color: '#2a1608', roughness: 0.18, clearcoat: 1, clearcoatRoughness: 0.08 })
  rigid(rig, 'Head', new THREE.SphereGeometry(1, 24, 16), muzzleM, [0, hc.y - 0.075, hc.z + 0.175], [0.08, 0, 0.08], [0.15, 0.1, 0.11])
  rigid(rig, 'Head', new THREE.SphereGeometry(1, 14, 10), noseM, [0.004, hc.y - 0.028, hc.z + 0.283], [0.25, 0, 0.08], [0.045, 0.03, 0.03])
  const face = new Face(rig, {
    bone: 'Head',
    eyes: { at: [0.095, hc.y + 0.08, hc.z + 0.19], r: 0.07, squash: [1, 1.1, 0.75], iris: C(s, 'pupil'), irisR: 0.032, pupilR: 0.012, spread: 0.3 },
    lids: null,
    brows: { color: '#7a3a08', size: [0.09, 0.022, 0.02], up: 0.1 },
    mouth: { at: [0.008, hc.y - 0.1, hc.z + 0.272], size: [0.17, 0.09], sphere: 0.12, tilt: -0.25, colors: { line: '#2a1406', inside: '#1a0b03', teeth: '#fbfbf6', tongue: '#d8585c' } },
  })
  // In a bail the mascot head pops off, bounces and rolls away, then pops back on at the end.
  const headBone = rig.bones.get('Head')!, neckBone = rig.bones.get('Neck')!
  const headR = 0.26
  const E = s.style.secondary ?? {}
  const hook = (c: HookCtx) => {
    // Ears: flop out on a landing and spring back past rest, lift as it falls and fold as it rises, lie back with
    // speed, and twitch a little standing; a damped response to the landing's timer, so shots stay exact.
    const land = c.landed >= 0 ? Math.exp(-c.landed / (E.decay ?? 10)) * Math.sin(c.landed * (E.freq ?? 0.3)) : 0
    const fall = c.air ? Math.max(-1, Math.min(1, -c.up / 6)) : 0
    const twitch = Math.sin(c.ticks * 0.07) * Math.sin(c.ticks * 0.023) * (E.idle ?? 0.05)
    for (const e of ears) {
      e.p.rotation.z = -e.side * ((E.land ?? 0.5) * land + (E.air ?? 0.35) * fall + twitch)
      e.p.rotation.x = -Math.min(1, c.speed / 10) * (E.speed ?? 0.25) - (E.land ?? 0.5) * 0.3 * land
    }
    const T = c.bailT
    if (T < 12 || T > 150) return
    // The path in model space (y up from the soles): up and out, a bounce, a roll, rest. With the
    // park in reach, it sits on the ground under each point and stops short of a wall.
    const t1 = 12, t2 = 40, t3 = 82
    const P0 = new THREE.Vector3(0, 1.55, 0.15), L = new THREE.Vector3(0.45, headR, 0.85), R = new THREE.Vector3(0.95, headR, 1.25)
    const M = rig.root.matrixWorld, Minv = M.clone().invert()
    const onGround = (v: THREE.Vector3) => {
      if (!c.ground) return v
      const w = v.clone().applyMatrix4(M)
      const g = c.ground(w.x, w.y, w.z + 0.5)
      if (g === null) return v
      w.z = g + headR
      return w.applyMatrix4(Minv)
    }
    if (c.ground) {
      // Shorten the roll before anything higher than a curb.
      const base = c.ground(...(new THREE.Vector3(0, 0, 0).applyMatrix4(M).toArray() as [number, number, number]))
      for (let i = 1; i <= 8 && base !== null; i++) {
        const v = L.clone().lerp(R, i / 8).applyMatrix4(M)
        const g = c.ground(v.x, v.y, v.z + 0.6)
        if (g !== null && g > base + 0.3) { R.copy(L.clone().lerp(R, (i - 1) / 8)); break }
      }
      L.copy(onGround(L)); R.copy(onGround(R))
    }
    const pos = new THREE.Vector3(), q = new THREE.Quaternion()
    if (T < t2) {
      const k = (T - t1) / (t2 - t1)
      pos.lerpVectors(P0, L, k); pos.y += Math.sin(Math.PI * k) * 0.55
      q.setFromAxisAngle(new THREE.Vector3(1, 0, 0.4).normalize(), k * 4)
    } else {
      const k = Math.min(1, (T - t2) / (t3 - t2)), e = 1 - (1 - k) ** 2
      pos.lerpVectors(L, R, e); pos.y += Math.abs(Math.sin(e * Math.PI * 2)) * 0.08 * (1 - e)
      const dir = R.clone().sub(L), dist = dir.length() * e
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0).cross(dir.normalize()), 4 + dist / headR)
    }
    // Into the neck's frame (head bone local), blending back onto the neck at the end.
    const rootInv = rig.root.matrixWorld.clone().invert()
    const neckModel = rootInv.clone().multiply(neckBone.matrixWorld)
    const local = neckModel.clone().invert().multiply(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)))
    const lp = new THREE.Vector3(), lq = new THREE.Quaternion(), ls = new THREE.Vector3()
    local.decompose(lp, lq, ls)
    const back = smooth(136, 148, T)
    headBone.position.lerpVectors(lp, headBone.position.clone(), back)
    headBone.quaternion.copy(lq.slerp(headBone.quaternion.clone(), back))
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

function vampire(s: CharacterSpec): Draft {
  const r = s.rig, hy = r.ankle + r.shin + r.thigh + r.hipDrop, ucY = hy + r.spine[0] + r.spine[1] + r.spine[2]
  const rig = buildRig(s.rig, [
    { name: 'Cape1', parent: 'UpperChest', at: [0, ucY - 0.05, -0.17] },
    { name: 'Cape2', parent: 'Cape1', at: [0, ucY - 0.45, -0.22] },
  ])
  const sd = skinDetail(12)
  const skin = surface('pale skin', { color: C(s, 'skin'), normalMap: sd.normal, roughnessMap: sd.rough, roughness: 1, sheen: 0.2, sheenColor: '#c9d6ff' })
  const suitD = detailMaps(5, 3, 0.75, 0.2, 1)
  const suit = surface('suit', { color: C(s, 'suit'), normalMap: suitD.normal, roughnessMap: suitD.rough, roughness: 1 })
  const shirt = surface('shirt', { color: C(s, 'shirt'), roughness: 0.75 })
  const capeM = surface('cape', { color: C(s, 'cape'), roughness: 0.55, sheen: 0.6, sheenColor: '#5a5a70', side: THREE.FrontSide })
  const lining = surface('cape lining', { color: C(s, 'lining'), roughness: 0.35, sheen: 0.8, sheenColor: '#ff6070', side: THREE.BackSide })
  const hair = surface('slick hair', { color: C(s, 'hair'), roughness: 0.18, clearcoat: 1 })
  const shoeM = surface('dress shoe', { color: C(s, 'shoe'), roughness: 0.2, clearcoat: 1 })
  const medal = surface('medallion', { color: C(s, 'medal'), roughness: 0.25, metalness: 1 })
  const fang = surface('fang', { color: '#fbfaf3', roughness: 0.2, clearcoat: 1 })
  const hipsY = rig.at('Hips').y, neckY = rig.at('Neck').y
  lathe(rig, [[hipsY - 0.1, 0, 0], [hipsY - 0.08, 0.13, 0.1], [hipsY + 0.02, 0.15, 0.11], [hipsY + 0.2, 0.15, 0.1], [hipsY + 0.33, 0.18, 0.11], [neckY - 0.03, 0.17, 0.1], [neckY + 0.02, 0.06, 0.055], [neckY + 0.05, 0, 0]],
    ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], suit)
  // Shirt front and the medallion.
  rigid(rig, 'UpperChest', new THREE.SphereGeometry(1, 14, 10), shirt, [0, neckY - 0.08, 0.075], [0, 0, 0], [0.06, 0.1, 0.04])
  rigid(rig, 'UpperChest', new THREE.CylinderGeometry(0.028, 0.028, 0.006, 20), medal, [0, neckY - 0.13, 0.11], [Math.PI / 2, 0, 0])
  tube(rig, ['Neck', 'Head'], [0.05, 0.048], skin, { caps: [false, true] })
  limbs(rig, suit, suit, { arm: [0.052, 0.043, 0.037], leg: [0.07, 0.053, 0.045] })
  for (const side of ['Left', 'Right']) {
    // White shirt cuffs out of the sleeves, the trousers' hems on the shoes.
    const k = side === 'Left' ? 1 : -1, wr = rig.at(`${side}Hand`), an = rig.at(`${side}Foot`)
    rigid(rig, `${side}ForeArm`, new THREE.CylinderGeometry(0.036, 0.036, 0.022, 14, 1, true), shirt, [wr.x - k * 0.006, wr.y, wr.z], [0, 0, Math.PI / 2])
    rigid(rig, `${side}ForeArm`, new THREE.TorusGeometry(0.037, 0.006, 6, 16), suit, [wr.x - k * 0.024, wr.y, wr.z], [0, Math.PI / 2, 0])
    rigid(rig, `${side}Leg`, new THREE.TorusGeometry(0.046, 0.008, 6, 18), suit, [an.x, an.y + 0.028, an.z - 0.004], [Math.PI / 2 - 0.12, 0, 0], [1, 1.12, 1])
    hand(rig, side, skin, { r: 0.011, palm: [1, 0.024, 0.042], fingers: 4 })
    shoe(rig, side, shoeM, shoeM, { len: 0.3, w: 0.09, h: 0.075 })
  }
  // Head: long pale face, slicked hair with a widow's peak, pointed ears, fangs.
  const hc = new THREE.Vector3(0, rig.at('Head').y + 0.11, 0.015)
  // A long gaunt head: high cheekbones, a strong chin, a long hooked nose.
  humanHead(rig, skin, hc, { S: [0.105, 0.134, 0.11], nose: 1.15, hook: 0.25, long: 1.2, ears: 0, cheeks: 1.7, jaw: 1.3, chin: 1.4 })
  rigid(rig, 'Head', new THREE.SphereGeometry(0.111, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.42), hair, [0, hc.y + 0.02, hc.z - 0.008], [-0.5, 0, 0], [1.02, 1.3, 1.08])
  rigid(rig, 'Head', new THREE.ConeGeometry(0.022, 0.05, 3), hair, [0, hc.y + 0.075, hc.z + 0.098], [Math.PI * 1.08, 0, 0], [1, 1, 0.35])
  for (const k of [1, -1]) {
    rigid(rig, 'Head', new THREE.ConeGeometry(0.02, 0.07, 6), skin, [k * 0.1, hc.y + 0.02, hc.z - 0.01], [0, 0, -k * 1.2], [1, 1, 0.45])
    rigid(rig, 'Head', new THREE.ConeGeometry(0.006, 0.022, 6), fang, [k * 0.018, hc.y - 0.085, hc.z + 0.098], [Math.PI, 0, 0])
  }
  // Cape: a sheet round the back from the shoulders, skinned to two cape bones, high collar.
  const capeGeo = new THREE.CylinderGeometry(0.2, 0.36, 0.95, 20, 8, true, Math.PI * 0.55, Math.PI * 0.9)
  capeGeo.translate(0, neckY - 0.48, -0.02)
  const pos = capeGeo.getAttribute('position')
  const si: number[] = [], sw: number[] = []
  const uc = rig.skeleton.bones.findIndex((b) => b.name === 'UpperChest'), c1 = rig.skeleton.bones.findIndex((b) => b.name === 'Cape1'), c2 = rig.skeleton.bones.findIndex((b) => b.name === 'Cape2')
  for (let i = 0; i < pos.count; i++) {
    const t = clamp01((neckY - pos.getY(i)) / 0.95)
    if (t < 0.4) { const w = smooth(0.05, 0.4, t); si.push(uc, c1, 0, 0); sw.push(1 - w, w, 0, 0) } else { const w = smooth(0.4, 1, t); si.push(c1, c2, 0, 0); sw.push(1 - w, w, 0, 0) }
  }
  capeGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
  capeGeo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
  const hoodie = has(s, 'hoodie')
  if (!hoodie) {
    bindMesh(rig, capeGeo, capeM)
    bindMesh(rig, capeGeo, lining)
    const collar = new THREE.CylinderGeometry(0.13, 0.1, 0.16, 16, 1, true, Math.PI * 0.6, Math.PI * 0.8)
    rigid(rig, 'UpperChest', collar, capeM, [0, neckY + 0.06, -0.02], [-0.2, 0, 0])
    rigid(rig, 'UpperChest', collar, lining, [0, neckY + 0.06, -0.02], [-0.2, 0, 0])
  } else {
    // A black hoodie, hood up (no cape): the night is cold in the Mission.
    const cotton = detailMaps(23, 2, 0.9, 0.1, 1.6)
    const hood = surface('hoodie', { color: C(s, 'hoodie'), normalMap: cotton.normal, roughnessMap: cotton.rough, roughness: 1 })
    lathe(rig, [[hipsY - 0.12, 0.16, 0.13], [hipsY + 0.05, 0.19, 0.14], [hipsY + 0.3, 0.2, 0.135], [neckY - 0.03, 0.19, 0.13], [neckY + 0.04, 0.09, 0.08]], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], hood, { caps: [false, false] })
    for (const side of ['Left', 'Right']) tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.062, 0.055, 0.05], hood, { caps: [false, false], to: rig.at(`${side}Hand`).toArray() as V3 })
    rigid(rig, 'Head', new THREE.SphereGeometry(0.15, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), hood, [0, rig.at('Head').y + 0.12, 0.0], [-0.55, 0, 0], [1, 1.2, 1.15])
    rigid(rig, 'Chest', new THREE.BoxGeometry(0.2, 0.08, 0.02), hood, [0, hipsY + 0.12, 0.155])
  }
  if (has(s, 'sunglasses')) {
    // A daywalker: big shades.
    const shades = surface('shades', { color: '#0c0c0e', roughness: 0.05, metalness: 0.4, clearcoat: 1 })
    for (const k of [1, -1]) rigid(rig, 'Head', new THREE.CylinderGeometry(0.03, 0.03, 0.008, 18), shades, [k * 0.04, hc.y + 0.025, hc.z + 0.112], [Math.PI / 2, 0, 0], [1.2, 1, 0.85])
    rigid(rig, 'Head', new THREE.BoxGeometry(0.03, 0.006, 0.006), shades, [0, hc.y + 0.03, hc.z + 0.114])
  }
  const face = new Face(rig, {
    bone: 'Head',
    eyes: { at: [0.038, hc.y + 0.025, hc.z + 0.085], r: 0.021, iris: C(s, 'iris'), irisR: 0.012, pupilR: 0.005 },
    lids: { color: '#cfd2d8' },
    brows: { color: C(s, 'hair'), size: [0.04, 0.009, 0.008], up: 0.03, tilt: 0.35 },
    mouth: { at: [0, hc.y - 0.07, hc.z + 0.103], size: [0.075, 0.04], sphere: 0.11, colors: { line: '#4a0d14', inside: '#3a0509', teeth: '#fbfaf3', tongue: '#b0303c' } },
  })
  const cape1 = rig.bones.get('Cape1')!, cape2 = rig.bones.get('Cape2')!
  // Bats and smoke for the bails (model space, hidden until then).
  const bodyMeshes: THREE.Object3D[] = []
  rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) bodyMeshes.push(o) })
  const batM = surface('bat', { color: '#121216', roughness: 0.7, side: THREE.DoubleSide })
  const smokeM = surface('smoke', { color: '#3a3640', roughness: 1 })
  const wingShape = new THREE.Shape()
  wingShape.moveTo(0, 0); wingShape.lineTo(0.12, 0.04); wingShape.lineTo(0.16, -0.02); wingShape.lineTo(0.12, -0.01); wingShape.lineTo(0.09, -0.04); wingShape.lineTo(0.06, -0.015); wingShape.lineTo(0.03, -0.04); wingShape.lineTo(0, -0.01)
  const wingGeo = new THREE.ShapeGeometry(wingShape)
  wingGeo.rotateX(-Math.PI / 2)
  const bats = Array.from({ length: 14 }, (_, i) => {
    const g = new THREE.Group()
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.025, 8, 6), batM)
    body.scale.set(0.8, 0.8, 1.6)
    const l = new THREE.Object3D(), r2 = new THREE.Object3D()
    const lw = new THREE.Mesh(wingGeo, batM), rw = new THREE.Mesh(wingGeo, batM)
    rw.scale.x = -1
    l.add(lw); r2.add(rw)
    g.add(body, l, r2)
    g.visible = false
    rig.root.add(g)
    return { g, l, r2, r: 0.35 + hash2(i, 1, 9) * 0.6, h: 0.3 + hash2(i, 2, 9) * 0.9, a0: hash2(i, 3, 9) * Math.PI * 2, w: (0.05 + hash2(i, 4, 9) * 0.05) * (hash2(i, 5, 9) > 0.5 ? 1 : -1) }
  })
  const puffs = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), smokeM)
    m.visible = false
    m.castShadow = false
    rig.root.add(m)
    return m
  })
  const hook = (c: HookCtx) => {
    // The cape streams back with speed and lifts in the air; a flutter on top.
    const blow = Math.min(1, c.speed / 9) * 0.9 + (c.air ? 0.35 : 0) + (c.mood === 'ecstatic' ? 0.4 : 0)
    const flutter = Math.sin(c.ticks * 0.35) * 0.08 * (0.3 + blow)
    // Bat wings in the specials: the cape spreads wide and lifts behind.
    // In the Kickflip Superman the body is flat, so the wings lie along it instead of lifting.
    const w = c.special, flat = c.specialId === 'kickflipsuperman' ? 1 : 0
    // Weight (style.secondary): falling lifts the cape up behind, a landing slaps it down against the legs and it
    // swings back out past rest (the lower bone a beat later).
    const S2 = s.style.secondary ?? {}
    const fallLift = c.air ? Math.max(0, Math.min(1, -c.up / 7)) * (S2.fall ?? 0.5) : 0
    const lt = c.landed, dk = S2.decay ?? 11, fq = S2.freq ?? 0.24
    const slap = lt >= 0 ? Math.exp(-lt / dk) * Math.cos(lt * fq) * Math.min(1, lt / 2) * (S2.land ?? 0.4) : 0
    const slap2 = lt >= 0 ? Math.exp(-lt / dk) * Math.sin(lt * fq) * (S2.land ?? 0.4) : 0
    cape1.rotation.x = (-blow * 0.7 - flutter - fallLift + slap) * (1 - 0.8 * w * flat) - w * (0.45 - 0.42 * flat)
    cape2.rotation.x = (-blow * 0.5 - flutter * 1.6 - fallLift * 0.7 + slap2) * (1 - 0.8 * w * flat) - w * (0.3 - 0.25 * flat)
    cape1.scale.set(1 + w * (1.4 + 0.4 * flat), 1, 1)
    cape2.scale.set(1 + w * (0.7 + 0.4 * flat), 1 - w * 0.25, 1)
    // A bail turns him into a puff of bats that circle and reform.
    const T = c.bailT
    const batK = T >= 0 ? smooth(30, 38, T) * (1 - smooth(106, 114, T)) : 0
    const hidden = batK > 0.5
    for (const m of bodyMeshes) m.visible = !hidden
    for (const [i, b] of bats.entries()) {
      if (batK <= 0.01) { b.g.visible = false; continue }
      b.g.visible = true
      const spread = batK * b.r
      const a = b.a0 + (T - 30) * b.w
      b.g.position.set(Math.cos(a) * spread, 0.25 + b.h * batK + Math.sin(T * 0.13 + i) * 0.08, 0.3 + Math.sin(a) * spread)
      b.g.rotation.set(0, -a + Math.PI / 2, 0)
      const flap = Math.sin(T * 0.9 + i * 1.7) * 0.9
      b.l.rotation.z = flap; b.r2.rotation.z = -flap
      b.g.scale.setScalar(0.6 + 0.4 * batK)
    }
    for (const [i, p] of puffs.entries()) {
      const age1 = T - 30 - i * 0.6, age2 = T - 106 - i * 0.6
      const age = age1 >= 0 && age1 < 18 ? age1 : age2 >= 0 && age2 < 18 ? age2 : -1
      p.visible = age >= 0
      if (age >= 0) { p.scale.setScalar(0.05 + age * 0.018); p.position.set(Math.cos(i * 2.4) * age * 0.02, 0.35 + i * 0.05, 0.25 + Math.sin(i * 2.4) * age * 0.02) }
    }
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

function skeleton(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const bd = detailMaps(21, 4, 0.55, 0.25, 1.6)
  // Outfits: glow in the dark (emissive, bright at night) or golden bones.
  const boneM = surface('bone', has(s, 'glow') ? { color: C(s, 'bone'), normalMap: bd.normal, roughnessMap: bd.rough, roughness: 1, emissive: C(s, 'glow'), emissiveIntensity: 0.9 }
    : has(s, 'golden') ? { color: C(s, 'bone'), roughness: 0.28, metalness: 1, normalMap: bd.normal, normalScale: 0.4 } : { color: C(s, 'bone'), normalMap: bd.normal, roughnessMap: bd.rough, roughness: 1 })
  const socket = surface('socket', { color: C(s, 'socket'), roughness: 0.9 })
  const P = (n: string) => rig.at(n).toArray() as V3
  const knob = (b: string, at: V3, r: number) => rigid(rig, b, new THREE.SphereGeometry(r, 12, 8), boneM, at)
  for (const side of ['Left', 'Right']) {
    const k = side === 'Left' ? 1 : -1
    bone2bone(rig, `${side}UpLeg`, P(`${side}UpLeg`), P(`${side}Leg`), 0.022, boneM)
    knob(`${side}UpLeg`, P(`${side}UpLeg`), 0.035); knob(`${side}Leg`, P(`${side}Leg`), 0.034)
    bone2bone(rig, `${side}Leg`, P(`${side}Leg`), P(`${side}Foot`), 0.019, boneM)
    const kn = rig.at(`${side}Leg`), an = rig.at(`${side}Foot`)
    bone2bone(rig, `${side}Leg`, [kn.x + k * 0.025, kn.y - 0.03, kn.z - 0.01], [an.x + k * 0.02, an.y + 0.03, an.z - 0.01], 0.009, boneM)
    knob(`${side}Foot`, P(`${side}Foot`), 0.028)
    // Foot bones: a heel and five metatarsals fanned forward.
    knob(`${side}Foot`, [an.x, 0.03, an.z - 0.04], 0.03)
    for (let i = 0; i < 5; i++) bone2bone(rig, `${side}Foot`, [an.x + k * (i - 2) * 0.014, 0.035, an.z + 0.01], [an.x + k * (i - 2) * 0.02, 0.012, an.z + 0.16 - Math.abs(i - 2) * 0.012], 0.007, boneM)
    bone2bone(rig, `${side}Arm`, P(`${side}Arm`), P(`${side}ForeArm`), 0.018, boneM)
    knob(`${side}Arm`, P(`${side}Arm`), 0.03); knob(`${side}ForeArm`, P(`${side}ForeArm`), 0.024)
    const el = rig.at(`${side}ForeArm`), wr = rig.at(`${side}Hand`)
    bone2bone(rig, `${side}ForeArm`, [el.x, el.y, el.z + 0.012], [wr.x, wr.y, wr.z + 0.012], 0.011, boneM)
    bone2bone(rig, `${side}ForeArm`, [el.x, el.y, el.z - 0.012], [wr.x, wr.y, wr.z - 0.012], 0.01, boneM)
    hand(rig, side, boneM, { r: 0.0085, palm: [1, 0.012, 0.035], fingers: 4 })
    bone2bone(rig, 'UpperChest', P(`${side}Shoulder`), P(`${side}Arm`), 0.012, boneM)
  }
  // Spine, pelvis and ribcage.
  const hy = rig.at('Hips').y, ny = rig.at('Neck').y
  for (let y = hy - 0.02; y < ny + 0.08; y += 0.045) {
    const b = y < rig.at('Spine').y ? 'Hips' : y < rig.at('Chest').y ? 'Spine' : y < rig.at('UpperChest').y ? 'Chest' : y < ny ? 'UpperChest' : 'Neck'
    rigid(rig, b, new THREE.CylinderGeometry(0.02, 0.022, 0.03, 10), boneM, [0, y, -0.06])
    rigid(rig, b, new THREE.BoxGeometry(0.012, 0.02, 0.03), boneM, [0, y, -0.085])
  }
  rigid(rig, 'Hips', new THREE.TorusGeometry(0.11, 0.028, 10, 24, Math.PI * 1.25), boneM, [0, hy - 0.02, -0.01], [Math.PI / 2 + 0.3, 0, -Math.PI * 1.125 + Math.PI / 2], [1.1, 0.8, 1.5])
  const cy = rig.at('Chest').y
  for (let i = 0; i < 6; i++) {
    const y = cy - 0.02 + i * 0.045, r = 0.13 - Math.abs(i - 2.5) * 0.012
    rigid(rig, i < 3 ? 'Chest' : 'UpperChest', new THREE.TorusGeometry(r, 0.011, 6, 26, Math.PI * 1.7), boneM, [0, y, -0.01], [Math.PI / 2 + 0.25, 0, Math.PI * 0.65], [1, 0.75, 1])
  }
  rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.03, 0.2, 0.02), boneM, [0, cy + 0.1, 0.11], [-0.2, 0, 0])
  bone2bone(rig, 'Neck', P('Neck'), P('Head'), 0.02, boneM)
  // Skull: cranium, cheekbones, the jaw on a pivot, dark sockets with glowing pupils.
  const hc = new THREE.Vector3(0, rig.at('Head').y + 0.1, 0.01)
  rigid(rig, 'Head', new THREE.SphereGeometry(0.105, 24, 18), boneM, hc.toArray() as V3, [0, 0, 0], [0.95, 1.05, 1.1])
  rigid(rig, 'Head', new THREE.SphereGeometry(0.075, 18, 12), boneM, [0, hc.y - 0.05, hc.z + 0.03], [0, 0, 0], [1, 0.8, 1.05])
  const jawP = pivot(rig, 'Head', [0, hc.y - 0.05, hc.z - 0.01])
  const jaw = new THREE.Mesh(new THREE.SphereGeometry(0.065, 16, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5), boneM)
  jaw.position.set(0, -0.025, 0.04)
  jaw.scale.set(1, 0.7, 1.15)
  jawP.add(jaw)
  for (const k of [1, -1]) rigid(rig, 'Head', new THREE.SphereGeometry(0.03, 14, 10), socket, [k * 0.038, hc.y + 0.005, hc.z + 0.085], [0, 0, 0], [1, 1.1, 0.6])
  rigid(rig, 'Head', new THREE.ConeGeometry(0.014, 0.025, 3), socket, [0, hc.y - 0.032, hc.z + 0.105], [Math.PI, 0, 0], [1, 1, 0.5])
  const face = new Face(rig, {
    bone: 'Head',
    eyes: { at: [0.038, hc.y + 0.005, hc.z + 0.072], r: 0.012, white: C(s, 'socket'), iris: C(s, 'glow'), irisR: 0.008, glow: true },
    lids: null, brows: null,
    mouth: { at: [0, hc.y - 0.07, hc.z + 0.094], size: [0.085, 0.04], sphere: 0.1, colors: { line: '#3a3226', inside: C(s, 'socket'), teeth: C(s, 'bone'), tongue: C(s, 'socket') }, neutral: 'grin' },
    jaw: { at: [0, 0, 0], mesh: jawP, open: 0.5 },
  })
  // Coming apart in the specials: every bone part drifts out from the ribcage and snaps back.
  const centre = new THREE.Vector3(0, rig.at('Chest').y, 0)
  const parts: { m: THREE.Object3D; rest: THREE.Vector3; dir: THREE.Vector3 }[] = []
  for (const b of rig.bones.values()) for (const m of b.children) {
    if ((m as THREE.Bone).isBone) continue
    const model = m.position.clone().add(rig.at(b.name))
    const dir = model.sub(centre)
    dir.y *= 0.6
    parts.push({ m, rest: m.position.clone(), dir: dir.lengthSq() > 1e-6 ? dir.normalize() : new THREE.Vector3(0, 1, 0) })
  }
  const armParts = parts.filter((p) => { const b = p.m.parent?.name ?? ''; return b === 'RightForeArm' || b.startsWith('RightHand') })
  const hook = (c: HookCtx) => {
    // Specials: drift apart and snap back. Bails: collapse into a pile, then reassemble.
    const sp = c.special * Math.pow(Math.sin(Math.PI * clamp01(c.specialQ)), 2) * 0.16
    const pile = c.bailT >= 0 ? smooth(26, 44, c.bailT) * (1 - smooth(122, 144, c.bailT)) * 0.3 : 0
    const e = sp + pile
    for (const p of parts) {
      p.m.position.copy(p.rest).addScaledVector(p.dir, e)
      if (pile > 0) p.m.position.y -= pile * 0.4 * Math.max(0, p.dir.y)
    }
    // Standing still: the right forearm drops to the ground and later snaps back on.
    const off = c.idleName === 'armOff' ? c.idleK * smooth(20, 50, c.idleT) * (1 - smooth(300, 330, c.idleT)) : 0
    if (off > 0) {
      const rootInv = rig.root.matrixWorld.clone().invert()
      for (const p of armParts) {
        const bone = p.m.parent!
        const attached = p.m.position.clone().applyMatrix4(bone.matrixWorld).applyMatrix4(rootInv)
        const ground = new THREE.Vector3(attached.x * 1.2 - 0.25, 0.03 + (attached.y - 1) * 0.05, attached.z + 0.25)
        const target = attached.lerp(ground, off).applyMatrix4(rig.root.matrixWorld)
        p.m.position.copy(bone.worldToLocal(target))
      }
    }
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

function techBro(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const sd = skinDetail(31)
  const skin = surface('skin', { color: C(s, 'skin'), normalMap: sd.normal, roughnessMap: sd.rough, roughness: 1, sheen: 0.15, sheenColor: '#ffd0b0' })
  const oxford = foldMaps(5, { weave: 90, rough: 0.75 })
  const shirt = surface('oxford shirt', { color: C(s, 'shirt'), normalMap: oxford.normal, roughnessMap: oxford.rough, roughness: 1, sheen: 0.3, sheenColor: '#ffffff' })
  const fleece = detailMaps(9, 2, 0.95, 0.1, 2.5)
  const vest = surface('fleece vest', { color: C(s, 'vest'), normalMap: fleece.normal, roughnessMap: fleece.rough, roughness: 1, sheen: 0.6, sheenColor: '#7b8aa3' })
  const twill = foldMaps(3, { weave: 80, folds: 7, rough: 0.8 })
  const khaki = surface('khakis', { color: C(s, 'khaki'), normalMap: twill.normal, roughnessMap: twill.rough, roughness: 1, sheen: 0.3, sheenColor: '#fff4e0' })
  const wool = detailMaps(17, 2, 0.95, 0.1, 2.2)
  const shoeM = surface('wool sneaker', { color: C(s, 'shoe'), normalMap: wool.normal, roughnessMap: wool.rough, roughness: 1 })
  const soleM = surface('sole', { color: C(s, 'sole'), roughness: 0.7 })
  const hairM = surface('hair', { color: C(s, 'hair'), roughness: 0.6, sheen: 0.4, sheenColor: '#b08a5a' })
  const lan = surface('lanyard', { color: C(s, 'lanyard'), roughness: 0.6 })
  const badge = surface('badge', { color: C(s, 'badge'), roughness: 0.3, clearcoat: 1 })
  const frames = surface('glasses', { color: C(s, 'glasses'), roughness: 0.25, clearcoat: 1 })
  const pods = surface('earbuds', { color: C(s, 'pods'), roughness: 0.15, clearcoat: 1 })
  const phoneM = surface('phone', { color: '#1b1c1f', roughness: 0.15, metalness: 0.5, clearcoat: 1 })
  const hipsY = rig.at('Hips').y, neckY = rig.at('Neck').y
  // Shirt torso, the vest over it, khakis, sleeves, collar.
  lathe(rig, [[hipsY - 0.08, 0, 0], [hipsY - 0.06, 0.15, 0.11], [hipsY + 0.05, 0.16, 0.115], [hipsY + 0.25, 0.165, 0.11], [neckY - 0.04, 0.17, 0.105], [neckY + 0.02, 0.06, 0.055], [neckY + 0.05, 0, 0]], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], shirt)
  const playa = has(s, 'playa')
  const vestProfile: [number, number, number][] = [[hipsY - 0.03, 0.165, 0.125], [hipsY + 0.08, 0.17, 0.125], [hipsY + 0.25, 0.177, 0.12], [neckY - 0.05, 0.18, 0.115], [neckY - 0.0, 0.1, 0.075], [neckY + 0.03, 0.07, 0.065]]
  const vestMesh = lathe(rig, vestProfile, ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], playa ? furSurface('pink fur', 0xff6ec7, { tip: 0xffb3e6 }) : vest, { caps: [false, false] })
  if (playa) fur(vestMesh, { color: '#ff5fbf', tip: '#ffc2ea', length: 0.03, density: 9, shells: 8 })
  if (has(s, 'logo')) rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.05, 0.03, 0.004), surface('logo', { color: '#f4f1e8', roughness: 0.5 }), [0.07, neckY - 0.11, 0.125], [-0.1, 0.3, 0])
  tube(rig, ['Neck', 'Head'], [0.05, 0.048], skin, { caps: [false, true] })
  for (const side of ['Left', 'Right']) {
    const k = side === 'Left' ? 1 : -1
    tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.054, 0.046, 0.041], shirt, { blend: 0.05, bulge: ARM_SHAPE })
    tube(rig, [`${side}UpLeg`, `${side}Leg`, `${side}Foot`], [0.08, 0.06, 0.054], khaki, { blend: 0.06, bulge: LEG_SHAPE })
    // Cuffs at the wrists, the khakis' hems breaking over the shoes.
    const wr = rig.at(`${side}Hand`), an = rig.at(`${side}Foot`)
    rigid(rig, `${side}ForeArm`, new THREE.TorusGeometry(0.039, 0.008, 5, 12), shirt, [wr.x - k * 0.012, wr.y, wr.z], [0, Math.PI / 2, 0])
    rigid(rig, `${side}Leg`, new THREE.TorusGeometry(0.054, 0.009, 5, 14), khaki, [an.x, an.y + 0.03, an.z - 0.004], [Math.PI / 2 - 0.12, 0, 0], [1, 1.12, 1])
    hand(rig, side, skin, { r: 0.0115, palm: [1, 0.024, 0.045], fingers: 4 })
    shoe(rig, side, shoeM, soleM, { len: 0.29, w: 0.105, h: 0.085, puffy: 1.05 })
    rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.06, 0.004, 0.045), shirt, [k * 0.045, neckY + 0.0, 0.05], [0.5, k * 0.5, k * 0.2])
  }
  // Lanyard round the neck to a badge on the chest (not on the playa).
  if (!playa) {
    const lanG = new THREE.TorusGeometry(0.075, 0.005, 6, 24, Math.PI * 1.15)
    rigid(rig, 'UpperChest', lanG, lan, [0, neckY - 0.04, 0.07], [0.25, 0, Math.PI * 1.07])
    rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.055, 0.075, 0.004), badge, [0, neckY - 0.17, 0.13], [-0.12, 0, 0])
    rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.055, 0.018, 0.005), lan, [0, neckY - 0.145, 0.131], [-0.12, 0, 0])
  }
  // Head: hair with a side part, glasses, earbuds.
  const hc = new THREE.Vector3(0, rig.at('Head').y + 0.1, 0.015)
  humanHead(rig, skin, hc, { nose: 1.05, chin: 1.2, jaw: 0.9 })
  rigid(rig, 'Head', new THREE.SphereGeometry(0.106, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), hairM, [0, hc.y + 0.02, hc.z - 0.005], [-0.18, 0.1, 0.06], [0.98, 1.1, 1.08])
  rigid(rig, 'Head', new THREE.SphereGeometry(0.05, 14, 10), hairM, [0.035, hc.y + 0.1, hc.z + 0.05], [0, 0, 0], [1.1, 0.45, 0.9])
  for (const k of [1, -1]) {
    rigid(rig, 'Head', new THREE.TorusGeometry(0.022, 0.0035, 6, 16), frames, [k * 0.036, hc.y + 0.02, hc.z + 0.1], [0, 0, 0], [1.15, 0.85, 1])
    rigid(rig, 'Head', new THREE.BoxGeometry(0.004, 0.004, 0.09), frames, [k * 0.062, hc.y + 0.025, hc.z + 0.055], [0, 0, 0])
    rigid(rig, 'Head', new THREE.CapsuleGeometry(0.007, 0.018, 3, 8), pods, [k * 0.095, hc.y - 0.005, hc.z + 0.005], [0.2, 0, 0])
  }
  rigid(rig, 'Head', new THREE.BoxGeometry(0.016, 0.004, 0.004), frames, [0, hc.y + 0.022, hc.z + 0.104])
  if (playa) {
    // Playa goggles pushed up on the forehead, dust everywhere.
    const lens = surface('goggles', { color: '#ff9a3c', roughness: 0.05, metalness: 0.6, clearcoat: 1 })
    const strap = surface('strap', { color: '#2a1f18', roughness: 0.8 })
    for (const k of [1, -1]) rigid(rig, 'Head', new THREE.SphereGeometry(0.03, 14, 10), lens, [k * 0.037, hc.y + 0.085, hc.z + 0.085], [0, 0, 0], [1, 0.85, 0.5])
    rigid(rig, 'Head', new THREE.TorusGeometry(0.1, 0.007, 6, 28), strap, [0, hc.y + 0.075, hc.z - 0.005], [Math.PI / 2 - 0.3, 0, 0], [1, 1.12, 1])
  }
  // The phone he checks when standing still (scaled away otherwise).
  const phone = rigid(rig, 'RightHand', new THREE.BoxGeometry(0.075, 0.008, 0.15), phoneM, [rig.at('RightHand').x - 0.07, rig.at('RightHand').y - 0.02, rig.at('RightHand').z + 0.02], [0, 0.3, 0])
  const face = new Face(rig, {
    bone: 'Head',
    eyes: { at: [0.036, hc.y + 0.02, hc.z + 0.084], r: 0.016, iris: '#4a6a8a', irisR: 0.009, pupilR: 0.004 },
    lids: { color: C(s, 'skin') },
    brows: { color: C(s, 'hair'), size: [0.032, 0.008, 0.007], up: 0.03 },
    mouth: { at: [0, hc.y - 0.06, hc.z + 0.1], size: [0.07, 0.035], sphere: 0.105, colors: { line: '#6a3424', inside: '#3d1410', teeth: '#fbfaf3', tongue: '#cf5a62' }, neutral: 'neutral' },
  })
  const hook = (c: HookCtx) => { phone.scale.setScalar(c.phone || c.special > 0.15 || (c.bailT > 86 && c.bailT < 146) ? 1 : 1e-4) }
  return { spec: s, character: new Character(rig.root), face, hook }
}

// ---------------------------------------------------------------- the sticker cast
// Karl the Fog, the Mission Burrito and the Pigeon, after the title screen's stickers (assets/ui).
// Built the first time they are picked (data/characters.json "lazy"), so startup is unchanged.

/** Cauliflower lobes pushed out of a lathe body (a cloud): rounded bulges at hashed spots, none where clear() says. */
function billow(mesh: THREE.Mesh, y0: number, y1: number, o: { lobes: number; size: [number, number]; amount: number; seed: number; clear?: (a: number, t: number) => boolean }) {
  const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute
  const lobes: { a: number; t: number; r: number }[] = []
  for (let i = 0; i < o.lobes * 3 && lobes.length < o.lobes; i++) {
    const a = hash2(i, 1, o.seed) * Math.PI * 2 - Math.PI, t = 0.06 + hash2(i, 2, o.seed) * 0.9
    if (o.clear?.(a, t)) continue
    lobes.push({ a, t, r: o.size[0] + hash2(i, 3, o.seed) * (o.size[1] - o.size[0]) })
  }
  const v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const rad = Math.hypot(v.x, v.z)
    if (rad < 0.02) continue
    const a = Math.atan2(v.x, v.z), t = (v.y - y0) / (y1 - y0)
    let bump = 0
    for (const L of lobes) {
      const d = Math.hypot(Math.atan2(Math.sin(a - L.a), Math.cos(a - L.a)) * rad, (t - L.t) * (y1 - y0)) / L.r
      if (d < 1) bump = Math.max(bump, Math.sqrt(1 - d * d) * L.r)
    }
    const k = 1 + (bump * o.amount) / rad
    pos.setXYZ(i, v.x * k, v.y, v.z * k)
  }
  pos.needsUpdate = true
  mesh.geometry.computeVertexNormals()
}

/** A lathe profile's radius at a height (linear between its rings). */
function radiusAt(prof: [number, number, number][], y: number, axis: 1 | 2 = 2): number {
  for (let k = 0; k < prof.length - 1; k++) if (y >= prof[k][0] && y <= prof[k + 1][0]) return mix(prof[k][axis], prof[k + 1][axis], (y - prof[k][0]) / (prof[k + 1][0] - prof[k][0] || 1))
  return 0
}

/** Round sunglasses on a bone: tinted lenses (the googly eyes show through), frames, bridge and arms back to the head. */
function sunglasses(rig: Rig, bone: string, at: V3, o: { r: number; gap: number; frames: THREE.Material; lens: THREE.Material; wide?: number; arms?: number }) {
  const w = o.wide ?? 1.25
  const parts: THREE.Mesh[] = []
  for (const k of [1, -1]) {
    const x = at[0] + k * (o.gap / 2 + o.r * w)
    parts.push(rigid(rig, bone, new THREE.CylinderGeometry(o.r, o.r, 0.008, 22), o.lens, [x, at[1], at[2]], [Math.PI / 2, 0, 0], [w, 1, 0.85]))
    parts.push(rigid(rig, bone, new THREE.TorusGeometry(o.r, o.r * 0.16, 8, 24), o.frames, [x, at[1], at[2] + 0.004], [0, 0, 0], [w, 0.85, 1]))
    if (o.arms) parts.push(rigid(rig, bone, new THREE.BoxGeometry(0.008, 0.008, o.arms), o.frames, [x + k * o.r * w * 0.9, at[1] + 0.005, at[2] - o.arms / 2], [0, -k * 0.12, 0]))
  }
  parts.push(rigid(rig, bone, new THREE.BoxGeometry(o.gap + 0.01, 0.008, 0.008), o.frames, [at[0], at[1] + o.r * 0.35, at[2] + 0.006]))
  for (const p of parts) p.castShadow = false
  return parts
}

/** Tube sock stripes (u around, v down the tube): white with two coloured bands near the top. */
function sockMap(base: string, stripe: string): THREE.Texture {
  const W = 16, H = 64, a = img(W, H), b = rgb(base), s = rgb(stripe)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = y / H
    const band = (v > 0.1 && v < 0.17) || (v > 0.24 && v < 0.31)
    const c = band ? s : b
    a.d.set([c[0], c[1], c[2], 1], (y * W + x) * 4)
  }
  return texture(a, true)
}

/** Hand-drawn texture painter: 256 square, f(u, v) -> rgb (v up). */
function paintTex(N: number, f: (u: number, v: number, x: number, y: number) => number[]): THREE.Texture {
  const a = img(N, N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const c = f(x / N, 1 - y / N, x, y); a.d.set([c[0], c[1], c[2], 1], (y * N + x) * 4) }
  return texture(a, true)
}

// ---- Karl the Fog: a grey cloud in teal sunglasses and sneakers, puffy, see-through at the edges.

function karl(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const thick = has(s, 'thick')
  const cd = detailMaps(41, 4, 0.95, 0.1, 0.45)
  const cloud = surface('cloud', { color: C(s, 'cloud'), normalMap: cd.normal, roughnessMap: cd.rough, roughness: 1, sheen: 0.9, sheenColor: '#ffffff' })
  const mist = surface('mist', { color: C(s, 'mist'), roughness: 1, opacity: thick ? 0.55 : 0.34 })
  const glove = surface('glove', { color: C(s, 'glove'), roughness: 0.6 })
  const canvas = surface('canvas sneaker', { color: C(s, 'shoe'), roughness: 0.85 })
  const trim = surface('sneaker trim', { color: C(s, 'trim'), roughness: 0.6 })
  const soleM = surface('sole', { color: C(s, 'sole'), roughness: 0.7 })
  const frames = surface('sunglasses', { color: C(s, 'frames'), roughness: 0.3, clearcoat: 1 })
  const lens = surface('lens', { color: '#0e1216', roughness: 0.05, metalness: 0.2, clearcoat: 1, opacity: 0.86 })
  const hipsY = rig.at('Hips').y, headY = rig.at('Head').y
  // The head joint sits low in the cloud, so its whole top half turns and nods with the head.
  const y0 = hipsY - 0.15, y1 = headY + (thick ? 0.6 : 0.55), R = thick ? 0.46 : 0.41
  const prof: [number, number, number][] = []
  for (let k = 0; k <= 26; k++) {
    const t = k / 26, y = y0 + t * (y1 - y0)
    const r = R * Math.pow(Math.sin(Math.PI * t), 0.45) * (1 + 0.05 * Math.sin(t * 9))
    prof.push([y, Math.max(0, r), Math.max(0, r * 0.86)])
  }
  const skin = ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head']
  // The cloud: one lathe from the seat to above the head, lumped all over except the face.
  const tEye = 0.7, yEye = y0 + tEye * (y1 - y0)
  const faceClear = (a: number, t: number) => Math.abs(a) < 1.15 && t > tEye - 0.36 && t < tEye + 0.22
  const body = lathe(rig, prof, skin, cloud, { sides: 44 })
  billow(body, y0, y1, { lobes: thick ? 52 : 44, size: [0.09, 0.19], amount: 0.85, seed: thick ? 5 : 3, clear: faceClear })
  // See-through puffs round the edge (not over the face), one merged mesh per bone.
  const puffBones: [string, number, number][] = [['Hips', y0 + 0.08, 0.6], ['Spine', rig.at('Spine').y, 0.9], ['Chest', rig.at('Chest').y + 0.06, 1], ['UpperChest', rig.at('UpperChest').y + 0.04, 0.95], ['Head', y1 - 0.08, 0.6]]
  let n = 0
  for (const [b, y, rk] of puffBones) {
    const r0 = radiusAt(prof, y, 1)
    const geos: [THREE.BufferGeometry, THREE.Matrix4][] = []
    for (let i = 0; i < 6; i++, n++) {
      const a = (i / 6) * Math.PI * 2 + hash2(n, 1, 17) * 0.8
      const front = Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) < 0.95 && y > yEye - 0.3
      if (front) continue
      const pr = (0.09 + hash2(n, 2, 17) * 0.07) * (thick ? 1.2 : 1) * rk
      const p = new THREE.Vector3(Math.sin(a) * r0 * 0.92, y + (hash2(n, 3, 17) - 0.5) * 0.08, Math.cos(a) * r0 * 0.82).sub(rig.at(b))
      geos.push([new THREE.IcosahedronGeometry(pr, 2), new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)])
    }
    if (geos.length) { const m = new THREE.Mesh(merged(geos), mist); m.castShadow = false; rig.bones.get(b)!.add(m) }
  }
  for (const side of ['Left', 'Right']) {
    const k = side === 'Left' ? 1 : -1
    tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.058, 0.05, 0.045], cloud, { blend: 0.1 })
    tube(rig, [`${side}UpLeg`, `${side}Leg`, `${side}Foot`], [0.06, 0.052, 0.048], cloud, { blend: 0.08 })
    hand(rig, side, glove, { r: 0.015, palm: [1, 0.036, 0.052], fingers: 4 })
    rigid(rig, `${side}Hand`, new THREE.TorusGeometry(0.042, 0.016, 8, 16), glove, rig.at(`${side}Hand`).toArray() as V3, [0, Math.PI / 2, 0])
    shoe(rig, side, canvas, soleM, { len: 0.27, w: 0.115, h: 0.1, puffy: 1.1 })
    const a = rig.at(`${side}Foot`)
    // Teal heel tab and a side flash, like the sticker's sneakers.
    rigid(rig, `${side}Foot`, new THREE.BoxGeometry(0.05, 0.05, 0.02), trim, [a.x, 0.075, a.z - 0.075])
    rigid(rig, `${side}Foot`, new THREE.CapsuleGeometry(0.008, 0.09, 3, 8), trim, [a.x + k * 0.06, 0.06, a.z + 0.03], [Math.PI / 2, 0, -0.35 * k], [1, 1, 1])
  }
  // Face: googly eyes behind tinted teal shades, cool brows, a smirk.
  const zEye = radiusAt(prof, yEye) * 0.98
  const face = new Face(rig, {
    bone: 'Head',
    eyes: { at: [0.095, yEye, zEye - 0.04], r: 0.058, squash: [1, 1.05, 0.8], iris: '#202428', irisR: 0.032, pupilR: 0.015 },
    lids: { color: C(s, 'cloud') },
    brows: { color: C(s, 'brow'), size: [0.095, 0.021, 0.016], up: 0.12, tilt: 0.3 },
    mouth: { bone: 'Head', at: [0, yEye - 0.16, radiusAt(prof, yEye - 0.16) + 0.012], size: [0.3, 0.14], bend: radiusAt(prof, yEye - 0.16, 1), colors: { line: C(s, 'mouth'), inside: '#2a2c30', teeth: '#fbfbf6', tongue: '#d8707a' }, neutral: 'smile' },
  })
  const shades = sunglasses(rig, 'Head', [0, yEye, zEye + 0.022], { r: 0.068, gap: 0.036, frames, lens, wide: 1.3, arms: 0.14 })
  // Mist: puffs for the bail (he disperses and re-forms), the specials (a fog trail) and the
  // emote's exhale; wisps trailing at the seat all the time. Model space, hidden until used.
  const bodyMeshes: THREE.Object3D[] = []
  rig.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !shades.includes(o as THREE.Mesh)) bodyMeshes.push(o) })
  const puffM = surface('fog puff', { color: C(s, 'mist'), roughness: 1, opacity: 0.6 })
  const puffs = Array.from({ length: 28 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), puffM)
    m.visible = false; m.castShadow = false
    rig.root.add(m)
    const a = hash2(i, 1, 23) * Math.PI * 2, t = 0.1 + hash2(i, 2, 23) * 0.85, y = y0 + t * (y1 - y0), r = radiusAt(prof, y, 1) * 0.8
    const at = new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r * 0.9)
    const dir = at.clone().sub(new THREE.Vector3(0, (y0 + y1) / 2, 0)).normalize()
    return { m, at, dir, size: 0.07 + hash2(i, 3, 23) * 0.08, far: 0.5 + hash2(i, 4, 23) * 0.7, rise: hash2(i, 5, 23) }
  })
  const wispM = surface('fog wisp', { color: C(s, 'mist'), roughness: 1, opacity: 0.32 })
  const wisps = Array.from({ length: 4 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), wispM)
    m.castShadow = false
    rig.root.add(m)
    return { m, k: i }
  })
  const hook = (c: HookCtx) => {
    // Bail: the cloud thins out into drifting puffs (only the shades stay), then gathers again.
    const T = c.bailT
    const k = T >= 0 ? smooth(22, 36, T) * (1 - smooth(98, 126, T)) : 0
    const hidden = k > 0.55
    for (const m of bodyMeshes) m.visible = !hidden
    const trail = c.special > 0.02 && c.specialId !== 'emote' ? c.special : 0
    const exhale = c.specialId === 'emote' ? c.special : 0
    for (const [i, p] of puffs.entries()) {
      if (k > 0.02) {
        p.m.visible = true
        const spread = k * p.far
        p.m.position.copy(p.at).addScaledVector(p.dir, spread).add(new THREE.Vector3(Math.sin(T * 0.05 + i) * 0.05 * k, p.rise * 0.35 * k, 0))
        p.m.scale.setScalar(p.size * (0.8 + 0.9 * k))
      } else if (trail > 0) {
        // Specials: a fog trail streaming off the back.
        const age = (c.specialT * 1.4 + i * 4) % 60
        p.m.visible = true
        p.m.position.set((p.dir.x * 0.3) * (1 + age / 30), p.at.y - age * 0.004, -0.25 - age * 0.03)
        p.m.scale.setScalar(p.size * trail * (1.4 - age / 60))
      } else if (exhale > 0 && i < 6) {
        // The cool nod: a slow puff from the smirk.
        const age = (c.specialT - i * 10)
        p.m.visible = age > 0 && age < 90
        p.m.position.set((i - 2.5) * 0.02, yEye - 0.14 + age * 0.002, zEye + 0.06 + age * 0.004)
        p.m.scale.setScalar(Math.max(1e-4, (0.025 + age * 0.0011) * exhale * (1 - smooth(60, 90, age))))
      } else p.m.visible = false
    }
    // Wisps curling off the seat, longer the faster he goes.
    const drag = Math.min(1, c.speed / 8)
    for (const w of wisps) {
      w.m.visible = !hidden
      const ph = c.ticks * 0.04 + w.k * 1.7
      w.m.position.set(Math.sin(ph) * 0.06 - 0.12 + w.k * 0.02, y0 + 0.05 + w.k * 0.03 + Math.sin(ph * 1.3) * 0.02, -0.22 - w.k * (0.07 + drag * 0.12))
      w.m.scale.set(0.1 - w.k * 0.017, 0.07 - w.k * 0.012, 0.13 - w.k * 0.02)
    }
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

// ---- Mission Burrito: foil-wrapped, open at the top (rice, beans, salsa showing), orange shades, a shaka.

/**
 * Crumpled foil: folds, not cells. Random fold lines across the sheet each add a tent (a crease
 * with a flat face either side), so the facets are large, irregular and flat, the creases sharp;
 * a little fine wrinkle on top. The colour is nearly even (the metal's reflections do the work).
 * Not tiled: u runs once round the burrito (the seam at the back), v once up it.
 */
function foilMaps(seed: number, tint: string): { map: THREE.Texture; flatMap: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } {
  const N = 256, h = new Float32Array(N * N), r = new Float32Array(N * N), col = img(N, N), flat = img(N, N), t = rgb(tint)
  const folds = Array.from({ length: 26 }, (_, i) => {
    const a = hash2(i, 1, seed) * Math.PI
    return { cx: hash2(i, 2, seed) * N, cy: hash2(i, 3, seed) * N, nx: Math.cos(a), ny: Math.sin(a), k: (0.35 + hash2(i, 4, seed) * 0.65) * (hash2(i, 5, seed) > 0.5 ? 1 : -1) }
  })
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    let v = 0, crease = 1e9
    for (const f of folds) {
      const d = (x - f.cx) * f.nx + (y - f.cy) * f.ny
      v += f.k * Math.sqrt(d * d + 2.5) * 0.14   // a tent, softened over a pixel or two
      crease = Math.min(crease, Math.abs(d))
    }
    v += (fbm(x / 9, y / 9, N / 9, 2, seed + 3) - 0.5) * 0.35   // fine wrinkle
    h[y * N + x] = v
    r[y * N + x] = 0.13 + (1 - smooth(0, 3, crease)) * 0.18 + fbm(x / 20, y / 20, N / 20, 2, seed + 5) * 0.06
    const k = 0.97 + (fbm(x / 40, y / 40, N / 40, 2, seed + 7) - 0.5) * 0.06
    col.d.set([t[0] * k, t[1] * k, t[2] * k, 1], (y * N + x) * 4)
  }
  // The flat looks (cute, grey) have no metal: each facet's tilt is baked in as light and shade.
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const i = y * N + x, gx = h[y * N + ((x + 1) % N)] - h[y * N + ((x + N - 1) % N)], gy = h[((y + 1) % N) * N + x] - h[((y + N - 1) % N) * N + x]
    const k = Math.max(0.62, Math.min(1.12, 0.92 + gx * 0.9 - gy * 0.6))
    flat.d.set([t[0] * k, t[1] * k, t[2] * k, 1], i * 4)
  }
  const map = texture(col, true), flatMap = texture(flat, true), normal = texture(normalFromHeight(h, N, N, 6), false), rough = texture(roughMap(r, N, N, 1), false)
  return { map, flatMap, normal, rough }
}

/** The open top: rice with beans, meat, guacamole, salsa and cilantro (u, v across the disc). */
function fillingMap(s: CharacterSpec): THREE.Texture {
  const rice = rgb(C(s, 'rice')), bean = rgb(C(s, 'bean')), meat = rgb(C(s, 'meat')), guac = rgb(C(s, 'guac')), salsa = rgb(C(s, 'salsa'))
  return paintTex(256, (u, v, x, y) => {
    let c = rice.map((q) => q * (0.9 + hash2(x >> 1, y >> 1, 3) * 0.12))
    const blob = (cx: number, cy: number, r: number) => Math.hypot(u - cx, v - cy) < r + fbm(x / 12, y / 12, 256 / 12, 2, 4) * 0.04
    if (blob(0.62, 0.62, 0.17)) c = guac.map((q) => q * (0.85 + fbm(x / 6, y / 6, 256 / 6, 2, 9) * 0.3))
    for (let i = 0; i < 26; i++) {
      const cx = hash2(i, 1, 31), cy = hash2(i, 2, 31), kind = hash2(i, 3, 31)
      if (Math.hypot(u - cx, v - cy) < 0.035 + kind * 0.02) c = kind < 0.4 ? bean : kind < 0.75 ? meat : salsa
    }
    if (hash2(x >> 2, y >> 2, 77) > 0.94) c = [0.18, 0.42, 0.12]   // cilantro
    return c
  })
}

function burrito(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const wet = has(s, 'wet')
  const fm = foilMaps(51, C(s, 'foil'))
  const foil = surface('foil', { color: 0xffffff, map: fm.map, normalMap: fm.normal, normalScale: 1.0, roughnessMap: fm.rough, roughness: 1, metalness: 1, clearcoat: 0.25, clearcoatRoughness: 0.3 })
  // Brushed along the roll: an anisotropic highlight streaks up and down the wrap, as foil does.
  const foilReal = foil.userData.real as THREE.MeshPhysicalMaterial
  foilReal.anisotropy = 0.75; foilReal.anisotropyRotation = Math.PI / 2
  foil.map = fm.flatMap
  const sauceTex = paintTex(256, (u, v, x, y) => {
    const sauce = rgb(C(s, 'sauce')), cheese = rgb(C(s, 'cheese'))
    const streak = Math.sin(u * 40 + fbm(x / 16, y / 16, 16, 3, 2) * 8) > 0.72 && v > 0.45
    const n = 0.85 + fbm(x / 10, y / 10, 256 / 10, 3, 6) * 0.3
    return (streak ? cheese : sauce).map((q) => q * n)
  })
  const sauce = surface('enchilada sauce', { color: 0xffffff, flat: C(s, 'sauce'), map: sauceTex, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.12 })
  const tortTex = paintTex(128, (u, v, x, y) => {
    const t = rgb(C(s, 'tortilla')), b = rgb(C(s, 'toast'))
    const spot = fbm(x / 9, y / 9, 128 / 9, 3, 13) > 0.62
    return spot ? b : t.map((q) => q * (0.94 + hash2(x, y, 5) * 0.06))
  })
  const tortilla = surface('tortilla', { color: 0xffffff, flat: C(s, 'tortilla'), map: tortTex, roughness: 0.85, sheen: 0.3, sheenColor: '#fff2d0', side: THREE.DoubleSide })
  const filling = surface('filling', { color: 0xffffff, flat: C(s, 'rice'), map: fillingMap(s), roughness: 0.8 })
  const limb = surface('rubber hose', { color: C(s, 'limb'), roughness: 0.5, clearcoat: 0.3 })
  const glove = surface('glove', { color: C(s, 'glove'), roughness: 0.6 })
  const sockM = surface('tube sock', { color: 0xffffff, flat: C(s, 'sock'), map: sockMap(C(s, 'sock'), C(s, 'stripe')), roughness: 0.95 })
  const shoeM = surface('sneaker', { color: C(s, 'shoe'), roughness: 0.55, clearcoat: 0.3 })
  const soleM = surface('sole', { color: C(s, 'sole'), roughness: 0.7 })
  const frames = surface('sunglasses', { color: C(s, 'frames'), roughness: 0.3, clearcoat: 1 })
  const lens = surface('lens', { color: '#1c120a', roughness: 0.05, metalness: 0.2, clearcoat: 1, opacity: 0.86 })
  const hipsY = rig.at('Hips').y, R = 0.18, top = hipsY + 0.76, foilTop = top - 0.13
  const skin = ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck']
  // The wrap: folded bottom, a slightly fat middle, foil up to below the top (or smothered in sauce).
  const wrap: [number, number, number][] = [[hipsY - 0.035, 0, 0], [hipsY - 0.03, R * 0.72, R * 0.72], [hipsY - 0.005, R * 0.94, R * 0.92], [hipsY + 0.05, R, R * 0.97]]
  for (let k = 1; k <= 8; k++) { const y = hipsY + 0.05 + (k / 8) * (foilTop - hipsY - 0.05); const r = R * (1 + 0.05 * Math.sin(Math.PI * k / 8)); wrap.push([y, r, r * 0.97]) }
  const body = lathe(rig, wrap, skin, wet ? sauce : foil, {
    sides: 36, caps: [true, false],
    // Unwrapping (the bail): the top of the wrap peels out and down.
    morphs: { unwrap: (p, f) => { const k = smooth(0.3, 1, f); return new THREE.Vector3(p.x * (1 + 1.3 * k * k), p.y - 0.2 * k * k, p.z * (1 + 1.3 * k * k)) } },
  })
  if (!wet) {
    // A crumpled foil edge round the opening.
    const rimG = new THREE.TorusGeometry(R * 1.04, 0.02, 6, 30)
    const rp = rimG.getAttribute('position') as THREE.BufferAttribute
    for (let i = 0; i < rp.count; i++) rp.setXYZ(i, rp.getX(i) * (1 + (hash2(i, 1, 3) - 0.5) * 0.06), rp.getY(i) * (1 + (hash2(i, 2, 3) - 0.5) * 0.06), rp.getZ(i) * (1 + (hash2(i, 3, 3) - 0.5) * 0.8))
    rimG.computeVertexNormals()
    rigid(rig, 'UpperChest', rimG, foil, [0, foilTop, 0], [Math.PI / 2, 0, 0])
  }
  // The tortilla above the wrap, a little flared, and the filling inside it.
  const tort = lathe(rig, [[foilTop - 0.05, R * 0.99, R * 0.96], [top - 0.05, R * 1.02, R * 0.99], [top, R * 1.07, R * 1.04]], ['UpperChest', 'Neck'], tortilla, {
    sides: 32, caps: [false, false],
    morphs: { spill: (p, f) => new THREE.Vector3(p.x * (1 + 0.5 * f), p.y, p.z * (1 + 0.5 * f)) },
  })
  const capR = R * 1.0, capH = 0.035
  const capG = new THREE.SphereGeometry((capR * capR + capH * capH) / (2 * capH), 30, 6, 0, Math.PI * 2, 0, Math.asin(Math.min(1, capR / ((capR * capR + capH * capH) / (2 * capH)))))
  const cp = capG.getAttribute('position') as THREE.BufferAttribute, cuv = capG.getAttribute('uv') as THREE.BufferAttribute
  for (let i = 0; i < cp.count; i++) cuv.setXY(i, cp.getX(i) / capR * 0.5 + 0.5, cp.getZ(i) / capR * 0.5 + 0.5)
  const sphereR = (capR * capR + capH * capH) / (2 * capH)
  rigid(rig, 'Neck', capG, filling, [0, top - 0.045 - (sphereR - capH), 0])
  // A few chunks on top: beans, salsa, a scoop of guac.
  const bits = (n: number, seed: number, geo: (i: number) => THREE.BufferGeometry, spread: number, lift: number) => {
    const parts: [THREE.BufferGeometry, THREE.Matrix4][] = []
    for (let i = 0; i < n; i++) {
      const a = hash2(i, 1, seed) * Math.PI * 2, r = Math.sqrt(hash2(i, 2, seed)) * spread
      parts.push([geo(i), M([Math.cos(a) * r, top - 0.012 + lift + hash2(i, 3, seed) * 0.01, Math.sin(a) * r], [hash2(i, 4, seed) * 3, hash2(i, 5, seed) * 3, 0])])
    }
    return merged(parts).translate(0, -rig.at('Neck').y, 0)
  }
  const beanM = surface('beans', { color: C(s, 'bean'), roughness: 0.4, clearcoat: 0.4 })
  const salsaM = surface('salsa', { color: C(s, 'salsa'), roughness: 0.3, clearcoat: 0.6 })
  const guacM = surface('guacamole', { color: C(s, 'guac'), roughness: 0.6 })
  rig.bones.get('Neck')!.add(new THREE.Mesh(bits(12, 41, () => new THREE.SphereGeometry(0.014, 8, 6).scale(1.5, 0.8, 1), R * 0.8, 0), beanM))
  rig.bones.get('Neck')!.add(new THREE.Mesh(bits(9, 43, () => new THREE.IcosahedronGeometry(0.012, 0), R * 0.75, 0.004), salsaM))
  rig.bones.get('Neck')!.add(new THREE.Mesh(bits(1, 47, () => new THREE.SphereGeometry(0.05, 12, 8).scale(1.1, 0.6, 1), R * 0.3, 0.006), guacM))
  if (wet) {
    // Smothered: sauce drips down the sides and a dollop of sour cream on top.
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + 0.3, len = 0.06 + hash2(i, 1, 9) * 0.12
      rigid(rig, 'Chest', new THREE.CapsuleGeometry(0.014, len, 3, 8), sauce, [Math.sin(a) * R * 1.02, hipsY + 0.06 + hash2(i, 2, 9) * 0.1, Math.cos(a) * R * 1.0], [0, 0, 0])
    }
    rigid(rig, 'Neck', new THREE.SphereGeometry(0.045, 12, 8), surface('sour cream', { color: '#f6f2e8', roughness: 0.5, clearcoat: 0.3 }), [0.04, top + 0.005, 0.02], [0, 0, 0], [1.2, 0.55, 1])
  }
  // Arms and legs: black rubber hose, white gloves, striped tube socks, teal sneakers.
  limbs(rig, limb, limb, { arm: [0.03, 0.028, 0.026], leg: [0.034, 0.03, 0.028] }, true)
  for (const side of ['Left', 'Right']) {
    hand(rig, side, glove, { r: 0.015, palm: [1, 0.036, 0.052], fingers: 4 })
    rigid(rig, `${side}Hand`, new THREE.TorusGeometry(0.038, 0.015, 8, 16), glove, rig.at(`${side}Hand`).toArray() as V3, [0, Math.PI / 2, 0])
    tube(rig, [`${side}Leg`, `${side}Foot`], [0.042, 0.04], sockM, { caps: [false, false], from: rig.at(`${side}Leg`).clone().lerp(rig.at(`${side}Foot`), 0.35).toArray() as V3 })
    shoe(rig, side, shoeM, soleM, { len: 0.27, w: 0.115, h: 0.1, puffy: 1.12 })
  }
  // Face on the wrap: googly eyes behind orange shades, a big grin.
  const yEye = top - 0.25, zFace = R * 1.04
  const face = new Face(rig, {
    bone: 'UpperChest',
    eyes: { at: [0.06, yEye, zFace - 0.03], r: 0.042, squash: [1, 1.05, 0.8], iris: '#2a1a10', irisR: 0.024, pupilR: 0.012 },
    lids: { color: wet ? C(s, 'sauce') : C(s, 'foil') },
    brows: { color: '#2b2b2e', size: [0.05, 0.013, 0.01], up: 0.075 },
    mouth: { bone: 'Chest', at: [0, yEye - 0.13, zFace + 0.003], size: [0.17, 0.09], bend: zFace, colors: { line: '#3a1a10', inside: '#2a0a0c', teeth: '#fbfbf6', tongue: '#e15467' }, neutral: 'grin' },
  })
  sunglasses(rig, 'UpperChest', [0, yEye, zFace + 0.016], { r: 0.046, gap: 0.026, frames, lens, wide: 1.25, arms: 0.09 })
  // Spill (the bail): rice, beans, salsa and guac fly out of the top and land round him, then
  // fly back as he rewraps. Salsa spray in the specials. Model space, hidden until used.
  const chunkMats = [filling, beanM, salsaM, guacM]
  const chunks = Array.from({ length: 36 }, (_, i) => {
    const kind = i % 4, size = kind === 0 ? 0.012 : kind === 3 ? 0.022 : 0.015
    const m = new THREE.Mesh(kind === 1 ? new THREE.SphereGeometry(1, 8, 6).scale(1.5, 0.8, 1) : new THREE.IcosahedronGeometry(1, kind === 3 ? 1 : 0), chunkMats[kind])
    m.visible = false; m.castShadow = false
    rig.root.add(m)
    const a = hash2(i, 1, 61) * Math.PI * 2
    return { m, size, v: new THREE.Vector3(Math.cos(a) * (0.6 + hash2(i, 2, 61) * 1.2), 1.2 + hash2(i, 3, 61) * 1.5, Math.sin(a) * (0.6 + hash2(i, 2, 61) * 1.2)) }
  })
  const neck = rig.bones.get('Neck')!
  const dict = body.morphTargetDictionary!, tdict = tort.morphTargetDictionary!
  const fingers = (side: string, shaka: number) => {
    // A shaka: index, middle and ring curled in, thumb and pinky straight out.
    if (shaka <= 0) return
    const ax = new THREE.Vector3(0, 0, side === 'Left' ? -1 : 1)
    for (const f of ['Index', 'Middle', 'Ring']) for (let j = 1; j <= 3; j++) rig.bones.get(`${side}Hand${f}${j}`)!.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(ax, 1.45), shaka)
    for (let j = 1; j <= 3; j++) rig.bones.get(`${side}HandPinky${j}`)!.quaternion.slerp(new THREE.Quaternion(), shaka)
    rig.bones.get(`${side}HandThumb1`)!.quaternion.slerp(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), side === 'Left' ? 0.5 : -0.5), shaka)
    rig.bones.get(`${side}HandThumb2`)!.quaternion.slerp(new THREE.Quaternion(), shaka)
  }
  const hook = (c: HookCtx) => {
    const T = c.bailT
    const k = T >= 0 ? smooth(22, 32, T) * (1 - smooth(110, 132, T)) : 0
    body.morphTargetInfluences![dict.unwrap] = k
    tort.morphTargetInfluences![tdict.spill] = k
    // Where the top is now, in model space (lying down, it is near the ground).
    const rootInv = rig.root.matrixWorld.clone().invert()
    const at = new THREE.Vector3(0, top - rig.at('Neck').y, 0).applyMatrix4(neck.matrixWorld).applyMatrix4(rootInv)
    const spray = c.special > 0.02 && c.specialId !== 'emote' ? c.special : 0
    for (const [i, ch] of chunks.entries()) {
      if (T >= 26 && T < 134) {
        const t = Math.min(1.2, (T - 26) / 120), back = smooth(108, 130, T)
        const p = at.clone().addScaledVector(ch.v, t * 0.55).add(new THREE.Vector3(0, -4.9 * t * t * 0.55, 0))
        p.y = Math.max(ch.size, p.y)
        ch.m.position.copy(p.lerp(at, back))
        ch.m.scale.setScalar(ch.size * (1 - back) + 1e-4)
        ch.m.visible = true
      } else if (spray > 0 && i % 4 === 2) {
        const age = ((c.specialT + i * 3) % 30) / 120
        ch.m.position.copy(at).add(new THREE.Vector3(ch.v.x * age * 0.5, ch.v.y * age - 4.9 * age * age, ch.v.z * age * 0.5))
        ch.m.scale.setScalar(ch.size * spray)
        ch.m.visible = true
      } else ch.m.visible = false
    }
    // The shaka: in the emote and the shaka wave idle, on whichever hand is up.
    const shaka = Math.max(c.specialId === 'emote' ? c.special : 0, c.idleName === 'shakaWave' ? c.idleK : 0)
    if (shaka > 0) {
      const l = new THREE.Vector3(), r = new THREE.Vector3()
      rig.bones.get('LeftHand')!.getWorldPosition(l); rig.bones.get('RightHand')!.getWorldPosition(r)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(rig.root.getWorldQuaternion(new THREE.Quaternion()))
      fingers(l.dot(up) > r.dot(up) ? 'Left' : 'Right', shaka)
    }
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

// ---- The Pigeon: grey, chest puffed, iridescent neck, a backwards orange cap, orange feet in tube socks.

function pigeon(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const fd = detailMaps(61, 2, 0.85, 0.15, 1.5)
  const feathers = surface('feathers', { color: C(s, 'body'), normalMap: fd.normal, roughnessMap: fd.rough, roughness: 1, sheen: 0.4, sheenColor: '#dfe3ea' })
  const dark = surface('dark feathers', { color: C(s, 'dark'), normalMap: fd.normal, roughness: 0.9 })
  const light = surface('light feathers', { color: C(s, 'light'), normalMap: fd.normal, roughness: 0.95 })
  const wingTex = paintTex(128, (u, v) => {
    // Along the wing (u) two dark bars across the feathers, darker tips (primaries).
    const base = rgb(C(s, 'light')), bar = rgb(C(s, 'dark'))
    const isBar = (u > 0.38 && u < 0.46) || (u > 0.56 && u < 0.64)
    const tip = u > 0.85
    return isBar || tip ? bar : base.map((q) => q * (0.92 + 0.08 * Math.sin(v * 60)))
  })
  const wingM = surface('wing', { color: 0xffffff, flat: C(s, 'light'), map: wingTex, normalMap: fd.normal, roughness: 0.95 })
  const neckTex = paintTex(64, (u, v) => { const a = rgb(C(s, 'neckA')), b = rgb(C(s, 'neckB')); return a.map((q, i) => mix(b[i], q, smooth(0.25, 0.75, v + 0.15 * Math.sin(u * 12)))) })
  const neckM = surface('iridescent neck', { color: 0xffffff, flat: C(s, 'neckA'), map: neckTex, roughness: 0.32, iridescence: 1, sheen: 0.5, sheenColor: C(s, 'neckB') })
  const beakM = surface('beak', { color: C(s, 'beak'), roughness: 0.4, clearcoat: 0.5 })
  const cereM = surface('cere', { color: C(s, 'cere'), roughness: 0.8 })
  const capM = surface('cap', { color: C(s, 'cap'), roughness: 0.75 })
  const brimM = surface('brim', { color: C(s, 'brim'), roughness: 0.7 })
  const legM = surface('pigeon leg', { color: C(s, 'leg'), roughness: 0.55 })
  const talonM = surface('talon', { color: C(s, 'talon'), roughness: 0.3, clearcoat: 0.5 })
  const sockM = surface('tube sock', { color: 0xffffff, flat: C(s, 'sock'), map: sockMap(C(s, 'sock'), C(s, 'stripe')), roughness: 0.95 })
  const hipsY = rig.at('Hips').y, neckY = rig.at('Neck').y, headY = rig.at('Head').y
  // Body: plump, the chest pushed forward; it puffs up more strutting (morph).
  const bodyProf: [number, number, number, number][] = [[hipsY - 0.13, 0, 0, -0.02], [hipsY - 0.11, 0.13, 0.13, -0.02], [hipsY - 0.02, 0.19, 0.2, 0], [hipsY + 0.12, 0.215, 0.24, 0.04], [hipsY + 0.26, 0.225, 0.265, 0.07], [hipsY + 0.38, 0.2, 0.235, 0.065], [neckY - 0.06, 0.15, 0.165, 0.04], [neckY + 0.02, 0.095, 0.1, 0.02], [neckY + 0.06, 0, 0, 0.02]]
  const body = lathe(rig, bodyProf, ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], feathers, {
    sides: 36,
    morphs: { puff: (p, f) => { const k = Math.sin(Math.PI * Math.min(1, Math.max(0, (f - 0.2) / 0.7))); return new THREE.Vector3(p.x * (1 + 0.08 * k), p.y, p.z + Math.max(0, p.z) * 0.22 * k) } },
  })
  // The iridescent collar up the neck to the head.
  lathe(rig, [[neckY - 0.1, 0.16, 0.18, 0.05], [neckY - 0.02, 0.112, 0.122, 0.035], [neckY + 0.05, 0.082, 0.088, 0.02], [headY + 0.01, 0.07, 0.075, 0.015]], ['UpperChest', 'Neck', 'Head'], neckM, { sides: 28, caps: [false, false] })
  // Head: small and round, a dark beak with the white cere, a backwards cap.
  const hc = new THREE.Vector3(0, headY + 0.07, 0.02)
  rigid(rig, 'Head', new THREE.SphereGeometry(0.092, 22, 16), feathers, hc.toArray() as V3, [0, 0, 0], [0.92, 1, 1.12])
  rigid(rig, 'Head', new THREE.ConeGeometry(0.02, 0.075, 12), beakM, [0, hc.y - 0.01, hc.z + 0.125], [Math.PI / 2 + 0.25, 0, 0], [1, 1, 0.75])
  rigid(rig, 'Head', new THREE.SphereGeometry(0.022, 10, 8), cereM, [0, hc.y + 0.008, hc.z + 0.092], [0, 0, 0], [1, 0.6, 0.9])
  // The lower beak opens with the expression (the face's jaw).
  const jawP = pivot(rig, 'Head', [0, hc.y - 0.022, hc.z + 0.088])
  const lower = new THREE.Mesh(new THREE.ConeGeometry(0.015, 0.055, 10), beakM)
  lower.rotation.x = Math.PI / 2 + 0.35; lower.position.set(0, -0.004, 0.024); lower.scale.set(1, 1, 0.6)
  jawP.add(lower)
  rigid(rig, 'Head', new THREE.SphereGeometry(0.096, 20, 10, 0, Math.PI * 2, 0, Math.PI * 0.46), capM, [0, hc.y + 0.018, hc.z - 0.01], [-0.12, 0, 0], [0.96, 0.9, 1.1])
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.075, 0.075, 0.009, 18, 1, false, Math.PI / 2, Math.PI), brimM, [0, hc.y + 0.03, hc.z - 0.085], [-0.12, 0, 0], [1, 1, 1.45])
  rigid(rig, 'Head', new THREE.SphereGeometry(0.012, 8, 6), brimM, [0, hc.y + 0.105, hc.z - 0.01])
  // Wings for arms (two dark bars, dark primaries past the hand), feather fingers.
  for (const side of ['Left', 'Right']) {
    const k = side === 'Left' ? 1 : -1
    tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.052, 0.045, 0.038], feathers, { blend: 0.08 })
    const sh = rig.at(`${side}Arm`), el = rig.at(`${side}ForeArm`), wr = rig.at(`${side}Hand`)
    const up = el.x - sh.x, fo = wr.x - el.x
    rigid(rig, `${side}Arm`, new THREE.SphereGeometry(1, 18, 10), wingM, [sh.x + up / 2, sh.y - 0.02, sh.z - 0.02], [0, 0, 0], [Math.abs(up) * 0.55, 0.022, 0.085])
    rigid(rig, `${side}ForeArm`, new THREE.SphereGeometry(1, 18, 10), wingM, [el.x + fo * 0.62, el.y - 0.02, el.z - 0.025], [0, 0, k * -0.08], [Math.abs(fo) * 0.75, 0.018, 0.078])
    hand(rig, side, dark, { r: 0.012, palm: [1, 0.022, 0.05], fingers: 4 })
    // Legs: feathered thighs, thin pink shins in striped tube socks, orange feet with talons.
    tube(rig, [`${side}UpLeg`, `${side}Leg`], [0.075, 0.05], feathers, { blend: 0.06 })
    tube(rig, [`${side}Leg`, `${side}Foot`], [0.024, 0.021], legM, { blend: 0.04 })
    tube(rig, [`${side}Leg`, `${side}Foot`], [0.034, 0.031], sockM, { caps: [false, false], from: rig.at(`${side}Leg`).clone().lerp(rig.at(`${side}Foot`), 0.3).toArray() as V3, to: rig.at(`${side}Leg`).clone().lerp(rig.at(`${side}Foot`), 0.88).toArray() as V3 })
    const a = rig.at(`${side}Foot`)
    for (const [dx, len, back] of [[-0.035, 0.12, 0], [0, 0.14, 0], [0.035, 0.12, 0], [0, 0.07, 1]] as const) {
      const dir = back ? -1 : 1
      const from: V3 = [a.x + k * dx * 0.3, 0.02, a.z + 0.01 * dir]
      const to: V3 = [a.x + k * dx * 1.6, 0.014, a.z + dir * len]
      bone2bone(rig, `${side}Foot`, from, to, 0.013, legM)
      rigid(rig, `${side}Foot`, new THREE.ConeGeometry(0.009, 0.03, 8), talonM, [to[0], 0.012, to[2] + dir * 0.012], [dir * Math.PI / 2, 0, 0])
    }
  }
  // Tail: a fan of feathers, dark-banded.
  for (let i = 0; i < 7; i++) {
    const a = (i - 3) * 0.14
    rigid(rig, 'Hips', new THREE.CapsuleGeometry(0.045, 0.15, 3, 10), feathers, [Math.sin(a) * 0.11, hipsY - 0.05, -0.2 - Math.cos(a) * 0.05], [-Math.PI / 2 - 0.55, 0, a], [1, 1, 0.16])
    rigid(rig, 'Hips', new THREE.CapsuleGeometry(0.046, 0.04, 3, 10), dark, [Math.sin(a) * 0.17, hipsY - 0.12, -0.3 - Math.cos(a) * 0.04], [-Math.PI / 2 - 0.55, 0, a], [1, 1, 0.17])
  }
  // Light chest feathers down the front.
  rigid(rig, 'Chest', new THREE.SphereGeometry(1, 16, 12), light, [0, hipsY + 0.16, 0.2], [0, 0, 0], [0.12, 0.16, 0.05])
  const face = new Face(rig, {
    bone: 'Head',
    eyes: { at: [0.048, hc.y + 0.015, hc.z + 0.07], r: 0.03, squash: [1, 1, 0.8], iris: C(s, 'iris'), irisR: 0.022, pupilR: 0.009, spread: 0.45 },
    lids: { color: C(s, 'body') },
    brows: { color: C(s, 'dark'), size: [0.04, 0.009, 0.008], up: 0.034, tilt: 0.45 },
    // No lips on a pigeon: the mouth decal sits inside the head; the beak opens instead.
    mouth: { at: [0, hc.y - 0.02, hc.z + 0.02], size: [0.02, 0.01], colors: { line: '#000000', inside: '#000000', teeth: '#000000', tongue: '#000000' } },
    jaw: { at: [0, 0, 0], mesh: jawP, open: 0.5 },
  })
  // Feathers for the bail (a burst that floats down) and the specials (a few trailing).
  const featherMats = [light, feathers, light, dark]
  const plumes = Array.from({ length: 30 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6).scale(0.38, 0.07, 1), featherMats[i % 4])
    m.visible = false; m.castShadow = false
    rig.root.add(m)
    const a = hash2(i, 1, 71) * Math.PI * 2
    return { m, v: new THREE.Vector3(Math.cos(a) * (0.8 + hash2(i, 2, 71) * 1.6), 0.9 + hash2(i, 3, 71) * 1.6, Math.sin(a) * (0.8 + hash2(i, 2, 71) * 1.6)), spin: hash2(i, 4, 71) * 6, size: 0.06 + hash2(i, 5, 71) * 0.035 }
  })
  const headBone = rig.bones.get('Head')!, chest = rig.bones.get('Chest')!
  const dict = body.morphTargetDictionary!
  const hook = (c: HookCtx) => {
    // The head bob: walking, strutting (the emote) and pecking at crumbs (an idle).
    const strut = c.specialId === 'emote' ? c.special : 0
    const bob = Math.sin(c.ticks * 0.35) * 0.03 * Math.max(c.walk, strut) + (strut ? Math.sin(c.specialT * 0.28) * 0.035 * strut : 0)
    headBone.position.z += bob
    const peck = c.idleName === 'peck' ? c.idleK * Math.pow(Math.max(0, Math.sin(c.idleT * 0.1)), 6) : 0
    if (peck > 0) headBone.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), peck * 0.9))
    // Chest out: strutting, standing with wings crossed, and when thrilled.
    body.morphTargetInfluences![dict.puff] = Math.max(strut, c.idleName === 'crossWings' ? c.idleK * 0.5 : 0, c.mood === 'ecstatic' ? 0.6 : 0)
    // Bail: a burst of feathers that float down and settle, gone as he gets up.
    const T = c.bailT
    const rootInv = rig.root.matrixWorld.clone().invert()
    const at = new THREE.Vector3(0, 0.1, 0.1).applyMatrix4(chest.matrixWorld).applyMatrix4(rootInv)
    const trail = c.special > 0.02 && c.specialId !== 'emote' ? c.special : 0
    for (const [i, f] of plumes.entries()) {
      if (T >= 20 && T < 150) {
        const t = (T - 20) / 120
        const fall = Math.min(t, 0.18)
        const p = at.clone().addScaledVector(f.v, fall).add(new THREE.Vector3(Math.sin(T * 0.06 + i) * 0.08 * t, -Math.max(0, t - 0.18) * 0.9, 0))
        p.y = Math.max(0.005, p.y)
        f.m.position.copy(p)
        f.m.rotation.set(Math.sin(T * 0.05 + f.spin) * 0.8, f.spin + T * 0.02, Math.cos(T * 0.04 + f.spin) * 0.6)
        f.m.scale.setScalar(f.size * (1 - smooth(130, 150, T)) + 1e-4)
        f.m.visible = true
      } else if (trail > 0 && i < 10) {
        const age = ((c.specialT * 1.2 + i * 6) % 60) / 60
        f.m.position.set(f.v.x * 0.2, at.y - age * 0.4, -0.2 - age * 1.0)
        f.m.rotation.set(age * 4 + f.spin, f.spin, 0)
        f.m.scale.setScalar(f.size * trail)
        f.m.visible = true
      } else f.m.visible = false
    }
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

// ---- The secret skaters (unlocked through the Tour): the Robotaxi and the Cable Car. Vehicles as
// characters: the body is one rigid part on the Spine (a car does not bend), struts for legs.

/** A side profile ([z, y] points, model space) extruded across x to width, centred, edges bevelled. */
function profileSolid(pts: [number, number][], width: number, bevel: number, y0: number): THREE.BufferGeometry {
  const sh = new THREE.Shape()
  sh.moveTo(pts[0][0], pts[0][1])
  for (const p of pts.slice(1)) sh.lineTo(p[0], p[1])
  const depth = width - 2 * bevel
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 3, curveSegments: 4 })
  g.translate(0, y0, -depth / 2)
  g.rotateY(-Math.PI / 2)   // shape x -> model z, the extrusion -> model x
  g.computeVertexNormals()
  return g
}

/** A flat polygon ([z, y] points) on the side of a body at x, facing out (+x or -x). */
function sidePlate(pts: [number, number][], x: number, y0: number): THREE.BufferGeometry {
  const out = Math.sign(x)
  const sh = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(out > 0 ? -z : z, y)))
  const g = new THREE.ShapeGeometry(sh)
  g.rotateY(out * Math.PI / 2)
  g.translate(x, y0, 0)
  return g
}

/** A small painted sign texture: text (one line) on a colour, W x H pixels. */
function signTex(textStr: string, bg: string, fg: string, W = 256, H = 48): THREE.Texture {
  const a = img(W, H), b = rgb(bg), f = rgb(fg)
  // Cap height as a fraction of the sign's height, as big as fits (characters are 6/7 as wide as tall).
  const ch = Math.min(0.62, 0.9 / (textStr.length * (6 / 7) * (H / W))), cw = ch * (6 / 7) * (H / W)
  const u0 = 0.5 - (textStr.length * cw) / 2
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = textCoverage(textStr, (x / W - u0) / cw, (y / H - (0.5 - ch / 2)) / ch)
    const col = b.map((q, i) => mix(q, f[i], k))
    a.d.set([col[0], col[1], col[2], 1], (y * W + x) * 4)
  }
  return texture(a, true)
}

// The Robotaxi: a little white self-driving hatchback (no brand), a spinning sensor on the roof,
// googly eyes in the windshield, robot arms out of the mirrors, its own wheels tucked up under it.
function robotaxi(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const paint = surface('robotaxi paint', { color: C(s, 'body'), roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12 })
  const trim = surface('robotaxi trim', { color: C(s, 'trim'), roughness: 0.4, clearcoat: 0.5 })
  const glass = surface('robotaxi glass', { color: C(s, 'glass'), roughness: 0.08, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide })
  const dark = surface('robotaxi black', { color: C(s, 'dark'), roughness: 0.5 })
  const tire = surface('tire', { color: C(s, 'tire'), roughness: 0.85 })
  const hub = surface('hubcap', { color: C(s, 'hub'), roughness: 0.3, metalness: 0.8 })
  const sensorM = surface('lidar', { color: C(s, 'sensor'), roughness: 0.25, clearcoat: 0.6 })
  const lens = surface('lidar lens', { color: '#121417', roughness: 0.05, metalness: 0.3, clearcoat: 1 })
  const lamp = surface('headlight', { color: C(s, 'lamp'), emissive: C(s, 'lamp'), emissiveIntensity: 0.5, roughness: 0.2 })
  const bright = surface('headlight on', { color: C(s, 'lamp'), emissive: C(s, 'lamp'), emissiveIntensity: 3, roughness: 0.2 })
  const tail = surface('tail light', { color: C(s, 'tail'), emissive: C(s, 'tail'), emissiveIntensity: 0.4, roughness: 0.3 })
  const hazOff = surface('hazard lens', { color: '#b8692a', roughness: 0.3 })
  const hazOn = surface('hazard on', { color: C(s, 'hazard'), emissive: C(s, 'hazard'), emissiveIntensity: 3, roughness: 0.3 })
  const armM = surface('robot arm', { color: C(s, 'arm'), roughness: 0.35, metalness: 0.6 })
  const glove = surface('glove', { color: C(s, 'glove'), roughness: 0.6 })
  const coneM = surface('cone', { color: C(s, 'cone'), roughness: 0.6 })
  const white = surface('cone stripe', { color: '#f4f4f0', roughness: 0.5 })
  const y0 = rig.at('Hips').y
  // Body (nose to the facing side, +z) and the cabin on it.
  rigid(rig, 'Spine', profileSolid([[-0.4, 0], [0.34, 0], [0.4, 0.06], [0.39, 0.15], [0.22, 0.22], [-0.33, 0.24], [-0.4, 0.17], [-0.41, 0.05]], 0.56, 0.03, y0), paint)
  rigid(rig, 'Spine', profileSolid([[0.2, 0.22], [0.02, 0.4], [-0.27, 0.4], [-0.37, 0.24]], 0.47, 0.025, y0), paint)
  // Glass: the windshield (eyes in it), the rear window, the side windows.
  const ws = new THREE.PlaneGeometry(0.42, 0.25)
  rigid(rig, 'Spine', ws, glass, [0, y0 + 0.33, 0.13], [-Math.PI / 4, 0, 0])
  rigid(rig, 'Spine', new THREE.PlaneGeometry(0.4, 0.18), glass, [0, y0 + 0.335, -0.345], [-2.583, 0, 0])
  for (const x of [0.237, -0.237]) rigid(rig, 'Spine', sidePlate([[0.16, 0.25], [0.02, 0.375], [-0.25, 0.375], [-0.33, 0.26]], x, y0), glass)
  // Orange accents down the rear quarters, the dark bumper and grille, lights all round.
  for (const k of [1, -1]) {
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.008, 0.05, 0.3), trim, [k * 0.284, y0 + 0.08, -0.2])
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.008, 0.02, 0.5), trim, [k * 0.284, y0 + 0.15, 0.02])
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.11, 0.032, 0.012), lamp, [k * 0.17, y0 + 0.15, 0.425], [-0.35, 0, 0])
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.1, 0.035, 0.012), tail, [k * 0.19, y0 + 0.16, -0.446])
    rigid(rig, 'Spine', new THREE.SphereGeometry(0.028, 12, 8), dark, [k * 0.283, y0 + 0.2, 0.3])   // fender sensors
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.05, 0.035, 0.065), dark, [k * 0.3, y0 + 0.235, 0.17])   // mirrors (the arms come out of them)
  }
  const brights = [1, -1].map((k) => { const m = rigid(rig, 'Spine', new THREE.BoxGeometry(0.115, 0.036, 0.014), bright, [k * 0.17, y0 + 0.15, 0.427], [-0.35, 0, 0]); m.visible = false; m.castShadow = false; return m })
  rigid(rig, 'Spine', new THREE.BoxGeometry(0.42, 0.05, 0.02), dark, [0, y0 + 0.055, 0.438])
  const hazards: THREE.Mesh[] = []
  for (const [x, z] of [[0.27, 0.39], [-0.27, 0.39], [0.27, -0.41], [-0.27, -0.41]]) {
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.04, 0.025, 0.04), hazOff, [x, y0 + 0.11, z])
    const on = rigid(rig, 'Spine', new THREE.BoxGeometry(0.046, 0.03, 0.046), hazOn, [x, y0 + 0.11, z])
    on.visible = false; on.castShadow = false
    hazards.push(on)
  }
  // The roof sensor: a dark base and a spinning lidar head with a lens band and a fin to see it turn.
  rigid(rig, 'Spine', new THREE.CylinderGeometry(0.09, 0.1, 0.05, 24), dark, [0, y0 + 0.45, -0.13])
  const spinner = pivot(rig, 'Spine', [0, y0 + 0.5, -0.13])
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.07, 24), sensorM)
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.078, 0.078, 0.028, 24, 1, true), lens)
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05, 0.03), sensorM)
  fin.position.set(0, 0.01, 0.08)
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, 0.02, 24), dark)
  cap.position.y = 0.045
  for (const m of [head, band, fin, cap]) { m.castShadow = true; spinner.add(m) }
  // Its own wheels, tucked up flat under the body (it rides the board instead).
  for (const [x, z] of [[0.2, 0.26], [-0.2, 0.26], [0.2, -0.27], [-0.2, -0.27]]) {
    rigid(rig, 'Hips', new THREE.TorusGeometry(0.055, 0.03, 10, 20), tire, [x, y0 - 0.03, z], [Math.PI / 2, 0, 0])
    rigid(rig, 'Hips', new THREE.CylinderGeometry(0.05, 0.05, 0.02, 16), hub, [x, y0 - 0.03, z])
  }
  // Robot arms out of the mirrors, struts for legs, white gloves, tyres for shoes.
  limbs(rig, armM, armM, { arm: [0.022, 0.02, 0.018], leg: [0.034, 0.03, 0.028] }, true)
  for (const side of ['Left', 'Right']) {
    hand(rig, side, glove, { r: 0.013, palm: [1, 0.034, 0.05], fingers: 4 })
    rigid(rig, `${side}Hand`, new THREE.TorusGeometry(0.032, 0.012, 8, 16), glove, rig.at(`${side}Hand`).toArray() as V3, [0, Math.PI / 2, 0])
    shoe(rig, side, tire, dark, { len: 0.22, w: 0.1, h: 0.09, puffy: 1.1 })
  }
  // The cone on the hood: someone always cones it when it stops somewhere silly (the bail); the
  // Coned outfit keeps one.
  const cone = pivot(rig, 'Spine', [0, y0 + 0.245, 0.3], [0.39, 0, 0])
  const parts: [THREE.BufferGeometry, THREE.Material, number][] = [[new THREE.BoxGeometry(0.12, 0.015, 0.12), coneM, 0.0075], [new THREE.ConeGeometry(0.048, 0.17, 16), coneM, 0.09], [new THREE.CylinderGeometry(0.03, 0.036, 0.03, 16, 1, true), white, 0.08]]
  for (const [g, m, y] of parts) { const p = new THREE.Mesh(g, m); p.position.y = y; p.castShadow = true; cone.add(p) }
  const coned = has(s, 'cone')
  cone.visible = coned
  const face = new Face(rig, {
    bone: 'Spine',
    eyes: { at: [0.088, y0 + 0.345, 0.135], r: 0.058, squash: [1, 1, 0.55], white: '#ffffff', iris: '#111214', irisR: 0.034, pupilR: 0.022 },
    lids: { color: C(s, 'body') },
    brows: { color: C(s, 'brow'), size: [0.065, 0.013, 0.01], up: 0.075 },
    mouth: { at: [0, y0 + 0.262, 0.212], size: [0.13, 0.055], tilt: -0.785, colors: { line: C(s, 'brow'), inside: '#1a1c1f', teeth: '#f4f4f0', tongue: '#e15467' } },
  } satisfies FaceSpec)
  const hook = (c: HookCtx) => {
    // The lidar spins (faster in a special, the emote, when thrilled).
    spinner.rotation.y = c.ticks * (0.12 + 0.45 * Math.max(c.special, c.mood === 'ecstatic' ? 0.6 : 0))
    // Pulling over (the bail): hazards blinking. Arriving (the emote): the headlights flash.
    const haz = c.bailT >= 0 && Math.floor(c.bailT / 26) % 2 === 0
    for (const h of hazards) h.visible = haz
    const flash = c.specialId === 'emote' && c.special > 0.1 && Math.floor(c.specialT / 16) % 2 === 0
    for (const b of brights) b.visible = flash
    const k = coned ? 1 : c.bailT >= 0 ? smooth(40, 50, c.bailT) * (1 - smooth(132, 145, c.bailT)) : 0
    cone.visible = k > 0.01
    cone.scale.setScalar(Math.max(1e-3, k))
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

// The Cable Car: a little Powell St car, red below and cream above with gold pinstripes, wooden
// window frames, a destination sign, brass poles and the brass bell on the roof; the gripman's
// levers for arms, iron struts and steel wheels for legs.
function cablecar(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const wd = detailMaps(83, 3, 0.8, 0.15, 0.6)
  const paint = surface('cable car paint', { color: C(s, 'paint'), roughness: 0.35, clearcoat: 0.6, clearcoatRoughness: 0.2 })
  const cream = surface('cable car cream', { color: C(s, 'cream'), roughness: 0.45, clearcoat: 0.4 })
  const wood = surface('cable car wood', { color: C(s, 'wood'), normalMap: wd.normal, roughnessMap: wd.rough, roughness: 1, clearcoat: 0.3 })
  const roof = surface('cable car roof', { color: C(s, 'roof'), roughness: 0.8 })
  const brass = surface('brass', { color: C(s, 'brass'), roughness: 0.25, metalness: 1 })
  const gold = surface('gold leaf', { color: C(s, 'gold'), roughness: 0.3, metalness: 0.8 })
  const glass = surface('cable car glass', { color: C(s, 'glass'), roughness: 0.06, metalness: 0.2, clearcoat: 1 })
  const iron = surface('iron', { color: C(s, 'iron'), roughness: 0.6, metalness: 0.5 })
  const steel = surface('steel wheel', { color: C(s, 'steel'), roughness: 0.3, metalness: 1 })
  const lamp = surface('cable car lamp', { color: C(s, 'lamp'), emissive: C(s, 'lamp'), emissiveIntensity: 0.7, roughness: 0.2 })
  const sign = surface('destination sign', { color: 0xffffff, flat: C(s, 'cream'), map: signTex(has(s, 'california') ? 'CALIFORNIA ST' : 'POWELL & HYDE', '#f4ead2', '#1a1a1a'), roughness: 0.6 })
  const y0 = rig.at('Hips').y
  const W = 0.42, L = 0.62
  // The body: the red lower panels, the gold pinstripe, the cream window band, the roof.
  rigid(rig, 'Spine', new THREE.BoxGeometry(W, 0.26, L), paint, [0, y0 + 0.11, 0])
  rigid(rig, 'Spine', new THREE.BoxGeometry(W + 0.006, 0.012, L + 0.006), gold, [0, y0 + 0.235, 0])
  rigid(rig, 'Spine', new THREE.BoxGeometry(W + 0.006, 0.008, L + 0.006), gold, [0, y0 + 0.02, 0])
  rigid(rig, 'Spine', new THREE.BoxGeometry(W - 0.02, 0.3, L - 0.02), cream, [0, y0 + 0.39, 0])
  rigid(rig, 'Spine', new THREE.BoxGeometry(W + 0.05, 0.035, L + 0.08), roof, [0, y0 + 0.555, 0])
  rigid(rig, 'Spine', new THREE.BoxGeometry(0.26, 0.05, L), roof, [0, y0 + 0.595, 0])
  rigid(rig, 'Spine', new THREE.BoxGeometry(W + 0.1, 0.02, L - 0.04), wood, [0, y0 - 0.015, 0])   // the running boards
  // Windows: three a side and two at each end, wooden frames, dark glass (the front two hold the eyes).
  for (const k of [1, -1]) for (const z of [-0.19, 0, 0.19]) {
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.006, 0.19, 0.16), wood, [k * (W / 2 - 0.008), y0 + 0.4, z])
    rigid(rig, 'Spine', new THREE.PlaneGeometry(0.13, 0.16), glass, [k * (W / 2 - 0.004), y0 + 0.4, z], [0, k * Math.PI / 2, 0])
  }
  for (const k of [1, -1]) {
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.15, 0.19, 0.006), wood, [k * 0.09, y0 + 0.4, -(L / 2 - 0.008)])
    rigid(rig, 'Spine', new THREE.PlaneGeometry(0.12, 0.16), glass, [k * 0.09, y0 + 0.4, -(L / 2 - 0.004)], [0, Math.PI, 0])
    rigid(rig, 'Spine', new THREE.BoxGeometry(0.15, 0.19, 0.006), wood, [k * 0.09, y0 + 0.42, L / 2 - 0.008])
  }
  // The destination sign over the front windows, the headlight low on the front, brass grab poles.
  rigid(rig, 'Spine', new THREE.BoxGeometry(0.3, 0.06, 0.01), sign, [0, y0 + 0.52, L / 2 - 0.004])
  rigid(rig, 'Spine', new THREE.TorusGeometry(0.045, 0.01, 8, 20), brass, [0, y0 + 0.1, L / 2 + 0.006])
  rigid(rig, 'Spine', new THREE.CylinderGeometry(0.04, 0.04, 0.012, 20), lamp, [0, y0 + 0.1, L / 2 + 0.004], [Math.PI / 2, 0, 0])
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) rigid(rig, 'Spine', new THREE.CylinderGeometry(0.008, 0.008, 0.52, 8), brass, [x * (W / 2 + 0.03), y0 + 0.27, z * (L / 2 - 0.03)])
  // The bell, on a bracket at the front of the roof, swinging from its pivot.
  rigid(rig, 'Spine', new THREE.BoxGeometry(0.06, 0.05, 0.02), wood, [0, y0 + 0.645, 0.2])
  const bellP = pivot(rig, 'Spine', [0, y0 + 0.67, 0.2])
  const bell = new THREE.Mesh(new THREE.LatheGeometry([new THREE.Vector2(0.001, 0.0), new THREE.Vector2(0.018, -0.005), new THREE.Vector2(0.026, -0.03), new THREE.Vector2(0.034, -0.06), new THREE.Vector2(0.04, -0.07), new THREE.Vector2(0.001, -0.07)], 18), brass)
  bell.position.y = 0.065; bell.rotation.x = Math.PI; bell.castShadow = true
  bellP.add(bell)
  // The trucks underneath and a steel wheel at each corner.
  for (const z of [0.18, -0.18]) {
    rigid(rig, 'Hips', new THREE.BoxGeometry(0.3, 0.05, 0.16), iron, [0, y0 - 0.05, z])
    for (const k of [1, -1]) rigid(rig, 'Hips', new THREE.CylinderGeometry(0.045, 0.045, 0.02, 16), steel, [k * 0.16, y0 - 0.06, z], [0, 0, Math.PI / 2])
  }
  // Holiday Car: strings of lights round the roof edge and a wreath on the front.
  const lights: THREE.Mesh[] = []
  if (has(s, 'lights')) {
    const cols = ['#ff3b3b', '#4be08a', '#ffd23f', '#5aa0ff']
    const lm = cols.map((c, i) => surface(`holiday light ${i}`, { color: c, emissive: c, emissiveIntensity: 2.2, roughness: 0.3 }))
    let i = 0
    for (const [x0, z0, x1, z1] of [[-1, -1, 1, -1], [1, -1, 1, 1], [1, 1, -1, 1], [-1, 1, -1, -1]]) for (let k = 0; k < 7; k++) {
      const u = k / 7, x = (x0 + (x1 - x0) * u) * (W / 2 + 0.025), z = (z0 + (z1 - z0) * u) * (L / 2 + 0.04)
      const m = rigid(rig, 'Spine', new THREE.SphereGeometry(0.011, 8, 6), lm[i % 4], [x, y0 + 0.53, z]); m.castShadow = false; lights.push(m); i++
    }
    const wreath = surface('wreath', { color: '#2e7a3a', roughness: 0.8 })
    rigid(rig, 'Spine', new THREE.TorusGeometry(0.05, 0.016, 8, 18), wreath, [0, y0 + 0.62, L / 2 + 0.02])
    rigid(rig, 'Spine', new THREE.SphereGeometry(0.014, 8, 6), lm[0], [0, y0 + 0.575, L / 2 + 0.035])
  }
  // The gripman's levers for arms (wood, brass rings and knobs), iron struts, steel wheels for feet.
  limbs(rig, wood, iron, { arm: [0.026, 0.024, 0.022], leg: [0.034, 0.03, 0.028] }, true)
  for (const side of ['Left', 'Right']) {
    rigid(rig, `${side}ForeArm`, new THREE.TorusGeometry(0.03, 0.009, 8, 16), brass, rig.at(`${side}ForeArm`).toArray() as V3, [0, Math.PI / 2, 0])
    hand(rig, side, brass, { r: 0.012, palm: [1, 0.03, 0.045], fingers: 3 })
    shoe(rig, side, iron, steel, { len: 0.2, w: 0.1, h: 0.08 })
  }
  const face = new Face(rig, {
    bone: 'Spine',
    eyes: { at: [0.09, y0 + 0.42, L / 2 + 0.012], r: 0.052, squash: [1, 1.1, 0.55], white: '#fffdf4', iris: '#2a1a10', irisR: 0.028, pupilR: 0.015 },
    lids: { color: C(s, 'cream') },
    brows: { color: C(s, 'wood'), size: [0.06, 0.013, 0.01], up: 0.065 },
    mouth: { at: [0, y0 + 0.26, L / 2 + 0.004], size: [0.14, 0.055], colors: { line: '#3a1a12', inside: '#2a0a0c', teeth: '#fbfbf6', tongue: '#e15467' } },
  } satisfies FaceSpec)
  const hook = (c: HookCtx) => {
    // The bell swings: rung in the emote and the specials, clanging through a derail.
    const derail = c.bailT >= 0 ? smooth(8, 16, c.bailT) * (1 - smooth(90, 130, c.bailT)) : 0
    const ring = Math.max(c.special, derail)
    const t = derail > c.special ? c.bailT : c.specialT
    bellP.rotation.z = Math.sin(t * 0.55) * 0.75 * ring
    for (const [i, m] of lights.entries()) m.visible = (Math.floor(c.ticks / 22) + i) % 3 !== 0
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

// ---- The Sea Lion (a secret skater, from the Pier 39 docks), after its sticker: a sleek glossy torpedo
// leaning forward, broad in the chest and tapering down to the rear flippers, dark brown on the back
// blending to pale tan down the front; a big round head with a dog-like snout, a black nose, whiskers,
// big glossy black eyes and a cocked skipper's cap; front flippers spread wide like wings, rear
// flippers splayed on the deck. Barks (sound.json), claps, belly-flops in a splash.

function sealion(s: CharacterSpec): Draft {
  const rig = buildRig(s.rig)
  const sd = detailMaps(97, 4, 0.3, 0.08, 0.35)
  // Wet: a full clearcoat over a smooth pelt, low roughness, so it shines like the sticker.
  const wet = { normalMap: sd.normal, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.06 }
  const pelt = surface('sea lion pelt', { color: C(s, 'pelt'), ...wet })
  // The body's coat (u 0.25 faces forward on a lathe, v runs up it): the dark back, warmer brown on the
  // sides, blending into the pale tan front from the throat down to the tail, no hard edge.
  const coat = paintTex(128, (u, v) => {
    const back = rgb(C(s, 'back')), side = rgb(C(s, 'pelt')), front = rgb(C(s, 'belly'))
    const a = Math.abs(u - 0.25), around = Math.min(a, 1 - a)   // 0 at the front, 0.5 at the back
    const w = 0.12 + 0.05 * Math.sin(Math.PI * clamp01((v - 0.1) / 0.75))
    const k = smooth(w + 0.1, w - 0.05, around) * smooth(0.04, 0.2, v) * (1 - 0.35 * smooth(0.85, 1, v))
    const b = smooth(0.25, 0.48, around)
    return side.map((q, i) => mix(mix(q, back[i], b), front[i], k))
  })
  const coatM = surface('sea lion coat', { color: 0xffffff, map: coat, ...wet })
  const muzzle = surface('sea lion muzzle', { color: C(s, 'muzzle'), ...wet, roughness: 0.38 })
  const flipper = surface('flipper', { color: C(s, 'flipper'), ...wet, roughness: 0.34 })
  const nose = surface('sea lion nose', { color: C(s, 'nose'), roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05 })
  const whisker = surface('whisker', { color: C(s, 'whisker'), roughness: 0.5 })
  const glint = surface('eye glint', { color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0.6, roughness: 0.2 })
  const capM = surface('skipper cap', { color: C(s, 'cap'), roughness: 0.7 })
  const bandM = surface('cap band', { color: C(s, 'band'), roughness: 0.6 })
  const visorM = surface('cap visor', { color: C(s, 'visor'), roughness: 0.3, clearcoat: 0.6 })
  const badgeM = surface('cap badge', { color: C(s, 'badge'), roughness: 0.3, metalness: 0.9 })
  const hipsY = rig.at('Hips').y, neckY = rig.at('Neck').y, headY = rig.at('Head').y
  // The body: one smooth torpedo leaning forward, the chest broad and pushed out, tapering down and
  // back past the hips into a short tail between the rear flippers, flowing up into a thick neck.
  const prof: [number, number, number, number][] = [
    [hipsY - 0.2, 0, 0, -0.11], [hipsY - 0.175, 0.07, 0.06, -0.1], [hipsY - 0.11, 0.15, 0.14, -0.07], [hipsY, 0.205, 0.205, -0.03],
    [hipsY + 0.13, 0.24, 0.245, 0.02], [hipsY + 0.27, 0.255, 0.27, 0.07], [hipsY + 0.4, 0.235, 0.255, 0.12], [neckY - 0.06, 0.19, 0.205, 0.16],
    [neckY + 0.04, 0.15, 0.158, 0.19], [neckY + 0.13, 0.125, 0.13, 0.21],
  ]
  const body = lathe(rig, prof, ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], coatM, {
    sides: 40,
    // Breathing in for the bark and the clap: the chest swells forward.
    morphs: { swell: (p, f) => { const k = Math.sin(Math.PI * Math.min(1, Math.max(0, (f - 0.3) / 0.55))); return new THREE.Vector3(p.x * (1 + 0.05 * k), p.y, p.z + Math.max(0, p.z) * 0.15 * k) } },
  })
  // Head (scaled up by the rig's headScale): a big round crown, a dog-like snout in the pale muzzle
  // colour with fat whisker pads, the black nose on its tip, tiny ear flaps.
  const hc = new THREE.Vector3(0, headY + 0.05, 0.11)
  rigid(rig, 'Head', new THREE.SphereGeometry(0.1, 28, 20), pelt, hc.toArray() as V3, [0, 0, 0], [1, 0.95, 1])
  const sc = new THREE.Vector3(0, hc.y - 0.036, hc.z + 0.08)
  rigid(rig, 'Head', new THREE.SphereGeometry(1, 22, 16), muzzle, sc.toArray() as V3, [0.1, 0, 0], [0.064, 0.052, 0.064])
  for (const k of [1, -1]) rigid(rig, 'Head', new THREE.SphereGeometry(0.036, 16, 12), muzzle, [k * 0.03, sc.y - 0.012, sc.z + 0.036], [0, 0, 0], [1, 0.85, 0.85])
  rigid(rig, 'Head', new THREE.SphereGeometry(1, 16, 12), nose, [0, sc.y + 0.026, sc.z + 0.058], [0.25, 0, 0], [0.03, 0.018, 0.017])
  for (const k of [1, -1]) rigid(rig, 'Head', new THREE.ConeGeometry(0.01, 0.028, 8), pelt, [k * 0.088, hc.y + 0.02, hc.z - 0.03], [-0.6, 0, k * 0.9])
  // Whiskers: a fan each side off the pads, on a pivot that twitches.
  const whiskers: THREE.Object3D[] = []
  for (const k of [1, -1]) {
    const p = pivot(rig, 'Head', [k * 0.046, sc.y - 0.012, sc.z + 0.046])
    for (const [up, out, len] of [[0.012, 0.25, 0.13], [0, 0.12, 0.15], [-0.012, -0.02, 0.14], [-0.024, -0.16, 0.12]] as const) {
      const c = capsuleBetween([0, up * 0.3, 0], [k * len * Math.cos(out), up + len * Math.sin(out) * 0.5, len * 0.25], 0.002, 6)
      const m = new THREE.Mesh(c.geo, whisker)
      m.position.set(...c.mid); m.rotation.copy(c.rot); m.castShadow = false
      p.add(m)
    }
    whiskers.push(p)
  }
  // The skipper's cap, a little cocked: white crown, navy band, black visor, a gold anchor badge.
  const cap = pivot(rig, 'Head', [0, hc.y + 0.078, hc.z - 0.012], [-0.14, 0, 0.18])
  const part = (geo: THREE.BufferGeometry, mat: THREE.Material, at: V3, rot: V3 = [0, 0, 0], sc3: V3 = [1, 1, 1]) => { const m = new THREE.Mesh(geo, mat); m.position.set(...at); m.rotation.set(...rot); m.scale.set(...sc3); m.castShadow = true; cap.add(m); return m }
  part(new THREE.CylinderGeometry(0.08, 0.07, 0.046, 24), capM, [0, 0.033, 0], [0, 0, 0], [1, 1, 1.08])
  part(new THREE.CylinderGeometry(0.073, 0.073, 0.02, 24), bandM, [0, 0.0, 0], [0, 0, 0], [1, 1, 1.08])
  part(new THREE.CylinderGeometry(0.068, 0.068, 0.006, 20, 1, false, -Math.PI / 2, Math.PI), visorM, [0, -0.008, 0.044], [0.22, 0, 0], [1, 1, 0.75])
  part(new THREE.SphereGeometry(0.013, 10, 8), badgeM, [0, 0.012, 0.078], [0, 0, 0], [1.2, 1, 0.4])
  // Front flippers: a short arm in the coat's brown, then dark leather from the elbow into a long broad
  // paddle past the wrist, held out wide (style.arms) like the sticker's.
  for (const side of ['Left', 'Right']) {
    const k = side === 'Left' ? 1 : -1
    tube(rig, [`${side}Arm`, `${side}ForeArm`], [[0.07, 0.75], [0.055, 0.6]], pelt, { blend: 0.08 })
    tube(rig, [`${side}ForeArm`, `${side}Hand`], [[0.05, 0.5], [0.04, 0.4]], flipper, { blend: 0.05 })
    const w = rig.at(`${side}Hand`)
    rigid(rig, `${side}Hand`, new THREE.SphereGeometry(1, 24, 10), flipper, [w.x + k * 0.12, w.y - 0.006, w.z + 0.01], [0, k * 0.08, k * -0.08], [0.17, 0.014, 0.075])
    // Short legs hidden in the taper, and the rear flippers splayed on the deck: broad, toes fanned.
    tube(rig, [`${side}UpLeg`, `${side}Leg`], [0.075, 0.055], pelt, { blend: 0.06 })
    tube(rig, [`${side}Leg`, `${side}Foot`], [[0.042, 0.6], [0.032, 0.55]], flipper, { blend: 0.04 })
    const a = rig.at(`${side}Foot`)
    rigid(rig, `${side}Foot`, new THREE.SphereGeometry(1, 22, 10), flipper, [a.x + k * 0.016, 0.022, a.z + 0.075], [0, k * 0.16, 0], [0.085, 0.017, 0.15])
    for (let t = 0; t < 5; t++) {
      const x = a.x + k * 0.016 + (t - 2) * 0.03
      rigid(rig, `${side}Foot`, new THREE.SphereGeometry(1, 8, 6), flipper, [x, 0.03, a.z + 0.2 - Math.abs(t - 2) * 0.012], [0, 0, 0], [0.016, 0.012, 0.035])
    }
  }
  // Big glossy black eyes (the iris fills them, a white rim), each with a fixed white glint up front.
  const eyeAt: V3 = [0.05, hc.y + 0.024, hc.z + 0.066], eyeR = 0.036
  for (const k of [1, -1]) {
    rigid(rig, 'Head', new THREE.SphereGeometry(0.009, 10, 8), glint, [k * eyeAt[0] + k * 0.004, eyeAt[1] + 0.014, eyeAt[2] + eyeR * 0.82], [0, 0, 0], [1, 1, 0.6]).castShadow = false
    rigid(rig, 'Head', new THREE.SphereGeometry(0.0045, 8, 6), glint, [k * eyeAt[0] - k * 0.01, eyeAt[1] + 0.002, eyeAt[2] + eyeR * 0.86], [0, 0, 0], [1, 1, 0.6]).castShadow = false
  }
  const face = new Face(rig, {
    bone: 'Head',
    eyes: { at: eyeAt, r: eyeR, squash: [1, 1.05, 0.72], white: C(s, 'eye'), iris: C(s, 'iris'), irisR: 0.0345, pupilR: 0.027, spread: 0.45 },
    lids: { color: C(s, 'pelt') },
    brows: null,   // no brows on a sea lion: the eyes and the mouth do the talking
    mouth: { at: [0, sc.y - 0.03, sc.z + 0.046], size: [0.064, 0.03], sphere: 0.064, colors: { line: '#24150e', inside: '#4a1414', teeth: '#f6f1e6', tongue: '#e0707a' }, neutral: 'smile' },
  } satisfies FaceSpec)
  // A beach ball for the nose-balance idle, and spray: droplets for the belly flop and the specials.
  const ballTex = paintTex(64, (u) => { const band = Math.floor(u * 6) % 3; return band === 0 ? rgb('#e8462a') : band === 1 ? rgb('#f6f1e6') : rgb('#2f86c8') })
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 20, 14), surface('beach ball', { color: 0xffffff, flat: '#e8462a', map: ballTex, roughness: 0.4, clearcoat: 0.6 }))
  ball.visible = false
  rig.root.add(ball)
  const dropM = surface('spray', { color: C(s, 'spray'), roughness: 0.05, clearcoat: 1, opacity: 0.7 })
  const drops = Array.from({ length: 26 }, (_, i) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), dropM)
    m.visible = false; m.castShadow = false
    rig.root.add(m)
    const a = hash2(i, 1, 97) * Math.PI * 2, sp = 0.9 + hash2(i, 2, 97) * 1.4
    return { m, v: new THREE.Vector3(Math.cos(a) * sp, 1.2 + hash2(i, 3, 97) * 1.6, Math.sin(a) * sp), size: 0.014 + hash2(i, 4, 97) * 0.014 }
  })
  const headBone = rig.bones.get('Head')!, chest = rig.bones.get('Chest')!
  const dict = body.morphTargetDictionary!
  const hook = (c: HookCtx) => {
    // Whiskers twitch (faster when thrilled), the chest swells for the clap and when thrilled.
    const tw = Math.sin(c.ticks * (c.mood === 'ecstatic' ? 0.5 : 0.12)) * 0.08
    for (const [i, w] of whiskers.entries()) w.rotation.y = (i ? -1 : 1) * tw
    const clap = c.specialId === 'emote' ? c.special : 0
    body.morphTargetInfluences![dict.swell] = Math.max(clap * 0.8, c.mood === 'ecstatic' ? 0.5 : 0, c.landed >= 0 && c.landed < 30 ? 0.4 * (1 - c.landed / 30) : 0)
    // The nose-balance idle: the ball rides the nose, spinning, bobbing with the head.
    const nb = c.idleName === 'noseBall' ? c.idleK : 0
    ball.visible = nb > 0.3
    if (ball.visible) {
      // The nose tip in the head bone's own space (the rig's bones carry no rest rotation: rest position minus the joint).
      const tip = new THREE.Vector3(0, sc.y + 0.04 - headY, sc.z + 0.058).applyMatrix4(headBone.matrixWorld).applyMatrix4(rig.root.matrixWorld.clone().invert())
      ball.position.set(tip.x + Math.sin(c.idleT * 0.09) * 0.012, tip.y + 0.085 + Math.abs(Math.sin(c.idleT * 0.18)) * 0.02, tip.z)
      ball.rotation.set(c.idleT * 0.05, c.idleT * 0.11, 0)
      ball.scale.setScalar(Math.min(1, (nb - 0.3) / 0.4))
    }
    // Bail: a belly flop in a burst of spray that falls back; specials: spray trailing off the back.
    const T = c.bailT
    const rootInv = rig.root.matrixWorld.clone().invert()
    const at = new THREE.Vector3(0, 0, 0.15).applyMatrix4(chest.matrixWorld).applyMatrix4(rootInv)
    const trail = c.special > 0.02 && c.specialId !== 'emote' ? c.special : 0
    for (const [i, d] of drops.entries()) {
      if (T >= 22 && T < 90) {
        const t = (T - 22) / 120
        const p = at.clone().addScaledVector(d.v, t * 1.6)
        p.y += -4.9 * t * t * 2.2
        if (p.y < 0.01) p.y = 0.01
        d.m.position.copy(p)
        d.m.scale.setScalar(d.size * (1 - smooth(70, 90, T)) + 1e-4)
        d.m.visible = true
      } else if (trail > 0 && i < 12) {
        const age = ((c.specialT * 1.3 + i * 5) % 50) / 50
        d.m.position.set(d.v.x * 0.12, at.y + 0.1 - age * 0.5, -0.25 - age * 0.9)
        d.m.scale.setScalar(d.size * trail * (1 - age * 0.6))
        d.m.visible = true
      } else d.m.visible = false
    }
  }
  return { spec: s, character: new Character(rig.root), face, hook }
}

const BUILDERS: Record<string, (s: CharacterSpec) => Draft> = { can, blob, redmonster: redMonster, mascot, vampire, skeleton, techbro: techBro, karl, burrito, pigeon, robotaxi, cablecar, sealion }

/** Build the characters wanted at startup (order as in data/characters.json); "lazy" ones wait to be picked. */
export function buildRoster(data: CharactersData): Built[] {
  return data.characters.filter((s) => !s.lazy).map((s) => buildCharacter(s))
}

/** One character, in an outfit (its colour overrides and parts on top of the spec; null = default), painted with the picker's colours (tint: colour keys on top of all that). */
export function buildCharacter(base: CharacterSpec, outfitId: string | null = null, tint: Record<string, string> | null = null): Built {
  const o = outfitId ? base.outfits?.find((x) => x.id === outfitId) : undefined
  let s: CharacterSpec = o ? { ...base, colors: { ...base.colors, ...(o.colors ?? {}) }, parts: [...(base.parts ?? []), ...(o.parts ?? [])] } : base
  if (tint && Object.keys(tint).length) s = { ...s, colors: { ...s.colors, ...tint } }
  {
    const b = BUILDERS[s.id] ?? PEOPLE_BUILDERS[s.id] ?? (s.kit ? kitPerson : undefined)   // (looked up here, not at load: people.ts and kitpeople.ts import this module's parts)
    if (!b) throw new Error(`characters.json: no builder for "${s.id}"`)
    const built = b(s) as Built
    built.spec = base   // the character's own spec (bio, outfits, style); the outfit only changed how it is built
    built.outfit = o?.id ?? 'default'
    // The top of the character above its Head joint (for carrying the board on the head).
    built.character.root.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(built.character.root)
    const head = new THREE.Vector3()
    built.character.bones.get('Head')!.getWorldPosition(head)
    built.headTop = Math.max(0.02, box.max.y - head.y)
    built.character.root.name = `character:${s.id}:${built.outfit}`
    built.character.stretch = s.style.stretch
    return built
  }
}

