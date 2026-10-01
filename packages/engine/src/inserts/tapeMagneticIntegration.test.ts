/**
 * The magnetic core inside the shipped Tape insert (windsor#224): the
 * calibration, guard and slew tests (a) to (e) of design decision 3 in
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`.
 *
 * Every render runs the generated bundle one sample at a time
 * (`__fixtures__/tapeDspProbe.ts`) and reads the left core's stage points:
 * the field a test reports is the source field the guard let through, the
 * knee undone. "Full scale" is a peak of 1. What a test records rather than
 * gates (the guard counts where the guard is expected to act, the models'
 * gains, the slew case's resets) it prints, and the PR and the decision
 * record `2026-09-30-tape-magnetic-integration.md` carry the figures.
 * `tapeMagneticIntegrationLatency.test.ts` holds decision 4's delay tests
 * and `tapeMagneticIntegrationSwitch.test.ts` the model rows and the
 * oversampling switch.
 */
import { describe, expect, it } from 'vitest';
import { renderTape, tapeRig } from '../__fixtures__/tapeDspProbe';
import { mulberry32 } from '../sequencing/mulberry32';
import { TAPE_BOUNDS, TAPE_OVERSAMPLING, TAPE_TYPES } from './tapeConstants';
import { TAPE_MAGNETIC } from './tapeMagneticConstants';
import { sine } from './tapePortableMath';

const RATE = 48000;
/** A render test's budget: the heavier ones take a few seconds on one core. */
const SLOW = 30_000;
const [DRIVE_MIN, DRIVE_MAX] = TAPE_BOUNDS.drive;
const [BIAS_MIN, BIAS_MAX] = TAPE_BOUNDS.bias;
/** A fifth of a second: 20 cycles of 100 Hz, 200 of 1 kHz. */
const FRAMES = RATE / 5;
/** Past the pair's fixed delay and the first cycles, for the steady peak. */
const SETTLE = RATE / 100;

/** A tone at `level` of full scale, from `sine`, so the input is the same bits everywhere. */
const tone =
  (hz: number, level = 1) =>
  (n: number): number =>
    level * sine((2 * Math.PI * hz * n) / RATE);
/** A full-scale impulse up, then one down. */
const impulses = (n: number): number => (n === RATE / 50 ? 1 : n === RATE / 10 ? -1 : 0);
/** Full-scale steps: 0 → 1 → 0 → −1 → 0, each held 40 ms. */
const steps = (n: number): number => [0, 1, 0, -1, 0][Math.min(4, Math.floor(n / (RATE / 25)))]!;
const db = (gain: number): string => (20 * Math.log10(gain)).toFixed(2);

describe('the calibration point (a)', () => {
  it.each(TAPE_OVERSAMPLING)(
    'reaches source field 1.000 on a full-scale 1 kHz tone at Drive 0, EQ bypassed, at %ix',
    (oversampling) => {
      const rig = tapeRig({ drive: 0, oversampling }, RATE, false);
      const run = renderTape(rig, tone(1000), FRAMES, { settle: SETTLE });
      expect(run.field).toBeCloseTo(TAPE_MAGNETIC.knee, 3);
      expect(Math.abs(run.field - 1)).toBeLessThanOrEqual(0.001);
      expect(run.guards).toBe(0);
      expect(run.resets).toBe(0);
    },
  );

  it(
    "reports each model's 1 kHz gain at Bias 0",
    () => {
      const rows = TAPE_TYPES.map((model) => {
        const run = renderTape(tapeRig({ model }), tone(1000), FRAMES, { settle: RATE / 20 });
        expect(run.field).toBeGreaterThan(0);
        expect(run.resets).toBe(0);
        return `${model}: field ${run.field.toFixed(4)} (${db(run.field)} dB)`;
      });
      console.info(`1 kHz full scale, Drive 0, Bias 0:\n${rows.join('\n')}`);
    },
    SLOW,
  );
});

describe('the guard with the EQ bypassed (b)', () => {
  const drives = [DRIVE_MIN, DRIVE_MIN / 2, 0, DRIVE_MAX / 2, DRIVE_MAX];
  const cases = TAPE_OVERSAMPLING.flatMap((oversampling) =>
    drives.map((drive) => [oversampling, drive] as const),
  );

  it.each(cases)(
    'never reaches the guard or resets on full-scale tones and impulses at %ix, Drive %i',
    (oversampling, drive) => {
      for (const signal of [tone(100), tone(1000), impulses]) {
        const run = renderTape(tapeRig({ drive, oversampling }, RATE, false), signal, FRAMES);
        expect(run.field).toBeLessThanOrEqual(TAPE_MAGNETIC.fieldGuard);
        expect(run.guards).toBe(0);
        expect(run.resets).toBe(0);
      }
    },
    SLOW,
  );

  it(
    'holds full-scale steps at maximum Drive within the guard, with no reset',
    () => {
      const rows = TAPE_OVERSAMPLING.map((oversampling) => {
        const rig = tapeRig({ drive: DRIVE_MAX, oversampling }, RATE, false);
        const run = renderTape(rig, steps, FRAMES);
        expect(run.field).toBeLessThanOrEqual(TAPE_MAGNETIC.fieldGuard);
        // The interpolator's overshoot carries a ×4 step past 4: the guard catches it.
        expect(run.guards).toBeGreaterThan(0);
        expect(run.resets).toBe(0);
        return `${oversampling}x: ${run.guards} stage points clipped`;
      });
      console.info(`Full-scale steps at Drive ${DRIVE_MAX}, EQ bypassed:\n${rows.join('\n')}`);
    },
    SLOW,
  );
});

describe('every model at both Bias extremes (c)', () => {
  it(
    'never resets on a full-scale 100 Hz tone at maximum Drive, at 48 kHz',
    () => {
      const rows: string[] = [];
      for (const model of TAPE_TYPES)
        for (const bias of [BIAS_MIN, 0, BIAS_MAX]) {
          const rig = tapeRig({ model, bias, drive: DRIVE_MAX });
          const run = renderTape(rig, tone(100), FRAMES);
          expect(run.field).toBeLessThanOrEqual(TAPE_MAGNETIC.fieldGuard);
          expect(run.resets).toBe(0);
          expect(run.left.every(Number.isFinite)).toBe(true);
          rows.push(`${model} Bias ${bias}: ${run.guards} clipped, field ${run.field.toFixed(3)}`);
        }
      console.info(`Full-scale 100 Hz, Drive ${DRIVE_MAX}, 48 kHz, 2x:\n${rows.join('\n')}`);
    },
    SLOW,
  );
});

describe('over-level input through Ferric at full Bias (d)', () => {
  /** Ferric's EQ impulse response at full Bias, from the bundle's own filter chain. */
  function ferricResponse(length: number): Float64Array {
    const rig = tapeRig({ model: 'ferric', bias: BIAS_MAX });
    const tones = (rig.dsp as unknown as { tones: { tick(x: number): number }[] }).tones;
    const eq = tones[TAPE_TYPES.indexOf('ferric') * 2]!;
    return Float64Array.from({ length }, (_, n) => eq.tick(n === 0 ? 1 : 0));
  }

  it(
    'engages the guard and holds the field within ±4, with no reset',
    () => {
      const response = ferricResponse(RATE / 5);
      // The sequence that drives a linear filter's output to its largest peak, Σ|h|.
      const worst = (n: number): number =>
        response[response.length - 1 - (n % response.length)]! >= 0 ? 1 : -1;
      const rows: string[] = [];
      for (const [name, signal] of [
        ['sign of the impulse response', worst],
        ['1 kHz at +6 dB over full scale', tone(1000, 2)],
      ] as const) {
        const rig = tapeRig({ model: 'ferric', bias: BIAS_MAX, drive: 0 });
        const run = renderTape(rig, signal, 4 * response.length);
        expect(run.guards, name).toBeGreaterThan(0);
        expect(run.field, name).toBeLessThanOrEqual(TAPE_MAGNETIC.fieldGuard);
        expect(run.resets, name).toBe(0);
        rows.push(`${name}: ${run.guards} clipped`);
      }
      const peak = response.reduce((sum, h) => sum + Math.abs(h), 0);
      console.info(
        `Ferric, Bias ${BIAS_MAX}, Drive 0 (Σ|h| ${peak.toFixed(3)}):\n${rows.join('\n')}`,
      );
    },
    SLOW,
  );
});

describe('the slew case, one second (e)', () => {
  it(
    'stays finite on clipped noise and alternating input at +12 dB over full scale, resets recorded',
    () => {
      const over = 4;
      const random = mulberry32(7);
      const rows: string[] = [];
      for (const [name, signal] of [
        // Noise at twice the level, hard-clipped: half its samples sit at ±4.
        [
          'white noise, clipped at ±4',
          (): number => Math.max(-over, Math.min(over, 2 * over * (2 * random() - 1))),
        ],
        ['alternating ±4', (n: number): number => (n % 2 ? -over : over)],
      ] as const) {
        const run = renderTape(tapeRig({ model: 'studio', oversampling: 2 }), signal, RATE);
        expect(run.left.every(Number.isFinite), name).toBe(true);
        expect(run.field, name).toBeLessThanOrEqual(TAPE_MAGNETIC.fieldGuard);
        rows.push(`${name}: ${run.resets} resets, ${run.guards} clipped`);
      }
      console.info(`Slew smoke, Studio, Drive 0, 48 kHz, 2x, 1 s:\n${rows.join('\n')}`);
    },
    SLOW,
  );
});
