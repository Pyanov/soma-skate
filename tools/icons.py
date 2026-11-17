#!/usr/bin/env python3
"""App icons for the installable build (the web app manifest, public/manifest.webmanifest), from the wordmark
(docs/art-direction.md): SOMA over SKATE in Archivo Expanded Black, paper on ink, the accent's progress line
under it. The font is the game's own (assets/fonts/Archivo-Variable.woff2, instanced at width 125, weight 900
with fontTools):

    python3 tools/icons.py        # writes assets/icons/*.png

any: the wordmark across most of the square; maskable: the same inside the middle 70% (the safe zone
launchers may crop to a circle); apple-touch-icon 180; the favicons 32 and 64 are an S with the line (the
whole wordmark does not read that small).
"""
import io
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/icons'
INK, PAPER, ACCENT = (11, 11, 12, 255), (242, 239, 232, 255), (255, 79, 31, 255)

def font_bytes() -> bytes:
    f = TTFont(ROOT / 'assets/fonts/Archivo-Variable.woff2')
    f.flavor = None
    inst = instancer.instantiateVariableFont(f, {'wdth': 125, 'wght': 900})
    buf = io.BytesIO(); inst.save(buf); return buf.getvalue()

FONT = font_bytes()

def wordmark(size: int, box: float) -> Image.Image:
    """The stacked wordmark, left-aligned, filling box (a share of the square) across, centred, the line under it."""
    im = Image.new('RGBA', (size, size), INK)
    d = ImageDraw.Draw(im)
    w = size * box
    # The type size that sets SKATE (the wider word) at the box's width.
    px = 100
    f = ImageFont.truetype(io.BytesIO(FONT), px)
    px = int(px * w / d.textlength('SKATE', font=f))
    f = ImageFont.truetype(io.BytesIO(FONT), px)
    lead = px * 0.86
    line = max(1, round(size * 0.02))
    block_h = lead + px * 0.74 + line * 4
    x0 = (size - w) / 2
    y0 = (size - block_h) / 2
    for i, word in enumerate(['SOMA', 'SKATE']):
        top = f.getbbox(word)[1]
        d.text((x0, y0 + i * lead - top), word, font=f, fill=PAPER)
    ly = y0 + lead + px * 0.74 + line * 3
    d.rectangle([x0, ly, x0 + w * 0.62, ly + line - 1], fill=ACCENT)
    return im

def letter(size: int) -> Image.Image:
    im = Image.new('RGBA', (size, size), INK)
    d = ImageDraw.Draw(im)
    f = ImageFont.truetype(io.BytesIO(FONT), int(size * 0.78))
    l, t, r, b = d.textbbox((0, 0), 'S', font=f)
    x, y = (size - (r - l)) / 2 - l, (size - (b - t)) / 2 - t - size * 0.06
    d.text((x, y), 'S', font=f, fill=PAPER)
    line = max(2, round(size * 0.07))
    d.rectangle([size * 0.2, size * 0.86, size * 0.8, size * 0.86 + line - 1], fill=ACCENT)
    return im

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for n in (192, 512):
        wordmark(n, 0.78).save(OUT / f'icon-{n}.png')
        wordmark(n, 0.56).save(OUT / f'icon-maskable-{n}.png')
    wordmark(180, 0.78).convert('RGB').save(OUT / 'apple-touch-icon.png')
    for n in (32, 64):
        letter(n).save(OUT / f'favicon-{n}.png')
    print('assets/icons: icon-192, icon-512, maskable 192 and 512, apple-touch-icon, favicon 32 and 64')

if __name__ == '__main__':
    main()
