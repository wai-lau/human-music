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
>   skip sign where the cover would be.
> - The toolbar icon shows how many songs it skipped or took out of the
>   queue in that tab.
> - A log shows every song it skipped, removed or hid, and which list caused
>   it. One click there tells it never to skip that artist again.
>
> You choose the lists. It comes with the Soul Over AI list of AI-generated
> artists (CC BY 4.0), and you can add your own artists, songs and keywords
> or subscribe to other lists by web address.
>
> It never switches your tab or takes your keyboard focus, holds off while
> you type, and only the tab that is playing skips songs. When it isn't sure,
> the song plays.
>
> Everything stays on your computer. Human Music has no account, collects no
> data and sends nothing anywhere. It only downloads the lists you subscribe
> to.

**Category:** Entertainment. **Language:** English.

**Screenshots:** at least one, 1280x800 or 640x400. **Small promo tile**
(440x280): optional.

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
