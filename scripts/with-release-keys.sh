#!/usr/bin/env bash
# Run a release command with the release keys unlocked for that run only
# (security audit 2026-11-17). `npm run release` uses it:
#   scripts/with-release-keys.sh node scripts/release.mjs release
# It asks for the passphrase (not cached), decrypts ~/.keys/human-music-release.tar.gpg
# into a private temp folder in memory-backed storage, points HM_CRX_KEY (pack-crx.sh) and
# HM_CWS_SA_KEY (release.mjs) at the two files, runs the command, and shreds them when it
# ends, however it ends. Before scripts/lock-release-keys.sh has run, it just runs the
# command with the plain keys, as before.
set -euo pipefail
keys=${HM_KEYS_DIR:-$HOME/.keys}
gpg=${HM_GPG:-gpg}
bundle="$keys/human-music-release.tar.gpg"
[[ $# -gt 0 ]] || { echo "usage: $0 <command> [args...]" >&2; exit 2; }

if [[ ! -f $bundle ]]; then
  echo "note: release keys are not locked yet (scripts/lock-release-keys.sh); using the plain copies" >&2
  exec "$@"
fi

export GPG_TTY=${GPG_TTY:-$(tty 2>/dev/null || true)}
tmpbase=/dev/shm; [[ -d $tmpbase && -w $tmpbase ]] || tmpbase=${XDG_RUNTIME_DIR:-/tmp}
umask 077
dir=$(mktemp -d "$tmpbase/hm-release-keys.XXXXXX")
cleanup() { for f in "$dir"/*; do [[ -f $f ]] && shred -u "$f"; done; rm -rf "$dir"; }
trap cleanup EXIT INT TERM HUP

echo "Release keys: enter the passphrase." >&2
$gpg --decrypt --no-symkey-cache --pinentry-mode loopback --quiet "$bundle" | tar -C "$dir" -xf -
[[ -f $dir/human-music-crx.pem && -f $dir/human-music-cws-sa.json ]] || { echo "the bundle doesn't hold both keys" >&2; exit 1; }

export HM_CRX_KEY="$dir/human-music-crx.pem" HM_CWS_SA_KEY="$dir/human-music-cws-sa.json"
set +e
"$@"
status=$?
set -e
exit $status
