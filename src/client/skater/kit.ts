import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { fbm, hash2, img, normalFromHeight, roughMap, texture, type Img } from './tex.ts'

// Character kit: a skeleton built from proportions (data/characters.json) with the bone names
// the pose solver drives, and part builders on it: skinned tubes for limbs, skinned lathes for
// bodies, rigid parts carried by one bone, fur shells, face decals. Model space as the old GLB:
// +X = the character's left (the nose for a regular rider), +Y up, +Z facing; rest = T-pose,
// palms down, every bone's rest rotation the identity. Draw-only.

export type V3 = [number, number, number]

/** Proportions, metres. Lengths run joint to joint; heights are from the sole. */
export type RigSpec = {
  ankle: number            // sole to ankle joint
  shin: number; thigh: number
  hipX: number             // hip joint out from the middle
  hipDrop: number          // hip joints below the Hips bone
  toe: [number, number]    // toe joint: forward of the ankle, height
  spine: [number, number, number, number]   // Hips -> Spine -> Chest -> UpperChest -> Neck
  neck: number             // Neck -> Head
  clavicle: V3             // LeftShoulder from UpperChest
  shoulder: V3             // LeftArm joint from UpperChest
  upperArm: number; foreArm: number
  palm: number             // wrist to the finger roots
  finger: number           // one finger segment
  headScale?: number       // the head and everything on it, scaled about the neck joint
}

export type Rig = {
  root: THREE.Group
  bones: Map<string, THREE.Bone>
  at: (name: string) => THREE.Vector3              // rest position, model space
  skeleton: THREE.Skeleton
}

const SIDES: [string, number][] = [['Left', 1], ['Right', -1]]
const FINGERS: [string, number][] = [['Index', 0.022], ['Middle', 0.007], ['Ring', -0.008], ['Pinky', -0.022]]

export function buildRig(s: RigSpec, extra: { name: string; parent: string; at: V3 }[] = []): Rig {
  const pos = new Map<string, THREE.Vector3>()
  const bones = new Map<string, THREE.Bone>()
  const add = (name: string, parent: string | null, p: THREE.Vector3) => {
    const b = new THREE.Bone()
    b.name = name
    pos.set(name, p.clone())
    if (parent) { const pb = bones.get(parent)!; pb.add(b); b.position.copy(p).sub(pos.get(parent)!) } else b.position.copy(p)
    bones.set(name, b)
    return p
  }
  const hipsY = s.ankle + s.shin + s.thigh + s.hipDrop
  let y = hipsY
  add('Hips', null, new THREE.Vector3(0, y, 0))
  const chain = ['Spine', 'Chest', 'UpperChest', 'Neck']
  let prev = 'Hips'
  chain.forEach((n, i) => { y += s.spine[i]; add(n, prev, new THREE.Vector3(0, y, 0)); prev = n })
  add('Head', 'Neck', new THREE.Vector3(0, y + s.neck, 0))
  const uc = pos.get('UpperChest')!
  for (const [side, k] of SIDES) {
    const cl = add(`${side}Shoulder`, 'UpperChest', uc.clone().add(new THREE.Vector3(s.clavicle[0] * k, s.clavicle[1], s.clavicle[2])))
    const sh = add(`${side}Arm`, `${side}Shoulder`, uc.clone().add(new THREE.Vector3(s.shoulder[0] * k, s.shoulder[1], s.shoulder[2])))
    void cl
    const el = add(`${side}ForeArm`, `${side}Arm`, sh.clone().add(new THREE.Vector3(s.upperArm * k, 0, 0)))
    const wr = add(`${side}Hand`, `${side}ForeArm`, el.clone().add(new THREE.Vector3(s.foreArm * k, 0, 0)))
    for (const [f, z] of FINGERS) {
      let p = wr.clone().add(new THREE.Vector3(s.palm * k, 0, z * (s.palm / 0.08)))
      let parent = `${side}Hand`
      for (let j = 1; j <= 3; j++) {
        add(`${side}Hand${f}${j}`, parent, p)
        parent = `${side}Hand${f}${j}`
        p = p.clone().add(new THREE.Vector3(s.finger * k * (j === 1 ? 1 : 0.8), 0, 0))
      }
    }
    const t1 = add(`${side}HandThumb1`, `${side}Hand`, wr.clone().add(new THREE.Vector3(s.palm * 0.3 * k, -0.008, s.palm * 0.4)))
    add(`${side}HandThumb2`, `${side}HandThumb1`, t1.clone().add(new THREE.Vector3(s.finger * 0.8 * k, 0, s.finger * 0.5)))
    const hip = add(`${side}UpLeg`, 'Hips', new THREE.Vector3(s.hipX * k, hipsY - s.hipDrop, 0))
    const knee = add(`${side}Leg`, `${side}UpLeg`, hip.clone().add(new THREE.Vector3(0, -s.thigh, 0)))
    const ank = add(`${side}Foot`, `${side}Leg`, knee.clone().add(new THREE.Vector3(0, -s.shin, 0)))
    add(`${side}Toes`, `${side}Foot`, new THREE.Vector3(ank.x, s.toe[1], ank.z + s.toe[0]))
  }
  for (const e of extra) add(e.name, e.parent, new THREE.Vector3(...e.at))
  if (s.headScale) bones.get('Head')!.scale.setScalar(s.headScale)
  const root = new THREE.Group()
  root.add(bones.get('Hips')!)
  root.updateMatrixWorld(true)
  const list = [...bones.values()]
  const skeleton = new THREE.Skeleton(list)
  return { root, bones, at: (n) => pos.get(n)!.clone(), skeleton }
}

// ---------------------------------------------------------------- materials

export type Surface = {
  color: number | string
  map?: THREE.Texture
  normalMap?: THREE.Texture
  normalScale?: number
  roughnessMap?: THREE.Texture
  roughness?: number
  metalness?: number
  emissive?: number | string
  emissiveIntensity?: number
  clearcoat?: number
  clearcoatRoughness?: number
  sheen?: number
  sheenColor?: number | string
  transmission?: number
  thickness?: number
  alphaTest?: number
  side?: THREE.Side
  opacity?: number          // see-through below 1 (mist, tinted lenses), no depth write
  iridescence?: number      // thin-film sheen in the real look (a pigeon's neck)
  flat?: number | string    // grey/cute colour when it differs from color (e.g. a mapped part)
}

/** A flat Lambert (grey look; look.ts makes the cute toon twin from it) carrying its PBR twin. */
export function surface(name: string, s: Surface): THREE.MeshLambertMaterial {
  const see = s.opacity !== undefined && s.opacity < 1
  const l = new THREE.MeshLambertMaterial({ color: s.flat ?? (s.map ? 0xffffff : s.color), map: s.map ?? null, alphaTest: s.alphaTest ?? 0, side: s.side ?? THREE.FrontSide, emissive: s.emissive ?? 0x000000, emissiveIntensity: s.emissiveIntensity ?? 1, transparent: see, opacity: s.opacity ?? 1, depthWrite: !see })
  l.name = name
  const physical = s.clearcoat !== undefined || s.sheen !== undefined || s.transmission !== undefined || s.iridescence !== undefined
  const p: THREE.MeshPhysicalMaterialParameters = {
    color: s.color, map: s.map ?? null, normalMap: s.normalMap ?? null, roughnessMap: s.roughnessMap ?? null,
    roughness: s.roughness ?? 0.7, metalness: s.metalness ?? 0, alphaTest: s.alphaTest ?? 0, side: s.side ?? THREE.FrontSide,
    emissive: s.emissive ?? 0x000000, emissiveIntensity: s.emissiveIntensity ?? 1,
    transparent: see, opacity: s.opacity ?? 1, depthWrite: !see,
  }
  if (s.normalMap && s.normalScale) p.normalScale = new THREE.Vector2(s.normalScale, s.normalScale)
  const real = physical
    ? new THREE.MeshPhysicalMaterial({ ...p, clearcoat: s.clearcoat ?? 0, clearcoatRoughness: s.clearcoatRoughness ?? 0.1, sheen: s.sheen ?? 0, sheenColor: s.sheenColor ?? 0xffffff, sheenRoughness: 0.6, transmission: s.transmission ?? 0, thickness: s.thickness ?? 0, iridescence: s.iridescence ?? 0, iridescenceIOR: 1.5, iridescenceThicknessRange: [180, 520] })
    : new THREE.MeshStandardMaterial(p)
  real.name = name
  l.userData.real = real
  return l
}

/** Fine fabric/skin detail: a tiling normal and roughness pair from fractal noise. */
export function detailMaps(seed: number, scale: number, rough: number, spread: number, strength: number, size = 128): { normal: THREE.Texture; rough: THREE.Texture } {
  const h = new Float32Array(size * size), r = new Float32Array(size * size)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const v = fbm(x / scale, y / scale, size / scale, 3, seed) * 0.7 + hash2(x, y, seed) * 0.3
    h[y * size + x] = v
    r[y * size + x] = rough + (v - 0.5) * spread
  }
  return { normal: texture(normalFromHeight(h, size, size, strength), false), rough: texture(roughMap(r, size, size), false) }
}

// ---------------------------------------------------------------- skinned parts

type Ring = { c: THREE.Vector3; t: THREE.Vector3; r: [number, number]; w: [number, number, number, number]; i: [number, number, number, number]; v?: number }

function frameFor(t: THREE.Vector3): [THREE.Vector3, THREE.Vector3] {
  const ref = Math.abs(t.y) > 0.8 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 1, 0)
  const a = new THREE.Vector3().crossVectors(ref, t).normalize()
  const b = new THREE.Vector3().crossVectors(t, a).normalize()
  return [a, b]
}

/** Skin rings into a SkinnedMesh: each ring an ellipse across its tangent, ends capped. */
function ringsToMesh(rig: Rig, rings: Ring[], sides: number, mat: THREE.Material, caps: [boolean, boolean], uvLen = 1): THREE.SkinnedMesh {
  const P: number[] = [], UV: number[] = [], SI: number[] = [], SW: number[] = [], IDX: number[] = []
  const nr = rings.length
  for (let k = 0; k < nr; k++) {
    const g = rings[k]
    const [a, b] = frameFor(g.t)
    for (let j = 0; j <= sides; j++) {
      const th = (j / sides) * Math.PI * 2
      const p = g.c.clone().addScaledVector(a, Math.cos(th) * g.r[0]).addScaledVector(b, Math.sin(th) * g.r[1])
      P.push(p.x, p.y, p.z); UV.push(j / sides, g.v ?? (k / (nr - 1)) * uvLen)
      SI.push(...g.i); SW.push(...g.w)
    }
  }
  const row = sides + 1
  for (let k = 0; k < nr - 1; k++) for (let j = 0; j < sides; j++) {
    const a = k * row + j, b = a + 1, c = a + row, d = c + 1
    IDX.push(a, b, c, b, d, c)   // outward-facing walls
  }
  const capAt = (k: number, flip: boolean) => {
    const g = rings[k]
    const ci = P.length / 3
    P.push(g.c.x, g.c.y, g.c.z); UV.push(0.5, k === 0 ? 0 : uvLen); SI.push(...g.i); SW.push(...g.w)
    for (let j = 0; j < sides; j++) { const a = k * row + j; flip ? IDX.push(ci, a + 1, a) : IDX.push(ci, a, a + 1) }
  }
  if (caps[0]) capAt(0, true)
  if (caps[1]) capAt(nr - 1, false)
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2))
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(SI, 4))
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4))
  geo.setIndex(IDX)
  geo.computeVertexNormals()
  return bindMesh(rig, geo, mat)
}

export function bindMesh(rig: Rig, geo: THREE.BufferGeometry, mat: THREE.Material): THREE.SkinnedMesh {
  const m = new THREE.SkinnedMesh(geo, mat)
  m.castShadow = true
  m.frustumCulled = false
  rig.root.add(m)
  m.bind(rig.skeleton, new THREE.Matrix4())
  return m
}

const boneIndex = (rig: Rig, name: string) => rig.skeleton.bones.findIndex((b) => b.name === name)

/**
 * A tube along a bone chain (joint positions from the rig, or given points), radius per joint
 * (and a squash across: [r, depth ratio]). Each segment follows its bone; skin weights blend
 * over `blend` metres each side of the inner joints, so elbows and knees bend smoothly.
 */
export function tube(rig: Rig, chain: string[], radii: (number | [number, number])[], mat: THREE.Material, o: { sides?: number; per?: number; blend?: number; caps?: [boolean, boolean]; from?: V3; to?: V3; bulge?: (s: number) => number } = {}): THREE.SkinnedMesh {
  const pts = chain.map((n) => rig.at(n))
  if (o.from) pts[0] = new THREE.Vector3(...o.from)
  if (o.to) pts.push(new THREE.Vector3(...o.to))
  const segs = pts.length - 1
  const per = o.per ?? 6, blend = o.blend ?? 0.05
  const rad = (k: number) => { const r = radii[Math.min(k, radii.length - 1)]; return typeof r === 'number' ? [r, r] : [r[0], r[0] * r[1]] }
  const rings: Ring[] = []
  const total = pts.slice(1).reduce((s, p, i) => s + p.distanceTo(pts[i]), 0)
  let run = 0
  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[i + 1], len = a.distanceTo(b)
    const t = b.clone().sub(a).normalize()
    for (let k = i === 0 ? 0 : 1; k <= per; k++) {
      const s = k / per
      const c = a.clone().lerp(b, s)
      const ra = rad(i), rb = rad(i + 1)
      const bul = o.bulge ? o.bulge((run + s * len) / total) : 1
      const r: [number, number] = [(ra[0] + (rb[0] - ra[0]) * s) * bul, (ra[1] + (rb[1] - ra[1]) * s) * bul]
      // Weights: this segment's bone, blending into the previous/next bone near the joints.
      const own = boneIndex(rig, chain[Math.min(i, chain.length - 1)])
      const d0 = s * len, d1 = (1 - s) * len
      let w = 1, other = own
      if (i > 0 && d0 < blend) { other = boneIndex(rig, chain[i - 1]); w = 0.5 + 0.5 * (d0 / blend) }
      else if (i < segs - 1 && i + 1 < chain.length && d1 < blend) { other = boneIndex(rig, chain[i + 1]); w = 0.5 + 0.5 * (d1 / blend) }
      rings.push({ c, t, r, i: [own, other, 0, 0], w: [w, 1 - w, 0, 0] })
    }
    run += len
  }
  // Rounded ends: extra rings shrinking toward the axis.
  const caps = o.caps ?? [true, true]
  const roundEnd = (first: boolean) => {
    const g = first ? rings[0] : rings[rings.length - 1]
    const dir = g.t.clone().multiplyScalar(first ? -1 : 1)
    const out: Ring[] = []
    for (const f of [0.5, 0.8, 0.95]) {
      const ang = (f * Math.PI) / 2
      out.push({ c: g.c.clone().addScaledVector(dir, Math.sin(ang) * Math.min(g.r[0], g.r[1])), t: g.t, r: [g.r[0] * Math.cos(ang), g.r[1] * Math.cos(ang)], i: g.i, w: g.w })
    }
    return out
  }
  const all = [...(caps[0] ? roundEnd(true).reverse() : []), ...rings, ...(caps[1] ? roundEnd(false) : [])]
  return ringsToMesh(rig, all, o.sides ?? 14, mat, caps)
}

/**
 * A body of revolution about the vertical axis: profile rows [y, rx, rz, z offset], skinned by
 * height over the listed bones (weights interpolate between consecutive bones' heights).
 */
export function lathe(rig: Rig, profile: [number, number, number, number?][], skin: string[], mat: THREE.Material, o: { sides?: number; caps?: [boolean, boolean]; morphs?: Record<string, (p: THREE.Vector3, y01: number) => THREE.Vector3> } = {}): THREE.SkinnedMesh {
  const ys = skin.map((n) => rig.at(n).y)
  const weightAt = (y: number): [[number, number, number, number], [number, number, number, number]] => {
    if (y <= ys[0]) return [[boneIndex(rig, skin[0]), 0, 0, 0], [1, 0, 0, 0]]
    for (let k = 0; k < ys.length - 1; k++) {
      if (y <= ys[k + 1]) {
        const u = (y - ys[k]) / (ys[k + 1] - ys[k] || 1)
        const s = u * u * (3 - 2 * u)
        return [[boneIndex(rig, skin[k]), boneIndex(rig, skin[k + 1]), 0, 0], [1 - s, s, 0, 0]]
      }
    }
    return [[boneIndex(rig, skin[skin.length - 1]), 0, 0, 0], [1, 0, 0, 0]]
  }
  const rings: Ring[] = profile.map(([y, rx, rz, z]) => {
    const [i, w] = weightAt(y)
    return { c: new THREE.Vector3(0, y, z ?? 0), t: new THREE.Vector3(0, 1, 0), r: [rx, rz], i, w, v: (y - profile[0][0]) / (profile[profile.length - 1][0] - profile[0][0] || 1) }
  })
  const mesh = ringsToMesh(rig, rings, o.sides ?? 24, mat, o.caps ?? [true, true])
  if (o.morphs) {
    const pos = mesh.geometry.getAttribute('position')
    const y0 = profile[0][0], y1 = profile[profile.length - 1][0]
    const targets: THREE.BufferAttribute[] = []
    for (const f of Object.values(o.morphs)) {
      const arr = new Float32Array(pos.count * 3)
      const v = new THREE.Vector3()
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i)
        const d = f(v.clone(), (v.y - y0) / (y1 - y0)).sub(v)
        arr.set([d.x, d.y, d.z], i * 3)
      }
      targets.push(new THREE.BufferAttribute(arr, 3))
    }
    mesh.geometry.morphAttributes.position = targets
    mesh.geometry.morphTargetsRelative = true
    mesh.updateMorphTargets()
    mesh.morphTargetDictionary = Object.fromEntries(Object.keys(o.morphs).map((k, i) => [k, i]))
  }
  return mesh
}

// ---------------------------------------------------------------- rigid parts

/** A mesh carried by one bone; position and rotation given in model space at rest. */
export function rigid(rig: Rig, bone: string, geo: THREE.BufferGeometry, mat: THREE.Material, at: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat)
  const b = rig.bones.get(bone)!
  m.position.set(...at).sub(rig.at(bone))
  m.rotation.set(...rot)
  m.scale.set(...scale)
  m.castShadow = true
  b.add(m)
  return m
}

/** An empty pivot carried by a bone (for jaws, lids, brows that the face animates). */
export function pivot(rig: Rig, bone: string, at: V3, rot: V3 = [0, 0, 0]): THREE.Object3D {
  const o = new THREE.Object3D()
  o.position.set(...at).sub(rig.at(bone))
  o.rotation.set(...rot)
  rig.bones.get(bone)!.add(o)
  return o
}

/** A capsule from a to b (model space), as one geometry to hand to rigid(). */
export function capsuleBetween(a: V3, b: V3, r: number, segs = 10): { geo: THREE.BufferGeometry; mid: V3; rot: THREE.Euler } {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b)
  const geo = new THREE.CapsuleGeometry(r, Math.max(1e-4, A.distanceTo(B)), 4, segs)
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize())
  const mid = A.clone().add(B).multiplyScalar(0.5)
  return { geo, mid: [mid.x, mid.y, mid.z], rot: new THREE.Euler().setFromQuaternion(q) }
}

/** Rigid capsule along a bone chain segment (from joint a to joint b, or a point). */
export function bone2bone(rig: Rig, bone: string, a: V3 | string, b: V3 | string, r: number, mat: THREE.Material): THREE.Mesh {
  const p = (x: V3 | string): V3 => (typeof x === 'string' ? rig.at(x).toArray() as V3 : x)
  const c = capsuleBetween(p(a), p(b), r)
  return rigid(rig, bone, c.geo, mat, c.mid, [c.rot.x, c.rot.y, c.rot.z])
}

/** Merge geometries placed by matrices (for parts built from primitives). */
export function merged(parts: [THREE.BufferGeometry, THREE.Matrix4?][]): THREE.BufferGeometry {
  return mergeGeometries(parts.map(([g, m]) => {
    const x = (g.index ? g.toNonIndexed() : g.clone())
    for (const n of Object.keys(x.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') x.deleteAttribute(n)
    if (!x.getAttribute('uv')) x.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(x.getAttribute('position').count * 2), 2))
    return m ? x.applyMatrix4(m) : x
  }))
}

export const M = (pos: V3 = [0, 0, 0], rot: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) =>
  new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)), new THREE.Vector3(...scale))

// ---------------------------------------------------------------- fur

const FUR_INVISIBLE = new THREE.MeshBasicMaterial({ visible: false })
let furNoise: THREE.Texture | null = null

/** Strand mask: a dense field of round strands with random heights (R) and tone (G). */
function strands(): THREE.Texture {
  if (furNoise) return furNoise
  const N = 256
  const im = img(N, N)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const h = hash2(x, y, 77)
    const t = hash2(x, y, 91)
    im.d.set([h, t, 0, 1], (y * N + x) * 4)
  }
  furNoise = texture(im, false)
  furNoise.magFilter = THREE.NearestFilter
  furNoise.minFilter = THREE.NearestFilter
  furNoise.generateMipmaps = false
  return furNoise
}

/**
 * Shell fur over a mesh for the real look: copies pushed out along the (skinned) normal,
 * each keeping only the strands taller than its height, darker toward the roots. The
 * shells show only in the real look (their grey and cute materials are invisible).
 */
export function fur(base: THREE.Mesh, o: { color: number | string; tip?: number | string; length: number; shells?: number; density: number; roughness?: number }): THREE.Mesh[] {
  const n = o.shells ?? 8
  const out: THREE.Mesh[] = []
  const color = new THREE.Color(o.color), tip = new THREE.Color(o.tip ?? o.color)
  const skinned = (base as THREE.SkinnedMesh).isSkinnedMesh
  for (let i = 1; i <= n; i++) {
    const h = i / n
    const m = new THREE.MeshStandardMaterial({ color: color.clone().lerp(tip, h), roughness: o.roughness ?? 0.85, metalness: 0, side: THREE.FrontSide })
    m.name = `fur shell ${i}`
    const mask = strands()
    m.onBeforeCompile = (sh) => {
      sh.uniforms.furOffset = { value: o.length * h }
      sh.uniforms.furLevel = { value: h }
      sh.uniforms.furMask = { value: mask }
      sh.uniforms.furDensity = { value: o.density }
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float furOffset; varying vec2 vFurUv;')
        .replace(skinned ? '#include <skinning_vertex>' : '#include <begin_vertex>', `${skinned ? '#include <skinning_vertex>' : '#include <begin_vertex>'}\ntransformed += normalize(objectNormal) * furOffset;\nvFurUv = uv;`)
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float furLevel; uniform sampler2D furMask; uniform float furDensity; varying vec2 vFurUv;')
        .replace('#include <map_fragment>', `#include <map_fragment>
vec2 fm = texture2D(furMask, vFurUv * furDensity).rg;
if (fm.r < furLevel * 0.95 + 0.04) discard;
diffuseColor.rgb *= mix(0.55, 1.0, furLevel) * (0.85 + fm.g * 0.3);`)
    }
    m.customProgramCacheKey = () => `fur${skinned ? 's' : 'r'}`
    let shell: THREE.Mesh
    if (skinned) {
      const sk = base as THREE.SkinnedMesh
      const s = new THREE.SkinnedMesh(sk.geometry, m)
      s.bind(sk.skeleton, sk.bindMatrix)
      s.frustumCulled = false
      shell = s
      sk.parent!.add(s)
    } else {
      shell = new THREE.Mesh(base.geometry, m)
      shell.position.copy(base.position); shell.quaternion.copy(base.quaternion); shell.scale.copy(base.scale)
      base.parent!.add(shell)
    }
    shell.castShadow = false
    shell.userData.looks = { real: m, cute: FUR_INVISIBLE, grey: FUR_INVISIBLE }
    shell.material = FUR_INVISIBLE
    out.push(shell)
  }
  return out
}

/** Fur colour and normal maps for the base surface under the shells (and the grey/cute looks). */
export function furSurface(name: string, color: number, o: { tip?: number; length?: number } = {}): THREE.MeshLambertMaterial {
  const N = 128
  const a = img(N, N), h = new Float32Array(N * N), r = new Float32Array(N * N)
  const c = new THREE.Color(color), t = new THREE.Color(o.tip ?? color)
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const v = fbm(x / 3, y / 9, N / 3, 3, 5) * 0.6 + hash2(x, y, 3) * 0.4
    const k = 0.75 + v * 0.35
    const cc = c.clone().lerp(t, v)
    a.d.set([cc.r * k, cc.g * k, cc.b * k].map((q) => Math.pow(q, 1 / 2.2)).concat(1) as [number, number, number, number], (y * N + x) * 4)
    h[y * N + x] = v
    r[y * N + x] = 0.9
  }
  return surface(name, { color: 0xffffff, flat: color, map: texture(a, true), normalMap: texture(normalFromHeight(h, N, N, 4), false), roughnessMap: texture(roughMap(r, N, N), false), roughness: 1, sheen: 1, sheenColor: o.tip ?? color })
}

// ---------------------------------------------------------------- decals

/**
 * A curved patch for a face decal: w x h metres, bent round a vertical cylinder of radius
 * bendR (0 = flat), facing +Z, centred on `at`.
 */
export function patch(w: number, h: number, bendR: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, seg, 2)
  if (bendR > 0) {
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), a = x / bendR
      p.setXYZ(i, Math.sin(a) * bendR, p.getY(i), (Math.cos(a) - 1) * bendR)
    }
    g.computeVertexNormals()
  }
  return g
}

/** A patch bent round a sphere of radius R (for faces on round heads), facing +Z. */
export function spherePatch(w: number, h: number, R: number, seg = 12): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h, seg, seg)
  const p = g.getAttribute('position')
  for (let i = 0; i < p.count; i++) {
    const ax = p.getX(i) / R, ay = p.getY(i) / R
    const v = new THREE.Vector3(Math.sin(ax) * Math.cos(ay), Math.sin(ay), Math.cos(ax) * Math.cos(ay)).multiplyScalar(R)
    p.setXYZ(i, v.x, v.y, v.z - R)
  }
  g.computeVertexNormals()
  return g
}

// ---------------------------------------------------------------- heads, hands, cloth

const gauss = (x: number, s: number) => Math.exp(-(x * x) / (s * s))
const ease = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

/** One normal for the two columns a SphereGeometry's seam shares (computeVertexNormals leaves a crease there). */
function sealSeam(g: THREE.BufferGeometry, ws: number, hs: number) {
  const n = g.getAttribute('normal'), row = ws + 1, a = new THREE.Vector3(), b = new THREE.Vector3()
  for (let r = 0; r <= hs; r++) { a.fromBufferAttribute(n, r * row); b.fromBufferAttribute(n, r * row + ws); a.add(b).normalize(); n.setXYZ(r * row, a.x, a.y, a.z); n.setXYZ(r * row + ws, a.x, a.y, a.z) }
}

/**
 * A human head round its centre, face +Z: an egg of half sizes S with the jaw narrowing to the chin, the back of
 * the jaw running into the neck, a brow ridge, eye sockets the eyes sit in, cheekbones, the muzzle the mouth lies
 * on and the chin. Inside the plain egg everywhere but the brow, muzzle and chin, so hair, hats, beards and
 * glasses fitted to the egg (kitpeople.ts Shape.head) still fit. jaw: how much it narrows, chin: how far it juts.
 */
export function headGeo(S: V3 = [0.095, 0.115, 0.105], o: { jaw?: number; chin?: number; cheeks?: number; brow?: number } = {}): THREE.BufferGeometry {
  const ws = 28, hs = 20
  const g = new THREE.SphereGeometry(1, ws, hs)
  const p = g.getAttribute('position'), v = new THREE.Vector3()
  const jaw = o.jaw ?? 1, chin = o.chin ?? 1, cheeks = o.cheeks ?? 1, brow = o.brow ?? 1
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i)
    const { x, y, z } = v
    let X = x * S[0], Z = z * S[2]
    const Y = y * S[1]
    const low = ease(-0.05, -0.95, y)
    X *= 1 - 0.22 * low * jaw
    if (z < 0) Z *= 1 - 0.3 * low
    if (z < 0 && y > -0.2) Z *= 1 + 0.06 * Math.min(1, y + 0.2) * -z
    const f = Math.max(0, z)
    Z += S[2] * 0.07 * brow * gauss(y - 0.42, 0.1) * f ** 4 * gauss(x, 0.6)
    for (const k of [1, -1]) Z -= S[2] * 0.07 * gauss(x - k * 0.38, 0.14) * gauss(y - 0.17, 0.12) * f ** 2
    for (const k of [1, -1]) { const c = S[0] * 0.05 * cheeks * gauss(x - k * 0.64, 0.18) * gauss(y + 0.06, 0.16) * f; X += k * c; Z += c * 0.4 }
    Z += S[2] * 0.1 * gauss(x, 0.42) * gauss(y + 0.5, 0.18) * f ** 3
    Z += S[2] * 0.06 * chin * gauss(x, 0.24) * gauss(y + 0.85, 0.11) * f ** 2
    p.setXYZ(i, X, Y, Z)
  }
  g.computeVertexNormals()
  sealSeam(g, ws, hs)
  return g
}

/** A nose for headGeo's head (front: its half depth): bridge, tip and the two wings, round the head's centre. */
export function noseGeo(front: number, size = 1, o: { hook?: number; long?: number; y?: number } = {}): THREE.BufferGeometry {
  const k = size, L = o.long ?? 1, y = o.y ?? 0
  return merged([
    [new THREE.SphereGeometry(1, 8, 6), M([0, y - 0.012 * L, front - 0.006], [0.38 + (o.hook ?? 0), 0, 0], [0.0105 * k, 0.03 * k * L, 0.0135 * k])],
    [new THREE.SphereGeometry(1, 8, 6), M([0, y - 0.035 * L, front + 0.005 * k], [0, 0, 0], [0.011 * k, 0.01 * k, 0.0115 * k])],
    [new THREE.SphereGeometry(1, 6, 5), M([0.011 * k, y - 0.039 * L, front - 0.003], [0, 0.4, 0], [0.0075 * k, 0.007 * k, 0.0085 * k])],
    [new THREE.SphereGeometry(1, 6, 5), M([-0.011 * k, y - 0.039 * L, front - 0.003], [0, -0.4, 0], [0.0075 * k, 0.007 * k, 0.0085 * k])],
  ])
}

/** An ear on the head's side (side 1 = +X, at its centre): the flat lobe and the rolled rim round its back. */
export function earGeo(side: number, at: V3, size = 1): THREE.BufferGeometry {
  const s = size
  return merged([
    [new THREE.SphereGeometry(1, 10, 8), M(at, [0, side * 0.35, 0], [0.0075 * s, 0.024 * s, 0.016 * s])],
    [new THREE.TorusGeometry(0.0165 * s, 0.0042 * s, 5, 10, Math.PI * 1.25), M([at[0] + side * 0.003, at[1] + 0.002, at[2] - 0.002], [0, Math.PI / 2 + side * 0.35, -Math.PI * 0.62], [1, 1.45, 1])],
  ])
}

/**
 * A person's head on the Head bone round hc: headGeo with its nose and ears, one mesh in the skin. nose scales
 * the nose (0 none), ears the ears (0 none); S, jaw, chin, cheeks, brow as headGeo.
 */
export function humanHead(rig: Rig, mat: THREE.Material, hc: THREE.Vector3, o: { S?: V3; nose?: number; hook?: number; long?: number; ears?: number; jaw?: number; chin?: number; cheeks?: number; brow?: number } = {}): THREE.Mesh {
  const S = o.S ?? [0.095, 0.115, 0.105]
  const parts: [THREE.BufferGeometry, THREE.Matrix4?][] = [[headGeo(S, o)]]
  if (o.nose !== 0) parts.push([noseGeo(S[2], o.nose ?? 1, { hook: o.hook, long: o.long })])
  if (o.ears !== 0) for (const k of [1, -1]) parts.push([earGeo(k, [k * (S[0] - 0.001), 0.003, -0.006], o.ears ?? 1)])
  return rigid(rig, 'Head', merged(parts), mat, hc.toArray() as V3)
}

/** Limb profiles for tube()'s bulge (s 0 shoulder or hip .. 1 wrist or ankle): the deltoid, biceps, elbow, forearm; the thigh, knee, calf. */
export const ARM_SHAPE = (s: number) => 1 + 0.16 * gauss(s - 0.06, 0.1) + 0.05 * gauss(s - 0.3, 0.12) - 0.05 * gauss(s - 0.52, 0.06) + 0.07 * gauss(s - 0.66, 0.1) - 0.04 * gauss(s - 1, 0.08)
export const LEG_SHAPE = (s: number) => 1 + 0.1 * gauss(s - 0.12, 0.14) - 0.06 * gauss(s - 0.5, 0.06) + 0.09 * gauss(s - 0.66, 0.09) - 0.05 * gauss(s - 1, 0.08)

/** A soft block (half sizes 1): a box with its corners pulled toward the ball through them (k 0 box .. 1 ball). */
export function softBox(k = 0.5, seg = 3): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(2, 2, 2, seg, seg, seg)
  const p = g.getAttribute('position'), v = new THREE.Vector3(), s = new THREE.Vector3()
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); s.copy(v).normalize().multiplyScalar(1.15); v.lerp(s, k); p.setXYZ(i, v.x, v.y, v.z) }
  g.computeVertexNormals()
  return g
}

const FOLDS = new Map<string, { normal: THREE.Texture; rough: THREE.Texture }>()
/**
 * Cloth relief (u around a tube or body, v along it): soft creases across the length, warped so no two are alike
 * and deeper on one side (the inside of an elbow or knee), over a fine weave. Tiles both ways; made once per key.
 */
export function foldMaps(seed: number, o: { folds?: number; weave?: number; rough?: number; spread?: number; strength?: number; depth?: number } = {}): { normal: THREE.Texture; rough: THREE.Texture } {
  const key = JSON.stringify([seed, o])
  const hit = FOLDS.get(key)
  if (hit) return hit
  const N = 256, folds = o.folds ?? 6, wsc = N / (o.weave ?? 64), depth = o.depth ?? 1
  const h = new Float32Array(N * N), r = new Float32Array(N * N)
  const ph = (k: number) => hash2(k, 7, seed) * Math.PI * 2, T = Math.PI * 2
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N
    const w = 0.16 * Math.sin(T * (u + 2 * v) + ph(1)) + 0.09 * Math.sin(T * (2 * u - 3 * v) + ph(2)) + 0.05 * Math.sin(T * (3 * u + 5 * v) + ph(3))
    const c = 1 - Math.abs(Math.sin(Math.PI * (folds * v + w)))
    const side = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(T * u + ph(4)))
    const fold = Math.pow(c, 2.5) * side * depth
    const weave = fbm(x / wsc, y / wsc, N / wsc, 2, seed) * 0.6 + hash2(x, y, seed) * 0.4
    h[y * N + x] = fold * 4.5 + weave * 0.22
    r[y * N + x] = (o.rough ?? 0.85) + (weave - 0.5) * (o.spread ?? 0.12) - fold * 0.06
  }
  const out = { normal: texture(normalFromHeight(h, N, N, o.strength ?? 2.5), false), rough: texture(roughMap(r, N, N), false) }
  FOLDS.set(key, out)
  return out
}

export type { Img }
