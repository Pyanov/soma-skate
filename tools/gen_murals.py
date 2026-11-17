#!/usr/bin/env python3
"""Generate the mural alleys' murals with OpenAI gpt-image-2 (optional; needs OPENAI_API_KEY) and pack them.

    python3 tools/gen_murals.py gen [--set balmy|lilac] [<name> ...]   # writes out/murals/<name>.png (1536x1024); all names if none given
    python3 tools/gen_murals.py pack [--set balmy|lilac]               # packs the set into its atlas (3072x3072, 3x4)

Sets: clarion (Clarion Alley, assets/real/city/murals.jpg), balmy (Balmy Alley,
assets/real/city/murals-balmy.jpg) and lilac (Lilac Street, assets/real/city/murals-lilac.jpg).
Original art made for the game, not copies of the real murals in any of the alleys. The prompts are the source of truth for the art; keep them here. Each
set's order = its atlas order (row-major, 3 per row), the order city.murals indexes.
"""
import base64, json, subprocess, sys, urllib.request, concurrent.futures as cf
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from openai_key import key  # noqa: E402  (OPENAI_API_KEY)

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / 'out/murals'
ATLAS = ROOT / 'assets/real/city/murals.jpg'
STYLE = ("A huge original outdoor wall mural, seen straight on and filling the whole frame edge to edge as if the wall were the canvas "
         "(no wall edges, no sky above it, no ground, no people standing in front, no perspective). Painted in the bold San Francisco "
         "Mission District mural tradition: big simple shapes readable from far away, saturated warm colours (marigold, magenta, turquoise, "
         "chili red, deep blue), thick dark outlines, flat colour with a little brush texture, folk-art patterns and a decorative border. "
         "Original artwork; no words, no letters, no logos, no signatures, no real brands. Subject: ")
MURALS = {
    'burrito_saint': "a giant foil-wrapped burrito saint with a calm smiling face and a golden halo, arms open, floating above Mission rooftops "
                     "and palm trees, rays of light in chili red and gold, marigolds and tiny devotees holding up hot sauce bottles with blank labels.",
    'karl_deity': "Karl the Fog as an ancient cloud deity: a vast soft grey fog cloud with a wise sleepy face, long misty arms wrapping around "
                  "a red suspension bridge and the hills of the city, little foghorn spirits singing, cool blues and greys against an orange sunset.",
    'muni_dragon': "a Muni streetcar dragon: a long serpent dragon whose body is a chain of vintage red-and-cream streetcars with no logos, "
                   "a fierce friendly head with whiskers, coiling over steep hills and Victorian houses, sparks from the overhead wire like fire.",
    'pigeons_shades': "a gang of city pigeons wearing sunglasses and gold chains, lounging on a power line and on a striped shop awning, one "
                      "pigeon riding a skateboard, sunny and funny, big characters filling the wall.",
    'techbro_tale': "a cautionary tale told as one mural in three scenes left to right: a man in a fleece vest staring at his phone walks past "
                    "the whole colourful neighbourhood; a mischievous fog cloud swallows his electric scooter; he finally looks up, smiles "
                    "and shares a burrito with his neighbours on a stoop. Satirical but warm.",
    'skate_sun': "a sun goddess with a skateboard for a halo, skaters flying through her golden rays over palm trees and a hilltop park, "
                 "papel picado banners strung across the top.",
    'mission_mother': "a giant mother figure with marigold hair holding a row of colourful Victorian houses in her arms like children, "
                      "hummingbirds and calla lilies around her, a gentle face, monumental.",
    'seagull_heist': "a heroic seagull flying off with a giant round loaf of sourdough bread, waves crashing, a crab shaking its claw at it, "
                     "comic action and big shapes.",
    'lowrider_wave': "a lowrider car with no logos surfing a giant curling ocean wave like a skateboard, flames, roses and stars around it.",
    'park_fiesta': "a hilltop city park on a sunny day as a joyful festival: people of every kind picnicking on the grass, dogs, a mariachi "
                   "band, a giant smiling sun, a downtown skyline far behind.",
    'robotaxi_alebrije': "a self-driving robotaxi car turned into a fantastical alebrije creature: wings, a curling tail, bright patterns of "
                         "dots and stripes all over, a spinning sensor crown, surrounded by flowers.",
    'quetzal_skater': "a girl on a skateboard riding the back of a giant feathered serpent made of turquoise and green feathers through a "
                      "starry night sky over the Mission, moon and comets.",
}
BALMY = {
    'lowrider_parade': "a parade of gleaming lowrider cars with no logos bouncing down a sunny street lined with colourful Victorian houses, "
                       "hydraulics lifting their wheels, chrome and candy paint, papel picado banners overhead.",
    'calavera_skaters': "Dia de los Muertos calaveras skateboarding: smiling sugar-skull skeletons in bright clothes doing tricks over marigolds "
                        "and candles, one grinding a rail of cempasuchil flowers, joyful not scary.",
    'bart_serpent': "a commuter train as an Aztec feathered serpent: a long silver train with a stone-carved serpent head and turquoise feathers, "
                    "racing through a tunnel and bursting out over the city, glyph-like patterns along its body.",
    'mercado_24': "a busy neighbourhood mercado on a sunny street: fruit stands piled with mangoes and papayas, a paletero cart, a panaderia "
                  "window full of pan dulce, families shopping, papel picado strung overhead; no words on any sign.",
    'calavera_mariachi': "a mariachi band of calavera skeletons in black and silver charro suits playing trumpets, violins and a big guitarron "
                         "under a full moon, marigold petals swirling.",
    'monarch_migration': "a huge swirl of orange monarch butterflies migrating over hills and rooftops, a girl on a skateboard reaching up to "
                         "them, warm sunset colours.",
    'luchador_abuela': "a tiny grandmother in a lucha libre mask feeding pigeons in a plaza, the pigeons wearing tiny wrestling masks too, "
                       "playful and proud.",
    'maize_mother': "a monumental maize goddess with corn-husk hair and a face of calm strength, holding ears of corn of many colours, "
                    "hummingbirds, sun rays, folk-art patterns.",
    'paletero_rocket': "a paletero ice-cream pushcart turned into a rocket blasting off over the neighbourhood, the vendor waving his bell, "
                       "kids cheering below, paletas flying like stars.",
    'luchador_vs_fog': "a masked luchador wrestling a giant grey fog cloud with a grumpy face on top of the hills, the crowd of neighbours "
                       "cheering from rooftops.",
    'quince_fog': "a quinceanera in a huge ruffled turquoise dress dancing with her family on a hilltop as the fog rolls in, her dress "
                  "turning into waves and flowers.",
    'jaguar_bart': "a jaguar warrior skating down a steep city hill on a skateboard, spotted cape flying, stone temple and Victorian houses "
                   "mixed in the background, bold geometric sun.",
}
LILAC = {
    'fog_whale': "a giant whale made of soft grey fog swimming through the sky over steep hills, a little red cable car riding on its back, "
                 "seagulls trailing behind like a parade, cool blues against a warm sunset.",
    'taco_planets': "a cosmic scene of tacos as planets with rings of salsa orbiting a glowing golden burrito sun, comets of lime wedges, "
                    "a tiny astronaut skateboarder surfing between them.",
    'skate_owl': "a great horned owl in a hoodie carving a deep empty swimming pool at night, its wings spread for balance, the moon "
                 "behind it, stars like sparks off its board.",
    'parrot_canopy': "a flock of bright green wild parrots with red heads bursting out of a lush tree canopy over a hilltop tower, "
                     "flowers and leaves everywhere, joyful and loud.",
    'sealion_brass': "a brass band of sea lions on floating docks playing trumpets, a tuba and drums, the bay sparkling, a fishing boat "
                     "and gulls dancing along.",
    'domino_stoop': "grandparents playing dominoes on the stoop of a colourful Victorian house, a giant orange cat watching from the "
                    "window, kids on skateboards rolling past, warm afternoon light.",
    'lantern_dragon': "a dragon dance at a lantern-lit night market, the long dragon made of a hundred glowing paper lanterns weaving "
                      "between food stalls, sparks and steam, red and gold.",
    'tile_wave': "surfers riding a huge wave made of patterned ceramic tiles in blues and whites, the sun as a painted plate, folk-art "
                 "fish leaping out of the curl.",
    'coyote_moon': "a coyote howling at a huge full moon from a rocky hilltop above the sleeping city, its howl turning into swirls of "
                   "stars and wildflowers.",
    'hummingbird_crew': "a crew of hummingbirds riding tiny skateboards through a garden of giant flowers, motion lines and petals, "
                        "jewel colours.",
    'garden_robot': "a friendly boxy robot with a watering can tending a community garden full of tomatoes, sunflowers and chilies, "
                    "neighbours of every age working beside it.",
    'muni_mariachi': "a mariachi band playing on the roof of a moving vintage streetcar with no logos, the street below dancing, "
                     "papel picado strung from the trolley wire.",
}
SETS = {'clarion': (MURALS, ROOT / 'assets/real/city/murals.jpg'), 'balmy': (BALMY, ROOT / 'assets/real/city/murals-balmy.jpg'),
        'lilac': (LILAC, ROOT / 'assets/real/city/murals-lilac.jpg')}
NAMES = list(MURALS)




def gen(name, k, prompts=MURALS):
    body = {'model': 'gpt-image-2', 'prompt': STYLE + prompts[name], 'size': '1536x1024', 'quality': 'high', 'output_format': 'png', 'n': 1}
    req = urllib.request.Request('https://api.openai.com/v1/images/generations', data=json.dumps(body).encode(),
                                 headers={'Authorization': f'Bearer {k}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=400) as r: d = json.load(r)
    except urllib.error.HTTPError as e:
        return f'{name}: HTTP {e.code} {e.read().decode()[:300]}'
    except Exception as e:   # noqa: BLE001 (network)
        return f'{name}: {e}'
    SRC.mkdir(parents=True, exist_ok=True)
    (SRC / f'{name}.png').write_bytes(base64.b64decode(d['data'][0]['b64_json']))
    return f'{name}: ok'


def pack(names=NAMES, atlas_path=ATLAS):
    from PIL import Image
    cols, rows, W, H = 3, 4, 3072, 3072
    tw, th = W // cols, H // rows
    atlas = Image.new('RGB', (W, H), (40, 40, 40))
    for i, name in enumerate(names):
        im = Image.open(SRC / f'{name}.png').convert('RGB').resize((tw, th), Image.LANCZOS)
        atlas.paste(im, ((i % cols) * tw, (i // cols) * th))
    atlas_path.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(atlas_path, quality=82, optimize=True, progressive=True)
    print(atlas_path, atlas_path.stat().st_size // 1024, 'KB')


if __name__ == '__main__':
    args = sys.argv[1:]
    cmd = args.pop(0) if args else 'gen'
    which = 'clarion'
    if args[:1] == ['--set']: which = args[1]; args = args[2:]
    prompts, atlas_path = SETS[which]
    if cmd == 'pack':
        pack(list(prompts), atlas_path)
    else:
        names = args or list(prompts)
        k = key()
        with cf.ThreadPoolExecutor(6) as ex:
            for msg in ex.map(lambda n: gen(n, k, prompts), names): print(msg, flush=True)
