# Worktree: mates-qwen-2

## Task
Implement the player and queue half of Task 6 from the Human Music extension plan. Create `extension/src/page/ytm.js` — the YouTube Music page adapter that exposes DOM-agnostic functions for reading song info, queue state, and player controls.

## Objective
- Create `extension/src/page/ytm.js` with all required exports: SEL, REMOVE_ICON, readSong, readQueue, clickNext, pressNextKey, clickDislike, videoDuration, seekTo, removeQueueRow, mountPlayerButtons, pageAdapter
- Only player and queue functionality; page items (`readPageItems`, `hideItem`, `unhideAll`) are a later task
- All functions must never throw: missing elements return `null`, `false`, `NaN`, or no-op
- Support both 'new' and 'old' layout variants for player and queue elements
- `REMOVE_ICON` must be the exact SVG path string from the spec
- `removeQueueRow` requires polling with `setTimeout` (50ms intervals, up to 1500ms) to wait for menu popup
- `mountPlayerButtons` must be idempotent (second call adds nothing)
- `pageAdapter(doc)` returns an object with functions bound to the given document

## Status
**Done.** Player and queue page adapter implemented and all tests pass.

## Implementation Details
- `SEL` object contains all selector strings for new and old layouts
- `readSong(doc)` detects layout, reads title and byline, returns object or null
- `readQueue(doc)` reads all queue rows, skips `#counterpart-renderer`, returns array
- `clickNext(doc)` and `pressNextKey(doc)` handle both layouts
- `clickDislike(doc)` handles aria-pressed state for both layouts
- `videoDuration(doc)` and `seekTo(doc, seconds)` handle video element access
- `removeQueueRow(doc, row)` uses polling loop with timeout and Escape fallback
- `mountPlayerButtons(doc, handlers)` is idempotent, adds to existing or creates new container
- `pageAdapter(doc)` returns bound functions for use in skipper logic

## Files Changed
- `extension/src/page/ytm.js` — **created** full player and queue adapter implementation
- `tests/ytm.test.mjs` — **created** 22 comprehensive tests for player and queue operations
- `tests/fakes.mjs` — **modified** to add `fakeYtm()` helper with layout, song, queue, and video support

## Tests
All 22 tests for the player and queue adapter pass:
```
node tests/ytm.test.mjs
22/22 pass
```

Full test suite also passes (all 83 tests):
```
for f in tests/*.test.mjs; do node "$f"; done
```
