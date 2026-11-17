# Traffic (the city's cars, in the sim)
Milestone: physics phase 2. Code: src/sim/game/traffic.ts (cars), src/sim/skater/cars.ts (the
skater meeting them), src/sim/park/traffic.ts (the street network). Numbers: data/traffic.json.
View: src/client/traffic.ts draws the sim's cars (instanced, the same look as before).

Cars and robotaxis drive San Francisco's streets (world sf only: the city manifest's city.traffic,
OpenStreetMap axes). They used to be client-only; now they are Things of kind 'car', so the skater
can hit them, be hit by them and ride on them, and replays include them.

Rules (every tick, before the skater):
- A car follows its street axis in the right-hand lane (lane offsets by street type), at its cruise
  speed by OpenStreetMap kind (primary 12 m/s ... living street 5) with +-15% jitter, robotaxis at 90%.
  At a path's end it takes a street that meets it there (ends within 6 m), at random (world.trafficRng), or
  turns around (two-way) / wraps (one-way).
- It keeps its distance to the car ahead in its lane, braking on a constant-deceleration profile
  (v = sqrt(2 x 3 m/s^2 x (gap - 6.5 m)), plus half the other car's speed). An oncoming car (heading
  more than 90 degrees off) is the car ahead for only one of the two, the newer one (higher id): one-way
  streets drive the centre line, and where two run head-on into the same junction (Duboce at Valencia)
  the first car from each side stopped nose to nose for good (sf-traffic-headon). Now the older one
  goes first and the other waits for it.
- It yields to the skater in its lane ahead (in front of the bumper, within 14 m, within 2.6 m to the
  side, within 3 m of height), and to a skater beside the lane who will be there within 1 s (crossing).
  Not to a skater behind it (overtaking) or over its roof. Human drivers brake to stop 7 m short
  (centre to skater) on the same profile and honk once they have waited 0.8 s; robotaxis stop dead
  (14 m/s^2, event robotaxiStop), put their hazards on after 0.4 s and chime (honk, robo) after 1.2 s.
- Bubble: a car more than 340 m from the skater comes back on a street 140-300 m away, picked among
  the streets that come within that reach (so streets added elsewhere in the city change nothing here). The world
  starts with 60 cars and 20 robotaxis 15-260 m around the spawn. All random choices use the cars' own stream (world.trafficRng, seeded from the world's seed the first
  time traffic needs it), so a bigger street network never moves the skater's or anyone else's draws.
- Each car records how far it turned this tick (CarRun.turn), so riders turn with it.

The skater and cars (after the skater's step; only cars within 7 m):
- A car is two boxes in its own frame: the body (4.4 x 1.8 m, from the road to 1.15 m: the wheels
  fill the clearance, so a board cannot roll under it) and the cabin (2.4 x 1.6 m, up to 1.75 m,
  0.2 m back). A car never pushes anyone down (no contact from below).
- Coming down onto the roof or hood from the air is a landing judged against the car's motion
  (velocity relative to the car), then the skater rides it (Thing.carRide): the board's physics run
  relative to the car (grip, rolling, braking, powerslides), the skater moves and turns with it.
  Rolling off an edge, or off the roof onto the hood (0.6 m down), is a takeoff. Ollie off and you keep
  the car's speed, so you come down on it again. Stepping off (E) is ignored on a car.
- Side, front or back contact: more than traffic.hitSpeed (3.5 m/s) into the car is a bail: "ran into
  a car" when the skater's motion dominates, "hit by a car" when the car's does; event carHit; the
  part into the car is removed and the skater is knocked away at traffic.knock (2.5 m/s). Slower, the
  skater slides off it. Walkers and tumbling skaters are only pushed out.
- Landing crosswise slower than land.slowSpeed (2 m/s; a drift on a roof, or walking pace) is sketchy,
  not a bail, and does not swing the board to the drift.

Dev commands: `car <x> <y> <heading> [speed] [robo]` (a car on the nearest street lane, driving the way
closest to the heading; speed 0 = parked), `traffic clear`.
Events: honk {car, robo, x, y, tram?} (tram: a streetcar's bell), robotaxiStop {car, x, y}, carHit {car, robo, speed, reason}, carLand {car}.
Scenario readouts: car.gap (metres to the nearest car), car.<field> (that car, e.g. car.car.speed).

Cost: sf with traffic p50 0.045 ms, p99 0.09-0.16 ms per tick (budget 0.5; check --full measures it).
Scenarios: sf-car-yield (stops 7.06 m short, honks at 0.8 s), sf-robotaxi-stop (robotaxiStop at 14 m,
stops 11.7 m short, hazards, chime), sf-car-hit (a parked car's side at 6 m/s: bail), sf-car-hit-by (a
car at 11 m/s cannot stop: bail, knocked forward at 11.5 m/s), sf-car-crossing (a moving car brakes for
a skater about to cross: no contact), sf-car-roof (land on a moving roof, ride 3 s, ollie off and land
on it again), sf-traffic-roll (15 s in the full random traffic; also Node vs Chromium).
Car grinds (physics phase 3; src/sim/game/carlines.ts): every sim car has ten grindable edges
in its own frame, from the sizes of its collision boxes: the roof's four edges (1.75 m), the hood's
and trunk's side edges and the two bumpers (the body's top edge at each end, 1.15 m). They are
moving grind lines: tryCapture looks at the edges of the cars within collideRange as well as the
park's lines; the grind (GrindRun.car = the car's id, line = the edge) is placed each tick from the
car's pose, its speed is relative to the car, and leaving it (end, ollie, stall, balance) adds the
car's velocity. Parked cars (car ... 0) grind the same, and have no driver to honk. Gaps never
count on cars; sound treats car edges as metal.
Scenarios: sf-car-grind (a 50-50 along a moving car's roof, off the front at 9.5 m/s),
sf-car-grind-parked (a parked car's hood edge).
The city's own parked cars (city_car / city_car_top in the export) are static park geometry, so
their roof edges would come through the park's grind lines if the export listed them; see the
phase 3 report for why they are not solid yet.

Camera (client): src/client/camera.ts treats the cars near the skater as boxes (Cam.obstacles, filled
by main.ts and clip.ts from carBoxes each tick): the line of sight tests them like geometry and the
camera keeps data/camera.json collide.cars (1.5 m) from them, its smoothed position included.
Traffic.update hides a car with the lens inside it as a last resort. tests/camera.test.ts: a car
driving through the camera's spot on Guerrero passes 0.86 m from the lens without this, 1.5 m with it.

Skitching (physics phase 3; src/sim/skater/skitch.ts, data/traffic.json skitch):
- On the ground within skitch.reach (1.4 m) behind a car's rear bumper, at most skitch.side (0.8 m)
  off its middle and within skitch.maxRel (4 m/s) of its speed, a fresh press of L (grab; pad circle)
  grabs the bumper. Hold L to hang on: you are towed skitch.behind (0.35 m) behind it at its
  velocity, the board along the car, the wheels on the road. A combo still open from a landing
  carries on through it.
- Balance like a grind (left/right, the HUD's side-to-side meter, A/D to correct): instability 1.6,
  noise 0.9 from the world RNG, ramping 8% per second. Hands off, it goes in 3-4 s. The car's
  turn pushes you out (turnPush 0.25 per m/s^2 of its sideways acceleration); more than turnBail
  (4.5 m/s^2) throws you off (a car turning at a junction does). Below easySpeed (4 m/s) the wobble
  fades: hanging on to a stopped car is easy.
- Let go of L: you ride on at the car's speed and the Skitch goes into the combo (100 + 150 per
  second towed above 1 m/s), with the landing grace to link a manual. An ollie lets go too, the
  combo carrying on into the air ("Skitch + Kickflip").
- Human drivers honk after honkFirst (0.6 s) and every honkEvery (2.5 s). A robotaxi notices
  (robotaxiStop, the chime), slows politely at roboDecel (1.8 m/s^2) to a stop with its hazards on,
  and waits there until you let go.
- Thing.skitch {car, side, lead, balance...} for the view (the character view can pose a hand on
  the bumper); the HUD shows its name and balance like a grind.
- Events: skitchStart {car, robo}, skitchEnd {car, reason ('let go', 'ollie', a bail reason), points},
  plus trickStart/trickEnd "Skitch".
- Towed for less than skitch.minSeconds (1 s), a skitch never happened: skitchEnd reason void, no
  Skitch, no points. Grabbing again straight after a skitch (nothing else in the combo since) banks
  the combo first: letting go and grabbing again is not a new trick (physics phase 17; tapping
  the grab behind a car was 246 linked Skitches in 10 s). Scenarios sf-skitch-mash, sf-skitch-regrab.
- Co-op (physics phase 32): a vehicle a player drives (game/vehicles.ts) is a car like any other, so in
  split screen player 2 skitches player 1's van. The tow changes nothing for the van (no drag, no bump:
  it drives where and as fast as alone) and the van never honks at its partner (only a traffic driver
  honks). Its turns throw a skitcher as a car's do (skitch.turnBail, 4.5 m/s2 sideways: a corner taken at
  more than about 20 km/h). The scenarios' balance bot holds a skitch too. Scenario sf-coop-skitch.
- Scenarios: sf-skitch (3 s, honk at 0.6 s, 550 points, rides on at 7 m/s), sf-skitch-fall (hands off:
  falls after 3.3 s), sf-skitch-hold (nine A/D taps hold it 10 s: 1635), sf-skitch-robotaxi (stops politely,
  hazards, waits; 601 for the 3.3 s it towed), sf-skitch-ollie (Skitch + Kickflip x2), sf-skitch-turn
  (thrown off where the car turns 88 degrees).

## Game vehicles: the streetcars and the escape's robotaxi (physics phase 22; free roam phase 25)
- Two games bring their own vehicle, both car Things (Kind car, car fields as every car's, so the
  client draws them with the traffic renderer and the skater meets them as cars): the Muni Race's
  streetcar (car.tram: its line, the stop, dwelling or running; game/muni.ts) and the Robotaxi
  Escape's robotaxi (robo, car.chase: its place on its street graph and its plan; game/escape.ts).
  They drive themselves before the traffic and the skaters (session.ts stepGameCars); stepTraffic
  leaves them alone, while the other cars still keep their distance from them.
- A car's boxes come from dimsOf (skater/cars.ts): traffic.body and cabin for every car, and
  traffic.tram for a streetcar (a PCC car: 14.2 x 2.6 m, roof 2.95 m with its raised middle to
  3.2 m), tested within traffic.tram.collideRange (10 m). Its edges are grind lines named streetcar
  roof, streetcar hood and so on; its roof is rideable; you can skitch it. The streetcar never stops
  for you: its front shoves you out to the nearer side clear of the park, off its track, and coming at
  more than hitSpeed that is a bail, "hit by a streetcar" (carHit robo false); its rear is a bump like
  any car's (phase 25: running into a braking streetcar's back used to shove you sideways into a
  boarding island). Every other car is as before. Free-roam streetcars (modes.md) are the same cars.

