/* global process, console */
/** windsor#295 evidence: the width-edge table, each raised box's gates, the ladder's stopping
 * point and the declaration, all derived from saved raw trial records; and `--check`, which
 * re-derives them from measurement.json, re-hashes the import closure, re-renders the spot
 * trials and tests the runner's exit gate (windsor#315). Run from anywhere on Node 24:
 *   node docs/research/2026-10-01-tape-control-domain-2x/evidence.mjs --check
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import {
  summarise,
  survives,
  segmentPeaks,
  loudest,
  writeReport,
} from '../2026-10-01-tape-control-domain/evidence.mjs';

export { survives, writeReport };
const root = new URL('../../../', import.meta.url);
const folder = 'docs/research/2026-10-01-tape-control-domain-2x/';
const harness = 'docs/research/2026-10-01-tape-control-domain/';
export const report = new URL('./measurement.json', import.meta.url);

/** A TypeScript entry in this folder (windsor#295's `boxProgram.ts` by default), bundled by
 * esbuild with windsor#290's harness and the shipped engine sources. */
export async function loadProgram(entry = 'boxProgram.ts') {
  const result = await build({
    entryPoints: [new URL(`./${entry}`, import.meta.url).pathname],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: 'esnext',
  });
  const module = { exports: {} };
  new Function('module', 'exports', result.outputFiles[0].text)(module, module.exports);
  return module.exports;
}

/** Every file the entry reaches by relative import, repo-relative, with its SHA-256. */
export function importClosure(entry = 'boxProgram.ts') {
  const pattern = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  const seen = new Set(),
    queue = [new URL(`${folder}${entry}`, root)];
  while (queue.length) {
    const url = queue.pop();
    const path = url.pathname.slice(root.pathname.length);
    if (seen.has(path)) continue;
    seen.add(path);
    for (const [, spec] of readFileSync(url, 'utf8').matchAll(pattern)) {
      const next = [`${spec}.ts`, spec, `${spec}/index.ts`]
        .map((s) => new URL(s, url))
        .find((u) => existsSync(u) && !u.pathname.endsWith('/'));
      if (!next) throw new Error(`Unresolved import ${spec} in ${path}`);
      queue.push(next);
    }
  }
  return [...seen].sort().map((path) => ({
    path,
    sha256: createHash('sha256')
      .update(readFileSync(new URL(path, root)))
      .digest('hex'),
  }));
}

/** The closure holds only shipped engine sources, windsor#290's harness and this folder. */
export const closureClean = (closure) =>
  closure.every(({ path }) =>
    [`packages/engine/src/`, harness, folder].some((p) => path.startsWith(p)),
  );

/** The pole of the irreversible term at a width: |gap| = k (1 - c) / alpha, the shipped
 * mapping c = max(0, sqrt(1 - width) - offset). */
export function poleThreshold(width, S) {
  const t = S.TAPE_MAGNETIC;
  const c = Math.max(0, Math.sqrt(1 - width) - t.reversibleOffset);
  return (t.pinning * (1 - c)) / t.alpha;
}

/** The edge table: per width, every edge trial's gates, and the pole threshold beside the
 * bound on |gap| that the record allows, Ms + peak |M| (Ms = floor + scale at saturation 0). */
export function edgeTable(records, S, table = S.BOX) {
  const t = S.TAPE_MAGNETIC,
    ms = t.saturationFloor + t.saturationScale;
  return table.edge.widths.map((width) => {
    const rows = records.filter((r) => r.id.startsWith(`edge/${width}/`));
    return {
      width,
      poleThreshold: poleThreshold(width, S),
      ...summarise(rows),
      gapBound: ms + Math.max(...rows.map((r) => r.peakM)),
      trials: rows.map((r) => ({
        id: r.id,
        resets: r.resets,
        nonfinite: r.nonfinite,
        peakM: r.peakM,
        peakOut: r.peakOut,
        survives: survives(r),
      })),
    };
  });
}

/** One raised box: per rate, factor and part, its gates; its failures; whether it passed. */
export function boxResult(wMin, records, S) {
  const control = S.CONTROL;
  const groups = control.rates.flatMap((rate) =>
    control.factors.flatMap((factor) =>
      ['static', 'sweep', 'walk'].map((part) => ({
        rate,
        factor,
        part,
        ...summarise(
          records.filter((t) => t.rate === rate && t.factor === factor && t.part === part),
        ),
      })),
    ),
  );
  const byFactor = control.factors.flatMap((factor) =>
    ['static', 'sweep', 'walk'].map((part) => ({
      factor,
      part,
      ...summarise(records.filter((t) => t.factor === factor && t.part === part)),
    })),
  );
  const failures = records.filter((t) => !survives(t)).map((t) => t.id);
  return {
    wMin,
    box: S.raisedBox(wMin),
    passed: records.length > 0 && !failures.length,
    total: summarise(records),
    byFactor,
    groups,
    segmentPeaks: segmentPeaks(records, control),
    loudest: loudest(records),
    failures,
  };
}

/** The ladder the run implies: each width minimum in order, up to the first box that passed
 * on the recorded trials; and everything else derived from the trials. */
export function derive(trials, run, S, table = S.BOX) {
  const of = (set) => trials.filter((t) => t.id.startsWith(`${set}/`));
  const boxes = [];
  for (const wMin of table.ladder) {
    boxes.push(boxResult(wMin, of(`box/${wMin}`), S));
    if (boxes.at(-1).passed) break;
  }
  const expected = [
    ...S.edgeTrials(table),
    ...boxes.flatMap((b) => S.ladderTrials(b.wMin, table)),
  ].map((t) => t.id);
  const done = new Set(trials.map((t) => t.id));
  const missing = expected.filter((id) => !done.has(id));
  const extra = trials.filter((t) => !expected.includes(t.id)).map((t) => t.id);
  const complete = !missing.length && !extra.length && done.size === trials.length;
  const finished = complete && run.status === 'complete';
  const declared = boxes.find((b) => b.passed);
  return {
    status: finished ? 'complete' : 'incomplete',
    scheduled: expected.length,
    recorded: trials.length,
    missing,
    extra,
    edge: edgeTable(of('edge'), S, table),
    boxes,
    declaration: {
      qualified: finished && Boolean(declared),
      drive: [0, 1],
      width: declared ? [declared.wMin, table.wMax] : null,
      saturation: [0, 1],
      factors: S.CONTROL.factors,
      rates: S.CONTROL.rates,
      aboveShippedMinimum: declared ? declared.wMin > table.shippedMinimum : null,
      failedMinima: boxes.filter((b) => !b.passed).map((b) => b.wMin),
    },
  };
}

/** windsor#315 (Codex's P2 on PR #297): the runner's exit code. Every run fails on an unclean
 * closure, an expiry, a worker that exited nonzero or a truncated journal. A measurement also
 * fails unless every scheduled trial was recorded and a box qualified; a smoke run is partial
 * by design, so those two do not apply to it. */
export function exitCode({ run, derived, closureOk, smoke }) {
  const ran =
    run.status === 'complete' &&
    !run.expired &&
    run.exitCodes.length > 0 &&
    run.exitCodes.every((c) => c === 0) &&
    !run.truncatedTails.length;
  const measured = derived.status === 'complete' && derived.declaration.qualified === true;
  return closureOk && ran && (smoke || measured) ? 0 : 1;
}

/** The exit gate's cases, run by `--check`: a clean measurement passes, and each way a run
 * can be incomplete or unqualified fails it; a smoke run passes partial, and fails broken. */
export function exitGateCases() {
  const run = { status: 'complete', expired: false, exitCodes: [0, 0, 0, 0], truncatedTails: [] };
  const derived = { status: 'complete', declaration: { qualified: true } };
  const base = { run, derived, closureOk: true, smoke: false };
  const partial = { status: 'incomplete', declaration: { qualified: false } };
  const cases = [
    ['complete and qualified', base, 0],
    ['expired', { ...base, run: { ...run, status: 'incomplete', expired: true } }, 1],
    ['worker exited nonzero', { ...base, run: { ...run, exitCodes: [0, 1, 0, 0] } }, 1],
    ['worker killed', { ...base, run: { ...run, exitCodes: [0, null, 0, 0] } }, 1],
    ['no worker ran', { ...base, run: { ...run, exitCodes: [] } }, 1],
    ['truncated journal', { ...base, run: { ...run, truncatedTails: ['{"id'] } }, 1],
    ['trials missing', { ...base, derived: partial }, 1],
    [
      'no box qualified',
      { ...base, derived: { ...derived, declaration: { qualified: false } } },
      1,
    ],
    ['closure not clean', { ...base, closureOk: false }, 1],
    ['smoke, partial', { ...base, derived: partial, smoke: true }, 0],
    [
      'smoke, worker exited nonzero',
      { ...base, ...{ derived: partial, smoke: true }, run: { ...run, exitCodes: [1] } },
      1,
    ],
  ];
  return cases.map(([name, input, expected]) => ({ name, pass: exitCode(input) === expected }));
}

/** The runner's plan for windsor#295: the edge always, then the ladder's boxes in order,
 * stopping at the first that survives whole. */
export const experiment = {
  entry: 'boxProgram.ts',
  report,
  table: (S) => S.BOX,
  fixed: () => ['edge'],
  ladder: (S) => S.BOX.ladder.map((w) => `box/${w}`),
  trialsOf: (S, set) =>
    set === 'edge' ? S.edgeTrials() : S.ladderTrials(Number(set.slice('box/'.length))),
  settings: (S) => ({ box: S.BOX, control: S.CONTROL }),
  derive: (trials, run, S) => derive(trials, run, S),
};

const strip = ({ elapsedMs: _, ...rest }) => rest;

/** Re-derive from the saved trials, re-hash the closure, re-render the spot trials. */
export async function check(path = report) {
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  const S = await loadProgram();
  const derived = derive(saved.trials, saved.run, S);
  const closure = importClosure();
  const all = [...S.edgeTrials(), ...S.BOX.ladder.flatMap((w) => S.ladderTrials(w))];
  const spots = S.BOX.spotChecks.map((id) => {
    const trial = all.find((t) => t.id === id);
    const record = trial && S.runTrial(trial, trial.box);
    const kept = saved.trials.find((t) => t.id === id);
    return { id, equal: Boolean(record && kept && isDeepStrictEqual(strip(record), strip(kept))) };
  });
  const checks = {
    derived: isDeepStrictEqual(JSON.parse(JSON.stringify(derived)), saved.derived),
    closure: isDeepStrictEqual(closure, saved.closure),
    closureClean: closureClean(closure),
    spots: spots.every((s) => s.equal),
    exitGate: exitGateCases().every((c) => c.pass),
  };
  console.log(JSON.stringify({ checks, spots }, null, 1));
  return Object.values(checks).every(Boolean);
}

const at = process.argv.indexOf('--check');
if (process.argv[1] === new URL(import.meta.url).pathname && at > 0)
  process.exitCode = (await check(process.argv[at + 1] ?? report)) ? 0 : 1;
