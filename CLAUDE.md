# SoMa Skate

An arcade-style open-world skateboarding game: SoMa West Skatepark and San Francisco around it, in TypeScript and three.js. These are the project rules for contributors and AI coding assistants (CONTRIBUTING.md has the long form). Read `docs/architecture.md` once per session; load only the mechanic spec you are working on from `docs/mechanics/`.

## Setup
- Node 25+ runs the harness's TypeScript directly. `npm install`, then `./skate world fetch` (the city and the park's photo paint; `--file <tarball>` for a local copy), then `./skate check`.

## Rules
- `src/sim` is the source of truth: pure TypeScript, no DOM, no three.js, no clocks, no `Math.random`, no async. All randomness goes through `world.rng`. The client only draws state and plays events.
- Every world change is a command. Numbers live in `data/*.json`, not code. Change data before code.
- One `Thing` type. Add fields to it; never subclass.
- Erasable TypeScript only (Node runs .ts directly): no `enum`, no `namespace`.
- Park and city geometry come only from the world generator (`./skate park`; `./skate city` with `SOMA_SKATEPARK_DIR`, which builds the squeezed city: `city/squeeze.py`, then `city/build.py` on its output) or the released bundle (`./skate world fetch`). Never hand-edit `assets/park/soma.park.*` or the bundle's files.
- A bug from play gets a reproducing scenario (`./skate promote`) before the fix.
- `./skate monkey` (random keys in the real client, sf, 60 s) after client changes that touch input, menus or the frame loop; `check --full` runs a 10 s one on the lab park.
- Run `./skate check` after every change; the change is not done until it is green (`--full` before commits that touch physics, rendering, UI or fonts). For physics, read `./skate run -v` / `./skate trace` numbers. For visuals, use `./skate shot` + `./skate diff`, cropped to the subject, with only the layers you need.
- Small commits; message says what and why. New dependency or architecture change goes in `docs/decisions.md`.
- No real brands or copyrighted art in game data or assets; a new third-party asset gets its licence in its folder's `LICENSES.md` and in `CREDITS.md`.
- Automated checks open no visible windows: headless Chromium only, with `--mute-audio` and a unique profile, killed when done. The dev server is http://127.0.0.1:5410; people open it in their own browser.
- Never commit secrets. The optional art and voice tools read `OPENAI_API_KEY` from the environment.
