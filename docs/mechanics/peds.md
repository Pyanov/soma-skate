# Pedestrians
Milestone: physics phase 11. Code: src/sim/game/peds.ts; data/peds.json.

Input:        the command `ped spawn [n]` (n: data count, 24) and `ped clear`; `ped at x y heading
              [phone]` puts one walker on the sidewalk nearest (x, y), walking the way nearest the
              heading (degrees clockwise from north; phone: one who never looks up), for tests.
              The client sends spawn when a world with pedestrians loads; scenarios and replays
              without it have none. data peds.enabled false turns them off (spawn makes none).
States:       Things of kind 'ped'. pos is the walker's feet on the sidewalk, fwd the way they face,
              vel their walking velocity, up (0, 0, 1), state 'walk', and ped (PedRun): curb (the
              sidewalk line, -1 while out of the world), s and dir (where along it, which way), speed
              (walking, m/s), look (0..999: which person the view draws), side (metres left of their
              line now) and to (where they are stepping; 0 = back on the line), stagger (ticks left
              knocked down after a hard hit), close (their closest pass by you at speed, 99 = none),
              cool (ticks before they count again), phone, act (for the view: walk, aside or down) and
              since (the world tick that act began). A walker with alive false is out of the
              world (no sidewalk near you when it last looked) and is not drawn. Every other Thing
              has no ped field, so worlds without walkers hash exactly as before.
Rules:
- Sidewalks: the city export lists its curbs (curb_* lines, 2,907 of them, 88 km). The first time
  walkers are needed in a park, each curb near them is classified once: the side where the ground a
  little way off is sidewalk (city_sidewalk) at a few points along it; its walk line is the curb moved
  offset (1.3 m) onto that side. Curbs with sidewalk on neither or both sides (medians, lots) are
  skipped. This is a pure function of the park, kept as scratch outside the world.
- They walk their line at walk [1.1, 1.6] m/s and turn back at its end. One more than despawn (130 m)
  from you comes back on a sidewalk between spawnNear (25) and spawnFar (90) m of you, at most three
  a tick (a teleport sends all of them at once).
- Hitting one: they are a cylinder (radius 0.3, height 1.75 above the feet). Faster than hitSpeed (3.5
  m/s across the ground) you bail ('ran into a pedestrian') and they are knocked down for stagger (3 s);
  slower, you swerve off them: pushed out, the speed into them gone and half the rest (swerveKeep).
  On foot you are only pushed out. pedHit {id, speed, bail} either way.
- Stepping aside: one who sees you coming steps out of your way: you faster than see.speed (3.5 m/s),
  closing on them within see.time (1.3 s), passing within see.clear (1.2 m), and inside their view
  (see.fov 240 degrees, so not from right behind). They move see.aside (1.1 m) away from your path at
  see.stepSpeed (1.8 m/s), at most see.maxSide off their line, and step back once you are by. A
  quarter of them (phone) are on their phone and never look up. pedStep {id, side}.
- NEAR MISS: passing within nearMiss.distance (1.2 m) at nearMiss.speed (4 m/s) or more without
  touching (or above their head) is a NEAR MISS, nearMiss.points (250) into the combo like a gap (it
  banks on its own if nothing else is open; repeats in one combo lose value like any trick). Then that
  walker is out of play for cooldown (2 s). nearMiss {id, points, distance}.
- Their random draws (where they spawn, which way, how fast, phone) are their own stream
  (world.pedRng), so the player's draws are the same with or without them.
Numbers:      data/peds.json.
Events:       pedHit {id, speed, bail}, nearMiss {id, points, distance}, pedStep {id, side}.
Perf:         24 walkers add about 0.003 ms to the race tick at p50 (Dolores race p99 0.08 ms, best of
              3 per tick, budget 0.3; the city 0.12 ms raw, budget 0.5). `skate perf --race` and
              `skate perf --park sf` run with them; --no-peds runs without.
- The same walker pays a NEAR MISS once in nearMiss.again (15 s; physics phase 17): passing one
  walker again and again, every few seconds, was a farm. PedRun.missed (absent until their first).
Scenarios:    sf-ped-near-miss-repeat (four passes of one walker 4 s apart: one NEAR MISS),
              sf-ped-near-miss-again (the same with again at 3 s: four), sf-ped-step-aside (head-on:
              they step aside, you pass 1.1 m off: NEAR MISS), sf-ped-hit (from behind at 6 m/s:
              unseen, a bail), sf-ped-near-miss (overtaking 0.8 m to their side: NEAR MISS), sf-ped-bump (1.9 m/s: a swerve, no bail), sf-ped-spawn (24 around you, back
              around you after a teleport), sf-ped-off (enabled false). Scenario paths peds.alive,
              peds.near (within 100 m of the skater), peds.aside count them.
Feel notes:   (waiting for play)
