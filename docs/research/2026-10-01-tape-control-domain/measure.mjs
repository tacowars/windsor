/* global process, console, setTimeout, clearTimeout */
/** windsor#290 runner. Part A renders the width axis and fixes wMax by the declared rule;
 * part B renders every static point, sweep and walk in the box it implies. Each part runs
 * in `CONTROL.workers` child processes, one journal each, under one hard wall-clock bound
 * from the start: at the bound every child is killed and the report is assembled from the
 * journals alone. Run from the repo root on Node 24, with nothing else heavy:
 *   node docs/research/2026-10-01-tape-control-domain/measure.mjs
 * `--smoke <path>` runs two trials of each part per worker into <path>, not the measurement.
 */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { cpus, loadavg, release } from 'node:os';
import { URL } from 'node:url';
import * as V from './evidence.mjs';

const args = process.argv;
const smokeAt = args.indexOf('--smoke'),
  smoke = smokeAt < 0 ? null : args[smokeAt + 1];
const journal = (part, i) =>
  smoke
    ? `${smoke}.journal-${part}-${i}.ndjson`
    : new URL(`./.journal-${part}-${i}.ndjson`, import.meta.url).pathname;

/** The part's trials in cost order (rate x factor, highest first), dealt round-robin. */
function share(trials, worker, workers) {
  const cost = (t) => t.rate * t.factor;
  const sorted = trials
    .map((t, i) => ({ t, i }))
    .sort((a, b) => cost(b.t) - cost(a.t) || a.i - b.i)
    .map(({ t }) => t);
  const mine = sorted.filter((_, k) => k % workers === worker);
  if (!smoke) return mine;
  return ['static', 'sweep', 'walk', 'width'].flatMap((p) =>
    mine.filter((t) => t.part === p).slice(0, 2),
  );
}

async function worker() {
  const at = args.indexOf('--worker');
  const [part, index, workers, wMax] = args.slice(at + 1, at + 5);
  const S = await V.loadProgram();
  const trials = part === 'A' ? S.widthTrials() : S.boxTrials(Number(wMax));
  const path = journal(part, index);
  for (const trial of share(trials, Number(index), Number(workers))) {
    const record = S.runTrial(trial, Number(wMax));
    appendFileSync(path, `${JSON.stringify(record)}\n`);
    if (record.resets || record.nonfinite) console.log('FAIL', record.id);
  }
}

/** A killed writer may leave one partial final line; keep its bytes as evidence. */
function recover(path) {
  const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const end = text.lastIndexOf('\n');
  const entries = text
    .slice(0, end + 1)
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { entries, truncatedTail: text.slice(end + 1) || null };
}

/** One part: every worker spawned at once, each journal recovered after they exit. */
async function runPart(part, wMax, state) {
  const workers = state.table.workers,
    paths = [];
  const exits = [];
  for (let i = 0; i < workers; i++) {
    paths.push(journal(part, i));
    writeFileSync(paths[i], '');
    const child = spawn(
      process.execPath,
      [
        new URL(import.meta.url).pathname,
        '--worker',
        part,
        String(i),
        String(workers),
        String(wMax),
        ...(smoke ? ['--smoke', smoke] : []),
      ],
      { stdio: 'inherit' },
    );
    state.children.add(child);
    exits.push(
      new Promise((resolve, reject) => {
        child.once('exit', (code) => (state.children.delete(child), resolve(code)));
        child.once('error', reject);
      }),
    );
  }
  const codes = await Promise.all(exits);
  const recovered = paths.map(recover);
  if (!smoke) paths.forEach((p) => unlinkSync(p));
  return {
    exitCodes: codes,
    trials: recovered.flatMap((r) => r.entries),
    truncatedTails: recovered.map((r) => r.truncatedTail).filter(Boolean),
  };
}

async function reproduce() {
  const started = Date.now(),
    loadBefore = loadavg();
  const S = await V.loadProgram();
  const state = { table: S.CONTROL, children: new Set(), expired: false };
  const timer = setTimeout(() => {
    state.expired = true;
    for (const child of state.children) child.kill('SIGKILL');
  }, S.CONTROL.budgetMs);
  const grid = V.widthGrid(S);
  const a = await runPart('A', 1, state);
  const rule = V.widthRule(grid, a.trials, S);
  const b = state.expired
    ? { exitCodes: [], trials: [], truncatedTails: [] }
    : await runPart('B', rule.wMax, state);
  clearTimeout(timer);
  const exitCodes = [...a.exitCodes, ...b.exitCodes];
  const truncatedTails = [...a.truncatedTails, ...b.truncatedTails];
  const clean = !state.expired && exitCodes.every((c) => c === 0) && !truncatedTails.length;
  const run = {
    status: clean ? 'complete' : 'incomplete',
    expired: state.expired,
    exitCodes,
    truncatedTails,
    budgetMs: S.CONTROL.budgetMs,
    workers: S.CONTROL.workers,
    elapsedMs: Date.now() - started,
  };
  const trials = [...a.trials, ...b.trials];
  const environment = {
    cpu: cpus()[0].model,
    cores: cpus().length,
    os: release(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    v8: process.versions.v8,
    browser: 'none',
    backend:
      'Node Float64: the shipped TapeMagneticStage source (packages/engine/src), bundled by esbuild',
    commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
    loadAverage: { before: loadBefore, after: loadavg() },
  };
  const closure = V.importClosure();
  const derived = V.derive(trials, grid, run, S);
  const output = smoke ?? V.report.pathname;
  V.writeReport(output, { environment, run, closure, settings: S.CONTROL, derived, grid, trials });
  console.log(
    JSON.stringify({
      run,
      wMax: rule.wMax,
      binding: rule.binding,
      total: derived.total,
      status: derived.status,
    }),
  );
  if (!V.closureClean(closure) || derived.failures.length) process.exitCode = 1;
}

if (args.includes('--worker')) await worker();
else await reproduce();
