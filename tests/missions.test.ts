import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { DATA_FILES, validateGameData } from '../src/data/schema.ts'
import { loadData, loadPark, readJson, rel } from '../src/harness/io.ts'
import { applyCommand, parseCommand } from '../src/sim/commands.ts'
import { missionWorlds, placeOf, stepLines } from '../src/sim/game/missions.ts'
import { raycast } from '../src/sim/park/park.ts'
import { createSim, findSpot, session, skater, type SimEvent } from '../src/sim/sim.ts'
import { step } from '../src/sim/step.ts'

// Missions (data/missions.json, data/cast.json, game/missions.ts): data that holds together in its
// world, the commands refusing what they cannot do, and voices for every line.

const data = loadData()
const raw = () => Object.fromEntries(DATA_FILES.map((f) => [f, readJson(rel(`data/${f}.json`))])) as Record<(typeof DATA_FILES)[number], unknown>
const voices = JSON.parse(readFileSync(rel('data/voices.json'), 'utf8')) as { voices: Record<string, unknown> }
const sf = loadPark('sf', data)
const ground = (x: number, y: number, z: number) => raycast(sf, { x, y, z: z + 3 }, { x: 0, y: 0, z: -1 }, 10)?.point.z ?? null
const groundAny = (x: number, y: number) => raycast(sf, { x, y, z: 300 }, { x: 0, y: 0, z: -1 }, 600)?.point.z ?? null
// Lines written since the last voice run (tools/gen_voices.py records every line without an mp3): the dialogue
// box shows their words and a bark is captioned alone (src/client/voicelines.ts caption). Each must still lack its
// mp3, so the list empties as they are recorded.
const AWAITING_VOICE = new Set(['ch5-17', 'ch5-18', 'ch5-19', 'delay-08', 'delay-09', 'garbage-02', 'lowrider-03'])
const allLines = () => [
  ...data.cast.cast.flatMap((c) => c.chatter ?? []),
  ...data.missions.missions.flatMap((M) => [...Object.values(M.fail ?? {}).flat(), ...M.steps.flatMap(stepLines)]),
]

describe('cast', () => {
  it('every character has a voice, a portrait and a look, and stands on the ground at home', () => {
    const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as { characters: { id: string; outfits?: { id: string }[] }[]; people?: { id: string; outfits?: { id: string }[] }[] }
    const looks = [...chars.characters, ...(chars.people ?? [])]   // people: the cast people (castpeople.ts)
    for (const c of data.cast.cast) {
      expect(voices.voices[c.voice], `${c.id} voice ${c.voice}`).toBeTruthy()
      expect(existsSync(rel(`assets/ui/portrait/${c.id}.jpg`)), `${c.id} portrait (node tools/portraits.ts)`).toBe(true)
      const look = looks.find((l) => l.id === c.model.id)
      expect(look, `${c.id} model ${c.model.id}`).toBeTruthy()
      if (c.model.outfit) expect(look!.outfits?.some((o) => o.id === c.model.outfit), `${c.id} outfit ${c.model.outfit}`).toBe(true)
      const z = ground(c.home[0], c.home[1], c.home[2])
      expect(z, `${c.id} home`).not.toBeNull()
      expect(Math.abs(z! - c.home[2]), `${c.id} home z`).toBeLessThan(0.6)
    }
  })
})

describe('missions data', () => {
  it('every place resolves in the mission\'s world, every follow path and item is on the ground', () => {
    const sim = createSim(sf, data)
    const s = session(sim)
    for (const M of data.missions.missions) {
      expect(missionWorlds(M)).toContain('sf')
      M.steps.forEach((st, i) => {
        const at = `${M.id} step ${i}`
        for (const p of [st.kind === 'go' ? st.to : null, st.kind === 'deliver' ? st.to : null, st.kind === 'deliver' ? st.from : null, st.kind === 'trick' ? st.near : null]) if (p) expect(placeOf(sim, s, p), `${at} ${JSON.stringify(p)}`).not.toBeNull()
        if (st.kind === 'follow' || st.kind === 'race') for (const [x, y] of st.path) expect(groundAny(x, y), `${at} path ${x},${y}`).not.toBeNull()
        if (st.kind === 'collect') for (const [x, y, z] of st.items) expect(Math.abs((ground(x, y, z) ?? -99) - z), `${at} item ${x},${y}`).toBeLessThan(1)
      })
    }
  })

  it('every line has its voice (the speaker\'s) and its mp3, or waits for its recording', () => {
    for (const l of allLines()) {
      const c = data.cast.cast.find((x) => x.id === l.who)!
      expect(voices.voices[c.voice], l.id).toBeTruthy()
      expect(existsSync(rel(`assets/sound/voice/${l.id}.mp3`)), `${l.id}.mp3`).toBe(!AWAITING_VOICE.has(l.id))
    }
    for (const id of AWAITING_VOICE) expect(allLines().some((l) => l.id === id), `${id}: no such line`).toBe(true)
  })

  it('refuses unknown characters and gaps, a line id twice, an offer that is not the first step', () => {
    const bad = (f: (m: { missions: Record<string, any>[] }) => void) => { const r = raw() as Record<string, any>; f(r.missions); return () => validateGameData(r) }
    expect(bad((m) => { m.missions[0].steps[1].who = 'nobody' })).toThrow(/"nobody" is not in data\/cast.json/)
    expect(bad((m) => { m.missions[1].steps[2].gaps = ['nope'] })).toThrow(/no gap "nope"/)
    expect(bad((m) => { m.missions[1].steps[0].lines[0].id = m.missions[0].steps[0].lines[0].id })).toThrow(/line id "ch1-01" twice/)
    expect(bad((m) => { m.missions[0].steps[1].offer = true })).toThrow(/only the first step can be the offer/)
    expect(bad((m) => { m.missions[1].after = ['nope'] })).toThrow(/after "nope"/)
  })
})

describe('mission commands', () => {
  const sim = createSim(sf, data, { spot: 'big3_runway' })
  const run = (text: string, ev: SimEvent[] = []) => applyCommand(sim, parseCommand(text), ev)
  it('refuses what it cannot do', () => {
    expect(() => run('mission next')).toThrow(/no mission on/)
    expect(() => run('mission start nope')).toThrow(/no mission "nope"/)
    expect(() => run('mission start ch1 9')).toThrow(/steps 0..5/)
    expect(() => parseCommand('mission fly')).toThrow(/mission: start/)
    run('mission start ch1')
    expect(() => run('mission accept')).toThrow(/no offer waiting/)
    run('mission next all')
    expect(() => run('mission next')).toThrow(/no conversation on/)
    run('mission decline')
    expect(session(sim).mission).toBeUndefined()
  })
  it('setData addresses missions by id: a field of one, a new one added, an unknown id refused', () => {
    const s2 = createSim(sf, data)
    const go = (t: string) => applyCommand(s2, parseCommand(t))
    go('setData missions.missions.tourist.steps.1.every 3')
    const t = s2.data.missions.missions.find((M) => M.id === 'tourist')!.steps[1]
    expect(t.kind === 'carry' && t.every).toBe(3)
    const n = s2.data.missions.missions.length
    go('setData missions.missions.test-x {"id":"test-x","name":"X","kind":"side","area":"soma","giver":"karl","blurb":"x","steps":[{"kind":"go","text":"Go","to":"big3"}]}')
    expect(s2.data.missions.missions.length).toBe(n + 1)
    expect(s2.data.missions.missions[0].id).toBe('ch1')   // nothing replaced
    expect(() => go('setData missions.missions.nope.steps.1.every 3')).toThrow(/no element with id nope/)
    expect(() => go('setData missions.missions.test-y {"id":"other"}')).toThrow(/must have id test-y/)
    expect(data.missions.missions.find((M) => M.id === 'tourist')!.steps[1]).not.toBe(t)   // the sim's own copy
  })
  it('a mission is played in its world (chapter 1 in the park alone too, not in the lab)', () => {
    const soma = createSim(loadPark('soma', data), data)
    expect(() => applyCommand(soma, parseCommand('mission start ch1'))).not.toThrow()
    expect(() => applyCommand(soma, parseCommand('mission start burrito'))).toThrow(/played in sf/)
    const lab = createSim(loadPark('lab', data), data)
    expect(() => applyCommand(lab, parseCommand('mission start ch1'))).toThrow(/played in sf or soma/)
  })
  it('a world with no mission hashes as before: no mission field, no actor Things', () => {
    const s2 = createSim(sf, data)
    for (let i = 0; i < 30; i++) step(s2, { b: 0 })
    expect('mission' in session(s2)).toBe(false)
    expect(s2.world.things.some((t) => t.kind === 'actor')).toBe(false)
    expect(skater(s2).alive).toBe(true)
  })
})

// The abundance rule (docs/story.md, tiny stories): every neighbourhood on the map (data/ui.json hoods) has
// at least three things to do within a minute's skate (360 m at 6 m/s) of its nearest rideable ground:
// stories (where their characters stand), Tour challenges, city goals, game starts, burritos and the
// city's named gaps. Neighbourhoods with no rideable ground within 320 m are outside the playable city:
// they are listed here, so the day the city reaches one this fails until it has its stories.
describe('abundance', () => {
  it('every neighbourhood has at least three things to do within a minute\'s skate', () => {
    const R = 360, OUTSIDE = ['Haight-Ashbury', 'South of Market']
    const sim = createSim(sf, data)
    const ui = readJson<{ places: { hoods: { name: string; at: [number, number] }[] } }>(rel('data/ui.json'))
    const things: { what: string; x: number; y: number }[] = []
    const add = (what: string, x: number, y: number) => things.push({ what, x, y })
    const mid = (b: number[]) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] as const
    for (const M of data.missions.missions) { const c = data.cast.cast.find((x) => x.id === M.giver); if (c) add(`story:${M.id}`, c.home[0], c.home[1]) }
    for (const L of data.tour.levels) { const p = findSpot(sim, L.spot); if (p && L.world !== 'soma') add(`challenge:${L.id}`, p.pos.x, p.pos.y) }
    const gaps = data.gaps.gaps as { id: string; box?: number[]; from?: number[] }[]
    for (const g of data.goals.goals as { id: string; box?: number[]; gaps?: string[] }[]) {
      const gp = g.gaps ? gaps.find((x) => x.id === g.gaps![0]) : undefined, b = g.box ?? gp?.box ?? gp?.from
      if (b) add(`goal:${g.id}`, ...mid(b))
    }
    const run = data.run
    add('courier', run.courier.start.pos[0], run.courier.start.pos[1])
    for (const b of [run.bomb, ...run.bomb.routes]) add(`bomb:${b.id}`, b.start.pos[0], b.start.pos[1])
    for (const l of run.muni.lines) add(`muni:${l.id}`, l.stops[0].at[0], l.stops[0].at[1])
    run.burritos.forEach((b, i) => add(`burrito:${i}`, b.pos[0], b.pos[1]))
    for (const g of gaps) { const b = g.box ?? g.from; if (b && Math.abs(b[0]) > 150) add(`gap:${g.id}`, ...mid(b)) }   // the park's own gaps are SoMa West's
    const rideable = (x: number, y: number) => {
      const h = raycast(sf, { x, y, z: 300 }, { x: 0, y: 0, z: -1 }, 600)
      return !!h && /^(city_(road|sidewalk|lot|park|path|alley|spot|plaza)|ground)/.test(sf.elements[sf.elem[h.tri]].collection)
    }
    const nearestGround = (x0: number, y0: number): [number, number] | null => {
      for (let r = 0; r <= 320; r += 4) {
        const n = Math.max(1, Math.round((2 * Math.PI * r) / 4))
        for (let k = 0; k < n; k++) { const a = (k / n) * 2 * Math.PI, x = x0 + Math.cos(a) * r, y = y0 + Math.sin(a) * r; if (rideable(x, y)) return [x, y] }
      }
      return null
    }
    const outside: string[] = [], short: string[] = []
    for (const h of ui.places.hoods) {
      const g = nearestGround(h.at[0], h.at[1])
      if (!g) { outside.push(h.name); continue }
      const near = things.filter((t) => Math.hypot(t.x - g[0], t.y - g[1]) < R).map((t) => t.what)
      if (near.length < 3) short.push(`${h.name} at ${h.at}: ${near.join(', ') || 'nothing'}`)
    }
    expect(short).toEqual([])
    expect([...new Set(outside)].sort()).toEqual(OUTSIDE)
  })
})

// Pacing (data/story.json pacing.check): a fresh player meets a story within 30 s of skating anywhere.
// Random routes along the streets (the traffic paths, their ends joined to the nearest other street
// within 15 m), seconds long at speed, from random street points (a fixed seed): at least share of them
// pass within the minimap rim's range of a story with nothing before it (its face on the rim, its light
// column in view), so a story is never more than about a minute away.
describe('pacing', () => {
  it('almost every 30-second street walk passes within the minimap rim of a story to start', () => {
    const story = readJson<{ pacing: { rim: { range: number }; check: { seconds: number; speed: number; share: number; walks: number } } }>(rel('data/story.json'))
    const C = story.pacing.check, MEET = story.pacing.rim.range, LEN = C.seconds * C.speed
    const open = data.missions.missions.filter((M) => !(M.after ?? []).length).map((M) => data.cast.cast.find((c) => c.id === M.giver)!.home)
    const nodes: [number, number][] = [], adj: number[][] = [], ends: number[] = []
    const link = (a: number, b: number) => { if (a !== b && !adj[a].includes(b)) { adj[a].push(b); adj[b].push(a) } }
    for (const p of sf.traffic.paths) {
      let prev = -1, last: number[] | null = null
      p.points.forEach((q, i) => {
        if (last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 8 && i < p.points.length - 1) return
        nodes.push([q[0], q[1]]); adj.push([]); last = q
        const n = nodes.length - 1
        if (prev >= 0) link(prev, n); else ends.push(n)
        prev = n
      })
      if (prev >= 0) ends.push(prev)
    }
    const key = (x: number, y: number) => `${Math.floor(x / 15)},${Math.floor(y / 15)}`
    const grid = new Map<string, number[]>()
    nodes.forEach(([x, y], i) => { const k = key(x, y); grid.set(k, [...grid.get(k) ?? [], i]) })
    const around = (x: number, y: number) => [-1, 0, 1].flatMap((dx) => [-1, 0, 1].flatMap((dy) => grid.get(`${Math.floor(x / 15) + dx},${Math.floor(y / 15) + dy}`) ?? []))
    for (const e of ends) {
      let best = -1, bd = 15
      for (const j of around(...nodes[e])) { const d = Math.hypot(nodes[j][0] - nodes[e][0], nodes[j][1] - nodes[e][1]); if (j !== e && !adj[e].includes(j) && d < bd) { bd = d; best = j } }
      if (best >= 0) link(e, best)
    }
    for (const ids of grid.values()) for (const a of ids) for (const b of ids) if (a < b && Math.hypot(nodes[a][0] - nodes[b][0], nodes[a][1] - nodes[b][1]) < 3) link(a, b)
    const near = nodes.map(([x, y]) => Math.min(...open.map((h) => Math.hypot(h[0] - x, h[1] - y))))
    let seed = 12345
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    let met = 0
    for (let w = 0; w < C.walks; w++) {
      let cur = Math.floor(rnd() * nodes.length), prev = -1, dist = 0, ok = near[cur] <= MEET
      while (!ok && dist < LEN) {
        const opts = adj[cur].filter((j) => j !== prev), nx = opts.length ? opts[Math.floor(rnd() * opts.length)] : prev
        if (nx < 0) break
        dist += Math.hypot(nodes[nx][0] - nodes[cur][0], nodes[nx][1] - nodes[cur][1]); prev = cur; cur = nx
        ok = near[cur] <= MEET
      }
      if (ok) met++
    }
    expect(met / C.walks).toBeGreaterThanOrEqual(C.share)
  })
})

// The drive missions (physics phase 30's steps): Kevin's Garbage Run empties data/vehicles.json routes.garbage's
// five bins in his truck, stopping at each; the tourist rides in the mission's van; the van errands drive their
// own vans, Catering without a bump. Every placed vehicle is a vehicle type (the schema checks the rest).
describe('drive missions', () => {
  it('use the drive steps and the tested garbage route', () => {
    const vehicles = readJson<{ types: Record<string, unknown>; routes: { garbage: { bins: number[][] } } }>(rel('data/vehicles.json'))
    const by = Object.fromEntries(data.missions.missions.map((M) => [M.id, M]))
    const g = by.garbage.steps[1]
    expect(g.kind === 'collect' && g.vehicle === 'kevins_truck' && g.stop).toBe(true)
    if (g.kind === 'collect') expect(g.items).toEqual(vehicles.routes.garbage.bins)
    expect(by.tourist.steps[1].kind).toBe('carry')
    const c = by.catering.steps[1]
    expect(c.kind === 'deliver' && c.vehicle === 'taqueria_van' && (c.noBump ?? 0) > 0).toBe(true)
    for (const id of ['garbage', 'tourist', 'boarddrop', 'catering']) for (const v of by[id].vehicles ?? []) expect(vehicles.types[v.type], `${id} ${v.name}`).toBeTruthy()
  })
})

// Interiors (the city export's rooms, city.interiors): a character with inside ("room/anchor")
// stands at that anchor when the world has the room (mission places that name them follow), and at home
// without it; the map draws each room's door (story.ts mapIcons).
describe('interiors', () => {
  it('Big Lou, Gloria and Hector stand at their anchors inside, and at home in a world without the rooms', () => {
    const inside = Object.fromEntries(data.cast.cast.filter((c) => c.inside).map((c) => [c.id, c.inside]))
    expect(inside).toEqual({ biglou: 'fog_city_skate_shop/clerk', gloria: 'city_hall_lobby/clerk', hector: 'taqueria/cook' })
    const s = createSim(sf, data)
    for (const [id, at] of Object.entries(inside)) {
      const [room, anchor] = at!.split('/'), a = sf.interiors.find((r) => r.id === room)?.anchors[anchor]
      expect(a, `${id}: ${at}`).toBeTruthy()
      expect(placeOf(s, session(s), `cast:${id}`)).toEqual([a![0], a![1], a![2]])
      expect(ground(a![0], a![1], a![2]), `${id} stands on the room's floor`).not.toBeNull()
    }
    const bare = createSim({ ...sf, interiors: [] }, data)
    expect(placeOf(bare, session(bare), 'cast:biglou')).toEqual(data.cast.cast.find((c) => c.id === 'biglou')!.home)
  })
})
