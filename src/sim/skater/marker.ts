import { dot, headingDir, headingOf, len, min, max, scale, v3 } from '../math.ts'
import { placeAt, session, skater, type Sim, type SimEvent } from '../sim.ts'
import { State } from '../thing.ts'

// The session marker (as in EA's Skate): drop a marker where you stand, go back to it at once to try a
// spot again and again. Commands `marker set | go | clear`. Spec: docs/mechanics/marker.md.

export type MarkerOp = 'set' | 'go' | 'clear'

/** Why the marker cannot be used now, or null: only in free skate, not in a mission or a vehicle. */
function markerOff(sim: Sim): string | null {
  const s = session(sim), sk = skater(sim)
  if (s.mode !== 'free' && s.mode !== 'over') return 'not during a game'
  if (s.mission) return 'not during a mission'
  if (sk.drive !== undefined) return 'not while driving'
  return null
}

/** Applies a marker command for player 1; returns a one-line result (the event says whether it worked). */
export function markerCommand(sim: Sim, op: MarkerOp, events?: SimEvent[]): string {
  const sk = skater(sim), tick = sim.world.tick, M = sim.data.physics.marker
  const done = (text: string) => { events?.push({ t: 'marker', tick, op, ok: true }); return text }
  const no = (why: string) => { events?.push({ t: 'marker', tick, op, ok: false, why }); return `marker ${op}: ${why}` }
  if (op === 'clear') { delete sk.marker; return done('marker cleared') }
  const off = markerOff(sim)
  if (off) return no(off)
  if (op === 'set') {
    if (sk.state !== State.ground && sk.state !== State.walk) return no('on the ground only')
    const onBoard = sk.state === State.ground
    const h = v3(sk.vel.x, sk.vel.y, 0)
    // Fakie: rolling the board's tail first. The heading is the board's (on foot: the way the rider faces).
    const fakie = onBoard && len(h) > 0.3 && dot(h, sk.fwd) < 0
    sk.marker = { x: sk.pos.x, y: sk.pos.y, z: sk.pos.z, heading: headingOf(sk.fwd), speed: onBoard ? len(h) : 0, fakie }
    return done(`marker set at ${sk.pos.x.toFixed(2)} ${sk.pos.y.toFixed(2)} ${sk.pos.z.toFixed(2)}`)
  }
  const m = sk.marker
  if (!m) return no('no marker set')
  // Back on the marker at once, on the board, rolling the way it rolled (fakie stays fakie) at the speed
  // it had, at least marker.minSpeed. The combo in progress is dropped without a bail (no points, the
  // special meter kept), so going back mid-air never carries a combo into the next try.
  placeAt(sk, { id: 'marker', pos: v3(m.x, m.y, m.z), heading: m.heading })
  const speed = min(max(m.speed, M.minSpeed), sim.data.physics.limits.maxSpeed)
  sk.vel = scale(headingDir(m.heading), m.fakie ? -speed : speed)
  sk.combo = []; sk.trick = null; sk.landGrace = 0; sk.spin = 0; sk.spinVel = 0
  sk.hang = false; sk.climb = 0; sk.crouch = false; sk.charge = 0; sk.powerslide = 0; sk.wobble = 0; sk.stumble = 0; sk.steer = 0; sk.lean = 0; sk.slip = 0
  delete sk.revertWant; delete sk.getUp; delete sk.lipped; delete sk.wallrides; delete sk.offZ; delete sk.stance
  return done(`back at the marker, rolling ${speed.toFixed(1)} m/s${m.fakie ? ' fakie' : ''}`)
}
