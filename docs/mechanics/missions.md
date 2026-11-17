# Missions
Story phase 1 (docs/open-world.md, docs/story.md). Code: src/sim/game/missions.ts; data:
data/missions.json (missions, steps, lines, rewards) and data/cast.json (who stands where); the client
(save, markers, dialogue, journal, map): src/client/story.ts and its modules.

Input:        commands, never keys: `mission start <id> [step]` (the client sends it when you press the
              talk key by a character), `mission next` (Space or Enter: the next line), `mission next all`
              (Esc: the rest of the conversation), `mission accept` / `mission decline` (the offer's
              Accept and Not now), `mission skip` (marks it skipped, the story moves on), `mission abandon`;
              dev: `mission pass` (the current step done as if met: tests and the whole-story playthrough).
              `mission job <board> <YYYY-MM-DD> <slot>`: an odd job (game/jobs.ts, below), sent by a gig board's card.
              A mission is played in its world (default sf; chapter 1 also in soma); `run ...` (any other
              game) abandons the mission on. Starting a mission leaves any game for free skate.
States:       session.mission (absent without one, so other worlds hash as they did): id, step, ticks in
              the step, talk (the line showing; -1 before the conversation starts), offer (waiting for
              accept or decline), count (trick: times done), got (collect: items picked), clock (ticks
              left, -1 none), armed (deliver: picked up; follow, race: the character set off), away (follow:
              ticks behind), actor (follow, race: the character's Thing, kind 'actor', actor: ActorRun, game/movers.ts), grind
              (trick grind: metres of the grind on now), wrap (a mode step's game is on).
Rules:
- Steps run in order; each says its text (the objective), barks its say lines as it starts and its done
  lines when done. A step with seconds fails at 0 (missionFailed time).
- talk: the conversation starts when you are within radius (talkRadius 6 m) and height (4 m) of who:
  where the mission puts them (step actors from that step on, mission actors) or home (data/cast.json);
  the offer (always the first step) and a phone step start at once. Lines come one per mission next;
  past the last: the offer waits (missionOffer), else the step is done.
- go: within radius (goRadius 10 m) of the place. Places: a spot id, cast:<id>, or x y z.
- trick: an air (a landing after air seconds, taken off in the area), a grind (one grind of grind metres,
  on a line of feature, in the area), or else a banked combo (comboLanded: at least points, holding one of
  gaps or one of tricks, started or banked in the area); count times, each bark between. Area: near a
  place within radius (30 m) and/or inside box.
- collect: pass within radius (collectRadius 1.6 m) and height (the step's, else missions height 4 m) of every
  item (missionItem each; each: a bark between items). A small height wants you up where the item is (a roof). vehicle: only driving
  it (see Drive steps); stop: rolling no faster than vehicles.exit.speed (3 m/s), a bin a garbage truck stops at.
- deliver: from a place (if given: the pickup, then the clock starts) to a place within radius (deliverRadius
  6 m); noBail: a bail spills it (missionFailed bail). vehicle: picked up and dropped only driving it; noBump
  (m/s): a bump of the vehicle that hard (vanBump speed) once loaded spills it (missionFailed bump).
- follow: who rides path at speed (an actor Thing on the ground, moved by game/movers.ts; docs/mechanics/
  driving.md). It sets off once you are within distance, easing into its pace; more than wait (the step's,
  else data/movers.json 14 m) behind it along the path it stops for you (actorWait, a waiting bark) and goes
  on within resume (actorGo); lead metres past it, it notices (actorOvertaken, a passed bark). More than
  distance behind it along the path, or that far off the path, for lose seconds: missionFailed lost. Ahead
  of it is fine. Done when it reaches the end with you by it or ahead. The actor stays where it ended until
  the mission ends.
- Drive steps (physics phase 30; docs/mechanics/driving.md). vehicle, on any step that takes it: a type
  (van, garbage, scooter: a Vantage scooter, physics phase 31; a mission places its own under a name of its
  own, since the docks' vantage_1 to vantage_12 would go with it), a vehicle's name (crew_van, one the mission places) or any; left out: any. A mission's
  vehicles and a step's vehicles [{name, type, at: [x, y, heading]}] are placed (game/vehicles.ts
  placeVehicle) as it or the step starts, moved there if they exist and nobody drives them; they go when
  the mission ends, whoever drives one out by a door first (vehicleExit). The checks: placed vehicles of
  a type in data/vehicles.json, a step's vehicle a type, a parked vehicle, a placed one or any.
- drive: drive the vehicle to a place: within radius (driveRadius 8 m); stop: and no faster than 3 m/s there.
- carry: who waits where the mission puts them; the vehicle, no faster than 3 m/s within radius (carryRadius
  6 m) of them, takes them aboard (passengerIn {who, car}): an actor at the passenger seat (vehicles
  seat up, passenger 0.5 m right of the middle, state drive: the view does not draw them standing).
  On the way they say lines (barks), one every `every` seconds (carryEvery 8) while the vehicle moves.
  Stopped within radius of to, they get out beside the passenger door (passengerOut) and stand there
  for the rest of the mission (cast:<who> and talk steps find them there): done. Out of the vehicle
  mid-way, they wait in it.
- data/vehicles.json routes: tested routes for mission vehicles; routes.garbage is the garbage truck round
  SoMa West's block (the truck's start, the lane, five bins for a collect step, the path), for Kevin's
  Garbage Run.
- race: who rides path at speed, moved the same way but never stopping for you, setting off once you are
  within distance; you win reaching within finish metres of the path's end first (the next step), it wins
  reaching the end first (missionFailed lost). Any way there counts. Paths go round parked cars (the city's
  are solid).
- mode: the game starts as its own command would (it places you at its start), the mission set aside so
  it is not abandoned: courier (deliveries), bomb (route; place, maxSeconds), muni (route; won), escape
  (survived), skate (route = local; won), graffiti (pieces owned), combo (best). Won: back to free skate
  and the next step; its over event, or a courier fail: missionFailed mode.
- The mission ends with missionDone {kind, sticker, unlock, board, gig}, missionSkipped, missionAbandoned {reason: abandoned,
  declined, mode} or missionFailed {step, reason}; its game, its actor and its vehicles go with it.
- reward: sticker (the Sticker Book), unlock (a secret skater), deck (a board shop graphic), outfit
  (character/outfit): the client's (rewards.ts: the results card, the journal's Rewards page, the picker's
  locks). retry: the steps a failed mission is tried again from (the client's Try again sends `mission start
  <id> <step>` with the latest at or before the failed step; else the first after the offer).
- Which missions are done or skipped, story flags, stickers and unlocks are the client's save
  (localStorage soma-skate:story); markers show a mission once its after missions are done or skipped.
Odd jobs (story phase 4; data/jobs.json, game/jobs.ts, docs/story.md Odd jobs): two gig boards, at Fog City Skate
              Shop's counter (Big Lou: photo errands and races) and Taqueria La Niebla's menu (Hector: deliveries
              and rides in the van), each with perDay (3) gigs a San Francisco date. A gig is a one-step mission
              of kind job (id job-<board>-<day>-<slot>, giver the board's host, job {board, gig, client, day, slot})
              made from the board, the date and the slot: a hash of those (FNV-1a into mulberry32, never world.rng)
              picks the kind (the board's gigs in turn), the client (each kind's clients shuffled per board and day,
              none twice) and the target. deliver: an item from the board's spot (picked up there) to cast:<client>,
              seconds = base 30 + straight metres / speed 4.5, rounded up to 5; fail time: the client's late line.
              carry: the van (carry.vehicle, placed by the taqueria) to the client, who waits at the kerb by their home
              (the nearest street point, kerb 4 m toward home; step actors), then to a spot from carry.to minFrom 300 ..
              maxFrom 1600 m from them (its nearest street point, radius 12); one ride line. photo: a trick from
              photo.tricks near a spot from photo.spots (radius 50). race: the client (their own speed) along a course
              from race.courses (distance 15, finish 10); fail lost: the client's won line. Each gig's client says
              their line as it starts and their done line when done. `mission job` leaves any mission on, then puts
              the gig in this sim's data by id (replacing one of the same id; the loaded data is never touched,
              each sim owns its copy) and starts it, so `mission start <id> 0` (Try again) finds it too. A world
              without the board's room refuses it. The client's save keeps the gigs done today and how many from each
              board (decks: foil after 5 from the taqueria, slime after 5 from Fog City); the Sticker Book counts
              missionDone kind job (1, 10, 25, and all four gig kinds).
Interiors (the city export's rooms: city.interiors in the export, carried into the Park as park.interiors):
              a character with inside "<room>/<anchor>" (data/cast.json) stands at that anchor (x y z heading) when the
              world has the room (game/missions.ts homeOf, insideAnchor: talks, markers, cast:<id> places, both cast
              views), and at home without it; each room's door is on the big map with the interiors icon and who is
              inside. Big Lou: fog_city_skate_shop/clerk, Gloria: city_hall_lobby/clerk (at her permit window), Hector:
              taqueria/cook (Taqueria La Niebla on Mission at 17th).
Numbers:      data/missions.json talkRadius 6, goRadius 10, collectRadius 1.6, deliverRadius 6, driveRadius 8,
              carryRadius 6, carryEvery 8, height 4;
              each step's own radius, seconds, count, speed, distance, lose, wait, resume, lead (follow; data/movers.json
              the defaults), finish (race).
Events:       missionStart {mission, name, kind}, missionStep {mission, step, of, kind, text, seconds?},
              talk {mission, character, line, n, of, bark?} (a line: n of of in the conversation, or a bark
              said while you skate), missionOffer, missionItem {n, of, item}, missionDone {name, kind, sticker?,
              unlock?, board?, gig?}, missionSkipped, missionAbandoned {reason}, missionFailed {step, reason: time, lost,
              bail, bump, mode}, passengerIn {mission, who, car}, passengerOut {mission, who, car}; a
              mission's fail lines may have bump.
For the view: session.mission (objective, clock, count), the actor Things, data/missions.json text and
              lines, data/cast.json; the voice line of every line is assets/sound/voice/<id>.mp3 (a line written since the
              last voice run has none yet: tests/missions.test.ts lists it, the dialogue box shows its words and a bark
              is captioned alone, src/client/voicelines.ts caption).
Scenarios:    soma-mission-offer (the offer, accept, a talk step on arrival, Esc), soma-mission-kickflip
              (trick: a kickflip near Rosa), soma-mission-count (count with barks, done), sf-mission-collect
              (decline, then the crumbs), sf-mission-time (a clock), sf-mission-go (go, a gap twice with
              barks), sf-mission-deliver, sf-mission-spill (noBail), sf-mission-follow, sf-mission-escort-wait, sf-mission-lost,
              sf-mission-air, sf-mission-grind, sf-mission-mode (Courier wrapped, then a phone call),
              sf-mission-mode-fail, sf-mission-skip (skip, abandon, another game), sf-mission-race (won up
              Grant Ave), sf-mission-race-lombard (won down the crooked block), sf-mission-race-lost,
              sf-mission-ch5 (chapter 5: the race to Civic Center won, then up into City Hall's lobby before
              five), sf-mission-ch5-lost (Chad gets there first), sf-mission-ch5-escape, sf-mission-delay and
              sf-mission-delay-lost (Dolores's Delay: the Muni Race on the J, won and lost),
              sf-playtest-hour (the first hour: chapter 1, three side stories, Muni, a skip, an abandon); drive steps, each with a
              test mission added by id in the run (setData missions.missions.<id> {...}): sf-mission-drive (drive, then
              drive and stop), sf-mission-carry (Karl aboard, his lines, out at the place, then a talk with
              him), sf-mission-deliver-van (on the board the pickup does not count; in the van it does),
              sf-mission-spill-van (a hard bump: missionFailed bump), sf-truck-garbage (the garbage route's
              five bins in the mission's truck, the truck gone at the end). tests/missions.test.ts: the data in its world, voices, the command errors, the abundance
              rule (three things to do within 360 m of every neighbourhood). tests/playtest.test.ts: every
              step of every mission skipped and abandoned leaves free roam.
Feel notes:   (waiting for play)
