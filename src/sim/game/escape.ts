import type { Escape } from '../data.ts'
import { atan2, wrapAngle, v3 } from '../math.ts'
import { raycast, type Park } from '../park/park.ts'
import { spawn, skater, type Sim, type SimEvent } from '../sim.ts'
import { Kind, State, type Thing } from '../thing.ts'
import { carFrame, cars, follow } from './traffic.ts'

// The Robotaxi Escape (run escape; data run.escape, docs/mechanics/modes.md): a robotaxi decides you
// are a road hazard and follows you. It is a car Thing (robo, car.chase) that drives the city's
// streets by the shortest way (A*) to the street point nearest you, so it can never follow you up
// stairs, across a plaza or a park, or down an alley that is not a street. It runs before the
// skaters, like the cars, and keeps its distance from cars ahead as they do. Your combos set it
// recalculating (stopped); within catch metres of it for catchSeconds you are pulled over. No random
// draws: the same run plays out the same.

// ---- The street graph (scratch, built once per park and rules; never world state) ----

/**
 * Nodes: the traffic network's street points (about 4 m apart). Edges: along each street (one-ways
 * one way); between streets sharing a point (within 0.5 m); from each street's ends to the nearest
 * point of every other street within link metres, both ways (the network joins streets only at ends
 * within 6 m of each other, which leaves most T-junctions and many crossings open). When no legal
 * way reaches you, it takes a one-way the wrong way (any: every edge both ways). Any also has road
 * links, both ways, for the map's waypoint route and that last resort only: from a street's end to
 * the nearest point of each street network it does not join yet (a component) within
 * roadLink.reach metres, when the straight line between them is road all the way (every metre the
 * ground under it, seen through what stands on it (roadLink.through: parked cars), is one of
 * roadLink.roads, within roadLink.height of the line): where the traffic paths stop short and the
 * road runs on.
 */
type Graph = { x: Float64Array; y: Float64Array; z: Float64Array; adj: number[][]; any: number[][]; ends: number[]; cell: number; grid: Map<number, number[]>
  comp: Int32Array; main: number }   // any: adj both ways (one-ways too) and the road links; ends: each street's first and last point; comp: each node's network (joined by any); main: the largest
/** The rules the street graph is built by (data run.escape). */
export type StreetRules = Pick<Escape, 'link' | 'roadLink'>
const graphs = new WeakMap<Park, Map<string, Graph>>()
const CELL = 20

function graphOf(park: Park, rules: StreetRules): Graph {
  const net = park.traffic, { link, roadLink } = rules
  let m = graphs.get(park)
  if (!m) graphs.set(park, (m = new Map()))
  const id = `${link} ${roadLink.reach} ${roadLink.height} ${roadLink.roads.join(',')} ${roadLink.through.join(',')}`
  let g = m.get(id)
  if (g) return g
  const n = net.paths.reduce((k, p) => k + p.points.length, 0)
  const x = new Float64Array(n), y = new Float64Array(n), z = new Float64Array(n), path = new Int32Array(n)
  const adj: number[][] = Array.from({ length: n }, () => [])
  const edge = (a: number, b: number) => { const w = Math.hypot(x[b] - x[a], y[b] - y[a]); if (!adj[a].some((v, i) => i % 2 === 0 && v === b)) adj[a].push(b, w) }
  const ends: number[] = []
  let k = 0
  net.paths.forEach((p, q) => {
    const base = k
    for (const pt of p.points) { x[k] = pt[0]; y[k] = pt[1]; z[k] = pt[2] ?? 0; path[k] = q; k++ }
    for (let i = base + 1; i < k; i++) { edge(i - 1, i); if (!p.oneway) edge(i, i - 1) }
    ends.push(base, k - 1)
  })
  const grid = new Map<number, number[]>()
  for (let i = 0; i < n; i++) { const c = key(Math.floor(x[i] / CELL), Math.floor(y[i] / CELL)); const l = grid.get(c); if (l) l.push(i); else grid.set(c, [i]) }
  const around = (i: number, r: number, f: (j: number) => void) => {
    const cx = Math.floor(x[i] / CELL), cy = Math.floor(y[i] / CELL), rr = Math.ceil(r / CELL)
    for (let ix = cx - rr; ix <= cx + rr; ix++) for (let iy = cy - rr; iy <= cy + rr; iy++) for (const j of grid.get(key(ix, iy)) ?? []) f(j)
  }
  // Shared points: streets crossing at a common point (a 1 m grid of the points finds them).
  const fine = new Map<number, number[]>()
  for (let i = 0; i < n; i++) { const c = key(Math.floor(x[i]), Math.floor(y[i])); const l = fine.get(c); if (l) l.push(i); else fine.set(c, [i]) }
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(x[i]), cy = Math.floor(y[i])
    for (let ix = cx - 1; ix <= cx + 1; ix++) for (let iy = cy - 1; iy <= cy + 1; iy++) for (const j of fine.get(key(ix, iy)) ?? []) if (path[j] !== path[i] && Math.hypot(x[j] - x[i], y[j] - y[i]) <= 0.5) edge(i, j)
  }
  // Street ends: to the nearest point of each other street within link metres.
  for (const i of ends) {
    const best = new Map<number, number>()
    around(i, link, (j) => {
      if (path[j] === path[i]) return
      const d = Math.hypot(x[j] - x[i], y[j] - y[i])
      if (d > link) return
      const b = best.get(path[j])
      if (b === undefined || d < Math.hypot(x[b] - x[i], y[b] - y[i]) || (d === Math.hypot(x[b] - x[i], y[b] - y[i]) && j < b)) best.set(path[j], j)
    })
    for (const j of [...best.values()].sort((a, b) => a - b)) { edge(i, j); edge(j, i) }
  }
  const any: number[][] = adj.map((e) => [...e])
  const anyEdge = (a: number, b: number, w: number) => { if (!any[a].some((v, t) => t % 2 === 0 && v === b)) any[a].push(b, w) }
  for (let i = 0; i < n; i++) for (let k2 = 0; k2 < adj[i].length; k2 += 2) anyEdge(adj[i][k2], i, adj[i][k2 + 1])
  // Road links (any only): each street end to the nearest point of every other network within reach, where the line is road.
  const comp = components(any)
  const roads = new Set(roadLink.roads), through = new Set(roadLink.through)
  const groundAt = (px: number, py: number, pz: number): string | null => {   // what the ground is under (px, py) near height pz, through parked cars
    for (let top = pz + 6, k2 = 0; k2 < 8; k2++) {
      const h = raycast(park, v3(px, py, top), v3(0, 0, -1), top - pz + 6)
      if (!h) return null
      const c = park.elements[park.elem[h.tri]].collection
      if (!through.has(c)) return Math.abs(h.point.z - pz) <= roadLink.height ? c : null
      top = h.point.z - 0.002
    }
    return null
  }
  const onRoad = (a: number, b: number) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(x[b] - x[a], y[b] - y[a])))
    for (let k2 = 0; k2 <= steps; k2++) {
      const u = k2 / steps, c = groundAt(x[a] + (x[b] - x[a]) * u, y[a] + (y[b] - y[a]) * u, z[a] + (z[b] - z[a]) * u)
      if (c === null || !roads.has(c)) return false
    }
    return true
  }
  const links: [number, number][] = []
  for (const i of ends) {
    const best = new Map<number, number>()   // network: its nearest point
    around(i, roadLink.reach, (j) => {
      if (comp[j] === comp[i]) return
      const d = Math.hypot(x[j] - x[i], y[j] - y[i])
      if (d > roadLink.reach) return
      const b = best.get(comp[j]), db = b === undefined ? Infinity : Math.hypot(x[b] - x[i], y[b] - y[i])
      if (d < db || (d === db && j < b!)) best.set(comp[j], j)
    })
    for (const c of [...best.keys()].sort((a, b) => a - b)) { const j = best.get(c)!; if (onRoad(i, j)) links.push([i, j]) }
  }
  for (const [i, j] of links) { const w = Math.hypot(x[j] - x[i], y[j] - y[i]); anyEdge(i, j, w); anyEdge(j, i, w) }
  const joined = components(any), size = new Int32Array(n)
  for (let i = 0; i < n; i++) size[joined[i]]++
  let main = 0
  for (let c = 1; c < n; c++) if (size[c] > size[main]) main = c
  m.set(id, (g = { x, y, z, adj, any, ends, cell: CELL, grid, comp: joined, main }))
  return g
}

/** Each node's network (edges both ways: any), numbered from 0 in node order. */
function components(any: number[][]): Int32Array {
  const n = any.length, comp = new Int32Array(n).fill(-1)
  let c = 0
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0) continue
    const stack = [i]; comp[i] = c
    while (stack.length) {
      const u = stack.pop()!
      for (let k = 0; k < any[u].length; k += 2) { const v = any[u][k]; if (comp[v] < 0) { comp[v] = c; stack.push(v) } }
    }
    c++
  }
  return comp
}
const key = (cx: number, cy: number) => (cx + 32768) * 65536 + (cy + 32768)

/** The street point (graph node) nearest (x, y), searching rings of cells out to `rings` (only network `comp`'s points when given); -1 if none. */
function nearestNode(g: Graph, x: number, y: number, rings = 40, comp = -1): number {
  const cx = Math.floor(x / g.cell), cy = Math.floor(y / g.cell)
  let best = -1, bd = Infinity
  for (let ring = 0; ring <= rings; ring++) {
    if (best >= 0 && bd < (ring - 1) * g.cell) break   // nothing in a further ring can be nearer
    for (let ix = cx - ring; ix <= cx + ring; ix++) {
      for (let iy = cy - ring; iy <= cy + ring; iy++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== ring) continue
        for (const j of g.grid.get(key(ix, iy)) ?? []) {
          if (comp >= 0 && g.comp[j] !== comp) continue
          const d = Math.hypot(g.x[j] - x, g.y[j] - y)
          if (d < bd || (d === bd && j < best)) { bd = d; best = j }
        }
      }
    }
  }
  return best
}

// A* scratch, reused (never world state).
let gs = new Float64Array(0), from = new Int32Array(0), shut = new Uint8Array(0)

/** The shortest drive from node a to node b (A*, straight-line distance as the guess): its nodes, a first, and its length; null if none. */
function route(g: Graph, a: number, b: number, adj = g.adj): { nodes: number[]; length: number } | null {
  const n = g.x.length
  if (gs.length !== n) { gs = new Float64Array(n); from = new Int32Array(n); shut = new Uint8Array(n) }
  gs.fill(Infinity); shut.fill(0)
  const h = (i: number) => Math.hypot(g.x[i] - g.x[b], g.y[i] - g.y[b])
  const heap: number[] = [], fs: number[] = []   // node ids and their f, as a binary heap ordered by f then id
  const less = (i: number, j: number) => fs[i] < fs[j] || (fs[i] === fs[j] && heap[i] < heap[j])
  const swap = (i: number, j: number) => { [heap[i], heap[j]] = [heap[j], heap[i]]; [fs[i], fs[j]] = [fs[j], fs[i]] }
  const push = (v: number, f: number) => {
    heap.push(v); fs.push(f)
    for (let i = heap.length - 1; i > 0;) { const p = (i - 1) >> 1; if (!less(i, p)) break; swap(i, p); i = p }
  }
  const pop = () => {
    const top = heap[0]
    const lv = heap.pop()!, lf = fs.pop()!
    if (heap.length) {
      heap[0] = lv; fs[0] = lf
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1
        let m = i
        if (l < heap.length && less(l, m)) m = l
        if (r < heap.length && less(r, m)) m = r
        if (m === i) break
        swap(i, m); i = m
      }
    }
    return top
  }
  gs[a] = 0; from[a] = -1; push(a, h(a))
  while (heap.length) {
    const v = pop()
    if (shut[v]) continue
    if (v === b) {
      const nodes: number[] = []
      for (let i = b; i >= 0; i = from[i]) nodes.push(i)
      return { nodes: nodes.reverse(), length: gs[b] }
    }
    shut[v] = 1
    const e = adj[v]
    for (let k = 0; k < e.length; k += 2) {
      const w = e[k], c = gs[v] + e[k + 1]
      if (c < gs[w]) { gs[w] = c; from[w] = v; push(w, c + h(w)) }
    }
  }
  return null
}

// ---- The game ----

const KEEP = 24   // nodes of the plan kept (about 100 m); a new plan comes every plan seconds anyway
const HIDE_EVERY = 15   // ticks between looks at how far you are from the streets (anti-hide)

/** The robotaxis chasing you, in the world's order: the first, and the backup once it is called. */
const taxis = (sim: Sim) => sim.world.things.filter((t) => t.kind === Kind.car && t.car?.chase)

/** Leaving the escape (or starting another game): the robotaxis go. */
export function clearEscape(sim: Sim, s: Thing) {
  if (sim.world.things.some((t) => t.kind === Kind.car && t.car?.chase)) sim.world.things = sim.world.things.filter((t) => !(t.kind === Kind.car && t.car?.chase))
  delete s.escapeTaxi; delete s.escapeNear; delete s.escapeClose; delete s.escapeHide; delete s.escapeBackup
}

/** A robotaxi at node `at`, its way to `goal` planned, standing. */
function spawnTaxi(sim: Sim, g: Graph, at: number, goal: number): Thing {
  const E = sim.data.run.escape, hz = sim.data.physics.tickHz
  const r = (route(g, at, goal) ?? route(g, at, goal, g.any))?.nodes ?? [at]
  const c = spawn(sim, Kind.car)
  c.state = State.ground
  c.car = { path: -1, s: 0, dir: 1, speed: 0, cruise: E.cruise, robo: true, paint: -1, wait: 0, honked: false, yielding: false, hazard: false, turn: 0,
    chase: { recalc: 0, plan: Math.max(1, Math.round(E.plan * hz)), at, to: r[1] ?? at, u: 0, route: r.slice(2, 2 + KEEP), honkAt: 0 } }
  pose(sim, c, g)
  c.car.turn = 0
  return c
}

/** `run escape`: the robotaxi on the street point nearest to start metres behind you, heading your way; the clock starts. */
export function startEscape(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const E = sim.data.run.escape, hz = sim.data.physics.tickHz
  if (!E.parks.includes(sim.park.name) || !sim.park.traffic.paths.length) throw new Error(`the Robotaxi Escape is in the city (${E.parks.join(', ')}), not ${sim.park.name}`)
  const g = graphOf(sim.park, E)
  const fl = Math.hypot(sk.fwd.x, sk.fwd.y) || 1
  const at = nearestNode(g, sk.pos.x - (sk.fwd.x / fl) * E.start, sk.pos.y - (sk.fwd.y / fl) * E.start), goal = nearestNode(g, sk.pos.x, sk.pos.y)
  if (at < 0 || goal < 0) throw new Error('no street near you for the robotaxi')
  const c = spawnTaxi(sim, g, at, goal)
  s.escapeTaxi = c.id; s.escapeNear = 0; s.escapeClose = false
  s.timeLeft = Math.round(E.seconds * hz)
  events.push({ t: 'escapeStart', tick: sim.world.tick, seconds: E.seconds, car: c.id })
}

/** Where the robotaxi is: u metres from node at toward node to, lane metres right of the street's middle. */
function pose(sim: Sim, c: Thing, g: Graph) {
  const ch = c.car!.chase!, E = sim.data.run.escape
  const a = ch.at, b = ch.to, dx = g.x[b] - g.x[a], dy = g.y[b] - g.y[a], dz = g.z[b] - g.z[a], len = Math.hypot(dx, dy)
  const h0 = atan2(c.fwd.y, c.fwd.x)
  if (len > 1e-6) {
    const t = Math.min(1, ch.u / len), l3 = Math.hypot(dx, dy, dz)
    c.fwd = v3(dx / l3, dy / l3, dz / l3)
    c.pos = v3(g.x[a] + dx * t + (dy / len) * E.lane, g.y[a] + dy * t - (dx / len) * E.lane, g.z[a] + dz * t)
  }
  const sp = c.car!.speed
  c.vel = v3(c.fwd.x * sp, c.fwd.y * sp, c.fwd.z * sp)
  c.up = carFrame(c).u
  c.car!.turn = wrapAngle(atan2(c.fwd.y, c.fwd.x) - h0)
}

/** The turn at node n between coming from p and going on to q (radians, 0 straight on). */
function turnAt(g: Graph, p: number, n: number, q: number): number {
  const a = atan2(g.y[n] - g.y[p], g.x[n] - g.x[p]), b = atan2(g.y[q] - g.y[n], g.x[q] - g.x[n])
  return Math.abs(wrapAngle(b - a))
}

/**
 * The robotaxis' tick (before the skaters), each in turn: every plan seconds the shortest way to the
 * street point nearest you; then up to cruise (stopped while recalculating), slowing for the turns
 * ahead (over 45 degrees to turnSpeed, over 120, a U-turn, to uTurnSpeed), behind cars, and to stop
 * stopGap metres short of you or of the end of its way. Once the game is over they stop, hazards on.
 */
export function stepChaser(sim: Sim, s: Thing) {
  for (const c of taxis(sim)) drive(sim, s, c)
}

function drive(sim: Sim, s: Thing, c: Thing) {
  const E = sim.data.run.escape, T = sim.data.traffic, hz = sim.data.physics.tickHz, dt = 1 / hz
  const g = graphOf(sim.park, E)
  const car = c.car!, ch = car.chase!, sk = skater(sim)
  const live = s.mode === 'escape'
  if (live && --ch.plan <= 0) {
    ch.plan = Math.max(1, Math.round(E.plan * hz))
    const goal = nearestNode(g, sk.pos.x, sk.pos.y)
    const r = goal >= 0 ? route(g, ch.to, goal) ?? route(g, ch.to, goal, g.any) : null
    if (r) ch.route = r.nodes.slice(1, 1 + KEEP)
  }
  const seg = (a: number, b: number) => Math.hypot(g.x[b] - g.x[a], g.y[b] - g.y[a])
  let want = ch.recalc > 0 ? E.cruise * E.recalc.speed : E.cruise
  if (ch.recalc > 0) ch.recalc--
  if (!live) want = 0
  else {
    // The turns in the next few nodes, and the end of the way (when all of it is in the plan kept).
    let dist = seg(ch.at, ch.to) - ch.u, prev = ch.at, node = ch.to
    for (let k = 0; k < ch.route.length && dist < 40; k++) {
      const next = ch.route[k], turn = turnAt(g, prev, node, next)
      const v = turn > (2 * Math.PI) / 3 ? E.uTurnSpeed : turn > Math.PI / 4 ? E.turnSpeed : E.cruise
      want = Math.min(want, Math.sqrt(v * v + 2 * E.decel * Math.max(0, dist)))
      dist += seg(node, next); prev = node; node = next
    }
    if (ch.route.length < KEEP) {
      let rest = seg(ch.at, ch.to) - ch.u
      for (let k = 0, p = ch.to; k < ch.route.length; k++) { rest += seg(p, ch.route[k]); p = ch.route[k] }
      want = Math.min(want, Math.sqrt(2 * E.decel * Math.max(0, rest - E.stopGap)))
    }
    // You in front of it: stop stopGap short of you. Cars ahead (and the other robotaxi): keep the distance.
    const fl = Math.hypot(c.fwd.x, c.fwd.y) || 1, hx = c.fwd.x / fl, hy = c.fwd.y / fl
    const ax = sk.pos.x - c.pos.x, ay = sk.pos.y - c.pos.y, ahead = ax * hx + ay * hy, side = Math.abs(-ax * hy + ay * hx)
    if (ahead > 0 && side < T.yield.side && Math.abs(sk.pos.z - c.pos.z) < T.yield.height) want = Math.min(want, Math.sqrt(2 * E.decel * Math.max(0, ahead - T.body.length / 2 - E.stopGap)))
    for (const o of cars(sim)) want = follow(T, c, o, hx, hy, want)
  }
  car.speed += Math.max(-E.brake * dt, Math.min(E.accel * dt, want - car.speed))
  car.hazard = !live || ch.recalc > 0
  ch.u += car.speed * dt
  for (let len = seg(ch.at, ch.to); ch.u >= len; len = seg(ch.at, ch.to)) {
    if (!ch.route.length || ch.at === ch.to) { ch.u = len; car.speed = 0; break }
    ch.u -= len; ch.at = ch.to; ch.to = ch.route.shift()!
  }
  ch.u = Math.round(ch.u * 1e6) / 1e6
  pose(sim, c, g)
}

/** How far you are from a robotaxi itself (its body's outline in plan), not its middle; and up or down. */
function gap(sim: Sim, c: Thing, sk: Thing): { d: number; dz: number } {
  const B = sim.data.traffic.body, { f, l } = carFrame(c), dx = sk.pos.x - c.pos.x, dy = sk.pos.y - c.pos.y
  const ax = Math.max(0, Math.abs(dx * f.x + dy * f.y) - B.length / 2), ay = Math.max(0, Math.abs(dx * l.x + dy * l.y) - B.width / 2)
  return { d: Math.hypot(ax, ay), dz: Math.abs(sk.pos.z - c.pos.z) }
}

/**
 * The escape on the session (after the skaters): your combos set the robotaxis recalculating; how
 * close the nearer one is (escapeClose; each honks politely while that close); pulled over within
 * catch metres of either for catchSeconds; anti-hide: more than backup.far metres from every street
 * for backup.seconds and it calls for backup, a second robotaxi at the street end nearest you; the
 * clock. Time up: the last combo may land, then escapeOver with the survival bonus (session.ts).
 */
export function stepEscape(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const E = sim.data.run.escape, hz = sim.data.physics.tickHz, tick = sim.world.tick
  const all = taxis(sim)
  if (!all.length) { s.mode = 'over'; return }   // the robotaxis were cleared (traffic clear)
  for (const e of events) {
    if (e.t !== 'comboLanded' || e.player === 2 || e.points < E.recalc.points) continue
    const seconds = Math.round(Math.min(E.recalc.maxSeconds, (e.points / 1000) * E.recalc.secondsPer1000) * 10) / 10, ticks = Math.round(seconds * hz)
    let longer = false
    for (const c of all) if (ticks > c.car!.chase!.recalc) { c.car!.chase!.recalc = ticks; longer = true }
    if (longer) events.push({ t: 'escapeRecalc', tick, seconds, points: e.points })
  }
  let near = Infinity, nearZ = Infinity
  for (const c of all) {
    const { d, dz } = gap(sim, c, sk), ch = c.car!.chase!
    if (d < near) { near = d; nearZ = dz }
    if (d < E.close && tick >= ch.honkAt) {
      ch.honkAt = tick + Math.round(E.honkEvery * hz)
      events.push({ t: 'honk', tick, car: c.id, robo: true, x: round(c.pos.x), y: round(c.pos.y) })
    }
  }
  if (near < E.close && !s.escapeClose) { s.escapeClose = true; events.push({ t: 'escapeClose', tick, dist: Math.round(near * 100) / 100 }) }
  else if (near > E.close + E.closeOut) s.escapeClose = false
  s.escapeNear = near < E.catch && nearZ < 3 ? (s.escapeNear ?? 0) + 1 : 0
  if (s.escapeNear >= Math.round(E.catchSeconds * hz)) {
    s.mode = 'over'
    events.push({ t: 'escapeOver', tick, survived: false, score: sk.score, bonus: 0 })
    return
  }
  // Anti-hide: off the streets (more than backup.far from every street point) for backup.seconds.
  if (s.escapeBackup === undefined && tick % HIDE_EVERY === 0) {
    const g = graphOf(sim.park, E), n = nearestNode(g, sk.pos.x, sk.pos.y, Math.ceil(E.backup.far / g.cell) + 1)
    const off = n < 0 || Math.hypot(g.x[n] - sk.pos.x, g.y[n] - sk.pos.y) > E.backup.far
    if (off) s.escapeHide = (s.escapeHide ?? 0) + HIDE_EVERY
    else delete s.escapeHide
    if ((s.escapeHide ?? 0) >= Math.round(E.backup.seconds * hz)) {
      let end = -1, bd = Infinity
      for (const i of g.ends) { const d = Math.hypot(g.x[i] - sk.pos.x, g.y[i] - sk.pos.y); if (d < bd) { bd = d; end = i } }
      const goal = nearestNode(g, sk.pos.x, sk.pos.y)
      if (end >= 0 && goal >= 0) {
        const c = spawnTaxi(sim, g, end, goal)
        s.escapeBackup = c.id
        delete s.escapeHide
        events.push({ t: 'escapeBackup', tick, car: c.id, dist: Math.round(bd * 100) / 100 })
      }
    }
  }
  if (--s.timeLeft <= 0) s.mode = 'ending'
}

/** Time up and the last combo landed: survived, with the survival bonus added to your score. */
export function escapeSurvived(sim: Sim, s: Thing, sk: Thing): SimEvent {
  const bonus = sim.data.run.escape.survivalBonus
  sk.score += bonus
  return { t: 'escapeOver', tick: sim.world.tick, survived: true, score: sk.score, bonus }
}

const round = (x: number) => Math.round(x * 1000) / 1000

/**
 * Build the street graph now (a cache keyed by the park, never world state): the client calls it while the
 * city loads, so the first Robotaxi Escape (or the first waypoint route) does not spend its first tick on it.
 */
export function warmStreets(park: Park, rules: StreetRules) { if (park.traffic.paths.length) graphOf(park, rules) }

/**
 * The way along the streets from (ax, ay) to (bx, by), for the map's waypoint route (the client's minimap): the
 * street points of the shortest way, either way down one-ways (a skater may), or null if the streets do not join.
 * The same street graph as the robotaxi's (rules: data run.escape); scratch, never world state. Each end starts
 * from its nearest street point; when those two are on networks that do not join (a dead-end street cut off at
 * a tile's edge or by a park's lawn), both ends start from the nearest points of one network instead: whichever
 * of the two, or the city's largest, is nearest to both together.
 */
export function streetWay(park: Park, rules: StreetRules, ax: number, ay: number, bx: number, by: number): [number, number][] | null {
  if (!park.traffic.paths.length) return null
  const g = graphOf(park, rules)
  let a = nearestNode(g, ax, ay), b = nearestNode(g, bx, by)
  if (a < 0 || b < 0) return null
  if (g.comp[a] !== g.comp[b]) {
    let bd = Infinity
    for (const c of [g.comp[a], g.comp[b], g.main]) {
      const ca = nearestNode(g, ax, ay, 40, c), cb = nearestNode(g, bx, by, 40, c)
      if (ca < 0 || cb < 0) continue
      const d = Math.hypot(g.x[ca] - ax, g.y[ca] - ay) + Math.hypot(g.x[cb] - bx, g.y[cb] - by)
      if (d < bd) { bd = d; a = ca; b = cb }
    }
  }
  const r = route(g, a, b, g.any)
  return r ? r.nodes.map((i) => [g.x[i], g.y[i]] as [number, number]) : null
}
