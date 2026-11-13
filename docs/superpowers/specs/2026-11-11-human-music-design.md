# Human Music: design

Status: Wai, 2026-11-11: "Just make some assumptions and go for now". Her
decisions are quoted; everything marked **(Claude's call)** is an
assumption she has not reviewed yet.

## Why

Wai, 2026-11-11: "I want to say that AI music is music and not immoral on its
own / I just want to use music as a way to connect to other humans, and AI is
categorically different (not inferior)".

Human Music is a Chrome extension for YouTube Music that keeps your listening
to music made by people. Songs by AI artists are taken out of the queue
before they play, or skipped if one plays anyway. It is not a campaign
against AI music, and nothing it says calls AI music bad.

It replaces Wai's use of an existing extension (YTM AI Artist & Song
Blocker) that has no license, so its code can't be reused or published.
Human Music is written from scratch and released under MIT.

## The two parts

| Part | What it is | Ships in the extension? |
|---|---|---|
| Extension | Filters YouTube Music against lists | yes (the `extension/` folder is the whole package) |
| Research tool | Wai runs it to find new AI artists | no, it lives in `research/` |

Wai: "the research blocker is a separate part that I run, keep it in the
repo but don't bundle it into the extension. when I run it myself, I will
make a repo or something that contains the list of discovered AI music that
others can contribute to."

So the research tool's findings reach users only through a public list,
which the extension subscribes to like any other filter list.

```mermaid
flowchart LR
    R[Research tool<br/>run by Wai] --> P[Public list repo<br/>others contribute]
    S[Soul Over AI list] --> E[Extension]
    P --> E
    U[Your own lists] --> E
    E --> Q[YouTube Music queue and player]
```

## Goals

1. Take songs by listed artists out of the queue before they play
   (lookahead), and skip any that play anyway, moving on exactly one song.
2. Filter lists you can switch on and off one by one: Soul Over AI first,
   later Wai's public list and others.
3. Your own lists of artists, songs and keywords, from the popup and from
   buttons on the player.
4. Hide songs, albums, playlists and artists by listed artists on the home
   page, Explore and search results, like an ad blocker. Wai: "I want it to
   work like an adblock too, automatically hide the songs and playlists on
   the front page and from results".
5. A clear log of every song taken out or skipped, with the list that
   caused it.
6. Import a backup exported from the old extension, so Wai keeps her lists.
7. Later: the research tool, and more community lists.

## Non-goals

- youtube.com. Human Music runs only on music.youtube.com.
- Judging audio, or judging artists inside the extension at all (that is
  the research tool's job).
- Searching lists in the popup. Wai: "users will just export their
  blocklists if they want to search them".
- On-screen notices while listening (Wai chose a quiet log).
- Firefox, for now.
- Publishing to the Chrome Web Store. Wai's call later; the code should be
  ready for it (license, credits, icons, no borrowed code).

## Anti-goals (failure even if it works)

- **Skipping or removing a real person's music.** It cuts off the human
  connection the tool exists for. Wai: a real indie artist being skipped is
  worse than an AI artist slipping through. Unsure means play.
- **Judgmental wording.** Never "slop", "fake", "garbage", "fight AI". Use
  "made by people" and "AI-generated". The log reads as information:
  "Removed from queue: AI-generated (Soul Over AI)".
- **Breaking playback.** Any failure (slow network, missing list, page
  change) means the song plays.
- **Copying the old extension.** No code, icons or text from it. Its
  observable behavior is described here; builders don't need its source.

## How the extension behaves

```mermaid
flowchart TD
    A[Song starts, or the queue changes] --> L[Lookahead: check the next N queue songs]
    L --> M{Match, and not on Never skip?}
    M -- yes --> X[Remove it from the queue; log it]
    M -- no --> K[Leave it]
    A --> C{Playing song matches?}
    C -- no --> P[Play]
    C -- yes, auto-skip on --> S[Skip: move on exactly one song; log it]
    C -- yes, auto-skip off --> W[Play; log it as seen]
    S --> D{Auto-dislike on?}
    D -- yes --> DL[Dislike too]
```

### What counts as a match

| List | Matches when |
|---|---|
| Filter list artists (Soul Over AI, others) | a credited artist is that name, or the artist's channel ID is listed |
| Your artists | a credited artist is that name |
| Your songs | the title is that title, by that artist (title only when the entry has no artist) |
| Your keywords | the word appears as a whole word in the title or the artist line |
| Never skip | overrides all of the above for that artist |

- **Credited artists** come from the artist line before the first " • "
  (the rest is album and year). A credited artist matches a listed name when
  the whole credit equals it, or one part of it does after splitting on
  ", ", " & " and " feat. ". Comparison ignores case. **(Claude's call:** the
  old extension matched artist names anywhere in title plus artist, so a
  list entry like "After Midnight" skipped every song with that title, a
  direct hit on the first anti-goal.)
- **Whole words** work for any script and for names with punctuation:
  "Beyoncé" must not match "Beyoncés"; "米津玄師", "Panic!" and "Ke$ha" must
  match. A word boundary is any character that is not a letter or digit in
  any language.
- Queue rows carry no channel IDs (checked live), so lookahead matches by
  name; channel IDs help only for the playing song, if its artist line
  links to the channel (to check live).
- A filter list switched to **watch mode** logs its matches but never
  removes or skips. **(Claude's call:** lets you try a new list safely.)

### Lookahead

Wai confirmed: check the next N songs in the queue against the lists and
take matches out of the queue before they play, so no skip is heard.

- N is the "lookahead distance" setting. Default 3, range 0 to 10; 0 turns
  lookahead off. **(Claude's call)**
- Runs when a song starts and when the queue changes.
- Removing uses the queue row's own menu ("Remove from queue"). Finding that
  menu item without depending on English text, and doing it without the
  queue panel jumping around, is the first thing to verify live.
- If removal fails, the song stays and auto-skip catches it when it plays.

### Skipping (auto-skip)

Auto-skip covers songs lookahead missed: the first song you start, songs
added at the last moment, lookahead set to 0. On by default; when off, a
match that is already playing plays and goes in the log as seen.
**(Claude's call)**

Moving on exactly one song is the hard part; these rules come from bugs
found in the old extension on 2026-11-11.

1. Remember the song (title and artist line) at the moment of the skip.
2. Press Next with YouTube Music's own shortcut `j` (a keydown on the page
   body). Wai, 2026-11-12: "Use shortcut keys when possible". Only if, 750 ms
   later, the same song is plainly still playing (the video running and its
   time moving on) click the player's Next button, so a slow but working key
   never leads to a second Next.
3. Watch for the song to change. Once it has changed, do nothing more.
4. If it has not changed after 1.5 s, jump to the end of the song, but only
   when the video has loaded (its duration is a finite number above 0).
   Never jump to an arbitrary large time.
5. Give up after 10 s. No timer keeps running after that.
6. With auto-dislike on: press Dislike first. YouTube Music usually moves
   on by itself after a dislike; only if the song hasn't changed after 2 s,
   run steps 2 to 5.
7. A song that was already checked is never checked again while it plays.
   The check compares title and artist line together.

### Never in the person's way

Wai, 2026-11-12: "the addon shouldnt be changing the user's focused tab".
Human Music acts only inside the YouTube Music page (keys and clicks sent to
its own elements); it never navigates, switches tabs or focuses a window, so
it works the same in a background tab. Opening a queue row's menu takes
keyboard focus (checked live), so lookahead waits while the person is typing
in a text field, and puts focus back where it was after each removal.

### On the player

One "Block artist" button just right of the repeat button, with a skip glyph
(a circle with a slash, as on an UNO skip card). Wai, 2026-11-12: "make these
buttons coherent wit the other buttons / keep the same colors, just have a
block artist button, space appropriately ... to the right of loop, a skip
glyph (like uno)". It is built from a copy of the repeat button's own wrapper,
so it has the controls' size, colours and spacing. Pressing it adds the
playing song's whole credit to your artists and the song is skipped at once.
Songs are blocked from the popup.

### Hiding on pages

Like an ad blocker, Human Music hides matching items so they never show.

- **Where:** the home page (`/`), Explore (`/explore`) and search results
  (`/search`). Album, playlist and artist pages are left alone: you went
  there on purpose. **(Claude's call)** The queue and the player are never
  touched by hiding (lookahead and auto-skip handle them).
- **What:** song rows, album/single/EP cards, playlist cards, artist cards and
  the top search result card.
- **Who an item is by:** the text and channel ID of its artist links
  (`a[href*="channel/"]`, checked live: search and home items have them).
  Without links, the subtitle's credits after a leading type word ("Song",
  "Album", "Single", "EP", "Playlist", "Artist", "Video").
- **Rule:** hide when a credited artist matches an `act` filter list or your
  artists, songs or keywords, and nobody credited is on Never skip.
  **Mix cards** (a subtitle that is only a comma list of featured artists,
  like "ILLENIUM, GameChops, El Jazzy Chavo") hide only when every named
  artist is listed: one AI artist in a mix doesn't hide the human ones.
  **(Claude's call)** Watch-mode lists never hide.
- **Undo:** pausing Human Music or switching hiding off shows everything
  again at once.
- **Log:** a hidden item gets one log line ("Hidden on page"), at most once
  a day per item, so a wrongly hidden person can be found and put on Never
  skip. **(Claude's call)**

## Popup

Three tabs (Wai's layout).

### 1. Lists

- **Filter lists**, one row each: name, artist count, last refresh, on/off
  toggle, watch-mode toggle, "Refresh now". Soul Over AI is built in.
  "Add list by URL" adds another (for Wai's future public list); Chrome asks
  the user to allow that host. **(Claude's call)**
- **Refresh frequency**, one setting for all lists: every 6 h, 12 h, daily
  (default), weekly, or manual. **(Claude's call)** A failed refresh keeps
  the last good copy.
- **Your lists**: Artists, Songs, Keywords, Never skip. Add and remove; no
  search.
- **Backup**: export everything (your lists, filter-list choices,
  settings) as one JSON file; import it back. Import also accepts the old
  extension's backup: an object with `blockedArtists`, `blockedKeywords`
  (arrays of strings) and `blockedTracks` (strings, or `{title, artist}`
  objects where an artist of "Manual Entry" means no artist).
- **Credit**: "Soul Over AI list by souloverai.com, CC BY 4.0."

### 2. Behaviour

| Setting | Default |
|---|---|
| Lookahead distance | 3 (0 to 10; 0 = off) |
| Auto-skip a playing match | on |
| Auto-dislike | off (Wai: "off by default") |
| Hide listed artists on pages | on |
| Player buttons | on |
| Pause Human Music | off (one switch stops everything) |

Player buttons and Pause are **Claude's calls** (Wai asked "more?"); hiding is Wai's.

### 3. Log

Wai: "a clear log of every song that was skipped with details and source
list".

- One line per event, newest first: time, title, artist line, what happened
  (removed from queue, skipped, disliked, hidden on a page, seen with
  auto-skip off, seen in watch mode), the list and the entry that matched.
- Each line has "Wrong: never skip this artist", which adds the artist to
  Never skip. **(Claude's call)**
- Keeps the last 1000 lines; "Clear log" and "Export log". **(Claude's
  call)**

## YouTube Music page facts (checked live 2026-11-11)

These describe YouTube's page, not anyone's code. YouTube changes its page
without notice, so selectors belong in one place in the code.

| Thing | New layout | Old layout |
|---|---|---|
| Player | `ytmusic-miniplayer` | `ytmusic-player-bar` |
| Title | `.ytmusicTrackInfoTitle` | `.title` inside the player |
| Artist line | `.ytmusicTrackInfoByline` | `.byline` inside the player |
| Next | `button[aria-label="Next"]` | `.next-button` |
| Dislike | `dislike-button-view-model` (its inner `button` has `aria-pressed`) | `.dislike` |
| Queue rows | `ytmusic-player-queue-item` with `.song-title`, `.byline`, a `selected` attribute; no links | same |

- Synthetic clicks on Next and a synthetic `j` keydown on `document.body`
  both work.
- **Queue (checked live 2026-11-11, plan Task 0).** Rows live in
  `#queue ytmusic-player-queue-item` and exist while the player is minimized
  (no need to open the queue panel). Each song can have a hidden twin row (its
  video version) inside `div#counterpart-renderer`; skip those. The playing
  song's row sits in `div#primary-renderer` and has `selected`.
- **Removing a row.** Click the row's `ytmusic-menu-renderer button`; a
  visible `ytmusic-menu-popup-renderer` opens with `[role=menuitem]` items.
  "Remove from queue" is the item whose first `svg path` `d` is exactly
  `M9 .75a8.25 8.25 0 100 16.5A8.25 8.25 0 009 .75Zm0 1.5a6.75 6.75 0 110 13.5 6.75 6.75 0 010-13.5Zm3 6H6a.75.75 0 000 1.5h6a.75.75 0 100-1.5Z`
  (a circle with a minus; unique in that menu, so no English text needed).
  Clicking it closes the menu and removes the row within 1.5 s; nothing on
  screen moves. The same menu holds "Dismiss queue", which clears the whole
  queue, so only an exact icon match may be clicked. Escape (a keydown on
  `document`) closes the menu without acting.
- **Queue rows without menus (checked live 2026-11-12).** After a song is
  started from search, the up-next rows YouTube Music adds itself (its radio)
  carry no `ytmusic-menu-renderer` until the queue panel is drawn, and
  hovering does not create one. A right-click on the row (a `contextmenu`
  event) opens the same menu, "Remove from queue" included (Wai's pointer).
  `removeQueueRow` clicks the row's menu button when there is one and
  dispatches `contextmenu` otherwise; live, a radio row was removed 1.4 s
  after the queue filled.
- **Next in a Claude test tab (checked live 2026-11-12).** There, Next (a
  real click too, on any song) unloads the video and leaves the player
  stuck, so skipping can only be checked in Wai's own window.
- **Channel IDs.** The playing song's artist links have no `href`, and queue
  rows have no links, so the player and queue match by name only. Search and
  home items do link artists (`channel/UC…`), so hiding can match by channel ID.
- **Page items (checked live 2026-11-11).** Home and Explore: cards are
  `ytmusic-two-row-item-renderer` (`.title`, `.subtitle`); song rows (Quick
  picks) are `ytmusic-responsive-list-item-renderer`. Search: rows are
  `ytmusic-responsive-list-item-renderer` with subtitles like "EP • 1950
  SoulClub, 1960 SoulClub & Lewis Hanton • 2025"; the top result is
  `ytmusic-card-shelf-renderer`.
- Song rows in lists carry a `like-status` attribute (`LIKE`, `DISLIKE`,
  `INDIFFERENT`).
- The layout switch happened in 2026; keep both layouts working.

## Constraints

- Chrome Manifest V3, plain JavaScript, no build step, no dependencies.
  The `extension/` folder is loaded unpacked as is and is the whole
  package.
- Permissions: `storage`; hosts `https://music.youtube.com/*` and the Soul
  Over AI list URL; other list hosts as optional permissions, asked for
  when a list is added.
- Matching and skip logic live in plain modules with no page access, so
  Node tests can load them without a browser. Tests are `tests/*.test.mjs`,
  run with `node`, printing `N/N pass` and exiting 1 on any failure.
- Speed, with a 1375-name list: checking the same song again under 0.5 ms,
  a new song under 6 ms; a lookahead pass over 10 queue rows under 20 ms;
  a hiding pass over 100 page items under 30 ms.
- MIT license; copyright "wai-lau".
- New icons (16, 48, 128 px), drawn for Human Music.
- Wording rules from the anti-goals apply to every string, including the
  manifest description and README.

## Lists that survive removal (Wai, 2026-11-12)

Removing the old extension deleted its lists (Chrome wipes an extension's
storage on removal). Wai: "save the lists in chrome storage, save a local
copy that is auto-imported and committed (for now) / In the future, the
extension should be bundled without the lists, it should auto-download and
import from \"known lists\" that it is shipped with".

- **Now.** Lists live in `chrome.storage.local`. `extension/lists/` holds a
  committed copy: `index.json` names the files; `my-lists.json` is a Human
  Music backup of your own lists; `soul-over-ai.json` is a names-only
  snapshot of the Soul Over AI list (CC BY 4.0). On install and on every
  start the service worker imports each file whose content changed since the
  last import: a backup merges into your lists (a union, so an entry deleted
  in the popup stays deleted until the file changes); a filter-list file
  fills that list only while it has no downloaded copy.
  `scripts/save-lists.sh` copies the newest popup Export from Downloads into
  `my-lists.json` and commits it.
- **Later.** The package ships with no list data, only a file of known list
  URLs, and downloads and imports those on install.

## Firefox and Spotify (foundation, 2026-11-13)

Wai, 2026-11-13: "Also want you to figure out how to make it work for Firefox
and Spotify / do anything that lays the foundation that will not require my
input".

### Sites

One content script runs on each supported site and picks that site's page
adapter by host: `HM.ytm` (music.youtube.com) or `HM.spotify`
(open.spotify.com). Both adapters have the same shape (readSong, readQueue,
clickNext, pressNextKey, clickDislike, videoDuration, videoState, seekTo,
removeQueueRow, mountPlayerButtons, readPageItems, hideItem, unhideAll), so
matching, lookahead, skipping, hiding and the log are shared.

### Artist IDs

Every Soul Over AI record carries a Spotify artist ID (1375 of 1375) and most
a YouTube channel ID (1279). Lists keep both (`spotifyId`, `channelId`), and a
song or page item whose artist links carry a listed ID matches that artist
whatever name it shows. On Spotify every artist link carries its ID, so
Spotify matching is by ID first.

### Spotify page facts (checked live 2026-11-13, logged in)

| Thing | Where |
|---|---|
| Now playing | `[data-testid="now-playing-widget-v2"]` (no `now-playing-widget` in the narrow layout) |
| Title | `[data-testid="context-item-link"]` |
| Artists | `[data-testid="now-playing-widget-v2-byline"] a[href*="/artist/"]`, each href holds the 22-character artist ID |
| Next | `[data-testid="control-button-skip-forward"]`; a script click works (unlike YouTube Music in a test tab) |
| Repeat | `[data-testid="control-button-repeat"]` (32 px tertiary button; the block button goes right of it) |
| Play/pause | `[data-testid="control-button-playpause"]` (aria-label Play or Pause) |
| Position, duration | `[data-testid="playback-position"]`, `[data-testid="playback-duration"]` (text like 2:43), `[data-testid="playback-progressbar"]` |
| Queue panel | `[data-testid="control-button-queue"]` opens `aside[aria-label="Queue"]`; rows are `ul[role="treegrid"] li[role="row"]` with track and artist links and a "More options" button |
| Remove from queue | "More options" opens `#context-menu` (`data-testid="context-menu"`); the item whose icon path is the trash can below; "Exclude from your taste profile" and "Go to album" share another icon's start, so only an exact match counts |
| Search results | `[data-encore-id="listRow"]` rows in `[role="grid"][aria-label="Search results"]` (narrow layout), with track and artist links |
| Home cards | `[data-encore-id="card"]` with `cardTitle` and `cardSubtitle`; most are playlists whose subtitle is a description, not credits |

- The page's `<video>` element reports a duration that is not the song's
  (7.36 s for a 2:43 song), so seeking uses the progress bar, not the video.
- Shortcut keys sent by script (Ctrl+Right, Alt+Shift+Right, Shift+Right) did
  not move on; Spotify skips with the Next button.
- Spotify has no dislike; with auto-dislike on, Spotify presses Next.
- Hiding on Spotify goes by artist links only (their IDs, or the linked
  name): a playlist subtitle is a description and is never read as credits.
- Remove-from-queue icon: `M5.25 3v-.917C5.25.933 6.183 0 7.333 0h1.334c1.15 0 2.083.933 2.083 2.083V3h4.75v1.5h-.972l-1.257 9.544A2.25 2.25 0 0 1 11.041 16H4.96a2.25 2.25 0 0 1-2.23-1.956L1.472 4.5H.5V3zm1.5-.917V3h2.5v-.917a.583.583 0 0 0-.583-.583H7.333a.583.583 0 0 0-.583.583M2.986 4.5l1.23 9.348a.75.75 0 0 0 .744.652h6.08a.75.75 0 0 0 .744-.652L13.015 4.5H2.985z`

### Firefox

Firefox runs Manifest V3 with `background.scripts` (no service worker), needs
`browser_specific_settings.gecko.id`, and offers `chrome.*` APIs. Until a
combined manifest is checked live in Chrome, `scripts/build-firefox.sh` writes
a Firefox copy of `extension/` to `dist/firefox/` with a Firefox manifest;
the Chrome package stays as it is. The service worker's `importScripts` is
skipped there (the core files are listed in `background.scripts`).

## Phases

1. **Extension.** Everything above. Done when Wai uses Human Music instead
   of the old extension and the old extension's backup imports cleanly.
2. **Research tool**, in `research/`, never in `extension/`. Its design is
   `2026-11-11-ai-artist-checker-design.md` (approved 2026-11-11), changed
   by Wai's split: it no longer runs inside the extension or skips
   anything. It investigates artists and writes candidates for the public
   list, with evidence, for Wai to review. Its plan gets rewritten then.
3. **More community lists**: the ones ytm-deslop (MIT) merges (Stevoisiak,
   muhdiboy, AiSList, Cevval), matched by name or channel ID. First check
   each list's own license.

## Filter list format **(Claude's call)**

The extension reads two formats:

- Soul Over AI's: an array of records with `name` and `removed`;
  `removed: true` entries are ignored.
- Human Music's own, which the research tool and the public list use:
  `{"name": "...", "updated": "YYYY-MM-DD", "artists": [{"name": "...",
  "channelId": "UC... (optional)"}]}`.

## Left to the builder

- File and module layout inside `extension/`, within the constraints.
- Storage key names and the backup file's exact shape (it must round-trip).
- Popup look; plain and readable.
- Exact log line wording, within the wording rules.
- Icon design.

## Open

- Nothing blocking. Wai can overrule any **Claude's call** above.
