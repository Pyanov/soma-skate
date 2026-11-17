import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildRoster, type CharactersData } from '../src/client/skater/characters.ts'
import type { RawPoseData } from '../src/client/skater/poses.ts'
import { SkaterView } from '../src/client/skater/view.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater } from '../src/sim/sim.ts'
import type { Thing } from '../src/sim/thing.ts'

// Motion, not stills (view only): through real sequences, tick by tick, the board's orientation relative
// to the rider, every joint's rotation and the pelvis position must change smoothly. A snap is a one-tick
// jump well above both neighbouring ticks' change (excess = this tick's change minus the larger of the
// ticks before and after; a fast but steady turn, like a flip, has no excess, and neither has a turn that
// starts or stops). The worst ten are printed with scenario and tick; the test fails above SNAP.

const data = loadData()
const raw = JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData
const chars = JSON.parse(readFileSync(rel('data/characters.json'), 'utf8')) as CharactersData

/** [scenario, from tick, to tick]: ollie, kickflip, grinds and slides in and out, manual, transition air with a grab, revert, bail. */
export const SEQUENCES: [string, number, number][] = [
  ['lab-ollie-height', 40, 250], ['lab-kickflip-lands', 60, 240], ['lab-ollie-off-grind', 150, 400],
  ['lab-line-crooked-kickflip', 150, 380], ['lab-line-noseslide-shoveit', 100, 360], ['lab-line-boardslide-pop', 100, 320],
  ['lab-kickflip-to-manual', 60, 320], ['lab-line-tailslide', 120, 410], ['lab-grind-table-fs', 170, 345], ['lab-vert-grab', 180, 380], ['lab-revert', 280, 470], ['lab-early-land-bails', 60, 330],
]
/**
 * A snap's score: excess degrees of a joint / 12, of the board / 8, of the rider's heading in the world / 10,
 * centimetres of the pelvis / 2.5. The aim is
 * under 1.6; SNAP is a ratchet just over the worst one left (a bail's pelvis in the air, 2026-11-10), to be lowered
 * as the rest are fixed, so no new snap can come in above it.
 */
const SNAP = 5.2

export type Snap = { scenario: string; tick: number; score: number; what: string; state: string }

export function measure(view: SkaterView, name: string, from: number, to: number): Snap[] {
  const sc = loadScenario(rel(`scenarios/${name}.skate`))
  const states: [Thing, number][] = []
  runScenario({ ...sc, ticks: to }, data, { keys: (t, sim, b) => { if (t >= from) states.push([structuredClone(skater(sim)), sim.world.tick]); return b } })
  type F = { board: THREE.Quaternion; root: THREE.Quaternion; bones: Map<string, THREE.Quaternion>; hips: THREE.Vector3; state: string }
  const frames: F[] = []
  for (const [t, tick] of states) {
    view.tick = tick   // the world tick, as the game sets it (celebrations and idles time from it)
    view.update(t, data, 0)
    view.root.updateMatrixWorld(true)
    const board = new THREE.Quaternion().setFromRotationMatrix(view.board.matrix)
    const bones = new Map<string, THREE.Quaternion>()
    for (const [k, b] of view.character.bones) bones.set(k, b.quaternion.clone())
    // The pelvis in the world: the skater's own travel is steady from tick to tick (no excess), so what
    // stands out is the body or the whole rider jumping (a snap onto a rail, a pose switch).
    const hips = view.character.bones.get('Hips')!.getWorldPosition(new THREE.Vector3())
    const root = view.root.getWorldQuaternion(new THREE.Quaternion())   // the rider's heading in the world
    frames.push({ board, root, bones, hips, state: t.state + (t.grind ? ` ${t.grind.name}` : t.trick ? ` ${t.trick.id}` : '') })
  }
  const deg = (a: THREE.Quaternion, b: THREE.Quaternion) => (2 * Math.acos(Math.min(1, Math.abs(a.dot(b)))) * 180) / Math.PI
  const d = frames.slice(1).map((f, i) => {
    const p = frames[i]
    let joint = 0, which = ''
    for (const [k, q] of f.bones) { const a = deg(q, p.bones.get(k)!); if (a > joint) { joint = a; which = k } }
    // The deck is the same both ways round (nose and tail alike): a shove-it's half turn ending is no jump.
    const half = p.board.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI))
    return { board: Math.min(deg(f.board, p.board), deg(f.board, half)), joint, which, pelvis: f.hips.distanceTo(p.hips) * 100, heading: deg(f.root, p.root) }
  })
  const out: Snap[] = []
  for (let i = 1; i < d.length - 1; i++) {
    const ex = (k: 'board' | 'joint' | 'pelvis' | 'heading') => d[i][k] - Math.max(d[i - 1][k], d[i + 1][k])
    const s = [ex('board') / 8, ex('joint') / 12, ex('pelvis') / 2.5, ex('heading') / 10]
    const score = Math.max(...s), m = s.indexOf(score)
    const what = m === 0 ? `board ${d[i].board.toFixed(1)} deg` : m === 1 ? `${d[i].which} ${d[i].joint.toFixed(1)} deg` : m === 2 ? `pelvis ${d[i].pelvis.toFixed(1)} cm` : `heading ${d[i].heading.toFixed(1)} deg`
    out.push({ scenario: name, tick: from + i + 1, score, what, state: frames[i + 1].state })
  }
  return out
}

describe('pose continuity', () => {
  let view: SkaterView
  beforeAll(() => { view = new SkaterView(buildRoster(chars), raw, chars); view.setCharacter('techbro') })
  it('no snaps through ollies, flips, grinds and slides in and out, manuals, grabs, reverts and bails', () => {
    const all = SEQUENCES.flatMap(([n, a, b]) => measure(view, n, a, b)).sort((x, y) => y.score - x.score)
    const top = all.slice(0, 10)
    console.log(['worst ten (score: excess / limit; joint 12 deg, board 8 deg, heading 10 deg, pelvis 2.5 cm)', ...top.map((s) => `  ${s.score.toFixed(2)}  ${s.scenario}@${s.tick}  ${s.what}  (${s.state})`)].join('\n'))
    expect(top[0].score, `${top[0].scenario}@${top[0].tick}: ${top[0].what} (${top[0].state})`).toBeLessThan(SNAP)
  })
})
