# Credits and licences

- **Code:** GNU General Public License v3.0 ([LICENSE](LICENSE)).
- **Original art, audio, models and data made for the game:** CC BY-SA 4.0 ([ASSETS-LICENSE](ASSETS-LICENSE)), credit "SoMa Skate contributors".
- **Third-party assets and data** keep their own licences, listed below. The same list, shorter, is in the game under Credits (`data/ui.json` → `credits`).

## Third-party assets in this repository

| What | Where | Source | Licence | Attribution |
|---|---|---|---|---|
| Park textures and the overcast sky (asphalt, bark, concrete floor and wall, rusty metal; `overcast_soil_puresky`) | `assets/real/*.jpg`, `*.hdr` | [Poly Haven](https://polyhaven.com) ([licence](https://polyhaven.com/license)) | CC0 1.0 | Not required; credited here. Files and hashes: `assets/real/LICENSES.md` |
| City textures (white planks, white stucco, red brick, leafy grass, tarred gravel) | `assets/real/city/*_diffuse.jpg`, `*_nor_gl.jpg` | Poly Haven, by Rob Tuytel, Amal Kumar, Charlotte Baglioni, Dimitrios Savva | CC0 1.0 | Not required; credited in `assets/real/city/LICENSES.md` |
| Board, body and footstep sounds (65 files) | `assets/sound/kenney-impact/` | Kenney, [Impact Sounds](https://kenney.nl/assets/impact-sounds) | CC0 1.0 | Not required; `License.txt` beside them |
| Street cars (8 of 21 vehicles, FBX, and the converted `cars.json`, `cars.bin`) | `assets/cars/` | Raphael Gonçalves (Rgsdev), [Free Low Poly Vehicles Pack](https://rgsdev.itch.io/free-low-poly-vehicles-pack) | CC0 1.0 (the itch.io page: "Licence is CC0. Credit is not needed."; `assets/cars/src/License.txt`) | Not required; credited here and in the game |
| Inter Regular and Medium (Latin) | `assets/fonts/Inter-*.woff2` | The Inter Project Authors, via [Fontsource](https://fontsource.org/fonts/inter) 5.3.0 | SIL OFL 1.1 | `assets/fonts/Inter-OFL.txt` |
| Archivo (variable, Latin) | `assets/fonts/Archivo-Variable.woff2` | The Archivo Project Authors (Omnibus-Type), via Fontsource 5.3.0 | SIL OFL 1.1 | `assets/fonts/Archivo-OFL.txt` |
| IBM Plex Mono Medium (Latin) | `assets/fonts/IBMPlexMono-Medium.woff2` | IBM Corp., via Fontsource 5.3.0 | SIL OFL 1.1 | `assets/fonts/IBMPlexMono-OFL.txt` |
| sin, cos and atan kernels | `src/sim/math.ts` | fdlibm, as kept in FreeBSD's msun (Sun Microsystems, 1993) | fdlibm notice ("Permission to use, copy, modify, and distribute this software is freely granted, provided that this notice is preserved.") | The notice is kept at the top of the file |

## Third-party assets in the world bundle

The derived world (the city and the park's photo paint) is not in git. `./skate world fetch` downloads it from the release named in `assets/park/world.json`. It is made from the sources below by the world generator (docs/roadmap.md, World generator).

| What | Source | Licence | Attribution |
|---|---|---|---|
| Parks and lawns, storefront points (which ground floors are shops; no names or brands are drawn), named buildings, the coastline, piers, plazas, Market St's centre line, the F-line track, neighbourhood place names | [OpenStreetMap](https://www.openstreetmap.org), Overpass API extract | ODbL 1.0 | **Map data © OpenStreetMap contributors, available under the Open Database License ([openstreetmap.org/copyright](https://www.openstreetmap.org/copyright)).** Shown in the game's credits. The city mesh is a Produced Work under ODbL 4.5(b); to the extent the bundle's manifest is a Derivative Database, it is offered under ODbL 1.0 and the method that made it is the world generator. |
| Street right of way (h8n7-e4ns), curbs and islands (emxt-b6yg), curb ramps (ch9w-7kih), building footprints with 2010 LiDAR heights (ynuv-fyni), street trees (tkzw-k3nq), streets (3psu-pn9h), Rec and Park assets (e3jj-mbb3) | [DataSF](https://datasf.org), City and County of San Francisco | PDDL 1.0 ([DataSF terms](https://www.sf.gov/reports--april-2017--datasf-terms-use)) | Not required; credited here and in the game |
| Ground elevation (1 m bare-earth DEM, and a 40 m version for the far hills) | U.S. Geological Survey, 3D Elevation Program | Public domain (U.S. Government work) | "Elevation: U.S. Geological Survey, 3D Elevation Program" |
| The park model's LiDAR checks: the 2010 ARRA Golden Gate LiDAR, and the 2023 San Francisco LiDAR point cloud (CA_SanFrancisco_B23) | NOAA Office for Coastal Management, Digital Coast; U.S. Geological Survey, 3D Elevation Program | U.S. Government works (USGS: public domain; the NOAA collection's own record was not checked for this audit) | Credited here and in the game |
| Pier 7 measurements (2022 0.25 m orthoimagery, SanFranciscoCA_RGBN_2022_9784) | NOAA National Geodetic Survey, Remote Sensing Division ([InPort 69582](https://www.fisheries.noaa.gov/inport/item/69582)) | CC0 1.0 / not subject to copyright in the U.S. | Credited here and in the game |
| Construction props, interiors' furniture and shop fittings, scaffolding (baked into the city mesh) | Kenney: City Kit (Roads), Furniture Kit, Mini Market (with Fleur Keijsers, Guus Vermeulen), Retro Urban Kit | CC0 1.0 | Not required; `assets/kenney-*/LICENSES.md` |

**References used only for measuring, not shipped:** the park's public design plans and topographic survey (SF Public Works and Board of Supervisors records), photos of Pier 7 from the press and Wikimedia Commons, and "Potrero del Sol Skatepark" by scott.anderson on Sketchfab (CC BY 4.0, a 360-camera scan used as a layout reference). No image or mesh from them is in the repo or the bundle. Landmark heights and positions (Sutro Tower, the downtown towers, the Bay Bridge, Coit Tower and others) are facts from public sources.

## Made for the game

| What | Where | How | Licence |
|---|---|---|---|
| The park model (collision mesh, rails, lips, spots) | `assets/park/soma.park.*` | Built in the world generator from public plans, surveys and LiDAR | CC BY-SA 4.0 |
| The park's photo paint | world bundle: `assets/park/soma.park.paint.bin`, `paint/` | 26 photos of the park taken for the project (2026-09-20), projected onto the collision mesh and cut into small surface pieces in the atlases (a review of downscaled atlases found no recognisable people). The park's walls carry third-party graffiti, which shows in the paint as it does in the park. | CC BY-SA 4.0 for the photography; the graffiti and murals in it belong to their artists and are not covered by this project's licence. An artist who wants a piece removed can open an issue, and it will be taken out of the next world bundle. |
| Characters, boards, faces, poses, city facades, signs, vehicles' paint | `src/client/` | Made in code | GPL-3.0 (code) |
| Portraits and menu photographs | `assets/ui/portrait/`, `assets/ui/photo/` | Rendered from the game itself (`tools/portraits.ts`, `./skate photos`) | CC BY-SA 4.0 |
| App icons | `assets/icons/` | Drawn from the wordmark in Archivo (`tools/icons.py`) | CC BY-SA 4.0 (Archivo stays OFL) |
| Music on the radio (lo-fi, skate punk, hyphy) and every sound effect not from Kenney | `src/client/lofi.ts`, `punk.ts`, `hyphy.ts`, `sound.ts` | Synthesized in the browser | GPL-3.0 (code) |

### AI-generated assets (disclosed)

| What | Where | Tool | Notes |
|---|---|---|---|
| Voices: the robotaxi, Muni's announcements, the radio DJs and the story's characters (703 lines) | `assets/sound/voice/*.mp3` | OpenAI text to speech (gpt-4o-mini-tts), `tools/gen_voices.py`, from the text and voice instructions in `data/voices.json`, `data/missions.json`, `data/jobs.json`, `data/cast.json` | Synthetic speech, not recordings or imitations of real people. OpenAI's usage policies ask that listeners are told a TTS voice is AI-generated: the game's credits and this file say so. |
| Murals of Clarion Alley, Balmy Alley and Lilac Street (36) | `assets/real/city/murals*.jpg` | OpenAI image generation (gpt-image-2), `tools/gen_murals.py` | Original subjects, not copies of the real murals; no words, logos or brands |
| The logo and the burrito | `assets/ui/logo.png`, `assets/ui/burrito.png` | OpenAI image generation (gpt-image-2), `tools/gen_ui.py`, background keyed by `tools/key_ui.py` | |

Under OpenAI's Services Agreement (section 4.1) the customer owns the output, and the agreement has no clause against redistributing it (OpenAI's Terms of Use and usage-policy pages could not be read for this audit). These files ship under CC BY-SA 4.0 as far as copyright subsists in them (see ASSETS-LICENSE). The prompts in the tools are the source for regenerating them; the tools are optional and need `OPENAI_API_KEY`.

## Radio

The radio plays only the game's own generated stations: SoMa Skate FM, Fog City Punk and KSOMA Hyphy Hour. Every station, DJ and song title is fictional.

Earlier builds also tuned into live public streams. They were removed before release:

| Station | Terms checked (2026-11-16) | Result |
|---|---|---|
| SomaFM (all channels, including SF Police Scanner) | [somafm.com/contact/tos.html](https://somafm.com/contact/tos.html): "We can't grant permission for third-party SomaFM clients or applications, even noncommercial ones." Now-playing reuse is also against its terms. | Not allowed |
| NTS | [nts.live/terms-and-conditions](https://www.nts.live/terms-and-conditions) covers payments only; no published terms for third-party players | Unclear |
| KEXP | [kexp.org/terms-and-conditions](https://kexp.org/terms-and-conditions/): personal, noncommercial use; no written permission for apps | Unclear |
| dublab | No published terms for third-party players found | Unclear |
| Radio Paradise | No published terms for third-party players found | Unclear |
| BFF.fm | [developer.bff.fm](https://developer.bff.fm/audio/stream) invites apps to play the stream, with credit, an `app_id` and gentle polling | Allowed with conditions; left out with the rest for now (docs/roadmap.md) |

## Names and places

SoMa Skate is an independent game inspired by classic skateboarding games, and it is not affiliated with or endorsed by their makers. Real San Francisco streets, parks, landmarks and transit lines appear as the places they are; the game is not affiliated with or endorsed by the City and County of San Francisco, its agencies, the skatepark's designers or any business in the city. Shop names in the game are fictional.

## Libraries

Runtime: [three.js](https://threejs.org) (MIT), [zod](https://zod.dev) (MIT). Development: [Vite](https://vite.dev) (MIT), [Vitest](https://vitest.dev) (MIT), [TypeScript](https://www.typescriptlang.org) (Apache-2.0), [playwright-core](https://playwright.dev) (Apache-2.0), [odiff](https://github.com/dmtrKovalenko/odiff) (MIT). Their licences come with them in `node_modules/`.
