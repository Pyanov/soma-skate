// "Nothing gated" (docs/squeeze.md), on the built city: a street route from the park to each of the 20 places,
// planned on the sim's own traffic network (the city's traffic paths, joined where their ends meet another path
// and where two paths cross at the same height), written as scenarios that drive the crew van along it
// (scenarios/squeeze-routes/*.skate: the driving autopilot, harness/drivebot.ts) and expect it to arrive within
// 25 m of the place's nearest street point.
//   node tools/squeeze/routes.ts [--debug]
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { readJson, rel } from '../../src/harness/io.ts'

import { X, Y, Z, clear, nearest, dijkstra, park, endJoins, crossJoins, paths } from './net.ts'

const places = readJson<{ travel: { places: { spot: string }[] } }>(rel('data/story.json')).travel.places.map((p) => p.spot)
const spots = new Map(park.spots.map((s) => [s.id, s]))
const VAN: [number, number] = [57.5, -15.6]
const [s0] = nearest(46, -10)
const { dist, prev } = dijkstra(s0)
const out = rel('scenarios/squeeze-routes'); mkdirSync(out, { recursive: true })
for (const f of readdirSync(out)) if (f.startsWith('route-')) rmSync(`${out}/${f}`)   // a place with no route keeps no stale file
console.log(`traffic paths ${paths.length}, nodes ${X.length}, end joins ${endJoins}, crossings ${crossJoins}`)
const debug = process.argv.includes('--debug')
for (const pl of places) {
  if (pl === 'park_gate') continue
  const s = spots.get(pl)
  if (!s) { console.log(`${pl.padEnd(18)} NO SPOT`); continue }
  const [, gd] = nearest(s.pos.x, s.pos.y)
  // The route ends at the street point nearest the place that the park reaches. Where that is more than 25 m from
  // the spot, the spot stands in a plaza or a park off the street (reported); more than 100 m is not reached.
  let g = -1, rd = Infinity
  for (let j = 0; j < X.length; j++) if (Number.isFinite(dist[j])) { const d = Math.hypot(X[j] - s.pos.x, Y[j] - s.pos.y); if (d < rd) { rd = d; g = j } }
  if (rd > 100) {
    console.log(`${pl.padEnd(18)} NO ROUTE  street ${gd.toFixed(0)} m from the spot; nearest reachable ${rd.toFixed(0)} m at (${X[g].toFixed(0)}, ${Y[g].toFixed(0)})`)
    continue
  }
  const route: number[] = []
  for (let u = g; u >= 0; u = prev[u]) route.push(u)
  route.reverse()
  // no spikes: a point the route turns back at (over 100 degrees) is dropped when the line past it is clear
  for (let changed = true; changed;) {
    changed = false
    for (let i = 1; i + 1 < route.length; i++) {
      const a = route[i - 1], b = route[i], c = route[i + 1]
      const u = [X[b] - X[a], Y[b] - Y[a]], v = [X[c] - X[b], Y[c] - Y[b]]
      const cos = (u[0] * v[0] + u[1] * v[1]) / ((Math.hypot(u[0], u[1]) * Math.hypot(v[0], v[1])) || 1)
      if (cos < -0.17 && clear(X[a], Y[a], Z[a], X[c], Y[c], Z[c])) { route.splice(i, 1); changed = true; i-- }
    }
  }
  // string pulling: from each point, straight on to the farthest point within 30 m the line to which is clear (no
  // loops round a junction's one-way lanes, no zig-zag between parallel paths)
  const pulled = [route[0]]
  for (let i = 0; i < route.length - 1;) {
    let j = i + 1
    for (let k = route.length - 1; k > i + 1; k--) {
      const a = route[i], b = route[k]
      if (Math.hypot(X[b] - X[a], Y[b] - Y[a]) <= 30 && Math.abs(Z[b] - Z[a]) < 1.5 && clear(X[a], Y[a], Z[a], X[b], Y[b], Z[b])) { j = k; break }   // not on hills: the crooked block's hairpins and steep streets keep their curves
    }
    pulled.push(route[j]); i = j
  }
  const pts: [number, number][] = pulled.map((u) => [X[u], Y[u]])
  const keep: [number, number][] = [pts[0]]
  for (const q of pts.slice(1)) if (Math.hypot(q[0] - keep[keep.length - 1][0], q[1] - keep[keep.length - 1][1]) >= 8) keep.push(q)
  keep.push(pts[pts.length - 1])
  // no U-turn at the start: drop route points behind the van (it starts facing west at the park's gate)
  const turn = (a: number[], b: number[], c: number[]) => { const u = [b[0] - a[0], b[1] - a[1]], v = [c[0] - b[0], c[1] - b[1]]; return Math.acos(Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v) || 1)))) }
  while (keep.length > 2 && turn(VAN, keep[0], keep[1]) > 1.6) keep.shift()
  const L = dist[g], ticks = Math.round((L / 4 + 60) * 120), end = pts[pts.length - 1]
  const R = pl === 'hyde_hill' ? 40 : 25   // Russian Hill is up Lombard's crooked block, which the van climbs at walking pace past its last hairpin
  const path = [VAN, ...keep].map((q) => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' ')
  writeFileSync(`${out}/route-${pl}.skate`,
    `# 'Nothing gated' (docs/squeeze.md): the crew van from the park to ${pl} by street (${L.toFixed(0)} m), the driving autopilot on the\n` +
    `# sim's own traffic network (tools/squeeze/routes.ts writes this file). The van must arrive within ${R} m of the route's end.\n` +
    `park sf\ncmd 0 traffic clear\ncmd 1 teleport 57.5 -17.8 -1.1 270\ntap use 30\n` +
    `bot drive ${path} from 100 speed 8 corner 4 stop\nrun ${ticks}\n` +
    `expect skater.pos.x > ${(end[0] - R).toFixed(1)} at ${ticks}\nexpect skater.pos.x < ${(end[0] + R).toFixed(1)} at ${ticks}\n` +
    `expect skater.pos.y > ${(end[1] - R).toFixed(1)} at ${ticks}\nexpect skater.pos.y < ${(end[1] + R).toFixed(1)} at ${ticks}\n`)
  console.log(`${pl.padEnd(18)} ${L.toFixed(0).padStart(5)} m  ends ${rd.toFixed(0)} m from the spot${rd > 25 ? ' (across a plaza or park)' : ''}`)
  if (debug) console.log('   ', keep.map((q) => `${q[0].toFixed(0)},${q[1].toFixed(0)}`).join(' '))
}
