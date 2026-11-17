#!/usr/bin/env python3
"""Key the flat magenta background out of generated UI art (gpt-image-2 has no
transparent output) and write web-sized PNGs to assets/ui/.

    python3 tools/key_ui.py [name ...]     # default: every assets/ui/src/*.png
Only magenta connected to the image border is removed (flood fill), so magenta-ish
pixels inside the artwork survive; the edge gets a soft alpha and the pink fringe is
pulled back toward neutral.
"""
import sys
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
SRC, OUT = ROOT / 'assets/ui/src', ROOT / 'assets/ui'
MAX = {'logo': 1200}

def key(path: Path):
    im = np.asarray(Image.open(path).convert('RGB')).astype(np.float32)
    r, g, b = im[..., 0], im[..., 1], im[..., 2]
    # magenta-ness: red and blue high, green low
    m = np.clip(((r + b) / 2 - g - 60) / 120, 0, 1)
    if m[:4].mean() < 0.5 and m[:, :4].mean() < 0.5:      # already has no magenta background
        alpha = np.full(r.shape, 255, np.uint8)
    else:
        hard = Image.fromarray(((m > 0.35) * 255).astype(np.uint8)).copy()   # fromarray images are read-only views
        h, w = r.shape
        for seed in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)] + [(x, 0) for x in range(0, w, 64)] + [(x, h - 1) for x in range(0, w, 64)]:
            if hard.getpixel(seed) == 255: ImageDraw.floodfill(hard, seed, 128)
        # plus enclosed holes (between legs, inside handles): pure magenta never appears in the art
        bg = (np.asarray(hard) == 128) | (m > 0.85)
        # soft edge: inside a 2 px band around the background, alpha follows magenta-ness
        band = np.asarray(Image.fromarray(bg.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(5))) > 0
        alpha = np.where(bg, 0, np.where(band, (1 - m) * 255, 255)).astype(np.uint8)
        # despill: pull magenta tint out of edge pixels
        wide = np.asarray(Image.fromarray(bg.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(9))) > 0
        tint = wide & ((r + b) / 2 > g + 8)
        im[..., 0] = np.where(tint, g + (r - g) * 0.15, r); im[..., 2] = np.where(tint, g + (b - g) * 0.15, b)
    rgba = np.dstack([np.clip(im, 0, 255).astype(np.uint8), alpha])
    out = Image.fromarray(rgba)
    bbox = out.getchannel('A').point(lambda v: 255 if v > 8 else 0).getbbox()
    if bbox: out = out.crop((max(0, bbox[0] - 6), max(0, bbox[1] - 6), min(out.width, bbox[2] + 6), min(out.height, bbox[3] + 6)))
    lim = MAX.get(path.stem, 512)
    out.thumbnail((lim, lim), Image.Resampling.LANCZOS)
    OUT.mkdir(parents=True, exist_ok=True)
    out.save(OUT / f'{path.stem}.png', optimize=True)
    return f'{path.stem}: {out.width}x{out.height}'

if __name__ == '__main__':
    names = sys.argv[1:]
    files = [SRC / f'{n}.png' for n in names] if names else sorted(SRC.glob('*.png'))
    for f in files: print(key(f))
