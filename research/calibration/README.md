# Calibration set: artists known to be people

`known-people.json` is the "made by people" half of the investigator's
calibration sample (see the Calibration section of
`docs/superpowers/specs/2026-11-16-ai-investigator-design.md`). The other half
is about 50 AI-generated artists taken from the Soul Over AI list. The
investigator runs on both sets, and its raw confidences are mapped so that "95"
means at most about 1 wrong in 20 on this sample.

This set is only useful for new artists, so every entry's first release came in
2020 or later. An artist from before 2020 is trivially a person by date alone.

## Selection rules

- Strong public evidence the music is made by people: a Wikipedia article that
  cites press coverage, plus where found an NPR session, a prize shortlist, or
  the artist's own site. Two or more pieces where possible.
- First release in 2020 or later. The year and the Wikipedia sentence it came
  from are in each entry's first `evidence` line.
- A spread of genres, countries and sizes, from chart acts to small independent
  bands.
- On no AI-music list I could find, and no public controversy about AI use.
  Artists with any doubt were left out.
- Spotify artist ID and YouTube channel ID only where a reliable page gives them
  (the Wikidata record, linked in the entry). Left out otherwise; none guessed.

## How it was built

Candidates were chosen from general knowledge, then each was checked against
its Wikipedia article (first release, no AI mention) and Wikidata record (IDs,
official site). Official-site and NPR links were opened to confirm they load.
Only public web pages were read; nothing was signed up for, posted or sent.
Candidates whose Wikipedia text showed an earlier first release were dropped.

Known limits:

- Several entries (marked by having only a Wikipedia line plus maybe an official
  site) rest mostly on one source. Treat them as the thinner part of the sample.
- "First release" follows Wikipedia's account. Some artists may have an earlier
  small release it does not mention.
- Seven of the 51 are K-pop groups, which makes the sample heavier there than
  the real mix; reweight or drop a few if that matters.

## Public artists only

Every entry is a publicly known artist or group. No private individuals.
