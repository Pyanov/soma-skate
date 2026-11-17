# The squeezed city

The city around the park (world `sf`) is a squeezed San Francisco. Eighteen tiles of the real city, each trimmed to
the blocks that make its place, are packed side by side, with invented streets between them:
- All 20 places in the map menu (`data/story.json` `travel.places`) are in it, 150 to 300 m apart: 20 to 40 s of
  pushing from one to the next.
- The places span about 1.1 by 1.2 km (about 4 by 6 km in the real city). With the two bomb strips, out to Twin
  Peaks and to Alamo Square, the map is about 1.8 by 1.6 km.
- Places keep their rough real order, but not their true distances.
- The three hill bombs (Dolores, Twin Peaks and Upper Market, Hayes) are full length.
- The park stays at the origin, its frame unchanged.

The world generator makes it from open data: `city/squeeze.py` warps the data by the tile table
`city/squeeze_tiles.json`, and `city/build.py` builds the city from the result. `./skate city` runs both (section 3).

## 1. The tiles

Each tile is a piece of the real city moved by a whole-metre shift, with no rotation, and raised or lowered by its
own height offset. The moves, the select areas and the rest of each tile's settings are in the tile table.

| tile | what it keeps |
|---|---|
| park | the park, Duboce and 13th St to the half block before 14th, the freeway deck and its touchdown at Market & Octavia |
| mission | 16th St to Clarion Alley, Valencia St to the lot line between Mission and Capp: the 16th St BART plaza and its stairs, the Valencia shops, Fog City Skate Shop, the taqueria, the laundromat, the corner store |
| calle24 | 24th & Mission (both BART plazas), Lilac St to 25th, Capp St |
| potrero | Potrero del Sol and its skatepark |
| dolores | Dolores Park from Church St to Dolores St and from 18th up to Liberty St: the lawn, the playground, the J Church right of way through the park with all of the J race's stops and rails, the Dolores bomb |
| castro | Castro St from Harvey Milk Plaza to 18th, and the Twin Peaks bomb strip up Upper Market, full length, out to the south-west |
| duboce | Duboce Park (the lawn, the N Judah, the rooftop) and the whole of Duboce Ave |
| hayes | Patricia's Green and Hayes Valley, and the Hayes bomb strip, full length, out west to Alamo Square and the Painted Ladies |
| cityhall | City Hall and Civic Center Plaza |
| unplaza | UN Plaza, Market Courtyard, Market St from 8th to 7th and its BART stairs |
| downtown | Market St at 5th, Hallidie Plaza with its ledge, rail and stairs, the Powell turntable |
| chinatown | Grant Ave from Bush St through the Dragon Gate to Pine St: the lanterns |
| northbeach | Washington Square, Saints Peter and Paul, Marini Plaza, Columbus Ave along the square |
| lombard | Lombard St's crooked block and the top of Hyde St with its cable car slot |
| wharf | Fisherman's Wharf: Jefferson St from Jones to Mason, the crab stands, the boats, and the Hyde St turntable at its west end |
| pier39 | Pier 39: the gate plaza, the pier, the K-dock and its sea lions |
| pier7 | Pier 7 whole, and the Embarcadero in front of it |
| emb | the Ferry Building, Embarcadero Plaza and the fountain, Market St's end, the Embarcadero to Washington St |

- **Order.** The Mission, Dolores, the Castro and Twin Peaks are in the south. The park is in the middle, with
  Duboce and Hayes Valley to its north-west, and the civic centre and downtown run north of it. North Beach,
  Chinatown and Lombard come next. The waterfront runs along the north and east edges (the Wharf, Pier 39, Pier 7,
  the Embarcadero), with the bay north and east.
- **Two places moved further than the rest:** Calle 24 sits beside 16th St BART (its piece of Mission St runs
  parallel to the Mission tile's, 130 m apart), and Potrero del Sol sits beside Calle 24.
- **Market St is in four pieces:** at the park (Octavia), at UN Plaza, at Powell and at the Ferry Building. They are
  parallel, but not in one line; invented streets join them.
- **Three places are more than 300 m from their nearest neighbour,** each because of its own size: the Castro,
  Dolores Park (285 m wide, its spot on Dolores St, on the far side from the Castro) and Lombard (its spot at the top
  of the crooked block). The bomb tops are further out: Alamo Square about 650 m from Duboce Park, Twin Peaks about
  770 m down the bomb from the Castro.

## 2. Streets, heights and walls

- **Gutter streets.** Between two joined tiles runs one invented street, on one line: halfway between the tiles'
  facing edges, along the foot of a wall (below), or on a line laid by hand (`gutter_opts`). Each is named after a
  removed street that ran there, or the next real one (`gutter_names`; the map labels them in `data/story.json`
  `map.streets`).
  - `squeeze.py` writes each one into the warped raw data as the city would have it: a street, its right of way,
    curbs, sidewalks, curb ramps and lots of SF size facing it. The generator's own stages then add the facades,
    trees, lights, parked cars, markings and traffic.
  - Real streets that reach a tile's edge run on to the gutter street as legs, and meet it at real junctions, so
    cars, markings and parking keep clear of them. Streets up to 45 m wide at the cut carry across a gutter
    (Market St, Polk St).
  - Joins of 44 to 60 m have two streets, one along each tile, with a connector block between them and cross
    streets through it.
- **Slides.** At three joins a real street carries on across the cut instead: McAllister, Grove and Fulton
  (City Hall with UN Plaza), the Embarcadero (the Embarcadero with Pier 7), and Jefferson St into the Embarcadero
  (the Wharf with Pier 39).
- **Height.** Each tile moves up or down as a whole. The park and the four waterfront tiles are at 0, one water
  level; the inland tiles are lower than in the real city to meet them, by up to 26 m (Lombard), and Twin Peaks' top
  stands about 97 m over the park. Every hill keeps its own relief. Inside a tile, the ground is the real city's
  plus the tile's offset, and its ground grid is offset by the tile's move, so its triangles and curbs come out as
  the real city's. Between the tiles the ground is filled in, and each gutter street is graded on it.
- **Walls.** Where a join's sides stand too far apart for a street, the low side's street runs along a retaining
  wall (`city/squeeze_walls.py`): Guerrero St under Dolores Park's side over the Mission, Sanchez St under Church
  St's side over Castro St, and Mason St under North Beach over the Wharf.
  - The street runs a terrace strip out from the wall's foot (`walls[].terrace` in the tile table: 10, 14 and 8 m),
    and the hillside steps up across the strip: terrace houses against the foot with a planted terrace level with
    the high side over them, a second row of houses halfway up a drop of more than 17 m, and a planted deck at the
    wall's top under 5 m.
  - Switchback stairs climb where the high side's streets end at the wall, and every 70 m.
  - Walls and house fronts collide; terraces, roofs and treads are rideable.
  - At Sanchez St's north end the street's side stands higher, so the wall is built the other way round, its
    railing and stairs on the street's side.
- **The bay.** Each waterfront tile's water moves with it and is filled between the tiles, never over a tile's land:
  one shore. Pier 7's deck meets its plaza at the real seawall, the Ferry Building stands whole, and no background
  city stands on the bay.
- **Muni.** The J Church is whole inside the Dolores tile. The F is parked: five streetcars stand on the Market
  pieces and the Embarcadero (`parked_streetcars`). The cable car slots and the Powell turntable are inside their
  tiles, and the Hyde St turntable stands at the Wharf's west end.
- **The freeway.** The Central Freeway's deck east of the park is not moved: it runs out past the map's edge as a
  draw-only strip, with the real buildings beside it.
- **Around the tiles.** Each tile's real surroundings move with it as background massing and ground. The Bay Bridge
  moves with the Ferry Building; downtown's towers outside the map stand where they are, as a far skyline.

## 3. How `./skate city` builds it

From the game's root, `SOMA_SKATEPARK_DIR=<the world generator's checkout> ./skate city` runs two steps in the
generator's checkout, then writes the city's BVH (`$GAME` is the game's root):
```
uv run -q --no-project --with numpy --with shapely --with scipy --with pillow python city/squeeze.py --game $GAME --out-raw $GAME/out/city-squeeze/raw --out-config $GAME/out/city-squeeze/config.json
uv run -q --no-project --with numpy --with shapely --with scipy --with pillow python city/build.py --raw $GAME/out/city-squeeze/raw --config $GAME/out/city-squeeze/config.json --out $GAME/assets/park
```
- `city/squeeze.py` reads the generator's open data in `city/raw` (from `city/fetch.py`), its `city/config.json` and
  the tile table. It writes the warped data and config to `out/city-squeeze`, which is not in git;
  `raw/squeeze.json` there lists the tiles, the joins with their lines, and the walls.
- **The content check.** The warp fails when it cuts a landmark, a mural alley, a Painted Lady, an interior, a spot
  or a vignette that the tile table's `dropped_ok` does not list. It reads the game's `data/vignettes.json`
  (`--game`) in the squeezed frame because `tools/squeeze/migrated.json` is there: keep that file.
- The warp takes about 70 s and the build about 50 s. The command prints the warp's config line and the build's
  `wrote` line, which ends with the city's hash; `assets/park/sf.city.json` has the same `hash`. A step that fails
  stops the command with exit code 1 and its last lines.
- The real city, not squeezed, still builds by hand: `city/build.py` with no `--raw` or `--config`. The game's data
  does not fit it.
- The built city and the park's paint ship as the world bundle: `./skate world pack` writes it to `out/` and names
  it in `assets/park/world.json`, and `./skate world fetch` gets it (README.md).

## 4. The game in the squeezed frame

The game's data, scenarios and tests are in the squeezed frame. They were moved once from the real city's frame,
each point by its tile, with a hand fix where a feature moved or went, and they are edited in place like any other
data. A change to the tile table (a move, an area, a height offset) moves the city under them: move the points in
the changed tiles by hand, then build the city again and run the checks (section 6).

What changed in the game with the squeeze:
- **The F races** are retired with the F (`sf-muni-f-win`, `sf-muni-fcivic-win`, `sf-muni-fdowntown-win`), and the
  two stories that raced the F have new races (`data/missions.json`):
  - Chapter 5, Chad's Move: Chad waits at the park gate on a new skateboard and races you along Duboce, north to the
    Oak St gutter and up to Civic Center Plaza's south edge (366 m), then Gloria's window, 45 s. Losing the race
    fails the chapter.
  - Dolores's Delay: the F is parked for good, so Dolores drives the J Church; the race is the Muni Race on the J,
    from Liberty to 18th Street through Dolores Park.
  - Scenarios `sf-mission-ch5`, `sf-mission-ch5-lost`, `sf-mission-delay`, `sf-mission-delay-lost`. The races'
    five new lines are listed in `tests/missions.test.ts`.
- **The Tour:** level areas round their tiles, and some goals changed (docs/mechanics/tour.md). Chinatown's Sick
  tier is 65,000 and the Wharf's 52,000 (docs/feel-audit.md section 8).
- **Racers keep their tuck in the air** (`game/npc.ts`): below Clayton the Twin Peaks bomb has a crest where a
  racer's board leaves the road for a tick.
- **Pins:** `tests/city-areas.json`, the two-player sf hash and the ghost times (Dolores 11.97 s, Twin Peaks
  103.53 s) are the squeezed city's.
- **Valencia's rider line** (`data/lines.json` `valencia_north`) replaces the city export's, which ran through
  removed blocks.
- `sf-car-cabin-corner` is retired: its car stood in a removed block.
- `scenarios/city-sweep/` (findings in the real city, not run by `./skate check`) stays in the real city's frame,
  as a record.

## 5. Spots outside the 20 places

Real skate spots with obstacles that stood in removed blocks are re-homed into a kept tile (`rehome` in the tile
table). What the game hangs on a dropped spot (gaps, burritos, courier stops) is re-pointed, not lost.

| spot | what | new home |
|---|---|---|
| dock_15th, dock_valencia | loading docks | the Mission, on Valencia St |
| dock_17th | loading dock | the Mission, on 17th St |
| dock_cesar_chavez | loading dock | Calle 24, on 24th St |
| site_soma (SITE FLAT BAR) | building site | beside Potrero del Sol |
| site_mission | building site | Calle 24, in Lilac St |
| site_north_beach (SITE FLAT BAR) | building site | North Beach, at Columbus Ave |
| lowriders_24th | the three lowriders | Calle 24, on 24th St |
| bart_market_4th | Market & 4th BART stairs | downtown, beside the 4th St stairs |
| MUNI HOP | the hop over the J tracks (was at Church & 17th) | Church St north of 18th |
| TURNTABLE RIM | the Hyde & Beach cable car turntable | the Wharf's west end |
| PROMENADE EDGE | the Embarcadero promenade's granite edges | in front of Pier 7 |
| F-LINE RAIL | the F rail gap (was at Market & Van Ness) | UN Plaza's piece of Market St |
| CALIFORNIA SLOT | the cable car slot | POWELL SLOT, by the Powell turntable |
| MISSION DOLORES LEDGE | the curb in front of Mission Dolores | VALENCIA CURB, in front of Fog City Skate Shop |
| vignettes `chinatown-cards`, `valencia-cafe` | the card players, the laptop cafe | Grant Ave, Valencia St |

Dropped, with nothing of their own to skate: Mission Dolores (its courier stop is Clarion Alley now), Guerrero &
18th (Valencia & 17th), Church & 17th, the Sanchez St hill, Balmy Alley, Columbus Ave beyond the square and Grant
Ave above Pine St. Their labels stay in `data/spots.json`. Corona Heights and Buena Vista Park, parks in removed
blocks, have no place banner now.

## 6. Checks

- **Nothing gated:** the route scenarios `scenarios/squeeze-routes/route-<place>.skate` (in `./skate check`;
  `./skate run route-<place>` runs one). In each, the crew van drives from the park gate to the place's nearest
  reachable street point on the driving autopilot.
  - After a new city build, `node tools/squeeze/routes.ts` writes them again. It plans on `tools/squeeze/net.ts`'s
    network: the sim's traffic paths in `assets/park`, densified to 4 m and joined where a path's end meets
    another path (8 m), where two paths cross (2.5 m), and from a street's end to another street within 60 m
    when the straight line is paved all the way. An edge is kept only on paving, with nothing taller than 0.5 m
    within 1.2 m of it (the van's width) and no metre climbing more than 0.45 m.
  - Where a spot stands in a plaza or a park off the street (UN Plaza, Washington Square, Powell, the Embarcadero
    plaza, Duboce Park's lawn, Alamo Square's slope, the 16th St BART plaza), its route ends at the nearest street
    point, up to 100 m away; `routes.ts` prints each distance. Russian Hill's van climbs Lombard's crooked block
    at walking pace, and its arrival radius is 40 m.
  - `tools/squeeze/topdown.ts out.png x0,y0,x1,y1 m-per-px [--traffic] [--reach] [--routes]` draws the sim's world
    from above, with the traffic paths, the route network (red: reached from the park) or the routes.
- **The minimap's route** (`game/escape.ts` `streetWay`): `tests/waypoint.test.ts` wants a route from the park gate
  to every place in the list that ends within 100 m of its spot. Road links (`run.json` `escape.roadLink`) join
  the street networks where the traffic paths stop short at a join (section 7). The robotaxi takes them only when
  no legal way reaches you.
- **The crowd's busy streets:** `tests/crowd.test.ts` wants Valencia St, 16th St and Mission St at least 4 times as
  busy as the residential sidewalks. The margin is thinner than in the real city: Valencia's sidewalks are 1.45 km
  in two pieces (3.65 km in the real city), and over 16 seeds Valencia is 4.24 to 4.91 times (4.97 in the real
  city), 16th St under 4 on one seed.
- After a change to the tile table or the generator: `./skate city`, `node tools/squeeze/routes.ts`,
  `./skate check`, then `./skate check --full` (its city fuzz sweeps the streets).

## 7. Open

World generator:
- The traffic paths stop short at three joins where the road runs on: into downtown (from (744, 482) to
  (732, 503)), west of Pier 39 (from (142, 965) to (157, 952)) and on the Alamo Square tile's cut block (from
  (-252, 508) to (-247, 456)). The city's cars do not drive across them; the minimap's road links bridge them.
- A small median with a 15 cm curb stands in Valencia St's northbound lane at 17th (-48.25, -346.7). The street
  scenarios keep 20 m north of it. The real city has it too.

Game:
- The J's route (`game/muni.ts`: the rails chained, gaps bridged straight) turns 0.6 degrees in one tick where the
  bridge from `rail_-306_-449` meets `rail_-386_-367` (-387, -367). A skitch through it throws the skater ("the
  car turned"), so `sf-muni-skitch` lets go before it.
- Some docs keep the real city's numbers: docs/feel-audit.md (rates measured before the squeeze, apart from the Sick
  tiers) and the level descriptions in docs/mechanics/tour.md (its note at the top lists what changed).
