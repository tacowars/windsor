/**
 * Tape's output stays continuous when the magnetic core's controls move
 * (windsor#296, `docs/log/2026-10-01-tape-output-continuity.md`). The core's
 * output is M × gain, the gain the origin-susceptibility normalisation. A
 * field held still, or silence after remanence, freezes M (dM/dt is
 * proportional to dH/dt), and before this change lowering drive raised the
 * gain under it: hundreds of times the field under held DC, which the DC
 * block turned into a decaying thump. `TapeMagneticCore.retune` now rescales
 * M by the old gain over the new, so M × gain is continuous.
 *
 * Every test runs the shipped bundle (`__fixtures__/tapeDspProbe.ts`) at
 * 44.1, 48 and 96 kHz, at 2× and then 4× on one DSP per rate, and asserts no
 * core reset.
 *
 * - **A model switch in silence after a full-scale tone**, the whole path as
 *   heard: an Eulerian walk of every ordered pair of models, each a
 *   full-scale 300 Hz tone on the first for `SETTLE`, `QUIET` of silence,
 *   then the switch and `HOLD` more silence. Every sample after the switch
 *   stays within `BOUND.silence` of the tone's steady peak.
 * - **The core drive moved across [0, 1]** in the corners of the box the
 *   Advanced panel may reach (drive [0, 1], width [0.05, 0.62], saturation
 *   [0, 1]; research windsor#290 and #295), as a jump (the stage's 10 ms
 *   glide alone) and as a `SWEEP` linear sweep of the target. The panel does
 *   not exist yet, so the test writes the stage's target after each block's
 *   `configure`, as it will. The Bias and model EQ are bypassed, so the field
 *   is the input times Drive's gain: 1 at Drive 0, the knee, and 4 at +32,
 *   the guard. Drive goes from 1 to 0 under a held field at 4 (a
 *   raised-cosine onset, held through the motion, then released) and under a
 *   full-scale 300 Hz tone at 1 and at 4, and from 0 to 1 under the held
 *   field, the direction that grows M:
 *   - under a held field, every sample from the motion's start to the end of
 *     the release stays within `BOUND.fall` (drive falling) or `BOUND.rise`
 *     of the conditioned field, the measure of #290 (which read up to 242
 *     there);
 *   - under a tone, every sample stays within `BOUND.tone` of the larger of
 *     the steady peaks before and after the motion;
 *   - |M| stays within `BOUND.m`, against the state guard of 20.
 */
import { describe, expect, it } from 'vitest';
import { tapeRig, type TapeRig } from '../__fixtures__/tapeDspProbe';
import { circuit } from '../__fixtures__/tapeModelWalk';
import { TapeMagneticCore, originSusceptibility } from '../worklet/tape/tapeMagnetic';
import { TAPE_BOUNDS, TAPE_OVERSAMPLING, TAPE_TYPES } from './tapeConstants';
import { driveGain, TAPE_MAGNETIC } from './tapeMagneticConstants';
import { cosine, sine } from './tapePortableMath';

const RATES = [44100, 48000, 96000] as const;
const HZ = 300;
const QUANTUM = 128;
/**
 * The worst each check measured on Node 24 (arm64; the core's arithmetic is
 * portable, so x64 reads the same bits), as a fraction of its reference, and
 * before this change in brackets:
 *
 * - silence, 0.0798 (0.2402): the tone's own decaying tail, 20 ms on;
 * - held, 0.887 with drive falling (57.3) and 1.230 with it rising (2.88),
 *   both at 48 kHz. Rising, M grows to keep the output, past Ms, and the
 *   release then swings a little wider than the field; at constant drive 0
 *   the release alone reaches 1.216 of the field;
 * - tone, 1.0004 (1.0034);
 * - |M|, 4.97 with drive rising under the held field (1.67).
 *
 * Each ratio's gate is its measurement plus about half a point. M's, 5.5,
 * is about a tenth over its measurement and under a third of the state
 * guard.
 */
const BOUND = { silence: 0.085, fall: 0.892, rise: 1.235, tone: 1.005, m: 5.5 };
/** Seconds: a signal before the switch or the motion, the silence before either, and the hold after. */
const SETTLE = 0.05;
const QUIET = 0.02;
const HOLD = 0.04;
/** The linear sweep's length, and the raised-cosine edge of a held field. */
const SWEEP = 0.05;
const EDGE = 0.005;
const DRIVE_MAX = TAPE_BOUNDS.drive[1];
/** The box's corners: [width, saturation]. */
const CORNERS = [
  [0.05, 0],
  [0.05, 1],
  [0.62, 0],
  [0.62, 1],
] as const;

const resets = (rig: TapeRig): number =>
  rig.dsp.magnetic.oversamplers.reduce((sum, pair) => sum + pair.core.resets, 0);

/** The knee (`tapeMagnetic.ts`'s `condition`) on a field's magnitude. */
function conditioned(field: number, table = TAPE_MAGNETIC): number {
  if (field <= table.knee) return field;
  const span = table.asymptote - table.knee,
    z = (field - table.knee) / span;
  return table.knee + span * (z / (1 + z));
}

interface Clock {
  n: number;
}

/**
 * One sample: `configure` at each block's start, then `controls` (which may
 * write the stage's target), then `x` on both channels. Returns the left output.
 */
function tick(rig: TapeRig, clock: Clock, x: number, controls?: () => void): number {
  const { dsp, params } = rig;
  if (clock.n % QUANTUM === 0) {
    dsp.configure(params, QUANTUM);
    controls?.();
  }
  clock.n++;
  dsp.tick(x, x);
  return dsp.left;
}

describe("the core's retune (windsor#296)", () => {
  const loud = { drive: 1, width: 0.05, saturation: 0 },
    quiet = { drive: 0, width: 0.62, saturation: 1 };

  it('keeps M × gain, to rounding, across the whole range of the gain', () => {
    const core = new TapeMagneticCore(48000, 2, loud);
    core.m = 0.75;
    const out = core.m * core.gain;
    core.retune(quiet);
    expect(core.gain * originSusceptibility(loud)).toBeGreaterThan(900);
    expect(core.m * core.gain).toBeCloseTo(out, 12);
    core.retune(loud);
    expect(core.m * core.gain).toBeCloseTo(out, 12);
  });

  it('leaves M to the bit when retuned to the same controls', () => {
    const core = new TapeMagneticCore(48000, 2, loud);
    core.m = 0.75;
    core.retune(loud);
    expect(core.m).toBe(0.75);
  });
});

describe('switching models in silence after a tone (windsor#296)', () => {
  const walk = circuit(TAPE_TYPES.length);

  /** The walk at the rig's factor; returns the worst post-switch peak over the tone's steady peak. */
  function walkInSilence(rig: TapeRig, rate: number, clock: Clock): number {
    const period = rate / HZ;
    const tone = Math.round((rate * SETTLE) / period) * period,
      quiet = Math.round(rate * QUIET),
      hold = Math.round(rate * HOLD);
    let worst = 0;
    for (let s = 1; s < walk.length; s++) {
      rig.params.model![0] = walk[s - 1]!;
      let steady = 0,
        after = 0;
      for (let i = 0; i < tone; i++) {
        const y = tick(rig, clock, sine((2 * Math.PI * HZ * i) / rate));
        if (i >= tone - 4 * period) steady = Math.max(steady, Math.abs(y));
      }
      for (let i = 0; i < quiet; i++) tick(rig, clock, 0);
      rig.params.model![0] = walk[s]!;
      for (let i = 0; i < hold; i++) after = Math.max(after, Math.abs(tick(rig, clock, 0)));
      worst = Math.max(worst, after / steady);
    }
    return worst;
  }

  it.each(RATES)(
    'at %i Hz, 2× then 4×: no reset, and no switch lifts the silence',
    (rate) => {
      const first = TAPE_TYPES[walk[0]!]!;
      const rig = tapeRig({ model: first, oversampling: TAPE_OVERSAMPLING[0] }, rate);
      const clock = { n: 0 };
      for (const oversampling of TAPE_OVERSAMPLING) {
        rig.params.oversampling![0] = oversampling;
        const worst = walkInSilence(rig, rate, clock);
        expect(rig.dsp.magnetic.factor).toBe(oversampling);
        expect(worst, `${rate} Hz ${oversampling}×`).toBeLessThanOrEqual(BOUND.silence);
      }
      expect(resets(rig)).toBe(0);
    },
    60_000,
  );
});

interface Trial {
  width: number;
  saturation: number;
  /** Seconds of linear sweep; 0 is a jump. */
  sweep: number;
  signal: 'held' | 'tone';
  /** The insert's Drive, which sets the field: 0 puts a full-scale input at 1, its maximum at 4. */
  drive: number;
  /** The core's drive control before and after the motion. */
  from: number;
  to: number;
}

/** What a trial measured: the worst sample over its reference, and the largest |M| on the left core. */
interface Excursion {
  ratio: number;
  m: number;
}

/** The stage's target for this block: `drive`, and the trial's width and saturation. */
function aim(rig: TapeRig, trial: Trial, drive: number): void {
  const m = rig.dsp.magnetic,
    t = m.target,
    c = m.controls;
  t.drive = drive;
  t.width = trial.width;
  t.saturation = trial.saturation;
  if (c.drive !== t.drive || c.width !== t.width || c.saturation !== t.saturation) m.gliding = true;
}

/** The trial's input at sample `i` of its signal: the tone, or the held field's onset and hold. */
function input(trial: Trial, rate: number, i: number): number {
  if (trial.signal === 'tone') return sine((2 * Math.PI * HZ * i) / rate);
  const edge = Math.round(rate * EDGE);
  return i < edge ? 0.5 - 0.5 * cosine((Math.PI * i) / edge) : 1;
}

/**
 * One trial: the controls glide to `from` in silence, the signal settles,
 * the core drive moves to `to`, and it holds; a held field is then released
 * and its tail read. The reference is the conditioned field for a held
 * field, and the larger steady peak before and after the motion for a tone.
 */
function sweepDrive(rig: TapeRig, rate: number, clock: Clock, trial: Trial): Excursion {
  const period = rate / HZ;
  const settle = Math.round((rate * SETTLE) / period) * period,
    hold = Math.round((rate * HOLD) / period) * period,
    sweep = Math.round(rate * trial.sweep),
    edge = Math.round(rate * EDGE);
  rig.params.drive![0] = trial.drive;
  for (let i = 0; i < rate * QUIET; i++) tick(rig, clock, 0, () => aim(rig, trial, trial.from));
  const core = rig.dsp.magnetic.active[0]!.core;
  let before = 0,
    after = 0,
    worst = 0,
    m = 0;
  for (let i = 0; i < settle; i++) {
    const y = tick(rig, clock, input(trial, rate, i), () => aim(rig, trial, trial.from));
    if (i >= settle - 4 * period) before = Math.max(before, Math.abs(y));
  }
  const startFrame = clock.n,
    span = trial.to - trial.from;
  // At each block's start: `from` to `to` over `sweep` frames, or `to` at once.
  const drive = (): number =>
    sweep === 0 ? trial.to : trial.from + span * Math.min(1, (clock.n - startFrame) / sweep);
  for (let i = settle; i < settle + sweep + hold; i++) {
    const y = tick(rig, clock, input(trial, rate, i), () => aim(rig, trial, drive()));
    worst = Math.max(worst, Math.abs(y));
    m = Math.max(m, Math.abs(core.m));
    if (i >= settle + sweep + hold - 4 * period) after = Math.max(after, Math.abs(y));
  }
  if (trial.signal === 'tone') return { ratio: worst / Math.max(before, after), m };
  for (let k = 0; k < edge + hold; k++) {
    const x = k < edge ? 0.5 + 0.5 * cosine((Math.PI * k) / edge) : 0;
    worst = Math.max(worst, Math.abs(tick(rig, clock, x, () => aim(rig, trial, trial.to))));
    m = Math.max(m, Math.abs(core.m));
  }
  return { ratio: worst / conditioned(driveGain(trial.drive)), m };
}

/** Down under a held field at the guard and under tones at the knee and the guard; up under the held field. */
const TRIALS: Trial[] = CORNERS.flatMap(([width, saturation]) =>
  [0, SWEEP].flatMap((sweep) => [
    { width, saturation, sweep, signal: 'held' as const, drive: DRIVE_MAX, from: 1, to: 0 },
    { width, saturation, sweep, signal: 'tone' as const, drive: 0, from: 1, to: 0 },
    { width, saturation, sweep, signal: 'tone' as const, drive: DRIVE_MAX, from: 1, to: 0 },
    { width, saturation, sweep, signal: 'held' as const, drive: DRIVE_MAX, from: 0, to: 1 },
  ]),
);

describe('moving the core drive across [0, 1] (windsor#296)', () => {
  it.each(RATES)(
    'at %i Hz, 2× then 4×, across the box: no reset, and held, tone and M peaks bounded',
    (rate) => {
      const rig = tapeRig({ oversampling: TAPE_OVERSAMPLING[0] }, rate, false);
      const clock = { n: 0 };
      for (const oversampling of TAPE_OVERSAMPLING) {
        rig.params.oversampling![0] = oversampling;
        for (const trial of TRIALS) {
          const { ratio, m } = sweepDrive(rig, rate, clock, trial);
          const name = `${rate} Hz ${oversampling}× ${JSON.stringify(trial)}`;
          const gate = trial.signal === 'tone' ? 'tone' : trial.to < trial.from ? 'fall' : 'rise';
          expect(ratio, name).toBeLessThanOrEqual(BOUND[gate]);
          expect(m, name).toBeLessThanOrEqual(BOUND.m);
        }
        expect(rig.dsp.magnetic.factor).toBe(oversampling);
      }
      expect(resets(rig)).toBe(0);
    },
    120_000,
  );
});
