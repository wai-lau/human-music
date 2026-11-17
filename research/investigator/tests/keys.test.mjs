// The gate's key logic: derive, hash, constant-time check.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { run } from './harness.mjs';
import { deriveKey, hashKey, checkBearer } from '../src/keys.mjs';

const sha256hex = (s) => createHash('sha256').update(s).digest('hex');
const k = deriveKey('admin-secret');
const h = hashKey(k);

await run([
  ['derive matches the exec-fn formula', () => deriveKey('abc') === sha256hex('human-music-investigator:abc')],
  ['right key passes', () => checkBearer('Bearer ' + k, hashKey(k)) === true],
  ['wrong key, empty, missing, no Bearer prefix all fail', () => [checkBearer('Bearer x', h), checkBearer('', h), checkBearer(undefined, h), checkBearer(k, h), checkBearer('bearer ' + k, h)].every((v) => v === false)],
  ['a hash given as the key does not pass', () => checkBearer('Bearer ' + hashKey(k), hashKey(k)) === false],
  ['a malformed stored hash fails closed', () => checkBearer('Bearer ' + k, 'zz') === false],
  ['long and non-ASCII keys do not throw', () => checkBearer('Bearer ' + 'é'.repeat(5000), h) === false],
  ['shorter and longer keys fail', () => checkBearer('Bearer ' + k.slice(1), h) === false && checkBearer('Bearer ' + k + 'a', h) === false],
  ['source never reads the admin key', () => !/API_KEY/.test(readFileSync(join(import.meta.dirname, '../src/keys.mjs'), 'utf8').replace(/apiKey/g, ''))],
]);
