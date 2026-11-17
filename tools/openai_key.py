"""The OpenAI API key for the optional art and voice tools (tools/gen_ui.py, gen_murals.py, gen_voices.py,
check_voices.py), from the OPENAI_API_KEY environment variable.

These tools only regenerate files that are already in the repo (assets/ui, assets/real/city/murals*.jpg,
assets/sound/voice). Nothing else in the game or the harness needs a key or a network service.
"""
import os
import sys


def key() -> str:
    k = os.environ.get('OPENAI_API_KEY', '').strip()
    if not k:
        sys.exit('OPENAI_API_KEY is not set. This tool is optional: it regenerates art or voice files that are already in the repo.')
    return k
