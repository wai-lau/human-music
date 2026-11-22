"""The fakeprint of a song, written from the description in Afchar, Meseguer Brocal, Akesbi and
Hennequin, "A Fourier Explanation of AI-music Artifacts" (ISMIR 2025). No code from Deezer's
repository is used (Wai, 2026-11-22: build our own variant; design in
docs/superpowers/specs/2026-11-22-fakeprint-design.md).

1. mono audio at 44.1 kHz;
2. long-window spectrum (FFT size 2^14, Hann window, half overlap), magnitude in dB averaged over time;
3. keep 5-16 kHz;
4. subtract a lower envelope (a running minimum, then smoothed), keep what lies above it;
5. scale to a maximum of 1.

The 5-16 kHz band at this resolution is about 4,090 bins; the result is max-pooled in groups of
POOL bins so a small classifier can learn from a few thousand songs.
"""
import subprocess

import numpy as np
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 44100
N_FFT = 2 ** 14
HOP = N_FFT // 2
F_MIN, F_MAX = 5000, 16000
ENV_BINS = 151      # running-minimum width, in bins (about 400 Hz)
SMOOTH_BINS = 51    # smoothing of that minimum
POOL = 8


def decode(data: bytes, seconds: float = 30.0) -> np.ndarray:
    """Any audio file's bytes to mono float32 at SR, through ffmpeg (no file written)."""
    out = subprocess.run(
        ['ffmpeg', '-v', 'quiet', '-i', 'pipe:0', '-t', str(seconds), '-ac', '1', '-ar', str(SR), '-f', 'f32le', 'pipe:1'],
        input=data, capture_output=True, check=True, timeout=60,
    ).stdout
    return np.frombuffer(out, dtype=np.float32)


def mean_spectrum_db(x: np.ndarray) -> np.ndarray:
    if len(x) < N_FFT:
        raise ValueError('audio shorter than one window')
    win = np.hanning(N_FFT).astype(np.float32)
    frames = np.lib.stride_tricks.sliding_window_view(x, N_FFT)[::HOP]
    mag = np.abs(np.fft.rfft(frames * win, axis=1))
    return (20 * np.log10(mag + 1e-10)).mean(axis=0)


def fakeprint(x: np.ndarray) -> np.ndarray:
    spec = mean_spectrum_db(x)
    freqs = np.fft.rfftfreq(N_FFT, 1 / SR)
    band = spec[(freqs >= F_MIN) & (freqs <= F_MAX)]
    env = uniform_filter1d(minimum_filter1d(band, ENV_BINS, mode='nearest'), SMOOTH_BINS, mode='nearest')
    resid = np.clip(band - env, 0, None)
    n = len(resid) // POOL * POOL
    pooled = resid[:n].reshape(-1, POOL).max(axis=1)
    top = pooled.max()
    return (pooled / top if top > 0 else pooled).astype(np.float32)
