import type { TourLevel } from '../data.ts'
import { dist, v3 } from '../math.ts'
import { findSpot, placeAt, type Sim, type SimEvent } from '../sim.ts'
import { State, type Thing } from '../thing.ts'
import { goalMet } from './goals.ts'

// The Tour (docs/mechanics/tour.md; data/tour.json): arcade-style levels, each a world, a start spot,
// an area, S-K-A-T-E letters, a secret tape, two score tiers and its own goals, played as a
// 2-minute run (`run level <id>`). The sim reports what got done this run (levelGoal, tapeFound,
// levelOver); the career (which goals ever, which levels open) is the client's.

const inBox = (b: [number, number, number, number], x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]
const outside = (b: [number, number, number, number], x: number, y: number) => Math.hypot(Math.max(b[0] - x, 0, x - b[2]), Math.max(b[1] - y, 0, y - b[3]))

export function tourLevel(sim: Sim, id: string): TourLevel {
  const L = sim.data.tour.levels.find((l) => l.id === id)
  if (!L) throw new Error(`no Tour level "${id}" (data/tour.json: ${sim.data.tour.levels.map((l) => l.id).join(', ')})`)
  return L
}

/** `run level <id> [start]`: at the level's start spot (or one of its other starts), letters and tape not found, its clock on. */
export function startLevel(sim: Sim, s: Thing, sk: Thing, events: SimEvent[], id: string, start?: string) {
  const L = tourLevel(sim, id)
  // A level is built in its world; worlds lists others that contain the same ground (the park is inside sf).
  if (L.world !== sim.park.name && !L.worlds?.includes(sim.park.name)) throw new Error(`level ${id} is in the ${L.world} world, not ${sim.park.name}`)
  const at = start ?? L.spot
  if (at !== L.spot && !L.starts?.includes(at)) throw new Error(`level ${id} starts at ${[L.spot, ...(L.starts ?? [])].join(' or ')}, not ${at}`)
  const spot = findSpot(sim, at)
  if (!spot) throw new Error(`level ${id}: no spot "${at}" in ${sim.park.name}`)
  placeAt(sk, spot)
  s.level = id; s.levelGoals = []; s.tape = false; s.away = false; s.grindRun = 0; delete s.levelMarks
  s.timeLeft = Math.round(sim.data.tour.seconds * sim.data.physics.tickHz)
  events.push({ t: 'levelStart', tick: sim.world.tick, level: id, seconds: sim.data.tour.seconds })
}

/** Leaving a level for another game: its fields go (so a world without a Tour run hashes as before). */
export function clearLevel(s: Thing) {
  delete s.level; delete s.levelGoals; delete s.tape; delete s.away; delete s.grindRun; delete s.levelMarks
}

/** Each tick of a level run (and its ending, while the last combo lands): letters, tape, goals, the area, the clock. */
export function stepLevel(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const T = sim.data.tour, L = tourLevel(sim, s.level!), tick = sim.world.tick, level = L.id
  const goals = s.levelGoals!
  const goal = (id: string, name: string) => { if (goals.includes(id)) return; goals.push(id); events.push({ t: 'levelGoal', tick, level, id, name }) }
  // Letters: pass through them (the run's letter radius), on the board or on foot: a vehicle takes none, nor the tape.
  const skating = sk.drive === undefined
  for (const l of L.letters) {
    if (!skating || s.letters.includes(l.letter) || dist(sk.pos, v3(...l.pos)) >= sim.data.run.letterRadius) continue
    s.letters += l.letter
    events.push({ t: 'letter', tick, letter: l.letter, have: L.letters.map((x) => (s.letters.includes(x.letter) ? x.letter : '_')).join('') })
  }
  if (s.letters.length === L.letters.length) goal('skate', T.names.skate)
  // The secret tape.
  if (skating && !s.tape && dist(sk.pos, v3(...L.tape.pos)) < T.tapeRadius) {
    s.tape = true
    events.push({ t: 'tapeFound', tick, level })
    goal('tape', T.names.tape)
  }
  // Score tiers and the level's own goals.
  if (sk.score >= L.tiers.pro) goal('pro', T.names.pro)
  if (sk.score >= L.tiers.sick) goal('sick', T.names.sick)
  if (events.some((e) => e.t === 'grindStart')) s.grindRun = 0
  if (sk.state === State.grind && sk.grind) s.grindRun = (s.grindRun ?? 0) + Math.abs(sk.grind.speed) / sim.data.physics.tickHz
  for (const g of L.goals) if (skating && g.kind === 'dash' && inBox(g.from, sk.pos.x, sk.pos.y)) (s.levelMarks ??= {})[g.id] = tick
  for (const g of L.goals) if (!goals.includes(g.id) && goalMet(sim, s, sk, g, events)) goal(g.id, g.name)
  // Far outside the area: a hint, never a fail.
  // (In one of its exclude boxes, a spot of another level inside its area, it is as far out as can be.)
  const off = L.exclude?.some((b) => outside(b, sk.pos.x, sk.pos.y) === 0) ? Infinity : Math.min(...[L.area, ...(L.areas ?? [])].map((b) => outside(b, sk.pos.x, sk.pos.y)))
  if (!s.away && off > T.wrongWay.away) { s.away = true; events.push({ t: 'levelWrongWay', tick, level }) }
  else if (s.away && off <= T.wrongWay.back) { s.away = false; events.push({ t: 'levelBack', tick, level }) }
  if (s.mode === 'level' && --s.timeLeft <= 0) s.mode = 'ending'
}

export function levelOverEvent(sim: Sim, s: Thing, sk: Thing): SimEvent {
  return { t: 'levelOver', tick: sim.world.tick, level: s.level!, score: sk.score, goals: [...s.levelGoals!], tape: !!s.tape }
}
