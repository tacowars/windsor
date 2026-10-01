/* global process, console */
/** windsor#315 evidence: the normalisation table over each candidate box (its six faces and
 * its volume), the shipped model rows, each candidate's gates, where the candidates stop and
 * the declaration, all derived from saved raw trial records and the shipped `configure`; and
 * `--check`, which re-derives them from rowsMeasurement.json, re-hashes the import closure,
 * re-renders the spot trials and tests the runner's exit gate. Run from anywhere on Node 24:
 *   node docs/research/2026-10-01-tape-control-domain-2x/rowsEvidence.mjs --check
 */
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { summarise, segmentPeaks, loudest } from '../2026-10-01-tape-control-domain/evidence.mjs';
import { survives, loadProgram, importClosure, closureClean, exitGateCases } from './evidence.mjs';

export const report = new URL('./rowsMeasurement.json', import.meta.url);
const entry = 'rowsProgram.ts';
const AXES = ['drive', 'width', 'saturation'];
const setOf = (S, c) => `rows/${S.candidateName(c)}`;
const at = (range, u) => range[0] + u * (range[1] - range[0]);
const inside = (point, box) => point.every((v, i) => v >= box[i][0] && v <= box[i][1]);

/** The shipped `configure` at a point, and the gain over its width-0 value (windsor#290's
 * rule (ii) ratio, drive-independent but for the alpha term). */
function evaluate(S, point) {
  const here = S.normalisation(point);
  const base = S.normalisation([point[0], 0, point[2]]);
  return { point, ...here, relativeGain: here.gain / base.gain };
}

const argBy = (points, key, sign) =>
  points.reduce((a, b) => (sign * (b[key] - a[key]) > 0 ? b : a));

/** A grid's extremes: the lowest susceptibility, the highest gain and gain ratio, and where. */
function extremes(points, floor, margin) {
  const low = argBy(points, 'susceptibility', -1),
    high = argBy(points, 'gain', 1),
    ratio = argBy(points, 'relativeGain', 1);
  return {
    points: points.length,
    minSusceptibility: low.susceptibility,
    minSusceptibilityAt: low.point,
    floorRatio: low.susceptibility / floor,
    aboveMargin: low.susceptibility >= margin * floor,
    maxGain: high.gain,
    maxGainAt: high.point,
    maxRelativeGain: ratio.relativeGain,
    maxRelativeGainAt: ratio.point,
  };
}

/** One candidate's normalisation table: each face's grid, the volume's, and the worst. */
export function faceTable(c, S, table = S.ROWS) {
  const box = S.candidateBox(c, table),
    floor = S.TAPE_MAGNETIC.susceptibilityFloor;
  const n = table.faceSteps,
    v = table.volumeSteps;
  const faces = [0, 1, 2].flatMap((axis) =>
    [0, 1].map((end) => {
      const points = [];
      for (let i = 0; i <= n; i++)
        for (let j = 0; j <= n; j++) {
          const u = [i / n, j / n];
          u.splice(axis, 0, end);
          points.push(
            evaluate(
              S,
              u.map((x, k) => at(box[k], x)),
            ),
          );
        }
      return { face: `${AXES[axis]}=${box[axis][end]}`, ...extremes(points, floor, table.margin) };
    }),
  );
  const volume = [];
  for (let i = 0; i <= v; i++)
    for (let j = 0; j <= v; j++)
      for (let k = 0; k <= v; k++)
        volume.push(
          evaluate(
            S,
            [i / v, j / v, k / v].map((x, a) => at(box[a], x)),
          ),
        );
  const inVolume = extremes(volume, floor, table.margin);
  const worst = {
    minSusceptibility: Math.min(...faces.map((f) => f.minSusceptibility)),
    maxGain: Math.max(...faces.map((f) => f.maxGain)),
    maxRelativeGain: Math.max(...faces.map((f) => f.maxRelativeGain)),
  };
  return {
    candidate: S.candidateName(c),
    box,
    floor,
    margin: table.margin,
    faces,
    volume: inVolume,
    worst,
    extremesOnFaces:
      inVolume.minSusceptibility >= worst.minSusceptibility &&
      inVolume.maxGain <= worst.maxGain &&
      inVolume.maxRelativeGain <= worst.maxRelativeGain,
  };
}

/** The shipped model rows: each one's normalisation and which candidate boxes hold it. */
export function rowsTable(S, table = S.ROWS) {
  return S.shippedRows().map(({ label, point }) => ({
    label,
    ...evaluate(S, point),
    inside: table.candidates.map((c) => ({
      candidate: S.candidateName(c),
      inside: inside(point, S.candidateBox(c, table)),
    })),
  }));
}

/** One candidate box: per rate, factor and part, its gates; its failures; whether it passed. */
export function candidateResult(c, records, S) {
  const control = S.CONTROL,
    parts = ['static', 'sweep', 'walk'];
  const pick = (f) => summarise(records.filter(f));
  const groups = control.rates.flatMap((rate) =>
    control.factors.flatMap((factor) =>
      parts.map((part) => ({
        ...{ rate, factor, part },
        ...pick((t) => t.rate === rate && t.factor === factor && t.part === part),
      })),
    ),
  );
  const byFactor = control.factors.flatMap((factor) =>
    parts.map((part) => ({ factor, part, ...pick((t) => t.factor === factor && t.part === part) })),
  );
  const failures = records.filter((t) => !survives(t)).map((t) => t.id);
  return {
    candidate: S.candidateName(c),
    box: S.candidateBox(c),
    passed: records.length > 0 && !failures.length,
    total: summarise(records),
    byFactor,
    groups,
    segmentPeaks: segmentPeaks(records, control),
    loudest: loudest(records),
    failures,
  };
}

/** The candidates the run implies: each in order, up to the first that passed on the
 * recorded trials; the normalisation and rows tables; and the declaration. */
export function derive(trials, run, S, table = S.ROWS) {
  const ran = [];
  for (const c of table.candidates) {
    const set = setOf(S, c);
    ran.push({
      c,
      result: candidateResult(
        c,
        trials.filter((t) => t.id.startsWith(`${set}/`)),
        S,
      ),
    });
    if (ran.at(-1).result.passed) break;
  }
  const expected = ran.flatMap(({ c }) => S.rowsTrials(c, table)).map((t) => t.id);
  const done = new Set(trials.map((t) => t.id)),
    wanted = new Set(expected);
  const missing = expected.filter((id) => !done.has(id));
  const extra = trials.filter((t) => !wanted.has(t.id)).map((t) => t.id);
  const complete = !missing.length && !extra.length && done.size === trials.length;
  const finished = complete && run.status === 'complete';
  const declared = ran.find(({ result }) => result.passed);
  const rows = rowsTable(S, table);
  const box = declared ? declared.result.box : null;
  return {
    status: finished ? 'complete' : 'incomplete',
    scheduled: expected.length,
    recorded: trials.length,
    missing,
    extra,
    normalisation: table.candidates.map((c) => faceTable(c, S, table)),
    rows,
    boxes: ran.map(({ result }) => result),
    declaration: {
      qualified: finished && Boolean(declared),
      drive: box && box[0],
      width: box && box[1],
      saturation: box && box[2],
      factors: S.CONTROL.factors,
      rates: S.CONTROL.rates,
      holdsEveryRow: box ? rows.every((r) => inside(r.point, box)) : null,
      failedCandidates: ran
        .filter(({ result }) => !result.passed)
        .map(({ result }) => result.candidate),
    },
  };
}

/** The runner's plan for windsor#315: the candidates in order, stopping at the first that
 * survives whole. */
export const experiment = {
  entry,
  report,
  table: (S) => S.ROWS,
  fixed: () => [],
  ladder: (S) => S.ROWS.candidates.map((c) => setOf(S, c)),
  trialsOf: (S, set) => S.rowsTrials(S.ROWS.candidates.find((c) => setOf(S, c) === set)),
  settings: (S) => ({ rows: S.ROWS, control: S.CONTROL }),
  derive: (trials, run, S) => derive(trials, run, S),
};

const strip = ({ elapsedMs: _, ...rest }) => rest;

/** Re-derive from the saved trials, re-hash the closure, re-render the spot trials. */
export async function check(path = report) {
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  const S = await loadProgram(entry);
  const derived = derive(saved.trials, saved.run, S);
  const closure = importClosure(entry);
  const all = S.ROWS.candidates.flatMap((c) => S.rowsTrials(c));
  const spots = S.ROWS.spotChecks.map((id) => {
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

const flag = process.argv.indexOf('--check');
if (process.argv[1] === new URL(import.meta.url).pathname && flag > 0)
  process.exitCode = (await check(process.argv[flag + 1] ?? report)) ? 0 : 1;
