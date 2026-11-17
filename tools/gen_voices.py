#!/usr/bin/env python3
"""Generate the spoken lines in data/voices.json with OpenAI text to speech (optional; needs OPENAI_API_KEY).

    python3 tools/gen_voices.py            # every line without an mp3 yet
    python3 tools/gen_voices.py <id> ...   # these lines, overwriting
Writes assets/sound/voice/<id>.mp3 (mono, 48 kbps, silence trimmed, through ffmpeg). The text and the voice's
instructions in data/voices.json are the source of truth; the audio is AI-generated. The story's lines come from
data/missions.json (every step's lines, say, done, each, waiting and passed, every mission's fail lines), the odd jobs' from
data/jobs.json (the boards' hosts, the gigs' clients) and the cast's chatter from data/cast.json, each said in its speaker's voice (data/cast.json voice); their lengths are measured by the client.
"""
import json, subprocess, sys, tempfile, urllib.request, concurrent.futures as cf
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from openai_key import key  # noqa: E402  (OPENAI_API_KEY)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/sound/voice'
MODEL = 'gpt-4o-mini-tts'
# Silence off both ends (the speech starts when the event happens), leaving 60 ms of tail.
TRIM = 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,asetpts=N/SR/TB,apad=pad_dur=0.06'


def gen(line_id, line, voice, k):
    body = json.dumps({'model': MODEL, 'voice': voice['tts'], 'input': line.get('say', line['text']), 'instructions': voice['instructions'], 'response_format': 'mp3'}).encode()
    req = urllib.request.Request('https://api.openai.com/v1/audio/speech', body, {'Authorization': f'Bearer {k}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r, tempfile.NamedTemporaryFile(suffix='.mp3') as raw:
        raw.write(r.read()); raw.flush()
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-i', raw.name, '-af', TRIM, '-ac', '1', '-ar', '24000', '-b:a', '48k', str(OUT / f'{line_id}.mp3')], check=True)
    return line_id

def story_lines():
    """The missions' and the cast's lines (data/missions.json, data/cast.json), as voices.json lines: id -> voice, text, say."""
    cast = json.loads((ROOT / 'data/cast.json').read_text())['cast']
    voice = {c['id']: c['voice'] for c in cast}
    out = {}
    def add(l): out[l['id']] = {'voice': voice[l['who']], 'text': l['text'], **({'say': l['say']} if 'say' in l else {})}
    for c in cast:
        for l in c.get('chatter', []) + c.get('post', []): add(l)
    for m in json.loads((ROOT / 'data/missions.json').read_text())['missions']:
        for ls in m.get('fail', {}).values():
            for l in ls: add(l)
        for st in m['steps']:
            for k in ('lines', 'say', 'done', 'each', 'waiting', 'passed'):
                for l in st.get(k, []): add(l)
    # The odd jobs' lines (data/jobs.json): the boards' hosts and the gigs' clients.
    J = json.loads((ROOT / 'data/jobs.json').read_text())
    for b in J['boards']:
        add(b['hello']); add(b['empty'])
    for k, roles in (('deliver', ('say', 'done', 'late')), ('carry', ('say', 'ride', 'done')), ('photo', ('say', 'done')), ('race', ('say', 'done', 'won'))):
        for c in J[k]['clients']:
            for r in roles: add(c[r])
    # The vignettes' lines (data/vignettes.json): each says its own voice.
    for vg in json.loads((ROOT / 'data/vignettes.json').read_text())['vignettes']:
        for l in vg.get('lines', []): out[l['id']] = {'voice': l['voice'], 'text': l['text']}
    return out

def main():
    d = json.loads((ROOT / 'data/voices.json').read_text())
    lines = {**d['lines'], **story_lines()}
    OUT.mkdir(parents=True, exist_ok=True)
    ids = sys.argv[1:] or [i for i in lines if not (OUT / f'{i}.mp3').exists()]
    unknown = [i for i in ids if i not in lines]
    if unknown: sys.exit(f'unknown line ids: {unknown}')
    k = key()
    with cf.ThreadPoolExecutor(6) as ex:
        for done in ex.map(lambda i: gen(i, lines[i], d['voices'][lines[i]['voice']], k), ids):
            print('wrote', done)
    # Each voices.json line's length, for captions in clips (they have no audio buffers to measure).
    for i in [i for i in ids if i in d['lines']]:
        out = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(OUT / f'{i}.mp3')], capture_output=True, text=True, check=True).stdout
        d['lines'][i]['seconds'] = round(float(out), 2)
    (ROOT / 'data/voices.json').write_text(json.dumps(d, indent=2, ensure_ascii=False) + '\n')

if __name__ == '__main__':
    main()
