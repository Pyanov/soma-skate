# Mechanics catalog

The THPS moves this game needs, grouped by milestone. Each move gets its own spec in `docs/mechanics/<name>.md` before it is built (template at the end). Exact button and direction bindings live in `data/controls.json` and `data/tricks.json`. They follow THPS 1+2 defaults and are confirmed in playtests.

## Controls (THPS-style, PlayStation names)

| Button | Use |
|---|---|
| ✕ | Ollie: hold to crouch and charge, release to pop. Also wallplant (in the air facing a wall) and jumping off rails and lips. |
| □ + direction | Flip tricks. |
| ○ + direction | Grab tricks (hold to keep the grab). |
| △ + direction | Grinds and slides near a rail, lip tricks at a lip, wallride near a wall. |
| Stick / d-pad | Turn on the ground, spin in the air, balance in grinds, manuals and lips. Up then down starts a manual; down then up starts a nose manual. |
| Shoulders | Spin left and right, revert, nollie and switch. Exact mapping to confirm. |

## M1: Rolling

- Push, coast, brake, turn (turn rate falls with speed)
- Carving and pumping on banks, transitions and the wave
- Quarterpipes and vert: ride up, vert air with the lip rule, land back in
- Fakie and switch rolling
- Bail on a bad landing; respawn

## M2: Air

- Ollie (charged), nollie, fakie ollie, late ollie off edges
- Spins: 180, 360, 540 and up, frontside and backside
- Flip tricks: kickflip, heelflip, pop shove-it, impossible, varial kickflip, hardflip, 360 flip, double variants by double tap
- Grab tricks: indy, melon, method, nosegrab, tailgrab, stalefish, japan, benihana, held for points
- Landing check: forward or fakie within tolerance, trick finished, otherwise bail

## M3: Grinds and slides

- Grinds (parallel to the rail): 50-50, 5-0, nosegrind, crooked, overcrook, smith, feeble; FS/BS by approach
- Slides (across the rail): boardslide, lipslide, noseslide, tailslide, bluntslide, nosebluntslide
- Balance meter, switching grinds mid-rail, ollie off, rail-to-rail transfers
- Rail types: coping (COP pipe), angle-iron ledges (AI5), flat-bar edges (FSB), round rails, hubbas, down rails, ledge edges

## M4: Combo system

- Manual and nose manual with pitch balance
- Revert on transition landings (keeps the combo)
- Lip tricks: rock to fakie, axle stall, disaster, nose stall, invert, handplant
- Wallride and wallplant (freeway columns, perimeter walls)
- Spine transfer
- Combo multiplier, repeat penalties, special meter, special tricks

## M5: Game layer

- Two-minute session, high score, goals, letters
- Named gaps in the park's local names: Hellride, Big 3, Big 2, and more from playtest review notes
- Sound

## Spec template (`docs/mechanics/<name>.md`)

```
# <Mechanic>
Milestone: M?
Input:        buttons, directions, buffer windows (ticks)
States:       entered from, exits to
Rules:        what the sim does each tick, in plain sentences
Numbers:      every constant, with its data/*.json path and starting value
Events:       events emitted
Scenarios:    scenario names, with the expected numbers each asserts
Feel notes:   what playtests said, dated
```
