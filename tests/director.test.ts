import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { Cam, type CamPose } from '../src/client/camera.ts'
import { Director, stretchFrames, stretchTimes, type MomentsData, type SlowmoLevel } from '../src/client/director.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { runReplay } from '../src/sim/replay.ts'
import { player2, session, skater, worldHash } from '../src/sim/sim.ts'

// The trick director (src/client/director.ts, data/moments.json): it finds the big moments in a run's events (a
// kickflip off the big 3, a special, a long grind), eases the time scale down to the slow motion and back around
// them, swings the camera into a shot and back to the chase camera with a spring, stays out of the games where
// time matters, and never touches the sim.

const data = loadData()
const D = JSON.parse(readFileSync(rel('data/moments.json'), 'utf8')) as MomentsData
Cam.specials = new Set(((data.tricks as unknown as { specials?: { id: string }[] }).specials ?? []).map((s) => s.id))

/** A scenario through a chase camera and the director: per tick its time scale, weight, pose and the chase pose. */
function direct(name: string, o: { level?: SlowmoLevel; cameras?: boolean; game?: string } = {}) {
  const rp = runScenario(loadScenario(rel('scenarios', `${name}.skate`)), data).replay
  const park = loadPark(rp.start.park.name, data)
  const dir = new Director(park, D, data.physics)
  dir.level = o.level ?? 'big'; dir.cameras = o.cameras ?? true
  const cam = new Cam(); cam.park = park
  const rows: { tick: number; speed: number; w: number; pose: CamPose | null; chase: CamPose; state: string }[] = []
  const lands: number[] = [], grindEnds: number[] = []
  let hash = ''
  let last = skater(runScenario(loadScenario(rel('scenarios', `${name}.skate`)), data).sim)
  runReplay(rp, park, { onTick: (s, ev) => {
    const t = skater(s)
    last = structuredClone(t)
    cam.step(t, rows.length === 0)
    dir.step(t, ev, s.world.tick, cam.pose, cam, dir.allowed(o.game ?? session(s).game, !!player2(s)))
    rows.push({ tick: s.world.tick, speed: dir.speed(s.world.tick), w: dir.weight, pose: dir.pose, chase: cam.pose!, state: t.state })
    for (const e of ev) { if (e.t === 'land') lands.push(e.tick); if (e.t === 'grindEnd') grindEnds.push(e.tick) }
    hash = worldHash(s.world)
  } })
  return { dir, rows, lands, grindEnds, hash, rp, park, last, cam }
}

describe('trick director', () => {
  it('slows a kickflip off the big 3 around its peak, back to full speed before it lands', () => {
    const { dir, rows, lands } = direct('soma-big3-kickflip')
    expect(dir.seen.map((m) => m.kind)).toEqual(['air'])
    const m = dir.seen[0], land = lands[lands.length - 1]
    expect(m.shot).toBe('swing')
    expect(m.b1).toBeLessThanOrEqual(land)
    const S = D.slowmo
    // The speed: 1 before, down to the slow motion, held about hold real seconds, 1 again; never under it, never a jump.
    const speeds = rows.map((r) => r.speed)
    expect(Math.min(...speeds)).toBeCloseTo(S.speed, 5)
    for (let i = 1; i < speeds.length; i++) expect(Math.abs(speeds[i] - speeds[i - 1])).toBeLessThan(0.1)
    const held = rows.filter((r) => Math.abs(r.speed - S.speed) < 1e-9).length
    expect(held / data.physics.tickHz / S.speed).toBeGreaterThan(0.5)
    expect(held / data.physics.tickHz / S.speed).toBeLessThan(0.85)
    expect(rows.filter((r) => r.tick < m.a0 || r.tick > m.b1).every((r) => r.speed === 1)).toBe(true)
  })

  it('swings the camera into the shot and back to the chase camera, smoothly and round the skater', () => {
    const { rows, dir, last, cam } = direct('soma-big3-kickflip')
    expect(Math.max(...rows.map((r) => r.w))).toBeGreaterThan(0.95)
    // After the shot, the spring only eases back (slower than it went in), then sits exactly on the chase camera.
    const end = dir.seen[0].shotEnd, back = rows.filter((r) => r.tick > end + 1).map((r) => r.w)
    for (let i = 1; i < back.length; i++) expect(back[i]).toBeLessThanOrEqual(back[i - 1] + 1e-9)
    let tick = rows[rows.length - 1].tick
    for (let i = 0; i < 240; i++) { cam.step(last); dir.step(last, [], ++tick, cam.pose, cam, true) }
    expect(dir.weight).toBe(0)
    expect(dir.pose).toEqual(cam.pose)
    // No snaps: the swing (in the slow motion) moves the camera at most half a metre a tick, its speed changes a little
    // from tick to tick (it accelerates and settles), and the weight never jumps.
    const moves: number[] = []
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1].pose!, b = rows[i].pose!
      moves.push(Math.hypot(b.pos.x - a.pos.x, b.pos.y - a.pos.y, b.pos.z - a.pos.z))
      expect(Math.abs(rows[i].w - rows[i - 1].w)).toBeLessThan(0.08)
    }
    expect(Math.max(...moves)).toBeLessThan(0.5)
    for (let i = 1; i < moves.length; i++) expect(Math.abs(moves[i] - moves[i - 1])).toBeLessThan(0.12)
  })

  it('finds a special and a long grind (the push-in along the rail, until the grind ends)', () => {
    expect(direct('soma-special-superman').dir.seen.map((m) => [m.kind, m.shot])).toEqual([['special', 'swing']])
    const g = direct('sf-grind-promenade')
    expect(g.dir.seen.map((m) => [m.kind, m.shot])).toEqual([['grind', 'push']])
    expect(g.dir.seen[0].shotEnd).toBeLessThanOrEqual(g.grindEnds[0] ?? Infinity)
  })

  it('films a grind down a handrail from the side, never from below looking up the stairs', () => {
    // A playtest report of 2026-11-16: a grind down a rail looked like it went up. The push-in sat
    // ahead of the skater down the rail, below it, looking back up the stairs: in slow motion, with the
    // camera keeping pace, the stairs rising behind the rider read as a grind going up.
    const { dir, rows } = direct('sf-gap-bart-rail', { level: 'every' })
    const m = dir.seen.find((x) => x.kind === 'grind')!
    expect(m.shot).toBe('track')
    const shot = rows.filter((r) => r.state === 'grind' && r.w > 0.9 && r.pose)
    expect(shot.length).toBeGreaterThan(30)
    const t = dir.seen[0].dir
    for (const r of rows.filter((x) => shot.includes(x))) {
      const sk = r.chase.look, c = r.pose!.pos
      // Not ahead down the rail, and not below the rider.
      expect((c.x - sk.x) * t.x + (c.y - sk.y) * t.y).toBeLessThan(0.5)
      expect(c.z).toBeGreaterThan(r.pose!.look.z - 0.2)
    }
    // A level ledge keeps the push-in from ahead.
    expect(direct('sf-grind-promenade').dir.seen.map((x) => x.shot)).toEqual(['push'])
  })

  it('a big vert air with a flip gets the orbit', () => {
    expect(direct('lab-vert-combo').dir.seen.map((m) => [m.kind, m.shot])).toEqual([['bigAir', 'orbit']])
  })

  it('stays out of races, the Escape, S.K.A.T.E. and two-player games; Off keeps the camera moves only; both off do nothing', () => {
    for (const game of D.noSlowmo) {
      const r = direct('soma-big3-kickflip', { game })
      expect(r.dir.seen).toEqual([])
      expect(r.rows.every((x) => x.speed === 1 && x.w === 0)).toBe(true)
    }
    const off = direct('soma-big3-kickflip', { level: 'off' })
    expect(off.dir.seen.length).toBe(1)
    expect(off.rows.every((x) => x.speed === 1)).toBe(true)
    expect(Math.max(...off.rows.map((x) => x.w))).toBeGreaterThan(0.9)
    const none = direct('soma-big3-kickflip', { level: 'off', cameras: false })
    expect(none.dir.seen).toEqual([])
    expect(none.rows.every((x) => x.pose === null || JSON.stringify(x.pose) === JSON.stringify(x.chase))).toBe(true)
  })

  it('never changes the sim: the same world hash with and without it', () => {
    const { hash, rp, park } = direct('soma-big3-kickflip')
    let plain = ''
    runReplay(rp, park, { onTick: (s) => { plain = worldHash(s.world) } })
    expect(hash).toBe(plain)
  })

  it('stretches a clip by the slow motion: frames repeat, and the sound lands at the same stretched times', () => {
    const { rows } = direct('soma-big3-kickflip')
    const speeds = rows.map((r) => r.speed), hz = data.physics.tickHz
    const frames = stretchFrames(speeds, 0, speeds.length, hz, 30), times = stretchTimes(speeds, 0, speeds.length, hz)
    expect(frames.length / 30).toBeCloseTo(times[times.length - 1], 1)
    expect(frames.length).toBeGreaterThan(Math.floor((speeds.length / hz) * 30))
    for (let i = 1; i < frames.length; i++) expect(frames[i]).toBeGreaterThanOrEqual(frames[i - 1])
  })
})
