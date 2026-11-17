import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// A cheap rig for characters seen from afar (NPC skaters): every visible part merged into one
// skinned mesh per look, on the character's own skeleton, so a hundred meshes (fingers, buttons,
// eyes) become a handful of draw calls that the same bones still pose. Rigid parts ride their bone
// with weight 1, frozen in the transform they had when baked (after the first pose, so the hooks'
// props are in their resting state); parts on pivots (the face's eyes, lids and brows) stay
// themselves so they keep moving; the mouth atlas still changes (a shared texture); morphs are baked
// in; fur shells and hidden or scaled-away parts are left out.

type Looks = { grey: THREE.Material; cute: THREE.Material; real: THREE.Material }
const ATTRS = ['position', 'normal', 'uv'] as const

/** The rest-pose skeleton to bake against: the rig's own (from a skinned part), else one made now. Call before posing. */
export function restSkeleton(root: THREE.Object3D): THREE.Skeleton {
  let found: THREE.Skeleton | null = null
  root.traverse((o) => { const s = (o as THREE.SkinnedMesh).isSkinnedMesh ? (o as THREE.SkinnedMesh).skeleton : null; if (s && !found) found = s })
  if (found) return found
  root.updateMatrixWorld(true)
  const bones: THREE.Bone[] = []
  root.traverse((o) => { if ((o as THREE.Bone).isBone) bones.push(o as THREE.Bone) })
  return new THREE.Skeleton(bones)
}

const shown = (o: THREE.Object3D, stop: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p && p !== stop; p = p.parent) if (!p.visible) return false; return true }
const furShell = (m: THREE.Mesh) => !!(m.userData.looks && (m.userData.looks.cute as THREE.Material).visible === false)

/** Position, normal and uv of a geometry (made up where missing), non-indexed, morphs applied. */
function plain(m: THREE.Mesh): THREE.BufferGeometry {
  let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()
  const inf = m.morphTargetInfluences, morphs = g.morphAttributes.position
  if (inf && morphs?.length) {
    const p = g.attributes.position as THREE.BufferAttribute
    for (let k = 0; k < morphs.length; k++) {
      if (!inf[k]) continue
      const d = morphs[k] as THREE.BufferAttribute
      for (let i = 0; i < p.count; i++) {
        if (g.morphTargetsRelative) p.setXYZ(i, p.getX(i) + d.getX(i) * inf[k], p.getY(i) + d.getY(i) * inf[k], p.getZ(i) + d.getZ(i) * inf[k])
        else p.setXYZ(i, p.getX(i) + (d.getX(i) - p.getX(i)) * inf[k], p.getY(i) + (d.getY(i) - p.getY(i)) * inf[k], p.getZ(i) + (d.getZ(i) - p.getZ(i)) * inf[k])
      }
    }
    g.computeVertexNormals()
  }
  const out = new THREE.BufferGeometry()
  const n = g.attributes.position.count
  if (!g.attributes.normal) g.computeVertexNormals()
  out.setAttribute('position', g.attributes.position.clone())
  out.setAttribute('normal', g.attributes.normal.clone())
  out.setAttribute('uv', g.attributes.uv ? g.attributes.uv.clone() : new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2))
  g = out
  return g
}

/** Transform a non-indexed geometry, keeping triangles facing out under a mirroring transform. */
function place(g: THREE.BufferGeometry, m: THREE.Matrix4) {
  g.applyMatrix4(m)
  if (m.determinant() >= 0) return
  for (const name of Object.keys(g.attributes)) {
    const a = g.attributes[name] as THREE.BufferAttribute, k = a.itemSize, arr = a.array as Float32Array
    for (let t = 0; t + 2 < a.count; t += 3) for (let c = 0; c < k; c++) { const i1 = (t + 1) * k + c, i2 = (t + 2) * k + c; const x = arr[i1]; arr[i1] = arr[i2]; arr[i2] = x }
  }
}

function skinOf(g: THREE.BufferGeometry, idx: number) {
  const n = g.attributes.position.count
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) { si[i * 4] = idx; sw[i * 4] = 1 }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4))
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4))
}

/**
 * Bake the character under root (posed once, matrices current) into skinned meshes on skel, one
 * per look. Returns them (not yet added) and the parts it could not take (they stay drawn as they are).
 */
export function bakeFarRig(root: THREE.Object3D, skel: THREE.Skeleton, one = false): { meshes: THREE.SkinnedMesh[]; kept: THREE.Mesh[] } {
  root.updateMatrixWorld(true)
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const looksOf = new Map<THREE.Material, Looks>()   // toonify gives each mesh its own looks: group by the shared original
  const kept: THREE.Mesh[] = []
  const boneIdx = new Map(skel.bones.map((b, i) => [b as THREE.Object3D, i]))
  const restWorld = skel.boneInverses.map((m) => m.clone().invert())
  // one: everything in a single mesh, each part coloured per vertex with its flat colour (patterns and maps go).
  const ONE = new THREE.MeshLambertMaterial({ vertexColors: true })
  ONE.name = 'far one'
  ONE.userData.real = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 })
  const add = (key: THREE.Material, g: THREE.BufferGeometry) => {
    if (one) {
      const c = ((looksOf.get(key)?.grey ?? key) as THREE.MeshLambertMaterial).color ?? new THREE.Color(0xcccccc), n = g.attributes.position.count, a = new Float32Array(n * 3)
      for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3)
      g.setAttribute('color', new THREE.Float32BufferAttribute(a, 3))
      key = ONE
    }
    if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(g)
  }
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material
    if (furShell(m) || !shown(m, root) || mat.visible === false) return
    const ws = new THREE.Vector3(); m.getWorldScale(ws)
    if (Math.min(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z)) < 0.05) return   // a prop scaled away (a phone, foam)
    if (Array.isArray(m.material) || (mat as THREE.MeshLambertMaterial).transparent) { kept.push(m); return }
    const looks = m.userData.looks as Looks | undefined
    const key = looks?.grey ?? mat
    if (looks && !looksOf.has(key)) looksOf.set(key, looks)
    const sk = m as THREE.SkinnedMesh
    if (sk.isSkinnedMesh) {
      if (sk.skeleton !== skel || !sk.geometry.attributes.skinIndex) { kept.push(m); return }
      const g = plain(m)
      place(g, sk.bindMatrix)
      const nonIdx = sk.geometry.index ? sk.geometry.toNonIndexed() : sk.geometry
      const si = nonIdx.attributes.skinIndex, sw = nonIdx.attributes.skinWeight
      const a = new Uint16Array(si.count * 4), w = new Float32Array(sw.count * 4)
      for (let i = 0; i < si.count; i++) for (let j = 0; j < 4; j++) { a[i * 4 + j] = si.getComponent(i, j); w[i * 4 + j] = sw.getComponent(i, j) }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(a, 4))
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4))
      add(key, g)
      return
    }
    // On a pivot (eyes, lids, brows, a jaw, the can's tab): the face animates it, so it stays itself
    // (a kit prop's group, userData.prop, holds still on its bone: baked with it).
    if (!boneIdx.has(m.parent!) && !m.parent!.userData.prop) { kept.push(m); return }
    // Rigid: ride the nearest bone, frozen where it is relative to that bone now.
    let b: THREE.Object3D | null = m.parent
    while (b && b !== root && !boneIdx.has(b)) b = b.parent
    const idx = b ? boneIdx.get(b) : undefined
    if (idx === undefined || !b) { kept.push(m); return }
    const local = b.matrixWorld.clone().invert().multiply(m.matrixWorld)
    const g = plain(m)
    place(g, restWorld[idx].clone().multiply(local))
    skinOf(g, idx)
    add(key, g)
  })
  const meshes: THREE.SkinnedMesh[] = []
  for (const [key, list] of groups) {
    const merged = mergeGeometries(list)
    if (!merged) continue
    const looks = looksOf.get(key)
    const sm = new THREE.SkinnedMesh(merged, key)
    if (looks) sm.userData.looks = looks
    sm.bind(skel, new THREE.Matrix4())
    sm.frustumCulled = false
    sm.castShadow = true
    sm.name = 'far'
    meshes.push(sm)
  }
  return { meshes, kept }
}

/** The board's parts merged into one mesh per look, in the board's own frame (wheels frozen). */
export function bakeBoard(board: THREE.Object3D): THREE.Mesh[] {
  board.updateMatrixWorld(true)
  const inv = board.matrixWorld.clone().invert()
  const groups = new Map<THREE.Material, THREE.BufferGeometry[]>()
  const looksOf = new Map<THREE.Material, Looks>()
  board.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || m.name === 'far' || !shown(m, board)) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material
    if (Array.isArray(m.material) || (mat as THREE.MeshLambertMaterial).transparent) return
    const looks = m.userData.looks as Looks | undefined
    const key = looks?.grey ?? mat
    if (looks && !looksOf.has(key)) looksOf.set(key, looks)
    const g = plain(m)
    for (const a of ATTRS) if (!g.attributes[a]) return
    place(g, inv.clone().multiply(m.matrixWorld))
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(g)
  })
  const out: THREE.Mesh[] = []
  for (const [key, list] of groups) {
    const merged = mergeGeometries(list)
    if (!merged) continue
    const looks = looksOf.get(key)
    const mesh = new THREE.Mesh(merged, key)
    if (looks) mesh.userData.looks = looks
    mesh.castShadow = true
    mesh.name = 'far'
    out.push(mesh)
  }
  return out
}

/**
 * The character under root as it stands now, as one static mesh (its own space) coloured per vertex
 * from each part's flat colour: a cast member far off on the low preset, one draw call. Skinned parts
 * are skinned on the CPU in their current pose; see-through parts and fur shells are left out.
 */
export function bakeStatue(root: THREE.Object3D): THREE.Mesh | null {
  root.updateMatrixWorld(true)
  const inv = root.matrixWorld.clone().invert()
  const parts: THREE.BufferGeometry[] = []
  const v = new THREE.Vector3()
  root.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh || m.name === 'far' || m.name === 'statue' || (m as unknown as THREE.InstancedMesh).isInstancedMesh || !shown(m, root) || furShell(m)) return
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshLambertMaterial
    if (mat.transparent || mat.visible === false) return
    const ws = new THREE.Vector3(); m.getWorldScale(ws)
    if (Math.min(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z)) < 0.05) return
    // Parts too small to see from 30 m (fingers, eyes, buttons) are left out.
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere()
    if (!(m as THREE.SkinnedMesh).isSkinnedMesh && (m.geometry.boundingSphere?.radius ?? 1) * Math.max(Math.abs(ws.x), Math.abs(ws.y), Math.abs(ws.z)) < 0.022) return
    const base = ((m.userData.looks?.grey ?? mat) as THREE.MeshLambertMaterial).color ?? new THREE.Color(0xcccccc)
    const g = plain(m)
    const P = g.attributes.position as THREE.BufferAttribute
    const sk = m as THREE.SkinnedMesh
    if (sk.isSkinnedMesh) {
      // The skinned position (bind space) of each vertex of the original, unrolled like plain().
      const src = sk.geometry.index ? sk.geometry.toNonIndexed() : sk.geometry
      const keep = sk.geometry
      sk.geometry = src
      for (let i = 0; i < P.count; i++) { sk.applyBoneTransform(i, v.fromBufferAttribute(src.attributes.position as THREE.BufferAttribute, i)); P.setXYZ(i, v.x, v.y, v.z) }
      sk.geometry = keep
    }
    place(g, inv.clone().multiply(m.matrixWorld))
    const c = new Float32Array(P.count * 3)
    for (let i = 0; i < P.count; i++) c.set([base.r, base.g, base.b], i * 3)
    g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3))
    g.deleteAttribute('normal')
    parts.push(g)
  })
  if (!parts.length) return null
  const geo = mergeGeometries(parts)
  if (!geo) return null
  geo.computeVertexNormals()
  const lam = new THREE.MeshLambertMaterial({ vertexColors: true })
  lam.name = 'statue'
  lam.userData.real = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0 })
  const mesh = new THREE.Mesh(geo, lam)
  mesh.name = 'statue'
  mesh.castShadow = true
  return mesh
}
