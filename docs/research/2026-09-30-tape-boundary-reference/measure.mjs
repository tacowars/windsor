/* global process, console, setTimeout, clearTimeout */
/** Single 900-second numerical child; no numerical work after journal recovery. */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import { recoverJournal } from '../2026-09-30-tape-conditioning/journal.mjs';
import { trial, compare, baselineCheck, assemble } from './evidence.mjs';
const S = await loadSource(`
export * from './docs/research/2026-09-30-tape-boundary-reference/boundaryConstants.ts';
export * from './docs/research/2026-09-30-tape-boundary-reference/boundaryReference.ts';
export * from './docs/research/2026-09-30-tape-conditioning/conditioning.ts';`);
const B = S.BOUNDARY,
  rows = S.cases();
const journal = new URL('./.measurement-journal.ndjson', import.meta.url);
const baselineURL = new URL('../2026-09-30-tape-conditioning/measurement.json', import.meta.url);
const emit = (kind, value) => appendFileSync(journal, `${JSON.stringify({ kind, value })}\n`);
function worker() {
  const fields = new Map(),
    previous = new Map(),
    trials = [],
    pairs = [];
  for (const factor of B.levels) {
    for (const row of rows) {
      if (!fields.has(row.id)) fields.set(row.id, S.pulseField(row.level, 0, B.levels.at(-1)));
      const field = S.subgrid(fields.get(row.id), factor);
      const r = S.renderBoundary({ row, factor, field });
      const t = trial(row, factor, r);
      emit('trial', t);
      trials.push(t);
      if (previous.has(row.id)) {
        const p = compare(previous.get(row.id), t);
        emit('pair', p);
        pairs.push(p);
      }
      previous.set(row.id, t);
      console.log(
        'Completed',
        trials.length,
        '/',
        rows.length * B.levels.length,
        row.level,
        factor,
        r.failure ?? 'finite',
      );
    }
  }
  emit('baseline', baselineCheck(trials, pairs, JSON.parse(readFileSync(baselineURL, 'utf8'))));
}
function sourceHashes() {
  const paths = [
    'boundaryConstants.ts',
    'boundaryReference.ts',
    'diagnostics.ts',
    'evidence.mjs',
    'measure.mjs',
    '../2026-09-30-tape-conditioning/conditioning.ts',
    '../2026-09-30-tape-filtered-reference/reconstruction.ts',
    '../2026-09-30-tape-filtered-reference/filteredReference.ts',
    '../2026-09-30-tape-phase-3/hysteresis.ts',
  ];
  return Object.fromEntries(
    paths.map((path) => [
      path,
      createHash('sha256')
        .update(readFileSync(new URL(path, import.meta.url)))
        .digest('hex'),
    ]),
  );
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
  }, B.budgetMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  const elapsedMs = Date.now() - started;
  const { entries, truncatedTail } = recoverJournal(readFileSync(journal, 'utf8'));
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
    settings: { boundary: B, conditioning: S.CONDITIONING, core: S.CORE },
    sources: sourceHashes(),
    baselineSha256: createHash('sha256').update(readFileSync(baselineURL)).digest('hex'),
    ...assemble(entries, { expired, exitCode, elapsedMs, truncatedTail }),
  };
  writeReport(new URL('./measurement.json', import.meta.url), report);
  unlinkSync(journal);
  console.log(
    report.run,
    report.groups.map((g) => ({ level: g.level, qualified: g.qualified })),
  );
}
if (process.argv.includes('--worker')) worker();
else await reproduce();
