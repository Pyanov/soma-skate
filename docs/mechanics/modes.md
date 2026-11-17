# Game modes
Milestone: M5 (physics phase 4). Code: src/sim/game/session.ts, src/sim/game/modes.ts.

Input:        the command `run start|free|courier|combo|bomb [route]|skate [local]` (the menu sends it); skating as usual.
States:       session Thing `mode` = what is on now: free, run, courier, combo, bomb, then ending
              (time is up, the combo in progress may still land) and over. `game` = the game
              started last (free, run, courier, combo, bomb); it stays through ending and over so
              the results screen knows which game it was. The 2-minute run is unchanged.
Rules:
- Every start resets the score, combo, letters, burritos, gaps and goals. Burritos count in every
  mode (in the worlds they are placed for). Letters and goals only in the 2-minute run.
- Courier (sf only): `run courier` puts you at Hector's door, Taqueria La Niebla on Mission (city phase
  13's interior; physics phase 31 moved it from the taqueria on Valencia), and hands you the first
  order (courierPickup). Each order has a drop (data run.courier.legs[i].to) and seconds. Ride
  there: within dropRadius (6 m) across and dropHeight (4 m) up or down it is delivered
  (courierDeliver, +deliveryPoints 1000), and the next order is handed over on the spot, its
  seconds added to what is left (courierPickup with bonus = the seconds carried over). Orders loop
  through the legs: Guerrero & 18th, Dolores Park, Mission Dolores, Harvey Milk Plaza (Castro and
  Market, 160 s, uphill), 16th St Mission BART (200 s), Valencia St, the park gate, Market St, back
  to the taqueria (the two plazas came with phase 10, after Mission Dolores, so the first three legs
  and the scenarios that shorten them are as they were). The clock runs out with an order on board: courierFail, then ending; over
  brings courierOver {deliveries, score, bestCombo}. Score = deliveries x 1000 + everything banked
  on the way (tricks, burritos).
- Combo Challenge (any park): `run combo` puts run.combo.seconds (60) on the clock; when it runs out,
  ending lets the last combo land; over brings comboOver {best, score}. Only the best single combo
  counts (best); score is everything banked, for reference.
- Hill Bomb (sf only): `run bomb` puts you at the top of Dolores St (bombReady). Gates are lines across
  the street (run.bomb.gates: pos, race direction, halfWidth 15 m, within 8 m height). The clock
  starts at the first gate (bombStart), checkpoints in between (bombCheckpoint), stops at the last
  (bombFinish {time, penalty, falls, total}, mode over at once). Each bail during the race adds
  fallPenalty (3 s). Past maxSeconds (90) after the start: bombFail {reason: 'time'}. The best time
  is the client's to keep.
Numbers:      data/run.json courier (start, legs, pickupRadius 5, dropRadius 6, dropHeight 4,
              deliveryPoints 1000), combo.seconds 60, bomb (start, gates, fallPenalty 3, maxSeconds 90).
Session fields (the session Thing): mode, game, timeLeft (ticks: run, courier, combo), courierLeg
              (index of the order on board), courierDone (deliveries), courierCarrying, raceGate (next
              gate; 0 = the start line), raceTicks (since the start line), racePenalty (ticks),
              raceFalls; plus bestCombo, burritos as before. Times in events are seconds (2 decimals).
Events:       courierPickup {leg, id, place, line, to, seconds, timeLeft, bonus?}, courierDeliver {n, id,
              place, points, timeLeft}, courierFail {delivered, id, place}, courierOver {deliveries, score,
              bestCombo}; comboStart {seconds}, comboOver {best, score}; bombReady {gates}, bombStart {gate},
              bombCheckpoint {n, of, gate, time}, bombFinish {time, penalty, falls, total}, bombFail {reason,
              gate, time}. The 2-minute run keeps runStart / runOver.
Scenarios:    sf-courier (two deliveries by teleport: 73.34 s carried over, 173.34 s on the clock),
              sf-courier-fail (short legs: two delivered, the third runs out at tick 2043),
              sf-courier-plazas (by teleport through Harvey Milk Plaza and 16th St BART: five delivered),
              lab-combo-challenge (6 s: best 490 of 590 banked), sf-bomb-race (11.96 s, no falls),
              sf-bomb-fall (standing, wobbles from 10.5 m/s here: 20.64 + 3 = 23.64 s), sf-bomb-timeout (4 s limit: fail).
              tests/sim.test.ts: courier and bomb refuse the lab.
Feel notes:   (waiting for play)

## Ghosts (physics phase 6; src/sim/ghost.ts)
- `ghostFrames(replay, park, data?) -> { frames, start, splits, finish }`: re-runs a stored replay
  (the client keeps the best run's, recorded from the `run bomb` command) in its own sim and keeps
  the skater Thing after every tick (frames[k] is the skater after replay tick k). start is the frame
  of the race start (bombStart; for courier the first pickup); splits are the gates the ghost
  crossed ({name, frame, time}: Dolores & 19th, Finish; courier: each delivery's place), time in
  seconds since the start line; finish is its total (penalties included) or null.
- The HUD lines the ghost up by race time: at live race time t draw frames[start + round(t x 120)];
  at the live bombCheckpoint n (or bombFinish) show `ghostDelta(ghost, n, liveTime)` seconds
  (+0.42 = behind the ghost, -0.30 = ahead; null if the ghost never got there).
- The ghost never enters the player's world (no Thing, no hash change, no events); the same replay
  always gives the same frames, Node and Chromium alike.
- tests/ghost.test.ts: a recorded bomb run re-run as a ghost ends where the live skater ended, its
  splits equal the live gate times, the live world hash is untouched.

## Hill Bomb routes (physics phase 7)
- `run bomb [route]`: `run bomb` races the default route (Dolores, the top level of data run.bomb,
  where it always was); `run bomb twinpeaks` races Twin Peaks (bomb.routes). An unknown route is an
  error listing the routes. Each route has id, name, start, gates, maxSeconds; fallPenalty is shared.
- Twin Peaks: from Market and Grand View (the twin_peaks_line start, 112.5 m) down Upper Market:
  gates Start, Market & Clayton, Market & 19th, Market & 18th, Market & Douglass, Finish: Castro
  (33 m); halfWidth 20 m, height 10 m; maxSeconds 240. Gate positions are the rider line's points
  nearest the OpenStreetMap intersections.
- The session's raceRoute says which route is on; every bomb event carries `route` (bombReady also
  `name`). Goals of kind bomb take an optional route (default: the default route), so the Dolores
  goals do not complete on Twin Peaks. ghostFrames returns the route of the replayed run.
- sf-bomb-twinpeaks: the autopilot (bot line twin_peaks_line) races it clean in 103.36 s.
- Hayes St (physics phase 14; the city's phase 7 area, spot hayes_hill): `run bomb hayes` from
  Hayes and Pierce at Alamo Square (67 m) east down Hayes to Octavia (9 m), 875 m: gates Start,
  Hayes & Steiner, & Fillmore, & Webster, & Buchanan, & Laguna, Finish: Octavia (on the street's
  middle at each cross street, found from the cross streets' road surface); halfWidth 15 m, height
  10 m; maxSeconds 150. About 10% for three blocks to Webster, then easing to 1.4% at Octavia. The
  route has no rider line: its racers follow a lane down its start and gates, a point every
  bomb.gateStep (5 m) reached within gateRadius (4 m), offset to their side by their line-up offset
  but at most bomb.gateLane (1.5 m), so they keep to the travel lanes (physics phase 17:
  aiming at the gates themselves, a block apart, the tour guide drifted into the parking lane and
  stopped against a parked car). sf-bomb-hayes-rivals, tests/racers.test.ts.
  Tucked all the way the player tops out at 17.6 m/s past Fillmore, just under the tuck's wobble
  speed (17), and finishes in 57.43 s.

## Hill Bomb rivals (physics phase 8; src/sim/game/npc.ts racers, data run.json racers)
- Each route lists its racers (3 on Dolores: Kevin from Three Bin, Night-shift nurse, Dolores Park DJ;
  3 on Twin Peaks: Mission bike messenger, Muni operator (off duty), Castro roller-disco legend; 3 on
  Hayes St: Hayes Valley barista on a break, Alamo Square tour guide, Painted Ladies landlord) and
  the rider line they follow (line; without one, the route's start and gates). `run bomb [route]` lines them up beside the start line, frozen;
  when the player crosses it (bombStart) they push off at the player's speed (a rolling start).
- They are NPC Things (kind 'npc', npc.racer = {name, gate, go, ticks, place, standing}, npc.look
  fixed from data) and ride with the NPC autopilot: their cruising speed (speed), braking only when
  more than brakeMargin over what the next corners allow, tucked from 10 m/s (kept over a crest: a tick in
  the air does not let go of it, which would pop a full late ollie). A show-off (standUp,
  standFor, flipChance) stands up at speed now and then, which pops a hop out of the tuck, sometimes
  with a flip at a random moment: too late and they land mid-flip. Their random draws are the NPC
  stream (world.npcRng), so the player's game is identical with them (every scenario's player
  fingerprint is unchanged); like all NPCs they never touch the player, and cars yield to them.
- They get up after a bail and ride on. Each crosses the route's gates; at the finish they get a
  place (racerFinish {route, id, name, place, time}, time from their push-off). The player's live
  place is session.racePlace (1-based; 0 before the start line), raceOf how many race, raceFinished
  how many are home; bombFinish gains place and of. These session fields only exist once a race has
  started, so worlds without a race hash as before.
- When the race ends (the player finishes or runs out of time) or another game starts, the racers go
  home (despawn); a racer still out has no place.
- Measured (16 seeds, the player out of the way): Dolores: Kevin 11.90 s every time, the DJ 12.1-12.4
  s and bails in about a third of the races, the nurse about 13.6 s. Twin Peaks: the messenger 103.95 s
  (a rolling start at the autopilot's speed), the Muni operator 109.4 s, the legend 110-121 s with a
  bail in most races. The player's no-brakes Dolores line (11.00 s) wins; the line with two
  powerslides (11.96 s) was third behind Kevin and the DJ, and is fourth since the city's sweep
  fixes (city phase 8: parked cars 0.62 m off the curb, laid out again), the nurse then in 11.51 s,
  and third again since city phase 11 (its curbs moved once), the nurse behind it; the Twin Peaks
  autopilot won by a hair from the messenger from city phase 8 (104.01 s in phase 10) and is second
  to him since phase 11: by 0.12 s (103.34 s against 103.22 s), by 0.19 s since its second export change (103.36 s against 103.17 s).
  Hayes St (8 seeds, city phase 7): the barista 60.46 s every time, the tour guide 67.47 s, the
  landlord 57.8 s when his stand-ups stay up (half the races) and 60-77 s after a bail. The tucked
  player (57.43 s) beats him by 0.35 s. On the phase 8 city the scenario seed has the landlord
  bailing (60.70 s, second to the barista's 60.50 s) and the guide 67.40 s (city phase 9); on the
  phase 10 city he keeps his stand-up and wins in 57.73 s, the barista 60.44 s, the guide 65.27 s;
  on phase 11's 57.80 s, 60.49 s, 65.31 s, the tucked player 57.49 s.
- Scenarios: sf-bomb-rivals-win (first of four), sf-bomb-rivals-lose (third: Kevin 11.17 s, the DJ
  11.48 s), sf-bomb-twinpeaks (second, 0.12 s behind the messenger), sf-bomb-hayes (first of four: Hayes Under a
  Minute, Beat the Landlord), sf-bomb-hayes-rivals (the locals on their own).

## Game of S.K.A.T.E. (physics phase 9; src/sim/game/skate.ts, data run.json skate)
- `run skate [local]` (soma, and the park inside sf; the lab refuses): a local comes out (one of
  data run.skate.locals, drawn from its own stream unless named: rosa, kenji, dre, tash), you both go
  to the spot (east of the middle of the park, on the 1.2-degree slab: start [45, 19.5], the mark
  [52, 19.5], the lane on to [65, 19.5]; you watch from [45.5, 21.6], the local from [47.5, 21.6]).
- Turns: the setter lands a trick at the mark, then the other has to land the same trick there. The
  setter changes every round and the local sets first. Each turn puts whoever is up at the start,
  facing down the lane, with no combo; the clock (session.timeLeft: setSeconds 25 / matchSeconds 25)
  starts after pauseSeconds (2). The clock is the time to start a try; one under way may finish.
  Your try is watched from the turn's start, not the clock's: pushing off at once reaches the mark
  before the pause is over (phase 10; it used to be ignored, then the clock ran out).
- A try starts with a pop from the ground (or a manual) within spot.near (5 m) of the mark; one that
  started beyond spot.radius (2 m) misses with reason 'too far from the mark' (the try's `at`, metres
  from the mark, is in its events). Further out a pop is just riding around. A try counts when its
  combo banks: one trick at a time, a foot trick, a spin up to 360, a flip or a grab,
  in any mix of one each (key 'nocomply+bs180', 'fs180+kickflip'; nothing at all is 'ollie'), or a
  manual of at least manualSeconds (1). The same trick = the same key, landed clean: a sketchy or
  stumbling landing, a bail, a different trick, another kind of trick (a grind, a gap, two flips) or
  the clock running out is a miss.
- A set stands when it is landed clean and has not been set this game (else skateSetMiss, reason
  'already set'). A missed match earns the next letter of word (SKATE); whoever spells it loses
  (skateOver, mode over, the local goes home).
- The local is an NPC Thing (npc.skate = {id, name, go, plan, pilot, try}, npc.look from data) that
  rides its tries with the real skater physics. At the start of its clock it plans: its set (a
  favourite favoriteChance of the time, else any of data sets, never one already set) or the trick to
  match, and whether it lands it: chance skill - hardness x difficulty (+ favoriteBonus for its
  favourites), within [minMake, maxMake]; difficulty is the sum of the trick's parts (data
  difficulty). The trick autopilot (trickKeys, shared with the harness's `bot skate`) rides the lane at
  runSpeed (5 m/s), locks lockTicks (45) before the mark and counts down: a full crouch, the foot
  trick's taps (boneless: up, up; no comply: down), the manual's taps (up then down; nose: down then
  up), the pop on the mark, the flip three ticks into the air, the grab held to just in time, the spin
  driven to the angle and braked with the other spin key. A planned miss flips or grabs too late
  (lands in it: a bail), lands 5-20 degrees past the clean band crooked (land.cleanDeg + 5 to + 20:
  25-40 degrees since phase 24; sketchy), or lets the manual go. Its plans and
  its physics draw from world.skateRng, so the player's game is the same as without it.
- The park's NPC skaters keep off the lane while a game is on (the lane: spot.start to spot.end, 2 m
  longer each way, spot.clear 2.5 m either side). One whose line crosses it, or who is on it, goes and
  watches from the first free crowd spot (spot.crowd: seven [x, y, heading] beside the lane), standing
  (npc.watch = the spot's index); the others ride only lines clear of it (respawns and line changes
  pick from those). When the game is over the watchers ride again.
- Session fields (only once a game has started, so other worlds hash as before): skateLocal (its id),
  skateName, skateTurn ('player' | 'local'), skateRole ('set' | 'match'), skateTrick and
  skateTrickName (the trick to match; '' when setting), skatePlayer and skateLocalLetters (letters so
  far), skatePause (ticks before the clock starts), skateUsed (tricks set), skateTry (your try:
  phase ready | air | manual | landed | done, ok, trick, name, reason, at); the clock is timeLeft.
- Events: skateStart {local, name, hood, word}; skateTurn {who, role, trick, name, seconds};
  skateSet {by, trick, name, at, line}; skateSetMiss {by, reason, got, at, line}; skateMatch {by, ok,
  trick, name, got, reason, at, line}; skateLetter {who, letters}; skateOver {winner, name, player,
  local, line}. who / by / winner: 'player' or 'local'; got: what the try was ('' after a bail); at:
  metres from the mark where the try started (-1: no try); reason: too far from the mark, bail,
  sketchy, stumble, time, different trick, already set, or why it is not one trick; line: what the
  local says ('' when it is quiet; from data lines, {trick} filled in). comboLanded now lists its
  entries (id, name, points).
- Measured: a turn is about 5 s (the pause and the ride); the scenario games last 82 s (loss) and 145 s (win).
- Scenarios: soma-skate-win (Kenji spells SKATE missing five of your sets, all sketchy; you land all
  five of his: over at tick 17352), soma-skate-loss (every try of yours lands crooked: Dre lands five
  sets, SKATE for you at 9867), soma-skate-sketchy (Rosa's Impossible matched 26 degrees off: sketchy,
  an S), sf-skate-park (the same spot inside sf: Tash bails her set, matches your Ollie),
  soma-skate-quick-set (you pop 0.95 m from the mark before the pause is over: your Ollie stands),
  soma-skate-too-far (a clean Ollie popped 3.34 m out: skateSetMiss 'too far from the mark'),
  soma-skate-crowd (the NPCs leave the lane for the crowd during a game and come back after; scenario
  paths npcs.onlane, npcs.watching, npcs.riding count them).

## Local two-player (physics phase 21; src/sim/game/twoplayer.ts, data run.json twoPlayer)
- THPS 2's split-screen games, the sim side (the split screen itself is the client's). `player2 join
  [spot | x y z [heading]]` puts a second skater Thing (player: 2) and its own session Thing (player:
  2) in the world; without a place it stands join.side (1.5) m to player 1's left, facing the same
  way, on the ground there (on player 1 when that is not clear ground). `player2 leave` takes both out
  (a two-player game on stops; player 1 skates free). `player2 teleport <spot | x y z [heading]>` and
  `player2 speed <m/s>` work like teleport and speed; `set skater2.<field>` / `set session2.<field>`.
- Player 2 rides on InputFrame.b2 with the same skater code, and on its own random stream
  (world.p2Rng, seeded at join), so its wobbles and balance never change player 1's draws: player 1
  skates exactly as alone (tests/twoplayer.test.ts compares it tick for tick in soma with NPC
  skaters and sf with traffic and pedestrians). The players never touch each other. Cars hit player 2
  like player 1 but brake and honk only for player 1; pedestrians, the park's NPC skaters (their
  lines, cheers and lane) read player 1 only.
- Each player scores its own gaps, car hops, burritos and city goals, into its own session (score
  and combo on its skater). With player 2 in, every skater event and every event its session makes
  carries `player: 1 | 2` (comboLanded, gap, bail, letter, goalComplete, ...); events that name a
  player already keep theirs (skateOver's letters, tagged), and the two-player games' own events are
  untagged (they name the players). Without player 2 nothing is tagged and every world, replay and
  hash is as before (no field is set until someone joins).
- The game is on player 1's session (mode, game, timeLeft, and horse* and tags), mirrored (mode, game,
  timeLeft) on player 2's. `run trickattack2p | horse2p [word] | graffiti2p` needs player 2, resets
  both scores and sessions; a one-player `run` with player 2 in leaves player 2 skating free.
- Trick Attack (`run trickattack2p`): both skate at once for trickAttack.seconds (120); the higher
  score wins. When the clock runs out each combo in progress may still land, then trickAttackOver
  {scores: [p1, p2], winner: 1 | 2 | 0 (a draw)}.
- HORSE (`run horse2p [word]`: horse.word HORSE, or one of horse.words, SOMA): a game of S.K.A.T.E.
  between the players at the S.K.A.T.E. spot (soma, the park inside sf), with S.K.A.T.E.'s tries and
  rules (game/skate.ts: the spot, one flat-ground trick, clean, the set stands if new, the setter
  changes every round, the matcher sets next) and HORSE's clocks: setSeconds and matchSeconds 10,
  pauseSeconds 2. Player 1 sets first. Each turn puts whoever is up at spot.start and the other at
  its watch spot (player 1 at playerWatch, player 2 at localWatch); the try is watched from the
  turn's start. A missed match is the next letter of the word; whoever spells it loses (horseOver,
  mode over). The park's NPC skaters keep off the lane as for S.K.A.T.E.
- Graffiti (`run graffiti2p`): both skate at once for graffiti.seconds (120). Obstacles: park grind
  lines ('line:<index into park.grind>', ground or lip tricked, not a car) and gaps ('gap:<id>').
  Each one in a player's open combo (session.tagging) is tagged for it when the combo banks, if
  nobody owns it or the other player tagged it with a smaller combo (a bigger combo steals it back;
  an equal one does not; the owner's own bigger combo raises its number). A lost combo tags nothing.
  The owners are session.tags {obstacle: {player, points}}; each session's owned counts its own.
  Whoever owns the most at the end wins (graffitiOver {counts, winner}, after the combos in progress
  land).
- Session fields (only once used, so other worlds hash as before): on player 1's: horseWord,
  horseTurn (1 | 2), horseRole, horseTrick, horseTrickName, horsePause, horseUsed, horseTry; tags.
  On each player's: horseLetters, tagging, owned.
- Events: player2 {joined}; trickAttackStart {seconds}; trickAttackOver {scores, winner}; horseStart
  {word}; horseTurn {who, role, trick, name, seconds}; horseSet {by, trick, name, at}; horseSetMiss
  {by, reason, got, at}; horseMatch {by, ok, trick, name, got, reason, at}; horseLetter {who, letters};
  horseOver {winner, letters: [p1, p2]}; graffitiStart {seconds}; tagged {player, obstacle, points,
  from: 0 | 1 | 2 (whose it was)}; graffitiOver {counts: [p1, p2], winner}. who / by / winner: 1 | 2
  (winner 0: a draw); reason and at as for S.K.A.T.E.
- Replays carry player 2's buttons (soma-replay/2, input2); one without them is soma-replay/1 as
  before. Perf: sf with traffic, pedestrians and two players p50 about 0.06 ms, p99 about 0.18 (one
  player 0.056 / 0.17); check --full measures it.
- Scenarios: lab-2p-join (player 2 on player 1's spot with the same keys: both grind the ledge tick
  for tick, events twice, tagged; then it leaves), lab-2p-trickattack (3 s: the clock runs out on
  player 1's grind, the game waits for it: 475 to 100), lab-2p-graffiti (a line tagged, stolen by a
  bigger combo, not by a smaller one), soma-2p-graffiti-gaps (BIG 3 GAP tagged, not stolen by a
  smaller combo, stolen back by a bigger one; WAVE AIR by the rider-line bot; a draw),
  soma-2p-horse-win (SOMA, player 2 sketchy: S-O-M-A in 11 turns), soma-2p-horse-turns (both clean:
  the matcher sets next), soma-2p-horse-time (player 2 never rides: time, a letter, a set miss),
  sf-2p-goals (each player completes Bench Press for itself).

## Muni Race (physics phase 22; src/sim/game/muni.ts, data run.json muni)
- `run muni [line]` (sf only; line j, the J Church, the default and in the squeezed city the only one: the F
  is parked there, docs/squeeze.md, and f and fdowntown below are from before the squeeze): race a streetcar to its line's last stop. J: Right of Way & Liberty, 20th
  Street, 18th Street, down through Dolores Park's right of way (558 m of rails, 47 m down). F: Castro,
  Market & Noe, Sanchez, Church, down Market (659 m to Church). F downtown (phase 25, data only):
  Market & 5th at Powell, Market & 3rd, Market & 1st, Don Chee Way & Steuart by the Ferry Building
  (1.8 km; the 100 m along Steuart where the export has no rails is bridged straight), cruise 10 m/s:
  the streetcar takes 215 s, the autopilot pushing down Market's right lane 201 s.
- The route: the line's rails (grind lines with feature streetcar rail, by id, in order) chained, the
  gaps where the export broke them (crossings) bridged straight, then shifted onto the track's middle
  by the stops' mean distance from the rail (OpenStreetMap stop positions are on the track's middle;
  the export kept only one rail of a track in places). Stops project onto it; worked out once per park.
- The streetcar: a car Thing (car.tram {line, n, phase dwell | run | done, wait, bell}; car.s along
  the route; docs/mechanics/traffic.md for its boxes). It waits startDwell (3 s) at the first stop,
  then runs to each stop: up to the line's cruise (J 11, F 14 m/s) at accel 1.2 m/s2, braking at
  decel 1.3 to stand at the stop (never slower than creep 0.5 m/s until there), and stands dwell (4 s).
  At a stop between the first and the last it is delayed delay.chance (0.35) of the time for 6-14 s
  more, with a line ("Delayed due to a disabled train ahead."), drawn from world.muniRng (seeded
  once, like the S.K.A.T.E. local's), so nothing else draws differently. It rings once for a skater
  on its track ahead (within bell 25 m, bellSide 1.8 m across: a honk event, robo false, tram true) and never
  stops for one.
- You start beside it on the platform side (platform 2.6 m right of the track), facing the way it
  goes. You reach a stop within stopRadius (6 m) across and 4 m up or down of its point on the track,
  in any order, by any way (Church St, Dolores Park, its roof). Whoever reaches the last stop first
  wins (a tie goes to the streetcar: it moves first in the tick). The race ends at once.
- Session fields (only once raced): muniLine, muniTram (its id), muniReached (your stops), muniFrom.
- Events: muniStart {line, name, car, stops: names}; muniStop {n, name, you} (you: you reached stop
  n, else the streetcar did); muniDelay {n, name, seconds, says}; muniOver {won, margin, time}:
  margin is how far the other still had, metres (the streetcar along its track, you in a straight
  line); time, seconds since the start. The streetcar runs on to its last stop after the race, then
  stands there until the next run.
- Measured: the F line's streetcar takes 91 s to Church (23.6 s to Noe, 57.7 s to Sanchez);
  the autopilot pushing down Market gets there in 73.7 s, 170 m ahead. The J's takes 65.8 s to 18th.
- Scenarios (the squeezed city parks the F: its races sf-muni-f-win and sf-muni-fdowntown-win are retired,
  docs/squeeze.md section 4): sf-muni-j-lose (you never push: it wins by 371 m), sf-muni-j-delay (seed
  3: 12.4 s at 20th Street, there 1488 ticks later), sf-muni-streetcar-hit (bell at 25 m, hit at 11.3
  m/s, thrown aside, it runs on), sf-muni-skitch (towed 2 s behind the race car: Skitch and MUNI SKITCH); in the story, Dolores's Delay
  (sf-mission-delay, sf-mission-delay-lost). tests/citymodes.test.ts: the routes, refusals, clearing.
- Skitching a streetcar is allowed (as any car) and pays the gap MUNI SKITCH (500; gaps.json kind
  skitch with tram: a skitch that counted, on a streetcar) on top of the Skitch.

## Streetcars in free roam (physics phase 25; src/sim/game/muni.ts, data run.json muni.roam)
- In the city the streetcars run outside the race too: seven of them with the traffic (spawned with
  it; `traffic clear` takes them away, `streetcars on | off` alone). Their ids are their own (1,000,000
  on), so every id the world hands out is as before. Lines run one way on one track, with the race
  lines' fields: f-in (Castro to Don Chee Way by the Ferry Building, 5.1 km, 19 stops, 3 cars; the
  first, 1,000,000, starts where the city's parked PCC stands near 2nd Street and waits 20 s there),
  f-out (Don Chee Way to Market & Cyril Magnin at 5th, 1.8 km, 7 stops, 2 cars: the export has no
  outbound rails west of 5th, so an outbound car ends there and the next inbound one sets off from
  Castro), j-in and j-out (one car each way through Dolores Park). Stops from OpenStreetMap, on that
  track. At its last stop a car waits layover (20 s) and goes on as its pair line, from that line's
  point nearest it (pairAt start: from its start).
- They drive as the race car does (accel, decel, creep, dwell at every stop, the race's delays drawn
  silently from world.tramRng, seeded at its first draw), ring for you on the track ahead and shove
  you off it from the front (a hit coming hard; only to a side clear of the park). tramStop {car,
  line, n, name} at each stop; bells are honk {car, robo: false, tram: true}
  (as the race car's, and a streetcar you skitch rings it too).
- None during a Muni Race but its own car: `run muni` takes them away (session.muniRoam) and the next
  game brings them back as they were at the start.
- Perf (sf, best of 3 per tick): about 3 us more per tick for the seven (route lookups cached per line).
- Scenarios: sf-streetcars (stops, the parked car's layover, the J turning back at 18th, the outbound F
  ending at Cyril Magnin), sf-streetcar-roam-hit (bell, hit at 12 m/s), sf-streetcars-race (none during
  a race, back after). In the squeezed city (docs/squeeze.md section 2) the F is parked and only the two J
  cars roam: sf-streetcars checks both J turnarounds, and sf-streetcar-roam-hit is hit by the J at 11 m/s.

## Robotaxi Escape (physics phase 22; src/sim/game/escape.ts, data run.json escape)
- `run escape` (sf only): a robotaxi decides you are a road hazard and follows you for seconds (90).
  It is a car Thing (robo, car.chase {recalc, plan, at, to, u, route, honkAt}) on the street point
  nearest to start (70 m) behind you.
- It drives a street graph made from the traffic network: its street points (about 4 m apart), along
  each street (one-ways one way), streets joined where they share a point and each street's ends
  joined to the nearest point of every other street within link (15 m): the network itself joins
  streets only at ends within 6 m, which leaves 453 of its 1,098 ends open. With 15 m, 80% of the
  points can reach each other both ways. Every plan (1 s) it plans the shortest way (A*) to the point
  nearest you; with no legal way, it takes a one-way the wrong way, or a road link. Built once per park
  (about 16 ms the first time `run escape` is given); a plan costs at most a few milliseconds.
- Road links (roadLink) join a street's end to the nearest point of each street network it does not
  join yet within reach (60 m), when the straight line between them is road all the way: every metre
  the ground under it, seen through parked cars (through), is road or median (roads), within height
  (1.5 m) of the line. They join where the traffic paths stop short and the road runs on: in the
  squeezed city (docs/squeeze.md section 7), at the joins into downtown, on both sides of Pier 39 and
  into the Alamo Square tile. They are in the graph's every-way edges (any) only, so the robotaxi's
  legal ways are as before.
- The map's waypoint route (the minimap; `streetWay`) plans on the same graph, either way down
  one-ways and with the road links. Each end starts from its nearest street point; when those two are
  on networks that do not join (a dead-end street cut off by a tile's edge or a park's lawn, as by
  Duboce Park), both start from the nearest points of one network: whichever of the two, or the
  largest, is nearest to both together. From the park gate it reaches every place in the map's list
  (tests/waypoint.test.ts: the route ends within 100 m of each spot; Duboce Park's lawn, 78 m from
  Duboce Ave, is the farthest).
- It keeps lane (1.5 m) right of the street's middle, drives at cruise (8.5 m/s; you push to 9) with
  accel 2.6 and brake 9, slows at decel 3 for the turns in the next 40 m (over 45 degrees to
  turnSpeed 5, over 120, a U-turn, to uTurnSpeed 2), behind cars (the traffic's follow rule), and to
  stop stopGap (2 m) short of you or the end of its way.
- It cannot leave the streets: stairs, plazas, parks and alleys that are not streets are escape
  routes (Clarion Alley: sf-escape-alley). Distance is to its body's outline in plan, so standing on
  a sidewalk beside its street is not safe. Within close (15 m): escapeClose once (again only after it
  fell back past close + closeOut, 20 m) and a polite honk every honkEvery (3 s) while it stays that
  close. Within catch (3 m, and 3 m up or down) for catchSeconds (2 s) in a row: pulled over,
  escapeOver {survived: false, score}, at once.
- Your combos slow it: one of at least recalc.points (200) sets it recalculating for 4 s per 1000
  points (at most 6 s; a longer one replaces a shorter one), driving at recalc.speed (0: stopped,
  hazards on). Score: your tricks (skater score). Time up: the last combo may land (ending), then the
  survival bonus (survivalBonus, 500) is added and escapeOver {survived: true, score, bonus}; the
  robotaxis stop, hazards on. Pulled over: escapeOver {survived: false, score, bonus: 0}.
- Anti-hide (phase 23): more than backup.far (40 m) from every street point for backup.seconds (10 s;
  looked at every 15 ticks, session.escapeHide counts it) and the robotaxi calls for backup, once a
  run: a second robotaxi at the street end nearest you (escapeBackup {car, dist}; session.escapeBackup,
  its id). Both chase the same way, the nearer one counts for close and catch, each honks, and your
  combos set both recalculating. They still cannot leave the streets: hiding stays possible, but
  with two waiting at the edges, and it scores only the bonus.
- Session fields (only once played): escapeTaxi (its id), escapeNear (ticks within catch in a row),
  escapeClose, escapeHide and escapeBackup (anti-hide); the clock is timeLeft.
- Events: escapeStart {seconds, car}; escapeRecalc {seconds, points}; escapeClose {dist}; escapeBackup
  {car, dist}; escapeOver {survived, score, bonus}; the honks are honk {car, robo: true}.
- Scenarios: sf-escape-pulled-over (standing by the street: close at 7.7 s, pulled over at 12.2 s),
  sf-escape-recalc (a 360 Flip as it closes in: 2 s recalculating, pulled over 279 ticks later),
  sf-escape-alley (down Clarion Alley: it goes round and waits at the mouth, 7 m off; survived, 100
  and the 500 bonus), sf-escape-backup (hiding in the middle of Dolores Park: backup called at 10 s,
  92 m away; survived with the bonus alone).
- Harness: `bot path x,y x,y ... [from t] [speed v] [nobrake] [nocars]` drives the rider-line
  autopilot along any points (nocars: not holding back for cars, which would keep it behind the
  streetcar); perf --mode 'muni f' | escape, measured by check --full.

## Solo Graffiti (physics phase 24; src/sim/game/graffiti.ts, data run.json graffiti)
- `run graffiti` (any park): THPS 2's tag mode for one player, with two-player Graffiti's tags and
  state (above): park grind lines ('line:<index>', ground or lip tricked, not a car's) and gaps
  ('gap:<id>') in a combo are tagged when it banks; a bailed or lost combo tags nothing. Tag as many
  as you can in graffiti.seconds (120). A re-tag counts only when it beats your own best on that
  obstacle: a tagged event with from: 1 (yourself), the best raised; a smaller combo there changes
  nothing. The last combo may land after the clock, then graffitiOver {counts: [how many you hold]}
  (one count, no winner; two-player's has two and a winner).
- State on the session: tags (obstacle -> {player: 1, points}), tagging (the open combo's obstacles),
  owned, timeLeft. Events: graffitiStart {seconds}, tagged {player: 1, obstacle, points, from: 0 | 1},
  graffitiOver {counts}.
- No Tour goal: the Tour's levels run their own goals and do not keep a tag map; a "Tag 10 pieces"
  goal would need the level runner to tag as well, so it is left out.
- Scenarios: lab-graffiti-solo (the ledge tagged, re-tagged by a bigger combo, the rail; 2 at the
  end), lab-graffiti-bail (a bailed grind tags nothing; a smaller combo does not re-tag).

