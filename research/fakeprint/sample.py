"""Fakeprints of labelled artists from Deezer's 30-second previews. Keeps only the fakeprints:
no audio is written to disk.

For each artist: find it on Deezer by exact name (normalised); if more than one Deezer artist has
that name, skip it (the label could belong to either); take its top two tracks with a preview,
fetch each preview into memory, compute the fakeprint, keep it.

Usage: .venv/bin/python sample.py <artists.json> <label ai|human> <out.npz> [--max N] [--seed S]
  artists.json: {"artists": [{"name": ...}, ...]} or a plain list of such entries.
Resumes: artists already in <out.npz> are skipped.
"""
import argparse
import json
import random
import sys
import time
import unicodedata
import urllib.parse
import urllib.request

import numpy as np

from fakeprint import decode, fakeprint

UA = 'human-music-research/0.1 (https://github.com/wai-lau/human-music)'
_last = [0.0]


def norm(s):
    return ' '.join(unicodedata.normalize('NFKC', str(s or '')).lower().split())


def get(url, raw=False):
    # Deezer allows 50 requests per 5 seconds; stay well under it.
    wait = _last[0] + 0.15 - time.time()
    if wait > 0:
        time.sleep(wait)
    _last[0] = time.time()
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        body = r.read()
    return body if raw else json.loads(body)


def deezer_artist(name):
    q = urllib.parse.quote(name)
    found = get(f'https://api.deezer.com/search/artist?q={q}&limit=10').get('data') or []
    exact = [a for a in found if norm(a.get('name')) == norm(name)]
    ids = {a['id'] for a in exact}
    return next(iter(ids)) if len(ids) == 1 else None


def previews(artist_id, n=2):
    top = get(f'https://api.deezer.com/artist/{artist_id}/top?limit=10').get('data') or []
    return [(t['id'], t['preview']) for t in top if t.get('preview')][:n]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('artists'); ap.add_argument('label', choices=['ai', 'human']); ap.add_argument('out')
    ap.add_argument('--max', type=int, default=1000); ap.add_argument('--seed', type=int, default=20261122)
    a = ap.parse_args()
    data = json.load(open(a.artists))
    rows = data['artists'] if isinstance(data, dict) else data
    rows = [r for r in rows if r.get('name') and not r.get('idOnly')]
    random.Random(a.seed).shuffle(rows)

    have = {}
    try:
        z = np.load(a.out, allow_pickle=True)
        have = {k: list(z[k]) for k in z.files}
    except FileNotFoundError:
        have = {'names': [], 'labels': [], 'tracks': [], 'prints': []}
    done = set(have['names'])
    kept = len(done)
    for r in rows:
        if kept >= a.max:
            break
        name = r['name']
        if name in done:
            continue
        done.add(name)
        try:
            aid = deezer_artist(name)
            if not aid:
                continue
            prints, tracks = [], []
            for tid, url in previews(aid):
                prints.append(fakeprint(decode(get(url, raw=True))))
                tracks.append(tid)
            if len(prints) < 2:
                continue
            for tid, fp in zip(tracks, prints):
                have['names'].append(name); have['labels'].append(a.label); have['tracks'].append(tid); have['prints'].append(fp)
            kept += 1
            if kept % 25 == 0:
                np.savez(a.out, **{k: np.array(v, dtype=object if k != 'prints' else np.float32) for k, v in have.items()})
                print(f'{kept}/{a.max} {a.label} artists', flush=True)
        except Exception as e:  # one artist's failure never stops the run
            print(f'skip {name!r}: {str(e)[:80]}', file=sys.stderr, flush=True)
    np.savez(a.out, **{k: np.array(v, dtype=object if k != 'prints' else np.float32) for k, v in have.items()})
    print(f'done: {kept} {a.label} artists, {len(have["prints"])} songs', flush=True)


if __name__ == '__main__':
    main()
