import type { Gap } from '../data.ts'
import { dist, v3 } from '../math.ts'
import { player2, session, skater, type Sim, type SimEvent } from '../sim.ts'
import { State, type Thing, type TwoPlayerMode } from '../thing.ts'
import { checkCityGoals, trackCarHop, trackComboStart } from './goals.ts'
import { clearRacers } from './npc.ts'
import { clearLocals, startSkate, stepSkate } from './skate.ts'
import { overEvent, settled, startBomb, startCombo, startCourier, stepBomb, stepCombo, stepCourier } from './modes.ts'
import { clearLevel, levelOverEvent, startLevel, stepLevel } from './tour.ts'
import { clearTwoPlayer, isTwoPlayer, startTwoPlayer, stepTwoPlayer, type Players } from './twoplayer.ts'
import { clearMuni, startMuni, stepMuni, stepTrams } from './muni.ts'
import { clearEscape, escapeSurvived, startEscape, stepChaser, stepEscape } from './escape.ts'
import { graffitiOver, startGraffiti, stepGraffiti } from './graffiti.ts'
import { abandonForGame, stepMission } from './missions.ts'

// The game layer: timed runs, S-K-A-T-E letters, named gaps, goals.
// It reads the skater's events each tick; it never changes skating physics.

const inBox = (b: [number, number, number, number], x: number, y: number) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]

export type GameMode = 'run' | 'free' | 'courier' | 'combo' | 'bomb' | 'skate' | 'level' | 'muni' | 'escape' | 'graffiti' | TwoPlayerMode

/**
 * Start a game (command `run start|free|courier|combo|bomb|skate|level`): score and session reset;
 * courier, bomb, skate and level put you at their start. route: the hill bomb route, the S.K.A.T.E.
 * local, the Tour level (game/tour.ts), or the Muni line (game/muni.ts; `run escape`: game/escape.ts).
 * The two-player games (trickattack2p, horse2p [word], graffiti2p: game/twoplayer.ts) need player 2
 * and reset both players.
 */
export function startRun(sim: Sim, mode: GameMode, events: SimEvent[], route?: string, start?: string) {
  const s = session(sim), sk = skater(sim), p2 = player2(sim)
  abandonForGame(sim, s, events)   // a mission on gives way to the game (game/missions.ts starts its own games with the mission set aside)
  if (isTwoPlayer(mode)) {
    if (!p2) throw new Error(`run ${mode}: player 2 first (player2 join [spot])`)
    return startTwoPlayer(sim, mode, { sk: [sk, p2.sk], s: [s, p2.s], ev: [[], []] }, events, route)
  }
  if (p2) { clearTwoPlayer(p2.s); p2.s.mode = 'free'; p2.s.game = 'free' }   // player 2 skates free while player 1 plays alone
  clearTwoPlayer(s)
  clearRacers(sim)   // leaving a race (or starting another) sends the locals home
  clearLocals(sim)
  clearMuni(sim, s)  // and the streetcar, and the robotaxi
  clearEscape(sim, s)
  if (mode === 'courier') startCourier(sim, s, sk)
  if (mode === 'bomb') startBomb(sim, s, sk, events, route)
  if (mode === 'skate') startSkate(sim, s, sk, events, route)
  if (mode === 'muni') startMuni(sim, s, sk, events, route)
  if (mode === 'escape') startEscape(sim, s, sk, events)
  if (mode === 'graffiti') startGraffiti(sim, s, events)
  if (mode === 'level') startLevel(sim, s, sk, events, route!, start)
  else clearLevel(s)
  s.mode = mode
  s.game = mode
  s.timeLeft = mode === 'run' ? Math.round(sim.data.run.durationSeconds * sim.data.physics.tickHz) : mode === 'courier' || mode === 'bomb' || mode === 'muni' ? 0 : s.timeLeft
  s.letters = ''; s.burritos = []; s.gapsHit = []; s.goalsDone = []; s.bestCombo = 0; delete s.carHops
  sk.score = 0; sk.combo = []; sk.special = 0
  if (mode === 'run') events.push({ t: 'runStart', tick: sim.world.tick, seconds: sim.data.run.durationSeconds })
  if (mode === 'combo') startCombo(sim, s, events)
}

/**
 * After the skaters stepped: gaps from their events, letters, goals, the clock, the modes. With player
 * 2 (game/twoplayer.ts) each player reads its own events (player 1 also the world's untagged ones) into
 * its own session, and what that adds is tagged with the player; the two-player game's own events go
 * after, untagged (they name the players themselves).
 */
export function stepSession(sim: Sim, events: SimEvent[]) {
  const s = session(sim), sk = skater(sim), p2 = player2(sim)
  if (!p2) {
    earn(sim, s, sk, events)
    stepGame(sim, s, sk, events)
    // City goals are always on: after the game's own step, so they see its events (deliveries, the bomb finish).
    checkCityGoals(sim, s, sk, events)
    trackComboStart(s, sk)
    stepMission(sim, s, sk, events)   // after the game's step (its over events) and the combo's start
    return
  }
  const one = events.filter((e) => e.player !== 2), two = events.filter((e) => e.player === 2)
  const n1 = one.length, n2 = two.length, game: SimEvent[] = []
  earn(sim, s, sk, one)
  earn(sim, p2.s, p2.sk, two)
  if (isTwoPlayer(s.game)) stepTwoPlayer(sim, { sk: [sk, p2.sk], s: [s, p2.s], ev: [one, two] } satisfies Players, game)
  else stepGame(sim, s, sk, one)
  checkCityGoals(sim, s, sk, one)
  checkCityGoals(sim, p2.s, p2.sk, two)
  trackComboStart(s, sk)
  trackComboStart(p2.s, p2.sk)
  stepMission(sim, s, sk, one)   // missions are player 1's
  for (const e of one.slice(n1)) events.push(tagged(e, 1))
  for (const e of two.slice(n2)) events.push(tagged(e, 2))
  events.push(...game)
}

/** An event with its player, unless it names one already (skateOver's letters). */
function tagged(e: SimEvent, n: 1 | 2): SimEvent {
  if (!('player' in e)) (e as { player?: 1 | 2 }).player = n
  return e
}

/** One player's own tick: gaps from its events, car hops, burritos. */
function earn(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const tick = sim.world.tick
  for (const e of [...events]) {
    if (e.t === 'air' || e.t === 'pop') { sk.takeoffXY = [sk.pos.x, sk.pos.y]; s.hopCar = s.onCar ? -2 : -1 }   // off a car's roof or edge: not a hop over it
    if (e.t === 'bail') s.hopCar = -1
    if (e.t === 'land' && s.hopCar >= 0 && !events.some((x) => x.t === 'carLand')) carHop(sim, s, sk, events)
    if (e.t === 'land') hitGaps(sim, s, sk, sim.data.gaps.gaps.filter((g) => g.kind === 'air' && airGap(g, sk, e.airTicks)), events)
    if (e.t === 'grindEnd' && e.reason !== 'balance' && e.reason !== 'blocked' && e.reason !== 'void') gapForElement(sim, s, sk, 'grind', events)
    if (e.t === 'lipEnd' && e.reason === 'drop in') gapForElement(sim, s, sk, 'lip', events)
    if (e.t === 'wallrideEnd' || e.t === 'wallplant') hitGaps(sim, s, sk, sim.data.gaps.gaps.filter((g) => g.kind === 'wall' && !!g.plant === (e.t === 'wallplant') && inBox(g.box, sk.pos.x, sk.pos.y)), events)
    if (e.t === 'comboLanded') s.bestCombo = Math.max(s.bestCombo, e.points)
    // A skitch that counted: a skitch gap for the kind of car (MUNI SKITCH behind a streetcar).
    if (e.t === 'skitchEnd' && e.points > 0) {
      const tram = !!sim.world.things.find((c) => c.id === e.car)?.car?.tram
      hitGaps(sim, s, sk, sim.data.gaps.gaps.filter((g) => g.kind === 'skitch' && !!g.tram === tram), events)
    }
  }
  // Burritos: in free skate and every game, anywhere in the park and the city (only in the worlds they are placed for;
  // on the board or on foot, not from a vehicle).
  const BR = sim.data.run.burritoRadius
  if (sim.data.run.burritoParks.includes(sim.park.name) && sk.drive === undefined) sim.data.run.burritos.forEach((b, i) => {
    if (s.burritos.includes(i) || dist(sk.pos, v3(...b.pos)) >= BR) return
    s.burritos.push(i)
    sk.score += sim.data.run.burritoPoints
    events.push({ t: 'burrito', tick, n: s.burritos.length, of: sim.data.run.burritos.length, points: sim.data.run.burritoPoints })
  })
  trackCarHop(sim, s, sk)
}

/**
 * Before the traffic and the skaters: the streetcars (the Muni Race's and the free-roam ones) and the
 * escape's robotaxi (they drive themselves; traffic.ts leaves them alone), so the skaters meet them
 * where they are this tick, as they meet the cars.
 */
export function stepGameCars(sim: Sim, events: SimEvent[]) {
  const s = session(sim)
  stepTrams(sim, s, events)
  if (s.game === 'escape') stepChaser(sim, s)
}

/** The game on now: run letters, goals and clock; courier, combo challenge, hill bomb; the end. */
function stepGame(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const tick = sim.world.tick
  if (s.mode === 'free' || s.mode === 'over') return
  if (s.game === 'run') {
    // Letters: pass through them (on the board or on foot: a vehicle passing through takes none).
    const R = sim.data.run.letterRadius
    for (const L of sim.data.run.letters) {
      if (s.letters.includes(L.letter) || sk.drive !== undefined) continue
      if (dist(sk.pos, v3(...L.pos)) < R) {
        s.letters += L.letter
        events.push({ t: 'letter', tick, letter: L.letter, have: order(sim, s.letters) })
      }
    }
    checkGoals(sim, s, sk, events)
    if (s.mode === 'run' && --s.timeLeft <= 0) s.mode = 'ending'
  }
  else if (s.game === 'level') stepLevel(sim, s, sk, events)
  else if (s.mode === 'courier') stepCourier(sim, s, sk, events)
  else if (s.mode === 'combo') stepCombo(s)
  else if (s.mode === 'bomb') stepBomb(sim, s, sk, events)
  else if (s.mode === 'skate') stepSkate(sim, s, sk, events)
  else if (s.mode === 'muni') stepMuni(sim, s, sk, events)
  else if (s.mode === 'escape') stepEscape(sim, s, sk, events)
  else if (s.game === 'graffiti') stepGraffiti(sim, s, sk, events)   // through the ending too: the last combo still tags
  // Time is up: the combo in progress may still land (THPS), then the game is over.
  if (s.mode === 'ending' && settled(sk)) {
    s.mode = 'over'
    if (s.game === 'run') events.push({ t: 'runOver', tick, score: sk.score, goals: [...s.goalsDone], bestCombo: s.bestCombo })
    else if (s.game === 'level') events.push(levelOverEvent(sim, s, sk))
    else if (s.game === 'escape') events.push(escapeSurvived(sim, s, sk))
    else if (s.game === 'graffiti') events.push(graffitiOver(sim, s))
    else { const e = overEvent(sim, s, sk); if (e) events.push(e) }
  }
}

const order = (sim: Sim, have: string) => sim.data.run.letters.map((l) => (have.includes(l.letter) ? l.letter : '_')).join('')

function airGap(g: Extract<Gap, { kind: 'air' }>, sk: Thing, airTicks: number) {
  if (!inBox(g.from, sk.takeoffXY[0], sk.takeoffXY[1])) return false
  if (g.to && !inBox(g.to, sk.pos.x, sk.pos.y)) return false
  if (g.toZ && (sk.pos.z < g.toZ[0] || sk.pos.z > g.toZ[1])) return false
  if (g.over && !g.over.some((poly) => passesOver(poly, sk.takeoffXY[0], sk.takeoffXY[1], sk.pos.x, sk.pos.y))) return false
  // Travelled at least minMeters in the air (a hop on the spot in the box is not a crest air).
  if (g.minMeters && Math.hypot(sk.pos.x - sk.takeoffXY[0], sk.pos.y - sk.takeoffXY[1]) < g.minMeters) return false
  return airTicks >= (g.minAirTicks ?? 0)
}

/** In plan, from (ax, ay) to (bx, by): both ends outside the polygon and the path crossing its edge (so over it, for a convex one). */
function passesOver(poly: [number, number][], ax: number, ay: number, bx: number, by: number) {
  if (inPoly(poly, ax, ay) || inPoly(poly, bx, by)) return false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (segmentsCross(ax, ay, bx, by, poly[j][0], poly[j][1], poly[i][0], poly[i][1])) return true
  return false
}
function inPoly(poly: [number, number][], x: number, y: number) {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j]
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const side = (px: number, py: number, qx: number, qy: number, rx: number, ry: number) => (qx - px) * (ry - py) - (qy - py) * (rx - px)
  const d1 = side(cx, cy, dx, dy, ax, ay), d2 = side(cx, cy, dx, dy, bx, by), d3 = side(ax, ay, bx, by, cx, cy), d4 = side(ax, ay, bx, by, dx, dy)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function gapForElement(sim: Sim, s: Thing, sk: Thing, kind: 'grind' | 'lip', events: SimEvent[]) {
  const line = kind === 'grind' ? lastLine(sim, sk) : sk.lip ? sim.park.grind[sk.lip.line] : lastLine(sim, sk)
  if (!line) return
  hitGaps(sim, s, sk, sim.data.gaps.gaps.filter((g) => {
    if (g.kind !== kind || !(g.element.endsWith('*') ? line.element.startsWith(g.element.slice(0, -1)) : line.element === g.element)) return false
    if (g.feature && line.feature !== g.feature) return false
    return !g.box || line.points.some((p) => inBox(g.box!, p.x, p.y))
  }), events)
}

/**
 * The gaps one move earned, less any that a more specific one among them replaces (gaps.json
 * replaces): Patricia's Green's benches pay PATRICIA'S BENCH, not that and BENCH GRIND as well.
 */
function hitGaps(sim: Sim, s: Thing, sk: Thing, gs: Gap[], events: SimEvent[]) {
  for (const g of gs) if (!gs.some((o) => o.replaces?.includes(g.id))) hitGap(sim, s, sk, g, events)
}

/** The line of the grind or lip that just ended (remembered on the skater). */
function lastLine(sim: Sim, sk: Thing) {
  return sk.lastLine >= 0 ? sim.park.grind[sk.lastLine] : undefined
}

/**
 * Landed off a car cleared in the air: the robotaxi gap for a robotaxi, else the car gap. The same car
 * pays again only after the gap's again seconds (hopping one parked car back and forth was a farm).
 */
function carHop(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  const car = sim.data.gaps.gaps.filter((g) => g.kind === 'car')
  const pick = (s.hopRobo ? car.find((g) => g.kind === 'car' && g.robo) : undefined) ?? car.find((g) => g.kind === 'car' && !g.robo)
  const id = String(s.hopCar), last = s.carHops?.[id], tick = sim.world.tick
  if (pick && pick.kind === 'car' && (last === undefined || tick - last >= pick.again * sim.data.physics.tickHz) && hitGap(sim, s, sk, pick, events)) (s.carHops ??= {})[id] = tick
  s.hopCar = -1
}

/**
 * A gap into the combo. Once per combo: a gap already in it neither pays nor
 * adds to the multiplier again (a seat wall carried on along the wall beside it paid it twice).
 * False when it did not pay.
 */
function hitGap(sim: Sim, s: Thing, sk: Thing, g: Gap, events: SimEvent[]): boolean {
  if (sk.combo.some((e) => e.id === `gap-${g.id}`)) return false
  sk.combo.push({ id: `gap-${g.id}`, name: g.name, points: g.points })
  // A gap alone (an air with no trick) still banks: the landing gave no grace to an empty combo.
  if (sk.state === State.ground && sk.landGrace === 0 && !sk.manual) sk.landGrace = sim.data.physics.combo.graceTicks
  if (!s.gapsHit.includes(g.id)) s.gapsHit.push(g.id)
  events.push({ t: 'gap', tick: sim.world.tick, id: g.id, gap: g.name, points: g.points })
  return true
}

function checkGoals(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  for (const g of sim.data.run.goals) {
    if (s.goalsDone.includes(g.id)) continue
    const done = g.kind === 'score' ? sk.score >= g.value
      : g.kind === 'letters' ? s.letters.length >= g.value
      : g.kind === 'gaps' ? s.gapsHit.length >= g.value
      : g.kind === 'burritos' ? s.burritos.length >= g.value
      : g.kind === 'speed' ? sk.state !== 'bail' && sk.drive === undefined && Math.hypot(sk.vel.x, sk.vel.y, sk.vel.z) * 3.6 >= g.value   // km/h, on the board or in the air (not in a vehicle)
      : s.bestCombo >= g.value
    if (done) { s.goalsDone.push(g.id); events.push({ t: 'goal', tick: sim.world.tick, goal: g.name }) }
  }
}
