import { Btn, type BtnName } from '../sim/input.ts'
import { nextFloat, seedRng, type RngState } from '../sim/rng.ts'
import { createSim, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import { applyCommand, parseCommand } from '../sim/commands.ts'
import { advance } from '../sim/replay.ts'
import { raycast, sphereContacts, type Contact, type Park } from '../sim/park/park.ts'
import { State } from '../sim/thing.ts'
import { v3, type Vec3 } from '../sim/math.ts'
import { loadData, loadPark, rel } from './io.ts'
import { checkInvariants, flicker } from './scenario.ts'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

// The city sweep (docs/architecture.md, `skate cityfuzz`): random-input bots dropped at random
// points on the city's rideable ground, spread evenly over its areas, each for a segment, with the
// checks a big generated map needs on top of the shared invariants: through the ground (a street
// surface above the skater), on the catch floor, trapped (not moving while pushing, and none of a
// player's ways out works: pivot and push either way, brake back, ollie, step off and walk), and
// grinds captured through a wall. Each finding comes with a scenario that replays its segment from
// a fresh world (traffic cleared, so it repeats).

/** Surfaces a bot may start on: the street-level ground of the city. */
const START_ON = ['city_road', 'city_sidewalk', 'city_alley', 'city_park', 'city_path', 'city_median', 'city_green', 'city_spot', 'city_play', 'city_lot']
/** Ground nobody should ever be under (a skater below one of these fell through the street). */
const STREET = new Set(['city_road', 'city_sidewalk', 'city_alley', 'city_park', 'city_path', 'city_median', 'city_green', 'city_lot'])

export type Finding = { kind: 'invariant' | 'flicker' | 'underground' | 'catchfloor' | 'trapped' | 'grindwall'; tick: number; at: [number, number, number]; detail: string; scenario: string
  touching: string[]   // the collections the skater touches there
  known?: string       // the rule in cityfuzz-known.json it matches (already reported)
}
type KnownRule = { id: string; kinds: string[]; at?: [number, number]; radius?: number; touching?: string[]; note: string }
const KNOWN: KnownRule[] = (JSON.parse(readFileSync(new URL('./cityfuzz-known.json', import.meta.url), 'utf8')) as { rules: KnownRule[] }).rules

/** The already-reported problem a finding is, if any. */
export function knownAs(f: Finding): string | undefined {
  for (const k of KNOWN) {
    if (!k.kinds.includes(f.kind)) continue
    if (k.at && Math.hypot(f.at[0] - k.at[0], f.at[1] - k.at[1]) <= (k.radius ?? 3)) return k.id
    if (!k.at && k.touching && k.touching.every((c) => f.touching.includes(c))) return k.id
  }
  return undefined
}

/** Points on street-level ground, every `step` metres over the city, grouped by `cell` metre squares (one area each). */
export function startPoints(park: Park, step = 20, cell = 200): { x: number; y: number; z: number; cell: string }[] {
  const near: Contact[] = []
  const out: { x: number; y: number; z: number; cell: string }[] = []
  const top = park.boundsMax.z + 1, depth = park.boundsMax.z - park.boundsMin.z + 2
  for (let x = Math.ceil(park.boundsMin.x / step) * step; x <= park.boundsMax.x; x += step) {
    for (let y = Math.ceil(park.boundsMin.y / step) * step; y <= park.boundsMax.y; y += step) {
      const h = raycast(park, v3(x, y, top), v3(0, 0, -1), depth)
      if (!h) continue
      const c = park.elements[park.elem[h.tri]].collection
      if (!START_ON.includes(c) || h.normal.z < 0.9) continue
      // Not on the world's edge: ground 3 m away on every side too, and the boundary wall not within reach.
      if ([[3, 0], [-3, 0], [0, 3], [0, -3]].some(([dx, dy]) => !raycast(park, v3(x + dx, y + dy, top), v3(0, 0, -1), depth))) continue
      if (sphereContacts(park, v3(x, y, h.point.z + 0.5), 3, near).some((c) => park.elements[park.elem[c.tri]].collection === 'boundary')) continue
      // Not inside anything (a tree trunk is an open tube a ray from above goes straight down).
      if (sphereContacts(park, v3(x, y, h.point.z + 0.5), 0.4, near).some((c) => park.elements[park.elem[c.tri]].role !== 'ground')) continue
      out.push({ x, y, z: h.point.z, cell: `${Math.floor(x / cell)},${Math.floor(y / cell)}` })
    }
  }
  return out
}

/** The ways out a player would try when stuck, each from a copy of the world: does any get 1.5 m away? */
const ESCAPES: [number, number][][] = [
  ...[40, 80, 120, 160, 200].flatMap((n) => [[[Btn.left, n], [Btn.up, 240]], [[Btn.right, n], [Btn.up, 240]]] as [number, number][][]),
  [[Btn.down, 240]], [[Btn.ollie, 30], [Btn.up | Btn.ollie, 1], [Btn.up, 240]], [[Btn.walk, 1], [0, 10], [Btn.up, 300]],
  [[Btn.walk, 1], [0, 10], [Btn.left, 60], [Btn.up, 300]], [[Btn.walk, 1], [0, 10], [Btn.right, 60], [Btn.up, 300]],
]
export function canEscape(sim: Sim): boolean {
  const start = skater(sim).pos
  for (const plan of ESCAPES) {
    const copy: Sim = { ...sim, world: structuredClone(sim.world) }
    for (const [b, n] of plan) for (let k = 0; k < n; k++) advance(copy, { b })
    const p = skater(copy).pos
    if (Math.hypot(p.x - start.x, p.y - start.y) >= 1.5) return true
  }
  return false
}

const BTN_NAMES = Object.keys(Btn) as BtnName[]
const holdName = (b: number) => BTN_NAMES.filter((k) => (b & Btn[k]) !== 0).join('+')

/** The random bot: mostly pushing, some turning, now and then every other key (as the soma fuzz). */
function nextKeys(rng: RngState): { b: number; hold: number } {
  const r = nextFloat(rng)
  let b = (r < 0.65 ? Btn.up : r < 0.75 ? Btn.down : 0) | (nextFloat(rng) < 0.35 ? (nextFloat(rng) < 0.5 ? Btn.left : Btn.right) : 0)
  for (const k of [Btn.ollie, Btn.flip, Btn.grab, Btn.grind, Btn.revert, Btn.slide, Btn.walk]) if (nextFloat(rng) < 0.1) b |= k
  return { b, hold: 20 + Math.floor(nextFloat(rng) * 100) }
}

export function cityFuzz(o: { segments: number; segmentTicks: number; seed: number; out?: string; quiet?: boolean; near?: [number, number, number] }) {
  const data = loadData(), park = loadPark('sf', data)
  // near [x, y, r]: only start points within r metres of (x, y), at 5 m spacing (to chase one problem down).
  const pts = o.near ? startPoints(park, 5).filter((p) => Math.hypot(p.x - o.near![0], p.y - o.near![1]) <= o.near![2]) : startPoints(park)
  const cells = [...new Set(pts.map((p) => p.cell))].sort()
  const byCell = new Map(cells.map((c) => [c, pts.filter((p) => p.cell === c)]))
  const rng = seedRng(o.seed ^ 0xc17f)
  const findings: Finding[] = []
  const r = data.physics.skater.radius, hz = data.physics.tickHz
  const near: Contact[] = []
  let ticks = 0
  const outDir = o.out ?? rel('out/cityfuzz')
  mkdirSync(outDir, { recursive: true })
  for (let s = 0; s < o.segments; s++) {
    // One area after another (round robin over the cells, a random point in each).
    const list = byCell.get(cells[s % cells.length])!
    const p = list[Math.floor(nextFloat(rng) * list.length)]
    const heading = Math.round(nextFloat(rng) * 360)
    const tp = `teleport ${p.x} ${p.y} ${(p.z + r + 0.05).toFixed(2)} ${heading}`
    const holds: { b: number; from: number; to: number }[] = []
    const recent: { t: string; rel: number; airTicks?: number }[] = []
    let b = 0, change = 0, prev = v3(), win = v3(), winAt = 0, pushed = 0, fastest = 0
    let found: Finding | null = null
    // A fresh world for each segment (traffic cleared), so its scenario replays it exactly.
    const sim = createSim(park, data, { seed: o.seed })
    applyCommand(sim, parseCommand('traffic clear'))
    applyCommand(sim, parseCommand(tp))
    for (let t = 0; t < o.segmentTicks && !found; t++) {
      if (t >= change) { const k = nextKeys(rng); b = k.b; change = t + k.hold; holds.push({ b, from: t, to: change }) }
      const sk = skater(sim)
      prev = v3(sk.pos.x, sk.pos.y, sk.pos.z)
      const ev = advance(sim, { b }, t === 0 ? [] : [])
      ticks++
      for (const e of ev) { recent.push({ t: e.t, rel: t, airTicks: e.t === 'land' ? e.airTicks : undefined }); if (recent.length > 64) recent.shift() }
      const bad = checkInvariants(sim, sk) ?? flicker(recent, t)
      const at: [number, number, number] = [sk.pos.x, sk.pos.y, sk.pos.z]
      const make = (kind: Finding['kind'], detail: string): Finding => {
        sphereContacts(park, sk.pos, r + 0.1, near)
        const touching = [...new Set(near.map((c) => park.elements[park.elem[c.tri]].collection))].sort()
        const f: Finding = { kind, tick: t + 1, at, detail, scenario: '', touching }
        f.known = knownAs(f)
        return f
      }
      if (bad) { found = make(bad.startsWith('air/land') ? 'flicker' : 'invariant', bad); break }
      // Below the street: the first thing above is street-level ground (not a roof, a deck, a tree).
      const up = raycast(park, v3(sk.pos.x, sk.pos.y, sk.pos.z), v3(0, 0, 1), 3)
      if (up && STREET.has(park.elements[park.elem[up.tri]].collection) && sk.state !== State.walk) { found = make('underground', `${park.elements[park.elem[up.tri]].id} ${up.t.toFixed(2)} m above`); break }
      // On the catch floor: what is under the skater is the boundary's floor.
      const down = raycast(park, v3(sk.pos.x, sk.pos.y, sk.pos.z), v3(0, 0, -1), r + 0.2)
      if (down && park.elements[park.elem[down.tri]].collection === 'boundary' && down.normal.z > 0.7) { found = make('catchfloor', `on ${park.elements[park.elem[down.tri]].id}`); break }
      // A grind start that reached through something solid from where the skater was.
      if (ev.some((e) => e.t === 'grindStart') && sk.grind && sk.grind.car < 0) {
        const d = v3(sk.pos.x - prev.x, sk.pos.y - prev.y, sk.pos.z - prev.z), l = Math.hypot(d.x, d.y, d.z)
        const hit = l > 0.05 ? raycast(park, prev, v3(d.x / l, d.y / l, d.z / l), l) : null
        const line = park.grind[sk.grind.line]
        if (hit && hit.t < l - 0.15 && park.elements[park.elem[hit.tri]].id !== line?.element) { found = make('grindwall', `onto ${line?.element} through ${park.elements[park.elem[hit.tri]].id} (${hit.t.toFixed(2)} of ${l.toFixed(2)} m)`); break }
      }
      // Pushing most of 4 s on the ground, never faster than 0.6 m/s and not 0.5 m further: try a
      // player's ways out on a copy of the world; trapped if none gets 1.5 m away.
      if (t === 0 || sk.state !== State.ground) { win = v3(sk.pos.x, sk.pos.y, sk.pos.z); winAt = t; pushed = 0; fastest = 0 }
      if ((b & Btn.up) !== 0) pushed++
      fastest = Math.max(fastest, Math.hypot(sk.vel.x, sk.vel.y))
      if (t - winAt >= 4 * hz) {
        const moved = Math.hypot(sk.pos.x - win.x, sk.pos.y - win.y), stuck = moved < 0.5 && pushed > 2 * hz && fastest < 0.6
        win = v3(sk.pos.x, sk.pos.y, sk.pos.z); winAt = t; pushed = 0; fastest = 0
        if (!stuck || canEscape(sim)) continue
        sphereContacts(park, sk.pos, r + 0.08, near)
        const ids = [...new Set(near.map((c) => park.elements[park.elem[c.tri]].id))].join(', ') || 'nothing'
        found = make('trapped', `touching ${ids}`); break
      }
    }
    if (found) {
      // A scenario that replays the segment from a fresh world.
      const name = `cityfuzz-${o.seed}${o.near ? `-near${o.near.map((v) => Math.round(v)).join('_')}` : ''}-${findings.length + 1}`
      const lines = [`# city sweep finding: ${found.kind} at ${found.at.map((v) => v.toFixed(2)).join(' ')} (${found.detail}), tick ${found.tick}`, 'park sf', 'cmd 0 traffic clear', `cmd 0 ${tp}`]
      for (const h of holds) if (h.b && h.from < found.tick) lines.push(`hold ${holdName(h.b)} ${h.from}..${Math.min(h.to, found.tick)}`)
      lines.push(`run ${found.tick + 2}`)
      found.scenario = `${outDir}/${name}.skate`
      writeFileSync(found.scenario, lines.join('\n') + '\n')
      findings.push(found)
      if (!o.quiet) console.log(`${found.kind.padEnd(11)} ${found.at.map((v) => v.toFixed(1)).join(', ')}  ${found.detail}${found.known ? `  [known: ${found.known}]` : ''}  (${found.scenario})`)
    }
  }
  return { segments: o.segments, cells: cells.length, points: pts.length, ticks, findings }
}

export type CityFuzzResult = ReturnType<typeof cityFuzz>
void ({} as SimEvent, {} as Vec3, {} as Sim)
