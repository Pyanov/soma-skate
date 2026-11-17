import { Btn, has, type InputFrame } from '../input.ts'
import { abs, cos, DEG, dot, flatten, norm, scale, sqrt, v3, type Vec3 } from '../math.ts'
import { raycast, sphereContacts, type Contact } from '../park/park.ts'
import type { Sim, SimEvent } from '../sim.ts'
import { State, type Thing } from '../thing.ts'

// Spine transfers (later classic games): in the air off a transition with another ramp back to back behind its
// lip, the revert button carries you over the spine to land going down the far side. The far ramp
// is found by looking down along the way over the lip; the arc is set so it clears the spine top
// and comes down onto the far wall, the board turned to meet it. Spec: docs/mechanics/air-tricks.md.

const Z = v3(0, 0, 1)
const near: Contact[] = []

type Target = { pos: Vec3; n: Vec3; ridgeZ: number }

/**
 * The far ramp behind the lip, along d (horizontal, over the lip): the first surface beyond the
 * spine top that faces the far side and lies spine.landDrop below the top. Null when there is none
 * within spine.reach, or what is there rises above the top (a wall, a deck: not a spine).
 */
function farRamp(sim: Sim, t: Thing, d: Vec3, shift: Vec3): Target | null {
  const S = sim.data.physics.spine
  const from = t.pos.z + 0.6   // look down from just above the skater (overhead guards and decks are not the spine)
  let ridgeZ = -Infinity, pastRidge = false
  for (let k = 0; k <= S.reach + 1e-9; k += 0.1) {
    const o = v3(t.pos.x + shift.x + d.x * k, t.pos.y + shift.y + d.y * k, from)
    const hit = raycast(sim.park, o, v3(0, 0, -1), 8)
    if (!hit || sim.park.cls[hit.tri] === 0) continue
    const facesFar = dot(hit.normal, d) > S.faceMin && hit.normal.z < cos(S.minDeg * DEG)
    if (!pastRidge) {
      if (hit.point.z > ridgeZ) ridgeZ = hit.point.z
      if (facesFar && hit.point.z < ridgeZ - 0.05) pastRidge = true
      else continue
    }
    if (!facesFar) {
      if (hit.point.z > ridgeZ + 0.1) return null   // something higher beyond: not a spine
      continue
    }
    if (hit.point.z <= ridgeZ - S.landDrop) return { pos: hit.point, n: hit.normal, ridgeZ }
  }
  return null
}

/**
 * In the air: a revert press is remembered for spine.bufferTicks, and each tick of that the transfer
 * is tried, so pressing on the way up works (it starts once the arc clears the spine top).
 */
export function stepSpine(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]) {
  const S = sim.data.physics.spine
  const pressed = has(input, Btn.revert) && (t.prevB & Btn.revert) === 0
  if (t.state === State.ground) {
    // Pressed on the way up the wall, just before the lip: remembered into the air.
    if (pressed && t.up.z < cos(S.takeoffDeg * DEG) && dot(t.vel, Z) > 0.5) t.spineWant = S.bufferTicks
    else if (t.spineWant > 0) t.spineWant--
    return
  }
  if (t.state !== State.air || t.spine) { t.spineWant = 0; return }
  if (pressed) t.spineWant = S.bufferTicks
  if (t.spineWant <= 0) return
  t.spineWant--
  if (trySpine(sim, t, events)) t.spineWant = 0
}

/** Carry the skater over a spine if there is one and the arc from here clears it. */
function trySpine(sim: Sim, t: Thing, events: SimEvent[]): boolean {
  if (t.trick) return false
  const P = sim.data.physics, S = P.spine, g = P.gravity, r = P.skater.radius
  if (t.takeoffN.z > cos(S.takeoffDeg * DEG)) return false   // only off a transition
  const dl = Math.hypot(t.takeoffN.x, t.takeoffN.y)
  if (dl < 1e-6) return false
  const d = v3(-t.takeoffN.x / dl, -t.takeoffN.y / dl, 0)   // over the lip
  // Velocity over the spine: the part along the lip stays, the part across it reaches the far wall.
  // The far wall is looked for where the skater will be along the lip by then (two passes).
  const c = v3(-d.y, d.x, 0)
  const along = dot(t.vel, c)
  let far: Target | null = null, q = v3(), T = 0
  for (let pass = 0; pass < 2; pass++) {
    far = farRamp(sim, t, d, scale(c, along * T))
    if (!far) return false
    q = v3(far.pos.x + far.n.x * r, far.pos.y + far.n.y * r, far.pos.z + far.n.z * r)
    const disc = t.vel.z * t.vel.z + 2 * g * (t.pos.z - q.z)
    if (disc < 0) return false
    T = (t.vel.z + sqrt(disc)) / g
  }
  if (!far || T < 0.15) return false
  const across = dot(v3(q.x - t.pos.x, q.y - t.pos.y, 0), d) / T
  if (across <= 0 || across > S.maxSpeed) return false
  const vel = v3(c.x * along + d.x * across, c.y * along + d.y * across, t.vel.z)
  // The arc must clear the spine top and everything else (a guard rail, a column): a sphere of
  // spine.clearance x the radius swept along it, finely enough that no step jumps a corner.
  const steps = Math.min(240, Math.ceil((T * (Math.hypot(vel.x, vel.y) + abs(vel.z) + g * T)) / (0.5 * r)))
  for (let i = 1; i < steps; i++) {
    const s = (T * i) / steps
    const p = v3(t.pos.x + vel.x * s, t.pos.y + vel.y * s, t.pos.z + vel.z * s - 0.5 * g * s * s)
    if (Math.hypot(p.x - q.x, p.y - q.y, p.z - q.z) < r + 0.25) break   // arriving on the far wall
    if (sphereContacts(sim.park, p, r * S.clearance, near).length > 0) return false
  }
  // Over: the board comes round to meet the far wall, nose down it (or tail, riding fakie).
  const lead = dot(t.fwd, t.vel) >= 0 ? 1 : -1
  const vLand = v3(vel.x, vel.y, vel.z - g * T)
  t.vel = vel
  t.vertAir = true   // the board keeps the far wall as its up for the rest of the air
  t.up = norm(far.n, Z)
  t.fwd = scale(norm(flatten(vLand, t.up), t.fwd), lead)
  t.spine = true
  const def = sim.data.tricks.spine
  t.combo.push({ id: def.id, name: def.name, points: def.points })
  events.push({ t: 'spineTransfer', tick: sim.world.tick, gap: round(dot(v3(q.x - t.pos.x, q.y - t.pos.y, 0), d)), points: def.points })
  events.push({ t: 'trickStart', tick: sim.world.tick, trick: def.name }, { t: 'trickEnd', tick: sim.world.tick, trick: def.name, points: def.points })
  return true
}

const round = (x: number) => Math.round(x * 1000) / 1000
