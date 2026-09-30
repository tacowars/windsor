/* global process, console, setTimeout, clearTimeout */
/** Single 900-second numerical child for windsor#204. renderConditioned, the stage
 * arithmetic, loader, report writer and journal recovery run unchanged.
 */
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { createHash } from 'node:crypto';
import { relative } from 'node:path';
import { URL } from 'node:url';
import { loadSource } from '../2026-09-30-tape-phase-3/load.mjs';
import { writeReport } from '../2026-09-30-tape-phase-3/report.mjs';
import { recoverJournal } from '../2026-09-30-tape-conditioning/journal.mjs';
import * as V from './evidence.mjs';
const S = await loadSource(`
export * from './docs/research/2026-09-30-tape-dynamic-survival/dynamicConstants.ts';
export * from './docs/research/2026-09-30-tape-dynamic-survival/program.ts';
export * from './docs/research/2026-09-30-tape-conditioning/conditioning.ts';
export { Hysteresis } from './docs/research/2026-09-30-tape-phase-3/hysteresis.ts';`);
const O = S.DYNAMIC,
  rows = S.schedule(O);
const journal = new URL('./.measurement-journal.ndjson', import.meta.url);
const emit = (kind, value) => appendFileSync(journal, `${JSON.stringify({ kind, value })}\n`);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function worker() {
  const observer = V.observe(S.Hysteresis),
    fields = new Map(),
    references = new Map();
  const finest = Math.max(...O.settings.map((s) => s.factor));
  for (const [i, row] of rows.entries()) {
    let t;
    if (row.part === 'static') {
      if (!fields.has(row.level)) fields.set(row.level, S.pulseField(row.level, O.history, finest));
      t = V.renderStatic(S, { row, field: fields.get(row.level), observer }, O);
    } else {
      const reference = references.get(row.rate) ?? null;
      const { record, trace } = V.renderDynamic(S, { row, observer, reference }, O);
      if (!reference) references.set(row.rate, trace);
      t = record;
    }
    emit('trial', t);
    const lost = t.segments?.find((s) => !V.segmentSurvives(s))?.name ?? '';
    console.log('Completed', i + 1, '/', rows.length, V.key(t), lost);
  }
}

/** Every local file measure.mjs reaches, keyed relative to this folder. */
export function importClosure() {
  const root = new URL('../../../', import.meta.url),
    base = new URL('./', import.meta.url);
  const pattern = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  const found = new Set(),
    queue = [new URL('measure.mjs', base)];
  while (queue.length) {
    const url = queue.pop();
    if (found.has(url.href)) continue;
    found.add(url.href);
    for (const [, spec] of readFileSync(url, 'utf8').matchAll(pattern)) {
      const bare = new URL(spec, spec.startsWith('./docs/') ? root : url);
      const next = existsSync(bare) ? bare : new URL(`${bare.href}.ts`);
      if (!existsSync(next)) throw new Error(`Unresolved import ${spec} in ${url.pathname}`);
      queue.push(next);
    }
  }
  return [...found].map((href) => relative(base.pathname, new URL(href).pathname)).sort();
}
const sources = () =>
  Object.fromEntries(
    importClosure().map((path) => [path, sha256(readFileSync(new URL(path, import.meta.url)))]),
  );

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
    settings: { dynamic: O, conditioning: S.CONDITIONING, core: S.CORE },
    sources: sources(),
    outcome: V.interpret(assembled, O),
    ...assembled,
  };
  writeReport(new URL('./measurement.json', import.meta.url), report);
  unlinkSync(journal);
  console.log(report.run, JSON.stringify(report.outcome.declaration));
}
if (process.argv.includes('--worker')) worker();
else if (process.argv[1] === new URL(import.meta.url).pathname) await reproduce();
