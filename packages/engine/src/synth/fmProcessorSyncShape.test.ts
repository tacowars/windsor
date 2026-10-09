/**
 * The synced Saw, Square and Pulse's direct shape through the shipped
 * worklet (windsor#655, record `2026-10-09-sync-direct-shape`): which
 * operators take it (decision 1), at the bind and at each control block, a
 * switch to the table path and back that adds nothing the two paths do not
 * already differ by, the edges a reset meets summed without a NaN or a
 * sample past the table path's peak, the Saw's polarity and the Pulse's
 * mean. The edges' arithmetic is `worklet/fm/voiceSyncShape.test.ts`; the
 * fine interval for a modulated ratio is `voiceControlInterval.test.ts`.
 *
 * A note period of 128 samples (375 Hz at 48 kHz) puts every reset on the
 * same sample of each period, and on a control block's first sample, so a
 * switch lands on a reset: the worst place for one.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makePatch } from '../patch/patch';
import type { PartialOperator, Patch } from '../patch/patch';
import { VOICE_TARGET_COUNT, VOICE_TARGET_PATHS } from '../worklet/fm/voiceTargetTables';
import { voiceSlotParamName } from './audioPart';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;
const PERIOD = 128;
const NOTE = 69 + 12 * Math.log2(SR / PERIOD / 440);
/** D into A, B and C, the three carriers: A on the table path while D is there, silent or not. */
const ONE_TO_THREE = 5;
/** D into C, with A and B free: the same three carriers, A modulated by nothing. */
const STACK_TWO = 6;
/** Past the attack: from here every amplitude is held. */
const SETTLED = 4 * PERIOD;

const HELD = { attackTime: 0.001, decayTime: 0.01, sustainLevel: 1, peakLevel: 1 };

/** Operator A synced to the note, as `a` says, over `algorithm`; the rest silent; the filter off. */
function synced(a: PartialOperator, algorithm = STACK_TWO, extra: Partial<Patch> = {}): Patch {
  return makePatch({
    algorithm,
    filter: { mode: FILTER_MODE.OFF },
    ...extra,
    ops: [0, 1, 2, 3].map((i) => ({
      level: 0,
      velSens: 0,
      phaseFree: false,
      phase: 0,
      env: HELD,
      ...(i === 0 ? { level: 1, sync: 'note', ...a } : {}),
    })),
  });
}

interface ShapeView {
  sync: { blep: number; shape: { eligible: number; direct: number } };
}

/** Operator A's bits after `blocks` blocks of one note: eligible, direct, corrected. */
function bits(patch: Patch, blocks = 2, stepMod?: number[]): [number, number, number] {
  const processor: ProcessorLike = loaded.create(patch, 1);
  const on: ScheduledEvent = { type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 };
  render(loaded, processor, blocks, [stepMod ? { ...on, stepMod } : on]);
  const { sync } = processor.voices[0] as unknown as ShapeView;
  return [sync.shape.eligible & 1, sync.shape.direct & 1, sync.blep & 1];
}

/** The left channel of one held note. */
function play(patch: Patch, blocks = 40, note = NOTE): Float32Array {
  const processor = loaded.create(patch, 1);
  const events: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note, velocity: 1, frame: 0 }];
  return render(loaded, processor, blocks, events).samples.filter((_, k) => k % 2 === 0);
}

const peak = (x: Float32Array, from = SETTLED): number =>
  x.subarray(from).reduce((m, s) => Math.max(m, Math.abs(s)), 0);
const mean = (x: Float32Array, from = SETTLED): number =>
  x.subarray(from).reduce((m, s) => m + s, 0) / (x.length - from);

/** `a` on the table path: the same operator and carriers, with a silent modulator into it. */
const onTable = (a: PartialOperator): Patch => synced(a, ONE_TO_THREE);

const SAW_A = { wave: WAVE.SAW, ratio: 2.37 };

describe('who takes the direct shape (windsor#655, decision 1)', () => {
  it.each([
    ['Saw', { wave: WAVE.SAW, ratio: 2.37 }],
    ['Square', { wave: WAVE.SQUARE, ratio: 2.37 }],
    ['Pulse at width 0.3', { wave: WAVE.PULSE, ratio: 2.37, width: 0.3 }],
  ])('a synced %s that nothing modulates', (_, a) => {
    expect(bits(synced(a))).toEqual([1, 1, 0]);
  });

  it('not a synced Saw with a modulator at level 0 in its algorithm, nor one in a patch at Tone 0.9', () => {
    const saw = { wave: WAVE.SAW, ratio: 2.37 };
    expect(bits(onTable(saw))).toEqual([0, 0, 0]);
    expect(bits(synced(saw, STACK_TWO, { tone: 0.9 }))).toEqual([0, 0, 0]);
    // The Sine keeps its correction.
    expect(bits(synced({ wave: WAVE.SINE, ratio: 2.37 }))).toEqual([0, 0, 1]);
  });

  it('not while its live feedback is not 0 or a Saw’s live width is not 1', () => {
    const saw = { wave: WAVE.SAW, ratio: 2.37 };
    expect(bits(synced({ ...saw, feedback: 0.3 }))).toEqual([1, 0, 0]);
    const feedbackStep = new Array<number>(VOICE_TARGET_COUNT).fill(0);
    feedbackStep[VOICE_TARGET_PATHS.indexOf('ops.0.feedback')] = 0.2;
    expect(bits(synced(saw), 2, feedbackStep)).toEqual([1, 0, 0]);
    expect(bits(synced({ ...saw, width: 0.5 }))).toEqual([1, 0, 0]);
  });

  it('re-checks a Saw’s live width at each control block, under an LFO that squeezes it half the time', () => {
    // The LFO's positive half asks for a width over 1, which clamps to 1.
    const lfo = { rate: 20, amount: 0.5, toWidth: [0.3, 0, 0, 0] };
    const processor = loaded.create(synced(SAW_A, STACK_TWO, { lfo: lfo as Patch['lfo'] }), 1);
    const seen = new Set<string>();
    processor.inbox({ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 });
    for (let b = 0; b < 40; b++) {
      render(loaded, processor, 1);
      const voice = processor.voices[0] as unknown as ShapeView & {
        width: Float32Array;
        widthInc: Float32Array;
      };
      const plain = voice.width[0] === 1 && voice.widthInc[0] === 0 ? 1 : 0;
      expect(voice.sync.shape.direct & 1, `block ${b}`).toBe(plain);
      seen.add(`${plain}`);
    }
    expect([...seen].sort()).toEqual(['0', '1']);
  });
});

describe('a switch to the table path and back (windsor#655, decision 1)', () => {
  const SAW = synced({ wave: WAVE.SAW, ratio: 2.37 });
  const OFFSET = 1e-6;
  const BLOCKS = 40;

  /**
   * The left channel, and A's direct bit each block, with a feedback lane at
   * `OFFSET` over `[from, to)`; every control block the fine one, so each
   * starts a quantum's quarter and a switch lands where a reset does.
   */
  function run(from: number, to: number): { x: Float32Array; direct: number[] } {
    const processor = loaded.create(SAW, 1, undefined, {
      voiceSlots: ['ops.0.feedback'],
      controlIntervals: { long: loaded.ctrlInterval },
    });
    const params: Record<string, Float32Array> = {
      pitchBend: new Float32Array([0]),
      modWheel: new Float32Array([0]),
      gain: new Float32Array([1]),
      [voiceSlotParamName(0)]: new Float32Array([0]),
    };
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    const x = new Float32Array(BLOCKS * BLOCK);
    const direct: number[] = [];
    processor.inbox({ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 });
    for (let b = 0; b < BLOCKS; b++) {
      loaded.setFrame(b * BLOCK);
      params[voiceSlotParamName(0)]![0] = b >= from && b < to ? OFFSET : 0;
      processor.process([], [[left, right]], params);
      x.set(left, b * BLOCK);
      direct.push((processor.voices[0] as unknown as ShapeView).sync.shape.direct & 1);
    }
    return { x, direct };
  }

  it('leaves the shape at the block its feedback moves, and takes it again once the feedback is back at 0', () => {
    const { direct } = run(10, 20);
    // Back at 0, the feedback ramps from the offset over one fine control
    // block, and the shape returns at the next, inside the same quantum.
    expect(direct.slice(8, 22)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
  });

  it('plays every sample of either path through both switches, neither skipping nor repeating one', () => {
    // A switch lands on a reset (the note's period is four fine blocks), whose
    // owed correction the table path must drop. The bound is the feedback
    // offset's own effect on the table path, about 1.4e-6.
    const shape = run(BLOCKS, BLOCKS).x;
    const table = run(0, BLOCKS).x;
    const switched = run(10, 20).x;
    let apart = 0;
    for (let n = SETTLED; n < shape.length; n++) {
      apart = Math.max(apart, Math.abs(table[n]! - shape[n]!));
      const nearest = Math.min(
        Math.abs(switched[n]! - shape[n]!),
        Math.abs(switched[n]! - table[n]!),
      );
      expect(nearest, `sample ${n}`).toBeLessThan(1e-5);
    }
    // The two paths differ, so a sample a switch played wrong would show.
    expect(apart).toBeGreaterThan(0.1);
  });
});

describe('the edges a reset meets (windsor#655, decision 3)', () => {
  /** A finite render whose every sample stays within the table path's peak for the same operator and LFOs. */
  function expectBounded(a: PartialOperator, extra: Partial<Patch> = {}): void {
    const x = play(synced(a, STACK_TWO, extra));
    expect(x.every(Number.isFinite)).toBe(true);
    expect(peak(x)).toBeGreaterThan(0.1);
    expect(peak(x)).toBeLessThanOrEqual(peak(play(synced(a, ONE_TO_THREE, extra))) * 1.0001);
  }

  it('through a ratio swept just below and through a whole number', () => {
    for (const ratio of [1.999, 2, 2.0005, 2.001]) {
      expectBounded({ wave: WAVE.SAW, ratio });
      expectBounded({ wave: WAVE.SQUARE, ratio });
    }
    const lfo = { shape: 0, rate: 5, amount: 1, toRatio: [0.01, 0, 0, 0] };
    expectBounded({ wave: WAVE.SAW, ratio: 2 }, { lfo: lfo as Patch['lfo'] });
  });

  it('with a duty edge within a sample of a reset, before it or after it', () => {
    // The Square falls at 0.5 a fraction of a sample before each reset.
    expectBounded({ wave: WAVE.SQUARE, ratio: 2.5005 });
    // A Pulse at width 0.99 falls at 0.01, inside the sample after each reset.
    expectBounded({ wave: WAVE.PULSE, ratio: 2.37, width: 0.99 });
  });

  it('with a Pulse whose width an LFO sweeps, its duty edge moving within each sample', () => {
    const a = { wave: WAVE.PULSE, ratio: 2.37, width: 0.5 };
    const lfo = { shape: 0, rate: 20, amount: 1, toWidth: [0.4, 0, 0, 0] } as Patch['lfo'];
    expect(bits(synced(a, STACK_TWO, { lfo }), 8)).toEqual([1, 1, 0]);
    expectBounded(a, { lfo });
  });
});

describe('the shape against the table path (windsor#655, decision 2)', () => {
  it('falls: a synced Saw at ratio 1 is positive just after each reset and negative just before', () => {
    const x = play(synced({ wave: WAVE.SAW, ratio: 1 }));
    // A sample late: phase 0 sounds at sample 1 of each period.
    for (let n = SETTLED; n + PERIOD < x.length; n += PERIOD) {
      expect(x[n + 3]!).toBeGreaterThan(0.1);
      expect(x[n + PERIOD - 3]!).toBeLessThan(-0.1);
    }
  });

  it('keeps the Pulse’s mean, at width 0.3 and at a harmonic and an inharmonic ratio', () => {
    for (const ratio of [1, 3.7]) {
      const a = { wave: WAVE.PULSE, ratio, width: 0.3 };
      const direct = play(synced(a), 200, 36);
      const table = play(onTable(a), 200, 36);
      expect(Math.abs(mean(direct) - mean(table)), `ratio ${ratio}`).toBeLessThan(
        2e-3 * peak(table),
      );
    }
  });
});

describe('past Nyquist, the table path (windsor#655, SYNC_SHAPE_MAX_INC)', () => {
  it('a synced Saw at 48 GHz reads its table, so a block takes constant time, and plays finite samples', () => {
    const a = { wave: WAVE.SAW, fixed: true, fixedHz: 48e9 };
    expect(bits(synced(a))).toEqual([1, 0, 0]);
    expect(play(synced(a), 4).every(Number.isFinite)).toBe(true);
  });

  /** A note of 32 samples (1500 Hz), a fine block: every control block opens on a reset. */
  const HIGH = 69 + 12 * Math.log2(SR / 32 / 440);
  /** Ratio 12 at that note is 0.375 of a cycle a sample; the lane's octave up makes it 0.75. */
  const SAW_12 = { wave: WAVE.SAW, ratio: 12 };
  const BLOCKS = 40;

  /** The left channel, and A's direct bit each block, with a ratio lane an octave up over `[from, to)`. */
  function run(patch: Patch, from: number, to: number): { x: Float32Array; direct: number[] } {
    const processor = loaded.create(patch, 1, undefined, {
      voiceSlots: ['ops.0.ratio'],
      controlIntervals: { long: loaded.ctrlInterval },
    });
    const params: Record<string, Float32Array> = {
      pitchBend: new Float32Array([0]),
      modWheel: new Float32Array([0]),
      gain: new Float32Array([1]),
      [voiceSlotParamName(0)]: new Float32Array([0]),
    };
    const left = new Float32Array(BLOCK);
    const right = new Float32Array(BLOCK);
    const x = new Float32Array(BLOCKS * BLOCK);
    const direct: number[] = [];
    processor.inbox({ type: 'noteOn', id: 1, note: HIGH, velocity: 1, frame: 0 });
    for (let b = 0; b < BLOCKS; b++) {
      loaded.setFrame(b * BLOCK);
      params[voiceSlotParamName(0)]![0] = b >= from && b < to ? 1 : 0;
      processor.process([], [[left, right]], params);
      x.set(left, b * BLOCK);
      direct.push((processor.voices[0] as unknown as ShapeView).sync.shape.direct & 1);
    }
    return { x, direct };
  }

  it('leaves the shape while a ratio lane lifts it past Nyquist, and takes it again below, neither skipping nor repeating a sample', () => {
    const switched = run(synced(SAW_12), 10, 20);
    expect(switched.direct.slice(8, 22)).toEqual([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1]);
    const shape = run(synced(SAW_12), BLOCKS, BLOCKS).x;
    // The same lane on the table path; A is not eligible there, so it sounds a sample early.
    const table = run(onTable(SAW_12), 10, 20).x;
    // The first sample the shape sends back is its wave at the phase the
    // block's opening reset left, without the half of that reset's step the
    // table path never took: any entry on a reset does so. It stays within
    // the naive Saw's own level, `g·π/2`, `g` the one-harmonic table's peak.
    const back = 20 * BLOCK + 1;
    expect(Math.abs(switched.x[back]!)).toBeLessThanOrEqual(peak(table) * (Math.PI / 2) * 1.0001);
    for (let n = SETTLED; n < switched.x.length; n++) {
      if (n === back) continue;
      const nearest = Math.min(
        Math.abs(switched.x[n]! - shape[n]!),
        Math.abs(switched.x[n]! - table[n - 1]!),
      );
      expect(nearest, `sample ${n}`).toBeLessThan(1e-5);
    }
  });
});
