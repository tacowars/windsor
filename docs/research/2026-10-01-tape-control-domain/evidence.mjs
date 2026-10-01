/* global process, console */
/** windsor#290 evidence: the width rule, the schedule's completeness, the survival gates and
 * the declaration, all derived from saved raw trial records; and `--check`, which re-derives
 * them from measurement.json, re-hashes the import closure and re-renders the spot trials.
 * Run from anywhere on Node 24:
 *   node docs/research/2026-10-01-tape-control-domain/evidence.mjs --check
 */
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = new URL('../../../', import.meta.url);
const folder = 'docs/research/2026-10-01-tape-control-domain/';
export const report = new URL('./measurement.json', import.meta.url);

/** The folder's TypeScript entry, bundled by esbuild with the shipped engine sources. */
export async function loadProgram() {
  const result = await build({
    entryPoints: [new URL('./program.ts', import.meta.url).pathname],
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

/** Every file program.ts reaches by relative import, repo-relative, with its SHA-256. */
export function importClosure() {
  const pattern = /(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g;
  const seen = new Set(),
    queue = [new URL(`${folder}program.ts`, root)];
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

/** The closure holds only shipped engine sources and this folder: no other research. */
export const closureClean = (closure) =>
  closure.every(({ path }) => path.startsWith('packages/engine/src/') || path.startsWith(folder));

/** Part A's configure-only grid: susceptibility and gain along width at each extreme. */
export function widthGrid(S, table = S.CONTROL) {
  const steps = Math.round(1 / table.width.gridStep);
  return table.width.extremes.flatMap(([drive, saturation]) =>
    Array.from({ length: steps + 1 }, (_, i) => {
      const width = i / steps;
      return { drive, saturation, width, ...S.normalisation([drive, width, saturation]) };
    }),
  );
}

export const survives = (t) =>
  t.resets === 0 &&
  t.nonfinite === 0 &&
  t.nonfiniteInput === 0 &&
  Number.isFinite(t.finalM) &&
  Number.isFinite(t.peakM);

/** The declared width rule: the largest grid width up to which, at every extreme, (i) the
 * susceptibility is at least margin x floor and (ii) the gain is at most relativeGain x its
 * width-0 value; then below any rendered part-A width that failed survival. */
export function widthRule(grid, widthRecords, S, table = S.CONTROL) {
  const { margin, relativeGain, gridStep } = table.width,
    floor = S.TAPE_MAGNETIC.susceptibilityFloor;
  const widths = [...new Set(grid.map((g) => g.width))].sort((a, b) => a - b);
  const base = (g) =>
    grid.find((h) => h.width === 0 && h.drive === g.drive && h.saturation === g.saturation);
  const ok = {
    susceptibility: (g) => g.susceptibility >= margin * floor,
    gain: (g) => g.gain <= relativeGain * base(g).gain,
  };
  const upTo = (test) => {
    let last = null;
    for (const w of widths) {
      if (!grid.filter((g) => g.width === w).every(test)) break;
      last = w;
    }
    return last;
  };
  const bySusceptibility = upTo(ok.susceptibility),
    byGain = upTo(ok.gain);
  const failed = widthRecords.filter((t) => !survives(t)).map((t) => t.point[1]);
  const firstFailure = failed.length ? Math.min(...failed) : null;
  const bySurvival = firstFailure === null ? 1 : widths.filter((w) => w < firstFailure).at(-1);
  const wMax = Math.min(bySusceptibility, byGain, bySurvival);
  const binding = Object.entries({ bySusceptibility, byGain, bySurvival })
    .filter(([, w]) => w === wMax)
    .map(([k]) => k);
  return {
    rule: { margin, relativeGain, floor, gridStep },
    bySusceptibility,
    byGain,
    bySurvival,
    firstFailure,
    wMax,
    binding,
  };
}

const max = (xs) => xs.reduce((a, b) => Math.max(a, b), -Infinity);
const min = (xs) => xs.reduce((a, b) => Math.min(a, b), Infinity);
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

/** Gate counts and peaks over a group of trial records. */
export function summarise(rows) {
  return {
    trials: rows.length,
    survive: rows.filter(survives).length,
    resets: sum(rows.map((t) => t.resets)),
    nonfinite: sum(rows.map((t) => t.nonfinite + t.nonfiniteInput)),
    guards: sum(rows.map((t) => t.guards)),
    peakField: max(rows.map((t) => t.peakField)),
    peakM: max(rows.map((t) => t.peakM)),
    guardMargin: min(rows.map((t) => t.guardMargin)),
    peakOut: max(rows.map((t) => t.peakOut)),
    maxGain: max(rows.map((t) => t.maxGain)),
    minSusceptibility: min(rows.map((t) => t.minSusceptibility)),
  };
}

/** Part A's rendered width axis, one row per extreme, width and factor. */
export function widthTable(records) {
  const seg = (t, name) => t.segments.find((s) => s.name === name);
  return records.map((t) => ({
    id: t.id,
    point: t.point,
    factor: t.factor,
    survives: survives(t),
    susceptibility: t.susceptibility,
    gain: t.gain,
    peakField: t.peakField,
    peakOut: t.peakOut,
    peakM: t.peakM,
    dcRemanence: seg(t, 'dc').remanence,
    spikesRemanence: seg(t, 'spikes').remanence,
  }));
}

/** Per box part and segment: the largest output, M and |remanence| and the guard clips. */
export function segmentPeaks(box, table) {
  return ['static', 'sweep', 'walk'].flatMap((part) =>
    table.segments.map(({ name }) => {
      const rows = box
        .filter((t) => t.part === part)
        .map((t) => t.segments.find((s) => s.name === name));
      return {
        part,
        segment: name,
        peakOut: max(rows.map((s) => s.peakOut)),
        peakM: max(rows.map((s) => s.peakM)),
        remanence: max(rows.map((s) => Math.abs(s.remanence))),
        guards: sum(rows.map((s) => s.guards)),
      };
    }),
  );
}

/** The box trials with the largest output peak, and the segment where each peaked. */
export function loudest(box, count = 12) {
  return [...box]
    .sort((a, b) => b.peakOut - a.peakOut || (a.id < b.id ? -1 : 1))
    .slice(0, count)
    .map((t) => ({
      id: t.id,
      peakOut: t.peakOut,
      maxGain: t.maxGain,
      segment: t.segments.reduce((a, b) => (b.peakOut > a.peakOut ? b : a)).name,
    }));
}

/** Everything derived from the trials: the rule, completeness, gates and the declaration. */
export function derive(trials, grid, run, S, table = S.CONTROL) {
  const width = trials.filter((t) => t.part === 'width');
  const rule = widthRule(grid, width, S, table);
  const expected = [...S.widthTrials(table), ...S.boxTrials(rule.wMax, table)].map((t) => t.id);
  const done = new Set(trials.map((t) => t.id));
  const missing = expected.filter((id) => !done.has(id));
  const extra = trials.filter((t) => !expected.includes(t.id)).map((t) => t.id);
  const complete = !missing.length && !extra.length && done.size === trials.length;
  const box = trials.filter((t) => t.part !== 'width');
  const groups = table.rates.flatMap((rate) =>
    table.factors.flatMap((factor) =>
      ['static', 'sweep', 'walk'].map((part) => ({
        rate,
        factor,
        part,
        ...summarise(box.filter((t) => t.rate === rate && t.factor === factor && t.part === part)),
      })),
    ),
  );
  const failures = box.filter((t) => !survives(t)).map((t) => t.id);
  const finished = complete && run.status === 'complete';
  return {
    status: finished ? 'complete' : 'incomplete',
    scheduled: expected.length,
    recorded: trials.length,
    missing,
    extra,
    widthRule: rule,
    widthTable: widthTable(width),
    groups,
    total: summarise(box),
    segmentPeaks: segmentPeaks(box, table),
    loudest: loudest(box),
    failures,
    declaration: {
      qualified: finished && !failures.length,
      drive: [0, 1],
      width: [0, rule.wMax],
      saturation: [0, 1],
      factors: table.factors,
      rates: table.rates,
      failed: failures,
    },
  };
}

/** One trial per line, as the earlier records keep raw measurements reviewable. */
export function writeReport(path, value) {
  const fields = Object.entries(value).map(([key, v]) => {
    const encoded = Array.isArray(v)
      ? `[\n${v.map((row) => `    ${JSON.stringify(row)}`).join(',\n')}\n  ]`
      : JSON.stringify(v);
    return `  ${JSON.stringify(key)}: ${encoded}`;
  });
  writeFileSync(path, `{\n${fields.join(',\n')}\n}\n`);
}

const strip = ({ elapsedMs: _, ...rest }) => rest;

/** Re-derive from the saved trials, re-hash the closure, re-render the spot trials. */
export async function check(path = report) {
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  const S = await loadProgram();
  const grid = widthGrid(S);
  const derived = derive(saved.trials, grid, saved.run, S);
  const closure = importClosure();
  const all = [...S.widthTrials(), ...S.boxTrials(saved.derived.widthRule.wMax)];
  const spots = S.CONTROL.spotChecks.map((id) => {
    const trial = all.find((t) => t.id === id);
    const record = trial && S.runTrial(trial, saved.derived.widthRule.wMax);
    const kept = saved.trials.find((t) => t.id === id);
    return { id, equal: Boolean(record && kept && isDeepStrictEqual(strip(record), strip(kept))) };
  });
  const checks = {
    grid: isDeepStrictEqual(grid, saved.grid),
    derived: isDeepStrictEqual(JSON.parse(JSON.stringify(derived)), saved.derived),
    closure: isDeepStrictEqual(closure, saved.closure),
    closureClean: closureClean(closure),
    spots: spots.every((s) => s.equal),
  };
  console.log(JSON.stringify({ checks, spots }, null, 1));
  return Object.values(checks).every(Boolean);
}

const at = process.argv.indexOf('--check');
if (process.argv[1] === new URL(import.meta.url).pathname && at > 0)
  process.exitCode = (await check(process.argv[at + 1] ?? report)) ? 0 : 1;
