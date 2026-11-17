# Board physics (rolling, steering, grip, braking)
Milestone: physics, after M6. Replaces the turn-rate and lateral-grip rules of rolling.md.

Goal (2026-10-16): the characters can look playful and eclectic, but the physics and the
skateboard must be realistic and feel good. The THPS trick feel stays (big ollies,
generous grinds, arcade combos); rolling, turning, slopes and the board are physically grounded.

Input:
- A/D: lean (tip the deck). Lean builds at board.leanIn per second and relaxes at board.leanOut, so
  a tap is a small carve and a hold is a hard one. At a standstill A/D pivot the board (kick turn).
  At bombing speed (blended in over board.leanAtSpeed from..to, 12-16 m/s) the lean follows the keys
  as a lag instead (time constants tauIn 0.2 s, tauOut 0.6 s; the opposite key still straightens at
  the snappy rate): the keys are all-or-nothing and a held key carves past the grip, so a long bend
  is ridden by tapping, and the lag turns taps into a steady part lean (a third of the time held is
  about 0.55) rather than a zigzag (lab-hill-bend-taps).
- W push, S foot brake, K held = crouch (tuck on a hill, pump in a transition, charge the ollie).
- Shift (gamepad L2): powerslide while held. A/D during the slide open or close the board angle.

States: ground only (air, grind, lip, wall are unchanged; walking is walk.md).

Rules, each tick on the ground:
- Steering: the deck lean u (-1..1, Thing.steer) follows the stick. Curvature of the path the trucks
  steer is kappa = u / (board.minRadius + v^2 / board.carveAccel): a 1 m circle at full lean when
  slow, opening up with speed so a full-lean carve asks for about board.carveAccel of sideways
  acceleration at speed. Park speeds carve tighter (feel pass 2026-11-09): up to board.park.from
  (8 m/s) the circle is board.park's minRadius 0.65 + v^2 / carveAccel 15 with the grip board.park.grip
  1.4, blended out by board.park.to (12 m/s), from where on (bombing) minRadius 1, carveAccel 9 and
  grip 0.85 hold as before, so the hill's scrubbing carve and the races keep their numbers
  (src/sim/skater/board.ts carveAt). A 180 at full lean takes 1.43 s at 3 m/s and 1.88 s at 7 m/s (was
  2.22 and 3.02); a 3-tick tap still turns nothing, an 8-tick tap under a degree. The NPC riders
  (src/sim/game/follow.ts: the park's locals, the race rivals, the S.K.A.T.E. locals) take a corner at
  cornerSpeed, the fastest speed whose full-lean circle (fullLeanRadius, park carve included) fits it
  (round 3: their mean rolling speed in the park 3.35 to 3.48 m/s, the Big 3 locals back on their line
  0.3 s sooner; the races unchanged, their corners are wide). Their pure-pursuit look-ahead keeps the
  bombing numbers: shortened, the rivals weaved and the Twin Peaks messenger lost 2 s. The scenario
  autopilot (src/harness/pilot.ts) keeps the bombing numbers for both, which is the cautious side. Below board.pivotMaxSpeed the stick also pivots the board directly
  (board.pivotRate), fading out with speed. Thing.lean = the deck roll for the view (radians,
  + = the board's right edge down), u * board.leanMaxDeg, plus the wobble.
- Grip: the wheels only push sideways. Each tick they cancel the board's sideways velocity up to
  mu * N * dt, with N the normal load and mu = board.grip while gripping, board.slideFriction once
  sliding. While gripping, the turn keeps the speed (the sideways force does no work); past the
  limit the rest stays as slip (Thing.slip, m/s) and the sliding friction scrubs it, which costs
  speed. Asking more than the grip allows makes the board drift up to board.carveSlipMaxDeg off
  the direction of travel and scrub: a hard carve at speed is how you control speed on a hill.
- Normal load N (Thing.load, in g): gravity's share into the surface plus the centripetal load
  measured from how the surface normal turns under the skater (concave transitions press you
  down, crests make you light). Smoothed with board.loadSmoothing.
- Forces along the surface: gravity; rolling resistance Crr * N against the rolling direction, Crr
  by the surface under the wheels (ground.rollingByType by element type: city road 0.018, sidewalk
  0.014, lots and medians 0.016, grass 0.12; park concrete ground.rollingResistance 0.010); aerodynamic drag 0.5 * rho * CdA * v^2 / m (aero.*), with CdA = aero.cdaTuck
  while crouched and aero.cdaStand otherwise; pushing up to ground.maxPushSpeed. Air drag uses the
  same aero numbers. Terminal speed on a hill is where gravity equals drag plus rolling resistance.
- Pumping: crouched while going down a concave transition, the extra load (N above gravity's share)
  turns into speed: ground.crouchPump * (load - n.z) * g along the travel direction. No curvature,
  no pump: on a straight hill crouching is a tuck.
- Foot brake (S): ground.footBrakeDecel up to footBrakeFullSpeed, fading to footBrakeHighFactor of
  that at footBrakeHighSpeed (a foot dragged at speed does little).
- Powerslide (Shift, above slide.minSpeed): the board swings slide.angleDeg across the direction of
  travel at slide.yawRate (the nose to the heel side by default, to the stick side if one is held);
  A/D change the angle by up to slide.steerDeg. All the speed is then sideways, so sliding friction
  stops you at about slideFriction * g. Release: the board swings back to the nearer of forward and
  fakie at board.recoverYawRate (past 90 degrees that is fakie).
- Straightening: whenever the board is more than carveSlipMaxDeg off the travel direction (after a
  landing, a slide, a wobble), the rider turns it back at board.recoverYawRate; when not leaning
  (|lean| < 0.2) the board keeps self-centring onto the travel direction inside that band too, so
  friction never drags the travel onto a crooked board.
- Speed wobble: above wobble.speed standing tall (12 m/s), or wobble.tuckSpeed crouched (17 m/s), a
  wobble grows at wobble.grow * (v / threshold - 1) per second from a small seeded kick (world RNG). It shakes the deck (wobble.leanDeg at wobble.hz),
  which the trucks turn into a weave. Crouching damps it (wobble.crouchDamp), carving and sliding
  damp it, slowing down lets it die (wobble.damp). At 1 it throws you off: bail "speed wobbles".

Landing (replaces the angle-only rule of rolling.md): angle error a between the board and the
travel direction, impact speed into the surface vn.
- A trick still running, the board more than land.maxUpDeg off the surface, a > land.toleranceDeg,
  or vn > land.hardSpeed: bail.
- Clean (a <= land.cleanDeg, vn <= land.stumbleSpeed): the board lines up with the travel direction
  and the speed along the surface is kept.
- Sketchy: the rider turns the board land.straighten of the way and the wheels skid out the rest,
  which costs that part of the speed (speed x cos of the angle left).
- Stumble (a > land.stumbleDeg or vn > land.stumbleSpeed): speed x land.stumbleKeep, no push and
  half steering for land.stumbleTicks, the combo banks at once (no manual or revert out of it).

Signals for the view (src/sim/skater/signals.ts; the physics never reads them):
- Thing.lastLand: tick, airTicks, quality (clean, sketchy, stumble), impact (m/s into the surface),
  then points, multiplier, combo name and bankTick when its combo banks (after the grace window).
- Thing.danger (0..1) with a `danger {why}` event when it rises past 0.5: in the air, the touchdown
  below is forecast (time to the surface, impact speed, board angle with the spin carried on, a trick
  still running) and a bail-bound landing ramps from 0 at 36 ticks out to 1 at 6 ticks out; on a
  rail, lip or manual, balance past 0.7 or heading for the edge within 34 ticks at its rate; on the
  board, wobble past 0.4. Measured lead before the bail: mid-trick and sideways landings 21 ticks,
  grind and manual balance 13-14 ticks, wobble 78 ticks; no alarm in held grinds, manuals, lip stalls
  or a clean kickflip. mood.ts turns it into the scared face.

- Wedged (unstuck): resting in the air against something it cannot land on for half a second, or
  (physics phase 19) stopped on the ground for half a second on a slope steeper than safe
  ground (ground.safeNormalZ 0.8, about 37 degrees; Thing.wedged counts it): the skater goes back to
  the last spot it stood on safe ground (Thing.safe), stood up. On a slope that steep gravity never
  lets a rider stop that long, so only a corner holds it (steep Twin Peaks lots into buildings).
  Scenario lab-wedge-steep (synthetic: safeNormalZ raised so the lab hill counts as steep, braked to
  a stop on it, back to the flat top); the city's lots are eased under 37 degrees now (city phase 9),
  so sf-steep-lot-corner no longer wedges.

Numbers: data/physics.json ground.*, board.*, aero.*, slide.*, wobble.*, land.*.
Events: land {quality, impact}, powerslide {on, speed}, unstuck, danger {why}, bail {reason}.

Measured on the lab flat (scratch measurement, 2026-10-16), full lean held, before -> after:

| speed m/s | before: radius, sideways g, speed after 1 s | after: radius, sideways g, speed after 1 s | note |
|---|---|---|---|
| 1 | 0.28 m, 0.21 g, 0.69 | 0.32 m, 0.27 g, 0.90 | pivot (kick turn) |
| 2 | 0.63 m, 0.43 g, 1.49 | 0.78 m, 0.48 g, 1.89 | pivot fading out |
| 4 | 1.44 m, 0.83 g, 3.20 | 2.68 m, 0.57 g, 3.85 | grip |
| 6 | 2.46 m, 1.16 g, 5.03 | 4.78 m, 0.73 g, 5.78 | grip |
| 8 | 3.78 m, 1.42 g, 6.96 | 7.70 m, 0.80 g, 7.69 | grip |
| 10 | 5.54 m, 1.58 g, 9.00 | 11.4 m, 0.84 g, 9.58 | at the grip limit |
| 12 | 6.99 m, 1.82 g, 10.88 | 22 m, 0.60 g, 11.20 | slides and scrubs |
| 15 | 8.75 m, 2.28 g, 13.62 | 35 m, 0.60 g, 13.89 | slides and scrubs |

Before, every turn bled speed (the velocity was lerped toward the board, which shortens it) and the
sideways acceleration went past 2 g. Now a turn inside the grip keeps its speed (the loss is drag and
rolling resistance), and past the grip the board slides at the sliding friction.

Other numbers: coasting from 9 m/s, 5 s: before 8.49, after 7.38 standing, 7.85 tucked. Foot brake:
4 m/s stops in 1.3 s / 2.5 m (before 0.8 s / 1.6 m); 15 m/s takes 6.3 s / 54 m (before 2.9 s / 22 m),
so at speed you powerslide: 9 m/s stops in 1.5 s / 7 m. Pushing is unchanged (5 m/s^2 to 9 m/s).
Terminal speed on a hill: where g sin(a) = Crr g cos(a) + k v^2, k = 0.5 rho CdA / m. On a 10% asphalt
street: 15.4 m/s (55 km/h) standing, 18.9 m/s (68 km/h) crouched (CdA 0.30); Dolores St from 20th
falls about 11% for one block, where a crouched rider reaches about 14 m/s (city phase 3 placed the
elevation data right; the Twin Peaks bomb down Upper Market is the long one), so in practice a
bomb tops out around 14-18 m/s and is held there with carves and powerslides (sf-dolores-bomb,
rider line dolores_bomb_line: 16.4 m/s). It never reaches the 25 m/s cap.

Scenarios:
- lab-carve-grip: 6 m/s full lean, never slips, heading 90 -> 350 in 1 s (90 -> 29 before the park carve), keeps 5.78 m/s.
- lab-carve-scrub: 12 m/s full lean slides (slip up to 1.45 m/s), 12 -> 11.2 m/s in 1 s.
- lab-coast-drag / lab-tuck-drag: 9 m/s coast for 5 s ends at 7.38 standing, 7.85 tucked.
- sf-grass-roll: 5 m/s on a flat city lawn (Crr 0.12) loses 1.24 m/s per second and stops in 4.1 s,
  10 m on; with road Crr the same push loses 0.23 m/s per second. (The lawn at -460, -1100 may move
  when the city is rebuilt.)
- lab-hill-bend-taps: 16 m/s round the hill's 59 m bend tapping left 9 ticks of every 30: a steady
  0.45-0.64 lean, 2 m outside the centreline (the lean lag at bombing speed).
- lab-foot-brake: 4 m/s stops by tick 165; at 12 m/s the same foot leaves 5.1 m/s after 3 s.
- lab-pivot: a standstill pivot turns about 3 rad/s without travel.
- lab-bank-traverse: straight across the 25 degree bank holds its line to 1 mm; load 0.906 g.
- lab-powerslide / lab-powerslide-release: 9 m/s stops in 1.5 s and 7.2 m; a 0.4 s slide sheds
  2.6 m/s and the board swings back in line.
- lab-land-quality: 8 degrees off = clean (keeps 4.92 of 4.96 m/s), 32 degrees off = sketchy (4.84),
  3 m drop (7.6 m/s impact) = stumble (2.93).
- lab-land-hard-bail: a 5 m drop (9.8 m/s impact) bails.
- soma-walltop-stuck: the fuzz case on the north wall top (see decisions.md).
