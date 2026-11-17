# NPC skaters
Milestone: M5 (physics phase 6; styles, combos, sessions and reactions phase 12). Code:
src/sim/game/npc.ts; data/npc.json.

Input:        the command `npc spawn [n]` (n: the world's default, 4) and `npc clear`. The client
              sends spawn when a park with NPCs loads; scenarios and replays without it have none.
States:       Things of kind 'npc' with every skater field (pos, vel, fwd, up, state, trick, grind,
              lean, crouch, combo...) plus npc (NpcRun: line, i, act, look...; npc.life for the
              park's skaters). They run the real skater physics (stepSkater) after the player each tick.
Rules:
- Each is born with a style (styles, picked by share: tech 0.4, gnar 0.3, cruiser 0.3) and a skill
  drawn from the style's range (tech 0.65-0.95, gnar 0.45-0.85, cruiser 0.3-0.7). The style sets
  its speed (x 0.95 / 1.2 / 0.85 of speed 5 m/s, +- 15%), how often it tries something
  (trickEvery), what it pops (flipChance, grabChance, grindChance, else an ollie), how long its
  combos run (links), how often it manuals (manualChance, held manualTicks) and flips out of a grind
  (flipOut), and whether it goes for the big stuff (send).
- They ride the park's rider lines (park.lines; data/npc.json parks.<world>.lines) with the same
  autopilot the rider-line check uses (game/follow.ts): pure pursuit to the next waypoint, push up
  to their speed, slow for corners, powerslide or foot-brake when too fast. While crouched for a pop
  they only steer (a push or a brake tap there would read as a foot trick or a manual).
- Combos: every trickEvery seconds on a straight at speed they crouch (chargeTicks) and pop. A trick
  that opens a combo gets links (style.links, e.g. tech 2-4) more: landing with the combo open they
  press up then down into a manual, balance it, and pop out of it into the next link (a flip, a
  grab, or a grind when a rail or ledge is right ahead); off a grind (balanced, ollied off after
  grindTicks) a flip out. A manual they fall into (a brake then a push) is ridden as a link too. A
  grind try that catches a wall is one wallride, no more grind presses that air. Landings, combos
  and bails come from the physics like the player's.
- Skill: a try goes sloppy with chance (1 - skill) x sloppy (0.35): the flip comes lateTicks (40)
  late (and may land in it) or the grind or manual balance lets go for lapseTicks (30).
- Sends (gnar, send 0.7): a respawn picks a send line (data sends) that often, and the run goes for
  it at the send's speed: the Big 3 (gap: crouch so the pop comes at the top of the set, out past it
  to via) and the Hellride (wall: keep 0, so the run starts off the line on the deck by the fence and
  goes straight down the bank head-on at the Otis quarter, about heading 61, at 9 m/s; vert with a
  grab or a flip, back down the quarter). After a send it rolls the landing out until the combo counts.
- Sessions: lines that share a spot (data spots: big3, hellride, manualpad, wave; a line not listed
  is its own spot) take one rider at a time; the claim lasts the rider's run on it (a run ends at
  its line's end, never on another line of the same spot). A respawn picks a free spot freeSpot
  (0.8) of the time; at a busy one (or one somebody is waiting for) it waits at the top (act
  'wait', standing still a step back from the start or beside it, within 0.25 m of the start's
  height and waitGap (1.2 m) from any other waiter) and goes when the spot is clear and nobody has
  waited longer, riding to the start first; after maxWait (6 s) it picks another line.
- Near the player (phase 25): a respawn picks among the lines starting within near.radius (250 m) of
  player 1 near.share (0.85) of the time, when some lines do and some do not: a city's lines spread
  over it, and the locals of a spot should show up when you are there. All near or none near, every
  line, with no draw (so the park's NPCs ride as before). tests/npcnear.test.ts.
- Reactions: when the player lands a combo of cheer.points (2000) or more, each NPC within
  cheer.range (18 m) on the ground or waiting stomps its board (npcCheer; once per cooldown 4 s).
  After a combo of copy.points (1500), with chance copy.chance (0.35) the nearest one riding within
  copy.range (20 m) rides the player's last copy.seconds (5 s) of line after them: it starts where
  the player got moving (placed there, like a respawn), rides it at the player's speeds and pops
  where the player popped with a flip or a grab of its own (no grinds), then rides on as usual. The
  player's line is kept a point every trail.every (10) ticks and at every pop, for trail.seconds (8).
- At a line's end they ride on to another line starting within linkRange (25 m) on another spot,
  free and not queued for, else respawn. They respawn at a random line start (lifted clear of any
  crease) after a bail, when stuck for stuckTicks (2.5 s), when more than lostRange (25 m) from
  their line, or after stepping off.
- Isolation: their random draws come from world.npcRng (seeded from the world seed when the first
  NPC spawns), their raw events stay private, they never touch the player and the player never
  touches them. With or without them the player's game is identical (soma-npcs-player,
  sf-npcs-skitch). Drivers yield to them like to the player.
Numbers:      data/npc.json (per world count and lines, speed, speedJitter, chargeTicks, grabTicks,
              grindTicks, styles, sloppy, lateTicks, lapseTicks, sends, spots, maxWait, freeSpot,
              near, cheer, copy, trail, linkRange, stuckTicks, lostRange, castFrom 3: the height the
              ground is looked for from, under the freeway).
For the view: kind 'npc'; npc.look (0..999, fixed per NPC) picks the character and outfit; pose them
              from the same fields as the player (state, trick, grind, manual, lean, crouch, ...).
              npc.life.style ('tech' | 'gnar' | 'cruiser') and npc.life.skill (0..1) for a look or a
              label; npc.act 'wait': standing at the top of a spot for its turn (board under the
              arm, say); npc.life.copy set while it rides your line after you.
Events:       npcTrick {id, trick, points} (a trick ended), npcGrind {id, trick}, npcLand {id, trick
              (the combo's name), points}, npcBail {id, reason}; npcCombo {id, points, name,
              multiplier} (a park skater landed a combo: the floating number; same tick as its
              npcLand), npcSend {id, kind: 'gap' | 'wall', line} (a gnar one goes off the Big 3 or up
              the Hellride), npcCheer {id} (it stomps its board for your combo), npcCopy {id} (it
              starts riding your line after you).
Cost:         about 0.02 ms per NPC per tick; check --full measures soma and sf with them.
Scenarios:    soma-npcs (30 s: at least 3 landed combos and 3 tricks, nothing reaches the player),
              soma-npcs-player (the Big 3 kickflip identical with NPCs), sf-npcs-skitch (the RNG-driven
              skitch hold identical with NPCs; also Node vs Chromium: soma-npcs), soma-npc-combos (a
              minute of linked combos, 2x to 4x), soma-npc-sessions (four on two spots: two always
              waiting, never two on one, never two waiters on one place), soma-npc-big3 and soma-npc-hellride (gnar sends),
              soma-npc-react (cheer and copy, thresholds lowered), soma-npc-nocheer (700 points:
              nothing). Fuzz spawns them in soma and sf and checks their invariants too.
Feel notes:   (waiting for play)

Racers (phase 8): Hill Bomb rivals are NPC Things too (npc.racer set); see docs/mechanics/modes.md.
They wait frozen at the start line, never respawn (they get up after a bail and ride on) and despawn
when the race ends.
Locals (phase 9): the S.K.A.T.E. local is one too (npc.skate set), stepped by game/skate.ts on its
own stream (world.skateRng); see docs/mechanics/modes.md. The line-following autopilot all of them
share is src/sim/game/follow.ts.
Pedestrians (phase 11) are their own kind ('ped'): docs/mechanics/peds.md.
