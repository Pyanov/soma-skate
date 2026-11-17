import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { jobLines } from '../src/data/schema.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { boardPlace, jobId, jobMission, jobsFor } from '../src/sim/game/jobs.ts'
import { castAt, missionData, placeOf } from '../src/sim/game/missions.ts'
import { raycast } from '../src/sim/park/park.ts'
import { createSim, findSpot, session, type Sim, type SimEvent } from '../src/sim/sim.ts'
import { step } from '../src/sim/step.ts'
import type { Mission } from '../src/sim/data.ts'

// Odd jobs (data/jobs.json, game/jobs.ts, docs/story.md Odd jobs): each board's gigs on a San Francisco
// date are the same every time they are made, rotate from day to day, never repeat a client on a board in
// a day, point at places that exist, and play to the end like any mission: a deliver and a race for real,
// a photo and a ride passed; a failed one tried again from its step; a ride's van gone when it is left.

const data = loadData()
const sf = loadPark('sf', data)
const voices = JSON.parse(readFileSync(rel('data/voices.json'), 'utf8')) as { voices: Record<string, unknown> }
const groundAny = (x: number, y: number) => raycast(sf, { x, y, z: 300 }, { x: 0, y: 0, z: -1 }, 600)?.point.z ?? null
const days = (n: number) => Array.from({ length: n }, (_, i) => new Date(Date.UTC(2026, 9, 1 + i)).toISOString().slice(0, 10))

function world() {
  const sim = createSim(sf, data), events: SimEvent[] = []
  const run = (t: string) => applyCommand(sim, parseCommand(t), events)
  const tick = (n = 3) => { for (let i = 0; i < n; i++) events.push(...step(sim, { b: 0 })) }
  const at = (p: number[]) => `${p[0].toFixed(2)} ${p[1].toFixed(2)} ${(p[2] + 0.4).toFixed(2)}`
  return { sim, events, run, tick, at, s: session(sim) }
}

describe('odd jobs: the gigs', () => {
  it('a board\'s gigs on a day are the same every time, perDay of them, its kinds in turn, no client twice', () => {
    const { sim } = world(), other = world().sim
    for (const B of data.jobs.boards) for (const day of days(40)) {
      const a = jobsFor(sim, B.id, day), b = jobsFor(other, B.id, day)
      expect(a).toEqual(b)
      expect(a.length).toBe(data.jobs.perDay)
      a.forEach((M, i) => {
        expect(M.id).toBe(jobId(B.id, day, i))
        expect(M.kind).toBe('job')
        expect(M.giver).toBe(B.host)
        expect(B.gigs).toContain(M.job!.gig)
        expect(M.steps.length).toBe(1)
      })
      // Kinds alternate; no client twice in a day on a board.
      for (let i = 1; i < a.length; i++) if (B.gigs.length > 1) expect(a[i].job!.gig, `${B.id} ${day}`).not.toBe(a[i - 1].job!.gig)
      const who = a.map((M) => `${M.job!.gig}:${M.job!.client}`)
      expect(new Set(who).size, `${B.id} ${day} ${who}`).toBe(who.length)
    }
  })

  it('rotates: across a month every client and most targets come up, and days differ', () => {
    const { sim } = world()
    const all = days(30).flatMap((day) => data.jobs.boards.flatMap((B) => jobsFor(sim, B.id, day)))
    for (const k of ['deliver', 'carry', 'photo', 'race'] as const) {
      const clients = new Set(all.filter((M) => M.job!.gig === k).map((M) => M.job!.client))
      expect(clients.size, k).toBe(data.jobs[k].clients.length)
    }
    const texts = new Set(all.map((M) => M.steps[0].text))
    expect(texts.size).toBeGreaterThan(all.length * 0.6)
    const sig = (day: string) => data.jobs.boards.map((B) => jobsFor(sim, B.id, day).map((M) => M.steps[0].text).join('|')).join('/')
    expect(new Set(days(30).map(sig)).size).toBe(30)
  })

  it('every gig points at real places: the board\'s room, the client, the spot, a kerb on the street, a course on the ground', () => {
    const { sim, s } = world()
    for (const B of data.jobs.boards) expect(boardPlace(sim, B), B.id).not.toBeNull()
    for (const day of days(60)) for (const B of data.jobs.boards) for (const M of jobsFor(sim, B.id, day)) {
      const st = M.steps[0], where = `${M.id} ${st.text}`
      if (st.kind === 'deliver') {
        expect(placeOf(sim, s, st.from!), where).not.toBeNull()
        expect(castAt(sim, s, st.to.toString().slice(5)), where).not.toBeNull()
        expect(st.seconds! % 5, where).toBe(0)
        expect(st.seconds!, where).toBeGreaterThanOrEqual(data.jobs.deliver.base)
      } else if (st.kind === 'carry') {
        const wait = M.steps[0].actors![st.who], to = st.to as number[]
        expect(Math.abs((groundAny(wait[0], wait[1]) ?? -99) - wait[2]), `${where} kerb`).toBeLessThan(1.5)
        expect(Math.abs((groundAny(to[0], to[1]) ?? -99) - to[2]), `${where} drop-off`).toBeLessThan(1.5)
        const d = Math.hypot(to[0] - wait[0], to[1] - wait[1])
        expect(d, where).toBeGreaterThan(data.jobs.carry.minFrom * 0.8)
        expect(M.vehicles?.[0].name).toBe(data.jobs.carry.vehicle.name)
      } else if (st.kind === 'trick') {
        expect(findSpot(sim, st.near as string), where).not.toBeNull()
      } else if (st.kind === 'race') {
        for (const [x, y] of st.path) expect(groundAny(x, y), `${where} ${x},${y}`).not.toBeNull()
      } else throw new Error(`${where}: a gig of kind ${st.kind}`)
    }
  })

  it('every gig line is voiced in its speaker\'s voice', () => {
    for (const l of jobLines(data.jobs)) {
      const c = data.cast.cast.find((x) => x.id === l.who)!
      expect(voices.voices[c.voice], l.id).toBeTruthy()
      expect(existsSync(rel(`assets/sound/voice/${l.id}.mp3`)), `${l.id}.mp3`).toBe(true)
    }
  })

  it('refuses a board that is not there, a bad day or slot, and a world without the room', () => {
    const { sim } = world()
    expect(() => jobMission(sim, 'nowhere', '2026-10-18', 0)).toThrow(/no gig board "nowhere"/)
    expect(() => jobMission(sim, 'taqueria', 'today', 0)).toThrow(/YYYY-MM-DD/)
    expect(() => jobMission(sim, 'taqueria', '2026-10-18', data.jobs.perDay)).toThrow(/slots 0\.\./)
    const lab = createSim(loadPark('soma', data), data)
    expect(() => applyCommand(lab, parseCommand('mission job taqueria 2026-10-18 0'))).toThrow(/does not have/)
  })
})

/** The first day from 2026-10-01 whose board has a gig of this kind in some slot. */
function find(sim: Sim, kind: string, pred: (M: Mission) => boolean = () => true): Mission {
  for (const day of days(120)) for (const B of data.jobs.boards) for (const M of jobsFor(sim, B.id, day)) if (M.job!.gig === kind && pred(M)) return M
  throw new Error(`no ${kind} gig in 120 days`)
}

describe('odd jobs: playing them', () => {
  it('a delivery: picked up at the counter, carried to the client; done says it is a gig, from which board', () => {
    const { sim, events, run, tick, at, s } = world()
    const M = find(sim, 'deliver'), st = M.steps[0] as Extract<Mission['steps'][number], { kind: 'deliver' }>
    run(`teleport ${at(st.from as number[])}`)
    run(`mission job ${M.job!.board} ${M.job!.day} ${M.job!.slot}`)
    expect(s.mission?.id).toBe(M.id)
    expect(events.some((e) => e.t === 'talk' && e.bark && e.line === st.say![0].id)).toBe(true)
    tick(3)
    expect(s.mission!.armed, 'picked up at the counter').toBe(true)
    run(`teleport ${at(castAt(sim, s, M.job!.client)!)}`); tick(3)
    const done = events.find((e) => e.t === 'missionDone')
    expect(done).toMatchObject({ mission: M.id, kind: 'job', board: M.job!.board, gig: 'deliver' })
    expect(s.mission).toBeUndefined()
  })

  it('a race: the rival waits at the start on the ground, sets off, and is beaten at the finish', () => {
    const { sim, events, run, tick, at, s } = world()
    // Guerrero's course starts at the foot of the Dolores wall, far from Kevin's home in the park and below the
    // wall's top: the rival still stands on that street, not on the wall or under the street.
    const M = find(sim, 'race', (x) => x.job!.client === 'kevin' && (x.steps[0] as { path: number[][] }).path[0][1] < -460)
    run(`mission job ${M.job!.board} ${M.job!.day} ${M.job!.slot}`)
    const a = sim.world.things.find((t) => t.kind === 'actor' && t.alive)!, st = M.steps[0] as Extract<Mission['steps'][number], { kind: 'race' }>
    expect(Math.abs(a.pos.z - (groundAny(a.pos.x, a.pos.y) ?? -99)), 'on the ground at the start').toBeLessThan(1)
    run(`teleport ${a.pos.x.toFixed(2)} ${(a.pos.y - 3).toFixed(2)} ${(a.pos.z + 0.3).toFixed(2)}`); tick(2)
    expect(s.mission!.armed).toBe(true)
    const end = st.path[st.path.length - 1]
    run(`teleport ${at([end[0], end[1], groundAny(end[0], end[1])!])}`); tick(2)
    expect(events.find((e) => e.t === 'missionDone')).toMatchObject({ mission: M.id, kind: 'job', gig: 'race' })
    expect(sim.world.things.some((t) => t.kind === 'actor' && t.alive)).toBe(false)
  })

  it('a race lost: the rival\'s line, then Try again starts the gig over from its step', () => {
    const { sim, events, run, tick, s } = world()
    const M = find(sim, 'race')
    run(`mission job ${M.job!.board} ${M.job!.day} ${M.job!.slot}`)
    const a = sim.world.things.find((t) => t.kind === 'actor' && t.alive)!
    run(`teleport ${a.pos.x.toFixed(2)} ${(a.pos.y - 3).toFixed(2)} ${(a.pos.z + 0.3).toFixed(2)}`)
    for (let i = 0; i < 120 * 200 && s.mission; i++) tick(1)
    expect(events.find((e) => e.t === 'missionFailed')).toMatchObject({ mission: M.id, reason: 'lost' })
    expect(missionData(sim, M.id).fail?.lost?.[0].who).toBe(M.job!.client)
    run(`mission start ${M.id} 0`)
    expect(s.mission?.id).toBe(M.id)
  })

  it('a photo and a ride (passed), and a ride left: its van goes with it', () => {
    const { sim, events, run, tick, s } = world()
    for (const kind of ['photo', 'carry']) {
      const M = find(sim, kind)
      run(`mission job ${M.job!.board} ${M.job!.day} ${M.job!.slot}`); tick()
      run('mission pass'); tick()
      expect(events.filter((e) => e.t === 'missionDone').at(-1)).toMatchObject({ mission: M.id, kind: 'job', gig: kind })
    }
    const R = find(sim, 'carry')
    run(`mission job ${R.job!.board} ${R.job!.day} ${R.job!.slot}`); tick()
    expect(sim.world.things.some((t) => t.alive && t.car?.drive?.name === data.jobs.carry.vehicle.name)).toBe(true)
    run('mission abandon'); tick()
    expect(sim.world.things.some((t) => t.alive && t.car?.drive?.name === data.jobs.carry.vehicle.name)).toBe(false)
    expect(s.mission).toBeUndefined()
  })

  it('a gig started over another mission leaves it first; the same gig made again replaces its mission', () => {
    const { sim, events, run, s } = world()
    run('mission start ch1')
    const M = find(sim, 'photo')
    run(`mission job ${M.job!.board} ${M.job!.day} ${M.job!.slot}`)
    expect(events.some((e) => e.t === 'missionAbandoned' && e.mission === 'ch1')).toBe(true)
    run(`mission job ${M.job!.board} ${M.job!.day} ${M.job!.slot}`)
    expect(s.mission?.id).toBe(M.id)
    expect(sim.data.missions.missions.filter((x) => x.id === M.id).length).toBe(1)
    expect(data.missions.missions.some((x) => x.kind === 'job'), 'the loaded data is never touched').toBe(false)
  })
})
