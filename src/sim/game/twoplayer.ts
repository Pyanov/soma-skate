import { copy, headingOf, v3, type Vec3 } from '../math.ts'
import { raycast, sphereContacts, type Contact } from '../park/park.ts'
import { seedRng } from '../rng.ts'
import { findSpot, placeAt, player2, spawn, type Sim, type SimEvent } from '../sim.ts'
import { Kind, type SkateTry, type Thing, type TwoPlayerMode } from '../thing.ts'
import { settled } from './modes.ts'
import { clearRacers } from './npc.ts'
import { clearLocals, freshTry, place, trackTry } from './skate.ts'
import { clearLevel } from './tour.ts'

// Local two-player (THPS 2 split screen; docs/mechanics/modes.md, data run.twoPlayer). Player 2 is a
// second skater Thing (player: 2) with its own session Thing, stepped on its own buttons (InputFrame.b2)
// by the same skater code. The players never touch each other; each scores its own gaps, burritos and
// city goals (game/session.ts). The game itself lives on player 1's session: Trick Attack (both skate,
// the higher score wins), HORSE (S.K.A.T.E. between the players: game/skate.ts's tries and rules) and
// Graffiti (tricks on an obstacle tag it; a bigger combo steals it). Without player 2 nothing here
// runs and no field here is set, so one-player worlds hash as they did.

const touching: Contact[] = []
const MODES: readonly string[] = ['trickattack2p', 'horse2p', 'graffiti2p'] satisfies TwoPlayerMode[]
export const isTwoPlayer = (m: string): m is TwoPlayerMode => MODES.includes(m)
const other = (n: 1 | 2): 1 | 2 => (n === 1 ? 2 : 1)

/** Both players, [player 1, player 2]: skaters, sessions, and this tick's events (player 1's also the world's untagged ones). */
export type Players = { sk: [Thing, Thing]; s: [Thing, Thing]; ev: [SimEvent[], SimEvent[]] }

/**
 * `player2 join [spot | x y z [heading]]`: a second skater with its own session, at the spot (or the
 * place, like teleport), or beside player 1 (join.side metres to its left, facing the same way, on the
 * ground there; on player 1 when that is not clear ground). Returns the skater.
 */
export function joinPlayer2(sim: Sim, p1: Thing, events: SimEvent[], spot?: string | { id: string; pos: Vec3; heading: number }): Thing {
  if (player2(sim)) throw new Error('player 2 is already in (player2 leave first)')
  const at = typeof spot === 'string' ? findSpot(sim, spot) : spot
  if (spot && !at) throw new Error(`no spot "${spot}"`)
  sim.world.p2Rng = seedRng((sim.world.seed * 7919 + 2) >>> 0)
  const s = spawn(sim, Kind.session)
  s.player = 2
  const sk = spawn(sim, Kind.skater)
  sk.player = 2
  if (at) placeAt(sk, at)
  else {
    const side = sim.data.run.twoPlayer.join.side, r = sim.data.physics.skater.radius, f = p1.fwd
    const fl = Math.hypot(f.x, f.y) || 1, lx = -f.y / fl, ly = f.x / fl
    const from = v3(p1.pos.x + lx * side, p1.pos.y + ly * side, p1.pos.z + 1)
    const g = raycast(sim.park, from, v3(0, 0, -1), 4)
    const pos = g ? v3(from.x, from.y, g.point.z + r + 0.02) : copy(p1.pos)
    const clear = g && sphereContacts(sim.park, pos, r, touching).length === 0
    placeAt(sk, { id: 'player2', pos: clear ? pos : copy(p1.pos), heading: headingOf(f) })
  }
  events.push({ t: 'player2', tick: sim.world.tick, joined: true })
  return sk
}

/** `player2 leave`: player 2's skater and session go; a two-player game on stops (player 1 skates free). */
export function leavePlayer2(sim: Sim, s1: Thing, events: SimEvent[]) {
  if (!player2(sim)) throw new Error('no player 2')
  sim.world.things = sim.world.things.filter((t) => t.player !== 2)
  delete sim.world.p2Rng
  if (isTwoPlayer(s1.game)) { s1.mode = 'free'; s1.game = 'free'; clearTwoPlayer(s1) }
  events.push({ t: 'player2', tick: sim.world.tick, joined: false })
}

/** A one-player game starting: no two-player fields left on the session (game/session.ts startRun). */
export function clearTwoPlayer(s: Thing) {
  delete s.horseWord; delete s.horseTurn; delete s.horseRole; delete s.horseTrick; delete s.horseTrickName
  delete s.horsePause; delete s.horseUsed; delete s.horseTry; delete s.horseLetters; delete s.tags; delete s.tagging; delete s.owned
}

/**
 * `run trickattack2p | horse2p [word] | graffiti2p`: both players' scores and sessions reset, the
 * game goes on player 1's session (mirrored on player 2's). HORSE puts them at the S.K.A.T.E. spot.
 */
export function startTwoPlayer(sim: Sim, mode: TwoPlayerMode, p: Players, events: SimEvent[], word?: string) {
  const P = sim.data.run.twoPlayer, hz = sim.data.physics.tickHz, tick = sim.world.tick
  if (mode === 'horse2p') {
    const S = sim.data.run.skate
    if (!S.parks.includes(sim.park.name)) throw new Error(`HORSE is played at the S.K.A.T.E. spot in the park (${S.parks.join(', ')}), not ${sim.park.name}`)
    if (word && !P.horse.words.includes(word.toUpperCase())) throw new Error(`HORSE words: ${P.horse.words.join(', ')}`)
  }
  clearRacers(sim)
  clearLocals(sim)
  const [s1] = p.s
  clearLevel(s1)
  for (const s of p.s) {
    clearTwoPlayer(s)
    s.letters = ''; s.burritos = []; s.gapsHit = []; s.goalsDone = []; s.bestCombo = 0; delete s.carHops
  }
  for (const sk of p.sk) { sk.score = 0; sk.combo = []; sk.special = 0 }
  s1.mode = mode; s1.game = mode
  if (mode === 'trickattack2p') {
    s1.timeLeft = Math.round(P.trickAttack.seconds * hz)
    events.push({ t: 'trickAttackStart', tick, seconds: P.trickAttack.seconds })
  } else if (mode === 'graffiti2p') {
    s1.timeLeft = Math.round(P.graffiti.seconds * hz)
    s1.tags = {}
    for (const s of p.s) { s.tagging = []; s.owned = 0 }
    events.push({ t: 'graffitiStart', tick, seconds: P.graffiti.seconds })
  } else {
    s1.horseWord = word ? word.toUpperCase() : P.horse.word
    s1.horseUsed = []
    for (const s of p.s) s.horseLetters = ''
    events.push({ t: 'horseStart', tick, word: s1.horseWord })
    beginTurn(sim, p, 1, 'set', '', '', events)
  }
  mirror(p)
}

/** player 2's session shows the game too (the client reads either). */
function mirror(p: Players) {
  const [s1, s2] = p.s
  s2.mode = s1.mode; s2.game = s1.game; s2.timeLeft = s1.timeLeft
}

/** One tick of the two-player game on player 1's session: the clock, HORSE's turns, Graffiti's tags; the end. */
export function stepTwoPlayer(sim: Sim, p: Players, events: SimEvent[]) {
  const s = p.s[0], tick = sim.world.tick
  if (s.mode === 'free' || s.mode === 'over') return
  if (s.game === 'horse2p') stepHorse(sim, p, events)
  else {
    if (s.game === 'graffiti2p') { tag(sim, p, 1, events); tag(sim, p, 2, events) }
    if (s.mode !== 'ending' && --s.timeLeft <= 0) s.mode = 'ending'
    // Time is up: the combos in progress may still land (THPS), then the game is over.
    if (s.mode === 'ending' && settled(p.sk[0]) && settled(p.sk[1])) {
      s.mode = 'over'
      if (s.game === 'trickattack2p') {
        const scores: [number, number] = [p.sk[0].score, p.sk[1].score]
        events.push({ t: 'trickAttackOver', tick, scores, winner: winner(scores) })
      } else {
        const counts: [number, number] = [p.s[0].owned ?? 0, p.s[1].owned ?? 0]
        events.push({ t: 'graffitiOver', tick, counts, winner: winner(counts) })
      }
    }
  }
  mirror(p)
}

const winner = (v: [number, number]): 0 | 1 | 2 => (v[0] > v[1] ? 1 : v[1] > v[0] ? 2 : 0)

// ---- Graffiti ----

/**
 * One player's tick: the grind line it is on (not a car's) or lip tricking, and the gaps it made,
 * go into its open combo's list; when the combo banks each is tagged for it if nobody owns it or the
 * other player tagged it with a smaller combo (its own, from a smaller one, just takes the bigger
 * number); a lost combo tags nothing.
 */
function tag(sim: Sim, p: Players, n: 1 | 2, events: SimEvent[]) {
  if (tagCombo(sim, p.sk[n - 1], p.s[n - 1], n, p.s[0].tags!, p.ev[n - 1], events, false))
    for (const k of [1, 2] as const) p.s[k - 1].owned = Object.values(p.s[0].tags!).filter((t) => t.player === k).length
}

/**
 * One player's tick of tagging (two-player Graffiti, and solo Graffiti: game/graffiti.ts): its open
 * combo's obstacles from its state and its events `ev`; when the combo banks, each goes to it if
 * nobody holds it or the holder's combo there was smaller. Its own tag, from a smaller combo, takes the
 * bigger number: silently in two-player, as a tagged event (from: itself) when `best` is set (solo:
 * a re-tag counts only when it beats your own score there). True when an obstacle changed hands.
 */
export function tagCombo(sim: Sim, sk: Thing, s: Thing, n: 1 | 2, tags: Record<string, { player: 1 | 2; points: number }>, ev: SimEvent[], events: SimEvent[], best: boolean): boolean {
  const tick = sim.world.tick
  const list = (s.tagging ??= [])
  const add = (id: string) => { if (!list.includes(id)) list.push(id) }
  if (sk.grind && sk.grind.car < 0) add(`line:${sk.grind.line}`)
  if (sk.lip) add(`line:${sk.lip.line}`)
  let changed = false
  for (const e of [...ev]) {
    if (e.t === 'gap') add(`gap:${e.id}`)
    else if (e.t === 'comboLost') list.length = 0
    else if (e.t === 'comboLanded') {
      for (const id of list) {
        const had = tags[id]
        if (had && had.player === n) {
          if (best && e.points > had.points) events.push({ t: 'tagged', tick, player: n, obstacle: id, points: e.points, from: n })
          had.points = Math.max(had.points, e.points)
          continue
        }
        if (had && had.points >= e.points) continue
        tags[id] = { player: n, points: e.points }
        changed = true
        events.push({ t: 'tagged', tick, player: n, obstacle: id, points: e.points, from: had ? had.player : 0 })
      }
      list.length = 0
    }
  }
  // Nothing open (a command dropped the combo, say): nothing to tag.
  if (sk.combo.length === 0 && !sk.grind && !sk.lip) list.length = 0
  return changed
}

// ---- HORSE: S.K.A.T.E. between the players (game/skate.ts) ----

/** A turn: whoever is up goes to the spot's start, the other to its watch spot; the clock waits pauseSeconds. */
function beginTurn(sim: Sim, p: Players, who: 1 | 2, role: 'set' | 'match', trick: string, name: string, events: SimEvent[]) {
  const H = sim.data.run.twoPlayer.horse, S = sim.data.run.skate, hz = sim.data.physics.tickHz, s = p.s[0]
  s.horseTurn = who; s.horseRole = role; s.horseTrick = trick; s.horseTrickName = name
  const seconds = role === 'set' ? H.setSeconds : H.matchSeconds
  s.timeLeft = Math.round(seconds * hz)
  s.horsePause = Math.max(1, Math.round(H.pauseSeconds * hz))
  const up = p.sk[who - 1], watch = p.sk[other(who) - 1]
  place(sim, up, S.spot.start, S.spot.heading, 'horse_start')
  place(sim, watch, other(who) === 1 ? S.spot.playerWatch : S.spot.localWatch, S.spot.watchHeading, 'horse_watch')
  s.horseTry = freshTry(up)
  events.push({ t: 'horseTurn', tick: sim.world.tick, who, role, trick, name, seconds })
}

/** The pause, the clock, the try (watched from the turn's start, like S.K.A.T.E.), the turn's outcome. */
function stepHorse(sim: Sim, p: Players, events: SimEvent[]) {
  const s = p.s[0], who = s.horseTurn!, tr = s.horseTry!
  const pausing = (s.horsePause ?? 0) > 0
  if (pausing) s.horsePause! -= 1
  trackTry(sim, p.sk[who - 1], p.ev[who - 1], tr)
  if (!pausing && s.timeLeft > 0) s.timeLeft--
  if (tr.phase !== 'done') {
    if (pausing || s.timeLeft > 0 || tr.phase !== 'ready') return   // a try under way may finish after the clock
    tr.phase = 'done'; tr.ok = false; tr.reason = 'time'
  }
  endTurn(sim, p, tr, events)
}

/** S.K.A.T.E.'s rules: a set stands if landed clean and new; a missed match is a letter; the setter changes every round. */
function endTurn(sim: Sim, p: Players, tr: SkateTry, events: SimEvent[]) {
  const s = p.s[0], tick = sim.world.tick, by = s.horseTurn!, word = s.horseWord!
  if (s.horseRole === 'set') {
    const again = tr.ok && (s.horseUsed ?? []).includes(tr.trick)
    if (tr.ok && !again) {
      s.horseUsed = [...(s.horseUsed ?? []), tr.trick]
      events.push({ t: 'horseSet', tick, by, trick: tr.trick, name: tr.name, at: tr.at })
      return beginTurn(sim, p, other(by), 'match', tr.trick, tr.name, events)
    }
    events.push({ t: 'horseSetMiss', tick, by, reason: again ? 'already set' : tr.reason, got: tr.trick, at: tr.at })
    return beginTurn(sim, p, other(by), 'set', '', '', events)
  }
  const ok = tr.ok && tr.trick === s.horseTrick
  const reason = ok ? '' : tr.ok ? 'different trick' : tr.reason
  events.push({ t: 'horseMatch', tick, by, ok, trick: s.horseTrick ?? '', name: s.horseTrickName ?? '', got: tr.trick, reason, at: tr.at })
  if (!ok) {
    const mine = p.s[by - 1], had = mine.horseLetters ?? ''
    mine.horseLetters = had + word[had.length]
    events.push({ t: 'horseLetter', tick, who: by, letters: mine.horseLetters })
    if (mine.horseLetters.length >= word.length) {
      s.mode = 'over'
      events.push({ t: 'horseOver', tick, winner: other(by), letters: [p.s[0].horseLetters ?? '', p.s[1].horseLetters ?? ''] })
      return
    }
  }
  beginTurn(sim, p, by, 'set', '', '', events)   // the matcher sets next
}
