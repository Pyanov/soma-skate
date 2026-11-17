import type { Sim, SimEvent } from '../sim.ts'
import type { Thing } from '../thing.ts'
import { tagCombo } from './twoplayer.ts'

// Solo Graffiti (run graffiti; data run.graffiti, docs/mechanics/modes.md): the classic games' tag mode for one
// player. The same tags and rules as two-player Graffiti (game/twoplayer.ts): each grind line ground
// (or lip tricked) and each gap in a combo is tagged when the combo banks. Tag as many obstacles as you
// can before the clock runs out; a re-tag counts (a tagged event, from: 1) only when it beats your own
// best there. The state is the same: session.tags (obstacle -> {player: 1, points}), tagging, owned.

/** `run graffiti`: the clock, an empty tag map. */
export function startGraffiti(sim: Sim, s: Thing, events: SimEvent[]) {
  const G = sim.data.run.graffiti
  s.timeLeft = Math.round(G.seconds * sim.data.physics.tickHz)
  s.tags = {}
  s.tagging = []
  s.owned = 0
  events.push({ t: 'graffitiStart', tick: sim.world.tick, seconds: G.seconds })
}

/** Each tick, and through the ending while the last combo lands: tags from your combos, the clock. */
export function stepGraffiti(sim: Sim, s: Thing, sk: Thing, events: SimEvent[]) {
  if (tagCombo(sim, sk, s, 1, s.tags!, events, events, true)) s.owned = Object.keys(s.tags!).length
  if (s.mode === 'graffiti' && --s.timeLeft <= 0) s.mode = 'ending'
}

/** The end: how many obstacles you hold (counts has one entry; no winner). */
export const graffitiOver = (sim: Sim, s: Thing): SimEvent => ({ t: 'graffitiOver', tick: sim.world.tick, counts: [s.owned ?? 0] })
