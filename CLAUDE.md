# Human Music

A Chrome extension for music.youtube.com and open.spotify.com (a Firefox build
is made by `scripts/build-firefox.sh`) that keeps your listening to music
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
- **Name.** Display name "Human Music: AI Music Blocker" (Wai, 2026-11-17), short name
  "Human Music" (with a space) where room is tight, such as the popup header; repo
  `human-music`.
- **No upstream contact.** Nothing goes to the old extension's repo.
- **License.** MIT, copyright "wai-lau". Credit Soul Over AI (CC BY 4.0)
  in the popup and README.

## Working here

- Plain JavaScript, Manifest V3, no build step, no dependencies. Each file
  in `extension/` is an IIFE that sets `globalThis.HM.<name>`. Dev tools
  only (ESLint 10.15, Playwright 1.64) live in the root `package.json`; never
  add one to `extension/`.
- Node: the nvm default is v26 (use it: `export PATH=$HOME/.nvm/versions/node/v26.13.1/bin:$PATH`)
  and `/usr/bin/node` is 18. Unit tests run on 18; lint and e2e need 20.19 or
  newer; the investigator (`research/investigator`, its own `npm test`, uses
  `node:sqlite`) needs 22.13 or newer.
- Lint: `npm run lint` (extension, tests, e2e, scripts and research). End-to-end:
  `npm run e2e` (`e2e/`, real Chromium, stand-in pages served by `context.route`,
  no network). Each e2e test loads its own temporary copy of `extension/` with
  the gitignored `dev-copy` marker added; a test with `storeCopy` loads the copy
  without it, like a packed release (`e2e/store-copy.spec.mjs`). `HM_E2E_EXT=<dir>`
  runs another copy as it is. A change to a page selector updates the stand-in
  page in `e2e/pages/` too.
- Tests: `npm test` (same as `for f in tests/*.test.mjs; do node "$f" || exit 1; done`). Each
  prints `N/N pass` and exits 1 on failure. `tests/dom.mjs` is a small DOM
  (no dependencies); `tests/contract-*.check.mjs` are the lead's contract
  checks, written from the plan apart from each module's own tests, run by
  `tests/contracts.test.mjs`. Qwen writes both code and tests, so a task's
  check must include a contract check written before the send (red on base).
  A contract that still fails is named `wip-contract-*.check.mjs`, which the
  suite does not run; it is renamed to `contract-*` once the fix lands.
- Release: only Wai releases (2026-11-17), with `npm run release` (two phases: checks and tests with no
  key unlocked, then `release.mjs sign` under `scripts/with-release-keys.sh`).
  The steps are in `docs/store-listing.md`.
- Routing (mates): tasks with a test as their check go to Qwen; live checks
  on YouTube Music and judgment work stay with Claude.
- YouTube Music page facts (selectors, what works) are in the spec; they
  were checked live on 2026-11-11 and YouTube changes them without notice.

## Start here (2026-11-17)

- Phase 1 is done and the extension is on the Chrome Web Store (manifest version
  0.1.3). The Firefox build exists but has not been loaded in a real Firefox yet.
- The investigator (`research/investigator`) is in the repo; its notes are in
  its README and `docs/superpowers/specs/2026-11-16-ai-investigator-design.md`.
  Optimal and Aggressive stay on List only until the verdict list is calibrated.
- Load the extension unpacked from `\\wsl$\Ubuntu\home\wai\src\human-music\extension`.
- Questions for Wai go in a gitignored `OPEN-QUESTIONS.md` here, published as
  this repo's own questions page (see the global CLAUDE.md); its URL is in
  project memory.
- Background lives in the old repo's docs (`docs/answered-questions.md` in
  `~/src/YTM-AI-Artist-Song-Blocker`); reading those docs is fine, its code
  is not.
