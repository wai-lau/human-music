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
for size in (16, 48, 128):
    big.resize((size, size), Image.LANCZOS).save(f"{sys.argv[2]}/icon{size}.png", optimize=True)
EOF
ls -l "$repo/extension/icons"
