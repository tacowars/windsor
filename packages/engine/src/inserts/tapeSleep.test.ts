/**
 * Tape's sleep on silence (windsor#793, `worklet/tape/tapeSleep.ts`), on the shipped bundle
 * against the same bundle with `sleep: false`, the plate's method:
 *
 * - After a tone, the tape sleeps within its tail; asleep its wet path is frozen (the transport
 *   delay's write head stands still) and, with the hiss off, its output is exact zeros. A tone
 *   starting mid-block wakes it on that block, and the whole render stays within
 *   `WOKEN_BOUND` of the tape that never slept: no click, at 44.1, 48 and 96 kHz, both factors,
 *   Drive at its top and Wear's motion running asleep.
 * - With the hiss on (the issue's decision 3), the asleep tape hisses on silence to the bit of
 *   the tape that never slept, and once the hiss is turned off it lands on exact zeros.
 *
 * Measured on Node 24 (arm64): the tape slept 0.203 s after the tone at the defaults and 0.251 s
 * at VHS, Drive +32 (the DC block's settle, then the ring), and every woken render read within
 * 1.2e-7 of the never-sleeping one, a float32 ulp of the tone. The bounds are a little over.
 */
import { describe, expect, it } from 'vitest';
import { loadTape, tapeParams, type TapeProcessorLike } from '../__fixtures__/tapeHarness';
import type { TapeSpec } from './tapeSpec';

const Q = 128;
/** Seconds from the tone's end to the first asleep block: the DC block's settle and the ring. */
const TAIL_BOUND = 0.3;
const WOKEN_BOUND = 1e-6;

interface Tape {
  tape: TapeProcessorLike;
  params: Record<string, Float32Array>;
  left: Float32Array;
  right: Float32Array;
}

function tape(spec: Partial<TapeSpec>, sleep: boolean, rate = 48000): Tape {
  const params = tapeParams(spec);
  return {
    tape: loadTape(rate, params, { sleep }),
    params,
    left: new Float32Array(Q),
    right: new Float32Array(Q),
  };
}

/** One block of `signal` from sample `at`, or of no input at all; returns the block's left and right. */
function block(t: Tape, at: number, signal: ((n: number) => number) | null): Float32Array[] {
  const out = [new Float32Array(Q), new Float32Array(Q)];
  if (signal === null) {
    t.tape.process([], [out], t.params);
    return out;
  }
  for (let i = 0; i < Q; i++) t.left[i] = t.right[i] = signal(at + i);
  t.tape.process([[t.left, t.right]], [out], t.params);
  return out;
}

const peakDiff = (a: Float32Array[], b: Float32Array[]): number =>
  Math.max(...a.map((channel, c) => Math.max(...channel.map((v, i) => Math.abs(v - b[c]![i]!)))));

describe('the tape asleep on silence (windsor#793)', () => {
  const cases: [number, Partial<TapeSpec>][] = [
    [48000, {}],
    [44100, { model: 'vhs', drive: 32 }],
    [96000, { oversampling: 4, drive: 24 }],
    [48000, { wear: 60 }],
  ];

  it.each(cases)(
    'at %i Hz, %j: sleeps within its tail, frozen and silent, and wakes on the block of a tone, continuous',
    (rate, spec) => {
      const toneEnd = Math.round(0.2 * rate),
        wakeAt = Math.round(0.8 * rate) + Q / 2;
      const signal = (n: number): number =>
        n < toneEnd || n >= wakeAt ? 0.5 * Math.sin((2 * Math.PI * 220 * n) / rate) : 0;
      const sleeping = tape(spec, true, rate),
        awake = tape(spec, false, rate);
      let slept = -1,
        held = -1,
        worst = 0;
      for (let at = 0; at < Math.round(1.2 * rate); at += Q) {
        const out = block(sleeping, at, signal);
        worst = Math.max(worst, peakDiff(out, block(awake, at, signal)));
        const dsp = sleeping.tape.dsp;
        if (at + Q <= wakeAt) {
          if (!dsp.asleep) continue;
          // The block that fell asleep rendered awake; every one after it, asleep.
          if (slept < 0) [slept, held] = [at + Q, dsp.position];
          else expect(out.every((channel) => channel.every((v) => v === 0))).toBe(true);
          expect(dsp.position, 'the wet path frozen').toBe(held);
        } else if (at <= wakeAt) expect(dsp.asleep, 'woken on the block of the tone').toBe(false);
      }
      expect(slept).toBeGreaterThan(toneEnd);
      expect((slept - toneEnd) / rate).toBeLessThan(TAIL_BOUND);
      expect(worst).toBeLessThan(WOKEN_BOUND);
    },
    30_000,
  );

  it('hisses asleep on silence to the bit of a tape that never sleeps, and lands on zeros with the hiss off', () => {
    const sleeping = tape({ hiss: -30 }, true),
      awake = tape({ hiss: -30 }, false);
    let energy = 0;
    for (let b = 0; b < 200; b++) {
      const out = block(sleeping, b * Q, null);
      expect(out).toEqual(block(awake, b * Q, null));
      energy += out[0]!.reduce((sum, v) => sum + v * v, 0);
    }
    expect(sleeping.tape.dsp.asleep).toBe(true);
    expect(energy).toBeGreaterThan(0);
    sleeping.params.hiss![0] = awake.params.hiss![0] = -70;
    let last: Float32Array[] = [];
    for (let b = 0; b < 200; b++) {
      last = block(sleeping, b * Q, null);
      expect(peakDiff(last, block(awake, b * Q, null))).toBeLessThan(1e-9);
    }
    expect(last.every((channel) => channel.every((v) => v === 0))).toBe(true);
  });
});

/**
 * Controls moved while the tape sleeps (windsor#802): an asleep frame steps the controls, the
 * switch's fade, the motion and the noise as an awake one does, so a wake mid-glide renders what
 * a tape that never slept renders, within `GLIDE_BOUND`.
 */
describe('the tape asleep through control changes (windsor#802)', () => {
  /** The block the tone ends on, and the first block of the tone that wakes it, at 48 kHz. */
  const TONE_END = 75;
  const WAKE = 250;
  const END = WAKE + 120;
  const GLIDE_BOUND = 1e-7;
  type Change = (params: Record<string, Float32Array>) => void;
  const set =
    (values: Record<string, number>): Change =>
    (params) => {
      for (const [name, value] of Object.entries(values)) params[name]![0] = value;
    };

  /** `spec` through `changes` (by block) with and without the sleep; the worst difference. */
  function glide(spec: Partial<TapeSpec>, changes: Map<number, Change>, level = 0.5): number {
    const signal = (n: number): number =>
      n < TONE_END * Q || n >= WAKE * Q ? level * Math.sin((2 * Math.PI * 220 * n) / 48000) : 0;
    const sleeping = tape(spec, true),
      awake = tape(spec, false);
    let worst = 0;
    for (let b = 0; b < END; b++) {
      const change = changes.get(b);
      if (change) {
        expect(sleeping.tape.dsp.asleep, `asleep at the change on block ${b}`).toBe(true);
        change(sleeping.params);
        change(awake.params);
      }
      const out = block(sleeping, b * Q, signal);
      worst = Math.max(worst, peakDiff(out, block(awake, b * Q, signal)));
      if (b === WAKE) expect(sleeping.tape.dsp.asleep, 'woken by the tone').toBe(false);
    }
    return worst;
  }

  // The last changes land a block or two before the wake, so the tape wakes mid-glide.
  const everything = new Map<number, Change>([
    [200, set({ model: 3, bias: 40, wowRate: 3, flutterRate: 15 })],
    [WAKE - 3, set({ drive: 18, trim: -6, wear: 50, wow: 10, flutter: 20, dropouts: 30 })],
    [WAKE - 2, set({ mix: 0.4, hiss: -30 })],
  ]);

  it.each<[string, Partial<TapeSpec>]>([
    ['the hiss off and the motion still', {}],
    ['Wear on', { wear: 60 }],
    ['the split dials on', { split: true, wow: 40, flutter: 70, dropouts: 100 }],
  ])('with %s, wakes mid-glide on the render of a tape that never slept', (_, spec) => {
    expect(glide(spec, everything)).toBeLessThan(GLIDE_BOUND);
  });

  it.each<[string, Partial<TapeSpec>]>([
    ['the hiss off and the motion still', {}],
    ['Wear on', { wear: 60 }],
  ])('with %s, a bypass toggled asleep fades as awake into a full-scale tone', (_, spec) => {
    const off = new Map<number, Change>([[WAKE - 1, set({ enabled: 0 })]]);
    expect(glide(spec, off, 1)).toBeLessThan(GLIDE_BOUND);
    const on = new Map<number, Change>([
      [200, set({ enabled: 0 })],
      [WAKE - 1, set({ enabled: 1 })],
    ]);
    expect(glide(spec, on, 1)).toBeLessThan(GLIDE_BOUND);
  });
});
