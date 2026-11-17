import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { castAt, placeOf } from '../src/sim/game/missions.ts'
import type { Mission } from '../src/sim/data.ts'
import { createSim, session, type SimEvent } from '../src/sim/sim.ts'
import { step } from '../src/sim/step.ts'

// The whole story by bot, in one world, the way a player meets it: every mission the moment its after
// missions are done or skipped (chapters first, then side stories in data order), from chapter 1 to the
// finale and every side story. Talk steps are listened to and accepted; go, collect, deliver and race
// steps are played for real (teleporting where a player would skate); the rest (tricks, games, escorts,
// driving) are passed with the dev `mission pass`, their mechanics being each one's own scenarios. Along
// the way some missions are abandoned mid-way and started again, one is skipped and its sequel still
// opens, and after the finale the world is free: nothing on, nothing left in it, a game still starts.

const data = loadData()
const sf = loadPark('sf', data)

describe('the whole story by bot', () => {
  it('plays chapter 1 to 6 and every side story to the end, with abandons and a skip, and nothing soft-locks', () => {
    const sim = createSim(sf, data)
    const events: SimEvent[] = []
    const run = (t: string) => applyCommand(sim, parseCommand(t), events)
    const tick = (n = 3) => { for (let i = 0; i < n; i++) events.push(...step(sim, { b: 0 })) }
    const at = (p: number[]) => `${p[0].toFixed(2)} ${p[1].toFixed(2)} ${(p[2] + 0.4).toFixed(2)}`
    const s = session(sim)
    const done = new Set<string>(), skipped = new Set<string>()
    const played: Record<string, number> = {}, passed: Record<string, number> = {}
    const open = () => data.missions.missions.filter((M) => !done.has(M.id) && !skipped.has(M.id) && (M.after ?? []).every((a) => done.has(a) || skipped.has(a)))
    const next = (): Mission | undefined => { const o = open(); return o.filter((M) => M.kind === 'story').sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0))[0] ?? o[0] }
    const clean = (M: Mission) => {
      expect(s.mission, `${M.id}: no mission on`).toBeUndefined()
      expect(s.mode, `${M.id}: free roam`).toBe('free')
      expect(sim.world.things.some((t) => t.kind === 'actor' && t.alive), `${M.id}: no actor left`).toBe(false)
      for (const v of [...M.vehicles ?? [], ...M.steps.flatMap((st) => st.vehicles ?? [])]) expect(sim.world.things.some((t) => t.alive && t.car?.drive?.name === v.name), `${M.id}: its ${v.name} gone`).toBe(false)
    }
    /** One move on the step that is on; false when the mission is over. */
    const play = (M: Mission) => {
      const m = s.mission
      if (!m || m.id !== M.id) return false
      const st = M.steps[m.step], k = st.kind
      const count = (map: Record<string, number>) => { map[k] = (map[k] ?? 0) + 1 }
      if (k === 'talk') {
        if (m.offer) { run('mission accept'); return true }
        if (m.talk < 0) { run(`teleport ${at(castAt(sim, s, st.who)!)}`); tick(); expect(s.mission?.talk ?? 0, `${M.id} step ${m.step}: ${st.who} talks once you are by them`).toBeGreaterThanOrEqual(0) }
        if (s.mission === m && m.talk >= 0 && !m.offer) { run('mission next all'); count(played) }
        tick(); return true
      }
      if (k === 'go') { run(`teleport ${at(placeOf(sim, s, st.to)!)}`); count(played) }
      else if (k === 'collect' && !st.vehicle) { for (const p of st.items) { run(`teleport ${p[0]} ${p[1]} ${p[2] + 0.2}`); tick(2) } count(played) }
      else if (k === 'deliver' && !st.vehicle) { if (!m.armed && st.from) { run(`teleport ${at(placeOf(sim, s, st.from)!)}`); tick(2) } run(`teleport ${at(placeOf(sim, s, st.to)!)}`); count(played) }
      else if (k === 'race') {
        const a = sim.world.things.find((t) => t.kind === 'actor' && t.alive)!
        run(`teleport ${a.pos.x.toFixed(2)} ${(a.pos.y - 3).toFixed(2)} ${(a.pos.z + 0.3).toFixed(2)}`); tick(2)
        const end = st.path[st.path.length - 1]
        run(`teleport ${at([end[0], end[1], a.pos.z])}`); count(played)
      } else { run('mission pass'); count(passed) }
      tick(3)
      return true
    }
    const fails = () => events.filter((e) => e.t === 'missionFailed')
    let n = 0, skippedOne = false
    for (let M = next(); M; M = next()) {
      n++
      expect(n, 'the story ends').toBeLessThan(200)
      // Every third side story is abandoned after its offer and started again; one side story with a sequel is skipped.
      if (!skippedOne && M.kind === 'side' && data.missions.missions.some((x) => x.after?.includes(M!.id))) {
        run(`mission start ${M.id}`); run('mission skip'); tick(); clean(M); skipped.add(M.id); skippedOne = true; continue
      }
      if (M.kind === 'side' && n % 3 === 0 && M.steps.length > 1) {
        run(`mission start ${M.id}`); run('mission next all'); run('mission accept'); tick(5)
        run('mission abandon'); tick(); clean(M)
      }
      const before = events.length
      run(`mission start ${M.id}`)
      for (let i = 0; i < 80 && play(M); i++) { /* step by step */ }
      expect(fails(), `${M.id}: no fail`).toEqual([])
      expect(events.slice(before).some((e) => e.t === 'missionDone' && e.mission === M!.id), `${M.id} done`).toBe(true)
      clean(M)
      done.add(M.id)
    }
    // Everything finished or skipped; the finale among them.
    expect(done.size + skipped.size).toBe(data.missions.missions.length)
    expect(done.has('ch6')).toBe(true)
    expect(skipped.size).toBe(1)
    // After the finale the world carries on: free skate, a game starts and ends, a mission can still be replayed.
    run('run combo'); tick(5); expect(s.mode).toBe('combo')
    run('run free'); tick(); expect(s.mode).toBe('free')
    run('mission start ch1'); run('mission abandon'); tick(); expect(s.mission).toBeUndefined()
    // And the gig boards still give work: every board's gigs today, each to the end (game/jobs.ts).
    for (const B of data.jobs.boards) for (let slot = 0; slot < data.jobs.perDay; slot++) {
      run(`mission job ${B.id} 2026-10-18 ${slot}`); tick()
      run('mission pass'); tick()
      expect(events.filter((e) => e.t === 'missionDone').at(-1), `${B.id} gig ${slot}`).toMatchObject({ kind: 'job', board: B.id })
      expect(s.mission).toBeUndefined()
    }
    // Most steps were played for real; the passed ones are the tricks, games, escorts and drives.
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0)
    console.log(`whole story: ${done.size} missions done, ${skipped.size} skipped, ${events.filter((e) => e.t === 'missionAbandoned').length} abandoned and restarted; steps played ${sum(played)} ${JSON.stringify(played)}, passed ${sum(passed)} ${JSON.stringify(passed)}; ${sim.world.tick} ticks`)
    expect(sum(played)).toBeGreaterThan(sum(passed))
    expect(Object.keys(passed).sort()).toEqual(expect.arrayContaining(['mode', 'trick']))
  })
})
