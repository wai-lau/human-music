#!/usr/bin/env bash
# Lock the two release keys behind a passphrase only you type (security audit 2026-11-17).
# Run it once, yourself, in your own terminal (not through Claude: gpg asks for the
# passphrase on the terminal).
#
# It packs ~/.keys/human-music-crx.pem (the .crx signing key) and
# ~/.keys/human-music-cws-sa.json (the Chrome Web Store service account) into one
# encrypted file, ~/.keys/human-music-release.tar.gpg, checks that it decrypts to exactly
# the same two files, then shreds the plain copies. From then on, scripts/with-release-keys.sh
# (which `npm run release` uses) asks for the passphrase and decrypts them only for the run.
# gpg is told not to cache the passphrase, so no other program can reuse it afterwards.
#
# Keep a backup of human-music-release.tar.gpg somewhere off this PC, and remember the
# passphrase: without both, the store item can't be updated with a signed .crx again.
set -euo pipefail
keys=${HM_KEYS_DIR:-$HOME/.keys}
gpg=${HM_GPG:-gpg}
bundle="$keys/human-music-release.tar.gpg"
files=(human-music-crx.pem human-music-cws-sa.json)

[[ -e $bundle ]] && { echo "already locked: $bundle exists (nothing changed)" >&2; exit 1; }
for f in "${files[@]}"; do [[ -f $keys/$f ]] || { echo "missing $keys/$f" >&2; exit 1; }; done
export GPG_TTY=${GPG_TTY:-$(tty 2>/dev/null || true)}

echo "Choose a passphrase for the release keys (asked twice to confirm, then once more to check)."
umask 077
tar -C "$keys" -cf - "${files[@]}" \
  | $gpg --symmetric --cipher-algo AES256 --no-symkey-cache --pinentry-mode loopback --output "$bundle"
chmod 600 "$bundle"

# Check: decrypt into memory-backed temp space and compare byte for byte before shredding.
tmpbase=/dev/shm; [[ -d $tmpbase && -w $tmpbase ]] || tmpbase=${XDG_RUNTIME_DIR:-/tmp}
check=$(mktemp -d "$tmpbase/hm-keys-check.XXXXXX")
trap 'for f in "$check"/*; do [[ -f $f ]] && shred -u "$f"; done; rm -rf "$check"' EXIT
$gpg --decrypt --no-symkey-cache --pinentry-mode loopback --quiet "$bundle" | tar -C "$check" -xf -
for f in "${files[@]}"; do
  cmp -s "$keys/$f" "$check/$f" || { echo "check failed for $f: plain copies kept, $bundle removed" >&2; rm -f "$bundle"; exit 1; }
done

for f in "${files[@]}"; do shred -u "$keys/$f"; done
echo "Locked: $bundle. The plain copies are shredded."
echo "Back up $bundle off this PC, and keep the passphrase somewhere safe."
