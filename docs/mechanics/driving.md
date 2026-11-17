# Driving and the story's characters on the move
Milestone: physics phase 29 (docs/open-world.md: free roam, driving, missions). Code:
src/sim/game/vehicles.ts, src/sim/game/movers.ts (how the story's actors move); data/vehicles.json, data/movers.json; the driving
autopilot for scenarios src/harness/drivebot.ts; the view src/client/traffic.ts (placeholder boxes) and
src/client/camera.ts (the drive camera).

## Vehicles

Input:        F, the interact action (data/controls.json keyboard interact, the pad's triangle):
              in a vehicle it gets out; else the story's talk prompt goes first; with none up, by a free
              vehicle, the client presses Btn.use (8192) for a tick (src/client/drivekey.ts). On a touch
              screen a button (get in, get out) shows when the prompt would, above the talk button.
              Player 2 (split screen): its interact key (player2 keyboard interact, the numpad's Enter)
              and its pad's triangle get in and out (no talking); its drive camera is its own, and its own
              prompt (phase 31) shows in its half of the screen (#ui2). Next to a free vehicle
              (within vehicles.enter, 2 m of its body box), standing or rolling slowly on the board (up
              to exit.speed, 3 m/s) or on foot, a fresh use press gets in (canGetIn). E stays step off.
              In a vehicle: up throttle, down brake and then reverse, left and right steer, slide
              (Shift, L2) the handbrake, ollie the horn, F out again. The prompt ("F Get in", and "F
              Get out" once slow enough) shows where the talk prompt is not. Commands: `van summon [x y [heading]]` (the crew van on the street
              lane nearest the skater, summon.near to summon.far metres off, facing along the street; or
              at x y, heading in degrees clockwise from north), `vehicle spawn <type> <x> <y> [heading]
              [name]` (a vehicle of a data type, named name, default its type; the one with that name
              is moved), `vehicle enter [name]` (into that vehicle or the nearest free one, wherever it
              is), `vehicle exit` (out, even moving or boxed in), `vehicle clear [name]`.
States:       A vehicle is a Thing of kind 'car' with car.drive (DriveRun) and car.path -1, so the
              traffic, the skater's car collisions (roof riding, grinding its edges, being hit), the
              views and the scenarios see it as a car. pos is the ground under its middle, fwd its
              heading along the ground, up the ground's normal, vel its velocity. DriveRun: type and
              name (crew_van), driver (the skater's Thing id; -1 nobody), heading (radians clockwise
              from north), yawRate, steer (front wheels, radians, + right), ground (on its wheels),
              handbrake, throttle (-1..1, for the view and sound), bumpCool, hornAt. Vehicle Things
              take ids of their own (2,000,000 up), so adding one never moves another Thing's id. The
              skater in one has state 'drive' and drive (the vehicle's id); it rides at the seat
              (vehicles.seat, 1.3 m up the vehicle's normal) with the vehicle's velocity, so everything
              that follows the skater's place (the traffic and pedestrian bubbles, park NPCs near you,
              the Tour's area and the camera) follows the vehicle. Its own physics does not run. Every
              Thing that is not a vehicle or its driver has no drive field, so worlds without one
              hash as before; the crew van is parked in sf from the start (vehicles.parked), so sf
              worlds hash with it.
Rules:
- Wheels: four rays down from where the wheels sit (wheelbase, track), each from maxStep above where
  the ground it stands on now would put it: a curb (15 cm) is climbed, a step higher than maxStep
  (0.4 m) is not; ground more than maxDrop (1.2 m) below is none; a face steeper than 53 degrees is a
  wall, not ground. The middle sits at the four heights' mean and leans with their plane (pitch and
  roll); with two wheels or fewer on the ground it is in the air.
- On the ground: the steering goes toward full lock (steer.maxDeg 34 at a standstill, narrowing as
  steer.fade / (steer.fade + speed): 18 degrees at 8 m/s) at steer.rate and back at steer.back. The
  yaw is the bicycle model's, speed x tan(steer) / wheelbase, held to what the tyres can give
  (grip.lateral 9 m/s2 sideways); what is sideways after the turn is a slide the grip takes out at
  that rate. The engine pulls engine.accel (7 m/s2) at rest, falling to nothing at topSpeed (24);
  down brakes at engine.brake (9) and then reverses (reverseAccel 3, up to reverseTop 6). Rolling and
  drag stop it without turning it round; gravity along the ground pulls it up and down the hills. Let
  go of both pedals nearly stopped and the brake holds it, on a hill too. An empty vehicle brakes to a
  stop at driverless (6 m/s2), and a still one costs nothing.
- Handbrake: the rear lets go (grip.handbrake 2.2 m/s2), the turn comes from the whole speed, not the
  part along the van, yawBoost (2.2) times harder; the spin builds at yawAccel (10 rad/s2) and dies
  away only at yawFade (2.5), so a slowing slide swings on round: 180 degrees from 45 km/h in 1.24 s.
  It follows the steering while the handbrake is held (backing up under power, the other way). The
  locked rear slows it at handbrakeDecel (4.5). Let go, and grip returns: it drives on the way it
  faces (docs/feel-audit.md section 10).
- Off the ground: where the ground falls away faster than the van follows (a crest at speed, an edge)
  it flies, under gravity, its yaw fading; back on the ground the speed into it goes (vanLand when
  hard).
- Walls and props (the park and the city's buildings, poles, trunks, parked cars): body.spheres
  spheres along the body (radius half its width) from body.clearance above the ground. Out of what they
  touch (faces not flatter than the wheels' ground), the speed into it reversed by restitution
  (0.15), rubbed by friction, turned by where along the body it hit (yawKick). vanBump {car, what
  wall, other -1, speed} when bumpSpeed (1.5 m/s) or more into it, at most every bumpCooldown.
- Cars (traffic, robotaxis, streetcars, other vehicles): the van's body box against theirs in plan.
  They keep to their paths: the van is put out of them and the speed into them goes. A driver stops
  and honks; a robotaxi stops (robotaxiStop) with its hazards on. vanBump {what car | robotaxi |
  streetcar | vehicle, other: its id}. While someone drives it, traffic yields to the vehicle as to a
  skater, the lane and stopping room grown by its half width and half length: a car behind stops short
  and honks after honkAfter, a robotaxi stops dead, hazards on, and honks politely.
- The skater meets a vehicle as a car (src/sim/skater/cars.ts), with the vehicle's own boxes (dims
  body and cabin: the roof and the hood to land on and grind, named for its type, van roof), the
  box down to the ground (a skater cannot roll under it).
- Pedestrians (player 1's vehicle): they see a vehicle coming as they see a skater, with a berth its
  half width and peds.see.vehicle (1 m) wider, and step its half width further. One it reaches (inside
  its body grown by their radius) jumps clear to their side of it and stays clear while they walk past
  it. They shout (pedShout, a line from vehicles.reactions.pedShouts by their id and the tick) when they
  jump clear, or when it passes within reactions.nearMiss (1.5 m) of them at nearMissSpeed (5 m/s) or
  more (near: a near miss); once per shoutCooldown (8 s). No hit, nothing scores.
- NPC skaters (any vehicle, moving or stopped with a driver): coming at them (within npcLook, 1.5 s, of
  its moving end at its speed, npcLane 1.5 m either side of its body, npcSpeed 3 m/s or more) they shout
  (npcShout, from npcShouts; once per shoutCooldown); reached (inside its body grown by reactions.body,
  0.35 m, a person) they jump clear to their side of it, their speed toward it gone (npcDodge).
- Actors (the story's characters): solid to it, reactions.body round. It is put out of them and the
  speed into them goes (vanBump {what actor}); one walking holds while a vehicle stands in its next step
  (game/movers.ts vehicleAt), and goes on when it has gone.
- Robotaxis yield to it as to a skater (stop dead, hazards, a polite honk), and the escape's chaser
  keeps its route.
- Getting out: below exit.speed (3 m/s), onto the board beside the driver's door (the left; the right,
  ahead or behind when that is blocked), exit.side (0.7 m) off the body, rolling as the van was; faster,
  or with every side blocked, it stays in (vehicleExitBlocked {reason moving | blocked}). A teleport
  (placeAt) takes the skater out where it lands; the vehicle brakes to a stop.
- A vehicle takes nothing of the skater's: no letters (run or Tour), no tape, no burritos, no speed
  or dash goals, no hill bomb gates. Getting in banks the combo (as stepping off does). A courier
  delivery is made by van as on the board.
- Types (data/vehicles.json types) carry every number above: the crew van (5.3 x 2.0 m, roof 2.45 m) and
  Kevin's garbage truck (8.6 x 2.5 m, roof 3.5 m, accel 5, top 19.5 m/s, slower steering, a 17 m
  circle). The numbers against arcade targets: docs/feel-audit.md section 10 (`skate feel --section
  drive`). A mission
  vehicle is a type and a `vehicle spawn`.
- Rental scooters (physics phase 31; data/vehicles.json types.scooter, its scooter block): Chad Vantage's
  fleet, twelve parked in threes at four docks downtown (Market at 4th, at 3rd, at Beale; Powell),
  `vehicle spawn scooter ...` for more. The same Thing and the same arcade model, sized 1.1 x 0.4 m with
  the bars at 1.12 m, 20 km/h top (18 km/h reached), wheels that only just climb a curb, no reverse, no
  handbrake, no horn; ridden standing (stand, seat 1.05 m). F on and off as any vehicle.
  - Battery: battery seconds of riding on a full charge (each scooter keeps its own, ridden time only);
    at low seconds left it says so (scooterBattery low) and its limiter brakes it to lowTop m/s; empty
    (scooterBattery empty) the motor stops and it coasts, the rider still on.
  - The ride's clock (ride.rideTicks) runs while it is ridden; getting off, ditching or falling ends the
    ride (scooterRideEnd {seconds, fare}: fare.unlock plus fare.perMinute for each minute started, in
    cents). The client shows clock, fare and battery in a strip at the top while it is ridden.
  - Wheelie: up then down quickly (the manual's input) at the manual's start speed: the rider's manual is
    Scooter Wheelie (data/tricks.json manuals), stepped by the manual's balance on up and down (the balance
    bot and feel's humans hold it as a manual) while the motor runs (up and down are not throttle and brake
    then). It scores and banks as a manual: slowing under the manual's minimum banks it, getting off
    banks it, the balance lost throws the rider off beside the scooter (bail: fell off the scooter).
  - Ditch: ollie pops the rider off its left side onto the board (pop up speed, the scooter's speed along),
    Scooter Ditch in the combo (a wheelie before it too); the board twists off at a spin drawn from the
    world's random stream within spinMax rad/s, which the air's spin decay slows: the landing decides
    (about a third bail, the rest clean, sketchy or a stumble, measured over 40 seeds); spinning against
    it saves it. The scooter falls over where it was left (ride.tipped, stopped) until someone rides it.
  - A scooter is no car to clear: jumping off or over one is no CAR HOP.
Events:       vehicleEnter {car, name, type}, vehicleExit {car, name, type}, vehicleExitBlocked {car, reason},
              vanBump {car, what, other, speed}, vanLand {car, speed}, honk {car, robo: false, x, y,
              van: true} (the horn); and the traffic's own honk and robotaxiStop at the van; pedShout
              {id, car, line, near}, npcShout {id, car, line}, npcDodge {id, car} (phase 31: each shout is a
              voiced line in data/voices.json, keyed by its text, with a cooldown, captioned when said);
              scooterBattery {car, state: low | empty}, scooterRideEnd {car, seconds, fare}, scooterDitch
              {car, spin} (the display's voice lines: on vehicleEnter of a scooter, both battery states,
              the ride's end; the unlock chirp in place of the door).
For the view: car Things with car.drive (src/client/traffic.ts carPoses adds van {type, up, steer}, and
              for a scooter rider, wheelie (the rider's manual balance), tipped, and (phase 32, for the
              scooter model and the standing pose) pitch (radians the front is up about the rear
              wheel: view.wheelieDeg + view.swingDeg x the balance in a wheelie, else 0) and lean (radians into
              the turn, + right: atan(speed x yaw rate / g) within view.leanMaxDeg): a placeholder scooter
              with a placeholder figure on it while ridden, its front up in a wheelie, on its side when
              ditched; the character models replace them and pose the rider);
              a placeholder box of its type's size, leaning with the ground, front wheels steering
              (a real model replaces it later). The skater is not drawn while its state is drive.
              The drive camera (data/camera.json drive): dist 8.5 m behind and 2.4 m above the seat,
              further and higher with speed; the skating moods are off. canGetIn(sim, skater) and
              canGetOut (game/vehicles.ts) say whether F would get in or out: src/client/drivekey.ts
              draws the prompt and presses use (wired in main.ts next to the talk key).
              Sound (src/client/sound.ts, data/sound.json drive): the engine, two oscillators through
              a lowpass, its pitch climbing with speed through three gears and with the pedal down
              (the truck lower), louder on the pedals; the tyres squeal with the handbrake or a
              sideways slide; the door's thump and latch on vehicleEnter and vehicleExit; a thump
              for vanBump and vanLand; the van's own two-tone horn. Clips carry it too (clip.ts
              keeps the driven vehicle each tick).
Scenarios:    sf-van-lap (a lap of SoMa West's block, 640 m, no bump), sf-van-dolores (up Dolores,
              29 m in 290 m), sf-van-handbrake (a handbrake turn against the steering alone),
              sf-van-bump (a car and a robotaxi yield, honk, and are bumped), sf-van-ped (walkers step
              aside, one jumps clear), sf-van-enter-exit (E: reach, walk, moving, out, back in),
              sf-van-letters (no letters from a vehicle), sf-truck-dolores (the garbage truck), sf-van-shout
              (a walker's near miss), soma-van-npc (an NPC skater shouts, jumps clear), sf-van-actor (an actor
              holds by the van, the van stops against another); sf-scooter-ride (on, 17 km/h, off: the
              fare), sf-scooter-wheelie-ditch (a wheelie, ditched clean, no car hop),
              sf-scooter-ditch-bail (the draw throws it), sf-scooter-ditch-save (spun against, a stumble),
              sf-scooter-wheelie-fall (unbalanced, thrown off), sf-scooter-battery (low, limited, empty);
              tests/vehicles.test.ts; node=chromium replays sf-van-lap and sf-van-bump; check --full's
              vehicle keys: the real client, F in and out of a van, E steps off. `bot drive x,y
              x,y ... [from t] [speed v] [corner v] [lane m] [stop]` drives whoever is in a vehicle along
              the points (pure pursuit, slower for corners, the right-hand lane lane metres off, a stop
              at the end). Expectation paths: van.<field> (the vehicle the skater drives, else the
              nearest), van.gap, npc.<field> and npc.gap (the nearest NPC skater). `skate perf --van`: the city with the crew van driven through the
              traffic (in check --full's budget).

## The story's characters on the move

Input:        a mission's follow step (game/missions.ts) moves its character; `actor spawn <who> escort
              <pace> x,y x,y ... [wait m] [resume m] [lead m]`, `actor spawn <who> follow <pace> [gap m]
              [at x,y]`, `actor clear [who]` start and clear others; from code, spawnActor(sim, spec:
              ActorSpec, events), clearActors(sim, who?), actorRun and moveActor (game/movers.ts). ActorSpec:
              who (a cast id, data/cast.json: whom the view draws; spawning one again replaces it), mode,
              pace (m/s), path (escort: [[x, y], ...]), at (follow: where it starts), wait, resume, lead
              (escort), gap (follow); the numbers left out are data/movers.json's.
States:       Things of kind 'actor' with actor (ActorRun): who, mode, path, i (its segment), s (metres along
              the path), pace, speed, state (hold: not set off yet, go, wait, done), wait, resume, lead, gap,
              ahead (you are past it), ticks. pos is a skater's middle over the ground (the view draws a
              skater), fwd the way it goes, vel its velocity. Actors from `actor spawn` take ids of their own
              (3,000,000 up); a mission's takes the next id, as before. No physics: it rides the ground (a ray
              down each tick), never bails and never blocks.
Rules:
- Escort: it goes along its path at pace (easing at accel 2.5 and decel 4 m/s2). How far along the
  path you are is your nearest point on the segments round it. More than wait (14 m) behind it, it
  stops and waits (actorWait); within resume (6 m), it goes on (actorGo). More than lead (6 m) ahead
  of it, it notices (actorOvertaken), and again when you drop back behind it (actorBehind); ahead of it
  before it has moved is where you started, not a pass. At the path's end it stops (actorDone).
- A mission's follow step: its character holds still until you come within the step's distance, then
  escorts you at the step's speed (wait, resume, lead from the step, else data); it barks the step's
  waiting lines as it stops for you and its passed lines as you pass it (one each time, in turn). The
  step's own rules decide lost and done (docs/mechanics/missions.md).
- Follow: it comes after you at up to pace, as fast as holds gap (4 m) at your speed (your speed plus
  the distance beyond gap), easing to a stop inside it. More than catchUp (60 m) away, it has lost you
  and comes round at catchBack (12 m) behind you (actorCatchUp). The player is the skater, or the
  vehicle it drives.
Events:       actorStart {id, who, mode} (`actor spawn`), actorWait {id, who, behind}, actorGo,
              actorOvertaken {id, who, ahead}, actorBehind, actorDone, actorCatchUp ({id, who} each).
Scenarios:    sf-actor-escort (waits, goes, is overtaken, passes you, waits again, done), sf-actor-follow
              (settles 4 m behind at your speed, catches up after a teleport), sf-mission-escort-wait (Donna
              waits for you on Castro St, goes on, notices your pass, the step done), sf-mission-follow;
              tests/vehicles.test.ts (ids, the barks). Expectation paths actor.<field>, actor.gap (the actor
              nearest the skater).
