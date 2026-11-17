// Street car models for the traffic view (src/client/traffic.ts), from the CC0 low-poly vehicle pack
// (assets/cars/src, LICENSES.md): each model merged into one mesh, turned to the game's frame (x
// forward, y left, z up, wheels on the ground), fitted to the sim's car box (4.4 m long, 1.8 m wide, at
// most 1.75 m tall: data/traffic.json), its vertices coloured by material, with a paint flag on the body
// panels (the instance colour paints them; glass, lights, tyres and trim keep theirs) and a lamp flag on
// the head and rear lights (they glow at night). Written as
// assets/cars/cars.json (layout) and cars.bin. usage: node tools/cars.ts
import { readFileSync, writeFileSync } from 'node:fs'
import * as THREE from 'three'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

const ROOT = new URL('../', import.meta.url).pathname
const SRC = `${ROOT}assets/cars/src`
/** id -> the pack's file name. */
const MODELS: Record<string, string> = { sedan: 'Sedan', hatchback: 'Hatchback', suv: 'SUV', pickup: 'Pickup', sports: 'Sports', muscle: 'Muscle', taxi: 'Taxi', police: 'Police Sedan' }
const BOX = { length: 4.4, width: 1.8, height: 1.75 }
/** Paintable: the coloured body panels (not its black and white trim; a taxi and a police car keep their colours). */
const paintable = (id: string, mat: string) => id !== 'taxi' && id !== 'police' && /^body /.test(mat) && !/black|white/.test(mat)
/** The pack's lavender lamps and rims read as toys in the real look: warm white lamps, darker red tail lights, silver rims. */
const RECOLOUR: Record<string, number> = { headlights: 0xe9e5d8, 'rear lights': 0x8c0b0b, wheels: 0xb4b8be }
/** The colour's fourth byte: 255 a painted panel, 192 a headlight, 96 a rear light, 0 the rest. */
const flagOf = (paint: boolean, mat: string) => (paint ? 255 : mat === 'headlights' ? 192 : mat === 'rear lights' ? 96 : 0)

const out: { id: string; vertices: number; size: [number, number, number]; offset: number }[] = []
const chunks: Buffer[] = []
let at = 0
for (const [id, file] of Object.entries(MODELS)) {
  const buf = readFileSync(`${SRC}/${file}.fbx`)
  const g = new FBXLoader().parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer, '')
  g.updateMatrixWorld(true)
  const parts: THREE.BufferGeometry[] = []
  let headZ = 0, tailZ = 0
  g.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as THREE.MeshPhongMaterial[]
    const src = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld)
    const pos = src.getAttribute('position'), n = pos.count
    const groups = src.groups.length ? src.groups : [{ start: 0, count: n, materialIndex: 0 }]
    const color = new Float32Array(n * 3), paint = new Float32Array(n)
    for (const gr of groups) {
      const mat = mats[gr.materialIndex ?? 0] ?? mats[0]
      const c = RECOLOUR[mat.name] !== undefined ? new THREE.Color(RECOLOUR[mat.name]) : mat.color ?? new THREE.Color(1, 1, 1), p = paintable(id, mat.name)
      for (let i = gr.start; i < gr.start + gr.count && i < n; i++) {
        color.set(p ? [1, 1, 1] : [c.r, c.g, c.b], i * 3); paint[i] = flagOf(p, mat.name)
        if (mat.name === 'headlights') headZ += pos.getZ(i)
        if (mat.name === 'rear lights') tailZ += pos.getZ(i)
      }
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', pos.clone())
    geo.setAttribute('color', new THREE.BufferAttribute(color, 3))
    geo.setAttribute('paint', new THREE.BufferAttribute(paint, 1))
    parts.push(geo)
  })
  const merged = mergeGeometries(parts)!
  // The pack is y up, its length along z: front where the headlights are. Game frame: x forward, y left, z up.
  const front = headZ > tailZ ? 1 : -1
  const p = merged.getAttribute('position') as THREE.BufferAttribute
  for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i); p.setXYZ(i, front * z, front * x, y) }
  merged.computeBoundingBox()
  const b = merged.boundingBox!, size = b.getSize(new THREE.Vector3())
  // Width: the box's, but no narrower than the pack's own shape allows (its mirrors stick out a few cm past the box).
  const sx = BOX.length / size.x, sy = Math.max(BOX.width / size.y, sx * 0.82), sz = Math.min(sx, BOX.height / size.z)
  const c = b.getCenter(new THREE.Vector3())
  for (let i = 0; i < p.count; i++) p.setXYZ(i, (p.getX(i) - c.x) * sx, (p.getY(i) - c.y) * sy, (p.getZ(i) - b.min.z) * sz)
  merged.computeVertexNormals()
  const nrm = merged.getAttribute('normal') as THREE.BufferAttribute, col = merged.getAttribute('color') as THREE.BufferAttribute, pt = merged.getAttribute('paint') as THREE.BufferAttribute
  const n = p.count
  // Per vertex: position (3 f32), normal (3 i8), colour (3 u8 sRGB), flag (u8: paint or lamp); 4-byte aligned blocks.
  const P = new Float32Array(n * 3), N = new Int8Array(n * 4), K = new Uint8Array(n * 4)
  const tmp = new THREE.Color()
  for (let i = 0; i < n; i++) {
    P.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3)
    N.set([Math.round(nrm.getX(i) * 127), Math.round(nrm.getY(i) * 127), Math.round(nrm.getZ(i) * 127), 0], i * 4)
    tmp.setRGB(col.getX(i), col.getY(i), col.getZ(i)).convertLinearToSRGB()
    K.set([Math.round(tmp.r * 255), Math.round(tmp.g * 255), Math.round(tmp.b * 255), pt.getX(i)], i * 4)
  }
  for (const a of [P, N, K]) chunks.push(Buffer.from(a.buffer, a.byteOffset, a.byteLength))
  out.push({ id, vertices: n, size: [BOX.length, BOX.width, +(size.z * sz).toFixed(3)], offset: at })
  at += P.byteLength + N.byteLength + K.byteLength
  console.log(`${id.padEnd(10)} ${n / 3} triangles, ${(size.z * sz).toFixed(2)} m tall (scale ${sx.toFixed(4)} ${sy.toFixed(4)} ${sz.toFixed(4)})`)
}
writeFileSync(`${ROOT}assets/cars/cars.bin`, Buffer.concat(chunks))
writeFileSync(`${ROOT}assets/cars/cars.json`, JSON.stringify({ _doc: 'tools/cars.ts from assets/cars/src (CC0, LICENSES.md): per model its vertex count and byte offset in cars.bin: positions (f32 x3), normals (i8 x4), colours (u8 sRGB x3 and a flag: 255 painted body, 192 headlight, 96 rear light), non-indexed; x forward, y left, z up, fitted to the sim car box.', models: out }, null, 1) + '\n')
console.log(`cars.bin ${(at / 1024).toFixed(0)} KB`)
