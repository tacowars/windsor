/* global process, console */
/** Isolated, muted Chrome AudioContext benchmark. No user profile or app data. */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { writeReport } from './report.mjs';
import { cpus, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { loadSource, researchEntry } from './load.mjs';
const { EXPERIMENT: E } = await loadSource(researchEntry);
const folder = new URL('./', import.meta.url);
const worklet = await build({
  entryPoints: [new URL('./browserWorklet.mjs', folder).pathname],
  bundle: true,
  write: false,
  format: 'iife',
  target: 'esnext',
  plugins: [
    {
      name: 'phase-2-baseline',
      setup(b) {
        b.onLoad({ filter: /\/packages\/.*\.ts$/ }, ({ path }) => ({
          contents: execFileSync(
            'git',
            ['show', `${E.baseline}:${path.slice(process.cwd().length + 1)}`],
            { encoding: 'utf8' },
          ),
          loader: 'ts',
        }));
      },
    },
  ],
});
const PAGE = `<!doctype html><title>Tape research</title><script type="module">
const results = { userAgent: navigator.userAgent, backend: 'headless Chrome AudioContext, muted destination; output device unverified', trials: [] };
async function trial(options, count) {
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
  try {
    await ctx.audioWorklet.addModule('/worklet.js');
    const reports = [];
    for (let i = 0; i < count; i++) {
      const node = new AudioWorkletNode(ctx, 'tape-research', { numberOfInputs: 0,
        numberOfOutputs: 1, outputChannelCount: [2], processorOptions: options });
      reports.push(new Promise((resolve, reject) => {
        node.port.onmessage = e => resolve(e.data);
        node.onprocessorerror = () => reject(Error('processorerror'));
      }));
      node.connect(ctx.destination);
    }
    await ctx.resume();
    const measured = await Promise.all(reports);
    return { options, instances: count, rate: ctx.sampleRate, state: ctx.state,
      baseLatency: ctx.baseLatency, outputLatency: ctx.outputLatency,
      renderCapacityAvailable: 'renderCapacity' in ctx, reports: measured,
      estimatedLoadPct: measured.reduce((sum, r) => sum + r.busyMs, 0) /
        Math.max(...measured.map(r => r.wallMs)) * 100 };
  } finally { await ctx.close(); }
}
try {
  for (const options of [{ legacy: true, factor: 1 }, { solver: 'rk2', factor: 4 }, { solver: 'rk4', factor: 4 }])
    for (const instances of [1, 4]) for (const moving of [false, true])
      results.trials.push(await trial({ ...options, moving }, instances));
} catch (error) { results.error = String(error); }
await fetch('/result', { method: 'POST', body: JSON.stringify(results) });
</script>`;
let finish;
const done = new Promise((resolve) => {
  finish = resolve;
});
const server = createServer((req, res) => {
  if (req.url === '/result' && req.method === 'POST') {
    let body = '';
    req.on('data', (data) => {
      body += data;
    });
    req.on('end', () => {
      res.end('ok');
      finish(JSON.parse(body));
    });
    return;
  }
  res.setHeader('content-type', req.url === '/worklet.js' ? 'text/javascript' : 'text/html');
  res.end(req.url === '/worklet.js' ? worklet.outputFiles[0].text : PAGE);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const profile = mkdtempSync(join(tmpdir(), 'windsor-tape-phase3-'));
const chromePath =
  process.env.TAPE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const chromeVersion = execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim();
const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-extensions',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    `http://127.0.0.1:${server.address().port}/`,
  ],
  { stdio: 'ignore' },
);
let timer;
try {
  const result = await Promise.race([
    done,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('Browser measurement timed out')), 90000);
      chrome.on('error', reject);
      chrome.on('exit', () => reject(Error('Browser exited before measurement')));
    }),
  ]);
  if (result.error) throw Error(result.error);
  result.environment = { cpu: cpus()[0].model, os: release(), arch: process.arch };
  result.chromeVersion = chromeVersion;
  result.baseline = E.baseline;
  writeReport(new URL('./browser-measurement.json', folder), result);
  console.log(JSON.stringify(result));
} finally {
  clearTimeout(timer);
  chrome.kill('SIGTERM');
  await new Promise((resolve) =>
    !chrome.pid || chrome.exitCode !== null ? resolve() : chrome.once('exit', resolve),
  );
  server.close();
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
