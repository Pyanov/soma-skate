# Roadmap

San Francisco first, other cities next. This file lists where the game is going, what the world generator needs before it can be published, and some first issues for new contributors.

## Direction

- **More cities.** The game reads any world in the soma-park/1 format (`src/sim/park/source.ts`): a collision mesh with surface classes, grind lines, spots and a per-vertex look file. San Francisco is built from open data (OpenStreetMap, the city's open data portal, a national elevation model). Most large cities publish the same kinds of data, so the next city is mostly a new config for the world generator plus city-specific landmarks.
- **Multiplayer.** The sim is deterministic and every change is a command (docs/architecture.md, 4.3 and 4.4), and local two-player already runs on it (docs/mechanics/modes.md). Online play would send input frames, not state: lockstep or rollback over WebRTC, with the state hash every tick to catch a desync.
- **Mobile.** Touch controls exist (`data/touch.json`, `src/client/touch.ts`) and the build is an installable web app (docs/deploy.md). The open work is load size on cellular (the city is about 31 MB gzipped), memory on phones, and a lower-detail city.
- **A packed map.** A smaller, denser map update comes later; the release ships today's map.

## World generator

The park model and the city are made by a separate generator (Python, open data, no logins), today in its own repository, not yet public. `./skate world fetch` downloads its output, so nobody needs it to play or to work on the game. `./skate park` and `./skate city` run it when `SOMA_SKATEPARK_DIR` points at a checkout.

What a public `worldgen/` needs, from an audit of the generator:

- **The city build:** `city/build.py` and its 25 modules (about 8,200 lines: terrain, ground, buildings, props, markings, traffic, landmarks, spots, interiors, skyline and the rest), `city/config.json`, `city/sources.json`, `city/kits.py` with the Kenney kits' OBJ and MTL files (CC0), and `city/fetch.py`, which downloads about 670 MB of open data into `city/raw/` (never committed) and logs every request.
- **Shared with the park:** `blender/geom/site.py` and `data/site.json` (the park's site frame, curbs, fence and gates).
- **The park export:** `scripts/export_game_park.py`, `blender/geom/` (mesh, obstacles, scene), `blender/texture/atlas.py` and `blender/materials.py`. No Blender is needed for the geometry.
- **The photo paint:** `blender/project_photos.py --profile game` needs Blender, the 26 photos of the park and their solved cameras. Until the photos and solves are published, the paint stays a released file in the world bundle.

Before it moves here, the generator gets a fetch script that identifies the project in its requests, only redistributable references, and a check that a fresh fetch and build reproduce the bundle's city hash (`sf.city.json` → `hash`) from the logged raw data.

## Radio

The release ships only the game's generated stations (CREDITS.md, Radio). A live station can come back once its owner gives written permission for third-party players. BFF.fm already invites apps (credit, an `app_id` parameter, gentle polling) and is the first candidate. A new generated station (a synth like `src/client/lofi.ts`, with its DJ) needs no permission at all.

## Good first issues

Each of these is small, has a clear check, and touches one or two files. Read CONTRIBUTING.md first.

1. **A GitHub Actions workflow for `./skate check`.** Node 25, `npm ci`, `./skate world fetch`, `./skate check`. The world bundle is about 30 MB; cache it by the tag in `assets/park/world.json`.
2. **Linux and Windows for headless shots.** `src/harness/browser.ts` finds Playwright's headless shell on any platform now; try `./skate shot` and `./skate check --full` on Linux and fix what breaks (fonts, GL flags).
3. **A fourth generated radio station.** Copy the shape of `src/client/punk.ts` (a seeded synth, song titles in `data/radio.json`), keep it offline, and add it to the credits.
4. **Keyboard layouts.** `data/controls.json` assumes QWERTY. Add an AZERTY preset and a way to pick it in Settings.
5. **A missing trick scenario.** Pick a trick in `data/tricks.json` that no scenario lands (grep `scenarios/`), write `scenarios/lab-<trick>-lands.skate`, and make it pass.
6. **Shop names.** `data/signs.json` holds the fictional shop signs; add more, San Francisco jokes welcome, no real brands.
7. **Dead-end hunt.** Play the story with `./skate playtest --park sf` and turn anything that gets stuck into a scenario (`./skate promote`).
8. **Docs for one command.** Pick a `./skate` command whose help line is thin (`./skate help`) and give it a short section in docs/architecture.md, section 6.
