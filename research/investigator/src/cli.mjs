// The owner's commands, run on the droplet against the service's own database:
//   status | recheck <key> | calibrate | accept-calibration
// `calibrate` only fits and reports; it never runs Claude. `accept-calibration` is the only
// thing that stores a mapping as accepted and sets calibrated: true (Wai decides, not the code).
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fitMapping, report } from './calibrate.mjs';
import { DEFAULT_DATA_DIR, dbPath } from './main.mjs';
import { createQueue } from './queue.mjs';
import { openStore } from './store.mjs';

const KEY_SHAPE = /^(sp|yt|nm):.{1,300}$/s;
const USAGE = 'usage: node src/cli.mjs status | recheck <key> | calibrate | accept-calibration';

const val = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

export async function runCli(argv, env, { out = (l) => console.log(l), now = () => new Date() } = {}) {
  const [command, ...rest] = argv;
  if (!['status', 'recheck', 'calibrate', 'accept-calibration'].includes(command)) {
    out(USAGE);
    return 1;
  }
  const capNum = Number.parseInt(val(env.HM_DAILY_CAP) || '', 10);
  const cap = Number.isInteger(capNum) && capNum > 0 ? capNum : 100;
  const store = openStore(dbPath(val(env.HM_DATA_DIR) || DEFAULT_DATA_DIR));
  try {
    const queue = createQueue({ store, now, cap });

    if (command === 'status') {
      const s = queue.status();
      out(`queued: ${s.queued}`);
      out(`today: ${s.today} of ${s.cap}`);
      out(`paused: ${s.paused === null ? 'no' : s.paused}`);
      out(`last error: ${s.lastError === null ? 'none' : s.lastError}`);
      out(`calibrated: ${store.getState('calibrated') === true ? 'yes' : 'no'}`);
      return 0;
    }

    if (command === 'recheck') {
      const key = rest[0];
      if (typeof key !== 'string' || !KEY_SHAPE.test(key)) {
        out('usage: recheck <key>   (key looks like sp:<id>, yt:<id> or nm:<name>)');
        return 1;
      }
      const v = store.findVerdict([key]);
      if (!v) { out(`no such artist: ${key}`); return 1; }
      const artist = { name: v.name, site: '', songs: [], playing: false };
      if (v.spotifyId) artist.spotifyId = v.spotifyId;
      if (v.channelId) artist.channelId = v.channelId;
      queue.requeue(artist);
      out(`queued for another look: ${v.name} (the stored verdict stays until a new one replaces it)`);
      return 0;
    }

    if (command === 'calibrate') {
      const stored = store.getState('calibration.samples');
      const samples = Array.isArray(stored) ? stored : [];
      const fit = fitMapping(samples);
      store.setState('calibration.fit', fit);
      if (samples.length === 0) out('no calibration samples stored yet');
      out(report(samples, fit));
      out(fit.ok
        ? 'fit ok: run accept-calibration to publish with it'
        : 'fit not ready: nothing is published at 95 or more');
      return 0;
    }

    // accept-calibration
    const fit = store.getState('calibration.fit');
    if (!fit || fit.ok !== true) {
      out('refusing: the last calibration fit is missing or not ok. Run calibrate first.');
      return 1;
    }
    store.setState('calibration.mapping', fit);
    store.setState('calibrated', true);
    store.setState('publish.stale', true); // the running service republishes on its next tick
    out('calibration accepted: the published list will say calibrated: true');
    return 0;
  } finally {
    store.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  runCli(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
}
