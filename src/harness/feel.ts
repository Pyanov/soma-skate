import { existsSync } from 'node:fs'
import type { GameData } from '../sim/data.ts'
import { Btn } from '../sim/input.ts'
import { cos, DEG, v3, type Vec3 } from '../sim/math.ts'
import { advance } from '../sim/replay.ts'
import { nextFloat, seedRng, type RngState } from '../sim/rng.ts'
import { createSim, placeAt, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import { startManual, stepManual } from '../sim/skater/combo.ts'
import type { Thing } from '../sim/thing.ts'
import { loadData, loadPark, rel } from './io.ts'
import { loadScenario, runScenario, type RunHooks, type Scenario } from './scenario.ts'
import { saveSnapshot, type Snapshot } from '../sim/snapshot.ts'
import { raycast, sphereContacts, type Contact } from '../sim/park/park.ts'
import { driveFeel } from './drivefeel.ts'

// The feel audit (docs/feel-audit.md): the core controls as numbers, measured through the real sim.
// `skate feel [--section ollie|capture|balance|landing|spin|special|vert|drive] [--trials n]`, `skate feel --tour`.

const R = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d
type Row = Record<string, number | string>

function sim(data: GameData, park = 'lab', seed = 1): Sim { return createSim(loadPark(park, data), data, { seed }) }

/** The skater in the air at pos, moving vel, facing heading (degrees clockwise from north). */
function inAir(s: Sim, pos: Vec3, vel: Vec3, heading: number) {
  const sk = skater(s)
  placeAt(sk, { id: 'feel', pos, heading: heading * DEG })
  sk.vel = vel
  sk.takeoffXY = [pos.x, pos.y]
}

/** Advance n ticks with keys(t, s); the events with their tick offset. */
function play(s: Sim, n: number, keys: (t: number, s: Sim) => number, stop?: (e: SimEvent) => boolean): { t: number; e: SimEvent }[] {
  const out: { t: number; e: SimEvent }[] = []
  for (let t = 0; t < n; t++) {
    for (const e of advance(s, { b: keys(t, s) })) { out.push({ t, e }); if (stop?.(e)) return out }
  }
  return out
}

// ---- 1. Ollie ----

/** Pop speed, height and air time by crouch (ticks held), standing and rolling; the late-ollie window off a ledge's end. */
export function ollieFeel(data: GameData): { charge: Row[]; late: Row } {
  const charge: Row[] = []
  for (const held of [1, 6, 12, 18, 24, 30, 40]) {
    const row: Row = { held, ms: Math.round((held / data.physics.tickHz) * 1000) }
    for (const [label, speed] of [['standing', 0], ['rolling 5 m/s', 5]] as const) {
      const s = sim(data)
      const sk = skater(s)
      placeAt(sk, { id: 'feel', pos: v3(-15, 10, 0.2), heading: 90 * DEG })
      play(s, 30, () => 0)
      if (speed) sk.vel = v3(speed, 0, 0)
      const z0 = sk.pos.z
      let peak = z0
      const ev = play(s, held + 200, (t, w) => { peak = Math.max(peak, skater(w).pos.z); return t < held ? Btn.ollie : 0 }, (e) => e.t === 'land')
      const pop = ev.find((x) => x.e.t === 'pop')?.e, land = ev.find((x) => x.e.t === 'land')?.e
      row[`${label} pop`] = pop && pop.t === 'pop' ? pop.speed : '-'
      row[`${label} height m`] = R(peak - z0)
      row[`${label} air s`] = land && land.t === 'land' ? R(land.airTicks / data.physics.tickHz) : '-'
    }
    charge.push(row)
  }
  // Late ollie: roll off the end of the 0.45 m ledge (L04) at 4 m/s holding the crouch, let go k ticks into the air.
  let lastPop = -1
  for (let k = 0; k <= 14; k++) {
    const s = sim(data), sk = skater(s)
    placeAt(sk, { id: 'feel', pos: v3(7, 0.25, 0.45 + data.physics.skater.radius + 0.02), heading: 90 * DEG })
    play(s, 10, () => Btn.ollie)
    sk.vel = v3(4, 0, 0)
    let airAt = -1, popped = false
    play(s, 200, (t, w) => {
      const st = skater(w).state
      if (airAt < 0 && st === 'air' && t > 2) airAt = t
      return airAt >= 0 && t >= airAt + k ? 0 : Btn.ollie
    }, (e) => { if (e.t === 'pop') popped = true; return e.t === 'land' })
    if (popped) lastPop = k
  }
  return { charge, late: { 'late ollie pops up to (ticks after leaving the edge)': lastPop, ms: Math.round((lastPop / data.physics.tickHz) * 1000) } }
}

// ---- 2. Grind capture ----

type Target = { name: string; line: number; side: 1 | -1; top: number }
/** The lab's 0.45 m ledge (L04 front edge), 1.0 m ledge (L03 back edge) and flat rail (L05). side: which way the approach side is (+y / -y). */
const TARGETS: Target[] = [{ name: '0.45 m ledge', line: 11, side: -1, top: 0.45 }, { name: '1.0 m ledge', line: 9, side: 1, top: 1.0 }, { name: 'flat rail 0.35 m', line: 28, side: -1, top: 0.35 }]
const ANGLES = [0, 15, 30, 45, 60, 75, 90]
const MISSES = [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 0.9, 1.0, 1.25]

/**
 * One approach: in the air at v m/s (5; 7.5 for the timing runs, 3 m back), at angle deg to the line (0 along it, 90 straight at it),
 * coming down so its feet reach the line's height `miss` metres short of it (on the approach side;
 * negative: past it), 0.4 s after the start. press: 'held' taps grind every 3 ticks (the timing
 * never matters), or a tick to tap it once. True if it grinds.
 */
function approach(data: GameData, t: Target, deg: number, miss: number, press: 'held' | number, v = 5): boolean {
  const s = sim(data), line = s.park.grind[t.line], hz = data.physics.tickHz, r = data.physics.skater.radius, g = data.physics.gravity
  const a = line.points[0], b = line.points[line.points.length - 1], L = Math.hypot(b.x - a.x, b.y - a.y)
  const tx = (b.x - a.x) / L, ty = (b.y - a.y) / L, nx = 0, ny = t.side
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2
  const ux = tx * Math.cos(deg * DEG) - nx * Math.sin(deg * DEG), uy = ty * Math.cos(deg * DEG) - ny * Math.sin(deg * DEG)
  const t1 = 0.4, vz0 = 2
  const cx = mx + nx * miss, cy = my + ny * miss, zc = t.top + r
  const pos = v3(cx - ux * v * t1, cy - uy * v * t1, zc - vz0 * t1 + (g * t1 * t1) / 2)
  inAir(s, pos, v3(ux * v, uy * v, vz0), Math.atan2(ux, uy) / DEG)
  const ev = play(s, Math.round(t1 * hz) + 40, (k) => (press === 'held' ? (k % 3 === 0 ? Btn.grind : 0) : k === press ? Btn.grind : 0), (e) => e.t === 'grindStart' || e.t === 'land' || e.t === 'bail')
  return ev.some((x) => x.e.t === 'grindStart')
}

/** The capture envelope (held press) by angle and miss distance; the press-timing window on a dead-on 20 degree approach. */
export function captureFeel(data: GameData): { grid: Row[]; timing: Row[]; wall: Row } {
  const grid: Row[] = []
  for (const t of TARGETS) {
    for (const deg of ANGLES) {
      const row: Row = { line: t.name, angle: deg }
      let hit = 0, n = 0
      for (const m of MISSES) {
        if (m < 0 && !t.name.includes('rail')) { row[`d ${m}`] = ' '; continue }   // past a ledge's edge is on top of it, not a near miss
        const ok = approach(data, t, deg, m, 'held')
        row[`d ${m}`] = ok ? 'G' : '.'
        if (m > 0) { n++; if (ok) hit++ }
      }
      row['near misses that grind'] = `${hit}/${n}`
      grid.push(row)
    }
  }
  // Timing: one press, dead on (miss 0), straight at the line and at 45 degrees: the presses that still grind.
  const timing: Row[] = []
  const hz = data.physics.tickHz
  for (const t of TARGETS) {
    for (const deg of [90, 45]) {
      const ok: number[] = []
      for (let k = 0; k < 60; k++) if (approach(data, t, deg, 0, k, 7.5)) ok.push(k)
      const reach = ok.length ? ok[0] + data.physics.grind.bufferTicks : -1   // the first tick it was in reach: a press buffers bufferTicks
      timing.push({ line: t.name, angle: deg, 'in reach from (s before its feet reach the line)': reach >= 0 ? R(0.4 - reach / hz) : '-', 'press up to ms early': Math.round((data.physics.grind.bufferTicks / hz) * 1000), 'presses that grind': ok.length, 'window ms': Math.round((ok.length / hz) * 1000) })
    }
  }
  // The wall: riding beside the lab's wall, popped on tick 101 (lab-wallride), the grind pressed k ticks before it.
  let wallUpTo = -1
  for (let k = 0; k <= 20; k++) {
    const s = sim(data), sk = skater(s)
    placeAt(sk, { id: 'feel', pos: v3(-27.3, -9, 0.14), heading: 0 })
    const ev = play(s, 160, (t) => (t >= 6 && t < 90 ? Btn.up : 0) | (t >= 80 && t < 100 ? Btn.ollie : 0) | (t === 101 - k ? Btn.grind : 0), (e) => e.t === 'wallrideStart')
    if (ev.some((x) => x.e.t === 'wallrideStart')) wallUpTo = k
  }
  const wall: Row = { 'a wallride takes a grind press up to (ticks before the wall is in reach)': wallUpTo, ms: Math.round((wallUpTo / hz) * 1000) }
  return { grid, timing, wall }
}

// ---- 3. Balance: grinds and manuals with a human-like player ----

/** A player: reaction delay (ms), how badly the meter is read (sd), how far ahead it leads the needle (s), the dead zone it leaves alone. */
type Player = { name: string; react: number; sd: number; lead: number; dead: number }
export const PLAYERS: Player[] = [
  { name: 'perfect (scenario bot)', react: 0, sd: 0, lead: 0, dead: 0.03 },
  { name: 'good: 150 ms, sd 0.03', react: 150, sd: 0.03, lead: 0.1, dead: 0.05 },
  { name: 'decent: 200 ms, sd 0.05', react: 200, sd: 0.05, lead: 0.1, dead: 0.05 },
  { name: 'casual: 280 ms, sd 0.08', react: 280, sd: 0.08, lead: 0.05, dead: 0.06 },
]

/** The player's push from the meter: +1 to push the balance up, -1 down, 0 none; it sees the meter react ms late, misread, every 100 ms a new glance. */
function bot(p: Player, hz: number, rng: RngState) {
  const hist: [number, number][] = []
  let misread = 0, glance = 0
  const gauss = () => { let u = 0; for (let i = 0; i < 6; i++) u += nextFloat(rng); return (u - 3) / Math.sqrt(0.5) }
  return (balance: number, vel: number): number => {
    hist.push([balance, vel])
    const lag = Math.round((p.react / 1000) * hz)
    if (glance-- <= 0) { misread = p.sd * gauss(); glance = Math.round(0.1 * hz) }
    const seen = hist[Math.max(0, hist.length - 1 - lag)]
    const want = seen[0] + seen[1] * p.lead + misread
    return want > p.dead ? -1 : want < -p.dead ? 1 : 0
  }
}

const stats = (xs: number[], cap: number) => {
  const s = [...xs].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]
  return { p10: R(q(0.1), 1), median: R(q(0.5), 1), p90: R(q(0.9), 1), 'held to the cap': `${xs.filter((x) => x >= cap).length}/${xs.length}` }
}

/**
 * How long each player keeps a grind (on the lab's 260 m hill curb, downhill: up to its end) and a
 * manual (stepManual itself, at a steady 5 m/s, up to 60 s), trials each from its own seed.
 */
export function balanceFeel(data: GameData, trials = 24): Row[] {
  const hz = data.physics.tickHz, rows: Row[] = []
  for (const p of PLAYERS) {
    const grind: number[] = [], manual: number[] = []
    for (let i = 1; i <= trials; i++) {
      // Grind: dropped onto the hill curb near its top, moving down it at 4 m/s.
      const s = sim(data, 'lab', i), line = s.park.grind[23], a = line.points[0], b = line.points[4]
      const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), dx = (b.x - a.x) / L, dy = (b.y - a.y) / L, dz = (b.z - a.z) / L
      inAir(s, v3(a.x + dx * 3, a.y + dy * 3, a.z + dz * 3 + data.physics.skater.radius + 0.3), v3(dx * 4, dy * 4, dz * 4), Math.atan2(dx, dy) / DEG)
      const pg = bot(p, hz, seedRng(1000 + i))
      let start = -1, end = -1
      play(s, 60 * hz, (t, w) => {
        const sk = skater(w)
        if (!sk.grind) return start < 0 && t % 3 === 0 ? Btn.grind : 0
        const push = pg(sk.grind.balance, sk.grind.balanceVel)
        return push > 0 ? Btn.right : push < 0 ? Btn.left : 0
      }, (e) => { if (e.t === 'grindStart') start = s.world.tick; if (e.t === 'grindEnd') { end = s.world.tick; return true } return false })
      if (start >= 0) grind.push(((end < 0 ? s.world.tick : end) - start) / hz)
      // Manual: the balance alone, as the game steps it each ground tick.
      const m = sim(data, 'lab', i), sk = skater(m), ev: SimEvent[] = []
      sk.combo = []
      startManual(m, sk, 'manual', ev)
      const pm = bot(p, hz, seedRng(2000 + i))
      let ticks = 0
      for (; ticks < 60 * hz; ticks++) {
        sk.vel = v3(5, 0, 0)
        const push = pm(sk.manual!.balance, sk.manual!.balanceVel)
        if (!stepManual(m, sk, { b: push > 0 ? Btn.up : push < 0 ? Btn.down : 0 }, ev)) break
        m.world.tick++
      }
      manual.push(ticks / hz)
    }
    const g = stats(grind, 25), mm = stats(manual, 60)
    rows.push({ player: p.name, 'grind p10 s': g.p10, 'grind median s': g.median, 'grind p90 s': g.p90, 'manual p10 s': mm.p10, 'manual median s': mm.median, 'manual p90 s': mm.p90, 'manual held 60 s': mm['held to the cap'] })
  }
  return rows
}

// ---- 4. Landing ----

/** The verdict by yaw error (board vs travel) at three speeds off a 1 m drop; then by drop height, straight. */
export function landingFeel(data: GameData): { yaw: Row[]; drop: Row[] } {
  const r = data.physics.skater.radius, yaw: Row[] = []
  const verdict = (ev: { e: SimEvent }[]) => {
    const b = ev.find((x) => x.e.t === 'bail')?.e, l = ev.find((x) => x.e.t === 'land')?.e
    return b && b.t === 'bail' ? 'BAIL' : l && l.t === 'land' ? l.quality : '-'
  }
  for (const err of [0, 10, 15, 20, 30, 40, 45, 50, 60, 65, 75, 90, 115, 120, 135, 150, 165, 180]) {
    const row: Row = { 'yaw error deg': err }
    for (const speed of [2.5, 5, 9]) {
      const s = sim(data)
      inAir(s, v3(-15, 10, 1 + r), v3(speed, 0, 0), 90 - err)
      row[`${speed} m/s`] = verdict(play(s, 120, () => 0, (e) => e.t === 'land' || e.t === 'bail'))
    }
    yaw.push(row)
  }
  const drop: Row[] = []
  for (const h of [1, 2, 2.5, 3, 4, 5, 6, 8, 10, 11]) {
    const s = sim(data)
    inAir(s, v3(-15, 10, h + r), v3(5, 0, 0), 90)
    const ev = play(s, 240, () => 0, (e) => e.t === 'land' || e.t === 'bail')
    const l = ev.find((x) => x.e.t === 'land')?.e
    drop.push({ 'drop m': h, 'impact m/s': l && l.t === 'land' ? l.impact : R(Math.sqrt(2 * data.physics.gravity * h)), verdict: verdict(ev) })
  }
  return { yaw, drop }
}

// ---- 5. Spin ----

/** Holding spin from takeoff to touchdown: the rotation, by air time (flat ollies, then airs set up with the time). */
export function spinFeel(data: GameData): Row[] {
  const rows: Row[] = [], r = data.physics.skater.radius, g = data.physics.gravity, L = data.physics.land
  const landable = (deg: number) => {
    // The biggest multiple of 180 within reach that lands: under-rotating by up to cleanDeg / stumbleDeg (the spin can always be stopped short).
    let clean = 0, sketchy = 0
    for (let m = 0; m * 180 <= deg + L.stumbleDeg; m++) { if (m * 180 <= deg + L.cleanDeg) clean = m * 180; sketchy = m * 180 }
    return { clean, sketchy }
  }
  const measure = (label: string, setup: (s: Sim) => void, keys: (t: number) => number) => {
    const s = sim(data)
    setup(s)
    let spin = 0, air = 0
    play(s, 600, (t, w) => { const sk = skater(w); if (sk.state === 'air') { spin = sk.spin; air++ } return keys(t) | (sk.state === 'air' ? Btn.spinL : 0) }, (e) => e.t === 'land' || e.t === 'bail')
    const deg = Math.abs(spin) / DEG, l = landable(deg)
    rows.push({ air: label, 'air s': R(air / data.physics.tickHz), 'rotation held deg': Math.round(deg), 'lands clean': l.clean, 'lands sketchy/stumble': l.sketchy })
  }
  const roll = (s: Sim) => { const sk = skater(s); placeAt(sk, { id: 'feel', pos: v3(-15, 10, 0.2), heading: 90 * DEG }); play(s, 30, () => 0); sk.vel = v3(5, 0, 0) }
  measure('flat ollie, tapped', roll, (t) => (t < 1 ? Btn.ollie : 0))
  measure('flat ollie, full crouch', roll, (t) => (t < 30 ? Btn.ollie : 0))
  for (const T of [1.2, 1.6, 2.0]) measure(`${T} s air (a kicker or gap)`, (s) => inAir(s, v3(-15, 10, 0.2 + r), v3(5, 0, (g * T) / 2), 90), () => 0)
  return rows
}

// ---- 6. Special meter ----

/** Points to fill it, and when it filled in the Tour scenarios (the first specialReady), with what was banked by then. */
export function specialFeel(data: GameData): Row[] {
  const rows: Row[] = [{ what: 'points banked to fill (combo.specialPoints)', value: data.physics.combo.specialPoints }]
  for (const name of ['tour-soma', 'tour-hayes', 'tour-castro']) {
    const r = runScenario(loadScenario(rel('scenarios', `${name}.skate`)), data)
    const ready = r.events.find((e) => e.t === 'specialReady'), combos = r.events.filter((e) => e.t === 'comboLanded' && (!ready || e.rel <= ready.rel))
    rows.push({ what: `${name}: full after`, value: ready ? `${R(ready.rel / data.physics.tickHz, 1)} s, ${combos.length} combos` : 'never' })
  }
  return rows
}

// ---- 9. Vert: every quarter and vert wall ----

/**
 * The tops of every transition in a world: rideable faces steeper than 50 degrees (not walls), the
 * highest per element and 2.5 m cell, with a flat run-up below them (at least 0.8 m of drop to
 * flat within 8 m out from the face). Each: where to start (2.5 m out on the flat, facing the face),
 * the steepest face met on the way up (the top angle), and the drop.
 */
type Top = { element: string; type: string; x: number; y: number; z: number; drop: number; topDeg: number; start: Vec3; heading: number }
export function vertTops(sim: Sim): Top[] {
  const park = sim.park, cells = new Map<string, number>()
  for (let t = 0; t < park.triCount; t++) {
    const c = park.cls[t], nz = park.tn[t * 3 + 2]
    if ((c !== 3 && c !== 4) || nz < 0.05 || nz > cos(50 * DEG)) continue   // steep or vert, not a wall face or an overhang
    const o = t * 9, cz = (park.tv[o + 2] + park.tv[o + 5] + park.tv[o + 8]) / 3
    const cx = (park.tv[o] + park.tv[o + 3] + park.tv[o + 6]) / 3, cy = (park.tv[o + 1] + park.tv[o + 4] + park.tv[o + 7]) / 3
    const key = `${park.elem[t]}:${Math.floor(cx / 2.5)}:${Math.floor(cy / 2.5)}`, k = cells.get(key)
    if (k === undefined || cz > (park.tv[k * 9 + 2] + park.tv[k * 9 + 5] + park.tv[k * 9 + 8]) / 3) cells.set(key, t)
  }
  const tops: Top[] = []
  for (const t of cells.values()) {
    const o = t * 9, e = park.elements[park.elem[t]]
    const c = v3((park.tv[o] + park.tv[o + 3] + park.tv[o + 6]) / 3, (park.tv[o + 1] + park.tv[o + 4] + park.tv[o + 7]) / 3, (park.tv[o + 2] + park.tv[o + 5] + park.tv[o + 8]) / 3)
    const hl = Math.hypot(park.tn[t * 3], park.tn[t * 3 + 1]), dx = park.tn[t * 3] / hl, dy = park.tn[t * 3 + 1] / hl
    // Down the face and out: the steepest face met, and where it is flat.
    let topDeg = 0, flatAt = -1, last = c.z + 0.05, ok = true
    for (let s = 0.1; s <= 8 && flatAt < 0; s += 0.1) {
      const h = raycast(park, v3(c.x + dx * s, c.y + dy * s, c.z + 0.5), v3(0, 0, -1), 6)
      if (!h || h.point.z > last + 0.02) { ok = false; break }
      last = h.point.z
      topDeg = Math.max(topDeg, Math.acos(Math.min(1, Math.abs(h.normal.z))) / DEG)
      if (h.normal.z > 0.99 && c.z - h.point.z > 0.8) flatAt = s
    }
    if (!ok || flatAt < 0) continue
    const sx = c.x + dx * (flatAt + 2.5), sy = c.y + dy * (flatAt + 2.5)
    const g = raycast(park, v3(sx, sy, last + 1), v3(0, 0, -1), 3)
    if (!g || g.normal.z < 0.99 || Math.abs(g.point.z - last) > 0.15) continue
    tops.push({ element: e.feature || e.id, type: e.type, x: R(c.x, 1), y: R(c.y, 1), z: R(c.z, 2), drop: R(c.z - g.point.z, 2), topDeg: R(topDeg, 1), start: v3(sx, sy, g.point.z + 0.2), heading: Math.atan2(-dx, -dy) / DEG })
  }
  return tops.sort((a, b) => a.element.localeCompare(b.element) || a.x - b.x || a.y - b.y)
}

/**
 * Where a run at a top starts, angle degrees off head-on: as far out as the head-on start, on the line
 * that meets the top at that angle (an angled run at the same lip, as a rider aims at it). Null when
 * that spot is not flat floor level with the head-on start (another feature, or no run-up there).
 */
export function vertStart(sim: Sim, top: Top, angle: number): Vec3 | null {
  if (angle === 0) return copyV(top.start)
  const L = Math.hypot(top.start.x - top.x, top.start.y - top.y), h = (top.heading + angle) * DEG
  const x = top.x - Math.sin(h) * L, y = top.y - Math.cos(h) * L
  const g = raycast(sim.park, v3(x, y, top.z + 0.5), v3(0, 0, -1), top.drop + 2)
  if (!g || g.normal.z < 0.99 || Math.abs(g.point.z + 0.2 - top.start.z) > 0.15) return null
  return v3(x, y, g.point.z + 0.2)
}

/**
 * One run at a top: from its start (vertStart) at speed v, angle off head-on; up to the first air. The
 * exit (vertical speed, vert or not), the most speed lost in one tick on the way up (on the face: the
 * share of the energy above the floor, 0.5 v^2 + g z; at the launch: of the vertical speed for a vert
 * launch, which drops the rest by design, else of the speed), and whether the coping pipe (a rail-class
 * face) was in reach above the wheels on the way. Null when the angled run has no run-up.
 */
export function vertRun(sim: Sim, top: Top, v: number, angle: number) {
  const g = sim.data.physics.gravity, r = sim.data.physics.skater.radius
  const start = vertStart(sim, top, angle)
  if (!start) return null
  placeAt(skater(sim), { id: 'vert', pos: start, heading: (top.heading + angle) * DEG })
  let air: { vz: number; vert: boolean; steep: number } | null = null, loss = 0, pipe = false
  const near: Contact[] = []
  for (let t = 0; t < 360 && !air; t++) {
    const sk = skater(sim)
    if (t === 10) { const h = (top.heading + angle) * DEG; sk.vel = v3(Math.sin(h) * v, Math.cos(h) * v, 0) }   // once down on the flat
    if (sk.state === 'ground' && t > 10) {
      sphereContacts(sim.park, sk.pos, r + 0.08, near)
      if (near.some((c) => sim.park.cls[c.tri] === 7 && c.pz > sk.pos.z)) pipe = true
    }
    const vz0 = sk.vel.z, sp0 = Math.hypot(sk.vel.x, sk.vel.y, sk.vel.z), E0 = 0.5 * sp0 * sp0 + g * sk.pos.z, onGround = sk.state === 'ground'
    const ev = advance(sim, { b: 0 })
    const sp = Math.hypot(sk.vel.x, sk.vel.y, sk.vel.z), E = 0.5 * sp * sp + g * sk.pos.z, floor = top.z - top.drop
    const up = ev.find((e) => e.t === 'air')
    if (t > 11 && onGround) {
      // The launch: a vert one keeps its vertical speed (the rest goes, by design), any other its speed.
      if (up && up.t === 'air') loss = Math.max(loss, up.vert ? (vz0 - sk.vel.z) / Math.max(vz0, 0.5) : (sp0 - sp) / Math.max(sp0, 0.5))
      else if (sk.state === 'ground' && sk.pos.z > floor + 0.3) loss = Math.max(loss, (E0 - E) / Math.max(E0 - g * floor, 1e-6))
    }
    // An air within 2.5 m of the top is the lip; elsewhere the run missed it (an angled run past a short quarter).
    if (up && up.t === 'air' && t > 10) { if (Math.hypot(sk.pos.x - top.x, sk.pos.y - top.y) < 2.5) air = { vz: sk.vel.z, vert: up.vert, steep: Math.acos(Math.min(1, sk.takeoffN.z)) / DEG }; else break }
    if (sk.state === 'bail') break
  }
  return { air, loss, pipe }
}
const copyV = (p: Vec3) => v3(p.x, p.y, p.z)

/**
 * Every top in each world swept: entry speeds 5-10 m/s, head-on and 20 degrees either side. Per top:
 * the top angle; head-on and angled, how many runs reached the lip (an air within 2.5 m of the top),
 * left it as vert, lost more than 15% in a tick on the way (vertRun); how many touched the coping pipe;
 * the exit vertical speed head-on at 7, 8.5 and 10 m/s. Flags (head-on): speed lost; a top within 5
 * degrees under vert.minWallDeg; not vert at 8.5 m/s; no lip at all.
 */
export function vertFeel(data: GameData, worlds = ['soma', 'sf']): Row[] {
  const rows: Row[] = [], speeds = [5, 6, 7, 7.5, 8, 8.25, 8.5, 8.75, 9, 9.5, 10]
  const W = data.physics.vert.minWallDeg, tol = data.physics.vert.topToleranceDeg
  for (const w of worlds) {
    const tops = vertTops(sim(data, w))
    // The park inside the city is the same park: the sf rows are the city's own transitions only.
    for (const top of w === 'sf' ? tops.filter((x) => !/^F\d\d/.test(x.element)) : tops) {
      // Head-on, and 20 degrees either side, aimed at the same top (an angled run with no flat run-up
      // there is left out; one can still meet the next feature over before the lip).
      const runs = (angles: number[]) => {
        const c = { lip: 0, vert: 0, lost: 0, worst: 0, pipe: 0, n: 0, exit: {} as Record<number, string> }
        for (const a of angles) for (const v of speeds) {
          const run = vertRun(sim(data, w), top, v, a)
          if (!run) continue
          c.n++
          if (run.air) { c.lip++; if (run.air.vert) c.vert++ }
          if (run.loss > 0.15) { c.lost++; c.worst = Math.max(c.worst, run.loss) }
          if (run.pipe) c.pipe++
          if (a === 0 && (v === 7 || v === 8.5 || v === 10)) c.exit[v] = run.air ? `${R(run.air.vz, 1)}${run.air.vert ? '' : ' (not vert)'}` : 'no air'
        }
        return c
      }
      const h = runs([0]), side = runs([-20, 20])
      const lost = (c: typeof h) => (c.lost ? `${c.lost} (worst ${Math.round(c.worst * 100)}%)` : 0)
      const flags = [h.lost ? 'speed lost head-on' : '', top.topDeg < W && top.topDeg >= W - 5 ? `top ${top.topDeg} deg (vert from ${W - tol})` : '', h.exit[8.5]?.includes('not vert') ? 'not vert at 8.5' : '', h.lip === 0 ? 'no lip head-on' : ''].filter(Boolean).join('; ')
      rows.push({
        world: w, element: top.element, type: top.type, at: `${top.x}, ${top.y}`, 'drop m': top.drop, 'top deg': top.topDeg,
        'head-on lip/vert': `${h.lip}/${h.vert} of ${h.n}`, 'head-on lost': lost(h), 'angled lip/vert': `${side.lip}/${side.vert} of ${side.n}`, 'angled lost': lost(side),
        'coping touched': h.pipe + side.pipe, 'exit vz 7': h.exit[7], 'exit vz 8.5': h.exit[8.5], 'exit vz 10': h.exit[10], flags,
      })
    }
  }
  return rows
}

// ---- 7. The Tour with human hands ----

/**
 * A human on the scripted Tour lines: when they press (timing sd, ms: every press and release of a
 * scripted chord moves together), how they balance (section 3's model: reaction, misread, lead, dead
 * zone), how they steer a rider line (the autopilot's keys seen react / 2 late), and how they come in
 * to a spot (the teleport and speed standing in for the ride up: heading sd in degrees, lateral sd in
 * metres, speed sd as a fraction).
 */
export type Human = { name: string; timing: number; react: number; sd: number; lead: number; dead: number; heading: number; lateral: number; speed: number }
export const HUMANS: Human[] = [
  { name: 'perfect', timing: 0, react: 0, sd: 0, lead: 0, dead: 0.03, heading: 0, lateral: 0, speed: 0 },
  { name: 'decent', timing: 40, react: 200, sd: 0.05, lead: 0.1, dead: 0.05, heading: 3, lateral: 0.15, speed: 0.05 },
  { name: 'casual', timing: 70, react: 280, sd: 0.08, lead: 0.05, dead: 0.06, heading: 6, lateral: 0.3, speed: 0.1 },
]

const gaussOf = (rng: RngState) => { let u = 0; for (let i = 0; i < 6; i++) u += nextFloat(rng); return (u - 3) / Math.sqrt(0.5) }

/** What the skater is doing, for following a script: its state, a manual told apart. */
const phaseOf = (sk: Thing) => (sk.manual ? 'manual' : sk.state)

/**
 * The script's own run: where the skater's phase changed (not by a teleport), where it was each tick
 * (x, y), the ticks the rider-line autopilot drove, and the world just before each teleport (snaps).
 */
type Plan = { teleports: Set<number>; moves: { t: number; from: string; to: string }[]; xy: Float64Array; pilot: Uint8Array }
export function planOf(sc: Scenario, data: GameData, o: { until?: number; start?: Snapshot; snaps?: boolean } = {}): Plan & { events: (SimEvent & { rel: number })[]; snaps: Map<number, Snapshot> } {
  const teleports = new Set([...sc.cmds.entries()].filter(([, l]) => l.some((c) => c.startsWith('teleport'))).map(([t]) => t))
  const phases: string[] = [], xy = new Float64Array(2 * (sc.ticks + 1)), pilot = new Uint8Array(sc.ticks + 1), snaps = new Map<number, Snapshot>()
  const r = runScenario(sc, data, {
    lite: true, until: o.until, start: o.start,
    pilot: (t, k) => { pilot[t] = 1; return k },
    keys: (t, sim, b) => {
      const sk = skater(sim)
      phases[t] = phaseOf(sk); xy[2 * t] = sk.pos.x; xy[2 * t + 1] = sk.pos.y
      if (o.snaps && teleports.has(t)) snaps.set(t, saveSnapshot(sim))
      return b
    },
  })
  const moves: Plan['moves'] = []
  for (let t = 1; t < phases.length; t++) if (phases[t] !== phases[t - 1] && !teleports.has(t - 1)) moves.push({ t, from: phases[t - 1], to: phases[t] })
  return { teleports, moves, events: r.events, xy, pilot, snaps }
}

/** Ticks from..to of a scenario as one of its own, from tick 0 (the rider-line autopilots that start in it). */
export function legOf(sc: Scenario, from: number, to: number): Scenario {
  const cmds = new Map<number, string[]>()
  for (const [t, l] of sc.cmds) if (t >= from && t < to) cmds.set(t - from, l)
  return {
    ...sc, cmds, ticks: to - from, expects: [],
    holds: sc.holds.filter((x) => x.to > from && x.from < to).map((x) => ({ ...x, from: x.from - from, to: x.to - from })),
    pilots: sc.pilots.filter((p) => p.from >= from && p.from < to).map((p) => ({ ...p, from: p.from - from })),
  }
}

/**
 * The scenario as a human would play it: the approach after each teleport off by a little (cmds), and the
 * scripted buttons with every press and release moved by a timing error (keys: indexed by script time).
 */
export function humanize(sc: Scenario, h: Human, rng: RngState, hz: number): { sc: Scenario; keys: Uint32Array } {
  const err = new Map<number, number>()
  const E = (t: number) => { let e = err.get(t); if (e === undefined) { e = Math.round(((gaussOf(rng) * h.timing) / 1000) * hz); err.set(t, e) } return e }
  const keys = new Uint32Array(sc.ticks + 1)
  for (const x of sc.holds) {
    if (x.p === 2) continue
    let from = x.from, to = x.to
    if (to - from <= 1) { const e = E(from); from += e; to += e } else { from += E(from); to = Math.max(from + 1, to + E(to)) }
    for (let t = Math.max(0, from); t < Math.min(keys.length, to); t++) keys[t] |= x.b
  }
  const cmds = new Map<number, string[]>()
  let rot = 0, scale = 1, until = -1
  for (const t of [...sc.cmds.keys()].sort((a, b) => a - b)) {
    const list = sc.cmds.get(t)!, out: string[] = []
    const vx = list.find((c) => c.startsWith('set skater.vel.x ')), vy = list.find((c) => c.startsWith('set skater.vel.y '))
    for (const c of list) {
      const a = c.split(/\s+/)
      if (a[0] === 'teleport' && a.length >= 5 && Number.isFinite(Number(a[1]))) {
        const dh = gaussOf(rng) * h.heading, lat = gaussOf(rng) * h.lateral, hd = Number(a[4]) * DEG
        rot = dh; scale = 1 + gaussOf(rng) * h.speed; until = t + 6
        out.push(`teleport ${R(Number(a[1]) + Math.cos(hd) * lat, 3)} ${R(Number(a[2]) - Math.sin(hd) * lat, 3)} ${a[3]} ${R(Number(a[4]) + dh, 2)}`)
      } else if (t <= until && (c === vx || c === vy)) {
        if (c === vy && vx) continue   // written with vel.x
        const x = vx ? Number(vx.split(/\s+/)[2]) : 0, y = vy ? Number(vy.split(/\s+/)[2]) : 0
        const m = Math.hypot(x, y) * scale, hh = Math.atan2(x, y) + rot * DEG
        out.push(`set skater.vel.x ${R(Math.sin(hh) * m, 4)}`, `set skater.vel.y ${R(Math.cos(hh) * m, 4)}`)
      } else if (t <= until && a[0] === 'speed' && a.length === 2) out.push(`speed ${R(Number(a[1]) * scale, 3)}`)
      else out.push(c)
    }
    cmds.set(t, out)
  }
  return { sc: { ...sc, holds: [], cmds }, keys }
}

/**
 * The human's hands: the script followed by what happens, not by the clock (its time jumps to each of
 * the script's phase changes when the skater makes it, early or late; after a different move the
 * script runs on by the clock), section 3's balance model on the grind, lip or manual meter (a fresh
 * read for each), and steering: rolling more than 0.3 m to the side of the script's line, where the
 * script steers nothing, no autopilot drives, no ollie is being charged and no pop is due within half a
 * second (lined up by then: steering into a pop lands it sideways), the human steers for where the
 * script's skater is half a second on (a dead zone of 3 degrees); that and
 * the rider-line autopilot's keys act react / 4 late (the road ahead is in sight: steering leads).
 */
function humanHooks(h: Human, hz: number, rng: RngState, plan: Plan, keys: Uint32Array): RunHooks {
  const p = { name: h.name, react: h.react, sd: h.sd, lead: h.lead, dead: h.dead }
  let kind = '', push: ReturnType<typeof bot> | null = null
  const lag = Math.round((h.react / 4 / 1000) * hz), seen: number[] = [], steer: number[] = []
  const look = Math.round(hz / 2), last = plan.xy.length / 2 - 1
  let tau = 0, i = 0, lost = false, prev = ''
  const firstAfter = (t: number) => { const k = plan.moves.findIndex((m) => m.t > t); return k < 0 ? plan.moves.length : k }
  return {
    lite: true,
    pilot: (t, k) => { seen[t] = k; return seen[t - lag] ?? 0 },
    keys: (t, sim, b) => {
      const sk = skater(sim), ph = phaseOf(sk)
      if (t === 0) { prev = ph; i = firstAfter(0) }
      else if (plan.teleports.has(t - 1)) { tau = t; i = firstAfter(t); lost = false }
      else if (ph !== prev && !lost) {
        const m = plan.moves[i]
        if (m && m.from === prev && m.to === ph) { tau = m.t; i++ } else { lost = true; tau++ }
      } else tau++
      prev = ph
      b |= keys[Math.min(tau, keys.length - 1)]
      // Steering for the script's line (decided now, done lag ticks on).
      let s = 0
      // How far off the script's line, across it (its way at script time tau), and whether its next move
      // is a pop within half a second (lined up by then: no steering into a pop).
      const k0 = Math.max(1, Math.min(tau, last - 1)), wx = plan.xy[2 * k0 + 2] - plan.xy[2 * k0 - 2], wy = plan.xy[2 * k0 + 3] - plan.xy[2 * k0 - 1], wl = Math.hypot(wx, wy)
      const across = wl > 1e-6 ? Math.abs(((sk.pos.x - plan.xy[2 * k0]) * wy - (sk.pos.y - plan.xy[2 * k0 + 1]) * wx) / wl) : 0
      const popSoon = !lost && plan.moves[i] && plan.moves[i].from === 'ground' && plan.moves[i].to === 'air' && plan.moves[i].t - tau < look
      if (across > 0.3 && !popSoon && sk.state === 'ground' && !sk.manual && !plan.pilot[t] && (b & (Btn.left | Btn.right | Btn.ollie)) === 0 && Math.hypot(sk.vel.x, sk.vel.y) > 1) {
        const k = Math.min(tau + look, last), dx = plan.xy[2 * k] - sk.pos.x, dy = plan.xy[2 * k + 1] - sk.pos.y
        if (Math.hypot(dx, dy) > 1) {
          let err = Math.atan2(dx, dy) - Math.atan2(sk.vel.x, sk.vel.y)
          while (err > Math.PI) err -= 2 * Math.PI
          while (err < -Math.PI) err += 2 * Math.PI
          s = err > 3 * DEG ? Btn.right : err < -3 * DEG ? Btn.left : 0
        }
      }
      steer[t] = s
      if ((b & (Btn.left | Btn.right | Btn.ollie)) === 0 && sk.state === 'ground' && !sk.manual) b |= steer[t - lag] ?? 0
      const g = sk.state === 'grind' ? sk.grind : sk.state === 'lip' ? sk.lip : null
      const now = g ? 'grind' : sk.manual ? 'manual' : ''
      if (now !== kind) { kind = now; push = now ? bot(p, hz, rng) : null }
      if (g && push && (b & Btn.grind) === 0) { const k = push(g.balance, g.balanceVel); return (b & ~(Btn.left | Btn.right)) | (k > 0 ? Btn.right : k < 0 ? Btn.left : 0) }
      if (sk.manual && push) { const k = push(sk.manual.balance, sk.manual.balanceVel); return (b & ~(Btn.up | Btn.down)) | (k > 0 ? Btn.up : k < 0 ? Btn.down : 0) }
      return b
    },
  }
}

type Goal = { key: string; name: string; from: number; to: number; ok: (e: SimEvent) => boolean }

/** A scenario's Tour goals as its script reaches them, each with its leg (from its teleport to the next). */
function goalsOf(sc: Scenario, data: GameData, events: (SimEvent & { rel: number })[], teleports: Set<number>): { goals: Goal[]; until: number; level: string } {
  const tps = [...teleports].sort((a, b) => a - b)
  const leg = (rel: number) => {
    const from = [0, ...tps].filter((t) => t < rel).pop()!, next = tps.find((t) => t >= rel)
    return { from, to: next ?? Math.min(sc.ticks, rel + 10 * data.physics.tickHz) }
  }
  const goals: Goal[] = []
  let level = ''
  for (const e of events) {
    if (e.t === 'levelStart') level = e.level
    if (e.t === 'letter') goals.push({ key: `letter ${e.letter}`, name: `letter ${e.letter}`, ...leg(e.rel), ok: (x) => x.t === 'letter' && x.letter === e.letter })
    if (e.t === 'tapeFound') goals.push({ key: 'tape', name: 'secret tape', ...leg(e.rel), ok: (x) => x.t === 'tapeFound' })
    if (e.t === 'levelGoal' && !['pro', 'sick', 'skate', 'tape'].includes(e.id)) goals.push({ key: e.id, name: e.name, ...leg(e.rel), ok: (x) => x.t === 'levelGoal' && x.id === e.id })
  }
  return { goals, until: Math.max(0, ...goals.map((g) => g.to)) + 1, level }
}

const pct = (n: number, of: number) => `${Math.round((100 * n) / of)}%`

/** One human run of a scenario (trial i), by the plan (from a snapshot: a leg). */
export function humanRun(sc: Scenario, data: GameData, plan: Plan, h: Human, hi: number, i: number, until?: number, start?: Snapshot) {
  const hz = data.physics.tickHz, rng = seedRng(7919 * i + 31 * hi + 1)
  const hm = humanize(sc, h, rng, hz)
  return runScenario(hm.sc, data, { ...humanHooks(h, hz, rng, plan, hm.keys), until, start })
}

/**
 * Every Tour goal with human hands (docs/feel-audit.md section 8): each goal's scripted leg in
 * tour-<level> (and tour-hills-twinpeaks), from the script's own world at its teleport (a bail in one leg
 * does not spill into the next), played trials times by each human; S-K-A-T-E: all five letters' legs
 * done in the same trial. Pro and Sick: the great run (tour-<level>-sick) played through, its final score.
 */
export function tourFeel(data: GameData, trials = 50, only?: string, log = false): Row[] {
  const rows: Row[] = []
  const files = ['soma', 'mission', 'castro', 'hills', 'hills-twinpeaks', 'hayes', 'civic', 'embarcadero', 'chinatown', 'russianhill', 'northbeach', 'wharf'].filter((f) => !only || f === only || f.startsWith(`${only}-`))
  const seenGoal = new Set<string>()
  for (const f of files) {
    const sc = loadScenario(rel('scenarios', `tour-${f}.skate`)), plan = planOf(sc, data, { snaps: true })
    const { goals, level } = goalsOf(sc, data, plan.events, plan.teleports)
    const mine = goals.filter((g) => !seenGoal.has(`${level}:${g.key}`))
    if (!mine.length) continue
    for (const g of mine) seenGoal.add(`${level}:${g.key}`)
    const done: Record<string, number[]> = {}, skate = HUMANS.map(() => 0)
    for (const g of mine) done[g.key] = HUMANS.map(() => 0)
    // The legs with goals in them, each its own scenario from the script's world at its teleport.
    const legs = [...new Set(mine.map((g) => g.from))].map((from) => {
      const goals = mine.filter((g) => g.from === from), to = Math.max(...goals.map((g) => g.to))
      const leg = legOf(sc, from, to + 1), start = plan.snaps.get(from)
      return { from, to, leg, start, plan: planOf(leg, data, { start }), goals }
    })
    HUMANS.forEach((h, hi) => {
      for (let i = 1; i <= trials; i++) {
        let letters = 0
        for (const L of legs) {
          const r = humanRun(L.leg, data, L.plan, h, hi, i, undefined, L.start)
          for (const g of L.goals) if (r.events.some((e) => e.rel > 0 && g.ok(e))) { done[g.key][hi]++; if (g.key.startsWith('letter')) letters++ }
        }
        if (letters === 5) skate[hi]++
      }
    })
    for (const g of mine) {
      const row: Row = { level, goal: g.name }
      HUMANS.forEach((h, hi) => { row[h.name] = pct(done[g.key][hi], trials) })
      rows.push(row)
      if (log) console.log(table([row]).split('\n')[1])
    }
    if (mine.filter((g) => g.key.startsWith('letter')).length === 5) {
      const row: Row = { level, goal: 'S-K-A-T-E (all five in the run)' }
      HUMANS.forEach((h, hi) => { row[h.name] = pct(skate[hi], trials) })
      rows.push(row)
    }
  }
  // Pro and Sick: Sick on the great run played through (tour-<level>-sick); Pro on the level's Pro line
  // (tour-<level>-pro: manuals, short grinds and gaps, physics phase 32) where it has one, else on the
  // great run too. Pro is the "you played the level" tier: at least 40% casual and 85% decent.
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]
  const play = (file: string, tier: number) => {
    const sc = loadScenario(rel('scenarios', file)), plan = planOf(sc, data)
    const made = HUMANS.map(() => 0), scores: number[][] = HUMANS.map(() => [])
    HUMANS.forEach((h, hi) => {
      for (let i = 1; i <= trials; i++) {
        const r = humanRun(sc, data, plan, h, hi, 1000 + i)
        const over = r.events.find((e) => e.t === 'levelOver'), score = over && over.t === 'levelOver' ? over.score : 0
        scores[hi].push(score)
        if (score >= tier) made[hi]++
      }
    })
    return { made, scores }
  }
  for (const L of data.tour.levels.filter((l) => !only || l.id === only)) {
    const proFile = `tour-${L.id}-pro.skate`, hasPro = existsSync(rel('scenarios', proFile))
    const sick = play(`tour-${L.id}-sick.skate`, L.tiers.sick), pro = hasPro ? play(proFile, L.tiers.pro) : play(`tour-${L.id}-sick.skate`, L.tiers.pro)
    for (const [goal, r] of [[`Pro Score (${L.tiers.pro})${hasPro ? ' on its Pro line' : ''}`, pro], [`Sick Score (${L.tiers.sick})`, sick]] as const) {
      const row: Row = { level: L.id, goal }
      HUMANS.forEach((h, hi) => { row[h.name] = `${pct(r.made[hi], trials)} (median ${med(r.scores[hi])})` })
      rows.push(row)
      if (log) console.log(table([row]).split('\n')[1])
    }
  }
  return rows
}

// ---- 11. Flow: the links between moves, getting up, turning, curbs ----

/** Ticks (relative to the landing, -40..30 by 2) at which a press of `keys` links on the landing; the landing's tick. */
function linkWindow(data: GameData, spot: string, setup: (t: number) => number, press: (t: number, at: number) => number, want: SimEvent['t'], landAfter: number) {
  const runIt = (k: (t: number) => number) => {
    const s = sim(data, 'lab'), sk = skater(s)
    placeAt(sk, s.park.spots.find((p) => p.id === spot)!)
    const ev: { t: number; e: SimEvent }[] = []
    for (let t = 0; t < 700; t++) for (const e of advance(s, { b: k(t) }, t === 6 && spot === 'lab_vert' ? ['speed 10'] : [])) ev.push({ t, e })
    return ev
  }
  const land = runIt(setup).find((x) => x.e.t === 'land' && x.t > landAfter)!.t
  const ok: number[] = []
  for (let k = -40; k <= 30; k += 2) if (runIt((t) => setup(t) | press(t, land + k)).some((x) => x.e.t === want)) ok.push(k)
  return ok.length ? `${ok[0]}..${ok[ok.length - 1]} (${ok.length * 2} ticks, ${Math.round((ok.length * 2 * 1000) / data.physics.tickHz)} ms)` : 'never'
}

/** The revert and manual windows around a landing, the get-up after a bail, turning by speed, a curb head-on. */
export function flowFeel(data: GameData): { links: Row[]; bail: Row[]; turn: Row[]; curb: Row[]; ledge: Row[] } {
  const hz = data.physics.tickHz
  const flip = (t: number) => (t === 212 ? Btn.flip | Btn.left : 0)
  const ledge = (t: number) => (t < 60 ? Btn.up : t < 90 ? Btn.ollie : t === 96 ? Btn.flip | Btn.left : 0)
  const links: Row[] = [
    { link: 'revert after a kickflip (vert ramp, lands fakie)', 'press, ticks from the landing': linkWindow(data, 'lab_vert', flip, (t, at) => (t === at ? Btn.revert : 0), 'revert', 300) },
    { link: 'revert after a plain vert air', 'press, ticks from the landing': linkWindow(data, 'lab_vert', () => 0, (t, at) => (t === at ? Btn.revert : 0), 'revert', 300) },
    { link: 'manual after a kickflip (up, then down 5 ticks later)', 'press, ticks from the landing': linkWindow(data, 'lab_ledge', ledge, (t, at) => (t === at - 5 ? Btn.up : t === at ? Btn.down : 0), 'manualStart', 100) },
  ]
  // A bail at 5 m/s (sideways onto the lab floor from 2 m), waiting or pressing ollie every 8 ticks.
  const bail: Row[] = []
  for (const press of [false, true]) {
    const s = sim(data), sk = skater(s)
    placeAt(sk, { id: 'feel', pos: v3(0, -10, 2), heading: 0 })
    sk.vel = v3(5, 0, 0)
    let bailT = -1, recT = -1, rollT = -1
    for (let t = 0; t < 800 && rollT < 0; t++) {
      for (const e of advance(s, { b: recT >= 0 ? Btn.up : press && bailT >= 0 && t % 8 === 0 ? Btn.ollie : 0 })) { if (e.t === 'bail' && bailT < 0) bailT = t; if (e.t === 'recover') recT = t }
      if (recT >= 0 && Math.hypot(sk.vel.x, sk.vel.y) >= 3) rollT = t
    }
    bail.push({ 'after a 5 m/s bail': press ? 'pressing ollie' : 'waiting', 'control back s': R((recT - bailT) / hz), 'rolling 3 m/s again s': R((rollT - bailT) / hz) })
  }
  // Full lean from speed v on the lab floor (pushing to hold it): heading turned after 0.5 and 1 s, time to 90 and 180 degrees.
  const turn: Row[] = []
  for (const v of [3, 5, 7, 9]) {
    const s = sim(data), sk = skater(s)
    placeAt(sk, { id: 'feel', pos: v3(-22, -18, 0.13), heading: 90 * DEG })
    play(s, 10, () => 0)
    sk.vel = v3(v, 0, 0)
    let turned = 0, prev = Math.atan2(sk.vel.x, sk.vel.y), h05 = 0, h10 = 0, t90 = -1, t180 = -1
    for (let t = 0; t < 600 && t180 < 0; t++) {
      advance(s, { b: Btn.left | (Math.hypot(sk.vel.x, sk.vel.y) < v ? Btn.up : 0) })
      const h = Math.atan2(sk.vel.x, sk.vel.y)
      let d = h - prev
      if (d > Math.PI) d -= 2 * Math.PI
      if (d < -Math.PI) d += 2 * Math.PI
      turned += d; prev = h
      if (t === 59) h05 = turned
      if (t === 119) h10 = turned
      if (t90 < 0 && Math.abs(turned) >= Math.PI / 2) t90 = t
      if (Math.abs(turned) >= Math.PI) t180 = t
    }
    // A light touch: the heading 1 s after a tap held 3 ticks (25 ms) and 8 ticks (67 ms), coasting.
    const tapTurn = (n: number) => {
      const s2 = sim(data), k = skater(s2)
      placeAt(k, { id: 'feel', pos: v3(-22, -18, 0.13), heading: 90 * DEG })
      play(s2, 10, () => 0)
      k.vel = v3(v, 0, 0)
      play(s2, 120, (t) => (t < n ? Btn.left : 0))
      return Math.round(Math.abs(Math.atan2(k.vel.x, k.vel.y) - Math.PI / 2) / DEG * 10) / 10
    }
    turn.push({ 'm/s': v, 'deg in 0.5 s': Math.round(Math.abs(h05) / DEG), 'deg in 1 s': Math.round(Math.abs(h10) / DEG), '90 deg s': t90 < 0 ? '-' : R(t90 / hz), '180 deg s': t180 < 0 ? '-' : R(t180 / hz), 'deg after a 3-tick tap': tapTurn(3), 'deg after an 8-tick tap': tapTurn(8) })
  }
  // Head-on into the 14.5 cm curb in sf (the road at 126.5, -159.7; the sidewalk from x 126.2), rolling.
  const curb: Row[] = []
  const park = loadPark('sf', data)
  for (const v of [2, 5, 8]) {
    const s = createSim(park, data, { seed: 1 }), sk = skater(s)
    for (let t = 0; t < 30; t++) advance(s, { b: 0 }, t === 0 ? ['teleport 128 -159.7 -4.5 268'] : [])
    const hd = Math.atan2(sk.fwd.x, sk.fwd.y)
    sk.vel = v3(Math.sin(hd) * v, Math.cos(hd) * v, 0)
    let up = false, air = false
    for (let t = 0; t < 240 && sk.pos.x > 125.7; t++) for (const e of advance(s, { b: 0 })) { if (e.t === 'bump') up = true; if (e.t === 'air') air = true }
    curb.push({ 'm/s': v, result: sk.pos.x <= 125.7 ? `up, ${R(Math.hypot(sk.vel.x, sk.vel.y))} m/s on the sidewalk${air ? ' (air)' : ''}${up ? '' : ' (no bump)'}` : `stopped (${R(Math.hypot(sk.vel.x, sk.vel.y))} m/s)` })
  }
  // A late ollie at the lab's 0.45 m ledge (L04, its face at y 0), rolling north at v, popped d metres
  // before the face (tapped, or a 12-tick crouch released there): on top, short (stopped in front), or a bail.
  const pops: Row[] = []
  for (const v of [4, 6]) for (const crouch of [1, 12]) {
    const row: Row = { 'm/s': v, crouch: crouch === 1 ? 'tap' : '12 ticks' }
    for (const d of [0.2, 0.4, 0.6, 0.8]) {
      const s = sim(data), sk = skater(s)
      placeAt(sk, { id: 'feel', pos: v3(7, -6, 0.13), heading: 0 })
      play(s, 10, () => 0)
      sk.vel = v3(0, v, 0)
      let held = 0, popped = false, bailed = false, top = false
      for (let t = 0; t < 200; t++) {
        let b = 0
        if (!popped && (held > 0 || -(sk.pos.y + data.physics.skater.radius) <= d + (v / hz) * (crouch - 1))) { held++; b = held <= crouch ? Btn.ollie : 0; if (held > crouch) popped = true }
        for (const e of advance(s, { b })) if (e.t === 'bail') bailed = true
        if (sk.state === 'ground' && sk.pos.z > 0.5 && sk.pos.y > 0) top = true
      }
      row[`${d} m`] = bailed ? 'bail' : top ? 'on top' : sk.pos.y < 0 ? 'short' : 'over'
    }
    pops.push(row)
  }
  return { links, bail, turn, curb, ledge: pops }
}

// ---- The audit ----

const table = (rows: Row[]) => {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0]), w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)))
  return [cols.map((c, i) => c.padEnd(w[i])).join('  '), ...rows.map((r) => cols.map((c, i) => String(r[c] ?? '').padEnd(w[i])).join('  '))].join('\n')
}

export function feel(o: { section?: string; trials?: number; tour?: boolean; level?: string }) {
  const data = loadData(), want = (k: string) => !o.tour && o.section !== 'vert' && o.section !== 'drive' && o.section !== 'flow' && (!o.section || o.section === k)
  if (want('ollie')) { const x = ollieFeel(data); console.log('\n# 1. Ollie\n' + table(x.charge) + '\n' + table([x.late])) }
  if (want('capture')) { const x = captureFeel(data); console.log('\n# 2. Grind capture (G: grinds; miss m short of the line, negative past it)\n' + table(x.grid) + '\n\n' + table(x.timing) + '\n' + table([x.wall])) }
  if (want('balance')) console.log('\n# 3. Balance (seconds held)\n' + table(balanceFeel(data, o.trials ?? 24)))
  if (want('landing')) { const x = landingFeel(data); console.log('\n# 4. Landing\n' + table(x.yaw) + '\n\n' + table(x.drop)) }
  if (want('spin')) console.log('\n# 5. Spin\n' + table(spinFeel(data)))
  if (want('special')) console.log('\n# 6. Special meter\n' + table(specialFeel(data)))
  if (o.section === 'vert') console.log('\n# 9. Vert: every quarter and vert wall\n' + table(vertFeel(data)))
  if (o.section === 'flow') {
    const x = flowFeel(data)
    console.log('\n# 11. Flow\n## Links on a landing\n' + table(x.links) + '\n\n## Getting up\n' + table(x.bail) + '\n\n## Turning (full lean, lab floor)\n' + table(x.turn) + '\n\n## Curb head-on (sf, 14.5 cm)\n' + table(x.curb) + '\n\n## Late ollie at the 0.45 m ledge (popped d before its face)\n' + table(x.ledge))
  }
  if (o.section === 'drive') {
    const x = driveFeel(data)
    console.log('\n# 10. Driving\n## Straight (lab strip)\n' + table(x.straight) + '\n\n## Full lock (lab floor)\n' + table(x.turning) + '\n\n## Handbrake (lab floor, full lock)\n' + table(x.handbrake) +
      '\n\n## Kerb (15 cm, head on: the kerb at 126, -160, flat and clear beyond)\n' + table(x.kerb) + '\n\n## Hills (full throttle)\n' + table(x.climb))
  }
  if (o.tour || o.section === 'tour') console.log('\n# 7. The Tour with human hands (done, of ' + (o.trials ?? 50) + ' tries each)\n' + table(tourFeel(data, o.trials ?? 50, o.level)))
}
