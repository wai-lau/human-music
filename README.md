# Human Music

<img src="extension/icons/icon128.png" alt="" width="64" align="right">

A browser extension for [YouTube Music](https://music.youtube.com) and the
[Spotify web player](https://open.spotify.com) that keeps your listening to
music made by people.

**Status:** early. I use it loaded unpacked; it isn't on the Chrome Web
Store.

## What it does

- Takes songs by listed AI-generated artists out of your queue before they
  play, including the songs YouTube Music adds to its own radio.
- Skips one if it plays anyway, moving on exactly one song.
- Hides their songs, albums and playlists on the home page, Explore and
  search results.
- Greys out their songs on playlist, album and artist pages, with a skip
  sign where the cover would be, so you can see what will be skipped.
- Shows on the toolbar icon how many songs it skipped or took out of the
  queue in that tab.
- Logs every song it removed, skipped or hid, with the list that caused it,
  so you can check its work.

Everything happens inside the music tab. It doesn't switch tabs or
take your keyboard focus, it holds off while you type, and if you have more
than one music tab open, only the one that's playing skips songs.

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

In Chrome:

1. Download or clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick the `extension` folder.

In Firefox (121 or later), run `scripts/build-firefox.sh`, open
`about:debugging`, choose This Firefox, then Load Temporary Add-on, and pick
`dist/firefox/manifest.json`. Firefox support is new and hasn't been tried in
Firefox itself yet.

## Spotify

On Spotify, Human Music matches listed artists by their Spotify ID, so a
look-alike name never counts. It removes listed songs from your queue (it
opens the Queue panel once to see them; close it and it stays closed), skips
one that starts anyway, and hides listed artists' songs and albums on the home page
and in search. Spotify has no dislike button, so auto-dislike only skips there.

## How it decides

Human Music checks songs against lists:

- Filter lists you subscribe to. The Soul Over AI list is built in, and
  you can add others by URL. Each one can be switched off, or put in watch
  mode, where it only logs what it would have done.
- Your own lists of artists, songs and keywords. Add to them from the
  popup, or press the block button (a circle with a slash) next to Repeat
  on the player to add the artist that's playing.
- Never skip: an artist on that list is always played, whatever the other
  lists say.

An artist matches only when they're credited on the song. A list entry
called "After Midnight" catches the artist After Midnight, not every song
with that title.

For now the repository also holds a copy of my own lists in
`extension/lists/`. The extension imports it when it installs, so the lists
survive removing the extension. If you load the folder yourself and don't
want my lists, empty `my-lists.json` first.

Coming from YTM AI Artist & Song Blocker? Export a backup there and import
it in Human Music's Lists tab to keep your lists.

## Credits

The built-in list is the [Soul Over AI](https://souloverai.com) list by
souloverai.com, used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Development

Plain JavaScript with no build step and no dependencies. The `extension`
folder is the whole extension, loaded as it is. The unit tests need Node 18
or later and nothing installed:

```sh
npm test
```

The linter and the end-to-end tests use a few dev tools listed in
`package.json`; none of them ship with the extension. Install them once:

```sh
npm install
npx playwright install chromium
```

Then:

```sh
npm run lint   # ESLint over the extension, tests and e2e
npm run e2e    # Chromium with the extension loaded, on stand-in pages
```

The end-to-end tests stay offline. Each one starts Chromium with a fresh
profile and the extension unpacked, and serves small stand-in pages in place
of music.youtube.com and open.spotify.com, built from the page selectors in
the spec. Set `HM_E2E_HEADED=1` to watch them run.

Release to the Chrome Web Store: `npm run release` (see `docs/store-listing.md`;
needs the signing key and the store credentials in `~/.keys`).

## License

MIT, copyright wai-lau. See [LICENSE](LICENSE).
