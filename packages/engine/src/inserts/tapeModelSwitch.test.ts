/**
 * The live model switch (design decision 6 of
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`, windsor#289
 * decision 2): now that every model has its own magnetic row, switching
 * models under a steady full-scale tone glides the core's three controls with
 * the 10 ms time constant and keeps the magnetization. The glide passes
 * through control points the survival record did not sample, and this test is
 * the evidence for them.
 *
 * Per rate (44.1, 48 and 96 kHz), one shipped DSP (`__fixtures__/tapeDspProbe.ts`,
 * the whole path as heard: Bias and model EQ, Drive 0, the core, the DC block,
 * Mix 1) plays a full-scale 300 Hz sine, a whole number of samples per cycle
 * at every rate, at 2× and then at 4×. At each factor it first reads every
 * model's steady peak after 100 ms on it, then walks an Eulerian circuit of
 * the seven models, so each of the 42 ordered pairs is one switch, held 60 ms
 * (six time constants) before the next. Across every switch: no state reset
 * on any core, no sample above the larger steady peak of the pair, and no
 * cycle whose peak falls below the smaller, each within `GLIDE_TOLERANCE`.
 * One DSP per rate rather than per factor: in one process, the sixth bundle
 * instance ran this loop about five times slower than the first five.
 *
 * The tolerance is the glide's intermediate states, not its steps (the
 * 2026-10-01 amendment to decision 6). The stage glides the controls and
 * retunes the active cores every sample, so the core's coefficients and
 * normalisation never step; it glides the model EQ's crossfade with the same
 * 10 ms time constant. Each moment of the glide is then a point between the
 * two models, and some of those points have a steady peak outside the
 * envelope of the ends. Frozen at points along Ferric to Metal (44.1 kHz,
 * 4×), the whole path's steady peak reached 1.014 of Metal's at four fifths
 * of the way, Ferric's EQ still lifting the level into a core already near
 * Metal's ceiling; along 30ips Studio to Vintage it dipped to 0.987 of
 * Studio's. Measured on Node 24 (arm64), this walk's worst sample is 1.0189
 * of the larger steady peak (Metal to Ferric, 96 kHz, at 2× and 4×) and its
 * lowest cycle peak 0.9862 of the smaller (Vintage to 30ips Studio, 96 kHz);
 * `MEASURED` holds both. Since windsor#296 the core keeps M × gain through a
 * retune, so the normalisation no longer lifts or drops the magnetization
 * the glide carries; before it, the worst was 1.0213 (Ferric to Metal, 4×,
 * 44.1 kHz) and the lowest 0.9599 (30ips Studio to Vintage). The test allows
 * each a tenth of a point more (`MARGIN`): the core's arithmetic is portable
 * (`tapePortableMath.ts`), so x64 reads the same bits and the margin only
 * absorbs a harmless change, and the gate stays under 2%. The
 * per-block reconfiguration this replaced reached 1.075 here, and 1.093 with
 * the EQ bypassed. A last test holds a finished glide to the constant render:
 * once settled, every core is tuned exactly as a DSP started on the model.
 * The last two hold the song's `core` (windsor#291) through the same walk
 * and clear it back to a model's row.
 * Runs in about 25 s.
 */
import { describe, expect, it } from 'vitest';
import { tapeRig, type TapeRig } from '../__fixtures__/tapeDspProbe';
import { circuit } from '../__fixtures__/tapeModelWalk';
import { TapeMagneticCore, originSusceptibility } from '../worklet/tape/tapeMagnetic';
import { magneticControls } from '../worklet/tape/tapeMagneticRows';
import { TAPE_MODELS, TAPE_OVERSAMPLING, TAPE_TYPES } from './tapeConstants';
import { sine } from './tapePortableMath';

const RATES = [44100, 48000, 96000] as const;
const HZ = 300;
const QUANTUM = 128;
const STEADY_SECONDS = 0.1;
const HOLD_SECONDS = 0.06;
/** This walk's worst excursions past the envelope, as fractions of the steady peak (see above). */
const MEASURED = { above: 0.0189, below: 0.0138 };
/** The allowance past each measured excursion. */
const MARGIN = 0.001;
/** A finished glide's longest possible run: a whole-range step snaps within about 16 time constants. */
const SETTLE_SECONDS = 0.2;

/** Every field the core derives from its controls and rate. */
const TUNING = [
  'ms',
  'invA',
  'reversibleGain',
  'irreversible',
  'irreversibleK',
  'dt',
  'susceptibility',
  'gain',
] as const;

/** `frames` samples of the tone from sample `start`, both channels, each left output to `each`. */
function play(
  rig: TapeRig,
  rate: number,
  start: number,
  frames: number,
  each: (y: number) => void,
) {
  const { dsp, params } = rig;
  for (let n = start; n < start + frames; n++) {
    if (n % QUANTUM === 0) dsp.configure(params, QUANTUM);
    const x = sine((2 * Math.PI * HZ * n) / rate);
    dsp.tick(x, x);
    each(dsp.left);
  }
}

const resets = (rig: TapeRig): number =>
  rig.dsp.magnetic.oversamplers.reduce((sum, pair) => sum + pair.core.resets, 0);

describe('switching tape models live (decision 6)', () => {
  const walk = circuit(TAPE_TYPES.length);

  it('walks every ordered pair of models exactly once', () => {
    const pairs = walk.slice(1).map((b, s) => `${walk[s]}>${b}`);
    expect(pairs).toHaveLength(TAPE_TYPES.length * (TAPE_TYPES.length - 1));
    expect(new Set(pairs).size).toBe(pairs.length);
    expect(pairs.every((pair) => pair[0] !== pair[2])).toBe(true);
  });

  /** Each model's steady peak, from `STEADY_SECONDS` on it in turn, ending on the walk's first model. */
  function steadyPeaks(rig: TapeRig, rate: number, at: { n: number }): number[] {
    const period = rate / HZ;
    const frames = Math.round((rate * STEADY_SECONDS) / period) * period;
    const steady: number[] = [];
    for (const model of TAPE_TYPES.map((_, i) => (i + 1) % TAPE_TYPES.length)) {
      rig.params.model![0] = model;
      play(rig, rate, at.n, frames, () => {});
      at.n += frames;
      let peak = 0;
      play(rig, rate, at.n, 4 * period, (y) => (peak = Math.max(peak, Math.abs(y))));
      at.n += 4 * period;
      steady[model] = peak;
    }
    return steady;
  }

  /** The walk from its first model: each switch held `HOLD_SECONDS`, checked against the pair's steady peaks. */
  function walkModels(rig: TapeRig, rate: number, at: { n: number }, steady: number[]): void {
    const period = rate / HZ;
    const hold = Math.round((rate * HOLD_SECONDS) / period) * period;
    for (let s = 1; s < walk.length; s++) {
      const from = steady[walk[s - 1]!]!,
        to = steady[walk[s]!]!;
      rig.params.model![0] = walk[s]!;
      let worst = 0,
        cyclePeak = 0,
        lowest = Infinity,
        i = 0;
      play(rig, rate, at.n, hold, (y) => {
        worst = Math.max(worst, Math.abs(y));
        cyclePeak = Math.max(cyclePeak, Math.abs(y));
        if (++i % period === 0) {
          lowest = Math.min(lowest, cyclePeak);
          cyclePeak = 0;
        }
      });
      at.n += hold;
      const pair = `${rate} Hz ${rig.dsp.magnetic.factor}×, ${TAPE_TYPES[walk[s - 1]!]} to ${TAPE_TYPES[walk[s]!]}`;
      expect(worst, pair).toBeLessThanOrEqual(Math.max(from, to) * (1 + MEASURED.above + MARGIN));
      expect(lowest, pair).toBeGreaterThanOrEqual(
        Math.min(from, to) * (1 - MEASURED.below - MARGIN),
      );
    }
  }

  // One DSP per rate, 2× then 4×: the factor switch starts the 4× pair from rest, and the
  // steady peaks are read again at the new factor before its walk.
  it.each(RATES)(
    'at %i Hz, 2× then 4×: no reset, and every sample inside the two steady states',
    (rate) => {
      expect(walk[0]).toBe(0);
      const rig = tapeRig({ model: TAPE_TYPES[1], oversampling: TAPE_OVERSAMPLING[0] }, rate);
      const at = { n: 0 };
      for (const oversampling of TAPE_OVERSAMPLING) {
        rig.params.oversampling![0] = oversampling;
        walkModels(rig, rate, at, steadyPeaks(rig, rate, at));
        expect(rig.dsp.magnetic.factor).toBe(oversampling);
      }
      expect(resets(rig)).toBe(0);
    },
    60_000,
  );

  it("retunes every row to exactly the floor check's susceptibility", () => {
    for (const { magnetic } of TAPE_MODELS) {
      const controls = magneticControls(magnetic, { drive: NaN, width: NaN, saturation: NaN });
      const core = new TapeMagneticCore(48000, 2, controls);
      core.retune(controls);
      expect(core.susceptibility).toBe(originSusceptibility(controls));
    }
  });

  it('ends a glide on the row itself, every core tuned as a DSP started there', () => {
    const rate = 48000;
    const rig = tapeRig({ model: TAPE_TYPES[1] }, rate);
    const fresh = tapeRig({ model: TAPE_TYPES[5] }, rate).dsp.magnetic.oversamplers;
    expect(rig.dsp.magnetic.gliding).toBe(false);
    rig.params.model![0] = 5;
    let glided = 0;
    play(rig, rate, 0, rate * SETTLE_SECONDS, () => (glided += rig.dsp.magnetic.gliding ? 1 : 0));
    expect(glided).toBeGreaterThan(0);
    expect(rig.dsp.magnetic.gliding).toBe(false);
    rig.dsp.magnetic.oversamplers.forEach(({ core }, i) => {
      for (const field of TUNING) expect(core[field], field).toBe(fresh[i]!.core[field]);
    });
  });
});

/**
 * The song's `core` (windsor#291): while one is set the core plays it on
 * every model, so a model switch moves the EQ alone, and clearing it (Use
 * model, or a starting point) glides the core to the model's row with the
 * same 10 ms time constant, ending on the row exactly as a DSP started there.
 */
describe("switching tape models live with the song's core set (windsor#291)", () => {
  const core = { drive: 0.2, width: 0.55, saturation: 0.9 };

  it.each(RATES)(
    'at %i Hz, 2× then 4×: the core stays on its controls through every switch, with no reset',
    (rate) => {
      const walk = circuit(TAPE_TYPES.length);
      const rig = tapeRig({ model: TAPE_TYPES[walk[0]!]!, core }, rate);
      const held = { ...rig.dsp.magnetic.controls };
      const hold = Math.round(rate * HOLD_SECONDS);
      const at = { n: 0 };
      for (const oversampling of TAPE_OVERSAMPLING) {
        rig.params.oversampling![0] = oversampling;
        for (const model of walk) {
          rig.params.model![0] = model;
          play(rig, rate, at.n, hold, () => {
            expect(rig.dsp.magnetic.gliding).toBe(false);
          });
          at.n += hold;
          expect({ ...rig.dsp.magnetic.controls }).toEqual(held);
        }
      }
      expect(resets(rig)).toBe(0);
    },
    60_000,
  );

  it("clears to the model's row with a glide that ends as a DSP started there", () => {
    const rate = 48000;
    const rig = tapeRig({ model: TAPE_TYPES[1], core }, rate);
    const fresh = tapeRig({ model: TAPE_TYPES[3] }, rate).dsp.magnetic.oversamplers;
    rig.params.model![0] = 3;
    rig.params.core![0] = 0;
    let glided = 0;
    play(rig, rate, 0, rate * SETTLE_SECONDS, () => (glided += rig.dsp.magnetic.gliding ? 1 : 0));
    expect(glided).toBeGreaterThan(0);
    expect(rig.dsp.magnetic.gliding).toBe(false);
    expect(resets(rig)).toBe(0);
    rig.dsp.magnetic.oversamplers.forEach(({ core: tuned }, i) => {
      for (const field of TUNING) expect(tuned[field], field).toBe(fresh[i]!.core[field]);
    });
  });
});
