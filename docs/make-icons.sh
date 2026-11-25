#!/usr/bin/env bash
# Build extension/icons/icon{16,48,128}.png and the store's small promo tile from Wai's icon,
# docs/icon-source.png (the "no" sign over a pixel invader, 1024 px, white background).
# The area outside the red ring becomes transparent; inside stays white.
# Needs python3 with Pillow.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
python3 - "$repo/docs/icon-source.png" "$repo/extension/icons" "${PROMO_OUT:-}" <<'PY'
import sys
from PIL import Image, ImageDraw
src = Image.open(sys.argv[1]).convert("RGBA"); out_dir = sys.argv[2]; promo = sys.argv[3]
W = src.size[0]
row = [src.getpixel((x, W // 2)) for x in range(W)]
left = next(x for x, p in enumerate(row) if p[0] < 250 or p[1] < 250)
right = W - 1 - next(x for x, p in enumerate(reversed(row)) if p[0] < 250 or p[1] < 250)
cx, r, S = (left + right) / 2, (right - left) / 2, 4
mask = Image.new("L", (W * S, W * S), 0)
ImageDraw.Draw(mask).ellipse([(cx - r) * S, (W / 2 - r) * S, (cx + r) * S, (W / 2 + r) * S], fill=255)
art = src.copy(); art.putalpha(mask.resize((W, W), Image.LANCZOS))
art = art.crop((int(cx - r) - 2, int(W / 2 - r) - 2, int(cx + r) + 3, int(W / 2 + r) + 3))
def icon(size, pad):
    c = Image.new("RGBA", (size, size), (0, 0, 0, 0)); n = size - 2 * pad
    c.alpha_composite(art.resize((n, n), Image.LANCZOS), (pad, pad)); return c
icon(16, 0).save(f"{out_dir}/icon16.png", optimize=True)
icon(48, 0).save(f"{out_dir}/icon48.png", optimize=True)
# The 128 px icon is the store icon: 96 px artwork in 16 px of transparent padding per side
# (developer.chrome.com/docs/webstore/images), since the store draws its own frame around it.
icon(128, 16).save(f"{out_dir}/icon128.png", optimize=True)
if promo:  # small promo tile, 440x280, no text: the icon on a dark field
    tile = Image.new("RGBA", (440, 280), (22, 23, 28, 255))
    tile.alpha_composite(art.resize((200, 200), Image.LANCZOS), (120, 40))
    tile.convert("RGB").save(promo, optimize=True)
PY
ls -l "$repo/extension/icons"
