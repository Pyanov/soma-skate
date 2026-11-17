import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ACTS, actPose, vigPoint, Vignettes, type VignetteData } from '../src/client/vignettes.ts'
import { Crowd, type CrowdData } from '../src/client/crowd.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { raycast } from '../src/sim/park/park.ts'
import type { SimEvent } from '../src/sim/sim.ts'
import * as THREE from 'three'

// Lines whose recording is pending: the client shows their caption alone until the mp3 exists.
const AWAITING_VOICE = new Set(['vig-post-1'])

// The ambient vignettes (data/vignettes.json, src/client/vignettes.ts): the data holds together (ids, looks, acts,
// voiced lines with their mp3s), everyone stands on the ground where their vignette is, every act's pose is sound,
// the reactions and lines come when they should (and not again too soon), and the crowd carries their people.

const V = JSON.parse(readFileSync(rel('data/vignettes.json'), 'utf8')) as VignetteData
const P = JSON.parse(readFileSync(rel('data/pedestrians.json'), 'utf8')) as CrowdData
const voices = JSON.parse(readFileSync(rel('data/voices.json'), 'utf8')) as { voices: Record<string, unknown> }
const sf = loadPark('sf', loadData())
const FOOT = new Set(['city_sidewalk', 'city_path', 'city_spot', 'city_park', 'city_lot', 'city_stoop', 'city_plaza', 'city_alley', 'ground', 'city_curb', 'city_road'])
const ground = (x: number, y: number) => { const h = raycast(sf, { x, y, z: 400 }, { x: 0, y: 0, z: -1 }, 800); return h ? { z: h.point.z, c: sf.elements[sf.elem[h.tri]]?.collection ?? '' } : null }

describe('vignettes', () => {
  it('hold together: unique ids, known looks and acts, voiced lines with their mp3s, a few people each', () => {
    const ids = V.vignettes.map((v) => v.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.length).toBeGreaterThanOrEqual(15)
    const lineIds = new Set<string>()
    for (const v of V.vignettes) {
      expect(v.members.length, v.id).toBeGreaterThan(0)
      expect(v.members.length, v.id).toBeLessThanOrEqual(5)
      for (const m of v.members) { expect(P.types[m.type], `${v.id} ${m.type}`).toBeTruthy(); expect(ACTS as readonly string[], `${v.id} ${m.act}`).toContain(m.act) }
      expect(v.lines.length, v.id).toBeGreaterThanOrEqual(2)
      for (const l of v.lines) {
        expect(lineIds.has(l.id), l.id).toBe(false); lineIds.add(l.id)
        expect(['combo', 'trick', 'grind', 'pass']).toContain(l.on)
        expect(voices.voices[l.voice], `${l.id} voice ${l.voice}`).toBeTruthy()
        expect(existsSync(rel(`assets/sound/voice/${l.id}.mp3`)), `${l.id}.mp3`).toBe(!AWAITING_VOICE.has(l.id))
      }
    }
  })

  it('everyone stands on the ground at their vignette (sidewalks, parks, plazas; the parklet in the parking lane)', () => {
    for (const v of V.vignettes) for (const m of v.members) {
      const w = vigPoint(v, m.at[0], m.at[1]), g = ground(w.x, w.y)
      expect(g, `${v.id} ${m.act} at ${w.x.toFixed(1)},${w.y.toFixed(1)}`).not.toBeNull()
      expect(FOOT.has(g!.c), `${v.id}: ${g!.c}`).toBe(true)
      if (g!.c === 'city_road') expect(v.id).toBe('castro-brunch')
    }
  })

  it('every act poses with finite joints, through its loop and its reactions', () => {
    for (const act of ACTS) for (const t of [0, 0.37, 2.9, 41.2]) for (const react of [null, { kind: 'statue', age: 0.8 }, { kind: 'film', age: 1 }]) {
      const A = actPose(act, t, { seed: 0.31, seat: 0.46, side: 1 }, react)
      const nums = [A.hipZ, A.lean, A.roll, A.lie, A.yaw, A.lift, ...(A.head ?? []), ...(A.arms ?? []).flat(), ...(A.legs ?? []).flat()].filter((x) => x !== undefined) as number[]
      for (const n of nums) expect(Number.isFinite(n), `${act} at ${t}`).toBe(true)
    }
  })

  it('reacts to a big combo, a trick, a grind and skating through, and speaks no sooner than its cooldowns allow', () => {
    const vg = new Vignettes(V, sf, null)
    const said: string[] = []
    vg.say = (id) => said.push(id)
    const i = V.vignettes.findIndex((v) => v.id === 'market-chess'), chess = V.vignettes[i], c = vigPoint(chess, 0, 0)
    const cam = new THREE.Vector3(c.x, c.y, 10)
    vg.update(100, null, cam)
    vg.event({ t: 'comboLanded', tick: 0, name: 'Kickflip', points: V.bigPoints + 1, multiplier: 1, entries: [] } as SimEvent, c.x + 3, c.y)
    expect(vg.state(i)?.kind).toBe('look')
    expect(said.length).toBe(1)
    expect(chess.lines.find((l) => l.id === said[0])?.on).toBe('combo')
    // Again at once: the look again, no line (the vignette's cooldown).
    vg.event({ t: 'comboLanded', tick: 0, name: 'Kickflip', points: V.bigPoints + 1, multiplier: 1, entries: [] } as SimEvent, c.x + 3, c.y)
    expect(said.length).toBe(1)
    // A small combo far off does nothing.
    vg.update(200, null, cam)
    vg.event({ t: 'comboLanded', tick: 0, name: 'Ollie', points: 10, multiplier: 1, entries: [] } as SimEvent, c.x + 3, c.y)
    expect(said.length).toBe(1)
    // The cafe flinches at a grind near it; the statue comes alive when you skate through, once per pass.
    const cafeI = V.vignettes.findIndex((v) => v.id === 'valencia-cafe'), cafe = V.vignettes[cafeI], q = vigPoint(cafe, 0, 0)
    vg.event({ t: 'grindStart', tick: 0, trick: '50-50', line: 'bench', slide: false } as SimEvent, q.x - 3, q.y)
    expect(vg.state(cafeI)?.kind).toBe('flinch')
    expect(said.length).toBe(2)
    const stI = V.vignettes.findIndex((v) => v.id === 'pier39-statue'), st = V.vignettes[stI], sp = vigPoint(st, 0, 0)
    vg.update(300, { x: sp.x + 30, y: sp.y, z: 0, speed: 6 }, cam)
    vg.update(300.1, { x: sp.x + 1, y: sp.y, z: -8.6, speed: 6 }, cam)
    expect(vg.state(stI)?.kind).toBe('statue')
    const before = said.length
    vg.update(300.2, { x: sp.x + 0.5, y: sp.y, z: -8.6, speed: 6 }, cam)   // still inside: not again
    expect(said.length).toBe(before)
    // The busker takes a tip for a trick near him.
    let tips = 0
    vg.tip = () => tips++
    const bk = V.vignettes.find((v) => v.id === 'powell-busker')!, b = vigPoint(bk, 0, 0)
    vg.event({ t: 'trickStart', tick: 0, trick: 'Kickflip' } as SimEvent, b.x + 2, b.y)
    expect(tips).toBe(1)
  })

  it("their people are the crowd's: placed with their vignette, first in line, low drops the extras", () => {
    const crowd = new Crowd(sf, { ...P, vignettes: V }, null)
    const n = V.vignettes.reduce((a, v) => a + v.members.length, 0)
    const vig = crowd.people.slice(0, n) as unknown as { vig: number; spare: boolean; act: string }[]
    expect(vig.every((p) => p.vig >= 0 && p.act)).toBe(true)
    expect((crowd.people[n] as unknown as { vig: number }).vig).toBe(-1)
    const extras = V.vignettes.reduce((a, v) => a + v.members.filter((m) => m.extra).length, 0)
    expect(vig.filter((p) => p.spare).length).toBe(extras)
    expect(extras).toBeGreaterThan(5)
  })
})
