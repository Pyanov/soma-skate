import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { beforeEach, describe, expect, it } from 'vitest'
import { awardPiece, CAS_KEY, CasLocks, casKit, casSpec, defaultChoices, loadSkaters, randomChoices, randomName, rng, ROWS, saveSkaters, type CasData, type CasItem } from '../src/client/cas.ts'
import { buildCharacter, type HookCtx } from '../src/client/skater/characters.ts'
import { KIT_PROPS } from '../src/client/skater/kitpeople.ts'
import { rel } from '../src/harness/io.ts'

// Create-a-Skater (src/client/cas.ts, data/cas.json): the catalogue holds together, every piece builds on the
// skater rig, the randomizer makes valid (and repeatable) skaters, the slots save and load, locked pieces
// open with their mission, sticker or an award, and a created skater carries its riding style and its prop.

const d = JSON.parse(readFileSync(rel('data/cas.json'), 'utf8')) as CasData
const lists = ['bodies', 'heights', 'faces', 'hair', 'beards', 'hats', 'glasses', 'tops', 'patterns', 'bottoms', 'layers', 'extras', 'props', 'attitudes', 'specials', 'bails', 'emotes'] as const
const store = new Map<string, string>()
;(globalThis as unknown as { localStorage: Storage }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v) }, removeItem: (k: string) => { store.delete(k) }, clear: () => store.clear(), key: () => null, length: 0 } as Storage
const career = (done: string[] = []) => ({ total: 0, count: () => 0, story: (id: string) => done.includes(id) })
const hook = (over: Partial<HookCtx>): HookCtx => ({ speed: 0, up: 0, air: false, crouch: 0, landed: -1, squash: 0, ticks: 0, mood: 'chill', idle: 0, bail: false, walk: 0, phone: false, special: 0, specialQ: 0, specialT: 0, specialId: '', bailT: -1, idleName: '', idleT: 0, idleK: 0, root: new THREE.Group(), ground: null, ...over })

describe('Create-a-Skater', () => {
  beforeEach(() => store.clear())

  it('holds together: unique ids, rows that point at real lists and palettes, the listed unlockable pieces', () => {
    for (const l of lists) {
      const ids = d[l].map((x) => x.id)
      expect(new Set(ids).size, l).toBe(ids.length)
      expect(ids.length, l).toBeGreaterThan(1)
      for (const it of d[l]) if (it.unlock) expect(it.unlock.hint.length, `${l} ${it.id}`).toBeGreaterThan(4)
    }
    for (const row of ROWS) expect(row.list ? d[row.list] : d.palettes[row.palette!], row.key).toBeTruthy()
    for (const p of d.props) if (p.prop) expect(KIT_PROPS, p.id).toContain(p.prop)
    for (const s of d.specials) expect(Object.keys(s.names as object).sort()).toEqual(['540flip', 'christair', 'kickflipsuperman'])
    // The pieces the Story can award: the Muni conductor's cap, Karl's sunglasses, the burrito costume, the Sea Lion's skipper cap.
    expect(d.hats.find((x) => x.id === 'muni')?.unlock?.story).toBe('delay')
    expect(d.glasses.find((x) => x.id === 'karl')?.unlock?.story).toBe('ch1')
    expect(d.layers.find((x) => x.id === 'burrito')?.unlock?.story).toBe('burrito')
    expect(d.hats.find((x) => x.id === 'skipper')?.unlock?.story).toBe('barnacle')
  })

  it('builds every piece of every row on the full skater rig, a person tall', () => {
    for (const row of ROWS) {
      const options = row.list ? d[row.list].map((x) => x.id) : d.palettes[row.palette!].map((p) => p.color)
      for (const v of options) {
        const spec = casSpec({ id: 'cas1', name: 'Test', choices: { ...defaultChoices(d), [row.key]: v } }, d)
        const b = buildCharacter(spec)
        expect(b.character.bones.has('LeftHandIndex1'), `${row.key} ${v}`).toBe(true)
        b.character.root.updateMatrixWorld(true)
        const h = new THREE.Box3().setFromObject(b.character.root).max.y
        expect(h, `${row.key} ${v}`).toBeGreaterThan(1.3)
        expect(h, `${row.key} ${v}`).toBeLessThan(2.6)
      }
    }
  })

  it('randomizes valid, repeatable skaters from the open pieces only, with funny names', () => {
    const locks = new CasLocks(career(), () => false)
    const open = (it: CasItem) => !locks.locked(it)
    const a = randomChoices(d, rng(5), open), b = randomChoices(d, rng(5), open)
    expect(a).toEqual(b)
    for (let i = 0; i < 30; i++) {
      const r = rng(100 + i), c = randomChoices(d, r, open), name = randomName(d, r)
      expect(name.length).toBeLessThanOrEqual(d.nameMax)
      for (const row of ROWS) if (row.list) { const it = d[row.list].find((x) => x.id === c[row.key]); expect(it, row.key).toBeTruthy(); expect(locks.locked(it!), `${row.key} ${it!.id}`).toBe(false) }
      expect(() => buildCharacter(casSpec({ id: 'cas2', name, choices: c }, d))).not.toThrow()
    }
  })

  it('keeps up to four skaters, saved like kit recipes, and loads them back', () => {
    const k = { id: 'cas2', name: 'Lil\' Pothole', choices: randomChoices(d, rng(9)) }
    saveSkaters([null, k, null, null], d)
    const raw = JSON.parse(store.get(CAS_KEY)!)
    expect(raw.length).toBe(4)
    expect(raw[1].kit.top.color).toBe(k.choices.topColor)
    expect(raw[1].kit.face.iris).toBe(k.choices.eyes)
    const back = loadSkaters(d)
    expect(back[0]).toBeNull()
    expect(back[1]).toMatchObject({ id: 'cas2', name: 'Lil\' Pothole', choices: k.choices })
    // A broken save keeps what it can.
    store.set(CAS_KEY, JSON.stringify([{ name: 'X', choices: { hat: 'cone', bogus: 1 } }, 'nope']))
    const fixed = loadSkaters(d)
    expect(fixed[0]?.choices.hat).toBe('cone'); expect(fixed[0]?.choices.top).toBe(defaultChoices(d).top); expect(fixed[1]).toBeNull()
  })

  it('opens locked pieces with their mission, sticker or an award, and shows their hint', () => {
    const skipper = d.hats.find((x) => x.id === 'skipper')!, cone = d.hats.find((x) => x.id === 'cone')!, karl = d.glasses.find((x) => x.id === 'karl')!
    const none = new CasLocks(career(), () => false)
    expect(none.locked(skipper)).toBe(true)
    expect(none.hint(skipper)).toMatch(/Barnacle/)
    expect(new CasLocks(career(['barnacle']), () => false).locked(skipper)).toBe(false)
    expect(new CasLocks(career(), (id) => id === 'robotaxi').locked(cone)).toBe(false)
    expect(new CasLocks(career(), () => false, 'all').locked(karl)).toBe(false)
    awardPiece('karl')
    expect(none.locked(karl)).toBe(false)
    // Announced once.
    const L = new CasLocks(career(['barnacle']), () => false)
    expect(L.fresh(d).map((x) => x.id)).toContain('skipper')
    expect(L.fresh(d).map((x) => x.id)).not.toContain('skipper')
  })

  it('rides like a hand-built skater: its attitude, special, bail and taunt; the prop out only when standing or celebrating', () => {
    const c = { ...defaultChoices(d), attitude: 'goofy', special: 'bighead', bail: 'flop', emote: 'dab', prop: 'flag', layer: 'burrito', hat: 'cone' }
    const spec = casSpec({ id: 'cas1', name: 'Professor Waffles', choices: c }, d)
    expect(spec.style.signature).toBe('bighead')
    expect(spec.style.flair?.bail).toBe('flop')
    expect(spec.style.emote).toMatchObject({ kind: 'dab' })
    expect(spec.style.squash).toBeGreaterThan(0.3)
    expect(casKit(c, d).signature).toBe('flag')
    const b = buildCharacter(spec)
    const sig = b.character.root.userData.signature as { groups: THREE.Object3D[]; hands: Record<string, string>; out: boolean }
    expect(sig.groups.length).toBeGreaterThan(0)
    expect(sig.hands.Right).toBe('grip')
    expect(sig.groups.every((g) => !g.visible)).toBe(true)
    b.hook!(hook({ idleK: 1 }))
    expect(sig.out).toBe(true); expect(sig.groups.every((g) => g.visible)).toBe(true)
    b.hook!(hook({ speed: 6, idleK: 0 }))
    expect(sig.out).toBe(false)
    b.hook!(hook({ landed: 20 }))
    expect(sig.out).toBe(true)
  })
})
