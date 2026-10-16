/* global process, console, URL, WebSocket, setInterval, clearInterval, setTimeout, clearTimeout */
/** The long-export measurement (windsor#822 decision 6), one command from the repo root:
 *   node docs/research/2026-10-16-long-audio-export/measure.mjs [--cases a,b] [--profile-root dir]
 * It bundles page.mjs with esbuild, serves it beside the engine's generated worklet bundles on
 * 127.0.0.1 (a secure context, so the origin-private file system is there), and for each case
 * starts a headless Chrome of its own with a throwaway profile under `--profile-root`, runs the
 * export over the DevTools protocol and samples every process of that profile with `ps` once a
 * second. It prints one table row per case and writes results/<timestamp>.json. The WAV each
 * case writes lives in the throwaway profile's OPFS; the page removes it, and the profile is
 * deleted with the browser. `WINDSOR_CHROME` names the browser binary.
 */
import { build } from 'esbuild';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, release, tmpdir, totalmem } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const folder = new URL('./', import.meta.url);
const generated = new URL('../../../packages/engine/src/worklet/generated/', import.meta.url);
const CHROME =
  process.env.WINDSOR_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at > 0 ? process.argv[at + 1] : fallback;
};
const only = arg('--cases', null)?.split(',') ?? null;
const profileRoot = arg('--profile-root', tmpdir());
const SAMPLE_MS = 1000;
const CASE_TIMEOUT_MS = 30 * 60 * 1000;

/** The songs: the fixture's four parts at three lengths, all 48 kHz. */
const SONGS = {
  // 225 bars of 4/4 at 60 BPM: 900 s, plus the default 2 s tail.
  '15min': { song: { bars: 225, bpm: 60, meter: '4/4' }, tailSeconds: 2 },
  // 225 bars of 4/4 at 30 BPM: 1800 s, plus the default 2 s tail.
  '30min': { song: { bars: 225, bpm: 30, meter: '4/4' }, tailSeconds: 2 },
  // The stream cap's song: 256 bars of 12/8 at 20 BPM, 4608 s, plus the longest tail, 10 s.
  cap: { song: { bars: 256, bpm: 20, meter: '12/8' }, tailSeconds: 10 },
};
const CASES = Object.entries(SONGS).flatMap(([name, song]) =>
  ['whole', 'stream'].flatMap((path) =>
    [24, 32].map((bitDepth) => ({ name: `${name}-${path}-${bitDepth}`, path, bitDepth, ...song })),
  ),
);

async function files() {
  const html = '<!doctype html><title>Export</title><script type="module" src="/src/bench/page.js"></script>';
  const page = await build({
    entryPoints: [new URL('page.mjs', folder).pathname],
    bundle: true,
    write: false,
    target: 'esnext',
    format: 'esm',
    loader: { '.json': 'json' },
  });
  // The engine resolves its worklets with `new URL('../worklet/generated/…', import.meta.url)`,
  // so the bundle sits where that lands on the served copies.
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

function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = new Set();
  let id = 0;
  ws.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    const waiting = pending.get(message.id);
    if (!waiting) return listeners.forEach((listen) => listen(message));
    pending.delete(message.id);
    if (message.error) waiting.reject(Error(JSON.stringify(message.error)));
    else waiting.resolve(message.result);
  };
  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((resolve, reject) => {
      pending.set(++id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return new Promise((resolve, reject) => {
    ws.onopen = () => resolve({ ws, send, listeners });
    ws.onerror = reject;
  });
}

async function launch() {
  const profile = mkdtempSync(join(profileRoot, 'windsor-822-chrome-'));
  const chrome = spawn(
    CHROME,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-background-networking',
      '--disable-extensions',
      '--mute-audio',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 400 && !existsSync(portFile); i++) await sleep(50);
  const [port, path] = readFileSync(portFile, 'utf8').trim().split('\n');
  const browser = await connect(`ws://127.0.0.1:${port}${path}`);
  const close = async () => {
    browser.ws.close();
    chrome.kill('SIGTERM');
    if (chrome.exitCode === null) await new Promise((resolve) => chrome.once('exit', resolve));
    rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  };
  return { ...browser, profile, pid: chrome.pid, close };
}

/** Every process of `profile` once a second: the peak RSS of the largest renderer, the browser, and all. */
function sampler(profile, browserPid) {
  const peak = { rendererMb: 0, browserMb: 0, totalMb: 0, samples: 0 };
  const tick = () => {
    const lines = execFileSync('ps', ['-A', '-o', 'pid=,rss=,command='], { encoding: 'utf8' }).split('\n');
    let total = 0;
    for (const line of lines) {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
      if (!match) continue;
      const [, pid, rssKb, command] = match;
      const mine = Number(pid) === browserPid || command.includes(`--user-data-dir=${profile}`);
      if (!mine) continue;
      const mb = Number(rssKb) / 1024;
      total += mb;
      if (Number(pid) === browserPid) peak.browserMb = Math.max(peak.browserMb, mb);
      if (command.includes('--type=renderer')) peak.rendererMb = Math.max(peak.rendererMb, mb);
    }
    peak.totalMb = Math.max(peak.totalMb, total);
    peak.samples++;
  };
  tick();
  const timer = setInterval(tick, SAMPLE_MS);
  return { peak, stop: () => (clearInterval(timer), tick(), peak) };
}

async function runCase(base, spec) {
  const browser = await launch();
  try {
    const { product } = await browser.send('Browser.getVersion');
    const { targetId } = await browser.send('Target.createTarget', { url: base });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    await browser.send('Inspector.enable', {}, sessionId);
    const crashed = new Promise((_, reject) =>
      browser.listeners.add((m) => {
        if (m.method === 'Inspector.targetCrashed') reject(Error('the renderer crashed'));
      }),
    );
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await browser.send(
        'Runtime.evaluate',
        { expression, awaitPromise: true, returnByValue: true },
        sessionId,
      );
      if (exceptionDetails) throw Error(exceptionDetails.exception?.description ?? 'evaluate failed');
      return result.value;
    };
    for (let i = 0; i < 100 && !(await evaluate('typeof window.measure === "object"')); i++) await sleep(100);
    const watch = sampler(browser.profile, browser.pid);
    let timer;
    const timeout = new Promise((_, reject) => (timer = setTimeout(() => reject(Error('timed out')), CASE_TIMEOUT_MS)));
    let result;
    try {
      result = await Promise.race([evaluate(`measure.run(${JSON.stringify(spec)})`), crashed, timeout]);
    } catch (error) {
      result = { error: error.message };
    }
    clearTimeout(timer);
    return { ...spec, browser: product, ...result, memory: watch.stop() };
  } finally {
    await browser.close();
  }
}

const mb = (bytes) => (bytes / 2 ** 20).toFixed(0);
const s = (ms) => (ms / 1000).toFixed(1);

function row(r) {
  if (r.error) return `| ${r.name} | failed: ${r.error} | | | | ${r.memory.rendererMb.toFixed(0)} | ${r.memory.browserMb.toFixed(0)} |`;
  const f = r.file;
  const ok =
    f.riff === 'RIFF' &&
    f.rate === 48000 &&
    f.channels === 2 &&
    f.bits === r.bitDepth &&
    f.format === (r.bitDepth === 32 ? 3 : 1) &&
    f.dataBytes === r.frames * 2 * (r.bitDepth / 8) &&
    f.bytes === f.dataAt + f.dataBytes &&
    (r.bitDepth !== 32 || f.fact === r.frames);
  return `| ${r.name} | ${(r.frames / 48000 / 60).toFixed(1)} min | ${s(r.renderMs)} | ${s(r.writeMs)} | ${mb(f.bytes)} MiB${ok ? '' : ' (header wrong)'} | ${r.memory.rendererMb.toFixed(0)} | ${r.memory.browserMb.toFixed(0)} |`;
}

const server = await serve(await files());
const base = `http://127.0.0.1:${server.address().port}/`;
const results = [];
console.log('| case | length | render s | encode + write s | file | renderer peak MiB | browser peak MiB |');
console.log('|---|---|---|---|---|---|---|');
for (const spec of CASES) {
  if (only && !only.some((name) => spec.name.startsWith(name))) continue;
  const result = await runCase(base, spec);
  results.push(result);
  console.log(row(result));
}
server.close();
const machine = { cpu: cpus()[0].model, cores: cpus().length, memoryGb: totalmem() / 2 ** 30, os: release() };
mkdirSync(new URL('results/', folder), { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
writeFileSync(new URL(`results/${stamp}.json`, folder), `${JSON.stringify({ machine, results }, null, 2)}\n`);
console.log(JSON.stringify(machine));
