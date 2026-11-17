# Reusable 3D assets (licence-checked, 2026-10-18)

From the asset research for the open world (docs/open-world.md). Kenney licences come from the License.txt in each zip (CC0). Poly Haven is CC0 (polyhaven.com/license). Sketchfab licences come from its model API; re-confirm them in the download dialog, which needs a free account.

What the game uses today: the rgsdev vehicles (assets/cars/), four Kenney kits (assets/kenney-*/, baked into the city by the world generator), Kenney Impact Sounds and Poly Haven textures. None of the Sketchfab, KayKit, Kenney Mini Skate or Poly Haven prop models listed below are in the game (checked 2026-11-16 against assets/ and data/).

Rules:
- CC0 first, CC-BY second. Licence evidence goes in `assets/<kit>/LICENSES.md`, and CC-BY credit lines go in data/ui.json credits.
- Never collide with render meshes. Collision goes through the world generator or boxes in data. Grind lines are explicit polylines.
- No real brands (trademarks). No scans of murals, graffiti or sculptures (the artists' rights). Nothing ripped from games.

## Vehicles
- **In use:** rgsdev Free Low Poly Vehicles Pack (CC0, itch, no account) for traffic. https://rgsdev.itch.io/free-low-poly-vehicles-pack
- **Candidates, not downloaded** (Sketchfab, needs a free account), all CC-BY 4.0:
  - comrade1280's generic civil service pack: garbage truck, bus, taxi, police, postal van and more. https://sketchfab.com/3d-models/generic-civil-service-vehicles-pack-8ff2a13f30914932a70c7950cfa58465
  - comrade1280's generic passenger car pack: https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5
  - Zhabotinsky's Shvan '92 van, for the crew van: https://sketchfab.com/3d-models/09d718c9cf72401b8534d265a06a803f
- **Kenney Car Kit** (CC0) has toy proportions, so it suits the cute look only.
- **Streetcar and cable car:** no good CC model exists. Keep the procedural ones.

## Street props
- **Poly Haven Hidden Alley and related props** (CC0, no account): fire escapes, rollershutters, utility boxes, lamps, bins, planters, outdoor tables.
- **Kenney City Kit Roads and Retro Urban Kit** (CC0): construction barriers, cones, dumpsters, scaffolding, pallets, awnings, benches.
  - https://kenney.nl/assets/city-kit-roads
  - https://kenney.nl/assets/retro-urban-kit
- **CC-BY:**
  - TampaJoey City Props vol. 2: https://sketchfab.com/3d-models/2f52ea53c58e455f9b69d11f58763c96
  - vmatthew Street Asset Pack: https://sketchfab.com/3d-models/f3eb47d02e2e4ab290e66752fa354b48
  - Food carts and trucks:
    - https://sketchfab.com/3d-models/d363905ab6db442789acf06e031e2b21
    - https://sketchfab.com/3d-models/1a97f872c1ac4a83a0132cd749d0b2a8
    - https://sketchfab.com/3d-models/72ad29245a2c4981a819f77dc1dbb631

## Interiors
- **Kenney Furniture Kit and Mini Market** (CC0; scale about 2.2x): corner store and laundromat.
  - https://kenney.nl/assets/furniture-kit
  - https://kenney.nl/assets/mini-market
- **KayKit Restaurant Bits and Furniture Bits** (CC0): the taqueria.
  - https://kaylousberg.itch.io/restaurant-bits
  - https://kaylousberg.itch.io/furniture-bits
- **99.Miles Simple Storefront Interior Pack** (CC-BY): https://sketchfab.com/3d-models/348da01c195d46eca29e478e98aab16c
- **Poly Haven props** (CC0).

## Skateparks
- **Kenney Mini Skate** (CC0, 42 clean grid pieces): bases for DIY and plywood obstacles. https://kenney.nl/assets/mini-skate
- **bral_unit Indoor Skatepark** (CC-BY, game-ready): https://sketchfab.com/3d-models/7eb6668a5bea4337b7c393a32b498d7a
- **Bay Area scans by scott.anderson** (CC-BY). Reference and photos only; their surfaces are too lumpy to collide with.
  - Potrero del Sol: https://sketchfab.com/3d-models/925920ab9549465bb24b7b48cbce65bd
  - Lake Cunningham: https://sketchfab.com/3d-models/c243c0866e044db1846630f369e52ff3

## Candidate second maps
1. **A California beach town with a boardwalk.** OSM pipeline plus Overture buildings plus USGS 3DEP elevation, with fictional names.
2. **Lake Cunningham skatepark (San Jose),** rebuilt from the CC-BY scans plus LiDAR the way SoMa West was.
3. **A warehouse district with the indoor park,** built from CC0 kits. The fastest to ship.

## Red flags
- **Quaternius:** the pack pages say CC0, but its licence page (2026-08-28) has its own licence that bans redistributing the assets.
- **Mixamo:** raw files can't be redistributed.
- **Rejected:** game rips labelled CC-BY, uploads with Bing, Google Maps or Quixel material inside, non-commercial licences, and LA County building data (members only).
