# Human Music: AI Music Blocker

<img src="extension/icons/icon128.png" alt="" width="64" align="right">

A browser extension for [YouTube Music](https://music.youtube.com) and the
[Spotify web player](https://open.spotify.com) that keeps your listening to
music made by people.

Human Music is on the [Chrome Web Store](https://chromewebstore.google.com/detail/gfmfiblcoldnfgafoapjmelpedonegca).
A Firefox build exists, but I haven't tried it in Firefox yet.

## What it does

On YouTube Music and Spotify, Human Music keeps songs by AI-generated artists
out of your listening: out of your queue before they play, skipped if one
starts anyway, and hidden on the home page and in search.

A slider in the popup sets how much it filters. No filtering turns it off.
List only acts on the lists below. Optimal and Aggressive also act on the
investigator's verdicts (see below) at a confidence of 95 or higher (Optimal)
or 60 or higher (Aggressive). Until the verdict list has been calibrated, both
of those fall back to List only. List only is the default until then, and
Optimal after that, unless you've picked a mode yourself.

It works from lists you choose: [Zoundhub](https://zoundhub.com)'s clearest
AI flags, Cevval's AI music list, Human Music's own verdicts, your own
artists, songs and keywords, or any list you subscribe to by web address. The
first three are built in. [Soul Over AI](https://souloverai.com) (CC BY 4.0),
which stopped updating in March 2026, is built in too but starts switched off
on new installs. A new list only watches, and logs what it would skip, until
you let it act.

From Zoundhub, Human Music uses only the artists it rates 5 dots that also
carry Deezer's AI label and first released music in 2020 or later. Zoundhub
calls its rating "an AI signal, not a verified classification", so the less
certain ratings are left out, and a name Zoundhub also gives to a low-rated
artist only matches that artist's Spotify ID. A copy of that list is
refreshed in [human-music-verdicts](https://github.com/wai-lau/human-music-verdicts).

Lists can't keep up with every new artist, so I run an
investigator service that checks artists that aren't on any list yet. It looks
for several independent sources, gives each artist a verdict with a
confidence, and publishes the verdicts as a public list,
[human-music-verdicts](https://github.com/wai-lau/human-music-verdicts). The
extension only downloads that list. The service is my own, runs on my server
and isn't part of the extension package: the Chrome Web Store copy never
contacts it. The code is in [`research/investigator`](research/investigator).

There's no account, tracking or ads. Human Music collects nothing and sends
nothing; it only downloads the lists you use. Your settings and its log stay
on your computer and go away when you uninstall it. It asks for access to
YouTube Music and Spotify only, and treats every list as plain data.

Human Music is free and will stay free, under the MIT license.

## Why

AI music is music, and there's nothing wrong with making or liking it. I
listen to music to feel connected to other people, though, and a song
without a person behind it can't give me that. I don't think AI music is
worse; it's a different kind of thing. Human Music is for people who want
their listening to stay with music made by people.

That's also why it errs toward playing. Skipping a real artist by mistake
is the worst thing it could do, so when it isn't sure, the song plays. If
anything goes wrong (a page change, a slow network, a missing list), the
song plays too.

## Install

Install it from the [Chrome Web Store](https://chromewebstore.google.com/detail/gfmfiblcoldnfgafoapjmelpedonegca).
The store copy updates itself, so you get fixes as they ship.

To work on the code instead, clone this repository, open `chrome://extensions`,
switch on **Developer mode**, click **Load unpacked** and pick the `extension`
folder. A copy loaded this way doesn't update, and it behaves like the store
copy: the development aids stay off unless the folder holds the owner's
`dev-copy` marker file, which is never committed.

In Firefox (121 or later), run `scripts/build-firefox.sh`, open
`about:debugging`, choose This Firefox, then Load Temporary Add-on, and pick
`dist/firefox/manifest.json`.

## Spotify

On Spotify, Human Music matches listed artists by their Spotify ID, so a
look-alike name never counts. It removes listed songs from your queue (it
opens the Queue panel once to see them; close it and it stays closed), skips
one that starts anyway, and hides listed artists' songs and albums on the home page
and in search. Spotify has no dislike button, so auto-dislike only skips there.

## How it decides

Human Music checks songs against lists:

- Filter lists you subscribe to. The Zoundhub, Cevval, Human Music verdict
  and Soul Over AI lists are built in, and you can add others by URL. Each one can be switched off, or put in watch
  mode, where it only logs what it would have done.
- Your own lists of artists, songs and keywords. Add to them from the
  popup, or press the block button (a circle with a slash) next to Repeat
  on the player to add the artist that's playing.
- Never skip: an artist on that list is always played, whatever the other
  lists say.

An artist matches only when they're credited on the song. A list entry
called "After Midnight" catches the artist After Midnight, not every song
with that title.

The repository also holds a copy of my own lists in `extension/lists/`, so
they survive removing the extension. Only my own working copy (the one with
the `dev-copy` marker) imports them; a copy you load yourself starts with the
built-in lists only.

Coming from YTM AI Artist & Song Blocker? Export a backup there and import
it in Human Music's Lists tab to keep your lists.

## Credits

The Zoundhub list comes from [zoundhub.com](https://zoundhub.com). The Soul
Over AI list is by souloverai.com, used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Development

Plain JavaScript with no build step and no dependencies. The `extension`
folder is the whole extension, loaded as it is. The unit tests need Node 18
or later and nothing installed:

```sh
npm test
```

The linter and the end-to-end tests use a few dev tools listed in
`package.json` (they need Node 20.19 or later); none of them ship with the
extension. Install them once:

```sh
npm install
npx playwright install chromium
```

Then:

```sh
npm run lint   # ESLint over the whole repository
npm run e2e    # Chromium with the extension loaded, on stand-in pages
```

The end-to-end tests stay offline. Each one starts Chromium with a fresh
profile and its own temporary copy of the extension, and serves small stand-in pages in place
of music.youtube.com and open.spotify.com, built from the page selectors in
the spec. Set `HM_E2E_HEADED=1` to watch them run.

Release to the Chrome Web Store: `npm run release`. It first checks the commit
and runs the tests with no key unlocked, then asks for a passphrase to unlock
the signing key and store credentials for the signing and upload step only (see
`docs/store-listing.md`).

## License

MIT, copyright wai-lau. See [LICENSE](LICENSE).
