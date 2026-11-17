import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { parseScenario, runScenario } from '../src/harness/scenario.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { Btn } from '../src/sim/input.ts'
import { closestOnTri, rayTri } from '../src/sim/park/geom.ts'
import { raycast, sphereContacts, type Contact } from '../src/sim/park/park.ts'
import { Recorder, runReplay } from '../src/sim/replay.ts'
import { nextFloat, nextU32, seedRng } from '../src/sim/rng.ts'
import { createSim, session, skater, worldHash, type SimEvent } from '../src/sim/sim.ts'
import { checkCityGoals } from '../src/sim/game/goals.ts'
import { loadSnapshot, saveSnapshot } from '../src/sim/snapshot.ts'
import { advance } from '../src/sim/replay.ts'
import { judgeTrick, trickDifficulty, trickParts } from '../src/sim/game/skate.ts'

const data = loadData()
const lab = loadPark('lab', data)

describe('rng', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = seedRng(42), b = seedRng(42), c = seedRng(43)
    const sa = Array.from({ length: 30 }, () => nextU32(a))
    expect(Array.from({ length: 30 }, () => nextU32(b))).toEqual(sa)
    expect(Array.from({ length: 30 }, () => nextU32(c))).not.toEqual(sa)
  })
  it('floats are in [0,1) with a sane mean', () => {
    const r = seedRng(7)
    let sum = 0
    for (let i = 0; i < 10000; i++) { const f = nextFloat(r); expect(f).toBeGreaterThanOrEqual(0); expect(f).toBeLessThan(1); sum += f }
    expect(sum / 10000).toBeGreaterThan(0.48); expect(sum / 10000).toBeLessThan(0.52)
  })
})

describe('collision queries', () => {
  const soma = loadPark('soma', data)
  for (const park of [lab, soma]) {
    it(`raycast matches brute force on ${park.name}`, () => {
      const r = seedRng(1)
      const { boundsMin: lo, boundsMax: hi } = park
      for (let i = 0; i < 200; i++) {
        const o = { x: lo.x + (hi.x - lo.x) * nextFloat(r), y: lo.y + (hi.y - lo.y) * nextFloat(r), z: hi.z + 1 }
        const d = { x: (nextFloat(r) - 0.5) * 0.4, y: (nextFloat(r) - 0.5) * 0.4, z: -1 }
        const l = Math.hypot(d.x, d.y, d.z); d.x /= l; d.y /= l; d.z /= l
        let best = Infinity
        for (let t = 0; t < park.triCount; t++) { const h = rayTri(park.tv, t * 9, o.x, o.y, o.z, d.x, d.y, d.z); if (h >= 0 && h < best) best = h }
        const hit = raycast(park, o, d, 1000)
        if (best === Infinity) expect(hit).toBeNull()
        else expect(hit!.t).toBeCloseTo(best, 9)
      }
    })
  }
  it('sphere contacts on soma: the cached neighbourhoods give exactly the brute-force contacts', () => {
    // Runs of nearby queries (as a skater makes them) hit the cache; every result must be the
    // brute-force one bit for bit: the same triangles, closest points and distances, in order.
    const r = seedRng(3)
    const out: Contact[] = []
    const q = { x: 0, y: 0, z: 0 }
    const near = (x: number, y: number) => raycast(soma, { x, y, z: 3 }, { x: 0, y: 0, z: -1 }, 20)
    let checked = 0
    for (let run = 0; run < 12; run++) {
      const x0 = 5 + 85 * nextFloat(r), y0 = 10 + 20 * nextFloat(r), g = near(x0, y0)
      if (!g) continue
      for (let k = 0; k < 8; k++) {
        const c = { x: x0 + 0.04 * k, y: y0 + 0.03 * k, z: g.point.z + 0.05 + 0.02 * k }
        const rad = k % 2 ? 0.18 : 0.12
        const brute: Contact[] = []
        for (let t = 0; t < soma.triCount; t++) {
          closestOnTri(soma.tv, t * 9, c.x, c.y, c.z, q)
          const dx = c.x - q.x, dy = c.y - q.y, dz = c.z - q.z, d2 = dx * dx + dy * dy + dz * dz
          if (d2 < rad * rad) brute.push({ tri: t, px: q.x, py: q.y, pz: q.z, dist: Math.sqrt(d2) })
        }
        brute.sort((a, b) => a.dist - b.dist || a.tri - b.tri)
        expect(sphereContacts(soma, c, rad, out)).toEqual(brute)
        checked += brute.length
      }
    }
    expect(checked).toBeGreaterThan(50)
  })
  it('sphere contacts match brute force on lab', () => {
    const r = seedRng(2)
    const out: Contact[] = []
    const q = { x: 0, y: 0, z: 0 }
    for (let i = 0; i < 300; i++) {
      const c = { x: -30 + 60 * nextFloat(r), y: -20 + 50 * nextFloat(r), z: 3.5 * nextFloat(r) }
      const rad = 0.1 + nextFloat(r)
      const brute: number[] = []
      for (let t = 0; t < lab.triCount; t++) { closestOnTri(lab.tv, t * 9, c.x, c.y, c.z, q); if (Math.hypot(c.x - q.x, c.y - q.y, c.z - q.z) < rad) brute.push(t) }
      expect(sphereContacts(lab, c, rad, out).map((k) => k.tri).sort((a, b) => a - b)).toEqual(brute.sort((a, b) => a - b))
    }
  })
})

describe('snapshots and replays', () => {
  const run = (sim: ReturnType<typeof createSim>, n: number) => { for (let i = 0; i < n; i++) advance(sim, { b: i % 200 < 120 ? Btn.up : Btn.left }) }
  it('save/load round-trips exactly', () => {
    const sim = createSim(lab, data, { spot: 'lab_vert' })
    run(sim, 300)
    const snap = saveSnapshot(sim)
    expect(saveSnapshot(loadSnapshot(snap, lab))).toEqual(snap)
  })
  it('a loaded snapshot continues exactly like the original', () => {
    const a = createSim(lab, data, { spot: 'lab_vert' })
    run(a, 240)
    const b = loadSnapshot(saveSnapshot(a), lab)
    run(a, 500); run(b, 500)
    expect(worldHash(b.world)).toBe(worldHash(a.world))
  })
  it('tap <btn> a..b every n presses one tick at a, a + n, ... before b', () => {
    const sc = parseScenario('park lab\ntap grind 10..20 every 4\nrun 30')
    expect(sc.holds.map((h) => [h.from, h.to])).toEqual([[10, 11], [14, 15], [18, 19]])
    expect(() => parseScenario('tap grind 10..20 every 1')).toThrow(/2 or more/)
  })
  it('two identical runs produce identical hashes', () => {
    const sc = parseScenario('park lab\nspawn lab_vert\ncmd 6 speed 10\nrun 600')
    expect(worldHash(runScenario(sc, data).sim.world)).toBe(worldHash(runScenario(sc, data).sim.world))
  })
  it('replays verify, and a changed input is caught with the differing fields', () => {
    const sim = createSim(lab, data, { spot: 'lab_center' })
    const rec = new Recorder()
    for (let i = 0; i < 400; i++) rec.tick(sim, { b: i < 200 ? Btn.up : 0 }, i === 10 ? ['speed 3'] : [])
    const rp = rec.replay()
    expect(runReplay(rp, lab).divergence).toBeNull()
    const bad = { ...rp, input: rp.input.map(([n, b], i) => [n, i === 0 ? Btn.up | Btn.left : b] as [number, number]) }
    const res = runReplay(bad, lab)
    expect(res.divergence).not.toBeNull()
    expect(res.divergence!.fields.some((f) => f.includes('pos'))).toBe(true)
  })
  it('a rolling recorder clips the last N ticks from a stored snapshot', () => {
    const sim = createSim(lab, data, { spot: 'lab_center' })
    const rec = new Recorder(600)
    for (let i = 0; i < 2000; i++) rec.tick(sim, { b: Btn.up })
    const rp = rec.replay(600)
    expect(rp.start.world.tick).toBeLessThanOrEqual(2000 - 600)
    expect(rp.start.world.tick + rp.ticks).toBe(2000)
    expect(runReplay(rp, lab).divergence).toBeNull()
  })
})

describe('commands', () => {
  it('parses and applies', () => {
    const sim = createSim(lab, data)
    expect(parseCommand('teleport 1 2 3 90')).toEqual({ t: 'teleport', pos: [1, 2, 3], heading: 90 })
    applyCommand(sim, parseCommand('teleport lab_bank'))
    expect(skater(sim).spot).toBe('lab_bank')
    applyCommand(sim, parseCommand('setData physics.gravity 5'))
    expect(sim.data.physics.gravity).toBe(5)
    expect(() => parseCommand('fly away')).toThrow(/unknown command/)
    expect(() => applyCommand(sim, parseCommand('set skater.nope 1'))).toThrow(/no field/)
  })
  it('starts game modes; courier and the hill bomb need the city', () => {
    const sim = createSim(lab, data)
    expect(parseCommand('run courier')).toEqual({ t: 'run', mode: 'courier' })
    expect(parseCommand('run start')).toEqual({ t: 'run', mode: 'run' })
    expect(() => parseCommand('run golf')).toThrow(/courier/)
    expect(() => applyCommand(sim, parseCommand('run courier'))).toThrow(/needs a city/)
    expect(() => applyCommand(sim, parseCommand('run bomb'))).toThrow(/needs a city/)
    applyCommand(sim, parseCommand('run combo'))
    const s = sim.world.things.find((t) => t.kind === 'session')!
    expect(s.mode).toBe('combo')
    expect(s.game).toBe('combo')
    expect(s.timeLeft).toBe(data.run.combo.seconds * data.physics.tickHz)
  })
  it('S.K.A.T.E.: run skate [local], in the park only', () => {
    expect(parseCommand('run skate')).toEqual({ t: 'run', mode: 'skate' })
    expect(parseCommand('run skate rosa')).toEqual({ t: 'run', mode: 'skate', route: 'rosa' })
    expect(() => applyCommand(createSim(lab, data), parseCommand('run skate'))).toThrow(/played in the park/)
    const sim = createSim(loadPark('soma', data), data)
    expect(() => applyCommand(sim, parseCommand('run skate nobody'))).toThrow(/no local "nobody"/)
    applyCommand(sim, parseCommand('run skate dre'))
    const s = sim.world.things.find((t) => t.kind === 'session')!
    expect([s.mode, s.skateName, s.skateTurn, s.skateRole, s.skatePlayer, s.skateLocalLetters]).toEqual(['skate', 'Dre', 'local', 'set', '', ''])
    expect(sim.world.things.filter((t) => t.npc?.skate).length).toBe(1)
    applyCommand(sim, parseCommand('run free'))
    expect(sim.world.things.filter((t) => t.npc?.skate).length).toBe(0)   // another game sends the local home
  })
  it('pedestrians: ped spawn | clear | at, in the city only', () => {
    expect(parseCommand('ped spawn 3')).toEqual({ t: 'ped', op: 'spawn', n: 3 })
    expect(parseCommand('ped at 1 2 90 phone')).toEqual({ t: 'ped', op: 'at', x: 1, y: 2, heading: 90, phone: true })
    expect(() => parseCommand('ped walk')).toThrow(/spawn/)
    expect(() => applyCommand(createSim(loadPark('soma', data), data), parseCommand('ped spawn'))).toThrow(/no pedestrians in soma/)
  })
  it('a combo goal with gaps wants one of them in the combo', () => {
    const sim = createSim(loadPark('soma', data), data), s = session(sim), sk = skater(sim)
    s.comboFrom = [-235, -190]   // at the Dolores planters (the dolores tile of the squeezed city)
    const landed = (ids: string[]): SimEvent[] => [{ t: 'comboLanded', tick: 1, name: 'x', points: 3000, multiplier: ids.length, entries: ids.map((id) => ({ id, name: id, points: 100, value: 100 })) }]
    checkCityGoals(sim, s, sk, landed(['kickflip', 'manual', 'gap-bart_stairs']))
    expect(s.cityGoals).not.toContain('dolorescombo')
    checkCityGoals(sim, s, sk, landed(['5050', 'gap-bench', 'manual']))
    expect(s.cityGoals).toContain('dolorescombo')
  })
  it('S.K.A.T.E.: a banked combo as one flat-ground trick', () => {
    const sim = createSim(lab, data)
    const e = (id: string, name: string) => ({ id, name, points: 100 })
    const j = (entries: { id: string; name: string; points: number }[], manualTicks = 0) => judgeTrick(sim, entries, manualTicks)
    expect(j([])).toEqual({ ok: true, trick: 'ollie', name: 'Ollie', reason: '' })
    expect(j([e('kickflip', 'Kickflip'), e('spin1', 'FS 180')])).toEqual({ ok: true, trick: 'fs180+kickflip', name: 'FS 180 Kickflip', reason: '' })
    expect(j([e('nocomply', 'No Comply'), e('spin1', 'BS 180')])).toMatchObject({ ok: true, trick: 'nocomply+bs180', name: 'No Comply BS 180' })
    expect(j([e('kickflip', 'Kickflip'), e('heelflip', 'Heelflip')])).toMatchObject({ ok: false, reason: 'more than one trick' })
    expect(j([e('5050', 'BS 50-50')])).toMatchObject({ ok: false, reason: 'BS 50-50 is not a flat-ground trick' })
    expect(j([e('spin3', 'FS 540')])).toMatchObject({ ok: false, reason: 'more than a 360' })
    expect(j([e('manual', 'Manual')], 60)).toMatchObject({ ok: false, reason: 'manual too short' })
    expect(j([e('manual', 'Manual')], 120)).toEqual({ ok: true, trick: 'manual', name: 'Manual', reason: '' })
    // A key back into parts for the autopilot: frontside is counterclockwise for a regular rider.
    expect(trickParts(sim, 'fs180+kickflip')).toMatchObject({ spin: Math.PI, flip: { id: 'kickflip' }, foot: '', manual: '' })
    expect(trickParts(sim, 'nocomply+bs180')).toMatchObject({ spin: -Math.PI, foot: 'nocomply' })
    expect(trickDifficulty(sim, 'ollie')).toBe(0)
    expect(trickDifficulty(sim, 'bs180+heelflip')).toBeCloseTo(0.5, 9)
  })
})
