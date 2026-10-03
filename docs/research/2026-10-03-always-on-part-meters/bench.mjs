/* global process, console */
/** windsor#533: what always-on part meters cost, in one command from the repo root on
 * Node 24, with nothing else heavy running if it can be helped:
 *   node docs/research/2026-10-03-always-on-part-meters/bench.mjs
 * It bundles page.mjs and the research multi-input meter with esbuild, serves them with
 * the engine's generated worklet bundles byte for byte, and drives a headless Chrome of its
 * own over the DevTools protocol (cdp.mjs). Every round runs every pass in passes.mjs
 * once. Results go to results/<timestamp>.json; report.mjs prints the README's tables from
 * all of them. `--rounds <n>` overrides the round count; `--quick` is a harness check
 * whose file is named `-quick` and which report.mjs leaves out.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus, release, totalmem } from 'node:os';
import { URL } from 'node:url';
import { BENCH } from './benchConstants.mjs';
import { launch } from './cdp.mjs';
import { offline, pass, plan } from './passes.mjs';

const folder = new URL('./', import.meta.url);
const generated = new URL('../../../packages/engine/src/worklet/generated/', import.meta.url);
const quick = process.argv.includes('--quick');
const flag = process.argv.indexOf('--rounds');
const Q = BENCH.quick;
const timing = {
  rounds: flag > 0 ? Number(process.argv[flag + 1]) : quick ? Q.rounds : BENCH.rounds,
  warmupSeconds: quick ? Q.warmupSeconds : BENCH.warmupSeconds,
  segmentSeconds: quick ? Q.segmentSeconds : BENCH.segments.seconds,
  traceSeconds: quick ? Q.traceSeconds : BENCH.traceSeconds,
  offlineRepeats: quick ? Q.offlineRepeats : BENCH.offline.repeats,
};

async function bundle(entry, format) {
  const out = await build({
    entryPoints: [new URL(entry, folder).pathname],
    bundle: true,
    write: false,
    target: 'esnext',
    format,
  });
  return out.outputFiles[0].text;
}

async function files() {
  const html =
    '<!doctype html><title>Meters</title><script type="module" src="/src/bench/page.js"></script>';
  const served = {
    '/': ['text/html', html],
    // page.js sits where the engine's `new URL('../worklet/generated/…', import.meta.url)`
    // resolves to the generated bundles served below, byte for byte.
    '/src/bench/page.js': ['text/javascript', await bundle('page.mjs', 'esm')],
    '/multi-meter.js': ['text/javascript', await bundle('multiMeterProcessor.mjs', 'iife')],
    '/song.json': ['application/json', readFileSync(new URL(BENCH.song, folder), 'utf8')],
  };
  for (const name of readdirSync(generated).filter((n) => n.endsWith('.js')))
    served[`/src/worklet/generated/${name}`] = [
      'text/javascript',
      readFileSync(new URL(name, generated), 'utf8'),
    ];
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

function environment(chromeVersion) {
  const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
  return {
    cpu: cpus()[0].model,
    cores: cpus().length,
    memoryGB: totalmem() / 2 ** 30,
    os: `${run('sw_vers', ['-productName'])} ${run('sw_vers', ['-productVersion'])} (Darwin ${release()})`,
    arch: process.arch,
    node: process.version,
    chromeVersion,
    commit: run('git', ['rev-parse', 'HEAD']),
    peakMeterBundleSha256: createHash('sha256')
      .update(readFileSync(new URL('peak-meter-processor.js', generated)))
      .digest('hex'),
    timing,
    quick,
  };
}

function headline(record) {
  if (record.error) return record.error;
  if (record.kind === 'main') return `${record.busyMsPerSecond.toFixed(2)} ms/s busy`;
  return Object.entries(record.byN ?? {})
    .map(([n, s]) => `N=${n} ${s.wallUs.mean.toFixed(1)} µs`)
    .join(', ');
}

const started = new Date();
const server = await serve(await files());
const base = `http://127.0.0.1:${server.address().port}/`;
const chromeVersion = execFileSync(BENCH.chrome, ['--version'], { encoding: 'utf8' }).trim();
const browser = await launch(BENCH.chrome);
const passes = [];
try {
  for (let round = 0; round < timing.rounds; round++) {
    for (const config of plan(round)) {
      const record = await pass(browser, base, { ...config, round }, timing);
      passes.push(record);
      console.log(
        round,
        config.kind,
        config.case,
        config.variant,
        config.n ?? '',
        headline(record),
      );
    }
    passes.push(...(await offline(browser, base, round, timing.offlineRepeats)));
    console.log(round, 'offline done');
  }
} finally {
  await browser.close();
  server.close();
}
mkdirSync(new URL('results/', folder), { recursive: true });
const name = `results/${started.toISOString().replace(/[:.]/g, '-')}${quick ? '-quick' : ''}.json`;
const record = { started: started.toISOString(), environment: environment(chromeVersion), passes };
writeFileSync(new URL(name, folder), `${JSON.stringify(record)}\n`);
console.log('wrote', name);
