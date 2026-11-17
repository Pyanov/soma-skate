import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { loadData, loadPark } from '../src/harness/io.ts'
import { Btn } from '../src/sim/input.ts'
import { lineAt, type GrindLine } from '../src/sim/park/grindlines.ts'
import type { Park } from '../src/sim/park/park.ts'
import { advance } from '../src/sim/replay.ts'
import { createSim, skater } from '../src/sim/sim.ts'
import { State } from '../src/sim/thing.ts'

// Grinds and slides on sloped lines go downhill (docs/mechanics/grinds.md, the catch's direction).
// A playtest report of 2026-11-16: a grind down a rail turned and went up it. Two sweeps over
// every sloped line of the lab, the SoMa park and the city's handrails and hubbas:
// - the catch: ollied onto a sloped segment from either side at 20 to 88 degrees off downhill, rising,
//   level or falling as the feet reach the line, with I pressed every few ticks. Whatever it catches on
//   a line that slopes there must run downhill along it. Before the fix the climb of the ollie counted
//   as travel along the line (rising onto a down rail is uphill along it), and a slide's 2.5 m/s floor
//   then carried that sign: 1,058 of 10,800 city rail catches went up the rail, the 16th St BART
//   handrails among them.
// - the ride: dropped onto the line at its top going down it at 1.5, 3 and 5 m/s with the balance bot,
//   the grind's arc position never turns back while it lasts.

const data = loadData()
const r = data.physics.skater.radius
const haveCity = existsSync(new URL('../assets/park/sf.city.json', import.meta.url))

/** Segments steeper than 8 degrees and at least 1.5 m long: [line, segment index]. */
function sloped(park: Park, pick: (l: GrindLine) => boolean): [GrindLine, number][] {
  const out: [GrindLine, number][] = []
  for (const L of park.grind) {
    if (L.kind === 'coping' || !pick(L)) continue
    for (let i = 1; i < L.points.length; i++) {
      const a = L.points[i - 1], b = L.points[i], h = Math.hypot(b.x - a.x, b.y - a.y)
      if (h >= 1.5 && Math.abs(b.z - a.z) / h >= 0.14) out.push([L, i])
    }
  }
  return out
}

/** Every catch on a line that slopes where it caught it, from the side matrix: those that went uphill. */
function catchUphill(park: Park, segs: [GrindLine, number][]) {
  const bad: string[] = []
  let caught = 0
  for (const [L, i] of segs) {
    const a = L.points[i - 1], b = L.points[i], h = Math.hypot(b.x - a.x, b.y - a.y), dn = b.z < a.z ? 1 : -1
    const ux = ((b.x - a.x) / h) * dn, uy = ((b.y - a.y) / h) * dn
    const { pos } = lineAt(L, L.cum[i - 1] + (L.cum[i] - L.cum[i - 1]) * 0.35)
    for (const side of [1, -1]) for (const ang of [20, 45, 70, 80, 88]) for (const vz of [2.5, 1, -1]) for (const hsp of [3, 6]) {
      const sim = createSim(park, data, { seed: 3 })
      for (const c of sim.world.things) if (c.kind === 'car') c.alive = false
      const t = skater(sim)
      const nx = -uy * side, ny = ux * side, c = Math.cos((ang * Math.PI) / 180), s = Math.sin((ang * Math.PI) / 180)
      const dx = ux * c - nx * s, dy = uy * c - ny * s, back = 0.6 / Math.max(0.2, s)
      t.pos = { x: pos.x - dx * back, y: pos.y - dy * back, z: pos.z + r + 0.08 }
      t.vel = { x: dx * hsp, y: dy * hsp, z: vz }
      t.fwd = { x: dx, y: dy, z: 0 }
      t.up = { x: 0, y: 0, z: 1 }
      t.state = State.air; t.stateTicks = 10; t.popped = true
      t.takeoffXY = [t.pos.x - dx * 1.5, t.pos.y - dy * 1.5]
      let done = false
      for (let k = 0; k < 40 && !done; k++) {
        for (const e of advance(sim, { b: k < 30 && k % 3 === 0 ? Btn.grind : 0 })) {
          if (e.t !== 'grindStart' || !t.grind || t.grind.car >= 0 || done) continue
          done = true
          const gl = park.grind[t.grind.line], tz = lineAt(gl, t.grind.s).tan.z
          if (Math.abs(tz) < 0.1) continue   // caught where that line is (near) level: no downhill to keep
          caught++
          if (tz * t.grind.speed > 0) bad.push(`${gl.element} (${e.trick}) at ${ang} deg, side ${side}, vz ${vz}, ${hsp} m/s: ${t.grind.speed.toFixed(2)} m/s up it`)
        }
      }
    }
  }
  return { bad, caught }
}

/** Dropped on at the top going down it: the arc position turns back while grinding (on the same line, tick after tick). */
function rideTurnsBack(park: Park, lines: GrindLine[]) {
  const bad: string[] = []
  for (const L of lines) {
    const z0 = L.points[0].z, z1 = L.points[L.points.length - 1].z
    if (Math.abs(z0 - z1) < 0.4 || Math.abs(z0 - z1) / L.length < 0.06) continue
    const down = z0 > z1 ? 1 : -1, s0 = down > 0 ? Math.min(1, L.length * 0.1) : L.length - Math.min(1, L.length * 0.1)
    for (const v of [1.5, 3, 5]) {
      const sim = createSim(park, data, { seed: 7 })
      for (const c of sim.world.things) if (c.kind === 'car') c.alive = false
      const t = skater(sim)
      const { pos, tan } = lineAt(L, s0), h = Math.hypot(tan.x, tan.y) || 1
      t.pos = { x: pos.x, y: pos.y, z: pos.z + r + 0.12 }
      t.vel = { x: (tan.x / h) * v * down, y: (tan.y / h) * v * down, z: -0.5 }
      t.fwd = { x: (tan.x / h) * down, y: (tan.y / h) * down, z: 0 }
      t.up = { x: 0, y: 0, z: 1 }
      t.state = State.air; t.stateTicks = 5; t.popped = true
      t.takeoffXY = [pos.x - (tan.y / h) * 0.6, pos.y + (tan.x / h) * 0.6]
      let prev: { line: number; s: number; k: number; dir: number } | null = null
      for (let k = 0; k < 900; k++) {
        const g = t.grind
        advance(sim, { b: (k === 0 ? Btn.grind : 0) | (g ? (g.balance > 0.03 ? Btn.left : g.balance < -0.03 ? Btn.right : 0) : 0) })
        const state: string = t.state   // (assigned above: read it again after the step)
        if (state !== State.grind || !t.grind || t.grind.car >= 0) { if (state === State.ground && k > 30) break; continue }
        const now = t.grind
        if (prev && prev.line === now.line && prev.k === k - 1) {
          const ds = now.s - prev.s, dir: number = prev.dir || Math.sign(ds)
          if (dir && Math.sign(ds) === -dir && Math.abs(ds) > 1e-6) { bad.push(`${L.element} at ${v} m/s: turned back at tick ${k}`); break }
          prev = { line: now.line, s: now.s, k, dir }
        } else prev = { line: now.line, s: now.s, k, dir: 0 }
      }
    }
  }
  return bad
}

describe('grinds on sloped lines go downhill', () => {
  for (const name of ['lab', 'soma'] as const) {
    it(`${name}: a catch from the side, rising or falling, runs down the line`, () => {
      const park = loadPark(name, data)
      const { bad, caught } = catchUphill(park, sloped(park, () => true))
      if (name === 'soma') expect(caught).toBeGreaterThan(50)
      expect(bad).toEqual([])
    })
    it(`${name}: dropped on at the top, a grind never turns back`, () => {
      const park = loadPark(name, data)
      expect(rideTurnsBack(park, park.grind)).toEqual([])
    })
  }
  // The city's handrails and hubbas people ride down: the 16th St BART stairs, City Hall's Polk St steps.
  const cityPick = (l: GrindLine) => /^rail_(9[89]|10[01])_-19|^ledge_1[0-9]_3[56]/.test(l.element)   // (the squeezed city's ids)
  it.skipIf(!haveCity)('sf: the BART handrails and City Hall hubbas, caught from the side, run down', () => {
    const park = loadPark('sf', data)
    const segs = sloped(park, cityPick)
    expect(segs.length).toBeGreaterThanOrEqual(5)
    const { bad, caught } = catchUphill(park, segs)
    expect(caught).toBeGreaterThan(100)
    expect(bad).toEqual([])
  })
  it.skipIf(!haveCity)('sf: dropped on at the top of each, a grind never turns back', () => {
    const park = loadPark('sf', data)
    expect(rideTurnsBack(park, park.grind.filter(cityPick))).toEqual([])
  })
})
