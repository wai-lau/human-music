# AI Investigator, Extension Side: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. In this repo, tasks with a test as their check go to Qwen through mates; the popup (Task 6) and live checks stay with Claude.

**Goal:** Every Human Music reads the investigator's verdict list and blocks by confidence according to a four-stop filtering mode; Wai's copy also sends unknown artists to the investigator.

**Architecture:** The verdict list is a second built-in filter list with `verdict` and `confidence` per artist. The matcher's index takes the mode's threshold and keeps only AI verdicts at or above it. Unknown artists (on no list, with no verdict) are reported by the content script to the worker, which sends them to the droplet only when an investigator token is set. The droplet service itself is a separate plan.

**Tech Stack:** Plain JavaScript, Manifest V3, no dependencies; node tests (`npm test`), Playwright end-to-end (`npm run e2e`), ESLint (`npm run lint`).

**Spec:** `docs/superpowers/specs/2026-11-16-ai-investigator-design.md`

## Global Constraints

- No new manifest permission of any kind (store copies show no change).
- Unsure means play: any error, missing list, malformed entry or slow network leaves songs playing.
- Never skip beats every verdict; people and unsure verdicts never unblock anything a list blocks.
- Thresholds: optimal blocks `verdict: "ai"` with `confidence >= 95`; aggressive with `confidence >= 60`; list-only and no filtering ignore verdicts.
- Verdict list: id `hm-verdicts`, name `Human Music verdicts`, URL `https://raw.githubusercontent.com/wai-lau/human-music/main/verdicts/verdicts.json` (this repo, public since 2026-11-16; the droplet never serves it), built in, mode `act`.
- Investigator: `POST https://wai-lau.net/human-music/api/investigate`, header `Authorization: Bearer <token>`; only when a token is set; each artist at most once a day per copy.
- Default mode `lists` (List-only) until the verdict list says `"calibrated": true`; Optimal and Aggressive stops are "not ready" until then.
- Wording rule: neutral words only ("made by people", "AI-generated"); `tests/wording.test.mjs` enforces it.
- Each file in `extension/` is an IIFE setting `globalThis.HM.<name>`; storage keys come from `HM.store`.

## Review Focus

1. **Verdict list missing, 404, offline or not JSON:** nothing blocks from it, the other lists keep working, the popup shows the list error. (Task 2 test.)
2. **Malformed entries** (confidence as text, above 100, negative, missing; unknown verdict words): ignored or clamped, never a block. (Task 2 test.)
3. **Mode changed while music plays:** the index rebuilds; rows marked or hidden under the old mode come back. (Task 4 test.)
4. **No token, or the droplet unreachable:** nothing is sent without a token; a failed send is recorded once and not retried in a storm. (Task 5 test.)
5. **Once a day survives worker restarts:** the "sent" record lives in storage, not memory. (Task 5 test.)

---

### Task 1: Filtering mode in settings

**Files:**
- Modify: `extension/src/core/settings.js`
- Test: `tests/contract-mode.check.mjs` (new, lead-written, red on base)

**Interfaces:**
- Produces: `HM.settings.MODES = ['off', 'lists', 'optimal', 'aggressive']`; `HM.settings.DEFAULTS.mode === 'lists'`; `HM.settings.threshold(mode) -> number | null` (95, 60, else null); `sanitize(obj).mode` always one of MODES; `sanitize(obj).paused === (mode === 'off')`; a stored `paused: true` always gives mode `'off'` (the Pause switch and older settings); `sanitize` keeps booleans `modeChosen` (the person moved the slider) and `investigate` (default false); `HM.settings.effectiveMode(settings, calibrated) -> mode`: the chosen mode when `modeChosen`, else `'optimal'` when the verdict list is calibrated and `'lists'` when not (the design: store copies default to Optimal once calibration passes).

- [ ] **Step 1: Write the failing contract** `tests/contract-mode.check.mjs`:

```js
eq('default', settings.sanitize({}).mode, 'lists');
eq('old paused migrates', settings.sanitize({ paused: true }).mode, 'off');
eq('mode wins over paused', settings.sanitize({ paused: true, mode: 'optimal' }).mode, 'optimal');
eq('paused follows mode', [settings.sanitize({ mode: 'off' }).paused, settings.sanitize({ mode: 'aggressive' }).paused], [true, false]);
eq('junk mode', settings.sanitize({ mode: 'turbo' }).mode, 'lists');
eq('thresholds', ['off', 'lists', 'optimal', 'aggressive'].map(settings.threshold), [null, null, 95, 60]);
eq('default follows calibration', [settings.effectiveMode(settings.sanitize({}), false), settings.effectiveMode(settings.sanitize({}), true)], ['lists', 'optimal']);
eq('a chosen mode stays', settings.effectiveMode(settings.sanitize({ mode: 'lists', modeChosen: true }), true), 'lists');
```

- [ ] **Step 2:** Run `node tests/contract-mode.check.mjs`; expect `PROBE FAIL`.
- [ ] **Step 3:** Implement in `settings.js` (`threshold` reads a `THRESHOLDS = { optimal: 95, aggressive: 60 }` table).
- [ ] **Step 4:** Run `npm test`; expect every file `N/N pass`.
- [ ] **Step 5:** Commit `feat: filtering mode setting (off, lists, optimal, aggressive)`.

### Task 2: The verdict list

**Files:**
- Modify: `extension/src/core/lists.js`, `extension/src/background.js` (install and start add the list when missing; the refresher stores `calibrated`)
- Create: `tests/fixtures/verdicts.json` (hand-made: Forrest Rose `ai` 97, The Broken Radios `ai` 70, a person `human` 90, one `unsure` 40, one entry with `"confidence": "high"`, one with 140)
- Test: `tests/contract-verdicts.check.mjs` (new, lead-written)

**Interfaces:**
- Produces: `HM.lists.HM_VERDICTS` (the Global Constraints values plus the usual list fields); `parseFilterList(data) -> { artists, calibrated }` where each artist may carry `verdict` (`'ai' | 'human' | 'unsure'`) and `confidence` (integer 0-100) and `calibrated` is present only when the list states it (`data.calibrated` is a boolean); list meta in `hm.filterLists` gains `calibrated: boolean` after a refresh.

- [ ] **Step 1: Write the failing contract:**

```js
const v = lists.parseFilterList(JSON.parse(fixture));
eq('ai kept with confidence', pick(v, 'Forrest Rose'), { name: 'Forrest Rose', verdict: 'ai', confidence: 97 });
eq('text confidence dropped', pick(v, 'Text Confidence').confidence, undefined);
eq('clamped', pick(v, 'Over Hundred').confidence, 100);
eq('unknown verdict dropped', pick(v, 'Odd Word').verdict, undefined);
eq('calibrated flag', v.calibrated, false);
eq('plain lists unchanged', lists.parseFilterList([{ name: 'A' }]).artists, [{ name: 'A' }]);
// worker: install on empty storage lists both built-ins; a start with only Soul Over AI adds hm-verdicts
eq('install', ids(await install()), ['soul-over-ai', 'hm-verdicts']);
eq('start adds it', ids(await startWith([SOA])), ['soul-over-ai', 'hm-verdicts']);
// a 404 or a non-JSON body records lastError and keeps the last good copy
eq('404 keeps copy', await refreshWith(404), { ok: false, keptCount: 3 });
```

- [ ] **Step 2:** Run it; expect `PROBE FAIL`.
- [ ] **Step 3:** Implement: `parseEntries` keeps `verdict` only for the three words and `confidence` only for finite numbers, clamped to 0-100 and rounded; `parseFilterList` returns `calibrated`; `install` and `importBundled` add `HM_VERDICTS` when its id is missing; `refreshOne` copies `calibrated` into the list meta.
- [ ] **Step 4:** Run `npm test`; expect all pass.
- [ ] **Step 5:** Commit `feat: built-in verdict list with verdict and confidence`.

### Task 3: Matching by threshold, and knowing who is unknown

**Files:**
- Modify: `extension/src/core/match.js`, `extension/src/core/log.js`
- Test: `tests/contract-verdict-match.check.mjs` (new, lead-written)

**Interfaces:**
- Consumes: `HM.settings.threshold`, the verdict list shape from Task 2.
- Produces: `buildIndex({ filterLists, user, threshold })` (threshold `number | null`); a list with `id === 'hm-verdicts'` contributes only entries with `verdict === 'ai' && confidence >= threshold` (none when threshold is null); matches from it carry `confidence`; `HM.match.isKnown(index, { credits, channelIds }) -> boolean` (true when any credited name or ID is on any list, user list, Never skip, or has any verdict at any confidence); `HM.log.makeEntry` keeps `match.confidence`; `HM.log.reason` appends ` · <confidence>%` when present.

- [ ] **Step 1: Write the failing contract:**

```js
const idx = t => match.buildIndex({ filterLists: [verdictList], user: emptyUser, threshold: t });
eq('optimal blocks 97, not 70', [hit(idx(95), 'Forrest Rose'), hit(idx(95), 'The Broken Radios')], [true, false]);
eq('aggressive blocks 70', hit(idx(60), 'The Broken Radios'), true);
eq('people never block', hit(idx(60), 'Real Person'), false);
eq('list-only ignores verdicts', hit(idx(null), 'Forrest Rose'), false);
eq('never skip wins', hit(match.buildIndex({ filterLists: [verdictList], user: { ...emptyUser, neverSkip: ['Forrest Rose'] }, threshold: 60 }), 'Forrest Rose'), false);
eq('confidence in the match', match.matchSong(idx(95), song('Forrest Rose')).confidence, 97);
eq('reason', log.reason({ listId: 'hm-verdicts', listName: 'Human Music verdicts', confidence: 97 }), 'AI-generated · Human Music verdicts · 97%');
eq('known: any verdict', match.isKnown(idx(null), { credits: ['real person'], channelIds: [] }), true);
eq('unknown', match.isKnown(idx(null), { credits: ['brand new act'], channelIds: [] }), false);
```

- [ ] **Step 2:** Run it; expect `PROBE FAIL`.
- [ ] **Step 3:** Implement: `buildIndex` builds a `known` set (normalised names and IDs of every entry on every enabled list, user lists and Never skip, verdicts at any confidence) and filters the verdict list by `threshold`; act-map entries from it keep `confidence`; `result()` passes it on.
- [ ] **Step 4:** Run `npm test`; expect all pass (existing contracts unchanged).
- [ ] **Step 5:** Commit `feat: verdicts block at the mode's confidence; unknown artists are recognisable`.

### Task 4: The content script reports unknown artists and follows the mode

**Files:**
- Modify: `extension/src/content.js`
- Test: `tests/contract-investigate-content.check.mjs` (new, lead-written; uses the fake site of `tests/log-errors.test.mjs`)

**Interfaces:**
- Consumes: `isKnown`, `threshold`, settings `mode` and a new non-secret setting `investigate` (boolean, default false; Task 1's `sanitize` keeps it).
- Produces: `createApp({ ..., onUnknown })` where `onUnknown(items)` gets `[{ site, title, artistLine, credits, album, artUrl, channelIds }]`; called only when `settings.investigate` is true; each credited artist reported at most once per page; the playing song and lookahead rows both report. `reload()` passes `HM.settings.threshold(settings.mode)` to `buildIndex`.

- [ ] **Step 1: Write the failing contract:**

```js
eq('reports the unknown playing artist', reported(await run({ investigate: true, song: UNKNOWN })), ['Brand New Act']);
eq('reports unknown queue rows once', reported(await run({ investigate: true, queue: [UNKNOWN_ROW, UNKNOWN_ROW] }), 3), ['Row Act']);
eq('known artists are not reported', reported(await run({ investigate: true, song: LISTED })), []);
eq('off without the setting', reported(await run({ investigate: false, song: UNKNOWN })), []);
eq('mode change rebuilds: optimal to lists unmarks a 97 verdict row', await modeSwitch('optimal', 'lists'), { before: true, after: false });
```

- [ ] **Step 2:** Run it; expect `PROBE FAIL`.
- [ ] **Step 3:** Implement: a `reported` Set of normalised credits; `onUnknown` fires from `checkPlaying` (no match) and the lookahead loop (rows not known), batched per pass. The Chrome block wires `onUnknown` to `chrome.runtime.sendMessage({ type: 'hm-investigate', items })` with the same catch as `onCount`. The playing song's album comes from the artist line's second part, and its art URL from the player's thumbnail image when the adapter offers `readArt(doc)` (optional; absent means none). `reload()` uses `HM.settings.effectiveMode(settings, verdictList.calibrated)`. `HM.ytm.readSong` fills `channelIds` from the player byline's `a[href*="channel/"]` links (today it returns `[]`), so ID-only lists can skip, not only hide.
- [ ] **Step 4:** Run `npm test`; expect all pass.
- [ ] **Step 5:** Commit `feat: unknown artists are reported for investigation (when enabled)`.

### Task 5: The worker sends to the investigator

**Files:**
- Modify: `extension/src/background.js`, `extension/src/core/store.js` (key `investigator: 'hm.investigator'` holding `{ token, base, sent: { <key>: 'YYYY-MM-DD' }, lastError, lastSentAt }`)
- Test: `tests/contract-investigate-worker.check.mjs` (new, lead-written; fake fetch, fake storage)

**Interfaces:**
- Consumes: the `hm-investigate` message from Task 4.
- Produces: `HM.createInvestigator({ storage, fetch, now }) -> { send(items) -> Promise<{ sent: number, skipped: number }> }`; the worker's message handler calls it. A send POSTs `{ items }` as JSON to `<base>/api/investigate` (`base` defaults to `https://wai-lau.net/human-music`) with `Authorization: Bearer <token>`. While anything was sent in the last 30 minutes, each worker start refreshes `hm-verdicts` if its copy is older than 5 minutes.

- [ ] **Step 1: Write the failing contract:**

```js
eq('no token: nothing sent', (await inv({ token: '' }).send(items)).sent, 0); eq('no fetch', calls.length, 0);
eq('sends with the token', call(0), { url: 'https://wai-lau.net/human-music/api/investigate', auth: 'Bearer t0k', count: 2 });
eq('same artist same day: skipped', (await again.send(items)).sent, 0);
eq('next day: sent again', (await nextDay.send(items)).sent, 2);
eq('sent record in storage', Object.keys(data['hm.investigator'].sent).length, 2);
eq('a failed send is recorded, not retried at once', [data['hm.investigator'].lastError, calls.length], ['HTTP 503', 1]);
eq('fresh verdicts: start refreshes hm-verdicts after a recent send', refreshedIds(), ['hm-verdicts']);
```

- [ ] **Step 2:** Run it; expect `PROBE FAIL`.
- [ ] **Step 3:** Implement in `background.js` beside the refresher: keys are normalised names plus IDs; `sent` entries older than 7 days are dropped on write; a failed send still marks the items sent for today (no storm) and stores `lastError`.
- [ ] **Step 4:** Run `npm test`; expect all pass.
- [ ] **Step 5:** Commit `feat: worker sends unknown artists to the investigator with the token`.

### Task 6: Popup: the mode slider, the investigator section, confidence in the log (Claude)

**Files:**
- Modify: `extension/popup/popup.html`, `popup.css`, `popup.js`
- Test: `tests/popup-ui.test.mjs`, `e2e/popup.spec.mjs`

**Interfaces:**
- Consumes: `settings.mode`, list meta `calibrated`, `hm.investigator`.
- Produces: header slider `#mode` (`input type="range"`, 0-3 for MODES) with `#mode-label`; moving it saves `mode`, `modeChosen: true` and `paused: mode === 'off'` (a stored `paused: true` always means No filtering, so leaving 'off' must clear it); the Pause switch `#paused` is removed. Behaviour gains an "Investigator" section: `#investigator-token` (password field), `#investigator-save`, `#investigator-status` (last sent, last error); saving a token also sets `settings.investigate = true`, clearing it sets false.

- [ ] **Step 1: Write the failing tests** (popup-ui): the slider shows the mode and saves it; with `calibrated: false`, choosing Optimal snaps back to List-only and the status says Optimal isn't ready yet; a verdict log line reads `AI-generated · Human Music verdicts · 97%`; saving a token stores it under `hm.investigator` and sets `investigate`; the token never appears in `hm.settings`.
- [ ] **Step 2:** Run `node tests/popup-ui.test.mjs`; expect FAIL.
- [ ] **Step 3:** Implement; the slider follows the uBlock reference Wai shared (four stops on one track, the current stop's name under it); it is keyboard operable.
- [ ] **Step 4:** Run `npm test`, `npm run lint`, `npm run e2e`; render the popup and look at it in light and dark.
- [ ] **Step 5:** Commit `feat: filtering mode slider and investigator token in the popup`.

### Task 7: End to end, docs, and the live check (Claude)

**Files:**
- Modify: `e2e/ytm.spec.mjs` (verdict blocks at Optimal via `setState` writing the fixture into storage), `README.md` (filtering modes), `docs/superpowers/specs/2026-11-11-human-music-design.md` (a pointer to the investigator design), `docs/store-listing.md` (description line for the modes; privacy answers unchanged because store copies send nothing).

- [ ] **Step 1:** Add the e2e test: with the fixture stored and mode `optimal`, a playing Forrest Rose song is skipped and The Broken Radios (70) plays; with `aggressive`, both are skipped.
- [ ] **Step 2:** Run `npm run e2e`; expect all pass.
- [ ] **Step 3:** Update the three docs (README through the humanizer).
- [ ] **Step 4:** Live check in Wai's Chrome with the fixture loaded by hand: the slider, a greyed Forrest Rose row at Optimal, the log line.
- [ ] **Step 5:** Commit `docs: filtering modes and the verdict list`.
