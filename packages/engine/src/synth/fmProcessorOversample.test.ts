/**
 * The synced voice at twice the rate through the shipped worklet
 * (windsor#656, record `2026-10-09-sync-voice-at-2x`): which voices take it
 * (decision 1), the rate kept for a note's life through a live edit and a
 * lane, the decimator's 16 samples of delay and the level against the same
 * patch at the part's rate (decisions 4 and 5), a voice at twice the rate
 * stolen, gliding and through the Acid ladder and the drive, and the direct
 * shape's bound read at the doubled rate. The decimator's arithmetic is
 * `worklet/fm/voiceOversample.test.ts`; the wave sets' level,
 * `worklet/fm/waveTables.test.ts`; the two sync presets' renders, the golden
 * tables.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { CreateOptions, ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makePatch } from '../patch/patch';
import type { PartialOperator, Patch } from '../patch/patch';
import { LADDER_INPUT_SCALE, LADDER_MIX_GAIN } from '../worklet/fm/fmConstants';
import { voiceSlotParamName } from './audioPart';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;
const ADDITIVE = 7;
/** Every voice at the part's rate. */
const AT_1X: CreateOptions = { syncOversample: false };
/** The decimator's delay at the part's rate: (65 − 1) / 2 samples at twice it. */
const DELAY = 16;
/** Past the attack: from here every amplitude is held. */
const SETTLED = 2048;

const HELD = { attackTime: 0.001, decayTime: 0.01, sustainLevel: 1, peakLevel: 1 };

/** Operator A as `a` says, a carrier on Additive with the others silent unless `others` sets them; the filter off. */
function patchOf(
  a: PartialOperator,
  others: PartialOperator[] = [],
  extra: Partial<Patch> = {},
): Patch {
  return makePatch({
    algorithm: ADDITIVE,
    filter: { mode: FILTER_MODE.OFF },
    ...extra,
    ops: [0, 1, 2, 3].map((i) => ({
      level: 0,
      velSens: 0,
      phaseFree: false,
      phase: 0,
      env: HELD,
      ...(i === 0 ? { level: 1, ...a } : others[i - 1]),
    })),
  });
}

const SAW: PartialOperator = { wave: WAVE.SAW, ratio: 2.37, sync: 'note' };

interface OversampleView {
  active: boolean;
  kernel: boolean;
  opRate: number;
  oversample: { factor: number };
  sync: { shape: { direct: number } };
}
const view = (p: ProcessorLike, i = 0): OversampleView => p.voices[i] as unknown as OversampleView;

const on = (id: number, note: number, frame = 0): ScheduledEvent => ({
  type: 'noteOn',
  id,
  note,
  velocity: 1,
  frame,
});

/** The left channel of `events` on `patch`. */
function play(
  patch: Patch,
  options: CreateOptions = {},
  blocks = 40,
  events: ScheduledEvent[] = [on(1, 60)],
): Float32Array {
  const processor = loaded.create(patch, 4, undefined, options);
  return render(loaded, processor, blocks, events).samples.filter((_, k) => k % 2 === 0);
}

/** The bound voice after one block of a note of `patch`. */
function voiceFor(patch: Patch, options: CreateOptions = {}): OversampleView {
  const processor = loaded.create(patch, 1, undefined, options);
  render(loaded, processor, 1, [on(1, 60)]);
  return view(processor);
}

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;
const peak = (x: Float32Array, from = 0): number =>
  x.subarray(from).reduce((m, s) => Math.max(m, Math.abs(s)), 0);
const rms = (x: Float32Array, from: number, n: number): number =>
  Math.sqrt(x.subarray(from, from + n).reduce((m, s) => m + s * s, 0) / n);

describe('which voices run at twice the rate (windsor#656, decision 1)', () => {
  it('one with a synced operator, and none with a fed or a Noise operator, or with no synced one', () => {
    const twice = voiceFor(patchOf(SAW));
    expect([twice.oversample.factor, twice.opRate, twice.kernel]).toEqual([2, 2 * SR, false]);
    const fed = patchOf(SAW, [{ feedback: 0.3 }]);
    const noisy = patchOf(SAW, [{}, { wave: WAVE.NOISE }]);
    for (const patch of [fed, noisy, patchOf({ wave: WAVE.SAW })]) {
      const voice = voiceFor(patch);
      expect([voice.oversample.factor, voice.opRate]).toEqual([1, SR]);
    }
    expect(voiceFor(patchOf({ wave: WAVE.SAW })).kernel).toBe(true);
    expect(voiceFor(patchOf(SAW), AT_1X).oversample.factor).toBe(1);
  });

  it('renders a synced voice with a fed or a Noise operator as the part at its own rate does, to the bit', () => {
    for (const others of [
      [{ level: 0.3, feedback: 0.4 }],
      [{}, { level: 0.2, wave: WAVE.NOISE }],
    ]) {
      const patch = patchOf(SAW, others);
      const x = play(patch);
      expect(peak(x)).toBeGreaterThan(0.1);
      expect(sameBits(x, play(patch, AT_1X))).toBe(true);
    }
  });
});

describe('the rate kept for the note’s life (windsor#656, decision 1)', () => {
  /**
   * A note of `from`, then a live edit to `to` two blocks in, then a second
   * note after six: the left channel and each note's factor.
   */
  function edit(from: Patch, to: Patch): { x: Float32Array; first: number; second: number } {
    const processor = loaded.create(from, 4);
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    const x = new Float32Array(30 * BLOCK);
    let written = 0;
    const take = (blocks: number, events: ScheduledEvent[] = []): void => {
      const left = render(loaded, processor, blocks, events).samples.filter((_, k) => k % 2 === 0);
      x.set(left, written);
      written += left.length;
    };
    take(2, [on(1, 60)]);
    processor.inbox({ type: 'patch', patch: to } as unknown as ScheduledEvent);
    take(4);
    const first = view(processor, 0).oversample.factor;
    // The harness counts frames from 0 in each render: the note lands at once.
    take(24, [on(2, 64)]);
    const second = processor.voices
      .map((_, i) => view(processor, i))
      .find((v, i) => i > 0 && v.active)!.oversample.factor;
    return { x, first, second };
  }

  /** Two notes of either patch at once, with half again for a switch's step. */
  const bound = (a: Patch, b: Patch): number => 3 * Math.max(peak(play(a)), peak(play(b)));

  it('keeps a 1× voice at 1× when a live edit turns its sync on, and the next note takes twice the rate', () => {
    const synced = patchOf(SAW);
    const free = patchOf({ ...SAW, sync: 'off' });
    const { x, first, second } = edit(free, synced);
    expect([first, second]).toEqual([1, 2]);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeLessThanOrEqual(bound(free, synced));
  });

  it('keeps a 2× voice at twice the rate when a live edit turns its sync off, and the next note takes 1×', () => {
    const synced = patchOf(SAW);
    const free = patchOf({ ...SAW, sync: 'off' });
    const { x, first, second } = edit(synced, free);
    expect([first, second]).toEqual([2, 1]);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeLessThanOrEqual(bound(free, synced));
  });

  it('plays a feedback lane that turns on mid-note at twice the rate, finite and bounded', () => {
    const patch = patchOf(SAW, [{ level: 0.5, ratio: 1 }]);
    const processor = loaded.create(patch, 1, undefined, { voiceSlots: ['ops.1.feedback'] });
    const params: Record<string, Float32Array> = {
      pitchBend: new Float32Array([0]),
      modWheel: new Float32Array([0]),
      gain: new Float32Array([1]),
      [voiceSlotParamName(0)]: new Float32Array([0]),
    };
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    let largest = 0;
    processor.inbox(on(1, 60));
    for (let b = 0; b < 40; b++) {
      loaded.setFrame(b * BLOCK);
      params[voiceSlotParamName(0)]![0] = b >= 10 && b < 30 ? 0.6 : 0;
      processor.process([], [[left, right]], params);
      expect(left.every(Number.isFinite), `block ${b}`).toBe(true);
      largest = Math.max(largest, peak(left));
    }
    expect(view(processor).oversample.factor).toBe(2);
    expect(largest).toBeGreaterThan(0.1);
    expect(largest).toBeLessThan(2);
  });
});

describe('the decimator’s delay and the level (windsor#656, decisions 4 and 5)', () => {
  it('sounds a voice at twice the rate 16 samples behind the same patch at 1×', () => {
    // An unsynced Sine carrier, at 65 Hz where the decimator's gain is 1;
    // a silent synced D sends the voice to twice the rate.
    const patch = patchOf({ ratio: 1 }, [{}, {}, { sync: 'note' }]);
    const once = play(patch, AT_1X, 40, [on(1, 36)]);
    const twice = play(patch, {}, 40, [on(1, 36)]);
    expect(voiceFor(patch).oversample.factor).toBe(2);
    // Held, the two agree at 16 samples to the float, and a sample either
    // side is the sine's own slope apart.
    const apart = (lag: number): number => {
      let worst = 0;
      for (let n = SETTLED; n < once.length; n++) {
        worst = Math.max(worst, Math.abs(twice[n]! - once[n - lag]!));
      }
      return worst;
    };
    const level = peak(once, SETTLED);
    expect(level).toBeGreaterThan(0.1);
    expect(apart(DELAY)).toBeLessThan(1e-5 * level);
    expect(apart(DELAY - 1)).toBeGreaterThan(5e-3 * level);
    expect(apart(DELAY + 1)).toBeGreaterThan(5e-3 * level);
    // The onset, the first sample past a hundredth of the level, the same.
    const onset = (x: Float32Array): number => x.findIndex((v) => Math.abs(v) > 0.01 * level);
    expect(Math.abs(onset(twice) - onset(once) - DELAY)).toBeLessThanOrEqual(1);
  });

  it.each([
    ['Saw', { wave: WAVE.SAW }],
    ['Square', { wave: WAVE.SQUARE }],
    ['Pulse at width 0.3', { wave: WAVE.PULSE, width: 0.3 }],
  ])('plays a synced %s at MIDI 36, ratio 1, within 0.3 dB of the same note at 1×', (_, a) => {
    const patch = patchOf({ ...a, ratio: 1, sync: 'note' });
    const once = play(patch, AT_1X, 80, [on(1, 36)]);
    const twice = play(patch, {}, 80, [on(1, 36)]);
    const n = 8192;
    const db = 20 * Math.log10(rms(twice, SETTLED + DELAY, n) / rms(once, SETTLED, n));
    expect(Math.abs(db)).toBeLessThan(0.3);
  });
});

describe('a voice at twice the rate stolen, gliding, and through the Acid ladder and the drive (windsor#656)', () => {
  it('fades out a stolen voice and starts the next, finite', () => {
    const processor = loaded.create(patchOf(SAW), 1);
    const events = [on(1, 60), on(2, 67, 3 * BLOCK + 17)];
    const x = render(loaded, processor, 20, events);
    expect(x.nonFinite).toBe(0);
    expect(x.peak).toBeGreaterThan(0.1);
    expect(view(processor).oversample.factor).toBe(2);
  });

  it('glides from the last note, finite', () => {
    const x = play(patchOf(SAW, [], { glide: 0.05 }), {}, 30, [on(1, 48), on(2, 60, 8 * BLOCK)]);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeGreaterThan(0.1);
  });

  it('plays through the Acid ladder at full Reso and a hot drive, within the ladder’s own bound', () => {
    const acid = patchOf(SAW, [], {
      filter: { mode: FILTER_MODE.LADDER, cutoff: 1200, resonance: 12 },
      drive: { on: true, gain: 4, shape: 0, bias: 0, tone: 1 },
    } as Partial<Patch>);
    expect(voiceFor(acid).oversample.factor).toBe(2);
    const x = play(acid, {}, 60);
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeGreaterThan(0.01);
    // `ladderLimits.test.ts`'s bound at the output mix's full gain.
    expect(peak(x)).toBeLessThan((4 * (1 + 2 * LADDER_MIX_GAIN)) / LADDER_INPUT_SCALE);
  });
});

describe('the direct shape at twice the rate (windsor#656, decision 11)', () => {
  it('takes the shape at the doubled rate’s bound: a synced Saw at 0.3 of the part’s rate a sample', () => {
    // 14.4 kHz is 0.3 cycles a sample at 48 kHz and 0.15 at 96 kHz.
    const a = { wave: WAVE.SAW, fixed: true, fixedHz: 0.3 * SR, sync: 'note' as const };
    expect(voiceFor(patchOf(a)).sync.shape.direct & 1).toBe(1);
  });

  it('reads the table for a synced Saw at −4800 Hz, at 1× and at twice the rate, finite', () => {
    const a = { wave: WAVE.SAW, fixed: true, fixedHz: -4800, sync: 'note' as const };
    for (const options of [{}, AT_1X]) {
      expect(voiceFor(patchOf(a), options).sync.shape.direct & 1).toBe(0);
      expect(play(patchOf(a), options, 4).every(Number.isFinite)).toBe(true);
    }
  });
});
