import { run } from './harness.mjs';
import { normalizeName, artistKeys, primaryKey } from '../src/names.mjs';

const SP = '2GRtAbCdEfGhIjKlMnOpQr';
const YT = 'UCLeAbCdEfGhIjKlMnOpQrSt';
const throws = (fn) => { try { fn(); } catch (e) { return e instanceof TypeError; } return false; };

await run([
  ['normalizeName trims, lowers, collapses', () => normalizeName('  The  Velvet SUNDOWN ') === 'the velvet sundown'],
  ['normalizeName applies NFC', () => normalizeName('é') === 'é'],
  ['both IDs give three keys, name last', () => {
    const k = artistKeys({ name: 'The Velvet Sundown', spotifyId: SP, channelId: YT });
    return JSON.stringify(k) === JSON.stringify([`sp:${SP}`, `yt:${YT}`, 'nm:the velvet sundown']) || JSON.stringify(k);
  }],
  ['name-only item gives one nm key', () => JSON.stringify(artistKeys({ name: 'Abba' })) === '["nm:abba"]'],
  ['bad IDs are left out', () => JSON.stringify(artistKeys({ name: 'Abba', spotifyId: 'short', channelId: 'UCshort' })) === '["nm:abba"]'],
  ['wrong-length IDs are left out', () => JSON.stringify(artistKeys({ name: 'Abba', spotifyId: SP + 'x', channelId: YT + 'x' })) === '["nm:abba"]'],
  ['empty name throws TypeError', () => throws(() => artistKeys({ name: '' })) && throws(() => artistKeys({ name: '   ' }))],
  ['non-string name throws TypeError', () => throws(() => artistKeys({ name: 5 })) && throws(() => artistKeys({})) && throws(() => normalizeName(5))],
  ['primaryKey is the first key', () => primaryKey({ name: 'X', spotifyId: SP }) === `sp:${SP}` && primaryKey({ name: 'X' }) === 'nm:x'],
]);
