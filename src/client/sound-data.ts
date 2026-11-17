import { z } from 'zod'

// Schema for data/sound.json (client only). Kept beside the sound code so the sim's data
// schema stays about the sim.

const pos = z.number().positive()
const nonneg = z.number().min(0)
const range = z.tuple([z.number(), z.number()])
const band = z.object({ gain: nonneg, bands: z.array(pos).min(1), q: pos, jitter: z.number().min(0).max(1) }).strict()
const kind = z.object({ rumble: nonneg, hiss: nonneg, grit: nonneg, joint: nonneg, jointGain: nonneg }).strict()
const hit = z.object({ files: z.string().optional(), gain: nonneg, rate: range.optional(), hz: pos.optional(), seconds: pos.optional(), count: z.number().int().min(1).optional(), stride: pos.optional() }).strict()

export const soundSchema = z.object({
  _doc: z.string().optional(),
  master: z.object({ gain: nonneg, sfx: nonneg, ambience: nonneg, ui: nonneg, reverb: z.object({ open: nonneg, underDeck: nonneg, seconds: pos }).strict() }).strict(),
  surfaces: z.object({
    kinds: z.object({ concrete: kind, sidewalk: kind, asphalt: kind, metal: kind, wood: kind, grass: kind }).strict(),
    byType: z.record(z.string(), z.string()), byCollection: z.record(z.string(), z.string()),
    byIdPattern: z.array(z.tuple([z.string(), z.string()])), default: z.string(),
  }).strict(),
  roll: z.object({ gain: nonneg, refSpeed: pos, rumbleHz: pos, rumblePerMs: nonneg, rumbleQ: pos, hissHz: pos, hiss: nonneg, grit: nonneg, manual: nonneg, wheelbase: pos }).strict(),
  grind: z.object({ metal: band, concrete: band }).strict(),
  slide: z.object({ metal: band, concrete: band, urethane: band }).strict(),
  wobble: z.object({ gain: nonneg, min: nonneg }).strict(),
  drive: z.object({
    _doc: z.string().optional(),
    engine: z.object({ idleHz: pos, perMs: nonneg, gears: z.array(pos).min(1), throttleHz: nonneg, truck: pos, scooter: pos, scooterGain: nonneg, idleGain: nonneg, gain: nonneg, lowpass: pos }).strict(),
    squeal: z.object({ hz: pos, q: pos, gain: nonneg, slip: nonneg, fullSpeed: pos }).strict(),
    door: z.object({ hz: pos, gain: nonneg }).strict(),
    unlock: z.object({ types: z.array(z.string()), hz: z.tuple([pos, pos]), gain: nonneg }).strict(),
    bump: z.object({ gain: nonneg, hz: pos }).strict(),
    horn: z.object({ hz: z.array(pos).min(1), seconds: pos, gain: nonneg }).strict(),
  }).strict(),
  wind: z.object({ gain: nonneg, refSpeed: pos, hz: pos, perMs: nonneg }).strict(),
  ambience: z.object({
    freeway: z.object({ gain: nonneg, underDeck: nonneg, hz: pos }).strict(),
    city: z.object({ gain: nonneg }).strict(),
    trucks: z.object({ every: range, seconds: pos, gain: nonneg, joints: z.number().int().min(0) }).strict(),
    sirens: z.object({ every: range, seconds: pos, gain: nonneg }).strict(),
    streets: z.object({ city: nonneg, birds: z.object({ every: range, gain: nonneg }).strict(), horns: z.object({ every: range, gain: nonneg }).strict() }).strict().optional(),
  }).strict(),
  hits: z.object({
    pop: hit, popCrack: hit, flip: hit, catch: hit, land: hit, landClack: hit, thump: hit, joint: hit,
    grindMetal: hit, grindConcrete: hit, lip: hit, bailBody: hit, bailHit: hit, clatter: hit, step: hit, footLand: hit, push: hit, pickup: hit, drop: hit,
  }).strict(),
  score: z.object({ gain: nonneg, ratio: pos, index: nonneg, bigCombo: pos }).strict(),
  npc: z.object({ _doc: z.string().optional(), gain: nonneg, near: pos, far: pos }).strict().optional(),
  dogs: z.object({ _doc: z.string().optional(), gain: nonneg, near: pos, far: pos, hz: range, seconds: pos, woofs: z.tuple([z.number().int().min(1), z.number().int().min(1)]) }).strict().optional(),
  applause: z.object({ _doc: z.string().optional(), claps: z.number().int().min(1), fullAt: pos, seconds: pos, delay: nonneg, hz: z.tuple([pos, pos]), gain: nonneg, woos: z.number().int().min(0), wooGain: nonneg }).strict().optional(),
  voices: z.object({ _doc: z.string().optional(), gain: nonneg }).catchall(z.union([z.string(), z.number(), z.object({ pop: z.array(z.string()), land: z.array(z.string()), bail: z.array(z.string()), emote: z.array(z.string()).optional() }).strict()])),
}).strict()

export type SoundData = z.infer<typeof soundSchema>
