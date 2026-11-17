# Air tricks (M2)
Milestone: M2

Input (keyboard):
- K or Space: hold on the ground to crouch and charge, release to ollie. Releasing within ollie.lateTicks after rolling off an edge still pops (late ollie).
- In the air: A/D or U/O spin left/right; J + direction = flip trick; L + direction = grab trick (hold L to keep grabbing, release to let go). The direction held at the moment J/L goes down picks the trick (8 directions plus none). A diagonal's second key that comes within tricks.dirTicks (5, 42 ms) after J or L still counts (keys pressed together on a keyboard land a tick or two apart): up held, J, then right 2 ticks later is the up-right trick (lab-diagonal-late-key; 8 ticks later it is a spin, lab-diagonal-too-late). From no direction only a diagonal counts so (a lone arrow just after J may be a spin).
- The flip slots follow Tony Hawk's Pro Skater 1 + 2 (2020; docs/mechanics/trick-list.md has the sources and the table): left Kickflip, right Heelflip, up Impossible, down Pop Shove-It, up-left Hardflip, up-right Inward Heelflip, down-left Varial Kickflip, down-right Varial Heelflip. Until 2026-11-16 up-right was the 360 Flip; a playtest pressed W + D and J for the inward heelflip, which is where THPS 1+2 has it.
- Double and triple tap (THPS): J pressed again within tricks.doubleTapTicks (16) of the last press turns the flip into its slot's next variant, running on from there (tricks.json flips with taps 2, then taps 3): left Double Kickflip, Triple Kickflip; right Double Heelflip, Triple Heelflip; down 360 Shove-It, 540 Shove-It; up Double Impossible, Triple Impossible; down-left 360 Flip; down-right Laser Flip; up-left 360 Hardflip; up-right 360 Inward Heelflip. A later press is ignored while the flip runs, as before.
- The direction twice (THPS 2's double-direction slots, kept in THPS 1+2; tricks.json twice): Right, then Right with J = FS Shove-It (J again: FS 360 Shove-It). Both presses in this air, the second within 20 ticks of the first and J within 12 of it (balance taps on a grind before the pop do not count). No special meter needed. A special's two directions (Right, Down + J) gone down within dirTicks of each other and both still held are a diagonal, not the special (lab-special-chord-diagonal).
States: air gains a current trick (or none). A trick runs its ticks (flips) or enter/hold/exit (grabs); a new trick can start once the current one ends.
Rules:
- Board turns (tricks.json roll, yaw, pitch, in turns): roll +1 is a kickflip, the heel-side edge dipping first (the front foot flicks off the heel-side corner of the nose), -1 a heelflip (the toe-side edge first); yaw +0.5 is a backside pop shove-it (the tail swings behind the rider, to the heel side), -0.5 frontside; pitch +1 an impossible (nose up and over the back foot). Varial Kickflip = BS shove + kickflip, Varial Heelflip = FS shove + heelflip, Hardflip = FS shove + kickflip, Inward Heelflip = BS shove + heelflip, 360 Flip = BS 360 shove + kickflip, Laser Flip = FS 360 shove + heelflip. The view (poses.json flipTilt) stands the hardflip up near vertical between the legs half way round (tail up), the inward heelflip less; the varials and 360 flips stay flat.
- Named: a flip and the body's turn that skaters call one trick (tricks.json named): a 360 Shove-It with a BS 180 in the same air is a Bigspin (FS 360 Shove-It with an FS 180 an FS Bigspin); at the landing it takes the place of both entries.
- Board turns of the THPS 1+2 additions: Double Impossible pitch 2, Triple Impossible pitch 3 (round the back foot, poses.json flipPivot); 360 Hardflip = FS 360 shove + kickflip (roll +1, yaw -1), 360 Inward Heelflip = BS 360 shove + heelflip (roll -1, yaw +1); Triple Kickflip roll 3, Triple Heelflip roll -3, 540 Shove-It yaw 1.5. The view: the impossibles and the hardflips turn from 0.32 and 0.3 of the trick (poses.json flipTurn), after the legs have spread, as the old double-tap window drew them (tests/flipcontact.test.ts).
- Stance (Thing.stance, set at the pop): K pops off the tail, the nose button (Q; player 2 Numpad1; data/controls.json nose; the pad has no free button) held as K is let go pops off the nose. Rolling forward off the tail: regular; off the nose: Nollie. Rolling backward off the tail: Fakie; off the nose: Switch (the rider's natural front foot pops the trailing nose). Flips, grabs, spins and Bigspin carry the name (Nollie Heelflip, Switch Kickflip, Fakie Bigspin; same id, so the repeat curve and S.K.A.T.E. count them as the trick) and tricks.stance's points (switch 1.25, nollie 1.15, fakie 1). Fakie spins: Half Cab (BS 180), Full Cab (BS 360), else Fakie FS 180. Switch spins are named in the other stance (a regular rider's switch FS 180 turns clockwise). Off the nose the view mirrors the pop and flick along the board and the shove scoops the nose. A fakie-to-forward revert brings the rider back to regular (the body turns with the board), and the ride-away after a 180 is fakie, not switch: switch is popping off the nose while rolling backward.
- Ollie: pop speed = lerp(ollie.popMin, ollie.popMax, charge / ollie.chargeTicks) along a mix of the surface normal and world up (ollie.upMix). Moving backward makes it a fakie ollie.
- Spin: spin input accelerates the board's rotation about its up axis up to air.spinMax (rad/s); without input it decays by air.spinDecay. Total rotation is rounded to the nearest 180 on landing (FS/BS 180, 360, ...). Turning left (counterclockwise from above) is frontside for a regular rider (data/rider.json), backside for goofy; fakie spins keep the same name for the same turn (half-cab = fakie BS 180). Because landing compares board and travel direction, a 180 lands fakie, a 360 lands forward.
- Flip tricks rotate the board (roll/yaw/pitch turns from tricks.json) over their ticks. Grabs hold until L is released, then take exitTicks to let go.
- Landing with a trick still running is a bail (as in THPS). Otherwise the air's tricks are banked.
- Score: each trick's points (grabs add pointsPerSecond while held; spins add scoring.spinPer180 per half turn), the n-th time a trick (by id: flips, grabs, grinds, slides, lips, manuals, and every other combo entry: gaps, spins, reverts) is in one combo it is worth scoring.repeat[n-1] of its points (THPS 2: 100%, 75%, 50%, 25%, then the 10% floor; physics phase 17, replacing a flat half per repeat), rounded per entry; the multiplier is the number of tricks, repeats included. Bail loses the combo.
Numbers:      data/tricks.json (trick tables), data/physics.json ollie.*, air.spin*, data/scoring.json.
Events:       pop {charge, fakie}, trickStart {trick}, trickEnd {trick}, comboLanded {name, points, multiplier, entries: {id, name, points, value}[]} (value: the entry after the repetition curve; comboValue(sim, entries).values gives the same for the combo in progress, for the trick string), comboLost.
Review:       ./skate strip --sheet scenarios/flips.strips (every flip from the front quarter, flick to catch).
Scenarios:    lab-<flip>-lands for every flip (doublekickflip, doubleheelflip, 360shoveit, fsshoveit, fs360shoveit, inwardheelflip, laserflip added with the double tap; doubleimpossible, 360hardflip, 360inwardheelflip, triplekickflip, tripleheelflip, 540shoveit, tripleimpossible with the THPS 1+2 table), lab-diagonal-late-key, lab-diagonal-too-late, lab-special-chord-diagonal, lab-single-tap-stays, lab-bigspin, lab-halfcab, lab-ollie-height (full charge vs tap), lab-late-ollie, lab-kickflip-lands, lab-early-land-bails, lab-180-lands-fakie, lab-grab-hold-points, soma-big3-kickflip, lab-repeat-curve (six kickflips in one air, 100 + 75 + 50 + 25 + 10 + 10), lab-repeat-by-id (kickflip and heelflip in turn, 100, 75, 50 each).

Feel numbers (physics quality pass, 2026-10-16; measured on the lab flat):
- Ollie height does not depend on speed (THPS, and true of a real pop): a tap rises 0.53 m (0.65 s of
  air), 10 ticks of charge 0.69 m (0.75 s), full charge (30 ticks) 1.15 m (0.97 s), about the world
  record ollie, at real gravity. Kept: big ollies are the THPS feel, and the air time follows from
  the height at 1 g.
- Spin: a full flat ollie holding spin turns 411 degrees, so a 360 on flat and 540s off ramps. Kept.
- Vert: from 10 m/s on the flat the 3.4 m lab vert is left with 4.3 m/s up (0.94 m above the
  coping); popping at the coping adds 4.8 m/s straight up (about 4 m of air), which is the THPS way
  to go big. Drag and rolling resistance now cost a 9 m/s approach about 3 J/kg (board.md), and the
  coping rule launches slow riders instead of rolling them onto the deck (rolling.md).
- Air drag is quadratic (board.md aero.*): 0.4 m/s^2 at 10 m/s, negligible in an ollie.
- Landing quality and the danger forecast: board.md.

Spine transfers (physics phase 3; src/sim/skater/spine.ts, data/physics.json spine):
- In the air off a transition (the takeoff surface steeper than spine.takeoffDeg, 30 degrees), ; (the
  revert button; pad R2) carries you over a spine: two ramps back to back. Pressed on the way up the
  wall or in the air, it is remembered for spine.bufferTicks (0.25 s) and tried every tick, so it
  starts once the arc clears.
- The far ramp is found by looking straight down along the way over the lip (from just above the
  skater, so guards and decks overhead do not count), up to spine.reach (2.5 m), where the skater
  will be along the lip by then: past the ridge, a surface facing the far side (steeper than
  spine.minDeg), spine.landDrop (0.6 m) below the top. Something higher beyond the ridge (a wall, a
  deck) is not a spine.
- The arc keeps the speed along the lip and sets the speed across it (at most spine.maxSpeed, 6 m/s)
  to come down on that spot; a sphere of spine.clearance (0.8) x the radius swept along it must
  touch nothing (the ridge, a guard rail, a column) until the far wall. The board turns to meet the
  far wall, nose down it (tail when riding fakie), and keeps it as its up for the rest of the air.
- Scores "Spine Transfer" (data/tricks.json spine, 250) into the combo; tricks on top add to it.
  Thing.spine marks the air for the view. Event spineTransfer {gap, points}.
- Where: the lab has a test spine (two 1.7 m quarters back to back, ridge at y = -10, spots
  lab_spine_south/north). On the SoMa park the Otis portal quarterpipe and the north rear Hellride
  quarter are back to back (ridge near 87.7, 22); its guard rail and the angled faces make it
  narrow: approach the Otis quarter head-on (heading about 61) at about 9 m/s. The volcano is a
  cone round a column and the wave has no back-to-back faces: no transfers there.
- Scenarios: lab-spine-transfer (clean landing down the north face), lab-spine-none (no press:
  back down fakie), lab-spine-early (pressed on the wall), lab-spine-trick (Spine Transfer +
  Kickflip x2), soma-hellride-spine (over the Otis/Hellride spine).
