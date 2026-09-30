/* global process, console, setTimeout, clearTimeout */
/** Single 900-second numerical child for windsor#192. #188's saved 8192x rows
 * are the ruler; #183's trial record, #167's journal recovery and the phase-3
 * loader and report writer are reused unchanged.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { createHash } from 'node:crypto';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import { recoverJournal } from '../2026-09-30-tape-conditioning/journal.mjs';
import { trial } from '../2026-09-30-tape-boundary-reference/evidence.mjs';
import { ruler, rulerRow, anchor, errors, assemble } from './evidence.mjs';
const S = await loadSource(`
export * from './docs/research/2026-09-30-tape-event-alignment/eventConstants.ts';
export * from './docs/research/2026-09-30-tape-event-alignment/eventAlignment.ts';
export * from './docs/research/2026-09-30-tape-conditioning/conditioning.ts';`);
const E = S.EVENTS,
  rows = S.cases(E);
const journal = new URL('./.measurement-journal.ndjson', import.meta.url);
const rulerURL = new URL('../2026-09-30-tape-overload-reference/measurement.json', import.meta.url);
const emit = (kind, value) => appendFileSync(journal, `${JSON.stringify({ kind, value })}\n`);
const sha = (url) => createHash('sha256').update(readFileSync(url)).digest('hex');
const tally = (events) =>
  Object.fromEntries(E.kinds.map((k) => [k, events.filter((e) => e.kind === k).length]));

function worker() {
  const saved = JSON.parse(readFileSync(rulerURL, 'utf8'));
  emit('ruler', ruler(saved, sha(rulerURL)));
  const fields = new Map(),
    trials = [];
  for (const factor of E.levels) {
    for (const row of rows) {
      if (!fields.has(row.id)) fields.set(row.id, S.pulseField(row.level, 0, E.levels.at(-1)));
      const field = S.subgrid(fields.get(row.id), factor);
      const located = S.locate({ field, input: S.pulseInput(row.level, 0), factor });
      const { splits, merged, atNode, inserted } = S.insertions(located, factor);
      const counts = tally(located);
      emit('events', { id: row.id, factor, counts, merged, atNode, inserted, events: located });
      for (const method of E.methods) {
        const r = S.renderAligned({
          row,
          factor,
          field,
          splits: method === 'aligned' ? splits : undefined,
        });
        const base = { ...trial(row, factor, r), method };
        const t = { ...base, errors: errors(base, rulerRow(saved, row.id)) };
        emit('trial', t);
        trials.push(t);
        console.log('Completed', trials.length, row.level, factor, method);
      }
    }
    if (factor === E.anchor.factor) emit('anchor', anchor(trials, saved));
  }
}
function sourceHashes() {
  const paths = [
    'eventConstants.ts',
    'eventAlignment.ts',
    'evidence.mjs',
    'measure.mjs',
    '../2026-09-30-tape-overload-reference/overloadConstants.ts',
    '../2026-09-30-tape-boundary-reference/boundaryConstants.ts',
    '../2026-09-30-tape-boundary-reference/boundaryReference.ts',
    '../2026-09-30-tape-boundary-reference/diagnostics.ts',
    '../2026-09-30-tape-boundary-reference/evidence.mjs',
    '../2026-09-30-tape-conditioning/conditioning.ts',
    '../2026-09-30-tape-filtered-reference/reconstruction.ts',
    '../2026-09-30-tape-filtered-reference/filteredReference.ts',
    '../2026-09-30-tape-phase-3/hysteresis.ts',
  ];
  return Object.fromEntries(paths.map((path) => [path, sha(new URL(path, import.meta.url))]));
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
  }, E.budgetMs);
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
    settings: { events: E, conditioning: S.CONDITIONING, core: S.CORE },
    sources: sourceHashes(),
    ...assemble(entries, { expired, exitCode, elapsedMs, truncatedTail }, E),
  };
  writeReport(new URL('./measurement.json', import.meta.url), report);
  unlinkSync(journal);
  console.log(report.run, report.outcome.outcome, report.outcome.gates);
}
if (process.argv.includes('--worker')) worker();
else await reproduce();
