# Rolling (M1)
Milestone: M1. Steering, grip, slopes, drag, braking, powerslides, wobble and landing quality moved to
board.md on 2026-10-16; this file keeps the surface-following and vert rules.

Input:        up = push, down = foot brake, left/right = lean (turn), ollie held on the ground = crouch
              (tuck, pump, charge), Shift = powerslide. Details in board.md.
States:       ground, air, bail. ground -> air when the surface ahead ends; air -> ground on a landing;
              air -> bail on a bad landing; bail -> ground after bail.ticks.
Rules:
- Ground: velocity lies in the surface plane and follows the board where the wheels grip (board.md).
  The skater follows the surface while it curves no faster than gravity can hold: over convex shapes
  the wheels may leave the surface by stickGap (seams) or what gravity closes in a tick; more launches.
  Going up a transition (the board tilted more than ground.transitionDeg, or the surface turning up
  into the path) the seams may open up to ground.transitionStickGap: only an edge launches (phase 27).
- Curb hop (feel pass 2026-11-09): rolling into a riser no higher than ground.curbHop (0.18 m) above
  the wheels, met within ground.curbHopDeg (50) of head-on at ground.curbHopMinSpeed (1.5 m/s) or
  more, with flat rideable ground on top for ground.curbHopDepth (0.45 m) and room above, the board
  rolls up onto it keeping ground.curbHopKeep (85%) of its speed (event bump {height}). Before, the
  12 cm wheels' sphere stopped dead against a city curb's face (14-17 cm) in one tick from any speed.
  A stair tread is shallower than curbHopDepth, so stairs still stop you: ollie them.
  For the view, Thing.bump counts down from ground.curbHopBumpTicks (12) after a roll-up: the board's
  nose lifts up to 9 degrees over the kerb and comes down, pivoting on its back wheels (src/client/
  skater/poses.ts; feel pass round 4, for the trick poses). Scenarios
  sf-curb-hop (5 m/s head-on: up at 4.0 m/s, no air), sf-curb-hop-angled (40 degrees, 6 m/s),
  lab-stairs-up-blocked.
- Ledge pop (feel pass round 2): an ollie popped too late at a ledge used to meet its face on the
  way up and stop dead in front of it (or catch the edge and bail). Within air.ledgePop.ticks (36) of
  an ollie, not in vert air and with no grind pressed, moving at minSpeed (1.5 m/s) or more within deg
  (50) of head-on into a face whose top is at most reach (0.4 m) above the wheels and at most maxHeight
  (0.55 m) above the ground below, with depth (0.3 m) of flat top and room, the skater is moved up past
  the edge keeping keep (90%) of its speed, and the ollie's arc carries on from there: on top, or past a
  narrow ledge (event bump {height, air: true}). Higher ledges and walls still stop you. At the lab's
  0.45 m ledge, popped 0.2 to 0.8 m before it at 4 and 6 m/s: before, short in 11 of 16 tries and a bail
  in 1; after, over or on it in all 16. Scenarios lab-ledge-late-pop, lab-ledge-pop-flip,
  lab-ledge-pop-too-high; sf-gap-potrero-ledge now adds a kickflip to its line (its grind keeps the
  speed the face used to take, so it banks less on its own).
- Coping: riding up a wall steeper than vert.minWallDeg, once the skater rises past the height of a
  walkable top in reach (the deck behind the coping), it leaves the wall (vert air). Gravity pulls
  along a vertical wall, never into it, so nothing can hold a skater round that edge; before this
  rule a slow skater rolled over the coping onto the deck.
- Into the coping (phase 27): riding up a transition (the board and the face steeper than
  vert.copingMinDeg) toward the coping pipe on its lip (rail-class faces above the wheels within this
  tick's travel and vert.copingReach), the skater leaves the wall now as vert air, moved out by as much
  as the pipe overhangs the way up, so the air clears it: the pipe used to take most of the air's speed.
- Vert takeoff: leaving a surface steeper than vert.minWallDeg - vert.topToleranceDeg (the face under
  the wheels or the board's up, whichever is steeper) while moving up it starts vert air. The
  board keeps the wall as its "up", the horizontal push away from the wall is removed and replaced by
  a small drift back over the ramp (vert.reentry metres over the predicted airtime). Speed along the
  coping is kept. You go straight up and come back down onto the ramp.
- Other takeoffs (bank tops, ledges, stairs) keep their velocity; the board eases toward level.
- Landing: see board.md (clean, sketchy, stumble, or bail by angle and impact speed).
- Bail: the skater slides to a stop with bail.friction, ignores input for bail.ticks, then stands up
  where it stopped. Quick get-up (feel pass 2026-11-09): after bail.getUpTicks (0.5 s), once the
  slide is under bail.getUpSpeed (3 m/s), a fresh press of ollie or push stands it up at once; that
  press does not pop an ollie when let go. The get-up plays the bail's own end, quickly (round 2): the
  bail clock, which every character's bail animation reads, jumps to bail.getUpFrom (112, where they
  start getting up) and runs at bail.getUpRate (3x) to bail.ticks, so the view blends from lying to
  standing in about 13 ticks instead of snapping up (Thing.getUp). A 5 m/s bail gave control back after
  1.24 s; pressing, after 0.63 s (0.53 s in round 1, with the snap) (lab-bail-getup).
Numbers:      data/physics.json ground.*, vert.*, land.*, bail.*; board.* and friends in board.md.
Events:       air {vert}, land {fakie, angleErr, quality, impact}, bail {reason}, recover, bump {height}.
Scenarios:    lab-vert-air (10 m/s reaches the coping with 4.3 m/s up, about 1 m of air, lands fakie),
              lab-vert-push (pushing to 9 m/s from 10 m out just clears the 3.4 m lip), lab-pump-crouch /
              lab-pump-plain (crouching through the 1.2 m quarter returns 4.9 m/s, plain 4.0 m/s, from
              4.5 m/s), lab-sideways-bail, soma-west-runway.
Feel notes:   2026-10-16 playtest: rolling works. 2026-10-16: see board.md.
