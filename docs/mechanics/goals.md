# City goals
Milestone: M5 (physics phase 5). Code: src/sim/game/goals.ts (checks and trackers),
src/sim/game/session.ts (calls them every tick), data/goals.json, new gaps in data/gaps.json.

Input:        none of its own: goals watch the skating.
States:       always on, in free skate and every game, in the worlds listed in goals.json parks (soma,
              sf; not the lab). A goal completes at most once per session: its id goes into the
              session's cityGoals and goalComplete fires. Starting a game does not reset them (the
              play session goes on). The client keeps completion across sessions.
Rules (kinds; each goal has id, name, area, description, kind and its parameters):
- gap {gaps: [ids]}: any of those gaps is hit (the gap event). New gaps for the city: MUNI HOP
  (air, box to box across the J-Church tracks on Church, both ways), MISSION DOLORES LEDGE (grind
  on curb_684; in the squeezed city VALENCIA CURB, the curb in front of Fog City Skate Shop, curb_-43_-290), BENCH GRIND (grind on any bench_* line: an element ending in * matches by prefix),
  BIKE RACK (rack_*), CAR HOP and ROBOTAXI HOP (new gap kind car, robo optional: clear a sim car in
  one air, the feet above its roof or hood while over its footprint, and land off it; a robotaxi
  scores ROBOTAXI HOP instead of CAR HOP; an air that started on a car, riding or grinding it, is
  not a hop over it).
- skitch {meters, robo?}: towed at least meters in one skitch (Thing.skitch.meters counts it);
  robo: by a robotaxi.
- speed {kmh, box, z?}: at least kmh (on the board or in the air, not bailing) inside box
  [minX, minY, maxX, maxY], between z[0] and z[1] if given.
- combo {points, box, gaps?}: a combo of at least points lands, and it started inside box (the session
  remembers where the open combo started: comboFrom, the skater's spot when its first trick went in);
  with gaps, the combo must hold one of them (comboLanded's entries include gap-<id>).
- collect {burritos}: burritos collected this session.
- courier {deliveries}: deliveries in one courier game.
- bomb {route?, maxSeconds?, noBrakes?, noFalls?, win?} (win: first home, ahead of the route's racers): finish the Hill Bomb with total <= maxSeconds, without
  braking (the foot brake, S on the board outside a manual, or a powerslide; bombFinish now carries
  braked), without falls.
Numbers:      data/goals.json (15 goals); data/gaps.json (the new gaps and their points: MUNI HOP 400,
              MISSION DOLORES LEDGE 300, BENCH GRIND 150, BIKE RACK 200, CAR HOP 500, ROBOTAXI HOP 750).
Session fields: cityGoals (ids done this session), hopCar / hopRobo / onCar (the car hop tracker),
              comboOpen / comboFrom (where the open combo started), raceBraked (hill bomb).
Events:       goalComplete {id, name, area}. gap events now carry the gap id too; bombFinish carries
              braked.
Scenarios:    sf-goal-carhop (boneless over a parked car: CAR HOP, Ollie an EV, once), sf-goal-robohop
              (ROBOTAXI HOP, two goals), sf-goal-carhop-off (landing on the trunk and popping off: no
              hop), sf-goal-bench (two bench grinds, one goal), sf-goal-missionledge, sf-goal-munihop,
              sf-goal-skitch (20 m here), sf-goal-roboskitch, sf-goal-bomb (50 km/h and under 12 s; the
              powerslides are brakes), sf-goal-nobrakes (11.0 s), sf-goal-market (35 km/h on Market),
              soma-goal-parkcombo and soma-goal-parkcombo-outside (the box), sf-goal-collect,
              sf-goal-courier, lab-goals-off (no goals in the lab).
Feel notes:   (waiting for play)

Twin Peaks (physics phase 8): goals tp110 (Twin Peaks Under 110, kind bomb route twinpeaks),
tp56 (56 km/h in a box over Upper Market), tpnobrakes (bomb, route twinpeaks, noBrakes), claytoncrest
(the CLAYTON CREST AIR gap); appended at the end of the list so the index-based setData in older
scenarios still points where it did. Measured: the autopilot's race takes 103.36 s (city phase 11) without ever
braking and tops out at 58.7 km/h between 18th and Douglass (the sim's real ceiling on that grade:
tucked, the drag balances near 16.3 m/s), so 60 km/h would be out of reach and 56 leaves room.
Gaps CLAYTON CREST AIR (400) and 19TH STREET CURVE AIR (500): airs of 45+ ticks taken and landed on
the crests where the city ground steepens (Clayton: 3% to 8%; the 19th Street intersection: flat to
12%). Rolled at the sim's speeds they do not launch (the 19th crest would need about 17 m/s); an ollie
off them flies 0.86 s because the street falls away. A gap alone now banks on its own (the landing
gave no grace to an empty combo, so DOLORES CREST AIR or MUNI HOP alone stayed open until the next
landing). Scenarios: sf-goal-twinpeaks, sf-gap-claytoncrest, sf-gap-curve19th.

City spots (physics phase 10; the city export's phase 4 spots bart_16th, harvey_milk,
dolores_ledges). Air gaps can now ask for a landing height (toZ [lo, hi], the skater's centre) and for
an air that passes over one of a list of outlines (over: polygons [[x, y], ...]: takeoff and landing
in plan, both outside it, the path crossing its edge). Grind and lip gaps can ask for the line to pass
through a box (box) and for the export's feature of the line (feature: 'car roof'; grind lines now
keep it). Gaps, appended to gaps.json:
- BART STAIRS (800): 16th St Mission BART's southwest stairs (49 steps of 14 cm, 7 m). Off the top in
  one ollie of at least 100 ticks, down 12 or more steps (toZ). The full set lands at about 12 m/s:
  a stumble since the feel audit (stumbleSpeed 10, hardSpeed 14; it was a bail at 9.5), so the gap
  is the top dozen steps and more; 15-20 steps is the usual landing, clean or a stumble. Riding a rail down and dropping off its end is not it (too short an air).
- BART HANDRAIL (600): grind any rail_* line in the BART stairwell (five handrails, 17.6 m and 7 m
  down; on at 4.6 m/s, off at 11.6 m/s).
- PARAPET HOP (500): over either side parapet of the BART stairwell (57 cm above the plaza) from the
  plaza and down onto the stairs (landing below the plaza level).
- HARVEY MILK SET (800): the Muni stairs at Harvey Milk Plaza (44 steps of 15.5 cm), 12 or more steps
  in one ollie of 100+ ticks.
- MUNI STAIRS RAIL (600): grind any rail_* line in the Harvey Milk stairwell (16.3 m). The rail starts
  1.1 m above the plaza: a full ollie, popped about 2 m early.
- DOLORES SEAT WALL (300): grind a ledge_* line at the Dolores Park planters by 19th (45 cm walls).
- PLANTER HOP (300): over one of the four planters' outlines. A straight hop across one hits the tree
  in its middle; over a corner works (sidewalk, grass, any side).
- ROOF GRIND (400): grind a parked car's roof edge (element car_*, feature 'car roof'; 48,590 car edges
  in the city, four of each car's ten). A roof is 1.47 m above the road and an ollie reaches 1.17 m,
  so it takes a boneless (20% more pop) or a start from higher up.
Goals, appended to goals.json (so older index-based setData still points where it did): bartstairs
(Ollie the BART Stairs: bart_stairs), harveyrail (Grind a Handrail at Harvey Milk Plaza, "Respect the
plaza. Mind the Muni riders.": muni_rail), dolorescombo (Bench Grind Combo at Dolores Park: 2,500
points started at the planters with DOLORES SEAT WALL or BENCH GRIND in it; the park-wide Dolores Park
Show-off already asks 1,500 of any combo), roofgrind (Roof Grind a Hybrid: roof_grind). The car in the
game carries no brand, and neither do the goal names.
Scenarios: sf-gap-bart-stairs (18 steps, clean, the goal), sf-gap-bart-stairs-short (nine steps: no
gap), sf-gap-bart-rail (rail to the floor; no stairs gap), sf-gap-parapet-hop, sf-gap-harvey-set (21
steps, clean), sf-goal-harvey-rail, sf-gap-seatwall (1,126 points: no combo goal yet),
sf-goal-dolores-combo (2,733), sf-gap-planter-hop (a corner), sf-gap-planter-hop-miss (alongside: no
gap), sf-goal-roof-grind (boneless from the street). sf-parked-car-grind's roof grind now scores ROOF
GRIND too (its hash changed for that).

Clarion Alley (physics, after phase 12; the city export's phase 6 spot clarion_alley: the mural
alley off Valencia, 4.6 to 5 m wide, 168 m east to Mission St, 4 m downhill, mural walls 3.4 to 17 m
tall both sides). A new gap kind wall: a wallride that ends inside a box (plant: true, a wallplant
there instead). Gaps:
- CLARION WALLRIDE (600): a wallride on either wall of the alley (box x 0 to 169, y -792 to -770).
  Beside a wall, about 4 m/s along it, ollie and I: the full 0.75 s on the mural.
- MURAL WALLPLANT (400): a wallplant (K in the air, moving into the wall at 1 m/s or more) there.
  Across the alley at 3 m/s it pushes you back off the wall and down fakie, usually a stumble.
Goal, appended: clarionmural (Wallride a Mural in Clarion Alley, "Don't touch the paint, it is
someone's life's work.": clarion_wallride). A wallplant is not a wallride, so it does not count.
Rider line: proposed to the city export (city/config.json, owned by the world generator) as
clarion_alley_line, Valencia to Mission down the middle of the alley; ridden in-memory by the
rider-line autopilot (31.9 s at 5.4 m/s). It joins `skate lines` once the export has it.
Scenarios: sf-clarion-wallride (north wall, the goal), sf-clarion-wallride-south (south wall),
sf-clarion-plant (MURAL WALLPLANT, no goal).

Hayes St (physics phase 14): goals hayes60 (Hayes Under a Minute: the Hayes St bomb in under
60 s, penalties included) and hayeswin (Beat the Landlord: first home ahead of the three locals;
the bomb goal kind gains win). Both in sf-bomb-hayes (57.43 s, first).

Scoring integrity (physics phase 17):
- CAR HOP and ROBOTAXI HOP pay once per car in the gap's again (30 s): hopping one parked car back and
  forth paid every time (session.carHops, car id to the tick it paid, reset when a run starts).
  Scenario sf-carhop-again.
- Air gaps can ask for travel: minMeters, the plan distance from takeoff to landing. WAVE AIR needs 3
  m, the crest airs 8 m, so a hop on the spot pays nothing (soma-wave-air).
- DOLORES CREST AIR and SENT IT ON DOLORES took off and landed anywhere in a 290 m box over the whole
  street, so any full ollie on Dolores paid both, 3,200 a second. They now take off on the crest at
  19th St (the downhill edge of the intersection, where the grade goes from 2% to 12%) and land down
  the block; SENT IT needs 120 ticks (a flat full ollie is 116, a well-timed pop at the crest 121-131).
  Scenarios sf-dolores-crest-gap (the pop at the crest: both), sf-dolores-flat-ollie (on 18th's flat:
  none).

Overlapping gaps (physics phase 18): a move pays each gap once, and a specific gap replaces a
generic one for the same move (gaps.json replaces: the replaced gap does not fire when the replacing
one does; same kind only, checked at load). The audit of every pair in data/gaps.json:
- Same move, two gaps, now one: PATRICIA'S BENCH replaces BENCH GRIND (a bench_* line in Patricia's
  Green's box paid both), SENT IT ON DOLORES replaces DOLORES CREST AIR (same takeoff and landing
  boxes: a send paid both, 1,600 x2). Hill Country's Dolores Crest Air goal takes either.
- Kept: BART STAIRS and PARAPET HOP in one air are two obstacles cleared (over a parapet and down the
  set); CLARION WALLRIDE and MURAL WALLPLANT are different moves; BIG 3 and BIG 2 take off from
  disjoint boxes; the two MUNI HOPs go opposite ways; ROOF GRIND is the only car-line gap; the grind
  gaps on exact elements (BIG 2 RAIL, BIG 3 HUBBA, TERRACE RAIL, MISSION DOLORES LEDGE, HELLRIDE LIP)
  or on prefixes inside a box (BART HANDRAIL, MUNI STAIRS RAIL, DOLORES SEAT WALL, PATRICIA'S SEAT
  WALL) have no generic gap over them; BIKE RACK has no specific one.
- Scenarios: tour-hayes (the Patricia line without BENCH GRIND), sf-dolores-crest-gap (a full pop at
  the crest: SENT IT only; a short one: DOLORES CREST AIR), sf-goal-bench (BENCH GRIND elsewhere).
- A gap pays once per combo (physics phase 19, cap A): a gap already in the
  combo neither pays nor adds to the multiplier again, and fires no gap event (the seat-wall
  carry-on at Patricia's Green paid PATRICIA'S SEAT WALL twice). A CAR HOP that did not pay leaves
  the car free to pay later. Scenarios sf-gap-once-per-combo, tour-hayes-sick (6,390 a line).
- Civic Center gaps (physics phase 20; Tour level 6): UN PLAZA LEDGE (250; the ledges of UN
  Plaza's two rows, not the BART stairwell parapets at their east end), FOUNTAIN RIM (400; the
  fountain's granite rim), CITY HALL HUBBA (500; the cheek walls of the Polk St steps), F-LINE RAIL
  (250; the streetcar rails in Market St from Van Ness to 7th, feature streetcar rail, not the
  stairwells' handrails), CIVIC CENTER LEDGE (200; the ledges round Civic Center Plaza's lawns), with
  the city export's CITY HALL STEPS (700). None overlaps another (no replaces needed): the plaza's
  benches are bench_* outside UN PLAZA LEDGE's box, and the hubba is a grind where the steps are an air.
  Scenarios sf-gap-un-ledge (out while the squeezed city build has a road over UN Plaza's north row),
  sf-gap-fountain-rim, sf-gap-city-hall-hubba, sf-gap-fline-rail,
  sf-gap-civic-ledge.
- Embarcadero gaps (physics phase 25; Tour level 7): EMB SEVEN (600, air: off the terrace, over a
  band across the middle of the seven stairs, down on the plaza, 40 ticks of air at least; an ollie or a
  fast roll-off that flies the set, not one that bumps down it), FOUNTAIN GAP (400, air: from the plaza
  east of the fountain over its east rim into the pool, 40 ticks of air at least), THREE BLOCK (300,
  grind: an edge of the three stacked blocks; it replaces EMB LEDGE), EMB LEDGE (200, grind: the plaza's
  ledges), PIER 7 BLOCK (250, grind: the blocks at the foot of Pier 7; PIER 7 BENCH on the old benches until city phase 15). F-LINE RAIL's box now runs down
  Market to the Embarcadero (the Market rails west of the park are outside it as before). Scenarios
  sf-gap-emb, sf-grind-emb (EMB LEDGE), sf-grind-pier-7 and sf-slide-pier-7 (PIER 7 BLOCK), tour-embarcadero (F-LINE RAIL at
  Steuart).
- New neighbourhoods' gaps (physics phase 31, on city phases 11-12; Tour levels 8-11): THROUGH THE
  DRAGON GATE (500, air: through the gate's middle opening on Grant, between its middle pillars), CALIFORNIA
  SLOT (300, grind: the cable car slot down California across Grant), LOMBARD FLOWER BED (300, grind: the
  low brick walls round the crooked block's beds), LOMBARD STAIRS (600, air: off the top of the steep
  flight of the south sidewalk's stairs and down it, 100 ticks of air at least), LOMBARD HANDRAIL (500,
  grind: the handrails down the north side; the upper one runs into a street tree's trunk 7 m from its
  foot), TURNTABLE RIM (400, air: across the edge of a cable car turntable's disc, both ends outside its
  rim; two gaps of the same name, Powell and Market and Hyde and Beach), PIER 39 GATE (400, air: through
  the gate between its posts), PROMENADE EDGE (250, grind: the granite edges along the promenade north
  of Pier 7; in the squeezed city its box is the seawall in front of Pier 7, where those edges are to be
  re-homed, and sf-grind-promenade and sf-gap-promenade-edge are retired until they are built), WASHINGTON SQUARE BENCH (250, grind: the square's benches;
  replaces BENCH GRIND). City goals added: Turntable Rim (either turntable), Hyde St at 50 (km/h down
  Hyde; the speed wobbles start at about 54), Grind a Lombard Flower Bed, Through the Dragon Gate, Grind
  the Promenade. Scenarios sf-gap-dragon-gate (also: the landing after a teleport is not the last air's;
  sim.ts placeAt puts the takeoff at the teleport, and before it paid the gate again), sf-gap-california-slot,
  sf-gap-lombard-bed, sf-gap-lombard-stairs, sf-gap-lombard-rail, sf-gap-turntable, sf-gap-turntable-hyde,
  sf-gap-pier39-gate, sf-gap-wsq-bench, sf-goal-hyde50 (on Hyde's kept top block in the squeezed city).
  CALIFORNIA SLOT pays on the Powell St slot in the squeezed city, named POWELL SLOT (Chinatown stops at Pine).
- City phase 13's spots (physics phase 31): FREEWAY DIY (300, grind: the edges of the DIY spot's
  banks under the Central Freeway), SITE FLAT BAR (250, grind: the flat bar at the building sites off
  Octavia, in SoMa and on the waterfront by North Beach; three gaps of one name), HALLIDIE PLAZA LEDGE
  (250) and HALLIDIE RAIL (500, the handrails down to the BART concourse), MARINI PLAZA LEDGE, MARKET
  COURTYARD LEDGE, 24TH ST PLAZA LEDGE (250 each, grind: the plazas' granite ledges), POTRERO DEL SOL
  (300, grind: any ledge or coping in the park) and POTRERO RAIL (300), DUBOCE ROOF (400, grind: the low
  roof's edges by Duboce Park). PROMENADE EDGE's box now stops at the last edge (x 1470), short of the
  waterfront building site. City goals: DIY or Die, Hard Hat Area, Lunch Break (a ledge in any of the
  four plazas), Hallidie Handrail, Potrero del Sol Line (a 2,000 combo with one of its gaps, started in
  the park), The Roof by Duboce Park. Scenarios sf-gap-diy-ledge, sf-gap-site-bar (the SoMa and North Beach sites and their
  scenarios are not in the squeezed city), sf-gap-hallidie-ledge, sf-gap-hallidie-rail, sf-gap-marini-ledge,
  sf-gap-courtyard-ledge, sf-gap-bart24-ledge, sf-gap-potrero-ledge, sf-gap-potrero-rail, sf-gap-duboce-roof.
