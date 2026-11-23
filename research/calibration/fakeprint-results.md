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
