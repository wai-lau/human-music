#!/usr/bin/env bash
# Render docs/icon.svg to extension/icons/icon{16,48,128}.png.
# Needs Chrome (headless, here the Windows build under WSL) and python3 with Pillow.
set -euo pipefail
repo=$(cd "$(dirname "$0")/.." && pwd)
chrome=${CHROME:-"/mnt/c/Program Files/Google/Chrome/Application/chrome.exe"}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/hm-icons.XXXXXX")
trap 'rm -rf "$tmp"' EXIT

cp "$repo/docs/icon.svg" "$tmp/icon.svg"
printf '<!doctype html><body style="margin:0;background:transparent"><img src="icon.svg" width="512" height="512" style="display:block"></body>' > "$tmp/page.html"

win() { if command -v wslpath >/dev/null; then wslpath -w "$1"; else echo "$1"; fi; }
"$chrome" --headless=new --disable-gpu --hide-scrollbars --default-background-color=00000000 \
  --window-size=512,512 --screenshot="$(win "$tmp/big.png")" "file:///$(win "$tmp/page.html" | tr '\\' /)" 2>/dev/null

mkdir -p "$repo/extension/icons"
python3 - "$tmp/big.png" "$repo/extension/icons" <<'EOF'
import sys
from PIL import Image
big = Image.open(sys.argv[1]).convert("RGBA")
for size in (16, 48):
    big.resize((size, size), Image.LANCZOS).save(f"{sys.argv[2]}/icon{size}.png", optimize=True)
# The 128 px icon is the store icon: 96 px artwork in 16 px of transparent padding per side
# (developer.chrome.com/docs/webstore/images), since the store draws its own frame around it.
store = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
store.paste(big.resize((96, 96), Image.LANCZOS), (16, 16))
store.save(f"{sys.argv[2]}/icon128.png", optimize=True)
EOF
ls -l "$repo/extension/icons"
