/* global process, console, setTimeout, clearTimeout */
/** windsor#207: one sequential numerical child under a hard wall-clock bound, one
 * journal line per filter, equivalence point and benchmark round; report assembly
 * afterwards from the journal only. Run from the repo root on Node 24.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, loadavg, release } from 'node:os';
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import { recoverJournal } from '../2026-09-30-tape-conditioning/journal.mjs';
import { assemble } from './evidence.mjs';
const S = await loadSource(`
export * from './docs/research/2026-09-30-tape-resampler/resamplerConstants.ts';
export * from './docs/research/2026-09-30-tape-resampler/response.ts';
export * from './docs/research/2026-09-30-tape-resampler/symmetric.ts';
export { ResampledHysteresis } from './docs/research/2026-09-30-tape-phase-3/resampler.ts';`);
const { RESAMPLER: R, EXPERIMENT: E } = S;
const journal = new URL('./.measurement-journal.ndjson', import.meta.url);
const emit = (kind, value) => appendFileSync(journal, `${JSON.stringify({ kind, value })}\n`);

async function reproduce() {
  writeFileSync(journal, '');
  const started = Date.now(),
    loadBefore = loadavg();
  const child = spawn(process.execPath, [new URL(import.meta.url).pathname, '--worker'], {
    stdio: 'inherit',
  });
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    child.kill('SIGKILL');
  }, R.budgetMs);
  const exitCode = await new Promise((resolve) => child.once('exit', resolve));
  clearTimeout(timer);
  const { entries, truncatedTail } = recoverJournal(readFileSync(journal, 'utf8'));
  const run = { expired, exitCode, elapsedMs: Date.now() - started, truncatedTail };
  const report = {
    environment: {
      cpu: cpus()[0].model,
      os: release(),
      arch: process.arch,
      node: process.version,
      v8: process.versions.v8,
      browser: 'none',
      backend: 'Node Float64 source DSP (esbuild bundle of the research TypeScript)',
      loadAverage: { before: loadBefore, after: loadavg() },
    },
    settings: { resampler: R, experiment: E },
    ...assemble(entries, run, R),
  };
  writeReport(new URL('./measurement.json', import.meta.url), report);
  unlinkSync(journal);
  console.log(report.run, report.missing, report.costTable, report.outcome);
}

/** Phase-3's precomputed benchmark input; the right channel is its negation. */
const benchmarkInput = (frames) =>
  Float64Array.from({ length: frames }, (_, i) =>
    R.benchmark.input.reduce(
      (sum, [amplitude, radians]) => sum + amplitude * Math.sin(i * radians),
      0,
    ),
  );

function instance({ variant, factor, span }) {
  const { identity, symmetric } = S.VARIANTS[variant];
  const Dsp = symmetric ? S.SymmetricResampledHysteresis : S.ResampledHysteresis;
  return new Dsp({ rate: R.rate, factor, span, identity, solver: 'rk4' });
}

/** Phase-3 method: stereo, one warmup round, then rounds alternating cell order. */
function benchmarkGroup(group, input) {
  const cells = group.cells.map((cell) => ({
    ...cell,
    channels: [instance(cell), instance(cell)],
  }));
  for (let round = -1; round < R.benchmark.rounds; round++) {
    const order = round % 2 ? [...cells].reverse() : cells,
      timesMs = {};
    let checksum = 0;
    for (const cell of order) {
      const [left, right] = cell.channels,
        start = performance.now();
      let sum = 0;
      for (let i = 0; i < input.length; i++) {
        sum += left.tick(input[i]);
        sum += right.tick(-input[i]);
      }
      timesMs[cell.id] = performance.now() - start;
      checksum += sum;
    }
    emit('round', { group: group.id, round, order: order.map((c) => c.id), timesMs, checksum });
  }
  console.log('Benchmarked', group.id);
}

function worker() {
  for (const f of S.filters(R)) {
    const start = performance.now(),
      record = S.measureFilter(f, R);
    emit('filter', { ...record, elapsedMs: performance.now() - start });
    console.log('Response', record.id);
  }
  for (const f of S.filters(R)) emit('equivalence', S.compareDecimators(f, R));
  console.log('Equivalence done');
  const input = benchmarkInput(R.rate * R.benchmark.seconds);
  for (const group of S.benchmarkGroups(R)) benchmarkGroup(group, input);
}
if (process.argv.includes('--worker')) worker();
else await reproduce();
