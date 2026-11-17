import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { Fx, type FxData } from '../src/client/fx.ts'
import { buildBoard } from '../src/client/skater/board.ts'
import { buildRoster, type CharactersData } from '../src/client/skater/characters.ts'
import type { RawPoseData } from '../src/client/skater/poses.ts'
import { SkaterView } from '../src/client/skater/view.ts'
import { loadData, loadPark, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater } from '../src/sim/sim.ts'

// Juice round the board (view only): sparks off metal, dust on hard landings, trucks turning with the
// carve, wheels spinning with the speed, and the cartoony bodies squashing on a big landing.

const data = loadData()
const d = JSON.parse(readFileSync(rel('data/effects.json'), 'utf8')) as FxData
const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData
const raw = JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData
const cam = new THREE.PerspectiveCamera()
const R = data.physics.skater.radius

/** Run a scenario through the effects frame by frame (as a clip does), summing what spawned. */
function run(name: string, from: number, to: number) {
  const sc = loadScenario(rel(`scenarios/${name}.skate`))
  const fx = new Fx(d, loadPark(sc.park, data), null)
  let sparks = 0, dust = 0
  for (let t = from; t <= to; t += 4) {
    const sk = skater(runScenario({ ...sc, ticks: t }, data).sim)
    cam.position.set(sk.pos.x, sk.pos.y - 4, sk.pos.z + 2)
    fx.update(t === from ? 0 : 4 / data.physics.tickHz, [sk], cam, R)
    sparks += fx.stats.sparks; dust += fx.stats.dust
  }
  return { sparks, dust }
}

describe('board effects', () => {
  it('sparks fly off a metal rail and an angle-iron ledge, not off a bare concrete curb', { timeout: 60000 }, () => {
    expect(run('lab-down-rail', 140, 180).sparks).toBeGreaterThan(20)
    expect(run('soma-5050-ledge', 40, 80).sparks).toBeGreaterThan(20)   // F42 has angle iron along its edge
    expect(run('lab-hill-curb-grind', 4, 60).sparks).toBe(0)   // a bare concrete curb
  })

  it('a hard landing throws up dust, a powerslide trails it', { timeout: 60000 }, () => {
    expect(run('soma-big3-kickflip', 318, 340).dust).toBeGreaterThan(5)
    expect(run('lab-powerslide', 12, 120).dust).toBeGreaterThan(20)
  })

  it('the trucks turn with the carve and the wheels spin with the speed', () => {
    const view = new SkaterView(buildRoster(chars), raw, chars)
    const sc = loadScenario(rel('scenarios/lab-carve-grip.skate'))
    const a = skater(runScenario({ ...sc, ticks: 60 }, data).sim), b = skater(runScenario({ ...sc, ticks: 64 }, data).sim)
    view.tick = 60; view.update(a, data, 0)
    const front = view.board.getObjectByName('truck:front')!, back = view.board.getObjectByName('truck:back')!, wheels = view.board.getObjectByName('wheels:front')!
    expect(Math.abs(front.rotation.z)).toBeGreaterThan(0.05)
    expect(Math.sign(front.rotation.z)).toBe(-Math.sign(back.rotation.z))   // front into the turn, back out
    const spin0 = wheels.rotation.y
    view.tick = 64; view.update(b, data, 0)
    // 4 ticks at about 6 m/s on 26.5 mm wheels: about 7.5 rad (wrapped), at most spinMaxStep in one go.
    expect(wheels.rotation.y).not.toBeCloseTo(spin0, 3)
  })

  it('a board is built in moving parts: deck (with flex), two trucks, their wheels', () => {
    const b = buildBoard()
    for (const n of ['deck', 'truck:back', 'truck:front', 'wheels:back', 'wheels:front']) expect(b.getObjectByName(n), n).toBeDefined()
    const deck = b.getObjectByName('deck')!.children[0] as THREE.Mesh
    expect(deck.morphTargetInfluences?.length).toBe(1)
  })

  it('the blob squashes on a big landing, the can a little, the tech bro not at all', () => {
    const view = new SkaterView(buildRoster(chars), raw, chars)
    const t = skater(runScenario({ ...loadScenario(rel('scenarios/soma-big3-kickflip.skate')), ticks: 328 }, data).sim)
    const squash = (id: string) => { view.setCharacter(id); view.tick = 328; view.update(t, data, 0); return 1 - view.character.root.scale.y }
    const blob = squash('blob'), can = squash('can'), tech = squash('techbro')
    expect(blob).toBeGreaterThan(0.05)
    expect(can).toBeGreaterThan(0)
    expect(can).toBeLessThan(blob / 2)
    expect(tech).toBe(0)
  })
})
