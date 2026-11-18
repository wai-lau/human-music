// The evidence checklist Claude fills in (Wai, 2026-11-18: scoring with the faceless guard).
// Claude no longer gives a gut number: for each sign it says found, not found or unknown, with
// the page that shows it, and src/score.mjs adds the points. The signs and their wording come
// from research/calibration/signals-research.md section 3. Three signs are left out because the
// service checks them itself: M3 and P16 (SH Labs), W4 (the tool-less cover look); and P1
// (a release before 2020) is the cheap pass's rule before Claude runs at all.

const HTTPS = /^https:\/\/[^\s]+$/;

// code -> [the status words Claude may use besides not_found and unknown, the wording]
export const CHECKLIST = {
  S1: [['found'], 'Deezer shows its "AI-generated content" tag on the artist\'s own main catalogue (Zoundhub\'s artist page relays it as "Deezer AI flag: Found").'],
  S2: [['found'], 'The artist says the music is AI-generated (bio, profile, post or interview).'],
  S3: [['found', 'from_label'], 'YouTube Music shows an AI label on a song by this artist. from_label: its info panel says the label came from the record label or distributor.'],
  M1: [['self_disclosed', 'likely'], 'Spotify shows an AI Persona badge: self_disclosed, or likely ("Likely AI Persona").'],
  S4: [['found'], 'A curated tracker that reviews entries and shows its evidence lists the artist (Zoundhub at 4-5 dots with the Deezer flag, SoullessMusic, Soul Over AI).'],
  M2: [['found'], 'A detector-led tracker lists the artist, or Zoundhub rates it without the Deezer flag.'],
  M4: [['found'], '10 or more albums in some 12 months since 2024.'],
  M5: [['found'], '5 to 9 albums in some 12 months since 2024, or 3 albums within 3 months.'],
  W1: [['found'], 'First release in 2024 or later, with no earlier trace.'],
  W2: [['found'], 'Four or more unrelated genres within 12 months.'],
  W7: [['found'], 'Many near-identical short tracks.'],
  M6: [['found'], 'After a full search, no person: no socials showing a person, no live dates, no press, no credits beyond the artist name. found means you searched fully and found none.'],
  M7: [['found'], 'The same obscure person is credited as writer across many unrelated artist profiles.'],
  M8: [['found'], 'No Spotify Verified badge although the artist has had 10,000 or more monthly listeners for 3 months or more.'],
  W3: [['found'], 'A little footprint but no person: an image-only social account, a link page.'],
  W5: [['found'], 'No bio, or a stock, generic-sounding bio.'],
  W8: [['found'], 'The label field is the artist\'s own name or blank.'],
  M9: [['found'], 'Photoreal artist photos with AI artifacts.'],
  W6: [['found'], 'Monthly listeners far above followers, or streams coming from a few anonymous playlists.'],
  P2: [['hard_date', 'streaming_date'], 'First release in 2020 to 2023: hard_date when a dated source shows it (press, Bandcamp, Discogs, a label page), streaming_date when only a streaming release date does.'],
  P3: [['found'], 'Live shows confirmed by someone other than the artist: a venue or ticket listing, local press, setlist.fm, a fan video.'],
  P4: [['found'], 'Show dates listed only by the artist (Bandsintown, Songkick).'],
  P5: [['found'], 'Real video of the person or band playing or talking, with a history and other people around.'],
  P6: [['found'], 'A press feature, interview or radio session where the musicians talk about making the music.'],
  P7: [['found'], 'A Wikipedia article, with independent sources, about the people making the music.'],
  P8: [['found'], 'An established label with a roster of artists made by people.'],
  P9: [['found'], 'Credits naming several different people (producer, mixer, players) who have footprints of their own.'],
  P10: [['found'], 'A physical release (vinyl, CD, cassette) with photos or a shop listing.'],
  P11: [['found'], 'Releases on Bandcamp.'],
  P12: [['found'], 'A Spotify Verified badge.'],
  P13: [['found'], 'A human pace: fewer than 3 releases a year, months apart.'],
  P14: [['found'], 'Members with a documented life outside the project: other bands, orchestras, schools, earlier projects.'],
  P15: [['found'], 'The artist says no AI is used.'],
};

export const CODES = Object.keys(CHECKLIST);
const statusesOf = (code) => [...CHECKLIST[code][0], 'not_found', 'unknown'];

export const CHECKLIST_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['signs', 'genres', 'summary'],
  properties: {
    signs: {
      type: 'object',
      additionalProperties: false,
      required: CODES,
      properties: Object.fromEntries(CODES.map((code) => [code, {
        type: 'object',
        additionalProperties: false,
        required: ['status', 'source'],
        properties: {
          status: { type: 'string', enum: statusesOf(code) },
          source: { type: 'string', maxLength: 500 },
        },
      }])),
    },
    genres: { type: 'array', maxItems: 6, items: { type: 'string', maxLength: 60 } },
    summary: { type: 'string', maxLength: 600 },
  },
};

export function checklistPromptLines() {
  return [
    'Fill in the evidence checklist for this artist. For every sign answer one status:',
    '- found (or the level named for that sign) when a page shows it; give that https page in source.',
    '- not_found when you checked and it is not there.',
    '- unknown when you could not check it. Never guess: unknown counts as nothing.',
    'Signs that are absences (M6, W3, W5, W8, M8) are found only after you looked and the thing was missing.',
    'Also list up to 6 genres the artist releases, in plain words (for example "lo-fi hip hop", "ambient", "indie rock").',
    'In summary, say in two or three sentences what you found, without a verdict.',
    'The signs:',
    ...CODES.map((code) => `${code}: ${CHECKLIST[code][1]}`),
  ];
}

// Strict check of Claude's answer. Returns { ok, checklist: { signs: {code: status}, genres,
// sources, summary } } or { ok: false, reason }. A found sign without an https source counts as
// unknown: a sign with nothing to show for it scores nothing.
export function checkChecklist(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return { ok: false, reason: 'not an object' };
  const raw = candidate.signs;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'no signs' };
  const signs = {};
  const sources = [];
  for (const code of CODES) {
    const entry = raw[code];
    if (!entry || typeof entry !== 'object') return { ok: false, reason: `missing sign ${code}` };
    if (!statusesOf(code).includes(entry.status)) return { ok: false, reason: `bad status for ${code}` };
    let status = entry.status;
    const source = typeof entry.source === 'string' ? entry.source.trim() : '';
    if (status !== 'not_found' && status !== 'unknown') {
      if (HTTPS.test(source)) sources.push(source);
      else status = 'unknown';
    }
    signs[code] = status;
  }
  const genres = Array.isArray(candidate.genres)
    ? candidate.genres.filter((g) => typeof g === 'string' && g.trim()).map((g) => g.trim().slice(0, 60)).slice(0, 6)
    : [];
  const summary = typeof candidate.summary === 'string' ? candidate.summary.slice(0, 600) : '';
  return { ok: true, checklist: { signs, genres, sources: [...new Set(sources)], summary } };
}
