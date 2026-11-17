import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Cam, type CameraData } from '../src/client/camera.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { runReplay } from '../src/sim/replay.ts'
import { skater } from '../src/sim/sim.ts'
import type { Thing } from '../src/sim/thing.ts'

// The chase camera's feel (view only, camera.ts, data/camera.json): out of stairwells, a side angle on
// long grinds, back and up in vert airs, lower and tighter on hill bombs, and clean cuts on a snap.

const data = loadData()
const D = JSON.parse(readFileSync(rel('data/camera.json'), 'utf8')) as CameraData
Cam.setData(D)

type Row = { tick: number; t: Thing; cam: { x: number; y: number; z: number }; feel: Cam['feel'] }
/** A scenario's replay through a chase camera, as a clip does: one row per tick. */
function ride(name: string, data2 = D): Row[] {
  Cam.setData(data2)
  const sc = loadScenario(rel(`scenarios/${name}.skate`))
  const res = runScenario(sc, data)
  const park = loadPark(sc.park, data)
  const cam = new Cam(); cam.park = park
  const rows: Row[] = []
  let i = 0
  runReplay(res.replay, park, { onTick: (sim) => {
    const t = structuredClone(skater(sim))
    cam.step(t, i === 0)
    rows.push({ tick: sim.world.tick, t, cam: { ...cam.pose!.pos }, feel: cam.feel })
    i++
  } })
  Cam.setData(D)
  return rows
}
const plain = (): CameraData => ({ ...D, tight: undefined, grind: undefined, vert: undefined, bomb: undefined })

describe('camera feel', () => {
  it('down the 16th St BART stairs the camera stays up out of the stairwell', { timeout: 120000 }, () => {
    // (before: without the handrail clearance either, which on its own lifts the camera over the rail)
    const now = ride('sf-gap-bart-rail'), before = ride('sf-gap-bart-rail', { ...plain(), collide: { ...D.collide, rails: 0 } })
    // On the rail, two thirds of the way down: the camera sits well above the skater, out of the walls.
    const at = (rows: Row[]) => rows.filter((r) => r.t.state === 'grind').slice(-60)
    const rise = (rows: Row[]) => Math.min(...at(rows).map((r) => r.cam.z - r.t.pos.z))
    expect(rise(now)).toBeGreaterThan(rise(before) + 0.3)
  })

  it('a long grind swings the camera to the approach side, and it comes back behind after', { timeout: 120000 }, () => {
    const rows = ride('lab-5050-ledge')
    const g = rows.filter((r) => r.t.state === 'grind')
    expect(g.length).toBeGreaterThan(D.grind!.after + 40)
    expect(Math.max(...g.map((r) => r.feel.grind))).toBeGreaterThan(0.5)
    // The angle round from straight behind the way it goes.
    const angle = (r: Row) => {
      const v = Math.hypot(r.t.vel.x, r.t.vel.y), bx = -r.t.vel.x / v, by = -r.t.vel.y / v
      const cx = r.cam.x - r.t.pos.x, cy = r.cam.y - r.t.pos.y, cl = Math.hypot(cx, cy)
      return (Math.acos(Math.max(-1, Math.min(1, (bx * cx + by * cy) / cl))) * 180) / Math.PI
    }
    expect(angle(g[g.length - 1])).toBeGreaterThan(12)
    expect(rows[rows.length - 1].feel.grind).toBeLessThan(0.15)
  })

  it('a vert air pulls the camera back and up, and it recovers on the way down the ramp', { timeout: 60000 }, () => {
    const rows = ride('lab-vert-air'), flat = ride('lab-vert-air', plain())
    const air = rows.filter((r) => r.t.state === 'air' && r.t.vertAir)
    expect(air.length).toBeGreaterThan(60)
    const peak = air[air.length - 1].tick, i = rows.findIndex((r) => r.tick === peak)
    expect(rows[i].cam.z).toBeGreaterThan(flat[i].cam.z + 0.4)
    expect(rows[rows.length - 1].feel.vert).toBeLessThan(0.05)
  })

  it('bombing Dolores the camera rides lower and keeps up (nearer) than without the bomb feel', { timeout: 120000 }, () => {
    const rows = ride('sf-dolores-bomb'), off = ride('sf-dolores-bomb', { ...D, bomb: undefined })
    const fast = rows.map((r, i) => ({ r, o: off[i] })).filter(({ r }) => Math.hypot(r.t.vel.x, r.t.vel.y) > 13.5)
    expect(fast.length).toBeGreaterThan(100)
    const mean = (f: (x: { r: Row; o: Row }) => number) => fast.reduce((s, x) => s + f(x), 0) / fast.length
    const back = (r: Row) => Math.hypot(r.cam.x - r.t.pos.x, r.cam.y - r.t.pos.y)
    expect(mean(({ r, o }) => (o.cam.z - o.t.pos.z) - (r.cam.z - r.t.pos.z))).toBeGreaterThan(0.25)
    expect(mean(({ r, o }) => back(o) - back(r))).toBeGreaterThan(0.6)
  })

  it('a snap (a teleport, a replay from its start) cuts straight to the pose, every factor reset', () => {
    const sc = loadScenario(rel('scenarios/lab-5050-ledge.skate'))
    const park = loadPark(sc.park, data), res = runScenario(sc, data)
    const cam = new Cam(); cam.park = park
    let i = 0, mid: Thing | null = null
    runReplay(res.replay, park, { onTick: (sim) => { const t = skater(sim); cam.step(t, i === 0); if (i === 330) mid = structuredClone(t); i++ } })
    cam.step(mid!, true)
    expect(cam.feel.grind).toBe(0)
    expect(cam.prev).toEqual(cam.pose)
    const again = new Cam(); again.park = park
    again.step(mid!, true)
    expect(again.pose).toEqual(cam.pose)   // a snapped camera is the same however it got there
  })
})
