import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Crowd, type CrowdData } from '../src/client/crowd.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'

// The people on the city's sidewalks (view only): a sidewalk graph from the curbs, seeded routes,
// busier streets busier, no one in the skatepark, the same place at the same time every run,
// and reactions to a skater going by.

const data = loadData()
const d = JSON.parse(readFileSync(rel('data/pedestrians.json'), 'utf8')) as CrowdData
// The vignettes' people too (data/vignettes.json): their looks are pedestrian types that only stand there.
d.vignettes = JSON.parse(readFileSync(rel('data/vignettes.json'), 'utf8'))
const sf = loadPark('sf', data)
const crowd = new Crowd(sf, d, null)

describe('pedestrians', () => {
  it('walk a sidewalk graph built from the curbs, with crosswalks, and gather at the spots', () => {
    const g = crowd.graph
    expect(g.edges.length).toBeGreaterThan(1000)
    expect(g.nodes.filter((n) => n.cross.length).length).toBeGreaterThan(500)
    expect(crowd.people.length).toBeGreaterThan(1000)
    const types = new Set(crowd.people.map((p) => p.type))
    for (const t of Object.keys(d.types)) expect(types.has(t), t).toBe(true)
    // Picnickers on the Dolores Park lawn, people at 16th St BART.
    crowd.update(1200, null, null, null)
    expect(crowd.people.filter((p) => p.type === 'picnicker' && Math.hypot(p.x + 320, p.y + 180) < 140).length).toBeGreaterThanOrEqual(20)
    expect(crowd.people.filter((p) => Math.hypot(p.x - 98.1, p.y + 199.1) < 14).length).toBeGreaterThanOrEqual(6)
    // The line for the cable car at the Powell St turntable: single file, most facing the front.
    const G = d.gathers.find((x) => x.line)!
    const ux = G.line![0] - G.at[0], uy = G.line![1] - G.at[1], L = Math.hypot(ux, uy)
    const q = crowd.people.filter((p) => p.fixed && Math.abs(((p.x - G.at[0]) * uy - (p.y - G.at[1]) * ux) / L) < 0.5 && ((p.x - G.at[0]) * ux + (p.y - G.at[1]) * uy) / L > -0.5 && ((p.x - G.at[0]) * ux + (p.y - G.at[1]) * uy) / L < L + 0.5)
    expect(q.length).toBeGreaterThanOrEqual(G.count - 2)
    expect(q.filter((p) => Math.cos(p.fixed!.h - Math.atan2(-uy, -ux)) > 0.8).length).toBeGreaterThanOrEqual(q.length * 0.6)
  })

  it('are busier on Valencia, 16th and Mission than on residential streets, and never in the skatepark', { timeout: 60000 }, () => {
    for (const tick of [0, 12000, 60000]) {
      crowd.update(tick, null, null, null)
      const [x0, y0, x1, y1] = d.exclude[0]
      expect(crowd.people.filter((p) => p.x > x0 && p.x < x1 && p.y > y0 && p.y < y1).length).toBe(0)
    }
    const per100 = (zone: string) => {
      const edges = crowd.graph.edges.filter((e) => (e.zone || 'residential') === zone)
      const len = edges.reduce((s, e) => s + e.len, 0)
      const near = crowd.people.filter((p) => !p.fixed && edges.some((e) => { const i = Math.floor(e.x.length / 2); return Math.hypot(e.x[i] - p.x, e.y[i] - p.y) < e.len / 2 + 4 }))
      return (near.length / len) * 100
    }
    const residential = per100('residential')
    // At least 4 times as busy: Valencia is 4.28 times in the squeezed city (15.57 per 100 m) and Mission St 4.33,
    // on 35 km of residential sidewalk at 3.64 people per 100 m (docs/squeeze.md section 6).
    for (const z of ['Valencia St', '16th St', 'Mission St']) expect(per100(z), z).toBeGreaterThan(residential * 4)
  })

  it('have neighbourhood types where they belong: the Castro, downtown, the Wharf', () => {
    crowd.update(0, null, null, null)
    const areas = d.areas ?? []
    const local = Object.entries(d.types).filter(([, t]) => t.areas)
    expect(local.map(([k]) => k).sort()).toEqual(['breadBowl', 'mapTourist', 'rainbowFan', 'rollerDisco', 'suit'])
    for (const [k, t] of local) {
      for (const a of t.areas!) expect(areas.some((x) => x.name === a), `${k}: area ${a}`).toBe(true)
      const mine = crowd.people.filter((p) => p.type === k)
      expect(mine.length, k).toBeGreaterThan(3)
      // Where they start: in (or just out of) one of their areas.
      const home = mine.filter((p) => areas.some((a) => t.areas!.includes(a.name) && Math.hypot(p.x - a.at[0], p.y - a.at[1]) < a.r + 60))
      expect(home.length, k).toBeGreaterThanOrEqual(mine.length * 0.8)
    }
  })

  it('are where they were at the same time in another run (seeded routes)', () => {
    const again = new Crowd(sf, d, null)
    crowd.update(7777, null, null, null)
    again.update(7777, null, null, null)
    expect(again.people.map((p) => [p.x, p.y, p.h])).toEqual(crowd.people.map((p) => [p.x, p.y, p.h]))
  })

  it('jump aside from a fast skater, and film or cheer a big combo landed near them', () => {
    const c = new Crowd(sf, d, null)
    c.update(600, null, null, null)
    const p = c.people.find((q) => q.fixed && q.T.move !== 'sit' && q.vig < 0)!   // (a vignette's people react as their vignette says, not by dodging)
    const head = c.group.getObjectByName('crowd:head') as THREE.InstancedMesh
    // A skater rushing by right beside them: they hop away (their body leaves its spot).
    c.update(601, null, { x: p.x + 1.0, y: p.y, z: p.z + 0.3, speed: 7 }, null)
    expect(p.dodge).toBeGreaterThan(0)
    c.update(601 + 50, null, { x: p.x + 40, y: p.y, z: p.z, speed: 0 }, null)
    // A big combo landed close by: they react for a few seconds.
    c.update(700, null, { x: p.x + 6, y: p.y, z: p.z, speed: 0 }, { tick: 690, points: d.reactions.bigPoints + 100, x: p.x + 6, y: p.y })
    expect(p.seenLand).toBe(690)
    expect(p.reactKind).toBeGreaterThan(0)
    expect(head.count).toBeGreaterThan(0)
  })

  it('draw the sim\'s pedestrians with the same figures, keep the crowd off them, and fall flat when knocked down', () => {
    const c = new Crowd(sf, d, null)
    c.update(900, null, null, null)
    const p = c.people.find((q) => !q.fixed)!
    const sims = [{ id: 1, x: p.x, y: p.y, z: p.z, heading: 0, speed: 1.2, state: 'walk' as const, t: 0, look: 321 }]
    c.update(900, null, null, null, false, sims)
    const head = c.group.getObjectByName('crowd:head') as THREE.InstancedMesh
    const m = new THREE.Matrix4(), at = new THREE.Vector3()
    head.getMatrixAt(0, m); at.setFromMatrixPosition(m)
    expect(at.distanceTo(new THREE.Vector3(p.x, p.y, at.z))).toBeLessThan(0.5)   // the sim one is drawn first
    expect(at.z - p.z).toBeGreaterThan(1.2)                                          // standing
    // No crowd figure in the same place.
    for (let i = 1; i < head.count; i++) { head.getMatrixAt(i, m); const q = new THREE.Vector3().setFromMatrixPosition(m); expect(Math.hypot(q.x - p.x, q.y - p.y)).toBeGreaterThan(0.6) }
    // Knocked down: the head near the ground.
    c.update(960, null, null, null, false, [{ ...sims[0], state: 'down', t: 40 }])
    head.getMatrixAt(0, m); at.setFromMatrixPosition(m)
    expect(at.z - p.z).toBeLessThan(0.5)
  })

  it('speak up rarely (a chance per reaction and a long cooldown)', { timeout: 60000 }, () => {
    const c = new Crowd(sf, d, null)
    // A camera over the BART plaza (only the people in view are posed and react).
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500)
    cam.up.set(0, 0, 1); cam.position.set(80, -210, 8); cam.lookAt(98, -199, 2); cam.updateMatrixWorld(); cam.updateProjectionMatrix()
    let lines = 0
    // Ten minutes of skating straight through the BART plaza crowd, back and forth.
    for (let tick = 0; tick < 120 * 600; tick += 12) {
      const k = (tick / 120) % 20
      lines += c.update(tick, cam, { x: 88 + k, y: -199, z: 2, speed: 7 }, null, true) ? 1 : 0
    }
    expect(lines).toBeLessThanOrEqual(Math.ceil(600 / d.reactions.toastCooldown) + 1)
  })
})
