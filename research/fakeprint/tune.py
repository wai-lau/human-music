"""Tune the fakeprint settings from saved spectra (sample.py --spectra).

Rebuilds each song's fakeprint from its 5-16 kHz mean spectrum with other settings (running-minimum
width, smoothing width, pooling, classifier C) and scores each setting the way train.py does: five
folds split by artist, an artist's score is the lower of its two songs. Reports AI caught at the
threshold where no person is flagged in cross-validation, and at 0.8.

Usage: .venv/bin/python tune.py data/ai-full.npz data/human-full.npz data/crawled-full.npz
"""
import argparse
import itertools

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler


def load(paths):
    names, y, spec = [], [], []
    for p in paths:
        z = np.load(p, allow_pickle=True)
        names += list(z['names']); y += [1 if l == 'ai' else 0 for l in z['labels']]
        spec.append(z['spectra'].astype(np.float32))
    return np.array(names, dtype=object), np.array(y), np.vstack(spec)


def prints(spec, env, smooth, pool):
    e = uniform_filter1d(minimum_filter1d(spec, env, axis=1, mode='nearest'), smooth, axis=1, mode='nearest')
    r = np.maximum(spec - e, 0)
    n = r.shape[1] // pool * pool
    p = r[:, :n].reshape(len(r), -1, pool).max(axis=2)
    top = p.max(axis=1, keepdims=True)
    return np.where(top > 0, p / np.where(top > 0, top, 1), p)


def score(names, y, X, C):
    probs = np.zeros(len(y))
    for tr, te in GroupKFold(n_splits=5).split(X, y, groups=names):
        sc = StandardScaler().fit(X[tr])
        m = LogisticRegression(C=C, max_iter=3000, class_weight='balanced').fit(sc.transform(X[tr]), y[tr])
        probs[te] = m.predict_proba(sc.transform(X[te]))[:, 1]
    per = {}
    for n, p, l in zip(names, probs, y):
        per.setdefault(n, [l, []])[1].append(p)
    ai = np.array([min(v) for l, v in per.values() if l == 1 and len(v) >= 2])
    pe = np.array([min(v) for l, v in per.values() if l == 0 and len(v) >= 2])
    worst = pe.max() if len(pe) else 0
    return (ai > worst).mean(), (ai >= 0.8).mean(), (pe >= 0.8).sum(), worst, len(ai), len(pe)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('files', nargs='+'); a = ap.parse_args()
    names, y, spec = load(a.files)
    print(f'{len(set(names))} artists, {len(y)} songs')
    print('| min width | smooth | pool | C | AI caught, no person flagged | AI caught at 0.8 | people at 0.8 | top person |')
    print('|---|---|---|---|---|---|---|---|')
    rows = []
    for env, smooth, pool, C in itertools.product((51, 151, 301), (11, 51), (4, 8, 16), (0.003, 0.01, 0.03)):
        if smooth > env:
            continue
        s = score(names, y, prints(spec, env, smooth, pool), C)
        rows.append(((env, smooth, pool, C), s))
        print(f'| {env} | {smooth} | {pool} | {C} | {100 * s[0]:.1f}% | {100 * s[1]:.1f}% | {s[2]} of {s[5]} | {s[3]:.3f} |', flush=True)
    best = max(rows, key=lambda r: (r[1][2] == 0, r[1][1], r[1][0]))
    print('best (no person at 0.8, then most AI at 0.8):', best)


if __name__ == '__main__':
    main()
