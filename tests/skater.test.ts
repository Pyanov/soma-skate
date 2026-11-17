import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { BOARD, deckTopZ, halfWidth } from '../src/client/skater/board.ts'
import { buildCharacter, buildRoster, type CharactersData } from '../src/client/skater/characters.ts'
import { twoBone } from '../src/client/skater/ik.ts'
import { evaluate, resolvePoses, type RawPoseData } from '../src/client/skater/poses.ts'
import { SkaterView } from '../src/client/skater/view.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater } from '../src/sim/sim.ts'

// The skater view (src/client/skater): pose data, IK, and the full solve run headless in
// Node against real scenario states.

const data = loadData()
const raw = JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData

describe('poses.json', () => {
  const P = resolvePoses(raw)
  it('resolves, and every trick in tricks.json has a pose', () => {
    const T = data.tricks
    for (const g of T.grabs) expect(P.poses[P.grabs[g.id]?.pose], `grab ${g.id}`).toBeDefined()
    for (const g of T.grinds) expect(P.poses[P.grinds[g.id]], `grind ${g.id}`).toBeDefined()
    for (const s of T.slides) expect(P.poses[P.slides[s.id]], `slide ${s.id}`).toBeDefined()
    for (const l of T.lips) expect(P.poses[P.lips[l.id]], `lip ${l.id}`).toBeDefined()
    for (const [id, name] of Object.entries(P.flicks)) expect(P.poses[name], `flick ${id}`).toBeDefined()
    for (const [, name] of P.bail) expect(P.poses[name], `bail ${name}`).toBeDefined()
    for (const s of T.specials) if (s.kind === 'grab') expect(P.poses[P.grabs[s.id]?.pose], `special ${s.id}`).toBeDefined()
  })
  it('the evaluator is a pure function of the Thing', () => {
    const sc = loadScenario(rel('scenarios/lab-kickflip-lands.skate'))
    const t = skater(runScenario({ ...sc, ticks: 110 }, data).sim)
    expect(evaluate(t, data, 0.3, P)).toEqual(evaluate(structuredClone(t), data, 0.3, P))
  })
})

describe('board', () => {
  it('has real proportions: 0.81 x 0.21 deck, kicked tips, 53 mm wheels', () => {
    expect(BOARD.length).toBeCloseTo(0.81, 3)
    expect(2 * halfWidth(0)).toBeCloseTo(0.21, 3)
    expect(halfWidth(BOARD.length / 2)).toBeLessThan(0.01)
    expect(deckTopZ(-0.4, 0) - deckTopZ(0, 0)).toBeGreaterThan(0.04)
    expect(deckTopZ(0, 0.1)).toBeGreaterThan(deckTopZ(0, 0))   // concave
    expect(BOARD.wheelR * 2).toBeCloseTo(0.053, 3)
  })
})

describe('two-bone IK', () => {
  it('reaches a reachable target with the given bone lengths and bends toward the pole', () => {
    const a = new THREE.Vector3(0, 1, 0), t = new THREE.Vector3(0.2, 0.4, 0.1)
    const s = twoBone(a, 0.35, 0.4, t, new THREE.Vector3(0, 0, 1))
    expect(s.end.distanceTo(t)).toBeLessThan(1e-6)
    expect(s.mid.distanceTo(a)).toBeCloseTo(0.35, 6)
    expect(s.mid.distanceTo(s.end)).toBeCloseTo(0.4, 6)
    expect(s.mid.z).toBeGreaterThan(0.05)
  })
  it('straightens toward an out-of-reach target', () => {
    const a = new THREE.Vector3(), t = new THREE.Vector3(0, -2, 0)
    const s = twoBone(a, 0.3, 0.3, t, new THREE.Vector3(0, 0, 1))
    expect(s.end.y).toBeCloseTo(-0.6, 3)
  })
})

const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData

describe('characters.json', () => {
  it('every character builds, with the bones the solver drives and a sane rig', () => {
    // The roster builds the eager ones at startup; the lazy ones (the sticker cast) build when picked.
    const roster = buildRoster(chars)
    expect(roster.map((b) => b.spec.id)).toEqual(chars.characters.filter((c) => !c.lazy).map((c) => c.id))
    expect(roster.some((b) => b.spec.id === chars.default)).toBe(true)
    expect(chars.characters.filter((c) => c.lazy).map((c) => c.id)).toEqual(['karl', 'burrito', 'pigeon', 'robotaxi', 'cablecar', 'sealion'])
    for (const b of [...roster, ...chars.characters.filter((c) => c.lazy).map((c) => buildCharacter(c))]) {
      for (const n of ['Hips', 'Spine', 'Chest', 'UpperChest', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'LeftHandIndex1', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToes']) expect(b.character.bones.has(n), `${b.spec.id} ${n}`).toBe(true)
      const d = b.character.dims
      expect(d.leg, b.spec.id).toBeGreaterThan(0.15)
      expect(d.ankleH, b.spec.id).toBeGreaterThan(0.03)
    }
  })
  it('the sticker cast is built only when picked (startup builds the rest), board and all', () => {
    const view = new SkaterView(buildRoster(chars), raw, chars)
    expect(view.roster.some((b) => b.spec.lazy)).toBe(false)
    expect(view.cast.map((c) => c.id)).toEqual(chars.characters.map((c) => c.id))
    for (const id of ['karl', 'burrito', 'pigeon', 'robotaxi', 'cablecar', 'sealion']) {
      view.setCharacter(id)
      expect(view.characterId).toBe(id)
      expect(view.board.name).toBe(`board:${id}`)
    }
  })
  it('the board shop swaps a character\'s deck and wheels, and back to its own', () => {
    const view = new SkaterView(buildRoster(chars), raw, chars)
    view.update(skater(runScenario({ ...loadScenario(rel('scenarios/soma-idle.skate')), ticks: 10 }, data).sim), data, 0)
    const own = chars.characters[0].style.board!
    expect(view.boardDesign('can')).toEqual(own)
    const before = view.board, parent = before.parent
    expect(parent).not.toBe(null)
    view.setBoard('can', { graphic: 'goldengate', wheel: '#c0362c' })
    expect(view.boardDesign('can')).toEqual({ graphic: 'goldengate', wheel: '#c0362c' })
    expect(view.board).not.toBe(before)
    expect(view.board.parent).toBe(parent)   // in the old board's place
    expect(before.parent).toBe(null)
    view.setBoard('can', { graphic: '', wheel: '' })
    expect(view.boardDesign('can')).toEqual(own)
    // Another character's pick waits until it is worn.
    view.setBoard('pigeon', { graphic: 'muni' })
    view.setCharacter('pigeon')
    expect(view.boardDesign('pigeon').graphic).toBe('muni')
  })
  it('the colours panel paints a character, back to its own colours, and leaves the others alone', () => {
    const view = new SkaterView(buildRoster(chars), raw, chars)
    view.update(skater(runScenario({ ...loadScenario(rel('scenarios/soma-idle.skate')), ticks: 10 }, data).sim), data, 0)
    const colourOf = (name: string) => { let c = ''; view.character.root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined; if (!c && m?.name === name) c = m.color.getHexString() }); return c }
    const before = view.character
    view.setTint('can', { gold: '#27251f' })
    expect(view.character).not.toBe(before)
    expect(view.tintFor('can')).toEqual({ gold: '#27251f' })
    expect(colourOf('shoe')).toBe(new THREE.Color(chars.characters[0].colors.shoe).getHexString())   // what is not painted stays
    view.setCharacter('blob')
    view.setTint('blob', { gel: '#9fd6bd', deep: '#5f9a80' })
    expect(colourOf('gel')).toBe(new THREE.Color('#9fd6bd').getHexString())
    view.setTint('blob', null)
    expect(view.tintFor('blob')).toBe(null)
    expect(colourOf('gel')).toBe(new THREE.Color(chars.characters[1].colors.gel).getHexString())
    expect(view.tintFor('can')).toEqual({ gold: '#27251f' })   // kept for when the can is worn again
  })
  it('every outfit builds, and the view can wear it', () => {
    const view = new SkaterView(buildRoster(chars), raw, chars)
    for (const c of chars.characters) for (const o of c.outfits ?? []) {
      const b = buildCharacter(c, o.id)
      expect(b.outfit, `${c.id} ${o.id}`).toBe(o.id)
      expect(b.character.bones.has('LeftHand'), `${c.id} ${o.id}`).toBe(true)
      view.setCharacter(c.id, o.id)
      expect(view.outfitId).toBe(o.id)
    }
  })

  it('every character has an emote that plays with a finite pose and the feet still on the deck', () => {
    const view = sharedView()
    const sc = loadScenario(rel('scenarios/soma-idle.skate'))
    const still = skater(runScenario({ ...sc, ticks: 200 }, data).sim), T = 200
    for (const c of chars.characters) {
      expect(c.style.emote?.say, c.id).toBeTruthy()
      view.setCharacter(c.id)
      view.emoteTick = T
      for (const at of [0, 20, 60, 120, 170]) {
        view.tick = T + at
        view.update(structuredClone(still), data, 0)
        view.root.updateMatrixWorld(true)
        for (const b of view.character.bones.values()) expect(Number.isFinite(b.quaternion.w + b.position.x), `${c.id} ${b.name} at ${at}`).toBe(true)
        expect(view.mood!.emote, `${c.id} at ${at}`).toBeCloseTo(at)
        for (const side of ['Left', 'Right'] as const) {
          const p = view.board.worldToLocal(view.character.bones.get(`${side}Foot`)!.getWorldPosition(new THREE.Vector3()))
          expect(Math.abs(p.z - (deckTopZ(p.x, p.y) + view.character.dims.ankleH)), `${c.id} ${side} ankle at ${at}`).toBeLessThan(0.02)
        }
      }
      view.emoteTick = -1
      view.tick = -1
    }
  })
})

let shared: SkaterView | null = null
const states = new Map<string, ReturnType<typeof skater>>()   // scenario states, shared by every character
const sharedView = () => (shared ??= new SkaterView(buildRoster(chars), raw, chars))

// Every character runs the same poses through its own proportions: finite bones, feet on the
// deck while rolling, and every grab's hand on its spot on the board.
for (const ch of chars.characters) describe(`skater solve on scenario states: ${ch.id}`, () => {
  let view: SkaterView
  beforeAll(() => {
    view = sharedView()
    view.setCharacter(ch.id)
  })
  for (const [name, ticks] of [['lab-push-coast', 400], ['lab-kickflip-lands', 260], ['lab-grab-hold-points', 260], ['lab-5050-ledge', 460], ['lab-boardslide-rail', 340], ['lab-manual-from-flat', 330], ['lab-sideways-bail', 260], ['lab-walk-climb', 300], ['lab-powerslide', 120], ['lab-carve-grip', 125]] as const) {
    it(`${name}: finite pose every 5 ticks; feet on the deck while rolling`, () => {
      const sc = loadScenario(rel(`scenarios/${name}.skate`))
      for (let at = 5; at <= ticks; at += 5) {
        const key = `${name}@${at}`
        if (!states.has(key)) states.set(key, skater(runScenario({ ...sc, ticks: at }, data).sim))
        const t = structuredClone(states.get(key)!)
        view.update(t, data, 0)
        view.root.updateMatrixWorld(true)
        for (const b of view.character.bones.values()) expect(Number.isFinite(b.quaternion.x + b.quaternion.y + b.quaternion.z + b.quaternion.w), `${b.name} at ${at}`).toBe(true)
        const tag = view.last!.tag
        if (t.state === 'ground' && tag === 'ground') {
          // Standing on the board: ankles one ankle-height over the grip, in the board's own frame
          // (the deck rolls with the sim's lean in a carve).
          for (const side of ['Left', 'Right'] as const) {
            const p = view.board.worldToLocal(view.character.bones.get(`${side}Foot`)!.getWorldPosition(new THREE.Vector3()))
            expect(Math.abs(p.z - (deckTopZ(p.x, p.y) + view.character.dims.ankleH)), `${ch.id} ${side} ankle height at ${at}`).toBeLessThan(0.02)
          }
        }
      }
    })
  }

  it('every grab puts its hand on its spot on the board', () => {
    const P = resolvePoses(raw)
    const base = skater(runScenario({ ...loadScenario(rel('scenarios/lab-grab-hold-points.skate')), ticks: 130 }, data).sim)
    for (const id of [...data.tricks.grabs.map((g) => g.id), ...data.tricks.specials.filter((s) => s.kind === 'grab').map((s) => s.id)]) {
      const t = structuredClone(base)
      t.trick = { id, kind: 'grab', tick: 0, phase: 'hold', held: 10 }
      view.update(t, data, 0)
      view.root.updateMatrixWorld(true)
      const spec = P.grabs[id]
      const [n, f, u] = spec.at
      // The wrist sits just outside the grabbed edge (or tip), above the deck (board space: toe side is -y).
      const inward = Math.abs(n) > 0.3 ? new THREE.Vector3(-Math.sign(n), 0, 0) : new THREE.Vector3(0, Math.sign(f), 0)
      const want = new THREE.Vector3(n, -f, deckTopZ(n, -f) + u).addScaledVector(inward, -0.04).add(new THREE.Vector3(0, 0, 0.055))
      const wrist = view.board.worldToLocal(view.character.bones.get(spec.hand === 'lead' ? 'LeftHand' : 'RightHand')!.getWorldPosition(new THREE.Vector3()))
      expect(wrist.distanceTo(want), `${ch.id} ${id}: wrist to its grab point`).toBeLessThan(0.03)
    }
  })
})
