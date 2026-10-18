/* global process, console */
/** windsor#897: one bounded run of `page.ts` in an isolated, muted headless Chrome
 * (temporary profile, no user data), as the Tape cost study's browser.mjs and the
 * Pump's bench.mjs run.
 * Serves the repository root on 127.0.0.1, collects each repeat the page posts,
 * and writes `measurement.json` beside this file. Run from the repo root on Node 24:
 *   node docs/research/2026-10-18-transient-insert/bench.mjs
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, loadavg, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { URL } from 'node:url';
import { setTimeout } from 'node:timers';

const BOUND_MS = 900_000;
const QUANTUM_MS = (128 / 48000) * 1000;
const folder = new URL('./', import.meta.url);
const root = new URL('../../../', folder).pathname;
const chromePath =
  process.env.TRANSIENT_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const loadBefore = loadavg();
const records = [];

const page = (
  await build({
    entryPoints: [new URL('./page.ts', folder).pathname],
    bundle: true,
    format: 'esm',
    write: false,
  })
).outputFiles[0].text;

const HTML = '<!doctype html><meta charset="utf-8"><script type="module" src="/page.js"></script>';

/** The median, min and max of `values`. */
function spread(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return { median: sorted[Math.floor(sorted.length / 2)], min: sorted[0], max: sorted.at(-1) };
}

/** Per cell: render ms, duty (render over the program's length) and ms per quantum. */
function summarise(plan) {
  const cells = new Map();
  for (const r of records.filter((x) => x.kind === 'repeat')) {
    const id = `${r.cell.mode}/${r.cell.instances}`;
    if (!cells.has(id)) cells.set(id, { ...r.cell, ms: [], peak: r.peak, rms: r.rms });
    cells.get(id).ms.push(r.ms);
  }
  return [...cells.values()].map((c) => {
    const ms = spread(c.ms);
    const duty = ms.median / (plan.seconds * 1000);
    return {
      mode: c.mode,
      instances: c.instances,
      repeats: c.ms.length,
      renderMs: ms,
      duty,
      msPerQuantum: duty * QUANTUM_MS,
      outputPeak: c.peak,
      outputRmsPerInstance: c.rms,
    };
  });
}

let finished = false;

function finish(server, chrome, profile, done) {
  if (finished) return;
  finished = true;
  const machine = execFileSync('sysctl', ['-n', 'machdep.cpu.brand_string']).toString().trim();
  const report = {
    machine: { cpu: machine, cores: cpus().length, darwin: release(), node: process.version },
    loadBefore,
    loadAfter: loadavg(),
    userAgent: done?.userAgent,
    plan: done?.plan,
    error: records.find((r) => r.kind === 'error')?.message ?? null,
    cells: summarise(done?.plan ?? { seconds: 20 }),
    repeats: records.filter((r) => r.kind === 'repeat'),
  };
  writeFileSync(new URL('./measurement.json', folder), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.cells, null, 2));
  server.close();
  chrome.on('exit', () => rmSync(profile, { recursive: true, force: true }));
  chrome.kill();
}

function serve(request, response, onDone) {
  if (request.method === 'POST') {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const record = JSON.parse(body);
      records.push(record);
      response.end();
      if (record.kind === 'done' || record.kind === 'error') onDone(record);
    });
    return;
  }
  const path = new URL(request.url, 'http://x').pathname;
  if (path === '/') return response.end(HTML);
  if (path === '/page.js') {
    response.setHeader('content-type', 'text/javascript');
    return response.end(page);
  }
  if (!path.startsWith('/packages/engine/src/worklet/generated/')) {
    response.statusCode = 404;
    return response.end();
  }
  response.setHeader('content-type', 'text/javascript');
  response.end(readFileSync(join(root, path)));
}

const profile = mkdtempSync(join(tmpdir(), 'windsor-897-transient-'));
let chrome;
const server = createServer((request, response) =>
  serve(request, response, (done) => finish(server, chrome, profile, done)),
);
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address();
  chrome = spawn(chromePath, [
    '--headless=new',
    `--user-data-dir=${profile}`,
    '--mute-audio',
    '--no-first-run',
    '--disable-extensions',
    `http://127.0.0.1:${port}/`,
  ]);
  setTimeout(() => finish(server, chrome, profile, null), BOUND_MS).unref();
});
