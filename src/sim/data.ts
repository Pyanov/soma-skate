// Shapes of the data files the sim reads. Validation lives in src/data/schema.ts
// (outside the sim); the sim only sees typed, validated data.

export type Physics = {
  tickHz: number
  gravity: number
  skater: { radius: number }
  ground: {
    pushAccel: number
    maxPushSpeed: number
    rollingResistance: number      // Crr: rolling resistance per unit normal load (park concrete)
    rollingByType: Record<string, number>   // Crr by surface element type (city road, sidewalk, grass...)
    footBrakeDecel: number
    footBrakeFullSpeed: number
    footBrakeHighSpeed: number
    footBrakeHighFactor: number
    snapDistance: number
    maxSnapAngleDeg: number
    groundMinNormalZ: number; safeNormalZ: number   // safe: ground the skater can stop on (the last such spot is where unstuck puts it back)
    crouchPump: number
    stickGap: number
    transitionDeg: number
    transitionStickGap: number
    curbHop: number; curbHopDeg: number; curbHopMinSpeed: number; curbHopDepth: number; curbHopKeep: number; curbHopBumpTicks: number   // rolling up a low step (skater.ts curbHop); bumpTicks: the view's front lift
  }
  board: {
    leanMaxDeg: number; leanIn: number; leanOut: number
    leanAtSpeed: { from: number; to: number; tauIn: number; tauOut: number }   // lean as a smooth lag at bombing speed (see board.ts)
    minRadius: number; carveAccel: number; pivotRate: number; pivotMaxSpeed: number
    park: { from: number; to: number; minRadius: number; carveAccel: number; grip: number }   // park-speed carve, blended out from..to m/s (board.ts carveAt)
    grip: number; slideFriction: number; carveSlipMaxDeg: number; recoverYawRate: number; slipMinSpeed: number
    loadSmoothing: number
  }
  aero: { airDensity: number; massKg: number; cdaStand: number; cdaTuck: number }
  slide: { minSpeed: number; angleDeg: number; steerDeg: number; yawRate: number; minScoreTicks: number; bertSpeed: number }
  wobble: { speed: number; tuckSpeed: number; grow: number; seed: number; damp: number; crouchDamp: number; carveDamp: number; hz: number; leanDeg: number }
  walk: {
    runSpeed: number; walkSpeed: number; backSpeed: number; accel: number; decel: number; turnRate: number; jumpSpeed: number
    stepHeight: number; climbMax: number; climbTicks: number; maxSlopeDeg: number; maxStepOffSpeed: number; hardLandSpeed: number; stumbleTicks: number
    hangMinDrop: number; hangMaxSpeed: number; hangDepth: number; pullUpTicks: number
  }
  vert: { minWallDeg: number; topToleranceDeg: number; copingReach: number; copingMinDeg: number; reentry: number }
  spine: { takeoffDeg: number; reach: number; faceMin: number; minDeg: number; landDrop: number; maxSpeed: number; clearance: number; bufferTicks: number }   // spine transfers (spine.ts)
  land: {
    toleranceDeg: number; maxUpDeg: number; cleanDeg: number; stumbleDeg: number; straighten: number
    stumbleSpeed: number; hardSpeed: number; stumbleKeep: number; stumbleTicks: number; slowSpeed: number
  }
  marker: { minSpeed: number }   // the session marker (skater/marker.ts)
  bail: { ticks: number; friction: number; getUpTicks: number; getUpSpeed: number; getUpFrom: number; getUpRate: number }
  air: { spinAccel: number; spinMax: number; spinDecay: number; ledgePop: { ticks: number; minSpeed: number; deg: number; reach: number; maxHeight: number; depth: number; keep: number } }   // ledgePop: skater.ts
  ollie: { popMin: number; popMax: number; chargeTicks: number; lateTicks: number; upMix: number }
  collision: { maxSubstepMove: number; iterations: number }
  surfaces: { flatMaxDeg: number; bankMaxDeg: number; steepMaxDeg: number }
  limits: { maxSpeed: number }
  combo: {
    graceTicks: number; manualWindow: number; manualMinSpeed: number; manualStartSpeed: number; manualComboTilt: number; manualComboRamp: number
    manualInstability: number; manualNoise: number; manualControl: number; manualDamping: number; manualStart: number; manualRamp: number
    revertMinDeg: number; revertBufferTicks: number; lipMaxAlong: number; footWindow: number
    wallReach: number; wallPressTicks: number; wallrideTicks: number; wallrideGravity: number; wallrideMinSpeed: number; wallrideMaxUp: number; wallridesPerAir: number
    wallplantKeep: number; wallplantPop: number; specialPoints: number
  }
  grind: {
    lines: { topMaxDeg: number; sideMinDeg: number; minDrop: number; minLength: number; mergeDeg: number; gridCell: number }   // gridCell: metres, the grid for captures
    captureRadius: number; captureAbove: number; captureBelow: number; bufferTicks: number; slideAngleDeg: number
    friction: number; slideMinSpeed: number; downhillSlope: number; stallSpeed: number; voidTicks: number; switchTicks: number; exitPop: number
    balanceInstability: number; balanceNoise: number; balanceControl: number; balanceDamping: number; balanceStart: number; balanceRamp: number; comboTilt: number; comboRamp: number; regrabAbove: number; sightRadius: number; sightSkip: number
  }
}

export type SpotAlias = { id: string; label: string; spot: string }

export type Dir = 'none' | 'up' | 'down' | 'left' | 'right' | 'upleft' | 'upright' | 'downleft' | 'downright'
/** A flip: dir + J; taps 2 = J pressed again within doubleTapTicks (the variant of that slot). roll +1 = kickflip, yaw +0.5 = BS shove-it, pitch +1 = impossible. */
export type FlipDef = { id: string; name: string; dir: Dir; taps?: 2 | 3; twice?: true; points: number; ticks: number; roll: number; yaw: number; pitch: number }
export type GrabDef = { id: string; name: string; dir: Dir; taps?: 2; points: number; pointsPerSecond: number; enterTicks: number; exitTicks: number }
export type GrindDef = { id: string; name: string; dir: Dir; points: number; pointsPerSecond: number; out?: 'forward' }   // lips: out forward = drops back in forward (the rider turned round), else fakie
/** Stick on a rail: up/down along the board, toward/away = toward the far side of the rail or back to the approach side. */
export type RailDir = 'none' | 'up' | 'down' | 'toward' | 'away' | 'upToward' | 'upAway' | 'downToward' | 'downAway'
/** A grind or slide. nose (slides): where the nose points, over the far side or back over the approach side. */
export type RailDef = { id: string; name: string; dirs: RailDir[]; taps?: 2; points: number; pointsPerSecond: number; nose?: 'far' | 'near' }
/** A flip and a body spin in one air that is one trick by name (360 Shove-It + BS 180 = Bigspin). */
export type NamedDef = { id: string; name: string; points: number; of: string; spin: 'fs180' | 'bs180' | 'fs360' | 'bs360' }
export type ManualDef = { id: string; name: string; points: number; pointsPerSecond: number }
/** A foot trick: an ollie that starts with a foot off the board, chosen by the direction taps just before the pop. */
export type FootDef = { id: string; name: string; points: number; pop: number; seq: ('up' | 'down' | 'left' | 'right')[] }
export type SpecialDef = (Omit<FlipDef, 'dir'> & { kind: 'flip'; seq: Dir[] }) | (Omit<GrabDef, 'dir'> & { kind: 'grab'; seq: Dir[] })
export type Tricks = {
  doubleTapTicks: number   // a second press of J (or I) within this many ticks is a double tap
  dirTicks: number         // a second direction key within this many ticks of J or L (or of the first key) makes a diagonal with it
  stance: { fakie: number; nollie: number; switch: number }   // points multiplier for a trick in that stance
  named: NamedDef[]
  defaults: { flip: string; grab: string; grind: string; slide: string }
  flips: FlipDef[]; grabs: GrabDef[]; grinds: RailDef[]; slides: RailDef[]
  manuals: ManualDef[]; lips: GrindDef[]; specials: SpecialDef[]
  powerslides: ManualDef[]   // powerslide, bertslide (a hand down at speed)
  foot: FootDef[]
  skitch: ManualDef          // towed behind a car (points + per second)
  spine: { id: string; name: string; points: number }   // a spine transfer
}
export type Scoring = { repeat: number[]; spinPer180: number; revertPoints: number; wallplantPoints: number; wallridePoints: number; wallridePointsPerSecond: number }

export type Goal = { id: string; name: string; kind: 'score' | 'letters' | 'gaps' | 'combo' | 'speed' | 'burritos'; value: number }
export type Run = { durationSeconds: number; letterRadius: number; letters: { letter: string; pos: [number, number, number]; hint: string }[]; burritoParks: string[]; burritoRadius: number; burritoPoints: number; burritos: { pos: [number, number, number]; hint: string }[]; goals: Goal[]
  courier: Courier; combo: { seconds: number }; bomb: Bomb; skate: Skate; twoPlayer: TwoPlayer; muni: Muni; escape: Escape; graffiti: { seconds: number } }
/** Muni Race (data/run.json muni; src/sim/game/muni.ts). */
export type MuniLine = { id: string; name: string; cruise: number; rails: string[]; stops: { name: string; at: [number, number] }[] }
export type Muni = { parks: string[]; accel: number; decel: number; creep: number; startDwell: number; dwell: number; stopRadius: number; platform: number; bell: number; bellSide: number
  delay: { chance: number; seconds: [number, number]; says: string[] }; lines: MuniLine[]
  roam: { parks: string[]; layover: number; lines: RoamLine[] } }
/** A free-roam streetcar line (run.muni.roam): a race line's fields, how many cars, the line it goes on as at its end, and where. */
export type RoamLine = MuniLine & { cars: number; pair: string; pairAt?: 'start' | 'nearest'; parked?: [number, number] }
/** Robotaxi Escape (data/run.json escape; src/sim/game/escape.ts). */
export type Escape = { parks: string[]; seconds: number; start: number; cruise: number; accel: number; brake: number; decel: number; stopGap: number; plan: number; link: number; roadLink: { reach: number; height: number; roads: string[]; through: string[] }; lane: number; turnSpeed: number; uTurnSpeed: number
  close: number; closeOut: number; catch: number; catchSeconds: number; honkEvery: number; recalc: { points: number; secondsPer1000: number; maxSeconds: number; speed: number }
  backup: { far: number; seconds: number }; survivalBonus: number }
/** Local two-player (data/run.json twoPlayer; src/sim/game/twoplayer.ts). */
export type TwoPlayer = { join: { side: number }; trickAttack: { seconds: number }; graffiti: { seconds: number }
  horse: { word: string; words: string[]; setSeconds: number; matchSeconds: number; pauseSeconds: number } }
type P3 = [number, number, number]
/** Courier mode (data/run.json courier; src/sim/game/modes.ts). */
export type Courier = { parks: string[]; start: { pos: P3; heading: number; place: string; line: string }; pickupRadius: number; dropRadius: number; dropHeight: number; deliveryPoints: number
  legs: { id: string; to: P3; seconds: number; place: string; line: string }[] }
/** Hill Bomb race (data/run.json bomb). A gate is a line across the street at pos, crossed going dir. */
export type BombRoute = { id: string; name: string; start: { pos: P3; heading: number }; gates: { name: string; pos: P3; dir: [number, number]; halfWidth: number; height: number }[]; maxSeconds: number
  line?: string         // the rider line the racers follow (without one: the start and the gates)
  racers: Racer[] }
/** A Hill Bomb rival: name, look (character and outfit), cruising speed, how far over the corner speed it brakes, how often a second it stands up (and risks the wobbles), where it lines up (metres left of the line). */
export type Racer = { name: string; look: number; speed: number; brakeMargin: number; standUp: number; standFor: number; flipChance: number; offset: number }
/** Game of S.K.A.T.E. (data/run.json skate; src/sim/game/skate.ts): the spot, the clock, the locals. Positions are park [x, y]. */
export type Skate = { parks: string[]; word: string
  // near: a pop this close to the mark is a try (one beyond radius misses: too far); clear: the lane's half-width park NPCs keep off; crowd: where they watch from [x, y, heading]
  spot: { mark: [number, number]; radius: number; near: number; start: [number, number]; end: [number, number]; heading: number; playerWatch: [number, number]; localWatch: [number, number]; watchHeading: number
    clear: number; crowd: [number, number, number][] }
  setSeconds: number; matchSeconds: number; pauseSeconds: number; manualSeconds: number; runSpeed: number; lockTicks: number
  hardness: number; favoriteBonus: number; favoriteChance: number; minMake: number; maxMake: number
  difficulty: Record<string, number>   // per part of a trick: a flip, foot trick, manual, spin (fs180 ...) or 'grab'
  sets: string[]                       // tricks a local may set
  locals: SkateLocal[] }
export type SkateLines = { set: string[]; setMiss: string[]; make: string[]; miss: string[]; youMake: string[]; youMiss: string[]; win: string[]; lose: string[] }
/** A local you play S.K.A.T.E. against: look (character and outfit), skill 0..1, favourite tricks, what they say. */
export type SkateLocal = { id: string; name: string; hood: string; look: number; skill: number; favorites: string[]; lines: SkateLines }
/** The top level is the default route (Dolores, kept where it always was); routes are the others. */
export type Bomb = BombRoute & { parks: string[]; fallPenalty: number; gateRadius: number; gateStep: number; gateLane: number; routes: BombRoute[] }
/** Boxes are [minX, minY, maxX, maxY] in site metres. */
export type Gap =
  // toZ: the landing's height window (the skater's centre); over: polygons [[x, y], ...]: the air, takeoff to landing in plan, passes over one of them (both ends outside it)
  | { id: string; name: string; kind: 'air'; points: number; from: [number, number, number, number]; to?: [number, number, number, number]; minAirTicks?: number; toZ?: [number, number]; over?: [number, number][][]; minMeters?: number; replaces?: string[] }   // minMeters: plan distance from takeoff to landing
  // element: exact, or a prefix ending in *; box: the line passes through it; feature: the export's feature for the line ('car roof')
  | { id: string; name: string; kind: 'grind' | 'lip'; points: number; element: string; box?: [number, number, number, number]; feature?: string; replaces?: string[] }
  | { id: string; name: string; kind: 'car'; points: number; robo?: boolean; again: number; replaces?: string[] }   // clear a sim car in one air, landing off it; the same car pays again only after again seconds
  | { id: string; name: string; kind: 'wall'; points: number; box: [number, number, number, number]; plant?: boolean; replaces?: string[] }   // a wallride (plant: a wallplant) ending inside box
  | { id: string; name: string; kind: 'skitch'; points: number; tram?: boolean; replaces?: string[] }   // a skitch that counted (skitchEnd with points), on a streetcar (tram) or not

export type Rider = { stance: 'regular' | 'goofy' }

/** data/npc.json: NPC skaters per world and how they ride (src/sim/game/npc.ts). */
export type NpcData = { parks: Record<string, { count: number; lines: string[] }>; speed: number; speedJitter: number
  chargeTicks: [number, number]; grabTicks: [number, number]; grindTicks: [number, number]
  styles: Record<string, NpcStyle>
  sloppy: number; lateTicks: number; lapseTicks: number
  sends: { line: string; kind: 'gap' | 'wall'; keep?: number; via: [number, number][]; speed: number }[]
  spots: Record<string, string[]>; maxWait: number; waitGap: number; freeSpot: number; near?: { radius: number; share: number }
  cheer: { points: number; range: number; cooldown: number }
  copy: { points: number; chance: number; range: number; seconds: number }
  trail: { every: number; seconds: number }
  linkRange: number; stuckTicks: number; lostRange: number; castFrom: number }
/** How an NPC skater rides (data npc.json styles): tech links long combos, gnar goes big, cruisers mostly roll. */
export type NpcStyle = { share: number; speed: number; skill: [number, number]; trickEvery: [number, number]
  flipChance: number; grabChance: number; grindChance: number; links: [number, number]; manualChance: number; manualTicks: [number, number]; flipOut: number; send: number }

/** data/peds.json: pedestrians on the city's sidewalks (src/sim/game/peds.ts, docs/mechanics/peds.md). */
export type PedData = { parks: string[]; enabled: boolean; count: number; offset: number; walk: [number, number]; spawnNear: number; spawnFar: number; despawn: number
  radius: number; height: number; hitSpeed: number; swerveKeep: number
  see: { speed: number; time: number; clear: number; fov: number; aside: number; stepSpeed: number; maxSide: number; vehicle: number }
  phone: number; nearMiss: { distance: number; speed: number; points: number; again: number }; cooldown: number; stagger: number }

/** data/goals.json: the city's goal list (src/sim/game/goals.ts). Boxes are [minX, minY, maxX, maxY]. */
type GoalBase = { id: string; name: string; area: string; description: string }
export type CityGoal = GoalBase & (
  | { kind: 'gap'; gaps: string[] }
  | { kind: 'skitch'; meters: number; robo?: boolean }
  | { kind: 'speed'; kmh: number; box: [number, number, number, number]; z?: [number, number] }
  | { kind: 'combo'; points: number; box: [number, number, number, number]; gaps?: string[] }   // gaps: the combo must hold one of these
  | { kind: 'collect'; burritos: number }
  | { kind: 'courier'; deliveries: number }
  | { kind: 'bomb'; route?: string; maxSeconds?: number; noBrakes?: boolean; noFalls?: boolean; win?: boolean })   // route: default the default route; win: first home, ahead of its racers

/** A Tour level's own goal (data/tour.json): the city goal kinds a run can do, plus grind length. */
export type TourGoal = { id: string; name: string; description: string } & (
  | { kind: 'gap'; gaps: string[] }
  | { kind: 'skitch'; meters: number; robo?: boolean }
  | { kind: 'speed'; kmh: number; box: [number, number, number, number]; z?: [number, number] }
  | { kind: 'combo'; points: number; box?: [number, number, number, number]; gaps?: string[]; every?: boolean; tricks?: string[] }   // box: where it started (anywhere when left out); gaps: holding one of them (every: all of them); tricks: holding one of these trick ids
  | { kind: 'grind'; meters: number; box?: [number, number, number, number]; feature?: string }   // one grind at least meters long (inside box; on a line of that export feature, like 'streetcar rail')
  | { kind: 'air'; seconds: number; box: [number, number, number, number] }                     // an air of at least seconds, taken off inside box
  | { kind: 'dash'; from: [number, number, number, number]; to: [number, number, number, number]; seconds: number })   // from the from box into the to box within seconds

/** A Tour level (data/tour.json, docs/mechanics/tour.md). */
export type TourLevel = {
  id: string; name: string; world: string; worlds?: string[]; spot: string
  starts?: string[]                        // other spots a run can start from (`run level <id> <spot>`): a level of two hills
  area: [number, number, number, number]   // [minX, minY, maxX, maxY]: far outside it, a wrong-way hint
  areas?: [number, number, number, number][]   // more boxes of the same level (one far from the rest: Hill Country's Hayes St)
  exclude?: [number, number, number, number][] // boxes inside the area that are not the level (Hill Country: Dolores Park); the hint shows in them at once
  letters: { letter: string; pos: [number, number, number]; hint: string }[]
  tape: { pos: [number, number, number]; hint: string }
  tiers: { pro: number; sick: number }
  goals: TourGoal[]
}

/** data/tour.json: the Tour's levels and the rules of a level run. */
export type Tour = {
  seconds: number; tapeRadius: number
  wrongWay: { away: number; back: number }   // metres outside the area for the hint, and back within for it to clear
  names: { pro: string; sick: string; skate: string; tape: string }
  levels: TourLevel[]
}

/** A car's two boxes in its own frame (x forward, y left, z up from the road under its middle): the body, and the cabin on it. */
export type CarDims = { body: { length: number; width: number; bottom: number; top: number }; cabin: { length: number; width: number; offset: number; top: number } }

/** data/traffic.json: the sim's cars (docs/mechanics/traffic.md). */
export type Traffic = {
  cars: number; robotaxis: number
  cruise: Record<string, number>; cruiseDefault: number; cruiseJitter: number; roboCruise: number
  accel: number; brake: number; roboBrake: number
  lane: { oneway: number; onewayMulti: number; twoWay: number; wide: number }
  yield: { ahead: number; stop: number; side: number; height: number; decel: number; look: number }
  follow: { range: number; gap: number; side: number }
  honkAfter: number; roboHonkAfter: number; hazardAfter: number
  bubble: { spawnNear: number; spawnFar: number; far: number; respawnNear: number; respawnFar: number }
  body: CarDims['body']
  cabin: CarDims['cabin']
  collideRange: number; hitSpeed: number; knock: number
  tram: CarDims & { name: string; collideRange: number }   // the Muni Race's streetcar (game/muni.ts)
  skitch: { reach: number; side: number; height: number; maxRel: number; behind: number; hold: number
    balanceStart: number; instability: number; noise: number; control: number; damping: number; ramp: number
    turnPush: number; turnBail: number; honkFirst: number; honkEvery: number; roboDecel: number; easySpeed: number; minSeconds: number }
}

/** A kind of drivable vehicle (data/vehicles.json types; src/sim/game/vehicles.ts, docs/mechanics/driving.md). */
export type VehicleType = {
  name: string; label: string; dims: CarDims
  wheelbase: number; track: number; maxStep: number; maxDrop: number
  engine: { accel: number; topSpeed: number; reverseAccel: number; reverseTop: number; brake: number; rolling: number; drag: number }
  steer: { maxDeg: number; fade: number; rate: number; back: number }
  grip: { lateral: number; handbrake: number; yawBoost: number; yawAccel: number; yawFade: number; handbrakeDecel: number }
  body: { spheres: number; clearance: number; restitution: number; friction: number; yawKick: number }
  bumpSpeed: number; bumpCooldown: number; driverless: number
  seat?: number    // the rider's height over the ground here, for this type (else vehicles.seat)
  stand?: boolean  // ridden standing, in view (a scooter), not inside
  scooter?: ScooterType
}
/**
 * A rental scooter's rules (data/vehicles.json types.<t>.scooter): battery (seconds of riding on a full
 * charge), low (seconds left when it says so), lowTop (m/s it is held to then, its limiter braking at limiter m/s2 above it); ditch: the ollie off it (a
 * trick of name and points, the pop's up speed, a spin drawn within spinMax rad/s); fare: the
 * ride's price for the view (unlock and perMinute, dollars).
 */
export type ScooterType = { battery: number; low: number; lowTop: number; limiter: number
  ditch: { name: string; points: number; pop: number; spinMax: number }
  fare: { unlock: number; perMinute: number }
  view?: { wheelieDeg: number; swingDeg: number; leanMaxDeg: number } }   // the client's (CarPose van.pitch, van.lean)
/** data/vehicles.json: the vehicle types, getting in and out, the parked ones, van summon. */
export type Vehicles = {
  types: Record<string, VehicleType>
  enter: number; exit: { side: number; speed: number }; seat: number; passenger: number   // passenger: metres right of the middle, a carry step's rider
  parked: { world: string; id: string; type: string; x: number; y: number; heading: number }[]
  summon: { id: string; type: string; near: number; far: number }
  horn: number
  /** Tested routes for mission vehicles (the story writes the missions): the vehicle type, where it starts (x y heading), the lane, bins (a collect step's items), the path. */
  routes: Record<string, { type: string; truck: [number, number, number]; lane: number; bins: [number, number, number][]; path: [number, number][] }>
  /** The world at a driven vehicle: pedestrians' and NPC skaters' shouts, the near miss, the NPCs' look ahead (docs/mechanics/driving.md). */
  reactions: { body: number; nearMiss: number; nearMissSpeed: number; shoutCooldown: number; npcLook: number; npcLane: number; npcSpeed: number; pedShouts: string[]; npcShouts: string[] }
}

/** data/movers.json: how the story's characters move, escorting and following (src/sim/game/movers.ts). */
export type Movers = { accel: number; decel: number; wait: number; resume: number; lead: number; gap: number; catchUp: number; catchBack: number }
/** A line of dialogue (data/missions.json, cast.json chatter): its voice line id (assets/sound/voice/<id>.mp3), who says it, the words, and say: a spelling for the voice where it gets a name wrong. */
export type DialogueLine = { id: string; who: string; text: string; say?: string }
/** A place in a mission: a spot id (data/spots.json aliases or the park's spots), 'cast:<id>' (where that character stands now), or x y z. */
export type Place = string | [number, number, number]
type Box = [number, number, number, number]
/** What a mission's mode step needs to win (docs/mechanics/missions.md). */
export type ModeWin = { deliveries?: number; place?: number; maxSeconds?: number; pieces?: number; best?: number }
/** One step of a mission (src/sim/game/missions.ts). say: barks as it starts; done: barks as it is done; seconds: a clock (fail at 0); actors: cast id -> x y z heading (degrees), where they stand from this step on. */
/** A vehicle a mission or a step places (game/vehicles.ts placeVehicle): its name (the step's vehicle), type (data/vehicles.json types), x y heading (degrees). */
export type MissionVehicle = { name: string; type: string; at: [number, number, number] }
export type MissionStep = { text: string; say?: DialogueLine[]; done?: DialogueLine[]; seconds?: number; actors?: Record<string, [number, number, number, number]>; vehicles?: MissionVehicle[] } & (
  | { kind: 'talk'; who: string; lines: DialogueLine[]; offer?: boolean; phone?: boolean; radius?: number }   // phone: starts at once, wherever you are
  | { kind: 'go'; to: Place; radius?: number }
  | { kind: 'trick'; near?: Place; radius?: number; box?: Box; points?: number; gaps?: string[]; tricks?: string[]; air?: number; grind?: number; feature?: string; count?: number; each?: DialogueLine[] }   // each: barks after every time but the last
  | { kind: 'collect'; items: [number, number, number][]; radius?: number; height?: number; item: string; vehicle?: string; stop?: boolean; each?: DialogueLine[] }   // vehicle: picked up driving it; stop: at most vehicles.exit.speed; each: a bark after every item but the last
  | { kind: 'deliver'; from?: Place; to: Place; radius?: number; noBail?: boolean; item: string; vehicle?: string; noBump?: number }   // noBump: a bump this hard (m/s) spills it
  | { kind: 'drive'; to: Place; radius?: number; vehicle?: string; stop?: boolean }   // drive there (vehicle: a type, a name, or any; stop: stopped there)
  | { kind: 'carry'; who: string; to: Place; radius?: number; vehicle?: string; lines?: DialogueLine[]; every?: number }   // pick them up, drive them there; lines said on the way, one every `every` seconds
  | { kind: 'follow'; who: string; path: [number, number][]; speed: number; distance: number; lose: number
      wait?: number; resume?: number; lead?: number   // metres: it stops for you, goes on, notices you pass (default data/movers.json)
      waiting?: DialogueLine[]; passed?: DialogueLine[] }   // barks (one each time, in turn) as it stops for you, as you pass it
  | { kind: 'race'; who: string; path: [number, number][]; speed: number; distance: number; finish: number }   // who rides path at speed once you are within distance; reach within finish of its end first
  | { kind: 'mode'; mode: 'courier' | 'bomb' | 'muni' | 'escape' | 'skate' | 'graffiti' | 'combo'; route?: string; win: ModeWin })
/** A mission (data/missions.json): a chapter of the story or a side story; or an odd job (kind job), made from data/jobs.json by game/jobs.ts. */
export type Mission = {
  id: string; name: string; kind: 'story' | 'side' | 'job'; chapter?: number; area: string; giver: string; blurb: string
  job?: JobInfo                               // an odd job's board, kind of gig, client, date and slot
  world?: string; worlds?: string[]           // the world it is played in (default sf) and others containing the same ground (the park is inside sf)
  after?: string[]                            // missions done (or skipped) before its marker shows (the client's save)
  actors?: Record<string, [number, number, number, number]>   // cast id -> x y z heading (degrees): where they stand while the mission is on
  vehicles?: MissionVehicle[]                 // placed as it starts, gone when it ends
  reward?: { sticker?: string; unlock?: string; deck?: string; outfit?: string }   // unlock: a secret skater; deck: a board shop graphic (data/boards.json); outfit: character/outfit (the client's picker)
  retry?: number[]                            // steps a failed mission can be tried again from (the latest at or before the failed step; else the first after the offer)
  fail?: Partial<Record<'time' | 'lost' | 'bail' | 'bump' | 'mode', DialogueLine[]>>   // said when it fails that way (the client)
  steps: MissionStep[]
}
/** An odd job's seed and what it is (game/jobs.ts). */
export type JobInfo = { board: string; gig: GigKind; client: string; day: string; slot: number }
export type GigKind = 'deliver' | 'carry' | 'photo' | 'race'
/** data/jobs.json: the gig boards and what their gigs are made of (game/jobs.ts, docs/story.md Odd jobs). */
export type Jobs = {
  after: string[]; perDay: number
  boards: { id: string; name: string; host: string; at: string; area: string; gigs: GigKind[]; hello: DialogueLine; empty: DialogueLine }[]
  deliver: { speed: number; base: number; items: string[]; clients: { who: string; say: DialogueLine; done: DialogueLine; late: DialogueLine }[] }
  carry: { vehicle: MissionVehicle; kerb: number; radius: number; every: number; minFrom: number; maxFrom: number; to: string[]; clients: { who: string; say: DialogueLine; ride: DialogueLine; done: DialogueLine }[] }
  photo: { radius: number; spots: string[]; tricks: { text: string; tricks?: string[]; air?: number; points?: number }[]; clients: { who: string; say: DialogueLine; done: DialogueLine }[] }
  race: { distance: number; finish: number; courses: { id: string; text: string; path: [number, number][] }[]; clients: { who: string; speed: number; say: DialogueLine; done: DialogueLine; won: DialogueLine }[] }
  decks: { deck: string; board: string; gigs: number }[]
}
export type Missions = { talkRadius: number; goRadius: number; collectRadius: number; deliverRadius: number; driveRadius: number; carryRadius: number; carryEvery: number; height: number; intro: string; missions: Mission[] }
/** A character (data/cast.json): where they stand, their sticker, voice and look; chatter: what they say when there is no mission to give. */
export type CastMember = { id: string; name: string; trait: string; sticker: string; voice: string; home: [number, number, number]; heading: number; area: string
  model: { id: string; outfit?: string }; standIn?: boolean; chatter?: DialogueLine[]; post?: DialogueLine[]   // post: said once after the finale (the client)
  inside?: string }   // room/anchor in the city's interiors (city.interiors): they stand there when the world has the room (game/missions.ts homeOf)

export type GameData = {
  cast: { cast: CastMember[] }
  missions: Missions
  jobs: Jobs
  rider: Rider
  traffic: Traffic
  vehicles: Vehicles
  movers: Movers
  run: Run
  gaps: { gaps: Gap[] }
  goals: { parks: string[]; goals: CityGoal[] }
  tour: Tour
  npc: NpcData
  peds: PedData
  physics: Physics
  spots: { default: string; aliases: SpotAlias[]; labels?: Record<string, string> }
  tricks: Tricks
  scoring: Scoring
}
