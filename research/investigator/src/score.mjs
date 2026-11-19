// Evidence scoring for the investigator. Signs, weights, groups, caps and guards
// from research/calibration/signals-research.md: section 3 (signs), section 4
// (combination rules), section 5 (worked examples).
import { siteOf } from './answer.mjs';

// Weights measured on 628 labelled artists, 312 known AI and 316 known people (Wai, 2026-11-19:
// "1A"; before that 106 artists, 2026-11-18 "1B"): every sign found 5 or more times takes its
// measured weight, rarer signs keep the research weights. See research/calibration/weights-628.md.
export const SIGNS = {
  S1: { group: 'A', points: 18 },
  S2: { group: 'A', points: 20 },
  S3: { group: 'A', points: { found: 15, from_label: 20 } },
  M1: { group: 'A', points: { self_disclosed: 13, likely: 10 } },
  S4: { group: 'B', points: 16 },
  M2: { group: 'B', points: 15 },
  M3: { group: 'B', points: 10 },
  M4: { group: 'C', points: 14 },
  M5: { group: 'C', points: 11 },
  W1: { group: 'C', points: 11 },
  W2: { group: 'C', points: 11 },
  W7: { group: 'C', points: 9 },
  M6: { group: 'D', points: 13 },
  M7: { group: 'D', points: 7 },
  M8: { group: 'D', points: 6 },
  W3: { group: 'D', points: 11 },
  W5: { group: 'D', points: 7 },
  W8: { group: 'D', points: 6 },
  W4: { group: 'E', points: 4 },
  M9: { group: 'E', points: 7 },
  W6: { group: 'F', points: 11 },
  P2: { group: 'people', points: { hard_date: -11, streaming_date: -8 } },
  P3: { group: 'people', points: -17 },
  P4: { group: 'people', points: -15 },
  P5: { group: 'people', points: -18 },
  P6: { group: 'people', points: -14 },
  P7: { group: 'people', points: -17 },
  P8: { group: 'people', points: -15 },
  P9: { group: 'people', points: -12 },
  P10: { group: 'people', points: -12 },
  P11: { group: 'people', points: -11 },
  P12: { group: 'people', points: -15 },
  P13: { group: 'people', points: -10 },
  P14: { group: 'people', points: -11 },
  P15: { group: 'people', points: -10 },
  P16: { group: 'people', points: -7 },
};

const GROUP_CAPS = { A: 30, B: 15, C: 15, D: 10, E: 7, F: 3 };
const FACELESS = [/lofi/i, /lo-fi/i, /chillhop/i, /ambient/i, /sleep/i, /meditation/i, /study/i, /cafe\s+jazz/i, /café\s+jazz/i, /bossa/i, /playlist\s+piano/i];

export function isFaceless(genres) {
  if (!Array.isArray(genres)) return false;
  return genres.some((g) => typeof g === 'string' && FACELESS.some((p) => p.test(g)));
}

function signPoints(def, status) {
  if (typeof def.points === 'number') return status === 'found' ? def.points : 0;
  // Own levels only: a status such as "constructor" is not a level.
  return typeof status === 'string' && Object.hasOwn(def.points, status) ? def.points[status] : 0;
}

export function scoreChecklist(input, opts) {
  try {
    const prior = opts?.prior ?? 0.1;
    const signs = typeof input?.signs === 'object' && input?.signs !== null ? input.signs : {};
    const genres = Array.isArray(input?.genres) ? input.genres : [];
    const sources = Array.isArray(input?.sources) ? input.sources : [];

    let score = 10 * Math.log10(prior / (1 - prior));
    const faceless = isFaceless(genres);
    const groups = { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, people: 0 };
    const buckets = { A: [], B: [], C: [], D: [], E: [], F: [] };

    for (const [code, status] of Object.entries(signs)) {
      const def = SIGNS[code];
      if (!def) continue;
      const pts = signPoints(def, status);
      if (def.group === 'people') {
        groups.people += pts;
      } else if (pts > 0) {
        buckets[def.group].push(pts);
      }
    }

    for (const g of ['A', 'B', 'C', 'D', 'E', 'F']) {
      buckets[g].sort((a, b) => b - a);
      let group = buckets[g][0] || 0;
      if (buckets[g][1]) group += buckets[g][1] / 2;
      groups[g] = Math.min(GROUP_CAPS[g], group);
    }

    if (faceless) {
      groups.C /= 2;
      groups.D /= 2;
    }

    if (signs.S1 === 'found') groups.B = Math.min(groups.B, 3);

    const otherAboveZero = ['A', 'B', 'C', 'D', 'F'].some((g) => groups[g] > 0);
    if (groups.E > 0 && !otherAboveZero) groups.E = 0;

    score += groups.A + groups.B + groups.C + groups.D + groups.E + groups.F + groups.people;

    // A curated list naming the artist (S4) or YouTube Music's own AI tag (S3) decides on its own
    // (Wai, 2026-11-18: "treat the lists and YTM tags as absolute").
    if (signs.S4 === 'found' || signs.S3 === 'found' || signs.S3 === 'from_label') {
      return { score, probability: 1, verdict: 'ai', confidence: 100, faceless, groups, absolute: true };
    }

    const probability = 1 / (1 + Math.pow(10, -score / 10));
    let confidence = Math.round(probability * 100);

    const strongSign =
      signs.S1 === 'found' ||
      signs.S2 === 'found' ||
      signs.S3 === 'found' ||
      signs.S3 === 'from_label' ||
      signs.S4 === 'found';
    const sites = new Set(sources.map(siteOf).filter(Boolean));
    const canExceed94 = strongSign && sites.size >= 2;
    const strongPeople = Object.entries(signs).some(([code, status]) => {
      const def = SIGNS[code];
      return def?.group === 'people' && signPoints(def, status) <= -10;
    });

    if (!canExceed94) confidence = Math.min(confidence, 94);
    if (strongPeople && signs.S2 !== 'found') confidence = Math.min(confidence, 94);
    if (faceless && groups.A <= 0 && groups.B <= 0) confidence = Math.min(confidence, 59);

    if (confidence >= 60) return { score, probability, verdict: 'ai', confidence, faceless, groups };
    if (probability <= 0.05) return { score, probability, verdict: 'human', confidence: Math.round((1 - probability) * 100), faceless, groups };
    return { score, probability, verdict: 'unsure', confidence, faceless, groups };
  } catch {
    return { score: -9.542, probability: 0.1, verdict: 'unsure', confidence: 10, faceless: false, groups: { A: 0, B: 0, C: 0, D: 0, E: 0, F: 0, people: 0 } };
  }
}
