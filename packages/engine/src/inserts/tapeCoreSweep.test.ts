/**
 * The Tape card's Advanced knobs (windsor#291) turned under a tone, through
 * the insert's own parameters, as the knobs reach the processor: each
 * control's parameter is written a block at a time, and the stage glides the
 * core's controls toward it with the 10 ms time constant, keeping the
 * magnetization and, since windsor#296, the core's output M × gain.
 *
 * Per rate (44.1, 48 and 96 kHz), one shipped DSP (`__fixtures__/tapeDspProbe.ts`,
 * the whole path as heard: Bias and model EQ, the core, the DC block, Mix 1)
 * plays a full-scale 300 Hz sine with the song's `core` set, at Drive 0 (the
 * field at the knee) and at +32 dB (at the guard), at 2× and then at 4×. Each
 * knob is swept across its whole range in `TAPE_CORE_BOUNDS` (windsor#315's
 * box, so Bend from 0.05 and Width to 0.85) and back, over `SWEEP` each way,
 * with the other two at each corner of theirs. Across every sweep: no state
 * reset on any core, no sample above `BOUND` times the larger steady peak at
 * the sweep's two ends, and no step from one sample to the next above
 * `BOUND` times the larger steady step there, so the motion neither lifts
 * the level nor jumps. `BOUND` is #307's tone bound
 * (`tapeOutputContinuity.test.ts`, 1.005). Measured on Node 24 (arm64; the
 * core's arithmetic is portable), the worst sample was 1.00001 of its
 * reference (Saturation swept at Bend 0.05, Width 0.85) and the worst step
 * 1.0024 (Bend swept at Width 0.05, Saturation 1), both at 44.1 kHz 2×. The
 * settle and the hold are each over ten time constants, so both references
 * are steady.
 *
 * Runs in about 45 s.
 */
import { describe, expect, it } from 'vitest';
import { tapeRig, type TapeRig } from '../__fixtures__/tapeDspProbe';
import {
  TAPE_BOUNDS,
  TAPE_CORE_BOUNDS,
  TAPE_CORE_CONTROLS,
  TAPE_CORE_PARAMS,
  TAPE_OVERSAMPLING,
} from './tapeConstants';
import { sine } from './tapePortableMath';

const RATES = [44100, 48000, 96000] as const;
const HZ = 300;
const QUANTUM = 128;
/** Seconds: the tone on the sweep's start, each sweep, and the hold after it. */
const SETTLE = 0.12;
const SWEEP = 0.15;
const HOLD = 0.1;
/** #307's bound on a tone's peak while the core's controls move. */
const BOUND = 1.005;

type Control = (typeof TAPE_CORE_CONTROLS)[number];
type Point = Record<Control, number>;

const resets = (rig: TapeRig): number =>
  rig.dsp.magnetic.oversamplers.reduce((sum, pair) => sum + pair.core.resets, 0);

interface Run {
  rig: TapeRig;
  rate: number;
  /** The next sample's index, which the tone and the blocks count from. */
  n: number;
}

/** One sample: at each block's start `controls` writes the parameters, then `configure`. */
function tick(run: Run, controls: () => void): number {
  const { rig, rate } = run;
  if (run.n % QUANTUM === 0) {
    controls();
    rig.dsp.configure(rig.params, QUANTUM);
  }
  const x = sine((2 * Math.PI * HZ * run.n) / rate);
  run.n++;
  rig.dsp.tick(x, x);
  return rig.dsp.left;
}

/** The four corners of the two controls other than `knob`. */
function corners(knob: Control): Point[] {
  const [a, b] = TAPE_CORE_CONTROLS.filter((c) => c !== knob) as [Control, Control];
  return TAPE_CORE_BOUNDS[a].flatMap((x) =>
    TAPE_CORE_BOUNDS[b].map((y) => ({ drive: NaN, width: NaN, saturation: NaN, [a]: x, [b]: y })),
  );
}

/** The largest |y| and the largest |y − previous| over a stretch. */
interface Peaks {
  peak: number;
  step: number;
  last: number;
}

function track(peaks: Peaks, y: number): void {
  peaks.peak = Math.max(peaks.peak, Math.abs(y));
  peaks.step = Math.max(peaks.step, Math.abs(y - peaks.last));
  peaks.last = y;
}

interface Sweep {
  knob: Control;
  at: Point;
  from: number;
  to: number;
}

/**
 * The tone settles on `from`, then the knob moves to `to` over `SWEEP` and
 * holds. Returns the worst sample and the worst step over their references:
 * the larger of the steady values over the last four cycles before and after.
 */
function sweepKnob(run: Run, { knob, at, from, to }: Sweep): { peak: number; step: number } {
  const period = run.rate / HZ;
  const settle = Math.round((run.rate * SETTLE) / period) * period,
    sweep = Math.round(run.rate * SWEEP),
    hold = Math.round((run.rate * HOLD) / period) * period;
  const params = run.rig.params;
  const set =
    (value: number): (() => void) =>
    () => {
      for (const c of TAPE_CORE_CONTROLS)
        params[TAPE_CORE_PARAMS[c]]![0] = c === knob ? value : at[c];
    };
  const before: Peaks = { peak: 0, step: 0, last: 0 };
  for (let i = 0; i < settle; i++) {
    const y = tick(run, set(from));
    if (i >= settle - 4 * period) track(before, y);
    else before.last = y;
  }
  const start = run.n,
    during: Peaks = { ...before, peak: 0, step: 0 },
    after: Peaks = { peak: 0, step: 0, last: 0 };
  for (let i = 0; i < sweep + hold; i++) {
    const y = tick(run, () => set(from + (to - from) * Math.min(1, (run.n - start) / sweep))());
    if (i >= sweep + hold - 4 * period) track(after, y);
    after.last = y;
    track(during, y);
  }
  return {
    peak: during.peak / Math.max(before.peak, after.peak),
    step: during.step / Math.max(before.step, after.step),
  };
}

/** `knob` from its minimum to its maximum and back, each sweep held to `BOUND`. */
function sweepBothWays(run: Run, knob: Control, at: Point, label: string): void {
  const [lo, hi] = TAPE_CORE_BOUNDS[knob];
  for (const [from, to] of [
    [lo, hi],
    [hi, lo],
  ] as const) {
    const factor = run.rig.params.oversampling![0];
    const name = `${run.rate} Hz ${factor}× ${label} ${knob} ${from}→${to} at ${JSON.stringify(at)}`;
    const { peak, step } = sweepKnob(run, { knob, at, from, to });
    expect(peak, name).toBeLessThanOrEqual(BOUND);
    expect(step, name).toBeLessThanOrEqual(BOUND);
  }
}

describe('turning the Advanced knobs under a tone (windsor#291)', () => {
  it("sweeps to windsor#315's box edges, Bend 0.05 and Width 0.85 among them", () => {
    expect(TAPE_CORE_BOUNDS).toEqual({ drive: [0.05, 1], width: [0.05, 0.85], saturation: [0, 1] });
    expect(corners('saturation')).toContainEqual({ drive: 0.05, width: 0.85, saturation: NaN });
  });

  it.each(RATES)(
    'at %i Hz, Drive 0 and +32, 2× then 4×: no reset, no lift and no jump',
    (rate) => {
      for (const drive of [0, TAPE_BOUNDS.drive[1]]) {
        const core = { drive: 0.5, width: 0.3, saturation: 0.5 };
        const run: Run = { rig: tapeRig({ drive, core }, rate), rate, n: 0 };
        for (const oversampling of TAPE_OVERSAMPLING) {
          run.rig.params.oversampling![0] = oversampling;
          for (const knob of TAPE_CORE_CONTROLS)
            for (const at of corners(knob)) sweepBothWays(run, knob, at, `Drive ${drive}`);
          expect(run.rig.dsp.magnetic.factor).toBe(oversampling);
        }
        expect(resets(run.rig)).toBe(0);
      }
    },
    300_000,
  );
});
