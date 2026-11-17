# City sweep findings (for the city generator)

`./skate cityfuzz` drops random-input bots on the sf world's street-level
ground (road, sidewalk, alley, park, path, median, green, spot, playground, lot), 20 m apart, area
by area (118 areas of 200 m), for 10 s each, and watches for: falling out of the world, landing on
the catch floor, being under the street (street-level ground above the skater's centre), being
trapped (not moving while pushing, and none of a player's ways out works: pivot either way and
push, brake, ollie, step off and walk), grinds captured through a wall, NaNs, the skater inside
geometry, and air/land flicker. 16 seeds x 3,000 drops (58 million ticks) plus targeted runs.

Sim fixes made here: a grind no longer captures a line through something solid between the skater
and the line (a curb on the far side of a parked car); the flicker check counts only hops of 4
ticks or less (rolling down stairs is one longer drop a step). Never seen in the sweep: NaNs,
falls out of the world (after keeping start points off the world's edge), the catch floor,
invisible walls (the boundary wall never stands over street ground on both sides), grind lines
without ground (the park build already drops the 282 of 59,956 with no floor below).

What is left is in the export. Each item has a scenario that replays it from a fresh world
(`./skate run scenarios/city-sweep/<name>.skate`; the end position is the problem) and a rule in
src/harness/cityfuzz-known.json that keeps `check --full` green until it is fixed (remove the rule
with the fix, and the check guards it from then on).

## 1. Parked cars 0.25 m off the curb (everywhere)
Parked car bodies stand about 0.25 m from the curb face (and from medians' curbs). The skater's
sphere is 0.24 m across, so the gap is a slot it drops into from the sidewalk or rolls into from
the road, and then jams between car and curb: stuck (no way out but luck), squeezed 3.6 cm into
both, or flickering air/land as the two walls push it up.
- 180.9, 177.5 (z -1.9): trapped, stepped off the sidewalk into the slot. car-curb-trapped.
- -783.6, -1336.0 (z 66.2): 3.6 cm inside car and curb at speed. car-curb-inside.
- Also seen: -757.0, -810.0; -1000.7, 400.8; -160.0, 337.7; -119.9, -587.2; 323.9, 65.9;
  -357.7, -1466.7 (a car beside a median's curb, flicker).
Fix: park cars flush with the curb (gap under 0.05 m) or at least 0.6 m off it.

## 2. Slivers between buildings, and building notches, at the back of lots
Gaps between neighbouring buildings (and notches in a footprint) narrower than a skater, where a
lot runs up to them: pushed in, the skater is squeezed 3.6 cm into the walls, or wedged in a
notch it gets out of only by pivoting a long way round.
- -459.9, 752.8 (z 12.4): building-sliver-1.
- -1819.0, -1417.4 (z 100.4), Upper Market: building-sliver-2.
- -835.3, 309.4 (z 44.5), Lower Haight: building-sliver-3.
- Also seen: -938.8, 646.1 (a 0.2 m slot); 234.3, -1112.4; -333.1, -1005.5 and -332.9, 349.4
  (0.3 m notches).
Fix: merge buildings closer than about 0.5 m (or fill the gap), and drop footprint notches
narrower than that.

## 3. Ground layers overlapping (a surface over the skater)
Two street-level surfaces overlap at different heights, so the skater rolls on the lower one
under the edge of the upper (and the view shows it inside the ground).
- -1906, -1420 (z 106), Upper Market below Grand View: a steep lot (53 degrees) reaching up to
  0.9 m over the sidewalk at its foot, along about 10 m. twin-peaks-lot. The worst one, and near
  the Twin Peaks bomb.
- -499, 365 (z 38.6), Duboce Park: the park edge 0.14 m over the sidewalk. duboce-park-edge.
- -747.9, -661.4 (z 19.9): two sidewalk layers 0.12 m apart. double-sidewalk.
- -1124.3, -87.2 (z 43.2): a sidewalk 0.13 m over a lot edge. lot-over-sidewalk-1.
- -1195.7, -741.9 (z 35.5): a lot 0.14 m over the sidewalk. lot-over-sidewalk-2.
- -1125.3, 566.6 (z 66.3), Alamo Square: a lot 0.13 m over the ground beside it. alamo-lot.
- -1648.5, -1021.3 and -1622.5, -1004.0 (z 48-51), Upper Market near 18th: sidewalks 0.12-0.16
  m over the surface beside them. upper-market-sidewalk.
- -569.5, -1221.9 (z 30.0), by Dolores Park: a sidewalk 0.19 m over the park. dolores-sidewalk.
- -590.7, 8.9 (z 28.0): a lot 0.14 m over the ground beside it. lot-overlap.
Fix: clip each surface against its neighbours (one layer per point), or join them with a curb or a
slope where heights differ.

## Fixed in the city generator
- 1. Parked cars stand 0.62 m off the curb (city/config.json cars.curb_gap) all along the car and as
  far from any other curb (a corner, a driveway cut, a median's nose): a slot two and a half skaters
  wide that it rides through and out of. Flush with the curb was tried first and blocked every curb
  grind beside a parked car (the Mission Ledge goal among them). Cars are now seeded per curb run
  (corner to corner), so a change elsewhere on a ring (the region's edge) no longer moves them.
- 2. Building footprints are closed (notches narrower than 0.5 m filled where no neighbour stands
  in them) and the gaps under 0.5 m between neighbours join one of them (buildings.min_gap; 249
  notches and about 5,000 gaps in sf).
- 3. Block ground (lots, parks, paths) eases from the sidewalk's height at its outline into the DEM
  by the exact distance to the outline, not a 1 m raster, so it meets the sidewalk at the same height
  everywhere (the Twin Peaks lot is a slope now, not a 0.9 m lip).
- Also: road strips narrower than a skater between a curb and the region's boundary wall are raised
  (seven in sf; one wedged the skater at -587, 419).
- Rules removed from src/harness/cityfuzz-known.json: car-curb-slot, building-sliver and all the
  underground ones. The scenarios above replay random inputs from where the problems were; on the
  new ground they no longer end in them (upper-market-sidewalk now starts a few centimetres under the
  raised lot and falls through, an artefact of its teleport height).
- Sweep after the fixes: 24 seeds x 3,000 drops (86 million ticks). Two findings left, both rare:
  steep-lot-corner (a 58-degree lot below Upper Market slides the skater into a building's outside
  corner, where it stays wedged; once in 72,000 drops) and car-cabin-corner (squeezed 4.5 cm into a
  parked car's cabin corner from its hood; once). Each has a rule and a scenario here.
- car-cabin-corner is fixed in the sim: it was a noseslide along the hood
  edge to its end, where the line meets the cabin, and leaving a grind put the skater at the line's
  end without pushing it out of what is there. Leaving a grind now resolves the sphere against the
  park first. Its rule is out of src/harness/cityfuzz-known.json and the scenario is
  scenarios/sf-car-cabin-corner.skate, which check ran until the squeeze removed its block (docs/squeeze.md
  section 4).
- steep-lot-corner fixed in the export (lots ease to the DEM under about 40 degrees,
  the DEM they ease to holds its slope under 0.8); its rule is gone too.
- steep-lot-corner is fixed in the sim as well: on the ground, stopped for half a
  second on a slope steeper than safe ground (ground.safeNormalZ, 0.8, about 37 degrees, the same
  line as the safe spot) is wedged, and the skater goes back to its last safe spot, stood up, like
  the air wedge rule. Its rule is out of src/harness/cityfuzz-known.json (now empty) and the scenario
  is scenarios/sf-steep-lot-corner.skate. Swept again around it (4,000 drops on two seeds): the two
  other corner traps on those lots (44 and 52 degrees) are gone too.
- New for the city generator: twin-peaks-lot-void. West of those lots the ground ends along a diagonal
  edge, about (-1990, -1350) to (-1955, -1385), with no boundary wall and nothing below; rolling off
  it falls out of the world (three of 4,000 drops near the lots, before this change as well; the check's 1,200
  city-wide drops do not reach it). Scenario scenarios/city-sweep/twin-peaks-lot-void.skate.
- twin-peaks-lot-void fixed in the export. The boundary wall stood on the street grade
  (3 m under to 8 m over it), and beside a hillside lot that climbs 8 m in 10 its foot or top missed
  the ground in places, so a skater could roll under it or fly over. It now spans the ground really
  beside it: from 6 m under the lowest surface at the wall to 8 m over the highest, and 7 m over any
  lot within 12 m. tests/boundary.test.ts checks every wall piece in sf against the ground beside
  it (foot 1 m under, top 4 m over anything within 6 m), and scenarios/sf-twin-peaks-lot-edge.skate
  replays the sweep's drop there.

## Second feel round (2026-11-09): one more building sliver
The park-speed carve (docs/mechanics/board.md) sends the sweep's random keys on other courses, and one
reached a sliver: two faces of city_building_-800_200 by Duboce Park (triangles 475848 and 475824, about
-673, 337.5) cross 3 to 5 cm apart facing away from each other, over a lot sloping into them, so a
sphere between them cannot be pushed out of both (3.6 cm inside). Scenario
scenarios/city-sweep/building-sliver-4.skate; rule building-sliver-4 in src/harness/cityfuzz-known.json
until the export closes it.
