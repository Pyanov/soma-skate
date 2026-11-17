import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { raycast, type Park } from '../sim/park/park.ts'
import { textCoverage } from './skater/tex.ts'
import { actPose, vigPoint, vigYaw, type ActPose, type VignetteData, type VigReact } from './vignettes.ts'

// SF pedestrians on the city's sidewalks (data/pedestrians.json), view only like the pigeons and
// the spectators: client side, seeded, never in the sim or the replays. Each walker has a route
// built once from the sidewalk graph (the city's curbs, walked a lane in from the curb): along
// the curb and round its corners, a wait at a dead end (the crosswalk) and across to the curb on
// the other side, and later the same way home, so where anyone is is a pure function of the
// time and shots, clips and play agree. Standing groups gather at the spots (16th St BART,
// Harvey Milk Plaza, picnics in Dolores Park, smokers outside cafes, drivers at bus stops, the
// line for the cable car at the Powell St turntable).
// They look at a skater coming by, jump aside or flinch when one skates right past, and film or
// cheer a big combo landed near them; now and then one of them says something (the toast).
// Drawn as instanced low-poly figures in the characters' style (round heads, googly eyes,
// hose limbs): one draw call per part for the whole crowd; only the ones near and in view.
// The vignettes' people (data/vignettes.json: chess on Market, the drum circle, the wedding shoot...) are
// people of the crowd too, standing, sitting or lying where their vignette puts them, posed by their act
// (vignettes.ts actPose) and reacting as their vignette says (vignettes.ts draws the props and speaks).

type V2 = [number, number]
export type CrowdType = {
  name: string; move: 'walk' | 'jog' | 'glide' | 'sit' | 'stand' | 'smoke'; speed: number; weight: number; where: string; hold: string
  colors: { top: string[]; bottom: string[]; shoes: string[]; hair?: string[]; extra?: string[]; skin?: string[] }; parts: string[]; lines: string[]
  /** Only in these neighbourhoods (CrowdData areas), on top of where. */
  areas?: string[]
  /** A dog walker's dogs (hold leash; 4 when not given). */
  dogs?: number
}
export type CrowdData = {
  seed: number; maxWalkers: number; perHundredMeters: number; standShare: number; residential: number; zoneReach: number; lane: V2
  exclude: [number, number, number, number][]; crossing: { min: number; max: number; wait: V2 }; routeSeconds: number
  zones: { street: string; density: number; lines: V2[][] }[]
  /** Neighbourhoods (circles; several may share a name): their sidewalks at least this busy, and the types local to them (CrowdType areas). */
  areas?: { name: string; at: V2; r: number; density: number }[]
  /** Metres the crowd keeps from a cast member standing at home (setKeepClear): a walker passes round them, a stander stands beside. */
  keepClear?: number
  gathers: { name: string; at: V2; radius: number; count: number; types: string[]; sit?: boolean; ground?: string; curb?: boolean; lane?: number; line?: V2 }[]
  types: Record<string, CrowdType>; skins: string[]; hairs: string[]; dogs: string[]
  reactions: { dodge: number; flinch: number; minSpeed: number; bigPoints: number; near: number; seconds: number; toastChance: number; toastCooldown: number }
  generalLines: string[]; lod: { drawDistance: number; halfRateBeyond: number; maxDrawn: number; nearCamera?: number }
  /** The vignettes (data/vignettes.json, main adds it): their people stand here too. */
  vignettes?: VignetteData
}
/** The last big combo landed (for filming and cheering): when, how big, where. */
export type CrowdLanded = { tick: number; points: number; x: number; y: number }
/**
 * A pedestrian the sim owns (an obstacle near the player): drawn by the same figure code as the
 * crowd, so the two look alike. look (0..999, fixed per pedestrian) picks the kind and colours;
 * state: walking, stepping aside (t ticks into it; the sim moves them, the view hops and throws the
 * arms up) or knocked down (t ticks since: they fall flat on their back).
 */
export type SimPedestrian = { id: number; x: number; y: number; z: number; heading: number; speed: number; state: 'walk' | 'aside' | 'down'; t: number; look: number }

/** The sim's pedestrians (Things of kind 'ped', src/sim/game/peds.ts) as the crowd draws them. */
export function simPeds(things: readonly { kind: string; alive: boolean; id: number; pos: { x: number; y: number; z: number }; fwd: { x: number; y: number }; vel: { x: number; y: number }; ped?: { look: number; act: 'walk' | 'aside' | 'down'; since: number } }[], tick: number): SimPedestrian[] {
  const out: SimPedestrian[] = []
  for (const t of things) if (t.kind === 'ped' && t.alive && t.ped) out.push({ id: t.id, x: t.pos.x, y: t.pos.y, z: t.pos.z, heading: Math.atan2(t.fwd.y, t.fwd.x), speed: Math.hypot(t.vel.x, t.vel.y), state: t.ped.act, t: tick - t.ped.since, look: t.ped.look })
  return out
}

function rng(seed: number) {
  let a = seed >>> 0
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }

// ---------------------------------------------------------------- the sidewalk graph

type Edge = { x: Float32Array; y: Float32Array; z: Float32Array; nx: Float32Array; ny: Float32Array; cum: Float32Array; len: number; a: number; b: number; density: number; zone: string; width: number; area: string }
type Node = { x: number; y: number; z: number; edges: number[]; cross: number[]; corner: number[] }
export type Graph = { nodes: Node[]; edges: Edge[] }

/** Segments in a coarse grid, for nearest and crossing tests. */
class SegGrid {
  private cells = new Map<number, number[]>()
  readonly seg: number[] = []          // ax, ay, bx, by per segment
  readonly tag: number[] = []
  private cell = 24
  add(ax: number, ay: number, bx: number, by: number, tag = 0) {
    const i = this.seg.length / 4
    this.seg.push(ax, ay, bx, by); this.tag.push(tag)
    const c = this.cell
    for (let cx = Math.floor(Math.min(ax, bx) / c); cx <= Math.floor(Math.max(ax, bx) / c); cx++) for (let cy = Math.floor(Math.min(ay, by) / c); cy <= Math.floor(Math.max(ay, by) / c); cy++) {
      const k = cx * 100003 + cy
      const l = this.cells.get(k)
      if (l) l.push(i); else this.cells.set(k, [i])
    }
  }
  near(x: number, y: number, r: number, f: (i: number) => void) {
    const c = this.cell, seen = new Set<number>()
    for (let cx = Math.floor((x - r) / c); cx <= Math.floor((x + r) / c); cx++) for (let cy = Math.floor((y - r) / c); cy <= Math.floor((y + r) / c); cy++) {
      for (const i of this.cells.get(cx * 100003 + cy) ?? []) if (!seen.has(i)) { seen.add(i); f(i) }
    }
  }
  /** Distance from a point to segment i, and the closest point. */
  dist(i: number, x: number, y: number): [number, number, number] {
    const s = this.seg, ax = s[i * 4], ay = s[i * 4 + 1], bx = s[i * 4 + 2], by = s[i * 4 + 3]
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2))
    const px = ax + dx * t, py = ay + dy * t
    return [Math.hypot(x - px, y - py), px, py]
  }
  /** Does segment i cross the segment p-q? */
  crosses(i: number, px: number, py: number, qx: number, qy: number): boolean {
    const s = this.seg, ax = s[i * 4], ay = s[i * 4 + 1], bx = s[i * 4 + 2], by = s[i * 4 + 3]
    const d = (qx - px) * (by - ay) - (qy - py) * (bx - ax)
    if (Math.abs(d) < 1e-9) return false
    const u = ((ax - px) * (by - ay) - (ay - py) * (bx - ax)) / d, v = ((ax - px) * (qy - py) - (ay - py) * (qx - px)) / d
    return u > 0.05 && u < 0.95 && v >= 0 && v <= 1
  }
}

/** The sidewalks: the city's curbs (each walked on its sidewalk side), joined at their ends, with crosswalks between dead ends. */
export function sidewalkGraph(park: Park, d: CrowdData): Graph {
  const roads = new SegGrid()
  for (const p of park.traffic.paths) for (let i = 1; i < p.points.length; i++) roads.add(p.points[i - 1][0], p.points[i - 1][1], p.points[i][0], p.points[i][1])
  const zones = new SegGrid()
  d.zones.forEach((z, zi) => { for (const l of z.lines) for (let i = 1; i < l.length; i++) zones.add(l[i - 1][0], l[i - 1][1], l[i][0], l[i][1], zi) })
  const excluded = (x: number, y: number) => d.exclude.some(([x0, y0, x1, y1]) => x > x0 && x < x1 && y > y0 && y < y1)
  const nodes: Node[] = [], edges: Edge[] = []
  const nodeGrid = new Map<string, number[]>()
  const nodeAt = (x: number, y: number, z: number) => {
    const kx = Math.round(x / 1.2), ky = Math.round(y / 1.2)
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const n of nodeGrid.get(`${kx + i},${ky + j}`) ?? []) if (Math.hypot(nodes[n].x - x, nodes[n].y - y) < 1.0) return n
    nodes.push({ x, y, z, edges: [], cross: [], corner: [] })
    const k = `${kx},${ky}`
    nodeGrid.set(k, [...(nodeGrid.get(k) ?? []), nodes.length - 1])
    return nodes.length - 1
  }
  // An edge: a polyline with its sidewalk-side normals; a density from the busiest zone near it.
  const addEdge = (P: { x: number; y: number; z: number }[], side: (mx: number, my: number, nx: number, ny: number) => number) => {
    const n = P.length
    const ex = new Float32Array(n), ey = new Float32Array(n), ez = new Float32Array(n), nx = new Float32Array(n), ny = new Float32Array(n), cum = new Float32Array(n)
    for (let i = 0; i < n; i++) {
      ex[i] = P[i].x; ey[i] = P[i].y; ez[i] = P[i].z
      const a = P[Math.max(0, i - 1)], b = P[Math.min(n - 1, i + 1)]
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1
      nx[i] = -ty / tl; ny[i] = tx / tl
      if (i) cum[i] = cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y)
    }
    const mi = Math.floor(n / 2), mid = P[mi]
    const sg = side(mid.x, mid.y, nx[mi], ny[mi])
    for (let i = 0; i < n; i++) { nx[i] *= sg; ny[i] *= sg }
    let density = d.residential, zone = ''
    zones.near(mid.x, mid.y, d.zoneReach, (i) => { const z = d.zones[zones.tag[i]]; if (z.density > density && zones.dist(i, mid.x, mid.y)[0] < d.zoneReach) { density = z.density; zone = z.street } })
    const inArea = d.areas?.find((a) => Math.hypot(mid.x - a.at[0], mid.y - a.at[1]) < a.r)
    if (inArea) density = Math.max(density, inArea.density)
    // How wide the sidewalk is: walk in from the curb until the ground stops being sidewalk.
    let width = 0.8
    for (const k of [0.25, 0.75]) {
      const i = Math.min(n - 1, Math.floor(n * k)), mz = P[i].z
      let w = 0
      for (let o = 0.6; o <= 5.4; o += 0.6) {
        const h = raycast(park, { x: P[i].x + nx[i] * o, y: P[i].y + ny[i] * o, z: mz + 2.5 }, { x: 0, y: 0, z: -1 }, 5)
        if (!h || Math.abs(h.point.z - mz) > 0.6 || !WALKABLE.has(park.elements[park.elem[h.tri]].collection)) break
        w = o
      }
      width = k === 0.25 ? w : Math.min(width, w)
    }
    const a = nodeAt(P[0].x, P[0].y, P[0].z), b = nodeAt(P[n - 1].x, P[n - 1].y, P[n - 1].z)
    edges.push({ x: ex, y: ey, z: ez, nx, ny, cum, len: cum[n - 1], a, b, density, zone, width: Math.max(0.8, width), area: inArea?.name ?? '' })
    nodes[a].edges.push(edges.length - 1); nodes[b].edges.push(edges.length - 1)
  }
  const curbs = new SegGrid()
  for (const r of park.rails) {
    if (r.kind !== 'curb' || r.points.length < 2) continue
    const P = r.points
    let len = 0
    for (let i = 1; i < P.length; i++) len += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y)
    for (let i = 1; i < P.length; i++) curbs.add(P[i - 1].x, P[i - 1].y, P[i].x, P[i].y)
    if (len < 2.5 || P.some((q) => excluded(q.x, q.y))) continue
    // The sidewalk is the side away from the nearest street centreline.
    const mid = P[Math.floor(P.length / 2)]
    let best = 1e9, rx = 0, ry = 0
    roads.near(mid.x, mid.y, 40, (i) => { const [dd, px, py] = roads.dist(i, mid.x, mid.y); if (dd < best) { best = dd; rx = px; ry = py } })
    if (best > 40) continue
    addEdge(P, (mx, my, nx, ny) => ((rx - mx) * nx + (ry - my) * ny > 0 ? -1 : 1))
  }
  // Streets the curbs do not cover (the Castro, the hills): sidewalks either side of the centreline,
  // set back by the street's width, wherever no curb is near.
  for (const path of park.traffic.paths) {
    const w = path.lanes * 1.7 + 2.2
    let run: { x: number; y: number; z: number }[] = []
    const flush = () => {
      let len = 0
      for (let i = 1; i < run.length; i++) len += Math.hypot(run[i].x - run[i - 1].x, run[i].y - run[i - 1].y)
      if (run.length >= 2 && len > 10) for (const sgn of [1, -1]) {
        const P = run.map((q, i) => {
          const a = run[Math.max(0, i - 1)], b = run[Math.min(run.length - 1, i + 1)], tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty) || 1
          return { x: q.x - (ty / tl) * w * sgn, y: q.y + (tx / tl) * w * sgn, z: q.z + 0.14 }
        })
        if (!P.some((q) => excluded(q.x, q.y))) addEdge(P, () => sgn)
      }
      run = []
    }
    // Resample the centreline every 4 m; a stretch with no curb within 12 m becomes sidewalk.
    for (let i = 1; i < path.points.length; i++) {
      const [ax, ay, az] = path.points[i - 1], [bx, by, bz] = path.points[i]
      const L = Math.hypot(bx - ax, by - ay), steps = Math.max(1, Math.ceil(L / 4))
      for (let k = i === 1 ? 0 : 1; k <= steps; k++) {
        const u = k / steps, x = ax + (bx - ax) * u, y = ay + (by - ay) * u, z = az + (bz - az) * u
        let covered = false
        curbs.near(x, y, 12, (c) => { if (!covered && curbs.dist(c, x, y)[0] < 12) covered = true })
        if (covered) flush(); else run.push({ x, y, z })
      }
    }
    flush()
  }
  // Crosswalks: from a dead end to the nearest ends across a street (the line crosses a centreline);
  // corners: to a dead end close by on the same side of every street (round the block's corner).
  const ends = nodes.map((nd, i) => ({ i, nd })).filter(({ nd }) => nd.edges.length === 1)
  const endGrid = new SegGrid()
  for (const { i, nd } of ends) endGrid.add(nd.x, nd.y, nd.x, nd.y, i)
  for (const { i, nd } of ends) {
    const cand: [number, number][] = [], corner: [number, number][] = []
    endGrid.near(nd.x, nd.y, d.crossing.max, (k) => {
      const j = endGrid.tag[k], o = nodes[j]
      const dist = Math.hypot(o.x - nd.x, o.y - nd.y)
      if (j === i || dist > d.crossing.max) return
      // Crossing a street: straight across it (not diagonally through the junction), one street only.
      let roadsCrossed = 0, square = true
      roads.near((nd.x + o.x) / 2, (nd.y + o.y) / 2, dist / 2 + 2, (r) => {
        if (!roads.crosses(r, nd.x, nd.y, o.x, o.y)) return
        roadsCrossed++
        const S = roads.seg, rx = S[r * 4 + 2] - S[r * 4], ry = S[r * 4 + 3] - S[r * 4 + 1], rl = Math.hypot(rx, ry) || 1
        if (Math.abs((rx * (o.x - nd.x) + ry * (o.y - nd.y)) / (rl * dist)) > 0.45) square = false
      })
      if (roadsCrossed === 1 && square && dist >= d.crossing.min) cand.push([dist, j])
      else if (!roadsCrossed && dist < 12) corner.push([dist, j])
    })
    cand.sort((p, q) => p[0] - q[0]); corner.sort((p, q) => p[0] - q[0])
    nd.cross = cand.slice(0, 3).map((c) => c[1])
    nd.corner = corner.slice(0, 2).map((c) => c[1])
  }
  return { nodes, edges }
}

const WALKABLE = new Set(['city_sidewalk', 'city_curb', 'city_furniture', 'city_pole', 'city_prop', 'city_trunk', 'city_path', 'city_spot', 'city_spot_furniture', 'city_park', 'city_lot', 'city_median'])

/** A point on an edge at arc length s, `lane` metres in onto the sidewalk (no further than it is wide); and its direction. */
function onEdge(e: Edge, s: number, lane: number, out: { x: number; y: number; z: number; dx: number; dy: number }) {
  s = Math.max(0, Math.min(e.len, s))
  lane = Math.min(lane, e.width - 0.35)
  let lo = 0, hi = e.cum.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (e.cum[m] <= s) lo = m; else hi = m }
  const seg = e.cum[hi] - e.cum[lo] || 1, u = (s - e.cum[lo]) / seg
  const nx = e.nx[lo] + (e.nx[hi] - e.nx[lo]) * u, ny = e.ny[lo] + (e.ny[hi] - e.ny[lo]) * u
  out.x = e.x[lo] + (e.x[hi] - e.x[lo]) * u + nx * lane
  out.y = e.y[lo] + (e.y[hi] - e.y[lo]) * u + ny * lane
  out.z = e.z[lo] + (e.z[hi] - e.z[lo]) * u
  const dx = e.x[hi] - e.x[lo], dy = e.y[hi] - e.y[lo], dl = Math.hypot(dx, dy) || 1
  out.dx = dx / dl; out.dy = dy / dl
}

// ---------------------------------------------------------------- people and their routes

type Leg = { kind: 0 | 1 | 2 | 3;   // along a sidewalk, a wait, across a street, round a corner
  edge: number; s0: number; s1: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; t0: number; dur: number; face: number }
/** Legs packed 13 floats each (thousands of people, dozens of legs each): the fields of Leg in order. */
const LEG = 13
const LEG_FIELDS = ['kind', 'edge', 's0', 's1', 'ax', 'ay', 'az', 'bx', 'by', 'bz', 't0', 'dur', 'face'] as const
type Person = {
  type: string; T: CrowdType; seed: number; scale: number; width: number
  skin: THREE.Color; top: THREE.Color; bottom: THREE.Color; shoes: THREE.Color; hair: THREE.Color; extra: THREE.Color; dogs: THREE.Color[]
  legs: Float32Array | null; total: number; offset: number; lane: number
  fixed: { x: number; y: number; z: number; h: number } | null
  inPlace: boolean                     // a review line-up: walking on the spot
  // live state (pose, reactions)
  x: number; y: number; z: number; h: number; moving: number; dist: number
  dodge: number; dodgeX: number; dodgeY: number; react: number; reactKind: 0 | 1 | 2; seenLand: number; told: boolean
  picnic: number; bx: number; by: number   // a picnic's blanket (the one who brought it, and the speaker), else -1
  placedAt: number
  // A vignette's person: its index (-1 none), the act, a chair's height (or how high they stand: a rope, a pedestal),
  // extra (dropped on low), which side of a couple, a line walked back and forth (with z) or a circle round a point.
  vig: number; act: string; seat: number; lift: number; spare: boolean; side: number
  path: { x: number; y: number; z: number }[] | null; pathSpeed: number
  circle: { x: number; y: number; z: number; r: number; speed: number; a: number; zs: number[] } | null   // zs: the ground round it, 24 points
}

/** Someone of a type, their colours and build from the seeded stream. */
function makePerson(type: string, d: CrowdData, r: () => number): Person {
  const T = d.types[type]
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length) % list.length]
  const c = (l: string[]) => new THREE.Color(pick(l))
  return {
    type, T, seed: r(), scale: 0.92 + r() * 0.16, width: 0.9 + r() * 0.25,
    skin: c(T.colors.skin ?? d.skins), top: c(T.colors.top), bottom: c(T.colors.bottom), shoes: c(T.colors.shoes), hair: c(T.colors.hair ?? d.hairs), extra: c(T.colors.extra ?? ['#2c3442', '#1f6f63', '#6b4a2e', '#c8372d', '#23314f', '#1d1d22']), dogs: Array.from({ length: Math.max(4, T.dogs ?? 4) }, () => c(d.dogs)),
    legs: null, total: 1, offset: 0, lane: d.lane[0] + r() * (d.lane[1] - d.lane[0]), fixed: null, inPlace: false,
    x: 0, y: 0, z: 0, h: 0, moving: 0, dist: 0, dodge: -1e9, dodgeX: 0, dodgeY: 0, react: -1e9, reactKind: 0, seenLand: -1, told: false, picnic: -1, bx: 0, by: 0, placedAt: -1,
    vig: -1, act: '', seat: 0, lift: 0, spare: false, side: 0, path: null, pathSpeed: 0, circle: null,
  }
}

/** The routes and placements, all seeded: walkers on the sidewalks by street, groups at the gathers. */
export function crowdPeople(park: Park, g: Graph, d: CrowdData): Person[] {
  const r = rng(d.seed)
  const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length) % list.length]
  const people: Person[] = []
  const typeIds = Object.keys(d.types)
  const whereOk = (where: string, e: Edge) => where === 'any' ? true : where === 'busy' ? e.density >= 0.5 : where === 'mission' ? (e.zone === 'Mission St' || e.zone === '16th St' || e.zone === 'Valencia St') : false
  // A neighbourhood's own types only there (the Castro's roller disco, downtown's suits, the Wharf's tourists with maps).
  const allowed = (type: string, e: Edge) => { const T = d.types[type]; return whereOk(T.where, e) && (!T.areas || T.areas.includes(e.area)) }
  const make = (type: string) => makePerson(type, d, r)
  // Walkers: on each sidewalk by its density, a type allowed there (by weight).
  const walkTypes = typeIds.filter((k) => d.types[k].weight > 0 && (d.types[k].move === 'walk' || d.types[k].move === 'jog' || d.types[k].move === 'glide' || d.types[k].move === 'stand'))
  let budget = 0
  const counts = g.edges.map((e) => (e.len / 100) * d.perHundredMeters * e.density)
  const sum = counts.reduce((a, b) => a + b, 0)
  const k = Math.min(1, d.maxWalkers / Math.max(1, sum))
  for (const [ei, e] of g.edges.entries()) {
    budget += counts[ei] * k
    while (budget >= 1) {
      budget -= 1
      const ok = walkTypes.filter((t) => allowed(t, e))
      if (!ok.length) continue
      let w = r() * ok.reduce((s, t) => s + d.types[t].weight, 0), type = ok[0]
      for (const t of ok) { w -= d.types[t].weight; if (w <= 0) { type = t; break } }
      const p = make(type)
      const loiter = p.T.move === 'walk' && e.density >= 0.5 && r() < d.standShare
      if (p.T.move === 'stand' || loiter) {
        // Standing about on the sidewalk: a driver on break, someone filming themselves, people
        // chatting or looking in a shop window (by the buildings, facing the street or the shop).
        const at = { x: 0, y: 0, z: 0, dx: 0, dy: 0 }
        if (loiter) p.lane = d.lane[1] + 0.3 + r() * 0.6
        onEdge(e, r() * e.len, p.lane, at)
        p.fixed = { x: at.x, y: at.y, z: at.z, h: Math.atan2(-e.ny[0], -e.nx[0]) + (loiter && r() < 0.5 ? Math.PI : 0) + (r() - 0.5) }
        if (loiter && r() < 0.6) {
          // A friend to talk to.
          const q = make(type)
          q.fixed = { x: at.x + at.dx * 0.9, y: at.y + at.dy * 0.9, z: at.z, h: Math.atan2(-at.dy, -at.dx) }
          p.fixed.h = Math.atan2(at.dy, at.dx)
          people.push(q)
        }
      } else route(p, g, ei, r() * e.len, d, r)
      people.push(p)
    }
  }
  // Gathers: groups standing (or sitting) round a point.
  for (const G of d.gathers) {
    const placed: { x: number; y: number }[] = []
    const ground = (x: number, y: number) => raycast(park, { x, y, z: 400 }, { x: 0, y: 0, z: -1 }, 800)
    if (G.curb) {
      // On the sidewalk by the nearest curb: smokers face along it, drivers face the street.
      let best = -1, bs = 0, bd = 1e9
      g.edges.forEach((e, ei) => { for (let i = 0; i < e.x.length; i++) { const dd = Math.hypot(e.x[i] - G.at[0], e.y[i] - G.at[1]); if (dd < bd) { bd = dd; best = ei; bs = e.cum[i] } } })
      if (best < 0 || bd > 30) continue
      for (let i = 0; i < G.count; i++) {
        const p = make(pick(G.types)), e = g.edges[best], at = { x: 0, y: 0, z: 0, dx: 0, dy: 0 }
        onEdge(e, bs + (i - (G.count - 1) / 2) * 1.1, G.lane ?? 2, at)
        const toStreet = Math.atan2(-e.ny[0], -e.nx[0])
        p.fixed = { x: at.x, y: at.y, z: at.z, h: p.T.move === 'smoke' ? Math.atan2(at.dy, at.dx) + (i % 2 ? Math.PI : 0) + 0.6 : toStreet }
        people.push(p)
      }
      continue
    }
    if (G.line) {
      // A queue: single file from at (its front) back toward line, everyone facing the front, a
      // little out of line and turned now and then (the wait for the cable car at Powell).
      const L = Math.hypot(G.line[0] - G.at[0], G.line[1] - G.at[1]) || 1
      const ux = (G.line[0] - G.at[0]) / L, uy = (G.line[1] - G.at[1]) / L
      for (let i = 0; i < G.count; i++) {
        const s = Math.min(L, i * 0.8 + (r() - 0.5) * 0.25), w = (r() - 0.5) * 0.4
        const x = G.at[0] + ux * s - uy * w, y = G.at[1] + uy * s + ux * w
        const h = ground(x, y)
        if (!h) continue
        const p = make(pick(G.types))
        p.fixed = { x, y, z: h.point.z, h: Math.atan2(-uy, -ux) + (r() < 0.2 ? (r() - 0.5) * 2.4 : (r() - 0.5) * 0.5) }
        people.push(p)
      }
      continue
    }
    const blankets: { x: number; y: number; n: number; fails: number; owner: boolean }[] = []
    const okGround = (x: number, y: number) => {
      const h = ground(x, y)
      if (!h || h.normal.z < 0.9) return null
      if (G.ground && park.elements[park.elem[h.tri]].collection !== G.ground) return null
      return h
    }
    for (let i = 0, tries = 0; i < G.count && tries < G.count * 40; tries++) {
      let x = G.at[0] + (r() * 2 - 1) * G.radius, y = G.at[1] + (r() * 2 - 1) * G.radius
      if (Math.hypot(x - G.at[0], y - G.at[1]) > G.radius) continue
      let b: (typeof blankets)[number] | null = null
      if (G.sit) {
        // Picnics: two to four round a blanket laid on the grass.
        b = blankets[blankets.length - 1] ?? null
        if (!b || b.n >= 2 + Math.floor((b.x * 7.31) % 1 * 3 + 3) % 3 || b.fails > 6) {
          if (!okGround(x, y) || blankets.some((q) => Math.hypot(q.x - x, q.y - y) < 4)) continue
          b = { x, y, n: 0, fails: 0, owner: false }
          blankets.push(b)
        }
        const a = (b.n * 2.1 + r() * 0.6) % (Math.PI * 2)
        x = b.x + Math.cos(a) * 0.95; y = b.y + Math.sin(a) * 0.95
      }
      const h = !placed.some((q) => Math.hypot(q.x - x, q.y - y) < (G.sit ? 0.7 : 1.1)) ? okGround(x, y) : null
      if (!h) { if (b) b.fails++; continue }
      const p = make(pick(G.types))
      const cx = b ? b.x : G.at[0], cy = b ? b.y : G.at[1]
      p.fixed = { x, y, z: h.point.z, h: Math.atan2(cy - y, cx - x) + (b ? 0 : (r() - 0.5) * 1.6) }
      if (b && !b.owner) { b.owner = true; p.picnic = blankets.length - 1; p.bx = cx; p.by = cy }   // this one brought the blanket and the speaker
      if (b) b.n++
      placed.push({ x, y }); people.push(p); i++
    }
  }
  // The vignettes' people: where their vignette puts them (data/vignettes.json), on the ground there; first in the
  // list, so the most drawn at once (lod.maxDrawn) never leaves them out.
  const V = d.vignettes, vigPeople: Person[] = []
  if (V) V.vignettes.forEach((v, vi) => {
    const groundAt = (x: number, y: number) => v.floor !== undefined ? v.floor : raycast(park, { x, y, z: 400 }, { x: 0, y: 0, z: -1 }, 800)?.point.z ?? null   // indoors: the room's floor
    const ax = vigPoint(v, 0, 0), az = groundAt(ax.x, ax.y) ?? 0
    for (const mb of v.members) {
      if (!d.types[mb.type]) continue
      const w = vigPoint(v, mb.at[0], mb.at[1]), z = groundAt(w.x, w.y) ?? az
      const p = make(mb.type)
      p.vig = vi; p.act = mb.act; p.seat = mb.seat ?? 0; p.lift = mb.z ?? 0; p.spare = !!mb.extra; p.side = mb.act === 'couple' ? (mb.at[0] < 0 ? -1 : 1) : 0
      p.fixed = { x: w.x, y: w.y, z, h: vigYaw(v.heading, mb.face) }
      if (mb.path && mb.path.length > 1) { p.path = mb.path.map(([rr, aa]) => { const q = vigPoint(v, rr, aa); return { x: q.x, y: q.y, z: (groundAt(q.x, q.y) ?? z) + p.lift } }); p.pathSpeed = mb.speed ?? 0.5 }
      if (mb.circle) p.circle = { x: ax.x, y: ax.y, z: az, r: mb.circle, speed: mb.speed ?? 2, a: Math.atan2(w.y - ax.y, w.x - ax.x), zs: Array.from({ length: 24 }, (_, k) => groundAt(ax.x + Math.cos((k / 24) * Math.PI * 2) * mb.circle!, ax.y + Math.sin((k / 24) * Math.PI * 2) * mb.circle!) ?? az) }
      vigPeople.push(p)
    }
  })
  return [...vigPeople, ...people]
}

/** Pick one of the ways on, the busier the likelier (people stay on the busy streets). */
function biased(opts: [number, number][], r: () => number): number {
  const w = opts.map(([, dd]) => Math.pow(Math.max(0.01, dd), 3))
  let k = r() * w.reduce((a, b) => a + b, 0)
  for (let i = 0; i < opts.length; i++) { k -= w[i]; if (k <= 0) return opts[i][0] }
  return opts[opts.length - 1][0]
}

/** A walk: along the sidewalks and round the corners, waits and crossings, then the same way back. */
function route(p: Person, g: Graph, e0: number, s0: number, d: CrowdData, r: () => number) {
  const legs: Leg[] = []
  const speed = p.T.speed * (0.9 + r() * 0.2)
  let t = 0, e = e0, s = s0, dir = r() < 0.5 ? 1 : -1
  const at = { x: 0, y: 0, z: 0, dx: 0, dy: 0 }
  const leg = (l: Omit<Leg, 't0'>) => { legs.push({ ...l, t0: t }); t += l.dur }
  const half = d.routeSeconds / 2
  for (let guard = 0; t < half && guard < 200; guard++) {
    const edge = g.edges[e]
    const s1 = dir > 0 ? edge.len : 0
    if (Math.abs(s1 - s) > 0.1) leg({ kind: 0, edge: e, s0: s, s1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, dur: Math.abs(s1 - s) / speed, face: 0 })
    const n = dir > 0 ? edge.b : edge.a, node = g.nodes[n]
    const next = node.edges.filter((x) => x !== e)
    // The ways on: the next sidewalk, round the corner, or across the street; the busier the likelier.
    const dens = (x: number) => (g.nodes[x].edges.length ? g.edges[g.nodes[x].edges[0]].density : 0)
    const ways: [number, number][] = [...next.map((x, i) => [i, g.edges[x].density] as [number, number]), ...node.corner.map((x, i) => [100 + i, dens(x)] as [number, number]), ...node.cross.map((x, i) => [200 + i, dens(x) * (next.length || node.corner.length ? 0.12 : 1)] as [number, number])]   // across only now and then while the sidewalk goes on
    if (!next.length) ways.push([300, edge.density * 0.2])   // or back the way they came (a stroll up and down the block)
    const way = ways.length ? biased(ways, r) : -1
    if (way >= 100 && way < 200) {
      // Round the corner to the next sidewalk of the block.
      const m = node.corner[way - 100], to = g.nodes[m]
      if (to.edges.length) {
        onEdge(edge, s1, p.lane, at)
        const ax = at.x, ay = at.y, az = at.z
        const e2 = to.edges[0], ne = g.edges[e2], d2 = ne.a === m ? 1 : -1
        onEdge(ne, d2 > 0 ? 0 : ne.len, p.lane, at)
        leg({ kind: 3, edge: e, s0: 0, s1: 0, ax, ay, az, bx: at.x, by: at.y, bz: at.z, dur: Math.max(0.3, Math.hypot(at.x - ax, at.y - ay) / speed), face: Math.atan2(at.y - ay, at.x - ax) })
        e = e2; dir = d2; s = d2 > 0 ? 0 : ne.len
        continue
      }
    }
    if (way >= 0 && way < 100) {
      e = next[way]
      const ne = g.edges[e]
      dir = ne.a === n ? 1 : -1; s = dir > 0 ? 0 : ne.len
      continue
    }
    if (way >= 200 && way < 300) {
      // The crosswalk: wait, then across to the curb on the other side and on along it.
      const m = node.cross[way - 200], to = g.nodes[m]
      if (!to.edges.length) break
      onEdge(edge, s1, p.lane, at)
      const ax = at.x, ay = at.y, az = at.z
      const e2 = to.edges[0], ne = g.edges[e2], d2 = ne.a === m ? 1 : -1
      onEdge(ne, d2 > 0 ? 0 : ne.len, p.lane, at)
      const wait = p.T.move === 'jog' || p.T.move === 'glide' ? 0.6 + r() : d.crossing.wait[0] + r() * (d.crossing.wait[1] - d.crossing.wait[0])
      const face = Math.atan2(at.y - ay, at.x - ax)
      leg({ kind: 1, edge: e, s0: s1, s1, ax, ay, az, bx: ax, by: ay, bz: az, dur: wait, face })
      leg({ kind: 2, edge: e, s0: 0, s1: 0, ax, ay, az, bx: at.x, by: at.y, bz: at.z, dur: Math.hypot(at.x - ax, at.y - ay) / speed, face })
      e = e2; dir = d2; s = d2 > 0 ? 0 : ne.len
      continue
    }
    // A dead end with nowhere to cross: turn round.
    onEdge(edge, s1, p.lane, at)
    leg({ kind: 1, edge: e, s0: s1, s1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, dur: 1 + r() * 2, face: Math.atan2(at.dy * dir, at.dx * dir) })
    dir = -dir; s = s1
  }
  // Home the same way.
  const back = legs.slice().reverse().map((l) => ({ ...l, s0: l.s1, s1: l.s0, ax: l.bx, ay: l.by, az: l.bz, bx: l.ax, by: l.ay, bz: l.az, face: l.face + Math.PI }))
  for (const l of back) { l.t0 = t; t += l.dur; legs.push(l) }
  const packed = new Float32Array(legs.length * LEG)
  legs.forEach((l, i) => LEG_FIELDS.forEach((f, k) => { packed[i * LEG + k] = l[f] }))
  p.legs = packed; p.total = Math.max(1, t); p.offset = r() * p.total
}

// ---------------------------------------------------------------- figures (instanced parts)

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z)
const along = (g: THREE.BufferGeometry, from: THREE.Vector3, to: THREE.Vector3) => {
  const dir = to.clone().sub(from), len = dir.length()
  g.scale(1, len, 1)
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(V(0, 1, 0), dir.normalize()))
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2)
  return g
}
const M = (geos: THREE.BufferGeometry[]) => mergeGeometries(geos.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => { for (const n of Object.keys(g.attributes)) if (n !== 'position' && n !== 'normal' && n !== 'uv') g.deleteAttribute(n); return g }))!

// Body layout (metres, figure frame: x forward, y left, z up).
const HIP = 0.92, THIGH = 0.42, SHIN = 0.42, TORSO = 0.5, UPPER = 0.27, FORE = 0.26

function printTexture(kind: 'heart' | 'bib' | 'rainbow'): THREE.Texture {
  const W = 128, H = 96, data = new Uint8Array(W * H * 4)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = x / W, v = y / H   // rows bottom up (flipY off)
    let c = [244, 244, 242]
    if (kind === 'rainbow') {
      // Six stripes, red at the top.
      const R = [[228, 3, 3], [255, 140, 0], [255, 237, 0], [0, 128, 38], [36, 64, 142], [115, 41, 130]]
      c = R[Math.min(5, Math.floor((1 - v) * 6))]
    } else if (kind === 'heart') {
      // I (heart) SF
      if (textCoverage('I', (u - 0.08) / 0.16, (0.75 - v) / 0.5) > 0.5) c = [30, 30, 34]
      const hx = (u - 0.43) / 0.17, hy = (v - 0.48) / 0.17
      if (Math.pow(hx * hx + hy * hy - 1, 3) - hx * hx * Math.pow(hy, 3) < 0) c = [212, 40, 52]
      if (textCoverage('SF', (u - 0.62) / 0.16, (0.75 - v) / 0.5) > 0.5) c = [30, 30, 34]
    } else {
      // A race bib: HALF and a number, the Golden Gate's orange band.
      if (v > 0.8) c = [240, 88, 42]
      if (textCoverage('HALF', (u - 0.12) / 0.19, (0.78 - v) / 0.24) > 0.5) c = [30, 30, 34]
      if (textCoverage('1849', (u - 0.12) / 0.19, (0.45 - v) / 0.32) > 0.5) c = [30, 30, 34]
    }
    data.set([c[0], c[1], c[2], 255], (y * W + x) * 4)
  }
  const t = new THREE.DataTexture(data, W, H)
  t.colorSpace = THREE.SRGBColorSpace
  t.flipY = false
  t.needsUpdate = true
  return t
}

function partGeometries() {
  const sph = (r: number, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h)
  const torso = new THREE.CapsuleGeometry(0.16, TORSO - 0.24, 3, 10).rotateX(Math.PI / 2).scale(0.72, 1, 1).translate(0, 0, TORSO / 2)
  const vest = new THREE.CapsuleGeometry(0.168, TORSO - 0.3, 3, 10).rotateX(Math.PI / 2).scale(0.74, 1.02, 1).translate(0, 0, TORSO / 2 + 0.01)
  return {
    torso, vest,
    apron: new THREE.BoxGeometry(0.02, 0.26, 0.42).translate(0.122, 0, 0.2),
    hood: sph(0.12, 10, 6).scale(0.7, 1.15, 0.6).translate(-0.12, 0, TORSO - 0.02),
    heart: new THREE.PlaneGeometry(0.2, 0.15).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0.121, 0, 0.33),
    bib: new THREE.PlaneGeometry(0.16, 0.12).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0.121, 0, 0.3),
    rainbow: new THREE.PlaneGeometry(0.22, 0.16).rotateX(Math.PI / 2).rotateZ(Math.PI / 2).translate(0.121, 0, 0.32),
    tie: new THREE.BoxGeometry(0.012, 0.05, 0.3).translate(0.12, 0, 0.3),
    sunhat: M([new THREE.CylinderGeometry(0.27, 0.27, 0.012, 16).rotateX(Math.PI / 2).translate(0, 0, 0.27), new THREE.CylinderGeometry(0.135, 0.15, 0.1, 14).rotateX(Math.PI / 2).translate(0, 0, 0.32)]),
    rollers: M([new THREE.BoxGeometry(0.2, 0.08, 0.025).translate(0.05, 0, -0.085), ...[0.12, -0.02].flatMap((x) => [1, -1].map((s) => new THREE.CylinderGeometry(0.028, 0.028, 0.025, 8).translate(x, s * 0.035, -0.115)))]),
    skirt: new THREE.CylinderGeometry(0.15, 0.27, 0.48, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, -0.2),
    // Head frame: the neck at the origin.
    head: sph(0.15, 14, 10).translate(0.01, 0, 0.17),
    eyes: M([1, -1].map((s) => sph(0.046, 9, 7).scale(0.6, 1, 1.15).translate(0.14, s * 0.052, 0.2))),
    pupils: M([1, -1].map((s) => sph(0.022, 7, 5).translate(0.172, s * 0.05, 0.195))),
    mouth: sph(0.03, 8, 5).scale(0.4, 1.2, 0.5).translate(0.155, 0, 0.1),
    hairShort: new THREE.SphereGeometry(0.157, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.42).rotateX(Math.PI / 2).rotateY(-0.45).translate(0.01, 0, 0.17),
    hairBun: M([new THREE.SphereGeometry(0.157, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.4).rotateX(Math.PI / 2).rotateY(-0.45).translate(0.01, 0, 0.17), sph(0.065).translate(-0.08, 0, 0.32)]),
    hairLong: M([new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.45).rotateX(Math.PI / 2).rotateY(-0.4).translate(0.01, 0, 0.17), new THREE.CapsuleGeometry(0.11, 0.18, 3, 8).rotateX(Math.PI / 2).scale(0.6, 1.2, 1).translate(-0.09, 0, 0.06)]),
    beanie: M([new THREE.SphereGeometry(0.16, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.5).rotateX(Math.PI / 2).scale(1, 1, 1.2).rotateY(-0.25).translate(0, 0, 0.24), sph(0.035, 6, 5).translate(-0.04, 0, 0.44)]),
    muniCap: M([new THREE.CylinderGeometry(0.15, 0.155, 0.08, 14).rotateX(Math.PI / 2).translate(0, 0, 0.3), new THREE.CylinderGeometry(0.17, 0.17, 0.02, 14).rotateX(Math.PI / 2).translate(0.02, 0, 0.345), new THREE.BoxGeometry(0.1, 0.18, 0.012).translate(0.17, 0, 0.27)]),
    helmet: new THREE.SphereGeometry(0.168, 12, 7, 0, Math.PI * 2, 0, Math.PI * 0.55).rotateX(Math.PI / 2).translate(0, 0, 0.19),
    headband: new THREE.TorusGeometry(0.152, 0.018, 6, 18).translate(0, 0, 0.25),
    vr: M([new THREE.BoxGeometry(0.11, 0.26, 0.11).translate(0.15, 0, 0.21), new THREE.TorusGeometry(0.15, 0.015, 6, 18).translate(0, 0, 0.21)]),
    salmonFin: new THREE.ConeGeometry(0.06, 0.2, 4).scale(1.6, 0.3, 1).translate(-0.04, 0, 0.36),
    // Limbs hang down -z from their joint.
    upperArm: new THREE.CylinderGeometry(0.046, 0.042, UPPER, 7).rotateX(Math.PI / 2).translate(0, 0, -UPPER / 2),
    foreArm: M([new THREE.CylinderGeometry(0.041, 0.037, FORE, 7).rotateX(Math.PI / 2).translate(0, 0, -FORE / 2), sph(0.043, 7, 5)]),
    hand: sph(0.052, 8, 6).translate(0, 0, -FORE - 0.03),
    thigh: new THREE.CylinderGeometry(0.068, 0.058, THIGH, 8).rotateX(Math.PI / 2).translate(0, 0, -THIGH / 2),
    shin: M([new THREE.CylinderGeometry(0.056, 0.045, SHIN, 8).rotateX(Math.PI / 2).translate(0, 0, -SHIN / 2), sph(0.058, 7, 5)]),
    shoe: new THREE.CapsuleGeometry(0.05, 0.12, 3, 8).rotateZ(Math.PI / 2).scale(1, 1, 0.75).translate(0.05, 0, -0.035),
    // Things held (hand frame: the hand at -FORE - 0.03).
    phone: new THREE.BoxGeometry(0.075, 0.012, 0.15).rotateX(Math.PI / 2).translate(0.05, 0, -FORE - 0.06),
    coffee: M([new THREE.CylinderGeometry(0.035, 0.028, 0.11, 10).rotateX(Math.PI / 2).translate(0.04, 0, -FORE - 0.03), new THREE.CylinderGeometry(0.037, 0.037, 0.012, 10).rotateX(Math.PI / 2).translate(0.04, 0, -FORE + 0.03)]),
    cigarette: new THREE.CylinderGeometry(0.004, 0.004, 0.07, 5).rotateZ(Math.PI / 2).translate(0.05, 0, -FORE - 0.03),
    camera: new THREE.BoxGeometry(0.06, 0.12, 0.08).translate(0.13, 0, 0.22),
    ball: new THREE.SphereGeometry(0.034, 8, 6).translate(0.04, 0, -FORE - 0.06),
    flag: M([new THREE.CylinderGeometry(0.007, 0.007, 0.62, 5).rotateX(Math.PI / 2).translate(0.03, 0, -FORE - 0.33), new THREE.PlaneGeometry(0.3, 0.2).rotateX(Math.PI / 2).rotateY(Math.PI / 2).translate(0.03 + 0.1, 0, -FORE - 0.55)]),   // the pole carries on from the forearm, the flag off its tip
    briefcase: M([new THREE.BoxGeometry(0.1, 0.36, 0.27).translate(0.02, 0, -FORE - 0.2), new THREE.BoxGeometry(0.03, 0.1, 0.03).translate(0.02, 0, -FORE - 0.05)]),
    map: new THREE.BoxGeometry(0.006, 0.55, 0.38).translate(0.12, -0.2, -FORE - 0.06),
    breadbowl: M([new THREE.SphereGeometry(0.075, 10, 7).scale(1, 1, 0.75).translate(0.07, 0, -FORE - 0.04), new THREE.CylinderGeometry(0.06, 0.06, 0.01, 10).rotateX(Math.PI / 2).translate(0.07, 0, -FORE + 0.01)]),
    smoke: new THREE.IcosahedronGeometry(1, 1),
    leash: new THREE.CylinderGeometry(0.007, 0.007, 1, 5),
    // Dogs (dog frame: x forward, the ground at z = 0, unit size).
    dogBody: M([new THREE.CapsuleGeometry(0.11, 0.26, 3, 8).rotateZ(Math.PI / 2).translate(0, 0, 0.3), new THREE.ConeGeometry(0.025, 0.18, 5).rotateZ(Math.PI * 0.65).translate(-0.27, 0, 0.42)]),
    dogHead: M([sph(0.1, 10, 8).translate(0.27, 0, 0.45), new THREE.CapsuleGeometry(0.045, 0.06, 3, 6).rotateZ(Math.PI / 2).translate(0.37, 0, 0.42), sph(0.022, 5, 4).translate(0.43, 0, 0.43),
      ...[1, -1].map((s) => sph(0.045, 6, 5).scale(0.5, 0.9, 1.4).translate(0.22, s * 0.08, 0.53))]),
    dogLeg: new THREE.CylinderGeometry(0.028, 0.024, 0.22, 5).rotateX(Math.PI / 2).translate(0, 0, -0.11),
    cart: M([
      // A folding shopping cart: a wire basket, two wheels, the handle.
      ...[[-0.15, -0.17], [0.15, -0.17], [-0.15, 0.17], [0.15, 0.17]].map(([x, y]) => new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4).rotateX(Math.PI / 2).translate(x, y, 0.4)),
      ...[0.18, 0.4, 0.64].map((z) => new THREE.TorusGeometry(0.2, 0.007, 4, 4, Math.PI * 2).rotateZ(Math.PI / 4).scale(1.06, 1.2, 1).translate(0, 0, z)),
      ...[1, -1].map((s) => new THREE.CylinderGeometry(0.08, 0.08, 0.03, 12).translate(0, s * 0.2, 0.08)),
      new THREE.CylinderGeometry(0.01, 0.01, 0.5, 5).rotateX(Math.PI / 2).translate(0.17, 0, 0.88),
    ]),
    monowheel: M([new THREE.BoxGeometry(0.72, 0.24, 0.05).translate(0, 0, 0.18), new THREE.CylinderGeometry(0.14, 0.14, 0.2, 14).translate(0, 0, 0.14), new THREE.BoxGeometry(0.2, 0.25, 0.04).translate(0, 0, 0.27)]),
    blanket: new THREE.PlaneGeometry(1.5, 1.5).translate(0, 0, 0.012),
    speaker: M([new THREE.BoxGeometry(0.34, 0.16, 0.2).translate(0, 0, 0.12), ...[1, -1].map((s) => new THREE.CylinderGeometry(0.05, 0.05, 0.02, 10).rotateZ(Math.PI / 2).translate(0.08 * s, 0.09, 0.12))]),
    salmonTail: new THREE.ConeGeometry(0.1, 0.28, 4).scale(0.3, 1.6, 1).rotateX(Math.PI).translate(-0.17, 0, -0.05),
    // A stroller (pushed: its handle at the hands, the basket ahead) and the camera gear riding in it.
    stroller: M([new THREE.BoxGeometry(0.55, 0.42, 0.3).translate(0.12, 0, 0.5), new THREE.CylinderGeometry(0.012, 0.012, 0.75, 5).rotateZ(0.9).translate(-0.28, 0, 0.72),
      ...[[0.32, 0.18], [0.32, -0.18], [-0.1, 0.2], [-0.1, -0.2]].map(([x, y]) => new THREE.CylinderGeometry(0.07, 0.07, 0.03, 10).translate(x, y, 0.07)),
      new THREE.CylinderGeometry(0.01, 0.01, 0.42, 4).translate(-0.12, 0, 0.3)]),
    gear: M([new THREE.CylinderGeometry(0.06, 0.07, 0.34, 10).rotateZ(Math.PI / 2).rotateY(-0.5).translate(0.15, 0.08, 0.78), new THREE.BoxGeometry(0.14, 0.12, 0.1).translate(0.02, -0.08, 0.72),
      ...[0, 1, 2].map((i) => new THREE.CylinderGeometry(0.008, 0.008, 0.8, 4).rotateX(0.25 * (i - 1)).rotateZ(-0.35).translate(0.3, (i - 1) * 0.05, 0.9))]),
  }
}
type PartName = keyof ReturnType<typeof partGeometries>
/** Only the big parts cast shadows (a person-shaped shadow needs no fingers or hats; each caster is another draw in the shadow pass). */
const SHADOW: PartName[] = ['torso', 'head', 'thigh', 'shin', 'skirt', 'dogBody', 'cart', 'monowheel']
const SMALL: PartName[] = ['eyes', 'pupils', 'mouth', 'hand', 'shoe', 'phone', 'coffee', 'cigarette', 'camera', 'headband', 'heart', 'bib', 'rainbow', 'tie', 'rollers', 'flag', 'breadbowl']   // dropped far away

// ---------------------------------------------------------------- the crowd

export class Crowd {
  readonly group = new THREE.Group()
  readonly graph: Graph
  readonly people: Person[]
  private d: CrowdData
  private meshes = new Map<PartName, THREE.InstancedMesh>()
  private looks = new Map<PartName, Record<'grey' | 'cute' | 'real', THREE.Material>>()
  private style = ''
  private n = new Map<PartName, number>()
  private frame = 0
  private frustum = new THREE.Frustum()
  private pm = new THREE.Matrix4()
  private sphere = new THREE.Sphere()
  private toastAt = -1e9
  private lastLine = ''
  private keep: { x: number; y: number }[] = []
  /** Low quality: each vignette's extra members are not drawn. */
  vignetteLow = false
  /** The vignettes (vignettes.ts): their state poses their people; their props draw with the crowd (a child of its group). */
  vignettes: { update(t: number, skater: { x: number; y: number; z: number; speed: number } | null, camera: THREE.Vector3): void; setStyle(style: string): void; state(i: number): VigReact; readonly group: THREE.Object3D } | null = null
  /** Hand the vignettes over (main): their props join the crowd's group. */
  setVignettes(v: NonNullable<Crowd['vignettes']>) { this.vignettes = v; this.group.add(v.group) }
  /** The cast standing at home (castpeople.ts): nobody in the crowd walks through or stands in one. */
  setKeepClear(points: readonly { x: number; y: number }[]) { this.keep = points.map((p) => ({ x: p.x, y: p.y })) }
  /** Per frame: people in the city, drawn, and close-up. */
  stats = { people: 0, drawn: 0, near: 0, ms: 0, tris: 0, calls: 0, shadowTris: 0, cheers: 0 }

  constructor(park: Park, d: CrowdData, gradient: THREE.Texture | null) {
    this.d = d
    this.graph = sidewalkGraph(park, d)
    this.people = crowdPeople(park, this.graph, d)
    const geo = partGeometries()
    const rainbow = printTexture('rainbow')
    const prints: Partial<Record<PartName, THREE.Texture>> = { heart: printTexture('heart'), bib: printTexture('bib'), rainbow, flag: rainbow }
    // Instance buffers sized for the most drawn at once (lod.maxDrawn), not the whole city's crowd.
    const cap = (k: PartName) => {
      const P = Math.min(this.people.length, d.lod.maxDrawn)
      if (k === 'upperArm' || k === 'foreArm' || k === 'hand' || k === 'thigh' || k === 'shin' || k === 'shoe' || k === 'rollers') return P * 2
      if (k === 'dogBody' || k === 'dogHead') return P * 6
      if (k === 'leash') return P * 12   // two segments a lead (its sag)
      if (k === 'dogLeg') return P * 24
      if (k === 'smoke') return P * 4
      return P
    }
    for (const [k, g] of Object.entries(geo) as [PartName, THREE.BufferGeometry][]) {
      const map = prints[k] ?? null
      const see = k === 'smoke'
      const looks = {
        grey: new THREE.MeshLambertMaterial({ color: 0xffffff, map, transparent: see, opacity: see ? 0.5 : 1, depthWrite: !see, side: k === 'skirt' || k === 'blanket' || k === 'flag' ? THREE.DoubleSide : THREE.FrontSide }),
        cute: gradient ? new THREE.MeshToonMaterial({ color: 0xffffff, map, gradientMap: gradient, transparent: see, opacity: see ? 0.5 : 1, depthWrite: !see, side: k === 'skirt' || k === 'blanket' || k === 'flag' ? THREE.DoubleSide : THREE.FrontSide }) : new THREE.MeshLambertMaterial({ color: 0xffffff, map }),
        real: new THREE.MeshStandardMaterial({ color: 0xffffff, map, roughness: k === 'eyes' || k === 'pupils' || k === 'phone' || k === 'vr' || k === 'monowheel' ? 0.25 : k === 'coffee' || k === 'helmet' ? 0.45 : 0.85, metalness: k === 'cart' ? 0.7 : 0, transparent: see, opacity: see ? 0.45 : 1, depthWrite: !see, side: k === 'skirt' || k === 'blanket' || k === 'flag' ? THREE.DoubleSide : THREE.FrontSide }),
      }
      const mesh = new THREE.InstancedMesh(g, looks.cute, Math.max(1, cap(k)))
      mesh.count = 0
      mesh.castShadow = SHADOW.includes(k)
      mesh.frustumCulled = false
      mesh.name = `crowd:${k}`
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, cap(k)) * 3).fill(1), 3)
      this.meshes.set(k, mesh); this.looks.set(k, looks)
      this.group.add(mesh)
    }
    this.group.name = 'crowd'
  }

  /**
   * For review shots: one of every type in a row (walkers walking on the spot), across a point
   * facing heading h, instead of the city's crowd. null puts the crowd back.
   */
  lineup(at: { x: number; y: number; z: number; h: number } | null) {
    if (!at) { if (this.saved) { this.people.splice(0, this.people.length, ...this.saved); this.saved = null } return }
    if (!this.saved) this.saved = this.people.slice()
    const r = rng(7), types = Object.keys(this.d.types), n = types.length
    const side = { x: -Math.sin(at.h), y: Math.cos(at.h) }
    const row = types.map((type, i) => {
      const p = makePerson(type, this.d, r)
      const o = (i - (n - 1) / 2) * 1.5
      p.fixed = { x: at.x + side.x * o, y: at.y + side.y * o, z: at.z, h: at.h }
      p.inPlace = p.T.move === 'walk' || p.T.move === 'jog' || p.T.move === 'glide'
      if (type === 'picnicker') { p.picnic = 0; p.bx = p.fixed.x + Math.cos(at.h) * 0.9; p.by = p.fixed.y + Math.sin(at.h) * 0.9 }
      return p
    })
    this.people.splice(0, this.people.length, ...row)
  }
  private saved: Person[] | null = null

  /** Where the dog owners stand (dogs.ts gives each a dog or two). */
  dogOwners(): { x: number; y: number; z: number }[] { return (this.saved ?? this.people).filter((p) => p.type === 'dogOwner' && p.fixed).map((p) => ({ x: p.fixed!.x, y: p.fixed!.y, z: p.fixed!.z })) }

  /** Match the renderer's look (cute toon, real PBR, grey clay). */
  setStyle(style: string) {
    if (style === this.style) return
    this.style = style
    const key = (style === 'real' || style === 'grey' ? style : 'cute') as 'grey' | 'cute' | 'real'
    for (const [k, mesh] of this.meshes) mesh.material = this.looks.get(k)![key]
  }

  /** Where someone is at this time (route or fixed place), into p.x/y/z/h, moving 0/1, distance walked. */
  private place(p: Person, t: number) {
    p.placedAt = t
    if (p.path) {
      // Back and forth along its line (a tightrope), turning at the ends.
      const P = p.path, seg = P.slice(1).map((q, i) => Math.hypot(q.x - P[i].x, q.y - P[i].y)), L = seg.reduce((a, b) => a + b, 0) || 1
      const u = ((t + p.seed * 50) * p.pathSpeed) % (2 * L), back = u > L, sAt = back ? 2 * L - u : u
      let i = 0, acc = 0
      while (i < seg.length - 1 && acc + seg[i] < sAt) acc += seg[i++]
      const k = Math.min(1, (sAt - acc) / (seg[i] || 1)), a = P[i], b = P[i + 1]
      p.x = a.x + (b.x - a.x) * k; p.y = a.y + (b.y - a.y) * k; p.z = a.z + (b.z - a.z) * k
      p.h = Math.atan2(b.y - a.y, b.x - a.x) + (back ? Math.PI : 0); p.moving = 1; p.dist = t * p.pathSpeed
      return
    }
    if (p.circle) {
      // Round and round a point (the roller-disco circle), facing the way they go.
      const C = p.circle, a = C.a + (t * C.speed) / C.r
      const u = ((((a / (Math.PI * 2)) % 1) + 1) % 1) * 24, k0 = Math.floor(u) % 24, f = u - Math.floor(u)
      p.x = C.x + Math.cos(a) * C.r; p.y = C.y + Math.sin(a) * C.r; p.z = C.zs[k0] + (C.zs[(k0 + 1) % 24] - C.zs[k0]) * f; p.h = a + Math.PI / 2; p.moving = 1; p.dist = t * C.speed
      return
    }
    if (p.fixed || !p.legs) { const f = p.fixed!; p.x = f.x; p.y = f.y; p.z = f.z; p.h = f.h; p.moving = p.inPlace ? 1 : 0; p.dist = p.inPlace ? t * p.T.speed : 0; return }
    const tt = ((t + p.offset) % p.total + p.total) % p.total
    const L = p.legs
    let lo = 0, hi = L.length / LEG - 1
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (L[m * LEG + 10] <= tt) lo = m; else hi = m - 1 }
    const o = lo * LEG
    const l = { kind: L[o], edge: L[o + 1], s0: L[o + 2], s1: L[o + 3], ax: L[o + 4], ay: L[o + 5], az: L[o + 6], bx: L[o + 7], by: L[o + 8], bz: L[o + 9], t0: L[o + 10], dur: L[o + 11], face: L[o + 12] }
    const u = Math.min(1, (tt - l.t0) / (l.dur || 1))
    const at = TMP_AT
    if (l.kind === 0) {
      const e = this.graph.edges[l.edge]
      onEdge(e, l.s0 + (l.s1 - l.s0) * u, p.lane, at)
      const dir = Math.sign(l.s1 - l.s0) || 1
      p.x = at.x; p.y = at.y; p.z = at.z; p.h = Math.atan2(at.dy * dir, at.dx * dir); p.moving = 1
    } else if (l.kind === 2 || l.kind === 3) {
      p.x = l.ax + (l.bx - l.ax) * u; p.y = l.ay + (l.by - l.ay) * u; p.z = l.az + (l.bz - l.az) * u; p.h = l.face; p.moving = 1
    } else {
      if (l.ax || l.ay) { p.x = l.ax; p.y = l.ay; p.z = l.az } else { onEdge(this.graph.edges[l.edge], l.s0, p.lane, at); p.x = at.x; p.y = at.y; p.z = at.z }
      p.h = l.face
      p.moving = 0
    }
    p.dist = tt * p.T.speed
  }

  /**
   * Pose and draw the crowd for this moment: the world tick (with the frame's fraction), the camera,
   * the skater (position, speed) and the last big combo. Returns a line for the toast now and then
   * (only when toasts are allowed: live play).
   */
  update(tick: number, camera: THREE.Camera | null, skater: { x: number; y: number; z: number; speed: number } | null, landed: CrowdLanded | null, toasts = false, sims: SimPedestrian[] = []): string | null {
    const t0 = performance.now()
    this.frame++
    const t = tick / 120, D = this.d, R = D.reactions
    let line: string | null = null
    const camPos = new THREE.Vector3()
    if (camera) { camera.updateMatrixWorld(); camPos.setFromMatrixPosition(camera.matrixWorld); this.frustum.setFromProjectionMatrix(this.pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)) }
    for (const k of this.meshes.keys()) this.n.set(k, 0)
    this.stats = { people: this.people.length, drawn: 0, near: 0, ms: 0, tris: 0, calls: 0, shadowTris: 0, cheers: 0 }
    const lod = D.lod
    // The sim's pedestrians: the same figures, posed from their Things.
    for (const sp of sims) {
      if (camera && Math.hypot(sp.x - camPos.x, sp.y - camPos.y) < (lod.nearCamera ?? 1.1) && camPos.z - sp.z > -0.3 && camPos.z - sp.z < 2.2) continue   // around the lens
      const p = this.simPerson(sp)
      p.x = sp.x; p.y = sp.y; p.z = sp.z; p.h = sp.heading; p.moving = sp.state === 'walk' && sp.speed > 0.1 ? 1 : 0; p.dist = (tick / 120) * Math.max(sp.speed, 0.8)
      const aside = sp.state === 'aside' ? Math.sin(Math.PI * Math.min(1, sp.t / 60)) : 0
      p.dodgeX = 0; p.dodgeY = 0   // the sim moves them aside itself; the view adds the hop and the arms
      const down = sp.state === 'down' ? smooth(0, 14, sp.t) : 0
      const flinch = sp.state === 'down' ? 0 : aside * 0.6
      let look = 0, lookYaw = 0
      if (skater) { const dx = skater.x - p.x, dy = skater.y - p.y; if (Math.hypot(dx, dy) < 14) { look = 1; lookYaw = Math.atan2(dy, dx) - p.h } }
      this.pose(p, t, false, aside * 0.35, flinch, 0, 0, look * (1 - down), lookYaw, skater, down)
      this.stats.drawn++; this.stats.near++
    }
    const clear = (x: number, y: number) => { for (const sp of sims) if (Math.abs(sp.x - x) < 1.4 && Math.abs(sp.y - y) < 1.4) return false; return true }
    for (const [pi, p] of this.people.entries()) {
      // Moved along their routes at full rate near, every other frame beyond halfRateBeyond, every
      // eighth frame out of reach (no one walks a metre in that time).
      const away = camera ? Math.hypot(p.x - camPos.x, p.y - camPos.y) : 0
      const every = !camera || away < lod.halfRateBeyond ? 1 : away < lod.drawDistance + 40 ? 2 : 8
      if (every === 1 || (this.frame + pi) % every === 0 || p.placedAt < 0) this.place(p, t)
      const K = D.keepClear ?? 1.3
      for (const c of this.keep) {
        const dx = p.x - c.x, dy = p.y - c.y, d2 = dx * dx + dy * dy
        if (d2 < K * K) { const l = Math.sqrt(d2) || 0.01; p.x = c.x + (dx / l) * K; p.y = c.y + (dy / l) * K }
      }
      const dist = camera ? Math.hypot(p.x - camPos.x, p.y - camPos.y, p.z - camPos.z) : 0
      if (camera) {
        if (dist > lod.drawDistance || this.stats.drawn >= lod.maxDrawn) continue
        // A person around the lens (the chase camera squeezing past on a stair or a narrow sidewalk) is not drawn.
        if (Math.hypot(p.x - camPos.x, p.y - camPos.y) < (lod.nearCamera ?? 1.1) && camPos.z - p.z > -0.3 && camPos.z - p.z < 2.2) continue
        this.sphere.center.set(p.x, p.y, p.z + 0.9); this.sphere.radius = p.T.hold === 'leash' ? 3.5 : 1.4
        if (!this.frustum.intersectsSphere(this.sphere)) continue
      }
      if (sims.length && !clear(p.x, p.y)) continue   // a sim pedestrian stands here: never two people in one place
      if (p.vig >= 0) {
        // A vignette's person: its act's pose, reacting as its vignette does (look up, cheer, film, flinch), no dodging.
        if (this.vignetteLow && p.spare) continue
        const V = this.vignettes?.state(p.vig) ?? null
        let look = 0, lookYaw = 0, cheer = 0, film = 0, flinch = 0
        if (skater) { const dx = skater.x - p.x, dy = skater.y - p.y, sd = Math.hypot(dx, dy); if (sd < 14 && Math.abs(skater.z - p.z) < 4) { look = 1 - smooth(9, 14, sd); lookYaw = Math.atan2(dy, dx) - p.h } }
        if (V) {
          const e = smooth(0, 0.3, V.age) * (1 - smooth(R.seconds - 0.6, R.seconds, V.age))
          if (V.kind === 'look') look = Math.max(look, e)
          if (V.kind === 'cheer') cheer = e
          if (V.kind === 'film') film = e
          if (V.kind === 'flinch') flinch = e * (1 - smooth(0.8, 1.6, V.age))
        }
        this.pose(p, t, camera ? dist > lod.halfRateBeyond : false, 0, flinch, film, cheer, look, lookYaw, skater, 0, actPose(p.act, t, p, V))
        this.stats.drawn++
        continue
      }
      // Reactions to the skater.
      let dodge = 0, flinch = 0, film = 0, cheer = 0, look = 0, lookYaw = 0
      if (skater) {
        const dx = skater.x - p.x, dy = skater.y - p.y, sd = Math.hypot(dx, dy)
        if (sd < 14 && Math.abs(skater.z - p.z) < 3) { look = 1 - smooth(9, 14, sd); lookYaw = Math.atan2(dy, dx) - p.h }
        const sitting = p.T.move === 'sit'
        if (!sitting && skater.speed > R.minSpeed && sd < R.dodge && Math.abs(skater.z - p.z) < 1.5 && t - p.dodge > 1.4) {
          p.dodge = t; const l = Math.max(0.01, sd); p.dodgeX = -dx / l; p.dodgeY = -dy / l
          if (toasts) line = line ?? this.say(p, t)
        }
        if (skater.speed > R.minSpeed && sd < R.flinch && Math.abs(skater.z - p.z) < 2) flinch = 1 - smooth(R.dodge, R.flinch, sd)
        if (landed && landed.points >= R.bigPoints && landed.tick !== p.seenLand && Math.hypot(landed.x - p.x, landed.y - p.y) < R.near && tick >= landed.tick) {
          p.seenLand = landed.tick; p.react = landed.tick / 120; p.reactKind = (p.T.hold === 'phone' || p.T.hold === 'selfie' || p.T.hold === 'vr' || p.seed > 0.55) ? 1 : 2
          if (p.reactKind === 2 && tick - landed.tick < 30) this.stats.cheers++   // just landed: the cheer is heard
          if (toasts) line = line ?? this.say(p, t)
        }
      }
      if (p.T.move !== 'sit') {
        const age = t - p.dodge
        if (age >= 0 && age < 1.4) dodge = Math.sin(Math.PI * Math.min(1, age / 1.4))
        // Right beside a fast skater (a shot of one moment has no history): already jumping aside.
        if (skater && skater.speed > R.minSpeed && Math.abs(skater.z - p.z) < 1.5) {
          const dx = p.x - skater.x, dy = p.y - skater.y, sd = Math.hypot(dx, dy), k = 1 - smooth(0.8, R.dodge, sd)
          if (k > dodge) { dodge = k; p.dodgeX = dx / Math.max(0.01, sd); p.dodgeY = dy / Math.max(0.01, sd) }
        }
      }
      const ra = t - p.react
      if (ra >= 0 && ra < R.seconds) { const e = smooth(0, 0.3, ra) * (1 - smooth(R.seconds - 0.6, R.seconds, ra)); if (p.reactKind === 1) film = e; else cheer = e }
      // Far away: posed every other frame (still drawn every frame where it last stood).
      const far = camera ? dist > lod.halfRateBeyond : false
      this.pose(p, t, far, dodge, flinch, film, cheer, look, lookYaw, skater)
      this.stats.drawn++
      if (!far) this.stats.near++
    }
    for (const [k, mesh] of this.meshes) {
      mesh.count = this.n.get(k)!
      mesh.visible = mesh.count > 0   // no empty draws
      const g = mesh.geometry, tris = ((g.index ? g.index.count : g.attributes.position.count) / 3) * mesh.count
      if (mesh.count) { this.stats.calls++; this.stats.tris += tris; if (mesh.castShadow) this.stats.shadowTris += tris }
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    }
    if (this.vignettes) { this.vignettes.setStyle(this.style); this.vignettes.update(t, skater, camPos) }
    this.stats.ms = performance.now() - t0
    return line
  }

  /** The figure for a sim pedestrian: its kind and colours from its look, kept while it lives. */
  private simPeople = new Map<number, { look: number; p: Person }>()
  private simPerson(sp: SimPedestrian): Person {
    const hit = this.simPeople.get(sp.id)
    if (hit && hit.look === sp.look) return hit.p
    const walkers = Object.keys(this.d.types).filter((k) => this.d.types[k].move === 'walk')
    const p = makePerson(walkers[Math.floor((sp.look % 1000) * walkers.length / 1000)], this.d, rng(sp.look * 7919 + 1))
    this.simPeople.set(sp.id, { look: sp.look, p })
    if (this.simPeople.size > 256) this.simPeople.delete(this.simPeople.keys().next().value!)
    return p
  }

  /** A line for the toast: rare (chance per reaction, a global cooldown), never the same twice running. */
  private say(p: Person, t: number): string | null {
    const R = this.d.reactions
    if (t - this.toastAt < R.toastCooldown || Math.random() > R.toastChance || p.told) return null
    const pool = [...p.T.lines, ...this.d.generalLines].filter((l) => l !== this.lastLine)
    const l = pool[Math.floor(Math.random() * pool.length)]
    this.toastAt = t; this.lastLine = l; p.told = true
    return l
  }

  private put(k: PartName, m: THREE.Matrix4, c: THREE.Color) {
    const mesh = this.meshes.get(k)!, i = this.n.get(k)!
    if (i >= mesh.instanceMatrix.count) return
    mesh.setMatrixAt(i, m)
    mesh.instanceColor!.setXYZ(i, c.r, c.g, c.b)
    this.n.set(k, i + 1)
  }

  /** One figure: the body from its type's move and hold, the reactions on top, its props and dogs. */
  private pose(p: Person, t: number, far: boolean, dodge: number, flinch: number, film: number, cheer: number, look: number, lookYaw: number, skater: { x: number; y: number } | null, down = 0, A: ActPose | null = null) {
    const T = p.T, parts = T.parts, hold = A?.hold ?? T.hold
    const mv = A ? (A.walk ? 'walk' : A.hipZ !== undefined && A.hipZ < 0.5 ? 'sit' : 'stand') : T.move   // an act's figure walks, sits or stands as it says
    const has = (s: string) => parts.includes(s)
    const s = p.scale
    // Walk cycle from the distance walked; jogging and gliding move their own ways.
    const stride = mv === 'jog' ? 1.9 : 1.25
    const ph = (p.dist / stride) * Math.PI * 2 + p.seed * 10
    const walk = A && !A.walk ? 0 : p.moving * (mv === 'glide' || mv === 'sit' ? 0 : 1)
    const swing = mv === 'jog' ? 0.75 : 0.42
    const bob = walk * Math.abs(Math.sin(ph)) * (mv === 'jog' ? 0.06 : 0.025)
    const shiver = has('shiver') ? Math.sin(t * 47 + p.seed * 9) * 0.035 : 0
    let lean = (A?.lean ?? 0) + (mv === 'jog' ? 0.14 : 0) * walk + (has('hunch') ? 0.3 : 0) - flinch * 0.35
    let yaw = p.h + (A?.yaw ?? 0)
    if (A) look *= A.look ?? 1
    // Dodging: a hop to the side away from the skater.
    let ox = p.dodgeX * dodge * 0.7, oy = p.dodgeY * dodge * 0.7, hop = dodge * 0.2   // a hop aside (not far: the shops are right there)
    if (mv === 'sit') { ox = 0; oy = 0; hop = 0 }
    const B = TMP_B.compose(TMP_V.set(p.x + ox, p.y + oy, p.z + hop + (A ? (A.lift ?? 0) + (p.path ? 0 : p.lift) : 0)), TMP_Q.setFromAxisAngle(Z_AX, mv === 'glide' ? yaw + Math.PI / 2 : yaw), TMP_S.setScalar(s))
    // Knocked down: flat on their back (rotated about the heels, lifted a body's thickness); an act lying down the same way.
    if (down > 0) B.multiply(TMP_M.makeTranslation(-0.1 * down, 0, 0.16 * down)).multiply(TMP_M2.makeRotationY(-Math.PI / 2 * down))
    if (A?.lie) B.multiply(TMP_M.makeTranslation(-0.1 * A.lie, 0, 0.16 * A.lie)).multiply(TMP_M2.makeRotationY(-Math.PI / 2 * A.lie))
    if (A?.roll) B.multiply(TMP_M.makeRotationX(A.roll))
    const sit = mv === 'sit'
    const hipZ = A?.hipZ ?? (sit ? 0.28 : HIP + bob)
    // Torso: lean forward (jog, hunch), back in a flinch, the tourist's shiver.
    const torsoM = TMP_T.copy(B).multiply(TMP_M.makeTranslation(0, 0, hipZ)).multiply(TMP_M2.makeRotationY(lean)).multiply(TMP_M3.makeRotationX(shiver))
    const wM = TMP_W.copy(torsoM).multiply(TMP_M.makeScale(p.width, p.width, 1))
    const top = p.top
    this.put('torso', wM, top)
    if (has('vest')) this.put('vest', wM, p.extra)
    if (has('apron')) this.put('apron', wM, TMP_C.set('#4a3426'))
    if (has('hood')) this.put('hood', wM, top)
    if (has('heart')) this.put('heart', wM, WHITE)
    if (has('bib')) this.put('bib', wM, WHITE)
    if (has('rainbow')) this.put('rainbow', wM, WHITE)
    if (has('tie')) this.put('tie', wM, p.extra)
    if (has('skirt')) this.put('skirt', TMP_M4.copy(B).multiply(TMP_M.makeTranslation(0, 0, hipZ)), p.bottom)
    if (has('salmon')) this.put('salmonTail', TMP_M4.copy(B).multiply(TMP_M.makeTranslation(0, 0, hipZ)), top)
    // Head: looks at the skater coming by, down at a phone, round at the group.
    const lookY = Math.atan2(Math.sin(lookYaw), Math.cos(lookYaw))
    let hy = look * Math.max(-1.3, Math.min(1.3, lookY)) + (p.fixed ? Math.sin(t * 0.3 + p.seed * 7) * 0.5 * (1 - look) : 0)
    let hp = hold === 'phone' && walk > 0 ? 0.45 : 0
    if (mv === 'sit' && !A) hp += Math.max(0, Math.sin(t * 6 + p.seed * 3)) * 0.12   // nodding to the music
    if (A?.head) { hy = hy * look + A.head[0] * (1 - look); hp += A.head[1] * (1 - look * 0.6) }
    if (film > 0) { hp = 0; hy = hy * (1 - film) + lookY * film }
    if (cheer > 0) hp = -0.25 * cheer
    const headM = TMP_H.copy(torsoM).multiply(TMP_M.makeTranslation(-0.01, 0, TORSO + 0.03)).multiply(TMP_M2.makeRotationZ(hy)).multiply(TMP_M3.makeRotationY(hp))
    this.put('head', headM, p.skin)
    if (!far) { this.put('eyes', headM, WHITE); this.put('pupils', headM, DARK); this.put('mouth', headM, MOUTH) }
    const hat = has('beanie') ? 'beanie' : has('muniCap') ? 'muniCap' : has('helmet') ? 'helmet' : ''
    this.put(has('bun') ? 'hairBun' : has('long') ? 'hairLong' : 'hairShort', headM, p.hair)
    if (hat) this.put(hat, headM, hat === 'muniCap' ? TMP_C.set('#23314f') : p.extra)
    if (has('headband')) this.put('headband', headM, TMP_C.set('#f2efe6'))
    if (has('sunhat')) this.put('sunhat', headM, p.extra)
    if (has('vr')) this.put('vr', headM, TMP_C.set('#ececef'))
    if (has('salmon')) this.put('salmonFin', headM, top)
    if (has('camera')) this.put('camera', torsoM, DARK)
    // Arms: swing walking, or held by what they carry; cheering, filming and flinching on top.
    for (const side of [1, -1]) {
      let fwd = walk * Math.sin(ph + (side > 0 ? Math.PI : 0)) * swing * (mv === 'jog' ? 0.9 : 0.8), out = 0.12, elbow = mv === 'jog' ? 1.5 : 0.25
      const right = side < 0
      if (has('shiver')) { fwd = 0.9; out = -0.15; elbow = 1.9 }          // hugging themselves in the fog
      if (mv === 'glide') { fwd = 0.2; out = 0.7; elbow = 0.4 }            // balancing on the one-wheel board
      if (mv === 'sit') { fwd = 0.35; out = 0.2; elbow = 0.5 }
      if (hold === 'phone' && right) { fwd = 0.5; out = 0.05; elbow = 1.35 }
      if (hold === 'vr') { fwd = 1.2; out = 0.08; elbow = 0.35 + Math.sin(t * 2 + side) * 0.15 }
      if (hold === 'coffee' && right) { const sip = Math.pow(Math.max(0, Math.sin(t * 0.7 + p.seed * 5)), 8); fwd = 0.35 + sip * 0.5; elbow = 1.2 + sip * 0.9 }
      if (hold === 'cigarette' && right) { const drag = Math.pow(Math.max(0, Math.sin(t * 0.55 + p.seed * 5)), 6); fwd = 0.3 + drag * 0.5; out = 0.15; elbow = 1.3 + drag * 1.0 }
      if (hold === 'leash' && right) { fwd = 0.85; out = 0.1; elbow = 0.2 }
      if (hold === 'cart' && right) { fwd = -0.35; out = 0.12; elbow = 0.1 }
      if (hold === 'selfie' && right) { fwd = 1.3; out = 0.35; elbow = 0.15 }
      if (hold === 'briefcase' && right) { fwd = walk * Math.sin(ph) * 0.2; out = 0.18; elbow = 0.05 }
      if (hold === 'flag' && right) { fwd = 0.75 + Math.sin(t * 2.2 + p.seed * 4) * 0.12; out = 0.15; elbow = 1.05 }
      if (hold === 'map') { fwd = 0.9; out = side > 0 ? 0.35 : 0.0; elbow = 1.05 }   // the map held open in front, both hands
      if (hold === 'breadbowl' && right) { fwd = 0.55; out = 0.05; elbow = 1.35 }
      if (hold === 'ball' && right) { const k = ((t * 0.32 + p.seed) % 1); const throwK = k > 0.85 ? Math.sin((k - 0.85) / 0.15 * Math.PI) : 0; fwd = 0.4 + throwK * 2.6 - (k > 0.75 && k < 0.85 ? (k - 0.75) * 8 : 0); out = 0.1; elbow = 0.9 - throwK * 0.7 }
      if (A?.arms) { const a = A.arms[side > 0 ? 0 : 1]; fwd = a[0]; out = a[1]; elbow = a[2] }
      if (film > 0) { fwd = fwd * (1 - film) + 1.25 * film; out = out * (1 - film) + 0.05 * film; elbow = elbow * (1 - film) + 1.1 * film }
      if (cheer > 0) { const w = Math.sin(t * 9 + side) * 0.25; fwd = fwd * (1 - cheer) + (2.8 + w) * cheer; out = out * (1 - cheer) + 0.35 * cheer; elbow = elbow * (1 - cheer) + 0.2 * cheer }
      if (flinch > 0) { fwd = fwd * (1 - flinch) + 1.6 * flinch; out = out * (1 - flinch) + 0.3 * flinch; elbow = elbow * (1 - flinch) + 1.6 * flinch }
      if (dodge > 0) { fwd = fwd * (1 - dodge) + 2.3 * dodge; out = out * (1 - dodge) + 0.8 * dodge }
      if (down > 0) { fwd = fwd * (1 - down) + 1.4 * down; out = out * (1 - down) + 1.1 * down; elbow = elbow * (1 - down) + 0.4 * down }
      const sh = TMP_A.copy(torsoM).multiply(TMP_M.makeTranslation(0, side * 0.2 * p.width, TORSO - 0.05)).multiply(TMP_M2.makeRotationY(-fwd)).multiply(TMP_M3.makeRotationX(side * out))
      this.put('upperArm', sh, top)
      const fa = TMP_F.copy(sh).multiply(TMP_M.makeTranslation(0, 0, -UPPER)).multiply(TMP_M2.makeRotationY(-elbow))
      this.put('foreArm', fa, top)
      if (!far) this.put('hand', fa, p.skin)
      if (right && !far) {
        if ((hold === 'phone' || hold === 'selfie') || film > 0.3) this.put('phone', fa, PHONE)
        if (hold === 'ball' && ((t * 0.32 + p.seed) % 1) < 0.92) this.put('ball', fa, BALL)
        if (hold === 'coffee') this.put('coffee', fa, TMP_C.set('#f4f1e8'))
        if (hold === 'cigarette') this.put('cigarette', fa, WHITE)
        if (hold === 'flag') this.put('flag', fa, WHITE)
        if (hold === 'briefcase') this.put('briefcase', fa, TMP_C.set('#3a2a1e'))
        if (hold === 'map') this.put('map', fa, TMP_C.set('#efe6c8'))
        if (hold === 'breadbowl') this.put('breadbowl', fa, TMP_C.set('#c99a5a'))
      }
      if (right && hold === 'leash') this.handAt.copy(TMP_V2.set(0, 0, -FORE - 0.03).applyMatrix4(fa))
      if (right && hold === 'cigarette') this.handAt.copy(TMP_V2.set(0.08, 0, -FORE - 0.03).applyMatrix4(fa))
    }
    // Legs: the walk cycle; sitting, gliding and dodging their own ways.
    for (const side of [1, -1]) {
      let thigh = walk * Math.sin(ph + (side > 0 ? 0 : Math.PI)) * swing, out = 0.02, knee = walk * Math.max(0, Math.sin(ph + (side > 0 ? 0 : Math.PI) - 1.2)) * (mv === 'jog' ? 1.3 : 0.7)
      if (mv === 'sit') { thigh = 1.45; knee = 1.5; out = side * 0.05 + 0.12 }
      if (mv === 'glide') { thigh = side * 0.18; out = 0.22; knee = 0.35 }
      if (A?.legs && !A.walk) { const l = A.legs[side > 0 ? 0 : 1]; thigh = l[0]; out = l[1]; knee = l[2] }
      if (dodge > 0) { thigh = thigh * (1 - dodge) + 0.5 * dodge * (side > 0 ? 1 : -0.2); knee = knee * (1 - dodge) + 0.9 * dodge }
      if (down > 0) { thigh = thigh * (1 - down) + (side > 0 ? 0.5 : 0.15) * down; knee = knee * (1 - down) + (side > 0 ? 0.9 : 0.3) * down; out = out * (1 - down) + 0.25 * down }
      const hm = TMP_A.copy(B).multiply(TMP_M.makeTranslation(0, side * 0.09 * p.width, hipZ)).multiply(TMP_M2.makeRotationY(-thigh)).multiply(TMP_M3.makeRotationX(side * out))
      const shorts = has('shorts')
      this.put('thigh', hm, p.bottom)
      const sm = TMP_F.copy(hm).multiply(TMP_M.makeTranslation(0, 0, -THIGH)).multiply(TMP_M2.makeRotationY(knee))
      this.put('shin', sm, shorts || has('skirt') ? (has('skirt') ? TMP_C.set('#3a3236') : p.skin) : p.bottom)
      if (!far) {
        const shoeM = TMP_A.copy(sm).multiply(TMP_M.makeTranslation(0, 0, -SHIN)).multiply(TMP_M2.makeRotationY(thigh - knee))
        this.put('shoe', shoeM, p.shoes)
        if (has('rollers')) this.put('rollers', shoeM, p.extra)
      }
    }
    // What goes with them: the one-wheel board, the cart, the picnic, the smoke, the dogs.
    if (mv === 'glide' && !has('rollers')) this.put('monowheel', TMP_A.copy(B).multiply(TMP_M.makeRotationZ(-Math.PI / 2)), TMP_C.set('#1d1d22'))
    if (hold === 'cart') this.put('cart', TMP_A.copy(B).multiply(TMP_M.makeTranslation(-0.62, 0, 0)).multiply(TMP_M2.makeRotationY(-0.3)), TMP_C.set('#b9bec4'))
    if (hold === 'stroller') {
      // A stroller pushed in front, full of camera gear (a big lens, a camera body, a tripod sticking out).
      const sm = TMP_A.copy(B).multiply(TMP_M.makeTranslation(0.62, 0, 0))
      this.put('stroller', sm, TMP_C.set('#2b3a55'))
      this.put('gear', sm, DARK)
    }
    if (p.picnic >= 0) {
      const pm = TMP_A.compose(TMP_V.set(p.bx, p.by, p.z), TMP_Q.setFromAxisAngle(Z_AX, p.seed * 6), TMP_S.set(1, 1, 1))
      this.put('blanket', pm, p.picnic % 2 ? TMP_C.set('#c8372d') : TMP_C.set('#3d6fa8'))
      this.put('speaker', TMP_F.copy(pm).multiply(TMP_M.makeTranslation(0.3, 0.2, 0)), DARK)
    }
    if (hold === 'cigarette' && !far) {
      for (let i = 0; i < 3; i++) {
        const age = (t * 0.6 + i / 3 + p.seed) % 1
        const m = TMP_A.compose(TMP_V.set(this.handAt.x + age * 0.08, this.handAt.y, this.handAt.z + age * 0.5), TMP_Q.identity(), TMP_S.setScalar(0.02 + age * 0.07))
        this.put('smoke', m, SMOKE)
      }
    }
    if (hold === 'leash') {
      const fx = Math.cos(yaw), fy = Math.sin(yaw)
      const nd = p.dogs.length
      for (let i = 0; i < nd; i++) {
        const sz = 0.55 + ((p.seed * 7 + i * 0.37) % 1) * 0.5
        const wob = Math.sin(t * 1.3 + i * 1.7) * 0.2
        const lat = (i - (nd - 1) / 2) * (nd > 4 ? 0.42 : 0.5) + wob
        const dx = p.x + fx * (1.5 + (i % 2) * 0.55) - fy * lat, dy = p.y + fy * (1.5 + (i % 2) * 0.55) + fx * lat
        const dh = yaw + Math.sin(t * 0.9 + i) * 0.35
        const trot = p.moving ? (p.dist / 0.7) * Math.PI * 2 + i : 0
        const dm = TMP_D.compose(TMP_V.set(dx, dy, p.z + Math.abs(Math.sin(trot)) * 0.02 * p.moving), TMP_Q.setFromAxisAngle(Z_AX, dh), TMP_S.setScalar(sz))
        const col = p.dogs[i]
        this.put('dogBody', dm, col); this.put('dogHead', dm, col)
        for (const [lx, ly, phase] of [[0.15, 0.07, 0], [0.15, -0.07, Math.PI], [-0.17, 0.07, Math.PI], [-0.17, -0.07, 0]] as const) {
          this.put('dogLeg', TMP_A.copy(dm).multiply(TMP_M.makeTranslation(lx, ly, 0.24)).multiply(TMP_M2.makeRotationY(Math.sin(trot + phase) * 0.5 * p.moving)), col)
        }
        // The lead: a thin dark line from the hand to the collar, sagging a little in the middle (two segments).
        const collar = TMP_V2.set(0.22, 0, 0.42).applyMatrix4(dm)
        const span = collar.distanceTo(this.handAt)
        const mid = TMP_V4.copy(this.handAt).add(collar).multiplyScalar(0.5); mid.z -= 0.06 + 0.05 * span
        for (const [a, b] of [[this.handAt, mid], [mid, collar]] as const) {
          const dv = TMP_V3.copy(b).sub(a), len = dv.length()
          const lm = TMP_A.compose(TMP_V.copy(a).addScaledVector(dv, 0.5), TMP_Q.setFromUnitVectors(Y_AX, dv.normalize()), TMP_S.set(1, len, 1))
          this.put('leash', lm, LEASH)
        }
      }
    }
  }
  private handAt = new THREE.Vector3()
}

const TMP_AT = { x: 0, y: 0, z: 0, dx: 0, dy: 0 }
const TMP_V4 = new THREE.Vector3()
const TMP_B = new THREE.Matrix4(), TMP_T = new THREE.Matrix4(), TMP_W = new THREE.Matrix4(), TMP_H = new THREE.Matrix4(), TMP_A = new THREE.Matrix4(), TMP_F = new THREE.Matrix4(), TMP_D = new THREE.Matrix4()
const TMP_M = new THREE.Matrix4(), TMP_M2 = new THREE.Matrix4(), TMP_M3 = new THREE.Matrix4(), TMP_M4 = new THREE.Matrix4()
const TMP_V = new THREE.Vector3(), TMP_V2 = new THREE.Vector3(), TMP_V3 = new THREE.Vector3(), TMP_S = new THREE.Vector3(), TMP_Q = new THREE.Quaternion(), TMP_C = new THREE.Color()
const Z_AX = new THREE.Vector3(0, 0, 1), Y_AX = new THREE.Vector3(0, 1, 0)
const BALL = new THREE.Color('#d8f04a')
const WHITE = new THREE.Color('#ffffff'), DARK = new THREE.Color('#151517'), MOUTH = new THREE.Color('#3a1416'), PHONE = new THREE.Color('#202226'), SMOKE = new THREE.Color('#d9dade'), LEASH = new THREE.Color('#1c1c1e')
