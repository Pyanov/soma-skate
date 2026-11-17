import { applyCommand, parseCommands } from './commands.ts'
import type { GameData } from './data.ts'
import type { InputFrame } from './input.ts'
import type { Park } from './park/park.ts'
import { worldHash, type Sim, type SimEvent, type World } from './sim.ts'
import { loadSnapshot, saveSnapshot, type Snapshot } from './snapshot.ts'
import { step } from './step.ts'

// Replays: a start snapshot plus the command stream (input frames and dev
// commands), with a hash chain and sparse full states to locate divergences.
// soma-replay/2 adds player 2's buttons (input2, game/twoplayer.ts); a recording
// without them is still written as soma-replay/1, byte for byte as before.

export const HASH_EVERY = 30
export const STATE_EVERY = 120

export type Replay = {
  format: 'soma-replay/1' | 'soma-replay/2'
  start: Snapshot
  ticks: number
  input: [number, number][]                 // run-length: [count, buttons]
  input2?: [number, number][]               // soma-replay/2: player 2's buttons, run-length the same way, as many ticks
  commands: { tick: number; text: string }[] // applied before that tick's step
  hashes: [number, string][]                // [tick after step, world hash]
  states: [number, World][]                 // [tick after step, full world]
  note?: string
  meta?: Record<string, string>
}

/** One tick: dev commands first, then the input step. Everything that runs the game goes through here. */
export function advance(sim: Sim, input: InputFrame, commands: string[] = []): SimEvent[] {
  const events: SimEvent[] = []
  for (const text of commands) for (const c of parseCommands(text)) applyCommand(sim, c, events)
  events.push(...step(sim, input))
  return events
}

type Frame = { tick: number; b: number; b2?: number; cmds: string[] }

/** Records play. With maxTicks it keeps a rolling window (for F8 clips). */
export class Recorder {
  private snaps: Snapshot[] = []
  private frames: Frame[] = []
  private hashes: [number, string][] = []
  private states: [number, World][] = []
  private maxTicks: number
  private snapEvery: number
  constructor(maxTicks = Infinity, snapEvery = 120) {
    this.maxTicks = maxTicks
    this.snapEvery = snapEvery
  }

  tick(sim: Sim, input: InputFrame, cmds: string[] = []): SimEvent[] {
    const t = sim.world.tick
    if (this.snaps.length === 0 || t % this.snapEvery === 0) this.snaps.push(saveSnapshot(sim))
    const events = advance(sim, input, cmds)
    this.frames.push(input.b2 === undefined ? { tick: t, b: input.b, cmds } : { tick: t, b: input.b, b2: input.b2, cmds })
    const after = sim.world.tick
    if (after % HASH_EVERY === 0) this.hashes.push([after, worldHash(sim.world)])
    if (after % STATE_EVERY === 0) this.states.push([after, JSON.parse(JSON.stringify(sim.world))])
    if (Number.isFinite(this.maxTicks)) this.trim(after)
    return events
  }

  private trim(now: number) {
    const keepFrom = now - this.maxTicks - this.snapEvery
    while (this.snaps.length > 1 && this.snaps[1].world.tick <= keepFrom) this.snaps.shift()
    const first = this.snaps[0].world.tick
    while (this.frames.length && this.frames[0].tick < first) this.frames.shift()
    while (this.hashes.length && this.hashes[0][0] <= first) this.hashes.shift()
    while (this.states.length && this.states[0][0] <= first) this.states.shift()
  }

  /** Replay of the last `ticks` (or everything recorded), starting at a stored snapshot. */
  replay(ticks = Infinity, note?: string, meta?: Record<string, string>): Replay {
    if (this.snaps.length === 0) throw new Error('nothing recorded yet')
    const last = this.frames.length ? this.frames[this.frames.length - 1].tick + 1 : this.snaps[0].world.tick
    const wantFrom = last - ticks
    // Latest snapshot at or before the window start; the earliest if the window reaches past it.
    let start = this.snaps[0]
    for (const s of this.snaps) if (s.world.tick <= wantFrom) start = s
    const from = start.world.tick
    const frames = this.frames.filter((f) => f.tick >= from)
    const input = rle(frames.map((f) => f.b))
    const two = frames.some((f) => f.b2 !== undefined)
    return {
      format: two ? 'soma-replay/2' : 'soma-replay/1', start, ticks: frames.length, input,
      ...(two ? { input2: rle(frames.map((f) => f.b2 ?? 0)) } : {}),
      commands: frames.flatMap((f) => f.cmds.map((text) => ({ tick: f.tick, text }))),
      hashes: this.hashes.filter(([t]) => t > from), states: this.states.filter(([t]) => t > from),
      note, meta,
    }
  }
}

/** Buttons per tick as runs: [count, buttons]. */
function rle(bs: number[]): [number, number][] {
  const out: [number, number][] = []
  for (const b of bs) {
    const last = out[out.length - 1]
    if (last && last[1] === b) last[0]++
    else out.push([1, b])
  }
  return out
}

/** A replay's buttons for every tick: player 1's, and player 2's (soma-replay/2) or none. */
export function replayInputs(replay: Replay): { b: number[]; b2: number[] | null } {
  const flat = (runs: [number, number][]) => runs.flatMap(([n, b]) => Array<number>(n).fill(b))
  return { b: flat(replay.input), b2: replay.input2 ? flat(replay.input2) : null }
}

export type Divergence = { tick: number; expected: string; actual: string; fields: string[] }

/** Re-run a replay. Reports the first hash mismatch and, at the next stored state, which fields differ. */
export function runReplay(replay: Replay, park: Park, opts: { data?: GameData | 'snapshot'; onTick?: (sim: Sim, events: SimEvent[]) => void } = {}) {
  const sim = loadSnapshot(replay.start, park, opts.data ?? 'snapshot')
  const cmdsAt = new Map<number, string[]>()
  for (const c of replay.commands) cmdsAt.set(c.tick, [...(cmdsAt.get(c.tick) ?? []), c.text])
  const hashAt = new Map(replay.hashes)
  const stateAt = new Map(replay.states)
  let divergence: Divergence | null = null
  let checked = 0
  const events: SimEvent[] = []
  const b2 = replay.input2 ? replayInputs(replay).b2! : null
  let k = 0
  for (const [count, b] of replay.input) {
    for (let i = 0; i < count; i++, k++) {
      const ev = advance(sim, b2 ? { b, b2: b2[k] ?? 0 } : { b }, cmdsAt.get(sim.world.tick) ?? [])
      events.push(...ev)
      opts.onTick?.(sim, ev)
      const tick = sim.world.tick
      const expected = hashAt.get(tick)
      if (expected !== undefined) {
        checked++
        const actual = worldHash(sim.world)
        if (actual !== expected && !divergence) divergence = { tick, expected, actual, fields: [] }
      }
      const state = stateAt.get(tick)
      if (state && divergence && divergence.fields.length === 0) divergence.fields = diffFields(state, sim.world)
    }
  }
  return { sim, events, divergence, checked }
}

/** Leaf paths whose values differ, "path: expected -> actual". */
export function diffFields(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 12) return out
  if (typeof a === 'object' && a !== null && typeof b === 'object' && b !== null) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)])
    for (const k of keys) diffFields((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out)
  } else if (a !== b) out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
  return out
}
