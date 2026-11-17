import type { GameData } from '../sim/data.ts'
import { applyCommand, parseCommand } from '../sim/commands.ts'
import { Btn } from '../sim/input.ts'
import { DEG, headingDir } from '../sim/math.ts'
import { advance } from '../sim/replay.ts'
import { createSim, skater, type Sim, type SimEvent } from '../sim/sim.ts'
import type { Thing } from '../sim/thing.ts'
import { driveKeys, laned, type DriveBot } from './drivebot.ts'
import { loadPark } from './io.ts'

// The drive section of the feel audit (`skate feel --section drive`, docs/feel-audit.md section 10):
// each vehicle type through the arcade numbers, driven through the real sim with a player's keys.
// Flat tests on the lab park (the 160 m strip at x 60 from rest; the 50 x 40 m floor, launched at the
// speed asked for); a 15 cm kerb in sf with flat, clear ground beyond (Valencia's west kerb north of 17th, at -58, -342); hills
// along the city's own lanes: Dolores 18th to 20th, Hyde St up to Lombard, the Lombard crooked block
// driven up its hairpins (one way down in life). Numbers in km/h where a driver thinks in them.

const R = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d
const KMH = 3.6
type Row = Record<string, number | string>

/** A sim with a vehicle of type at x y heading, the player in it, settled; launched at kmh along its heading. */
function inVehicle(data: GameData, park: string, type: string, x: number, y: number, heading: number, kmh = 0): { s: Sim; c: Thing } {
  const s = createSim(loadPark(park, data), data, { seed: 1 })
  if (park === 'sf') applyCommand(s, parseCommand('traffic clear'))
  applyCommand(s, parseCommand(`vehicle spawn ${type} ${x} ${y} ${heading} feel`))
  applyCommand(s, parseCommand('vehicle enter feel'))
  const c = s.world.things.find((t) => t.car?.drive?.name === 'feel')!
  for (let t = 0; t < 30; t++) advance(s, { b: 0 })
  if (kmh > 0) { const f = headingDir(heading * DEG), v = kmh / KMH; c.vel = { x: f.x * v, y: f.y * v, z: 0 } }
  return { s, c }
}
const speed = (c: Thing) => Math.hypot(c.vel.x, c.vel.y)
/** Up below want, nothing above it (a driver holding a speed). */
const hold = (c: Thing, want: number) => (speed(c) < want ? Btn.up : 0)

/** 0 to 50 km/h, the speed at the strip's end, stopping from 50: on the lab strip, northbound, from rest. */
export function straight(data: GameData, type: string): Row {
  let { s, c } = inVehicle(data, 'lab', type, 60, -75, 0)
  let t50 = -1, d50 = 0, t = 0
  const y0 = c.pos.y
  for (; t < 20 * 120 && c.pos.y < 75; t++) {
    advance(s, { b: Btn.up })
    if (t50 < 0 && speed(c) >= 50 / KMH) { t50 = (t + 1) / 120; d50 = c.pos.y - y0 }
  }
  const end = speed(c)
  ;({ s, c } = inVehicle(data, 'lab', type, 60, -40, 0, 50))
  const yb = c.pos.y
  let tb = 0
  while (speed(c) > 0.05 && tb < 10 * 120) { advance(s, { b: Btn.down }); tb++ }
  return { type, '0-50 km/h s': t50 < 0 ? '-' : R(t50, 2), '0-50 m': t50 < 0 ? '-' : R(d50), 'km/h at 150 m': R(end * KMH), 'top km/h (data)': R(data.vehicles.types[type].engine.topSpeed * KMH), 'stop from 50 m': R(c.pos.y - yb), 'stop s': R(tb / 120, 2) }
}

/** Full left lock at a held speed on the lab floor: the circle across (2 x speed / yaw rate, a second in) and the sideways pull. */
export function turning(data: GameData, type: string, kmh: number): Row {
  const { s, c } = inVehicle(data, 'lab', type, -12, -6, 90, kmh)
  const want = kmh / KMH
  let w = 0, v = 0, slid = 0
  for (let t = 0; t < 120; t++) {
    advance(s, { b: hold(c, want) | Btn.left })
    if (t >= 100) { w += Math.abs(c.car!.drive!.yawRate) / 20; v += speed(c) / 20; const f = c.fwd; slid = Math.max(slid, Math.abs(c.vel.x * f.y - c.vel.y * f.x)) }
  }
  const r = w > 1e-3 ? v / w : Infinity
  return { type, 'at km/h': kmh, 'held km/h': R(v * KMH), 'circle m (across)': R(2 * r), 'sideways pull g': R((v * w) / 9.81, 2), 'slide m/s': R(slid, 2) }
}

/** The handbrake at 45 km/h with full left lock: how long to 90 and 180 degrees, the speed left, how far. */
export function handbrake(data: GameData, type: string): Row {
  const { s, c } = inVehicle(data, 'lab', type, -12, -8, 90, 45)
  const x0 = c.pos.x, y0 = c.pos.y, v0 = speed(c)
  let t90 = -1, t180 = -1, turned = 0, last = c.car!.drive!.heading, t = 0, v180 = 0
  for (; t < 3 * 120 && t180 < 0; t++) {
    advance(s, { b: Btn.left | Btn.slide })
    let dh = c.car!.drive!.heading - last
    dh = Math.atan2(Math.sin(dh), Math.cos(dh))
    turned += dh; last = c.car!.drive!.heading
    if (t90 < 0 && Math.abs(turned) >= 90 * DEG) t90 = (t + 1) / 120
    if (Math.abs(turned) >= 180 * DEG) { t180 = (t + 1) / 120; v180 = speed(c) }
  }
  return { type, 'from km/h': R(v0 * KMH), '90 deg s': t90 < 0 ? '-' : R(t90, 2), '180 deg s': t180 < 0 ? `- (${R((Math.abs(turned) / DEG), 0)} deg)` : R(t180, 2), 'km/h at 180': t180 < 0 ? '-' : R(v180 * KMH), 'travelled m': R(Math.hypot(c.pos.x - x0, c.pos.y - y0)) }
}

/** Head on at a 15 cm kerb (sf, Valencia's west kerb at -58, -342) at a held speed: up onto it? Bumps, air, speed lost. */
const KERB_X = -58.4   // where the sidewalk starts
export function kerb(data: GameData, type: string, kmh: number): Row {
  const back = data.vehicles.types[type].dims.body.length / 2 + 3
  const { s, c } = inVehicle(data, 'sf', type, KERB_X + back, -341.7, 268, kmh)
  const want = kmh / KMH, ev: SimEvent[] = []
  let before = 0, after = -1, air = 0, minV = Infinity
  for (let t = 0; t < 6 * 120; t++) {
    for (const e of advance(s, { b: hold(c, want) })) ev.push(e)
    if (!c.car!.drive!.ground) air++
    if (c.pos.x > KERB_X + 1) before = speed(c)
    else minV = Math.min(minV, speed(c))
    if (after < 0 && c.pos.x < KERB_X - data.vehicles.types[type].dims.body.length / 2 - 1) { after = speed(c); break }
  }
  const bumps = ev.filter((e) => e.t === 'vanBump').length, lands = ev.filter((e) => e.t === 'vanLand').length
  return { type, 'at km/h': kmh, 'up and over': after < 0 ? 'no' : 'yes', 'km/h before': R(before * KMH), 'slowest km/h': minV === Infinity ? '-' : R(minV * KMH), 'air ticks': air, bumps, 'hard landings': lands }
}

/** A lane of the city's traffic network from near a to near b (its points in that order, z dropped). */
export function road(s: Sim, a: [number, number], b: [number, number]): [number, number][] {
  const near = (p: number[], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 8
  for (const p of s.park.traffic.paths) {
    const f = p.points[0], l = p.points[p.points.length - 1]
    if (near(f, a) && near(l, b)) return p.points.map((q) => [q[0], q[1]])
    if (near(l, a) && near(f, b)) return p.points.slice().reverse().map((q) => [q[0], q[1]])
  }
  throw new Error(`no lane from ${a} to ${b}`)
}

/** A climb along points at full throttle (the drive bot steering, slowing for hairpins): time, the slowest and the mean speed, metres up. */
export function climb(data: GameData, type: string, name: string, pts: (s: Sim) => [number, number][], lane: number, corner: number): Row {
  const probe = createSim(loadPark('sf', data), data, { seed: 1 })
  const path = laned(pts(probe), lane), [x, y] = path[0], h = (Math.atan2(path[2][0] - x, path[2][1] - y) / DEG + 360) % 360
  const { s, c } = inVehicle(data, 'sf', type, x, y, h)
  const bot: DriveBot = { path: path.slice(1), from: 0, speed: 40, corner, lane: 0, stop: false, i: 0, done: false }
  const z0 = c.pos.z, ev: SimEvent[] = []
  let t = 0, slow = Infinity, sum = 0, dist = 0, px = c.pos.x, py = c.pos.y
  for (; t < 120 * 120; t++) {
    const k = driveKeys(s, skater(s), bot)
    if (k === null) break
    for (const e of advance(s, { b: k })) ev.push(e)
    dist += Math.hypot(c.pos.x - px, c.pos.y - py); px = c.pos.x; py = c.pos.y
    if (t > 360) slow = Math.min(slow, speed(c))
    sum += speed(c)
  }
  const up = c.pos.z - z0
  return { type, hill: name, 'm along': R(dist), 'm up': R(up), 'grade %': R((up / Math.max(1, dist)) * 100), s: R(t / 120), 'slowest km/h': R(slow * KMH), 'mean km/h': R((sum / Math.max(1, t)) * KMH), bumps: ev.filter((e) => e.t === 'vanBump').length, done: bot.done || bot.i >= bot.path.length ? 'yes' : 'no' }
}

export const DOLORES: [number, number][] = [[-226, -162], [-226, -173], [-225, -183], [-224, -194], [-223, -210], [-222, -226], [-221, -242], [-220, -258], [-218, -276], [-217, -292], [-215, -309], [-214, -325], [-213, -342], [-211, -360], [-210, -379], [-209, -395], [-207, -412], [-206, -428], [-205, -444], [-204, -455]]

export function driveFeel(data: GameData): { straight: Row[]; turning: Row[]; handbrake: Row[]; kerb: Row[]; climb: Row[] } {
  const types = Object.keys(data.vehicles.types)
  return {
    straight: types.map((t) => straight(data, t)),
    turning: types.flatMap((t) => [8, 20, 40].map((k) => turning(data, t, k))),
    handbrake: types.map((t) => handbrake(data, t)),
    kerb: types.flatMap((t) => [8, 20, 35].map((k) => kerb(data, t, k))),
    climb: types.flatMap((t) => [
      climb(data, t, 'Dolores, 18th to 20th', () => DOLORES, 0, 7),
      climb(data, t, 'Hyde St, the top block up to Lombard (middle line)', (s) => road(s, [-310, 790], [-292, 698]), 0, 5),
      climb(data, t, 'Lombard crooked block, up (hairpins at 13 km/h)', (s) => road(s, [-148, 723], [-292, 698]), 0, 3.5),
    ]),
  }
}
