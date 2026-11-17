import { abs, angleBetween, clamp, DEG, dot, flatten, len, max, rotateAround, sqrt, v3 } from '../math.ts'
import { raycast } from '../park/park.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { State, type Thing } from '../thing.ts'
import { trickDef } from '../tricks/tricks.ts'

// Read-only signals for the view (faces, celebrations, sound): a forecast of a bail a few ticks
// ahead. Computed from the state after the tick; it never changes the physics.
// Spec: docs/mechanics/board.md (signals).

/** Ticks of air left before the running trick finishes (if it were let go now). */
function trickTicksLeft(sim: Sim, t: Thing): number {
  const r = t.trick
  if (!r) return 0
  const def = trickDef(sim, r.id, r.kind)
  if (!def) return 0
  if (r.kind === 'flip') return max(0, (def as { ticks: number }).ticks - r.tick)
  const g = def as { enterTicks: number; exitTicks: number }
  return r.phase === 'enter' ? g.enterTicks - r.tick + g.exitTicks : r.phase === 'exit' ? g.exitTicks - r.tick : g.exitTicks
}

/** In the air: would the touchdown below bail, and how soon? */
function airDanger(sim: Sim, t: Thing): { level: number; why: string } {
  const P = sim.data.physics, L = P.land, g = P.gravity, r = P.skater.radius
  const hit = raycast(sim.park, t.pos, v3(0, 0, -1), 40)
  if (!hit) return { level: 0, why: '' }
  const h = max(0, t.pos.z - r - hit.point.z)
  const fall = (t.vel.z + sqrt(t.vel.z * t.vel.z + 2 * g * h)) / g   // seconds to the surface
  const ticks = fall * P.tickHz
  const n = hit.normal
  const vAt = v3(t.vel.x, t.vel.y, t.vel.z - g * fall)
  let why = ''
  if (t.trick && trickTicksLeft(sim, t) > ticks) why = 'mid-trick'
  else if (-dot(vAt, n) > L.hardSpeed) why = 'too hard'
  else if (angleBetween(t.up, n) / DEG > L.maxUpDeg) why = 'board off the surface'
  else {
    const f = flatten(rotateAround(t.fwd, t.up, t.spinVel * fall), n), vt = flatten(vAt, n)
    if (len(vt) >= 0.6 && len(f) > 1e-3) {
      const a = angleBetween(f, vt) / DEG
      if (a > L.toleranceDeg && a < 180 - L.toleranceDeg) why = 'sideways'
    }
  }
  return { level: why ? clamp(1 - (ticks - 6) / 30, 0, 1) : 0, why }
}

/** Updates t.danger (0..1, 1 = a bail is about to happen) and emits `danger` when it rises past 0.5. */
export function updateDanger(sim: Sim, t: Thing, events: SimEvent[]) {
  let level = 0, why = ''
  // Balance: past 0.7 it is close anyway; heading out, the ticks left to the edge at this rate.
  const balance = (b: number, bv: number, what: string) => {
    const out = b * bv > 0 && abs(b) > 0.3
    const ticks = out ? ((1 - abs(b)) / max(abs(bv), 1e-6)) * sim.data.physics.tickHz : Infinity
    const l = max(clamp((abs(b) - 0.7) / 0.3, 0, 1), out ? clamp(1 - (ticks - 4) / 30, 0, 1) : 0)
    if (l > level) { level = l; why = what }
  }
  if (t.state === State.air) ({ level, why } = airDanger(sim, t))
  else if (t.state === State.grind && t.grind) balance(t.grind.balance, t.grind.balanceVel, 'grind balance')
  else if (t.state === State.lip && t.lip) balance(t.lip.balance, t.lip.balanceVel, 'lip balance')
  else if (t.state === State.ground) {
    if (t.manual) balance(t.manual.balance, t.manual.balanceVel, 'manual balance')
    const w = clamp((t.wobble - 0.4) / 0.6, 0, 1)
    if (w > level) { level = w; why = 'speed wobbles' }
  }
  if (level >= 0.5 && t.danger < 0.5) events.push({ t: 'danger', tick: sim.world.tick, why })
  t.danger = level
}
