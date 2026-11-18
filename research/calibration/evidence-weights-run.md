# Evidence-weights experiment, 2026-11-18

Wai, 2026-11-18, chose scoring each piece of evidence with a guard for faceless genres, and asked to "measure the weights on 40 labelled artists (20 AI, 20 small people)" before approving the numbers. This is that run.

## How it ran

- Claude (Opus, `--model opus`) filled in the evidence checklist (`research/investigator/src/checklist.mjs`) once per artist; `src/score.mjs` added the points with the research's weights (`signals-research.md`).
- Known AI: 10 from Soul Over AI and 10 rated 5 with Deezer's AI label on Zoundhub, debut 2020 or later (seed 20261118). The Zoundhub ten are named here only as "Zoundhub sample" until Wai decides how Zoundhub's data is used.
- Known people: `small-people.json`, 20 small acts from 2020 on, 6 of them faceless. Its caveats are in the file.
- Each artist was checked once; the order alternated people and AI.

## Results

| Confidence | Known AI caught | Known people called AI |
|---|---|---|
| 60 or more (Aggressive) | 18 of 20 | 0 of 20 |
| 95 or more (Optimal) | 4 of 20 | 0 of 20 |

For comparison, Claude's own number on the earlier calibration (50 Soul Over AI, 50 famous people) caught 16 of 50 at 60 and none at 95, also with no person called AI.

What it shows:

- The two groups separate widely: every person scored 0.3% or less (all `human`), every AI artist but two scored 64% or more.
- 95 needs a strong sign (a platform label, the artist's own disclosure or a tracker) from two sites. Claude rarely finds one: it can't read Zoundhub's pages (they are drawn by JavaScript) and Deezer's AI tag isn't in its public pages. So most AI verdicts stop at 94 and count for Aggressive only.
- Every sign that showed up pointed the right way. No sign was found for more people than AI artists, and none of the AI-side signs was found for a person except W5 (no bio) and W8 (own-name label), once each.
- The faceless people all scored as people: press, Bandcamp, labels and credits outweighed their thin footprint. The guard was never needed here, so this run doesn't test it.

## Per artist

| Artist | Truth | Faceless | P(AI) | Verdict | Confidence |
|---|---|---|---|---|---|
| Zoundhub sample 6 | AI | no | 100.0% | ai | 100 |
| Zoundhub sample 9 | AI | no | 100.0% | ai | 100 |
| Zoundhub sample 10 | AI | no | 99.9% | ai | 100 |
| Feral Cry | AI | no | 99.5% | ai | 99 |
| Wren and the Daughters of the Bear | AI | no | 97.2% | ai | 94 |
| AI MUSIC MATRIX | AI | no | 97.2% | ai | 94 |
| Zoundhub sample 7 | AI | no | 97.2% | ai | 94 |
| Zoundhub sample 5 | AI | no | 94.0% | ai | 94 |
| Art Roseman | AI | no | 89.8% | ai | 90 |
| Moebius FM | AI | no | 89.8% | ai | 90 |
| GNX75 | AI | no | 84.8% | ai | 85 |
| Zoundhub sample 1 | AI | no | 84.8% | ai | 85 |
| Zoundhub sample 8 | AI | no | 84.8% | ai | 85 |
| Zoundhub sample 4 | AI | no | 73.6% | ai | 74 |
| Berachah | AI | no | 68.9% | ai | 69 |
| Zoundhub sample 2 | AI | no | 68.9% | ai | 69 |
| Zoundhub sample 3 | AI | no | 68.9% | ai | 69 |
| Salen Records | AI | no | 63.8% | ai | 64 |
| Lydian Dominant | AI | no | 41.2% | unsure | 41 |
| Kuroi Riquid | AI | no | 5.3% | unsure | 5 |
| jüle. | people | yes | 0.3% | human | 100 |
| MZA | people | no | 0.0% | human | 100 |
| Confidential | people | yes | 0.0% | human | 100 |
| Weekend Punks | people | no | 0.0% | human | 100 |
| faff | people | yes | 0.0% | human | 100 |
| Anhedral | people | yes | 0.0% | human | 100 |
| Of Thread & Mist | people | yes | 0.0% | human | 100 |
| Nervous Light | people | no | 0.0% | human | 100 |
| Hoffy Beats | people | yes | 0.0% | human | 100 |
| Aló Presidente | people | no | 0.0% | human | 100 |
| Electron Odyssey | people | no | 0.0% | human | 100 |
| Genevieve Sovereign | people | no | 0.0% | human | 100 |
| Jade Relics | people | no | 0.0% | human | 100 |
| Assistert Sjølmord | people | no | 0.0% | human | 100 |
| UFO95 | people | no | 0.0% | human | 100 |
| Kataan | people | no | 0.0% | human | 100 |
| Atalaia Airlines | people | no | 0.0% | human | 100 |
| Goatroper | people | no | 0.0% | human | 100 |
| Howl Quartet | people | no | 0.0% | human | 100 |
| Mist & Wing | people | no | 0.0% | human | 100 |

## Per sign

"Measured points" is 10·log10 of (how often the sign was found for AI artists) over (how often for people), with half a count added to each side. With 20 per side, a sign found only on one side can't measure past about ±16, and the samples were chosen to be clear cases, so the measured numbers run high.

| Sign | Found, AI | Found, people | Unknown (all) | Measured points | Research points |
|---|---|---|---|---|---|
| S1 | 3/20 | 0/20 | 26/40 | 8.5 | 20 |
| S2 | 1/20 | 0/20 | 1/40 | 4.8 | 20 |
| S3 | 0/20 | 0/20 | 40/40 | 0 | {"found":15,"from_label":20} |
| M1 | 0/20 | 0/20 | 40/40 | 0 | {"self_disclosed":13,"likely":10} |
| S4 | 1/20 | 0/20 | 31/40 | 4.8 | 15 |
| M2 | 0/20 | 0/20 | 32/40 | 0 | 9 |
| M4 | 10/20 | 0/20 | 4/40 | 13.2 | 14 |
| M5 | 13/20 | 0/20 | 4/40 | 14.3 | 10 |
| W1 | 19/20 | 0/20 | 0/40 | 15.9 | 3 |
| W2 | 2/20 | 0/20 | 2/40 | 7 | 3 |
| W7 | 3/20 | 0/20 | 10/40 | 8.5 | 2 |
| M6 | 15/20 | 0/20 | 1/40 | 14.9 | 9 |
| M7 | 0/20 | 0/20 | 28/40 | 0 | 7 |
| M8 | 0/20 | 0/20 | 34/40 | 0 | 6 |
| W3 | 3/20 | 0/20 | 4/40 | 8.5 | 4 |
| W5 | 17/20 | 1/20 | 8/40 | 10.7 | 2 |
| W8 | 8/20 | 1/20 | 15/40 | 7.5 | 1 |
| M9 | 0/20 | 0/20 | 39/40 | 0 | 7 |
| W6 | 0/20 | 0/20 | 36/40 | 0 | 3 |
| P2 | 1/20 | 20/20 | 0/40 | -11.4 | {"hard_date":-11,"streaming_date":-8} |
| P3 | 0/20 | 6/20 | 8/40 | -11.1 | -15 |
| P4 | 0/20 | 1/20 | 17/40 | -4.8 | -5 |
| P5 | 0/20 | 1/20 | 20/40 | -4.8 | -8 |
| P6 | 0/20 | 16/20 | 2/40 | -15.2 | -10 |
| P7 | 0/20 | 0/20 | 4/40 | 0 | -13 |
| P8 | 1/20 | 8/20 | 4/40 | -7.5 | -6 |
| P9 | 0/20 | 10/20 | 8/40 | -13.2 | -8 |
| P10 | 0/20 | 10/20 | 4/40 | -13.2 | -8 |
| P11 | 3/20 | 14/20 | 3/40 | -6.2 | -6 |
| P12 | 0/20 | 0/20 | 40/40 | 0 | -15 |
| P13 | 1/20 | 13/20 | 4/40 | -9.5 | -5 |
| P14 | 0/20 | 15/20 | 5/40 | -14.9 | -8 |
| P15 | 0/20 | 1/20 | 3/40 | -4.8 | -1 |

## Limits

- 40 artists is small. Zero people wrong in 20 means the true rate could still be up to about 15% (the rule of three); together with the 50 famous people of the first calibration, up to about 4%.
- The people sample was picked for clear public evidence, and three acts may be bigger than "small", so people were easier to recognise here than in real queues.
- The AI sample comes from lists, so these are AI artists someone already caught.

## Reading

The research's weights did the job: no person was called AI, and nearly every AI artist reached Aggressive. Where the measured weights differ (W1, W5, P6, P14 measure higher), the samples were chosen to be clear cases, so the measured numbers overstate; the research's lower numbers are the safer choice for real queues.
