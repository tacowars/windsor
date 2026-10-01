/** windsor#315 (fix round on PR #317): one trial through the shipped magnetic stage, driven
 * exactly as `TapeDsp` drives it. Since #293 (`634e717`) `TapeMagneticStage.configure` only
 * sets the glide's target; the controls move per sample in `glide`, which `TapeDsp.step`
 * calls while `gliding`, before the channel's oversampler advances, and each `retune` there
 * rescales M by the old gain over the new (#307). #290's `runTrial` calls `configure` per
 * block and never `glide`, so on today's stage its sweeps and walks never leave their
 * starting point. This one makes the same calls in the same order as `TapeDsp`: per block
 * `select(factor)` then `configure(model)`; per sample `glide()` while `gliding`, then the
 * left channel's `input`, `advance()` and `output`. Every other act is #290's: the same
 * field program, the same research row written with the knob targets before each block's
 * `configure`, the same counters. It also records what the controls did, per sample, for
 * the motion gate (`rowsMotion.mjs`): the commanded range, the reached range, and for a
 * walk, the controls at the end of each hold.
 */
import { TAPE_MODELS } from '../../../packages/engine/src/inserts/tapeConstants';
import { TapeMagneticStage } from '../../../packages/engine/src/worklet/tape/tapeMagneticStage';
import {
  CONTROL,
  TAPE_MAGNETIC,
  boxOf,
  normalisation,
  program,
  target,
  walkPoints,
  type Box,
  type Path,
  type Trial,
} from './boxProgram';
import type { Control, Triple } from '../2026-10-01-tape-control-domain/controlConstants';

let research: { index: number; magnetic: number[] } | null = null;
/** This bundle's research row, appended once to its `TAPE_MODELS` (runtime arrays), as #290's. */
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

/** Per-segment accumulators: frame bounds, the remanence window, peaks and sums (#290's). */
function segmentsFor(rate: number, table: Control) {
  return table.segments.map(({ name, start, end }) => ({
    name,
    from: Math.round(start * rate),
    to: Math.round(end * rate),
    window: Math.round(table.remanence * rate),
    ...{ peakM: 0, peakOut: 0, guards: 0, sumOut: 0, sumM: 0 },
  }));
}

const range = () => [0, 1, 2].map(() => [Infinity, -Infinity]);
const widen = (r: number[][], v: readonly number[]) => {
  for (let i = 0; i < 3; i++) {
    r[i]![0] = Math.min(r[i]![0]!, v[i]!);
    r[i]![1] = Math.max(r[i]![1]!, v[i]!);
  }
};

/** What the controls did: the targets written, the glided controls per sample, and for a
 * walk, the controls at each hold's end (the last sample before its next point, and the
 * program's last) against the target then in force. */
function motionTracker(path: Path, rate: number) {
  const commanded = range(),
    reached = range();
  const ends = [new Set<number>(), new Set<number>(), new Set<number>()];
  let hold = -1,
    holds = 0,
    holdLag = 0;
  const last: Triple = [NaN, NaN, NaN];
  const end = (c: { drive: number; width: number; saturation: number }) => {
    const v = [c.drive, c.width, c.saturation];
    v.forEach((x, i) => ends[i]!.add(x));
    holdLag = Math.max(holdLag, ...v.map((x, i) => Math.abs(x - last[i]!)));
    holds++;
  };
  return {
    /** After each sample's glide: the controls the core runs at. */
    reach(c: TapeMagneticStage['controls']) {
      const r = reached;
      if (c.drive < r[0]![0]!) r[0]![0] = c.drive;
      if (c.drive > r[0]![1]!) r[0]![1] = c.drive;
      if (c.width < r[1]![0]!) r[1]![0] = c.width;
      if (c.width > r[1]![1]!) r[1]![1] = c.width;
      if (c.saturation < r[2]![0]!) r[2]![0] = c.saturation;
      if (c.saturation > r[2]![1]!) r[2]![1] = c.saturation;
    },
    /** Before a block's `configure`: close the hold that ends here, then note the targets. */
    block(start: number, targets: Triple, c: TapeMagneticStage['controls']) {
      if (path.kind === 'walk') {
        const k = Math.floor(start / rate / path.hold);
        if (hold >= 0 && k !== hold) end(c);
        hold = k;
      }
      widen(commanded, targets);
      write(last, targets);
    },
    record(c: TapeMagneticStage['controls']) {
      if (path.kind === 'walk') end(c);
      const walk = { holds, distinct: ends.map((s) => s.size), holdLag };
      return { commanded, reached, ...(path.kind === 'walk' ? { holdEnds: walk } : {}) };
    },
  };
}

/** One trial: the program through the shipped stage, driven as `TapeDsp` drives it. */
// eslint-disable-next-line max-lines-per-function -- one render loop and its counters, as #290's; split, the per-sample state would cross calls
export function runTrial(trial: Trial, domain: number | Box, table: Control = CONTROL) {
  const started = performance.now();
  const { rate, factor, path } = trial,
    box = boxOf(domain);
  const plan = path.kind === 'walk' ? walkPoints(path, box, table) : null;
  const targets: Triple = [NaN, NaN, NaN],
    row = researchRow();
  write(row.magnetic, target(path, 0, box, plan, targets));
  const stage = new TapeMagneticStage(rate, factor, row.index);
  const c = stage.controls,
    motion = motionTracker(path, rate);
  const input = program(rate, table),
    frames = input.length;
  const segments = segmentsFor(rate, table);
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
    motion.block(start, targets, c);
    stage.select(factor);
    stage.configure(row.index);
    for (let n = start; n < start + count; n++) {
      if (stage.gliding) stage.glide();
      const osc = stage.active[0]!,
        core = osc.core,
        x = input[n]!;
      motion.reach(c);
      minSusceptibility = Math.min(minSusceptibility, core.susceptibility);
      maxGain = Math.max(maxGain, core.gain);
      if (!Number.isFinite(x)) nonfiniteInput++;
      while (n >= segments[segment]!.to) segment++;
      const s = segments[segment]!,
        before = osc.guards;
      osc.input = x;
      osc.advance();
      s.guards += osc.guards - before;
      const y = osc.output,
        m = Math.abs(core.m);
      for (let q = 2; q < osc.stages.length; q += 2)
        peakField = Math.max(peakField, Math.abs(osc.stages[q]!));
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
  const osc = stage.active[0]!,
    core = osc.core;
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
    ...motion.record(c),
    minSusceptibility,
    maxGain,
    segments: segments.map((s) => ({
      name: s.name,
      peakM: s.peakM,
      peakOut: s.peakOut,
      guards: s.guards,
      remanence: s.sumOut / s.window,
      remanenceM: s.sumM / s.window,
    })),
    elapsedMs: performance.now() - started,
  };
}
