#!/usr/bin/env python3
"""Check generated voice lines by transcribing them back (OpenAI speech to text; optional, needs OPENAI_API_KEY).

    python3 tools/check_voices.py              # every story and cast line (data/missions.json, data/cast.json)
    python3 tools/check_voices.py <id> ...     # these lines (voices.json ids too)
Prints each line whose transcript differs from its text by more than a few words, with the word match (0..1).
"""
import difflib, json, re, subprocess, sys, concurrent.futures as cf
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from gen_voices import ROOT, OUT, key, story_lines  # noqa: E402

MODEL = 'gpt-4o-mini-transcribe'

def words(t):
    t = t.lower().replace('-', ' ')
    t = re.sub(r"[^a-z0-9' ]+", ' ', t)
    return [w.strip("'") for w in t.split() if w.strip("'")]

def transcribe(line_id, k):
    # The key goes in through stdin (curl -H @-), never in the arguments, so no error or process list shows it.
    for _ in range(3):
        r = subprocess.run(['curl', '-s', '--retry', '2', 'https://api.openai.com/v1/audio/transcriptions', '-H', '@-',
                            '-F', f'file=@{OUT / (line_id + ".mp3")}', '-F', f'model={MODEL}', '-F', 'language=en'], input=f'Authorization: Bearer {k}\n', capture_output=True, text=True)
        if r.returncode == 0:
            try: return json.loads(r.stdout).get('text', '')
            except json.JSONDecodeError: pass
    return f'(no transcript: curl failed for {line_id})'

def main():
    d = json.loads((ROOT / 'data/voices.json').read_text())
    lines = {**d['lines'], **story_lines()}
    ids = sys.argv[1:] or list(story_lines())
    k = key()
    bad = 0
    with cf.ThreadPoolExecutor(8) as ex:
        for i, heard in zip(ids, ex.map(lambda i: transcribe(i, k), ids)):
            want = lines[i].get('say', lines[i]['text'])
            r = difflib.SequenceMatcher(None, words(want), words(heard)).ratio()
            if r < 0.9:
                bad += 1
                print(f'{i}  {r:.2f}\n  want: {want}\n  got:  {heard}')
    print(f'{len(ids) - bad}/{len(ids)} lines match their text')

if __name__ == '__main__':
    main()
