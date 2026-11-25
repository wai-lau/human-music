#!/usr/bin/env bash
# Build extension/icons/icon{16,48,128}.png and the store's small promo tile from Wai's logo,
# docs/icon-source.png (1024 px square: a tan #E5BE92 figure on green #4F6F19, 2026-11-25).
# Icons are the square with rounded corners; the 128 px store icon keeps Chrome's 16 px padding.
# Needs python3 with Pillow.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
python3 - "$repo/docs/icon-source.png" "$repo/extension/icons" "${PROMO_OUT:-}" <<'PY'
import sys
from PIL import Image, ImageDraw
src = Image.open(sys.argv[1]).convert("RGBA"); out_dir = sys.argv[2]; promo = sys.argv[3]
W = src.size[0]; S = 4
mask = Image.new("L", (W * S, W * S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, W * S - 1, W * S - 1], radius=int(W * S * 0.22), fill=255)
tile = src.copy(); tile.putalpha(mask.resize((W, W), Image.LANCZOS))
def icon(size, pad):
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0)); n = size - 2 * pad
    c.alpha_composite(tile.resize((n, n), Image.LANCZOS), (pad, pad)); return c
icon(16, 0).save(f"{out_dir}/icon16.png", optimize=True)
icon(48, 0).save(f"{out_dir}/icon48.png", optimize=True)
# The 128 px icon is the store icon: 96 px artwork in 16 px of transparent padding per side
# (developer.chrome.com/docs/webstore/images), since the store draws its own frame around it.
icon(128, 16).save(f"{out_dir}/icon128.png", optimize=True)
if promo:  # small promo tile, 440x280, no text: the logo on its own green
    t = Image.new("RGBA", (440, 280), src.getpixel((4, 4)))
    t.alpha_composite(src.resize((260, 260), Image.LANCZOS), (90, 10))
    t.convert("RGB").save(promo, optimize=True)
PY
ls -l "$repo/extension/icons"
