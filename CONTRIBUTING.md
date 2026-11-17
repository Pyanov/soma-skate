# Contributing to SoMa Skate

Thanks for helping. This file is the short version of how the project works; [docs/architecture.md](docs/architecture.md) is the long one.

## Set up

```
npm install
./skate world fetch
./skate check          # should print CHECK OK
npm run dev            # http://127.0.0.1:5410
```

Node 25 or newer runs the harness's TypeScript directly, so there is no build step. For headless shots and `./skate check --full`, install Playwright's headless Chromium: `npx playwright-core install chromium-headless-shell`.

## The rules

These keep the game deterministic and every change checkable. [CLAUDE.md](CLAUDE.md) lists the same rules for AI coding assistants.

1. **`src/sim` is the source of truth.** Pure TypeScript: no DOM, no three.js, no clocks, no `Math.random`, no async. All randomness goes through `world.rng`, all trig through `src/sim/math.ts`. The client only draws state and plays events. `./skate check` lints for this.
2. **Every world change is a command.** Dev tools, tests, replays and the live bridge all go through `applyCommand`.
3. **Numbers live in `data/*.json`, not in code.** Change data before code. The files are validated with zod (`src/data/schema.ts`).
4. **One `Thing` type.** Add fields to it; never subclass.
5. **Erasable TypeScript only** (Node strips the types): no `enum`, no `namespace`; use `as const` objects.
6. **A bug from play gets a reproducing scenario before the fix.** Press F8 in the game to save the last 20 seconds with a note into `inbox/`, then `./skate promote <clip>` turns it into a scenario. The fix is done when that scenario passes.
7. **`./skate check` is green before a change is done.** Run `./skate check --full` too when you touch physics, rendering, the UI or fonts. For physics, read the numbers (`./skate run -v`, `./skate trace`); for visuals, use `./skate shot` and `./skate diff`, cropped to the subject.
8. **After client changes to input, menus or the frame loop,** run `./skate monkey` (random keys in the real client).
9. **Don't hand-edit `assets/park/soma.park.*` or the world bundle.** They come from the world generator.
10. **A new dependency or an architecture change gets a dated entry in [docs/decisions.md](docs/decisions.md).**

## Scenarios

A scenario is a plain-text script in `scenarios/`: a start (a spot, a snapshot or coordinates), timed key presses, and expectations.

```
# Push down the west runway, charged ollie at the top of Big 3, kickflip, land past the bottom step.
park soma
spawn big3
hold up 0..100
hold ollie 166..196
tap flip+left 202
run 420
expect event trickEnd{trick=Kickflip} within 240..260
expect event comboLanded{name=Kickflip + BIG 3 GAP,multiplier=2} within 300..360
expect no event bail
```

(`scenarios/soma-big3-kickflip.skate`, shortened.)

`./skate run <name> -v` runs one and prints its events, numbers and each expectation. The first comment line says what the scenario shows and why. Name it by park and subject (`lab-...`, `soma-...`, `sf-...`).

## Reporting a bug

Open an issue with:

- what you did and what happened, and what you expected;
- where: a spot (`?spot=...`), or the coordinates from the debug layer (key 6);
- the F8 clip from `inbox/` (a `.replay.json` and a `.png`) if you have one; it replays exactly;
- your browser and OS, if it looks like a rendering problem.

## Pull requests

- Work on a branch and open a pull request against `main`.
- Small commits; each message says what changed and why.
- Include the scenario that shows the change, and say in the description what `./skate check` (and `--full` if it applies) printed.
- Visual changes: attach a before and after `./skate shot`.
- By contributing you agree that your code is licensed under GPL-3.0 and your art, audio, models and data under CC BY-SA 4.0, as the rest of the repo (LICENSE, ASSETS-LICENSE). Third-party assets need a licence that allows this (CC0, CC BY, OFL and the like) and a line in CREDITS.md.

## Assets

- No real brands, logos or copyrighted art in the game. Shop names are made up.
- New third-party assets: CC0 or CC BY preferred; record the source URL, the licence and the download date in the folder's `LICENSES.md` and in CREDITS.md.
- AI-generated assets are allowed if they are disclosed in CREDITS.md and the tool's terms allow redistribution. The art and voice tools in `tools/` are optional and read `OPENAI_API_KEY` from the environment.

## Code of conduct

Everyone taking part agrees to the [Code of Conduct](CODE_OF_CONDUCT.md).
