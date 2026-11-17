import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { boardPoints, contactOf } from '../src/client/skater/contact.ts'
import { evaluate, resolvePoses, type RawPoseData } from '../src/client/skater/poses.ts'
import { loadData, rel } from '../src/harness/io.ts'
import { loadScenario, runScenario } from '../src/harness/scenario.ts'
import { skater, type Sim } from '../src/sim/sim.ts'
import { raycast } from '../src/sim/park/park.ts'
import { v3 } from '../src/sim/math.ts'
import type { Thing } from '../src/sim/thing.ts'

// Every grind and slide sits on what it grinds (view only, skater/poses.ts + contact.ts): the
// grinding truck's hanger on the edge or a slide's underside on it (not floating), and nothing of
// the board (deck, wheels, hangers) through the ledge or the rail. Each pose on a ledge (a top on the
// far side, where a feeble's front truck or a boardslide's far wheels rest) and on a rail (open on
// both sides, where they hang below it).

const data = loadData()
const P = resolvePoses(JSON.parse(readFileSync(rel('data/poses.json'), 'utf8')) as RawPoseData)
const run = (name: string, tick: number): Sim => runScenario({ ...loadScenario(rel(`scenarios/${name}.skate`)), ticks: tick }, data).sim
const at = (name: string, tick: number): Thing => skater(run(name, tick))
/** The view's probe (main.ts): the park's height under a point. */
const probeOf = (sim: Sim) => (x: number, y: number, z: number) => { const h = raycast(sim.park, v3(x, y, z), v3(0, 0, -1), 8); return h ? h.point.z : null }

const cases: [string, number][] = []
for (const side of ['fs', 'bs']) {
  for (const tk of [190, 212, 234, 256, 278, 300, 322]) cases.push([`lab-grind-table-${side}`, tk])
  for (const tk of [215, 245, 275, 305]) cases.push([`lab-grind-variants-${side}`, tk])
}
for (const tk of [140, 162, 184, 206, 228, 250]) cases.push(['lab-slide-table', tk], ['lab-slide-table-bs', tk])

describe('grind and slide contact', () => {
  const seen = new Set<string>()
  for (const [sc, tk] of cases) {
    it(`${sc}@${tk}: on the edge, not through it (ledge and rail)`, () => {
      const t = at(sc, tk)
      expect(t.grind, `${sc}@${tk} grinding`).not.toBeNull()
      const g = t.grind!
      seen.add(g.name)
      const def = (g.slide ? data.tricks.slides : data.tricks.grinds).find((x) => x.id === g.id)!
      const far: [number, number] = g.slide ? [def.nose === 'far' ? 1 : -1, 0] : [0, g.fs ? -1 : 1]
      const z = t.pos.z - data.physics.skater.radius
      for (const kind of ['ledge', 'rail'] as const) {
        const e = evaluate(t, data, 0, P, undefined, {}, kind === 'ledge' ? () => z : () => z - 3)
        const pts = boardPoints(e.pose.board)
        const c = contactOf(pts, { kind, far })
        const what = `${g.name} on a ${kind}`
        expect(c.deepest, `${what}: ${c.deepWhat} ${(c.deepest * 100).toFixed(1)} cm into it`).toBeGreaterThan(-0.005)
        // A bluntslide on a ledge rests its wheels on the top past the edge, the board high over it.
        if (kind === 'ledge' && /blunt/.test(g.id)) {
          const onTop = Math.min(...pts.filter((p) => p.part === 'wheel' && p.p[0] * far[0] + p.p[1] * far[1] > 0).map((p) => p.p[2]))
          expect(onTop, `${what}: wheels on the top`).toBeLessThan(0.006)
        } else expect(c.gap, `${what}: ${(c.gap * 100).toFixed(1)} cm off the line`).toBeLessThan(0.006)
      }
      // A narrow ledge or wall top (10 cm: under the 12 cm probe, so it gets the rail poses): nothing
      // through its top either.
      const e = evaluate(t, data, 0, P, undefined, {}, () => z - 3)
      const c = contactOf(boardPoints(e.pose.board), { kind: 'rail', far, rail: 0.1 })
      expect(c.deepest, `${g.name} on a 10 cm ledge: ${c.deepWhat} ${(c.deepest * 100).toFixed(1)} cm into it`).toBeGreaterThan(-0.005)
    })
  }

  // Real park and city ledges (SoMa's south rear runway ledge, Embarcadero Plaza's granite): the probe
  // finds the top and the crooked sits on the edge, nothing through it.
  for (const [sc, tk] of [['soma-ledge-crooked', 60], ['sf-emb-crooked', 60]] as const) {
    it(`${sc}@${tk}: a crooked on a real ledge, on the edge and not through it`, () => {
      const sim = run(sc, tk), t = skater(sim), g = t.grind!
      expect(g, `${sc}@${tk} grinding`).not.toBeNull()
      const far: [number, number] = [0, g.fs ? -1 : 1]
      const top = evaluate(t, data, 0, P, undefined, {}, probeOf(sim))
      const asLedge = evaluate(t, data, 0, P, undefined, {}, () => t.pos.z - data.physics.skater.radius)
      expect(JSON.stringify(top.pose.board), `${g.name}: the probe reads a ledge`).toBe(JSON.stringify(asLedge.pose.board))
      const c = contactOf(boardPoints(top.pose.board), { kind: 'ledge', far })
      expect(c.deepest, `${g.name}: ${c.deepWhat} ${(c.deepest * 100).toFixed(1)} cm into it`).toBeGreaterThan(-0.005)
      expect(c.gap, `${g.name}: ${(c.gap * 100).toFixed(1)} cm off the edge`).toBeLessThan(0.006)
    })
  }

  // Slides on a real SoMa coping (F04, beside the south rear runway): the park's own probe decides ledge or
  // rail, and the noseslide, bluntslide and nosebluntslide sit on it with nothing through it.
  for (const sc of ['soma-ledge-noseslide', 'soma-ledge-bluntslide', 'soma-ledge-nosebluntslide']) {
    it(`${sc}@30: a slide on a real SoMa coping sits on it`, () => {
      const sim = run(sc, 30), t = skater(sim), g = t.grind!
      expect(g, `${sc}@30 sliding`).not.toBeNull()
      const def = data.tricks.slides.find((x) => x.id === g.id)!
      const far: [number, number] = [def.nose === 'far' ? 1 : -1, 0]
      const z = t.pos.z - data.physics.skater.radius
      const e = evaluate(t, data, 0, P, undefined, {}, probeOf(sim))
      const asLedge = evaluate(t, data, 0, P, undefined, {}, () => z)
      const kind = JSON.stringify(e.pose.board) === JSON.stringify(asLedge.pose.board) ? 'ledge' : 'rail'
      const c = contactOf(boardPoints(e.pose.board), { kind, far })
      expect(c.deepest, `${g.name} on the coping (${kind}): ${c.deepWhat} ${(c.deepest * 100).toFixed(1)} cm into it`).toBeGreaterThan(-0.005)
    })
  }

  // On real geometry, with the view's own probe of the park: the lab ledge's top is found (ledge poses),
  // the lab rail has none (rail poses), and every slide on either sits on it.
  for (const [sc, kind] of [['lab-slide-ledge', 'ledge'], ['lab-slide-ledge-bs', 'ledge'], ['lab-slide-table', 'rail']] as const) {
    for (const tk of [140, 162, 184, 206, 228, 250]) {
      it(`${sc}@${tk}: the park probe finds a ${kind}, the slide sits on it`, () => {
        const sim = run(sc, tk), t = skater(sim), g = t.grind!
        expect(g, `${sc}@${tk} sliding`).not.toBeNull()
        const def = data.tricks.slides.find((x) => x.id === g.id)!
        const far: [number, number] = [def.nose === 'far' ? 1 : -1, 0]
        const ground = probeOf(sim)
        const top = evaluate(t, data, 0, P, undefined, {}, ground)
        const asLedge = evaluate(t, data, 0, P, undefined, {}, () => t.pos.z - data.physics.skater.radius)
        const asRail = evaluate(t, data, 0, P, undefined, {}, () => null)
        expect(JSON.stringify(top.pose.board), `${g.name}: the probe reads a ${kind}`).toBe(JSON.stringify((kind === 'ledge' ? asLedge : asRail).pose.board))
        const c = contactOf(boardPoints(top.pose.board), { kind, far })
        expect(c.deepest, `${g.name} on the ${kind}: ${c.deepWhat} ${(c.deepest * 100).toFixed(1)} cm into it`).toBeGreaterThan(-0.005)
      })
    }
  }
})
