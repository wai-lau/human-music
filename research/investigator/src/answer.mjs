// The only shape of answer the service accepts from Claude, and the rule that
// decides what an answer may claim. Strict on purpose: anything that is not
// exactly right is rejected, never repaired, because the answer is produced by
// a model that has read text strangers wrote.

export const SIGNALS = ['deezer_ai_label', 'no_human_footprint', 'short_heavy_catalogue', 'ai_style_art', 'tracker_listing', 'own_disclosure'];
export const STRONG = ['deezer_ai_label', 'own_disclosure', 'tracker_listing'];

const VERDICTS = ['ai', 'human', 'unsure'];
const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const CHANNEL_ID = /^UC[A-Za-z0-9_-]{22}$/;
const MAX_REASONS = 10;
const MAX_SOURCES = 5;
const MAX_REASON_LEN = 500;
const MAX_SOURCE_LEN = 500;
// Without a strong signal an ai verdict stays under the extension's Optimal line (95).
const WEAK_AI_CAP = 94;
const DOWNGRADE_CAP = 50;

export const ANSWER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['verdict', 'confidence', 'signals', 'reasons', 'sources'],
  properties: {
    verdict: { type: 'string', enum: VERDICTS },
    confidence: { type: 'integer', minimum: 0, maximum: 100 },
    signals: { type: 'array', uniqueItems: true, items: { type: 'string', enum: SIGNALS } },
    reasons: { type: 'array', maxItems: MAX_REASONS, items: { type: 'string', maxLength: MAX_REASON_LEN } },
    sources: { type: 'array', maxItems: MAX_SOURCES, items: { type: 'string', pattern: '^https://', maxLength: MAX_SOURCE_LEN } },
    spotifyId: { type: 'string', pattern: '^[A-Za-z0-9]{22}$' },
    channelId: { type: 'string', pattern: '^UC[A-Za-z0-9_-]{22}$' },
    trackIds: { type: 'array', maxItems: 2, items: { type: 'string', pattern: '^[A-Za-z0-9]{22}$' } },
  },
};

const fail = (reason) => ({ ok: false, reason });
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) &&
  (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
const strings = (v, max, maxLen, test) =>
  Array.isArray(v) && v.length <= max && v.every((s) => typeof s === 'string' && s.length <= maxLen && (!test || test(s)));

export function checkAnswer(raw) {
  if (!isPlain(raw)) return fail('answer is not an object');
  const allowed = Object.keys(ANSWER_SCHEMA.properties);
  for (const k of Object.getOwnPropertyNames(raw)) {
    if (!allowed.includes(k)) return fail(`unknown key ${JSON.stringify(k).slice(0, 40)}`);
  }
  for (const k of ANSWER_SCHEMA.required) {
    if (!Object.hasOwn(raw, k)) return fail(`missing ${k}`);
  }
  if (typeof raw.verdict !== 'string' || !VERDICTS.includes(raw.verdict)) return fail('verdict not one of ai, human, unsure');
  if (!Number.isInteger(raw.confidence) || raw.confidence < 0 || raw.confidence > 100) return fail('confidence not an integer 0-100');
  if (!Array.isArray(raw.signals) || !raw.signals.every((s) => typeof s === 'string' && SIGNALS.includes(s))) return fail('unknown signal');
  if (new Set(raw.signals).size !== raw.signals.length) return fail('duplicate signal');
  if (!strings(raw.reasons, MAX_REASONS, MAX_REASON_LEN)) return fail('reasons invalid');
  if (!strings(raw.sources, MAX_SOURCES, MAX_SOURCE_LEN, (s) => s.startsWith('https://'))) return fail('sources invalid');
  if (Object.hasOwn(raw, 'spotifyId') && !(typeof raw.spotifyId === 'string' && SPOTIFY_ID.test(raw.spotifyId))) return fail('spotifyId invalid');
  if (Object.hasOwn(raw, 'channelId') && !(typeof raw.channelId === 'string' && CHANNEL_ID.test(raw.channelId))) return fail('channelId invalid');
  if (Object.hasOwn(raw, 'trackIds') && !strings(raw.trackIds, 2, 22, (s) => SPOTIFY_ID.test(s))) return fail('trackIds invalid');

  const answer = {
    verdict: raw.verdict,
    confidence: raw.confidence,
    signals: [...raw.signals],
    reasons: [...raw.reasons],
    sources: [...raw.sources],
  };
  for (const k of ['spotifyId', 'channelId']) if (Object.hasOwn(raw, k)) answer[k] = raw[k];
  if (Object.hasOwn(raw, 'trackIds')) answer.trackIds = [...raw.trackIds];
  return { ok: true, answer };
}

// The rule is enforced here, not trusted to the prompt. What the model says in
// verdict and confidence never exceeds what its (checked) signals support.
export function decide(answer) {
  const { verdict, confidence, signals, reasons, sources } = answer;
  const base = { verdict, confidence, signals, reasons, sources, downgraded: false };
  if (verdict !== 'ai') return base;
  const distinct = new Set(signals);
  const strong = signals.some((s) => STRONG.includes(s));
  if (!strong && distinct.size < 2) {
    return { ...base, verdict: 'unsure', confidence: Math.min(confidence, DOWNGRADE_CAP), downgraded: true };
  }
  return { ...base, confidence: strong ? confidence : Math.min(confidence, WEAK_AI_CAP) };
}
