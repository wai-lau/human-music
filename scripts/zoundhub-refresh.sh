#!/usr/bin/env bash
# Daily Zoundhub refresh, run on Wai's PC (Wai, 2026-11-18: "1A", from her PC once a day).
# Zoundhub turns away server addresses (GitHub got HTTP 403), so this runs from a home address:
# one request a day, like a browser. It keeps a clone of wai-lau/human-music-verdicts, rebuilds
# zoundhub.json with scripts/zoundhub-mirror.mjs (which refuses a fetch or result that looks
# wrong, leaving yesterday's list up), and commits and pushes it when it changed.
# Installed as a systemd user timer: scripts/systemd/zoundhub-refresh.{service,timer}.
set -euo pipefail
REPO=$(cd "$(dirname "$0")/.." && pwd)
STATE=${HM_MIRROR_STATE:-$HOME/.local/state/human-music-mirror}
CLONE=$STATE/verdicts-repo
NODE=${HM_NODE:-$(command -v node || true)}
[[ -x $NODE ]] || { echo "no node (set HM_NODE)" >&2; exit 1; }
mkdir -p "$STATE"
# The clone sits under $HOME, itself a git repo: keep git from walking up into it.
export GIT_CEILING_DIRECTORIES=$STATE
if [[ ! -d $CLONE/.git ]]; then
  git clone -q https://github.com/wai-lau/human-music-verdicts.git "$CLONE"
fi
git -C "$CLONE" pull -q --rebase origin main
"$NODE" "$REPO/scripts/zoundhub-mirror.mjs" "$CLONE/zoundhub.json" "$CLONE/zoundhub.json"
git -C "$CLONE" add zoundhub.json
if git -C "$CLONE" diff --cached --quiet; then echo "no change"; exit 0; fi
git -C "$CLONE" commit -q -m "Update zoundhub.json ($(date -u +%Y-%m-%d))"
git -C "$CLONE" push -q origin HEAD:main
echo "pushed $(git -C "$CLONE" rev-parse --short HEAD)"
