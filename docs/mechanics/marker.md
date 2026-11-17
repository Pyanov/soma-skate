# Session marker (as in EA's Skate)
Milestone: feel pass (2026-11-09). Code: src/sim/skater/marker.ts, commands `marker set | go | clear`;
view: src/client/sessionmarker.ts (a flat chevron on the ground in the accent colour, pointing the way
it sends you; drawn in play from Thing.marker, left out of headless shots). Numbers: data/physics.json marker.*.

A player trying a spot over and over drops a marker where they stand and goes back to it at once.

Input: Z drops the marker (data/controls.json keyboard markerSet), Backspace goes back to it (markerGo:
deliberate, away from the trick keys, so a slipped finger never teleports you mid-line; Q is the nose
key since the tricks pass, round 2). No pad button is free; both are rebindable on the Controls page. The client sends the commands; replays record them.

Rules:
- `marker set`: on the board on the ground, or on foot, standing anywhere: the marker keeps the
  skater's position, the board's heading, whether it rolled fakie, and its speed (Thing.marker, absent
  until set, so worlds without one hash as before). In the air, grinding or in a bail it is refused.
- `marker go`: the skater is put back on the marker at once, on the board, rolling the way it was
  rolling (fakie stays fakie) at the speed it had, at least marker.minSpeed (3 m/s, a gentle roll) and
  at most limits.maxSpeed (a marker dropped on foot sends you back on the board, rolling 3 m/s). The combo in progress is dropped without a bail (no points, the special
  meter kept): going back mid-air cannot carry a combo into the next try. From a bail too.
- `marker clear` removes it. A new `set` replaces it.
- Refused (event marker {ok: false, why}): in any game but free skate (a timed run, a Tour level,
  courier, combo challenge, hill bomb, S.K.A.T.E., Muni race, Robotaxi Escape, graffiti, the two-player
  games): each is timed, raced or scored, and a teleport would cheat it; during a story mission; while
  driving a vehicle. After a game (its results) it works again. Player 1 only: player 2 has no keys for it.
Events: marker {op: set | go | clear, ok, why?}.
Scenarios: lab-marker-retry, lab-marker-fakie, lab-marker-refused.
