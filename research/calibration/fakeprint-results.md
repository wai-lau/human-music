# Fakeprint detector: first results (2026-11-22)

Our own audio detector (design: docs/superpowers/specs/2026-11-22-fakeprint-design.md), written from
the ISMIR 2025 paper's description. Data: two 30-second Deezer previews per artist; only the
fakeprints are kept. Five folds split by artist; an artist's score is the lower of its two songs.

| Sample | Artists | Songs |
|---|---|---|
| AI: random from Zoundhub and Soul Over AI | 400 | 800 |
| People: the earlier labelled samples (new acts, faceless producers) | 161 | 322 |
| People: Deezer's related artists with a release in 2018 or earlier | 600 | 1,200 |

Logistic regression on the fakeprint (C = 0.01, balanced classes), cross-validated:

| Both songs at or above | AI caught | People flagged | Faceless people flagged |
|---|---|---|---|
| 0.5 | 258 of 400 (64.5%) | 19 of 761 (2.5%) | 2 of 11 |
| 0.7 | 218 of 400 (54.5%) | 0 of 761 | 0 of 11 |
| 0.8 | 198 of 400 (49.5%) | 0 of 761 | 0 of 11 |
| 0.9 | 158 of 400 (39.5%) | 0 of 761 | 0 of 11 |
| 0.95 | 125 of 400 (31.2%) | 0 of 761 | 0 of 11 |

The most AI-looking person scored 0.695 (Maleah Frederick), so 0.7 has almost no margin; 0.8 does.
Zero people flagged in 761 still allows a true rate up to about 0.4% (the rule of three).

Other models on the same data: boosted trees caught 205 with no person flagged and 240 with one.

Limits:
- Deezer's previews are 128 kbps MP3, which smears the high frequencies the method reads; the
  player's own stream (step 3 of the design) may do better.
- The settings (envelope width, pooling) are guesses at the paper's description; only the finished
  fakeprints were kept, so tuning them needs the audio fetched again with the full spectrum saved.
- The AI side is list artists (Zoundhub's rating 5 is not proof); the people side is mostly
  established artists, so new small acts are the least tested.

Model: research/fakeprint/model.json (weights, intercept, feature scaling).

## Held-out check: AI artists Deezer didn't flag (2026-11-23)

A side agent noted that the AI sample leans on Deezer's own labels (Zoundhub keeps artists Deezer
tags AI), so the catch rate could be inflated. Check: Soul Over AI artists that are not on Zoundhub
and were never in training, scored with the saved model. 58 of the 324 could be scored (the rest had
no exact Deezer match or no previews).

| Both songs at or above | Held-out AI caught | (cross-validation, for comparison) |
|---|---|---|
| 0.5 | 39 of 58 (67%) | 64.5% |
| 0.7 | 34 of 58 (59%) | 54.5% |
| 0.8 | 30 of 58 (52%) | 49.5% |
| 0.9 | 19 of 58 (33%) | 39.5% |

No sign of inflation at the chosen line (0.8). Some of these may still carry Deezer's tag without being
on Zoundhub, whose filter is stricter. The false-positive side never depended on Deezer's labels.

## Tuning from full spectra (2026-11-23)

Resampled with each song's 5-16 kHz mean spectrum kept (`sample.py --spectra`): 600 AI artists, 1,161 people (161 labelled, 1,000 crawled), plus 56 held-out Soul Over AI artists not on Zoundhub. `tune.py` rebuilt fakeprints over 54 settings (running-minimum width 51/151/301, smoothing 11/51, pooling 4/8/16, C 0.003/0.01/0.03).

| Model | Cross-validation: AI caught at 0.8 | People flagged at 0.8 | Held-out AI caught at 0.8 |
|---|---|---|---|
| Live model (400 AI, 761 people; min 151, smooth 51, pool 8, C 0.01) | 49.5% | 0 of 761 | 30 of 58 (52%) |
| Same settings, retrained on 600 AI and 1,161 people | 70.0% | 0 of 1,161 | 24 of 56 (43%) |
| Best retrained setting (min 301, smooth 11 or 51, pool 4, C 0.01) | 71.7% | 0 of 1,161 | 28 of 56 (50%) |

Reading: more training data lifts cross-validation by 20 points but not the held-out set. Most training AI comes from Zoundhub, which is likely Deezer-flagged, so cross-validation rewards learning what Deezer's own detector already catches. On held-out the differences are within noise (56 artists, about 6.6 points). The live model stays. A real gain needs AI training data that Deezer did not flag; player-audio fakeprints from AI songs the extension already skips would give that.

## Stored droplet verdicts through the audio model (2026-11-23, read-only)

The 202 verdicts from Claude and SH Labs, matched on Deezer by exact name only (stored rows keep no song titles; the live layer also confirms by title).

| Stored verdict | Audio model says AI | Passes on | No previews found |
|---|---|---|---|
| made by people (158) | 0 | 79 | 79 |
| AI (20) | 1 | 7 | 12 |
| unsure (16) | 0 | 6 | 10 |

No person is flagged. Only 1 of 8 AI artists with previews is caught, far under the 52% held-out rate. Eight is too few to call, but the AI acts people actually play may differ from the list artists the model learned from; player-audio data from skipped AI songs would show it.
