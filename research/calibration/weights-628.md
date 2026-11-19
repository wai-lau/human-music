# Weights experiment: 628 artists (312 known AI, 316 known people)

Made 2026-11-19 by `tools/weights-analysis.mjs` from the checklist runs on `small-people.json`, `faceless-people.json`, `mb-people.json` (MusicBrainz), `ai-random.json` and the earlier hand-picked AI sample, plus 40 repeat runs. The open questions on it are in the questions page.

## Results per sample (weights in use)

| Sample | Count | Called AI at 60+ | Called AI at 95+ | Unsure |
|---|---|---|---|---|
| people, MusicBrainz | 250 | 8 of 250 (3.2%) | 0 of 250 (0.0%) | 40 |
| people, press (small) | 44 | 0 of 44 (0.0%) | 0 of 44 (0.0%) | 0 |
| AI, earlier | 62 | 54 of 62 (87.1%) | 13 of 62 (21.0%) |  |
| people, press (faceless) | 22 | 0 of 22 (0.0%) | 0 of 22 (0.0%) | 1 |
| AI, random | 250 | 209 of 250 (83.6%) | 49 of 250 (19.6%) |  |

## Cross-validated weights (5 folds: fit on four fifths, score the fifth)

| Weights | Known AI at 60+ | Known AI at 95+ | People called AI at 60+ |
|---|---|---|---|
| In use (the 106-artist fit) | 263 of 312 (84.3%) | 62 of 312 (19.9%) | 8 of 316 (2.5%) |
| Refit on all 628 (scored on the same artists) | 263 of 312 (84.3%) | 66 of 312 (21.2%) | 6 of 316 (1.9%) |
| Refit, cross-validated (each artist scored by weights that never saw it) | 264 of 312 (84.6%) | 66 of 312 (21.2%) | 6 of 316 (1.9%) |

## Each sign: weight in use, refit on all, and a 90% bootstrap range (200 resamples)

| Sign | Found, AI | Found, people | In use | Refit | 90% range |
|---|---|---|---|---|---|
| S1 | 32/312 | 0/316 | 12 | 18 | 17 to 19 |
| S2 | 53/312 | 0/316 | 9 | 20 | 19 to 21 |
| S4 | 19/312 | 0/316 | 10 | 16 | 14 to 18 |
| M2 | 15/312 | 0/316 | 9 | 15 | 12 to 16 |
| M3 | 0/312 | 0/316 | 10 | too rare | too rare |
| M4 | 112/312 | 4/316 | 15 | 14 | 11 to 18 |
| M5 | 189/312 | 14/316 | 17 | 11 | 10 to 14 |
| W1 | 271/312 | 22/316 | 11 | 11 | 10 to 13 |
| W2 | 31/312 | 2/316 | 3 | 11 | 8 to 18 |
| W7 | 18/312 | 2/316 | 2 | 9 | 6 to 16 |
| M6 | 214/312 | 11/316 | 18 | 13 | 11 to 15 |
| M7 | 2/312 | 0/316 | 7 | too rare | too rare |
| M8 | 0/312 | 0/316 | 6 | too rare | too rare |
| W3 | 44/312 | 3/316 | 13 | 11 | 8 to 15 |
| W5 | 205/312 | 40/316 | 13 | 7 | 6 to 8 |
| W8 | 112/312 | 30/316 | 11 | 6 | 5 to 7 |
| W4 | 0/312 | 0/316 | 4 | too rare | too rare |
| M9 | 1/312 | 0/316 | 7 | too rare | too rare |
| W6 | 16/312 | 1/316 | 3 | 11 | 7 to 16 |
| P3 | 2/312 | 119/316 | -13 | -17 | -24 to -14 |
| P4 | 0/312 | 14/316 | -5 | -15 | -16 to -12 |
| P5 | 0/312 | 32/316 | -8 | -18 | -19 to -17 |
| P6 | 6/312 | 149/316 | -13 | -14 | -17 to -11 |
| P7 | 1/312 | 72/316 | -13 | -17 | -22 to -14 |
| P8 | 4/312 | 141/316 | -11 | -15 | -20 to -13 |
| P9 | 5/312 | 87/316 | -11 | -12 | -16 to -10 |
| P10 | 3/312 | 51/316 | -12 | -12 | -16 to -9 |
| P11 | 7/312 | 97/316 | -10 | -11 | -14 to -9 |
| P12 | 0/312 | 1/316 | -15 | too rare | too rare |
| P13 | 14/312 | 157/316 | -13 | -10 | -13 to -9 |
| P14 | 10/312 | 124/316 | -12 | -11 | -13 to -9 |
| P15 | 0/312 | 5/316 | -1 | -10 | -13 to -10 |
| P16 | 0/312 | 0/316 | -7 | too rare | too rare |

## Logistic fit on the same signs (cross-validated), against the per-sign weights

| Model (no caps or guards in the logistic one) | Known AI at 60+ | Known AI at 95+ | People at 60+ | People at 95+ |
|---|---|---|---|---|
| Per-sign weights with caps and guards, cross-validated | 264 of 312 (84.6%) | 66 of 312 (21.2%) | 6 of 316 (1.9%) | 0 of 316 (0.0%) |
| Logistic, cross-validated | 282 of 312 (90.4%) | 115 of 312 (36.9%) | 14 of 316 (4.4%) | 1 of 316 (0.3%) |

## Guards: what each one changes (weights in use)

| Variant | Known AI at 60+ | Known AI at 95+ | People called AI at 60+ | People at 95+ |
|---|---|---|---|---|
| As in use | 263 of 312 (84.3%) | 62 of 312 (19.9%) | 8 of 316 (2.5%) | 0 of 316 (0.0%) |
| Without the faceless halving | 271 of 312 (86.9%) | 63 of 312 (20.2%) | 11 of 316 (3.5%) | 0 of 316 (0.0%) |
| Without the 94 cap (probability 95%+) | | 192 of 312 (61.5%) | | 3 of 316 (0.9%) |

## Threshold sweep (weights in use): where Aggressive and Optimal could sit

| Skip at | Known AI skipped | People skipped |
|---|---|---|
| 50 | 263 of 312 (84.3%) | 8 of 316 (2.5%) |
| 60 | 263 of 312 (84.3%) | 8 of 316 (2.5%) |
| 70 | 258 of 312 (82.7%) | 7 of 316 (2.2%) |
| 80 | 249 of 312 (79.8%) | 6 of 316 (1.9%) |
| 90 | 245 of 312 (78.5%) | 5 of 316 (1.6%) |
| 94 | 194 of 312 (62.2%) | 3 of 316 (0.9%) |
| 95 | 62 of 312 (19.9%) | 0 of 316 (0.0%) |
| 97 | 60 of 312 (19.2%) | 0 of 316 (0.0%) |
| 99 | 57 of 312 (18.3%) | 0 of 316 (0.0%) |

## Repeat runs: the same artist checked twice

- Artists checked twice: 40
- Signs found or not found the same way both times: 1254 of 1320 (95.0%)
- Same verdict both times: 38 of 40 (95.0%)
- Confidence difference: median 0, largest 53
