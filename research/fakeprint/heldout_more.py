"""Grow the held-out AI set: Soul Over AI artists that are not on Zoundhub (data/soa-only.json) and
were never in training, matched to Deezer by a looser but still dated rule, then sampled with
sample.py's preview and fingerprint code (spectra kept), scored with the live model.

Why sample.py keeps few: it needs an exact name with exactly one Deezer artist, then two tracks with
previews. This script reports which of those steps fails, and relaxes the match.

Match rule (a wrong match puts a person into the AI test set, so it is strict):
  1. Candidates: Deezer artists whose name equals the entry's name after a looser normalisation
     (accents dropped, everything but letters and digits removed, so "Axiom/Modulo" = "Axiom Modulo").
  2. A candidate is "young" if it has at least one album and EVERY album is dated 2023 or later
     (a namesake with older releases is another person; AI music made at scale starts in 2023).
  3. Accept only if exactly one candidate is young. Two young namesakes = ambiguous, skip.
  Songs: top tracks, then track search kept to that artist id, then that artist's own album tracks.
  Names already in training (ai.npz, ai-full.npz) or already held out (soa-full.npz) are left out.

Usage: .venv/bin/python heldout_more.py match      # phase 1: match names, write data/heldout-more-matches.json
       .venv/bin/python heldout_more.py sample     # phase 2: fingerprints -> data/heldout-more.npz
       .venv/bin/python heldout_more.py score      # phase 3: score with model.json
"""
import json
import re
import sys
import time
import unicodedata
import urllib.parse

import numpy as np

import sample
from fakeprint import F_MAX, F_MIN, N_FFT, SR, decode, fakeprint, mean_spectrum_db

MATCHES = 'data/heldout-more-matches.json'
OUT = 'data/heldout-more.npz'
YOUNG = '2023-01-01'


def loose(s):
    s = unicodedata.normalize('NFKD', str(s or '')).lower()
    return re.sub(r'[^a-z0-9]+', '', ''.join(c for c in s if not unicodedata.combining(c)))


def get(url, raw=False):
    for i in range(4):
        try:
            return sample.get(url, raw)
        except Exception:
            if i == 3:
                raise
            time.sleep(2 * (i + 1))


def albums(cid):
    out = []
    url = f'https://api.deezer.com/artist/{cid}/albums?limit=100'
    d = get(url)
    out += d.get('data') or []
    return out


def trained_names():
    s = set()
    for f in ('ai', 'ai-full', 'soa-full'):
        s |= set(np.load(f'data/{f}.npz', allow_pickle=True)['names'])
    return s


def match(name):
    q = urllib.parse.quote(name)
    found = get(f'https://api.deezer.com/search/artist?q={q}&limit=25').get('data') or []
    pool = [a for a in found if loose(a.get('name')) == loose(name)]
    exact = sum(sample.norm(a['name']) == sample.norm(name) for a in pool)
    info = []
    for a in pool[:8]:
        al = albums(a['id'])
        dates = sorted(x.get('release_date') or '' for x in al if x.get('release_date'))
        info.append({'id': a['id'], 'name': a['name'], 'n_albums': len(al), 'first': dates[0] if dates else None,
                     'young': bool(dates) and dates[0] >= YOUNG, 'exact': sample.norm(a['name']) == sample.norm(name)})
    young = [c for c in info if c['young']]
    rec = {'name': name, 'pool': len(pool), 'exact_in_pool': exact, 'cands': info}
    if not pool:
        rec['result'] = 'no-match'
    elif len(young) == 1:
        rec['result'] = 'ok'; rec['id'] = young[0]['id']; rec['first'] = young[0]['first']
    elif len(young) == 0:
        rec['result'] = 'none-young'
    else:
        rec['result'] = 'ambiguous'
    return rec


def songs(cid, name, n=2):
    got = sample.previews(cid, name, n)
    if len(got) < n:
        seen = {t for t, _ in got}
        for al in albums(cid):
            if len(got) >= n:
                break
            for t in (get(f'https://api.deezer.com/album/{al["id"]}/tracks?limit=50').get('data') or []):
                if t.get('preview') and t['id'] not in seen and (t.get('artist') or {}).get('id') == cid:
                    got.append((t['id'], t['preview'])); seen.add(t['id'])
                    if len(got) >= n:
                        break
    return got[:n]


def phase_match():
    names = [r['name'] for r in json.load(open('data/soa-only.json'))['artists']]
    skip = trained_names()
    try:
        recs = json.load(open(MATCHES))
    except FileNotFoundError:
        recs = {}
    for i, n in enumerate(names):
        if n in recs:
            continue
        try:
            recs[n] = match(n)
            recs[n]['in_training'] = n in skip
        except Exception as e:
            print('skip', n, str(e)[:60], file=sys.stderr, flush=True)
        if i % 20 == 0:
            json.dump(recs, open(MATCHES, 'w')); print(i, flush=True)
    json.dump(recs, open(MATCHES, 'w'))
    from collections import Counter
    print(Counter((r['result'], r['in_training']) for r in recs.values()))


def phase_sample():
    recs = json.load(open(MATCHES))
    skip = trained_names()
    try:
        z = np.load(OUT, allow_pickle=True); have = {k: list(z[k]) for k in z.files}
    except FileNotFoundError:
        have = {'names': [], 'labels': [], 'tracks': [], 'prints': [], 'spectra': []}
    done = set(have['names']); nofile = recs.setdefault('_nopreview', [])
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR); band = (freqs >= F_MIN) & (freqs <= F_MAX)

    def save():
        np.savez(OUT, **{k: np.array(v, dtype=np.float32 if k == 'prints' else np.float16 if k == 'spectra' else object) for k, v in have.items()})
    for n, r in recs.items():
        if n.startswith('_') or r['result'] != 'ok' or n in skip or n in done or n in nofile:
            continue
        try:
            sg = songs(r['id'], n)
            if len(sg) < 2:
                nofile.append(n); continue
            fp, sp = [], []
            for tid, url in sg:
                x = decode(get(url, raw=True))
                fp.append(fakeprint(x)); sp.append(mean_spectrum_db(x)[band].astype(np.float16))
            for (tid, _), f, s in zip(sg, fp, sp):
                have['names'].append(n); have['labels'].append('ai'); have['tracks'].append(tid)
                have['prints'].append(f); have['spectra'].append(s)
            done.add(n)
            if len(done) % 10 == 0:
                save(); json.dump(recs, open(MATCHES, 'w')); print(len(done), flush=True)
        except Exception as e:
            print('skip', n, str(e)[:60], file=sys.stderr, flush=True)
    save(); json.dump(recs, open(MATCHES, 'w'))
    print('sampled', len(done), 'artists; no previews:', len(nofile))


def phase_score():
    m = json.load(open('model.json'))
    mean, scale, coef = (np.array(m[k]) for k in ('mean', 'scale', 'coef'))
    sets = {}
    for tag, f in (('old (soa-full)', 'data/soa-full.npz'), ('new (heldout-more)', OUT)):
        z = np.load(f, allow_pickle=True)
        p = 1 / (1 + np.exp(-(m['intercept'] + ((z['prints'] - mean) / scale) @ coef)))
        per = {}
        for n, v in zip(z['names'], p):
            per.setdefault(n, []).append(v)
        sets[tag] = {n: min(v) for n, v in per.items() if len(v) >= 2}
    sets['combined'] = {**sets['old (soa-full)'], **sets['new (heldout-more)']}
    for tag, s in sets.items():
        a = np.array(list(s.values())); N = len(a)
        row = []
        for t in (0.5, 0.7, 0.8, 0.9):
            c = int((a >= t).sum()); pr = c / N
            row.append(f'{t}: {c}/{N} ({100 * pr:.0f}% +-{196 * np.sqrt(pr * (1 - pr) / N):.1f})')
        print(tag, '|', ' | '.join(row))


if __name__ == '__main__':
    {'match': phase_match, 'sample': phase_sample, 'score': phase_score}[sys.argv[1]]()
