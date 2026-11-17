import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { NpcViews } from '../src/client/npcs.ts'
import { buildRoster, type CharactersData } from '../src/client/skater/characters.ts'
import type { RawPoseData } from '../src/client/skater/poses.ts'
import { cheerTicks, DEFAULT_REACT, pointTicks, type NpcReact } from '../src/client/skater/react.ts'
import { SkaterView } from '../src/client/skater/view.ts'
import { npcPopTags, DEFAULT_POP } from '../src/client/tags.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater } from '../src/sim/sim.ts'
import type { Thing } from '../src/sim/thing.ts'

// Park NPCs reacting (view only, skater/react.ts and npcs.ts): cheering your combo (arms up, tail
// taps), pointing at you as they set off to copy your line, waiting off the board watching who
// rides; and their combos floating over them (tags.ts).

const data = loadData()
const raw = JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData
const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData
const R = chars.npcs?.react ?? DEFAULT_REACT
const react = (o: Partial<NpcReact>): NpcReact => ({ cheer: -1, point: -1, wait: 0, at: null, ...o })
const idle = skater(runScenario({ ...loadScenario(rel('scenarios/soma-idle.skate')), ticks: 10 }, data).sim)

/** Where the body faces in the drawn pose, degrees (stance space, + toward the nose): hips + spine + head. */
const facing = (v: SkaterView) => { const p = v.last!.pose; return p.hipsRot[0] + p.spine[0] + p.head[0] }

describe('NPC reactions', () => {
  const view = new SkaterView(buildRoster(chars), raw, chars)
  const at = (t: Thing, n: number, f: number) => {
    // A point n m toward the nose and f m out to the toe side (regular: the right of the board's forward).
    const fwd = new THREE.Vector3(t.fwd.x, t.fwd.y, 0).normalize(), toe = new THREE.Vector3(fwd.y, -fwd.x, 0).multiplyScalar(data.rider.stance === 'goofy' ? -1 : 1)
    return { x: t.pos.x + fwd.x * n + toe.x * f, y: t.pos.y + fwd.y * n + toe.y * f, z: t.pos.z + 1 }
  }

  it('waiting: off the board on the toe side, a foot resting on it, looking at who rides by', () => {
    view.tick = 1000
    for (const [n, f, want] of [[8, 0, 90], [0, 8, 0], [5, 5, 45]] as const) {
      view.react = react({ wait: 1, at: at(idle, n, f) })
      for (let k = 0; k < 40; k++) { view.tick++; view.update(idle, data, 0) }   // the head eases round
      const p = view.last!.pose
      expect(p.front.board).toBe(0)
      expect(p.back.board).toBe(1)
      expect(p.front.pos[1]).toBeGreaterThan(0.25)
      expect(Math.abs(facing(view) - want), `looking ${n} m ahead, ${f} m out`).toBeLessThan(6)
    }
    view.react = null
  })

  it('cheering: arms up, and the back foot taps the kicktail so the nose kicks up and slaps down', () => {
    view.tick = 2000
    const peak = R.tapFrom + R.tapEvery * 0.45, down = R.tapFrom + R.tapEvery * 0.8
    view.react = react({ cheer: peak, at: at(idle, 0, 6) })
    view.update(idle, data, 0)
    const up = view.last!.pose
    expect(up.lead.pos[2]).toBeGreaterThan(0.3)
    expect(up.rear.pos[2]).toBeGreaterThan(0.3)
    expect(up.board.pitch).toBeGreaterThan(R.tapPitch * 0.9)
    expect(up.back.pos[0]).toBeLessThan(-0.33)   // on the kicktail
    view.react = react({ cheer: down, at: at(idle, 0, 6) })
    view.update(idle, data, 0)
    expect(view.last!.pose.board.pitch).toBeLessThan(1)
    view.react = react({ cheer: R.cheerTicks + 5 })
    view.update(idle, data, 0)
    expect(view.last!.pose.lead.pos[2]).toBeLessThan(0)   // over: hands back down
    view.react = null
  })

  it('pointing: the hand on your side points at you', () => {
    view.tick = 3000
    view.react = react({ point: 40, at: at(idle, 10, 0) })
    for (let k = 0; k < 5; k++) view.update(idle, data, 0)
    const ahead = view.last!.pose.lead.pos
    expect(ahead[0]).toBeGreaterThan(0.4)            // out toward the nose, where you are
    view.react = react({ point: 40, at: at(idle, -10, 0) })
    view.tick += 100
    for (let k = 0; k < 5; k++) view.update(idle, data, 0)
    expect(view.last!.pose.rear.pos[0]).toBeLessThan(-0.4)   // behind: the other hand
    view.react = null
  })

  it('reads the sim: a cheer from npc.life.cheer, a point when it is placed at your start to copy you', () => {
    const res = runScenario({ ...loadScenario(rel('scenarios/soma-npc-react.skate')), ticks: 360 }, data)
    const npc = res.sim.world.things.find((t) => t.id === 3)!
    expect(cheerTicks(npc, 360, 0, R)).toBeCloseTo(360 - 337, 0)
    expect(pointTicks(npc, 0, R)).toBeGreaterThanOrEqual(0)
    expect(cheerTicks(npc, 337 + R.cheerTicks + 1, 0, R)).toBe(-1)
  })

  it('a waiting NPC is drawn standing on the ground, off its board, watching the one riding the spot', { timeout: 60000 }, () => {
    // soma-npc-sessions at 1440: NPC 3 waits at the top of the manual pad while NPC 5... and NPC 6 rides.
    const res = runScenario({ ...loadScenario(rel('scenarios/soma-npc-sessions.skate')), ticks: 1440 }, data)
    const npcs = res.sim.world.things.filter((t) => t.kind === 'npc' && t.alive)
    const waiting = npcs.filter((t) => t.npc?.act === 'wait')
    expect(waiting.length).toBeGreaterThanOrEqual(2)
    const player = new SkaterView(buildRoster(chars), raw, chars)
    const views = new NpcViews(player, null)
    views.you = skater(res.sim)
    views.sync(npcs.map((cur) => ({ cur })), res.sim.world.tick, 0, res.sim.data, null, true)
    const group = views.group
    for (const w of waiting) {
      const root = group.getObjectByName(`npc:${w.id}`)!
      expect(root.visible).toBe(true)
      root.updateMatrixWorld(true)
      // Feet on the ground beside the board (not floating where the sim holds it).
      expect(root.position.z).toBeLessThan(w.pos.z - data.physics.skater.radius + 0.05)
    }
  })
})

describe('NPC combo pops', () => {
  const soma = loadPark('soma', data)
  it('float over the NPC that landed one for a while, newest only, rising and fading', () => {
    // An NPC where the idle skater stands, seen from 6 m behind it.
    const t = { ...structuredClone(idle), id: 7, kind: 'npc' } as Thing
    const cam = new THREE.PerspectiveCamera(60, 16 / 9, 0.1, 500), p = t.pos, f = t.fwd
    cam.position.set(p.x - f.x * 6, p.y - f.y * 6, p.z + 2); cam.up.set(0, 0, 1); cam.lookAt(p.x, p.y, p.z + 1); cam.updateMatrixWorld(); cam.updateProjectionMatrix()
    const combos = [{ id: 7, tick: 50, name: 'Ollie', points: 50, multiplier: 1 }, { id: 7, tick: 100, name: 'Kickflip + 50-50 + Manual + Heelflip + Nosegrind + Kickflip', points: 1240, multiplier: 3 }]
    const hz = data.physics.tickHz, P = DEFAULT_POP
    const at = (tick: number) => npcPopTags(combos, [t], tick, hz, P, cam, soma, 1280, 720)
    const a = at(110), b = at(100 + hz)
    expect(a.length).toBe(1)
    expect(a[0].points).toBe(1240)
    expect(a[0].name.length).toBeLessThanOrEqual(P.maxName)
    expect(b[0].y).toBeLessThan(a[0].y)                                     // rises
    expect(at(100 + Math.round((P.seconds - 0.1) * hz))[0].opacity).toBeLessThan(0.5)   // fades
    expect(at(100 + Math.round(P.seconds * hz) + 1)).toEqual([])           // gone
  })
})
