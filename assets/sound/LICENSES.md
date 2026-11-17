# Sound assets: sources and licenses

## kenney-impact/ (board, body and footstep hits)

- **Source:** Kenney, "Impact Sounds" (version 1.0), https://kenney.nl/assets/impact-sounds
  Download: https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip
  (sha256 of the zip as downloaded on 2026-10-16: 029d734af1582474edf3a694d1b0cebc97c1c152f2f39fa34d4c2bafc5de77f8)
- **License:** Creative Commons Zero (CC0 1.0), see `kenney-impact/License.txt`. Crediting Kenney is optional; we do it here.
- **Kept:** the plank, wood, metal, plate, soft, punch, generic, tin and concrete-footstep groups (65 files). Everything else from the zip stays out of the repo.

Everything else the game plays (wheels, grinds, slides, wind, freeway, sirens, score stingers, reverb) is synthesized at run time in `src/client/sound.ts` from `data/sound.json`.

## voice/ (the robotaxi's speaker, Muni's PA, the radio DJs and the story's cast)

- **Source:** AI-generated with OpenAI text to speech (gpt-4o-mini-tts) by `tools/gen_voices.py`, from the text and voice instructions in `data/voices.json` (the story's lines: their text in `data/missions.json` and `data/cast.json`, checked by transcribing them back with `tools/check_voices.py`). These are synthetic voices, not recordings of people.
