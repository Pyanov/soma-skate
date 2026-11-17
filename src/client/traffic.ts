import * as THREE from 'three'
import type { Thing } from '../sim/thing.ts'
import { carMaterial, carModels, decodeCarModels, type CarLayout } from './carmodels.ts'

// Moving traffic: draws the sim's cars (src/sim/game/traffic.ts, Things of kind 'car'). The sim
// drives them, yields to the skater, honks and stops its robotaxis (events honk, robotaxiStop,
// carHit); this only draws them, between ticks by their velocity, with a robotaxi's roof sensor
// spinning and its hazards blinking while the sim says they are on. Near the camera they are models
// (assets/cars, tools/cars.ts: sedans, hatchbacks, SUVs, pickups, sports cars, muscle cars, taxis, the odd
// police car; a robotaxi is a white hatchback with its roof sensor), one instanced mesh per model with
// the body panels painted per car; beyond the preset's car detail distance they are the old boxes.

/** What the view needs of a car, per tick (clips keep these). van: a drivable vehicle (src/sim/game/vehicles.ts): its type, the ground's up under it, its front wheels' angle. */
export type CarPose = { pos: { x: number; y: number; z: number }; fwd: { x: number; y: number; z: number }; vel: { x: number; y: number; z: number }; robo: boolean; paint: number; hazard: boolean; tram?: boolean; livery?: number; id?: number
  van?: { type: string; up: { x: number; y: number; z: number }; steer: number
    // A rental scooter (physics phases 31-32), for its model and its rider's standing pose:
    // rider: someone is on it; wheelie: their wheelie's balance (-1..1, the manual's); tipped: lying on its side (ditched);
    // pitch: radians the front is up about the rear wheel (0, or view.wheelieDeg + view.swingDeg x the balance in a wheelie);
    // lean: radians it leans into the turn, + to the right (atan(forward speed x yaw rate / g), within view.leanMaxDeg; 0 lying down).
    rider?: boolean; wheelie?: number; tipped?: boolean; pitch?: number; lean?: number } }

/** A scooter's look (data/vehicles.json types.scooter.scooter.view), read with the vehicle data the Traffic view fetches; these until then. */
export const scooterView = { wheelieDeg: 18, swingDeg: 7, leanMaxDeg: 28, gravity: 9.81 }

/** A scooter's view fields: someone on it, their wheelie (balance and angle), its lean, lying on its side (ditched). */
const scooterPose = (things: readonly Thing[], t: Thing) => {
  const d = t.car!.drive!
  if (!d.ride) return {}
  const V = scooterView, rad = Math.PI / 180
  const rider = d.driver >= 0 ? things.find((x) => x.id === d.driver) : undefined
  const m = rider?.manual, pitch = m ? (V.wheelieDeg + V.swingDeg * m.balance) * rad : 0
  const maxLean = V.leanMaxDeg * rad, lean = d.ride.tipped ? 0 : Math.max(-maxLean, Math.min(maxLean, Math.atan((t.car!.speed * d.yawRate) / V.gravity)))
  return { rider: !!rider, ...(m ? { wheelie: m.balance } : {}), ...(d.ride.tipped ? { tipped: true } : {}), pitch, lean }
}

export const carPoses = (things: readonly Thing[]): CarPose[] =>
  things.filter((t) => t.kind === 'car' && t.alive && t.car).map((t) => ({ id: t.id, pos: { ...t.pos }, fwd: { ...t.fwd }, vel: { ...t.vel }, robo: t.car!.robo, paint: t.car!.paint, hazard: t.car!.hazard, ...(t.car!.tram ? { tram: true, livery: t.car!.tram.roam ? 1 + (t.id % (LIVERIES.length - 1)) : 0 } : {}), ...(t.car!.drive ? { van: { type: t.car!.drive.type, up: { ...t.up }, steer: t.car!.drive.steer, ...scooterPose(things, t) } } : {}) }))

/** A vehicle type's boxes (data/vehicles.json types[].dims), as the view needs them. */
type VanDims = { body: { length: number; width: number; bottom: number; top: number }; cabin: { length: number; width: number; offset: number; top: number } }
/** Body colours of the placeholder vehicles by type (stand-ins until a vehicle type has its own model). */
const VAN_PAINT: Record<string, number> = { van: 0xe8e4da, garbage: 0x2d4f7a, scooter: 0x6f9e3c }   // the scooter's rental green, dulled into the grade

/**
 * Streetcar liveries (lower body, roof and belt): the race car in Muni's cream over red, the
 * free-roam cars after the F line's historic fleet (picked by car id): 1940s Muni green and cream,
 * Philadelphia's green and cream, Los Angeles yellow and green, Boston's orange and cream, Kansas City's blue.
 */
const LIVERIES: [number, number][] = [[0xb2262b, 0xf1e6c8], [0x2f5a3c, 0xe6dcc0], [0x3d6b45, 0xefe4c4], [0x2e5a3a, 0xe8c24a], [0xd9661f, 0xf2e8d0], [0x2f4f7a, 0xe9e2cc]]
const PAINT = [0x1d2633, 0x8a1d1d, 0xd8d8d6, 0x3a4a5c, 0x6b6f72, 0x22313f, 0xb9b5ab, 0x2f4a3a, 0x0e0e10, 0x7c2a1a]
const ROBO = 0xf2f2ef

export class Traffic {
  readonly group = new THREE.Group()
  private capacity: number
  private time = 0
  private body: THREE.InstancedMesh
  private cabin: THREE.InstancedMesh
  private wheels: THREE.InstancedMesh
  private sensor: THREE.InstancedMesh
  private hazard: THREE.InstancedMesh
  private m = new THREE.Matrix4()
  private color = new THREE.Color()

  constructor(capacity = 128) {
    this.capacity = capacity
    const bodyG = new THREE.BoxGeometry(4.4, 1.8, 0.8).translate(0, 0, 0.75)
    const cabinG = new THREE.BoxGeometry(2.4, 1.6, 0.6).translate(-0.2, 0, 1.45)
    const wheelG = new THREE.CylinderGeometry(0.34, 0.34, 1.86, 10).translate(0, 0, 0.34)   // the axle across the car (y)
    const sensorG = new THREE.CylinderGeometry(0.28, 0.32, 0.32, 12).rotateX(Math.PI / 2).translate(0, 0, 1.92)
    const hazardG = new THREE.BoxGeometry(4.5, 1.86, 0.12).translate(0, 0, 0.9)
    const mat = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.4, ...o })
    this.body = new THREE.InstancedMesh(bodyG, mat({ color: 0xffffff }), capacity)
    this.cabin = new THREE.InstancedMesh(cabinG, mat({ color: 0x15191e, roughness: 0.08, metalness: 0.9 }), capacity)
    this.wheels = new THREE.InstancedMesh(wheelG, mat({ color: 0x111111, roughness: 0.9, metalness: 0 }), capacity * 2)
    this.sensor = new THREE.InstancedMesh(sensorG, mat({ color: 0x2a2d30, roughness: 0.3 }), capacity)
    this.hazard = new THREE.InstancedMesh(hazardG, new THREE.MeshBasicMaterial({ color: 0xff8a00, transparent: true, opacity: 0.85 }), capacity)
    for (const mesh of [this.body, this.cabin, this.wheels, this.sensor]) { mesh.castShadow = true; mesh.frustumCulled = false; this.group.add(mesh) }
    this.hazard.frustumCulled = false
    this.group.add(this.hazard)
    for (let i = 0; i < capacity; i++) this.body.setColorAt(i, this.color.set(0xffffff))
    for (const mesh of [this.body, this.cabin, this.wheels, this.sensor, this.hazard]) mesh.count = 0
    // The vehicles' sizes come with their data (fetched here, like the city's signs; a van-sized box until then).
    if (typeof fetch === 'function') fetch('data/vehicles.json', { cache: 'no-store' }).then((r) => r.json()).then((d: { types?: Record<string, { dims: VanDims; stand?: boolean; scooter?: { view?: Partial<typeof scooterView> } }> }) => { for (const [k, v] of Object.entries(d.types ?? {})) { this.vanDims[k] = v.dims; if (v.stand) this.standing.add(k); if (v.scooter?.view) Object.assign(scooterView, v.scooter.view) } }).catch(() => {})
  }
  /** Drivable vehicles (car.drive in the sim): placeholder boxes of their types' sizes; a pool by type. */
  private vanDims: Record<string, VanDims> = {}
  private standing = new Set<string>(['scooter'])   // ridden standing (types[].stand): the scooter's placeholder
  private vans: THREE.Group[] = []
  private vanAt(k: number, type: string) {
    while (this.vans.length <= k) { const g = new THREE.Group(); g.visible = false; this.vans.push(g); this.group.add(g) }
    const g = this.vans[k], dims = this.vanDims[type] ?? { body: { length: 5.3, width: 2.0, bottom: 0, top: 1.25 }, cabin: { length: 4.1, width: 1.9, offset: -0.45, top: 2.45 } }
    const stand = this.standing.has(type), key = `${type}:${dims.body.length}:${dims.cabin.top}:${stand}`
    if (g.userData.key !== key) { g.clear(); if (stand) scooterModel(g, dims, VAN_PAINT[type] ?? 0xd8d4c8); else vanModel(g, dims, type); g.userData.key = key }
    return g
  }
  // ---- the models (near the camera) ----
  private models: { id: string; mesh: THREE.InstancedMesh; n: number }[] = []
  private detail = 0
  /** A model's geometry and the shared car material, for a car drawn on its own (the cast's Unit 7). */
  model(id: string): { geometry: THREE.BufferGeometry; material: THREE.Material } | null {
    const m = this.models.find((x) => x.id === id)
    return m ? { geometry: m.mesh.geometry, material: m.mesh.material as THREE.Material } : null
  }
  /**
   * The car models (assets/cars: cars.json's layout, cars.bin): one instanced mesh each, its body panels
   * painted per car (the colour's flag byte mixes the instance colour in, so glass, lights and tyres keep
   * theirs). At night (the lamps' glow) the street lights light them as they light the parked cars, and
   * the head and rear lights glow.
   */
  setModels(layout: CarLayout, bin: ArrayBuffer) {
    carModels.list = decodeCarModels(layout, bin)   // the city's parked cars use them too (carmodels.ts)
    const mat = carMaterial(true)
    for (const M of carModels.list) {
      const mesh = new THREE.InstancedMesh(M.geometry, mat, this.capacity)
      mesh.count = 0; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.capacity * 3).fill(1), 3)
      mesh.name = `car:${M.id}`
      this.models.push({ id: M.id, mesh, n: 0 })
      this.group.add(mesh)
    }
  }
  /** Quality: within this many metres of the camera a car is its model, beyond it a box (0: boxes only); the city's parked cars too. */
  setDetail(metres: number) { this.detail = metres; carModels.detail = metres }
  /** Which model a car is (by its id, the same car always the same): taxis now and then, a police car rarely; a robotaxi a white hatchback. */
  private modelIndex(c: CarPose): number {
    const ids = this.models.map((m) => m.id), find = (id: string) => ids.indexOf(id)
    if (c.robo) return find('hatchback')
    const h = (((c.id ?? c.paint * 7919) * 2654435761) >>> 0) % 1000
    if (h < 110) return find('taxi')
    if (h < 125) return find('police')
    const street = ['sedan', 'sedan', 'hatchback', 'suv', 'suv', 'pickup', 'sports', 'muscle'].map(find).filter((i) => i >= 0)
    return street[h % street.length] ?? -1
  }

  /** Streetcars (car.tram in the sim: the race's and the free-roam ones), drawn apart from the street cars; a pool grown as needed. */
  private trams: THREE.Group[] = []
  private tramAt(k: number, livery: number) {
    while (this.trams.length <= k) { const t = streetcar(); t.visible = false; this.trams.push(t); this.group.add(t) }
    const t = this.trams[k]
    if (t.userData.livery !== livery) { const [body, roof] = LIVERIES[livery % LIVERIES.length]; (t.userData.body as THREE.MeshStandardMaterial).color.set(body); (t.userData.roof as THREE.MeshStandardMaterial).color.set(roof); t.userData.livery = livery }
    return t
  }

  /**
   * Draw the cars of a tick. alpha: progress into the next tick (cars are drawn back along their
   * velocity by the part of the tick not yet reached); dt: real seconds since the last frame.
   */
  update(cars: readonly CarPose[], alpha: number, tickHz: number, dt: number, eye?: { x: number; y: number; z: number }) {
    this.time += dt
    const n = Math.min(cars.length, this.capacity)
    const q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3(0, 0, 0)
    const p = new THREE.Vector3(), wp = new THREE.Vector3()
    let robots = 0, trams = 0, vans = 0
    for (let i = 0; i < n; i++) {
      const c = cars[i]
      if (c.van) {
        // A drivable vehicle: its own model, leaning with the ground (fwd along the heading, up the ground's normal).
        const back = (1 - alpha) / tickHz, g = this.vanAt(vans++, c.van.type)
        g.position.set(c.pos.x - c.vel.x * back, c.pos.y - c.vel.y * back, c.pos.z - c.vel.z * back)
        const fx = new THREE.Vector3(c.fwd.x, c.fwd.y, c.fwd.z).normalize(), uz = new THREE.Vector3(c.van.up.x, c.van.up.y, c.van.up.z).normalize()
        const ly = new THREE.Vector3().crossVectors(uz, fx).normalize(), fx2 = new THREE.Vector3().crossVectors(ly, uz)
        g.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(fx2, ly, uz))
        for (const w of (g.userData.front as THREE.Object3D[] | undefined) ?? []) w.rotation.z = -c.van.steer
        // A scooter: on its side when ditched; its front up in a wheelie (about the rear wheel), the rider standing on it.
        const tilt = g.userData.tilt as THREE.Object3D | undefined
        if (tilt) {
          const wb = (g.userData.wheelbase as number) ?? 0.86, pitch = c.van.pitch ?? 0
          tilt.rotation.set(c.van.tipped ? 1.45 : 0, -pitch, 0)
          tilt.position.set(0, 0, c.van.tipped ? 0.12 : Math.sin(pitch) * wb / 2)
          const rider = g.userData.rider as THREE.Object3D | undefined
          if (rider) rider.visible = !!c.van.rider
        }
        g.visible = true
        this.m.compose(g.position, new THREE.Quaternion(), new THREE.Vector3(0, 0, 0))
        this.body.setMatrixAt(i, this.m); this.cabin.setMatrixAt(i, this.m); this.hazard.setMatrixAt(i, this.m)
        this.wheels.setMatrixAt(i * 2, this.m); this.wheels.setMatrixAt(i * 2 + 1, this.m)
        continue
      }
      if (c.tram) {
        const back = (1 - alpha) / tickHz, tram = this.tramAt(trams++, c.livery ?? 0)
        tram.position.set(c.pos.x - c.vel.x * back, c.pos.y - c.vel.y * back, c.pos.z - c.vel.z * back)
        tram.rotation.set(0, -Math.atan2(c.fwd.z, Math.hypot(c.fwd.x, c.fwd.y)), Math.atan2(c.fwd.y, c.fwd.x), 'ZYX')
        tram.visible = true
        this.m.compose(tram.position, new THREE.Quaternion(), new THREE.Vector3(0, 0, 0))
        this.body.setMatrixAt(i, this.m); this.cabin.setMatrixAt(i, this.m); this.hazard.setMatrixAt(i, this.m)
        this.wheels.setMatrixAt(i * 2, this.m); this.wheels.setMatrixAt(i * 2 + 1, this.m)
        continue
      }
      const back = (1 - alpha) / tickHz
      p.set(c.pos.x - c.vel.x * back, c.pos.y - c.vel.y * back, c.pos.z - c.vel.z * back)
      const heading = Math.atan2(c.fwd.y, c.fwd.x), slope = Math.atan2(c.fwd.z, Math.hypot(c.fwd.x, c.fwd.y))
      e.set(0, -slope, heading, 'ZYX'); q.setFromEuler(e)
      // Last resort (the camera keeps clear of cars): a car around the lens is not drawn.
      let hide = false
      if (eye) {
        const ex = eye.x - p.x, ey = eye.y - p.y, ch = Math.cos(heading), sh = Math.sin(heading)
        hide = Math.abs(ex * ch + ey * sh) < 2.5 && Math.abs(-ex * sh + ey * ch) < 1.2 && eye.z - p.z > -0.3 && eye.z - p.z < 2.4
      }
      const size = hide ? zero : one
      // Near the camera: the car's model (the boxes scaled away), else the boxes.
      const mi = this.models.length && eye && (eye.x - p.x) ** 2 + (eye.y - p.y) ** 2 < this.detail * this.detail ? this.modelIndex(c) : -1
      const box = mi >= 0 ? zero : size
      if (mi >= 0) {
        const M = this.models[mi]
        this.m.compose(p, q, size)
        M.mesh.setMatrixAt(M.n, this.m)
        M.mesh.setColorAt(M.n, this.color.set(c.robo ? ROBO : PAINT[((c.paint % PAINT.length) + PAINT.length) % PAINT.length]))
        M.n++
      }
      this.m.compose(p, q, box)
      this.body.setMatrixAt(i, this.m); this.cabin.setMatrixAt(i, this.m)
      this.body.setColorAt(i, this.color.set(c.robo ? ROBO : PAINT[((c.paint % PAINT.length) + PAINT.length) % PAINT.length]))
      for (const [w, off] of [[0, 1.45], [1, -1.35]] as const) {
        wp.set(p.x + Math.cos(heading) * off, p.y + Math.sin(heading) * off, p.z)
        this.m.compose(wp, q, box); this.wheels.setMatrixAt(i * 2 + w, this.m)
      }
      // Robotaxis: a spinning roof sensor; hazards blink while the sim has them on.
      if (c.robo) {
        const sq = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -slope, heading + this.time * 6, 'ZYX'))
        this.m.compose(p, sq, size); this.sensor.setMatrixAt(robots++, this.m)
      }
      const blink = c.hazard && !hide && Math.sin(this.time * 9) > 0
      this.m.compose(p, q, blink ? one : zero); this.hazard.setMatrixAt(i, this.m)
    }
    for (let k = trams; k < this.trams.length; k++) this.trams[k].visible = false
    for (const M of this.models) { M.mesh.count = M.n; M.mesh.visible = M.n > 0; M.mesh.instanceMatrix.needsUpdate = true; if (M.mesh.instanceColor) M.mesh.instanceColor.needsUpdate = true; M.n = 0 }
    for (let k = vans; k < this.vans.length; k++) this.vans[k].visible = false
    this.body.count = this.cabin.count = this.hazard.count = n
    this.wheels.count = n * 2
    this.sensor.count = robots
    for (const mesh of [this.body, this.cabin, this.wheels, this.sensor, this.hazard]) mesh.instanceMatrix.needsUpdate = true
    if (this.body.instanceColor) this.body.instanceColor.needsUpdate = true
  }
}

/**
 * A drivable vehicle of the sim's sizes (its body and cabin boxes, data/vehicles.json), PS2-simple but finished:
 * two-tone paint with a belt trim, dark glass that takes the sky (metal-like, so the environment shows in it),
 * bumpers, head and tail lamps, wheels with hubs (the front pair steers), a darker rocker strip for road dirt.
 * The crew van carries a roof rack with two boards; the garbage truck (Three Bin Hauling, made up) is a blue cab
 * ahead of a white packer body striped in San Francisco's three bin colours: blue, green and black.
 */
function vanModel(g: THREE.Group, d: VanDims, type = 'van') {
  const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.15, ...o })
  const truck = type === 'garbage'
  const lower = mat(truck ? 0x2d4f7a : 0x3d5658), upper = mat(truck ? 0xe9e7df : 0xe4dccb), trim = mat(0x2a2b2d, { roughness: 0.7 }), dirt = mat(truck ? 0x223a58 : 0x2c3536, { roughness: 0.85 })
  const glass = mat(0x0c1218, { roughness: 0.06, metalness: 0.92 }), tyre = mat(0x151516, { roughness: 0.92, metalness: 0 }), hubM = mat(0xb9bcc0, { roughness: 0.35, metalness: 0.8 })
  const head = new THREE.MeshStandardMaterial({ color: 0xfff3d6, emissive: 0xffe7b0, emissiveIntensity: 0.25, roughness: 0.2 })
  const tail = new THREE.MeshStandardMaterial({ color: 0x8a1712, emissive: 0xff2a1a, emissiveIntensity: 0.25, roughness: 0.3 })
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, to: THREE.Object3D = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; to.add(o); return o }
  const box = (lx: number, ly: number, lz: number, m: THREE.Material, x: number, y: number, z: number) => add(new THREE.BoxGeometry(lx, ly, lz), m, x, y, z)
  const wheelR = truck ? 0.5 : 0.36, low = Math.max(d.body.bottom, wheelR * 0.9)
  const L = d.body.length, W = d.body.width, top = d.body.top, front = L / 2, rear = -L / 2
  // Body: the lower paint up to the belt, a dirt-dark rocker strip along the bottom, the belt trim.
  box(L, W, top - low, lower, 0, 0, (low + top) / 2)
  box(L + 0.01, W + 0.01, 0.12, dirt, 0, 0, low + 0.06)
  box(L + 0.02, W + 0.02, 0.06, trim, 0, 0, top)
  const cl = d.cabin.length, cx = d.cabin.offset, ct = d.cabin.top, cw = d.cabin.width
  if (!truck) {
    // The van's cabin box in cream: windscreen, a side glass band split by pillars, rear windows.
    box(cl, cw, ct - top, upper, cx, 0, (top + ct) / 2)
    const wz = top + (ct - top) * 0.58, wh = (ct - top) * 0.5
    add(new THREE.BoxGeometry(0.05, cw * 0.86, wh), glass, cx + cl / 2 + 0.02, 0, wz)
    add(new THREE.BoxGeometry(cl * 0.9, cw + 0.03, wh * 0.8), glass, cx, 0, wz)
    for (const x of [cx + cl / 2 - 1.0, cx - 0.3, cx - cl / 2 + 0.6]) box(0.12, cw + 0.05, wh * 0.82, upper, x, 0, wz)
    box(0.06, cw * 0.7, wh * 0.6, glass, cx - cl / 2 - 0.02, 0, wz)
    // Roof rack: two rails, three bars, two boards on it (deck, grip, wheels).
    const rz = ct + 0.07
    for (const y of [cw / 2 - 0.12, -cw / 2 + 0.12]) box(cl * 0.8, 0.04, 0.04, trim, cx, y, rz)
    for (const x of [-1, 0, 1]) box(0.04, cw - 0.2, 0.04, trim, cx + x * cl * 0.35, 0, rz)
    const decks = [[0x8a2f24, 0.32, 0.25], [0x2d4b6e, -0.32, -0.3]] as const
    for (const [c, y, x] of decks) {
      const dk = new THREE.Group(); dk.position.set(cx + x, y, rz + 0.06); g.add(dk)
      add(new THREE.BoxGeometry(0.8, 0.21, 0.02), mat(c, { roughness: 0.6 }), 0, 0, 0, dk)
      add(new THREE.BoxGeometry(0.78, 0.2, 0.004), mat(0x161616, { roughness: 0.95 }), 0, 0, 0.012, dk)
      for (const wx of [-0.27, 0.27]) for (const wy of [-0.07, 0.07]) add(new THREE.CylinderGeometry(0.027, 0.027, 0.03, 8), mat(0xe8e2d0), wx, wy, -0.035, dk)
    }
  } else {
    // The packer body (white, the three bin stripes low along it, the hopper's frame at the back) and the blue cab ahead of it.
    box(cl, cw, ct - top, upper, cx, 0, (top + ct) / 2)
    const bins = [0x2f6fb8, 0x4f9e4a, 0x1d1d22].map((c) => mat(c))
    bins.forEach((m, k) => box(cl + 0.02, cw + 0.02, 0.16, m, cx, 0, top + 0.5 - 0.16 * (k + 0.5)))
    box(0.5, cw + 0.04, ct - top + 0.1, trim, cx - cl / 2 - 0.2, 0, (top + ct) / 2)
    const cabL = front - (cx + cl / 2) - 0.15, cabX = cx + cl / 2 + 0.1 + cabL / 2, cabTop = top + 1.35
    box(cabL, W - 0.05, cabTop - top, lower, cabX, 0, (top + cabTop) / 2)
    add(new THREE.BoxGeometry(0.05, W * 0.8, 0.75), glass, cabX + cabL / 2 + 0.02, 0, top + 0.8)
    add(new THREE.BoxGeometry(cabL * 0.7, W - 0.02, 0.6), glass, cabX + 0.05, 0, top + 0.82)
    box(cabL + 0.02, W - 0.03, 0.08, upper, cabX, 0, cabTop)
  }
  // Bumpers, lamps.
  for (const x of [front + 0.06, rear - 0.06]) box(0.14, W + 0.04, 0.22, trim, x, 0, low + 0.14)
  for (const y of [W / 2 - 0.28, -W / 2 + 0.28]) {
    box(0.04, 0.26, 0.16, head, front + 0.01, y, top - 0.32)
    box(0.04, 0.16, 0.3, tail, rear - 0.01, y, top - 0.4)
  }
  // Wheels with hubs (the axle across, y): the front pair steers.
  const frontHubs: THREE.Object3D[] = []
  const wheel = new THREE.CylinderGeometry(wheelR, wheelR, 0.3, 16), hub = new THREE.CylinderGeometry(wheelR * 0.5, wheelR * 0.5, 0.31, 12)
  const axles = truck ? [front - 1.1, rear + 2.1, rear + 0.9] : [front - 0.9, rear + 0.9]
  for (const x of axles) for (const side of [1, -1]) {
    const h = new THREE.Group(); h.position.set(x, side * (W / 2 - 0.12), wheelR); g.add(h)
    add(wheel, tyre, 0, 0, 0, h); add(hub, hubM, 0, side * 0.005, 0, h)
    if (x === axles[0]) frontHubs.push(h)
  }
  g.userData.front = frontHubs
}

/**
 * A placeholder rental scooter of the sim's sizes (data/vehicles.json types.scooter dims): a deck, the stem
 * up to the bars at the front, two small wheels (the front one steers), in its paint; a simple standing
 * figure on the deck while it is ridden (the skater is not drawn in a vehicle; a real scooter model and
 * the rider's pose come later). Everything hangs off a tilt group, for lying on its side and the
 * wheelie.
 */
function scooterModel(g: THREE.Group, d: VanDims, paint: number) {
  const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, ...o })
  const body = mat(paint), dark = mat(0x26282c, { roughness: 0.6 }), tyre = mat(0x111111, { roughness: 0.9, metalness: 0 })
  const tilt = new THREE.Group(); g.add(tilt)
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, to: THREE.Object3D = tilt) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; to.add(o); return o }
  const r = 0.1, wb = d.body.length - 2 * r - 0.04
  add(new THREE.BoxGeometry(d.body.length - 0.1, d.body.width * 0.5, 0.05), body, 0, 0, d.body.top - 0.03)   // the deck
  const stemX = d.cabin.offset
  add(new THREE.CylinderGeometry(0.025, 0.025, d.cabin.top - d.body.top, 8).rotateX(Math.PI / 2), dark, stemX, 0, (d.body.top + d.cabin.top) / 2)   // the stem
  add(new THREE.CylinderGeometry(0.018, 0.018, d.cabin.width, 8), dark, stemX, 0, d.cabin.top - 0.02)   // the bars (across)
  add(new THREE.BoxGeometry(0.06, 0.08, 0.12), body, stemX, 0, d.cabin.top - 0.18)   // the display
  const wheel = new THREE.CylinderGeometry(r, r, 0.06, 12)
  const front = new THREE.Group(); front.position.set(wb / 2, 0, r); tilt.add(front); add(wheel, tyre, 0, 0, 0, front)
  add(wheel, tyre, -wb / 2, 0, r)
  // The rider placeholder: legs, a body and a head, standing on the deck facing the bars.
  const rider = new THREE.Group(); rider.visible = false; tilt.add(rider)
  const cloth = mat(0x2a3142, { roughness: 0.8, metalness: 0 }), skin = mat(0xe8c4a0, { roughness: 0.8, metalness: 0 })
  add(new THREE.CylinderGeometry(0.07, 0.06, 0.8, 8).rotateX(Math.PI / 2), cloth, -0.05, 0, d.body.top + 0.4, rider)
  add(new THREE.CylinderGeometry(0.16, 0.13, 0.62, 10).rotateX(Math.PI / 2), cloth, 0.0, 0, d.body.top + 1.12, rider)
  add(new THREE.SphereGeometry(0.11, 12, 8), skin, 0.03, 0, d.body.top + 1.55, rider)
  g.userData.front = [front]
  g.userData.tilt = tilt
  g.userData.rider = rider
  g.userData.wheelbase = wb
}

/** A PCC streetcar (14.2 x 2.6 m, roof 2.95 m with a raised middle to 3.2 m, the sim's boxes in
 *  data/traffic.json tram): its livery's body and roof colours, a window band, the trolley pole up to the wire. */
function streetcar(): THREE.Group {
  const g = new THREE.Group()
  const mat = (c: number, o: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.15, ...o })
  const red = mat(LIVERIES[0][0]), cream = mat(LIVERIES[0][1]), glass = mat(0x3a4855, { roughness: 0.12, metalness: 0.35 }), grey = mat(0x3a3d42, { roughness: 0.7 })
  const lamp = new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffe2a0, emissiveIntensity: 1.6 })
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o }
  add(new THREE.BoxGeometry(14.2, 2.6, 1.15), red, 0, 0, 0.4 + 0.575)                 // lower body
  add(new THREE.BoxGeometry(14.0, 2.62, 0.95), glass, 0, 0, 1.55 + 0.475)             // window band
  add(new THREE.BoxGeometry(14.2, 2.6, 0.45), cream, 0, 0, 2.5 + 0.225)               // roof sides
  add(new THREE.BoxGeometry(11.4, 1.9, 0.25), cream, 0, 0, 2.95 + 0.125)              // the raised middle
  add(new THREE.BoxGeometry(14.25, 2.65, 0.08), cream, 0, 0, 1.52)                    // the belt line
  for (const x of [-4.6, 4.6]) add(new THREE.BoxGeometry(2.4, 2.2, 0.45), grey, x, 0, 0.25)   // trucks
  // Window pillars in the roof colour down both sides (a window every 1.25 m), the ends' windshields framed too.
  const pillar = new THREE.BoxGeometry(0.16, 2.66, 0.95)
  for (let x = -6.25; x <= 6.26; x += 1.25) add(pillar, cream, x, 0, 1.55 + 0.475)
  for (const x of [-7.08, 7.08]) { add(new THREE.BoxGeometry(0.1, 0.5, 0.95), cream, x, 0, 2.025); add(new THREE.CircleGeometry(0.17, 12).rotateY(x > 0 ? Math.PI / 2 : -Math.PI / 2), lamp, x + Math.sign(x) * 0.05, 0, 0.95) }   // centre post, headlight
  const pole = add(new THREE.CylinderGeometry(0.04, 0.04, 4.6, 6), grey, -2.2, 0, 4.4)
  pole.rotation.set(0, Math.PI / 2 - 0.42, 0)
  g.userData = { body: red, roof: cream, livery: 0 }
  return g
}
