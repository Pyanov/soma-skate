# Walking off the board (THUG style)
Milestone: physics, after M6. Code: src/sim/skater/walk.ts. Numbers: data/physics.json walk.*.

Goal: walk around off the board (in the park and the city around it). A button steps
off and picks up the board; you walk or run with it, turn, jump, climb low ledges and drop down; the
same button drops the board and rides off.

Input: E (pad L3) steps off / drops the board. On foot: W run (walk.runSpeed 3.6 m/s), W + Shift walk
(walk.walkSpeed 1.5 m/s), S back up (walk.backSpeed 1 m/s), A/D turn (walk.turnRate 3.5 rad/s, also
standing), K jump (walk.jumpSpeed 3.4 m/s: the feet rise 0.59 m). Controls stay skater-relative (tank
style), like skating: the sim never needs the camera.

States: ground -> walk (E, on the ground only); walk -> ground (E on the ground) or air (E while
jumping or falling: a caveman, tricks and grinds open). Stepping off faster than walk.maxStepOffSpeed
(6 m/s) is a bail ("stepped off at 29 km/h"). A manual or an open combo banks when you step off.

Rules (the skater's sphere stays the feet: its centre is skater.radius over the ground):
- Facing is the board's old travel direction (fakie: the tail end). The feet do not drift sideways:
  velocity is the facing times the speed, which eases toward the target at walk.accel / walk.decel.
- Ground: after the horizontal move the feet are let down onto whatever is within walk.stepHeight
  (0.25 m) below, straight down in 1 cm steps refined by bisection, so a step's lip holds them (a
  push-out sweep slid them back off it). A face counts if it is within walk.maxSlopeDeg (40 degrees);
  an edge or corner always counts. Nothing within reach: you walked off an edge and fall.
- Steps: blocked by a rise up to walk.stepHeight, the feet lift, move and come down onto it (stairs
  are walked, not climbed). A wall stops the feet, not the runner's intent, so the speed is kept.
- Climbing: pressing forward into a ledge whose top is more than half a step and at most
  walk.climbMax (0.5 m) above the feet, with room on top and a clear path (up, then over; a rail
  overhead blocks it), climbs it in walk.climbTicks (0.3 s), all the way up before moving over.
  The test uses the feet's current height, so a jump reaches higher ledges.
- In the air on foot: gravity; landing on anything standable met from above. Harder than
  walk.hardLandSpeed (8 m/s, about a 3.3 m drop): a stumble, no control for walk.stumbleTicks.
- A move that would leave the feet inside geometry (pressing into an acute corner) is undone.
- Thing.stride counts metres walked (the legs' phase; sound.ts already plays footsteps for 'walk').

Events: stepOff {speed}, boardDrop {speed, air}, jump, climb {height}, footLand {impact}.
Scenarios: lab-walk-stepoff (2.4 m/s off, runs at 3.6, drops the board and rolls at 2.6),
lab-walk-climb (climbs the 0.45 m ledge, drops off the far side), lab-walk-stairs (the 3-stair by
step-ups, onto the 0.63 m platform), lab-walk-jump-climb (the 0.51 m side stops you; a jump climbs
it), lab-walk-caveman (board dropped mid-jump, lands rolling), lab-walk-stepoff-fast (8 m/s bails),
lab-walk-turn (a quarter turn standing in 0.45 s).
Client: a placeholder carry pose in src/client/skater/poses.ts (to be animated later).

Ledge hang (physics phase 2):
- Walking (not running: at most walk.hangMaxSpeed, 2 m/s, so Shift + W) off an edge with more than
  walk.hangMinDrop (1 m) below, the rider grabs it: turned round to face the wall, hanging with the
  feet walk.hangDepth (1.9 m) under the top, or just above the ground on a lower ledge (knees bent).
  Backing off an edge (S) grabs it too. Running off it, you drop.
- Hanging: no gravity, no moving. A fresh press of W (holding it from the walk does nothing) pulls up
  in walk.pullUpTicks (0.5 s), up then over, onto the ledge a little back from the lip; S or K lets go
  and drops.
- Thing.hang (and Thing.hangTop, where pulling up ends) for the view; Thing.climbLen is the length of
  the current climb (a pull-up is slower than a climb).
- Events: hang {drop}, hangEnd {how: 'pull up' | 'let go'}.
- The way up is checked for room at samples no further apart than 0.8 r (feel pass round 3: with 8
  samples a 1.9 m hang was checked every 0.24 m, and fuzz lab seed 3 hung under the lab hill's
  sidewalk, a sheet with nothing below, and pulled up through it).
- Scenarios: lab-walk-hang (hangs off the small quarter's 1.2 m deck, holding W does nothing, a tap
  pulls up), lab-walk-hang-letgo (S drops the last 10 cm), lab-walk-run-off (running off: no grab).
- Client: the climb pose (arms up) while hanging, tag 'hang', in src/client/skater/poses.ts.
