"""Golden values for the Node port of the fakeprint (research/investigator/src/fakeprint.mjs).

A synthetic 10-second signal that the Node test rebuilds sample for sample (three sines plus
xorshift32 noise), its fakeprint, and the model's probability on it. Writes
research/investigator/tests/fixtures/fakeprint-golden.json.

Signal, for n = 0 .. 441000-1 at 44100 Hz, in float64 then stored as float32:
  x[n] = 0.3 sin(2 pi 440 n / 44100) + 0.1 sin(2 pi 9000 n / 44100) + 0.05 sin(2 pi 12345 n / 44100)
         + 0.02 * (u[n] * 2 - 1)
  where u[n] = s / 2^32 for the xorshift32 state s after its (n+1)-th step, seed 2463534242:
  s ^= s << 13; s ^= s >> 17; s ^= s << 5 (all on unsigned 32-bit).
"""
import json
import os

import numpy as np

from fakeprint import SR, fakeprint

N = 441000


def signal():
    s = 2463534242
    u = np.empty(N)
    for i in range(N):
        s ^= (s << 13) & 0xFFFFFFFF
        s ^= s >> 17
        s ^= (s << 5) & 0xFFFFFFFF
        u[i] = s / 2 ** 32
    n = np.arange(N)
    x = (0.3 * np.sin(2 * np.pi * 440 * n / SR) + 0.1 * np.sin(2 * np.pi * 9000 * n / SR)
         + 0.05 * np.sin(2 * np.pi * 12345 * n / SR) + 0.02 * (u * 2 - 1))
    return x.astype(np.float32)


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    model = json.load(open(os.path.join(here, 'model.json')))
    fp = fakeprint(signal())
    z = (fp - np.array(model['mean'])) / np.array(model['scale'])
    p = 1 / (1 + np.exp(-(model['intercept'] + float(np.dot(model['coef'], z)))))
    out = os.path.join(here, '..', 'investigator', 'tests', 'fixtures', 'fakeprint-golden.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    json.dump({'seed': 2463534242, 'samples': N, 'sampleRate': SR, 'fakeprint': [round(float(v), 6) for v in fp], 'probability': float(p)}, open(out, 'w'))
    print('wrote', out, len(fp), 'values, probability', round(float(p), 6))


if __name__ == '__main__':
    main()
