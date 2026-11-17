#!/usr/bin/env python3
"""Generate UI art for SoMa Skate with OpenAI gpt-image-2 (optional; needs OPENAI_API_KEY).

    python3 tools/gen_ui.py <name> [<name> ...]   # names from PROMPTS below; writes assets/ui/src/<name>.png
Re-running a name overwrites it. Prompts are the source of truth for the art; keep them here.
"""
import base64, json, subprocess, sys, urllib.request, concurrent.futures as cf
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from openai_key import key  # noqa: E402  (OPENAI_API_KEY)

OUT = Path(__file__).resolve().parents[1] / 'assets/ui/src'
STICKER = ("Die-cut vinyl sticker illustration with a thick white border and a soft drop shadow, bold black ink outlines, "
           "flat colour with subtle screen-print grain, palette: International Orange #FF4F00, warm cream, fog grey, black, a little teal #1FA5A0. "
           "Playful 1990s skate-zine energy made modern and clean. Single object centred, isolated on a fully transparent background, no text unless asked.")
PROMPTS = {
    'logo': "A bold skateboard video game logo wordmark that reads exactly 'SOMA SKATE' (two words, all caps, spelled S-O-M-A S-K-A-T-E). "
            "Chunky italic letters leaning forward with speed lines, International Orange #FF4F00 fill, thick black outline, cream inner highlight, "
            "a small skateboard underlining the words and a tiny fog cloud and freeway overpass silhouette tucked behind. "
            "Die-cut sticker with a thick white border, transparent background, crisp vector look, nothing else in the image.",
    'burrito': STICKER + " A giant foil-wrapped Mission-style burrito riding a skateboard, cheerful face, sunglasses.",
    'karl': STICKER + " Karl the Fog: a fluffy grey fog cloud character with cool sunglasses and a smug grin, holding a skateboard.",
    'muni': STICKER + " A cute San Francisco Muni streetcar (generic red and cream vintage streetcar, no logos) doing a kickflip, motion lines.",
    'pigeon': STICKER + " A tough city pigeon wearing a backwards cap, standing on a skateboard, attitude.",
    'robotaxi': STICKER + " A white self-driving robotaxi car with a spinning roof sensor, confused cartoon face on the windshield, a traffic cone on its hood. Generic, no brand logos.",
    'hella': "A die-cut vinyl sticker with a thick white border that reads exactly 'HELLA' in fat bubbly graffiti letters, International Orange #FF4F00 with black outline and cream shine, small sparkles. Transparent background, nothing else.",
    'sick': "A die-cut vinyl sticker with a thick white border: a jagged comic starburst in electric yellow with an International Orange outline that reads exactly 'SICK!' in heavy black italic letters. Transparent background, nothing else.",
    'slam': "A die-cut vinyl sticker with a thick white border: a cracked jagged comic burst in red and black that reads exactly 'SLAMMED' in heavy cream italic letters with a black outline, a few cartoon stars. Transparent background, nothing else.",
    'cablecar': STICKER + " A classic San Francisco cable car (generic, no logos) climbing a steep hill, a tiny skater bombing down past it.",
    'victorian': STICKER + " A colourful San Francisco Victorian row house (painted-lady style) with a skateboard leaning on the steps.",
    'graduate': STICKER + " Karl the Fog, the same fluffy grey fog cloud character with teal sunglasses, a smug grin and black-and-cream sneakers, wearing a black graduation mortarboard cap with an International Orange tassel, holding a rolled diploma tied with an orange ribbon in one hand and a skateboard in the other.",
    'ferry': STICKER + " The San Francisco Ferry Building's clock tower (generic, no text, no logos) with a cheerful clock face, a skateboard leaning against its base, a seagull on top and a little wave of bay water at the bottom.",
    'sealion': STICKER + " A chunky, funny California sea lion from the Pier 39 docks riding a skateboard: glossy brown body with a pale tan belly, long white whiskers, big dark eyes, a dog-like snout with a black nose, front flippers spread out for balance, rear flippers planted on the deck, a little white skipper's cap with a navy band and a gold anchor badge cocked on its head, mouth open mid-bark.",
    # The open world's cast (docs/open-world.md): dialogue portraits, head and shoulders, each with its one trait.
    'cast-chad': STICKER + " Head-and-shoulders portrait of Chad Vantage, a smug, cheerful San Francisco tech landlord: blond side-parted hair, big confident smile, a grey fleece vest over a crisp light-blue shirt, holding up a glowing tablet like a pitch deck. Generic, no logos.",
    'cast-biglou': STICKER + " Head-and-shoulders portrait of Big Lou, a big, warm, bald ex-pro skater who runs a skate shop: bushy grey beard and moustache, a faded black band tee under a tan canvas shop apron with pens in the pocket, a black knee brace visible as he props one leg up, grinning mid-story.",
    'cast-marisol': STICKER + " Head-and-shoulders portrait of Marisol, a perfectionist skate filmer: backwards black cap, long dark ponytail, red hoodie, one eye squinting behind a chunky 1990s camcorder with a huge bulging fisheye lens pointed at the viewer, unimpressed expression.",
    'cast-gloria': STICKER + " Head-and-shoulders portrait of Gloria, a strict city hall permit clerk: grey hair in a bun with a pencil through it, red cat-eye glasses on a gold bead chain, mauve cardigan, holding up a big red rubber stamp, one eyebrow raised over the glasses.",
    'cast-grandmawu': STICKER + " Head-and-shoulders portrait of Grandma Wu, the fastest grandma in San Francisco: grey curly perm, a green see-through sun visor, round glasses, a quilted green vest over a flowery blouse, gripping the handle of a folding shopping cart full of bok choy and oranges, competitive grin.",
    'cast-brayden': STICKER + " Head-and-shoulders portrait of Brayden, an e-scooter startup bro: swoopy brown fringe, white wireless earbuds, sunglasses pushed up in his hair, a navy quarter-zip, one hand on the handlebar of a lime-green electric scooter, finger-gun pose. Generic, no logos.",
    'cast-sal': STICKER + " Head-and-shoulders portrait of Sal, a San Francisco cable car gripman: navy uniform jacket with brass buttons, a navy conductor's cap with a brass band, a thick grey-black moustache, leather gloves gripping a tall steel grip lever with a wooden handle, grumpy but proud. Generic, no logos.",
    'cast-dolores': STICKER + " Head-and-shoulders portrait of Dolores, a calm Muni streetcar operator: short dark curls under a navy operator's cap with a red band, navy uniform jacket with red piping, pale blue shirt, checking a big wristwatch with serene half-closed eyes, a travel mug in the other hand. Generic, no transit logos.",
    'cast-unit7': STICKER + " Unit 7, a white self-driving robotaxi car becoming sentient: a spinning roof sensor, and a big expressive cartoon face glowing on its windshield screen (huge round eyes, raised eyebrows, hopeful smile), a skateboard leaning against its bumper. Generic, no brand logos.",
    'tape': "A torn strip of matte cream masking tape, slightly translucent, isolated on a fully transparent background, photographed flat, no text.",
    # The story's cast (data/cast.json sticker): dialogue portraits and map icons, head and shoulders, in the same sticker family
    # (the cast people use their cast-* portraits above, drawn from their 3D models).
    'rosa': STICKER + " Head-and-shoulders portrait of Rosa, a deadpan teenage skater girl: half-lidded unimpressed eyes, flat mouth, black hoodie with the hood half up over a beanie, arms crossed over a worn skateboard held upright.",
    'kenji': STICKER + " Head-and-shoulders portrait of Kenji, a sunny laid-back Japanese-American surfer skater: shaggy sun-bleached hair, faded tee, looking around confused with empty hands, a seagull feather stuck in his hair.",
    'hector': STICKER + " Head-and-shoulders portrait of Hector, a proud middle-aged taqueria owner with a big moustache and a white apron, cradling a giant foil-wrapped burrito like a newborn baby.",
    'tash': STICKER + " Head-and-shoulders portrait of Tash, a chill art-school skater girl with a buzzcut and paint-stained overalls, filming on an old flip phone held out sideways.",
    'donna': STICKER + " Head-and-shoulders portrait of Donna, a fabulous older roller-disco diva: huge silver afro, sequined jumpsuit, star-shaped sunglasses, one arm raised in a disco pose, roller skates slung over a shoulder.",
    'bev': STICKER + " Head-and-shoulders portrait of Bev, a proud older crossing guard in a high-visibility vest and a rainbow scarf, holding a blank red octagonal stop paddle like a microphone, striking a runway pose.",
    'skye': STICKER + " Head-and-shoulders portrait of Skye, a young influencer with big sunglasses pushed up on the head and an oversized trendy jacket, holding a phone on a selfie stick, making a peace sign and a pout.",
    'marge': STICKER + " Head-and-shoulders portrait of Marge, a suspicious no-nonsense chowder vendor in a striped apron and a hairnet, holding a bread bowl of chowder protectively, glaring sideways at an unseen seagull.",
    # Story phase 2: chapter 3's Dre and the new side and tiny stories' characters.
    'dre': STICKER + " Head-and-shoulders portrait of Dre, a trash-talking young Bayview skater: fitted cap turned to the side, gap-toothed grin, pointing straight at the viewer, oversized tee, a skateboard on his shoulder.",
    'rocco': STICKER + " Head-and-shoulders portrait of Rocco, a skinny old North Beach beat poet: black beret, black turtleneck, round sunglasses, goatee, holding a battered notebook and a pencil to his chin, dreamy.",
    'nonna': STICKER + " Head-and-shoulders portrait of Nonna Gia, a tiny fierce Italian grandmother café owner: grey bun, apron, holding a steaming espresso cup on a saucer, one eyebrow raised.",
    'vito': STICKER + " Head-and-shoulders portrait of Vito, a dapper old Italian bocce player: flat cap, cardigan, white moustache, holding a bocce ball, unimpressed squint.",
    'mo': STICKER + " Head-and-shoulders portrait of Mo, a sturdy cable car brakeman: Muni-style conductor cap (no logos), work gloves, holding a heavy brake lever, worried look downhill.",
    'fitch': STICKER + " Head-and-shoulders portrait of Mrs. Fitch, a stern elderly Russian Hill gardener: sun hat, floral gardening gloves, holding pruning shears and a single blue hydrangea, glaring.",
    'gus': STICKER + " Head-and-shoulders portrait of Gus, a Fisherman's Wharf living-statue street performer painted entirely silver, frozen mid-pose with one hand raised, a tip bucket at his feet, eyes sideways.",
    'steve': STICKER + " Head-and-shoulders portrait of Steve, a scruffy San Francisco seagull with a smug face, a french fry in his beak and a stolen paper fry boat under one wing.",
    'kenny': STICKER + " Head-and-shoulders portrait of Kenny, a cheerful young lion dance troupe leader in a red and gold sash, holding a drumstick, a lion dance head (red, gold, fuzzy) beside him.",
    'mei': STICKER + " Head-and-shoulders portrait of Auntie Mei, a warm but bossy dim sum cart auntie in a quilted vest, holding a bamboo steamer with steam rising, pointing a finger.",
    'trent': STICKER + " Head-and-shoulders portrait of Trent, a frantic young finance bro in a quarter-zip fleece and AirPods, clutching a laptop to his chest, sweating, looking at his smartwatch.",
    'june': STICKER + " Head-and-shoulders portrait of Farmer June, a sunburnt cheerful stone-fruit farmer in overalls and a straw hat, holding a wooden crate overflowing with peaches.",
    'vinny': STICKER + " Head-and-shoulders portrait of Vinny, a big tough city pigeon in a pinstripe vest and a tiny fedora, Union Square mob boss attitude, a breadcrumb tucked behind one ear.",
    'tiffany': STICKER + " Head-and-shoulders portrait of Tiffany, a glamorous shopaholic in big sunglasses and a fur-trimmed coat, arms loaded with shopping bags (no logos), mid-sigh.",
    'xochitl': STICKER + " Head-and-shoulders portrait of Xochitl, a young Chicana muralist with paint-splattered overalls and a bandana, holding a paintbrush and a spray can, squinting at the viewer like a model.",
    'beto': STICKER + " Head-and-shoulders portrait of Don Beto, a round jolly Mexican baker in a white cap and apron, holding up a pink concha pastry like a trophy.",
    'memo': STICKER + " Head-and-shoulders portrait of Tio Memo, a proud older lowrider owner in a pressed flannel shirt and sunglasses, leaning on the chrome hood of a candy-red lowrider car (no logos), arms crossed.",
    'ramon': STICKER + " Head-and-shoulders portrait of Don Ramon, a mariachi band leader in a black charro suit with silver buttons and a big sombrero, holding a guitarron, tapping his foot.",
    'lupita': STICKER + " Head-and-shoulders portrait of Lupita, a stressed young paleta vendor pushing a small white paleta cart, holding a melting mango paleta, alarmed.",
    'rosaura': STICKER + " Head-and-shoulders portrait of Abuela Rosaura, a tiny stern Mexican grandmother in a cardigan and house dress, holding one sandal (a chancla) raised like a weapon.",
    'priya': STICKER + " Head-and-shoulders portrait of Priya, a frazzled young dog walker tangled in nine leashes, holding three frisbees, a corgi at her feet looking guilty.",
    'ezra': STICKER + " Head-and-shoulders portrait of Ezra, a hip young kombucha brewer with a man bun and a cardigan, cradling a big glass jar of kombucha with a floating scoby like a baby.",
    'gravity': STICKER + " Head-and-shoulders portrait of Dr. Gravity, an eccentric physics professor with wild white hair, lab coat and clipboard, holding an apple, peering through safety goggles.",
    'dez': STICKER + " Head-and-shoulders portrait of Dez, a laid-back record store clerk with headphones round the neck and a vintage band tee (no text), holding a vinyl record sleeve, half-asleep eyes.",
    'philippa': STICKER + " Head-and-shoulders portrait of Philippa, a severe art critic with a sleek black bob, giant statement glasses and a black turtleneck, holding a tiny espresso and judging the viewer.",
    # The abundance pass, round 2: Lower Haight, Chinatown, Telegraph Hill and the north Embarcadero.
    'benny': STICKER + " Head-and-shoulders portrait of Benny, a frazzled, friendly sandwich shop owner with a pencil behind his ear and a deli apron, holding up a huge overstuffed sandwich with a tiny handwritten name flag (no readable text).",
    'juniper': STICKER + " Head-and-shoulders portrait of Juniper, a sardonic young bike messenger with a cycling cap flipped up, a messenger bag strap across the chest and a padded envelope in hand, one eyebrow raised.",
    'lau': STICKER + " Head-and-shoulders portrait of Mr. Lau, an elderly Chinese-American fortune cookie writer in a cardigan and reading glasses, holding a fortune cookie and a tiny paper slip (no readable text), dry weary look.",
    'pistachio': STICKER + " Head-and-shoulders portrait of Pistachio, a wild cherry-headed conure parrot of Telegraph Hill: bright green feathers, red face, beak wide open mid-squawk, very full of itself.",
    'herb': STICKER + " Head-and-shoulders portrait of Herb, a cheerful retiree tourist from Ohio in a souvenir fog hoodie (no text), a cruise lanyard and a sun visor, grinning and pointing at something off to the side.",
    'bernadette': STICKER + " Head-and-shoulders portrait of Bernadette, a chipper, frazzled tour guide in a windbreaker, holding a small tour flag on a pole high above her head, the other hand on her hip.",
    # Story phase 3: the Board of Supervisors at the jam.
    'okafor': STICKER + " Head-and-shoulders portrait of Supervisor Okafor, a tired, dignified Black woman in her fifties who chairs a city council: tailored blazer, reading glasses on a chain, a thick binder of permits under one arm, a gavel in the other hand, one eyebrow raised.",
    'pham': STICKER + " Head-and-shoulders portrait of Supervisor Pham, an eager Vietnamese-American city councilman in his thirties: suit jacket over a hoodie, lanyard with a blank badge, giving an awkward but enthusiastic shaka, a skateboard sticker on his laptop (no text).",
    'delgado': STICKER + " Head-and-shoulders portrait of Supervisor Delgado, a cautious Latina city councilwoman in her forties: neat bob, pearl earrings, holding a clipboard of waivers and a bicycle helmet out toward the viewer, worried smile.",
    # Story phase 3, pacing: tiny stories in the streets that had none nearby.
    'jasper': STICKER + " Head-and-shoulders portrait of Jasper, a mellow sun-baked slackliner in Dolores Park: long messy hair, bare feet tucked up, holding a coiled slackline strap, grass in his hair, serene half-smile.",
    'gideon': STICKER + " Head-and-shoulders portrait of Gideon, an exhausted Noe Valley dad: fleece vest, baby carrier straps, dark circles under his eyes, one finger to his lips going shh, the handle of a twin stroller in the other hand.",
    'misty': STICKER + " Head-and-shoulders portrait of Misty, a sulky, theatrical fog cloud with a soft grey face and a tiny beret, wisps for hair, looking down her nose, cousin of a smug fog cloud character.",
    'walter': STICKER + " Head-and-shoulders portrait of Walter, a patient old man waiting for a streetcar: tweed cap, cardigan, holding a wrapped sandwich and a paper transit schedule, wry calm smile.",
    'lorraine': STICKER + " Head-and-shoulders portrait of Lorraine, a frazzled woman in a raincoat holding an empty dog leash and a single shoe, a smug pug in a tiny bow tie peeking from her tote bag.",
    'ruth': STICKER + " Head-and-shoulders portrait of Ruth, a calm grandmotherly beekeeper at a farmers market: straw hat with a veil pushed back, holding up a jar of golden honey, one cartoon bee on her shoulder.",
    'haverford': STICKER + " Head-and-shoulders portrait of Mrs. Haverford, a polished, over-involved mother of the bride: pearls, a big hat with a flower, a clipboard and a tissue, pointing like a film director.",
    'lev': STICKER + " Head-and-shoulders portrait of Lev, a sly old speed-chess hustler: flat cap, scarf, stubble, holding a chess knight between two fingers, a paper coffee cup in the other hand, knowing smirk.",
    'kevin': STICKER + " Head-and-shoulders portrait of Kevin, a cheerful garbage truck driver with a surfer's grin: hi-vis green work shirt, work gloves, a skateboard under one arm, one ankle wrapped in a bandage, thumbs up.",
    'bjorn': STICKER + " Head-and-shoulders portrait of Bjorn, a delighted Swedish tourist: tall, blond beard, bucket hat, a huge unfolded paper map held upside down, a camera round his neck, pointing confidently at the wrong thing.",
    'chela': STICKER + " Head-and-shoulders portrait of Doña Chela, a warm, sharp Mexican grandmother churro vendor: apron, gold hoop earrings, holding a paper cone of churros, one eyebrow raised, a small cart behind her.",
}


MODEL = 'gpt-image-2'
# gpt-image-2 has no transparent output: draw on flat magenta and key it out (key.py).
KEYED = ' Instead of transparency, put the sticker on a perfectly flat, uniform pure magenta (#FF00FF) background with no gradient, no shadow on the background and no magenta anywhere in the artwork.'

def gen(name, k, model=None, suffix=''):
    model = model or MODEL
    transparent = model != 'gpt-image-2'
    prompt = PROMPTS[name] if transparent else PROMPTS[name].replace('on a fully transparent background', '').replace('Transparent background', '').replace('transparent background', '') + KEYED
    body = {'model': model, 'prompt': prompt, 'size': '1536x1024' if name == 'logo' else '1024x1024', 'quality': 'high', 'output_format': 'png', 'n': 1}
    if transparent: body['background'] = 'transparent'
    req = urllib.request.Request('https://api.openai.com/v1/images/generations', data=json.dumps(body).encode(), headers={'Authorization': f'Bearer {k}', 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=300) as r: d = json.load(r)
    except urllib.error.HTTPError as e:
        return f'{name}: HTTP {e.code} {e.read().decode()[:300]}'
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f'{name}{suffix}.png').write_bytes(base64.b64decode(d['data'][0]['b64_json']))
    return f'{name}{suffix}: ok ({model})'

if __name__ == '__main__':
    names = sys.argv[1:] or list(PROMPTS)
    k = key()
    with cf.ThreadPoolExecutor(6) as ex:
        for msg in ex.map(lambda n: gen(n, k), names): print(msg, flush=True)
