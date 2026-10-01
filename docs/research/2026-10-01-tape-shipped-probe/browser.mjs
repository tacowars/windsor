/* global process, console */
/** windsor#250 part 2: the shipped Tape bundle's cost in one bounded run of an isolated,
 * muted headless Chrome (temporary profile, no user data), #211's harness pattern. The
 * page journals every offline repeat and real-time trial as it completes; the report is
 * assembled from the journal alone, so a bound expiry keeps every finished record. #211's
 * browser.mjs runs its own experiment when imported, so its structure is copied, not
 * imported. Run from the repo root on Node 24, after probe.mjs, with nothing else heavy:
 *   node docs/research/2026-10-01-tape-shipped-probe/browser.mjs
 * `--smoke <path>` runs the declared smoke plan into <path> (harness check, not the
 * measurement); `--assemble` rebuilds the report from a journal a killed run left.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { cpus, loadavg, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { setTimeout, clearTimeout } from 'node:timers';
import { recoverJournal } from '../2026-09-30-tape-conditioning/journal.mjs';
import { assembleCost, save, SHIPPED, CONFIGURATIONS, plan } from './evidence.mjs';

const started = Date.now(),
  loadBefore = loadavg(),
  folder = new URL('./', import.meta.url);
const smoke = process.argv.includes('--smoke')
  ? process.argv[process.argv.indexOf('--smoke') + 1]
  : null;
const output = smoke ?? new URL('./measurement.json', folder).pathname;
const journal = `${smoke ?? new URL('./.measurement-journal', folder).pathname}.ndjson`;
const table = smoke ? { ...SHIPPED, repeats: SHIPPED.smoke.repeats } : SHIPPED;
const configurations = smoke
  ? CONFIGURATIONS.filter((c) => SHIPPED.smoke.configurations.includes(c.id))
  : CONFIGURATIONS;
const options = { table, configurations, steps: plan(table, configurations) };
const chromePath =
  process.env.TAPE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The page: program, hash, then every step in plan order, each result posted at once.
 * Edits are `setValueAtTime` events on each node's `drive` AudioParam over the program. */
const PAGE = `
import { SHIPPED as C, CONFIGURATIONS } from './probeConstants.ts';
import { renderProgram, programHash, checkProgram } from '../2026-09-30-tape-browser-cost/program.ts';
const post = (kind, value) => fetch('/journal', { method: 'POST', body: JSON.stringify({ kind, value }) });
const { steps, repeats } = await (await fetch('/plan.json')).json();
const byId = Object.fromEntries(CONFIGURATIONS.map((c) => [c.id, c]));
const message = (node, type) => new Promise((resolve, reject) => {
  node.port.addEventListener('message', (e) => e.data.type === type && resolve(e.data));
  node.port.start();
  node.addEventListener('processorerror', () => reject(Error('processorerror')));
});
const within = (promise, ms) => Promise.race([promise,
  new Promise((_, reject) => setTimeout(() => reject(Error('report timeout')), ms))]);
function edit(ctx, node) {
  const drive = node.parameters.get('drive'), every = (C.edits.quanta * C.quantumFrames) / C.rate;
  for (let k = 0; k * every < C.program.seconds; k++)
    drive.setValueAtTime(k % 2 ? C.edits.low : C.edits.high, ctx.currentTime + k * every);
}
function instances(ctx, step, source, realtime) {
  return Array.from({ length: step.instances }, () => {
    const node = new AudioWorkletNode(ctx, 'tape-shipped-cost', { numberOfInputs: 1,
      numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit',
      parameterData: { oversampling: byId[step.configuration].factor },
      processorOptions: { realtime, frames: C.program.frames } });
    if (step.mode === 'edits') edit(ctx, node);
    source.connect(node);
    node.connect(ctx.destination);
    return node;
  });
}
function scan(rendered) {
  let outputPeak = 0, outputNonfinite = 0;
  for (let ch = 0; ch < rendered.numberOfChannels; ch++)
    for (const v of rendered.getChannelData(ch))
      if (Number.isFinite(v)) outputPeak = Math.max(outputPeak, Math.abs(v)); else outputNonfinite++;
  return { outputPeak, outputNonfinite };
}
async function offline(step, repeat, buffer) {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: C.program.frames, sampleRate: C.rate });
  await ctx.audioWorklet.addModule('/worklet.js');
  const source = new AudioBufferSourceNode(ctx, { buffer });
  const finals = instances(ctx, step, source, false).map((n) => message(n, 'final'));
  source.start(0);
  const start = performance.now();
  const rendered = await ctx.startRendering();
  const renderMs = performance.now() - start;
  const reports = await within(Promise.all(finals), C.realtime.reportTimeoutMs);
  return { step: step.id, repeat, renderMs, reports, ...scan(rendered) };
}
async function realtime(step, buffer) {
  const ctx = new AudioContext({ sampleRate: C.rate, latencyHint: 'interactive' });
  try {
    await ctx.audioWorklet.addModule('/worklet.js');
    const source = new AudioBufferSourceNode(ctx, { buffer, loop: true });
    const nodes = instances(ctx, step, source, true);
    const warm = message(nodes[0], 'warm'), reports = Promise.all(nodes.map((n) => message(n, 'report')));
    const rc = 'renderCapacity' in ctx ? ctx.renderCapacity : null;
    const capacity = { available: !!rc, intervalSeconds: C.realtime.renderCapacitySeconds, updates: [] };
    source.start();
    await ctx.resume();
    await within(warm, C.realtime.reportTimeoutMs);
    if (rc) {
      rc.addEventListener('update', (e) => capacity.updates.push({ averageLoad: e.averageLoad,
        peakLoad: e.peakLoad, underrunRatio: e.underrunRatio, timestamp: e.timestamp }));
      rc.start({ updateInterval: capacity.intervalSeconds });
    }
    const measured = await within(reports, C.realtime.reportTimeoutMs);
    rc?.stop();
    return { step: step.id, rate: ctx.sampleRate, state: ctx.state, baseLatency: ctx.baseLatency,
      outputLatency: ctx.outputLatency, renderCapacity: capacity, reports: measured };
  } finally { await ctx.close(); }
}
try {
  const program = renderProgram();
  const buffer = new AudioBuffer({ numberOfChannels: 2, length: C.program.frames, sampleRate: C.rate });
  buffer.copyToChannel(program.left, 0);
  buffer.copyToChannel(program.right, 1);
  await post('program', { sha256: await programHash(program), ...checkProgram(program),
    userAgent: navigator.userAgent, renderCapacityInterface: 'AudioRenderCapacity' in globalThis });
  for (const step of steps) {
    try {
      if (step.kind === 'offline')
        for (let r = 0; r < repeats; r++) await post('repeat', await offline(step, r, buffer));
      else await post('realtime', await realtime(step, buffer));
    } catch (error) { await post('error', { step: step.id, error: String(error) }); }
  }
} catch (error) { await post('error', { step: null, error: String(error) }); }
await post('done', {});
`;

async function bundles() {
  const common = { bundle: true, write: false, target: 'esnext' };
  const worklet = await build({
    ...common,
    entryPoints: [new URL('./costWorklet.mjs', folder).pathname],
    format: 'iife',
    // The generated bundle arrives as its exact text, evaluated inside costWorklet.mjs.
    loader: { '.js': 'text' },
  });
  const page = await build({
    ...common,
    stdin: { contents: PAGE, resolveDir: folder.pathname, loader: 'js' },
    format: 'esm',
  });
  return {
    '/': [
      'text/html',
      '<!doctype html><title>Tape cost</title><script type="module" src="/page.js"></script>',
    ],
    '/page.js': ['text/javascript', page.outputFiles[0].text],
    '/worklet.js': ['text/javascript', worklet.outputFiles[0].text],
    '/plan.json': [
      'application/json',
      JSON.stringify({ steps: options.steps, repeats: table.repeats }),
    ],
  };
}

function serve(files, onDone) {
  return createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/journal') {
      let body = '';
      req.on('data', (data) => (body += data));
      req.on('end', () => {
        const entry = JSON.parse(body);
        appendFileSync(journal, `${JSON.stringify(entry)}\n`);
        res.end('ok');
        if (entry.kind === 'done') onDone();
        else
          console.log(
            entry.kind,
            entry.value.step ?? '',
            entry.value.renderMs ?? entry.value.error ?? '',
          );
      });
      return;
    }
    const [type, text] = files[req.url] ?? ['text/plain', ''];
    res.setHeader('content-type', type);
    res.end(text);
  });
}

function report(run, costEnvironment) {
  const { entries, truncatedTail } = recoverJournal(readFileSync(journal, 'utf8'));
  const result = assembleCost(entries, { ...run, truncatedTail }, options);
  save(output, { costEnvironment, ...result });
  console.log(result.costRun, result.costMissing, result.costCheck, result.costAssessments);
}

/** Chrome on the served page until the page posts `done` or the bound expires. */
async function chromeRun(server, done) {
  const profile = mkdtempSync(join(tmpdir(), 'windsor-tape-shipped-'));
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
  const outcome = await Promise.race([
    done,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ expired: true }), started + table.budgetMs - Date.now());
      chrome.once('error', (e) => resolve({ expired: false, error: String(e) }));
      chrome.once('exit', (code) => resolve({ expired: false, error: `Chrome exited (${code})` }));
    }),
  ]);
  clearTimeout(timer);
  chrome.kill('SIGTERM');
  await new Promise((r) =>
    chrome.exitCode !== null || !chrome.pid ? r() : chrome.once('exit', r),
  );
  rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return outcome;
}

async function measure() {
  writeFileSync(journal, '');
  const chromeVersion = execFileSync(chromePath, ['--version'], { encoding: 'utf8' }).trim();
  let finish;
  const done = new Promise((resolve) => (finish = resolve));
  const server = serve(await bundles(), () => finish({ expired: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const outcome = await chromeRun(server, done);
  server.close();
  const run = {
    ...outcome,
    budgetMs: table.budgetMs,
    elapsedMs: Date.now() - started,
    smoke: !!smoke,
  };
  report(run, {
    cpu: cpus()[0].model,
    os: release(),
    arch: process.arch,
    node: process.version,
    chromeVersion,
    backend:
      'headless Chrome: OfflineAudioContext (mean) and AudioContext (real time), muted destination; output device unverified',
    bundle: table.bundle,
    bundleSha256: createHash('sha256').update(readFileSync(table.bundle)).digest('hex'),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    loadAverage: { before: loadBefore, after: loadavg() },
  });
  if (!smoke) unlinkSync(journal);
}

if (process.argv.includes('--assemble'))
  report({ expired: null, recovered: true }, { recovered: 'environment not recorded' });
else await measure();
