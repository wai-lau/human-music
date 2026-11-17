// Name normalising and artist keys. normalizeName follows extension/src/core/text.js
// (NFC, lower case, trim, collapse spaces) so a name matches exactly as the extension matches it.

const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
const YOUTUBE_ID = /^UC[\w-]{22}$/;

export function normalizeName(s) {
  if (typeof s !== 'string') throw new TypeError('name must be a string');
  return s.normalize('NFC').toLowerCase().trim().replace(/\s+/g, ' ');
}

export function artistKeys(item) {
  const name = item ? normalizeName(item.name) : '';
  if (!name) throw new TypeError('name must be a non-empty string');
  const keys = [];
  if (typeof item.spotifyId === 'string' && SPOTIFY_ID.test(item.spotifyId)) keys.push('sp:' + item.spotifyId);
  if (typeof item.channelId === 'string' && YOUTUBE_ID.test(item.channelId)) keys.push('yt:' + item.channelId);
  keys.push('nm:' + name);
  return keys;
}

export function primaryKey(item) {
  return artistKeys(item)[0];
}
