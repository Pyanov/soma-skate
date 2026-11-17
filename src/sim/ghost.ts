import type { GameData } from './data.ts'
import type { Park } from './park/park.ts'
import { runReplay, type Replay } from './replay.ts'
import { skater } from './sim.ts'
import type { Thing } from './thing.ts'

// Ghosts (docs/mechanics/modes.md): a stored replay of your best run, re-run in its own sim, gives
// the skater for every tick of it, plus where it crossed each race gate. The ghost is never part of
// the player's world: it cannot change the player's hash or anything else.

/** A split: the ghost crossing a gate (hill bomb) or handing over an order (courier). */
export type GhostSplit = { name: string; frame: number; time: number }

export type Ghost = {
  frames: Thing[]        // the skater after each tick of the replay (frames[k]: k + 1 ticks in)
  start: number          // frame of the race start (bombStart / the first courierPickup), 0 if none
  splits: GhostSplit[]   // in order, time = seconds since the race start
  finish: number | null  // seconds to the finish (bombFinish total), null if it never finished
  route: string | null   // the hill bomb route raced (bombReady), null for courier
}

/**
 * Re-run a replay and keep the skater of every tick. Deterministic: the same replay always gives the
 * same frames (Node and Chromium alike). The HUD lines the ghost up by race time: at live race time
 * t show frames[start + t * tickHz], and at each live gate compare its time with splits[n].time.
 */
export function ghostFrames(replay: Replay, park: Park, data?: GameData): Ghost {
  const frames: Thing[] = []
  const splits: GhostSplit[] = []
  let start = -1, finish: number | null = null, startTick = 0, hz = 120, route: string | null = null
  runReplay(replay, park, {
    data: data ?? 'snapshot',
    onTick: (sim, events) => {
      hz = sim.data.physics.tickHz
      frames.push(JSON.parse(JSON.stringify(skater(sim))) as Thing)
      const k = frames.length - 1
      for (const e of events) {
        if (e.t === 'bombReady') route = e.route
        if ((e.t === 'bombStart' || (e.t === 'courierPickup' && e.leg === 0 && start < 0)) && start < 0) { start = k; startTick = sim.world.tick }
        const time = Math.round(((sim.world.tick - startTick) / hz) * 100) / 100
        if (e.t === 'bombCheckpoint') splits.push({ name: e.gate, frame: k, time: e.time })
        if (e.t === 'bombFinish') { splits.push({ name: 'Finish', frame: k, time: e.time }); finish = e.total }
        if (e.t === 'courierDeliver' && start >= 0) splits.push({ name: e.place, frame: k, time })
      }
    },
  })
  return { frames, start: Math.max(0, start), splits, finish, route }
}

/** Seconds behind (+) or ahead (-) of the ghost at split n, for a live time at the same gate. */
export const ghostDelta = (g: Ghost, n: number, liveTime: number): number | null =>
  n < g.splits.length ? Math.round((liveTime - g.splits[n].time) * 100) / 100 : null
