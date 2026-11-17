import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { INTERIOR_PROPS, insidePolygon, Interiors, type InteriorRoom, type InteriorsData } from '../src/client/interiors.ts'
import { ACTS } from '../src/client/vignettes.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { Cam, type CameraData } from '../src/client/camera.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { advance } from '../src/sim/replay.ts'
import { createSim, skater } from '../src/sim/sim.ts'

// The interiors' dressing (data/interiors.json, src/client/interiors.ts) over the city's rooms (city.interiors): the
// data holds together (a dressing per room kind, anchors the rooms have, props the builder knows, people with real
// looks and acts), each room builds in a few draw calls with everything inside its walls, the people stand on its
// floor and keep off the cast's anchors, and the city's own night lamps inside a room reach less.

const url = new URL('../assets/park/sf.city.json', import.meta.url)
const have = existsSync(url)
const rooms: InteriorRoom[] = have ? JSON.parse(readFileSync(url, 'utf8')).city?.interiors ?? [] : []
const D = JSON.parse(readFileSync(rel('data/interiors.json'), 'utf8')) as InteriorsData
const peds = JSON.parse(readFileSync(rel('data/pedestrians.json'), 'utf8')) as { types: Record<string, unknown> }
const cast = JSON.parse(readFileSync(rel('data/cast.json'), 'utf8')) as { cast: { id: string; inside?: string }[] }

describe('interiors', () => {
  it.skipIf(!have)('dresses every room kind, with anchors the rooms have, props it builds, and real looks and acts', () => {
    expect(rooms.length).toBeGreaterThanOrEqual(5)
    for (const r of rooms) {
      const dress = D.rooms[r.kind]
      expect(dress, r.kind).toBeDefined()
      const places = [...dress.rugs ?? [], ...dress.lights ?? [], ...dress.signs ?? [], ...dress.props ?? [], ...dress.people ?? []]
      for (const p of places) if (p.at) expect(Object.keys(r.anchors), `${r.id}: anchor ${p.at}`).toContain(p.at)
      for (const p of dress.props ?? []) expect(INTERIOR_PROPS, `${r.id}: prop ${p.kind}`).toContain(p.kind)
      for (const p of dress.people ?? []) { expect(Object.keys(peds.types), `${r.id}: look ${p.type}`).toContain(p.type); expect(ACTS as readonly string[], `${r.id}: act ${p.act}`).toContain(p.act) }
      // A light, a sign and somebody in every room.
      expect(dress.lights?.length, r.id).toBeGreaterThan(0)
      expect(dress.signs?.length, r.id).toBeGreaterThan(0)
      expect(dress.people?.length, r.id).toBeGreaterThan(0)
    }
  })

  it.skipIf(!have)('builds each room in a few draw calls, inside its walls; its people stand on its floor, off the cast\'s anchors', () => {
    const park = loadPark('sf', loadData())
    const I = new Interiors(rooms, D, park, null)
    expect(I.stats.map((s) => s.id).sort()).toEqual(rooms.map((r) => r.id).sort())
    for (const s of I.stats) expect(s.meshes, `${s.id}: meshes`).toBeLessThanOrEqual(14)
    // Nothing drawn far outside the room (a placement off by a sign or a wrong frame lands in the street).
    for (const r of rooms) {
      const g = I.group.children.find((c) => c.name === `interior:${r.id}`)!
      g.updateMatrixWorld(true)
      const near = (x: number, y: number) => insidePolygon(r.polygon, x, y) || r.polygon.some((q, i) => { const n = r.polygon[(i + 1) % r.polygon.length], dx = n[0] - q[0], dy = n[1] - q[1], t = Math.max(0, Math.min(1, ((x - q[0]) * dx + (y - q[1]) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(q[0] + dx * t - x, q[1] + dy * t - y) < 0.5 })
      g.traverse((o) => {
        const m = o as THREE.Mesh
        if (!m.isMesh) return
        const P = m.geometry.attributes.position, v = new THREE.Vector3(), step = Math.max(1, Math.floor(P.count / 400))
        for (let i = 0; i < P.count; i += step) {
          v.fromBufferAttribute(P, i).applyMatrix4(m.matrixWorld)
          expect(near(v.x, v.y), `${r.id}: a part at ${v.x.toFixed(1)} ${v.y.toFixed(1)}`).toBe(true)
          expect(v.z, r.id).toBeGreaterThan(r.floor - 0.1)
          expect(v.z, r.id).toBeLessThan(r.floor + r.height + 0.1)
        }
      })
    }
    // The people: on the room's floor, inside it, a metre and more from where the story puts its own cast.
    const vig = I.vignettes()
    expect(vig.length).toBe(rooms.reduce((n, r) => n + (D.rooms[r.kind].people?.length ?? 0), 0))
    for (const v of vig) {
      const r = rooms.find((x) => v.id.startsWith(`${x.id}-`))!
      expect(v.floor, v.id).toBe(r.floor)
      expect(insidePolygon(r.polygon, v.at[0], v.at[1]), v.id).toBe(true)
      for (const c of cast.cast.filter((x) => x.inside?.startsWith(`${r.id}/`))) {
        const a = r.anchors[c.inside!.split('/')[1]]
        expect(Math.hypot(a[0] - v.at[0], a[1] - v.at[1]), `${v.id} near ${c.id}`).toBeGreaterThan(1)
      }
    }
  })

  it.skipIf(!have)('shortens the reach of the city\'s night lamps inside a room, and only there', () => {
    const park = loadPark('sf', loadData())
    const I = new Interiors(rooms, D, park, null)
    const r = rooms[0], c = r.polygon.reduce((a, p) => [a[0] + p[0] / r.polygon.length, a[1] + p[1] / r.polygon.length], [0, 0])
    const out = I.indoorLamps([{ x: c[0], y: c[1], z: r.floor + r.height - 0.3, r: 13 }, { x: c[0], y: c[1], z: r.floor + 30, r: 13 }, { x: c[0] + 500, y: c[1], z: r.floor, r: 13 }])
    expect(out.map((l) => l.r)).toEqual([D.indoorLampReach, 13, 13])
  })

  it.skipIf(!have)('keeps the chase camera inside a room, under its ceiling (the collision has none)', () => {
    const data = loadData(), park = loadPark('sf', data)
    Cam.setData(JSON.parse(readFileSync(rel('data/camera.json'), 'utf8')) as CameraData)
    const I = new Interiors(rooms, D, park, null)
    Cam.ceilingAt = (x, y, z) => I.ceilingAt(x, y, z)
    try {
      for (const r of rooms) {
        // At the back of the room facing the door (the wall right behind: without the ceiling the camera lifts over it
        // and ends up above the roof), and halfway in facing in. (Just inside the door it may sit out on the street,
        // looking in through the open door.)
        const a = (r.inward * Math.PI) / 180, fx = Math.sin(a), fy = Math.cos(a)
        const depth = Math.max(...r.polygon.map((p) => (p[0] - r.door[0]) * fx + (p[1] - r.door[1]) * fy))
        for (const [k, h] of [[0.8, r.inward + 180], [0.5, r.inward]]) {
          const x = r.door[0] + fx * depth * k, y = r.door[1] + fy * depth * k
          const sim = createSim(park, data)
          applyCommand(sim, parseCommand(`teleport ${x.toFixed(2)} ${y.toFixed(2)} ${(r.floor + 0.3).toFixed(2)} ${h % 360}`))
          for (let i = 0; i < 30; i++) advance(sim, { b: 0 })
          const cam = new Cam(); cam.park = park
          cam.step(skater(sim), true)
          for (let i = 0; i < 10; i++) cam.step(skater(sim), false)
          const c = cam.pose!.pos
          expect(c.z, `${r.id} ${k}: under the ceiling`).toBeLessThan(r.floor + r.height - 0.2)
          expect(insidePolygon(r.polygon, c.x, c.y), `${r.id} ${k}: inside the room`).toBe(true)
        }
      }
    } finally { Cam.ceilingAt = null }
  })

  it.skipIf(!have)('draws a room only near the camera, and brightens its pools at night', () => {
    const park = loadPark('sf', loadData())
    const I = new Interiors(rooms, D, park, null)
    const r = rooms[0], far = new THREE.Vector3(r.door[0] + 1000, r.door[1], r.floor)
    I.update(far, 0)
    expect(I.stats.every((s) => !s.shown)).toBe(true)
    I.update(new THREE.Vector3(r.door[0], r.door[1], r.floor + 1.5), 1)
    expect(I.stats.find((s) => s.id === r.id)!.shown).toBe(true)
    const pools: THREE.MeshBasicMaterial[] = []
    I.group.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshBasicMaterial | undefined; if (m?.blending === THREE.AdditiveBlending) pools.push(m) })
    expect(pools.length).toBeGreaterThan(0)
    for (const m of pools) expect(m.opacity).toBeCloseTo(D.pool.night, 5)
  })
})
