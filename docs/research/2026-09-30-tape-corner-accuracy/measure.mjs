/* global process, console, setTimeout, clearTimeout */
/** Single 900-second numerical child for windsor#215. renderConditioned, Field, subgrid,
 * the loader, report writer and journal recovery run unchanged. Each reference case and
 * each candidate render is journaled on completion; assembly does no numerical work.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import { recoverJournal } from '../2026-09-30-tape-conditioning/journal.mjs';
import * as V from './evidence.mjs';
const S = await loadSource(`
export * from './docs/research/2026-09-30-tape-corner-accuracy/cornerConstants.ts';
export * from './docs/research/2026-09-30-tape-corner-accuracy/render.ts';
export { renderConditioned, subgrid } from './docs/research/2026-09-30-tape-conditioning/conditioning.ts';
export { Field } from './docs/research/2026-09-30-tape-filtered-reference/reconstruction.ts';`);
const T = S.CORNER;
const journal = new URL('./.measurement-journal.ndjson', import.meta.url);
const emit = (kind, value) => appendFileSync(journal, `${JSON.stringify({ kind, value })}\n`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const SOURCES = [
  'cornerConstants.ts',
  'render.ts',
  'evidence.mjs',
  'measure.mjs',
  '../2026-09-30-tape-conditioning/conditioning.ts',
  '../2026-09-30-tape-conditioning/evidence.mjs',
  '../2026-09-30-tape-conditioning/journal.mjs',
  '../2026-09-30-tape-dynamic-survival/program.ts',
  '../2026-09-30-tape-filtered-reference/evidence.mjs',
  '../2026-09-30-tape-filtered-reference/filteredReference.ts',
  '../2026-09-30-tape-filtered-reference/reconstruction.ts',
  '../2026-09-30-tape-phase-3/hysteresis.ts',
  '../2026-09-30-tape-phase-3/resampler.ts',
  '../2026-09-30-tape-phase-3/spectra.mjs',
  '../2026-09-30-tape-reference/diagnostics.ts',
  '../2026-09-30-tape-reference/reference.ts',
  '../2026-09-30-tape-resampler/symmetric.ts',
];

/** Fields per signal and span: the imported span-32 Field on the finest reference grid
 * (reference and span-32 candidates), the other span on the candidate grid. */
function fields(bins, cache) {
  const key = bins.join('+');
  if (!cache.has(key)) {
    const spans = new Set(T.settings.map((s) => s.span));
    const entries = [...spans].map((span) => [
      span,
      span === T.referenceSpan
        ? new S.Field(bins, 2 * T.refinements.at(-1))
        : S.spanField(bins, T.candidateGrid, span),
    ]);
    cache.set(key, Object.fromEntries(entries));
  }
  return cache.get(key);
}

function worker() {
  const cache = new Map();
  const rows = S.cases(T);
  for (const [i, row] of rows.entries()) {
    const f = fields(row.bins, cache);
    const base = { rate: T.rate, signal: row, controls: row.controls, policy: T.policy };
    const refs = T.refinements.map((factor) =>
      S.renderConditioned({ ...base, factor, field: S.subgrid(f[T.referenceSpan], factor) }),
    );
    const ref = V.reference(refs, row);
    emit('reference', ref);
    for (const setting of T.settings) {
      const actual = S.renderCandidate({
        setting,
        signal: row,
        controls: row.controls,
        field: S.subgrid(f[setting.span], setting.factor),
      });
      emit('candidate', V.candidate(actual, refs.at(-1), row, ref, setting));
    }
    console.log(
      'Completed',
      i + 1,
      '/',
      rows.length,
      row.id,
      ref.qualified ? 'qualified' : 'UNQUALIFIED',
    );
  }
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
  }, T.budgetMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  const elapsedMs = Date.now() - started;
  const { entries, truncatedTail } = recoverJournal(readFileSync(journal, 'utf8'));
  const assembled = V.assemble(entries, { expired, exitCode, elapsedMs, truncatedTail }, T);
  const report = {
    environment: {
      cpu: cpus()[0].model,
      cores: cpus().length,
      os: release(),
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      v8: process.versions.v8,
      browser: 'none',
      backend: 'Node Float64 source DSP',
    },
    settings: {
      corner: T,
      reference: S.REFERENCE,
      filtered: S.FILTERED,
      knee: { knee: S.CONDITIONING.knee, asymptote: S.CONDITIONING.asymptote },
    },
    sources: Object.fromEntries(
      SOURCES.map((path) => [path, sha256(readFileSync(new URL(path, import.meta.url)))]),
    ),
    ...assembled,
  };
  writeReport(new URL('./measurement.json', import.meta.url), report);
  unlinkSync(journal);
  console.log(report.run, report.counts, report.outcome.statement);
}
if (process.argv.includes('--worker')) worker();
else await reproduce();
