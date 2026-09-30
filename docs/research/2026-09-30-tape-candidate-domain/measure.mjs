/* global process, console, setTimeout, clearTimeout */
/** Single 900-second numerical child for windsor#197. renderConditioned, the
 * loader, report writer and journal recovery run unchanged; rulers are read only.
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
export * from './docs/research/2026-09-30-tape-candidate-domain/candidateConstants.ts';
export * from './docs/research/2026-09-30-tape-conditioning/conditioning.ts';
export { Hysteresis } from './docs/research/2026-09-30-tape-phase-3/hysteresis.ts';`);
const O = S.CANDIDATE,
  rows = S.schedule(O);
const journal = new URL('./.measurement-journal.ndjson', import.meta.url);
const emit = (kind, value) => appendFileSync(journal, `${JSON.stringify({ kind, value })}\n`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
function readRuler(path) {
  const bytes = readFileSync(new URL(path, import.meta.url));
  return { sha256: sha256(bytes), report: JSON.parse(bytes.toString('utf8')) };
}
function worker() {
  const rulers = new Map(O.rulers.map((r) => [r.path, readRuler(r.path)]));
  emit(
    'anchor',
    V.anchors((path) => rulers.get(path), O),
  );
  const observer = V.observe(S.Hysteresis),
    fields = new Map();
  for (const [i, row] of rows.entries()) {
    if (!fields.has(row.level))
      fields.set(row.level, S.pulseField(row.level, O.history, O.factors.at(-1)));
    const t = V.renderCandidate(S, { row, field: fields.get(row.level), observer }, O);
    if (row.part === 'accuracy') {
      const ruler = V.rulerFor(row, O);
      t.errors = V.accuracy(t, V.rulerRow(rulers.get(ruler.path).report, row, ruler), O);
    }
    emit('trial', t);
    console.log('Completed', i + 1, '/', rows.length, row.part, row.id, V.key(t));
  }
}
function sourceHashes() {
  const paths = [
    'candidateConstants.ts',
    'evidence.mjs',
    'measure.mjs',
    '../2026-09-30-tape-boundary-reference/boundaryConstants.ts',
    '../2026-09-30-tape-conditioning/conditioning.ts',
    '../2026-09-30-tape-conditioning/conditioningConstants.ts',
    '../2026-09-30-tape-filtered-reference/reconstruction.ts',
    '../2026-09-30-tape-filtered-reference/filteredReference.ts',
    '../2026-09-30-tape-phase-3/hysteresis.ts',
    '../2026-09-30-tape-phase-3/experimentConstants.ts',
  ];
  return Object.fromEntries(
    paths.map((path) => [path, sha256(readFileSync(new URL(path, import.meta.url)))]),
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
  }, O.budgetMs);
  const exitCode = await new Promise((resolve, reject) => {
    child.once('exit', resolve);
    child.once('error', reject);
  });
  clearTimeout(timer);
  const elapsedMs = Date.now() - started;
  const { entries, truncatedTail } = recoverJournal(readFileSync(journal, 'utf8'));
  const assembled = V.assemble(entries, { expired, exitCode, elapsedMs, truncatedTail }, O);
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
    settings: { candidate: O, conditioning: S.CONDITIONING, core: S.CORE },
    sources: sourceHashes(),
    outcome: V.interpret(assembled, O),
    ...assembled,
  };
  writeReport(new URL('./measurement.json', import.meta.url), report);
  unlinkSync(journal);
  console.log(report.run, JSON.stringify(report.outcome));
}
if (process.argv.includes('--worker')) worker();
else await reproduce();
