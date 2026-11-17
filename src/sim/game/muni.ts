import type { MuniLine, RoamLine } from '../data.ts'
import { atan2, norm, v3, wrapAngle, type Vec3 } from '../math.ts'
import { raycast, sphereContacts, type Contact, type Park } from '../park/park.ts'
import { nextFloat, seedRng } from '../rng.ts'
import { placeAt, skater, spawn, type Sim, type SimEvent } from '../sim.ts'
import { Kind, makeThing, State, type Thing } from '../thing.ts'
import { carFrame } from './traffic.ts'

// The Muni Race (run muni [line]; data run.muni, docs/mechanics/modes.md): race a streetcar to its
// line's last stop. The streetcar is a car Thing (car.tram) on its line's rails, not the streets:
// car.s is how far along the route it is. It runs before the skaters, like the cars, so you meet
// it where it is this tick (skater/cars.ts: its own boxes; its ends shove you off the track). Its
// delays come from its own stream (world.muniRng), so the rest of the world draws as without it.

const touching: Contact[] = []

/** A line's route: its rails' track centre, chained (x, y, z per point), the length along it, each stop's place on it. */
export type MuniRoute = { pts: Vec3[]; cum: number[]; length: number; stops: number[] }

// Routes are worked out from the park and the line's data once, then kept (scratch, never world state).
const routes = new WeakMap<Park, Map<string, MuniRoute>>()

/** A race line, or a free-roam one (run.muni.roam). */
export const muniLine = (sim: Sim, id: string): MuniLine | undefined => sim.data.run.muni.lines.find((l) => l.id === id) ?? sim.data.run.muni.roam.lines.find((l) => l.id === id)

/** The line's route in this park (built on first use). */
export function muniRoute(sim: Sim, line: MuniLine): MuniRoute {
  // Every tick for every streetcar: the same line object in the same park with the same data is the same route.
  const f = lastRoute.get(line)
  if (f && f.park === sim.park && f.hash === sim.dataHash) return f.route
  let m = routes.get(sim.park)
  if (!m) routes.set(sim.park, (m = new Map()))
  const key = `${line.id}|${line.rails.join(',')}|${line.stops.map((s) => s.at.join(',')).join(';')}`
  let r = m.get(key)
  if (!r) m.set(key, (r = buildRoute(sim.park, line)))
  lastRoute.set(line, { park: sim.park, hash: sim.dataHash, route: r })
  return r
}
const lastRoute = new WeakMap<MuniLine, { park: Park; hash: string; route: MuniRoute }>()

/**
 * Chain the line's rails in order (each turned to start where the last ended; the gaps where the
 * export broke them, at crossings, bridged straight), then move the line sideways onto the track's
 * middle: the stops are OpenStreetMap stop positions, on the middle of the track, so the route
 * shifts by their mean distance to one side of the rail (stops within 1.2 m of it; the export keeps
 * one rail of a track in some places, so the other rail cannot be the guide).
 */
function buildRoute(park: Park, line: MuniLine): MuniRoute {
  const rails = park.grind.filter((g) => g.feature === 'streetcar rail')
  const lines = line.rails.map((id) => {
    const g = rails.find((x) => x.element === id)
    if (!g) throw new Error(`muni ${line.id}: no streetcar rail "${id}" in ${park.name}`)
    return g
  })
  const pts: Vec3[] = []
  lines.forEach((g, i) => {
    let p = g.points.map((q) => v3(q.x, q.y, q.z))
    const flip = i === 0
      ? lines.length > 1 && near(p[0], lines[1].points) < near(p[p.length - 1], lines[1].points)
      : Math.hypot(p[p.length - 1].x - pts[pts.length - 1].x, p[p.length - 1].y - pts[pts.length - 1].y) < Math.hypot(p[0].x - pts[pts.length - 1].x, p[0].y - pts[pts.length - 1].y)
    if (flip) p = p.reverse()
    for (const q of p) {
      const last = pts[pts.length - 1]
      if (last && Math.hypot(q.x - last.x, q.y - last.y) < 0.05) continue
      pts.push(q)
    }
  })
  // The track's middle: the stops' mean distance to the left of the rail (each where it projects).
  let sum = 0, n = 0
  for (const st of line.stops) {
    let best = { d: Infinity, side: 0 }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey || 1
      const t = Math.max(0, Math.min(1, ((st.at[0] - a.x) * ex + (st.at[1] - a.y) * ey) / l2))
      const dx = st.at[0] - (a.x + ex * t), dy = st.at[1] - (a.y + ey * t), d = Math.hypot(dx, dy)
      if (d < best.d) best = { d, side: (-ey * dx + ex * dy) / Math.sqrt(l2) }
    }
    if (best.d <= 1.2) { sum += best.side; n++ }
  }
  const shift = n ? sum / n : 0
  const mid = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(b.x - a.x, b.y - a.y) || 1
    return v3(p.x - ((b.y - a.y) / l) * shift, p.y + ((b.x - a.x) / l) * shift, p.z)
  })
  const cum = [0]
  for (let i = 1; i < mid.length; i++) cum.push(cum[i - 1] + Math.hypot(mid[i].x - mid[i - 1].x, mid[i].y - mid[i - 1].y))
  const route: MuniRoute = { pts: mid, cum, length: cum[cum.length - 1], stops: [] }
  route.stops = line.stops.map((s) => project(route, s.at[0], s.at[1]))
  for (let i = 1; i < route.stops.length; i++) if (route.stops[i] <= route.stops[i - 1]) throw new Error(`muni ${line.id}: stop ${line.stops[i].name} is not after ${line.stops[i - 1].name} along the rails`)
  return route
}

const near = (p: Vec3, q: { x: number; y: number }[]) => Math.min(Math.hypot(p.x - q[0].x, p.y - q[0].y), Math.hypot(p.x - q[q.length - 1].x, p.y - q[q.length - 1].y))

/** How far along the route the point nearest (x, y) is. */
function project(r: MuniRoute, x: number, y: number): number {
  let best = Infinity, s = 0
  for (let i = 1; i < r.pts.length; i++) {
    const a = r.pts[i - 1], b = r.pts[i], ex = b.x - a.x, ey = b.y - a.y, l2 = ex * ex + ey * ey || 1
    const t = Math.max(0, Math.min(1, ((x - a.x) * ex + (y - a.y) * ey) / l2))
    const d = Math.hypot(a.x + ex * t - x, a.y + ey * t - y)
    if (d < best) { best = d; s = r.cum[i - 1] + Math.sqrt(l2) * t }
  }
  return s
}

/** The point at s along the route and the direction there (with the slope). */
export function routeAt(r: MuniRoute, s: number): { p: Vec3; f: Vec3 } {
  let i = 1, hi = r.cum.length - 1
  while (i < hi) { const m = (i + hi) >> 1; if (r.cum[m] < s) i = m + 1; else hi = m }
  const a = r.pts[i - 1], b = r.pts[i], seg = r.cum[i] - r.cum[i - 1] || 1
  const k = Math.max(0, Math.min(1, (s - r.cum[i - 1]) / seg))
  return { p: v3(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k), f: norm(v3((b.x - a.x) / seg, (b.y - a.y) / seg, (b.z - a.z) / seg), v3(1, 0, 0)) }
}

/** The streetcar's pose at its s: on the track, along it; its velocity and how far it turned. */
function pose(c: Thing, r: MuniRoute) {
  const car = c.car!, { p, f } = routeAt(r, car.s)
  const h0 = atan2(c.fwd.y, c.fwd.x)
  c.pos = p
  c.fwd = f
  c.vel = v3(f.x * car.speed, f.y * car.speed, f.z * car.speed)
  c.up = carFrame(c).u
  car.turn = wrapAngle(atan2(f.y, f.x) - h0)
}

const tramOf = (sim: Sim, s: Thing) => sim.world.things.find((t) => t.id === s.muniTram && t.kind === Kind.car && t.car?.tram && !t.car.tram.roam) ?? null
const isRoam = (t: Thing) => t.kind === Kind.car && !!t.car?.tram?.roam

/** Leaving a race (or starting another game): the race's streetcar goes, and the free-roam ones it took away come back. */
export function clearMuni(sim: Sim, s: Thing) {
  if (sim.world.things.some((t) => t.kind === Kind.car && t.car?.tram && !t.car.tram.roam)) sim.world.things = sim.world.things.filter((t) => !(t.kind === Kind.car && t.car?.tram && !t.car.tram.roam))
  const back = s.muniRoam
  delete s.muniLine; delete s.muniTram; delete s.muniReached; delete s.muniFrom; delete s.muniRoam
  if (back) spawnStreetcars(sim)
}

/**
 * `run muni [line]`: the streetcar at the line's first stop, doors open for startDwell seconds, and
 * you beside it on the platform side, facing the way it goes. The free-roam streetcars leave.
 */
export function startMuni(sim: Sim, s: Thing, sk: Thing, events: SimEvent[], id?: string) {
  const M = sim.data.run.muni, hz = sim.data.physics.tickHz
  if (!M.parks.includes(sim.park.name)) throw new Error(`the Muni Race is in the city (${M.parks.join(', ')}), not ${sim.park.name}`)
  const line = id ? M.lines.find((l) => l.id === id) : M.lines[0]
  if (!line) throw new Error(`no Muni line "${id}" (lines: ${M.lines.map((l) => l.id).join(', ')})`)
  const r = muniRoute(sim, line)
  if (sim.world.things.some(isRoam)) { clearStreetcars(sim); s.muniRoam = true }
  if (!sim.world.muniRng) sim.world.muniRng = seedRng((sim.world.seed * 7907 + 5) >>> 0)
  const c = spawn(sim, Kind.car)
  c.state = State.ground
  c.car = { path: -1, s: r.stops[0], dir: 1, speed: 0, cruise: line.cruise, robo: false, paint: -1, wait: 0, honked: false, yielding: false, hazard: false, turn: 0,
    tram: { line: line.id, n: 0, phase: 'dwell', wait: Math.max(1, Math.round(M.startDwell * hz)), bell: false } }
  pose(c, r)
  c.car.turn = 0
  // You: platform metres to the right of the track at the first stop, on the ground there.
  const { p, f } = routeAt(r, r.stops[0]), rad = sim.data.physics.skater.radius
  const fl = Math.hypot(f.x, f.y) || 1, rx = f.y / fl, ry = -f.x / fl
  const from = v3(p.x + rx * M.platform, p.y + ry * M.platform, p.z + 3)
  const g = raycast(sim.park, from, v3(0, 0, -1), 8)
  const pos = v3(from.x, from.y, (g ? g.point.z : p.z) + rad + 0.02)
  for (let k = 0; k < 25 && sphereContacts(sim.park, pos, rad, touching).length > 0; k++) pos.z += 0.02
  placeAt(sk, { id: `muni_${line.id}`, pos, heading: atan2(f.x, f.y) })
  s.muniLine = line.id; s.muniTram = c.id; s.muniReached = [0]; s.muniFrom = sim.world.tick
  events.push({ t: 'muniStart', tick: sim.world.tick, line: line.id, name: line.name, car: c.id, stops: line.stops.map((x) => x.name) })
}

// ---- Free roam (run.muni.roam): streetcars on the city's rails outside a race ----

/** Free-roam streetcars' ids: their own range, so every id the world hands out is as it was without them. */
export const ROAM_ID = 1_000_000

/**
 * The city's free-roam streetcars (createSim, `streetcars on`, back after a race): each roam line's
 * cars spread between its first and last stops, running to the next stop; with parked, the first
 * stands there for layover seconds. No random draws (world.tramRng is seeded at its first draw).
 */
export function spawnStreetcars(sim: Sim) {
  const T = sim.data.run.muni.roam, hz = sim.data.physics.tickHz
  if (!T.parks.includes(sim.park.name) || sim.world.things.some(isRoam)) return
  let k = 0
  for (const line of T.lines) {
    const r = muniRoute(sim, line), last = r.stops.length - 1
    for (let i = 0; i < line.cars; i++) {
      const parked = i === 0 && line.parked ? project(r, line.parked[0], line.parked[1]) : null
      const at = parked ?? r.stops[0] + ((r.stops[last] - r.stops[0]) * (i + 0.5)) / line.cars
      let n = 0
      while (n < last && r.stops[n] <= at) n++
      const c = makeThing(ROAM_ID + k++, Kind.car)
      sim.world.things.push(c)
      c.state = State.ground
      c.car = { path: -1, s: at, dir: 1, speed: 0, cruise: line.cruise, robo: false, paint: -1, wait: 0, honked: false, yielding: false, hazard: false, turn: 0,
        tram: parked !== null ? { line: line.id, n: n - 1, phase: 'dwell', wait: Math.max(1, Math.round(T.layover * hz)), bell: false, roam: true } : { line: line.id, n, phase: 'run', wait: 0, bell: false, roam: true } }
      pose(c, r)
      c.car.turn = 0
    }
  }
}

/** `streetcars off` (and a Muni Race): the free-roam streetcars go. */
export function clearStreetcars(sim: Sim) {
  if (sim.world.things.some(isRoam)) sim.world.things = sim.world.things.filter((t) => !isRoam(t))
}

/** The streetcars' tick (before the traffic and the skaters): the race's, during a race, and the free-roam ones. */
export function stepTrams(sim: Sim, s: Thing, events: SimEvent[]) {
  if (s.game === 'muni') { const c = tramOf(sim, s); if (c) drive(sim, c, events) }
  for (const t of sim.world.things) if (isRoam(t)) drive(sim, t, events)
}

/**
 * One streetcar's tick: standing at a stop until its time is up, or running to the next one: up to
 * cruise at accel, braking at decel to stand at the stop (never slower than creep until it is there).
 * It rings once for a skater on its track ahead; it never stops for one.
 */
function drive(sim: Sim, c: Thing, events: SimEvent[]) {
  const M = sim.data.run.muni, hz = sim.data.physics.tickHz, dt = 1 / hz, tick = sim.world.tick
  const car = c.car!, tr = car.tram!
  let line = muniLine(sim, tr.line)
  if (!line) return
  let r = muniRoute(sim, line), last = r.stops.length - 1
  if (tr.phase === 'dwell') {
    car.speed = 0
    if (--tr.wait <= 0) {
      if (tr.roam && tr.n >= last) {
        // The end of the line: on as its pair line, from its point nearest here (or its start).
        const L = line as RoamLine, next = muniLine(sim, L.pair)
        if (next) {
          const nr = muniRoute(sim, next)
          car.s = L.pairAt === 'start' ? nr.stops[0] : project(nr, c.pos.x, c.pos.y)
          tr.line = next.id; line = next; r = nr; last = nr.stops.length - 1
          tr.n = 0
          while (tr.n < last && nr.stops[tr.n] <= car.s) tr.n++
          car.cruise = next.cruise
          tr.phase = 'run'
        }
      } else { tr.n++; tr.phase = 'run' }
    }
  } else if (tr.phase === 'run') {
    const target = r.stops[tr.n], togo = target - car.s
    const want = Math.min(car.cruise, Math.max(M.creep, Math.sqrt(2 * M.decel * Math.max(0, togo))))
    car.speed += Math.max(-M.decel * 2 * dt, Math.min(M.accel * dt, want - car.speed))
    car.s = Math.min(target, car.s + car.speed * dt)
    if (car.s >= target) arrive(sim, c, line, r, last, events)
  } else car.speed = 0
  pose(c, r)
  // The bell: a skater on the track ahead (in its frame: in front of its nose, within bellSide across).
  const sk = skater(sim), { f, l, u } = carFrame(c)
  const dx = sk.pos.x - c.pos.x, dy = sk.pos.y - c.pos.y, dz = sk.pos.z - c.pos.z
  const ahead = dx * f.x + dy * f.y + dz * f.z, side = Math.abs(dx * l.x + dy * l.y + dz * l.z), up = Math.abs(dx * u.x + dy * u.y + dz * u.z)
  const half = sim.data.traffic.tram.body.length / 2
  const onTrack = tr.phase === 'run' && ahead > half && ahead < half + M.bell && side < M.bellSide && up < 3
  if (onTrack && !tr.bell) events.push({ t: 'honk', tick, car: c.id, robo: false, x: round(c.pos.x), y: round(c.pos.y), tram: true })
  tr.bell = onTrack
}

/**
 * At stop n: it stands there for dwell seconds (and a delay, sometimes, between the first and the
 * last). The race's car is done at the last; a free-roam one waits layover seconds there.
 */
function arrive(sim: Sim, c: Thing, line: MuniLine, r: MuniRoute, last: number, events: SimEvent[]) {
  const M = sim.data.run.muni, hz = sim.data.physics.tickHz, car = c.car!, tr = car.tram!, tick = sim.world.tick
  car.s = r.stops[tr.n]; car.speed = 0
  const name = line.stops[tr.n].name
  if (tr.roam) {
    events.push({ t: 'tramStop', tick, car: c.id, line: line.id, n: tr.n, name })
    tr.phase = 'dwell'
    tr.wait = Math.max(1, Math.round((tr.n >= last ? sim.data.run.muni.roam.layover : M.dwell) * hz))
    if (tr.n > 0 && tr.n < last) {
      const rng = (sim.world.tramRng ??= seedRng((sim.world.seed * 7919 + 11) >>> 0))
      if (nextFloat(rng) < M.delay.chance) tr.wait += Math.round((M.delay.seconds[0] + (M.delay.seconds[1] - M.delay.seconds[0]) * nextFloat(rng)) * hz)
    }
    return
  }
  events.push({ t: 'muniStop', tick, n: tr.n, name, you: false })
  if (tr.n >= last) { tr.phase = 'done'; return }
  tr.phase = 'dwell'
  tr.wait = Math.max(1, Math.round(M.dwell * hz))
  const rng = sim.world.muniRng!
  if (nextFloat(rng) < M.delay.chance) {
    const [lo, hi] = M.delay.seconds, seconds = Math.round((lo + (hi - lo) * nextFloat(rng)) * 10) / 10
    const says = M.delay.says[Math.floor(nextFloat(rng) * M.delay.says.length)]
    tr.wait += Math.round(seconds * hz)
    events.push({ t: 'muniDelay', tick, n: tr.n, name, seconds, says })
  }
}

/**
 * The race on the session (after the skaters): the stops you reach (within stopRadius of their
 * place on the track, any order), and the end: the first at the last stop wins.
 */
export function stepMuni(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const M = sim.data.run.muni, tick = sim.world.tick, hz = sim.data.physics.tickHz
  const c = tramOf(sim, s), line = s.muniLine ? muniLine(sim, s.muniLine) : undefined
  if (!c || !line) { s.mode = 'over'; return }   // the streetcar was cleared (traffic clear)
  const r = muniRoute(sim, line), last = r.stops.length - 1, reached = s.muniReached!
  const time = Math.round(((tick - (s.muniFrom ?? tick)) / hz) * 100) / 100
  for (let n = 1; n <= last; n++) {
    if (reached.includes(n)) continue
    const { p } = routeAt(r, r.stops[n])
    if (Math.hypot(sk.pos.x - p.x, sk.pos.y - p.y) >= M.stopRadius || Math.abs(sk.pos.z - p.z) >= 4) continue
    reached.push(n)
    events.push({ t: 'muniStop', tick, n, name: line.stops[n].name, you: true })
    if (n === last && c.car!.tram!.phase !== 'done') {
      s.mode = 'over'
      events.push({ t: 'muniOver', tick, won: true, margin: round2(r.stops[last] - c.car!.s), time })
      return
    }
  }
  if (c.car!.tram!.phase === 'done') {
    const { p } = routeAt(r, r.stops[last])
    s.mode = 'over'
    events.push({ t: 'muniOver', tick, won: false, margin: round2(Math.hypot(sk.pos.x - p.x, sk.pos.y - p.y)), time })
  }
}

const round = (x: number) => Math.round(x * 1000) / 1000
const round2 = (x: number) => Math.round(x * 100) / 100
