import { z } from 'zod'
import type { GameData, Physics, Scoring, Tricks } from '../sim/data.ts'

// Validation for data/*.json. Runs where files are read (harness, client), never in the sim.

const pos = z.number().positive()
const nonneg = z.number().nonnegative()

const physics = z.object({
  tickHz: z.number().int().min(30).max(480),
  gravity: pos,
  skater: z.object({ radius: pos }).strict(),
  ground: z.object({
    pushAccel: nonneg, maxPushSpeed: nonneg, rollingResistance: nonneg, rollingByType: z.record(z.string(), nonneg),
    footBrakeDecel: nonneg, footBrakeFullSpeed: nonneg, footBrakeHighSpeed: pos, footBrakeHighFactor: z.number().min(0).max(1),
    snapDistance: nonneg, maxSnapAngleDeg: z.number().min(0).max(90), groundMinNormalZ: z.number().min(-1).max(1), safeNormalZ: z.number().min(-1).max(1),
    crouchPump: nonneg, stickGap: nonneg, transitionDeg: z.number().min(0).max(90), transitionStickGap: nonneg,
    curbHop: nonneg, curbHopDeg: z.number().min(0).max(90), curbHopMinSpeed: nonneg, curbHopDepth: nonneg, curbHopKeep: z.number().min(0).max(1), curbHopBumpTicks: z.number().int().min(0),
  }).strict(),
  board: z.object({
    leanMaxDeg: z.number().min(0).max(45), leanIn: pos, leanOut: pos,
    leanAtSpeed: z.object({ from: nonneg, to: pos, tauIn: pos, tauOut: pos }).strict(),
    minRadius: pos, carveAccel: pos, pivotRate: nonneg, pivotMaxSpeed: pos,
    park: z.object({ from: nonneg, to: pos, minRadius: pos, carveAccel: pos, grip: pos }).strict(),
    grip: pos, slideFriction: pos, carveSlipMaxDeg: z.number().min(0).max(90), recoverYawRate: pos, slipMinSpeed: nonneg,
    loadSmoothing: z.number().min(0.01).max(1),
  }).strict(),
  aero: z.object({ airDensity: nonneg, massKg: pos, cdaStand: nonneg, cdaTuck: nonneg }).strict(),
  slide: z.object({ minSpeed: nonneg, angleDeg: z.number().min(0).max(170), steerDeg: z.number().min(0).max(80), yawRate: pos, minScoreTicks: z.number().int().min(0), bertSpeed: nonneg }).strict(),
  wobble: z.object({ speed: pos, tuckSpeed: pos, grow: nonneg, seed: z.number().min(0).max(1), damp: nonneg, crouchDamp: nonneg, carveDamp: nonneg, hz: pos, leanDeg: nonneg }).strict(),
  walk: z.object({
    runSpeed: pos, walkSpeed: pos, backSpeed: nonneg, accel: pos, decel: pos, turnRate: nonneg, jumpSpeed: nonneg,
    stepHeight: nonneg, climbMax: nonneg, climbTicks: z.number().int().min(1), maxSlopeDeg: z.number().min(0).max(89), maxStepOffSpeed: nonneg, hardLandSpeed: pos, stumbleTicks: z.number().int().min(0),
    hangMinDrop: nonneg, hangMaxSpeed: nonneg, hangDepth: pos, pullUpTicks: z.number().int().min(1),
  }).strict(),
  vert: z.object({ minWallDeg: z.number().min(30).max(90), topToleranceDeg: z.number().min(0).max(30), copingReach: nonneg, copingMinDeg: z.number().min(0).max(90), reentry: nonneg }).strict(),
  spine: z.object({ takeoffDeg: pos, reach: pos, faceMin: z.number().min(0).max(1), minDeg: nonneg, landDrop: nonneg, maxSpeed: pos, clearance: nonneg, bufferTicks: z.number().int().min(1) }).strict(),
  land: z.object({
    toleranceDeg: z.number().min(0).max(90), maxUpDeg: z.number().min(0).max(180), cleanDeg: z.number().min(0).max(90), stumbleDeg: z.number().min(0).max(90),
    straighten: z.number().min(0).max(1), stumbleSpeed: pos, hardSpeed: pos, stumbleKeep: z.number().min(0).max(1), stumbleTicks: z.number().int().min(0), slowSpeed: nonneg,
  }).strict(),
  marker: z.object({ minSpeed: nonneg }).strict(),
  bail: z.object({ ticks: z.number().int().min(1), friction: nonneg, getUpTicks: z.number().int().min(0), getUpSpeed: nonneg, getUpFrom: z.number().int().min(0), getUpRate: z.number().int().min(1) }).strict(),
  air: z.object({ spinAccel: nonneg, spinMax: nonneg, spinDecay: nonneg,
    ledgePop: z.object({ ticks: z.number().int().min(0), minSpeed: nonneg, deg: z.number().min(0).max(90), reach: nonneg, maxHeight: nonneg, depth: nonneg, keep: z.number().min(0).max(1) }).strict() }).strict(),
  ollie: z.object({ popMin: nonneg, popMax: nonneg, chargeTicks: z.number().int().min(1), lateTicks: z.number().int().min(0), upMix: z.number().min(0).max(1) }).strict(),
  collision: z.object({ maxSubstepMove: pos, iterations: z.number().int().min(1).max(16) }).strict(),
  surfaces: z.object({ flatMaxDeg: nonneg, bankMaxDeg: nonneg, steepMaxDeg: nonneg }).strict(),
  limits: z.object({ maxSpeed: pos }).strict(),
  combo: z.object({
    graceTicks: z.number().int().min(0), manualWindow: z.number().int().min(1), manualMinSpeed: nonneg, manualStartSpeed: nonneg, manualComboTilt: nonneg, manualComboRamp: nonneg,
    manualInstability: nonneg, manualNoise: nonneg, manualControl: nonneg, manualDamping: nonneg, manualStart: nonneg, manualRamp: nonneg,
    revertMinDeg: nonneg, revertBufferTicks: z.number().int().min(0), lipMaxAlong: nonneg, footWindow: z.number().int().min(1),
    wallReach: nonneg, wallPressTicks: z.number().int().min(1), wallrideTicks: z.number().int().min(1), wallrideGravity: nonneg, wallrideMinSpeed: nonneg, wallrideMaxUp: nonneg, wallridesPerAir: z.number().int().min(1),
    wallplantKeep: nonneg, wallplantPop: nonneg, specialPoints: pos,
  }).strict(),
  grind: z.object({
    lines: z.object({ topMaxDeg: nonneg, sideMinDeg: nonneg, minDrop: nonneg, minLength: nonneg, mergeDeg: nonneg, gridCell: pos }).strict(),
    captureRadius: pos, captureAbove: nonneg, captureBelow: nonneg, bufferTicks: z.number().int().min(1), slideAngleDeg: z.number().min(0).max(90),
    friction: nonneg, slideMinSpeed: nonneg, downhillSlope: nonneg, stallSpeed: nonneg, voidTicks: z.number().int().min(0), switchTicks: z.number().int().min(1), exitPop: nonneg,
    balanceInstability: nonneg, balanceNoise: nonneg, balanceControl: nonneg, balanceDamping: nonneg, balanceStart: nonneg, balanceRamp: nonneg, comboTilt: nonneg, comboRamp: nonneg, regrabAbove: nonneg, sightRadius: pos, sightSkip: nonneg,
  }).strict(),
}).strict() satisfies z.ZodType<Physics>

const spots = z.object({
  default: z.string(),
  aliases: z.array(z.object({ id: z.string(), label: z.string(), spot: z.string() }).strict()),
  labels: z.record(z.string(), z.string()).optional(),
}).strict()

const dir = z.enum(['none', 'up', 'down', 'left', 'right', 'upleft', 'upright', 'downleft', 'downright'])
const grindDef = z.object({ id: z.string(), name: z.string(), dir, points: nonneg, pointsPerSecond: nonneg }).strict()
const railDir = z.enum(['none', 'up', 'down', 'toward', 'away', 'upToward', 'upAway', 'downToward', 'downAway'])
const taps = z.literal(2).optional()
const railDef = z.object({ id: z.string(), name: z.string(), dirs: z.array(railDir).min(1), taps, points: nonneg, pointsPerSecond: nonneg, nose: z.enum(['far', 'near']).optional() }).strict()
const tricks = z.object({
  _doc: z.string().optional(),
  doubleTapTicks: z.number().int().min(1),
  dirTicks: z.number().int().min(0),
  stance: z.object({ fakie: pos, nollie: pos, switch: pos }).strict(),
  named: z.array(z.object({ id: z.string(), name: z.string(), points: nonneg, of: z.string(), spin: z.enum(['fs180', 'bs180', 'fs360', 'bs360']) }).strict()),
  defaults: z.object({ flip: z.string(), grab: z.string(), grind: z.string(), slide: z.string() }).strict(),
  grinds: z.array(railDef),
  slides: z.array(railDef.extend({ nose: z.enum(['far', 'near']) })),
  manuals: z.array(z.object({ id: z.string(), name: z.string(), points: nonneg, pointsPerSecond: nonneg }).strict()),
  spine: z.object({ id: z.literal('spine'), name: z.string(), points: nonneg }).strict(),
  skitch: z.object({ id: z.literal('skitch'), name: z.string(), points: nonneg, pointsPerSecond: nonneg }).strict(),
  powerslides: z.array(z.object({ id: z.enum(['powerslide', 'bertslide']), name: z.string(), points: nonneg, pointsPerSecond: nonneg }).strict()).length(2),
  foot: z.array(z.object({ id: z.string(), name: z.string(), points: nonneg, pop: pos, seq: z.array(z.enum(['up', 'down', 'left', 'right'])).min(1).max(3) }).strict()),
  lips: z.array(grindDef.extend({ out: z.literal('forward').optional() })),
  specials: z.array(z.union([
    z.object({ id: z.string(), name: z.string(), kind: z.literal('flip'), seq: z.array(dir), points: nonneg, ticks: z.number().int().min(1), roll: z.number(), yaw: z.number(), pitch: z.number() }).strict(),
    z.object({ id: z.string(), name: z.string(), kind: z.literal('grab'), seq: z.array(dir), points: nonneg, pointsPerSecond: nonneg, enterTicks: z.number().int().min(1), exitTicks: z.number().int().min(1) }).strict(),
  ])),
  flips: z.array(z.object({ id: z.string(), name: z.string(), dir, taps: z.union([z.literal(2), z.literal(3)]).optional(), twice: z.literal(true).optional(), points: nonneg, ticks: z.number().int().min(1), roll: z.number(), yaw: z.number(), pitch: z.number() }).strict()),
  grabs: z.array(z.object({ id: z.string(), name: z.string(), dir, taps, points: nonneg, pointsPerSecond: nonneg, enterTicks: z.number().int().min(1), exitTicks: z.number().int().min(1) }).strict()),
}).strict() satisfies z.ZodType<Tricks>
const scoring = z.object({ _doc: z.string().optional(), repeat: z.array(z.number().min(0).max(1)).min(1).refine((r) => r.every((x, i) => i === 0 || x <= r[i - 1]), "repeat shares never go up"), spinPer180: nonneg, revertPoints: nonneg, wallplantPoints: nonneg, wallridePoints: nonneg, wallridePointsPerSecond: nonneg }).strict() satisfies z.ZodType<Scoring>

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/)
export const lookSchema = z.object({
  _doc: z.string().optional(),
  style: z.enum(['real', 'cute', 'grey']),
  sky: z.object({ top: hex, horizon: hex, below: hex }).strict(),
  fog: z.object({ near: pos, far: pos }).strict(),
  sun: z.object({ color: hex, intensity: nonneg, from: z.tuple([z.number(), z.number(), pos]) }).strict(),
  hemi: z.object({ sky: hex, ground: hex, intensity: nonneg }).strict(),
  toon: z.object({ bands: z.array(z.number().min(0).max(1)).min(2) }).strict(),
  outline: z.object({ ink: hex, width: pos, crease: pos, fade: z.tuple([nonneg, pos]), strength: z.number().min(0).max(1) }).strict(),
  mottle: z.number().min(0).max(0.5),
  paint: z.object({
    id: z.record(z.string(), hex), idPattern: z.array(z.tuple([z.string(), hex])), role: z.record(z.string(), hex),
    type: z.record(z.string(), hex), collection: z.record(z.string(), hex), buildings: z.array(hex).min(1), default: hex,
  }).strict(),
  real: z.object({
    _doc: z.string().optional(),
    sky: z.object({ hdri: z.string(), environment: nonneg, background: nonneg, turn: z.number(), highlights: z.object({ knee: pos, span: pos }).strict() }).strict(),
    exposure: pos,
    sun: z.object({ color: hex, intensity: nonneg, from: z.tuple([z.number(), z.number(), pos]), shadowMap: z.number().int().min(512).max(16384), shadowRadius: nonneg.optional(), shadowIntensity: z.number().min(0).max(1).optional() }).strict(),
    toneMapping: z.enum(['neutral', 'aces', 'agx']).optional(),
    film: z.object({
      lift: z.number().min(0).max(0.2), shoulder: z.number().min(0).max(1), warm: z.tuple([z.number(), z.number(), z.number()]), cool: z.tuple([z.number(), z.number(), z.number()]), split: z.number().min(0).max(1),
      grain: z.number().min(0).max(0.2), lens: z.object({ chase: z.number().min(0).max(0.3), trick: z.number().min(0).max(0.3), vignette: z.number().min(0).max(1) }).strict(),
      ps2: z.object({ height: z.number().int().min(120).max(1080), levels: z.number().int().min(4).max(256) }).strict(),
    }).strict().optional(),
    daySky: z.object({ zenith: hex, horizon: hex, sunGlow: hex, glow: z.number().min(0).max(4), clouds: z.number().min(0).max(1), cloudColor: hex, cloudShade: hex }).strict().optional(),
    readable: z.object({ fill: z.tuple([nonneg, nonneg]), rim: z.tuple([nonneg, nonneg]), rimNight: hex }).strict().optional(),
    sunHaze: z.number().min(0).max(1).optional(),
    moonlight: z.object({ sky: hex, ground: hex, intensity: nonneg, lamps: nonneg }).strict().optional(),
    fog: z.object({ color: hex, near: pos, far: pos }).strict(),
    atlasGain: pos,
    unseen: z.object({ albedo: nonneg, stains: z.number().min(0).max(1), stainScale: pos }).strict(),
    nearFade: z.tuple([nonneg, pos]),
    lamps: z.array(z.string()),
    ao: z.object({ radius: pos, intensity: z.number().min(0).max(2), resolution: z.number().min(0.25).max(1), samples: z.number().int().min(4).max(32).optional(), denoise: z.number().int().min(2).max(32).optional() }).strict(),
    detail: z.record(z.enum(['concrete', 'wall', 'asphalt', 'metal', 'bark']), z.object({ texture: z.string(), scale: pos, albedo: z.number().min(0).max(1), normal: z.number().min(0).max(1), rough: z.number().min(0).max(1) }).strict()),
    materials: z.record(z.string(), z.enum(['concrete', 'wall', 'asphalt', 'metal', 'bark', 'none'])),
    pbr: z.record(z.string(), z.object({ roughness: z.number().min(0).max(1), metalness: z.number().min(0).max(1) }).strict()),
    grade: z.object({ contrast: pos, saturation: nonneg, vignette: z.number().min(0).max(1) }).strict(),
    weather: z.record(z.string(), z.object({
      label: z.string(), fog: z.object({ color: hex.optional(), near: pos.optional(), far: pos.optional() }).strict().optional(),
      sun: z.object({ color: hex.optional(), intensity: nonneg.optional(), from: z.tuple([z.number(), z.number(), pos]).optional() }).strict().optional(),
      daySky: z.object({ zenith: hex.optional(), horizon: hex.optional(), sunGlow: hex.optional(), glow: z.number().min(0).max(4).optional(), clouds: z.number().min(0).max(1).optional() }).strict().optional(),
      environment: nonneg.optional(), exposure: pos.optional(), sky: z.enum(['hdri', 'fog']).optional(), night: z.boolean().optional(), heightFog: z.number().min(0).max(1).optional(),
      bloom: z.number().min(0).max(1).optional(),
    }).strict()).optional(),
    bloom: z.object({ strength: nonneg, radius: z.number().min(0).max(1), threshold: nonneg }).strict().optional(),
    heightFog: z.object({ density: nonneg, base: z.number(), falloff: pos, noiseScale: pos, wind: z.tuple([z.number(), z.number()]) }).strict().optional(),
    live: z.object({ lat: z.number(), lon: z.number(), fogVisibility: pos, fogCloud: z.number().min(0).max(100), goldenMinutes: nonneg, refreshMinutes: pos }).strict().optional(),
    nightSky: z.object({
      zenith: hex, horizon: hex, glow: hex, glowHeight: pos, stars: z.number().int().min(0).max(20000), starBrightness: nonneg,
      moon: z.object({ dir: z.tuple([z.number(), z.number(), pos]), size: pos, color: hex, halo: nonneg }).strict(),
    }).strict().optional(),
  }).strict(),
  city: z.object({ _doc: z.string().optional(), shadowReach: pos, shadowMap: z.number().int().min(512).max(16384) }).strict().optional(),
}).strict()
export type Look = z.infer<typeof lookSchema>

export const controlsSchema = z.object({
  keyboard: z.record(z.string(), z.array(z.string())),
  gamepad: z.object({ _doc: z.string().optional(), buttons: z.record(z.string(), z.array(z.number().int().min(0))), stickDeadzone: z.number().min(0).max(1), start: z.number().int().min(0), radio: z.number().int().min(0).optional(), replay: z.number().int().min(0).optional(), interact: z.number().int().min(0).optional(),
    rumble: z.record(z.enum(['land', 'bail', 'grind', 'carHit']), z.object({ ms: z.number().positive(), strong: z.number().min(0).max(1), weak: z.number().min(0).max(1) }).strict()).optional(), rumbleLandImpact: z.tuple([z.number().nonnegative(), z.number().positive()]).optional() }).strict(),
  player2: z.object({ _doc: z.string().optional(), keyboard: z.record(z.string(), z.array(z.string())), pad: z.number().int().min(0) }).strict().optional(),
  dev: z.object({
    save: z.string(), load: z.string(), clip: z.string(), tuning: z.string(), respawn: z.string(), nextSpot: z.string(), pin: z.string(), help: z.string(),
    pause: z.string(), stepTick: z.string(), camera: z.string(), style: z.string(), layers: z.record(z.string(), z.string()),
    radio: z.string().optional(), radioPrev: z.string().optional(), radioOff: z.string().optional(), share: z.string().optional(), photo: z.string().optional(), replay: z.string().optional(), character: z.string().optional(), emote: z.string().optional(), map: z.string().optional(),
  }).strict(),
}).strict()
export type Controls = z.infer<typeof controlsSchema>

const box = z.tuple([z.number(), z.number(), z.number(), z.number()])
const xy = z.tuple([z.number(), z.number()])
const lines = z.array(z.string()).min(1)
const bombRoute = {
  id: z.string(), name: z.string(),
  start: z.object({ pos: z.tuple([z.number(), z.number(), z.number()]), heading: z.number() }).strict(),
  gates: z.array(z.object({ name: z.string(), pos: z.tuple([z.number(), z.number(), z.number()]), dir: z.tuple([z.number(), z.number()]), halfWidth: pos, height: pos }).strict()).min(2),
  maxSeconds: pos,
  line: z.string().optional(),
  racers: z.array(z.object({ name: z.string(), look: z.number().int().min(0).max(999), speed: pos, brakeMargin: nonneg, standUp: nonneg, standFor: nonneg, flipChance: z.number().min(0).max(1), offset: z.number() }).strict()).max(6),
}
const run = z.object({
  durationSeconds: pos, letterRadius: pos,
  letters: z.array(z.object({ letter: z.string(), pos: z.tuple([z.number(), z.number(), z.number()]), hint: z.string() }).strict()),
  burritoParks: z.array(z.string()), burritoRadius: pos, burritoPoints: nonneg,
  burritos: z.array(z.object({ pos: z.tuple([z.number(), z.number(), z.number()]), hint: z.string() }).strict()),
  goals: z.array(z.object({ id: z.string(), name: z.string(), kind: z.enum(['score', 'letters', 'gaps', 'combo', 'speed', 'burritos']), value: nonneg }).strict()),
  courier: z.object({
    _doc: z.string().optional(), parks: z.array(z.string()),
    start: z.object({ pos: z.tuple([z.number(), z.number(), z.number()]), heading: z.number(), place: z.string(), line: z.string() }).strict(),
    pickupRadius: pos, dropRadius: pos, dropHeight: pos, deliveryPoints: nonneg,
    legs: z.array(z.object({ id: z.string(), to: z.tuple([z.number(), z.number(), z.number()]), seconds: pos, place: z.string(), line: z.string() }).strict()).min(1),
  }).strict(),
  combo: z.object({ _doc: z.string().optional(), seconds: pos }).strict(),
  bomb: z.object({
    _doc: z.string().optional(), parks: z.array(z.string()), ...bombRoute, fallPenalty: nonneg, gateRadius: pos, gateStep: pos, gateLane: nonneg,
    routes: z.array(z.object(bombRoute).strict()),
  }).strict(),
  skate: z.object({
    _doc: z.string().optional(), parks: z.array(z.string()), word: z.string().min(1),
    spot: z.object({ mark: xy, radius: pos, near: pos, start: xy, end: xy, heading: z.number(), playerWatch: xy, localWatch: xy, watchHeading: z.number(),
      clear: pos, crowd: z.array(z.tuple([z.number(), z.number(), z.number()])).min(1) }).strict(),
    setSeconds: pos, matchSeconds: pos, pauseSeconds: pos, manualSeconds: nonneg, runSpeed: pos, lockTicks: z.number().int().min(24),
    hardness: nonneg, favoriteBonus: z.number(), favoriteChance: z.number().min(0).max(1), minMake: z.number().min(0).max(1), maxMake: z.number().min(0).max(1),
    difficulty: z.record(z.string(), nonneg),
    sets: z.array(z.string()).min(1),
    locals: z.array(z.object({
      id: z.string(), name: z.string(), hood: z.string(), look: z.number().int().min(0).max(999), skill: z.number().min(0).max(1), favorites: z.array(z.string()),
      lines: z.object({ set: lines, setMiss: lines, make: lines, miss: lines, youMake: lines, youMiss: lines, win: lines, lose: lines }).strict(),
    }).strict()).min(1),
  }).strict(),
  twoPlayer: z.object({
    _doc: z.string().optional(),
    join: z.object({ side: z.number() }).strict(),
    trickAttack: z.object({ seconds: pos }).strict(),
    horse: z.object({ word: z.string().min(1), words: z.array(z.string().min(1)).min(1), setSeconds: pos, matchSeconds: pos, pauseSeconds: pos }).strict(),
    graffiti: z.object({ seconds: pos }).strict(),
  }).strict(),
  muni: z.object({
    _doc: z.string().optional(), parks: z.array(z.string()),
    accel: pos, decel: pos, creep: pos, startDwell: nonneg, dwell: nonneg, stopRadius: pos, platform: z.number(), bell: nonneg, bellSide: nonneg,
    delay: z.object({ chance: z.number().min(0).max(1), seconds: z.tuple([nonneg, nonneg]), says: z.array(z.string()).min(1) }).strict(),
    lines: z.array(z.object({ id: z.string(), name: z.string(), cruise: pos, rails: z.array(z.string()).min(1), stops: z.array(z.object({ name: z.string(), at: xy }).strict()).min(2) }).strict()).min(1),
    roam: z.object({
      _doc: z.string().optional(), parks: z.array(z.string()), layover: nonneg,
      lines: z.array(z.object({ id: z.string(), name: z.string(), cruise: pos, cars: z.number().int().min(0), pair: z.string(), pairAt: z.enum(['start', 'nearest']).optional(), parked: xy.optional(),
        rails: z.array(z.string()).min(1), stops: z.array(z.object({ name: z.string(), at: xy }).strict()).min(2) }).strict()),
    }).strict(),
  }).strict(),
  escape: z.object({
    _doc: z.string().optional(), parks: z.array(z.string()),
    seconds: pos, start: pos, cruise: pos, accel: pos, brake: pos, decel: pos, stopGap: nonneg, plan: pos, link: pos, roadLink: z.object({ reach: pos, height: pos, roads: z.array(z.string()).min(1), through: z.array(z.string()) }).strict(), lane: z.number(), turnSpeed: pos, uTurnSpeed: pos,
    close: pos, closeOut: nonneg, catch: pos, catchSeconds: pos, honkEvery: pos,
    recalc: z.object({ points: nonneg, secondsPer1000: nonneg, maxSeconds: nonneg, speed: z.number().min(0).max(1) }).strict(),
    backup: z.object({ far: pos, seconds: pos }).strict(),
    survivalBonus: nonneg,
  }).strict(),
  graffiti: z.object({ _doc: z.string().optional(), seconds: pos }).strict(),
}).strict()
const gaps = z.object({ gaps: z.array(z.union([
  z.object({ id: z.string(), name: z.string(), kind: z.literal('air'), points: nonneg, from: box, to: box.optional(), minAirTicks: z.number().int().min(0).optional(),
    toZ: z.tuple([z.number(), z.number()]).optional(), over: z.array(z.array(xy).min(3)).min(1).optional(), minMeters: nonneg.optional(), replaces: z.array(z.string()).optional() }).strict(),
  z.object({ id: z.string(), name: z.string(), kind: z.enum(['grind', 'lip']), points: nonneg, element: z.string(), box: box.optional(), feature: z.string().optional(), replaces: z.array(z.string()).optional() }).strict(),
  z.object({ id: z.string(), name: z.string(), kind: z.literal('car'), points: nonneg, robo: z.boolean().optional(), again: nonneg, replaces: z.array(z.string()).optional() }).strict(),
  z.object({ id: z.string(), name: z.string(), kind: z.literal('wall'), points: nonneg, box, plant: z.boolean().optional(), replaces: z.array(z.string()).optional() }).strict(),
  z.object({ id: z.string(), name: z.string(), kind: z.literal('skitch'), points: nonneg, tram: z.boolean().optional(), replaces: z.array(z.string()).optional() }).strict(),
])) }).strict()

const goalBase = { id: z.string(), name: z.string(), area: z.string(), description: z.string() }
const goals = z.object({
  _doc: z.string().optional(), parks: z.array(z.string()),
  goals: z.array(z.union([
    z.object({ ...goalBase, kind: z.literal('gap'), gaps: z.array(z.string()).min(1) }).strict(),
    z.object({ ...goalBase, kind: z.literal('skitch'), meters: pos, robo: z.boolean().optional() }).strict(),
    z.object({ ...goalBase, kind: z.literal('speed'), kmh: pos, box, z: z.tuple([z.number(), z.number()]).optional() }).strict(),
    z.object({ ...goalBase, kind: z.literal('combo'), points: pos, box, gaps: z.array(z.string()).min(1).optional() }).strict(),
    z.object({ ...goalBase, kind: z.literal('collect'), burritos: z.number().int().min(1) }).strict(),
    z.object({ ...goalBase, kind: z.literal('courier'), deliveries: z.number().int().min(1) }).strict(),
    z.object({ ...goalBase, kind: z.literal('bomb'), route: z.string().optional(), maxSeconds: pos.optional(), noBrakes: z.boolean().optional(), noFalls: z.boolean().optional(), win: z.boolean().optional() }).strict(),
  ])),
}).strict()

const tourGoalBase = { id: z.string(), name: z.string(), description: z.string() }
const tour = z.object({
  _doc: z.string().optional(),
  seconds: pos, tapeRadius: pos, wrongWay: z.object({ away: pos, back: nonneg }).strict(),
  names: z.object({ pro: z.string(), sick: z.string(), skate: z.string(), tape: z.string() }).strict(),
  levels: z.array(z.object({
    id: z.string(), name: z.string(), world: z.string(), worlds: z.array(z.string()).optional(), spot: z.string(), starts: z.array(z.string()).min(1).optional(), area: box, areas: z.array(box).min(1).optional(), exclude: z.array(box).min(1).optional(),
    letters: z.array(z.object({ letter: z.string().length(1), pos: z.tuple([z.number(), z.number(), z.number()]), hint: z.string() }).strict()).min(1),
    tape: z.object({ pos: z.tuple([z.number(), z.number(), z.number()]), hint: z.string() }).strict(),
    tiers: z.object({ pro: pos, sick: pos }).strict(),
    goals: z.array(z.union([
      z.object({ ...tourGoalBase, kind: z.literal('gap'), gaps: z.array(z.string()).min(1) }).strict(),
      z.object({ ...tourGoalBase, kind: z.literal('skitch'), meters: pos, robo: z.boolean().optional() }).strict(),
      z.object({ ...tourGoalBase, kind: z.literal('speed'), kmh: pos, box, z: z.tuple([z.number(), z.number()]).optional() }).strict(),
      z.object({ ...tourGoalBase, kind: z.literal('combo'), points: pos, box: box.optional(), gaps: z.array(z.string()).min(1).optional(), every: z.boolean().optional(), tricks: z.array(z.string()).min(1).optional() }).strict(),
      z.object({ ...tourGoalBase, kind: z.literal('grind'), meters: pos, box: box.optional(), feature: z.string().optional() }).strict(),
      z.object({ ...tourGoalBase, kind: z.literal('air'), seconds: pos, box }).strict(),
      z.object({ ...tourGoalBase, kind: z.literal('dash'), from: box, to: box, seconds: pos }).strict(),
    ])).min(1),
  }).strict()).min(1),
}).strict()

const rider = z.object({ stance: z.enum(['regular', 'goofy']) }).strict()

const nums = (keys: string[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.number()]))).strict()
const traffic = z.object({
  _doc: z.string().optional(),
  cars: z.number().int().min(0), robotaxis: z.number().int().min(0),
  cruise: z.record(z.string(), pos), cruiseDefault: pos, cruiseJitter: z.number().min(0).max(1), roboCruise: pos,
  accel: pos, brake: pos, roboBrake: pos,
  lane: nums(['oneway', 'onewayMulti', 'twoWay', 'wide']),
  yield: nums(['ahead', 'stop', 'side', 'height', 'decel', 'look']),
  follow: nums(['range', 'gap', 'side']),
  honkAfter: nonneg, roboHonkAfter: nonneg, hazardAfter: nonneg,
  bubble: nums(['spawnNear', 'spawnFar', 'far', 'respawnNear', 'respawnFar']),
  body: nums(['length', 'width', 'bottom', 'top']),
  cabin: nums(['length', 'width', 'offset', 'top']),
  collideRange: pos,
  tram: z.object({ _doc: z.string().optional(), name: z.string(), body: nums(['length', 'width', 'bottom', 'top']), cabin: nums(['length', 'width', 'offset', 'top']), collideRange: pos }).strict(),
  hitSpeed: pos, knock: nonneg,
  skitch: nums(['reach', 'side', 'height', 'maxRel', 'behind', 'hold', 'balanceStart', 'instability', 'noise', 'control', 'damping', 'ramp', 'turnPush', 'turnBail', 'honkFirst', 'honkEvery', 'roboDecel', 'easySpeed', 'minSeconds']),
}).strict()

const carDims = z.object({ body: nums(['length', 'width', 'bottom', 'top']), cabin: nums(['length', 'width', 'offset', 'top']) }).strict()
const vehicleType = z.object({
  name: z.string(), label: z.string(), dims: carDims,
  wheelbase: pos, track: pos, maxStep: nonneg, maxDrop: pos,
  engine: z.object({ accel: pos, topSpeed: pos, reverseAccel: pos, reverseTop: pos, brake: pos, rolling: nonneg, drag: nonneg }).strict(),
  steer: z.object({ maxDeg: pos, fade: pos, rate: pos, back: pos }).strict(),
  grip: z.object({ lateral: pos, handbrake: pos, yawBoost: pos, yawAccel: pos, yawFade: pos, handbrakeDecel: nonneg }).strict(),
  body: z.object({ spheres: z.number().int().min(1).max(8), clearance: nonneg, restitution: z.number().min(0).max(1), friction: z.number().min(0).max(1), yawKick: nonneg }).strict(),
  bumpSpeed: pos, bumpCooldown: nonneg, driverless: pos,
  seat: nonneg.optional(), stand: z.boolean().optional(),
  scooter: z.object({ battery: pos, low: nonneg, lowTop: pos, limiter: nonneg,
    ditch: z.object({ name: z.string(), points: nonneg, pop: pos, spinMax: nonneg }).strict(),
    fare: z.object({ unlock: nonneg, perMinute: nonneg }).strict(),
    view: z.object({ wheelieDeg: nonneg, swingDeg: nonneg, leanMaxDeg: nonneg }).strict().optional() }).strict().optional(),
  _doc: z.string().optional(),
}).strict()
const vehicles = z.object({
  _doc: z.string().optional(),
  types: z.record(z.string(), vehicleType),
  enter: pos, exit: z.object({ side: pos, speed: nonneg }).strict(), seat: nonneg, passenger: nonneg,
  parked: z.array(z.object({ world: z.string(), id: z.string(), type: z.string(), x: z.number(), y: z.number(), heading: z.number() }).strict()),
  summon: z.object({ id: z.string(), type: z.string(), near: nonneg, far: pos }).strict(),
  horn: nonneg,
  routes: z.record(z.string(), z.object({ _doc: z.string().optional(), type: z.string(), truck: z.tuple([z.number(), z.number(), z.number()]), lane: nonneg,
    bins: z.array(z.tuple([z.number(), z.number(), z.number()])).min(1), path: z.array(z.tuple([z.number(), z.number()])).min(2) }).strict()),
  reactions: z.object({ _doc: z.string().optional(), body: pos, nearMiss: nonneg, nearMissSpeed: nonneg, shoutCooldown: nonneg, npcLook: nonneg, npcLane: nonneg, npcSpeed: nonneg,
    pedShouts: z.array(z.string().min(1)).min(1), npcShouts: z.array(z.string().min(1)).min(1) }).strict(),
}).strict()

const moversData = z.object({ _doc: z.string().optional(), accel: pos, decel: pos, wait: pos, resume: nonneg, lead: pos, gap: nonneg, catchUp: pos, catchBack: pos }).strict()

/** Vehicles: parked ones and van summon name types that exist; parked ids are unique. */
function checkVehicles(v: GameData['vehicles']): GameData['vehicles'] {
  for (const [id, r] of Object.entries(v.routes)) if (!v.types[r.type]) throw new Error(`data/vehicles.json: route ${id} is for type "${r.type}", not in types`)
  const ids = new Set<string>()
  for (const p of v.parked) {
    if (!v.types[p.type]) throw new Error(`data/vehicles.json: parked ${p.id} has type "${p.type}", not in types`)
    if (ids.has(p.id)) throw new Error(`data/vehicles.json: parked id "${p.id}" twice`)
    ids.add(p.id)
  }
  if (!v.types[v.summon.type]) throw new Error(`data/vehicles.json: summon type "${v.summon.type}" is not in types`)
  return v
}

const unit = z.number().min(0).max(1)
const npcData = z.object({
  _doc: z.string().optional(),
  parks: z.record(z.string(), z.object({ count: z.number().int().min(0).max(12), lines: z.array(z.string()) }).strict()),
  speed: pos, speedJitter: z.number().min(0).max(1),
  chargeTicks: z.tuple([pos, pos]), grabTicks: z.tuple([pos, pos]), grindTicks: z.tuple([pos, pos]),
  styles: z.record(z.string(), z.object({
    share: nonneg, speed: pos, skill: z.tuple([unit, unit]), trickEvery: z.tuple([pos, pos]),
    flipChance: unit, grabChance: unit, grindChance: unit, links: z.tuple([nonneg, nonneg]), manualChance: unit, manualTicks: z.tuple([pos, pos]), flipOut: unit, send: unit,
  }).strict()),
  sloppy: unit, lateTicks: z.number().int().min(0), lapseTicks: z.number().int().min(0),
  sends: z.array(z.object({ line: z.string(), kind: z.enum(['gap', 'wall']), keep: z.number().int().min(0).optional(), via: z.array(z.tuple([z.number(), z.number()])).min(1), speed: pos }).strict()),
  spots: z.record(z.string(), z.array(z.string())), maxWait: pos, waitGap: pos, freeSpot: unit,
  near: z.object({ radius: pos, share: unit }).strict().optional(),
  cheer: z.object({ points: nonneg, range: pos, cooldown: nonneg }).strict(),
  copy: z.object({ points: nonneg, chance: unit, range: pos, seconds: pos }).strict(),
  trail: z.object({ every: z.number().int().min(1), seconds: pos }).strict(),
  linkRange: pos, stuckTicks: z.number().int().min(1), lostRange: pos, castFrom: z.number(),
}).strict()

const pedsData = z.object({
  _doc: z.string().optional(), parks: z.array(z.string()), enabled: z.boolean(), count: z.number().int().min(0).max(64), offset: pos,
  walk: z.tuple([pos, pos]), spawnNear: nonneg, spawnFar: pos, despawn: pos, radius: pos, height: pos, hitSpeed: nonneg, swerveKeep: z.number().min(0).max(1),
  see: z.object({ speed: nonneg, time: pos, clear: pos, fov: z.number().min(0).max(360), aside: nonneg, stepSpeed: pos, maxSide: nonneg, vehicle: nonneg }).strict(),
  phone: z.number().min(0).max(1),
  nearMiss: z.object({ distance: pos, speed: nonneg, points: nonneg, again: nonneg }).strict(),
  cooldown: nonneg, stagger: nonneg,
}).strict()

// The cast and the missions (game/missions.ts, docs/mechanics/missions.md, docs/story.md).
const vec3 = z.tuple([z.number(), z.number(), z.number()])
const place = z.union([z.string(), vec3])
const dline = z.object({ id: z.string().regex(/^[a-z0-9-]+$/), who: z.string(), text: z.string().min(1), say: z.string().optional() }).strict()
const dlines = z.array(dline).min(1)
const actors = z.record(z.string(), z.tuple([z.number(), z.number(), z.number(), z.number()]))
const missionVehicles = z.array(z.object({ name: z.string().regex(/^[a-z0-9_]+$/), type: z.string(), at: z.tuple([z.number(), z.number(), z.number()]) }).strict())
const stepBase = { text: z.string(), say: dlines.optional(), done: dlines.optional(), seconds: pos.optional(), actors: actors.optional(), vehicles: missionVehicles.optional() }
const missionStep = z.discriminatedUnion('kind', [
  z.object({ ...stepBase, kind: z.literal('talk'), who: z.string(), lines: dlines, offer: z.boolean().optional(), phone: z.boolean().optional(), radius: pos.optional() }).strict(),
  z.object({ ...stepBase, kind: z.literal('go'), to: place, radius: pos.optional() }).strict(),
  z.object({ ...stepBase, kind: z.literal('trick'), near: place.optional(), radius: pos.optional(), box: box.optional(), points: nonneg.optional(), gaps: z.array(z.string()).min(1).optional(), tricks: z.array(z.string()).min(1).optional(), air: pos.optional(), grind: pos.optional(), feature: z.string().optional(), count: z.number().int().min(1).optional(), each: dlines.optional() }).strict(),
  z.object({ ...stepBase, kind: z.literal('collect'), items: z.array(vec3).min(1), radius: pos.optional(), height: pos.optional(), item: z.string(), vehicle: z.string().optional(), stop: z.boolean().optional(), each: dlines.optional() }).strict(),
  z.object({ ...stepBase, kind: z.literal('deliver'), from: place.optional(), to: place, radius: pos.optional(), noBail: z.boolean().optional(), item: z.string(), vehicle: z.string().optional(), noBump: pos.optional() }).strict(),
  z.object({ ...stepBase, kind: z.literal('drive'), to: place, radius: pos.optional(), vehicle: z.string().optional(), stop: z.boolean().optional() }).strict(),
  z.object({ ...stepBase, kind: z.literal('carry'), who: z.string(), to: place, radius: pos.optional(), vehicle: z.string().optional(), lines: dlines.optional(), every: pos.optional() }).strict(),
  z.object({ ...stepBase, kind: z.literal('follow'), who: z.string(), path: z.array(z.tuple([z.number(), z.number()])).min(2), speed: pos, distance: pos, lose: nonneg,
    wait: pos.optional(), resume: nonneg.optional(), lead: pos.optional(), waiting: dlines.optional(), passed: dlines.optional() }).strict(),
  z.object({ ...stepBase, kind: z.literal('race'), who: z.string(), path: z.array(z.tuple([z.number(), z.number()])).min(2), speed: pos, distance: pos, finish: pos }).strict(),
  z.object({ ...stepBase, kind: z.literal('mode'), mode: z.enum(['courier', 'bomb', 'muni', 'escape', 'skate', 'graffiti', 'combo']), route: z.string().optional(),
    win: z.object({ deliveries: z.number().int().min(1).optional(), place: z.number().int().min(1).optional(), maxSeconds: pos.optional(), pieces: z.number().int().min(1).optional(), best: pos.optional() }).strict() }).strict(),
])
const missions = z.object({
  _doc: z.string().optional(), talkRadius: pos, goRadius: pos, collectRadius: pos, deliverRadius: pos, driveRadius: pos, carryRadius: pos, carryEvery: pos, height: pos, intro: z.string(),
  missions: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), kind: z.enum(['story', 'side']), chapter: z.number().int().min(1).optional(), area: z.string(), giver: z.string(), blurb: z.string(),
    world: z.string().optional(), worlds: z.array(z.string()).optional(), after: z.array(z.string()).optional(),
    actors: actors.optional(),
    vehicles: missionVehicles.optional(),
    reward: z.object({ sticker: z.string().optional(), unlock: z.string().optional(), deck: z.string().optional(), outfit: z.string().regex(/^[a-z0-9-]+\/[a-z0-9-]+$/).optional() }).strict().optional(),
    retry: z.array(z.number().int().min(1)).optional(),
    fail: z.object({ time: dlines.optional(), lost: dlines.optional(), bail: dlines.optional(), bump: dlines.optional(), mode: dlines.optional() }).strict().optional(),
    steps: z.array(missionStep).min(1),
  }).strict()),
}).strict()
const cast = z.object({
  _doc: z.string().optional(),
  cast: z.array(z.object({
    id: z.string().regex(/^[a-z0-9-]+$/), name: z.string(), trait: z.string(), sticker: z.string(), voice: z.string(), home: vec3, heading: z.number(), area: z.string(),
    model: z.object({ id: z.string(), outfit: z.string().optional() }).strict(), standIn: z.boolean().optional(), chatter: dlines.optional(), post: dlines.optional(), inside: z.string().regex(/^[a-z0-9_]+\/[a-z0-9_]+$/).optional(),
  }).strict()),
}).strict()

// Odd jobs (game/jobs.ts, docs/story.md Odd jobs): the gig boards and what their gigs are made of.
const gig = z.enum(['deliver', 'carry', 'photo', 'race'])
const jobs = z.object({
  _doc: z.string().optional(), after: z.array(z.string()), perDay: z.number().int().min(1).max(6),
  boards: z.array(z.object({ id: z.string().regex(/^[a-z0-9]+$/), name: z.string(), host: z.string(), at: z.string().regex(/^[a-z0-9_]+\/[a-z0-9_]+$/), area: z.string(), gigs: z.array(gig).min(1), hello: dline, empty: dline }).strict()).min(1),
  deliver: z.object({ speed: pos, base: nonneg, items: z.array(z.string()).min(1), clients: z.array(z.object({ who: z.string(), say: dline, done: dline, late: dline }).strict()).min(1) }).strict(),
  carry: z.object({ vehicle: missionVehicles.element, kerb: nonneg, radius: pos, every: pos, minFrom: nonneg, maxFrom: pos, to: z.array(z.string()).min(1), clients: z.array(z.object({ who: z.string(), say: dline, ride: dline, done: dline }).strict()).min(1) }).strict(),
  photo: z.object({ radius: pos, spots: z.array(z.string()).min(1), tricks: z.array(z.object({ text: z.string(), tricks: z.array(z.string()).min(1).optional(), air: pos.optional(), points: pos.optional() }).strict()).min(1), clients: z.array(z.object({ who: z.string(), say: dline, done: dline }).strict()).min(1) }).strict(),
  race: z.object({ distance: pos, finish: pos, courses: z.array(z.object({ id: z.string(), text: z.string(), path: z.array(z.tuple([z.number(), z.number()])).min(2) }).strict()).min(1), clients: z.array(z.object({ who: z.string(), speed: pos, say: dline, done: dline, won: dline }).strict()).min(1) }).strict(),
  decks: z.array(z.object({ deck: z.string(), board: z.string(), gigs: z.number().int().min(1) }).strict()),
}).strict()

/** Cross-file checks on the odd jobs: hosts and clients in the cast, a line id used once (also against the story's), a known van type, missions in after, decks from boards that exist. */
function checkJobs(j: GameData['jobs'], c: GameData['cast'], m: GameData['missions'], v: GameData['vehicles']): GameData['jobs'] {
  const who = new Set(c.cast.map((x) => x.id)), mids = new Set(m.missions.map((x) => x.id)), boards = new Set(j.boards.map((b) => b.id))
  const lineIds = new Set([...c.cast.flatMap((x) => [...x.chatter ?? [], ...x.post ?? []]), ...m.missions.flatMap((M) => [...Object.values(M.fail ?? {}).flat(), ...M.steps.flatMap((st) => [...st.say ?? [], ...st.done ?? [], ...(st.kind === 'talk' ? st.lines : []), ...(st.kind === 'trick' || st.kind === 'collect' ? st.each ?? [] : []), ...(st.kind === 'follow' ? [...st.waiting ?? [], ...st.passed ?? []] : []), ...(st.kind === 'carry' ? st.lines ?? [] : [])])])].map((l) => l!.id))
  for (const l of jobLines(j)) {
    if (lineIds.has(l.id)) throw new Error(`data/jobs.json: line id "${l.id}" twice`)
    if (!who.has(l.who)) throw new Error(`data/jobs.json: line ${l.id} is said by "${l.who}", who is not in data/cast.json`)
    lineIds.add(l.id)
  }
  for (const b of j.boards) if (!who.has(b.host)) throw new Error(`data/jobs.json: board ${b.id}: host "${b.host}" is not in data/cast.json`)
  for (const k of ['deliver', 'carry', 'photo', 'race'] as const) for (const x of j[k].clients) if (!who.has(x.who)) throw new Error(`data/jobs.json: ${k} client "${x.who}" is not in data/cast.json`)
  if (!v.types[j.carry.vehicle.type]) throw new Error(`data/jobs.json: carry vehicle type "${j.carry.vehicle.type}" is not in data/vehicles.json`)
  for (const a of j.after) if (!mids.has(a)) throw new Error(`data/jobs.json: after "${a}", which is not a mission`)
  for (const d of j.decks) if (!boards.has(d.board)) throw new Error(`data/jobs.json: deck ${d.deck} from board "${d.board}", which is not a board`)
  return j
}
/** Every line the odd jobs say (the boards' hosts and the clients'), for voices and the client. */
export function jobLines(j: GameData['jobs']) {
  return [...j.boards.flatMap((b) => [b.hello, b.empty]), ...j.deliver.clients.flatMap((x) => [x.say, x.done, x.late]), ...j.carry.clients.flatMap((x) => [x.say, x.ride, x.done]),
    ...j.photo.clients.flatMap((x) => [x.say, x.done]), ...j.race.clients.flatMap((x) => [x.say, x.done, x.won])]
}

/** Cross-file checks on the missions: unique ids, known characters and gaps, missions named in after, a line id used once. */
function checkMissions(m: GameData['missions'], c: GameData['cast'], gapIds: string[], v?: GameData['vehicles']): GameData['missions'] {
  const who = new Set(c.cast.map((x) => x.id)), ids = new Set<string>(), lineIds = new Set<string>()
  const useLine = (where: string, l: { id: string; who: string }) => {
    if (lineIds.has(l.id)) throw new Error(`data/missions.json: line id "${l.id}" twice (${where})`)
    if (!who.has(l.who)) throw new Error(`data/missions.json: ${where}: line ${l.id} is said by "${l.who}", who is not in data/cast.json`)
    lineIds.add(l.id)
  }
  for (const x of c.cast) for (const l of [...x.chatter ?? [], ...x.post ?? []]) useLine(`cast ${x.id} chatter`, l)
  for (const M of m.missions) {
    if (ids.has(M.id)) throw new Error(`data/missions.json: mission id "${M.id}" twice`)
    ids.add(M.id)
    if (!who.has(M.giver)) throw new Error(`data/missions.json: ${M.id}: giver "${M.giver}" is not in data/cast.json`)
    for (const a of [...Object.keys(M.actors ?? {}), ...M.steps.flatMap((st) => Object.keys(st.actors ?? {}))]) if (!who.has(a)) throw new Error(`data/missions.json: ${M.id}: actor "${a}" is not in data/cast.json`)
    for (const ls of Object.values(M.fail ?? {})) for (const l of ls ?? []) useLine(`${M.id} fail`, l)
    M.steps.forEach((st, i) => {
      const at = `${M.id} step ${i}`
      for (const l of [...st.say ?? [], ...st.done ?? [], ...(st.kind === 'talk' ? st.lines : []), ...(st.kind === 'trick' || st.kind === 'collect' ? st.each ?? [] : []), ...(st.kind === 'follow' ? [...st.waiting ?? [], ...st.passed ?? []] : []), ...(st.kind === 'carry' ? st.lines ?? [] : [])]) useLine(at, l)
      if ((st.kind === 'talk' || st.kind === 'follow' || st.kind === 'carry' || st.kind === 'race') && !who.has(st.who)) throw new Error(`data/missions.json: ${at}: "${st.who}" is not in data/cast.json`)
      for (const g of st.kind === 'trick' ? st.gaps ?? [] : []) if (!gapIds.includes(g)) throw new Error(`data/missions.json: ${at}: no gap "${g}" in data/gaps.json`)
      if (st.kind === 'talk' && st.offer && i !== 0) throw new Error(`data/missions.json: ${at}: only the first step can be the offer`)
    })
    for (const r of M.retry ?? []) if (r >= M.steps.length) throw new Error(`data/missions.json: ${M.id}: retry from step ${r}, past its last step`)
  }
  // Vehicles: placed ones of a type that exists; a step's vehicle is a type, a parked one, one the mission places, or any.
  if (v) for (const M of m.missions) {
    const placed = [...M.vehicles ?? [], ...M.steps.flatMap((st) => st.vehicles ?? [])]
    for (const p of placed) if (!v.types[p.type]) throw new Error(`data/missions.json: ${M.id}: vehicle ${p.name} is of type "${p.type}", not in data/vehicles.json`)
    const names = new Set(['any', ...Object.keys(v.types), ...v.parked.map((p) => p.id), ...placed.map((p) => p.name)])
    M.steps.forEach((st, i) => { const want = 'vehicle' in st ? st.vehicle : undefined; if (want && !names.has(want)) throw new Error(`data/missions.json: ${M.id} step ${i}: vehicle "${want}" is no type, parked vehicle or vehicle the mission places`) })
  }
  for (const M of m.missions) for (const a of M.after ?? []) if (!ids.has(a)) throw new Error(`data/missions.json: ${M.id}: after "${a}", which is not a mission`)
  if (!ids.has(m.intro)) throw new Error(`data/missions.json: intro "${m.intro}" is not a mission`)
  return m
}

export const DATA_FILES = ['rider', 'physics', 'spots', 'tricks', 'scoring', 'run', 'gaps', 'traffic', 'goals', 'npc', 'peds', 'tour', 'vehicles', 'movers', 'cast', 'missions', 'jobs'] as const

/** Gaps: unique ids, and replaces naming other gaps of the same kind. */
function checkGaps(g: GameData['gaps']): GameData['gaps'] {
  const byId = new Map<string, GameData['gaps']['gaps'][number]>()
  for (const x of g.gaps) {
    if (byId.has(x.id)) throw new Error(`data/gaps.json: gap id "${x.id}" twice`)
    byId.set(x.id, x)
  }
  for (const x of g.gaps) for (const id of x.replaces ?? []) {
    const o = byId.get(id)
    if (!o || o.id === x.id) throw new Error(`data/gaps.json: gap ${x.id} replaces "${id}", which is not another gap`)
    if (o.kind !== x.kind) throw new Error(`data/gaps.json: gap ${x.id} (${x.kind}) replaces ${id} (${o.kind}): only gaps of the same kind fire together`)
  }
  return g
}

/** Cross-file checks on the Tour: unique level and goal ids, S-K-A-T-E in order, known gaps. */
function checkTour(t: GameData['tour'], gapIds: string[]): GameData['tour'] {
  const ids = new Set<string>()
  for (const L of t.levels) {
    if (ids.has(L.id)) throw new Error(`data/tour.json: level id "${L.id}" twice`)
    ids.add(L.id)
    if (L.letters.map((l) => l.letter).join('') !== 'SKATE') throw new Error(`data/tour.json: level ${L.id} letters must be S, K, A, T, E in order`)
    const goalIds = new Set(['pro', 'sick', 'skate', 'tape'])
    for (const g of L.goals) {
      if (goalIds.has(g.id)) throw new Error(`data/tour.json: level ${L.id} goal id "${g.id}" twice (pro, sick, skate and tape are the standard ones)`)
      goalIds.add(g.id)
      const gs = g.kind === 'gap' || g.kind === 'combo' ? g.gaps ?? [] : []
      for (const id of gs) if (!gapIds.includes(id)) throw new Error(`data/tour.json: level ${L.id} goal ${g.id}: no gap "${id}" in data/gaps.json`)
    }
  }
  return t
}

export function validateGameData(raw: Record<(typeof DATA_FILES)[number], unknown>): GameData {
  const parse = <T>(name: string, schema: z.ZodType<T>, v: unknown): T => {
    const r = schema.safeParse(v)
    if (!r.success) throw new Error(`data/${name}.json: ${z.prettifyError(r.error)}`)
    return r.data
  }
  const t = parse('tricks', tricks, raw.tricks)
  for (const kind of ['flip', 'grab', 'grind', 'slide'] as const) {
    const list: { id: string }[] = { flip: t.flips, grab: t.grabs, grind: t.grinds, slide: t.slides }[kind]
    if (!list.some((x) => x.id === t.defaults[kind])) throw new Error(`data/tricks.json: default ${kind} "${t.defaults[kind]}" is not in the list`)
  }
  return {
    rider: parse('rider', rider, raw.rider),
    physics: parse('physics', physics, raw.physics), spots: parse('spots', spots, raw.spots), tricks: t, scoring: parse('scoring', scoring, raw.scoring),
    run: parse('run', run, raw.run), gaps: checkGaps(parse('gaps', gaps, raw.gaps)),
    goals: (({ _doc, ...g }) => g)(parse('goals', goals, raw.goals)) as GameData['goals'],
    tour: checkTour((({ _doc, ...g }) => g)(parse('tour', tour, raw.tour)) as GameData['tour'], parse('gaps', gaps, raw.gaps).gaps.map((g) => g.id)),
    npc: (({ _doc, ...n }) => n)(parse('npc', npcData, raw.npc)) as GameData['npc'],
    peds: (({ _doc, ...p }) => p)(parse('peds', pedsData, raw.peds)) as GameData['peds'],
    traffic: (({ _doc, ...t }) => t)(parse('traffic', traffic, raw.traffic)) as GameData['traffic'],
    vehicles: checkVehicles((({ _doc, ...v }) => v)(parse('vehicles', vehicles, raw.vehicles)) as GameData['vehicles']),
    movers: (({ _doc, ...m }) => m)(parse('movers', moversData, raw.movers)) as GameData['movers'],
    cast: (({ _doc, ...c }) => c)(parse('cast', cast, raw.cast)) as GameData['cast'],
    missions: checkMissions((({ _doc, ...m }) => m)(parse('missions', missions, raw.missions)) as GameData['missions'], parse('cast', cast, raw.cast), parse('gaps', gaps, raw.gaps).gaps.map((g) => g.id), parse('vehicles', vehicles, raw.vehicles) as GameData['vehicles']),
    jobs: checkJobs((({ _doc, ...j }) => j)(parse('jobs', jobs, raw.jobs)) as GameData['jobs'], parse('cast', cast, raw.cast), parse('missions', missions, raw.missions) as GameData['missions'], parse('vehicles', vehicles, raw.vehicles) as GameData['vehicles']),
  }
}
