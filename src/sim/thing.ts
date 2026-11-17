import { v3, type Vec3 } from './math.ts'

// One type for everything in the world. Kinds branch behavior; fields a kind does
// not use stay at their defaults. Add fields here, never subclass.

export const Kind = { session: 'session', skater: 'skater', car: 'car', npc: 'npc', ped: 'ped', actor: 'actor' } as const
export type ThingKind = (typeof Kind)[keyof typeof Kind]

export const State = { ground: 'ground', air: 'air', bail: 'bail', grind: 'grind', lip: 'lip', wall: 'wall', walk: 'walk', drive: 'drive' } as const
export type SkaterState = (typeof State)[keyof typeof State]

export type TrickRun = { id: string; kind: 'flip' | 'grab'; tick: number; phase: 'run' | 'enter' | 'hold' | 'exit'; held: number; named?: string; dir?: string; tapAt?: number }   // dir: the direction it was picked by (a diagonal's second key may still come, tricks.dirTicks); tapAt: the trick tick of the last J (the double and triple tap)   // named: the body's turn made it a named trick (tricks.json named: a Bigspin) as it began
export type ComboEntry = { id: string; name: string; points: number }
export type BalanceRun = { id: string; name: string; ticks: number; balance: number; balanceVel: number }
export type LipRun = BalanceRun & { line: number; s: number }
export type WallRun = { n: Vec3; ticks: number }
/** An NPC skater's autopilot (src/sim/game/npc.ts): the line it rides and its trick plan. */
export type NpcRun = {
  line: number      // index into park.lines
  i: number         // next waypoint
  lastUp: number    // tick of its last push
  plan: number      // ticks to the next trick try
  act: string       // '', 'charge', then the air trick ('flip', 'grab', 'grind', 'ollie'), 'grinding', 'bailed'
  actTicks: number
  actEnd: number
  dir: number       // the direction button of the trick
  slow: number      // ticks nearly stopped
  speed: number     // its cruising speed
  look: number      // 0..999, fixed per NPC: which character and outfit the view gives it
  racer?: RacerRun  // a Hill Bomb rival (game/npc.ts): absent for park NPCs
  skate?: LocalRun  // a S.K.A.T.E. local (game/skate.ts): absent for the others
  watch?: number    // a park NPC watching a S.K.A.T.E. game: its crowd spot (data run.skate.spot.crowd); absent when riding
  life?: NpcLife    // a park NPC's style, skill and combo state (game/npc.ts); racers and locals have none
  shouted?: number  // the tick it last shouted at a vehicle coming at it (game/vehicles.ts; absent until then)
}
/**
 * A park NPC skater's character and the state of its combo (game/npc.ts): style (data npc.styles:
 * tech, gnar, cruiser), skill 0..1, links (combo links left: a manual, a grind, a flip out), next (the
 * air act its coming pop is for), hold (ticks to hold that grab), sloppy (this try goes wrong), send
 * ('', gap or wall: it goes for this line's end), wait (ticks waited for its turn at a spot), cheer
 * (tick of its last cheer), copy (a line it rides after the player: x, y, pop 0|1, speed per point).
 */
export type NpcLife = { style: string; skill: number; links: number; next: string; hold: number; sloppy: boolean; send: string; wait: number; cheer: number; copy?: number[] }
/**
 * A try at the S.K.A.T.E. spot (game/skate.ts), the player's or a local's: ready (none yet), in the
 * air, in a manual, landed (waiting for the combo to bank), done (ok, the trick and its name, or why not).
 */
export type SkateTry = { phase: 'ready' | 'air' | 'manual' | 'landed' | 'done'; ground: boolean; manualTicks: number; ok: boolean; trick: string; name: string; reason: string
  at: number }   // metres from the mark where the try started (-1: none yet)
/** The trick autopilot (game/skate.ts): riding the lane, counting down to the pop, in the air, rolling out. */
export type TrickPilot = { ride: 'run' | 'count' | 'air' | 'out'; count: number; air: number; airT: number; man: number; i: number; lastUp: number }
/** How a trick is gone for: the trick, landed or not, and when not, how it goes wrong (late: the flip or grab is still on at touchdown; twist: lands twist radians crooked, sketchy; fall: lets the manual go at tick failAt). */
export type TrickPlan = { trick: string; make: boolean; miss: 'late' | 'twist' | 'fall'; twist: number; failAt: number }
/** A S.K.A.T.E. local: which one (data run.skate.locals), riding its try (go) or waiting, its plan, autopilot and try. */
export type LocalRun = { id: string; name: string; go: boolean; plan: TrickPlan; pilot: TrickPilot; try: SkateTry }
/**
 * A pedestrian (game/peds.ts): the sidewalk line it walks (curb: an index into the park's curbs, -1
 * while out of the world), how far along (s, m) and which way (dir), its walking speed (m/s), look
 * (0..999: which person the view draws), side (m left of its line now) and to (where it is stepping:
 * 0 back on the line), stagger (ticks left knocked back), close (its closest pass by the player at
 * speed this time, m; 99 when none), cool (ticks before it counts again), phone (never looks up), act
 * (for the view: walking, stepping aside, knocked down) and since (the world tick it started).
 */
export type PedRun = { curb: number; s: number; dir: number; speed: number; look: number; side: number; to: number; stagger: number; close: number; cool: number; phone: boolean
  missed?: number   // the tick this walker last paid a NEAR MISS (absent until then; again after nearMiss.again seconds)
  shouted?: number  // the tick this walker last shouted at a vehicle (absent until then; vehicles.reactions.shoutCooldown)
  act: 'walk' | 'aside' | 'down'; since: number }
/**
 * A character the story moves (kind 'actor': game/missions.ts places a follow step's, `actor spawn` others;
 * game/movers.ts moves them). who: a cast id (data/cast.json), whom the view draws. mode: escort (along
 * path at pace; it waits for you when you fall more than wait metres behind along it, goes again once
 * you are within resume, and says so when you get lead metres ahead of it) or follow (after you, gap
 * metres off, at up to pace; lost far behind, it catches up). s: metres along the path; i: the segment
 * it is on; speed now; state hold (not set off yet), go, wait or done (at the path's end); ahead: you
 * are past it now (escort); ticks in this state.
 */
export type ActorRun = { who: string; s: number; mode: 'escort' | 'follow' | 'ride'; path: [number, number][]; i: number; pace: number; speed: number
  state: 'hold' | 'go' | 'wait' | 'done'; wait: number; resume: number; lead: number; gap: number; ahead: boolean; ticks: number
  car?: number }   // ride: the vehicle it rides in as a passenger (a carry step), at the passenger seat
/**
 * The mission on now (game/missions.ts, docs/mechanics/missions.md): which, its step and ticks in it,
 * the line of the conversation showing (talk: -1 before it starts), an offer waiting for accept or
 * decline, times done (trick), items picked (collect), the clock (ticks left, -1: none), armed (deliver:
 * picked up; follow: the character set off), away (follow: ticks too far behind), the character it moves
 * (actor: a Thing id, -1: none), metres of the grind in progress (trick grind), wrap (a mode step's game is on).
 */
export type MissionRun = { id: string; step: number; ticks: number; talk: number; offer: boolean; count: number; got: number[]; clock: number
  armed: boolean; away: number; actor: number; grind: number; wrap: boolean }
/** A Hill Bomb rival's race: its name, the next gate, released yet, its race clock, its place once finished. */
export type RacerRun = { name: string; gate: number; go: boolean; ticks: number; place: number; standing: number }
/** Towed behind a car (skitch.ts): the car, where you hang (metres left of its middle), which end of the board leads, the next honk. */
export type SkitchRun = BalanceRun & { car: number; side: number; lead: number; honkAt: number; meters: number }
/** A car driving the city's streets (src/sim/game/traffic.ts). pos is the road under its middle, fwd its travel direction (with the slope). */
export type CarRun = {
  path: number; s: number; dir: number   // street path, arc length along it, +1 / -1 along its points
  speed: number; cruise: number          // m/s
  robo: boolean                          // a robotaxi: stops dead for you, hazards on, no horn rage
  paint: number                          // body colour index for the view
  wait: number                           // ticks stopped for the skater
  honked: boolean
  yielding: boolean                      // the skater is in its lane ahead
  hazard: boolean                        // robotaxi hazards blinking
  turn: number                           // radians it turned this tick (+ = counterclockwise): riders turn with it
  tram?: TramRun                         // the Muni Race's streetcar (game/muni.ts): on its line's rails, not the streets (path -1, s along the route)
  chase?: ChaseRun                       // the Robotaxi Escape's robotaxi (game/escape.ts): drives the streets toward you
  drive?: DriveRun                       // a drivable vehicle (game/vehicles.ts): the crew van, a mission vehicle; not on the streets (path -1)
}
/**
 * A drivable vehicle (game/vehicles.ts, docs/mechanics/driving.md; data/vehicles.json): its type and name
 * (crew_van), the skater at the wheel (its Thing id; -1: nobody), heading (radians clockwise from north),
 * yawRate (rad/s, + = clockwise), steer (the front wheels, radians, + = right), on its wheels or in the air,
 * the handbrake on, the last throttle (-1 reverse or brake .. 1, for the view and sound), ticks before
 * the next vanBump event, the tick of the last honk.
 */
export type DriveRun = { type: string; name: string; driver: number; heading: number; yawRate: number; steer: number; ground: boolean; handbrake: boolean; throttle: number; bumpCool: number; hornAt: number
  ride?: ScooterRun }   // a rental scooter's (types.<t>.scooter): absent on other vehicles, so their worlds hash as before
/** A rental scooter's state: charge (ticks of riding left), rideTicks (this ride so far), low (it said low battery), tipped (ditched: lying on its side till someone rides it). */
export type ScooterRun = { charge: number; rideTicks: number; low: boolean; tipped: boolean }
/**
 * The Muni Race's streetcar: its line (data run.muni.lines id), the stop it is running to or standing
 * at (n, index into the line's stops), dwelling (doors open, wait ticks left) or running, done at the
 * last stop; bell: it rang for a skater on the track ahead.
 */
export type TramRun = { line: string; n: number; phase: 'dwell' | 'run' | 'done'; wait: number; bell: boolean
  roam?: true }   // a free-roam streetcar (run.muni.roam lines), not the race's
/**
 * The Robotaxi Escape's robotaxi: recalc (ticks of recalculating left: slowed), plan (ticks to the
 * next route plan), where it is on its street graph (from node at toward node to, u metres along;
 * game/escape.ts), the nodes it means to drive after `to` (route, the next few of its last plan),
 * the tick of its next polite honk.
 */
export type ChaseRun = { recalc: number; plan: number; at: number; to: number; u: number; route: number[]; honkAt: number }
/** The last landing, for celebrations: filled at touchdown, completed when its combo banks. */
export type LandRecord = { tick: number; airTicks: number; quality: 'none' | 'clean' | 'sketchy' | 'stumble'; impact: number; points: number; multiplier: number; combo: string; bankTick: number }
export type DirPress = { d: 'up' | 'down' | 'left' | 'right'; tick: number }
export type GrindRun = { line: number; s: number; speed: number; slide: boolean; id: string; name: string; ticks: number; balance: number; balanceVel: number; side: number
  far: number   // +1 when the far side of the rail is left of the line direction
  fs: boolean   // frontside: the chest faced the rail on the way in
  car: number   // a car's edge (its id; line is then the edge index, carlines.ts), or -1 for a park line
  popLate?: true   // ollie released before grind.voidTicks: the pop waits for them (a void grind gives no pop)
  tapped?: true    // the double tap's second press came after the lock-on and made this its variant (once)
  lastTap?: number // tick of the last grind press on this grind, the catch counting as one (a press within grind.switchTicks of it is mashing, not a switch)
  stance?: 'fakie' | 'nollie' | 'switch'   // the stance it was ridden in (Fakie / Nollie / Switch FS Crooked): its name and points
  turn?: number    // radians the catch turned the board (along the line, or across it for a slide): the view eases it in
  prev?: string    // the grind it switched from on this rail (the view blends from its pose)
  snap?: [number, number, number]   // where the skater was, from where the catch put it on the line (m): the view eases it onto the edge over a few ticks
}

/** The two-player games (game/twoplayer.ts): Trick Attack, HORSE, Graffiti. */
export type TwoPlayerMode = 'trickattack2p' | 'horse2p' | 'graffiti2p'

export type Thing = {
  id: number
  kind: ThingKind
  alive: boolean
  player?: 2               // the second player's skater and session (absent: player 1, or not a player; game/twoplayer.ts)
  // body
  pos: Vec3
  vel: Vec3
  fwd: Vec3                // board forward, unit, kept perpendicular to up
  up: Vec3                 // surface normal while grounded, eases to world up in the air
  // skater
  state: SkaterState
  stateTicks: number       // ticks spent in the current state
  airTicks: number         // length of the last completed air
  airPeakZ: number
  crouch: boolean          // ollie held on the ground
  // board (docs/mechanics/board.md)
  steer: number            // the rider's deck lean input, -1..1, + = turning right (clockwise from above)
  lean: number             // deck roll for the view, radians, + = the board's right edge (nose forward) down
  slip: number             // sideways slip of the wheels, m/s, + = sliding toward the board's right
  load: number             // normal load in g (1 on flat ground, more in transitions, less over crests)
  groundTri: number        // the triangle under the wheels (-1 in the air): its surface sets the rolling resistance
  powerslide: number       // 0, or the side the board swung to (+1 counterclockwise from above, -1 clockwise)
  slideLead: number        // which end led when the powerslide started (+1 nose, -1 tail)
  slideTicks: number       // length of the powerslide so far
  bertTicks: number        // ticks of it crouched at speed (a hand down: a Bert slide)
  footTrick: string        // the foot trick this air started with ('' / boneless / nocomply), for the view
  wobble: number           // speed wobble amplitude, 0..1 (1 throws you off)
  wobblePhase: number      // radians
  stumble: number          // ticks left of a stumble after a rough landing
  safe: Vec3               // last position on solid, gentle ground (wedged in the air, the skater goes back here)
  // on foot (docs/mechanics/walk.md); state 'walk', the board carried
  footAir: boolean         // on foot and off the ground (jumping, falling)
  climb: number            // ticks left of climbing onto a ledge (0 = not climbing)
  climbLen: number         // ticks the climb takes in all (a pull-up from a hang is slower)
  climbFrom: Vec3
  climbTo: Vec3
  stride: number           // metres walked, for the legs' phase and footsteps
  hang: boolean            // hanging from a ledge by the hands (walked off it slowly)
  hangTop: Vec3            // where pulling up puts the feet: the ledge top
  // signals for the view (src/sim/skater/signals.ts); never read by the physics
  danger: number           // 0..1: a bail is coming (a landing that will bail, balance near the edge, wobble)
  lastLand: LandRecord
  carRide: number          // id of the car whose roof or hood the skater rides (-1: none)
  drive?: number           // id of the vehicle the skater drives (state 'drive'; absent on foot or on the board, so worlds without driving hash as before)
  car: CarRun | null       // kind 'car' only
  skitch: SkitchRun | null // towed behind a car (skitching)
  npc: NpcRun | null       // kind 'npc' only: its autopilot
  actor?: ActorRun         // kind 'actor' only: a character the story moves (game/missions.ts, game/movers.ts); pos is a skater's middle
  ped?: PedRun             // kind 'ped' only (absent on every other Thing, so worlds without walkers hash as before); pos is its feet
  vertAir: boolean         // this air started off a vert wall
  takeoffN: Vec3           // surface normal at takeoff
  prevB: number            // last tick's buttons, for press/release edges
  charge: number           // ticks of crouch charge for the next ollie
  popped: boolean          // this air started with an ollie
  spin: number             // rotation this air, radians (+ = left/counterclockwise)
  spinVel: number
  trick: TrickRun | null   // trick running now
  combo: ComboEntry[]      // tricks in the current combo
  score: number
  grindPress: number       // ticks left on a buffered grind press
  grind: GrindRun | null   // the grind running now
  landGrace: number        // ticks left to manual or revert before the combo banks
  landSteep: boolean       // last landing was on a transition (revert allowed)
  dirHist: DirPress[]      // recent direction presses, for manuals and specials
  manual: BalanceRun | null
  lip: LipRun | null
  wall: WallRun | null
  wallplanted: boolean     // one wallplant per air
  // Absent until used in an air (so worlds without them hash as they did), cleared on landing:
  lipped?: boolean         // a lip trick this air (one per air)
  wallrides?: number       // wallrides this air (at most combo.wallridesPerAir)
  offZ?: number            // the height of the grind this air left (lines no higher are caught only on the way down)
  left?: { id: string; slide: boolean; fs: boolean; stance?: 'fakie' | 'nollie' | 'switch' }   // the grind or slide this air left (the view blends out of its pose; cleared on landing)
  slideTurn?: number       // radians the skater was turned back in line with travel as it left a slide (the view eases it out over the first air ticks; cleared on landing)
  stance?: 'fakie' | 'nollie' | 'switch'   // how this air was popped (absent: regular): rolling forward off the tail (regular) or the nose (nollie), rolling backward off the tail (fakie) or the nose (switch); its tricks carry the name and data tricks.stance's points
  grindTaps?: number       // 2: I pressed again while the grind press was still buffered (the double tap's variant grind)
  wedged?: number          // ticks stopped on the ground on a slope steeper than ground.safeNormalZ (absent otherwise; 60 puts it back where it last stood)
  marker?: { x: number; y: number; z: number; heading: number; speed: number; fakie: boolean }   // the session marker (skater/marker.ts; absent until one is set)
  bump?: number            // ticks left of the board's front lift after a curb roll-up (skater.ts curbHop, ground.curbHopBumpTicks; for the view; absent otherwise)
  getUp?: true             // getting up early from a bail (skater.ts stepBail: the bail clock runs fast to its end; absent otherwise)
  revertWant?: number      // ticks left on a revert pressed in the air (it counts on touching down on a transition; absent otherwise)
  spine: boolean           // this air is a spine transfer (one per air)
  spineWant: number        // ticks left of a buffered spine-transfer press
  special: number          // special meter, 0..1
  takeoffXY: [number, number] // where this air started (air gaps)
  lastLine: number         // grind line of the last grind or lip (line gaps)
  // session
  mode: 'free' | 'run' | 'courier' | 'combo' | 'bomb' | 'skate' | 'level' | 'muni' | 'escape' | 'graffiti' | TwoPlayerMode | 'ending' | 'over'   // what is on now (ending: time is up, the last combo may land)
  game: 'free' | 'run' | 'courier' | 'combo' | 'bomb' | 'skate' | 'level' | 'muni' | 'escape' | 'graffiti' | TwoPlayerMode   // the game started last (stays through ending and over, for the results)
  timeLeft: number         // ticks left on the clock (run, courier, combo)
  courierLeg: number       // courier: index into data run.courier.legs of the order being carried
  courierDone: number      // courier: deliveries made
  courierCarrying: boolean // courier: an order is on board (false before the first pickup and after a fail)
  raceRoute: string        // hill bomb: the route raced (data run.bomb id or one of its routes)
  // Set when a hill bomb starts (absent before, so worlds without a race hash as they did):
  racePlace?: number       // hill bomb: the player's place right now (1-based; 0 before the start line)
  raceOf?: number          // hill bomb: how many race (the player and the racers)
  raceFinished?: number    // hill bomb: how many have crossed the finish
  raceGate: number         // hill bomb: the next gate to cross (0: the start line)
  raceTicks: number        // hill bomb: ticks since the start line
  racePenalty: number      // hill bomb: penalty ticks for falls
  raceFalls: number        // hill bomb: falls during the race
  raceBraked: boolean      // hill bomb: the foot brake or a powerslide was used during the race
  // Set when a game of S.K.A.T.E. starts (absent before, so other worlds hash as they did); the clock is timeLeft:
  skateLocal?: number      // S.K.A.T.E.: the local's Thing id
  skateName?: string       // S.K.A.T.E.: the local's name
  skateTurn?: 'player' | 'local'   // S.K.A.T.E.: whose try it is
  skateRole?: 'set' | 'match'      // S.K.A.T.E.: setting a trick, or matching one
  skateTrick?: string      // S.K.A.T.E.: the trick to match ('bs180+kickflip'; '' when setting)
  skateTrickName?: string  // S.K.A.T.E.: its name ('BS 180 Kickflip')
  skatePlayer?: string     // S.K.A.T.E.: the player's letters ('SK')
  skateLocalLetters?: string   // S.K.A.T.E.: the local's letters
  skatePause?: number      // S.K.A.T.E.: ticks before the turn's clock starts
  skateUsed?: string[]     // S.K.A.T.E.: tricks set this game (none can be set twice)
  skateTry?: SkateTry      // S.K.A.T.E.: the player's try this turn
  // Two players (game/twoplayer.ts; absent until a two-player game starts, so other worlds hash as they did).
  // The game (mode, game, timeLeft and the fields below marked "game") is on player 1's session, mirrored
  // (mode, game, timeLeft) on player 2's; each player's own score and combo are on its skater.
  horseWord?: string       // game: HORSE, the word in play (data run.twoPlayer.horse)
  horseTurn?: 1 | 2        // game: whose try it is
  horseRole?: 'set' | 'match'   // game
  horseTrick?: string      // game: the trick to match (a S.K.A.T.E. trick key; '' when setting)
  horseTrickName?: string  // game
  horsePause?: number      // game: ticks before the turn's clock starts
  horseUsed?: string[]     // game: tricks set this game
  horseTry?: SkateTry      // game: the try this turn
  horseLetters?: string    // each player's session: its HORSE letters ('HO')
  tags?: Record<string, { player: 1 | 2; points: number }>   // game: Graffiti (two-player, and solo: game/graffiti.ts), obstacle ('line:12': park grind line 12; 'gap:big3') -> its owner and the combo that tagged it
  tagging?: string[]       // each player's session: Graffiti, the obstacles in its open combo (tagged when it banks)
  owned?: number           // each player's session: Graffiti, how many obstacles it owns now
  // The Muni Race (game/muni.ts; absent before one, so other worlds hash as they did):
  muniLine?: string        // the line raced (data run.muni.lines id)
  muniTram?: number        // the streetcar's Thing id
  muniReached?: number[]   // the stops you have reached (indexes into the line's stops; the start is 0)
  muniFrom?: number        // the tick the race started
  muniRoam?: boolean       // the race took the free-roam streetcars away: they come back when it is cleared
  // The Robotaxi Escape (game/escape.ts; absent before one); the clock is timeLeft:
  escapeTaxi?: number      // the robotaxi's Thing id
  escapeNear?: number      // ticks it has been within escape.catch metres, in a row
  escapeClose?: boolean    // within escape.close metres now (escapeClose fired; re-armed past close + closeOut)
  escapeHide?: number      // ticks you have been more than backup.far from every street, in a row (absent: on or near one)
  escapeBackup?: number    // the backup robotaxi's Thing id, once called
  // Set when a Tour level starts (absent before, so other worlds hash as they did); letters and the clock are letters and timeLeft:
  level?: string           // Tour: the level's id (data/tour.json)
  levelGoals?: string[]    // Tour: its goals done this run (pro, sick, skate, tape and the level's own ids)
  tape?: boolean           // Tour: the secret tape found this run
  away?: boolean           // Tour: far outside the level's area (the wrong-way hint is up)
  grindRun?: number        // Tour: metres of the grind in progress (grind goals)
  levelMarks?: Record<string, number>   // Tour: dash goals, the tick the skater was last inside each one's from box
  mission?: MissionRun     // the mission on now (game/missions.ts; absent without one, so other worlds hash as they did)
  cityGoals: string[]      // city goals (data/goals.json) completed this session
  hopCar: number           // the car the skater cleared in this air (-1: none, -2: this air left a car), for car-hop gaps
  onCar: boolean           // last tick the skater rode or ground a car
  hopRobo: boolean         // ... and whether it was a robotaxi
  carHops?: Record<string, number>   // car id -> the tick its car hop last paid (absent until the first; the same car pays again after the gap's again seconds)
  comboOpen: boolean       // a combo is open
  comboFrom: [number, number] // where the open (or last) combo started, for area combo goals
  letters: string          // letters collected this run
  burritos: number[]       // indices into data run.burritos collected this run or free session
  gapsHit: string[]        // distinct gaps this run
  goalsDone: string[]
  bestCombo: number
  // session
  spot: string             // last spawn/teleport spot
}

export function makeThing(id: number, kind: ThingKind): Thing {
  return {
    id, kind, alive: true,
    pos: v3(), vel: v3(), fwd: v3(0, 1, 0), up: v3(0, 0, 1),
    state: State.air, stateTicks: 0, airTicks: 0, airPeakZ: 0,
    crouch: false, vertAir: false, takeoffN: v3(0, 0, 1),
    steer: 0, lean: 0, slip: 0, load: 1, groundTri: -1, powerslide: 0, slideLead: 1, slideTicks: 0, bertTicks: 0, footTrick: '', wobble: 0, wobblePhase: 0, stumble: 0, safe: v3(),
    footAir: false, climb: 0, climbLen: 1, climbFrom: v3(), climbTo: v3(), stride: 0, hang: false, hangTop: v3(),
    carRide: -1, car: null, skitch: null, npc: null,
    danger: 0, lastLand: { tick: -1, airTicks: 0, quality: 'none', impact: 0, points: 0, multiplier: 0, combo: '', bankTick: -1 },
    prevB: 0, charge: 0, popped: false, spin: 0, spinVel: 0, trick: null, combo: [], score: 0,
    grindPress: 0, grind: null,
    landGrace: 0, landSteep: false, dirHist: [], manual: null, lip: null, wall: null, wallplanted: false, spine: false, spineWant: 0, special: 0,
    takeoffXY: [0, 0], lastLine: -1, mode: 'free', game: 'free', timeLeft: 0, courierLeg: 0, courierDone: 0, courierCarrying: false, raceRoute: '', raceGate: 0, raceTicks: 0, racePenalty: 0, raceFalls: 0, raceBraked: false, cityGoals: [], hopCar: -1, onCar: false, hopRobo: false, comboOpen: false, comboFrom: [0, 0], letters: '', burritos: [], gapsHit: [], goalsDone: [], bestCombo: 0,
    spot: '',
  }
}
