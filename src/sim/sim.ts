import type { GameData } from './data.ts'
import { hashString } from './hash.ts'
import { headingDir, v3, copy, type Vec3 } from './math.ts'
import type { Park, Spot } from './park/park.ts'
import { seedRng, type RngState } from './rng.ts'
import { Kind, makeThing, State, type ComboEntry, type Thing } from './thing.ts'
import { spawnTraffic } from './game/traffic.ts'
import { spawnStreetcars } from './game/muni.ts'
import { spawnParked } from './game/vehicles.ts'

export type World = {
  format: 'soma-world/1'
  tick: number
  seed: number
  rng: RngState
  npcRng?: RngState   // NPC skaters' own stream (game/npc.ts), so they never change the player's draws
  skateRng?: RngState // the S.K.A.T.E. local's own stream (game/skate.ts): its choices and its physics
  pedRng?: RngState   // pedestrians' own stream (game/peds.ts)
  p2Rng?: RngState    // player 2's own stream (game/twoplayer.ts): its wobbles and balance never change player 1's draws
  trafficRng?: RngState // the cars' own stream (game/traffic.ts): the street network grows with the city, and how many
                        // draws placing the cars takes must not move everyone else's
  muniRng?: RngState  // the Muni Race streetcar's own stream (game/muni.ts): its delays
  tramRng?: RngState  // the free-roam streetcars' own stream (game/muni.ts): their delays (seeded at the first draw)
  npcTrail?: number[] // the player's recent line for park NPCs to copy (game/npc.ts): x, y, pop, speed per point
  nextId: number
  things: Thing[]
}

export type Sim = { world: World; park: Park; data: GameData; dataHash: string }
export type SkateSide = 'player' | 'local'

/**
 * Events, each tagged with the player it belongs to (player: 1 | 2) when someone plays player 2: the
 * skater's own events and its session's (game/twoplayer.ts). Untagged without player 2, as before.
 * Events that already name a player for their own reasons (skateOver's letters, tagged) keep theirs.
 */
export type SimEvent = Tagged<SimEventBase>
type Tagged<E> = E extends { player: unknown } ? E : E & { player?: 1 | 2 }
type SimEventBase =
  | { t: 'air'; tick: number; speed: number; z: number; vert: boolean }
  | { t: 'land'; tick: number; airTicks: number; peakZ: number; speed: number; fakie: boolean; angleErr: number; quality: 'clean' | 'sketchy' | 'stumble'; impact: number }
  | { t: 'powerslide'; tick: number; on: boolean; speed: number }
  | { t: 'unstuck'; tick: number }
  | { t: 'marker'; tick: number; op: 'set' | 'go' | 'clear'; ok: boolean; why?: string }   // the session marker (skater/marker.ts)
  | { t: 'bump'; tick: number; height: number; air?: boolean }   // rolled up a curb (skater.ts curbHop); air: a late ollie set onto a ledge (ledgePop)
  | { t: 'stepOff'; tick: number; speed: number }
  | { t: 'boardDrop'; tick: number; speed: number; air: boolean }
  | { t: 'jump'; tick: number }
  | { t: 'footLand'; tick: number; impact: number }
  | { t: 'climb'; tick: number; height: number }
  | { t: 'hang'; tick: number; drop: number }
  | { t: 'hangEnd'; tick: number; how: 'pull up' | 'let go' }
  | { t: 'danger'; tick: number; why: string }
  | { t: 'honk'; tick: number; car: number; robo: boolean; x: number; y: number; tram?: true; van?: true } // tram: a streetcar's bell (the race car and the free-roam ones), not a horn; van: a driven vehicle's horn (game/vehicles.ts)
  | { t: 'robotaxiStop'; tick: number; car: number; x: number; y: number }
  | { t: 'carHit'; tick: number; car: number; robo: boolean; speed: number; reason: string }
  | { t: 'carLand'; tick: number; car: number }
  | { t: 'skitchStart'; tick: number; car: number; robo: boolean }
  | { t: 'spineTransfer'; tick: number; gap: number; points: number }
  | { t: 'skitchEnd'; tick: number; car: number; reason: string; points: number }
  | { t: 'bail'; tick: number; reason: string }
  | { t: 'recover'; tick: number }
  | { t: 'teleport'; tick: number; spot: string }
  | { t: 'pop'; tick: number; charge: number; fakie: boolean; speed: number; nose?: boolean }
  | { t: 'trickStart'; tick: number; trick: string }
  | { t: 'trickEnd'; tick: number; trick: string; points: number }
  | { t: 'comboLanded'; tick: number; name: string; points: number; multiplier: number; entries: (ComboEntry & { value: number })[] }   // value: the entry's worth after repeats in the combo
  | { t: 'comboLost'; tick: number; name: string }
  | { t: 'grindStart'; tick: number; trick: string; line: string; slide: boolean }
  | { t: 'grindEnd'; tick: number; trick: string; reason: string; points: number }
  | { t: 'manualStart'; tick: number; trick: string }
  | { t: 'manualEnd'; tick: number; trick: string; reason: string; points: number }
  | { t: 'revert'; tick: number; points: number }
  | { t: 'lipStart'; tick: number; trick: string }
  | { t: 'lipEnd'; tick: number; trick: string; reason: string; points: number }
  | { t: 'wallrideStart'; tick: number }
  | { t: 'wallrideEnd'; tick: number; reason: string; points: number }
  | { t: 'wallplant'; tick: number; points: number }
  | { t: 'specialReady'; tick: number }
  | { t: 'gap'; tick: number; id: string; gap: string; points: number }
  | { t: 'letter'; tick: number; letter: string; have: string }
  | { t: 'burrito'; tick: number; n: number; of: number; points: number }
  | { t: 'goal'; tick: number; goal: string }
  | { t: 'runStart'; tick: number; seconds: number }
  | { t: 'runOver'; tick: number; score: number; goals: string[]; bestCombo: number }
  // Tour (game/tour.ts): a level run. goals: the ids done this run (pro, sick, skate, tape, the level's own).
  | { t: 'levelStart'; tick: number; level: string; seconds: number }
  | { t: 'levelGoal'; tick: number; level: string; id: string; name: string }
  | { t: 'tapeFound'; tick: number; level: string }
  | { t: 'levelWrongWay'; tick: number; level: string }   // far outside the level's area: show "wrong way, back to the level"
  | { t: 'levelBack'; tick: number; level: string }       // back in it: hide the hint
  | { t: 'levelOver'; tick: number; level: string; score: number; goals: string[]; tape: boolean }
  | { t: 'courierPickup'; tick: number; leg: number; id: string; place: string; line: string; to: [number, number, number]; seconds: number; timeLeft: number; bonus?: number }
  | { t: 'courierDeliver'; tick: number; n: number; id: string; place: string; points: number; timeLeft: number }
  | { t: 'courierFail'; tick: number; delivered: number; id: string; place: string }
  | { t: 'courierOver'; tick: number; deliveries: number; score: number; bestCombo: number }
  | { t: 'comboStart'; tick: number; seconds: number }
  | { t: 'comboOver'; tick: number; best: number; score: number }
  | { t: 'bombReady'; tick: number; route: string; name: string; gates: number }
  | { t: 'bombStart'; tick: number; route: string; gate: string }
  | { t: 'bombCheckpoint'; tick: number; route: string; n: number; of: number; gate: string; time: number }
  | { t: 'bombFinish'; tick: number; route: string; time: number; penalty: number; falls: number; total: number; braked: boolean; place: number; of: number }
  | { t: 'racerFinish'; tick: number; route: string; id: number; name: string; place: number; time: number }
  | { t: 'goalComplete'; tick: number; id: string; name: string; area: string }
  | { t: 'npcTrick'; tick: number; id: number; trick: string; points: number }
  | { t: 'npcGrind'; tick: number; id: number; trick: string }
  | { t: 'npcLand'; tick: number; id: number; trick: string; points: number }
  | { t: 'npcBail'; tick: number; id: number; reason: string }
  | { t: 'npcCombo'; tick: number; id: number; points: number; name: string; multiplier: number }   // a park NPC banked a combo (the view floats its points)
  | { t: 'npcCheer'; tick: number; id: number }   // a park NPC near you saw your big combo: it stomps its board
  | { t: 'npcCopy'; tick: number; id: number }    // a park NPC starts riding your last line after you
  | { t: 'npcSend'; tick: number; id: number; kind: 'gap' | 'wall'; line: string }   // a gnar NPC goes for it: off the Big 3 (gap) or out of the Hellride (wall)
  | { t: 'bombFail'; tick: number; route: string; reason: string; gate: number; time: number }
  // Game of S.K.A.T.E. (game/skate.ts). who / by / winner: 'player' or 'local'. trick: a trick's key
  // ('bs180+kickflip'), name: its name ('BS 180 Kickflip'). line: what the local says ('' when quiet).
  | { t: 'skateStart'; tick: number; local: string; name: string; hood: string; word: string }
  | { t: 'skateTurn'; tick: number; who: SkateSide; role: 'set' | 'match'; trick: string; name: string; seconds: number }
  // at: metres from the mark where the try started (-1: there was none).
  | { t: 'skateSet'; tick: number; by: SkateSide; trick: string; name: string; at: number; line: string }
  | { t: 'skateSetMiss'; tick: number; by: SkateSide; reason: string; got: string; at: number; line: string }
  | { t: 'skateMatch'; tick: number; by: SkateSide; ok: boolean; trick: string; name: string; got: string; reason: string; at: number; line: string }
  | { t: 'skateLetter'; tick: number; who: SkateSide; letters: string }
  | { t: 'skateOver'; tick: number; winner: SkateSide; name: string; player: string; local: string; line: string }
  // Pedestrians (game/peds.ts): id is the walker's Thing id.
  | { t: 'pedHit'; tick: number; id: number; speed: number; bail: boolean }   // you ran into one (bail: fast enough to fall; else a swerve)
  | { t: 'nearMiss'; tick: number; id: number; points: number; distance: number }   // passed close at speed: NEAR MISS in the combo
  | { t: 'pedStep'; tick: number; id: number; side: number }   // one saw you coming and steps aside (side: metres left of its line)
  // Two players (game/twoplayer.ts). winner 0: a draw.
  | { t: 'player2'; tick: number; joined: boolean }
  | { t: 'trickAttackStart'; tick: number; seconds: number }
  | { t: 'trickAttackOver'; tick: number; scores: [number, number]; winner: 0 | 1 | 2 }
  | { t: 'horseStart'; tick: number; word: string }
  | { t: 'horseTurn'; tick: number; who: 1 | 2; role: 'set' | 'match'; trick: string; name: string; seconds: number }
  | { t: 'horseSet'; tick: number; by: 1 | 2; trick: string; name: string; at: number }   // at: metres from the mark where the try started
  | { t: 'horseSetMiss'; tick: number; by: 1 | 2; reason: string; got: string; at: number }
  | { t: 'horseMatch'; tick: number; by: 1 | 2; ok: boolean; trick: string; name: string; got: string; reason: string; at: number }
  | { t: 'horseLetter'; tick: number; who: 1 | 2; letters: string }
  | { t: 'horseOver'; tick: number; winner: 1 | 2; letters: [string, string] }
  | { t: 'graffitiStart'; tick: number; seconds: number }
  | { t: 'tagged'; tick: number; player: 1 | 2; obstacle: string; points: number; from: 0 | 1 | 2 }   // from: whose tag it was (0: nobody's)
  | { t: 'graffitiOver'; tick: number; counts: [number] | [number, number]; winner?: 0 | 1 | 2 }   // solo Graffiti (game/graffiti.ts): one count, no winner
  // Muni Race (game/muni.ts): the streetcar (car.tram) is a car Thing.
  | { t: 'muniStart'; tick: number; line: string; name: string; car: number; stops: string[] }
  | { t: 'muniStop'; tick: number; n: number; name: string; you: boolean }   // you: you reached stop n (else the streetcar did)
  | { t: 'muniDelay'; tick: number; n: number; name: string; seconds: number; says: string }
  | { t: 'muniOver'; tick: number; won: boolean; margin: number; time: number }   // margin: metres the other still had; time: seconds since the start
  | { t: 'tramStop'; tick: number; car: number; line: string; n: number; name: string }   // a free-roam streetcar at a stop (run.muni.roam)
  // Robotaxi Escape (game/escape.ts): the robotaxi (car.chase) is a car Thing.
  | { t: 'escapeStart'; tick: number; seconds: number; car: number }
  | { t: 'escapeRecalc'; tick: number; seconds: number; points: number }
  | { t: 'escapeClose'; tick: number; dist: number }
  | { t: 'escapeOver'; tick: number; survived: boolean; score: number; bonus: number }   // score: your tricks, plus bonus (escape.survivalBonus) when you survived
  | { t: 'escapeBackup'; tick: number; car: number; dist: number }   // anti-hide: a second robotaxi at the street end nearest you (dist: metres away)
  // Driving (game/vehicles.ts): car is the vehicle's Thing id; other the Thing it bumped (-1: the park).
  | { t: 'vehicleEnter'; tick: number; car: number; name: string; type: string }
  | { t: 'vehicleExit'; tick: number; car: number; name: string; type: string }
  | { t: 'vehicleExitBlocked'; tick: number; car: number; reason: 'moving' | 'blocked' }
  | { t: 'vanBump'; tick: number; car: number; what: 'wall' | 'car' | 'robotaxi' | 'streetcar' | 'vehicle' | 'skater' | 'actor'; other: number; speed: number }
  | { t: 'pedShout'; tick: number; id: number; car: number; line: string; near: boolean }   // a walker shouts at the vehicle (near: a near miss; else it jumped clear)
  | { t: 'npcShout'; tick: number; id: number; car: number; line: string }   // an NPC skater shouts at the vehicle coming at it
  | { t: 'npcDodge'; tick: number; id: number; car: number }   // an NPC skater jumped clear of the vehicle's body
  | { t: 'vanLand'; tick: number; car: number; speed: number }
  // Rental scooters (a vehicle type with a scooter block, game/vehicles.ts): the battery running low and out, the
  // ride ending (seconds ridden, the fare in cents), a ditch (ollied off it: spin, rad/s it twisted off with, + left).
  | { t: 'scooterBattery'; tick: number; car: number; state: 'low' | 'empty' }
  | { t: 'scooterRideEnd'; tick: number; car: number; seconds: number; fare: number }
  | { t: 'scooterDitch'; tick: number; car: number; spin: number }
  // The story's characters on the move (game/movers.ts): id is the actor's Thing id, who its cast id.
  | { t: 'actorStart'; tick: number; id: number; who: string; mode: 'escort' | 'follow' }   // `actor spawn` (a mission's actor starts with its step)
  | { t: 'actorWait'; tick: number; id: number; who: string; behind: number }    // escort: you fell behind; it stops for you
  | { t: 'actorGo'; tick: number; id: number; who: string }                      // escort: you caught up; it goes on
  | { t: 'actorOvertaken'; tick: number; id: number; who: string; ahead: number } // escort: you got lead metres ahead of it
  | { t: 'actorBehind'; tick: number; id: number; who: string }                  // escort: back behind it after overtaking
  | { t: 'actorDone'; tick: number; id: number; who: string }                    // escort: it reached its path's end
  | { t: 'actorCatchUp'; tick: number; id: number; who: string }                 // follow: it was lost far behind and came round near you
  // Missions (game/missions.ts, docs/mechanics/missions.md): mission is the mission's id (data/missions.json).
  | { t: 'missionStart'; tick: number; mission: string; name: string; kind: 'story' | 'side' | 'job' }
  | { t: 'missionStep'; tick: number; mission: string; step: number; of: number; kind: string; text: string; seconds?: number }
  // A line said: n of of in a conversation (the dialogue box), or a bark (said while you skate, captioned).
  | { t: 'talk'; tick: number; mission: string; character: string; line: string; n: number; of: number; bark?: true }
  | { t: 'missionOffer'; tick: number; mission: string }   // the offer's last line is done: Accept (mission accept) or Not now (mission decline)
  | { t: 'missionItem'; tick: number; mission: string; n: number; of: number; item: string }   // picked up: a collect step's item, a deliver step's load
  | { t: 'missionDone'; tick: number; mission: string; name: string; kind: 'story' | 'side' | 'job'; sticker?: string; unlock?: string; board?: string; gig?: string }   // board, gig: an odd job's (game/jobs.ts)
  | { t: 'missionSkipped'; tick: number; mission: string }
  | { t: 'missionAbandoned'; tick: number; mission: string; reason: 'abandoned' | 'declined' | 'mode' }   // mode: another game was started
  | { t: 'missionFailed'; tick: number; mission: string; step: number; reason: 'time' | 'lost' | 'bail' | 'bump' | 'mode' }
  | { t: 'passengerIn'; tick: number; mission: string; who: string; car: number }    // a carry step: they got in
  | { t: 'passengerOut'; tick: number; mission: string; who: string; car: number }   // a carry step: they got out at the place

export const dataHashOf = (data: GameData) => hashString(JSON.stringify(data))
export const worldHash = (w: World) => hashString(JSON.stringify(w))

export function createSim(park: Park, data: GameData, opts: { seed?: number; spot?: string } = {}): Sim {
  const seed = opts.seed ?? 1
  const world: World = { format: 'soma-world/1', tick: 0, seed, rng: seedRng(seed), nextId: 1, things: [] }
  // Each sim owns its data: setData commands change this copy, never the caller's (or another sim's).
  const own = JSON.parse(JSON.stringify(data)) as GameData
  const sim: Sim = { world, park, data: own, dataHash: dataHashOf(own) }
  spawn(sim, Kind.session)
  const sk = spawn(sim, Kind.skater)
  const spot = findSpot(sim, opts.spot ?? own.spots.default) ?? park.spots[0]
  if (spot) placeAt(sk, spot)
  spawnTraffic(sim)   // the city's cars (none where there are no streets)
  spawnStreetcars(sim)   // and its streetcars (game/muni.ts; ids of their own, so every other id is as before)
  spawnParked(sim)   // and the vehicles parked in it (game/vehicles.ts: the crew van; ids of their own too)
  return sim
}

export function spawn(sim: Sim, kind: Thing['kind']): Thing {
  const t = makeThing(sim.world.nextId++, kind)
  sim.world.things.push(t)
  return t
}

export function session(sim: Sim): Thing {
  const t = sim.world.things.find((x) => x.kind === Kind.session && x.player !== 2)
  if (!t) throw new Error('no session in world')
  return t
}

export function skater(sim: Sim): Thing {
  const t = sim.world.things.find((x) => x.kind === Kind.skater && x.alive && x.player !== 2)
  if (!t) throw new Error('no skater in world')
  return t
}

/** The second player's skater and session, when someone plays player 2 (game/twoplayer.ts); else null. */
export function player2(sim: Sim): { sk: Thing; s: Thing } | null {
  let sk: Thing | undefined, s: Thing | undefined
  for (const t of sim.world.things) {
    if (t.player !== 2) continue
    if (t.kind === Kind.skater) sk = t
    else if (t.kind === Kind.session) s = t
  }
  return sk && s ? { sk, s } : null
}

/** Data aliases first (hellride, big3, ...), then park spot ids. */
export function findSpot(sim: Sim, id: string): Spot | undefined {
  const alias = sim.data.spots.aliases.find((a) => a.id === id)
  const target = alias ? alias.spot : id
  return sim.park.spots.find((s) => s.id === target)
}

export function placeAt(t: Thing, spot: { id: string; pos: Vec3; heading: number }) {
  t.pos = copy(spot.pos)
  t.vel = v3()
  t.fwd = headingDir(spot.heading)
  t.up = v3(0, 0, 1)
  t.state = State.air
  t.stateTicks = 0
  t.spot = spot.id
  t.skitch = null
  t.carRide = -1
  // In the air at the new spot: whatever it was riding ends (a manual carried on after the landing there,
  // a grind's state stayed on the skater; phase 26, lab-teleport-mid-manual).
  t.grind = null; t.lip = null; t.manual = null; t.wall = null
  // The air it lands from starts here: the landing after a teleport is not an air from where the last
  // one took off (physics phase 31: a teleport up Grant Ave paid THROUGH THE DRAGON GATE on landing).
  t.takeoffXY = [t.pos.x, t.pos.y]
  // Out of any vehicle it drove (game/vehicles.ts): the vehicle sees its driver gone and brakes to a stop.
  if (t.drive !== undefined) delete t.drive
}
