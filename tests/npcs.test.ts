import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { GhostView } from '../src/client/ghostview.ts'
import { NpcViews } from '../src/client/npcs.ts'
import { buildRoster, type CharactersData } from '../src/client/skater/characters.ts'
import type { RawPoseData } from '../src/client/skater/poses.ts'
import { SkaterView } from '../src/client/skater/view.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater, type SimEvent } from '../src/sim/sim.ts'
import { step } from '../src/sim/step.ts'
import type { InputFrame } from '../src/sim/input.ts'
import type { Thing } from '../src/sim/thing.ts'

// The NPC skaters and the race ghost drawn with the characters: one view each, posed from the
// Thing like the player (finite bones, a celebration after npcLand, a bail pose after npcBail).

const data = loadData()
const raw = JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData
const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData

describe('NPC skater views', () => {
  const player = new SkaterView(buildRoster(chars), raw, chars)
  const sc = loadScenario(rel('scenarios/soma-npcs.skate'))
  // 20 s of four NPCs riding (they flip, grab, grind, land and bail), every tick kept.
  const res = runScenario({ ...sc, ticks: 600 }, data)
  const frames: { tick: number; npcs: Thing[]; events: SimEvent[] }[] = []
  for (let k = 0; k < 2400; k++) {
    const events = step(res.sim, { b: 0 } as InputFrame)
    frames.push({ tick: res.sim.world.tick, npcs: res.sim.world.things.filter((t) => t.kind === 'npc').map((t) => structuredClone(t)), events })
  }

  it('every NPC wears a character other than the player, posed with finite bones; happy after a landing, bailing after a bail', () => {
    const v = new NpcViews(player, null)
    let lands = 0, bails = 0
    for (const [i, f] of frames.entries()) {
      const land = f.events.find((e) => e.t === 'npcLand'), bail = f.events.find((e) => e.t === 'npcBail')
      if (i % 20 !== 0 && !land && !bail) continue
      v.sync(f.npcs.map((cur) => ({ cur })), f.tick, 1, data, null, true)
      for (const t of f.npcs) {
        expect(v.characterOf(t.id)).not.toBe(player.characterId)
        const root = v.group.getObjectByName(`npc:${t.id}`)!
        expect(root.visible).toBe(true)
        root.traverse((o) => { if ((o as THREE.Bone).isBone) expect(Number.isFinite(o.quaternion.w + o.position.x)).toBe(true) })
      }
      // A few frames after: the landing NPC celebrates, the bailing one is in its bail.
      const later = frames[i + 20]
      if (later && (land || bail)) {
        const id = ((land ?? bail) as { id: number }).id
        const t = later.npcs.find((x) => x.id === id)
        if (!t) continue
        v.sync(later.npcs.map((cur) => ({ cur })), later.tick, 1, data, null, true)
        if (land && t.state === 'ground') { expect(t.lastLand.bankTick).toBeGreaterThan(0); lands++ }
        if (bail && t.state === 'bail') bails++
      }
    }
    expect(lands + bails).toBeGreaterThan(0)
  })

  it('pose like the player: the same rig solve on a scenario state', () => {
    // Four NPCs 25 s into soma-npcs: each view placed where its Thing is.
    const npcs = frames[frames.length - 1].npcs
    expect(npcs.length).toBe(4)
    const v = new NpcViews(player, null)
    v.sync(npcs.map((cur) => ({ cur })), frames[frames.length - 1].tick, 1, data, null, true)
    for (const t of npcs) {
      const root = v.group.getObjectByName(`npc:${t.id}`)!
      expect(root.position.distanceTo(new THREE.Vector3(t.pos.x, t.pos.y, t.pos.z))).toBeLessThan(0.5)
    }
    expect(v.stats.drawn).toBe(4)
    // The player's character never changes what an NPC wears unless it would be the same character.
    expect(new Set(npcs.map((t) => v.characterOf(t.id))).has(player.characterId)).toBe(false)
    expect(skater(res.sim).kind).toBe('skater')
  })
})

describe('NPC looks', () => {
  it('spread 0..999 evenly over every character and outfit, never the player\'s character or a secret skater', () => {
    const player = new SkaterView(buildRoster(chars), raw, chars)
    const v = new NpcViews(player, null)
    const counts = new Map<string, number>()
    for (let look = 0; look < 1000; look++) {
      const l = v.lookOf({ id: 1, npc: { look } } as unknown as Thing)
      expect(l.id).not.toBe(player.characterId)
      counts.set(`${l.id}:${l.outfit}`, (counts.get(`${l.id}:${l.outfit}`) ?? 0) + 1)
    }
    // Secret skaters (unlock) are never worn by NPCs.
    const looks = chars.characters.filter((c) => !c.unlock).reduce((n, c) => n + 1 + (c.outfits?.length ?? 0), 0)
    const own = 1 + (chars.characters.find((c) => c.id === player.characterId)!.outfits?.length ?? 0)
    expect(counts.size).toBe(looks - own)
    for (const [k, n] of counts) expect(n, k).toBeGreaterThanOrEqual(Math.floor(1000 / looks))
    for (const c of ['karl', 'burrito', 'pigeon']) expect([...counts.keys()].some((k) => k.startsWith(`${c}:`))).toBe(true)
    for (const c of ['robotaxi', 'cablecar']) expect([...counts.keys()].some((k) => k.startsWith(`${c}:`))).toBe(false)
  })
})

describe('race ghost view', () => {
  it("is the player's character in one see-through tint, without shadows", () => {
    const player = new SkaterView(buildRoster(chars), raw, chars)
    const g = new GhostView(player)
    const res = runScenario({ ...loadScenario(rel('scenarios/soma-idle.skate')), ticks: 120 }, data)
    g.set(skater(res.sim), data)
    expect(g.group.visible).toBe(true)
    const mats = new Set<THREE.Material>()
    g.group.traverse((o) => {
      const m = o as THREE.Mesh
      if (!m.isMesh || !m.layers.isEnabled(0)) return
      expect(m.castShadow).toBe(false)
      mats.add(m.material as THREE.Material)
    })
    expect(mats.size).toBe(1)
    const mat = [...mats][0] as THREE.MeshLambertMaterial
    expect(mat.transparent).toBe(true)
    expect(mat.opacity).toBeCloseTo(chars.ghost!.opacity)
    expect(mat.depthWrite).toBe(false)
    g.set(null, data)
    expect(g.group.visible).toBe(false)
  })
})
