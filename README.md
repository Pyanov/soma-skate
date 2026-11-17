# SoMa Skate

An open-world skateboarding game set in San Francisco, built in TypeScript and three.js. It runs in the browser.

It is an arcade-style game, inspired by classic skate games: ollies, flips, grabs, grinds, manuals, reverts, wallrides and long combos, scored the way those games score them. You start in SoMa West Skatepark under the Central Freeway, painted with photos of the real park, then roll out of the gates into the city around it: Duboce, Valencia's shops, Market St down to the Ferry Building and Pier 7, the Castro, Alamo Square, Chinatown, Lombard, and the Dolores hill bomb. The city is generated from open data. There is a story with a cast of locals, side missions, races, a Tour of levels, Game of S.K.A.T.E., local two-player, a radio with three made-up stations, weather and night.

San Francisco first, other cities next.

## Screenshots

To be added before the first release:

- [ ] `docs/media/hero.gif`: a 10 s line through the park and out of the gate (`./skate clip`, then a gif)
- [ ] `docs/media/park.png`: the real look in the park
- [ ] `docs/media/dolores.png`: bombing Dolores at golden hour
- [ ] `docs/media/pier7.png`: Pier 7 at night
- [ ] `docs/media/menu.png`: the pause menu and the character picker
- [ ] `docs/media/harness.png`: a `./skate run -v` printout next to a `./skate strip` sheet

## Play

You need [Node.js](https://nodejs.org) 25 or newer (the harness runs TypeScript directly), git, and a browser with WebGL2.

```
git clone https://github.com/Pyanov/soma-skate.git
cd soma-skate
npm install
./skate world fetch     # the city and the park's photo paint, about 30 MB, from this repo's releases
npm run dev             # then open http://127.0.0.1:5410
```

`./skate world fetch` downloads the world bundle that `assets/park/world.json` names and checks its hash. With a copy on disk: `./skate world fetch --file world-....tar.gz`.

URL options: `?park=soma` for the park alone, `?park=lab` for the small test park, `?spot=dolores_bomb` (or `valencia_shops`, `market_st`, `park_gate`) to start somewhere.

## Controls

Keyboard (the face buttons sit on I, J, K, L like a PlayStation pad's diamond):

| Key | Does |
|---|---|
| W / ↑ | push |
| S / ↓ | foot brake (strong when slow, weak at speed) |
| A D / ← → | lean and turn (tap = small carve, hold = hard carve; at a standstill, pivot) |
| K or Space | ollie (hold = crouch: tuck on hills, pump in transitions) |
| J, L, I | flip, grab, grind (with a direction: the trick; see the Trick list in the menu) |
| U, O | spin left, right |
| ; | revert (in the air over a spine: spine transfer) |
| Shift | powerslide (hold; scores and links combos); on foot: walk |
| W W or S, then let go of K | boneless (a higher pop) or no comply (a quick low hop) |
| E | step off the board and carry it (on foot: W run, A D turn, K jump, run into a ledge to climb it); E again rides off |
| F | talk to someone with a marker over them |
| M | the city map: waypoints, and Muni to places you have visited |
| Esc | menu: runs, Go to, Character, Radio, Weather, Settings, Trick list, High scores, Credits |
| Tab | next character |
| [ ] \\ | radio: previous / next station, on/off |
| R / N | respawn / next spot |
| C | camera: chase, top, side, quarter, orbit |
| G | look: real (photo-painted), cute, grey |
| B | photo mode (Enter saves a PNG) |
| V | save the last 15 seconds as a video (on the dev server: an MP4 with sound in `out/clips/`) |
| X | instant replay of the last 6 seconds |
| H | How to skate: every key, including the dev keys (P pause, 1 to 8 layers, F5 F9 save and load, F8 clip with a note, F7 park comments, \` tuning panel) |

Gamepad (standard mapping, PlayStation layout): cross ollie, square flip, circle grab, triangle grind, L1/R1 spin, L2 powerslide, R2 revert, L3 step off, select radio, options menu. Touch controls appear on touch screens.

## The harness

The game is built to be read by tools, following Kyle Kukshtel's article "Your Game Is A Harness": a game is opaque to an automated check, or to an AI coding assistant, unless it is built to be inspected. So:

- The simulation (`src/sim`) is pure, deterministic TypeScript at a fixed 120 Hz with one seeded RNG. It runs the same in Node and in the browser, tick for tick, and every tick has a state hash.
- Every change to the world is a command, every number lives in `data/*.json`, and there is one `Thing` type, so any moment can be saved, loaded, replayed and diffed.
- `./skate` runs the game headless and prints short text: scenario results, per-tick traces, headless screenshots with image diffs, fuzzing, perf.

```
./skate check [--full]      # the gate for every change (typecheck, sim lint, unit tests, 474 scenarios with the street routes)
./skate run all -v          # scenarios with their events and numbers
./skate trace <scenario>    # a table of position, speed and state per tick
./skate shot spot:hellride --cam top --layers park,skater,rails   # a headless screenshot
./skate send "teleport big3; speed 7"   # puppet the running game
./skate clip <scenario>     # a replay or scenario as an MP4 with sound and HUD
./skate build               # a static site in dist/ for any host (docs/deploy.md)
./skate help
```

Headless shots, clips and `./skate check --full` need Playwright's headless Chromium: `npx playwright-core install chromium-headless-shell` (or point `SKATE_CHROMIUM` at one). Clips need ffmpeg.

More in [docs/architecture.md](docs/architecture.md); the moves by milestone are in [docs/mechanics.md](docs/mechanics.md), the decisions in [docs/decisions.md](docs/decisions.md).

## Roadmap

- **More cities**: the world format is not San Francisco specific, and the city comes from open data that most cities publish.
- **Multiplayer**: the deterministic sim and command stream are the basis for online play.
- **Mobile**: touch controls and an installable web app exist; load size and memory on phones are the work.
- **The world generator**: the Python tool that builds the park model and the city from open data is not public yet; it comes later. Until then `./skate world fetch` gives everyone its output.

Details and first issues: [docs/roadmap.md](docs/roadmap.md).

## How to help

Read [CONTRIBUTING.md](CONTRIBUTING.md). In short: a bug from play gets a reproducing scenario first, every number goes in `data/`, and `./skate check` is green before a change is done. [CLAUDE.md](CLAUDE.md) holds the same rules in short form for contributors and AI coding assistants. Good first issues are in [docs/roadmap.md](docs/roadmap.md).

Found a bug? Open an issue with what happened, where (`?spot=` or the coordinates from the debug layer) and, best of all, the F8 clip from `inbox/`.

## Licence

- Code: [GPL-3.0](LICENSE).
- Original art, audio, models and data: [CC BY-SA 4.0](ASSETS-LICENSE).
- Third-party assets and data keep their own licences: [CREDITS.md](CREDITS.md). Map data © OpenStreetMap contributors, available under the Open Database License.
- Some voices and images were made with AI tools; CREDITS.md lists them.

SoMa Skate is an independent game and is not affiliated with or endorsed by the makers of any skateboarding game, the City and County of San Francisco, or any business named in it.
