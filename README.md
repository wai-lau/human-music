# Human Music

<img src="extension/icons/icon128.png" alt="" width="64" align="right">

A Chrome extension for [YouTube Music](https://music.youtube.com) that keeps
your listening to music made by people.

**Status:** in development. Not ready to install yet.

## What it does

- Takes songs by listed AI-generated artists out of your queue before they
  play.
- Skips one if it plays anyway, moving on exactly one song.
- Hides their songs, albums and playlists on the home page, Explore and
  search results.
- Logs every song it removed, skipped or hid, with the list that caused it,
  so you can check its work.

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

1. Download or clone this repository.
2. Open `chrome://extensions` and switch on **Developer mode**.
3. Click **Load unpacked** and pick the `extension` folder.

## How it decides

Human Music checks songs against lists:

- Filter lists you subscribe to. The Soul Over AI list is built in, and
  you can add others by URL. Each one can be switched off, or put in watch
  mode, where it only logs what it would have done.
- Your own lists of artists, songs and keywords. Add to them from the
  popup or with the Block artist and Block song buttons on the player.
- Never skip: an artist on that list is always played, whatever the other
  lists say.

An artist matches only when they're credited on the song. A list entry
called "After Midnight" catches the artist After Midnight, not every song
with that title.

Coming from YTM AI Artist & Song Blocker? Export a backup there and import
it in Human Music's Lists tab to keep your lists.

## Credits

The built-in list is the [Soul Over AI](https://souloverai.com) list by
souloverai.com, used under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Development

Plain JavaScript with no build step and no dependencies. The `extension`
folder is the whole extension. Run the tests with Node 18 or later:

```sh
for f in tests/*.test.mjs; do node "$f" || exit 1; done
```

## License

MIT, copyright wai-lau. See [LICENSE](LICENSE).
