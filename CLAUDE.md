# Human Music

A Chrome extension for music.youtube.com that keeps your listening to music
made by people. Spec: `docs/superpowers/specs/2026-11-11-human-music-design.md`.
Plan: `docs/superpowers/plans/2026-11-11-human-music-extension.md`.

## Why (Wai's words)

"I want to say that AI music is music and not immoral on its own / I just
want to use music as a way to connect to other humans, and AI is
categorically different (not inferior)".

## Rules

- **Wording.** Every string a person reads uses neutral words: "made by
  people", "AI-generated". Never "slop", "fake", "garbage", "fight AI".
  `tests/wording.test.mjs` enforces it for `extension/`.
- **Worst mistake: skipping or removing a real person's music.** Unsure
  means play. Any error leaves the song playing.
- **Clean room.** This replaces an unlicensed extension (YTM AI Artist &
  Song Blocker). Never copy its code, icons or text, and don't open its
  source (`~/src/YTM-AI-Artist-Song-Blocker`). The spec describes all the
  behavior needed.
- **Two parts.** `extension/` is the whole package, loaded unpacked as is.
  The research tool (phase 2) lives in `research/` and is never bundled:
  Wai runs it herself and publishes findings as a public list that the
  extension subscribes to.
- **Name.** Display name "Human Music" (with a space); repo `human-music`.
- **No upstream contact.** Nothing goes to the old extension's repo.
- **License.** MIT, copyright "wai-lau". Credit Soul Over AI (CC BY 4.0)
  in the popup and README.

## Working here

- Plain JavaScript, Manifest V3, no build step, no dependencies. Each file
  in `extension/` is an IIFE that sets `globalThis.HM.<name>`.
- Tests: `for f in tests/*.test.mjs; do node "$f" || exit 1; done`. Each
  prints `N/N pass` and exits 1 on failure.
- Routing (mates): tasks with a test as their check go to Qwen; live checks
  on YouTube Music and judgment work stay with Claude.
- YouTube Music page facts (selectors, what works) are in the spec; they
  were checked live on 2026-11-11 and YouTube changes them without notice.
