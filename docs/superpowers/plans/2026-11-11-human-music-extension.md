# Human Music extension (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Chrome extension for music.youtube.com that takes songs by listed artists out of the queue before they play, skips any that play anyway, hides their songs, albums and playlists on the home page, Explore and search results, and logs every action with its source list.

**Architecture:** Pure logic modules (`extension/src/core/`) hold matching, list parsing, skipping, lookahead, log and settings; each attaches to a shared `globalThis.HM` namespace so the content script, popup, service worker and Node tests all load the same files. One page adapter (`extension/src/page/ytm.js`) is the only code that touches YouTube Music's DOM. The content script wires them; a service worker refreshes filter lists.

**Tech Stack:** Chrome Manifest V3, plain JavaScript (no build step, no dependencies), Node 20+ for tests (`node:vm`).

**Spec:** `docs/superpowers/specs/2026-11-11-human-music-design.md`

**Execution:** start `mates` in `/home/wai/src/human-music`. The lead routes tasks marked [Qwen] with the task's check command; tasks marked [Claude] or [Wai] are the lead's own.

## Global Constraints

- The `extension/` folder is the whole package, loaded unpacked as is. Nothing from `research/`, `tests/` or `docs/` is referenced by it.
- No build step, no npm dependencies, no ES module syntax in `extension/` (content scripts can't load modules). Each file is an IIFE that sets `globalThis.HM.<name>`.
- Clean room: don't open the old extension's source (`~/src/YTM-AI-Artist-Song-Blocker`). Everything needed is in the spec and this plan.
- Wording (spec anti-goal): no string in `extension/` contains "slop", "fake", "garbage" or "fight AI". Use "made by people" and "AI-generated".
- Display name exactly "Human Music". MIT, copyright "wai-lau".
- Unsure means play: any thrown error, missing element or failed fetch leaves the song playing.
- Tests: `tests/<name>.test.mjs`, run with `node`, print `PASS`/`FAIL` per case and a final `N/N pass`, exit 1 on any failure. Run all: `for f in tests/*.test.mjs; do node "$f" || exit 1; done`.
- Speed with a 1375-name list: same song re-check under 0.5 ms, new song under 6 ms, lookahead over 10 rows under 20 ms.

## Review Focus

1. A blocked song that comes back later (replay, re-added) must be caught again: the "already checked" memory resets when the song changes. Test in Task 8.
2. Removing a queue row shifts the rows after it; lookahead must re-read the queue after each removal, never reuse old positions. Test in Task 8.
3. A filter list URL that returns an HTML error page or broken JSON keeps the last good copy, and a first-ever failure leaves an empty list, not a crash. Test in Task 7.
4. Songs with no artist line (podcast episodes, some videos) never match and never throw. Test in Task 2.
5. A second skip trigger for the same song while a skip is running is ignored (one Next press). Test in Task 4.

## Files

| File | Responsibility |
|---|---|
| `extension/manifest.json` | MV3 manifest |
| `extension/src/core/text.js` | `HM.text`: name normalizing, artist credits, whole-word regex |
| `extension/src/core/match.js` | `HM.match`: build an index from all lists, match one song |
| `extension/src/core/lists.js` | `HM.lists`: filter-list formats, refresh timing, backup import/export |
| `extension/src/core/settings.js` | `HM.settings`: defaults and sanitizing |
| `extension/src/core/log.js` | `HM.log`: log entries, cap, wording |
| `extension/src/core/lookahead.js` | `HM.lookahead`: which upcoming rows to remove |
| `extension/src/core/skipper.js` | `HM.skipper`: move on exactly one song |
| `extension/src/page/ytm.js` | `HM.ytm`: every YouTube Music selector and DOM action |
| `extension/src/content.js` | wiring on music.youtube.com |
| `extension/src/background.js` | service worker: install defaults, refresh lists |
| `extension/popup/popup.html`, `popup.css`, `popup.js` | the three-tab popup |
| `extension/popup/model.js` | `HM.popup`: list edits behind the popup, testable |
| `extension/icons/icon{16,48,128}.png` | new icons |
| `tests/load.mjs` | `load()` and `run()` helpers |
| `tests/fakes.mjs` | fake clock, fake storage, fake YouTube Music DOM |
| `README.md`, `CLAUDE.md` | for people; for future lead sessions |

## Shared shapes (every task uses these names)

```js
// A song as read from the page or a queue row
Song  = { title: string, artistLine: string, channelIds?: string[] }
// An item on the home page, Explore or search results
PageItem = { title: string, credits: string[], channelIds: string[], featured: boolean }  // featured: a mix card's comma list
// A filter list's metadata (storage key "hm.filterLists": FilterList[])
FilterList = { id, name, url, enabled: boolean, mode: 'act'|'watch', builtIn: boolean,
               lastRefresh: number|null, count: number, lastError: string|null }
// A filter list's artists (storage key "hm.list.<id>")
ListData = { artists: [{ name: string, channelId?: string }] }
// The user's own lists (storage key "hm.user")
User = { artists: string[], songs: [{ title: string, artist: string|null }],
         keywords: string[], neverSkip: string[] }
// A match (null = no match)
Match = { listId: string, listName: string, rule: 'artist'|'channel'|'song'|'keyword',
          entry: string, mode: 'act'|'watch' }
// Other storage keys: "hm.settings" (Settings), "hm.log" (LogEntry[])
```

User list ids: `user:artists`, `user:songs`, `user:keywords`. Built-in filter list: `{ id: 'soul-over-ai', name: 'Soul Over AI', url: 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/main/dist/artists.json', enabled: true, mode: 'act', builtIn: true }`.

---

### Task 0: Live recon [Claude]

Facts the later tasks depend on, checked on music.youtube.com in Chrome.

Done 2026-11-11: removal by script works (queue 67 → 66, nothing on screen moved); details in the spec's page facts and Task 6 Step 3. The playing song's artist links carry no channel IDs.

- [x] **Step 1:** With a queue of 5+ songs, find how to remove one row: the row's menu button selector, the menu item for "Remove from queue" identified without English text (icon name, item position or service endpoint), and whether the queue panel must be open. Remove one row by script and confirm the queue shrinks by exactly one.
- [x] **Step 2:** Check whether the playing song's artist line contains links to `channel/UC…`.
- [x] **Step 3:** Check that `ytmusic-player-queue-item` rows exist while the queue panel is closed.
- [x] **Step 4:** Write the results into the spec's "YouTube Music page facts" table and into Task 6 Step 3 below; commit.
- [ ] **Gate:** if no reliable removal exists, stop and tell Wai: lookahead would fall back to skipping when the song starts. Don't build Task 6's `removeQueueRow` on a guess.

### Task 1: Scaffold, manifest and test helpers [Qwen]

**Files:** Create `extension/manifest.json`, `tests/load.mjs`, `tests/fakes.mjs` (clock and storage only; Task 6 adds the DOM), `tests/manifest.test.mjs`, `tests/wording.test.mjs`.

**Interfaces:**
- Produces: `load(files: string[], globals?: object) → vm.Context` (runs each `extension/<file>` in one context and returns it; `ctx.HM` is the namespace); `run(cases: [label: string, fn: () => true|string|Promise<true|string>][]) → never` (prints, exits); `fakeClock() → { setTimeout, clearTimeout, setInterval, clearInterval, tick(ms), pending() }`; `fakeStorage(initial?) → { get(keys), set(obj), onChanged: { addListener(fn) }, data }` (async like `chrome.storage.local`, fires listeners with `(changes, 'local')`).

- [x] **Step 1: Write `tests/manifest.test.mjs` and `tests/wording.test.mjs`.**

```js
// manifest.test.mjs
m.manifest_version === 3
m.name === 'Human Music'
JSON.stringify(m.permissions.sort()) === '["alarms","storage"]'
m.host_permissions includes 'https://music.youtube.com/*' and 'https://raw.githubusercontent.com/xoundbyte/soul-over-ai/*'
m.optional_host_permissions deep-equals ['https://*/*']
m.background.service_worker === 'src/background.js'
m.action.default_popup === 'popup/popup.html'
m.content_scripts[0].matches deep-equals ['https://music.youtube.com/*']
m.content_scripts[0].js deep-equals ['src/core/text.js','src/core/match.js','src/core/lists.js','src/core/settings.js',
  'src/core/log.js','src/core/lookahead.js','src/core/skipper.js','src/page/ytm.js','src/content.js']
every file named in the manifest exists under extension/ (the icons may be missing until Task 10: skip *.png)
// wording.test.mjs: every file under extension/ (text files only)
no match for /\b(slop|fake|garbage)\b|fight ai/i
```

- [x] **Step 2:** Run `node tests/manifest.test.mjs`: FAIL (no manifest).
- [x] **Step 3:** Write the manifest (description: "Keeps your YouTube Music listening to music made by people.", version "0.1.0", icons 16/48/128 under `icons/`), `load.mjs`, `fakes.mjs`. Create the content-script files as empty IIFE stubs so the existence check passes.
- [x] **Step 4:** Check: `node tests/manifest.test.mjs && node tests/wording.test.mjs` → both `N/N pass`.
- [x] **Step 5:** Commit `feat: manifest, test helpers`.

### Task 2: Text and matching [Qwen]

**Files:** Create `extension/src/core/text.js`, `extension/src/core/match.js`, `tests/match.test.mjs`, `tests/perf.test.mjs`.

**Interfaces:**
- Produces `HM.text`: `normalize(s: string) → string` (NFC, lowercase, trimmed, runs of whitespace → one space); `credits(artistLine: string) → string[]` (normalized; the whole credit before the first " • ", then its parts after splitting on ", ", " & " and " feat. " (case-insensitive), no duplicates, no empty strings); `wholeWord(term: string) → RegExp` (flags `iu`; boundary = start, end, or a character that is not `\p{L}` or `\p{N}`).
- Produces `HM.match`: `buildIndex({ filterLists: (FilterList & ListData)[], user: User }) → Index`; `matchSong(index, song: Song) → Match|null`; `matchItem(index, item: PageItem) → Match|null` (credits are names as shown, normalized inside; same precedence; `featured: true` → a Match only when every credit matches an artist entry, keywords and songs ignored).
- Precedence inside `matchSong`: a credit on `neverSkip` → `null`; then user songs, user artists, user keywords; then enabled filter lists, `act` lists before `watch` lists. Disabled lists are ignored.

- [x] **Step 1: Write `tests/match.test.mjs`.** Cases (label → assertion):

```js
credits('1950 SoulClub, 1960 SoulClub & Lewis Hanton • Album • 2025')
  deep-equals ['1950 soulclub, 1960 soulclub & lewis hanton','1950 soulclub','1960 soulclub','lewis hanton']
credits('Earth, Wind & Fire • Hits') includes 'earth, wind & fire'
credits('Daft Punk feat. Pharrell Williams') includes 'pharrell williams'
credits('') deep-equals []
// filter list 'Soul Over AI' with artists [{name:'The Velvet Sundown'},{name:'After Midnight'},{name:'10mm'}]
matchSong(idx, {title:'Dust on the Wind', artistLine:'The Velvet Sundown • Floating on Echoes • 2025'})
  → {listId:'soul-over-ai', rule:'artist', entry:'The Velvet Sundown', mode:'act'}
matchSong(idx, {title:'After Midnight', artistLine:'Eric Clapton • Slowhand'}) → null   // title is not an artist
matchSong(idx, {title:'X', artistLine:'After Midnight Project • Album'}) → null          // exact credit only
matchSong(idx, {title:'X', artistLine:'10mm, Someone • Album'}) → rule 'artist'
matchSong(idx, {title:'X', artistLine:'', }) → null and no throw                        // Review Focus 4
matchSong(idx, {title:'X', artistLine:'Real Band • A', channelIds:['UCabc']}) with list artist {name:'Other', channelId:'UCabc'} → rule 'channel'
// user lists
user.artists ['Beyoncé']: artistLine 'Beyoncé • Lemonade' → listId 'user:artists'; 'BEYONCÉ • x' → match
user.keywords ['after']: title 'After the Rain' → rule 'keyword'; title 'Afterpiece' → null
user.keywords ['beyoncé']: title 'Beyoncés' → null; ['米津玄師'] in 'Lemon / 米津玄師' → match;
  ['panic!'] in 'Panic! at the Disco • x' → match; ['ke$ha'] in 'Ke$ha • Animal' → match
user.songs [{title:'Love', artist:'Some Band'}]: 'Love' by 'Some Band • A' → rule 'song';
  'love' by 'Some Band • B' → match; 'Love' by 'Other • A' → null; 'Lovely' by 'Some Band • A' → null
user.songs [{title:'Love', artist:null}]: 'Love' by anyone → match
neverSkip ['The Velvet Sundown'] → the Velvet Sundown song above → null (overrides the filter list)
filter list enabled:false → null; mode:'watch' → match with mode 'watch'
same artist on an act list and a watch list → mode 'act'
matchItem(idx, {title:'EP', credits:['1950 SoulClub','Lewis Hanton'], channelIds:[], featured:false}) with list name '1950 SoulClub' → rule 'artist'
matchItem(idx, {title:'X', credits:['Someone'], channelIds:['UCOCi_VDTQPFn9fZtfqnpVag'], featured:false}) with that channelId listed → rule 'channel'
matchItem(idx, {title:'Replay Mix', credits:['The Velvet Sundown','ILLENIUM'], channelIds:[], featured:true}) → null   // one human in the mix
matchItem(idx, {title:'Mix', credits:['The Velvet Sundown','10mm'], channelIds:[], featured:true}) → match
matchItem with a credit on neverSkip → null
```

- [x] **Step 2: Write `tests/perf.test.mjs`:** a 1375-name filter list (generated names); 2000 `matchSong` calls on distinct songs average under 6 ms each (expect far less); report the average.
- [x] **Step 3:** Run both: FAIL.
- [x] **Step 4:** Implement. Filter-list names and channel IDs go in `Set`s at build time; keyword regexes are built once in `buildIndex`.
- [x] **Step 5:** Check: `node tests/match.test.mjs && node tests/perf.test.mjs`.
- [x] **Step 6:** Commit `feat: credit and keyword matching`.

### Task 3: Lists and backups [Qwen]

**Files:** Create `extension/src/core/lists.js`, `tests/lists.test.mjs`.

**Interfaces:**
- Produces `HM.lists`: `SOUL_OVER_AI` (the built-in FilterList above, with `lastRefresh:null, count:0, lastError:null`); `FREQUENCIES = { '6h': 21600000, '12h': 43200000, daily: 86400000, weekly: 604800000, manual: Infinity }`; `parseFilterList(data: any) → ListData|null`; `isRefreshDue(lastRefresh: number|null, frequency: string, now: number) → boolean`; `importBackup(data: any) → { user: User, settings?: object, filterLists?: FilterList[] }` (throws `Error('Not a Human Music or YTM blocker backup')` otherwise); `exportBackup(state: { user, settings, filterLists }) → object`; `mergeUser(a: User, b: User) → User` (union, duplicates by `HM.text.normalize`).

- [ ] **Step 1: Write `tests/lists.test.mjs`:**

```js
parseFilterList([{name:'A',removed:false},{name:'B',removed:true},{name:'C'}]) deep-equals {artists:[{name:'A'},{name:'C'}]}
parseFilterList(['A','B']) deep-equals {artists:[{name:'A'},{name:'B'}]}
parseFilterList({name:'HM', updated:'2026-11-11', artists:[{name:'A',channelId:'UC1'}]}) deep-equals {artists:[{name:'A',channelId:'UC1'}]}
parseFilterList('<html>') === null; parseFilterList({foo:1}) === null; parseFilterList(null) === null
isRefreshDue(null, 'manual', 0) === true            // never fetched
isRefreshDue(0, 'daily', 86400000) === true; isRefreshDue(0, 'daily', 86399999) === false
isRefreshDue(0, 'manual', 1e12) === false; isRefreshDue(0, 'bogus', 86400000) === true   // unknown → daily
// old extension backup
importBackup({blockedArtists:['A'], blockedKeywords:['k'], blockedTracks:['Old Song',
  {title:'T', artist:'Manual Entry'}, {title:'U', artist:'Band • Album'}]}).user
  deep-equals {artists:['A'], keywords:['k'], neverSkip:[],
  songs:[{title:'Old Song',artist:null},{title:'T',artist:null},{title:'U',artist:'Band'}]}
// own format round-trip
importBackup(exportBackup(state)) deep-equals {user, settings, filterLists} of state
exportBackup(state).format === 'human-music-backup'; .version === 1
exportBackup output has no artist data from filter lists (only id,name,url,enabled,mode,builtIn)
importBackup({}) throws; importBackup('x') throws
mergeUser({artists:['A'],…}, {artists:['a','B'],…}).artists deep-equals ['A','B']
```

- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement. **Step 4:** Check: `node tests/lists.test.mjs`. **Step 5:** Commit `feat: filter-list formats and backups`.

### Task 4: Skipper [Qwen]

**Files:** Create `extension/src/core/skipper.js`, `tests/skipper.test.mjs`.

**Interfaces:**
- Consumes: a page adapter `{ readSong() → Song|null, clickNext() → boolean, pressNextKey() → void, clickDislike() → boolean, videoDuration() → number, seekTo(seconds) → void }` (Task 6 builds the real one; the test builds a fake).
- Produces `HM.skipper`: `createSkipper({ page, setTimeout, clearTimeout, setInterval, clearInterval }) → { skip({ dislikeFirst: boolean }) → void, busy() → boolean }`.

- [x] **Step 1: Write `tests/skipper.test.mjs`** with a fake page (title changes when `clickNext`, `pressNextKey` or `clickDislike` "moves on", per case) and `fakeClock()`. Spec rules 1–6, as cases:

```js
Next moves on → clickNext 1 call, seeks []
Next ignored, duration 200 → seeks [] at 1000 ms; seeks [200] by 3000 ms
Next ignored, duration NaN until 2000 ms then 180 → never a seek ≥ 99999; seeks [180] by 5000 ms
Next ignored, never loads → seeks [] and clock.pending() === 0 after 10000 ms
clickNext returns false → pressNextKey called once, synchronously inside skip(); key moves on → seeks []
clickNext returns true → pressNextKey never called
song moves on at 2500 ms (after the seek is due) with duration 200 → seeks []
dislikeFirst, dislike moves on → clickNext 0 calls, seeks []
dislikeFirst, song stays, Next moves on → clickNext 1 call (after 2000 ms), seeks []
dislikeFirst, nothing moves → clickNext 1 call, then seeks [200]
skip() called again for the same song while busy() → ignored (clickNext 1 call total)   // Review Focus 5
clickNext is called synchronously inside skip() (dislikeFirst false)
```

- [x] **Step 2:** Run: FAIL. **Step 3:** Implement (poll every 100 ms; arm the seek at 1500 ms; give up at 10000 ms; return immediately once the song changed). **Step 4:** Check: `node tests/skipper.test.mjs`. **Step 5:** Commit `feat: skip moves on exactly one song`.

### Task 5: Settings, log and lookahead [Qwen]

**Files:** Create `extension/src/core/settings.js`, `log.js`, `lookahead.js`, `tests/core.test.mjs`.

**Interfaces:**
- `HM.settings`: `DEFAULTS = { lookahead: 3, autoSkip: true, autoDislike: false, hidePageItems: true, playerButtons: true, paused: false, refresh: 'daily' }`; `sanitize(obj: any) → Settings` (fills defaults; `lookahead` integer clamped 0–10; `refresh` must be a key of `HM.lists.FREQUENCIES` else `'daily'`; booleans coerced).
- `HM.log`: `makeEntry({ event, song, match, at }) → LogEntry` where `event ∈ 'removed'|'skipped'|'disliked'|'hidden'|'seen'|'watched'` and `LogEntry = { at, event, title, artistLine, listId, listName, rule, entry }`; `append(entries, entry, cap = 1000) → LogEntry[]` (new array, newest first); `describe(entry) → string`; `seenRecently(entries, entry, now, windowMs = 86400000) → boolean` (an entry with the same event, title and artist line inside the window; used so a hidden item is logged at most once a day).
- `HM.lookahead`: `pickRemovals(rows: (Song & { selected: boolean })[], distance: number, matchFn: (Song) → Match|null) → { remove: number[], watched: { index: number, match: Match }[] }` (rows after the selected one, at most `distance`; no selected row or `distance` 0 → both empty; `remove` holds `act` matches only).

- [x] **Step 1: Write `tests/core.test.mjs`:**

```js
sanitize({}) deep-equals DEFAULTS; sanitize({lookahead: 99}).lookahead === 10; sanitize({lookahead: -1}).lookahead === 0
sanitize({lookahead: '4'}).lookahead === 4; sanitize({refresh: 'hourly'}).refresh === 'daily'
describe(entry removed, list 'Soul Over AI')            === 'Removed from queue: AI-generated (Soul Over AI)'
describe(entry skipped, list 'Soul Over AI')            === 'Skipped: AI-generated (Soul Over AI)'
describe(entry disliked, list 'Soul Over AI')           === 'Skipped and disliked: AI-generated (Soul Over AI)'
describe(entry seen, listId 'user:artists')             === 'Played (auto-skip off): on your artists list'
describe(entry watched, list 'Soul Over AI')            === 'Watch mode, left alone: AI-generated (Soul Over AI)'
describe(entry skipped, listId 'user:keywords', entry 'remix') === 'Skipped: keyword "remix" from your keywords list'
describe(entry skipped, listId 'user:songs')            === 'Skipped: on your songs list'
describe(entry hidden, list 'Soul Over AI')             === 'Hidden on page: AI-generated (Soul Over AI)'
seenRecently([hidden X at t], hidden X, t + 3600000) === true; at t + 90000000 → false; a 'skipped' X doesn't count
append(1000 entries, new) → length 1000, [0] is new
pickRemovals(rows [A(selected), B*, C, D*, E*], 3, fn) → remove [1, 3]     // E is 4 ahead
pickRemovals(same, 0, fn) → remove []; no selected row → remove []
a watch-mode match → in watched, not in remove
```

- [x] **Step 2:** Run: FAIL. **Step 3:** Implement. **Step 4:** Check: `node tests/core.test.mjs`. **Step 5:** Commit `feat: settings, log and lookahead choice`.

### Task 6: YouTube Music page adapter [Qwen]

**Files:** Create `extension/src/page/ytm.js`, `tests/ytm.test.mjs`; extend `tests/fakes.mjs` with `fakeYtm({ layout: 'new'|'old', song, queue, nextMovesOn })`.

**Interfaces:**
- Produces `HM.ytm`: `SEL` (the spec's selector table, one object); `readSong(doc) → Song|null`; `readQueue(doc) → (Song & { selected: boolean, el })[]`; `clickNext(doc) → boolean`; `pressNextKey(doc) → void` (keydown, `key: 'j'`, `code: 'KeyJ'`, `bubbles: true`, on `doc.body`); `clickDislike(doc) → boolean` (already pressed → no click, returns true); `videoDuration(doc) → number` (NaN without a video); `seekTo(doc, seconds)`; `removeQueueRow(doc, row) → Promise<boolean>`; `mountPlayerButtons(doc, { onBlockArtist, onBlockSong }) → boolean` (one container `#hm-player-buttons`, never two); `pageAdapter(doc) → ` the adapter Task 4 consumes; `readPageItems(doc, path: string) → (PageItem & { el })[]` (only when `path` is `/`, `/explore` or starts with `/search`; else `[]`); `hideItem(el)` (sets `el.hidden = true` and `data-hm-hidden`); `unhideAll(doc)`.

- [ ] **Step 1: Write `tests/ytm.test.mjs`**, both layouts: `readSong` returns the fake's title and artist line; `channelIds` from artist links when present; `readQueue` returns rows with `selected`; `clickNext` clicks the Next button (true) and returns false when it's absent; `pressNextKey` dispatches one keydown `j` on body; `clickDislike` doesn't click when `aria-pressed="true"`; `mountPlayerButtons` twice → one container with two buttons labelled "Block artist" and "Block song"; `removeQueueRow` clicks the row's menu button, then the item with the exact remove icon, and resolves true; with no matching item it clicks nothing else, sends Escape and resolves false; a twin row inside `#counterpart-renderer` is not returned by `readQueue`. Page items: a search row with three `channel/` links → credits are the three link texts and channelIds the three IDs; a card with subtitle "Album • Otis Redding" and no links → credits ['Otis Redding']; a mix card with subtitle "ILLENIUM, GameChops, Shin-Ski" → featured true, three credits; on `/browse/x` → `[]`; items inside `ytmusic-player-page` or the queue are never returned; `hideItem` then `unhideAll` restores `hidden = false`.
- [ ] **Step 2:** Run: FAIL.
- [ ] **Step 3:** Implement. `readQueue` reads `#queue ytmusic-player-queue-item` rows, skipping any inside `#counterpart-renderer`. `removeQueueRow(doc, row)`, from Task 0: click `row.querySelector('ytmusic-menu-renderer button')`; wait (poll ≤ 1500 ms) for a visible `ytmusic-menu-popup-renderer`; find the `[role=menuitem]` whose first `svg path` `d` equals `HM.ytm.REMOVE_ICON` (the exact string in the spec's page facts); none → dispatch an Escape keydown on `doc` and resolve false (never click anything else: "Dismiss queue" is in the same menu); found → click it, then resolve true once `row.isConnected` is false or the row count dropped, false after 1500 ms. `readSong` returns `channelIds: []` (the page has none).
- [ ] **Step 4:** Check: `node tests/ytm.test.mjs`. **Step 5:** Commit `feat: YouTube Music page adapter`.

### Task 7: Service worker list refresh [Qwen]

**Files:** Create `extension/src/background.js`, `tests/background.test.mjs`.

**Interfaces:**
- `background.js` loads core files with `importScripts('core/text.js', 'core/lists.js', 'core/settings.js')` and exposes `HM.refresher = createRefresher({ storage, fetch, now })` → `{ install() → Promise, refreshDue() → Promise<string[]>, refreshOne(id) → Promise<boolean> }`. Chrome hooks: `onInstalled` → `install()`; alarm `hm-refresh` every 60 min → `refreshDue()`; message `{ type: 'refresh', id }` → `refreshOne(id)`.
- `install()` writes `hm.filterLists = [SOUL_OVER_AI]`, `hm.user` empty, `hm.settings = DEFAULTS` only where missing, then refreshes Soul Over AI.

- [ ] **Step 1: Write `tests/background.test.mjs`** (load `background.js` in a context with stub `chrome`, `importScripts` mapped to `load`, stub `fetch`):

```js
install() on empty storage → hm.filterLists[0].id === 'soul-over-ai', hm.settings deep-equals DEFAULTS
install() keeps existing hm.user
refreshOne ok (2 artists) → hm.list.soul-over-ai.artists.length === 2, meta.count === 2, meta.lastRefresh === now, lastError null
refreshOne after a good copy, fetch returns '<html>' (status 200) → list data unchanged, meta.lastError set   // Review Focus 3
refreshOne first ever, fetch rejects → hm.list.soul-over-ai deep-equals {artists:[]}, no throw
refreshDue with refresh 'daily', lastRefresh now-25h → refreshes it; now-1h → doesn't; disabled list → skipped
```

- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement. **Step 4:** Check: `node tests/background.test.mjs`. **Step 5:** Commit `feat: filter-list refresh`.

### Task 8: Content script wiring [Qwen]

**Files:** Create `extension/src/content.js`, `tests/content.test.mjs`.

**Interfaces:**
- `content.js` defines `HM.createApp({ doc, storage, timers, now }) → { start() → Promise, checkPlaying() → void, runLookahead() → Promise }` and, only when `typeof chrome !== 'undefined' && chrome.storage`, starts it with the real ones.
- Reads `hm.user`, `hm.settings`, `hm.filterLists`, `hm.list.<id>`; rebuilds the index when any of those change (`storage.onChanged`), never on `hm.log` changes.
- `checkPlaying`: skips when paused; re-checks only when title+artist line changed; on an `act` match with `autoSkip` → `skipper.skip({ dislikeFirst: autoDislike })` and log `skipped`/`disliked`; without `autoSkip` → log `seen`; `watch` match → log `watched`.
- `runLookahead`: when not paused and `lookahead > 0`, `pickRemovals` then remove rows one at a time, re-reading `readQueue` after each removal; log `removed` per success.
- Hiding: when `hidePageItems` and not paused, a pass over `readPageItems(doc, location.pathname)` on page mutations (one per animation frame): `act` match → `hideItem` and log `hidden` unless `seenRecently`. Pausing or switching hiding off → `unhideAll`.
- Player buttons per `playerButtons`: "Block artist" adds the playing song's credits (the whole credit) to `user.artists`; "Block song" adds `{ title, artist: first credit }` to `user.songs`.

- [ ] **Step 1: Write `tests/content.test.mjs`** with `fakeYtm`, `fakeStorage`, `fakeClock`:

```js
playing song by a Soul Over AI artist → Next clicked once, hm.log[0].event === 'skipped'
autoDislike true → dislike clicked, log 'disliked'; autoSkip false → no Next, log 'seen'
paused true → no Next, no removal, hm.log empty
same song, 50 mutations → matched once (one log line)
song A (blocked) → skipped → song B → song A again → skipped again             // Review Focus 1
queue [cur, B*, C*, D] with lookahead 3 → B and C removed (the fake shifts rows after each removal),
  D kept, 2 'removed' log lines                                                  // Review Focus 2
never-skip artist → nothing happens
"Block artist" click → hm.user.artists includes the whole credit; the song is then skipped
writing hm.log does not rebuild the index (count buildIndex calls)
on '/search' with a listed artist's EP row → hidden, one 'hidden' log line; a second pass → no second line
watch-mode list match on a page → not hidden; paused → unhideAll restores it
a hiding pass over 100 page items under 30 ms
same-song re-check under 0.5 ms; new song under 6 ms (1375-name list)
runLookahead's matching over 10 queue rows under 20 ms (removal itself excluded)
```

- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement (one MutationObserver on the player for song changes, one on the queue container; both debounced to one run per animation frame). **Step 4:** Check: run all tests. **Step 5:** Commit `feat: content script wiring`.

### Task 9: Popup [Qwen]

**Files:** Create `extension/popup/popup.html`, `popup.css`, `popup.js`, `model.js`, `tests/popup.test.mjs`.

**Interfaces:**
- `HM.popup` (in `model.js`): `addEntry(user, kind: 'artists'|'keywords'|'neverSkip', value) → User` (trimmed, no duplicates by `normalize`, empty ignored); `addSong(user, title, artist|null) → User`; `removeEntry(user, kind, index) → User`; `addFilterList(lists, url, name) → FilterList[]` (throws on non-`https:` URL or duplicate URL; id from name, lowercase-dashed, made unique; `enabled: true, mode: 'act', builtIn: false`); `removeFilterList(lists, id) → FilterList[]` (built-in lists can't be removed: throws).
- Tabs exactly "Lists", "Behaviour", "Log", per the spec's Popup section. "Add list by URL" calls `chrome.permissions.request({ origins: [origin + '/*'] })` before saving. Refresh buttons send `{ type: 'refresh', id }`. Import reads a file and calls `HM.lists.importBackup`, then `mergeUser` into the existing lists. Credit line text exactly: "Soul Over AI list by souloverai.com, CC BY 4.0." Log tab: each line shows `HM.log.describe(entry)`, time, title and artist line, plus a "Wrong: never skip this artist" button that calls `addEntry(user, 'neverSkip', <the entry's whole credit>)`; "Clear log" and "Export log" buttons. Popup loads `src/core/text.js`, `lists.js`, `settings.js`, `log.js`, then `model.js`, `popup.js`. Permissions note: the plan adds `alarms` (for scheduled refresh) to the spec's `storage`.

- [ ] **Step 1: Write `tests/popup.test.mjs`** for the model: duplicates ignored case-insensitively; `addSong(u,'Love',null)` → `{title:'Love',artist:null}`; `addFilterList` rejects `http://x`, rejects a duplicate URL, makes ids `my-list`, `my-list-2`; removing `soul-over-ai` throws. Also: `popup.html` contains the three tab labels and the credit line.
- [ ] **Step 2:** Run: FAIL. **Step 3:** Implement. **Step 4:** Check: `node tests/popup.test.mjs && node tests/wording.test.mjs`. **Step 5:** Commit `feat: popup`.

### Task 10: Icons, README, CLAUDE.md [Claude]

- [x] **Step 1:** Draw a simple icon (a person and a note, readable at 16 px) as SVG in `docs/icon.svg`; export PNGs at 16, 48 and 128 px to `extension/icons/`.
- [x] **Step 2:** `README.md`: what it does, the why in one paragraph, install (load `extension/` unpacked), the Soul Over AI credit, MIT. Run the humanizer skill over it.
- [x] **Step 3:** `CLAUDE.md`: Wai's why and wording rules, clean-room rule, `extension/` is the package, research tool stays out, test command, mates routing.
- [x] **Step 4:** Check: all tests pass (the manifest test now finds the icons). Commit `docs: icons, README, CLAUDE.md`.

### Task 11: Live end-to-end [Wai + Claude]

- [ ] **Step 1 [Wai]:** export a backup from the old extension's popup; disable the old extension; load `extension/` unpacked.
- [ ] **Step 2 [Wai]:** import the backup in Human Music's Lists tab; counts match the old popup's.
- [ ] **Step 3 [Claude]:** with a queue holding a Soul Over AI artist 2 songs ahead: it's removed before it plays, and the Log tab shows "Removed from queue: AI-generated (Soul Over AI)".
- [ ] **Step 4 [Wai]:** start a song by The Velvet Sundown directly: it's skipped once, no dislike; the log shows it.
- [ ] **Step 5:** Note anything that broke as new tests before fixing.
