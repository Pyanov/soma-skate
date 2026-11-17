import type { InputFrame } from './input.ts'
import { player2, type Sim, type SimEvent } from './sim.ts'
import { stepSkater } from './skater/skater.ts'
import { updateDanger } from './skater/signals.ts'
import { stepTraffic } from './game/traffic.ts'
import { meetCars } from './skater/cars.ts'
import { Kind, type Thing } from './thing.ts'
import { stepGameCars, stepSession } from './game/session.ts'
import { npcAware, stepNpc } from './game/npc.ts'
import { stepPeds } from './game/peds.ts'
import { buttonsFor, getInOrRide, stepVehicles } from './game/vehicles.ts'
import { stepActors } from './game/movers.ts'

/** One skater's tick: in or out of a vehicle (game/vehicles.ts), else its own physics, the cars it meets, the danger it is in. */
function skate(sim: Sim, t: Thing, input: InputFrame, events: SimEvent[]) {
  if (getInOrRide(sim, t, input.b, events)) return
  stepSkater(sim, t, input, events)
  meetCars(sim, t, events)
  updateDanger(sim, t, events)
}

/** Advance the world one tick. The only way time moves in the sim. */
export function step(sim: Sim, input: InputFrame): SimEvent[] {
  const events: SimEvent[] = []
  stepGameCars(sim, events)   // the Muni streetcar, the escape's robotaxi (game/muni.ts, escape.ts)
  stepTraffic(sim, events)
  stepVehicles(sim, buttonsFor(sim, input), events)   // the crew van and mission vehicles: their drivers' buttons (game/vehicles.ts)
  // The skaters: player 1 on input.b; player 2 (game/twoplayer.ts), when someone plays it, on input.b2
  // and its own random stream, its events tagged player 2 (and player 1's tagged 1) so the session and
  // the client can tell them apart.
  const two = player2(sim) !== null
  for (const t of sim.world.things) {
    if (!t.alive || t.kind !== Kind.skater) continue
    if (t.player !== 2) { const own: SimEvent[] = two ? [] : events; skate(sim, t, input, own); if (two) for (const e of own) { e.player = 1; events.push(e) }; continue }
    const own: SimEvent[] = [], keep = sim.world.rng
    sim.world.rng = sim.world.p2Rng!
    try { skate(sim, t, { b: input.b2 ?? 0 }, own) } finally { sim.world.p2Rng = sim.world.rng; sim.world.rng = keep }
    for (const e of own) { e.player = 2; events.push(e) }
  }
  // NPC skaters: after the player, on their own random stream, only their npc* events reach the world.
  // First what they make of the player this tick (their line kept for copying, a cheer for a big combo).
  npcAware(sim, events)
  for (const t of sim.world.things) if (t.alive && t.kind === Kind.npc && t.npc) stepNpc(sim, t, events)
  // Pedestrians: they walk, see the player coming, and meet the player where it now is.
  stepPeds(sim, events)
  // The story's characters started by command (game/movers.ts; a mission moves its own with its step), before the session reads the tick.
  stepActors(sim, events)
  stepSession(sim, events)
  sim.world.tick++
  return events
}
