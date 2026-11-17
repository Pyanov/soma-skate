import { describe, expect, it } from 'vitest'
import { loadData } from '../src/harness/io.ts'
import { Btn } from '../src/sim/input.ts'
import { grindNear, type GrindLine } from '../src/sim/park/grindlines.ts'
import { buildPark } from '../src/sim/park/park.ts'
import type { ParkSource, RailInfo } from '../src/sim/park/source.ts'
import { advance } from '../src/sim/replay.ts'
import { nextFloat, seedRng } from '../src/sim/rng.ts'
import { createSim, skater } from '../src/sim/sim.ts'

// The grind grid: captures look only at lines near the feet. A synthetic park with 50,000 short
// ledges (what the city plus exported parked-car edges will have) must give exactly the lines a full
// scan gives, in the same order, and keep a grinding skater inside the per-tick budget.

const data = loadData()

function syntheticPark(count: number) {
  const rng = seedRng(50)
  const S = 1000   // a 2 km square of floor
  const rails: RailInfo[] = []
  for (let i = 0; i < count; i++) {
    const x = (nextFloat(rng) * 2 - 1) * (S - 5), y = (nextFloat(rng) * 2 - 1) * (S - 5), a = nextFloat(rng) * Math.PI, l = 1 + nextFloat(rng) * 3
    rails.push({ id: `edge_${i}`, feature: '', kind: 'ledge', spec: '', points: [[x, y, 0.5], [x + Math.cos(a) * l, y + Math.sin(a) * l, 0.5]] })
  }
  const src: ParkSource = {
    name: 'grid50k', hash: 'grid50k',
    positions: new Float32Array([-S, -S, 0, S, -S, 0, S, S, 0, -S, S, 0]), indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
    elements: [{ id: 'floor', element: 'floor', collection: 'ground', feature: '', name: 'floor', type: '', role: 'body', tris: [0, 2] }],
    rails, spots: [{ id: 'start', label: 'start', xy: [0, 0], heading: 0 }], lines: [],
  }
  return buildPark(src, data.physics)
}

/** What a full scan meets: every line whose bounding box reaches the query box, in id order. */
const brute = (lines: GrindLine[], x0: number, y0: number, x1: number, y1: number) =>
  lines.filter((l) => l.hi.x >= x0 && l.lo.x <= x1 && l.hi.y >= y0 && l.lo.y <= y1).map((l) => l.id)

describe('grind grid', () => {
  const park = syntheticPark(50000)

  it('has the 50,000 lines and returns exactly what a full scan would, in id order', () => {
    expect(park.grind.length).toBe(50000)
    const rng = seedRng(7), out: number[] = []
    let nonEmpty = 0
    for (let k = 0; k < 3000; k++) {
      const x = (nextFloat(rng) * 2 - 1) * 1000, y = (nextFloat(rng) * 2 - 1) * 1000, r = 0.5 + nextFloat(rng) * 3
      const got = grindNear(park.grindGrid, x - r, y - r, x + r, y + r, out).slice()
      const want = brute(park.grind, x - r, y - r, x + r, y + r)
      // The grid may return a neighbour whose box only shares a cell; never misses one, keeps the order.
      expect(want.every((id) => got.includes(id))).toBe(true)
      expect(got).toEqual([...got].sort((a, b) => a - b))
      if (want.length) nonEmpty++
    }
    expect(nonEmpty).toBeGreaterThan(100)
  })

  it('keeps a skater pressing grind across the park inside the per-tick budget', () => {
    const sim = createSim(park, data, { seed: 3 })
    const rng = seedRng(11), times: number[] = []
    let captures = 0
    for (let t = 0; t < 6000; t++) {
      const cmds = t % 60 === 0 ? [`teleport ${((nextFloat(rng) * 2 - 1) * 990).toFixed(2)} ${((nextFloat(rng) * 2 - 1) * 990).toFixed(2)} 1.2 ${Math.floor(nextFloat(rng) * 360)}`, 'speed 4'] : []
      const t0 = performance.now()
      const ev = advance(sim, { b: t % 4 === 0 ? Btn.grind : 0 }, cmds)
      times.push(performance.now() - t0)
      captures += ev.filter((e) => e.t === 'grindStart').length
    }
    times.sort((a, b) => a - b)
    const p99 = times[Math.floor(times.length * 0.99)]
    expect(captures).toBeGreaterThan(0)
    expect(p99).toBeLessThan(0.5)
    expect(skater(sim).pos.z).toBeGreaterThan(-1)
  })
})
