/** windsor#290: the field program and one trial through the shipped magnetic stage.
 * The stage (`TapeMagneticStage`: both oversampler pairs, the 10 ms control smoothing and
 * the per-block reconfiguration), the oversampler, the core and its constants are the
 * shipped engine sources, unchanged. The only harness act on them: one research row is
 * appended to this bundle's in-memory `TAPE_MODELS`, and its `magnetic` triple is written
 * with the knob targets before each block's `configure`, as a model change would be.
 */
import { TAPE_MODELS } from '../../../packages/engine/src/inserts/tapeConstants';
import { TAPE_MAGNETIC } from '../../../packages/engine/src/inserts/tapeMagneticConstants';
import { cosine, sine } from '../../../packages/engine/src/inserts/tapePortableMath';
import {
  TapeMagneticCore,
  originSusceptibility,
} from '../../../packages/engine/src/worklet/tape/tapeMagnetic';
import { TapeMagneticStage } from '../../../packages/engine/src/worklet/tape/tapeMagneticStage';
import { CONTROL, type Control, type Triple } from './controlConstants';
import { boxOf, target, walkPoints, type Box, type Trial } from './controlPaths';

export { CONTROL } from './controlConstants';
export * from './controlPaths';
export { TAPE_MAGNETIC };

/** The three tones at host frame n, sum / 3; phases reduced exactly in integers. */
function tones(n: number, rate: number, table: Control) {
  const { bins, period, referenceRate } = table.tones,
    cycle = period * rate;
  let sum = 0;
  for (const bin of bins) sum += sine((2 * Math.PI * ((bin * referenceRate * n) % cycle)) / cycle);
  return sum / bins.length;
}

/** The program's source field at host frame n (closed form, sampled at the host rate). */
export function field(n: number, rate: number, table: Control = CONTROL): number {
  const t = n / rate,
    { level, edge, spike } = table;
  if (t >= spike.end) return 0;
  if (t >= spike.start) {
    const k = Math.floor((t - spike.start) / spike.every),
      tau = t - spike.start - k * spike.every;
    if (tau >= spike.width) return 0;
    return (k % 2 ? -level : level) * (0.5 - 0.5 * cosine((2 * Math.PI * tau) / spike.width));
  }
  const ramp = table.segments[0]!.end;
  let v = level * tones(n, rate, table) * Math.min(1, t / ramp);
  for (const [start, value] of table.levels) {
    if (t < start!) break;
    const e = t >= start! + edge ? 1 : 0.5 - 0.5 * cosine((Math.PI * (t - start!)) / edge);
    v = v * (1 - e) + value! * e;
  }
  return v;
}

const fields = new Map<number, Float64Array>();
/** The whole program at `rate`, built once per process. */
export function program(rate: number, table: Control = CONTROL): Float64Array {
  let input = fields.get(rate);
  if (input) return input;
  input = new Float64Array(Math.round(table.seconds * rate));
  for (let n = 0; n < input.length; n++) input[n] = field(n, rate, table);
  fields.set(rate, input);
  return input;
}

let research: { index: number; magnetic: number[] } | null = null;
/** The research row, appended once to the bundled `TAPE_MODELS` (runtime arrays). */
function researchRow() {
  if (research) return research;
  const models = TAPE_MODELS as unknown as { magnetic: number[] }[];
  const magnetic = [NaN, NaN, NaN];
  models.push({ ...models[0]!, magnetic });
  research = { index: models.length - 1, magnetic };
  return research;
}
const write = (row: number[], v: Triple) => {
  row[0] = v[0];
  row[1] = v[1];
  row[2] = v[2];
};

/** Origin susceptibility and output gain from the shipped `configure`, at one point. */
export function normalisation(point: Triple) {
  const controls = { drive: point[0], width: point[1], saturation: point[2] };
  const core = new TapeMagneticCore(CONTROL.rates[0]!, CONTROL.factors[0]!, controls);
  return { susceptibility: originSusceptibility(controls), gain: core.gain };
}

/** Per-segment accumulators: frame bounds, the remanence window, peaks and sums. */
function segmentsFor(rate: number, table: Control) {
  return table.segments.map(({ name, start, end }) => ({
    name,
    from: Math.round(start * rate),
    to: Math.round(end * rate),
    window: Math.round(table.remanence * rate),
    peakM: 0,
    peakOut: 0,
    guards: 0,
    sumOut: 0,
    sumM: 0,
  }));
}

/** One trial: the program through the shipped stage, the knobs read once per block. */
// eslint-disable-next-line max-lines-per-function -- one render loop and its counters; split, the per-sample state would cross calls
export function runTrial(trial: Trial, domain: number | Box, table: Control = CONTROL) {
  const started = performance.now();
  const { rate, factor, path } = trial,
    box = boxOf(domain);
  const plan = path.kind === 'walk' ? walkPoints(path, box, table) : null;
  const targets: Triple = [NaN, NaN, NaN],
    row = researchRow();
  write(row.magnetic, target(path, 0, box, plan, targets));
  const stage = new TapeMagneticStage(rate, factor, row.index);
  const osc = stage.active[0]!,
    core = osc.core,
    stages = osc.stages;
  const input = program(rate, table),
    frames = input.length;
  const segments = segmentsFor(rate, table);
  const reached = [0, 1, 2].map(() => [Infinity, -Infinity]);
  let minSusceptibility = Infinity,
    maxGain = 0,
    peakField = 0,
    peakM = 0,
    peakOut = 0,
    nonfinite = 0,
    nonfiniteInput = 0,
    segment = 0;
  for (let start = 0; start < frames; start += table.block) {
    const count = Math.min(table.block, frames - start);
    write(row.magnetic, target(path, start / rate, box, plan, targets));
    stage.configure(row.index, count);
    const c = stage.controls;
    [c.drive, c.width, c.saturation].forEach((v, i) => {
      reached[i]![0] = Math.min(reached[i]![0]!, v);
      reached[i]![1] = Math.max(reached[i]![1]!, v);
    });
    minSusceptibility = Math.min(minSusceptibility, core.susceptibility);
    maxGain = Math.max(maxGain, core.gain);
    for (let n = start; n < start + count; n++) {
      const x = input[n]!;
      if (!Number.isFinite(x)) nonfiniteInput++;
      while (n >= segments[segment]!.to) segment++;
      const s = segments[segment]!,
        before = osc.guards;
      osc.input = x;
      osc.advance();
      s.guards += osc.guards - before;
      const y = osc.output,
        m = Math.abs(core.m);
      for (let q = 2; q < stages.length; q += 2)
        peakField = Math.max(peakField, Math.abs(stages[q]!));
      if (!Number.isFinite(y)) nonfinite++;
      peakM = Math.max(peakM, m);
      peakOut = Math.max(peakOut, Math.abs(y));
      s.peakM = Math.max(s.peakM, m);
      s.peakOut = Math.max(s.peakOut, Math.abs(y));
      if (n >= s.to - s.window) {
        s.sumOut += y;
        s.sumM += core.m;
      }
    }
  }
  const summary = segments.map((s) => ({
    name: s.name,
    peakM: s.peakM,
    peakOut: s.peakOut,
    guards: s.guards,
    remanence: s.sumOut / s.window,
    remanenceM: s.sumM / s.window,
  }));
  return {
    id: trial.id,
    part: trial.part,
    rate,
    factor,
    ...(path.kind === 'static' ? { point: path.point, ...normalisation(path.point) } : {}),
    frames,
    resets: core.resets,
    nonfinite,
    nonfiniteInput,
    guards: osc.guards,
    peakField,
    peakM,
    guardMargin: TAPE_MAGNETIC.stateGuard / peakM,
    peakOut,
    finalM: core.m,
    reached,
    minSusceptibility,
    maxGain,
    segments: summary,
    elapsedMs: performance.now() - started,
  };
}
