// The gate's key logic. The service holds only the hash of the derived key.
import { createHash, timingSafeEqual } from 'node:crypto';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest();

export function deriveKey(apiKey) {
  return sha256('human-music-investigator:' + apiKey).toString('hex');
}

export function hashKey(key) {
  return sha256(key).toString('hex');
}

// True only for "Bearer <key>" whose hash equals keyHashHex. The presented key
// is hashed to 32 bytes and compared with the 32-byte stored hash, so lengths
// always match and nothing throws. A malformed stored hash fails closed.
export function checkBearer(authorizationHeader, keyHashHex) {
  if (typeof authorizationHeader !== 'string' || typeof keyHashHex !== 'string') return false;
  if (!/^[0-9a-f]{64}$/.test(keyHashHex)) return false;
  if (!authorizationHeader.startsWith('Bearer ')) return false;
  const presented = sha256(authorizationHeader.slice('Bearer '.length));
  return timingSafeEqual(presented, Buffer.from(keyHashHex, 'hex'));
}
