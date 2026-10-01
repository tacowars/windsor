/* global process, console, setTimeout, clearTimeout */
/** windsor#295 and windsor#315 runner. By default it runs windsor#295's experiment: the
 * width-edge trials, then each raised box in the ladder's order. `--rows` runs windsor#315's:
 * each candidate box that holds every shipped model row, in order. Either stops at the first
 * box in which every trial survives. Each set runs in the table's `workers` child processes,
 * one journal each, under one hard wall-clock bound from the start: at the bound every child
 * is killed and the report is assembled from the journals alone. The exit code is nonzero
 * unless the run is complete and a box qualified (`exitCode` in evidence.mjs). Run from the
 * repo root on Node 24:
 *   node docs/research/2026-10-01-tape-control-domain-2x/measure.mjs [--rows]
 * `--smoke <path>` runs two trials of each part per worker into <path>, not the measurement.
 */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { basename } from 'node:path';
import { cpus, loadavg, release } from 'node:os';
import { URL } from 'node:url';
import * as V from './evidence.mjs';
import * as R from './rowsEvidence.mjs';

const args = process.argv;
const rows = args.includes('--rows');
const E = rows ? R.experiment : V.experiment;
const smokeAt = args.indexOf('--smoke'),
  smoke = smokeAt < 0 ? null : args[smokeAt + 1];
const journal = (set, i) => {
  const name = `.journal-${set.replaceAll('/', '-')}-${i}.ndjson`;
  return smoke ? `${smoke}${name}` : new URL(`./${name}`, import.meta.url).pathname;
};

/** The set's trials in cost order (rate x factor, highest first), dealt round-robin. */
function share(trials, worker, workers) {
  const cost = (t) => t.rate * t.factor;
  const sorted = trials
    .map((t, i) => ({ t, i }))
    .sort((a, b) => cost(b.t) - cost(a.t) || a.i - b.i)
    .map(({ t }) => t);
  const mine = sorted.filter((_, k) => k % workers === worker);
  if (!smoke) return mine;
  return ['static', 'sweep', 'walk'].flatMap((p) => mine.filter((t) => t.part === p).slice(0, 2));
}

async function worker() {
  const at = args.indexOf('--worker');
  const [set, index, workers] = args.slice(at + 1, at + 4);
  const S = await V.loadProgram(E.entry);
  const path = journal(set, index);
  for (const trial of share(E.trialsOf(S, set), Number(index), Number(workers))) {
    const record = S.runTrial(trial, trial.box);
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

/** One set: every worker spawned at once, each journal recovered after they exit. */
async function runSet(set, state) {
  const workers = state.table.workers,
    paths = [],
    exits = [];
  const started = Date.now();
  for (let i = 0; i < workers; i++) {
    paths.push(journal(set, i));
    writeFileSync(paths[i], '');
    const child = spawn(
      process.execPath,
      [
        new URL(import.meta.url).pathname,
        ...['--worker', set, String(i), String(workers)],
        ...(rows ? ['--rows'] : []),
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
  const trials = recovered.flatMap((r) => r.entries);
  console.log(JSON.stringify({ set, trials: trials.length, elapsedMs: Date.now() - started }));
  return {
    set,
    exitCodes: codes,
    trials,
    truncatedTails: recovered.map((r) => r.truncatedTail).filter(Boolean),
    elapsedMs: Date.now() - started,
  };
}

const empty = (set) => ({ set, exitCodes: [], trials: [], truncatedTails: [], elapsedMs: 0 });

/** The experiment's fixed sets, then its ladder up to the first box that survives whole. */
async function runSets(S, state) {
  const sets = [];
  for (const set of E.fixed(S)) sets.push(state.expired ? empty(set) : await runSet(set, state));
  for (const set of E.ladder(S)) {
    const result = state.expired ? empty(set) : await runSet(set, state);
    sets.push(result);
    if (!state.expired && result.trials.length && result.trials.every(V.survives)) break;
  }
  return sets;
}

async function reproduce() {
  const started = Date.now(),
    loadBefore = loadavg();
  const S = await V.loadProgram(E.entry);
  const table = E.table(S);
  const state = { table, children: new Set(), expired: false };
  const timer = setTimeout(() => {
    state.expired = true;
    for (const child of state.children) child.kill('SIGKILL');
  }, table.budgetMs);
  const sets = await runSets(S, state);
  clearTimeout(timer);
  const exitCodes = sets.flatMap((s) => s.exitCodes);
  const truncatedTails = sets.flatMap((s) => s.truncatedTails);
  const clean =
    !state.expired &&
    exitCodes.length > 0 &&
    exitCodes.every((c) => c === 0) &&
    !truncatedTails.length;
  const run = {
    status: clean ? 'complete' : 'incomplete',
    expired: state.expired,
    sets: sets.map(({ set, trials, elapsedMs }) => ({ set, trials: trials.length, elapsedMs })),
    exitCodes,
    truncatedTails,
    budgetMs: table.budgetMs,
    workers: table.workers,
    elapsedMs: Date.now() - started,
  };
  const trials = sets.flatMap((s) => s.trials);
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
  const closure = V.importClosure(E.entry);
  const derived = E.derive(trials, run, S);
  const output = smoke ? `${smoke}${basename(E.report.pathname)}` : E.report.pathname;
  V.writeReport(output, { environment, run, closure, settings: E.settings(S), derived, trials });
  console.log(JSON.stringify({ run, status: derived.status, declaration: derived.declaration }));
  const closureOk = V.closureClean(closure);
  process.exitCode = V.exitCode({ run, derived, closureOk, smoke: Boolean(smoke) });
}

if (args.includes('--worker')) await worker();
else await reproduce();
