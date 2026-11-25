# Chrome Web Store listing

Text for each field of the developer dashboard, ready to paste. Package:
the item takes verified uploads only, so a release uploads the signed
`dist/human-music-<version>.crx` that `npm run release` packs (see "Releasing
from the terminal" below); a plain zip of `extension/` is no longer accepted.
The store pack leaves out `extension/lists/my-lists.json` (personal lists) and the
development-only audio files; `scripts/verify-pack.mjs` checks the pack before a release.

## Package tab

Upload the signed `.crx`. Name ("Human Music: AI Music Blocker"), version and icon come from
`manifest.json`.

## Store listing tab

**Summary** (from the manifest, 132 characters at most):

> Keeps your YouTube Music and Spotify listening to music made by people.

**Description** (the guide's shape: an overview paragraph, then a short list of main features;
developer.chrome.com/docs/webstore/best-listing, read 2026-11-18):

> Human Music keeps your YouTube Music and Spotify listening to music made by
> people. AI-generated music is still music, and some listeners enjoy it. This
> extension is for listeners who use music to connect with other humans. It
> works from lists of AI-generated artists that you choose, and when it isn't
> sure, the song plays.
>
> Main features:
> • Takes songs by listed artists out of your queue before they play, and
>   skips one if it starts anyway
> • Hides or greys out their albums and songs on the home page, in search and
>   on playlists
> • Built-in lists: Zoundhub, Cevval's AI music list, Human Music's own
>   verdicts and Soul Over AI (CC BY 4.0), plus your own artists and any list
>   you subscribe to
> • Turn any list off in one click, and one switch keeps a listed artist
>   playing
> • Human Music's verdicts cover new artists that no list has yet; you choose
>   how sure a verdict must be before a song is skipped
> • A log of every skip, grouped by artist, kept on your computer
> • No account, no tracking, no ads: it sends nothing, only downloads the lists
>   you use, and asks for access to YouTube Music and Spotify only
>
> Free and open source under the MIT license: github.com/wai-lau/human-music

**Website:** https://github.com/wai-lau/human-music
**Support:** https://github.com/wai-lau/human-music/issues
(The guide: a website and a support page "can help build trust with users".)

**Category:** Entertainment. **Language:** English.

**Screenshots** (1280x800, in this order; files in `~/store-shots/`; the guide prefers the
maximum of five):

1. `1-greyed-out.png`: songs by listed artists greyed out on a playlist.
2. `2-ytm-oldnew.png`: the same YouTube Music search for an AI-generated artist (Breaking Rust), without and with Human Music, side by side.
3. `3-spotify-oldnew.png`: the same search on Spotify, without and with Human Music.
4. `4-blocked.png`: the log's Blocked section.
5. `5-lists.png`: the Lists tab, largest list first.

The Old/New pairs (shots 2 and 3) were made 2026-11-25 (Wai: "A for both spotify and YTM") from live searches with filtering off and on, cropped to the results so no personal playlists or account show. They replaced the Actions and Behaviour shots, kept in `~/store-shots/old/`. Shots 4 and 5 were retaken 2026-11-24 for 0.1.7.

**Small promo tile** (440x280, `~/store-shots/promo-small.png`): upload it. It is optional, but
items without one are shown after items that have one. Per the guide it has no text: the icon on
a saturated green field.

**Store icon:** Wai uploaded her own in the dashboard (2026-11-20): keep it, never replace it.
The package's icons (`extension/icons/`) and the small promo tile are built by `docs/make-icons.sh` from Wai's logo, `docs/icon-source.png` (a tan figure with a skull on green, 2026-11-25; the person-and-note icon is archived in `.archaeology/docs/`). The 128 px one is 96 px of artwork in 16 px of transparent padding. Run `PROMO_OUT=~/store-shots/promo-small.png docs/make-icons.sh` to rebuild both. Screenshots 4 and 5 were retaken 2026-11-25 to show the new icon in the popup header.

## Privacy tab

**Single purpose:**

> Keeps YouTube Music and Spotify listening to music made by people, by
> skipping, removing from the queue, hiding and greying out songs by artists
> on lists the user chooses.

**Permission justifications** (the dashboard asks for one box per
permission, and one for all hosts):

| Box | Text |
|---|---|
| storage | Saves the user's lists, settings and log on their own computer. Nothing is sent anywhere. |
| scripting | When Human Music is installed or updated, YouTube Music and Spotify tabs that are already open don't have it yet. scripting adds it to those tabs, so music keeps being checked without the user reloading the page. It only ever adds Human Music's own packaged files, and only on those two sites. |
| Host permission | Human Music works only on music.youtube.com and open.spotify.com. On those pages it reads the playing song, the queue and the songs shown, compares them with the user's lists, and then presses Next, removes a listed song from the queue, or hides or greys out a listed item. It asks for no other site. |

The list downloads need no permission: GitHub allows any site to read its
raw files. The built-in lists all come from public GitHub repos on
raw.githubusercontent.com: Soul Over AI (xoundbyte/soul-over-ai), Cevval's AI
music list (cevvalkoala/CevvalYoutubeAIBlocklist), and Human Music's verdicts
and its daily copy of Zoundhub's clearest AI flags (both in
wai-lau/human-music-verdicts). A list the user adds downloads from its own
https address. These requests carry no user data, and no other copy of the
extension ever sends anything (only the owner's development copy talks to
the investigator, and store copies can't become one).

**Remote code:** No. The lists it downloads are data only (JSON, or a plain
text list of channel IDs) and are never run; all code is in the package.

**Data usage:** tick **Website content** only (decided 2026-11-25). Google's user-data FAQ: "Extensions are required to disclose how they handle user data, even when data is processed or stored locally on a user's device." Human Music reads song titles, artist names and IDs on the music pages and keeps a log on the computer; nothing leaves it. Not Web history (no record of pages visited), not User activity (no clicks, keystrokes, scrolling or network monitoring), none of the personal kinds. Certify all three statements (not sold to third parties, not used for unrelated purposes, not used for creditworthiness or lending).

**Privacy policy URL:** https://github.com/wai-lau/human-music/blob/main/PRIVACY.md
(Chrome's policy counts reading page content and keeping a log on the computer as handling user
data, even when nothing leaves it, so a policy is needed. `PRIVACY.md` also carries the Limited Use
statement.)

## Distribution tab

Visibility: Public, Unlisted (only people with the link) or Private
(chosen testers). Regions: all.

**Going public with the next release** (Wai, 2026-11-18: "for the next release, I want it
public, not unlisted"):

A review in progress can't be cancelled and blocks a new submission (Wai, 2026-11-20), so make
every listing change before anything is submitted:

1. Run `npm run release` as usual. It uploads the new version.
2. In the dashboard, Distribution tab: set Visibility to **Public** and save.
3. Store listing tab: paste the description above, upload all five screenshots and the small
   promo tile from `~/store-shots`, and fill in the website and support links.
4. Submit for review by hand from the dashboard, once, after steps 2 and 3: a visibility change
   made by hand needs one publish by hand before the API can publish again. If the release
   already submitted, wait for that review to finish, then make steps 2 to 4.

A public listing is reviewed more closely: the description, the screenshots in
`~/store-shots` and every permission's reason must match what the extension does.

## Releasing from the terminal

After the first upload in the dashboard, every release is one command:

    npm run release            (or: npm run release -- minor / major)

Only Wai releases (2026-11-17). The two keys it needs are locked behind a
passphrase: run `scripts/lock-release-keys.sh` once, in your own terminal. The
release runs in two phases, and the keys exist only in the second.

Phase 1 holds no key. It refuses on uncommitted changes, off `main`, or when
HEAD is not exactly GitHub's `main`. Then it prints the commits since the last
`v*` tag and waits for you to type `yes` (anything else stops it). It runs the
unit tests, lint and the end-to-end tests on that commit.

Phase 2 is `node scripts/release.mjs sign`, which the release starts itself
under `scripts/with-release-keys.sh`. That script asks for the passphrase (not
cached), unlocks the keys into memory-backed temp space for that run only, and
shreds them when it ends, however it ends. Phase 2 stops with "main moved while
testing: run again" if HEAD changed meanwhile, and refuses while a version
still waits for review. Then it bumps the version above everything the store
holds and commits `release: <version>`. It packs the signed `.crx` and the
Firefox zip from that commit into a staging folder, before anything is tagged
or pushed. If a pack fails, it undoes the version commit and nothing is tagged
or pushed. When every pack has worked it tags `v<version>`, pushes the branch
and the tag in one atomic push, uploads the `.crx` and submits it for review.
It goes live with the item's current visibility once Google approves it, and
the packs are copied into `dist/`. Back up `~/.keys/human-music-release.tar.gpg`
off this PC.

To run `upload` or `publish` by hand, wrap it the same way:
`scripts/with-release-keys.sh node scripts/release.mjs upload`.

`node scripts/release.mjs status` shows the published and submitted
versions. If an upload fails after the push, `node scripts/release.mjs
publish` (or `upload`) uploads the version at HEAD without bumping again.
Both apply the release guards: clean tree, on `main`, HEAD equal to GitHub's
`main`, and HEAD tagged `v<manifest version>`; otherwise they refuse.

The Firefox build (`scripts/build-firefox.sh [ref]`, `scripts/pack-firefox.sh
[ref]`) is made from a commit with `git archive`, never the working tree.
`pack-firefox.sh` uses the tag `v<version>` of the version at HEAD when it
exists, so the AMO zip holds exactly the released code.

One-time setup (Wai; done 2026-11-15):

1. Google Cloud console: create a project, search "Chrome Web Store API",
   enable it.
2. IAM, Service accounts (console.cloud.google.com/iam-admin/serviceaccounts):
   create one (no roles needed), then Keys, Add key, JSON. Save the file as
   `~/.keys/human-music-cws-sa.json` and `chmod 600` it.
3. Developer Dashboard, Account: add the service account's email (one per
   publisher). The publishing Google account needs 2-step verification.
4. Write `~/.keys/human-music-cws.json`:
   `{ "publisherId": "<Publisher, Settings>", "itemId": "<32 letters, Package tab>", "serviceAccountKey": "~/.keys/human-music-cws-sa.json" }`

Neither file goes in the repo. If the visibility is changed by hand in the
dashboard, publish once by hand before the API can publish again.

## Firefox (addons.mozilla.org)

Upload `dist/human-music-firefox-<version>.zip`, made by
`scripts/pack-firefox.sh` (it runs `scripts/build-firefox.sh` first and zips
`dist/firefox/` with `manifest.json` at the root). The Firefox build has not
yet been loaded in a real Firefox; do that first (`about:debugging`, This
Firefox, Load Temporary Add-on, pick `dist/firefox/manifest.json`).

**Data collection:** the manifest declares
`browser_specific_settings.gecko.data_collection_permissions` as
`{ "required": ["none"] }`, which AMO requires of every new extension. In
the upload form, answer that the extension collects no data. Firefox older
than 140 ignores the key, which is harmless here.

**Listing text:** reuse the Summary and Description from the Store listing
tab above as they are. Reuse the four screenshots (1280x800, same
order). The name and icon come from the manifest.

**Source code:** the package is plain JavaScript with no build step or
minification, so AMO should not ask for source; if it does, upload a zip of
the repo.

Wai does these herself:

1. Create or sign in to the AMO developer account
   (addons.mozilla.org/developers) and submit a new add-on.
2. Choose "On this site" (listed), upload the zip, and fix anything the
   validator reports.
3. Fill in the listing from the text above; pick the "Photos, Music &
   Videos" category (AMO's own list).
4. Submit for review. Later releases use the same pack script after bumping
   `version` in `extension/manifest.json` (AMO rejects a version it already
   has).
