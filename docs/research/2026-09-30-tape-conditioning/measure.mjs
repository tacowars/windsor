/* global process, console, setTimeout, clearTimeout */
/** One sequential child, hard wall-clock limit, append-only evidence until exit. */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import { absolute, summary, refinement, candidate, complete } from './evidence.mjs';
import { recoverJournal } from './journal.mjs';
const S = await loadSource(`
export * from './docs/research/2026-09-30-tape-conditioning/conditioningConstants.ts';
export * from './docs/research/2026-09-30-tape-conditioning/conditioning.ts';
export * from './docs/research/2026-09-30-tape-conditioning/matrix.ts';
export * from './docs/research/2026-09-30-tape-filtered-reference/reconstruction.ts';
export * from './docs/research/2026-09-30-tape-filtered-reference/filteredReference.ts';`);
const { CONDITIONING: K, EXPERIMENT: E, REFERENCE: R, FILTERED: F } = S;
const journal = new URL('./.measurement-journal.ndjson', import.meta.url);
const expected = S.matrix();
const emit = (data) => appendFileSync(journal, `${JSON.stringify(data)}\n`);

async function reproduce() {
  writeFileSync(journal, '');
  const started = Date.now();
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, '--worker'], {
    stdio: 'inherit',
  });
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    child.kill('SIGKILL');
  }, K.budgetMs);
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  clearTimeout(timer);
  const { entries, truncatedTail } = recoverJournal(readFileSync(journal, 'utf8'));
  const groups = entries.filter((e) => e.kind === 'group').map((e) => e.value);
  const finished = new Set(groups.map((g) => g.id));
  const report = {
    environment: {
      cpu: cpus()[0].model,
      os: release(),
      arch: process.arch,
      node: process.version,
      v8: process.versions.v8,
      browser: 'none',
      backend: 'Node Float64 source DSP',
    },
    settings: { conditioning: K, experiment: E, reference: R, filtered: F },
    run: {
      status: 'incomplete',
      expired,
      exitCode,
      elapsedMs: Date.now() - started,
      truncatedTail,
    },
    groups,
    partialTrials: entries.filter((e) => e.kind === 'trial' && !finished.has(e.id)),
    missing: expected.filter((row) => !finished.has(row.id)),
  };
  report.run.status =
    !expired && exitCode === 0 && complete(report, expected) ? 'complete' : 'incomplete';
  writeReport(new URL('./measurement.json', import.meta.url), report);
  unlinkSync(journal);
  console.log(report.run, 'groups', groups.length, 'missing', report.missing.length);
}

function fieldFor(row, fields) {
  const key = row.domain === 'boundary' ? `pulse/${row.level}/${row.history}` : row.bins.join();
  if (!fields.has(key))
    fields.set(
      key,
      row.domain === 'boundary'
        ? S.pulseField(row.level, row.history, K.refinements.at(-1))
        : new S.Field(row.bins, 2 * K.refinements.at(-1)),
    );
  return fields.get(key);
}

// eslint-disable-next-line max-lines-per-function -- One group journals every trajectory before deriving its reference/candidate evidence.
function runGroup(row, field, cache) {
  const options = {
    ...row,
    signal: row,
    frames: row.domain === 'boundary' ? K.boundaryFrames : undefined,
  };
  const previous = row.policy === 'nonnegative' ? cache.get('unchanged') : cache.get('nonnegative');
  const identityMapping = S.configured(row.rate, row.controls, 'unchanged').c >= 0;
  const trials = [...K.refinements.map((factor) => ({ factor, solver: 'rk4' })), ...K.candidates];
  const renders = trials.map(({ factor, solver }, index) => {
    const prior = previous?.renders[index];
    const reuse =
      prior &&
      (row.policy === 'nonnegative'
        ? identityMapping
        : row.policy === 'knee' && prior.finite && !prior.failure && prior.fieldPeak <= K.knee);
    const r = reuse
      ? prior
      : S.renderConditioned({ ...options, factor, solver, field: S.subgrid(field, factor) });
    emit({
      kind: 'trial',
      id: row.id,
      factor,
      solver,
      reusedFrom: reuse ? previous.id : null,
      state: summary(r, row, 'output'),
    });
    return { ...r, reusedFrom: reuse ? previous.id : null };
  });
  const refs = renders.slice(0, K.refinements.length);
  const references = Object.fromEntries(
    ['raw', 'output'].map((key) => [key, refinement(refs, row, key)]),
  );
  const candidates = K.candidates.map((setting, index) => ({
    ...setting,
    ...candidate(renders[K.refinements.length + index], refs.at(-1), row, references),
  }));
  const group = { ...row, references, candidates };
  if (row.domain === 'center') {
    const setting = K.candidates[1];
    const baseline =
      previous?.baseline ??
      S.render({ ...options, ...setting, field: S.subgrid(field, setting.factor) });
    const actual = renders[K.refinements.length + 1];
    group.centerRegression = {
      solver: setting.solver,
      factor: setting.factor,
      identity: actual.conditionedStages === 0,
      rawMaximumDifference: absolute(actual, baseline, 'raw'),
      outputMaximumDifference: absolute(actual, baseline, 'output'),
    };
    cache.set(row.policy, { id: row.id, renders, baseline });
  } else cache.set(row.policy, { id: row.id, renders });
  if (row.domain === 'boundary')
    group.inputPoints = K.boundaryTimes.map((t) => ({
      t,
      sample: S.pulseInput(row.level, row.history)(t),
      reconstructed: field.at(t * field.grid),
    }));
  emit({ kind: 'group', value: group });
}

function worker() {
  const fields = new Map();
  let last = '',
    cache = new Map();
  for (const [i, row] of expected.entries()) {
    const key = row.id.slice(0, row.id.lastIndexOf('/'));
    if (key !== last) {
      cache = new Map();
      last = key;
    }
    runGroup(row, fieldFor(row, fields), cache);
    if ((i + 1) % K.policies.length === 0)
      console.log('Completed', i + 1, '/', expected.length, key);
  }
}
if (process.argv.includes('--worker')) worker();
else await reproduce();
