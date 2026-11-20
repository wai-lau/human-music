# Privacy policy

Human Music: AI Music Blocker, the browser extension in this repository.
Last updated: 20 November 2026.

Human Music collects nothing about you and sends nothing about you anywhere. It reads the music
pages you open so it can do its one job, and everything it keeps stays on your computer.

## What it reads

Human Music runs only on music.youtube.com and open.spotify.com. On those pages it reads the songs
that are playing, queued or shown on the home page and in search: the song title, the artist names,
the album, the cover picture's address, and the artist's YouTube channel ID or Spotify ID. It
compares them with the lists you have turned on, so it can skip a listed song, take it out of the
queue, or hide it on the page. It reads nothing on any other website.

## What it keeps on your computer

It stores these in the browser's own extension storage, on your computer only:

- your settings;
- your own lists of artists, songs and keywords;
- copies of the lists you subscribe to;
- a log of what it skipped, removed from the queue or hid, kept so you can check its work. The
  Web Store copy keeps up to 20,000 entries.

None of this is synced to a Google account or sent anywhere. You can clear the log or export it from
the popup, and uninstalling the extension deletes all of it.

## What it downloads

Human Music downloads the lists you have turned on, over HTTPS, from their web addresses. The
built-in lists come from GitHub (raw.githubusercontent.com): the Zoundhub copy and Human Music's
own verdicts from wai-lau/human-music-verdicts, Soul Over AI from xoundbyte/soul-over-ai, and
Cevval's list from cevvalkoala/CevvalYoutubeAIBlocklist. A list you add yourself comes from the
address you give it. These downloads ask for a file and send nothing about you or your listening.
Like any web request, they show your IP address to the server that hosts the list. Each list is
treated as plain data and never run as code.

## What it sends

Nothing. Human Music has no account, no analytics, no ads, no tracking and no cookies of its own,
and it loads no code from other sites. The copy on the Chrome Web Store never contacts the
investigator service described in the README. Only the developer's own working copy does that.

## Sharing

Human Music shares no data with anyone, because it collects none. Nothing is sold or used for
advertising. The use of information received from Google APIs will adhere to the Chrome Web Store
User Data Policy, including the Limited Use requirements.

## Permissions

- Access to music.youtube.com and open.spotify.com: to read the songs on those pages and act on
  them, as described above.
- Storage: to keep your settings, lists and log on your computer.
- Scripting: to start Human Music again in music tabs that are already open after an update.

## Changes

If this policy changes, the new version will be published here with a new date. Its history is in
this repository's commits.

## Contact

Questions about this policy: open an issue at https://github.com/wai-lau/human-music/issues.
