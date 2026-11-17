# The Tour
Milestone: physics phase 13 (the career's sim side; the client keeps the career and draws
the level select, checklist, unlocks and results). Code: src/sim/game/tour.ts (goal checks shared
with city goals in game/goals.ts goalMet); data/tour.json.

In the squeezed city (docs/squeeze.md) some levels changed
from what is written below: Chinatown's California slot goal is Bomb Grant in Under 10 (a dash down Grant
through the Dragon Gate) and it starts only at the Dragon Gate; Russian Hill's Hyde slot goal is 50 m from
Lombard; North Beach plays Columbus along the square and also starts from Marini Plaza; Fisherman's Wharf's
Promenade Line is the Wharf Line on Jefferson, its turntable at the Wharf's west end, and it no longer starts
at Pier 7; Civic Center's UN Plaza line uses the south row. Sick tiers follow the new great runs, except
Chinatown's (65,000) and the Wharf's (52,000): on their curbs a decent player keeps 60 to 70% of the script's
score, so they are set where a decent player reaches them about a third of the time (docs/feel-audit.md section 8).

Input:        `run level <id> [start]`: a run of tour.seconds (120) on that level, from its spot or
              one of its other starts (Hill Country: twin_peaks_bomb or hayes_hill; Hayes Valley:
              alamo_square or patricias_green; Civic Center: city_hall; Embarcadero: pier_7). The world must
              be the level's (soma or sf); an unknown level, the wrong world or a start the level
              does not have is a command error. Any other `run ...` leaves the level.
States:       session fields, set when a level starts (absent before, so other runs hash as they did):
              level (id), levelGoals (ids done this run), tape (found this run), away (the wrong-way
              hint is up), grindRun (metres of the grind in progress), levelMarks (dash goals: the
              tick the skater was last inside each one's from box); letters and timeLeft as in
              the 2-minute run. mode 'level', then 'ending' (time up, the last combo may still land,
              as in the run), then 'over'; game stays 'level'.
Rules:
- A level's goal list: pro and sick (score tiers), skate (all five letters), tape, and its own three
  goals. Each completes once per run (levelGoal). They count toward the career, which the client
  keeps. Every level is open from the start (story phase 1, docs/open-world.md): the
  neighbourhoods' open challenges, each started from its marker in the city (a teal column at its
  start spot; the talk key there) or from the pause menu's Challenges; the journal lists them.
- Letters: passed within run.letterRadius (0.9 m) of their point, in any order (letter {letter,
  have} as in the run, have spelt from the level's letters). The tape: within tapeRadius (1.2 m).
- Own goals use the city goal kinds a run can do: gap (any of gaps), skitch, speed (kmh in a box,
  within z), combo (points; started in box when given; holding one of gaps, or all of them with
  every: true; holding one of tricks, trick ids like spine), plus grind (one grind of at least
  meters, the grind's own speed summed each tick, inside box when given), air (a landing after at
  least seconds of air, taken off inside box) and dash (inside the to box within seconds of last
  being inside the from box; the clock restarts each time the skater is in from).
- Area: more than wrongWay.away (25 m) outside the level's box (and outside each of its extra
  areas, when it has them), levelWrongWay (a hint: "wrong way, back to the level"); back within
  wrongWay.back (15 m), levelBack. Never a fail. (The soma world has walls round the park, so only
  the sf levels can show it.)
- Time up: as the 2-minute run, then levelOver {level, score, goals, tape}. City goals stay on during
  a level run (goalComplete), like in every game.
Levels (data/tour.json; positions are the site/city frame, letters and tape checked by scenarios):
- SoMa West Skatepark (soma, from the west runway): Big 3 Combo (2,000 with the BIG 3 GAP),
  Ollie the Big 2 (BIG 2 GAP), Transfer the Hellride (a combo with a Spine Transfer). Letters over
  Big 3, over the wave, on the manual pad, along the Big 2 rail, down the south rear runway. Tape:
  high over the Hellride side of the spine, at the top of what a full-speed (9 m/s) transfer from the
  Otis quarter reaches; the 8.9 m/s transfer that makes the goal passes under it (phase 28: it was
  found on nearly every transfer once phase 27 made vert airs consistent). Tiers 12,000 / 52,000.
- The Mission (sf, from Valencia between 17th and 16th): Wallride a Mural (CLARION
  WALLRIDE), Ollie the BART Stairs (BART STAIRS), Bench Combo at Dolores Park (1,500 with a seat wall
  or bench grind, started in the park). Letters up Valencia, round the BART plaza, down Clarion
  Alley. Tape: on the roof of a parked hybrid on Valencia (boneless up). Tiers 10,000 / 40,000.
- The Castro (sf, from Harvey Milk Plaza): Rainbow Combo (1,000 started on the crossing at
  Castro and 18th), All the Way Down (a 15 m grind on a Muni stairs rail), Bomb Castro St (34 km/h
  between Market and 18th; pushing downhill gets about 35). Letters on the plaza, down Market,
  down Castro. Tape: in the air past the bottom of the Muni stairs' middle rail: hold the ollie
  through the 50-50 and pop before the end (phase 28; it hung over the stairs, which an ollie of the
  set found nearly every time). Tiers 5,000 / 22,000.
- Hill Country (sf, from the top of Dolores or Grand View): Dolores Crest Air (off the
  crest at 19th St; phase 17, it paid any full ollie on Dolores before), Upper
  Market at 56 (km/h, from Grand View), 19th Street Curve Air. Letters down Dolores. Tape: on the
  roof of the car parked just below the crest at 19th on Dolores: a boneless beside it and a grind
  along its roof (phase 28; it hung over the crest at Market and Clayton, which any ollie there
  found, and no air off a street crest gets far enough above the street to hide a tape). Tiers
  3,500 / 23,500 (the hills only, phase 18).
  Dolores and Twin Peaks are 1.5 km apart, more than a run can push uphill, hence the second start.
  The third start is the Hayes St bomb (hayes_hill, the Hayes Valley spot): the level's extra area
  takes in Hayes up to just short of Octavia, so no wrong-way hint on the bomb; its own goals are on
  Dolores and Market, the bomb is for the ride. Dolores Park (the Mission's seat walls, at the bottom
  of the Dolores bomb) is an exclude box and Patricia's Green is past the Hayes box's end: the
  wrong-way hint shows at both (tour-hills-park). Points there still count (a hint, never a fail).
- Hayes Valley & Alamo Square (sf, from Hayes and Pierce; also from the top of Alamo
  Square or at Patricia's Green): Bomb Hayes in Under 60 (Octavia within 60 s of leaving Pierce;
  tucked all the way takes 57.7 s), Patricia's Green Line (a 3,000 combo holding both PATRICIA'S
  SEAT WALL and PATRICIA'S BENCH), Postcard Air (1.1 s of air taken off on the east slope of Alamo
  Square, facing the Painted Ladies; a flat ollie gets about 1 s, a full ollie down the steep part
  1.2). Letters S, K, A, T down Hayes, E on Patricia's Green's first seat wall. Tape: on the plinth
  of the steel sculpture at Patricia's Green (the slabs are 7 m tall walls, so their top is out of
  reach): ollie up from the road south of it and steer clear of the fins. Tiers 24,000 (9,500 before the feel pass round 4) / 59,000
  (phases 18-19: the bench pays PATRICIA'S BENCH only and a gap pays once a combo; the line carries
  on along the long wall).
- Civic Center (sf, from UN Plaza; also from the top of City Hall's Polk St steps;
  physics phase 20): City Hall Steps (the city export's CITY HALL STEPS gap), UN Plaza Line (a
  2,500 combo holding UN PLAZA LEDGE, started in the plaza), F-Line Grind (25 m on the streetcar rails
  in Market St: the grind goal takes a line feature now; Market from Octavia or Van Ness to the plaza
  falls only about 0.5%, too gentle to bomb, so this replaces the planned Bomb Market to the Plaza).
  Letters: S on UN Plaza's north row, K on the fountain rim, A on the F-line near 8th, T on Civic
  Center Plaza's north-west ledge, E in the air over City Hall's steps. Tape: on top of the tallest
  pier in UN Plaza's fountain, a boneless from the fountain floor. Gaps added: UN PLAZA LEDGE (the
  two rows), FOUNTAIN RIM, CITY HALL HUBBA (the steps' cheek walls), F-LINE RAIL, CIVIC CENTER LEDGE.
  Tiers 14,000 / 115,000.
- Embarcadero (sf, from EMB; also from Pier 7; physics phase 25, on city phase 10's
  waterfront): EMB Seven (EMB SEVEN, off the terrace down the seven stairs), Three-Block (THREE BLOCK, a
  grind on the stacked blocks by the fountain), Pier 7 Line (a 3,000 combo holding PIER 7 BLOCK, started
  at the blocks). Letters: S on the third ledge of EMB's row by the banks, K over the fountain's east
  rim (the fountain gap), A on the F-line rails where Market meets Steuart, T on the south-east edge of
  Pier 7's middle block, E in the air down the seven. Tape: high off the street end of Pier 7's middle
  block, at the top of what a full pop off it reaches after a grind from the seawall side (city phase 15 rebuilt Pier 7
  as it is: three blocks straddling two steps; before, on the old benches, phase 28; before that it sat
  on the lone granite block in the fountain's pool). Gaps added: EMB SEVEN, FOUNTAIN GAP, THREE BLOCK, EMB LEDGE,
  PIER 7 BLOCK (PIER 7 BENCH until city phase 15); F-LINE RAIL's box runs down Market to the Embarcadero.
  Tiers 20,000 / 162,000 (Sick re-measured after city phase 15: tour-embarcadero-sick's great line is now EMB's
  row by the banks, the real Pier 7's blocks being one a pass).
- Chinatown (sf, from the Dragon Gate; also from Grant at Sacramento; physics phase 31, on city
  phase 12's Grant Ave): Through the Dragon Gate (THROUGH THE DRAGON GATE, an ollie through its middle
  opening, taken off south of the pillars and landed north of them), Ride the California Slot (20 m in
  the cable car slot down California across Grant: the grind goal's feature), Lantern Line (a 2,000
  combo started on Grant). Letters: S in the air in the gate's middle opening, A and T on Grant's west
  curb below California, K and E in the California slot. Tape: high in the gate's narrow west opening
  (2 m between its pillars, over the sidewalk), out of an ollie's reach: a boneless through it. Gaps
  added: THROUGH THE DRAGON GATE, CALIFORNIA SLOT (the slot's last 5 m run a few centimetres under the
  road's surface, so a grind there runs into it: pop before). Tiers 19,000 / 110,000.
- Russian Hill (sf, from the top of Lombard's crooked block; also from Hyde at Lombard; phase 31):
  Lombard Flower Beds (LOMBARD FLOWER BED, a grind on the low brick wall round a bed), Lombard Stairs
  (LOMBARD STAIRS, an ollie down the steep flight of the south sidewalk's stairs, or LOMBARD HANDRAIL,
  the long handrail down the north side), Ride the Hyde Slot (80 m in the cable car slot down Hyde, 12
  m/s by then). Letters: S on a bed wall, K in the air down the stairs, A on the handrail, T and E in the
  Hyde slot. Tape: high over the steep flight, out of an ollie's reach: a boneless off its top. Tiers
  45,000 (17,500 before the feel pass round 4) / 104,000.
- North Beach (sf, from Washington Square; also from Columbus at Broadway; phase 31): Washington Square
  Bench Line (a 1,500 combo holding WASHINGTON SQUARE BENCH, started in the square), Columbus Curb (15 m
  on a curb along Columbus: the grind goal with feature curb), Café Manual (a 1,500 combo with a manual,
  started on Columbus). Letters: S on a bench on the square's south path, K and A on Columbus's west
  curb down from Broadway, T and E in the street further down. Tape: on the roof of a car parked on
  Columbus just down from Broadway: a boneless beside it and a grind along its roof. Tiers 17,500 /
  105,000.
- Fisherman's Wharf (sf, from Pier 39; also from Fisherman's Wharf on Jefferson and from Pier 7; phase
  31): Pier 39 Gate (PIER 39 GATE, an ollie through it; a car parked at the curb in front means coming
  in along the footway at a slant), Promenade Line (a 2,500 combo holding PROMENADE EDGE, started on the
  promenade north of Pier 7), Turntable Rim (TURNTABLE RIM at Hyde and Beach: an ollie across the edge
  of the turntable's timber disc beside its cable car, both ends outside the rim). The level is the
  waterfront from Pier 7 to Aquatic Park, more than a run can push: its extra areas are the promenade
  and Hyde and Beach, and its starts put a run near each part (like Hill Country's). Letters: S, A, E
  on the promenade's first granite edge, K in the air through the gate, T in the air across the
  turntable's edge. Tape: high over the turntable's edge, out of an ollie's reach: a boneless across
  it. Tiers 17,500 / 103,000.
  Letters and the tape may be in a level's extra areas (tests/tour.test.ts).
Numbers:      data/tour.json (seconds, tapeRadius, wrongWay, names, levels).
For the view: session.level, levelGoals, tape, letters, timeLeft, mode; the level's data for the
              checklist (names: tour.names and each goal's name and description), the letters and
              the tape (draw it where it is, a VHS tape, until found).
Events:       levelStart {level, seconds}, letter {letter, have}, levelGoal {level, id, name},
              tapeFound {level}, levelWrongWay {level}, levelBack {level}, levelOver {level, score,
              goals: string[], tape}. Also the usual gap, comboLanded and goalComplete.
Scenarios:    tour-soma, tour-mission, tour-castro, tour-hills (each a full run: its goals (three;
              two in Hill Country), the tape and S-K-A-T-E, set up by teleports), tour-hills-twinpeaks (the other
              start, Upper Market at 56), tour-hills-hayes (the third start, the Hayes bomb with no
              wrong-way hint), tour-hayes (a full run), tour-tape-once (the tape found twice: one
              tapeFound), tour-hills-park (the hint in Dolores Park and at Patricia's Green), tour-tiers (pro and sick, lowered),
              tour-wrongway (the hint up and down, the run carries on), tour-civic (a full run),
              tour-civic-sick, tour-embarcadero (a full run), tour-embarcadero-sick, and phase 31's
              tour-chinatown, tour-russianhill, tour-northbeach, tour-wharf (full runs) with their -sick
              great runs; their gaps each have an sf-gap-* scenario. tests/tour.test.ts: the data
              checks and command errors.
Tiers (physics phase 14): measured against scripted runs, each line repeated at the pace of
              riding back to its start (a teleport stands in for the ride). Pro is about a decent run
              (a level's 2,000-3,000 combos every 20 s), Sick a little under a great one (its best
              line every 10 s):
              SoMa: decent 12,320 (Big 3 + manual + heelflip, 2,464), great 62,172 (62,422 before the feel pass's park carve; 5,652 with a
              second manual and an impossible): 12,000 / 52,000. The Mission: decent 11,760 (seat
              wall, roof grind, Clarion wallride), great 48,528 (the seat wall with a kickflip out,
              4,044, camped): 10,000 / 40,000. The Castro: decent 5,137 (rainbow combo, Harvey Milk
              set), great 25,935 (the Muni rail with a kickflip off the end, 3,705 every 16 s for the
              climb back; camping the rainbow crossing 16,506): 5,000 / 22,000. Hill Country (phase 18,
              the hills only): decent 3,684 (the pop at the 19th crest with a kickflip, 2,600, two
              bert slides on their own, a burrito), great 28,024 (one combo from 20th to 18th: SENT IT
              with a 360 flip and a kickflip, manual, heelflip, bert slide, pop shove-it, nose manual,
              impossible, 27,774; riding back up takes longer than the run): 3,500 / 23,500. Hayes
              Valley: decent 9,840 (the bomb, then the line without the long wall, 3,280, three times
              20 s apart), great 69,520 (the line with it, 6,320, every 10 s): 9,500 / 59,000
              (re-measured in phase 24 after the early grind press and the wider clean landing: they
              were 9,864, 3,288, 70,290 and 6,390; a 1% move, so the tiers stay: Pro is still under
              the decent run, Sick 85% of the great one).
              Civic Center (phase 20): decent 14,256 (two UN Plaza ledges, 2,376, every 20 s), great
              125,400 (four ledges with a flip between each, 11,400 since city phase 11, every 10 s; 136,512 before the
              phase 23 balance damping, when the bot's taps once made a special): 14,000 / 115,000.
              Embarcadero (phase 25): decent 20,394 (two Pier 7 benches, 3,399, every 20 s), great
              166,320 (166,914 before city phase 11; a wallride along the first bench's side onto it, then four benches with a flip
              between each, 15,120, every 10 s; the bot's heelflip then shove-it is the Kickflip
              Superman's keys, so with the meter full its line became a special three times, 204,714,
              and the flips go shove-it, kickflip, heelflip): 20,000 / 140,000. EMB's row by the banks
              is close (three ledges with flips, 12,033, within 10 s). Measuring it found the ledge-hop
              farm (grinds.md: a catch slower than stallSpeed, a pop off a void grind), fixed first.
              City phase 15 rebuilt Pier 7 as it is: three blocks 9 to 12 m apart across the riding
              line, one a pass for a strong player (the Tour leg: a 50-50 down the middle block, a
              kickflip off, a manual, a heelflip out, 4,470). The great line is EMB's row by the banks
              now: at 7 m/s a 50-50 down its second ledge, an impossible onto the third, a kickflip onto
              the fourth, an impossible off into a manual, a kickflip out, 17,496 x9 every 10 s, 192,456
              (only impossibles and kickflips: up and left end no special's keys, whatever the balance
              bot pressed; a shove-it after its right became a Kickflip Superman, 220,734). Sick
              162,000 (84%, as 140,000 was of 166,320), on the tenth pass. A decent run on the row (two
              ledges popped, 2,889, every 20 s) scores 17,334, under Pro's 20,000, which stays (see
              docs/feel-audit.md for how decent and casual players do on it).
              Scenarios tour-<level>-sick ride the great runs.
              Phase 31's four (each line every 10 s; Pro under the decent run, Sick about 91% of the
              great one, as Chinatown measured): Chinatown: decent 19,164 (the California slot as a
              50-50 popped off plain, 3,194, every 20 s), great 120,384 (a kickflip into the slot, a
              nosegrind, a 360 flip off, 10,032): 19,000 / 110,000. Russian Hill: decent 17,976 (the
              handrail as a 50-50 to its foot, 2,996), great 114,288 (a boneless onto it, a nosegrind, a
              360 flip off before its foot, 9,524): 17,500 / 104,000. North Beach: decent 17,952 (down
              Columbus, a kickflip to manual, a heelflip to manual, 2,992), great 115,344 (three flips
              between three manuals: kickflip, 360 flip, varial heelflip, 9,612): 17,500 / 105,000.
              Fisherman's Wharf: decent 17,724 (the promenade's first edge as a 50-50 to its end,
              2,954), great 113,424 (a boneless onto it, a nosegrind, a 360 flip off, 9,452): 17,500 /
              103,000.
              Re-measured in phase 17 (the repetition curve, the farm fixes): the Mission, the Castro
              and Hill Country did not move (Hill Country's crest air now has to be popped at the
              crest at 19th, which its runs do); SoMa's great line gained 252 (its second manual is
              now worth 75%, not 50%); Hayes's line went from 4,718 to 11,571: a grind left at a
              line's end can now carry on onto a higher wall beside it (grinds.md), and at Patricia's
              Green the short seat wall ends beside the long one, a 4 s grind and a second PATRICIA'S
              SEAT WALL. Phase 18: one gap per move (PATRICIA'S BENCH without BENCH GRIND, SENT IT
              without CREST AIR), Hill Country measured on the hills, Hayes's decent run on 2-3k
              combos like the other levels'. Phase 19: a gap pays once a combo, so the carry-on no
              longer pays PATRICIA'S SEAT WALL twice: the line is 6,390, still the Tour's best (the
              4 s grind on the long wall, 912 before the curve); a 2 s limit on one grind's
              per-second points would bring it to 5,360, not taken for now.
Feel notes:   `skate feel --tour` (docs/feel-audit.md section 8) plays every goal's leg with a decent
              and a casual human model: every goal but the tapes and Sick is made by a decent player
              at least a quarter of the time (phase 26; lowest: the Embarcadero's S-K-A-T-E, 26%,
              and Transfer the Hellride, 28%). The tapes are finds (phase 28): each is out of reach
              of a flat ollie from the ground near it and on a line with two parts (a fast transfer,
              a grind and a pop, a boneless and a grind), so a decent player finds it a quarter to
              two fifths of the time and a casual one under one in seven. The Mission's, Hayes's and
              Civic's, which a decent player found under 80% of the time, stay where they were.
              Play-testing still wanted for tiers and letters.

Pro lines (physics phase 32, finished in the feel pass round 3): Chinatown, Russian Hill, Fisherman's
Wharf and Hayes have a Pro line besides the great run (scenarios/tour-<level>-pro.skate: manuals, short
grinds and gaps, which a casual player makes), and `feel --tour` measures Pro on it (Sick stays on the
great run). The Wharf's Pro is 16,500 (was 17,500). Measured in docs/feel-audit.md section 8 (round 3):
casual Pro 57%, 100%, 43% and 100%.

Pro tiers re-measured (feel pass round 4, 2026-11-10): Pro on Russian Hill's and Hayes's Pro lines had
become a given (casual median 44,154 against 17,500; decent median 36,379 against 9,500). Set from 30
tries of each human on the Pro line: Russian Hill 45,000 (decent 80%, casual 43%); Hayes 24,000 (casual
43%, decent 97%: the casual runs split into bails near 11,000 and finished runs at 20,000-25,000 while a
decent run rarely scores under 28,000, so no tier gives decent 70-85% with casual 30-50%; Pro favours
the casual window, "you played the level").

