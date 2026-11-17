import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Cam, type CameraData } from '../src/client/camera.ts'
import { BestCombo, introPath, loopIndex, type PresentData } from '../src/client/present.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater } from '../src/sim/sim.ts'

// Presentation (view only, present.ts): Tour level intros that fly over the level onto the chase
// camera, the best combo of a run for the results replay, and the goal punch-in.

const data = loadData()
const P = JSON.parse(readFileSync(rel('data/presentation.json'), 'utf8')) as PresentData
const C = JSON.parse(readFileSync(rel('data/camera.json'), 'utf8')) as CameraData
Cam.setData(C)

describe('presentation', () => {
  it('each Tour level intro starts high over the level and lands exactly on the chase camera', { timeout: 120000 }, () => {
    for (const [id, scen] of [['soma', 'tour-soma'], ['mission', 'tour-mission'], ['castro', 'tour-castro'], ['hills', 'tour-hills']]) {
      const sc = loadScenario(rel(`scenarios/${scen}.skate`)), park = loadPark(sc.park, data)
      const sk = skater(runScenario({ ...sc, ticks: 2 }, data).sim)
      const cam = new Cam(); cam.park = park; cam.step(sk, true)
      const L = data.tour.levels.find((l) => l.id === id)!
      const path = introPath(L, park, sk, cam.pose!, P.intro)
      const a = path(0), b = path(1)
      expect(b.pos.x).toBeCloseTo(cam.pose!.pos.x, 5)
      expect(b.look.z).toBeCloseTo(cam.pose!.look.z, 5)
      expect(a.pos.z - sk.pos.z, id).toBeGreaterThan(3)
      // Under the park's freeway deck all the way (drawn, not solid: the level's ceilingZ).
      const cap = P.intro.levels?.[id]?.ceilingZ
      if (cap !== undefined) for (let u = 0; u <= 1; u += 0.05) expect(path(u).pos.z).toBeLessThanOrEqual(cap + 1e-6)
    }
  })

  it('the best combo of a run: the highest, from the pop before its first trick to where it banks', () => {
    const res = runScenario(loadScenario(rel('scenarios/tour-soma.skate')), data)
    const best = new BestCombo()
    for (const e of res.events) best.event(e)
    const top = Math.max(...res.events.flatMap((e) => (e.t === 'comboLanded' ? [e.points] : [])))
    expect(best.best!.points).toBe(top)
    const pop = res.events.filter((e) => e.t === 'pop' && e.tick <= best.best!.from + 1).pop()!
    expect(best.best!.from).toBe(pop.tick)
    expect(best.best!.to).toBeGreaterThan(best.best!.from + 60)
  })

  it('the results replay loops in slow motion with a pause between', () => {
    const hz = 120, n = 240, run = n / (hz * P.replay.speed)
    expect(loopIndex(0, n, hz, P.replay)).toBe(0)
    expect(loopIndex(run * 0.5, n, hz, P.replay)).toBe(n / 2)
    expect(loopIndex(run + P.replay.pause * 0.5, n, hz, P.replay)).toBe(-1)
    expect(loopIndex(run + P.replay.pause + 0.001, n, hz, P.replay)).toBe(0)
  })

  it('a goal punches the chase camera in briefly, and a snap cancels it', () => {
    const sc = loadScenario(rel('scenarios/lab-push-coast.skate')), park = loadPark(sc.park, data)
    const t = skater(runScenario({ ...sc, ticks: 300 }, data).sim)
    const cam = new Cam(); cam.park = park; cam.step(t, true)
    for (let i = 0; i < 30; i++) cam.step(t)
    const d0 = Math.hypot(cam.pose!.pos.x - t.pos.x, cam.pose!.pos.y - t.pos.y), f0 = cam.pose!.fov
    cam.punch()
    for (let i = 0; i < 14; i++) cam.step(t)
    expect(Math.hypot(cam.pose!.pos.x - t.pos.x, cam.pose!.pos.y - t.pos.y)).toBeLessThan(d0 - 0.2)
    expect(cam.pose!.fov).toBeLessThan(f0 - 1)
    for (let i = 0; i < C.punch!.ticks + 60; i++) cam.step(t)
    expect(Math.hypot(cam.pose!.pos.x - t.pos.x, cam.pose!.pos.y - t.pos.y)).toBeCloseTo(d0, 1)
    cam.punch(); cam.step(t, true)
    for (let i = 0; i < 10; i++) cam.step(t)
    expect(Math.hypot(cam.pose!.pos.x - t.pos.x, cam.pose!.pos.y - t.pos.y)).toBeCloseTo(d0, 1)
  })
})
