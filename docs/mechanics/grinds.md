# Grinds and slides (M3)
Milestone: M3

Grind lines: derived from park geometry at load (src/sim/park/grindlines.ts): convex edges where a near-level top meets a steep side (ledges, pads, terrace edges, platform drops, quarterpipe coping), chained into polylines, plus round rails from the export. Stairs are excluded. Lines sit exactly on real corners and follow park fixes automatically. physics.grind.lines sets the angle, drop and length thresholds.

Input: I (grind) + direction, in the air. The press is remembered for grind.bufferTicks (14, 117 ms, since phase 24; it was 10), so pressing it just before reaching the rail works; a wall takes the same press only within combo.wallPressTicks (10) of it (combos.md). Pressing I + direction again while grinding switches the grind (into a different grind, after grind.switchTicks, 20, on this one; the same grind again is no switch). A grind left within grind.voidTicks (12) of its start never happened: no entry, no gap (grindEnd reason void), so tapping I at a standstill or at a line's end scores nothing. While grinding: A/D balance, hold K to charge and release to ollie off. Released before voidTicks, the pop waits until they have passed (if the grind ends first, a void grind, there is no pop), and a void grind allows no late ollie (phase 25: caught and popped at once, a flip, caught again was a combo that never landed; sf-ledge-hop-farm-pop).
States: air -> grind on capture; grind -> air at a line end, on ollie, or when it stalls; grind -> bail when balance is lost.
Rules:
- Capture: nearest line whose closest point is within grind.captureRadius horizontally of the board, with the board between captureBelow under and captureAbove over it, and no flip/grab still running. Nothing solid may lie between the skater and its place on the line (physics phase 15: a hit more than 0.2 m from the line, like a parked car between skater and curb, refuses the capture; since city phase 8 parked cars stand 0.62 m off the curb, so the curb behind a car is out of reach anyway).
- Grind or slide: board within slideAngleDeg of the line = grind, across it = slide.
- Which way along the line (2026-11-16): the velocity along the line at the catch, except that on a line sloped more than grind.downhillSlope (0.035, 2 degrees) rising is not travel up it: when the climb would turn the sign, the horizontal travel along the line decides, at that speed; a slide too slow for slideMinSpeed goes downhill; a near-standstill catch goes downhill. Before, a boardslide caught across a handrail on the way up slid up the rail and stalled (a playtest report: a rail grind going down turned and started grinding up; sf-bart-rail-slide-downhill, tests/grinddownhill.test.ts sweeps every sloped line of the lab, SoMa and the city's handrails). The slow-motion camera for a grind down a slope is a tracking shot from the side (moments.json shots.track).
- Near and far side: the side of the line the air started on (takeoffXY) is the near (approach) side; if that is on the line, where the skater is now; then the way they drift. The other side is the far side.
- Frontside / backside: FS when the chest faced the rail on the way in, i.e. the far side is on the chest side. Regular riders (data/rider.json) face the right of the nose, goofy the left. Grinds use the board as it lands (so fakie works); slides are named for a forward approach (nose in the travel direction). Every name gets the prefix: FS 50-50, BS Smith Grind, FS Boardslide. A grind ridden tail first is a Fakie one (Fakie FS 50-50). So a backside boardslide slides facing forward and a frontside one blind; a frontside lipslide or tailslide faces forward, a backside one is blind; a backside noseslide faces forward.
- Stick on the rail: up/down along the board; left/right become toward (the far side) or away (the approach side), relative to the travel direction.
- Grinds (data/tricks.json grinds, dirs): none 50-50; up Nosegrind; down 5-0; up+toward Crooked (front truck, nose angled onto the ledge top, tail out over the approach side); up+away Overcrook (front truck, tail over the far side); down+toward or toward Feeble (back truck, front truck over the far side); down+away or away Smith (back truck, front dipped on the approach side). Missing combinations fall back to the up/down part, then none.
- Stance: the air's stance (Nollie, Switch, Fakie) names and scores the grind or slide (Switch FS Crooked Grind); else a grind ridden tail first is Fakie. Riding switch, the rider's nose and front truck are the board's tail and back truck: a switch nosegrind grinds the board's back truck, a switch noseslide slides the board's tail (the view mirrors the pose along the board). Slides take FS/BS from the real approach: in fakie or switch the chest faces the other side of the way it slides.
- Bluntslides: 55 degrees steep, the tail down at the edge, the back wheels hooked over onto the top (or over the rail, the rail between the wheels and the tail); the board's nose leans over the far side, so tricks.json gives the bluntslide nose far (it faces like a boardslide) and the nosebluntslide nose near.
- Double tap (tricks.json taps 2): I twice, both presses before the lock-on (the second while the first is still buffered: Thing.grindTaps) or the second within tricks.doubleTapTicks (16) after it (GrindRun.tapped, once, no entry for the first), picks the variant with the free end the other way: Feeble / Salad (back truck, nose raised over the far side), Smith / Suski (back truck, nose raised, angled back over the approach side), Crooked / Willy (front truck, back truck dipped on the approach side), Overcrook / Losi (front truck, back truck over the far side). The direction counts as it locks on, as for every grind. Mashing I (a press every few ticks) is a double tap.
- Slides (slides, dirs + nose): none/toward/away Boardslide if the nose points over the far side (front truck crossed), Lipslide if it points back (back truck crossed); up Noseslide; down Tailslide; up+side Nosebluntslide; down+side Bluntslide. Noseslide and Nosebluntslide put the nose over the far side, Tailslide and Bluntslide put it back; the board turns to match.
- Poses (data/poses.json grinds/slides) are written frontside, with the far side = toe side; backside mirrors the board's yaw, roll and sideways shift. Board yaw and pitch turn about the grinding truck so it stays on the rail.
- On what it grinds: the view probes the park 12 cm out on the far side; a top there (a ledge, coping, a curb, a car roof) takes the poses.json grindsTop / slidesTop pose where it differs (the far wheels rest on the top: the 50-50 family tips 12 degrees toward the approach side, a feeble's front truck and a losi's back truck lie on the top, a boardslide or lipslide on a ledge pitches up over its far truck); a rail keeps the hanging ones. Then poses.ts seat puts the grinding truck's hanger on the edge (both for a 50-50) or a slide's underside on it. Bluntslides put the back wheels up on top past the edge, the board steep, the nose high on the approach side (nosebluntslides the mirror). tests/trickcontact.test.ts measures every grind and slide on a ledge and a rail (src/client/skater/contact.ts): on the line, nothing through it.
- Along the line: speed changes with gravity along the slope and grind.friction; a slide approach keeps at least slideMinSpeed. Below stallSpeed it drops off. A catch slower than stallSpeed along the line (not a slide) is no grind at all (phase 25): the skater comes down on the line instead. It stalled on its first tick, a void grind, and a late ollie off it popped the skater straight up again, so a flip between catches at a ledge's end kept a combo in the air forever (sf-ledge-hop-farm).
- Balance: b'' = balanceInstability*b + random push (world.rng, balanceNoise) + balanceControl*input. Past |b| = 1 it bails. The HUD shows the meter.
- Leaving: at a line end it rolls off with exitPop up; ollie pops off with the charged pop. The grind is added to the combo with points + pointsPerSecond * time. The combo carries through grinds and banks on landing.
Numbers:      data/physics.json grind.*, data/tricks.json grinds/slides, data/rider.json stance.
Review:       ./skate strip --sheet scenarios/grinds.strips (every grind FS and BS on the lab ledge, along the edge and from the side), scenarios/slides.strips (every slide on the lab rail)
Events:       grindStart {trick, line}, grindEnd {trick, reason, points}.
Scenarios:    lab-grind-table-bs, lab-grind-table-fs, lab-grind-variants-fs, lab-grind-variants-bs, lab-grind-double-tap, lab-slide-table, lab-goofy-names, lab-5050-ledge, lab-boardslide-rail, lab-down-rail, lab-grind-switch, lab-balance-bail, lab-ollie-off-grind, soma-ledge-grind.

Physics changes (2026-10-16):
- Air drag along the line too (board.md aero.*): with grind.friction it caps a downhill grind; the
  hill's curb tops out near 11.9 m/s on the 10% instead of accelerating forever (lab-hill-curb-grind).
- Balance gets harder the longer the grind (THPS): instability and noise grow by grind.balanceRamp
  (0.12) per second, so a 10 s grind is 2.2x as twitchy as the first moment. With no input a grind
  falls in about 2 s either way; a perfect balancer (the scenario bot) lasts about 19 s, so long
  curb and rail grinds are a skill. Lip stalls use the same ramp.
- Grind and lip balance feed Thing.danger (board.md, signals): the face shows scared about 13
  ticks before a balance bail.
- Hill curbs (17 cm, collection obstacles, type curb) are 255 m grind lines (hill.md).
- Capture looks only at lines near the feet (physics phase 7): park.grindGrid is a uniform grid
  (grind.lines.gridCell, 6 m) over the lines' bounding boxes, built at park load; grindNear returns
  the ids whose boxes may reach the capture box, each once, in ascending id order, the order a full
  scan meets them, so the nearest-line choice and its tie-break are unchanged (all 149 scenarios kept
  their hash chains byte for byte). Cost no longer grows with the line count: a synthetic park with
  50,000 ledges keeps a skater pressing grind at p99 0.011 ms per tick (tests/grindgrid.test.ts).
- Caught again only on the way down (physics phase 17): after leaving a grind, while still going
  up, only a line at least grind.regrabAbove (0.1 m) higher than the one left can be caught (a
  transfer up). Popping off a rail and catching it, or the ledge's other edge, the next tick was an
  endless chain of grinds, seven a second; a regrind now comes back down onto it (about 0.35 s for a
  small pop). Thing.offZ (the height left), cleared on landing. At a line's end the next wall beside
  it, if higher, is still caught at once: on Patricia's Green the short seat wall now carries on onto
  the long one (tour-hayes-sick).
- Each grind already in the combo makes the next one touchier (combos.md, grind.comboTilt and
  grind.comboRamp); scenario lab-grind-hop-chain (the 28th hop falls).
- Leaving a grind resolves the skater against the park before it flies (physics phase 17): at a
  line's end the sphere could be left inside what the line runs into (a parked car's hood edge ends
  at its cabin: 4.5 cm in, city sweep car-cabin-corner, then sf-car-cabin-corner, retired with its block in the squeeze).
- The line-of-sight rule's scenario is sf-grind-through-solid (the 16th St BART handrail inside its
  stair wall, refused; the wall's edge caught instead), since parked cars moved off the curb.
- The capture's line of sight is a swept sphere (physics phase 18): grind.sightRadius (6 cm)
  moved from the skater to its place on the line in steps of three quarters of it, refused by any
  contact more than grind.sightSkip (0.2 m) from the line (nearer is the line's own ledge or rail).
  The single ray it replaces slipped through the 10 cm slot between the SoMa park's north wall and
  the fence on top of it. Scenario sf-grind-fence-gap.
