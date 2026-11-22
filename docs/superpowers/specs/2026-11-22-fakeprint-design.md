# Our own audio detector ("fakeprint" layer)

Wai, 2026-11-22, after reading about ETCH's Quicksilver: "use this, or some variant of it as an
additional signal", then choosing to build our own variant: "B ... We have like 10k artists".

## Why

SH Labs is the only audio opinion today, and it is a paid outside service with a monthly quota.
A detector of our own adds a second, independent audio opinion, with no quota, trained on the
artists our lists already label.

## The method (from the published paper, not from anyone's code)

Afchar, Meseguer Brocal, Akesbi and Hennequin, "A Fourier Explanation of AI-music Artifacts"
(ISMIR 2025). AI music generators leave a fixed pattern of small peaks in the high frequencies of
the spectrum. The "fakeprint" of a song:

1. decode the audio to mono at 44.1 kHz;
2. take a long-window spectrum (FFT size 2^14) and average its magnitude (in dB) over time;
3. keep the 5-16 kHz band;
4. subtract a lower envelope of that curve, so only the peaks above it remain;
5. scale to a maximum of 1.

A small classifier (logistic regression) on that curve says how likely the song is AI-made.
Quicksilver is this idea packaged; we write ours from the paper's description. Deezer's
research code is non-commercial licensed and is not used or copied.

## Audio source

Wai, 2026-11-22: "Audio source, record audio output (tiny clips from YTM)". Checked live the same
day: the content script can take the YouTube Music player's own audio (`video.captureStream()`),
48 kHz, at full level whatever the player's volume (a 4-second test at 2% volume came back clear).
No new permission is needed. The fakeprint needs only a time-averaged spectrum, so the extension
can build it while the song plays (Web Audio's analyser, FFT size 2^14) without recording or
keeping any audio: about 30 seconds of listening gives one fakeprint.

That allows two places for the detector:

| Where | What happens | Notes |
|---|---|---|
| A. In every copy | after ~30 s of a song, the copy scores the fakeprint with the shipped model (a few hundred weights) and remembers the result for that artist on this computer; a confident AI score acts like a verdict | nothing leaves the computer; only the playing song can be heard, so the first song of an AI artist plays ~30 s before a skip |
| B. In the investigator | Wai's own copy sends fakeprints (numbers, no audio) with the artist to the investigator, which adds the score as a layer | only artists Wai plays; the store copy sends nothing, as today |

Recommended: both. B also builds the training data (fakeprints from YouTube Music's own audio,
labelled by the lists and by verdicts), which fits the model to what copies hear; A ships once the
model's numbers are approved. Deezer previews (below) start the training before that data grows.

## Data

| Side | Source | Size to aim for |
|---|---|---|
| AI | artists on Zoundhub, Soul Over AI and Cevval (about 10,000) | 2,000 drawn at random |
| People | new acts from MusicBrainz (the existing sampler), plus the earlier people samples | 2,000 |

For each artist: find it on Deezer (exact name, as the ISRC link does), take its top two tracks'
30-second previews, compute the fakeprints in memory, and keep only the fakeprints (a few hundred
numbers per song). No audio is stored.

## Measuring before using

Five-fold cross-validation on the 4,000 artists, reported like the weights experiment: AI caught
and people wrongly flagged at each threshold, and on the press-picked faceless people separately.
Tested on the previews' 30 seconds, since that is what the service will hear. The layer goes in
only with a threshold where no person in the sample is flagged, and Wai approves the numbers.

## In the service

A layer beside SH Labs: two Deezer previews scored by our model, graded like SH Labs (both songs
over the approved line: AI below Optimal at first; both well under: made by people; else on to
the next layer). The model is a list of weights; scoring runs in Node with the audio decoded by
ffmpeg on the droplet. The research runs in Python on Wai's PC.

## Risks

- **Patents.** Deezer says it has applied for two patents on synthetic-content detection; the
  licence of its code grants no patent rights. A free, non-commercial project is a low-value
  target, but the risk is not zero. Wai accepts it by choosing this route.
- **Older and newer generators.** The paper's peaks come from specific generators; a new one may
  not leave them. The cross-validation shows how much of today's lists it catches.
- **Previews.** 30 seconds may carry weaker peaks than a full song.

## Steps

1. Sampler: fetch Deezer previews, compute fakeprints, save them (research tool, Python).
2. Train and measure (cross-validation, threshold sweep); write the numbers up for Wai.
3. In the extension (Wai's copy first): build the fakeprint from the playing song and send it to the
   investigator (B); check live that its fakeprints match the ones from previews.
4. If Wai approves the numbers: the investigator layer, then the in-copy score (A), each a Qwen task
   with a contract. The privacy policy then says the audio is analysed on the computer.
