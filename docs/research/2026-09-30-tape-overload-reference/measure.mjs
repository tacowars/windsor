/* global process, console, setTimeout, clearTimeout */
/** Single 900-second numerical child for windsor#188; #183's renderer,
 * evidence, journal recovery and report writer run unchanged on OVERLOAD.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import { recoverJournal } from '../2026-09-30-tape-conditioning/journal.mjs';
import { trial, compare, assemble } from '../2026-09-30-tape-boundary-reference/evidence.mjs';
import { located, anchorCheck, interpret } from './evidence.mjs';
const S = await loadSource(`
export * from './docs/research/2026-09-30-tape-overload-reference/overloadConstants.ts';
export * from './docs/research/2026-09-30-tape-boundary-reference/boundaryReference.ts';
export * from './docs/research/2026-09-30-tape-conditioning/conditioning.ts';`);
const O = S.OVERLOAD,
  rows = S.cases(O);
const journal = new URL('./.measurement-journal.ndjson', import.meta.url);
const anchorURL = new URL(
  '../2026-09-30-tape-boundary-reference/measurement.json',
  import.meta.url,
);
const emit = (kind, value) => appendFileSync(journal, `${JSON.stringify({ kind, value })}\n`);
function worker() {
  const fields = new Map(),
    previous = new Map(),
    trials = [];
  for (const factor of O.levels) {
    for (const row of rows) {
      if (!fields.has(row.id)) fields.set(row.id, S.pulseField(row.level, 0, O.levels.at(-1)));
      const field = S.subgrid(fields.get(row.id), factor);
      const r = S.renderBoundary({ row, factor, field }, O);
      const t = trial(row, factor, r);
      emit('trial', t);
      trials.push(t);
      if (previous.has(row.id)) {
        const before = previous.get(row.id);
        emit('pair', { ...compare(before, t, O), maxima: located(before, t, O) });
      }
      previous.set(row.id, t);
      console.log(
        'Completed',
        trials.length,
        '/',
        rows.length * O.levels.length,
        row.level,
        factor,
      );
    }
    if (factor === O.anchor.factor)
      emit('baseline', anchorCheck(trials, JSON.parse(readFileSync(anchorURL, 'utf8'))));
  }
}
function sourceHashes() {
  const paths = [
    'overloadConstants.ts',
    'evidence.mjs',
    'measure.mjs',
    '../2026-09-30-tape-boundary-reference/boundaryConstants.ts',
    '../2026-09-30-tape-boundary-reference/boundaryReference.ts',
    '../2026-09-30-tape-boundary-reference/diagnostics.ts',
    '../2026-09-30-tape-boundary-reference/evidence.mjs',
    '../2026-09-30-tape-conditioning/conditioning.ts',
    '../2026-09-30-tape-filtered-reference/reconstruction.ts',
    '../2026-09-30-tape-filtered-reference/filteredReference.ts',
    '../2026-09-30-tape-phase-3/hysteresis.ts',
  ];
  const hash = (path) =>
    createHash('sha256')
      .update(readFileSync(new URL(path, import.meta.url)))
      .digest('hex');
  return Object.fromEntries(paths.map((path) => [path, hash(path)]));
}
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
  }, O.budgetMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  const elapsedMs = Date.now() - started;
  const { entries, truncatedTail } = recoverJournal(readFileSync(journal, 'utf8'));
  const assembled = assemble(entries, { expired, exitCode, elapsedMs, truncatedTail }, O);
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
    settings: { overload: O, conditioning: S.CONDITIONING, core: S.CORE },
    sources: sourceHashes(),
    anchorSha256: createHash('sha256').update(readFileSync(anchorURL)).digest('hex'),
    outcome: interpret(assembled),
    ...assembled,
  };
  writeReport(new URL('./measurement.json', import.meta.url), report);
  unlinkSync(journal);
  console.log(report.run, report.outcome);
}
if (process.argv.includes('--worker')) worker();
else await reproduce();
