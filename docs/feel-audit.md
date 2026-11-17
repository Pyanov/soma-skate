# Feel audit: the core controls against THPS 1+2

Every number below comes from the real sim, run by `./skate feel` (the
harness module `src/harness/feel.ts`; `--section ollie|capture|balance|landing|spin|special`,
`--trials n`; `--tour` for section 8, every Tour goal with human hands; `--section flow` for section 11; `--section vert` for section
9, every quarter's lip; `--section drive` for section 10, the vehicles). Re-run it after any change to `data/physics.json` and compare.

THPS 1+2 references: neither game published its constants. The THPS column describes how the games
play, from play and common player knowledge. It is approximate and has no measured numbers.

The audit led to three data changes (section 7): balance damping doubled, a longer late-ollie window,
and gentler impact limits. A second tuning pass took its two proposals: a longer early grind press (with the
wallride's press window split off in code) and a wider clean landing. The tables show the values
after them; "before" gives the old value where it changed.

## 1. Ollie: timing and height

Hold ollie to crouch, release to pop. The pop speed rises with the crouch up to `ollie.chargeTicks`
(30 ticks, 0.25 s), from `popMin` 3.2 to `popMax` 4.8 m/s. Measured on the lab floor:

| crouch held | pop m/s | height m | air s |
|---|---|---|---|
| 1 tick (a tap) | 3.25 | 0.53 | 0.65 |
| 50 ms | 3.52 | 0.62 | 0.71 |
| 100 ms | 3.84 | 0.73 | 0.77 |
| 150 ms | 4.16 | 0.86 | 0.83 |
| 200 ms | 4.48 | 1.00 | 0.90 |
| 250 ms or more | 4.80 | 1.15 | 0.97 |

Rolling at 5 m/s gives the same numbers: the pop is straight up on the flat.

- **Late ollie** (release just after rolling off an edge, off the 0.45 m ledge's end at 4 m/s): it
  pops up to 11 ticks (92 ms) into the air. Before: 7 ticks (58 ms). The data value is
  `ollie.lateTicks` 12 (before: 8); the first air tick is spent leaving the edge.
- **THPS 1+2:** the pop comes on release, and a short crouch gives a higher ollie. A tapped ollie
  clears curbs and benches. Ollieing just after leaving a ledge or a lip is forgiving.
- **Finding:** the crouch-to-full time (0.25 s) and the tap height (0.53 m: a bench, a low ledge) fit.
  The late-ollie window was tight at 58 ms, about a third of a human reaction spread. Now 92 ms.

## 2. Grind capture: radius and forgiveness

Capture works on geometry only. With a grind press buffered (`grind.bufferTicks` 14 = 117 ms before;
83 ms before the second pass),
the skater snaps to the nearest line whose closest point is within `captureRadius` 0.75 m across its
feet, from 1.0 m above it to 0.2 m below. No approach angle is refused: steep ones become slides.

**The grid.** For each line, approaches at 5 m/s at angles from 0 (along it) to 90 degrees (straight at
it). Each comes down so its feet reach the line's height *d* metres short of it (negative: past it,
for the rail). The press is repeated every 3 ticks, so timing never matters. G means it grinds.

| line | angle | -0.75 | -0.5 | -0.25 | 0 | 0.25 | 0.5 | 0.75 | 0.9 | 1.0 | 1.25 | near misses that grind |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.45 m ledge, 1.0 m ledge | 0, 15 | | | | G | G | G | G | . | . | . | 3/6 |
| | 30 | | | | G | G | G | G | G | . | . | 4/6 |
| | 45, 60, 75, 90 | | | | G | G | G | G | G | G | . | 5/6 |
| flat rail 0.35 m | 0, 15 | G | G | G | G | G | G | G | . | . | . | 3/6 |
| | 30 | G | G | G | G | G | G | G | G | . | . | 4/6 |
| | 45, 60, 75, 90 | G | G | G | G | G | G | G | G | G | . | 5/6 |

- **Capture rate.** Every miss up to 0.75 m short grinds, from every angle and on every line. So does
  overshooting the rail by up to 0.75 m, its feet passing over it. Beyond 0.75 m it depends on the
  angle: approaches heading into the line keep closing on it as their feet dip the last 0.2 m. So
  0.9 m grinds from 30 degrees and 1.0 m from 45 degrees, but neither does along the line. Nothing
  grinds at 1.25 m. Across the near misses (0.25 to 1.25 m short), 50% grind along the line, 67% at
  30 degrees and 83% from 45 degrees.
- **Consistency.** The radius is the same from every angle. Only the extra reach of a steep approach
  differs, by up to a quarter metre.
- **Press timing.** One press, dead on, at 7.5 m/s. The press may come 117 ms before the line is in
  reach (the buffer; 83 ms before the second pass). The line is in reach from 0.08 s (straight at it) to
  0.13 s (at 45 degrees) before the feet reach its height. In all, 24 to 41 different press ticks grind:
  a window of 200-242 ms on the ledges and 300-342 ms on the rail, which can also be caught after
  passing it. Before the second pass: 20 to 37 ticks, 167-208 ms and 267-308 ms.
- **Wallrides keep their own, shorter window** (`combo.wallPressTicks` 10, since the second pass). Beside the
  lab's wall, a grind press up to 9 ticks (75 ms) before the wall is in reach starts a wallride, as
  before; an earlier one does not, though it would still catch a line. When one window served both,
  growing it made the press for Patricia's Green bench also start a wallride on the wall beside it.
- **THPS 1+2:** grinds are famously generous. Press grind near a rail or ledge and the skater snaps on
  from about a body width away and from almost any angle (across it, a boardslide or lipslide).
- **Finding:** the reach (0.75 m, up to 1.0 m) and the any-angle rule fit. The 83 ms early-press buffer
  was the tightest part; the second pass made it 117 ms (proposal 5).

## 3. Balance: how long a player holds a grind or a manual

Grind and manual balance is an unstable needle: instability grows with time held and with links of
the same kind in the combo, plus noise. Stick input pushes it back and damping slows it.

**Method.** A player model reads the meter late (reaction delay), misreads it (a Gaussian error, a new
glance every 100 ms), leads the needle a little by its motion, and pushes while the needle is outside a
small dead zone. Grinds run on the lab's 260 m hill curb, downhill, from the real `stepGrind`; the
curb ends at about 37 s. Manuals run `stepManual` itself at a steady 5 m/s, up to 60 s. There are 24
trials per player, each from its own seed.

| player | grind median s (p10-p90) | manual median s (p10-p90) | before: grind / manual median |
|---|---|---|---|
| perfect (the scenario bot) | to the curb's end (37) | 60 cap (24/24) | to the end / 60 (14/24) |
| good: 150 ms, error sd 0.03 | 18.4 (14.4-22.7) | 22.6 (19.4-30.5) | 9.0 / 10.2 |
| decent: 200 ms, sd 0.05 | 9.5 (6.6-12.5) | 12.0 (7.3-15.7) | 3.6 / 3.9 |
| casual: 280 ms, sd 0.08 | 2.4 (1.8-3.8) | 2.9 (2.0-3.3) | 1.9 / 1.9 |

- **THPS 1+2:** a practised player keeps grinds and manuals for many seconds, and long manual links
  are the backbone of a THPS 2 combo. The needle gets faster the longer you hold.
- **Finding:** before, a decent player (200 ms) fell off a grind in 3.6 s and a manual in 3.9 s. That is
  sim-heavy: the needle ran away faster than a human can answer it. Instability and its ramp were not
  the cause. Halving the ramp or cutting instability by a fifth moved the decent player by under half a
  second, less noise by nothing, a weaker stick by about a second. Damping is what makes the needle
  answerable:
  doubling it (0.6 to 1.2) gives a decent player about 10-12 s and a good one about 20 s. It still
  ends, because the ramp still grows, and a casual player still falls in 2-3 s.

## 4. Landing leniency

Off a 1 m drop, the board turned by a yaw error from the travel direction. The verdict was the same at
2.5, 5 and 9 m/s:

| yaw error | verdict |
|---|---|
| 0-20 degrees | clean (`land.cleanDeg` 20; 15 before the second pass) |
| 30-45 | sketchy: the board straightens half way, a little speed scrubbed |
| 50-60 | stumble (`stumbleDeg` 45, `toleranceDeg` 60): speed x 0.6 |
| 65-120 | bail, landed sideways |
| 135 | stumble (fakie) |
| 150 | sketchy (fakie) |
| 165-180 | clean (fakie) |

Straight, by drop height:

| drop | impact | verdict now | before |
|---|---|---|---|
| 1-5 m | 4.4-9.8 m/s | clean | stumble from 3 m, bail at 5 m |
| 6-10 m | 10.7-13.8 m/s | stumble (`stumbleSpeed` 10) | bail |
| 11 m | 14.7 m/s | bail (`hardSpeed` 14) | bail |

- **THPS 1+2:** a landing roughly straight or fakie rolls away, and a sideways one bails. Height almost
  never matters: you can drop off roofs and land clean.
- **Finding:** the angle bands fit (a 60-degree margin each side of straight and fakie). The impact
  limits did not: a 3 m drop stumbled and a 5 m drop bailed, in a city of stairs and roofs. Now only
  drops over about 5 m stumble, and only about 11 m or more bails.

## 5. Spin

The spin key accelerates at `air.spinAccel` 22 rad/s² to `spinMax` 9.5 rad/s (544 degrees a second) in
0.43 s. Releasing it slows the spin at `spinDecay` 12. Holding spin from takeoff to touchdown (the spin
can always be stopped short):

| air | air s | rotation held | biggest landable spin |
|---|---|---|---|
| flat ollie, tapped | 0.65 | 234 degrees | 180 |
| flat ollie, full crouch | 0.97 | 406 | 360 |
| a 1.2 s air (kicker, gap) | 1.23 | 547 | 540 |
| 1.6 s | 1.61 | 756 | 720 |
| 2.0 s | 2.00 | 969 | 900 |

- **THPS 1+2:** a 180 off any ollie and a 360 off a full one; 540-720 off a kicker or a decent quarter
  air; the 900 is the big one.
- **Finding:** fits. No change.

## 6. Special meter

It fills by banked combo points over `combo.specialPoints` (3000) and empties on a bail. It does not
drain over time. In the Tour scenarios it fills after 10 s and 2 combos (Castro), 19 s and 4 combos
(SoMa), or 64 s and 1 big combo (Hayes, whose run waits at first).

- **THPS 1+2:** a few good combos fill it, a bail empties it, and it drains slowly while you are not
  tricking.
- **Finding:** the fill rate fits. The missing idle drain is a code change, not a data tweak, so it is
  noted here and not proposed.

## 7. Tweaks: forgiving and fast

| # | tweak | why | applied? |
|---|---|---|---|
| 1 | `grind.balanceDamping` and `combo.manualDamping` 0.6 to 1.2 | a decent player holds 10-12 s, not 3.6-3.9 (section 3) | yes |
| 2 | `ollie.lateTicks` 8 to 12 | late-ollie window 58 to 92 ms (section 1) | yes |
| 3 | `land.stumbleSpeed` 7 to 10, `land.hardSpeed` 9.5 to 14 | stumble from about 5 m, bail from about 11 m (section 4) | yes |
| 4 | `land.cleanDeg` 15 to 20 | more clean landings; THPS 2 has no sketchy band | second pass |
| 5 | `grind.bufferTicks` 10 to 14 | a longer early-press window (section 2) | second pass |

The second pass took 4 and 5, each with what held it back:
- **4: clean landings.** The S.K.A.T.E. locals' planned misses land a fixed distance past the clean band
  now (`land.cleanDeg` + 5 to + 20 degrees: 25-40 at 20), so they still land sketchy, a miss, as they
  were written to; the harness's sketchy bots land 10 past it. Hayes's lines moved about 1% and its
  tiers were re-measured (docs/mechanics/tour.md): they stay.
- **5: early grind press.** The same buffered press used to start wallrides too: at 14 ticks or more
  Patricia's Green Line picked up a Wallride from the wall beside its bench (the great run 70,290 to
  94,710). A wallride now takes the press only within `combo.wallPressTicks` (10) of it, so the grind
  buffer could grow to 14 with no other scenario changing.
Left alone:
- `captureRadius` 0.9 changes which lines eleven gap, goal and Tour
  scenarios catch, and `spinAccel` 28 makes the scripted spins over-rotate (and sections 2 and 5
  already fit).

**What the applied tweaks changed.** Every scenario still passes after four retunes:
- `lab-land-hard-bail`: now an 11 m drop.
- `lab-land-quality`: the stumble drop is now 5.5 m.
- `lab-manual-mash`: the mashed manual falls at 7.6 s, not 7.3 s.
- `tour-civic-sick`: the great run is 125,312, Sick on its eleventh pass. Before, the bot's
  balance taps once happened to make a Kickflip Superman; the row itself is still 11,392.

Hash chains change in 68 scenarios: every scenario with a grind or a manual (the balance state), the
two landing scenarios, and `sf-escape-alley` (the survival bonus). The goal events, gaps and Tour scores
in them are as before, apart from Civic's great run. The golden replay verifies (replays keep the data
they were recorded with), and the one-player world pins hold.

**What the second pass changed.** The split alone changes no hash. The longer buffer and the wider clean band
retune three scenarios (`sf-gap-once-per-combo`, `tour-hayes`, `tour-hayes-sick`: the line 6,390 to
6,320, the decent line 3,288 to 3,280, the great run 70,290 to 69,520) and re-pin the one-player worlds
(soma and sf move: checked against the previous code with the new clean band).

## 8. The Tour with human hands

Can a person do every Tour goal? The goals and tiers were set with bots that
press on exact ticks. `./skate feel --tour [--trials 50] [--level id]` plays each one with human
hands instead and counts how often it gets done.

**Method.** For every goal, the tool takes its leg of `tour-<level>` (and `tour-hills-twinpeaks` for
Upper Market): from the teleport before the goal to the next one. Each leg starts from the script's
own world at that teleport, so a bail in one leg does not spill into the next. S-K-A-T-E counts a
trial when all five letters' legs succeed in it. Pro and Sick play the great run (`tour-<level>-sick`)
through to the end and compare its final score with the tiers. A third player, perfect, replays the
script exactly. It must make 100% of every goal, which checks that the tool cuts the legs correctly
(`tests/feeltour.test.ts`).

The human, two players (decent / casual):
- **Timing:** every scripted press and release moves by an error with sd 40 / 70 ms. A chord (a flip
  and its direction) moves together.
- **Following the script:** the human follows what happens, not the clock. The script's time jumps
  to each of its phase changes (takeoff, landing, a grind starting and ending, a manual) when the
  skater makes it, early or late. After a different move, the script runs on by the clock.
- **Balance:** section 3's model, at 200 ms and sd 0.05 / 280 ms and sd 0.08.
- **The approach:** the teleport and speed stand in for the ride up, so each comes in a little off:
  heading sd 3 / 6 degrees, 0.15 / 0.3 m to the side, speed sd 5 / 10%.
- **Steering:** more than 0.3 m to the side of the script's line, the human steers for where the
  script's skater will be half a second later. It does not steer while charging an ollie or within
  half a second of a pop. A key held into the pop spins the board.
- **Rider lines:** where the script uses the autopilot, its keys arrive react / 4 late.

The table: 50 tries each, re-measured after the tape move (below) on the waterfront export (2026-10-18: re-parked cars, stable curbs, the waterfront). Transfer the Hellride moved with the vert fix (section 9), and the four tapes marked with values from the vert fix with the tape move. Other rows moved a few points with the vert fix's physics and the waterfront export: All the Way Down, Hayes's tape and the Embarcadero's Pier 7 legs among them.

| level | goal | decent | casual |
|---|---|---|---|
| SoMa | letter S | 86% | 88% |
| SoMa | Big 3 Combo | 48% | 20% |
| SoMa | letter T | 88% | 80% |
| SoMa | Ollie the Big 2 | 62% | 44% |
| SoMa | Transfer the Hellride | 90% (in the Tour audit: 28%) | 74% (12%) |
| SoMa | letter K | 100% | 100% |
| SoMa | letter A | 72% | 74% |
| SoMa | letter E | 100% | 100% |
| SoMa | secret tape | 36% (after the vert fix: 100%) | 8% (86%) |
| SoMa | S-K-A-T-E (all five) | 56% | 52% |
| Mission | secret tape | 20% | 6% |
| Mission | Ollie the BART Stairs | 96% | 82% |
| Mission | Wallride a Mural | 42% | 26% |
| Mission | Bench Combo at Dolores Park | 40% | 14% |
| Mission | letter S | 100% | 100% |
| Mission | letter K | 100% | 100% |
| Mission | letter A | 100% | 100% |
| Mission | letter T | 100% | 100% |
| Mission | letter E | 100% | 100% |
| Mission | S-K-A-T-E (all five) | 100% | 100% |
| Castro | secret tape | 36% (after the vert fix: 86%) | 12% (44%) |
| Castro | All the Way Down | 80% | 46% |
| Castro | letter A | 100% | 96% |
| Castro | Bomb Castro St | 100% | 100% |
| Castro | letter T | 100% | 98% |
| Castro | letter E | 100% | 100% |
| Castro | Rainbow Combo | 40% | 16% |
| Castro | letter S | 98% | 70% |
| Castro | letter K | 100% | 64% |
| Castro | S-K-A-T-E (all five) | 98% | 58% |
| Hill Country | letter S | 100% | 100% |
| Hill Country | Dolores Crest Air | 52% | 56% |
| Hill Country | letter K | 100% | 100% |
| Hill Country | 19th Street Curve Air | 86% | 90% |
| Hill Country | secret tape | 26% (after the vert fix: 100%) | 10% (98%) |
| Hill Country | letter A | 100% | 100% |
| Hill Country | letter T | 100% | 100% |
| Hill Country | letter E | 100% | 100% |
| Hill Country | S-K-A-T-E (all five) | 100% | 100% |
| Hill Country | Upper Market at 56 | 100% | 100% |
| Hayes | letter S | 100% | 100% |
| Hayes | letter K | 100% | 100% |
| Hayes | letter A | 100% | 100% |
| Hayes | letter T | 100% | 100% |
| Hayes | Bomb Hayes in Under 60 | 100% | 100% |
| Hayes | Patricia's Green Line | 46% | 40% |
| Hayes | letter E | 70% | 52% |
| Hayes | secret tape | 34% | 30% |
| Hayes | Postcard Air | 100% (28% before the new line, below) | 96% (14%) |
| Hayes | S-K-A-T-E (all five) | 70% | 52% |
| Civic Center | letter S | 68% | 30% |
| Civic Center | UN Plaza Line | 50% | 34% |
| Civic Center | secret tape | 52% | 42% |
| Civic Center | letter K | 100% | 78% |
| Civic Center | letter T | 86% | 84% |
| Civic Center | letter A | 98% | 76% |
| Civic Center | F-Line Grind | 60% | 0% |
| Civic Center | letter E | 100% | 94% |
| Civic Center | City Hall Steps | 98% | 82% |
| Civic Center | S-K-A-T-E (all five) | 56% | 8% |
| Embarcadero | letter E | 100% | 78% |
| Embarcadero | EMB Seven | 66% | 64% |
| Embarcadero | Three-Block | 64% | 64% |
| Embarcadero | letter K | 100% | 74% |
| Embarcadero | secret tape | 30% (after the vert fix: 100%) | 14% (80%) |
| Embarcadero | letter S | 90% | 64% |
| Embarcadero | letter A | 78% | 70% |
| Embarcadero | letter T | 54% | 22% |
| Embarcadero | Pier 7 Line | 40% | 8% |
| Embarcadero | S-K-A-T-E (all five) | 38% | 0% |
| SoMa | Pro Score (12000) | 100% (median 35374) | 98% (median 20187) |
| SoMa | Sick Score (52000) | 0% (median 35374) | 0% (median 20187) |
| Mission | Pro Score (10000) | 100% (median 22264) | 72% (median 12581) |
| Mission | Sick Score (40000) | 0% (median 22264) | 0% (median 12581) |
| Castro | Pro Score (5000) | 100% (median 19379) | 82% (median 7511) |
| Castro | Sick Score (22000) | 34% (median 19379) | 0% (median 7511) |
| Hill Country | Pro Score (3500) | 100% (median 16217) | 100% (median 8760) |
| Hill Country | Sick Score (23500) | 16% (median 16217) | 2% (median 8760) |
| Hayes | Pro Score (9500) | 84% (median 15100) | 60% (median 11005) |
| Hayes | Sick Score (59000) | 0% (median 15100) | 0% (median 11005) |
| Civic Center | Pro Score (14000) | 96% (median 39047) | 94% (median 28468) |
| Civic Center | Sick Score (115000) | 0% (median 39047) | 0% (median 28468) |
| Embarcadero | Pro Score (20000) | 98% (median 49929) | 74% (median 27459) |
| Embarcadero | Sick Score (140000) | 0% (median 49929) | 0% (median 27459) |

**Outliers and fixes.** On the first measure, three goals fell under 20% for a decent player, and
none was the goal's own fault:
- **Patricia's Green Line (2%):** the script's leg began with a teleport into the first bench, and the
  skater was thrown up onto its top. A line that rides up beside the first bench and ollies onto the
  second makes it 46% of the time (casual 42%).
- **Transfer the Hellride (8%):** the head-on 9 m/s line is fragile. Coming in a little further south
  at 8.5 m/s, a decent player makes it 28% of the time. The tape keeps the old line, as a leg of its
  own.
- **The UN Plaza Line (24%) and its S (28%):** these were just over the bar. A faster line, coming in
  at a slant, makes them 48% and 64%.

The three lines were found by a search that plays each candidate with the decent player's hands.
`tour-hayes`, `tour-soma` and `tour-civic` now ride them. The goals did not change.

- **A teleport leaving the skater's grind or manual on it (a sim fix).** Hayes's E leg ends on a seat
  wall. Its grind stayed on the skater through the next teleport, and a balance player kept reading
  that grind's meter while in the air: the board spun and landed sideways. After a teleport
  mid-manual, the manual carried on at the new spot (`lab-teleport-mid-manual`). A teleport now ends
  a grind, lip, manual or wallride. Postcard Air went from 26% to 80%.

Left as they are, for a later look:
- **The Otis quarter's coping.** At some entry speeds the wheels run into the coping pipe just below
  the lip, which halves the vert air (8.2 m/s: 5.7 m/s of air; 8.5: 3.7; 9.0: 6.6). The quarter's top
  is 61.6 degrees, just under `vert.minWallDeg` (62), so some approaches leave it as a plain air, and
  no transfer can follow. A rule that leaves the wall when the pipe is above the wheels makes the
  transfer about three times as likely across approaches. It also moves the Hellride NPC scenarios,
  `tour-soma` and the spine scenarios, so it wants its own change.
- **The F-Line Grind for a casual player (0%).** 25 m on a streetcar rail is about 11 s of balance. A
  decent player gets 56%. 15 m would bring a casual player in, but it changes the target, so it is
  noted here, not applied.
- **The tapes are hard on purpose.** SoMa's (over the Hellride, mid-transfer) is 8%, the Mission's
  (onto the hybrid's roof) 20%. (The vert fix made SoMa's 100%; the tape move put it and three others back
  out of easy reach, below.)
- **Sick stays hard.** A decent player reaches it 28% of the time in the Castro and 14% in Hill
  Country, and never elsewhere. Pro is 84-100% for a decent player and 58-100% for a casual one.

**The tape move: the tapes are finds again.** Four tapes were found by a decent player 84-100% of the
time: SoMa's (the vert fix's consistent vert airs put it on every Hellride transfer), the Castro's (over
the Muni stairs, any ollie of the set), Hill Country's (over the crest at Market and Clayton, any ollie
there) and the Embarcadero's (on the granite block in the fountain's pool, one ollie up). Each moved to
where no ollie from the ground within the tape's 1.2 m gets to it (a car roof counts only from the
roof), at the edge of what a line with two parts reaches. One part (a crest air, one pop off a short
grind) gives a decent player only about 1.5 times a casual one's rate, because both make the move
about as often; two parts compound.

| level | the tape now | the line (hint) | decent / casual, 50 tries | 200 tries |
|---|---|---|---|---|
| SoMa | high over the Hellride side of the spine | the transfer from the Otis quarter at full speed (9 m/s); at 8.9 m/s it passes under | 36% / 8% (after the vert fix: 100% / 86%) | 37% / 12% |
| Castro | in the air past the bottom of the Muni stairs' middle rail | a 50-50 with the ollie held, popped 0.16 s before the end | 36% / 12% (86% / 44%) | 35% / 10% |
| Hill Country | on the roof of the car below the crest at 19th on Dolores | a boneless beside it and a 50-50 along its roof (ROOF GRIND) | 26% / 10% (100% / 98%) | 30% / 9% |
| Embarcadero | high off the street end of Pier 7's middle block (since the Pier 7 export of 2026-11-16; until then over the gap between the old benches' second and third, 30% / 14%) | a grind down the block from the seawall side, popped off its end at full charge | 50% / 40% | |

Fifty tries leave about 5 points of noise on a casual rate near 12% (before the waterfront export the Castro's
read 18% at 50 tries and 12% at 200). The waterfront export re-parked the Dolores car 3 m further down the hill,
so the tape moved with it, and made the Pier 7 bench line easier for both players (the line done 52% /
25% of the time, was 42% / 14%), so the Embarcadero's tape sits a little higher. Each tape that moved has its own leg in its Tour scenario when its line is not a goal's
(`tour-soma`, `tour-castro`, `tour-hills`; the Embarcadero's is on the Pier 7 leg), and the old easy
line stays in the script with `expect no event tapeFound`. Hill Country has no street feature that
hides a tape: no crest air there gets more than 1.2 m above the road, and Dolores's SENT IT air 1.5 m,
where a decent player's rate is only 1.3 times a casual one's. The Mission's (20% / 6%), Hayes's (34% /
30%) and Civic's (52% / 42%) are under 80% for a decent player and stay. The tape move changes no other row:
on the same export, before and after it, they read the same.

**The four new neighbourhoods** (50 tries each, decent / casual):

| level | goal | decent | casual |
|---|---|---|---|
| Chinatown | Through the Dragon Gate | 98% | 78% |
| Chinatown | Lantern Line | 92% | 4% |
| Chinatown | Ride the California Slot | 98% | 14% |
| Chinatown | secret tape | 30% | 8% |
| Chinatown | S-K-A-T-E (all five) | 80% | 0% |
| Chinatown | Pro (19,000) / Sick (110,000) | 100% / 40% | 0% / 0% |
| Russian Hill | Lombard Flower Beds | 86% | 88% |
| Russian Hill | Lombard Stairs | 66% | 36% |
| Russian Hill | Ride the Hyde Slot | 34% | 0% |
| Russian Hill | secret tape | 24% | 8% |
| Russian Hill | S-K-A-T-E (all five) | 38% | 2% |
| Russian Hill | Pro (17,500) / Sick (104,000) | 100% / 2% | 0% / 0% |
| North Beach | Washington Square Bench Line | 54% | 44% |
| North Beach | Columbus Curb | 98% | 14% |
| North Beach | Café Manual | 64% | 30% |
| North Beach | secret tape | 40% | 30% |
| North Beach | S-K-A-T-E (all five) | 52% | 24% |
| North Beach | Pro (17,500) / Sick (105,000) | 100% / 0% | 86% / 0% |
| Fisherman's Wharf | Pier 39 Gate | 100% | 82% |
| Fisherman's Wharf | Promenade Line | 90% | 2% |
| Fisherman's Wharf | Turntable Rim | 66% | 20% |
| Fisherman's Wharf | secret tape | 36% | 10% |
| Fisherman's Wharf | S-K-A-T-E (all five) | 82% | 2% |
| Fisherman's Wharf | Pro (17,500) / Sick (103,000) | 100% / 2% | 2% / 0% |

Every goal is made by a decent player at least a third of the time, and each tape a quarter to two
fifths of the time (Chinatown's, Russian Hill's and the Wharf's are out of an ollie's reach and want a
boneless; North Beach's is on a parked car's roof). Three things the measure found:
- **A grind pressed soon after the ollie's release pops straight off it.** With a human's timing the
  press can come before the release; the grind caught, and the release then popped off it. In the
  first measure this held the California slot to 24%. The scripts press grind 12 ticks or more after
  the release, and the slot ollie happens on the ground, not in the teleport's drop (98%).
- **More presses after the catch switch the grind** (a Smith or Feeble with the steering held), which a
  casual player loses: Columbus Curb's presses stop soon after the catch, and its 20 m became 15 (a
  casual player holds a curb 3 to 4 s; 0% at 20 m, 14% at 15).
- **Casual players and the long grinds.** Three of the four great runs are one long grind (the
  California slot 45 m, the Lombard handrail 53 m, a promenade edge 24 m), which a casual player loses
  after 2 to 4 s: Pro on those runs is 0-2% for them (86% on North Beach's, which is manuals). The
  tiers are measured on the great runs, so this is the line, not the score: a casual player's Pro
  there comes from other lines.

**Feel round 3 (2026-11-10): the Tour after the feel changes.** 30 tries each, with the park
carve, the curb hop, the ledge pop, the revert buffer, the trick-input rounds 1-2 and the Pro lines
(Pro lines, seam-safe grind lines), against the same 30-try measure before them (round 1):
- **Nothing fell out of reach.** Every goal a decent or casual player made before is still made. The
  casual zeros are the long grinds they were before (F-Line Grind, the Hyde slot, Chinatown's E, the
  EMB and Chinatown S-K-A-T-E); Russian Hill's S-K-A-T-E and the Promenade Line went from 1 of 30 to 0.
- **The Pro lines do their job.** Casual Pro: Chinatown 0 to 57%, Russian Hill 0 to 100%, the
  Wharf 43% (on its Pro line at 16,500), Hayes 60 to 100%; decent Pro is 97-100% everywhere.
- **Became easy (noted, not changed):** Pro on Russian Hill's Pro line (100% / 100%, the casual median
  64,956 against 17,500) and at Hayes (100% / 100%, decent median 36,379 against 9,500): Pro is meant as
  "you played the level", but these tiers could rise. Sick for a decent player rose in four levels
  (Castro 27 to 47%, Chinatown 33 to 60%, Russian Hill 0 to 20%, the Wharf 3 to 27%), still hard.
- **Fell, not from the feel changes:** Ride the Hyde Slot, decent 33 to 13% (casual 0). With the park
  carve off, with the curb hop and ledge pop off, and with the seam-safe grind lines reverted it stays at
  13%, so it comes from the trick-input rounds' grind changes (catches, double-tap switching) on the 80 m
  slot. It is under the Tour audit's 20% bar for a decent player; reported, not re-tuned in data here. Also
  down a little, the same kind of long edge grinds: the Promenade Line 83 to 63%, Chinatown's S-K-A-T-E
  80 to 60%, the Wharf's K (casual 77 to 57%).
- **Up:** Castro's K casual 67 to 90%; Embarcadero Pro casual 73 to 97%.

**Feel round 4 (2026-11-10): grind mashing, and two Pro tiers.** The Hyde slot's drop came from
mashing I through the lock-on: the double-tap variant, then each later press counted as a switch (an
entry in the combo, and each grind entry tips the balance faster), so a decent player bailed 10 times in
12. Presses within grind.switchTicks of the last one no longer switch (src/sim/skater/grind.ts). 30
tries, round 3 to round 4: the Hyde slot decent 13 to 53%; Russian Hill's E 63 to 90% and S-K-A-T-E 33
to 60%; the Promenade Line 63 to 87%; Chinatown's S-K-A-T-E 60 to 77%, the California slot casual 7 to
23%; Columbus Curb casual 7 to 13%. Down, all combo-score goals the accidental switches had padded with
free entries: Chinatown's Sick for a decent player 60 to 33%, the Washington Square Bench Line casual 63
to 47%, the UN Plaza Line decent 67 to 50%. Pro tiers (docs/mechanics/tour.md): Russian Hill 45,000
(decent 80%, casual 43%), Hayes 24,000 (casual 43%, decent 97%).

**The Pier 7 export (2026-11-16): Pier 7 as it is, and the Embarcadero re-measured.** The old Pier 7 (two rows
of benches) is gone: the real plaza has three blocks straddling two steps, 9 to 12 m apart across the
riding line (docs/decisions.md). The Tour leg is a 50-50 down the middle block from the seawall side, a
kickflip off, a manual, a heelflip out (4,470, Pier 7 Line); T sits on the block's edge, the tape at the
top of what a full pop off its street end reaches (a half-charged pop passes 0.17 m lower: the pop off a
grind has a narrow range, so this tape is easier than the others). The great run moved to EMB's row by
the banks (17,496 x9 every 10 s, 192,456; docs/mechanics/tour.md), Sick 162,000. 50 tries:

| goal | perfect | decent | casual |
|---|---|---|---|
| letter T | 100% | 70% | 68% |
| secret tape | 100% | 50% | 40% |
| Pier 7 Line | 100% | 40% | 20% |
| S-K-A-T-E (all five) | 100% | 50% | 14% |
| Pro Score (20,000) | 100% | 100% (median 129,257) | 86% (median 39,975) |
| Sick Score (162,000) | 100% | 6% (median 129,257) | 0% (median 39,975) |

The other Embarcadero goals are as before (E, EMB Seven, Three-Block, K, S, A). Pro stays at 20,000
though a decent run's own line on the row (two ledges popped, 2,889 every 20 s) makes 17,334: decent
players replaying the great run reach it every time, casual ones 86%. The perfect player's great run
scores 303,381, over the script's 192,456: its balance presses come in another order around the flips,
and with the meter full some flips become specials (the script picks flips whose directions end no
special's keys, but only against its own bot's presses).

**The squeezed city (2026-11-17): Pro and Sick.** 50 tries, decent / casual; Hayes measured on city build
`d565e2edfd8dd956`, which has Patricia's Green again (its Tour scenarios were blocked on the build before). Chinatown's and the Wharf's great runs moved to curbs (Grant's
west curb, Jefferson's north curb), where a decent run keeps 60 to 70% of the script's score: the kickflip or the
boneless lands before the curb, the flip off comes out smaller, a grind ends in a wallride. Their Sick tiers at
91% of the great run were reached 2% and 0% of the time; they are set where a decent player reaches them about a
third of the time now, as on the other levels where Sick is reachable.

| level | Pro | Sick | Sick before |
|---|---|---|---|
| SoMa | 100% / 98% (12,000) | 0% / 0% (52,000) | |
| Mission | 100% / 84% (10,000) | 0% / 0% (40,000) | |
| Castro | 100% / 84% (5,000) | 70% / 0% (22,000) | |
| Hill Country | 98% / 96% (3,500) | 16% / 4% (23,500) | |
| Hayes | 96% / 36% (24,000, Pro line) | 0% / 0% (59,000) | |
| Civic Center | 98% / 82% (14,000) | 0% / 0% (115,000) | |
| Embarcadero | 100% / 82% (20,000) | 4% / 0% (162,000) | |
| Chinatown | 100% / 58% (19,000, Pro line) | 36% / 0% (65,000) | 2% / 0% (81,000) |
| Russian Hill | 84% / 50% (45,000, Pro line) | 42% / 0% (104,000) | |
| North Beach | 100% / 90% (17,500) | 0% / 0% (105,000) | |
| Fisherman's Wharf | 100% / 56% (16,500, Pro line) | 34% / 0% (52,000) | 0% / 0% (69,000) |

The two tiers were set from these 50 tries. In 200 tries (`--trials 200`) a decent player reaches them 27% (Chinatown)
and 28% (the Wharf) of the time, and 24% and 26% in the 150 tries after the first 50; casual players 0%.

**Limits of the model.** It stands in for a person, and it is no measurement of one. The approach
error and the steering are crude. A pushed approach tops out at 9 m/s, where the model can come in
at up to 5% more or less. The lines are the script's, and a person might find an easier way to the
same goal.

## 9. Vert: every quarter and vert wall

`./skate feel --section vert` finds every transition top in the park and the
city: rideable faces steeper than 50 degrees (not walls) with at least 0.8 m of drop to a flat run-up.
For each, it rides at the top from 2.5 m out on the flat at 5-10 m/s, head-on and 20 degrees either
side. It records whether the run reaches the lip (an air within 2.5 m of the top), whether that air is
vert, the exit vertical speed, the most speed lost in one tick on the way up, and whether the coping
pipe was in reach.

**Before:** on 15 of the park's 21 tops, a run head-on lost 47-85% of its vertical speed at the
lip. The wheels' sphere ran into the coping pipe, a steel element a few centimetres out over the lip,
just under it, so the same quarter gave 1.3 m/s of air at one speed and 6 m/s at the next. F48 at
8.5 m/s went 6.3 m/s up the wall the tick before and 1.3 m/s after. Some runs also left a quarter
partway up, or at its foot, when a seam between its triangles opened a few millimetres more than
`ground.stickGap` (3 mm). The Otis quarter tops out at 61.6 degrees, just under
`vert.minWallDeg` (62), and the corner quarterpipe F25 at 52.7, so those left as plain airs.

**The fixes** (data in `physics.json`; `scenarios/soma-coping-speed.skate` showed the lost speed first):
- **Into the coping, out as vert air.** When both the board and the face are steeper than
  `vert.copingMinDeg` (45), the skater is moving up, and the coping pipe (a rail-class face) is above
  the wheels within this tick's travel plus `vert.copingReach` (0.03 m), the skater leaves the wall now
  as vert air. It is moved out by however much the pipe overhangs the way up (a few centimetres), so
  the air clears it. As in THPS, a lip with coping is vert, whatever the face's angle.
- **The vert test reads the wall left from**, the face under the wheels or the board's up, whichever is
  steeper, within `vert.topToleranceDeg` (4) of `vert.minWallDeg`, so 61.6 degrees counts. The
  deck-behind-the-coping rule keeps its old test.
- **Climbing a transition, only an edge launches.** Going up with the board tilted more than
  `ground.transitionDeg` (15), or with the surface turning up into the path, a gap of up to
  `ground.transitionStickGap` (2 cm) snaps back instead of launching. An edge opens centimetres in a
  tick, and a street crest turns the other way, so crest airs are unchanged.

**After:** every top makes vert head-on from the speed that reaches its lip, with no speed lost. Exit
speed now rises smoothly with entry speed: about 4.5 m/s at 7 m/s in, 6 at 8.5 and 7.5 at 10.

| element | at | drop m | top deg | head-on vert (before / after) | head-on speed lost (before / after) | exit vz at 8.5 m/s (before / after) | angled vert (after) |
|---|---|---|---|---|---|---|---|
| F01 quarterpipe wall with portal | 87.3, 22.5 | 1.56 | 61.6 | 10/11 / 10/11 | 10 (worst 47%) / 0 | 3.5 / 6.1 | 11/22 |
| F01 quarterpipe wall with portal | 87.4, 17.2 | 1.68 | 75.5 | 9/11 / 10/11 | 9 (worst 78%) / 0 | 1.8 / 5.8 | 19/22 |
| F01 quarterpipe wall with portal | 87.4, 22.3 | 1.52 | 66.5 | 9/11 / 10/11 | 9 (worst 59%) / 0 | 3.8 / 6 | 11/22 |
| F01 quarterpipe wall with portal | 87.5, 17.8 | 1.29 | 63.7 | 4/11 / 11/11 | 0 / 0 | 4.3 (not vert) / 5.2 | 11/22 |
| F01 quarterpipe wall with portal | 88.3, 19.9 | 2.13 | 66 | 0/11 / 0/11 | 0 / 0 | no air / no air | 0/22 |
| F07 radial transition | 54.4, 23.7 | 1.3 | 66.9 | 7/11 / 11/11 | 10 (worst 72%) / 0 | 1.8 / 6.1 | 0/22 |
| F07 radial transition | 54.9, 22.4 | 1.18 | 68.2 | 10/11 / 10/11 | 10 (worst 76%) / 0 | 1.4 / 6 | 0/22 |
| F07 radial transition | 55.2, 22.4 | 1.29 | 58 | 9/11 / 10/11 | 10 (worst 76%) / 0 | 1.8 / 6.1 | 0/22 |
| F07 radial transition | 55.8, 22.8 | 1.49 | 59.2 | 7/11 / 10/11 | 10 (worst 85%) / 0 | 1 / 6 | 0/22 |
| F25 corner quarterpipe | -0.9, 29.4 | 1.3 | 52.7 | 0/11 / 11/11 | 8 (worst 55%) / 0 | 3.3 (not vert) / 5.3 | 21/22 |
| F25 corner quarterpipe | -0.5, 26.7 | 1.11 | 54.9 | 2/11 / 11/11 | 0 / 0 | 5.3 (not vert) / 5.7 | 22/22 |
| F33 quarterpipe | -0.4, 25.6 | 1.1 | 72.2 | 10/11 / 11/11 | 11 (worst 78%) / 0 | 1.8 / 6.4 | 22/22 |
| F33 quarterpipe | -0.3, 24.7 | 1.11 | 73.5 | 9/11 / 11/11 | 11 (worst 77%) / 0 | 1.5 / 6.4 | 22/22 |
| F33 quarterpipe | -0.2, 22.5 | 1.21 | 68.9 | 0/11 / 0/11 | 0 / 0 | no air / no air | 0/22 |
| F33 quarterpipe | 0, 20 | 1 | 64.8 | 11/11 / 11/11 | 3 (worst 49%) / 0 | 6.5 / 6.5 | 11/22 |
| F33 quarterpipe | 0.1, 18.8 | 1.06 | 66.5 | 11/11 / 11/11 | 1 (worst 70%) / 0 | 6.4 / 6.4 | 22/22 |
| F33 quarterpipe | 0.3, 14.9 | 1.07 | 68.2 | 5/11 / 11/11 | 4 (worst 65%) / 0 | 5.8 (not vert) / 6.2 | 19/22 |
| F33 quarterpipe | 0.3, 16 | 1.07 | 63 | 3/11 / 11/11 | 4 (worst 54%) / 0 | 6.2 (not vert) / 6.5 | 22/22 |
| F41 quarterpipe | 88.3, 21.4 | 1.74 | 70.8 | 9/11 / 9/11 | 0 / 0 | 4.9 / 4.9 | 12/22 |
| F48 quarterpipe | 87.7, 17.2 | 1.54 | 70 | 8/11 / 10/11 | 10 (worst 81%) / 0 | 1.3 / 6.3 | 20/22 |
| F48 quarterpipe | 88.6, 19.8 | 1.89 | 72.4 | 9/11 / 9/11 | 0 / 0 | 5.5 / 5.5 | 10/22 |

What is still listed (the leftovers, at the end of this section, take up the F07 and F33 items):
- F01 at 88.3, 19.9 is the portal: a run rides through it and has no lip.
- F33 at -0.2, 22.5 has an obstacle in front of its run-up.
- Angled runs at the radial transition F07 ride along it or off its side, never up it.
- One angled spot on F33 (0, 20) loses speed against a step at the foot of the transition.
- **The city has no quarters.** Its steep faces are terrain: lot and sidewalk banks on the hills
  around Twin Peaks, and a lot by the Embarcadero. None has coping, and no run off one
  is vert. Those at 60-61.6 degrees could launch vert under the new tolerance, but none does in the
  sweep, because the runs never reach their tops at speed.

**The other sections do not move.** Ollie, capture, balance, landing, spin and special read the same
before and after, number for number (sections 1-6).

**The Tour** (feel --tour, decent / casual): Transfer the Hellride goes from 28% / 12% to 90% / 74% on
a new line. The SoMa tape, found mid-transfer, goes from 8% / 8% to 100% / 86%: a consistent vert
air reaches it every time. The SoMa tiers stay at 12,000 / 52,000. Neither the decent line (Big 3,
2,464) nor the great line (5,652) uses vert, and both are unchanged.

**The leftovers.**
- **F07: angled runs launch vert when they meet the top.** F07 is a radial bank wrapped round a
  freeway column, about 2.5 m in radius. The audit turned an angled run's heading at the head-on
  start, 4 m out, so on F07 the line passed 1.4-1.9 m wide of the column and crossed only the cone's
  foot. Those runs carved along the bank (up about 0.45 m and back down), and the 56-68% losses were
  the wall at the bank's north end. No physics change was needed. An angled run now starts as far
  out, on the line that meets the same top at 20 degrees (`vertStart`; a start that is not flat floor
  is left out), and at F07 it launches vert like a head-on run (`scenarios/soma-f07-angled.skate`).
  Head-on numbers are unchanged everywhere. Angled, the park's rows now read:

| element | at | angled, before (turned at the start) | angled, now (aimed at the top) |
|---|---|---|---|
| F01 | 87.3, 22.5 | 11/22 vert (16 lips), lost 1 (worst 42%) | 20/22 vert (21 lips) |
| F01 | 87.4, 17.2 | 19/22 vert (20 lips) | 10/11 vert |
| F01 | 87.4, 22.3 | 11/22 vert | 10/22 vert |
| F01 | 87.5, 17.8 | 11/22 vert | 22/22 vert |
| F01 | 88.3, 19.9 | 0/22 vert | 9/11 vert (10 lips) |
| F07 | 54.4, 23.7 | 0/22 vert (17 lips) | 21/22 vert |
| F07 | 54.9, 22.4 | 0/22 vert (14 lips), lost 3 (worst 68%) | 21/22 vert (22 lips) |
| F07 | 55.2, 22.4 | 0/22 vert (7 lips) | 20/22 vert |
| F07 | 55.8, 22.8 | 0/22 vert (16 lips), lost 3 (worst 56%) | 20/22 vert |
| F25 | -0.9, 29.4 | 21/22 vert | 11/22 vert |
| F25 | -0.5, 26.7 | 22/22 vert | 22/22 vert |
| F33 | -0.4, 25.6 | 22/22 vert | 22/22 vert |
| F33 | -0.3, 24.7 | 22/22 vert | 22/22 vert |
| F33 | -0.2, 22.5 | 0/22 vert (3 lips), lost 3 (worst 87%) | 0/22 vert (11 lips) |
| F33 | 0, 20 | 11/22 vert (20 lips), lost 9 (worst 51%) | 14/22 vert (22 lips) |
| F33 | 0.1, 18.8 | 22/22 vert | 22/22 vert |
| F33 | 0.3, 14.9 | 19/22 vert | 11/11 vert |
| F33 | 0.3, 16 | 22/22 vert | 22/22 vert |
| F41 | 88.3, 21.4 | 12/22 vert (21 lips) | 9/11 vert |
| F48 | 87.7, 17.2 | 20/22 vert | 10/11 vert |
| F48 | 88.6, 19.8 | 10/22 vert (21 lips), lost 1 (worst 33%) | 9/11 vert (10 lips) |

  "Of 11" means one side has no flat run-up on the aimed line. F25 at -0.9, 29.4 is a corner: aimed
  from one side, the run meets the corner's other quarter first. Most city rows lose their angled runs
  the same way (their run-ups are slopes).
- **F33's foot is a step in the park, not a seam.** From y 15 to 20 and from 23 to 26 the quarter
  meets the floor flush. Between y 20.5 and 22.7 its bottom edge climbs from the lower floor (z 0.51)
  to the upper one (0.75), while the floor in front (F15) stays at 0.52 until the stairs (F52) start
  at y 22.7. The step is 3 cm at y 20.5, 8 at 21.0, 14 at 21.5, 19 at 22.0 and 22 at 22.5. A seam
  is millimetres, so the sim does not snap it: an 8 cm step stops a board, as it would in the park.
  It is listed for the park export (the park comes only from the world generator).
  **Fixed in the park model** (the generator's blender/fix_f33_toe.py, data/site.json F33 only): the toe
  stays on the lower floor to y 22.6 and steps up with the two F52 stairs; the coping is unchanged.
  Measured in the export: flush (1 cm, the transition's own curve 5 cm in) from y 20 to 23.5. F33 at
  0, 20 now goes vert head-on 11/11 and angled 22/22 with no speed lost (was 11/22 angled, 9 losing up
  to 51%); at -0.2, 22.5, 7 of the 7 head-on runs with a run-up go vert (was 0 of 11), 3 still lose
  speed on the F52 treads they start from.
- **What blocks F33 at -0.2, 22.5 is the same step.** The head-on run starts on the first tread of
  the F52 stairs, rides it, and stops dead against F33's raised foot (22 cm above F15 there). Aimed
  from the north, over the upper floor, the run gets to the lip (11 lips) but leaves it almost
  flat, never vert; aimed from the south, it meets the step too.

## 10. Driving: the crew van and the garbage truck

`./skate feel --section drive` (src/harness/drivefeel.ts) drives each vehicle
type through the real sim with a player's keys. Straight-line numbers come from the lab park's 160 m
flat strip, starting from rest. Turning and the handbrake use the lab's 50 x 40 m floor, the vehicle
launched at the speed asked for; the circle comes from speed over yaw rate one second into full lock.
The kerb is 15 cm with flat, clear ground beyond (sf, at 126, -160), driven head-on. The hills follow
the city's own lanes at full throttle, the drive bot slowing for turns: Dolores from 18th to 20th, Hyde
St up to Lombard (on its middle line), and the Lombard crooked block driven up its hairpins at 13 km/h
(one way down in life).

The targets are arcade, not real. A van should feel quick and nimble, a garbage truck heavy but never
a chore. Neither GTA-like games nor THPS publish their numbers, so the targets come from play: 0-50
km/h in 3-4 s for the van and 5-7 s for the truck; stopping from 50 km/h in about 10-13 m and 13-18 m;
a walking-pace turning circle of 11-14 m and 16-20 m; a handbrake turn that swaps ends (180 degrees)
from 45 km/h in about 1.3 s for the van; kerbs climbed without a bump; no stalls on the city's
hills.

**Before** (the first driving build's numbers): the van took 5.8 s to 50 km/h. The truck reached only 40 km/h in the
strip's 150 m (about 11 s to 50 km/h by the formula). The van's handbrake turned 90 degrees in 0.9 s
but needed 2.9 s for 180, with the spin dying as fast as it built and turning back past 120 degrees.
The truck managed 93 degrees. The truck's circle was 20.3 m. The van climbed Dolores no slower than 33
km/h, the truck no slower than 18.

**The changes** (data/vehicles.json; `grip.yawFade` and the handbrake's direction are new code):
- van `engine.accel` 4.5 to 7.
- truck `engine.accel` 2.6 to 5, `topSpeed` 17 to 19.5 m/s (70 km/h), `drag` 0.004 to 0.0022 (the
  old drag ate most of the pull near 50 km/h); `steer.maxDeg` 36 to 38, `steer.fade` 6 to 9.
- Handbrake: the spin builds at `grip.yawAccel` and now dies away only at `grip.yawFade`, so a slowing
  slide swings on round. It follows the steering while the handbrake is held; only backing up under
  power turns it the other way (the old rule flipped it past 120 degrees and stopped every turn short
  of 180). Van `yawBoost` 1.9 to 2.2, `yawAccel` 6 to 10, `yawFade` 2.5, `handbrakeDecel` 3.5 to 4.5.
  Truck `yawBoost` 1.3 to 1.6, `yawAccel` 3 to 5, `yawFade` 1.5.
- Harness: the drive bot sees a corner as the way at a point against the way 8 m on, so a densely
  sampled lane's hairpins slow it (on the scenarios' paths of long segments this is the old test).

**After:**

| | van | truck | target (van / truck) |
|---|---|---|---|
| 0-50 km/h | 3.39 s, 28 m | 6.57 s, 60 m | 3-4 s / 5-7 s |
| speed after 150 m from rest | 68 km/h | 56 km/h | (top 86 / 70) |
| stopping from 50 km/h | 10.1 m, 1.5 s | 13.6 m, 2.0 s | 10-13 m / 13-18 m |
| circle at 8 km/h (across) | 12.8 m | 17.0 m (was 20.3) | 11-14 m / 16-20 m |
| circle at 20 / 40 km/h | 17.2 / 27.5 m | 23.0 / 41.2 m | |
| sideways pull at 40 km/h, full lock | 0.92 g (the grip's limit) | 0.61 g | |
| handbrake from 45 km/h: 90 deg, 180 deg | 0.75 s, 1.24 s, 24 km/h left, 11.7 m | 1.4 s, 2.58 s, 14 km/h left, 18.2 m | about 1.3 s / slower |
| 15 cm kerb head-on at 8, 20, 35 km/h | up and over, no bump, no air, no speed lost | the same | climbed |
| Dolores, 18th to 20th (28 m up, 10%) | 19.3 s, slowest 46 km/h (was 33) | 25 s, slowest 33 km/h (was 18) | never stalls |
| Hyde St up to Lombard (55 m up, 18%) | 23.4 s, slowest 40 km/h | 33 s, slowest 29 km/h | never stalls |
| Lombard crooked block, up (33 m up, 20%, hairpins) | 52 s at 13 km/h, no bump | stuck at a hairpin | van gets through |

Notes from the runs:
- Hyde St in the right-hand lane: the van strikes the corner kerb extensions at every cross street (the
  city's narrow streets, not the handling). On its middle line it climbs without a bump. The city
  generator could look at lane width on Hyde.
- The crooked block at more than about 13 km/h scrapes the hedges at every hairpin; at a crawl the van
  makes all eight. The truck, 8.6 m long, cannot make the first hairpin at any speed. Real trucks are
  banned from the crooked block too, so a mission there is the van's.
- The kerb is soft: no jolt or speed lost at 35 km/h. Fine for arcade; a small bump on the camera is
  the client's if we want one.
- Releasing the handbrake ends the spin at once: grip comes back and the van drives on in the way it
  faces, which is what lets a player swap ends and drive off. sf-van-handbrake shows it.

Scenarios re-measured for the new numbers (same behaviour, earlier ticks): sf-van-handbrake (now a
full end-swap and drive-off), sf-van-ped, sf-van-shout, soma-van-npc, sf-mission-drive,
sf-mission-carry, sf-truck-dolores (the truck climbs at 9-13 m/s).

**The rental scooter** is slow and silly on purpose: 18 km/h on the flat strip (20 by
the data, rolling and drag take the rest), a 4.3 m circle at walking pace, a stop from full speed in 4.5
s. It climbs Dolores at 9-12 km/h and gives up on Hyde (5 km/h, 120 s for 197 m) and the crooked block:
scooters downhill only, like the real ones. A 15 cm kerb is fine at any speed it reaches. No handbrake
(its row shows the turn alone). The ditch's landing over 40 seeds: 15% clean, 42% sketchy, 10% a
stumble, 33% a bail; spin against the twist and a bail becomes a stumble (sf-scooter-ditch-save).

### Postcard Air after the waterfront export

The waterfront export left Postcard Air (a 1.1 s air off the Alamo Square slope, takeoff in its box) at 28% for a
decent player. The old line pushed from the slope's top for 2.4 s and ollied twice. On the way down it
hopped over small bumps, the last one just before the ollie. feel --tour follows a script by its moves
(a human's timing jumps to each of the script's phase changes when the human makes the same one). A human
who hopped a bump at a slightly different moment had their timing skip to the script's last hop, and
ollied a few metres early (about 0.3 s short of air), or did not ollie at all. The goal is unchanged.
The new line starts 11 m before the slope's steep last stretch at 9 m/s (the teleport and its speed
stand in for the ride down, as the tape's leg does), crouches, and ollies at the edge. No bump lies
between, and any takeoff from 5 m before the edge to 1 m after it gives 1.15-1.5 s. Decent 100%, casual 96%.

## 11. Flow: links, getting up, turning, curbs (2026-11-09)

`./skate feel --section flow` (src/harness/feel.ts `flowFeel`). The lab, except the curb (sf).

**What a player meets, ranked** (from `./skate feel`, the tour, and scripted runs at the park and on
the city's streets):
1. **Curbs stop you dead.** The wheels' sphere (12 cm) meets a city curb's face (14-17 cm) as a wall:
   rolling into one at any speed stopped the skater in one tick, with no bump and no bail. The city is
   all curbs. Fixed: the curb hop (rolling.md).
2. **Turning is slow.** Full lean takes 2.2 s for a 180 at 3 m/s and 3.0 s at 7 m/s (table below):
   about half the rate THPS plays at. Fixed in round 2: the park-speed carve (board.md).
3. **The revert had no early press.** The window was the 11 ticks after touching down (92 ms), so a
   press as the wheels met the ramp, or a little before (what players do), was lost, and a plain air
   could not be reverted at all. Fixed (combos.md).
4. **A bail held the controls for 1.24 s** whatever the player did, then stood the skater up at 0 m/s:
   1.9 s from the bail to rolling at 3 m/s. Fixed: quick get-up (rolling.md).
5. Fine as they are: the ollie (sections 1, 5), grind capture (2), landing bands (4), the manual's
   window (-14 to +12 ticks of the landing links it; later it starts a new combo), pumping (a crouch
   through the 1.2 m quarter returns 4.9 m/s of 4.5, plain 4.1), hill speed (wobble, tuck, carve,
   powerslide: hill.md). `./skate farm` (soma, 100 patterns) finds no farm: the best random 10 s is a
   9,736 grab chain off the wave; reverts add nothing there (one per landing).

| | before | after |
|---|---|---|
| revert, press from the landing (kickflip, vert ramp) | 0 to +10 ticks (92 ms) | -18 to +10 (250 ms; `combo.revertBufferTicks` 20) |
| revert after a plain vert air | never | -18 to +10 (starts the combo: Revert, 100) |
| revert and a manual pressed together before the landing | the manual took the tick, the revert was lost | Revert + Manual |
| a 5 m/s bail: control back / rolling at 3 m/s, pressing ollie | 1.24 s / 1.86 s | 0.53 s / 1.14 s (`bail.getUpTicks` 60, `getUpSpeed` 3; waiting: as before); round 2, with the get-up played fast (`getUpFrom` 112, `getUpRate` 3): 0.63 s / 1.25 s |
| 14.5 cm curb head-on at 2 / 5 / 8 m/s | stopped dead (0 m/s) | up onto the sidewalk at 1.6 / 4.2 / 6.7 m/s, no air (`ground.curbHop` 0.18, `curbHopKeep` 0.85) |

Turning, full lean, pushing to hold the speed; the heading 1 s after a light tap, coasting
(round 2, the park-speed carve: `board.park` minRadius 0.65, carveAccel 15, grip 1.4 up to 8 m/s,
blended back to the old numbers by 12 m/s):

| m/s | deg in 1 s | 90 deg | 180 deg | 3-tick tap | 8-tick tap |
|---|---|---|---|---|---|
| 3 | 75 to 120 | 1.17 to 0.78 s | 2.22 to 1.43 s | 0 to 0 | 0.5 to 0.8 |
| 5 | 66 to 108 | 1.31 to 0.85 s | 2.50 to 1.58 s | 0 to 0 | 0.4 to 0.7 |
| 7 | 54 to 89 | 1.58 to 1.00 s | 3.02 to 1.88 s | 0 to 0 | 0.4 to 0.6 |
| 9 | 45 to 67 | 1.87 to 1.30 s | 3.90 to 2.48 s | 0 to 0 | 0.3 to 0.5 |

From 12 m/s on nothing changes, so the hill scenarios (lab-hill-*) hold as they were. A first try in
round 1 (data only, every speed) failed 20 scenarios, the hill and the races among them; this one
moves 24, each the same ride a few ticks off, re-pinned with the reason in its comment:
- the carve and the wall it meets: lab-carve-grip (a 3.05 m circle at 6 m/s, was 5 m), lab-wall-slide
  (meets the wall steeper: 5 m/s left, was 7);
- the races and Muni, same places and results, times a few tenths off: sf-bomb-twinpeaks (103.6 s,
  second; a rival's heelflip near Noe lands now), sf-goal-twinpeaks, sf-bomb-hayes-rivals,
  sf-muni-f-win, sf-muni-fdowntown-win, sf-muni-j-lose, tests/ghost.test.ts (103.6 s);
- the Tour: tour-hills-twinpeaks (Upper Market at 56, 24 ticks sooner), tour-soma-sick (the great run
  62,172, was 62,422; Sick is 52,000; docs/mechanics/tour.md), tour-soma and tour-russianhill-sick (a
  bail after a leg's goal, in the roll-out before the next teleport: the autopilot carving up the
  Hellride wall at an angle; a building met at 10 m/s with no keys held; scores unchanged);
- the city: sf-gap-site-bar (the bar met wider: an FS Boardslide, was a 50-50; the gap and Hard Hat
  Area still paid), sf-ledge-hop-farm-pop (the 50-50 stalls sooner; the farm stays shut),
  sf-steep-lot-corner (its random keys reach the known inside corner at 790, was 910: the run ends at
  760), sf-dolores-flat-ollie, sf-escape-alley, sf-actor-escort;
- the NPC sessions (their random draws moved): soma-npc-combos, soma-npc-big3, soma-npc-hellride,
  soma-npc-react, soma-npc-sessions, soma-van-npc;
- the one-player world pins (tests/twoplayer.test.ts: soma, sf and lab).

Late ollie at the lab's 0.45 m ledge, popped d metres before its face (round 2, the ledge pop,
rolling.md); short: stopped in front of it; over: cleared it (the ledge is 0.5 m deep):

| m/s | crouch | 0.2 m | 0.4 m | 0.6 m | 0.8 m |
|---|---|---|---|---|---|
| 4 | tap | short to over | short to over | over | over |
| 4 | 12 ticks | short to over | short to over | over | over |
| 6 | tap | short to over | short to over | short to over | short to over |
| 6 | 12 ticks | bail to over | short to over | short to over | over |

Round 2 also:
- **Session marker** (docs/mechanics/marker.md): Z drops it, Backspace goes back to it at once, rolling
  as you rolled (free skate only). A spot is retried in one key press instead of riding back to it.
- **Quick get-up blends**: the get-up plays the bail's own end at 3x (control back 0.63 s; 0.53 s with
  the snap of round 1).
- **Short key presses latched** in the client (src/client/input.ts): the vehicle keys steps headless
  at load 32, 6 of 6 (2 of 9 failed before, every miss the held-only E).
- **The chase camera over the new steps** (the camera's step spring): the 14.8 cm curb hop rises
  the camera by at most 5 mm a tick, no jump; the ledge pop's 21.7 cm lift in the air goes into the
  camera's follow (its rise per tick 3.5 to 5.9 cm, easing). No tuning needed.
- **Not done: a longer landing grace.** 178 scenarios pin a combo's bank, a level's goals or its score
  to the tick; lengthening combo.graceTicks would move them all for 100 ms more of manual window, which
  the revert buffer (round 1) covers for reverts already.

Scenarios: lab-revert-early, lab-revert-plain, lab-revert-manual-early, lab-bail-getup, sf-curb-hop,
sf-curb-hop-angled, lab-stairs-up-blocked; round 2: lab-carve-grip (re-measured), lab-ledge-late-pop,
lab-ledge-pop-flip, lab-ledge-pop-too-high, lab-marker-retry, lab-marker-fakie, lab-marker-refused.
