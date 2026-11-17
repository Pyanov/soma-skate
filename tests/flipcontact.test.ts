import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { BOARD, DECK_BOTTOM, DECK_TOP, halfWidth, kick } from '../src/client/skater/board.ts'
import { buildRoster, type CharactersData } from '../src/client/skater/characters.ts'
import type { RawPoseData } from '../src/client/skater/poses.ts'
import { SkaterView } from '../src/client/skater/view.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater } from '../src/sim/sim.ts'

// The legs clear the board in every flip (view only): from the flick to the catch, while the feet are
// off it, no point of a shin (knee to near the ankle) or thigh comes within a leg's radius of the deck
// as it turns. The hardflip and inward heelflip stand the board up between the legs, the impossible
// wraps it round the back foot: those spread and lift the legs (poses.json flipTuckWide, flipImpossible).

const data = loadData()
const raw = JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData
const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData
const LEG = 0.045   // a shin's radius, about

/** How far a board-space point is inside the deck slab grown by LEG (negative: clear of it). */
function inside(p: THREE.Vector3): number {
  const half = BOARD.length / 2
  const dx = Math.abs(p.x) - half, dy = Math.abs(p.y) - halfWidth(Math.min(half, Math.abs(p.x)))
  const lo = DECK_BOTTOM - 0.004 + kick(Math.min(half, Math.abs(p.x))), hi = DECK_TOP + kick(Math.min(half, Math.abs(p.x)))
  const dz = Math.max(lo - p.z, p.z - hi)
  return LEG - Math.max(dx, dy, dz)
}

const flips = data.tricks.flips.map((f) => f.id)

describe('legs clear the board in every flip', () => {
  let view: SkaterView
  beforeAll(() => {
    view = new SkaterView(buildRoster(chars), raw, chars)
    view.setCharacter('techbro')
  })
  for (const id of flips) {
    it(`${id}: no shin or thigh through the turning board`, () => {
      const def = data.tricks.flips.find((f) => f.id === id)!
      const sc = loadScenario(rel(`scenarios/lab-${id}-lands.skate`))
      let worst = { d: -1, at: '' }
      for (const q of [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.72]) {
        const tick = 97 + Math.round(def.ticks * q) + ((def.taps ?? 1) - 1) * 3   // the scenarios tap J again every 3 ticks
        const t = skater(runScenario({ ...sc, ticks: tick }, data).sim)
        view.update(t, data, 0)
        view.root.updateMatrixWorld(true)
        const B = view.character.bones
        const local = (name: string) => view.board.worldToLocal(B.get(name)!.getWorldPosition(new THREE.Vector3()))
        for (const side of ['Left', 'Right']) {
          const hip = local(`${side}UpLeg`), knee = local(`${side}Leg`), ankle = local(`${side}Foot`)
          for (let i = 0; i <= 10; i++) {
            const k = i / 10
            for (const [p, what] of [[hip.clone().lerp(knee, k), 'thigh'], [knee.clone().lerp(ankle, k * 0.8), 'shin']] as const) {
              const d = inside(p)
              if (d > worst.d) worst = { d, at: `${Math.round(q * 100)}% ${side === 'Left' ? 'front' : 'back'} ${what}` }
            }
          }
        }
      }
      expect(worst.d, `${id}: the ${worst.at} ${(worst.d * 100).toFixed(1)} cm into the board`).toBeLessThan(0.005)
    })
  }
})
