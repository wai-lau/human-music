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

# State report at every exit: what is on disk, in plain words.
verified=0
report() {
  local code=$?
  if (( verified )); then return; fi
  if [[ -f $keys/${files[0]} && -f $keys/${files[1]} ]]; then
    echo "State: the plain keys are still in place in $keys (nothing was shredded)." >&2
    [[ -e $bundle ]] && echo "State: $bundle exists but is not verified." >&2
    [[ -e $bundle ]] || echo "State: no encrypted bundle exists; run this script again to lock them." >&2
  else
    echo "State: PLAIN KEYS MISSING from $keys; check $bundle and your backups." >&2
  fi
  return "$code"
}
check=
cleanup() {
  [[ -n $check ]] && { for f in "$check"/*; do [[ -f $f ]] && shred -u "$f"; done; rm -rf "$check"; }
  report
}
trap cleanup EXIT
trap 'echo "Interrupted." >&2; exit 130' INT TERM HUP

echo "Choose a passphrase for the release keys (asked twice to confirm, then once more to check)."
umask 077
tar -C "$keys" -cf - "${files[@]}" \
  | $gpg --symmetric --cipher-algo AES256 --no-symkey-cache --pinentry-mode loopback --output "$bundle"
chmod 600 "$bundle"

# Check: decrypt into memory-backed temp space and compare byte for byte before shredding.
# A mistyped passphrase at the check prompt gets up to 3 tries; the plain keys are shredded only
# after a check has passed, and never otherwise.
tmpbase=/dev/shm; [[ -d $tmpbase && -w $tmpbase ]] || tmpbase=${XDG_RUNTIME_DIR:-/tmp}
check=$(mktemp -d "$tmpbase/hm-keys-check.XXXXXX")
ok=0
for try in 1 2 3; do
  rm -f "$check"/*
  echo "Check $try of 3: enter the passphrase again to verify the encrypted copy."
  if $gpg --decrypt --no-symkey-cache --pinentry-mode loopback --quiet "$bundle" 2>/dev/null | tar -C "$check" -xf - 2>/dev/null \
     && [[ -f $check/${files[0]} && -f $check/${files[1]} ]]; then ok=1; break; fi
  echo "The check could not decrypt the encrypted copy (mistyped passphrase?). Nothing was shredded." >&2
done
if (( ! ok )); then
  rm -f "$bundle"
  echo "Not verified after 3 tries: removed the unverified $bundle. Run this script again." >&2
  exit 1
fi
for f in "${files[@]}"; do
  cmp -s "$keys/$f" "$check/$f" || { rm -f "$bundle"; echo "The decrypted $f differs from the plain copy: removed $bundle." >&2; exit 1; }
done

for f in "${files[@]}"; do shred -u "$keys/$f"; done
verified=1
echo "Locked: $bundle. The plain copies are shredded."
echo "Back up $bundle off this PC, and keep the passphrase somewhere safe."
