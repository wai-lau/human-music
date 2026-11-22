"""Train and measure the fakeprint classifier.

Five folds split by artist (both of an artist's songs fall in the same fold), so every artist is
scored by a model that never saw it. A song's score is the classifier's probability that it is AI;
an artist's score is the lower of its two songs (both must look AI, like the SH Labs layer). Prints
a threshold sweep: AI artists caught and people flagged, and the faceless people on their own.

Usage: .venv/bin/python train.py data/ai.npz data/human.npz [--faceless names.json] [--save model.json]
  --save writes the model trained on everything (weights, intercept and the feature scaling), for
  the Node port.
"""
import argparse
import json

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.preprocessing import StandardScaler


def load(paths):
    names, labels, prints = [], [], []
    for p in paths:
        z = np.load(p, allow_pickle=True)
        names += list(z['names']); labels += list(z['labels']); prints.append(z['prints'])
    return np.array(names, dtype=object), np.array([1 if l == 'ai' else 0 for l in labels]), np.vstack(prints)


def artist_scores(names, probs):
    out = {}
    for n, p in zip(names, probs):
        out.setdefault(n, []).append(p)
    return {n: min(v) for n, v in out.items() if len(v) >= 2}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('files', nargs='+')
    ap.add_argument('--faceless'); ap.add_argument('--save'); ap.add_argument('--C', type=float, default=1.0)
    a = ap.parse_args()
    names, y, X = load(a.files)
    label_of = dict(zip(names, y))
    probs = np.zeros(len(y))
    for train, test in GroupKFold(n_splits=5).split(X, y, groups=names):
        sc = StandardScaler().fit(X[train])
        m = LogisticRegression(C=a.C, max_iter=2000, class_weight='balanced').fit(sc.transform(X[train]), y[train])
        probs[test] = m.predict_proba(sc.transform(X[test]))[:, 1]
    scores = artist_scores(names, probs)
    ai = [s for n, s in scores.items() if label_of[n] == 1]
    pe = [s for n, s in scores.items() if label_of[n] == 0]
    faceless = set()
    if a.faceless:
        faceless = {r['name'] for r in json.load(open(a.faceless))['artists']}
    fc = [s for n, s in scores.items() if n in faceless]
    print(f'artists: {len(ai)} AI, {len(pe)} people ({len(fc)} faceless); songs: {len(y)}')
    print('| Both songs at or above | AI caught | People flagged | Faceless people flagged |')
    print('|---|---|---|---|')
    for t in (0.5, 0.7, 0.8, 0.9, 0.95, 0.98, 0.99, 0.995, 0.999):
        c = sum(s >= t for s in ai); f = sum(s >= t for s in pe); ff = sum(s >= t for s in fc)
        print(f'| {t} | {c} of {len(ai)} ({100 * c / max(1, len(ai)):.1f}%) | {f} of {len(pe)} ({100 * f / max(1, len(pe)):.1f}%) | {ff} of {len(fc)} |')
    worst = sorted(((s, n) for n, s in scores.items() if label_of[n] == 0), reverse=True)[:8]
    print('most AI-looking people:', ', '.join(f'{n} {s:.3f}' for s, n in worst))
    if a.save:
        sc = StandardScaler().fit(X)
        m = LogisticRegression(C=a.C, max_iter=2000, class_weight='balanced').fit(sc.transform(X), y)
        json.dump({'mean': sc.mean_.tolist(), 'scale': sc.scale_.tolist(), 'coef': m.coef_[0].tolist(), 'intercept': float(m.intercept_[0]),
                   'note': 'fakeprint logistic model: p = sigmoid(intercept + coef . ((x - mean) / scale))'}, open(a.save, 'w'))
        print('saved', a.save)


if __name__ == '__main__':
    main()
