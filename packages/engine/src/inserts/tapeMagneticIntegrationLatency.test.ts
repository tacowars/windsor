/**
 * The shipped Tape insert's delays (windsor#224, design decision 4 of
 * `docs/log/2026-09-30-tape-magnetic-integration-design.md`): the magnetic
 * core's FIR pair delays the wet path by `latency` host samples, and the dry
 * path of Mix and bypass is delayed by the same, so at zero motion toggling
 * Enabled and moving Mix never shift the fixed delay; the transport's
 * variable delay stays on the wet path alone, after the core. The last test
 * reports, without a gate, the wet path's phase against the delayed dry
 * path across frequency, so the audition notes can say what a partial Mix
 * does. Renders run the generated bundle (`__fixtures__/tapeDspProbe.ts`).
 */
import { describe, expect, it } from 'vitest';
import { renderTape, tapeRig } from '../__fixtures__/tapeDspProbe';
import { TAPE_MAGNETIC } from './tapeMagneticConstants';
import { sine } from './tapePortableMath';

const RATE = 48000;
/** A render test's budget: the heavier ones take a few seconds on one core. */
const SLOW = 30_000;
const LATENCY = TAPE_MAGNETIC.span;
/** Where the test impulse falls: past the DC blocker's and the EQ's start-up. */
const AT = RATE / 20;
const FRAMES = AT + RATE / 20;

/** The index of the largest magnitude. */
function peakIndex(samples: Float64Array): number {
  let best = 0;
  for (let n = 1; n < samples.length; n++)
    if (Math.abs(samples[n]!) > Math.abs(samples[best]!)) best = n;
  return best;
}

describe('the fixed delay at zero motion', () => {
  // A small impulse, EQ bypassed: the core is at unity small-signal gain, so the
  // wet peak is where the pair's symmetric response centres it.
  const impulse = (n: number): number => (n === AT ? 0.01 : 0);

  it('delays the bypassed path by exactly the latency, and the wet path by the same', () => {
    const bypassed = renderTape(tapeRig({ enabled: false }, RATE, false), impulse, FRAMES).left;
    expect(peakIndex(bypassed)).toBe(AT + LATENCY);
    expect(bypassed[AT + LATENCY]).toBe(0.01);
    expect(bypassed.filter((v) => v !== 0)).toHaveLength(1);
    for (const mix of [1, 0.5]) {
      const wet = renderTape(tapeRig({ mix }, RATE, false), impulse, FRAMES).left;
      expect(peakIndex(wet), `Mix ${mix}`).toBe(AT + LATENCY);
      expect(wet.slice(0, AT).every((v) => Math.abs(v) < 1e-6)).toBe(true);
    }
  });

  it('keeps the dry path of Mix 0 exactly the delayed input, with motion on', () => {
    const input = (n: number): number => 0.3 * sine((2 * Math.PI * 440 * n) / RATE);
    const rig = tapeRig({ mix: 0, wear: 60, hiss: -30, seed: 5 });
    const out = renderTape(rig, input, FRAMES).left;
    for (let n = 0; n < FRAMES; n++) expect(out[n]).toBe(n < LATENCY ? 0 : input(n - LATENCY));
  });
});

describe('the transport delay at fixed Wear', () => {
  it(
    "delays the wet path past the fixed delay by exactly the motion model's delay",
    () => {
      const input = (n: number): number => 0.3 * sine((2 * Math.PI * 440 * n) / RATE);
      const frames = RATE / 2;
      // Hiss off: the wet path is the core's output through the transport and dropouts alone.
      const still = renderTape(tapeRig({ wear: 0, seed: 9 }), input, frames).left;
      const rig = tapeRig({ wear: 60, seed: 9 });
      const delays = new Float64Array(frames);
      const dropouts = new Float64Array(frames);
      const moving = renderTape(rig, input, frames, {
        each: (n) => {
          delays[n] = rig.dsp.motion.delay;
          dropouts[n] = rig.dsp.motion.dropout;
        },
      }).left;
      let largest = 0,
        worst = 0;
      for (let n = RATE / 10; n < frames; n++) {
        const read = n - delays[n]!;
        const index = Math.floor(read),
          frac = read - index;
        const expected =
          (still[index]! + frac * (still[index + 1]! - still[index]!)) * (1 - dropouts[n]!);
        worst = Math.max(worst, Math.abs(moving[n]! - expected));
        largest = Math.max(largest, delays[n]!);
      }
      expect(largest).toBeGreaterThan(1);
      expect(worst).toBeLessThan(1e-9);
    },
    SLOW,
  );
});

describe('the wet path against the delayed dry path', () => {
  /** The complex amplitude of `hz` over `samples`, which hold whole cycles of it. */
  function bin(samples: Float64Array, hz: number): [number, number] {
    let re = 0,
      im = 0;
    for (let n = 0; n < samples.length; n++) {
      const phase = (2 * Math.PI * hz * n) / RATE;
      re += samples[n]! * Math.cos(phase);
      im -= samples[n]! * Math.sin(phase);
    }
    return [re, im];
  }

  it(
    'reports phase and gain across frequency at a low level and at full scale',
    () => {
      const rows: string[] = [];
      // A tenth of a second holds whole cycles of every frequency, after 0.15 s to settle.
      const frames = RATE / 4,
        window = RATE / 10;
      for (const level of [0.01, 1])
        for (const hz of [50, 100, 250, 1000, 4000, 10000]) {
          const input = (n: number): number => level * sine((2 * Math.PI * hz * n) / RATE);
          const wet = renderTape(tapeRig({}), input, frames).left.slice(frames - window);
          const dry = Float64Array.from({ length: window }, (_, n) =>
            input(frames - window + n - LATENCY),
          );
          const [wr, wi] = bin(wet, hz),
            [dr, di] = bin(dry, hz);
          const phase = (Math.atan2(wi * dr - wr * di, wr * dr + wi * di) * 180) / Math.PI;
          const gain = 10 * Math.log10((wr * wr + wi * wi) / (dr * dr + di * di));
          expect(Number.isFinite(phase) && Number.isFinite(gain)).toBe(true);
          rows.push(`${level} ${hz} Hz: ${phase.toFixed(1)}°, ${gain.toFixed(2)} dB`);
        }
      console.info(`Studio, Bias 0, Drive 0, 2x, wet vs delayed dry:\n${rows.join('\n')}`);
    },
    SLOW,
  );
});
