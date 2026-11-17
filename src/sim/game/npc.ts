import { Btn, type InputFrame } from '../input.ts'
import { atan2, v3 } from '../math.ts'
import { raycast, sphereContacts, type Contact } from '../park/park.ts'
import { closestOnLine, grindNear } from '../park/grindlines.ts'
import { nextFloat, seedRng, type RngState } from '../rng.ts'
import type { BombRoute, NpcStyle } from '../data.ts'
import { placeAt, skater, spawn, type Sim, type SimEvent } from '../sim.ts'
import { Kind, State, type NpcLife, type Thing } from '../thing.ts'
import { stepSkater } from '../skater/skater.ts'
import { followLine } from './follow.ts'
import { lineCrossesSkateLane, onSkateLane, place, skateGameOn, stepLocal } from './skate.ts'

// NPC skaters (docs/mechanics/npc.md): Things of kind 'npc' that ride the park's rider lines with the
// same autopilot a scenario uses, pressing the keys a player would. Each has a style (tech, gnar,
// cruiser) and a skill; they link combos (a trick, a manual, a grind, a flip out), the gnar ones go
// for the Big 3 and the Hellride, they take turns at the busy spots, cheer your big combos and now
// and then ride your line after you. They run the real skater physics, but with their own random
// stream (world.npcRng), their own events (only the npc* ones reach the world) and no contact with
// the player, so the player's game is exactly what it would be without them. `npc spawn [n]`.

const touching: Contact[] = []
const nearIds: number[] = []
const rand = (sim: Sim) => nextFloat(sim.world.npcRng!)
const between = (sim: Sim, [a, b]: [number, number]) => a + (b - a) * rand(sim)
const AIR_ACTS = new Set(['flip', 'grab', 'grind', 'grinding', 'ollie'])
const FLIP_DIRS = [0, Btn.left, Btn.right, Btn.up, Btn.down]
const TRAIL = 4   // numbers per point of the player's line: x, y, pop 0|1, speed (m/s)
// Where a waiter stands, nearest first: metres back from a line's start and to its side.
const WAIT_AT = [[-1.5, 0], [-1.5, 1], [-1.5, -1], [0, 1.2], [0, -1.2], [-3, 0], [-3, 1], [-3, -1], [-1.5, 2], [-1.5, -2], [0, 2.4], [0, -2.4], [1.5, 1.2], [1.5, -1.2], [-4.5, 0]]

/** `npc spawn [n]`: n skaters (the park's default count) on random lines, each with a style and a skill. Returns how many. */
export function spawnNpcs(sim: Sim, n?: number): number {
  const cfg = sim.data.npc.parks[sim.park.name], N = sim.data.npc
  if (!cfg) throw new Error(`no NPC skaters in ${sim.park.name} (data/npc.json parks: ${Object.keys(N.parks).join(', ')})`)
  if (!sim.world.npcRng) sim.world.npcRng = seedRng((sim.world.seed * 7919 + 17) >>> 0)
  const lines = npcLines(sim)
  if (!lines.length) throw new Error(`none of the NPC lines exist in ${sim.park.name}`)
  const count = n ?? cfg.count
  const styles = Object.keys(N.styles), total = styles.reduce((s, k) => s + N.styles[k].share, 0)
  for (let k = 0; k < count; k++) {
    const t = spawn(sim, Kind.npc)
    let r = rand(sim) * total, style = styles[styles.length - 1]
    for (const s of styles) { if (r < N.styles[s].share) { style = s; break } r -= N.styles[s].share }
    const life: NpcLife = { style, skill: between(sim, N.styles[style].skill), links: 0, next: 'ollie', hold: 0, sloppy: false, send: '', wait: 0, cheer: -1e9 }
    t.npc = { line: 0, i: 1, lastUp: -1000, plan: 0, act: '', actTicks: 0, actEnd: 0, dir: 0, slow: 0, speed: 0, look: Math.floor(rand(sim) * 1000), life }
    respawn(sim, t)
  }
  return count
}

export function clearNpcs(sim: Sim) {
  sim.world.things = sim.world.things.filter((t) => t.kind !== Kind.npc)
}

const npcLines = (sim: Sim) => {
  const want = sim.data.npc.parks[sim.park.name]?.lines ?? []
  const all = sim.park.lines.map((l, i) => ({ l, i })).filter(({ l }) => want.includes(l.id))
  if (!skateGameOn(sim)) return all
  // A game of S.K.A.T.E. is on: only lines clear of its lane.
  const clear = all.filter(({ l }) => !lineCrossesSkateLane(sim, l.points))
  return clear.length ? clear : all
}
const styleOf = (sim: Sim, t: Thing): NpcStyle => sim.data.npc.styles[t.npc!.life!.style]
const sendOf = (sim: Sim, line: number) => sim.data.npc.sends.find((s) => s.line === sim.park.lines[line].id)

/** The spot a line belongs to (data npc.spots), or the line on its own. */
function spotOf(sim: Sim, line: number): string {
  const id = sim.park.lines[line].id
  for (const [spot, lines] of Object.entries(sim.data.npc.spots)) if (lines.includes(id)) return spot
  return `line:${id}`
}

/** The spot a park NPC holds now (riding a line of it), or null (waiting, watching, copying, or not a park NPC). */
export function npcSpot(sim: Sim, t: Thing): string | null {
  const m = t.npc
  if (t.kind !== Kind.npc || !m?.life || m.act === 'wait' || m.watch !== undefined || m.life.copy) return null
  return spotOf(sim, m.line)
}

/** Someone else is riding that spot now (the claim lasts their run on it). */
function spotBusy(sim: Sim, t: Thing, line: number): boolean {
  const spot = spotOf(sim, line)
  for (const o of sim.world.things) {
    const m = o.npc
    if (o === t || o.kind !== Kind.npc || !m?.life || m.act === 'wait' || m.watch !== undefined || m.life.copy) continue
    if (spotOf(sim, m.line) === spot) return true
  }
  return false
}

/** Someone has been waiting for that spot (longer than t, or t is new to it): t queues behind them. */
function spotQueued(sim: Sim, t: Thing, line: number): boolean {
  const spot = spotOf(sim, line), mine = t.npc!.act === 'wait' ? t.npc!.life!.wait : -1
  for (const o of sim.world.things) {
    const m = o.npc
    if (o === t || o.kind !== Kind.npc || !m?.life || m.act !== 'wait' || spotOf(sim, m.line) !== spot) continue
    if (m.life.wait > mine || (m.life.wait === mine && o.id < t.id)) return true
  }
  return false
}

/**
 * The lines starting within npc.near.radius of player 1, picked npc.near.share of the time, when some
 * do and some do not (a city's lines spread over it: the locals ride where you are). All near or none
 * near, every line, and no draw from the stream.
 */
function nearPlayer(sim: Sim, lines: ReturnType<typeof npcLines>) {
  const R = sim.data.npc.near
  if (!R) return lines
  const sk = skater(sim)
  const near = lines.filter(({ l }) => Math.hypot(l.points[0][0] - sk.pos.x, l.points[0][1] - sk.pos.y) < R.radius)
  if (!near.length || near.length === lines.length) return lines
  return rand(sim) < R.share ? near : lines
}

/** Back to the start of a random line (a gnar one often picks a line it can send), a fresh run. */
function respawn(sim: Sim, t: Thing) {
  const N = sim.data.npc, n = t.npc!, S = styleOf(sim, t)
  const lines = nearPlayer(sim, npcLines(sim))
  const sends = S.send > 0 ? lines.filter(({ i }) => sendOf(sim, i)) : []
  let from = sends.length && rand(sim) < S.send ? sends : lines
  // Mostly a spot nobody is riding; now and then one that is busy (and wait at the top for it).
  const free = from.filter(({ i }) => !spotBusy(sim, t, i) && !spotQueued(sim, t, i))
  if (free.length && rand(sim) < N.freeSpot) from = free
  const pick = from[Math.floor(rand(sim) * from.length)]
  n.speed = N.speed * S.speed * (1 + (rand(sim) * 2 - 1) * N.speedJitter)
  startLine(sim, t, pick.i, true)
}

function startLine(sim: Sim, t: Thing, line: number, place: boolean) {
  const n = t.npc!, L = n.life!, S = styleOf(sim, t)
  n.line = line
  n.i = place ? 1 : 0
  n.act = ''; n.actTicks = 0; n.slow = 0
  n.plan = Math.round(between(sim, S.trickEvery) * sim.data.physics.tickHz)
  const send = sendOf(sim, line)
  L.send = send && S.send > 0 && rand(sim) < S.send ? send.kind : ''
  L.links = 0; L.copy = undefined; L.wait = 0
  if (!place) return
  const pts = linePoints(sim, t)   // a send's way in may start off its line (keep 0)
  const [x0, y0] = pts[0], [x1, y1] = pts[1]
  // Their turn at a busy spot (someone riding it, or already waiting for it): wait at the top, a step back
  // (or beside it) on the same flat ground as the start; on the start itself when there is no such place.
  const busy = spotBusy(sim, t, line) || spotQueued(sim, t, line)
  const L01 = Math.hypot(x1 - x0, y1 - y0) || 1, ux = (x1 - x0) / L01, uy = (y1 - y0) / L01
  const r = sim.data.physics.skater.radius
  const z0 = groundAt(sim, x0, y0)
  let pos = v3(x0, y0, z0 + r + 0.02)
  if (busy) {
    // A place no other waiter stands on (waitGap apart), the nearest first; riders are on their way out.
    const gap = sim.data.npc.waitGap
    const taken = (x: number, y: number) => sim.world.things.some((o) => o !== t && o.kind === Kind.npc && o.npc?.act === 'wait' && Math.hypot(o.pos.x - x, o.pos.y - y) < gap)
    for (const [bx, by] of WAIT_AT) {
      const sx = x0 + ux * bx + uy * by, sy = y0 + uy * bx - ux * by
      if (taken(sx, sy)) continue
      const z = groundAt(sim, sx, sy), p = v3(sx, sy, z + r + 0.02)
      if (Math.abs(z - z0) < 0.25 && sphereContacts(sim.park, p, r, touching).length === 0) { pos = p; break }
    }
  }
  // Lifted clear of anything the sphere would touch (a crease between two ramps).
  for (let k = 0; k < 25 && sphereContacts(sim.park, pos, r, touching).length > 0; k++) pos.z += 0.02
  placeAt(t, { id: sim.park.lines[line].id, pos, heading: atan2(x1 - x0, y1 - y0) })
  t.combo = []; t.trick = null; t.grind = null; t.manual = null; t.lip = null; t.wall = null; t.skitch = null
  t.charge = 0; t.crouch = false; t.landGrace = 0; t.powerslide = 0; t.wobble = 0; t.stumble = 0
  if (busy) { n.act = 'wait'; n.i = 0 }   // from the waiting place to the start first
}

/** The height of the park's surface at (x, y), from above. */
function groundAt(sim: Sim, x: number, y: number): number {
  const from = sim.data.npc.castFrom
  return raycast(sim.park, v3(x, y, from), v3(0, 0, -1), from - sim.park.boundsMin.z + 1)?.point.z ?? 0
}

/** The points it rides now: a copied line, the line (its send's way in and run-out when it sends it), or the line. */
function linePoints(sim: Sim, t: Thing): [number, number][] {
  const n = t.npc!, L = n.life!
  if (L.copy) {
    const out: [number, number][] = []
    for (let k = 0; k < L.copy.length; k += TRAIL) out.push([L.copy[k], L.copy[k + 1]])
    return out
  }
  const line = sim.park.lines[n.line], send = L.send ? sendOf(sim, n.line) : undefined
  return send ? [...line.points.slice(0, send.keep ?? line.points.length), ...send.via] : line.points
}

/** A rail or ledge right ahead within an ollie's reach (2.5 m on, 0.1 to 1 m above the feet). */
function grindAhead(sim: Sim, t: Thing): boolean {
  const v = Math.hypot(t.vel.x, t.vel.y)
  if (v < 1) return false
  const r = sim.data.physics.skater.radius, fx = t.pos.x + (t.vel.x / v) * 2.5, fy = t.pos.y + (t.vel.y / v) * 2.5, feet = t.pos.z - r
  for (const id of grindNear(sim.park.grindGrid, fx - 1.2, fy - 1.2, fx + 1.2, fy + 1.2, nearIds)) {
    const c = closestOnLine(sim.park.grind[id], v3(fx, fy, feet + 0.5))
    if (Math.hypot(c.pos.x - fx, c.pos.y - fy) < 1.2 && c.pos.z - feet > 0.1 && c.pos.z - feet < 1) return true
  }
  return false
}

/** The air act for a pop: a grind try when a rail is right ahead, else by the style's chances. */
function trickFor(sim: Sim, t: Thing, S: NpcStyle, link: boolean): string {
  if (!link) return 'ollie'
  if (grindAhead(sim, t) && rand(sim) < Math.min(1, S.grindChance * 2.5)) return 'grind'
  const r = rand(sim)
  return r < S.flipChance ? 'flip' : r < S.flipChance + S.grabChance ? 'grab' : r < S.flipChance + S.grabChance + S.grindChance ? 'grind' : 'ollie'
}

/** Get ready for a pop into act: its direction, how long a grab is held, whether this one goes wrong. */
function ready(sim: Sim, t: Thing, act: string) {
  const n = t.npc!, L = n.life!, N = sim.data.npc
  L.next = act
  n.dir = FLIP_DIRS[Math.floor(rand(sim) * FLIP_DIRS.length)]
  L.hold = act === 'grab' ? Math.round(between(sim, N.grabTicks)) : 0
  L.sloppy = rand(sim) < (1 - L.skill) * N.sloppy
}

/** The keys this tick: ride the line, the combo it is in the middle of, its sends and copies. */
function pilot(sim: Sim, t: Thing): number {
  const n = t.npc!, L = n.life!, N = sim.data.npc, S = styleOf(sim, t), P = sim.data.physics, hz = P.tickHz
  const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
  // A grind try that caught a wall instead: one wallride, then no more grind presses this air.
  if (t.state === State.wall) { if (n.act === 'grind') n.act = 'ollie'; return 0 }
  // On a grind: keep the balance (a sloppy one lets go for a moment), ollie off after a while.
  if (t.state === State.grind && t.grind) {
    if (n.act !== 'grinding') { n.act = 'grinding'; n.actTicks = 0; n.actEnd = Math.round(between(sim, N.grindTicks)); L.sloppy = rand(sim) < (1 - L.skill) * N.sloppy }
    n.actTicks++
    const lapse = L.sloppy && n.actTicks > n.actEnd / 2 && n.actTicks < n.actEnd / 2 + N.lapseTicks
    let b = lapse ? 0 : t.grind.balance > 0.2 ? Btn.left : t.grind.balance < -0.2 ? Btn.right : 0
    if (n.actTicks >= n.actEnd) b |= Btn.ollie
    if (n.actTicks >= n.actEnd + 14) b &= ~Btn.ollie   // let go: pop off
    return b
  }
  if (t.state === State.air) {
    if (n.act === 'charge' || n.act === 'man-pop') { n.act = L.next; n.actTicks = 0 }   // the pop: the act picked for it
    else if (n.act === 'grinding') {
      // Off a grind: a flip out keeps the combo going.
      const out = L.links > 0 && rand(sim) < S.flipOut
      if (out) { L.links--; ready(sim, t, 'flip') }
      n.act = out ? 'flip' : 'ollie'; n.actTicks = 0
    } else if (n.act === '' && L.send === 'wall' && t.vertAir) { ready(sim, t, rand(sim) < 0.6 ? 'grab' : 'flip'); n.act = L.next; n.actTicks = 0 }   // up the Hellride: something in the air
    else if (n.act === 'man-in' || n.act === 'manual') { n.act = 'ollie'; n.actTicks = 0 }   // rolled off something mid-manual
    n.actTicks++
    let b = 0
    if (n.act === 'flip' && n.actTicks === (L.sloppy ? 6 + N.lateTicks : 6)) b |= Btn.flip | n.dir   // a sloppy one flips late (and may land in it)
    if (n.act === 'grab' && n.actTicks >= 6 && n.actTicks < 6 + L.hold) b |= Btn.grab | (n.actTicks === 6 ? n.dir : 0)
    if (n.act === 'grind' && n.actTicks >= 4) b |= n.actTicks % 8 === 4 ? Btn.grind : 0
    return b
  }
  if (t.state !== State.ground) return 0
  // Down again: a send is done (roll it out); with the combo open and links left, a manual; else let it bank.
  if (AIR_ACTS.has(n.act)) {
    if (L.send && !L.copy) { L.send = ''; n.act = 'out'; n.actTicks = 0 }
    else if (L.links > 0 && t.combo.length > 0 && t.landGrace > 0 && rand(sim) < S.manualChance) { n.act = 'man-in'; n.actTicks = 0; L.links-- }
    else { n.act = ''; L.links = 0; n.plan = Math.round(between(sim, S.trickEvery) * hz) }
  }
  // Rolling out a send: no keys until the combo counts (or a second has gone), then on to the next line.
  if (n.act === 'out') {
    if (t.combo.length === 0 || ++n.actTicks > hz) nextLine(sim, t)
    return 0
  }
  // A manual it fell into (a brake, then a push: down then up is a nose manual): ride it as a link.
  if (t.manual && n.act !== 'manual' && n.act !== 'man-pop') { n.act = 'manual'; n.actTicks = 0; n.actEnd = Math.round(between(sim, S.manualTicks)); L.sloppy = rand(sim) < (1 - L.skill) * N.sloppy }
  const pts = linePoints(sim, t)
  // On a copied line, the player's own speed there; on a send's way in, its speed; else its cruising speed.
  const send = L.send && !L.copy ? sendOf(sim, n.line) : undefined
  const want = L.copy ? Math.max(2.5, Math.min(9, L.copy[Math.min(n.i, L.copy.length / TRAIL - 1) * TRAIL + 3]))
    : send ? Math.max(n.speed, send.speed) : n.speed
  const f = followLine(sim, t, n, pts, L.copy ? 1 : sim.park.lines[n.line].radius ?? 1.2, want, 0.4)
  if (f === null) { nextLine(sim, t); return 0 }
  const steer = f.b & (Btn.left | Btn.right)
  // Into a manual: up, then down (combo.ts manualInput).
  if (n.act === 'man-in') {
    n.actTicks++
    if (t.manual) { n.act = 'manual'; n.actTicks = 0; n.actEnd = Math.round(between(sim, S.manualTicks)); L.sloppy = rand(sim) < (1 - L.skill) * N.sloppy; return steer }
    if (n.actTicks > 8) { n.act = ''; L.links = 0; n.plan = Math.round(between(sim, S.trickEvery) * hz); return f.b }
    return steer | (n.actTicks === 1 ? Btn.up : n.actTicks === 3 ? Btn.down : 0)
  }
  // In a manual: keep the balance (a sloppy one lets go for a moment), then ollie out into the next link.
  if (n.act === 'manual' || n.act === 'man-pop') {
    if (!t.manual) { n.act = ''; L.links = 0; n.plan = Math.round(between(sim, S.trickEvery) * hz); return f.b }   // it ended: ride on
    n.actTicks++
    const m = t.manual
    const lapse = n.act === 'manual' && L.sloppy && n.actTicks > n.actEnd / 3 && n.actTicks < n.actEnd / 3 + N.lapseTicks
    let b = steer | (lapse ? 0 : m.balance > 0.03 ? Btn.down : m.balance < -0.03 ? Btn.up : 0)
    if (n.act === 'manual' && n.actTicks >= n.actEnd) {
      const act = trickFor(sim, t, S, L.links > 0)
      if (act !== 'ollie') L.links--
      ready(sim, t, act)
      n.act = 'man-pop'; n.actTicks = 1
    }
    if (n.act === 'man-pop') b |= n.actTicks <= 10 ? Btn.ollie : 0   // crouch, then let go: the pop ends the manual
    return b
  }
  // A copied line: crouch so the pop comes where the player popped.
  if (n.act === '' && L.copy && n.i < L.copy.length / TRAIL && L.copy[n.i * TRAIL + 2] === 1) {
    const d = Math.hypot(L.copy[n.i * TRAIL] - t.pos.x, L.copy[n.i * TRAIL + 1] - t.pos.y), v = Math.max(speed, 1)
    if (d < v * (34 / hz) + 0.4) {
      ready(sim, t, rand(sim) * (S.flipChance + S.grabChance) < S.flipChance ? 'flip' : 'grab')   // a flip or a grab where you popped
      n.act = 'charge'; n.actTicks = 0; n.actEnd = Math.max(4, Math.min(34, Math.round(((d - 0.3) / v) * hz)))
      L.copy[n.i * TRAIL + 2] = 0   // that pop is taken
    }
  }
  // Sending the Big 3: crouch so the pop comes right at the top of the set (the last line point it keeps).
  if (n.act === '' && L.send === 'gap' && !L.copy) {
    const top = (sendOf(sim, n.line)?.keep ?? sim.park.lines[n.line].points.length) - 1
    const [ex, ey] = pts[top], d = Math.hypot(ex - t.pos.x, ey - t.pos.y), v = Math.max(speed, 1)
    if (n.i >= top && d < v * (34 / hz) + 0.5) {
      ready(sim, t, rand(sim) < 0.5 ? 'grab' : rand(sim) < 0.6 ? 'flip' : 'ollie')
      n.act = 'charge'; n.actTicks = 0; n.actEnd = Math.max(6, Math.min(34, Math.round(((d - 0.4) / v) * hz)))
    }
  }
  // Tricks: every few seconds on a straight bit at speed, crouch and pop; the air act is picked now.
  if (n.act === 'charge') {
    // Crouched: steering only (a push or a brake tap here would read as a foot trick or a manual).
    n.actTicks++
    if (n.actTicks < n.actEnd) return steer | Btn.ollie
    n.actTicks = 0
    return steer   // release: pop
  }
  if (!L.send && !L.copy && --n.plan <= 0 && speed > 2.5 && Math.abs(f.err) < 0.25) {
    // A trick that opens a combo gets its links (the manuals, grinds and flip outs that follow it).
    if (t.combo.length === 0) L.links = Math.round(between(sim, S.links))
    ready(sim, t, trickFor(sim, t, S, true))
    n.act = 'charge'; n.actTicks = 0; n.actEnd = Math.round(between(sim, N.chargeTicks))
  }
  return f.b
}

/** Off to watch a game of S.K.A.T.E.: the first free crowd spot, standing, facing the lane. */
function watchSkate(sim: Sim, t: Thing) {
  const crowd = sim.data.run.skate.spot.crowd
  const taken = new Set(sim.world.things.map((x) => x.npc?.watch).filter((k) => k !== undefined))
  let k = crowd.findIndex((_, i) => !taken.has(i))
  if (k < 0) k = taken.size % crowd.length
  const [x, y, heading] = crowd[k]
  place(sim, t, [x, y], heading, 'skate_crowd')
  t.npc!.watch = k
  t.npc!.act = ''
}

/** At a line's end: a free line starting within reach (ridden from where we are), else a respawn. */
function nextLine(sim: Sim, t: Thing) {
  const n = t.npc!
  n.life!.copy = undefined
  const here = spotOf(sim, n.line)
  const near = npcLines(sim).filter(({ l, i }) => i !== n.line && spotOf(sim, i) !== here && Math.hypot(l.points[0][0] - t.pos.x, l.points[0][1] - t.pos.y) < sim.data.npc.linkRange && !spotBusy(sim, t, i) && !spotQueued(sim, t, i))
  if (!near.length) return respawn(sim, t)
  startLine(sim, t, near[Math.floor(rand(sim) * near.length)].i, false)
}

/**
 * Before the NPC skaters move: the player's line (kept for copying), and what they make of the
 * player's combo this tick: a cheer from those near a big one, and now and then one rides it after.
 */
export function npcAware(sim: Sim, events: SimEvent[]) {
  if (!sim.world.npcRng) return
  const N = sim.data.npc, tick = sim.world.tick, hz = sim.data.physics.tickHz
  const npcs = sim.world.things.filter((t) => t.kind === Kind.npc && t.alive && t.npc?.life && t.npc.watch === undefined)
  if (!npcs.length) return
  const sk = sim.world.things.find((t) => t.kind === Kind.skater && t.alive && t.player !== 2)
  if (!sk) return
  // The player's line: a point every trail.every ticks and at every pop, for trail.seconds.
  const trail = sim.world.npcTrail ?? (sim.world.npcTrail = [])
  const popped = events.some((e) => e.t === 'pop' && e.player !== 2)
  if (popped || tick % N.trail.every === 0) {
    const r2 = (x: number) => Math.round(x * 100) / 100
    trail.push(r2(sk.pos.x), r2(sk.pos.y), popped ? 1 : 0, r2(Math.hypot(sk.vel.x, sk.vel.y)))
    const keep = TRAIL * Math.ceil((N.trail.seconds * hz) / N.trail.every)
    if (trail.length > keep) trail.splice(0, trail.length - keep)
  }
  const landed = events.find((e) => e.t === 'comboLanded' && e.player !== 2)
  if (!landed || landed.t !== 'comboLanded') return
  // A big combo: those near enough (and not mid-air or mid-grind) stomp their boards.
  if (landed.points >= N.cheer.points) {
    for (const t of npcs) {
      const L = t.npc!.life!
      if (Math.hypot(t.pos.x - sk.pos.x, t.pos.y - sk.pos.y) > N.cheer.range || tick - L.cheer < N.cheer.cooldown * hz) continue
      if (t.state !== State.ground && t.npc!.act !== 'wait') continue
      L.cheer = tick
      events.push({ t: 'npcCheer', tick, id: t.id })
    }
  }
  // Now and then the nearest one riding rides your last few seconds after you, popping where you did.
  if (landed.points >= N.copy.points && rand(sim) < N.copy.chance) {
    // The last copy.seconds of it, from where the player got moving.
    let n0 = Math.max(0, trail.length - TRAIL * Math.ceil((N.copy.seconds * hz) / N.trail.every))
    while (n0 + TRAIL < trail.length && trail[n0 + TRAIL + 3] < 1) n0 += TRAIL
    if (trail.length - n0 < 3 * TRAIL) return
    let best: Thing | null = null, bd = N.copy.range
    for (const t of npcs) {
      const m = t.npc!
      if (m.act !== '' || m.life!.copy || m.life!.send || t.state !== State.ground) continue
      const d = Math.hypot(t.pos.x - sk.pos.x, t.pos.y - sk.pos.y)
      if (d < bd) { bd = d; best = t }
    }
    if (!best) return
    // It starts where you started (like a respawn) and rides it at your speeds.
    const m = best.npc!, L = m.life!
    L.copy = trail.slice(n0); L.links = 0; L.send = ''
    m.i = 1; m.act = ''; m.slow = 0
    const x0 = L.copy[0], y0 = L.copy[1]
    let k = TRAIL
    while (k + TRAIL < L.copy.length && Math.hypot(L.copy[k] - x0, L.copy[k + 1] - y0) < 1) k += TRAIL
    const r = sim.data.physics.skater.radius, pos = v3(x0, y0, groundAt(sim, x0, y0) + r + 0.02)
    for (let j = 0; j < 25 && sphereContacts(sim.park, pos, r, touching).length > 0; j++) pos.z += 0.02
    placeAt(best, { id: 'npc_copy', pos, heading: atan2(L.copy[k] - x0, L.copy[k + 1] - y0) })
    best.combo = []; best.trick = null; best.grind = null; best.manual = null; best.landGrace = 0; best.charge = 0; best.crouch = false
    events.push({ t: 'npcCopy', tick, id: best.id })
  }
}

/**
 * One tick for an NPC skater: its keys, the skater physics on its own random stream and events,
 * the events the world hears, and the respawns (after a bail, when stuck, when lost).
 */
export function stepNpc(sim: Sim, t: Thing, out: SimEvent[]) {
  if (t.npc!.skate) return stepLocal(sim, t, out)   // a S.K.A.T.E. local (game/skate.ts)
  const n = t.npc!, N = sim.data.npc, tick = sim.world.tick
  const racer = n.racer
  if (racer && !racer.go) { t.vel = v3(); return }   // waiting at the start line
  if (n.watch !== undefined) {
    // Watching a game of S.K.A.T.E. from the crowd; when it is over, back to riding.
    if (skateGameOn(sim)) { t.vel = v3(); return }
    delete n.watch
    respawn(sim, t)
    return
  }
  if (n.act === 'wait' && n.life) {
    // Waiting at the top of a busy spot: go when it is free; after maxWait, another line.
    n.life.wait++
    if (!spotBusy(sim, t, n.line) && !spotQueued(sim, t, n.line)) { n.act = ''; n.life.wait = 0 }   // free, and first in line: go
    else if (n.life.wait > N.maxWait * sim.data.physics.tickHz) { respawn(sim, t); return }
    else { t.vel = v3(); return }
  }
  if (t.state === State.walk) { if (!racer) respawn(sim, t); return }
  const b = t.state === State.bail ? 0 : racer ? racerKeys(sim, t) : pilot(sim, t)
  const wasAir = t.state === State.air, wasVert = t.vertAir
  const keep: RngState = sim.world.rng
  sim.world.rng = sim.world.npcRng!
  const ev: SimEvent[] = []
  try { stepSkater(sim, t, { b } as InputFrame, ev) } finally { sim.world.npcRng = sim.world.rng; sim.world.rng = keep }
  for (const e of ev) {
    if (e.t === 'trickEnd') out.push({ t: 'npcTrick', tick, id: t.id, trick: e.trick, points: e.points })
    else if (e.t === 'grindStart') out.push({ t: 'npcGrind', tick, id: t.id, trick: e.trick })
    else if (e.t === 'comboLanded') {
      out.push({ t: 'npcLand', tick, id: t.id, trick: e.name, points: e.points })
      if (n.life) out.push({ t: 'npcCombo', tick, id: t.id, points: e.points, name: e.name, multiplier: e.multiplier })
    }
    else if (e.t === 'bail') { out.push({ t: 'npcBail', tick, id: t.id, reason: e.reason }); n.act = 'bailed' }
  }
  if (racer) { if (n.act === 'bailed' && t.state !== State.bail) n.act = ''; racer.ticks++; return }   // racers get up and ride on
  // A gnar one going for it: off the top of the Big 3, or up and out of the Hellride.
  const L = n.life
  if (L?.send === 'gap' && !wasAir && t.state === State.air && !L.copy) out.push({ t: 'npcSend', tick, id: t.id, kind: 'gap', line: sim.park.lines[n.line].id })
  if (L?.send === 'wall' && !wasVert && t.vertAir) out.push({ t: 'npcSend', tick, id: t.id, kind: 'wall', line: sim.park.lines[n.line].id })
  // A game of S.K.A.T.E. on: off its lane (a line over it, or on it now) to watch from the crowd.
  if (skateGameOn(sim) && (onSkateLane(sim, t.pos.x, t.pos.y) || lineCrossesSkateLane(sim, sim.park.lines[n.line].points))) { watchSkate(sim, t); return }
  // Back up after a bail, or when stuck or lost: a fresh run on a random line.
  if (n.act === 'bailed' && t.state !== State.bail) { respawn(sim, t); return }
  const speed = Math.hypot(t.vel.x, t.vel.y, t.vel.z)
  n.slow = speed < 0.3 && t.state !== State.bail ? n.slow + 1 : 0
  const pts = n.life ? linePoints(sim, t) : sim.park.lines[n.line].points, w = pts[Math.min(n.i, pts.length - 1)]
  if (n.slow > N.stuckTicks || Math.hypot(w[0] - t.pos.x, w[1] - t.pos.y) > N.lostRange || t.pos.z < sim.park.boundsMin.z - 1) respawn(sim, t)
}

// ---- Hill Bomb rivals (docs/mechanics/modes.md): locals who race you down the route ----

/** Line up the route's racers at the start line (frozen until the player crosses it). */
export function spawnRacers(sim: Sim, route: BombRoute) {
  clearRacers(sim)
  if (!route.racers.length) return
  if (!sim.world.npcRng) sim.world.npcRng = seedRng((sim.world.seed * 7919 + 17) >>> 0)
  // Their line: the route's rider line, or (a route without one) its start and gates down the street.
  const line = route.line ? sim.park.lines.findIndex((l) => l.id === route.line) : -1
  if (route.line && line < 0) throw new Error(`hill bomb route ${route.id}: no rider line "${route.line}"`)
  const g = route.gates[0], r = sim.data.physics.skater.radius
  for (const R of route.racers) {
    // The first waypoint past the start line.
    const pts = line >= 0 ? sim.park.lines[line].points : routeLane(sim, route, R.offset)
    let first = pts.findIndex(([x, y]) => (x - g.pos[0]) * g.dir[0] + (y - g.pos[1]) * g.dir[1] > 2)
    if (first < 0) first = pts.length - 1
    const t = spawn(sim, Kind.npc)
    t.npc = { line, i: first, lastUp: -1000, plan: 0, act: '', actTicks: 0, actEnd: 0, dir: 0, slow: 0, speed: R.speed, look: R.look,
      racer: { name: R.name, gate: 1, go: false, ticks: 0, place: 0, standing: 0 } }
    // Beside the line, a little behind it, facing down the route.
    const x = g.pos[0] - g.dir[1] * R.offset - g.dir[0] * 0.6, y = g.pos[1] + g.dir[0] * R.offset - g.dir[1] * 0.6
    const hit = raycast(sim.park, v3(x, y, g.pos[2] + 3), v3(0, 0, -1), 10)
    const pos = v3(x, y, (hit?.point.z ?? g.pos[2]) + r + 0.02)
    for (let k = 0; k < 25 && sphereContacts(sim.park, pos, r, touching).length > 0; k++) pos.z += 0.02
    placeAt(t, { id: `racer_${route.id}`, pos, heading: atan2(g.dir[0], g.dir[1]) })
  }
}

export function clearRacers(sim: Sim) {
  sim.world.things = sim.world.things.filter((t) => !(t.kind === Kind.npc && t.npc?.racer))
}

/**
 * A route without a rider line: a racer's lane down its start and gates (lines across the street at
 * its cross streets), a point every bomb.gateStep metres, offset to the racer's side of it by its
 * line-up offset but no more than bomb.gateLane (so in the travel lanes, clear of the parked cars).
 * Following the gates themselves, one a block ahead, a racer could drift metres off the street's
 * middle before its steering noticed, into the parking lane and a parked car.
 */
function routeLane(sim: Sim, route: BombRoute, offset: number): [number, number][] {
  const key = `${route.id} ${offset}`, B = sim.data.run.bomb
  const cached = lanes.get(B)?.get(key)
  if (cached) return cached
  const corners: [number, number][] = [[route.start.pos[0], route.start.pos[1]], ...route.gates.map((g): [number, number] => [g.pos[0], g.pos[1]])]
  const side = Math.max(-B.gateLane, Math.min(B.gateLane, offset)), out: [number, number][] = []
  for (let k = 1; k < corners.length; k++) {
    const [ax, ay] = corners[k - 1], [bx, by] = corners[k], d = Math.hypot(bx - ax, by - ay)
    const lx = -(by - ay) / d, ly = (bx - ax) / d, n = Math.max(1, Math.round(d / B.gateStep))
    for (let j = k === 1 ? 0 : 1; j <= n; j++) out.push([ax + ((bx - ax) * j) / n + lx * side, ay + ((by - ay) * j) / n + ly * side])
  }
  if (!lanes.has(B)) lanes.set(B, new Map())
  lanes.get(B)!.set(key, out)
  return out
}
const lanes = new WeakMap<object, Map<string, [number, number][]>>()   // per sim's data (setData copies it), deterministic

/** A racer's keys: the route line at its own speed, tucked at speed (unless it stands up), its own braking. */
function racerKeys(sim: Sim, t: Thing): number {
  const n = t.npc!, k = n.racer!, R = racerDef(sim, t), hz = sim.data.physics.tickHz
  if (t.state === State.air) {
    // The show-off's flip off the stand-up pop, whenever it comes: too late and it lands mid-flip.
    n.actTicks++
    if (n.act === 'flip' && n.actTicks === n.actEnd) return Btn.flip | n.dir
    // A tucked racer keeps the tuck over a crest, as the rider-line autopilot does (harness/pilot.ts): letting
    // go of it for a tick in the air would pop a full late ollie.
    return (t.prevB & Btn.ollie) !== 0 && k.standing === 0 ? Btn.ollie : 0
  }
  if (t.state !== State.ground) return 0
  n.act = ''
  const line = n.line >= 0 ? sim.park.lines[n.line] : undefined
  const pts = line ? line.points : routeLane(sim, racerRoute(sim, t), R.offset)
  const f = followLine(sim, t, n, pts, line ? line.radius ?? 1.2 : sim.data.run.bomb.gateRadius, R.speed, R.brakeMargin)
  if (f === null) return 0
  let b = f.b
  // Some stand up now and then (and the speed wobbles find them); the rest tuck from 10 m/s.
  if (k.standing > 0) k.standing--
  else if (R.standUp > 0 && Math.hypot(t.vel.x, t.vel.y) > sim.data.physics.wobble.speed && rand(sim) < R.standUp / hz) {
    // Only at speed, showing off: up out of the tuck (that pops), sometimes with a flip at a random moment.
    k.standing = Math.round(hz * R.standFor)
    if (rand(sim) < R.flipChance) { n.act = 'flip'; n.actTicks = 0; n.actEnd = 4 + Math.floor(rand(sim) * 80); n.dir = [0, Btn.left, Btn.right][Math.floor(rand(sim) * 3)] }
  }
  if (Math.hypot(t.vel.x, t.vel.y) > 10 && k.standing === 0) b |= Btn.ollie
  // Letting go of the tuck pops a little ollie: only a racer standing up does that (and lands it, mostly).
  if ((b & Btn.ollie) === 0 && (t.prevB & Btn.ollie) !== 0 && k.standing === 0) b |= Btn.ollie
  return b
}

function racerRoute(sim: Sim, t: Thing): BombRoute {
  const r = [sim.data.run.bomb, ...sim.data.run.bomb.routes].find((x) => x.racers.some((d) => d.name === t.npc!.racer!.name))
  if (!r) throw new Error(`no racer ${t.npc!.racer!.name}`)
  return r
}

function racerDef(sim: Sim, t: Thing) {
  const routes = [sim.data.run.bomb, ...sim.data.run.bomb.routes]
  for (const r of routes) { const d = r.racers.find((x) => x.name === t.npc!.racer!.name); if (d) return d }
  throw new Error(`no racer ${t.npc!.racer!.name}`)
}
