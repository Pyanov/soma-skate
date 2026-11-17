import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Cam, carBoxes, type CamBox, type CameraData, type V } from '../src/client/camera.ts'
import { loadData, loadPark } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { raycast } from '../src/sim/park/park.ts'
import { Btn } from '../src/sim/input.ts'
import { advance } from '../src/sim/replay.ts'
import { createSim, skater } from '../src/sim/sim.ts'

// The game camera and the sim's cars: a car never sits on the lens or between it and the skater.

const data = loadData()
Cam.setData(JSON.parse(readFileSync(new URL('../data/camera.json', import.meta.url), 'utf8')) as CameraData)

/** Distance from a point to a box (0 inside). */
function boxDist(p: V, b: CamBox): number {
  const rx = p.x - b.x, ry = p.y - b.y
  const a = rx * b.fx + ry * b.fy, s = -rx * b.fy + ry * b.fx, z = p.z - b.z
  const ea = Math.abs(a) - b.hl, es = Math.abs(s) - b.hw, ez = z < 0 ? -z : z - b.h
  return Math.hypot(Math.max(0, ea), Math.max(0, es), Math.max(0, ez))
}

describe('camera and cars', () => {
  const lab = loadPark('lab', data)
  const setup = () => {
    const sim = createSim(lab, data)
    applyCommand(sim, parseCommand('teleport 0 -12 0.13 90'))
    for (let i = 0; i < 30; i++) advance(sim, { b: 0 })
    const cam = new Cam()
    cam.park = lab
    cam.step(skater(sim), true)
    return { sim, cam }
  }

  it('a car parked where the chase camera sits pushes it clear', () => {
    const { sim, cam } = setup()
    const at = { ...cam.pose!.pos }
    const car: CamBox = { x: at.x, y: at.y, z: 0, fx: 0, fy: 1, hl: 2.2, hw: 0.9, h: 1.75 }
    cam.obstacles = [car]
    for (let i = 0; i < 60; i++) { advance(sim, { b: 0 }); cam.step(skater(sim)) }
    expect(boxDist(cam.pose!.pos, car)).toBeGreaterThan(1.45)
  })

  it('a car between the skater and the camera: the camera sees over it', () => {
    const { sim, cam } = setup()
    const t = skater(sim), eye = { x: t.pos.x, y: t.pos.y, z: t.pos.z + 0.9 }
    const p0 = { ...cam.pose!.pos }
    // A robotaxi across the line of sight halfway back (taller than the eye).
    const car: CamBox = { x: (eye.x + p0.x) / 2, y: (eye.y + p0.y) / 2, z: 0, fx: 0, fy: 1, hl: 2.2, hw: 0.9, h: 2.1 }
    cam.obstacles = [car]
    for (let i = 0; i < 90; i++) { advance(sim, { b: 0 }); cam.step(skater(sim)) }
    const p = cam.pose!.pos
    for (let k = 0; k <= 40; k++) {
      const u = k / 40
      expect(boxDist({ x: eye.x + (p.x - eye.x) * u, y: eye.y + (p.y - eye.y) * u, z: eye.z + (p.z - eye.z) * u }, car)).toBeGreaterThan(0)
    }
  })

  it('a car driving through where the camera sits pushes it aside: it keeps collide.cars (1.5 m) from the car', () => {
    // Standing on foot beside a street, facing away from it, so the chase camera sits over the lane;
    // a car comes up the lane at 9 m/s and passes the skater 4.6 m away (no yield).
    const sf = loadPark('sf', data)
    const run = (withCars: boolean) => {
      const sim = createSim(sf, data, { spot: 'valencia_shops' })
      applyCommand(sim, parseCommand('traffic clear'))
      applyCommand(sim, parseCommand('car -49.6 -329 356 9'))   // Valencia's northbound lane, north of 17th
      advance(sim, { b: 0 })
      const car = sim.world.things.find((k) => k.kind === 'car' && !k.car?.drive)!   // the car just placed (traffic clear leaves the crew van)
      const fl = Math.hypot(car.fwd.x, car.fwd.y), fx = car.fwd.x / fl, fy = car.fwd.y / fl
      const sx = car.pos.x + fx * 30 + fy * 4.6, sy = car.pos.y + fy * 30 - fx * 4.6
      const ground = raycast(sf, { x: sx, y: sy, z: car.pos.z + 20 }, { x: 0, y: 0, z: -1 }, 40)!
      const heading = (Math.atan2(fx, fy) * 180) / Math.PI + 90
      applyCommand(sim, parseCommand(`teleport ${sx} ${sy} ${ground.point.z + 0.2} ${heading}`))
      for (let i = 0; i < 20; i++) advance(sim, { b: 0 })
      advance(sim, { b: Btn.walk })
      const cam = new Cam()
      cam.park = sf
      let minDist = Infinity
      for (let tick = 0; tick < 700; tick++) {
        advance(sim, { b: 0 })
        const boxes = carBoxes(sim.world.things, sim.data.traffic, skater(sim).pos)
        cam.obstacles = withCars ? boxes : []
        cam.step(skater(sim), tick === 0)
        for (const c of boxes) minDist = Math.min(minDist, boxDist(cam.pose!.pos, c))
      }
      return { minDist, state: skater(sim).state }
    }
    const blind = run(false), seeing = run(true)
    expect(seeing.state).toBe('walk')
    expect(blind.minDist).toBeLessThan(1.0)   // the case being fixed: the car passes just under the lens
    expect(seeing.minDist).toBeGreaterThan(1.4)
  })
})
