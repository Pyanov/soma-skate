import { describe, expect, it } from 'vitest'
import { loadData, loadPark, readJson, rel } from '../src/harness/io.ts'
import { validateGameData, DATA_FILES } from '../src/data/schema.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { createSim, skater } from '../src/sim/sim.ts'
import { step } from '../src/sim/step.ts'
import { Btn } from '../src/sim/input.ts'
import { VEHICLE_ID } from '../src/sim/game/vehicles.ts'
import { ACTOR_ID } from '../src/sim/game/movers.ts'

// Driving and the story's characters on the move (docs/mechanics/driving.md, missions.md): the data holds
// together, the crew van is parked in sf only, vehicles and actors started by command take ids of their
// own, and a teleport takes the driver out.

const data = loadData()
const raw = () => Object.fromEntries(DATA_FILES.map((f) => [f, readJson(rel(`data/${f}.json`))])) as Record<(typeof DATA_FILES)[number], unknown> & { vehicles: { parked: { type: string }[]; summon: { type: string } } }

describe('vehicle data', () => {
  it('names only types it has, for the parked vehicles and van summon', () => {
    const r = raw()
    r.vehicles.parked[0].type = 'hovercraft'
    expect(() => validateGameData(r)).toThrow(/parked crew_van has type "hovercraft"/)
    const s = raw()
    s.vehicles.summon.type = 'zeppelin'
    expect(() => validateGameData(s)).toThrow(/summon type "zeppelin"/)
  })

  it('routes and mission drive steps name vehicles that exist', () => {
    const r = raw() as ReturnType<typeof raw> & { vehicles: { routes: Record<string, { type: string }> }; missions: { missions: { id: string; vehicles?: unknown[]; steps: Record<string, unknown>[] }[] } }
    r.vehicles.routes.garbage.type = 'hovercraft'
    expect(() => validateGameData(r)).toThrow(/route garbage is for type "hovercraft"/)
    const m = raw() as typeof r
    m.missions.missions[0].steps.push({ kind: 'drive', text: 'Drive', to: [0, 0, 0], vehicle: 'batmobile' })
    expect(() => validateGameData(m)).toThrow(/vehicle "batmobile" is no type, parked vehicle or vehicle the mission places/)
    const p = raw() as typeof r
    p.missions.missions[0].vehicles = [{ name: 'kevins_truck', type: 'garbage_scow', at: [0, 0, 0] }]
    expect(() => validateGameData(p)).toThrow(/vehicle kevins_truck is of type "garbage_scow"/)
    const ok = raw() as typeof r
    ok.missions.missions[0].vehicles = [{ name: 'kevins_truck', type: 'garbage', at: [0, 0, 0] }]
    ok.missions.missions[0].steps.push({ kind: 'drive', text: 'Drive', to: [0, 0, 0], vehicle: 'kevins_truck' }, { kind: 'carry', text: 'Carry', who: 'karl', to: [0, 0, 0], vehicle: 'van' })
    expect(() => validateGameData(ok)).not.toThrow()
  })
})

describe('the crew van', () => {
  it('is parked in sf, standing on its wheels, and nowhere else', () => {
    const sf = createSim(loadPark('sf', data), data)
    const vans = sf.world.things.filter((t) => t.car?.drive && t.car.drive.type === 'van')
    expect(vans.map((t) => [t.id, t.car!.drive!.name, t.car!.drive!.type, t.car!.drive!.driver])).toEqual([[VEHICLE_ID, 'crew_van', 'van', -1]])
    expect(vans[0].car!.drive!.ground).toBe(true)
    // Chad Vantage's rental scooters (physics phase 31): twelve downtown, each standing on its wheels on the sidewalk.
    const scooters = sf.world.things.filter((t) => t.car?.drive?.type === 'scooter')
    expect(scooters.length).toBe(12)
    for (const s of scooters) expect([s.car!.drive!.name, s.car!.drive!.ground, s.car!.drive!.ride!.tipped], s.car!.drive!.name).toEqual([s.car!.drive!.name, true, false])
    for (const park of ['soma', 'lab']) expect(createSim(loadPark(park, data), data).world.things.some((t) => t.car?.drive)).toBe(false)
  }, 20_000)   // sims of the city: seconds on a busy machine
  it('moves no other Thing\'s id: with or without it the ids are the same', () => {
    const park = loadPark('sf', data)
    const ids = (d: typeof data) => createSim(park, d).world.things.filter((t) => !t.car?.drive).map((t) => t.id)
    expect(ids(data)).toEqual(ids({ ...data, vehicles: { ...data.vehicles, parked: [] } }))
  }, 20_000)
  it('gets driven, and a teleport puts the driver out where it lands while the van stays', () => {
    const sim = createSim(loadPark('sf', data), data)
    applyCommand(sim, parseCommand('traffic clear'))
    applyCommand(sim, parseCommand('vehicle enter crew_van'))
    expect(skater(sim).state).toBe('drive')
    for (let t = 0; t < 120; t++) step(sim, { b: Btn.up })
    const van = sim.world.things.find((t) => t.car?.drive)!
    expect(Math.hypot(van.vel.x, van.vel.y)).toBeGreaterThan(2)
    applyCommand(sim, parseCommand('teleport big3_runway'))
    for (let t = 0; t < 240; t++) step(sim, { b: 0 })
    expect(skater(sim).drive).toBeUndefined()
    expect(van.car!.drive!.driver).toBe(-1)
    expect(Math.hypot(van.vel.x, van.vel.y)).toBe(0)
  }, 20_000)
})

describe('actors started by command', () => {
  it('take ids of their own, replace one of the same cast id, and are cast members', () => {
    const sim = createSim(loadPark('sf', data), data)
    const next = sim.world.nextId
    applyCommand(sim, parseCommand('actor spawn kenji follow 6'))
    applyCommand(sim, parseCommand('actor spawn kenji follow 7'))
    const m = sim.world.things.filter((t) => t.kind === 'actor')
    expect(m.map((t) => [t.id, t.actor!.who, t.actor!.pace])).toEqual([[ACTOR_ID, 'kenji', 7]])
    expect(sim.world.nextId).toBe(next)
    expect(() => applyCommand(sim, parseCommand('actor spawn donna escort 4 1,1'))).toThrow(/two points/)
    expect(() => applyCommand(sim, parseCommand('actor spawn nobody follow 4'))).toThrow(/cast/)
  }, 20_000)

  it('a mission follow step barks its waiting line as its character stops for you, its passed line as you pass', () => {
    const d = structuredClone(data)
    const st = d.missions.missions.find((M) => M.id === 'disco')!.steps[1]
    if (st.kind !== 'follow') throw new Error('disco step 1 is not a follow step')
    st.waiting = [{ id: 'test-waiting', who: 'donna', text: 'Keep up, sugar.' }]
    st.passed = [{ id: 'test-passed', who: 'donna', text: 'Show-off.' }]
    const sim = createSim(loadPark('sf', d), d), barks: string[] = []
    const run = (ticks: number, b: number) => { for (let i = 0; i < ticks; i++) for (const e of step(sim, { b })) if (e.t === 'talk' && e.bark && e.line.startsWith('test-')) barks.push(e.line) }
    applyCommand(sim, parseCommand('traffic clear'))
    applyCommand(sim, parseCommand('mission start disco 1'))
    applyCommand(sim, parseCommand('teleport -577 -41 18.6 180'))
    run(1000, Btn.down)   // you stand still on the hill: she passes you and stops 14 m on
    expect(barks).toEqual(['test-waiting'])
    applyCommand(sim, parseCommand('teleport -571 -98 16 180'))   // well ahead of her along her path
    run(10, 0)
    expect(barks).toEqual(['test-waiting', 'test-passed'])
  }, 30_000)
})

describe('a scooter for its view (src/client/traffic.ts CarPose van; physics phase 32)', () => {
  it('leans into a turn, + to the right, and pitches its front up in a wheelie', async () => {
    const { carPoses } = await import('../src/client/traffic.ts')
    const sim = createSim(loadPark('sf', data), data)
    const run = (ticks: number, b: number) => { for (let i = 0; i < ticks; i++) step(sim, { b }) }
    const pose = () => carPoses(sim.world.things).find((c) => c.van?.rider)!.van!
    applyCommand(sim, parseCommand('traffic clear'))
    applyCommand(sim, parseCommand('teleport 358.9 323.7 -0.98 45'))
    run(20, 0)
    run(2, Btn.use)
    run(400, Btn.up)
    expect([pose().pitch, Math.abs(pose().lean!) < 0.01]).toEqual([0, true])
    run(60, Btn.up | Btn.right)
    expect(pose().lean!).toBeGreaterThan(0.05)   // turning right at speed: leaning right
    expect(pose().lean!).toBeLessThanOrEqual((data.vehicles.types.scooter.scooter!.view!.leanMaxDeg * Math.PI) / 180)
    run(30, Btn.up)
    run(6, 0); run(3, Btn.up); run(3, 0); run(3, Btn.down)   // up then down quickly: the wheelie
    expect(pose().wheelie).toBeDefined()
    expect(pose().pitch!).toBeGreaterThan(0.15)
    expect(pose().pitch!).toBeLessThan(0.5)
  }, 30_000)
})
