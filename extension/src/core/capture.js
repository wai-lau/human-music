// Records the playing song's audio for its fingerprint, in Wai's own copy only (content.js
// calls this only when the worker says dev mode). Nothing is kept or sent from here: the caller
// turns the samples into 510 numbers and drops them.
//
// record(seconds, { mute }) -> Promise<Float32Array | null>: mono samples at 44100 Hz taken from
// the player's own stream (captureStream is taken before the volume control, so muting the video
// keeps the capture while the person hears nothing; checked live 2026-11-23). Resolves null when
// there is no playing video, no captureStream, or the audio context won't run. A mute is always
// undone, even on failure, and the recording stops after seconds + 5 at the latest with whatever
// it has.
(function () {
  'use strict';
  if (!Object.getOwnPropertyDescriptor(globalThis, 'HM')) globalThis.HM = {};
  const RATE = 44100;

  function record(seconds, opts) {
    const mute = !!(opts && opts.mute);
    return new Promise(function (resolve) {
      let video, ctx, wasMuted = false, muted = false, done = false, timer = null;
      const want = Math.max(1, Math.round(seconds * RATE));
      const out = new Float32Array(want);
      let n = 0;
      function finish(ok) {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        try { if (muted && video) video.muted = wasMuted; } catch (e) { /* gone */ }
        try { if (ctx) ctx.close(); } catch (e) { /* closed */ }
        resolve(ok && n > 0 ? out.slice(0, n) : null);
      }
      try {
        video = document.querySelector('video');
        if (!video || video.paused || typeof video.captureStream !== 'function') { finish(false); return; }
        const stream = video.captureStream();
        if (!stream.getAudioTracks().length) { finish(false); return; }
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) { finish(false); return; }
        ctx = new AC({ sampleRate: RATE });
        if (mute) { wasMuted = video.muted; video.muted = true; muted = true; }
        timer = setTimeout(function () { finish(true); }, (seconds + 5) * 1000);
        Promise.resolve(ctx.resume()).then(function () {
          if (done) return;
          if (ctx.state !== 'running' || ctx.sampleRate !== RATE) { finish(false); return; }
          const src = ctx.createMediaStreamSource(stream);
          const proc = ctx.createScriptProcessor(4096, 2, 1);
          const silent = ctx.createGain();
          silent.gain.value = 0; // the processor must reach the output to run; nothing is heard twice
          proc.onaudioprocess = function (e) {
            if (done) return;
            const b = e.inputBuffer;
            const a = b.getChannelData(0);
            const c = b.numberOfChannels > 1 ? b.getChannelData(1) : a;
            for (let i = 0; i < a.length && n < want; i++) out[n++] = (a[i] + c[i]) / 2;
            if (n >= want) finish(true);
          };
          src.connect(proc); proc.connect(silent); silent.connect(ctx.destination);
        }).catch(function () { finish(false); });
      } catch (e) { finish(false); }
    });
  }

  globalThis.HM.capture = { record: record };
})();
