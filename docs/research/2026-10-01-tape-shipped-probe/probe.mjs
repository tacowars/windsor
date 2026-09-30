/* global process, console, setTimeout, clearTimeout */
/** windsor#250 part 1: the guard (c) and slew (e) matrices through the shipped TapeDsp
 * source, in one child under the parent's 900-second wall-clock bound, as #188's children
 * run. Each cell is journaled on completion; the report is assembled from the journal
 * alone, so an expired run keeps every finished cell. Run from the repo root on Node 24:
 *   node docs/research/2026-10-01-tape-shipped-probe/probe.mjs
 * `--smoke <path>` renders the first two cells of each matrix into <path> (a harness
 * check, not the measurement).
 */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, loadavg, release } from 'node:os';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { recoverJournal } from '../2026-09-30-tape-conditioning/journal.mjs';
import * as V from './evidence.mjs';

const P = V.PROBE;
/** The shipped engine sources, loaded by the worker only. */
let S;
const at = process.argv.indexOf('--smoke'),
  smoke = at < 0 ? null : process.argv[at + 1];
const output = smoke ?? new URL('./measurement.json', import.meta.url).pathname;
const journal = `${smoke ?? new URL('./.probe-journal', import.meta.url).pathname}.ndjson`;
const emit = (kind, value) => appendFileSync(journal, `${JSON.stringify({ kind, value })}\n`);

/** The declared inputs at `rate`: full-scale (c) signals and over-level (e) signals. */
function signal(name, rate, random) {
  const g = P.guard,
    e = P.slew,
    [up, down] = g.impulseSeconds.map((s) => Math.round(s * rate)),
    hold = Math.round(g.stepSeconds * rate),
    tone = (hz) => (n) => g.level * S.sine((2 * Math.PI * hz * n) / rate);
  return {
    sine100: tone(100),
    sine1k: tone(1000),
    impulse: (n) => (n === up ? g.level : n === down ? -g.level : 0),
    step: (n) => g.level * [0, 1, 0, -1, 0][Math.min(4, Math.floor(n / hold))],
    noise: () => Math.max(-e.over, Math.min(e.over, e.spread * e.over * (2 * random() - 1))),
    alternating: (n) => (n % 2 ? -e.over : e.over),
  }[name];
}

/** One cell: a fresh shipped DSP, the left core read after every host sample. */
function render(cell, spec, seconds) {
  const frames = Math.round(seconds * cell.rate);
  const values = { ...S.TAPE_DEFAULTS, ...spec, oversampling: cell.factor };
  const params = Object.fromEntries(
    Object.entries({ ...values, model: S.TAPE_TYPES.indexOf(cell.model) }).map(([k, v]) => [
      k,
      new Float32Array([Number(v)]),
    ]),
  );
  const dsp = new S.TapeDsp(cell.rate, params);
  const core = () => dsp.magnetic.active[0].core;
  const perSecond = new Array(Math.ceil(seconds)).fill(0);
  let peakM = 0,
    resets = core().resets,
    firstResetSeconds = null;
  const each = (n) => {
    const now = core();
    peakM = Math.max(peakM, Math.abs(now.m));
    if (now.resets === resets) return;
    perSecond[Math.floor(n / cell.rate)] += now.resets - resets;
    resets = now.resets;
    firstResetSeconds ??= n / cell.rate;
  };
  const input = signal(cell.signal, cell.rate, S.mulberry32(P.slew.seed));
  const run = S.renderTape({ dsp, params }, input, frames, { each });
  let outputPeak = 0,
    nonfinite = 0;
  for (const v of run.left)
    if (Number.isFinite(v)) outputPeak = Math.max(outputPeak, Math.abs(v));
    else nonfinite++;
  const { guards, field } = run;
  const record = { ...cell, frames, seconds, guards, resets: run.resets, field, peakM };
  return { record: { ...record, outputPeak, nonfinite }, slew: { perSecond, firstResetSeconds } };
}

async function worker() {
  S = await loadSource(`
export { TapeDsp } from './packages/engine/src/worklet/tape/tapeDsp.ts';
export { renderTape } from './packages/engine/src/__fixtures__/tapeDspProbe.ts';
export { TAPE_DEFAULTS, TAPE_TYPES } from './packages/engine/src/inserts/tapeConstants.ts';
export { sine } from './packages/engine/src/inserts/tapePortableMath.ts';
export { mulberry32 } from './packages/engine/src/sequencing/mulberry32.ts';`);
  const take = (cells) => (smoke ? cells.slice(0, 2) : cells);
  const guard = take(V.guardCells(P)),
    slew = take(V.slewCells(P));
  for (const [i, cell] of guard.entries()) {
    const { record } = render(cell, { bias: cell.bias, drive: cell.drive }, P.guard.seconds);
    emit('guard', record);
    if (record.resets) console.log('RESET (blocker)', cell.id, record.resets);
    if ((i + 1) % 120 === 0) console.log('guard', i + 1, '/', guard.length);
  }
  for (const [i, cell] of slew.entries()) {
    const run = render(cell, { bias: P.slew.bias, drive: P.slew.drive }, P.slew.seconds);
    const record = { ...run.record, ...run.slew };
    emit('slew', record);
    console.log('slew', i + 1, '/', slew.length, cell.id, record.resets, 'resets');
  }
}

async function reproduce() {
  writeFileSync(journal, '');
  const started = Date.now(),
    loadBefore = loadavg();
  const child = spawn(
    process.execPath,
    [new URL(import.meta.url).pathname, '--worker', ...(smoke ? ['--smoke', smoke] : [])],
    {
      stdio: 'inherit',
    },
  );
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    child.kill('SIGKILL');
  }, P.budgetMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  const elapsedMs = Date.now() - started;
  const { entries, truncatedTail } = recoverJournal(readFileSync(journal, 'utf8'));
  const run = { expired, exitCode, budgetMs: P.budgetMs, elapsedMs, truncatedTail };
  const report = V.assembleProbe(entries, run, P);
  const probeEnvironment = {
    cpu: cpus()[0].model,
    cores: cpus().length,
    os: release(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    v8: process.versions.v8,
    browser: 'none',
    backend: 'Node Float64: the shipped TapeDsp source (packages/engine/src), bundled by esbuild',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    loadAverage: { before: loadBefore, after: loadavg() },
  };
  V.save(output, { probeEnvironment, ...report });
  if (!smoke) unlinkSync(journal);
  console.log(report.probeRun, report.probeAssertion);
  if (report.probeAssertion.state === 'fails') process.exitCode = 1;
}
if (process.argv.includes('--worker')) await worker();
else await reproduce();
