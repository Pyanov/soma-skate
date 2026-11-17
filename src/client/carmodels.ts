import * as THREE from 'three'
import { lampGlsl, LAMP_GLSL_DECL, lampUniforms } from './real.ts'

// The car models (assets/cars, tools/cars.ts: CC0 low-poly sedans, hatchbacks, SUVs, pickups, sports and
// muscle cars, taxis, a police car), shared by the moving traffic (traffic.ts) and the city's parked cars
// (city.ts calls ParkedCars). Each model is one geometry, its body panels flagged for paint so one instanced
// mesh paints every car its own colour. Near the camera (the preset's car detail distance) cars are these
// models; beyond it, the traffic's boxes and the city's own simple parked car.

export type CarLayout = { models: { id: string; vertices: number; offset: number }[] }
export type CarModel = { id: string; geometry: THREE.BufferGeometry }

/** The decoded models (once cars.bin has loaded) and how near a car is drawn as one (metres; 0: never). */
export const carModels: { list: CarModel[]; detail: number } = { list: [], detail: 120 }

/** cars.json's layout over cars.bin: per model, positions (f32 x3), normals (i8 x4), colours (u8 x4, the fourth the paint or lamp flag). */
export function decodeCarModels(layout: CarLayout, bin: ArrayBuffer): CarModel[] {
  return layout.models.map((M) => {
    const n = M.vertices
    const P = new Float32Array(bin, M.offset, n * 3), N = new Int8Array(bin, M.offset + n * 12, n * 4), K = new Uint8Array(bin, M.offset + n * 16, n * 4)
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(P.slice(), 3))
    geometry.setAttribute('normal', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(N.slice(), 4), 3, 0, true))   // x, y, z and a pad byte
    geometry.setAttribute('color', new THREE.BufferAttribute(K.slice(), 4, true))
    geometry.computeBoundingSphere()
    return { id: M.id, geometry }
  })
}

/**
 * The car material: the colour's flag byte mixes the instance colour into the body panels only (glass,
 * lights and tyres keep theirs); at night the street lights light it like the parked cars, and with
 * lights (moving cars) the head and rear lights glow.
 */
export function carMaterial(lights: boolean): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 })
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, lampUniforms)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLampPos; varying vec3 vLampNrm; varying float vCarLit;')
      .replace('#include <color_vertex>', `vColor = vec4(1.0);
float carFlag = 0.0;
#ifdef USE_COLOR_ALPHA
  vColor.xyz *= color.xyz; carFlag = color.w;
#endif
#ifdef USE_INSTANCING_COLOR
  vColor.xyz *= mix(vec3(1.0), instanceColor.xyz, step(0.9, carFlag));
#endif
vCarLit = ${lights ? 'carFlag > 0.6 && carFlag < 0.9 ? 2.5 : carFlag > 0.25 && carFlag < 0.6 ? 1.6 : 0.0' : '0.0'};`)
      .replace('#include <project_vertex>', `#include <project_vertex>
vec4 lampP = vec4(transformed, 1.0); vec3 lampN = objectNormal;
#ifdef USE_INSTANCING
lampP = instanceMatrix * lampP; lampN = mat3(instanceMatrix) * lampN;
#endif
vLampPos = (modelMatrix * lampP).xyz; vLampNrm = normalize(mat3(modelMatrix) * lampN);`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${LAMP_GLSL_DECL}
varying vec3 vLampPos; varying vec3 vLampNrm; varying float vCarLit;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
vec3 lampNrm = normalize(vLampNrm) * (gl_FrontFacing ? 1.0 : -1.0);
${lampGlsl('vLampPos', 'lampNrm')}
totalEmissiveRadiance += diffuseColor.rgb * vCarLit * min(glow, 1.0);`)
  }
  mat.customProgramCacheKey = () => (lights ? 'car-paint' : 'car-paint-parked')
  return mat
}

/** The models a parked car can be (no taxis or police at the kerb), by weight: picked by its place, so the same car is always the same. */
const PARKED = ['sedan', 'sedan', 'sedan', 'hatchback', 'hatchback', 'suv', 'suv', 'pickup', 'sports', 'muscle']

type Tile = { mesh: THREE.InstancedMesh; cars: number[][]; models: THREE.InstancedMesh[] | null; near: boolean }

/**
 * The city's parked cars as models near the camera (city.ts: buildCars hands over its tiles, cull calls
 * update). A tile within the car detail distance draws its cars as models, one instanced mesh per model
 * (built the first time the tile comes near), and hides its simple cars (count 0); beyond it, the city's
 * own. Rows: x, y, z, heading (compass degrees), colour index, length.
 */
export class ParkedCars {
  private tiles: Tile[]
  private context: THREE.Object3D
  private colours: THREE.Color[]
  private mat: THREE.MeshStandardMaterial | null = null

  constructor(context: THREE.Object3D, tiles: { mesh: THREE.InstancedMesh; cars: number[][] }[], colours: string[]) {
    this.context = context
    this.tiles = tiles.map((t) => ({ ...t, models: null, near: false }))
    this.colours = colours.map((c) => new THREE.Color(c))
  }

  /** The camera moved: tiles near it draw models, the rest the city's simple cars. */
  update(eye: THREE.Vector3) {
    const D = carModels.list.length ? carModels.detail : 0
    for (const t of this.tiles) {
      const s = t.mesh.boundingSphere
      const near = !!s && D > 0 && Math.hypot(s.center.x - eye.x, s.center.y - eye.y) - s.radius < D
      if (near === t.near) continue
      t.near = near
      if (near && !t.models) t.models = this.build(t)
      t.mesh.count = near ? 0 : t.cars.length
      for (const m of t.models ?? []) m.visible = near
    }
  }

  private build(t: Tile): THREE.InstancedMesh[] {
    this.mat ??= carMaterial(false)
    const ids = carModels.list.map((m) => m.id)
    const by = new Map<number, number[][]>()
    for (const c of t.cars) {
      const h = ((Math.round(c[0] * 10) * 73856093) ^ (Math.round(c[1] * 10) * 19349663)) >>> 0
      const k = ids.indexOf(PARKED[h % PARKED.length])
      if (k < 0) continue
      let a = by.get(k)
      if (!a) by.set(k, (a = []))
      a.push(c)
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1)
    const out: THREE.InstancedMesh[] = []
    for (const [k, cs] of by) {
      const im = new THREE.InstancedMesh(carModels.list[k].geometry, this.mat, cs.length)
      cs.forEach((c, i) => {
        const [x, y, zz, heading, ci, len] = c
        q.setFromAxisAngle(z, Math.PI / 2 - (heading * Math.PI) / 180)   // models run along +x; heading clockwise from north (+y)
        im.setMatrixAt(i, m.compose(p.set(x, y, zz), q, s.set(len / 4.4, 1, 1)))
        im.setColorAt(i, this.colours[ci % this.colours.length])
      })
      im.castShadow = true; im.receiveShadow = true
      im.computeBoundingSphere()
      im.name = `parked:${carModels.list[k].id}`
      this.context.add(im)
      out.push(im)
    }
    return out
  }
}
