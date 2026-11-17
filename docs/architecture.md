# SoMa Skate: architecture and working method

A skateboarding game set in SoMa West Skatepark, with THPS-style mechanics: ollies, flips, grabs, grinds, slides, manuals, lip tricks, reverts, wallrides, combos and scoring. The park geometry comes from the world generator, a separate repo (`SOMA_SKATEPARK_DIR`, not public yet; docs/roadmap.md). Graphics stay light (greybox) until the game plays well; the reskin comes later.

The whole project follows Kyle Kukshtel's article "Your Game Is A Harness" (kylekukshtel.com/ai-harness-engineering-game-development-claude-code). The article's point is that a game is opaque to an AI agent unless it is built to be read. Its fixes are a seeded RNG, saveable state, one Thing type, commands, external data, a standalone simulation, layer-toggled screenshots with image diffs, and text profiling. With those in place, the agent can check every change in seconds. This document says how each of those applies here.

## 1. The article, applied

| Article principle | What it becomes in this game |
|---|---|
| Decide determinism before writing code | Fixed 120 Hz simulation step, one seeded RNG inside the world state, and a lint and typecheck ban on clocks and `Math.random` in the sim. Every tick produces a state hash. |
| Reproduce any moment | Save and load an exact snapshot from day one: in the game (F5/F9), in the CLI and in tests. |
| Screenshots with layer toggles, cropped | Headless Chromium renders any snapshot with chosen layers (park, skater, HUD, debug overlays), a chosen camera and a crop around the region of interest. |
| odiff similarity score | `skate diff` returns a similarity percentage and a diff image. It is used for renderer and animation-pose checks against golden images. |
| Inner loop: small change, quick check, boring base | `skate check` runs in under 20 s, and every change runs it. Strict TypeScript, few dependencies, one file per skater state. |
| Everything is a Thing | One flat `Thing` record with a `kind` field covers the skater, the session/combo manager, gaps, goals, collectibles and moving props. The world is a list of Things, so there is one save path and one load path. |
| Command pattern, puppet-able game | Every change to the world is a serializable command: per-tick player input, plus dev commands such as `teleport`, `set`, `load` and `setData`. A single processor applies them. Replays are a start snapshot plus a command stream. Agents and tests send the same commands. |
| No compile for changes | Tuning and trick tables live in `data/*.json`, hot-reloaded into the running game, with an in-game tuning panel. The harness runs TypeScript directly in Node 25, with no build step. Commands go to the live game over a websocket. |
| Data outside code | Physics constants, the trick table, scoring, controls and the park itself are data. A data change during play is recorded as a `setData` command, so replays stay exact. |
| Blackbox simulation | `src/sim` is pure TypeScript with no DOM and no three.js, and it is the source of truth. The renderer only draws state and plays events. The sim runs in Node for tests and the CLI, and in the browser for play. |
| Fixed scenarios for impact assessment | Scenario tests (a snapshot plus input plus expected numbers), golden replays, park-wide fuzzing and rider-line tests through the real park. |
| Text profiling (samply) | `skate perf` prints ms per tick (p50/p99) and the top functions as text, from `node --cpu-prof`; samply is available for native-level captures. |
| Context engineering | A short CLAUDE.md, one spec file per mechanic, and harness output that fits on one screen: a failure prints the first divergent tick, not a log dump. Decisions go in `docs/decisions.md`, so the context never has to re-derive them. |

The article's postscript says this setup pays off on larger projects. A full THPS trick system on a 53-obstacle park is one.

## 2. Stack

- **TypeScript everywhere.** The sim, renderer, harness and tests share one language. Node 25 runs `.ts` files directly (type stripping), so the harness and tests have no build step. That means erasable syntax only: no `enum` and no `namespace`; we use `as const` objects instead.
- **three.js** for the greybox renderer, served by **Vite** at http://127.0.0.1:5410. Players open the page in their browser; automated checks use headless Chromium only.
- **Vitest** for tests, **playwright-core** with the already-installed headless Chromium for screenshots, **odiff** (`odiff-bin`) for image diffs, and **zod** to validate data files.
- **Custom physics, not a rigid-body engine.** THPS skating is a kinematic state machine (rolling, air, grind, manual, lip, wallride, bail) built on collision queries. A rigid-body engine would fight it. The only physics service we need is sphere and capsule sweeps against a static triangle mesh. That is a small, deterministic module behind a bounding-volume hierarchy (BVH) that we own and test. Rapier (with its deterministic build) is the fallback if collision robustness turns into a time sink.

Rejected: Unity, Godot and Bevy. They mean an engine editor the agent cannot see, slower edit-run loops, and screenshots that need a GPU window. The browser stack gives headless runs, the same V8 engine in Node and Chrome (which helps cross-runtime determinism), and the lightest loop we can get.

## 3. Repository layout

```
soma-skate/
  CLAUDE.md               contributor and AI-assistant rules (short)
  docs/
    architecture.md       this file
    mechanics.md          THPS mechanic catalog and per-mechanic spec template
    mechanics/*.md        one spec per mechanic, written before it is built
    decisions.md          dated decisions, newest first
  src/
    sim/                  blackbox simulation; own tsconfig with no DOM lib
      world.ts thing.ts rng.ts commands.ts step.ts snapshot.ts hash.ts
      data.ts             typed access to loaded data
      park/               park loading, BVH, sweeps, surface tags, rails, lips, walls
      skater/             one file per state: ground.ts air.ts grind.ts manual.ts lip.ts wall.ts bail.ts
      tricks/             trick input parser, trick queue, landing checks
      score/              combo, multiplier, special meter, gaps
    client/               three.js renderer, input, audio, HUD, dev panel, live bridge
    harness/              the `skate` CLI (runs in Node, imports src/sim)
  data/
    physics.json tricks.json scoring.json controls.json
    schema/               zod schemas
  assets/park/
    soma.park.json        exported by the world generator (collision mesh, tags, rails)
    *.bvh.bin             the sim's BVH pre-built by ./skate park / city / bvh (src/data/bvhfile.ts); check compares it with the builder
    lab.park.json         small procedural test park (never changes)
  scenarios/              named snapshots, input scripts and expectations
  replays/                promoted golden replays (clips from play)
  inbox/                  new F8 clips from play sessions
  goldens/                golden screenshots
  out/                    gitignored outputs (renders, traces, profiles)
```

The sim boundary has two enforcements. First, `src/sim/tsconfig.json` has no DOM lib, so any DOM access fails the typecheck. Second, a lint rule rejects imports into `src/sim` from `three`, `src/client` or `src/harness`.

## 4. The simulation

### 4.1 API

```ts
createWorld(park, data, seed): World
step(world, input: InputFrame): StepResult        // advances one tick; returns events
apply(world, cmd: Command): CommandResult         // dev commands between ticks
save(world): Snapshot   load(snapshot): World     // exact, JSON
hash(world): string                               // stable hash of the full state
```

`StepResult` holds the events from that tick, such as `pop`, `land`, `trickStart`, `trickLanded`, `grindStart`, `grindEnd`, `bail`, `comboBanked` and `gapHit`. The client uses them for sound, HUD and animation cues. It never changes state.

### 4.2 World and Thing

```ts
type World = { version: number; tick: number; rng: RngState; dataHash: string; parkHash: string; things: Thing[] }

type Thing = {
  id: number; kind: ThingKind; alive: boolean
  pos: Vec3; vel: Vec3; rot: Quat; angVel: Vec3
  state: SkaterState; stateTime: number          // skater fields, unused by other kinds
  board: { rot: Quat; flip: number }            // board orientation separate from body
  crouch: number; switchStance: boolean
  railId: number; railT: number; balance: number; balanceVel: number
  trick: TrickRun | null; combo: ComboState | null; special: number
  score: number; timeLeft: number                // session fields
  triggerId: number; collected: boolean          // gaps, goals, letters
  // new fields are added here, never as subclasses
}
```

There is one Thing type, as the article suggests. Kinds are `skater`, `session` (the article's GameManager Thing: run timer, score, goals), `gap`, `goal`, `collectible` and `prop`. Static park geometry is not a Thing; it is loaded data referenced by id. Fields a kind does not use stay at defaults. With a handful of Things the memory cost does not matter, and the gain is one place for every change and a trivial save/load.

### 4.3 Determinism rules

1. Fixed timestep of 120 Hz. The renderer interpolates between the last two states.
2. One RNG (sfc32), and its state lives in `world.rng`. The sim uses randomness for the grind and manual balance wobble, bail tumbles, and variations. Every call goes through `world.rng`.
3. No `Math.random`, `Date`, `performance.now`, timers or async code in `src/sim`. Lint enforces this, and a test greps for it.
4. Inputs are quantized: buttons are a bitmask, and stick axes are int8. The sim never sees raw floats from the gamepad.
5. All math goes through `src/sim/math.ts`. Its trig is our own (fdlibm kernels in plain arithmetic), because Node's and Chromium's Math.sin/cos/atan2/exp differ in the last bit; the sim lint rejects those Math functions elsewhere.
6. Every tick produces a state hash. Replays store a hash every 30 ticks. A browser-recorded replay re-run in Node must match tick for tick, and a test enforces it.

### 4.4 Commands

There are two families, and one processor applies both.

- **InputFrame:** what the controller says this tick (buttons and stick): `{ b, b2? }`, player 1's buttons and, while someone plays player 2 (local two-player, docs/mechanics/modes.md), player 2's. Recording a session means recording these frames. Streams are run-length encoded, because most ticks repeat the previous frame.
- **Dev commands:** `teleport <spot|x y z> [heading]` (x y z below the top of a body, a parked car or a planter, seen as an up-facing surface straight above within 4 m: on top of it, never inside), `set <thing.field> <value>`, `speed <m/s>`, `state <name>`, `load <snapshot>`, `setData <path> <value>` (in an array a path segment can be an id: `missions.missions.tourist.steps.1.to`; a new id appends), `seed <n>`, `spawn <kind> ...`, `pause` and `step <n>`; `player2 join [spot | x y z [heading]] | leave | teleport ... | speed <m/s>` for local two-player; `van summon [x y [heading]]`, `vehicle spawn | enter | exit | clear` and `actor spawn | clear` for driving and the story's characters on the move (docs/mechanics/driving.md); `marker set | go | clear` for the session marker (docs/mechanics/marker.md). These are what scripts, tests and the live bridge use to puppet the game.

Input scripts are plain text that anyone (a player, a contributor, an AI assistant, a test) can write without compiling:

```
load scenarios/big3-runup.snap.json
hold up 0..90          # push for 0.75 s
hold ollie 90..110     # crouch, then release at 110 = pop
tap flip+left 118      # kickflip
tap grind 120..200 every 4   # a press every 4 ticks (farm and mashing scenarios)
expect land within 140..200
expect trick kickflip landed
expect no bail
```

Player 2 (local two-player): `cmd <t> player2 join [spot | x y z [heading]]` brings it in; `p2 hold`, `p2 tap` and `p2 bot balance | line | horse` drive it the same way as player 1; `bot horse [tricks] [sketchy]` (and `p2 bot horse`) plays that player's HORSE turns like `bot skate`; paths `skater2.*` and `session2.*` read its skater and session (NaN while it is out) and `players` is 2 while it is in.

`bot path x,y x,y ... [from t] [speed v] [nobrake] [nocars]` drives the same autopilot along any points (nocars: without holding back for cars).

Bots drive part of a script: `bot balance` presses A/D against the grind and manual balance; `bot line <rider line id> [from tick] [nobrake]` hands the keys to the rider-line autopilot (src/harness/lines.ts pilotKeys, the one `skate lines` uses) until the line ends, on top of any scripted presses (nobrake: without its foot brake and powerslides; a script may have several, each taking over from its tick, fresh: teleport to the line first); `bot skate [trick,trick,...] [sketchy]` plays your S.K.A.T.E. turns with the locals' trick autopilot (matches the trick, sets from the list then data run.skate.sets, never one already set; sketchy: lands every try crooked); `bot drive x,y x,y ... [from t] [speed v] [corner v] [lane m] [stop]` drives whoever is in a vehicle along the points (src/harness/drivebot.ts, docs/mechanics/driving.md). Paths `van.*`, `van.gap` read the vehicle the skater drives (else the nearest), `actor.*`, `actor.gap` the nearest actor (the story's characters on the move). Expectation paths `npcs.onlane`, `npcs.watching`, `npcs.riding`, `npcs.waiting`, `npcs.crowded`, `npcs.stacked` count the park's NPC skaters (on the S.K.A.T.E. lane, watching a game, riding, waiting their turn at a spot; spots with two or more riding them; pairs of waiters under 1 m apart), `peds.alive`, `peds.near`, `peds.aside` the pedestrians (docs/mechanics/peds.md), `session.level`, `session.levelGoals.length`, `session.tape` a Tour level run (docs/mechanics/tour.md), and `no event name{field=value}` filters like `event` does.

### 4.5 Snapshots, replays and clips

- A **snapshot** is the full World as JSON: Things, RNG state, tick, data hash and park hash. Named snapshots in `scenarios/` are the starting points for tests ("approaching the Hellride at 8 m/s", "on the Big 3 ledge mid-grind").
- A **replay** is a start snapshot plus an input stream plus a hash chain. `skate replay --verify` reports the first divergent tick and which fields differ. Format `soma-replay/1`; a recording with player 2's buttons in it is `soma-replay/2`, which adds `input2` (player 2's buttons, run-length encoded the same way, as many ticks). A recording without them is still written as `soma-replay/1`, field for field, and both load.
- A **clip** is a replay of the last 20 seconds of play, saved by pressing F8 in the game, with a typed note and a screenshot. Clips land in `inbox/`. This is how a playtest reports "that felt wrong", the same way comments are pinned in the park viewer.
- In-game F5/F9 quick-save and quick-load, using the same snapshot path. It doubles as a practice feature.

### 4.6 Data

- `physics.json`: gravity, push force, max push speed, friction, pop range, crouch charge time, spin rates, landing tolerances, snap distances, grind capture radius, and balance constants.
- `tricks.json`: one entry per trick, with id, name, category, input (button plus direction or sequence), points, duration, whether it can be held, and allowed states.
- `scoring.json`: repeat penalties, multiplier rules, special meter fill and drain, and gap bonuses.
- `controls.json`: gamepad and keyboard bindings and input buffer windows.

Every file is validated with zod when it loads. In dev, Vite watches `data/`, and the running game applies a change without reloading by issuing a `setData` command, so replays stay exact. The in-game tuning panel (backquote key) writes values back to the JSON files through the dev server. Each replay stores the data hash it was recorded with. A replay recorded under different data is flagged rather than silently re-run.

### 4.7 The park

**Export.** A script in the world generator, `scripts/export_game_park.py`, calls the existing pure-Python geometry layer (`blender/geom/scene.py` `collect(site, validate=False, detail=False)`; no Blender needed) and writes `assets/park/soma.park.json` with:

- **Triangles** grouped by element (`F10_body_3`, `C04`, `ground`, ...), each tagged with a surface class derived from obstacle type and face normal: `floor`, `bank`, `transition`, `vert`, `stair`, `ledgeTop`, `wall`, `noCollide`.
- **Rails:** polylines with a type (`coping` COP pipe, `angle` AI5 angle iron, `flatbar` FSB, `rail`, `ledgeEdge`) and the element they belong to. The sources are the steel edge meshes and rail bodies already in the geometry code, plus convex top edges of ledges and banks above an angle and length threshold. They are connected into a graph so kinks and corners carry a grind through.
- **Lips:** the top edges of quarterpipes and the Hellride, with the outward horizontal normal. They drive vert air and lip tricks.
- **Spots:** the 22 rider-line starts from the skatepark project, plus aliases in the park's local names in `data/spots.json` (`hellride`, `big3`, `big3_runway`, `wave`, ...). Gaps come later.
- **Boundary:** the reconstruction is built for looks and is not watertight (fence ends, slab edges, the open Otis end). The export adds what THPS levels have: an invisible wall along the operational fence polygon and a catch floor at the base grade. The fuzzer found these gaps on its first run.

The collision mesh is the simple version, without bevels or texture detail. `skate park` re-runs the export and prints what changed (triangles, rails, lips, spots). When the park model improves (for example after pinned comments), the game picks it up with one command, and the diff shows the effect.

**The city (world `sf`).** San Francisco around the park, from the Dolores Hill Bomb (Dolores St from 20th down past Dolores Park) to Market St, Valencia, 16th, Mission and the streets around the park, about 1.4 km x 1.9 km, plus corridors and areas: Upper Market to Twin Peaks, Castro St, Alamo Square and the Painted Ladies, Hayes St, Octavia Blvd and Patricia's Green, Steiner St, Duboce Park, Balmy Alley and 24th St, Civic Center, Market St down to the Ferry Building, EMB and Pier 7 (the first spot rebuilt from photos and an orthophoto), the Embarcadero north to Pier 39 and Fisherman's Wharf, Powell St at the cable car turntable, and Russian Hill (Lombard's crooked block, Hyde St down to the Wharf), North Beach (Columbus Ave, Washington Square) and Chinatown (Grant Ave from the Dragon Gate). The world generator's `city/build.py` (pure Python, open data: USGS 3DEP elevation, DataSF right of way, curbs, curb ramps, building footprints, street trees, OpenStreetMap; sources in `city/sources.json` there) writes `assets/park/sf.city.json/.bin` in the same soma-park/1 format plus `sf.city.look.bin` (per-vertex facade data for the renderer); `skate city` re-runs it (the squeezed city: `city/squeeze.py` warps the open data by the tile table, then `city/build.py` builds on it; docs/squeeze.md). The manifest's long numeric lists (grind lines, traffic, trees, cars, lights) are in `sf.city.data.bin`, decoded by `src/sim/park/source.ts`. `src/sim/park/source.ts` composes the world: `sf` = the park (`soma`, minus its gates, invisible boundary wall and its own context streets and buildings) + the city; `soma` stays the park alone, unchanged, for fast tests. City elements carry `role` = `ground` (rideable, classified by slope), `wall` or `visual`; curbs come as grind lines of kind `curb` (ledges). The city meets the park on the park model's own surveyed curbs and slab plane, so the gates have no step; the boundary moves to the city edge. `?park=sf` in the client, `--park sf` in the harness.

**Lab park.** `lab.park.json` is generated in code: a flat floor, a 1.2 m and a 3 m quarterpipe, a bank, a ledge, a flat rail, a down rail, a manual pad, a 3-stair and a wall, plus (east of it, appended so the rest keeps its triangle order) a 256 m San Francisco test street for downhill bombing (docs/mechanics/hill.md). Mechanic tests run on the lab first, because it never changes and gives the stable base the article asks for. They run on SoMa second.

### 4.8 Skater physics

The skater has a board contact sphere (radius about 0.25 m, for sweeps against the mesh), a body capsule (for wall hits) and a board orientation separate from the body. Collision uses continuous sphere sweeps against a BVH over the park triangles, so nothing tunnels through at high speed. The step uses substeps when speed requires them.

States and the core rule in each:

- **GROUND (rolling):** velocity lies in the surface plane. Each tick a probe along the surface normal finds the surface ahead. If it is within snap distance and the angle change is within limit, the skater sticks and the velocity is re-projected onto the new plane, so banks, transitions and the wave carry speed. Otherwise the skater leaves the ground. The board itself (lean steering, grip and slip, normal load, rolling resistance, air drag, pumping, foot brake, powerslide, speed wobble) is docs/mechanics/board.md. Fakie and switch are flags.
- **Leaving a lip (vert):** going off a `lip` with a near-vertical surface triggers the THPS vert rule. The velocity component along the lip's outward horizontal normal is removed, so the skater goes straight up and comes back down onto the ramp. Speed along the coping is kept, and spins rotate around world up. A spine transfer (later) keeps that component instead.
- **AIR:** gravity (tuned for THPS feel, not real feel), a little air steering, and spins with ramp-up and carry-over. Flip and grab tricks run here with their own durations. A late ollie window lets the skater pop shortly after leaving a ledge.
- **Ollie:** hold to crouch and charge, release to pop. The impulse mixes the surface normal with world up, and charge time sets the height between the minimum and maximum pop. Nollie and fakie ollie are variants.
- **Landing:** when a sweep hits a rideable surface in AIR, the sim compares the board heading with the velocity across the surface. Within tolerance it lands forward. Near 180° it lands fakie, which toggles switch. Anything else bails. An unfinished flip or a grab held too late also bails. Landing tolerance is generous and tunable, as in THPS.
- **GRIND / SLIDE:** pressing grind (buffered) in AIR or GROUND searches rails within the capture radius along the predicted path. On a hit, the skater snaps to the rail and the velocity is projected onto the rail tangent. The grind type comes from the direction held plus the board's angle to the rail: parallel gives 50-50, 5-0, nosegrind and crooked, and perpendicular gives boardslide and lipslide. Balance is a one-dimensional unstable oscillator, with seeded wobble from `world.rng`, that the player counters with left and right. Going past the limit bails. At a rail end the skater goes airborne along the tangent, and ollie pops off the rail. Rail-graph links carry the grind across kinks.
- **MANUAL:** up then down within the buffer window, on the ground or just before landing (down then up gives a nose manual). Balance works on the pitch axis.
- **LIP:** grind plus a direction at a `lip` while going up. The skater stalls on the coping with balance, then drops back in.
- **WALL:** grind near a wall roughly parallel to velocity gives a wallride for a limited time. Ollie facing a wall in the air gives a wallplant. The freeway columns and perimeter walls are tagged `wall`.
- **Revert:** pressing revert within a window after landing on a transition keeps the combo alive.
- **BAIL:** a short kinematic tumble driven by the RNG, then a reset at the contact point with zero speed. The combo is lost.

The sim owns trick timing and board flip rotation, because landing checks depend on them. The client only draws them.

### 4.9 Tricks and scoring

The trick parser reads buffered input against `tricks.json`: button plus direction, double taps for variations, and sequences for specials. Each trick in a combo adds base points, reduced for repeats. The multiplier is the number of tricks in the combo. Spins add rotation bonuses (180, 360, 540, ...), and named gaps add bonuses. Landing banks the combo and a bail loses it. The special meter fills with landed tricks and unlocks special tricks. A two-minute session with goals comes in the game-layer milestone.

## 5. The client

The client draws state and plays events; it never changes the sim.

- **UI:** `src/client/ui.ts` (HUD, menu, results, pops, callouts; copy and jokes in `data/ui.json`, hot-reload), styles in `index.html`, art in `assets/ui/` (gpt-image-2 via `tools/gen_ui.py`), Inter, Archivo and IBM Plex Mono in `assets/fonts/` (CREDITS.md). Sound: `src/client/sound.ts` + `data/sound.json`; radio: `src/client/radio.ts` + `data/radio.json`.
- **Client systems beyond drawing the sim:** `src/client/ui.ts` also runs the game-mode HUDs (courier order card, hill bomb clock and gates, combo challenge), results cards and local bests, the minimap (city streets, park obstacles, burritos, the mode's target), session stats, first-time hints and the trick list; `life.ts` pigeons; `lofi.ts` / `punk.ts` the generated stations (SoMa Skate FM, Fog City Punk; also mixed into clips when playing); `nightsky.ts` the real look's night dome, stars and moon; `tags.ts` name tags over hill bomb rivals and your ghost; `postcard.ts` photo mode's postcard frame; neighbourhood banners from `data/ui.json` places; ghost racing (localStorage per route) in `main.ts` with `src/sim/ghost.ts`; `camera.ts` speed framing, obstacle avoidance and the special cam (`data/camera.json`); weather presets and night lamps in `render.ts` / `real.ts`. Clips (`skate clip`, V in play) replay all of it with the HUD and offline sound. `skate monkey` plays the real client with random keys.
- **The story and free roam** (docs/open-world.md, docs/story.md, docs/mechanics/missions.md): the game boots into free skate, Esc is the pause menu. `story.ts` keeps the story's save and draws the cast where they stand (`castview.ts`, data/cast.json), the markers over those with a story to give and over each neighbourhood's challenges (`markers.ts`), the talk prompt (F, data/controls.json interact), the mission's objective, and the minimap's faces and waypoint route; `dialogue.ts` is the dialogue box, `journal.ts` the journal, `mapscreen.ts` the city map (M: waypoints, Take Muni to visited spots). Numbers in data/story.json; styles in `story.css`.
- **Look:** three styles, G cycles. *Real* (default; `src/client/real.ts`, `data/look.json` → `real`): the park painted with 26 photos of the park taken on 2026-09-20, projected onto exactly the triangles the game collides with (the world generator's `blender/project_photos.py --profile game`, exported by `./skate park` as `assets/park/soma.park.paint.bin` + `paint/atlas-*.jpg`; regenerate, they are not in git; the client decodes them at half size for the first frame and swaps in the full ones a strip per frame after it, headless loads them full), one MeshStandardMaterial for the whole park (photo base colour, roughness/metalness per park material, triplanar CC0 detail textures from `assets/real/` by surface kind), an overcast HDRI sky that lights the park and shows behind it, a fixed sun whose one big shadow map covers the whole park, GTAO ambient occlusion, neutral tone mapping and the film pass (real.ts FILM_FRAG, `data/look.json` → `real.film`: a film curve with lifted blacks, a split tone, the filmer's lens (a slight fisheye with dark corners on the chase camera, stronger as the trick director's shots swing in: `CamPose.lens`; the camera draws wider by `lensFit` so the middle keeps its scale), grain at one CSS pixel, and the PS2 picture's ordered dither); Settings > Video > Lens and Picture (`render.ts setPicture`). By day a sky dome (`daysky.ts`, `real.daySky`) replaces the photo sky behind the city and the fog takes its horizon colour; a warm sun from the west-southwest with soft shadow edges (`real.sun.shadowRadius`) and a contact shadow under the board (`render.ts placeContact`). Without the baked paint (lab park, unbaked export) the game falls back to cute. *Cute* (`src/client/look.ts`): each park element painted a pastel by type, toon light in hard steps, ink outlines from the depth buffer in one post pass, a sky gradient and clouds. *Grey*: flat colors per surface class plus edge lines (like the park viewer's Clay plus Edges mode, used to judge shape); park-shape shots (view, pin, photo) default to it. `skate shot --style real|cute|grey`.
- **City (world sf):** `src/client/city.ts` draws everything the city export adds, one mesh per 200 m tile per class: ground (asphalt, sidewalk concrete with score lines, curbs, lawns, lots; shade under the park's deck), buildings (procedural San Francisco facades from the per-vertex look file: lap siding, fish-scale shingles, stucco, brick, recessed windows and doors traced per pixel with casings, hoods and sills, bays, cornices, garages, storefronts with generic signs, awnings), stoops up to the house doors (`city_stoop`, rideable stairs), road paint, rails, poles, furniture, Muni shelters, Mission Dolores and the freeway (the streetcars move: the sim's free-roam fleet on the F and J, drawn by the client); instanced street trees by crown class (leaf cards on branch limbs, blob shadows), palms and parked cars; around the corridors (Upper Market up to Twin Peaks), plain DEM ground and draw-only footprint massing (`city_context`, `city_massing`); a plain ring of blocks beyond the city's extent (`city.horizon`) on the far hills, and the skyline with Sutro Tower and downtown's towers (`src/client/skyline.ts`, `city.skyline`); the Clarion Alley murals, the Castro Theatre's sign and marquee and the Harvey Milk Plaza flag (`src/client/citydetail.ts`, `city.murals`, `city.castro`, `city.flag`); street paint (rainbow crosswalks, bike and bus lanes, STOP, SLOW, BUS ONLY) and Dolores Park's playground and J Church right of way; the Balmy Alley murals and the papel picado over 24th St; City Hall's dome, colonnades and floodlit granite (style bit 128, roof styles 7 and 8); the Ferry Building's clock tower with its clock faces lit at night (roof style 9), Embarcadero Plaza's brick (path style 1) and Pier 7 as it is (rebuilt from references: the world generator's city/pier7.py): its three concrete blocks straddling the two steps between the street side and the seawall side, the plaza's concrete panels laid square to the pier (path style 3 on the look's u, v, which the export sets to the pier's frame), the landing's granite band (path style 4), the deck in planks along the pier (path style 2), the blocks' worn cap and exposed-aggregate base (curb styles 1 and 2), the green cast-iron railings, lamps and bench ends, the PIER 7 pillar and the toilet kiosk (prop styles 12 to 14); the bay as a cheap water plane (kind water) out to the skyline's water, and the Bay Bridge as a silhouette on the skyline (`city.skyline.bridge`) with its lights at night (in Karl's fog the skyline's bay and bridge fade into the height fog too: `hfog`); the Embarcadero north to Pier 39 and Fisherman's Wharf with the promenade's granite edges, Pier 39's gate and the K-dock floats (prop style 10; the sea lions on them are data, `city.sealions`, drawn with the characters' Sea Lion); the Powell St cable car turntable (prop style 11) with a cable car on it (tram style 2), the line of tourists waiting (`data/pedestrians.json` gathers, `line`), a second turntable at Hyde & Beach and the cable car slot of every line as a grind line; Lombard's crooked block (brick lane, path style 1 on road ground, flower beds walled round, brick stairs up both sidewalks); Coit Tower on the skyline (shape coit); Chinatown's Dragon Gate and the lanterns strung over Grant Ave (`city.lanterns`, `src/client/citydetail.ts`); the interiors you roll into (Fog City Skate Shop, a taqueria, a laundromat, a corner store, the City Hall lobby: rooms behind door gaps, their boards over the doors `city.shopsigns`, their anchors for characters `city.interiors`); CC0 kit models baked into the mesh as look kind `kit` (the colour in the style, palette and flags bytes; their collision boxes in the undrawn collection `city_hitbox`); more spots (a freeway DIY, building sites, loading docks, banks to wall, plaza ledges, Potrero del Sol's bowls, a reachable roof by Duboce Park, `city.streetspots`); 24th St's lowriders (`city.lowriders`, their own instanced model); food trucks, parklets and shopfront furniture; the Lilac Street murals; draw-only decoration is built right after the first frame (`CityView.decorate`); the skate spots' stairwells, ledges and planters (`city_spot`); shop signs from `data/signs.json`. Tiles wholly past the fog are skipped each frame. Real, cute and grey like the park; in the real look the sun's shadow square follows the skater (`data/look.json` → `city`).
- **Skater:** `src/client/skater/`. A roster of pickable characters built in code (`characters.ts` on the kit in `kit.ts`, proportions, colours and steez in `data/characters.json`: a beer can, a blob, a eucalyptus-green furry monster, a guy in an orange mascot suit, a vampire, a skeleton, a tech bro) on a realistic board modelled in code (`board.ts`, procedural PBR maps from `tex.ts`). Every character has the same skeleton names, so one pose set drives them all: poses are retargeted to each character's legs and arms (`view.ts`), styled by its steez (`mood.ts`: stiffness, arm carriage, celebrations scaled to the landing, idle fidgets, bail flailing), and its face shows a mood read from the same state (`face.ts`: neutral, focused, happy, ecstatic, scared, dizzy, hurt). The menu's Character entry opens a picker with a turntable (`picker.ts`); the pick is kept in localStorage, Tab cycles in play. On foot (`gait.ts`) each character walks, runs, jumps and climbs in its own gait with the board carried by the edge or under the arm; on the board the rider leans into carves, powerslides with a hand down, flails in speed wobbles and tucks on hills; celebrations scale from the sim's last-landing record. `SkaterView.update(thing, data, alpha)` poses it from the Thing alone: keyframes in `data/poses.json` blended by state, crouch charge, trick id and progress, grind or slide type and balance, manual, lip, wallride and bail timers; two-bone IK puts the feet on the deck (kicks included) and the hands on grab points. The board's orientation and flip rotation come from the sim. Pure function of the Thing, so shots match play. Goofy is `stance` in `data/rider.json`, shared with the sim (drawn mirrored).
- **Camera:** a THPS chase camera with a pull-back on vert and a grind framing. Its smoothing steps once per sim tick, so the same replay gives the same camera. That makes screenshots repeatable. The sim does not need the camera, because THPS controls are skater-relative.
- **Input:** keyboard (see section 10) and a standard-mapping gamepad (PlayStation layout: cross ollie, square flip, circle grab, triangle grind, L1/R1 spin, L2/R2 revert, d-pad or left stick, options = Enter), read once per tick into an InputFrame (button bitmask). Bindings in `data/controls.json`.
- **Layer toggles:** `park` (rideable geometry and edges), `context` (freeway deck, buildings, streets), `skater`, `hud`, `rails`, `debug` (collision sphere, velocity, surface normal) and `shadows`. They are available from keys 1 to 7, the CLI and the live bridge. Shots default to everything except HUD and debug.
- **Dev panel and live bridge:** a Vite plugin hosts a websocket. `skate send "teleport hellride_top; speed 8"` reaches the running game, and `skate watch` streams state and events back as text.
- **HUD:** trick string, score, multiplier, balance meter and special meter, kept plain until the reskin.

## 6. The harness: the game is the harness

`skate` is the game running headless, plus tools. Every command prints compact text.

| Command | Does |
|---|---|
| `skate check` | Typecheck, lint (including the determinism bans), unit tests and scenario tests (in a pool of worker threads, `--jobs n`). One-screen summary; target under 20 s. |
| `skate run <scenario>` | Runs a scenario headless and prints its events, its key numbers and each expectation as pass or fail. |
| `skate trace <scenario\|replay> [--from --to --fields]` | A decimated table of position, velocity, state and balance, for reading physics as numbers. |
| `skate replay <file> --verify` | Re-runs the replay and checks the hash chain. On a divergence it prints the first divergent tick and the field differences. |
| `skate snap <replay> --at <tick>` | Cuts a snapshot out of a replay, to start a new scenario at the exact moment of a bug. |
| `skate shot <snapshot\|replay@tick> --layers --cam --crop` | Headless Chromium render to PNG. |
| `skate diff <a.png> <b.png>` | odiff: similarity %, changed pixel count and a diff image. |
| `skate clip <replay.json\|scenario> [--from --to --fps --size --style --weather --no-hud --music lofi\|punk\|hyphy --campath path.json ...]` | The run as an MP4 with the game's camera, HUD and sound, rendered offline in headless Chromium and muxed by ffmpeg (src/harness/clip.ts, src/client/clip.ts). `--campath` replaces the chase camera for the whole clip with a keyframed one (src/harness/campath.ts): a JSON file of keys `{ t, pos, look, fov? }` (seconds from the start; site metres, z up) on a Catmull-Rom spline whose tangents are taken over time, so the speed does not jump at unevenly spaced keys, starting and ending at rest. The run plays under it from `--from` for the path's length (a shorter run is an error), the city's sun shadows follow where it looks and the trick director is off. `scenarios/flythrough/squeeze.json` over `scenarios/flythrough/squeeze.skate` is the flythrough of the packed map (docs/squeeze.md). |
| `skate strip <scenario\|replay> --ticks a:b:n [--cam side\|quarter]` | A contact sheet of N cropped frames, so one image shows a whole trick (`out/strips/`). `--sheet scenarios/review.strips` stacks labelled strips into one review sheet. |
| `skate fuzz [--ticks --seed --spawns]` | Seeded random-input bots across the park; prints an invariant report. |
| `skate cityfuzz [--segments --seconds --seed --near x,y,r]` | The city sweep: random-input bots dropped on the sf world's street-level ground area by area; finds falls, the catch floor, being under the street, traps (stuck with no way out), grinds through walls, NaNs; a scenario per finding in out/cityfuzz/, known ones in src/harness/cityfuzz-known.json (docs/city-sweep.md). check --full runs 1,200 drops of 10 s and fails on a new finding. |
| `skate feel [--section ollie\|capture\|balance\|landing\|spin\|special] [--trials n]` | The feel audit's numbers through the real sim: ollie heights and the late window, a grid of grind approaches by angle and miss distance, grind and manual hold times for human-like players, landing verdicts, spin by air time, the special meter (docs/feel-audit.md). |
| `skate farm [--park --trials --seconds --seed --top --scenarios]` | The farm search (scoring integrity): random button patterns at every spot of a park with the balance bot, the best combos printed with their pattern; a combo far above what a line there should pay is a farm. --scenarios writes each hit to out/farm/ to replay and pin (docs/mechanics/combos.md). |
| `skate lines` | Autopilot rides the rider lines through the real park; pass or fail per line. |
| `skate perf [--profile] [--samply]` | ms per tick p50/p99, plus the top functions as text. `--race [dolores\|twinpeaks]`: a hill bomb race with traffic, park NPCs and racers, each tick's best of `--repeats` runs (budget p99 < 0.3 ms). |
| `skate send` / `skate watch` | Live bridge to the running dev game. |
| `skate inbox` / `skate promote <clip>` | Lists the F8 clips with notes, and turns one into a regression scenario. |
| `skate park` | Re-exports the park from the world generator (`SOMA_SKATEPARK_DIR`) and prints the diff. |
| `skate photos [ids] [--sheet]` | The loading and menu photographs (`assets/ui/photo/`) from the game itself: `data/photos.json` stages each (a scenario's skater at a tick, more of the cast, a camera), `src/client/photo.ts` adds a flash and develops it (fisheye, black and white, grain). |

Example of the text an agent reads:

```
$ skate run kickflip-off-big3
ticks 0-212 (1.77 s)  seed 1  data 9f3a  park 41c2
  t=0.75  pop        charge 0.17s  vUp 4.9 m/s
  t=0.98  trickStart kickflip
  t=1.23  trickLanded kickflip  100 pts
  t=1.61  land       forward  angleErr 6.2 deg  drop 1.31 m
  airtime 0.86 s   peak +0.98 m over lip   speed in 7.4 / out 7.1 m/s
  PASS  land within 140..200 (193)
  PASS  trick kickflip landed
  PASS  no bail
```

## 7. Testing

| Layer | What it checks | When it runs |
|---|---|---|
| Unit | Vector math, BVH, sweeps, rail projection, input parser, RNG, snapshot round-trip (`save(load(s)) == s`) | `skate check` |
| Scenario | A snapshot plus an input script, with expected numbers and events, on the lab park and on SoMa. Examples: ollie height range, kickflip completes before landing, 50-50 on the Big 3 ledge lasts past a given length, vert air returns to the ramp. | `skate check` |
| Determinism | Every scenario runs twice with identical hash chains, and a browser-recorded replay re-run in Node matches. | `skate check` (Node) and nightly-style full run (browser) |
| Golden replays | Promoted F8 clips and key lines must reproduce their recorded outcome (events and final hash). An intentional physics change re-baselines them, listed by name in the commit. | Full run |
| Fuzz | Seeded bots over 200k+ ticks from every spawn. Invariants: no NaN, never inside geometry, inside park bounds, speed under cap, never stuck for more than 3 s while input pushes, valid state transitions, a grinding skater always on a rail. | Full run |
| Rider lines | The 22 routes defined in the world generator's `blender/check_rider_lines.py` (north wall to Hellride, west runway to Big 3, wave both ways, ...) ridden by autopilot at a realistic speed. | Full run |
| Visual | `skate shot` of fixed snapshots (layers off except the subject, cropped) compared with goldens by odiff. Covers renderer regressions, poses at fixed trick progress, and HUD layout. | When the client changes |
| Performance | A sim budget of 0.5 ms per tick p99 on this Mac (soma, sf with traffic), 0.3 ms for a hill bomb race with traffic, NPCs and racers (each tick's best of three runs), and a render frame budget in headless Chromium. Printed as text. | Full run and when perf matters |
| Feel | People play it. This is the only test for whether it feels like THPS. | Each milestone, plus whenever something lands |

Full run (`skate check --full`) target: under 3 minutes.

## 8. How we work

**The inner loop (every change):**
1. Read the mechanic's spec in `docs/mechanics/`. If it does not exist, write it first: inputs, states, numbers and expectations.
2. Write or extend the scenario test that will show the change, so it fails first.
3. Make the smallest change in `src/sim` or `data/`. Change data instead of code whenever the change is a number.
4. `skate check`. For physics, read `skate run` and `skate trace` numbers. For visuals, run `skate shot` plus `skate diff` against the target, cropped to the subject.
5. Commit with a message saying what changed and why.

**The outer loop (playtests, regularly):**
1. Plays at http://127.0.0.1:5410 on the keyboard.
2. Presses F8 whenever something feels wrong or right, and types or dictates a note.
3. Each clip in `inbox/` becomes a scenario that reproduces it (`skate promote`), before any fix. The fix is done when that scenario passes and the next playtest agrees.
4. Tunes feel numbers live in the tuning panel. The settled values are saved to `data/`.
5. Presses F7 to pin comments on the park shape itself. Pins go into the park model's `data/comments.json` (in the world generator's checkout; without it, `out/park-comments/`) in the viewer's format, with a screenshot. The geometry is fixed in the park model, re-exports with `./skate park`, and the game picks it up.


**Context rules (for contributors and AI coding assistants):**
- CLAUDE.md stays short: the rules and the commands. Details live in `docs/`, and an assistant loads only the mechanic spec it is working on.
- Harness output is short and numeric. Failures show the first divergence, not full logs.
- One source of truth per concern: park geometry comes from the world generator (`site.json` and the geometry code) via the export, numbers live in `data/`, decisions in `docs/decisions.md`.
- Small commits on a stable base: no speculative abstractions, and no new dependency without a line in `decisions.md`.
- No visible windows: no `open`, no headed browsers, no GUI apps. Headless Chromium runs with `--mute-audio` and a unique profile, and is killed at the end.

## 9. Roadmap

Every milestone ends with `skate check --full` green and a playtest signing off on feel.

| Milestone | Contents | Exit criteria |
|---|---|---|
| **M0 Harness first** | Repo, sim skeleton, RNG, Thing, commands, snapshots, replays, hash chain, data loading with hot reload as commands, `skate` CLI, headless shot and odiff, perf, lab park, SoMa export, greybox renderer with layer toggles, live bridge, F8 clips, F5/F9. A sphere that rolls under gravity on the real park. | A replay recorded in the browser verifies in Node. `skate shot` and `skate diff` work. The park loads with rails, lips and spots. |
| **M1 Rolling** | Pushing, steering, carving, slopes, banks, transitions, the wave, quarterpipes, vert air with the lip rule, landing and bails, chase camera, gamepad. | Rides every rider line by autopilot. Playtest: rolling feels right. |
| **M2 Air tricks** | Ollie and nollie with charge, spins, flip and grab tricks from the table, trick timing, landing checks, basic combo and score, HUD. | Kickflip and a 360 off the Big 3 runway in scenarios. Tricks playtested. |
| **M3 Grinds and slides** | Rail capture and magnetism, the full grind and slide set, balance, rail graph, ledges, coping, hubbas, down rails, transfers. | Grinds on every rail type in the lab and SoMa. Fuzz shows no rail glitches. |
| **M4 Combo system** | Manuals and nose manuals, reverts, lip tricks, wallrides, wallplants, spine transfers, switch, multipliers, special meter and specials. | A long combo (manual, grind, revert, lip) chained in a scenario and in play. |
| **M5 Game layer** | Two-minute runs, goals, letters, named gaps in the park's local names (Hellride, Big 3, Big 2, ...), sound, menus. | A complete run is fun. |
| **M6 Reskin** | The photo-textured park from the world generator, a real skater model and animation. The sim does not change. | Visual goldens re-baselined, perf in budget. |

## 10. Settled (2026-10-16)

1. Controls: keyboard. The layout mirrors the PlayStation face-button diamond on I/J/K/L (I grind, J flip, K ollie, L grab), with WASD or the arrows for direction, U/O to spin and ; to revert. Bindings live in `data/controls.json`.
2. Feel reference: THPS 1+2 (the 2020 remake). Spine transfers (THPS4) may come later as an extra.

## 11. References from the article

- Kyle Kukshtel, "Your Game Is A Harness", from his Indie Rodeo talk.
- Drew Breunig on how long contexts fail: poisoning, distraction, confusion and clash (dbreunig.com, June 2025).
- odiff, github.com/dmtrKovalenko/odiff.
- samply, github.com/mstange/samply.
- Depot data editor (depot-editor.com), used on Cantata; Riot Games on content data; the Game Data Podcast.
- Brian Cronin's Roguelike Celebration talk on Monster Train's blackbox architecture; the Solium Infernum team on the Game Data Podcast.
- Wookash Podcast episodes with the creators of Dreams (on the Thing-style data model); Computer Enhance Q&A 80 on the memory cost.
