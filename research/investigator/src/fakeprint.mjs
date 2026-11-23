// Port of research/fakeprint/fakeprint.py. The fakeprint of a song: a spectrum fingerprint
// designed to detect AI-generated music (Afchar et al., ISMIR 2025). This module computes the
// fingerprint from raw audio samples; probability() classifies it with our model.

const SR = 44100;
const N_FFT = 16384;
const HOP = N_FFT / 2;
const F_MIN = 5000;
const F_MAX = 16000;
const ENV_BINS = 151;
const SMOOTH_BINS = 51;
const POOL = 8;

// Radix-2 Cooley-Tukey FFT, iterative in-place. Input: a[0..N-1] real, a[N..2N-1] imaginary.
// Output: same layout. N must be a power of 2.
function fftRe(a) {
  const N = a.length >> 1; // actual number of complex points
  // Bit-reversal permutation
  let j = 0;
  for (let i = 1; i < N; i++) {
    let bit = N >> 1;
    while (j >= bit) { j -= bit; bit >>= 1; }
    j += bit;
    if (i < j) {
      // swap real parts
      let tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
      // swap imag parts
      tmp = a[i + N];
      a[i + N] = a[j + N];
      a[j + N] = tmp;
    }
  }
  // Compute FFT
  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wreal = Math.cos(angle);
    const wimag = Math.sin(angle);
    for (let i = 0; i < N; i += len) {
      let wr = 1.0;
      let wi = 0.0;
      for (let j = 0; j < half; j++) {
        const idx1 = i + j;
        const idx2 = i + j + half;
        // twiddle factor
        const tr = wr * a[idx2] - wi * a[idx2 + N];
        const ti = wr * a[idx2 + N] + wi * a[idx2];
        // butterfly
        a[idx2] = a[idx1] - tr;
        a[idx2 + N] = a[idx1 + N] - ti;
        a[idx1] += tr;
        a[idx1 + N] += ti;
        // update twiddle
        const nwr = wr * wreal - wi * wimag;
        wi = wr * wimag + wi * wreal;
        wr = nwr;
      }
    }
  }
}

// Hann window, numpy convention: 0.5 - 0.5 cos(2πn/(N-1))
function hanning(N) {
  const w = new Float64Array(N);
  for (let n = 0; n < N; n++) {
    w[n] = 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1));
  }
  return w;
}

// Mean magnitude spectrum in dB over frames (rfft). Returns N_FFT/2+1 bins.
function meanSpectrumDb(samples) {
  const win = hanning(N_FFT);
  const N = samples.length;
  let frames = 0;
  const mag = new Float64Array(N_FFT / 2 + 1);
  let offset = 0;
  while (offset + N_FFT <= N) {
    // Window the frame (real input only)
    const frame = new Float64Array(N_FFT * 2);
    for (let k = 0; k < N_FFT; k++) {
      frame[k] = samples[offset + k] * win[k];
    }
    // FFT (real input stored in first half, imag in second)
    fftRe(frame);
    // Convert to magnitude in dB, first half of bins
    for (let k = 0; k <= N_FFT / 2; k++) {
      const re = frame[k];
      const im = frame[k + N_FFT];
      const m = Math.hypot(re, im);
      mag[k] += 20 * Math.log10(m + 1e-10);
    }
    frames++;
    offset += HOP;
  }
  if (frames === 0) throw new Error('audio shorter than one window');
  for (let k = 0; k <= N_FFT / 2; k++) {
    mag[k] /= frames;
  }
  return mag;
}

// Running minimum over windowSize with 'nearest' edge handling (pad with edge value)
function runningMinimum(arr, windowSize) {
  const n = arr.length;
  const half = Math.floor(windowSize / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let min = arr[i];
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      if (arr[j] < min) min = arr[j];
    }
    out[i] = min;
  }
  return out;
}

// Running mean over windowSize with 'nearest' edge handling
function runningMean(arr, windowSize) {
  const n = arr.length;
  const half = Math.floor(windowSize / 2);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    const lo = Math.max(0, i - half);
    const hi = Math.min(n - 1, i + half);
    for (let j = lo; j <= hi; j++) {
      sum += arr[j];
      count++;
    }
    out[i] = sum / count;
  }
  return out;
}

// Max-pool in groups of poolSize; drop the tail.
function maxPool(arr, poolSize) {
  const n = arr.length;
  const outLen = Math.floor(n / poolSize);
  const out = new Float64Array(outLen);
  let idx = 0;
  for (let i = 0; i < outLen * poolSize; i += poolSize) {
    let max = arr[i];
    for (let j = i + 1; j < i + poolSize; j++) {
      if (arr[j] > max) max = arr[j];
    }
    out[idx++] = max;
  }
  return out;
}

export function fakeprint(samples) {
  const spec = meanSpectrumDb(samples);
  // Freqs: bin k is k * SR / N_FFT. Keep 5000-16000 Hz.
  const band = [];
  for (let k = 0; k <= N_FFT / 2; k++) {
    const freq = k * SR / N_FFT;
    if (freq >= F_MIN && freq <= F_MAX) band.push(spec[k]);
  }
  const env = runningMean(runningMinimum(band, ENV_BINS), SMOOTH_BINS);
  const resid = new Float64Array(band.length);
  for (let k = 0; k < band.length; k++) {
    resid[k] = Math.max(band[k] - env[k], 0);
  }
  const pooled = maxPool(resid, POOL);
  const top = pooled.reduce((m, v) => Math.max(m, v), 0);
  const result = new Float32Array(pooled.length);
  for (let k = 0; k < pooled.length; k++) {
    result[k] = top > 0 ? pooled[k] / top : 0;
  }
  return result;
}

export function probability(fp, model) {
  let z = model.intercept;
  for (let k = 0; k < fp.length; k++) {
    z += model.coef[k] * (fp[k] - model.mean[k]) / model.scale[k];
  }
  return 1 / (1 + Math.exp(-z));
}

export async function decode(bytes, spawn) {
  const { spawn: realSpawn } = await import('node:child_process');
  const sp = spawn || realSpawn;
  // ffmpeg's stdin takes a Buffer: fetch gives an ArrayBuffer (live check 2026-11-23, when an
  // ArrayBuffer threw and left ffmpeg waiting). A broken or stuck decode rejects; nothing hangs.
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, value) => { if (done) return; done = true; clearTimeout(timer); if (err) reject(err); else resolve(value); };
    const proc = sp('ffmpeg', ['-v', 'quiet', '-i', 'pipe:0', '-t', '30', '-ac', '1', '-ar', '44100', '-f', 'f32le', 'pipe:1']);
    const timer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* gone */ } finish(new Error('ffmpeg timed out')); }, 60000);
    const chunks = [];
    proc.on('error', (e) => finish(e));
    proc.stdout.on('data', (d) => chunks.push(d));
    proc.on('close', (code) => {
      if (code !== 0) { finish(new Error('ffmpeg failed')); return; }
      const buf = Buffer.concat(chunks);
      const samples = new Float32Array(Math.floor(buf.length / 4));
      for (let j = 0; j < samples.length; j++) samples[j] = buf.readFloatLE(j * 4);
      finish(null, samples);
    });
    proc.stdin.on('error', (e) => finish(e));
    try { proc.stdin.end(input); } catch (e) { try { proc.kill('SIGKILL'); } catch { /* gone */ } finish(e); }
  });
}
