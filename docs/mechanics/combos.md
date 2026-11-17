# Combo system (M4)
Milestone: M4

Input: Up then Down quickly (W,S) = manual; Down then Up = nose manual; ; (revert) right after landing on a transition = revert; I near the coping while coming up a vert wall slowly = lip trick; I near a wall in the air = wallride; K tapped in the air facing a wall = wallplant. Two quick directions then J or L, with the special meter full = special trick.
States: ground gains manual (balance on pitch); new lip and wall states.
Rules:
- Landing grace: a clean landing does not bank the combo at once. For combo.graceTicks the combo stays open; a manual or a revert in that window continues it. Otherwise it banks.
- Manual / nose manual: rolling with a pitch balance (unstable, world-RNG push, W/S correct). Ollie pops out and keeps the combo; losing balance bails; slowing below combo.manualMinSpeed ends it and banks. Can also start from rolling (classic arcade style). Points per second.
- Revert: within the grace window after landing on a surface steeper than combo.revertMinDeg; adds Revert and reopens the grace window (so you can manual out of it). Pressed in the air up to combo.revertBufferTicks (20, 0.17 s) before touching down, it counts on the landing (Thing.revertWant). A plain air (nothing in the combo) can be reverted too, within as long after the landing as the grace: the revert starts the combo. On the landing tick the revert goes first, so a manual pressed with it links: Revert + Manual (feel pass 2026-11-09; before, the window was the 11 ticks after the landing only, 92 ms, and a plain air could not revert; now 30 ticks, 250 ms, either way). Scenarios lab-revert-early, lab-revert-plain, lab-revert-manual-early.
- Lip trick: in vert air near a coping line with along-coping speed under combo.lipMaxAlong, I + direction stalls on the coping (lips table). Hold I to stay, release to drop back in fakie; balance on A/D; lose it and bail.
- Wallride: in the air, I with a wall within combo.wallReach roughly along your travel; ride along it with reduced gravity for up to combo.wallrideTicks; K pops off; timeout drops off. The press counts for a wall only within combo.wallPressTicks (10) of it, though the grind buffer keeps it longer (grind.bufferTicks 14): the press for a grind beside a wall does not start a wallride on it (phase 24; scenarios lab-wallride-press-window, lab-wallride-early-press).
- Wallplant: K tapped in the air with a wall ahead within wallReach: bounce off (horizontal speed reversed x wallplantKeep, plus a pop). Once per air.
- Special meter: landed combos fill it (points / combo.specialPoints), bails empty it. When full, specials (tricks.json specials: two directions then a button) are available.
- Multiplier counts every trick, manual, revert, lip trick, wallride and wallplant.
Numbers: data/physics.json combo.*, data/tricks.json manuals, lips, specials.
Events: manualStart/End, revert, lipStart/End, wallrideStart/End, wallplant, specialReady.
Scenarios: lab-kickflip-to-manual, lab-manual-from-flat, lab-manual-bail, lab-revert-manual, lab-lip-stall, lab-wallride, lab-wallplant, lab-special.

Physics changes (2026-10-16):
- Manual balance gets harder with time like grinds (combo.manualRamp 0.12 per second); with no input
  a manual falls in about 2.3 s.
- Wallride is an arc, not a launch: the wall keeps at most combo.wallrideMaxUp (1.5 m/s) of the
  jump's upward speed. Before, the ollie's 4.3 m/s under 30% gravity carried the skater 2.2 m up the
  wall in 0.75 s and dropped it from 2.5 m (6.8 m/s into the floor); now it rises about 0.4 m, ends
  0.3 m up and lands at 3 m/s (lab-wallride).
- Stepping off the board (walk.md) banks an open combo and ends a manual.

Powerslides and foot tricks (physics phase 2):
- A powerslide is a trick (data/tricks.json powerslides). Held at least slide.minScoreTicks (0.25 s)
  and ended (let go, stopped, popped out of, rolled off an edge), it goes into the combo: 100 + 120
  per second, named FS/BS by its turn like a spin (counterclockwise is frontside for a regular rider).
  Crouched (K held) at more than slide.bertSpeed (5 m/s) for most of it, a hand goes down: a Bert
  Slide, 300 + 200 per second.
- It links combos like a manual: starting one keeps the combo open while sliding; after it, the
  landing grace lets you link on (manual, ollie) or the combo banks; an ollie out of a slide carries
  the combo into the air (letting go of Shift and K at once).
- Foot tricks (THUG; data/tricks.json foot), picked at the pop by the direction taps just before it
  (the last tap within combo.footWindow, 20 ticks): Boneless = W, W, then let go of K (pop x 1.2: a
  full ollie rises 1.66 m instead of 1.15, 150 points); No Comply = S, then let go of K (pop x 0.85:
  a quick 0.83 m hop, 100 points). Not out of a manual (its balance taps would read as one). They
  start the combo as a trick and set Thing.footTrick for the view (a foot off the board).
- Scenarios: lab-powerslide-trick (FS Powerslide 190; a 0.17 s tap scores nothing), lab-bertslide
  (FS Bert Slide 413, popped into an ollie, banks on the landing), lab-powerslide-link (Kickflip +
  FS Powerslide x2), lab-boneless (1.78 m peak), lab-nocomply (0.95 m peak).

Scoring integrity (physics phase 17): an exploit search over every way to score (scripted
mashing of each move, and `skate farm`, random button patterns at every spot of a park) found these
farms; each is closed by a rule, its numbers in data, and pinned by a scenario that mashes it:
- The repetition curve (scoring.repeat, air-tricks.md): 100%, 75%, 50%, 25%, then 10% for the same
  trick id again in one combo. The floor makes a long chain of one link grow with its square, so the
  links below had to stop repeating for nothing.
- Revert: one per landing (tapping ; kept reopening the grace: 272 reverts, 835,040 points from one
  landing). lab-revert-mash.
- Lip tricks: one per air (tapping I at the coping stalled again each tap: 30 lips in one air).
  Thing.lipped, cleared on landing. lab-lip-mash.
- Wallrides: at most combo.wallridesPerAir (2) in one air, and catching a wall never lifts you (the
  catch used to set at least 0.5 m/s up, so mashing I re-caught the wall after each timeout and
  wallie, wallride, wallie climbed past the wall top). Thing.wallrides, cleared on landing.
  lab-wallride-mash, lab-wallie-mash.
- Powerslides: a slide does not link to the slide just before it (that banks the combo first), and a
  slide too short to count (under slide.minScoreTicks) banks the combo instead of holding it open (a
  tap kept a combo open with nothing in it, so every later ollie carried it on; the random search
  found it). lab-powerslide-chain, lab-powerslide-tap.
- Manuals: none below combo.manualStartSpeed (2 m/s; they still run down to manualMinSpeed, 0.8): at
  walking pace a manual stopped at once and banked, 942 points a second standing still. Rocking W/S
  in a manual does not balance it. lab-manual-mash.
- Balance gets touchier with each link of the same kind already in the combo (later classic games): a manual
  starts combo.manualComboTilt (0.03) further over and tips combo.manualComboRamp (0.2) faster for
  each manual in it; grinds (and slides) and lip tricks the same with grind.comboTilt and
  grind.comboRamp. Even perfect presses lose a chain of about 28 (tricks.ts comboLinks).
  lab-grind-hop-chain, tests/scoring.test.ts.
- Skitch, car hop, NEAR MISS, crest airs and grinds caught again: see traffic.md, goals.md, peds.md
  and grinds.md. Burritos and the tape do not come back (soma-burrito-once, tour-tape-once).
- Checked, not farms: a spine transfer is one per air, a wallplant one per air, a held skitch or a
  long manual pays per second with real balance (about 75-150 a second).
