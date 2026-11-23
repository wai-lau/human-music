// The owner's commands, run on the droplet against the service's own database:
//   status | resume | recheck <key> | calibrate-run [--model opus|sonnet] [--seed N] | calibrate | accept-calibration
//   checklist-run --ai <path> --people <path> [--model opus|sonnet] | checklist-report [--model opus|sonnet]
//   shlabs-run --ai <path> --people <path> [--max N] | shlabs-report  (SH Labs accuracy; key from SHLABS_API_KEY)
// `checklist-run` is the evidence-weights experiment (Wai, 2026-11-18): Claude fills in the
// checklist for labelled artists, resumably; `checklist-report` prints what each sign is worth.
// `calibrate-run` investigates the calibration sample (50 Soul Over AI artists, up to 50 known
// people from 2020 on) one at a time, resumably; its rows never publish.
// `calibrate` only fits and reports; it never runs Claude. `accept-calibration` is the only
// thing that stores a mapping as accepted and sets calibrated: true (Wai decides, not the code).
import { readFileSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { fitMapping, report } from './calibrate.mjs';
import { pickSample, runCalibration, fitSamples } from './calibrun.mjs';
import { runChecklist, reportChecklist, measuredPoints } from './checklistrun.mjs';
import { runShLabs, reportShLabs } from './shlabsrun.mjs';
import { createShLabs } from './shlabs.mjs';
import { investigate as realInvestigate, pickModel } from './claude.mjs';
import { decide } from './answer.mjs';
import { DEFAULT_DATA_DIR, dbPath } from './main.mjs';
import { createQueue } from './queue.mjs';
import { openStore } from './store.mjs';

const KEY_SHAPE = /^(sp|yt|nm):.{1,300}$/s;
const USAGE = 'usage: node src/cli.mjs status | resume | recheck <key> | calibrate-run [--model opus|sonnet] [--seed N] [--soul-over-ai <path>] [--people <path>] | calibrate | accept-calibration | checklist-run --ai <path> --people <path> [--model opus|sonnet] | checklist-report [--model opus|sonnet] | shlabs-run --ai <path> --people <path> [--max N] | shlabs-report | export-prints';
// In the repo the sample files sit beside the service; on the droplet pass their paths.
const DEFAULT_SOA = new URL('../calibration/soul-over-ai.json', import.meta.url);
const DEFAULT_PEOPLE = new URL('../../calibration/known-people.json', import.meta.url);
const flag = (args, name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };

const val = (v) => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);

export async function runCli(argv, env, { out = (l) => console.log(l), now = () => new Date(), investigate = realInvestigate, fetchPage, shlabs } = {}) {
  const [command, ...rest] = argv;
  if (!['status', 'resume', 'recheck', 'calibrate-run', 'calibrate', 'accept-calibration', 'checklist-run', 'checklist-report', 'shlabs-run', 'shlabs-report', 'export-prints'].includes(command)) {
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

    if (command === 'resume') {
      const was = store.getState('queue.paused');
      queue.resume();
      out(was === null ? 'not paused' : `resumed (was paused: ${was})`);
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

    if (command === 'calibrate-run') {
      const model = pickModel(flag(rest, '--model'));
      // One seed per database, so a resumed run (or the Sonnet comparison) uses the same sample.
      let seed = store.getState('calibration.seed');
      if (!Number.isInteger(seed)) {
        const asked = Number.parseInt(flag(rest, '--seed') || '', 10);
        seed = Number.isInteger(asked) ? asked : now().getTime() % 2147483647;
        store.setState('calibration.seed', seed);
      }
      const soa = JSON.parse(readFileSync(flag(rest, '--soul-over-ai') || DEFAULT_SOA, 'utf8'));
      const people = JSON.parse(readFileSync(flag(rest, '--people') || DEFAULT_PEOPLE, 'utf8'));
      const sample = pickSample({ soa, people, seed });
      const total = sample.ai.length + sample.people.length;
      out(`calibration run: model ${model}, seed ${seed}, ${sample.ai.length} known AI and ${sample.people.length} known people`);
      const r = await runCalibration({ store, investigate, decide, sample, model });
      const results = store.getState(`calibration.results.${model}`) || {};
      if (model === 'opus') store.setState('calibration.samples', fitSamples(results));
      const rows = Object.entries(results).filter(([, v]) => v && v.verdict);
      const aiCalled = (truth, min) => rows.filter(([, v]) => v.truthAi === truth && v.verdict === 'ai' && v.confidence >= min).length;
      const of = (truth) => rows.filter(([, v]) => v.truthAi === truth).length;
      out(`${r.done} of ${total} done${r.stopped ? ` (stopped: ${r.stopped}; run again to go on)` : ''}`);
      out(`known AI called AI: ${aiCalled(true, 95)} at 95+, ${aiCalled(true, 60)} at 60+, of ${of(true)}`);
      out(`known people called AI: ${aiCalled(false, 95)} at 95+, ${aiCalled(false, 60)} at 60+, of ${of(false)}`);
      return r.stopped ? 2 : 0;
    }

    if (command === 'checklist-run') {
      const model = pickModel(flag(rest, '--model'));
      const aiPath = flag(rest, '--ai');
      const peoplePath = flag(rest, '--people');
      if (!aiPath || !peoplePath) { out(USAGE); return 1; }
      const pick = (file) => (JSON.parse(readFileSync(file, 'utf8')).artists || [])
        .filter((a) => a && typeof a.name === 'string' && a.name.trim())
        .map((a) => ({ name: a.name, spotifyId: a.spotifyId, youtubeChannelId: a.youtubeChannelId }));
      const sample = { ai: pick(aiPath), people: pick(peoplePath) };
      out(`checklist run: model ${model}, ${sample.ai.length} known AI and ${sample.people.length} known people`);
      const r = await runChecklist({ store, investigate, sample, model, log: out });
      out(`${r.done} of ${r.total} done${r.stopped ? ` (stopped: ${r.stopped}; run again to go on)` : ''}`);
      return r.stopped ? 2 : 0;
    }

    if (command === 'shlabs-run') {
      const aiPath = flag(rest, '--ai');
      const peoplePath = flag(rest, '--people');
      if (!aiPath || !peoplePath) { out(USAGE); return 1; }
      const key = val(env.SHLABS_API_KEY);
      if (!shlabs && !key) { out('SHLABS_API_KEY is not set'); return 1; }
      const pick = (file) => (JSON.parse(readFileSync(file, 'utf8')).artists || []).map((a) => ({ name: a.name, spotifyId: a.spotifyId }));
      const maxNum = Number.parseInt(flag(rest, '--max') || '', 10);
      const client = shlabs || createShLabs({ fetch: globalThis.fetch, key, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
      const page = fetchPage || (async (url) => {
        const res = await fetch(url, { headers: { 'User-Agent': 'HumanMusicResearch/1 (+https://github.com/wai-lau/human-music)' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      });
      const r = await runShLabs({ store, fetchPage: page, shlabs: client, sample: { ai: pick(aiPath), people: pick(peoplePath) }, maxRequests: Number.isInteger(maxNum) && maxNum > 0 ? maxNum : 190, log: out });
      out(`${r.done} artists scored, ${r.requests} SH Labs requests this run${r.stopped ? ` (stopped: ${r.stopped}; run again later)` : ''}`);
      return r.stopped ? 2 : 0;
    }

    if (command === 'shlabs-report') {
      out(reportShLabs(store.getState('shlabs.results') || {}, measuredPoints));
      return 0;
    }

    if (command === 'export-prints') {
      const prints = store.listPlayerPrints();
      for (const p of prints) {
        out(JSON.stringify(p));
      }
      return 0;
    }

    if (command === 'checklist-report') {
      const model = pickModel(flag(rest, '--model'));
      const { SIGNS, scoreChecklist } = await import('./score.mjs');
      out(reportChecklist(store.getState(`checklist.results.${model}`) || {}, { signsTable: SIGNS, score: scoreChecklist }));
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
