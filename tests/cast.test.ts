import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { CastPeople, kitIdle, openFacing, parseCast } from '../src/client/castpeople.ts'
import { KIT_PROPS, type KitRecipe } from '../src/client/skater/kitpeople.ts'
import { buildCharacter, type CharactersData } from '../src/client/skater/characters.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { buildPark } from '../src/sim/park/park.ts'
import type { ParkSource } from '../src/sim/park/source.ts'

// The open world's cast (src/client/skater/people.ts, src/client/castpeople.ts): the story's list parses
// (the contract's fields: id, name, sticker, voice, home, model), every person builds with the trait
// you read them by, they stand where their home spot says, turn to face you, offer a talk up close,
// and are not drawn far away.

const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData
const castJson = JSON.parse(readFileSync(rel('data/cast.json'), 'utf8'))
const data = loadData()

/** A 200 m square of flat ground. */
function flatPark() {
  const S = 100
  const src: ParkSource = {
    name: 'flat', hash: 'flat', positions: new Float32Array([-S, -S, 0, S, -S, 0, S, S, 0, -S, S, 0]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    elements: [{ id: 'floor', element: 'floor', collection: 'ground', feature: '', name: 'floor', type: '', role: 'body', tris: [0, 2] }],
    rails: [], spots: [{ id: 'start', label: 'start', xy: [0, 0], heading: 0 }], lines: [],
  }
  return buildPark(src, data.physics)
}

const names = (root: THREE.Object3D) => { const out = new Set<string>(); root.traverse((o) => { const m = (o as THREE.Mesh).material as THREE.Material | undefined; if (m?.name) out.add(m.name) }); return out }

describe('cast', () => {
  it('reads data/cast.json: every person built here is in it, as their own model, with their sticker', () => {
    const built = new Set([...chars.people!.map((p) => p.id), 'unit7'])
    const p = parseCast(castJson, built)
    expect(p.skipped).toBe(0)
    const mine = p.list.filter((e) => built.has(e.model))
    const kit = chars.people!.filter((c) => c.kit).map((c) => c.id)
    expect(kit.length).toBe(53)
    expect(mine.map((e) => e.id).sort()).toEqual(['biglou', 'brayden', 'chad', 'dolores', 'gloria', 'grandmawu', 'marisol', 'sal', 'unit7', ...kit].sort())
    for (const e of mine) { expect(e.sticker).toBe(kit.includes(e.id) ? `assets/ui/${e.id}.png` : `assets/ui/cast-${e.id}.png`); expect(readFileSync(rel(`assets/ui/portrait/${e.id}.jpg`)).length).toBeGreaterThan(1000); expect(e.standIn).toBeUndefined() }
    // Every kit person stands in their own model: no stand-ins left among them (none left in cast.json at all).
    for (const id of kit) expect(castJson.cast.find((c: { id: string }) => c.id === id)).toMatchObject({ model: { id } })
    expect(castJson.cast.filter((c: { standIn?: boolean }) => c.standIn).map((c: { id: string }) => c.id)).toEqual([])
    const bad = parseCast([{ id: 'a', name: 'A', model: 'chad' }, { id: 'b', name: 'B', model: 'chad', home: { x: 1 } }, null, { id: 'c', name: 'C', model: 'chad', home: { x: 1, y: 2 } }])
    expect(bad.skipped).toBe(3)
    expect(bad.list.map((e) => e.id)).toEqual(['c'])
    expect(parseCast(castJson.cast).list.length).toBe(castJson.cast.length)
    expect(parseCast(null)).toEqual({ list: [], skipped: 0 })
  })

  it('builds every person with their trait', () => {
    const trait: Record<string, string[]> = {
      chad: ['fleece vest', 'tablet', 'tablet screen'], biglou: ['knee brace', 'canvas apron', 'grey hair'], marisol: ['fisheye glass', 'camera body', 'cap'],
      gloria: ['stamp rubber', 'bead chain', 'cat-eye frames', 'clipboard'], grandmawu: ['cart wire', 'visor brim', 'grey perm'], brayden: ['AirPods', 'scooter green'],
      sal: ['lever steel', 'brass', 'moustache', 'leather gloves'], dolores: ['watch face', 'Muni red', 'operator cap'],
    }
    expect(chars.people!.filter((c) => !c.kit).map((c) => c.id).sort()).toEqual(Object.keys(trait).sort())
    for (const spec of chars.people!) {
      const b = buildCharacter(spec)
      expect(b.character.bones.has('Head'), spec.id).toBe(true)
      expect(b.face, spec.id).not.toBeNull()
      const have = names(b.character.root)
      for (const t of trait[spec.id] ?? []) expect(have.has(t), `${spec.id}: ${t}`).toBe(true)
      // A kit person wears their recipe's colours: the top and the hat you read them by.
      const K = spec.kit as KitRecipe | undefined
      if (K) {
        const all = [...have].join(' | ')
        if (K.top && !K.finish) expect(all, `${spec.id} top`).toContain(K.top.color)
        if (K.hat && !K.finish) expect(all, `${spec.id} hat`).toContain(K.hat.color)
        for (const pr of K.props ?? []) expect(KIT_PROPS, spec.id).toContain(pr.kind)
      }
      // Standing people, about a person's height (sole to the top of the head).
      b.character.root.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(b.character.root)
      expect(box.max.y, spec.id).toBeGreaterThan(1.2)
      expect(box.max.y, spec.id).toBeLessThan(2.3)
    }
  })

  it('stands at home, turns to you, offers a talk up close, and is not drawn far away', () => {
    const park = flatPark()
    const spot = { x: 10, y: 20, z: 0, heading: Math.PI / 2 }   // compass: facing east (+x)
    const entries = parseCast([{ id: 'lou', name: 'Big Lou', model: 'biglou', home: 'shop', stand: [3, 2] }, { id: 'u7', name: 'Unit 7', model: 'unit7', home: { x: -30, y: 0, heading: 0 } }]).list
    const cast = new CastPeople(entries, [...chars.people!, ...chars.characters], (id) => (id === 'shop' ? spot : null), park, null, chars.castView!)
    expect(cast.count).toBe(2)
    // Right of an east-facing spot is south (-y), ahead is east (+x).
    const lou = cast.placed[0]
    expect(lou.x).toBeCloseTo(12, 5); expect(lou.y).toBeCloseTo(17, 5); expect(lou.z).toBeCloseTo(0, 3)
    const holder = cast.group.children[0]
    const facing = () => { const v = new THREE.Vector3(0, -1, 0).applyQuaternion(holder.quaternion); return Math.atan2(v.y, v.x) }
    // At rest: facing the spot (back toward its middle).
    expect(Math.cos(facing() - Math.atan2(20 - 17, 10 - 12))).toBeGreaterThan(0.99)
    // You walk up from the south: within turnNear they turn to you; within talkNear they offer a talk.
    const you = new THREE.Vector3(12, 12, 0)
    for (let i = 0; i < 60; i++) cast.update(1 / 30, you, new THREE.Vector3(12, 8, 2))
    expect(Math.cos(facing() - Math.atan2(12 - 17, 0))).toBeGreaterThan(0.98)
    expect(cast.near).toBeNull()
    you.set(12, 15.5, 0)
    cast.update(1 / 30, you, new THREE.Vector3(12, 12, 2))
    expect(cast.near?.id).toBe('lou')
    // Far away: hidden.
    cast.update(1 / 30, new THREE.Vector3(500, 500, 0), new THREE.Vector3(500, 500, 2))
    expect(cast.group.children.every((c) => !c.visible)).toBe(true)
    expect(cast.near).toBeNull()
  })

  it('reads the story\'s cast.json: built people replace their stand-ins, the story can move or hide them', () => {
    // The story's shape (data/cast.json): home [x, y, z] with heading beside it, model { id, outfit }, standIn, sticker by name.
    const story = { cast: [
      { id: 'karl', name: 'Karl the Fog', sticker: 'karl', voice: 'karl', home: [7, 28.5, 0.62], heading: 222, area: 'SoMa', model: { id: 'karl' } },
      { id: 'chad', name: 'Chad Vantage', sticker: 'chad', voice: 'chad', home: [20, 30, 0], heading: 90, area: 'Hayes Valley', model: { id: 'techbro', outfit: 'fleece' }, standIn: true },
      { id: 'zed', name: 'Zed', sticker: 'zed', home: [46, 30, -0.97], heading: 200, model: { id: 'vampire', outfit: 'hoodie' }, standIn: true },
      { id: 'unit7', name: 'Unit 7', sticker: 'robotaxi', home: [-30, 0, 0], heading: 180, model: { id: 'robotaxi', outfit: 'coned' } },
    ] }
    const built = new Set([...chars.people!.map((p) => p.id), 'unit7'])
    const p = parseCast(story, built)
    expect(p.skipped).toBe(0)
    const by = Object.fromEntries(p.list.map((e) => [e.id, e]))
    expect(by.chad).toMatchObject({ model: 'chad', home: { x: 20, y: 30, z: 0, heading: 90 }, sticker: 'assets/ui/chad.png' })
    expect(by.chad.standIn).toBeUndefined(); expect(by.chad.outfit).toBeUndefined()
    expect(by.unit7.model).toBe('unit7')
    expect(by.zed).toMatchObject({ model: 'vampire', outfit: 'hoodie', standIn: true })   // not built here: the story's own view draws them
    expect(by.karl.model).toBe('karl')
    const mine = p.list.filter((e) => built.has(e.model))
    expect(mine.map((e) => e.id)).toEqual(['chad', 'unit7'])
    const cast = new CastPeople(mine, [...chars.people!, ...chars.characters], () => null, flatPark(), null, chars.castView!)
    expect(cast.has('chad')).toBe(true); expect(cast.has('zed')).toBe(false)
    // Heading 90 (compass: east): Chad faces +x.
    const holder = cast.group.children[0]
    const facing = () => { const v = new THREE.Vector3(0, -1, 0).applyQuaternion(holder.quaternion); return Math.atan2(v.y, v.x) }
    expect(Math.cos(facing())).toBeGreaterThan(0.99)
    // A mission puts him elsewhere, a ride hides him, then home again.
    cast.setOverride('chad', { x: -10, y: 5, z: 0, heading: 0 })
    cast.update(1 / 30, new THREE.Vector3(80, 80, 0), new THREE.Vector3(-10, 0, 2))
    expect(cast.placed[0]).toMatchObject({ x: -10, y: 5 }); expect(holder.visible).toBe(true)
    cast.setOverride('chad', 'hidden')
    cast.update(1 / 30, new THREE.Vector3(80, 80, 0), new THREE.Vector3(-10, 0, 2))
    expect(holder.visible).toBe(false)
    cast.setOverride('chad', null)
    cast.update(1 / 30, new THREE.Vector3(80, 80, 0), new THREE.Vector3(20, 25, 2))
    expect(cast.placed[0]).toMatchObject({ x: 20, y: 30 }); expect(holder.visible).toBe(true)
  })
  it('every kit idle holds its props in the kit frames, through its loop, near and far', () => {
    for (const spec of chars.people!.filter((c) => c.kit)) {
      const b = buildCharacter(spec), D = b.character.dims, K = spec.kit as KitRecipe
      for (const t of [0, 1.3, 4.7, 9.1]) for (const near of [false, true]) {
        const I = kitIdle(K.idle, t, 0.3, near, D)
        expect(I.rw ?? I.lw, `${spec.id} ${K.idle}: an idle of its own`).toBeDefined()
        expect(I.rhand && I.lhand, `${spec.id}: hand frames`).toBeTruthy()
        for (const v of [...(I.rw ?? []), ...(I.lw ?? []), ...(I.rhand ?? []).flat(), ...(I.lhand ?? []).flat(), ...(I.spine ?? []), ...(I.head ?? [])]) expect(Number.isFinite(v), spec.id).toBe(true)
      }
    }
  })

  it('draws a member in full near, as the baked rig further off, and as one mesh beyond simpleBeyond (low)', () => {
    const entries = parseCast([{ id: 'ramon', name: 'Don Ram\u00f3n', model: 'ramon', home: { x: 0, y: 0, z: 0, heading: 0 } }]).list
    const cast = new CastPeople(entries, [...chars.people!, ...chars.characters], () => null, flatPark(), null, chars.castView!)
    const you = new THREE.Vector3(0, 40, 0)
    cast.update(1 / 30, you, new THREE.Vector3(0, 4, 1.6))
    const near = cast.drawn
    cast.update(1 / 30, you, new THREE.Vector3(0, 20, 1.6))
    const far = cast.drawn
    cast.simpleBeyond = 30
    cast.update(1 / 30, you, new THREE.Vector3(0, 40, 1.6))
    const statue = cast.drawn
    expect(near).toBeGreaterThan(far)
    expect(far).toBeLessThan(40)
    expect(statue).toBe(1)
    cast.update(1 / 30, you, new THREE.Vector3(0, 4, 1.6))
    expect(cast.drawn).toBe(near)
  })

  it('never stands a member nose to a wall', () => {
    // A wall 1 m east of the home: facing east, they turn to an open way; facing west, they keep it.
    const S = 100
    const src: ParkSource = {
      name: 'wall', hash: 'wall', positions: new Float32Array([-S, -S, 0, S, -S, 0, S, S, 0, -S, S, 0, 1, -5, 0, 1, 5, 0, 1, 5, 4, 1, -5, 4]), indices: new Uint32Array([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]),
      elements: [{ id: 'floor', element: 'floor', collection: 'ground', feature: '', name: 'floor', type: '', role: 'body', tris: [0, 2] }, { id: 'wall', element: 'wall', collection: 'city_building', feature: '', name: 'wall', type: '', role: 'body', tris: [2, 2] }],
      rails: [], spots: [{ id: 'start', label: 'start', xy: [0, 0], heading: 0 }], lines: [],
    }
    const park = buildPark(src, data.physics)
    const turned = openFacing(park, 0, 0, 0, 0)
    expect(Math.cos(turned)).toBeLessThan(0.75)
    expect(openFacing(park, 0, 0, 0, Math.PI)).toBe(Math.PI)
  })
})
