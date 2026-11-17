# Chrome Web Store listing

Text for each field of the developer dashboard, ready to paste. Package:
`dist/human-music-<version>.zip`, built from `extension/` with
`cd extension && zip -qr -X ../dist/human-music-$(jq -r .version manifest.json).zip .`.
Check before every upload that `extension/lists/my-lists.json` holds no
personal lists: it ships in the package.

## Package tab

Upload the zip. Name, version and icon come from `manifest.json`.

## Store listing tab

**Summary** (from the manifest, 132 characters at most):

> Keeps your YouTube Music and Spotify listening to music made by people.

**Description:**

> Human Music is for people who want their music to come from other people.
> AI-generated music is still music, and some listeners enjoy it. This
> extension is for listeners who use music to connect with other humans.
>
> On YouTube Music and Spotify, it works from lists of AI-generated artists
> and from your own lists:
>
> - Songs by listed artists are taken out of your queue before they play,
>   including the songs YouTube Music adds to its radio.
> - If one starts anyway, it moves on by exactly one song.
> - Their songs, albums and playlists are hidden on the home page, Explore
>   and search results.
> - On playlist, album and artist pages their songs are greyed out, with a
>   skip sign where the cover would be, and can't be clicked.
> - The toolbar icon shows how many songs it skipped or took out of the
>   queue in that tab.
> - A log groups everything by artist: what it kept from playing, what it
>   skipped, and anything that didn't work, with the list that caused it.
>   If an artist is there by mistake, one switch keeps them playing.
>
> You choose the lists. It comes with the Soul Over AI list of AI-generated
> artists (CC BY 4.0), and you can add your own artists, songs and keywords
> or subscribe to other lists by web address. A new list only watches, and
> shows in the log what it would skip, until you let it act.
>
> It never switches your tab or takes your keyboard focus, holds off while
> you type, and only the tab that is playing skips songs. When it isn't sure,
> the song plays.
>
> Everything stays on your computer. Human Music has no account, collects no
> data and sends nothing anywhere. It only downloads the lists you subscribe
> to.

**Category:** Entertainment. **Language:** English.

**Screenshots** (1280x800, in this order; files in `~/store-shots/`):

1. `1-greyed-out.png`: songs by listed artists greyed out on a playlist.
2. `2-blocked.png`: the log's Blocked section.
3. `3-actions.png`: the log's Actions section.
4. `4-behaviour.png`: the Behaviour settings.

The popup shots show the redesigned popup (after 0.1.2) and the Pause
switch; retake 2-4 when the filtering-mode slider ships. **Small promo
tile** (440x280): optional.

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

The list download (raw.githubusercontent.com) needs no permission: GitHub
allows any site to read its raw files.

**Remote code:** No. The lists it downloads are JSON data; all code is in
the package.

**Data usage:** collects none of the listed kinds of user data. Certify all
three statements (not sold to third parties, not used for unrelated
purposes, not used for creditworthiness or lending).

**Privacy policy URL:** none needed while no user data is collected (the
GitHub repo is private, so it can't host one yet).

## Distribution tab

Visibility: Public, Unlisted (only people with the link) or Private
(chosen testers). Regions: all.

## Releasing from the terminal

After the first upload in the dashboard, every release is one command:

    npm run release            (or: npm run release -- minor / major)

It refuses on uncommitted changes, off `main`, behind GitHub, or while a
version still waits for review. Then it runs the unit tests, lint and the
end-to-end tests, bumps the version above everything the store holds,
commits `release: <version>`, tags `v<version>`, pushes, packs the signed
`.crx` (`scripts/pack-crx.sh`), uploads it and submits it for review. It
goes live with the item's current visibility once Google approves it.

`node scripts/release.mjs status` shows the published and submitted
versions. If an upload fails after the push, `node scripts/release.mjs
publish` uploads and submits the version at HEAD without bumping again.

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
