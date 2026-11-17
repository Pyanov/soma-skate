import * as THREE from 'three'
import { Character } from './character.ts'
import { hand, shoe, skinDetail, type CharacterSpec, type Draft, type HookCtx } from './characters.ts'
import { Face, type FaceSpec } from './face.ts'
import { ARM_SHAPE, buildRig, capsuleBetween, detailMaps, foldMaps, humanHead, lathe, LEG_SHAPE, rigid, surface, tube, type Rig, type V3 } from './kit.ts'
import { hash2 } from './tex.ts'

// The open world's cast (docs/open-world.md, Cast): people of the city in the sticker family, built
// on the same kit as the skaters (big heads, googly eyes, bold colours), each with one trait you can
// read from across the street: Chad's fleece vest and tablet, Big Lou's knee brace and shop apron,
// Marisol's fisheye camera, Gloria's stamp and glasses chain, Grandma Wu's shopping cart and visor,
// Brayden's e-scooter and AirPods, Sal's gripman uniform and grip lever, Dolores's Muni uniform and
// watch. They stand at their home spots (src/client/castpeople.ts poses them); they never skate, so
// they have no board and are not in the picker (data/characters.json people). Props they hold ride
// the hand bones; props on the ground (the cart, the scooter, the lever) stand on the rig's root.

const C = (s: CharacterSpec, k: string) => s.colors[k]
type Mat = THREE.MeshLambertMaterial

/** What every person shares: the rig, the skin, where the head and the body's landmarks are. */
export type Body = { rig: Rig; skin: Mat; hc: THREE.Vector3; hipsY: number; neckY: number; chestY: number; kneeY: number; headY: number }

/** Cloth: folds across the length over the weave (kit.ts foldMaps), and a soft sheen at grazing angles so dark cloth keeps its shape. */
export const cloth = (name: string, color: string, seed: number, o: { scale?: number; sheen?: number } = {}) => {
  const d = foldMaps(seed % 4, { weave: (o.scale ?? 1.4) > 1.6 ? 44 : 64 })   // few keys: each map is two 256 px textures
  return surface(name, { color, normalMap: d.normal, roughnessMap: d.rough, roughness: 1, sheen: o.sheen ?? 0.35, sheenColor: '#ffffff' })
}

/** A seeded number in 0..1 from an id (a nose's size, an ear's): the same person always gets the same face. */
export const idHash = (id: string, k: number) => { let h = 7; for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0; return hash2(h & 0xffff, k, 13) }

/**
 * A person's body: torso (girth wide, belly pushes the front out), sleeves, legs (in trousers, or
 * shorts with bare shins, or a skirt over them), hands, shoes, neck and a round head. Clothes: the
 * top, the trousers or skirt, the shoes; the builder adds hair, the face and the trait.
 */
export function person(s: CharacterSpec, o: { top: Mat; sleeves?: Mat; pants: Mat; shoe: Mat; sole: Mat; girth?: number; belly?: number; bust?: number; shorts?: boolean; skirt?: Mat; gloves?: Mat; shoeLen?: number; seed: number }): Body {
  const rig = buildRig(s.rig)
  const sd = skinDetail(o.seed)
  const skin = surface('skin', { color: C(s, 'skin'), normalMap: sd.normal, roughnessMap: sd.rough, roughness: 1, sheen: 0.15, sheenColor: '#ffd0b0' })
  const hipsY = rig.at('Hips').y, neckY = rig.at('Neck').y, chestY = rig.at('Chest').y, kneeY = rig.at('LeftLeg').y, headY = rig.at('Head').y
  const g = o.girth ?? 1, b = o.belly ?? 0, bu = o.bust ?? 0
  lathe(rig, [
    [hipsY - 0.08, 0, 0], [hipsY - 0.06, 0.15 * g, 0.11 * g], [hipsY + 0.05, 0.16 * g + b * 0.03, 0.115 * g + b, b * 0.6],
    [hipsY + 0.2, 0.165 * g + b * 0.04, 0.11 * g + b * 0.9 + bu * 0.3, b * 0.5], [chestY + 0.06, 0.168 * g, 0.108 * g + bu, b * 0.15 + bu * 0.4],
    [neckY - 0.04, 0.17 * g, 0.105 * g], [neckY + 0.02, 0.06, 0.055], [neckY + 0.05, 0, 0],
  ], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], o.top)
  tube(rig, ['Neck', 'Head'], [0.05, 0.048], skin, { caps: [false, true] })
  const sleeve = o.sleeves ?? o.top
  for (const side of ['Left', 'Right']) {
    const k = side === 'Left' ? 1 : -1
    // Shaped limbs (shoulder, elbow, forearm; thigh, knee, calf), and the cloth's thickness where it ends: a
    // cuff at the wrist, a hem at the ankle breaking over the shoe (or at the knee of shorts).
    tube(rig, [`${side}Arm`, `${side}ForeArm`, `${side}Hand`], [0.056 * g, 0.047 * g, 0.041], sleeve, { blend: 0.05, bulge: ARM_SHAPE })
    const wr = rig.at(`${side}Hand`)
    rigid(rig, `${side}ForeArm`, new THREE.TorusGeometry(0.039, 0.008, 5, 12), sleeve, [wr.x - k * 0.012, wr.y, wr.z], [0, Math.PI / 2, 0])
    if (o.shorts) {
      tube(rig, [`${side}UpLeg`, `${side}Leg`], [0.085 * g, 0.07 * g], o.pants, { blend: 0.06 })
      tube(rig, [`${side}Leg`, `${side}Foot`], [0.056, 0.046], skin, { blend: 0.06, bulge: (s) => 1 + 0.14 * Math.exp(-(((s - 0.3) / 0.2) ** 2)) })
      const kn = rig.at(`${side}Leg`)
      rigid(rig, `${side}UpLeg`, new THREE.TorusGeometry(0.07 * g, 0.009, 5, 14), o.pants, [kn.x, kn.y + 0.012, kn.z], [Math.PI / 2, 0, 0])
    } else {
      tube(rig, [`${side}UpLeg`, `${side}Leg`, `${side}Foot`], [0.08 * g, 0.06 * Math.sqrt(g), 0.054], o.pants, { blend: 0.06, bulge: LEG_SHAPE })
      const an = rig.at(`${side}Foot`)
      if (!o.skirt) rigid(rig, `${side}Leg`, new THREE.TorusGeometry(0.054, 0.009, 5, 14), o.pants, [an.x, an.y + 0.03, an.z - 0.004], [Math.PI / 2 - 0.12, 0, 0], [1, 1.12, 1])
    }
    hand(rig, side, o.gloves ?? skin, { r: 0.0115, palm: [1, 0.024, 0.045], fingers: 4 })
    shoe(rig, side, o.shoe, o.sole, { len: o.shoeLen ?? 0.28, w: 0.105, h: 0.085, puffy: 1.05 })
  }
  // The top's hem over the trousers.
  rigid(rig, 'Hips', new THREE.TorusGeometry(1, 0.06, 5, 20), o.top, [0, hipsY - 0.056, 0], [Math.PI / 2, 0, 0], [0.153 * g, 0.114 * g, 0.12])
  if (o.skirt) lathe(rig, [[hipsY + 0.02, 0.165 * g, 0.12 * g], [hipsY - 0.15, 0.19 * g, 0.15 * g], [kneeY - 0.06, 0.22 * g, 0.17 * g]], ['Hips'], o.skirt, { caps: [false, false] })
  const hc = new THREE.Vector3(0, headY + 0.1, 0.015)
  humanHead(rig, skin, hc, { nose: 0.85 + 0.35 * idHash(s.id, 1), ears: 0.92 + 0.2 * idHash(s.id, 2), jaw: 0.8 + 0.4 * idHash(s.id, 3), chin: 0.7 + 0.6 * idHash(s.id, 4) })
  return { rig, skin, hc, hipsY, neckY, chestY, kneeY, headY }
}

/** The sticker family's face: big googly eyes, brows, the mouth decal. */
export function faceOf(B: Body, s: CharacterSpec, o: { iris: string; brow: string; neutral?: 'neutral' | 'smile' | 'grin'; eyeR?: number; lidColor?: string; browSize?: [number, number, number] }): Face {
  const hc = B.hc
  return new Face(B.rig, {
    bone: 'Head',
    eyes: { at: [0.036, hc.y + 0.02, hc.z + 0.084], r: o.eyeR ?? 0.017, iris: o.iris, irisR: 0.0095, pupilR: 0.0045 },
    lids: { color: o.lidColor ?? C(s, 'skin') },
    brows: { color: o.brow, size: o.browSize ?? [0.032, 0.008, 0.007], up: 0.031 },
    mouth: { at: [0, hc.y - 0.06, hc.z + 0.1], size: [0.07, 0.035], sphere: 0.105, colors: { line: '#5a2a1e', inside: '#3d1410', teeth: '#fbfaf3', tongue: '#cf5a62' }, neutral: o.neutral ?? 'neutral' },
  } satisfies FaceSpec)
}

/** A hair cap over the crown (front edge at the brow), optional; returns it for tweaks. */
export const hairCap = (B: Body, m: Mat, o: { front?: number; back?: number; scale?: V3; tilt?: number } = {}) =>
  rigid(B.rig, 'Head', new THREE.SphereGeometry(0.107, 24, 14, 0, Math.PI * 2, 0, Math.PI * (o.front ?? 0.5)), m, [0, B.hc.y + 0.02, B.hc.z - 0.006], [o.tilt ?? -0.18, 0, 0], o.scale ?? [0.98, 1.1, 1.08])

/** A prop on a hand: model-space position near the wrist plus an offset along the palm. */
const inHand = (B: Body, side: 'Left' | 'Right', geo: THREE.BufferGeometry, m: THREE.Material, off: V3 = [0, 0, 0], rot: V3 = [0, 0, 0]) => {
  const w = B.rig.at(`${side}Hand`), k = side === 'Left' ? 1 : -1
  return rigid(B.rig, `${side}Hand`, geo, m, [w.x + k * off[0], w.y + off[1], w.z + off[2]], rot)
}

/** Props standing on the ground beside a person (the rig root, model space), as a group to turn with it. */
export function groundProp(B: Body, at: V3, yaw = 0): THREE.Group {
  const g = new THREE.Group()
  g.position.set(...at); g.rotation.y = yaw
  B.rig.root.add(g)
  return g
}
export const add = (g: THREE.Group, geo: THREE.BufferGeometry, m: THREE.Material, at: V3, rot: V3 = [0, 0, 0]) => { const x = new THREE.Mesh(geo, m); x.position.set(...at); x.rotation.set(...rot); x.castShadow = true; g.add(x); return x }

// ---------------------------------------------------------------- Chad Vantage

/** A tech landlord: grey fleece vest over a crisp shirt, navy chinos, white sneakers, a blond side part, a tablet whose screen glows. */
function chad(s: CharacterSpec): Draft {
  const top = cloth('oxford', C(s, 'shirt'), 7, { scale: 1.5 })
  const B = person(s, { top, pants: cloth('chinos', C(s, 'pants'), 3), shoe: surface('sneaker', { color: C(s, 'shoe'), roughness: 0.6 }), sole: surface('sole', { color: '#f2f1ec', roughness: 0.7 }), seed: 41 })
  const { rig, hc, hipsY, neckY } = B
  const fleece = detailMaps(9, 2, 0.95, 0.1, 2.5)
  const vest = surface('fleece vest', { color: C(s, 'vest'), normalMap: fleece.normal, roughnessMap: fleece.rough, roughness: 1, sheen: 0.6, sheenColor: '#c9ccd2' })
  lathe(rig, [[hipsY - 0.03, 0.172, 0.13], [hipsY + 0.08, 0.176, 0.13], [hipsY + 0.25, 0.182, 0.125], [neckY - 0.05, 0.186, 0.12], [neckY - 0.0, 0.11, 0.08], [neckY + 0.04, 0.075, 0.07]], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], vest, { caps: [false, false] })
  // The vest's zip and a tiny logo patch (no brand).
  rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.008, neckY - hipsY, 0.004), surface('zip', { color: '#d8dadf', roughness: 0.3, metalness: 0.7 }), [0, (neckY + hipsY) / 2, 0.133])
  rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.04, 0.022, 0.004), surface('patch', { color: '#f4f2ec', roughness: 0.5 }), [0.07, neckY - 0.1, 0.128], [-0.1, 0.3, 0])
  const hair = surface('hair', { color: C(s, 'hair'), roughness: 0.55, sheen: 0.5, sheenColor: '#f0d9a0' })
  hairCap(B, hair)
  rigid(rig, 'Head', new THREE.SphereGeometry(0.06, 14, 10), hair, [0.03, hc.y + 0.11, hc.z + 0.04], [0, 0, -0.2], [1.25, 0.5, 1])   // the swept side part
  // The tablet in his left hand: a dark slab with a glowing dashboard.
  const slab = surface('tablet', { color: '#1b1c1f', roughness: 0.2, metalness: 0.5, clearcoat: 1 })
  const glow = surface('tablet screen', { color: C(s, 'screen'), emissive: C(s, 'screen'), emissiveIntensity: 0.9, roughness: 0.2 })
  const tab = inHand(B, 'Left', new THREE.BoxGeometry(0.17, 0.008, 0.24), slab, [0.09, -0.015, 0.03], [0, 0, 0])
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 0.21), glow)
  scr.rotation.x = -Math.PI / 2; scr.position.y = -0.0045; scr.rotation.z = Math.PI
  tab.add(scr)
  // A smartwatch on the right wrist.
  inHand(B, 'Right', new THREE.BoxGeometry(0.03, 0.012, 0.035), surface('watch', { color: '#26282c', roughness: 0.3, clearcoat: 1 }), [-0.02, 0.012, 0])
  const face = faceOf(B, s, { iris: '#3d6e9c', brow: C(s, 'hair'), neutral: 'smile' })
  return { spec: s, character: new Character(rig.root), face }
}

// ---------------------------------------------------------------- Big Lou

/** The ex-pro skate shop owner: big, bald, a grey beard, a faded band tee under a canvas shop apron, cargo shorts and a black knee brace on the right knee. */
function bigLou(s: CharacterSpec): Draft {
  const B = person(s, { top: cloth('band tee', C(s, 'tee'), 13), pants: cloth('cargo shorts', C(s, 'shorts'), 5), shoe: surface('skate shoe', { color: C(s, 'shoe'), roughness: 0.75 }), sole: surface('gum sole', { color: '#d8b98a', roughness: 0.8 }), girth: 1.28, belly: 0.09, shorts: true, shoeLen: 0.3, seed: 52 })
  const { rig, hc, hipsY, neckY, kneeY } = B
  // The apron: a canvas bib over the chest and belly, straps over the shoulders, a pocket with pens.
  const canvas = cloth('canvas apron', C(s, 'apron'), 21, { scale: 2 })
  lathe(rig, [[kneeY + 0.08, 0.205, 0.245, 0.04], [hipsY - 0.02, 0.215, 0.255, 0.06], [hipsY + 0.1, 0.214, 0.262, 0.08], [hipsY + 0.25, 0.212, 0.232, 0.05], [neckY - 0.07, 0.19, 0.17, 0.02]], ['Hips', 'Spine', 'Chest', 'UpperChest'], canvas, { caps: [false, false], sides: 24 })
  for (const k of [1, -1]) rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.03, 0.2, 0.012), canvas, [k * 0.11, neckY - 0.04, 0.03], [0.6, 0, k * 0.15])
  rigid(rig, 'Spine', new THREE.BoxGeometry(0.16, 0.1, 0.012), surface('apron pocket', { color: C(s, 'pocket'), roughness: 0.9 }), [0, hipsY + 0.12, 0.31], [-0.15, 0, 0])
  for (const [x, c] of [[-0.03, '#c8372d'], [0.0, '#1f1f1f'], [0.035, '#2a5fb8']] as const) rigid(rig, 'Spine', new THREE.CylinderGeometry(0.006, 0.006, 0.09), surface('pen', { color: c, roughness: 0.4 }), [x, hipsY + 0.17, 0.315], [-0.15, 0, 0.1])
  // The knee brace: a padded black sleeve with straps and a steel hinge each side.
  const brace = surface('knee brace', { color: C(s, 'brace'), roughness: 0.8 })
  const strap = surface('brace strap', { color: '#5a5d63', roughness: 0.7 })
  const hinge = surface('brace hinge', { color: '#c9ccd2', roughness: 0.3, metalness: 0.9 })
  const kr = rig.at('RightLeg')
  rigid(rig, 'RightLeg', new THREE.CylinderGeometry(0.083, 0.076, 0.2, 18), brace, [kr.x, kr.y - 0.02, kr.z])
  for (const dy of [0.065, -0.1]) rigid(rig, 'RightLeg', new THREE.CylinderGeometry(0.088, 0.088, 0.024, 18), strap, [kr.x, kr.y + dy, kr.z])
  for (const k of [1, -1]) rigid(rig, 'RightLeg', new THREE.BoxGeometry(0.012, 0.19, 0.025), hinge, [kr.x + k * 0.085, kr.y - 0.02, kr.z])
  // Socks pulled high with two stripes.
  for (const side of ['Left', 'Right']) { const f = rig.at(`${side}Foot`); rigid(rig, `${side}Leg`, new THREE.CylinderGeometry(0.056, 0.052, 0.14, 14), surface('sock', { color: '#f2f0ea', roughness: 0.9 }), [f.x, f.y + 0.1, f.z]) }
  // Bald on top (the skin shows), a horseshoe of grey hair round the back, a big grey beard.
  const grey = surface('grey hair', { color: C(s, 'beard'), roughness: 0.85 })
  rigid(rig, 'Head', new THREE.TorusGeometry(0.085, 0.03, 8, 24, Math.PI * 1.25), grey, [0, hc.y + 0.02, hc.z - 0.02], [Math.PI / 2 + 0.3, 0, Math.PI * 0.375 + Math.PI])
  rigid(rig, 'Head', new THREE.SphereGeometry(0.1, 20, 14, 0, Math.PI * 2, Math.PI * 0.45, Math.PI * 0.55), grey, [0, hc.y - 0.04, hc.z + 0.03], [0.25, 0, 0], [0.95, 1.05, 0.95])
  rigid(rig, 'Head', new THREE.TorusGeometry(0.03, 0.009, 6, 16, Math.PI), grey, [0, hc.y - 0.035, hc.z + 0.104], [0, 0, Math.PI])   // the moustache over the mouth
  const face = faceOf(B, s, { iris: '#5a3d2a', brow: C(s, 'beard'), neutral: 'grin', browSize: [0.036, 0.011, 0.008] })
  return { spec: s, character: new Character(rig.root), face }
}

// ---------------------------------------------------------------- Marisol

/** The filmer: a backwards cap, a red hoodie, baggy jeans, a long ponytail, and the VX-style camera with its huge fisheye always up. */
function marisol(s: CharacterSpec): Draft {
  const B = person(s, { top: cloth('hoodie', C(s, 'hoodie'), 17, { scale: 1.8 }), pants: cloth('baggy jeans', C(s, 'jeans'), 4), shoe: surface('skate shoe', { color: C(s, 'shoe'), roughness: 0.7 }), sole: surface('sole', { color: '#ecebe6', roughness: 0.7 }), girth: 1.05, seed: 63 })
  const { rig, hc, neckY } = B
  // The hood bunched behind the neck, the front pocket, drawstrings.
  const hood = cloth('hood', C(s, 'hoodie'), 18, { scale: 1.8 })
  rigid(rig, 'UpperChest', new THREE.TorusGeometry(0.09, 0.04, 10, 20), hood, [0, neckY + 0.01, -0.03], [Math.PI / 2 - 0.4, 0, 0], [1.1, 1, 1])
  for (const k of [1, -1]) rigid(rig, 'UpperChest', new THREE.CylinderGeometry(0.004, 0.004, 0.12), surface('drawstring', { color: '#f2f0ea', roughness: 0.8 }), [k * 0.035, neckY - 0.08, 0.115], [0.1, 0, 0])
  const hair = surface('dark hair', { color: C(s, 'hair'), roughness: 0.5, sheen: 0.4, sheenColor: '#806040' })
  hairCap(B, hair)
  // The ponytail through the cap's strap, down the back.
  const tail = capsuleBetween([0, hc.y + 0.05, hc.z - 0.1], [0, hc.y - 0.12, hc.z - 0.16], 0.03)
  rigid(rig, 'Head', tail.geo, hair, tail.mid, [tail.rot.x, tail.rot.y, tail.rot.z])
  // The cap, backwards: crown and the peak over the back of the neck.
  const capM = surface('cap', { color: C(s, 'cap'), roughness: 0.8 })
  rigid(rig, 'Head', new THREE.SphereGeometry(0.112, 22, 12, 0, Math.PI * 2, 0, Math.PI * 0.42), capM, [0, hc.y + 0.035, hc.z - 0.005], [-0.12, 0, 0], [1, 1.02, 1.06])
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.075, 0.075, 0.012, 16, 1, false, -Math.PI / 2, Math.PI), capM, [0, hc.y + 0.045, hc.z - 0.1], [0.25, Math.PI, 0], [1.1, 1, 1])
  // The camera in her right hand: a black body, the handle on top with the mic, the fisheye's huge glass dome, a red tally light.
  const black = surface('camera body', { color: '#1d1e21', roughness: 0.45 })
  const glass = surface('fisheye glass', { color: '#2a3a52', roughness: 0.02, metalness: 0.4, clearcoat: 1 })
  const ring = surface('lens ring', { color: '#111214', roughness: 0.35, metalness: 0.5 })
  const cam = inHand(B, 'Right', new THREE.BoxGeometry(0.11, 0.13, 0.24), black, [0.06, 0.06, 0.04])
  const part = (geo: THREE.BufferGeometry, m: THREE.Material, at: V3, rot: V3 = [0, 0, 0]) => { const x = new THREE.Mesh(geo, m); x.position.set(...at); x.rotation.set(...rot); x.castShadow = true; cam.add(x); return x }
  part(new THREE.CylinderGeometry(0.06, 0.055, 0.06, 20), ring, [0, 0, 0.14], [Math.PI / 2, 0, 0])
  part(new THREE.SphereGeometry(0.075, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), glass, [0, 0, 0.17], [Math.PI / 2, 0, 0], )
  part(new THREE.TorusGeometry(0.075, 0.012, 8, 24), ring, [0, 0, 0.17])
  part(new THREE.BoxGeometry(0.03, 0.03, 0.2), black, [0, 0.09, 0.0])
  part(new THREE.CylinderGeometry(0.012, 0.012, 0.12, 10), surface('mic', { color: '#3a3b3f', roughness: 0.8 }), [0, 0.11, 0.13], [Math.PI / 2, 0, 0])
  const tally = part(new THREE.SphereGeometry(0.009, 8, 6), surface('tally', { color: '#ff2a1a', emissive: '#ff2a1a', emissiveIntensity: 2.5, roughness: 0.3 }), [0.04, 0.07, 0.12])
  const face = faceOf(B, s, { iris: '#4a2e1a', brow: C(s, 'hair'), neutral: 'neutral' })
  // Recording: the tally light blinks.
  const hook = (c: HookCtx) => { tally.visible = Math.floor(c.ticks / 40) % 2 === 0 }
  return { spec: s, character: new Character(rig.root), face, hook }
}

// ---------------------------------------------------------------- Gloria

/** The permit clerk: a mauve cardigan over a cream blouse, a long grey skirt, a grey bun, cat-eye glasses on a beaded chain, the rubber stamp and the clipboard of forms. */
function gloria(s: CharacterSpec): Draft {
  const B = person(s, { top: cloth('blouse', C(s, 'blouse'), 23), sleeves: cloth('cardigan', C(s, 'cardigan'), 24, { scale: 2.2, sheen: 0.3 }), pants: cloth('tights', C(s, 'tights'), 26), skirt: cloth('skirt', C(s, 'skirt'), 25), shoe: surface('flats', { color: C(s, 'shoe'), roughness: 0.45, clearcoat: 0.4 }), sole: surface('sole', { color: '#2a2524', roughness: 0.6 }), shoeLen: 0.25, seed: 74 })
  const { rig, hc, hipsY, neckY } = B
  const cardigan = cloth('cardigan', C(s, 'cardigan'), 24, { scale: 2.2, sheen: 0.3 })
  lathe(rig, [[hipsY - 0.02, 0.172, 0.125], [hipsY + 0.2, 0.18, 0.13], [neckY - 0.05, 0.182, 0.118], [neckY - 0.01, 0.1, 0.075]], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], cardigan, { caps: [false, false] })
  for (const dy of [0.05, 0.14, 0.23]) rigid(rig, 'Spine', new THREE.SphereGeometry(0.009, 8, 6), surface('button', { color: '#efe8d8', roughness: 0.3 }), [0.02, hipsY + dy, 0.13])
  const hair = surface('grey hair', { color: C(s, 'hair'), roughness: 0.75 })
  hairCap(B, hair, { scale: [1, 1.12, 1.1] })
  rigid(rig, 'Head', new THREE.SphereGeometry(0.05, 14, 12), hair, [0, hc.y + 0.1, hc.z - 0.08])   // the bun
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.003, 0.003, 0.11), surface('pencil', { color: '#f2c230', roughness: 0.5 }), [0.0, hc.y + 0.11, hc.z - 0.08], [0, 0, 1.2])   // a pencil through it
  // Cat-eye glasses (frames swept up at the outer corners) and the bead chain looping from the arms down behind the neck.
  const frames = surface('cat-eye frames', { color: C(s, 'frames'), roughness: 0.3, clearcoat: 1 })
  for (const k of [1, -1]) {
    rigid(rig, 'Head', new THREE.TorusGeometry(0.023, 0.004, 6, 16), frames, [k * 0.036, hc.y + 0.02, hc.z + 0.1], [0, 0, k * 0.25], [1.25, 0.85, 1])
    rigid(rig, 'Head', new THREE.ConeGeometry(0.008, 0.02, 6), frames, [k * 0.062, hc.y + 0.035, hc.z + 0.098], [0, 0, k * -0.9])
    rigid(rig, 'Head', new THREE.BoxGeometry(0.004, 0.004, 0.09), frames, [k * 0.062, hc.y + 0.025, hc.z + 0.055])
  }
  rigid(rig, 'Head', new THREE.BoxGeometry(0.016, 0.004, 0.004), frames, [0, hc.y + 0.022, hc.z + 0.104])
  const beads = surface('bead chain', { color: C(s, 'chain'), roughness: 0.3, metalness: 0.6 })
  for (let i = 0; i < 14; i++) {
    const t = i / 13, a = Math.PI * t   // a U from one temple down under the chin line and up to the other
    rigid(rig, 'Head', new THREE.SphereGeometry(0.0055, 6, 4), beads, [Math.cos(a) * 0.075, hc.y - 0.02 - Math.sin(a) * 0.12, hc.z + 0.03 - Math.sin(a) * 0.04])
  }
  // The stamp in her right hand (a wooden knob, a red rubber foot) and the clipboard with forms in her left.
  const wood = surface('stamp handle', { color: '#8a5a32', roughness: 0.5, clearcoat: 0.3 })
  const stamp = inHand(B, 'Right', new THREE.CylinderGeometry(0.018, 0.022, 0.06, 12), wood, [0.05, -0.04, 0.0], [0, 0, Math.PI / 2])
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.012, 0.04), surface('stamp rubber', { color: '#c8372d', roughness: 0.8 }))
  foot.position.y = -0.035; foot.castShadow = true; stamp.add(foot)
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), wood); knob.position.y = 0.035; stamp.add(knob)
  const board = inHand(B, 'Left', new THREE.BoxGeometry(0.2, 0.01, 0.28), surface('clipboard', { color: '#9a6b3c', roughness: 0.6 }), [0.1, -0.02, 0.03])
  for (let i = 0; i < 3; i++) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.003, 0.22), surface('form', { color: i === 0 ? '#fbfaf3' : i === 1 ? '#f6e8a8' : '#f2c6d0', roughness: 0.9 })); p.position.set(0.004 * i, 0.007 + 0.002 * i, 0.02 - 0.004 * i); board.add(p) }   // in triplicate
  const clip = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.015, 0.025), surface('clip', { color: '#c9ccd2', roughness: 0.3, metalness: 0.9 })); clip.position.set(0, 0.012, -0.125); board.add(clip)
  const face = faceOf(B, s, { iris: '#3a2a20', brow: C(s, 'hair'), neutral: 'neutral' })
  return { spec: s, character: new Character(rig.root), face }
}

// ---------------------------------------------------------------- Grandma Wu

/** The fastest grandma in SF: small, a quilted green vest over a flowery blouse, a grey perm under a green sun visor, white sneakers, and her folding shopping cart full of groceries. */
function grandmaWu(s: CharacterSpec): Draft {
  const B = person(s, { top: cloth('flowery blouse', C(s, 'blouse'), 33), pants: cloth('trousers', C(s, 'pants'), 34), shoe: surface('sneaker', { color: C(s, 'shoe'), roughness: 0.6 }), sole: surface('sole', { color: '#e8a0b4', roughness: 0.7 }), girth: 0.95, shoeLen: 0.25, seed: 85 })
  const { rig, hc, hipsY, neckY } = B
  const quilt = detailMaps(37, 3, 0.8, 0.15, 3)
  const vest = surface('quilted vest', { color: C(s, 'vest'), normalMap: quilt.normal, roughnessMap: quilt.rough, roughness: 1, sheen: 0.4, sheenColor: '#bfe0cf' })
  lathe(rig, [[hipsY - 0.02, 0.17, 0.13], [hipsY + 0.15, 0.176, 0.135], [neckY - 0.05, 0.178, 0.125], [neckY - 0.01, 0.1, 0.08]], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], vest, { caps: [false, false] })
  // A grey perm: tight curls all over the crown.
  const perm = surface('grey perm', { color: C(s, 'hair'), roughness: 0.9 })
  hairCap(B, perm, { front: 0.48 })
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2, r = 0.085
    rigid(rig, 'Head', new THREE.SphereGeometry(0.03, 8, 6), perm, [Math.cos(a) * r, hc.y + 0.075 + Math.sin(i * 1.7) * 0.012, hc.z - 0.01 + Math.sin(a) * r])
  }
  // The visor: a green see-through brim and a white band.
  rigid(rig, 'Head', new THREE.TorusGeometry(0.104, 0.008, 6, 24), surface('visor band', { color: '#f4f4f0', roughness: 0.6 }), [0, hc.y + 0.06, hc.z], [Math.PI / 2 + 0.12, 0, 0], [1, 1.08, 1])
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.11, 0.11, 0.006, 22, 1, false, -Math.PI / 2, Math.PI), surface('visor brim', { color: C(s, 'visor'), roughness: 0.15, clearcoat: 1, opacity: 0.6 }), [0, hc.y + 0.06, hc.z + 0.07], [0.18, 0, 0], [1, 1, 0.9])
  // Big round glasses.
  const frames = surface('glasses', { color: '#3a2a24', roughness: 0.3 })
  for (const k of [1, -1]) rigid(rig, 'Head', new THREE.TorusGeometry(0.025, 0.004, 6, 18), frames, [k * 0.037, hc.y + 0.02, hc.z + 0.1])
  rigid(rig, 'Head', new THREE.BoxGeometry(0.014, 0.004, 0.004), frames, [0, hc.y + 0.022, hc.z + 0.104])
  // The cart, in front of her: two wheels, a wire basket, the handle she pushes; bok choy and oranges.
  const wire = surface('cart wire', { color: '#c9ccd2', roughness: 0.3, metalness: 0.9 })
  const tire = surface('cart wheel', { color: '#2a2b2e', roughness: 0.8 })
  const cart = groundProp(B, [0, 0, 0.5])
  add(cart, new THREE.BoxGeometry(0.36, 0.42, 0.3), surface('cart basket', { color: '#4a4f57', roughness: 0.5, metalness: 0.3, opacity: 0.55 }), [0, 0.42, 0.1])
  for (const [x, y, z, w, h, d] of [[0, 0.21, 0.1, 0.37, 0.012, 0.31], [0, 0.63, 0.1, 0.37, 0.012, 0.31]] as const) add(cart, new THREE.BoxGeometry(w, h, d), wire, [x, y, z])
  for (const k of [1, -1]) {
    add(cart, new THREE.CylinderGeometry(0.008, 0.008, 0.95), wire, [k * 0.17, 0.5, -0.1], [-0.3, 0, 0])
    add(cart, new THREE.TorusGeometry(0.075, 0.018, 8, 18), tire, [k * 0.19, 0.075, 0.16], [0, Math.PI / 2, 0])
  }
  add(cart, new THREE.CylinderGeometry(0.014, 0.014, 0.38, 10), surface('cart grip', { color: '#c8372d', roughness: 0.6 }), [0, 0.95, -0.24], [0, 0, Math.PI / 2])
  for (let i = 0; i < 3; i++) add(cart, new THREE.SphereGeometry(0.04, 10, 8), surface('orange', { color: '#f08a24', roughness: 0.6 }), [-0.08 + i * 0.07, 0.66, 0.05 + (i % 2) * 0.06])
  for (const x of [0.06, 0.11]) add(cart, new THREE.ConeGeometry(0.05, 0.22, 8), surface('bok choy', { color: '#5fae4a', roughness: 0.7 }), [x, 0.74, 0.16], [0.2, 0, -0.2])
  const face = faceOf(B, s, { iris: '#2a1a12', brow: C(s, 'hair'), neutral: 'smile', eyeR: 0.016 })
  return { spec: s, character: new Character(rig.root), face }
}

// ---------------------------------------------------------------- Brayden

/** The e-scooter bro: tall and skinny, a swoopy fringe, white AirPods, a navy quarter-zip, joggers, white sneakers, his rental-green e-scooter beside him. */
function brayden(s: CharacterSpec): Draft {
  const B = person(s, { top: cloth('quarter-zip', C(s, 'top'), 43, { scale: 1.8 }), pants: cloth('joggers', C(s, 'joggers'), 44), shoe: surface('sneaker', { color: C(s, 'shoe'), roughness: 0.55 }), sole: surface('sole', { color: '#f4f4f0', roughness: 0.6 }), girth: 0.92, shoeLen: 0.3, seed: 96 })
  const { rig, hc, neckY } = B
  rigid(rig, 'UpperChest', new THREE.CylinderGeometry(0.075, 0.08, 0.05, 18), cloth('collar', C(s, 'top'), 43), [0, neckY + 0.02, 0.0])
  rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.008, 0.14, 0.004), surface('zip', { color: '#d8dadf', roughness: 0.3, metalness: 0.8 }), [0, neckY - 0.05, 0.112])
  const hair = surface('hair', { color: C(s, 'hair'), roughness: 0.5, sheen: 0.5, sheenColor: '#a07850' })
  hairCap(B, hair)
  rigid(rig, 'Head', new THREE.SphereGeometry(0.07, 16, 10), hair, [0.02, hc.y + 0.1, hc.z + 0.06], [0.3, 0, 0.3], [1.4, 0.55, 1])   // the swoop
  const pods = surface('AirPods', { color: '#fbfbf8', roughness: 0.12, clearcoat: 1 })
  for (const k of [1, -1]) {
    rigid(rig, 'Head', new THREE.SphereGeometry(0.012, 10, 8), pods, [k * 0.1, hc.y + 0.005, hc.z])
    rigid(rig, 'Head', new THREE.CapsuleGeometry(0.0055, 0.025, 3, 8), pods, [k * 0.1, hc.y - 0.022, hc.z + 0.008])
  }
  // Sunglasses pushed up in the hair.
  for (const k of [1, -1]) rigid(rig, 'Head', new THREE.CylinderGeometry(0.022, 0.022, 0.006, 16), surface('shades', { color: '#1a1c22', roughness: 0.05, metalness: 0.5, clearcoat: 1 }), [k * 0.037, hc.y + 0.1, hc.z + 0.08], [Math.PI / 2 - 0.9, 0, 0], [1.2, 1, 0.9])
  // The scooter at his left: deck, two small wheels, the stem up to the bars, a green stem (no brand).
  const green = surface('scooter green', { color: C(s, 'scooter'), roughness: 0.4, clearcoat: 0.5 })
  const dark = surface('scooter deck', { color: '#26282c', roughness: 0.7 })
  const steel = surface('scooter steel', { color: '#c9ccd2', roughness: 0.3, metalness: 0.8 })
  const sc = groundProp(B, [0.42, 0, 0.15])
  add(sc, new THREE.BoxGeometry(0.16, 0.05, 0.8), dark, [0, 0.11, 0])
  for (const z of [0.38, -0.38]) add(sc, new THREE.CylinderGeometry(0.1, 0.1, 0.05, 16), dark, [0, 0.1, z], [0, 0, Math.PI / 2])
  add(sc, new THREE.CylinderGeometry(0.025, 0.03, 1.0, 12), green, [0, 0.62, 0.42], [-0.12, 0, 0])
  add(sc, new THREE.CylinderGeometry(0.014, 0.014, 0.5, 10), steel, [0, 1.12, 0.48], [0, 0, Math.PI / 2])
  add(sc, new THREE.BoxGeometry(0.08, 0.06, 0.04), surface('scooter screen', { color: '#101214', emissive: '#7fe0a0', emissiveIntensity: 0.4, roughness: 0.3 }), [0, 1.13, 0.5])
  const face = faceOf(B, s, { iris: '#6a8a3a', brow: C(s, 'hair'), neutral: 'grin' })
  return { spec: s, character: new Character(rig.root), face }
}

// ---------------------------------------------------------------- Sal

/** The cable car gripman: a navy uniform jacket with brass buttons, the gripman's cap, leather gloves, a big moustache, and the grip lever he leans on. */
function sal(s: CharacterSpec): Draft {
  const gloves = surface('leather gloves', { color: C(s, 'gloves'), roughness: 0.55, clearcoat: 0.2 })
  const B = person(s, { top: cloth('uniform jacket', C(s, 'jacket'), 53, { scale: 2 }), pants: cloth('uniform trousers', C(s, 'pants'), 54), shoe: surface('work shoe', { color: '#151515', roughness: 0.4, clearcoat: 0.5 }), sole: surface('sole', { color: '#151515', roughness: 0.7 }), gloves, girth: 1.12, belly: 0.04, seed: 107 })
  const { rig, hc, hipsY, neckY } = B
  const brass = surface('brass', { color: '#d8b04a', roughness: 0.25, metalness: 0.9 })
  for (const dy of [0.05, 0.13, 0.21, 0.29]) for (const k of [1, -1]) rigid(rig, 'Spine', new THREE.SphereGeometry(0.009, 8, 6), brass, [k * 0.045, hipsY + dy, 0.155])
  rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.05, 0.035, 0.005), brass, [-0.08, neckY - 0.09, 0.13], [-0.1, -0.3, 0])   // the badge
  rigid(rig, 'UpperChest', new THREE.CylinderGeometry(0.07, 0.078, 0.045, 18), cloth('collar', C(s, 'jacket'), 53), [0, neckY + 0.01, 0.005])
  // The cap: navy crown, a black peak, a brass band.
  const navy = surface('cap', { color: C(s, 'jacket'), roughness: 0.7 })
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.115, 0.105, 0.07, 22), navy, [0, hc.y + 0.085, hc.z - 0.005], [-0.08, 0, 0])
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.107, 0.107, 0.014, 22), brass, [0, hc.y + 0.06, hc.z - 0.003], [-0.08, 0, 0])
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.08, 0.08, 0.008, 18, 1, false, -Math.PI / 2, Math.PI), surface('cap peak', { color: '#141414', roughness: 0.25, clearcoat: 0.8 }), [0, hc.y + 0.052, hc.z + 0.085], [0.25, 0, 0], [1.1, 1, 1])
  // The moustache: two fat rolls under the nose line, dark grey.
  const tache = surface('moustache', { color: C(s, 'hair'), roughness: 0.85 })
  for (const k of [1, -1]) { const c = capsuleBetween([0, hc.y - 0.035, hc.z + 0.103], [k * 0.05, hc.y - 0.05, hc.z + 0.088], 0.014); rigid(rig, 'Head', c.geo, tache, c.mid, [c.rot.x, c.rot.y, c.rot.z]) }
  for (const k of [1, -1]) rigid(rig, 'Head', new THREE.SphereGeometry(0.03, 10, 8), tache, [k * 0.088, hc.y + 0.02, hc.z - 0.02], [0, 0, 0], [0.5, 1, 1])   // grey at the temples
  // The grip lever at his right: a tall steel bar with a worn wooden handle, on a slotted floor plate.
  const steel = surface('lever steel', { color: '#8a8f96', roughness: 0.35, metalness: 0.9 })
  const lev = groundProp(B, [-0.38, 0, 0.2])
  add(lev, new THREE.BoxGeometry(0.3, 0.03, 0.5), surface('floor plate', { color: '#3a3d42', roughness: 0.6, metalness: 0.5 }), [0, 0.015, 0])
  const bar = new THREE.Group(); bar.position.set(0, 0.03, 0); lev.add(bar)
  add(bar, new THREE.CylinderGeometry(0.02, 0.024, 1.05, 12), steel, [0, 0.52, 0])
  add(bar, new THREE.CylinderGeometry(0.032, 0.032, 0.16, 12), surface('lever handle', { color: '#7a4e2a', roughness: 0.5, clearcoat: 0.4 }), [0, 1.06, 0])
  lev.userData.bar = bar
  const face = faceOf(B, s, { iris: '#2a2420', brow: C(s, 'hair'), neutral: 'neutral', browSize: [0.036, 0.012, 0.008] })
  return { spec: s, character: new Character(rig.root), face }
}

// ---------------------------------------------------------------- Dolores

/** The Muni operator: a navy uniform jacket with Muni red piping, a pale blue shirt, the operator's cap, a big wristwatch she keeps checking, a travel mug. */
function dolores(s: CharacterSpec): Draft {
  const B = person(s, { top: cloth('uniform shirt', C(s, 'shirt'), 63), sleeves: cloth('uniform jacket', C(s, 'jacket'), 64, { scale: 2 }), pants: cloth('uniform trousers', C(s, 'pants'), 65), shoe: surface('work shoe', { color: '#1b1b1d', roughness: 0.45, clearcoat: 0.4 }), sole: surface('sole', { color: '#1b1b1d', roughness: 0.7 }), girth: 1.06, seed: 118 })
  const { rig, hc, hipsY, neckY } = B
  const jacket = cloth('uniform jacket', C(s, 'jacket'), 64, { scale: 2 })
  lathe(rig, [[hipsY - 0.05, 0.18, 0.135], [hipsY + 0.15, 0.183, 0.14], [neckY - 0.05, 0.186, 0.13], [neckY - 0.01, 0.1, 0.082]], ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck'], jacket, { caps: [false, false] })
  const red = surface('Muni red', { color: C(s, 'red'), roughness: 0.5 })
  for (const k of [1, -1]) rigid(rig, 'Spine', new THREE.BoxGeometry(0.008, neckY - hipsY, 0.004), red, [k * 0.03, (neckY + hipsY) / 2 - 0.03, 0.14], [-0.05, 0, k * 0.1])
  // The shoulder patch: a red roundel on the left sleeve (no logo text).
  const sh = rig.at('LeftArm')
  rigid(rig, 'LeftArm', new THREE.CylinderGeometry(0.03, 0.03, 0.006, 16), red, [sh.x + 0.05, sh.y - 0.02, sh.z], [0, 0, Math.PI / 2])
  rigid(rig, 'UpperChest', new THREE.BoxGeometry(0.05, 0.016, 0.005), surface('name badge', { color: '#e8e4da', roughness: 0.4 }), [0.08, neckY - 0.1, 0.128], [-0.1, 0.3, 0])
  // Short dark curls under the operator's cap.
  const hair = surface('dark curls', { color: C(s, 'hair'), roughness: 0.85 })
  hairCap(B, hair, { scale: [1.04, 1.14, 1.12] })
  for (let i = 0; i < 10; i++) { const a = Math.PI * 0.6 + (i / 9) * Math.PI * 0.8; rigid(rig, 'Head', new THREE.SphereGeometry(0.028, 8, 6), hair, [Math.cos(a) * 0.1, hc.y - 0.0 + Math.sin(i) * 0.01, hc.z - 0.02 + Math.sin(a) * 0.1 - 0.02]) }
  const navy = surface('operator cap', { color: C(s, 'jacket'), roughness: 0.7 })
  rigid(rig, 'Head', new THREE.SphereGeometry(0.112, 22, 10, 0, Math.PI * 2, 0, Math.PI * 0.4), navy, [0, hc.y + 0.045, hc.z - 0.005], [-0.12, 0, 0], [1.02, 1, 1.06])
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.075, 0.075, 0.01, 16, 1, false, -Math.PI / 2, Math.PI), surface('cap peak', { color: '#141414', roughness: 0.3, clearcoat: 0.6 }), [0, hc.y + 0.045, hc.z + 0.09], [0.2, 0, 0], [1.15, 1, 1])
  rigid(rig, 'Head', new THREE.CylinderGeometry(0.113, 0.113, 0.012, 22), red, [0, hc.y + 0.05, hc.z - 0.003], [-0.12, 0, 0])
  // The watch: a big face on the left wrist; the travel mug in her right hand.
  const watch = inHand(B, 'Left', new THREE.CylinderGeometry(0.022, 0.022, 0.01, 18), surface('watch face', { color: '#f4f2ea', roughness: 0.2, clearcoat: 1 }), [-0.03, 0.022, 0], [0, 0, 0])
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.008, 6, 16), surface('watch strap', { color: '#1a1a1a', roughness: 0.6 })); strap.rotation.y = Math.PI / 2; strap.position.y = -0.03; watch.add(strap)
  inHand(B, 'Right', new THREE.CylinderGeometry(0.035, 0.03, 0.16, 16), surface('travel mug', { color: C(s, 'mug'), roughness: 0.3, metalness: 0.6 }), [0.05, -0.03, 0.04])
  const face = faceOf(B, s, { iris: '#3a2418', brow: C(s, 'hair'), neutral: 'neutral' })
  return { spec: s, character: new Character(rig.root), face }
}

/** The cast's builders (data/characters.json people, by id). */
export const PEOPLE_BUILDERS: Record<string, (s: CharacterSpec) => Draft> = { chad, biglou: bigLou, marisol, gloria, grandmawu: grandmaWu, brayden, sal, dolores }
