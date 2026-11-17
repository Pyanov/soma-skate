# City textures: sources and licenses

All from Poly Haven (https://polyhaven.com), **CC0 1.0** (public domain, no attribution required; credited here). Downloaded 2026-10-16 at 1k through https://api.polyhaven.com/files/<asset> and resized to 512 px (JPEG q88). Used by src/client/city.ts for the city around the park (world sf); asphalt and concrete come from ../ (the park's set).

| files | asset | author | used for |
|---|---|---|---|
| white_planks_clean_diffuse.jpg, _nor_gl.jpg | https://polyhaven.com/a/white_planks_clean | Rob Tuytel | painted wood siding (Victorian and Edwardian houses, turned horizontal) |
| white_stucco_diffuse.jpg, _nor_gl.jpg | https://polyhaven.com/a/white_stucco | Amal Kumar | stucco (apartments, modern, landmark) |
| red_brick_03_diffuse.jpg, _nor_gl.jpg | https://polyhaven.com/a/red_brick_03 | Rob Tuytel | brick (industrial buildings) |
| leafy_grass_diffuse.jpg, _nor_gl.jpg | https://polyhaven.com/a/leafy_grass | Charlotte Baglioni | grass (medians, Dolores Park, lawns) |
| tarred_gravel_diffuse.jpg, _nor_gl.jpg | https://polyhaven.com/a/tarred_gravel | Dimitrios Savva | tar and gravel roofs |

## Clarion Alley murals

| file | source | used for |
|---|---|---|
| murals.jpg | original art generated for the game with OpenAI gpt-image-2 (prompts in tools/gen_murals.py; `python3 tools/gen_murals.py gen` then `pack`) | the twelve murals on Clarion Alley's walls (src/client/citydetail.ts), 3 x 4 tiles of 1024 x 768 |

Not copies of the real Clarion Alley Mural Project's murals: new subjects in a bold Mission mural style (a burrito saint, Karl the Fog as a cloud deity, a Muni streetcar dragon, pigeons in sunglasses, a tech-bro cautionary tale and seven more), no words, logos or real brands.

## Balmy Alley murals

| file | source | used for |
|---|---|---|
| murals-balmy.jpg | original art generated for the game with OpenAI gpt-image-2 (prompts in tools/gen_murals.py, set balmy; `python3 tools/gen_murals.py gen --set balmy` then `pack --set balmy`) | the twelve murals on Balmy Alley's walls (src/client/citydetail.ts), 3 x 4 tiles of 1024 x 768 |

Not copies of the real Balmy Alley murals: new subjects in the Mission muralist style (lowriders, calaveras skating, a train as a feathered serpent, the 24th St mercado and eight more), no words, logos or real brands.

## Lilac Street murals

| file | source | used for |
|---|---|---|
| murals-lilac.jpg | original art generated for the game with OpenAI gpt-image-2 (prompts in tools/gen_murals.py, set lilac; `python3 tools/gen_murals.py gen --set lilac` then `pack --set lilac`) | the twelve murals on Lilac Street's walls (src/client/citydetail.ts), 3 x 4 tiles of 1024 x 768 |

Not copies of the real murals or graffiti on Lilac Street: new subjects (a whale of fog carrying a cable car, taco planets, an owl skating a pool, Telegraph Hill's parrots, a sea lion brass band and seven more), no words, logos or real brands.
