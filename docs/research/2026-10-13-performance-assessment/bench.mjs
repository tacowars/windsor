/* global process, console, URL */
/** The performance assessment's bench (2026-10-13), one command from the repo root:
 *   node docs/research/2026-10-13-performance-assessment/bench.mjs [--rounds n] [--only offline|live|kinds|micro]
 * It bundles page.mjs with esbuild, serves it beside the engine's generated worklet bundles,
 * drives a headless Chromium of its own over the DevTools protocol, and writes
 * results/<timestamp>.json. report.mjs prints the README's tables from the results.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { launch, openPage, trace } from './cdp.mjs';
import { audioPass } from './analyse.mjs';
import { KINDS, LIVE_CASES, OFFLINE_CASES } from './songs.mjs';

const folder = new URL('./', import.meta.url);
const generated = new URL('../../../packages/engine/src/worklet/generated/', import.meta.url);
const CHROME = process.env.WINDSOR_CHROME ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const rounds = Number(arg('--rounds', 3));
const only = arg('--only', null);
const LIVE_WARMUP_S = 4;
const LIVE_TRACE_S = 12;
const CATEGORIES = ['webaudio', 'disabled-by-default-v8.gc', 'blink.user_timing'];

async function files() {
  const html = '<!doctype html><title>Perf</title><script type="module" src="/src/bench/page.js"></script>';
  const page = await build({
    entryPoints: [new URL('page.mjs', folder).pathname],
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

const rotate = (list, by) => list.map((_, i) => list[(i + by) % list.length]);

async function ready(page) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate('typeof window.bench === "object"')) return;
    await sleep(100);
  }
  throw Error(`page never ready: ${page.logs.join(' | ')}`);
}

async function offlineRound(browser, base, round, results) {
  const page = await openPage(browser, base);
  await ready(page);
  for (const c of rotate(OFFLINE_CASES, round)) {
    const r = await page.evaluate(`bench.offline(${JSON.stringify(c.name)})`);
    results.push({ kind: 'offline', round, load1: loadavg()[0], ...r });
    console.log(round, 'offline', c.name, `${r.msPerAudioSecond.toFixed(1)} ms/s`);
  }
  await page.close();
}

async function kindsRound(browser, base, round, results) {
  const page = await openPage(browser, base);
  await ready(page);
  for (const k of rotate(['none', ...KINDS], round)) {
    for (const silent of [false, true]) {
      const r = await page.evaluate(`bench.kind(${JSON.stringify(k)}, ${silent})`);
      results.push({ kind: 'kind', insert: k, silent, round, load1: loadavg()[0], ...r });
      console.log(round, 'kind', r.name, `${r.msPerAudioSecond.toFixed(1)} ms/s`);
    }
  }
  await page.close();
}

async function liveRound(browser, base, round, results) {
  for (const name of rotate(LIVE_CASES, round)) {
    const page = await openPage(browser, base);
    await ready(page);
    const started = await page.evaluate(`bench.startLive(${JSON.stringify(name)})`);
    await sleep(LIVE_WARMUP_S * 1000);
    const { events, result } = await trace(browser, CATEGORIES, async () => {
      const before = await page.evaluate('bench.liveCounters()');
      await sleep(LIVE_TRACE_S * 1000);
      const after = await page.evaluate('bench.liveCounters()');
      return { before, after };
    });
    await page.evaluate('bench.stopLive()');
    const pass = audioPass(events, started.sampleRate);
    const wall = (result.after.wallMs - result.before.wallMs) / 1000;
    const clockRate = (result.after.audioSeconds - result.before.audioSeconds) / wall;
    const r = {
      kind: 'live',
      name,
      round,
      load1: loadavg()[0],
      sampleRate: started.sampleRate,
      baseLatency: started.baseLatency,
      clockRate,
      meter: result.after.load,
      underrunsMeter: result.after.load.underruns - result.before.load.underruns,
      ...pass,
    };
    results.push(r);
    console.log(
      round,
      'live',
      name,
      pass.renders
        ? `mean ${pass.renders.mean.toFixed(0)} p99 ${pass.renders.p99.toFixed(0)} max ${pass.renders.max.toFixed(0)} µs, over ${pass.renders.overBudget}/${pass.renders.count}, clock ${clockRate.toFixed(3)}`
        : 'no renders traced',
    );
    await page.close();
  }
}

async function microRound(browser, base, round, results) {
  const page = await openPage(browser, base);
  await ready(page);
  const r = await page.evaluate('bench.micro(16)');
  results.push({ kind: 'micro', round, load1: loadavg()[0], ...r });
  console.log(round, 'micro', JSON.stringify(r));
  await page.close();
}

async function mainRound(browser, base, round, results) {
  const page = await openPage(browser, base);
  await ready(page);
  const r = await page.evaluate('bench.mainThread()');
  results.push({ kind: 'main', round, load1: loadavg()[0], ...r });
  console.log(round, 'main', JSON.stringify(r));
  await page.close();
}

const started = new Date();
const server = await serve(await files());
const base = `http://127.0.0.1:${server.address().port}/`;
const chromeVersion = execFileSync(CHROME, ['--version'], { encoding: 'utf8' }).trim();
// Chromium's throwaway profiles go under one folder of the system temp dir, as CLAUDE.md asks
// of a tool that insists on /tmp; it is made here and removed after the browser closes.
const profileRoot = join(tmpdir(), 'windsor-perf-bench');
mkdirSync(profileRoot, { recursive: true });
const browser = await launch(CHROME, profileRoot);
const results = [];
try {
  for (let round = 0; round < rounds; round++) {
    if (!only || only === 'micro') await microRound(browser, base, round, results);
    if (!only || only === 'main') await mainRound(browser, base, round, results);
    if (!only || only === 'offline') await offlineRound(browser, base, round, results);
    if (!only || only === 'live') await liveRound(browser, base, round, results);
    if (!only || only === 'kinds') await kindsRound(browser, base, round, results);
  }
} finally {
  await browser.close();
  rmSync(profileRoot, { recursive: true, force: true });
  server.close();
}
const environment = {
  cpu: cpus()[0].model,
  cores: cpus().length,
  memoryGB: +(totalmem() / 2 ** 30).toFixed(1),
  kernel: release(),
  arch: process.arch,
  node: process.version,
  chromeVersion,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  rounds,
  only,
  started: started.toISOString(),
  finished: new Date().toISOString(),
};
mkdirSync(new URL('results/', folder), { recursive: true });
const out = new URL(`results/${started.toISOString().replace(/[:.]/g, '-')}${only ? `-${only}` : ''}.json`, folder);
writeFileSync(out, `${JSON.stringify({ environment, results }, null, 2)}\n`);
console.log('wrote', out.pathname);
