# Street car models: source and license

**Free Low Poly Vehicles Pack** by Raphael Gonçalves (Rgsdev), https://rgsdev.itch.io/free-low-poly-vehicles-pack. **CC0** (public domain, free for any use, commercial included; credit not required, credited here and in the game's credits). The pack's own license text is `src/License.txt`.

Downloaded 2026-10-18 through itch.io's no-account download ("No thanks, just take me to the downloads"). Eight of its 21 vehicles are used, as FBX in `src/` (Sedan, Hatchback, SUV, Pickup, Sports, Muscle, Taxi, Police Sedan). `node tools/cars.ts` converts them into `cars.json` and `cars.bin` (merged, turned to the game's frame, fitted to the sim's car box, vertex coloured, lamps and rims recoloured, body panels flagged for paint). `src/` stays out of the build (src/harness/build.ts).
