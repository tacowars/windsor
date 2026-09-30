/** Field-event localization and event-aligned RK4 for windsor#192.
 * Core: Jatin Chowdhury, GPL-3.0-only, 604372e4ffd9690c3e283362e4598cb43edbb475.
 * See ../2026-09-30-tape-phase-3/{COPYING,AUDIT.md,hysteresis.ts}. The equation,
 * knee chain derivative, RK4 stage arithmetic (`step`), playback, fixed-8x
 * observation and magnitude-20 guard are imported unchanged. This file only
 * chooses step boundaries and where the continuous field is sampled.
 */
import {
  configured,
  pulseInput,
  stage,
  type pulseField,
} from '../2026-09-30-tape-conditioning/conditioning';
import { playback, step } from '../2026-09-30-tape-filtered-reference/filteredReference';
import { reconstruct } from '../2026-09-30-tape-filtered-reference/reconstruction';
import { fixedObservation } from '../2026-09-30-tape-boundary-reference/boundaryReference';
import { equation } from '../2026-09-30-tape-boundary-reference/diagnostics';
import type { BoundaryCase } from '../2026-09-30-tape-boundary-reference/boundaryConstants';
import { EVENTS as E, type Kind } from './eventConstants';

type Field = ReturnType<typeof pulseField>;
type Input = (n: number) => number;
/** Source H and dH per host sample. */
type Sample = [number, number];
export type Points = (a: number, b: number) => number[];

export function classify(kind: Kind, [h, d]: Sample, table = E): number {
  if (kind === 'fieldZero') return Math.sign(h);
  if (kind === 'knee') return Math.abs(h) > table.knee ? 1 : 0;
  return d >= 0 ? 1 : -1;
}

/** Bisect one bracket on the direct continuous kernel evaluation. */
export function bisect(kind: Kind, bracket: [number, number], input: Input, table = E) {
  let [lo, hi] = bracket,
    bisections = 0;
  const from = classify(kind, reconstruct(lo, input), table);
  while (hi - lo > table.timeTolerance && bisections < table.bisectionCap) {
    const mid = (lo + hi) / 2;
    if (mid <= lo || mid >= hi) break;
    if (classify(kind, reconstruct(mid, input), table) === from) lo = mid;
    else hi = mid;
    bisections++;
  }
  const to = classify(kind, reconstruct(hi, input), table);
  return { kind, time: (lo + hi) / 2, lo, hi, width: hi - lo, bisections, from, to };
}
export type FieldEvent = ReturnType<typeof bisect>;

/** Bracket every class change on the factor's uniform stage grid, then bisect. */
export function locate(options: { field: Field; input: Input; factor: number }, table = E) {
  const { field, input, factor } = options,
    grid = 2 * factor;
  if (field.grid !== grid) throw Error('Field does not match the factor');
  const events: FieldEvent[] = [];
  let before: Sample = [field.at(0), field.at(0, true)];
  for (let i = 0; i < table.frames * grid; i++) {
    const after: Sample = [field.at(i + 1), field.at(i + 1, true)];
    for (const kind of table.kinds)
      if (classify(kind, before, table) !== classify(kind, after, table))
        events.push(bisect(kind, [i / grid, (i + 1) / grid], input, table));
    before = after;
  }
  return events.sort((a, b) => a.time - b.time);
}

/** Interior nodes per uniform step. Uniform nodes are never moved or removed. */
export function insertions(events: { time: number }[], factor: number, table = E) {
  const splits = new Map<number, number[]>();
  let merged = 0,
    atNode = 0,
    kept = -Infinity;
  for (const { time } of [...events].sort((a, b) => a.time - b.time)) {
    if (time - kept < table.mergeThreshold) {
      merged++;
      continue;
    }
    kept = time;
    if (Math.abs(time - Math.round(time * factor) / factor) < table.mergeThreshold) {
      atNode++;
      continue;
    }
    const index = Math.floor(time * factor);
    splits.set(index, [...(splits.get(index) ?? []), time]);
  }
  return { splits, merged, atNode, inserted: events.length - merged - atNode };
}

/** Conditioned stage inputs at a substep's start, midpoint and end, evaluated directly. */
export function directPoints(input: Input, rate: number, table = E): Points {
  return (a, b) =>
    [a, (a + b) / 2, b].flatMap((t) => {
      const [h, d] = reconstruct(t, input);
      return stage(h, rate * d, table.policy);
    });
}

type Switch = { step: number; stage: number; time: number; a: number; b: number; split: boolean };
/** Irreversible- and series-branch changes seen by the actual RK stage calls. */
export class Switches {
  inside = { irreversible: 0, series: 0 };
  atNodes = { irreversible: 0, series: 0 };
  records = { irreversible: [] as Switch[], series: [] as Switch[] };
  truncated = { irreversible: 0, series: 0 };
  private call = 0;
  private first: Record<string, boolean> = {};
  private last: Record<string, boolean> | null = null;
  private seen = new Set<string>();
  private span = { step: 0, a: 0, b: 0, split: false };
  constructor(readonly table = E) {}
  begin(span: { step: number; a: number; b: number; split: boolean }) {
    this.span = span;
    this.call = 0;
    this.seen.clear();
  }
  observe(terms: { irreversible: boolean; series: boolean }) {
    const { step: index, a, b, split } = this.span,
      stage = ++this.call;
    for (const key of this.table.switches) {
      if (stage === 1) {
        if (this.last && this.last[key] !== terms[key]) this.atNodes[key]++;
        continue;
      }
      if (this.seen.has(key) || terms[key] === this.first[key]) continue;
      this.seen.add(key);
      this.inside[key]++;
      const time = a + this.table.stagePhases[stage - 1] * (b - a);
      if (this.records[key].length < this.table.switchCap)
        this.records[key].push({ step: index, stage, time, a, b, split });
      else this.truncated[key]++;
    }
    const flags = { irreversible: terms.irreversible, series: terms.series };
    if (stage === 1) this.first = flags;
    this.last = flags;
  }
  summary() {
    const { inside, atNodes, records, truncated } = this;
    return { inside, atNodes, records, truncated };
  }
}

// eslint-disable-next-line max-lines-per-function -- One trajectory: the #183 uniform step verbatim, split only where a node is inserted.
export function renderAligned(
  options: {
    row: BoundaryCase;
    factor: number;
    field: Field;
    splits?: Map<number, number[]>;
    points?: Points;
    frames?: number;
  },
  table = E,
) {
  const {
    row,
    factor,
    field,
    splits = new Map<number, number[]>(),
    frames = table.frames,
  } = options;
  if (
    field.grid !== 2 * factor ||
    row.rate !== table.rate ||
    !(frames >= 1 && frames <= table.frames)
  )
    throw Error('Invalid aligned render');
  const points =
    options.points ?? directPoints(pulseInput(row.level, row.history), row.rate, table);
  const core = configured(row.rate * factor, row.controls, table.policy);
  const slope = core.slope.bind(core),
    log = new Switches(table);
  core.slope = (m, h, velocity) => {
    log.observe(equation(core, { m, h, velocity }));
    return slope(m, h, velocity);
  };
  const states = new Float64Array(frames * factor),
    cached = new Array<number>(6),
    dt = 1 / (row.rate * factor);
  let failure: string | null = null,
    failureIndex: number | null = null;
  for (let index = 0; index < states.length; index++) {
    states[index] = core.m;
    const bounds = [index / factor, ...(splits.get(index) ?? []), (index + 1) / factor];
    try {
      if (bounds.length === 2) {
        for (let j = 0; j < 3; j++) {
          const h = field.at(2 * index + j),
            d = row.rate * field.at(2 * index + j, true);
          [cached[2 * j], cached[2 * j + 1]] = stage(h, d, table.policy);
        }
        log.begin({ step: index, a: bounds[0], b: bounds[1], split: false });
        step(core, cached, dt, 'rk4');
      } else
        for (let s = 1; s < bounds.length; s++) {
          const [a, b] = [bounds[s - 1], bounds[s]];
          log.begin({ step: index, a, b, split: true });
          step(core, points(a, b), (b - a) / row.rate, 'rk4');
        }
    } catch (error) {
      failure = String(error);
      failureIndex = index;
      states.fill(NaN, index);
      break;
    }
  }
  return {
    raw: Float64Array.from({ length: frames }, (_, n) => states[n * factor]),
    output: playback(states, factor, frames),
    fixed: fixedObservation(states, factor, frames, table),
    failure,
    failureIndex,
    finite: states.every(Number.isFinite),
    final: core.m,
    resets: core.resets,
    clips: core.clips,
    diagnostics: log.summary(),
  };
}
