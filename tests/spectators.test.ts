import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Spectators, spectatorSeats, type SpectatorData } from '../src/client/spectators.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'

// The watchers on the park's ledges (view only): seats from the park geometry, the same every
// load, spread out, and a pose that cheers a big combo nearby and leans back from the skater.

const data = loadData()
const d = (JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as { spectators: SpectatorData }).spectators
const park = loadPark('soma', data)

describe('spectators', () => {
  it('sit on the park ledges, spread out, the same every time', () => {
    const seats = spectatorSeats(park, d)
    expect(seats.length).toBeGreaterThanOrEqual(6)
    expect(seats.length).toBeLessThanOrEqual(d.max)
    expect(spectatorSeats(park, d)).toEqual(seats)
    for (const a of seats) {
      expect(a.drop).toBeGreaterThanOrEqual(d.drop[0])
      for (const b of seats) if (a !== b) expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(d.spacing)
    }
  })

  it('cheer (hands above the head) for a big combo nearby, not for a small one, and lean back from the skater', () => {
    const s = new Spectators(park, d, null)
    const seat = s.seats[0]
    const handZ = () => {
      const arm = s.group.getObjectByName('spectators:hand') as THREE.InstancedMesh
      const m = new THREE.Matrix4(), p = new THREE.Vector3()
      arm.getMatrixAt(0, m)
      return p.set(0, 0, -0.52).applyMatrix4(m).z - seat.z
    }
    const away = { x: seat.x + 15, y: seat.y, z: seat.z }
    s.update(1000, away, null)
    const rest = handZ()
    s.update(1060, away, { tick: 1000, points: d.cheer.bigPoints, x: seat.x + 8, y: seat.y, z: seat.z })
    expect(handZ()).toBeGreaterThan(0.9)
    expect(rest).toBeLessThan(0.4)
    s.update(1060, away, { tick: 1000, points: d.cheer.points - 1, x: seat.x + 8, y: seat.y, z: seat.z })
    expect(handZ()).toBeCloseTo(rest, 1)
    // The skater right at the seat: leaning back, the head behind the hips.
    s.update(1000, { x: seat.x, y: seat.y, z: seat.z + 0.3 }, null)
    const head = s.group.getObjectByName('spectators:head') as THREE.InstancedMesh
    const m = new THREE.Matrix4()
    head.getMatrixAt(0, m)
    const p = new THREE.Vector3().applyMatrix4(m)
    const back = (p.x - seat.x) * Math.cos(seat.heading) + (p.y - seat.y) * Math.sin(seat.heading)
    expect(back).toBeLessThan(-0.3)
  })
})
