# The test hill (downhill bombing)
Milestone: physics, after M6. Geometry: src/sim/park/lab.ts `HILL` / `streetHill`; physics: board.md.

Goal: bomb San Francisco hills (the city around the park, the Dolores Park hill bomb included).
The lab gets a street to tune that on before the real streets exist.

Geometry (east of the lab, never touching it; the lab's own triangles keep their order):
- 256 m of street, arc length s from the top: flat start (0-12 m), 10% for 110 m, a crosswalk flat
  at 2% (127-139 m), 12% for 58 m bending 35 degrees left (s 152-188, radius 59 m), 8% for 30 m,
  then a flat runout that tips up 6% into an end wall. Total drop 21 m; the runout is at z = 0.
- Every change of grade is a rounded vertical curve (grade linear over 1.5-3 m): crest radius 30 m
  into the 10% and out of the crosswalk (the second crest throws you into the air above about
  17 m/s, like a Dolores intersection), sag radius about 25 m.
- 12 m crowned asphalt (1.5% to the gutters), 17 cm curbs with a 20 cm top (collection
  'obstacles', type curb, so both are 255 m grind lines), 2.8 m sidewalks rising 2% to building
  walls 4 m tall (collection 'walls': wallrides), end walls top and bottom, a catch floor 1.5 m
  under everything (it also keeps the curb lines, which need 'ground' below them).
- Spots: lab_hill_top (s 5), lab_hill_ten (s 40), lab_hill_crosswalk (s 131), lab_hill_twelve
  (s 146), lab_hill_bottom (s 238, facing up). Rider line lab_hill_bomb (s 5-236, every 4 m).

How it rides (the numbers the scenarios pin):
- The street is asphalt (element type road: Crr 0.018) and the sidewalks concrete (0.014).
- Terminal speed on the 10%: 15.4 m/s (55 km/h) standing, 18.9 m/s (68 km/h) crouched
  (lab-hill-terminal, wobble off to read drag alone). The hill is shorter than it takes to get
  there from a standstill.
- From the top, push 2 s and tuck: 13.6 m/s at the bottom of the 10%, 14.3 m/s (51 km/h) on the 12%
  before the bend (lab-hill-bomb-tuck). The autopilot, tucking, steering and scrubbing above
  16 m/s, rides the whole line in 19 s with a top speed of 15.8 m/s (skate lines --park lab).
- Standing tall above wobble.speed (12 m/s), or crouched above wobble.tuckSpeed (17 m/s), the board
  starts to wobble: standing at 14.5 m/s on the
  10% it throws you off after 2.2 s (lab-hill-wobble); tucked at that speed it does not
  (lab-hill-wobble-tuck).
  Standing from the top, the wobble starts near the bottom of the 10% and throws you on the 12%.
- Carving: full-lean S-turns at 14 m/s on the 10% scrub about what the slope gives (+0.4 m/s in
  3.3 s) and keep the wobble small (lab-hill-carve).
- Powerslide: 15 -> 10 m/s in a second on the 10%; let go and the board swings back in line within
  8 degrees of the old line (lab-hill-powerslide).
- The bend: at 15-16 m/s it needs about half lean. Holding the key carves past the grip (45 degrees
  for the 35 degree bend, scrubbing), so on a keyboard the bend is tapped. At this speed the lean
  follows the keys as a lag (board.leanAtSpeed), so regular taps give a steady lean: 9 ticks of
  every 30 hold about 0.6 and ride the bend 2 m outside the centreline (lab-hill-bend-taps); with
  the snappy park rates the same taps averaged 0.07 lean and ran wide into the outer curb. 6 of 30
  is too little (runs wide), 12 of 30 a little more than the bend (ends 0.8 m inside).
- Crosswalk crest: no air at 15 m/s; a tucked rider who arrives faster gets a little.

Scenarios: lab-hill-terminal, lab-hill-bomb-tuck, lab-hill-wobble, lab-hill-wobble-tuck,
lab-hill-carve, lab-hill-powerslide, lab-hill-no-hops, lab-hill-bend-taps; rider line lab_hill_bomb.
Feel notes: (none yet).
