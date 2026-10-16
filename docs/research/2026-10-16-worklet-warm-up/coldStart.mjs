/* global process, console, URL */
/** The cold-start bench (windsor#837), one command from the repo root:
 *   node docs/research/2026-10-16-worklet-warm-up/coldStart.mjs [--runs 5] [--cases bench,drums]
 *        [--rate 48000] [--label after] [--trace] [--dump] [--bundles <dir>]
 * Each run is a fresh browser, so a fresh audio thread and a cold V8: build the song's system
 * (the power button), wait `BUILD_S`, ▶, ■ after `PLAY_S`, wait `GAP_S`, ▶ again, ■ after
 * `PLAY_S`. The page samples both underrun counts every 25 ms; this reads each window's rise:
 * the build (from the build's start to the first ▶), the first ▶ and the second ▶ (each from
 * its press to its ■). `--trace` also records the audio thread's renders (`webaudio`) and
 * V8's compiles on it (`disabled-by-default-v8.compile`), and keeps per run the quanta over
 * budget around each press and the compile time spent there. Writes `results/<time>-<label>.json`.
 * Chrome is `WINDSOR_CHROME`, by default the installed Google Chrome on macOS.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch, openPage, trace } from '../2026-10-13-performance-assessment/cdp.mjs';

const folder = new URL('./', import.meta.url);
// `--bundles <dir>`: serve these generated bundles instead of the worktree's (a copy of another
// commit's `generated/`, for its "before"; the page's engine code is the worktree's either way,
// and only the bundles changed in windsor#837).
const bundlesArg = process.argv.indexOf('--bundles');
const generated =
  bundlesArg > 0
    ? new URL(`file://${process.argv[bundlesArg + 1].replace(/\/?$/, '/')}`)
    : new URL('../../../packages/engine/src/worklet/generated/', import.meta.url);
const CHROME =
  process.env.WINDSOR_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const runs = Number(arg('--runs', 5));
const cases = arg('--cases', 'bench,drums').split(',');
const rate = arg('--rate', null);
const label = arg('--label', 'run');
const tracing = process.argv.includes('--trace') || process.argv.includes('--dump');
// `--dump`: also keep the audio thread's events from each press's first `DUMP_MS`, names and args.
const dumping = process.argv.includes('--dump');
const DUMP_MS = 400;
const BUILD_S = 3;
const PLAY_S = 4;
const GAP_S = 1.5;
const WORKLET_THREAD = 'Realtime AudioWorklet thread';
const RENDER = 'RealtimeAudioDestinationHandler::Render';

async function files() {
  const html = '<!doctype html><title>Cold</title><script type="module" src="/src/bench/page.js"></script>';
  const page = await build({
    entryPoints: [new URL('coldPage.mjs', folder).pathname],
    bundle: true,
    write: false,
    target: 'esnext',
    format: 'esm',
    loader: { '.json': 'json' },
  });
  const served = {
    '/': ['text/html', html],
    '/src/bench/page.js': ['text/javascript', page.outputFiles[0].text],
  };
  for (const name of readdirSync(generated).filter((n) => n.endsWith('.js')))
    served[`/src/worklet/generated/${name}`] = ['text/javascript', readFileSync(new URL(name, generated), 'utf8')];
  return served;
}

function serve(served) {
  const server = createServer((req, res) => {
    const [type, text] = served[req.url.split('?')[0]] ?? ['text/plain', ''];
    res.setHeader('content-type', type);
    res.end(text);
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function ready(page) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate('typeof window.cold === "object"')) return;
    await sleep(100);
  }
  throw Error(`page never ready: ${page.logs.join(' | ')}`);
}

/** The rise of each count across [from, to), from the last sample at or before `from`. */
function rise(timeline, from, to) {
  const before = [...timeline].reverse().find((s) => s.t <= from) ?? timeline[0];
  const inside = timeline.filter((s) => s.t < to);
  const last = inside.at(-1) ?? before;
  // The processors' count is null until the system exists, and counts from 0 when it does.
  const diff = (key) => (last[key] === null ? null : last[key] - (before[key] ?? 0));
  return { device: diff('device'), deviceMs: diff('deviceMs'), dsp: diff('dsp') };
}

function windows({ timeline, marks }) {
  const at = (name, nth = 0) => marks.filter((m) => m.name === name)[nth].t;
  return {
    build: { ...rise(timeline, at('build'), at('play')), ms: at('built') - at('build') },
    first: rise(timeline, at('play'), at('stop')),
    second: rise(timeline, at('play', 1), at('stop', 1)),
  };
}

const key = (e) => `${e.pid}:${e.tid}`;

/** Per press and for the build: quanta over budget and V8 compile time on the audio thread. */
function traced(events, sampleRate, marks, clock) {
  const names = new Map();
  for (const e of events) if (e.ph === 'M' && e.name === 'thread_name') names.set(key(e), e.args.name);
  const audio = events.filter((e) => names.get(key(e)) === WORKLET_THREAD);
  const renders = audio.filter((e) => e.name === RENDER && e.ph === 'X');
  const counts = new Map();
  for (const e of renders) counts.set(key(e), (counts.get(key(e)) ?? 0) + 1);
  const thread = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
  const own = audio.filter((e) => key(e) === thread);
  const budgetUs = (128 / sampleRate) * 1e6;
  // The page's performance.now() to the trace's clock: `clock` is one pair read together.
  const toTrace = (t) => (t - clock.page) * 1000 + clock.trace;
  const span = (from, to) => {
    const inside = own.filter((e) => e.ts >= from && e.ts < to && e.ph === 'X');
    const quanta = inside.filter((e) => e.name === RENDER);
    const compiles = inside.filter((e) => e.cat.includes('v8.compile') || e.name.startsWith('V8.'));
    const byName = {};
    for (const e of compiles) byName[e.name] = (byName[e.name] ?? 0) + e.dur / 1000;
    return {
      quanta: quanta.length,
      overBudget: quanta.filter((e) => e.dur > budgetUs).length,
      worstUs: quanta.reduce((m, e) => Math.max(m, e.dur), 0),
      renderMs: quanta.reduce((s, e) => s + e.dur, 0) / 1000,
      compileMs: byName,
    };
  };
  const at = (name, nth = 0) => toTrace(marks.filter((m) => m.name === name)[nth].t);
  const dump = (from) =>
    own
      .filter((e) => e.ts >= from && e.ts < from + DUMP_MS * 1000 && e.ph === 'X')
      .map((e) => ({ ms: (e.ts - from) / 1000, dur: e.dur, name: e.name, args: e.args }));
  if (dumping) return { build: dump(at('build')), first: dump(at('play')), second: dump(at('play', 1)) };
  return {
    build: span(at('build'), at('play')),
    first: span(at('play'), at('stop')),
    second: span(at('play', 1), at('stop', 1)),
  };
}

async function oneRun(base, name, profileRoot) {
  const browser = await launch(CHROME, profileRoot);
  try {
    const page = await openPage(browser, base);
    await ready(page);
    const script = async () => {
      const clockPage = await page.evaluate('performance.now()');
      const started = await page.evaluate(`cold.build(${JSON.stringify(name)}, ${rate ?? 'null'})`);
      await sleep(BUILD_S * 1000);
      await page.evaluate('cold.play()');
      await sleep(PLAY_S * 1000);
      await page.evaluate('cold.stop()');
      await sleep(GAP_S * 1000);
      await page.evaluate('cold.play()');
      await sleep(PLAY_S * 1000);
      await page.evaluate('cold.stop()');
      await sleep(GAP_S * 1000);
      const recorded = await page.evaluate('cold.finish()');
      return { started, recorded, clockPage };
    };
    if (!tracing) {
      const { started, recorded } = await script();
      return { started, ...windows(recorded) };
    }
    // A clock pair: performance.now() in the page against the trace's own timestamps, taken
    // from a console.timeStamp-free mark the trace records (blink.user_timing).
    const { events, result } = await trace(
      browser,
      ['webaudio', 'disabled-by-default-v8.compile', 'v8', 'blink.user_timing'],
      async () => {
        await page.evaluate('performance.mark("cold-clock")');
        const pageClock = await page.evaluate('performance.getEntriesByName("cold-clock")[0].startTime');
        const out = await script();
        return { ...out, pageClock };
      },
    );
    const markEvent = events.find((e) => e.name === 'cold-clock');
    const clock = { page: result.pageClock, trace: markEvent?.ts ?? NaN };
    return {
      started: result.started,
      ...windows(result.recorded),
      trace: traced(events, result.started.sampleRate, result.recorded.marks, clock),
    };
  } finally {
    await browser.close();
  }
}

const started = new Date();
const server = await serve(await files());
const base = `http://127.0.0.1:${server.address().port}/`;
const chromeVersion = execFileSync(CHROME, ['--version'], { encoding: 'utf8' }).trim();
const profileRoot = mkdtempSync(join(tmpdir(), 'windsor-837-cold-'));
const results = [];
try {
  for (let run = 0; run < runs; run++) {
    for (const name of cases) {
      const r = await oneRun(base, name, profileRoot);
      results.push({ name, run, load1: loadavg()[0], ...r });
      const line = (w) => `dev ${w.device} dsp ${w.dsp}`;
      console.log(
        run,
        name,
        `${r.started.sampleRate} Hz`,
        `build ${r.build.ms.toFixed(0)} ms: ${line(r.build)} | first: ${line(r.first)} | second: ${line(r.second)}`,
        r.trace && !dumping
          ? `| over budget b/1/2 ${r.trace.build.overBudget}/${r.trace.first.overBudget}/${r.trace.second.overBudget}`
          : '',
      );
    }
  }
} finally {
  rmSync(profileRoot, { recursive: true, force: true });
  server.close();
}
const environment = {
  cpu: cpus()[0].model,
  cores: cpus().length,
  kernel: release(),
  arch: process.arch,
  node: process.version,
  chromeVersion,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  runs,
  cases,
  rate,
  label,
  bundles: bundlesArg > 0 ? 'other' : 'worktree',
  started: started.toISOString(),
  finished: new Date().toISOString(),
};
mkdirSync(new URL('results/', folder), { recursive: true });
const out = new URL(`results/${started.toISOString().replace(/[:.]/g, '-')}-${label}.json`, folder);
writeFileSync(out, `${JSON.stringify({ environment, results }, null, 2)}\n`);
console.log('wrote', out.pathname);
