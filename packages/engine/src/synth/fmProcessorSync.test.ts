/**
 * Hard sync through the shipped worklet (windsor#646, record
 * `2026-10-09-operator-hard-sync`): a sine synced to the note at a
 * harmonic ratio is the unsynced operator a sample late (the polyBLEP's
 * delay, which only the Sine, Triangle and User waves take), at an
 * inharmonic ratio it repeats at the note's period, synced to
 * another operator it repeats at that operator's period whatever its level,
 * detune or fixed mode, and a chain resets on its master's resets as well as
 * its wraps. A cycle, a self-sync and an unknown master play as unsynced,
 * a synced Noise operator sounds as it did, a Pulse resets both its reads,
 * a synced modulator and a synced carrier both work, and the feedback taps
 * read the raw wave. Every library patch is unsynced and renders as before:
 * `fmProcessorGolden.test.ts`. The binding is `worklet/fm/voiceSync.test.ts`.
 *
 * A note period of 128 samples (375 Hz at 48 kHz) puts every master's wrap
 * on the same sample of each period, so "repeats" is a sample-for-sample
 * comparison one period apart, away from the samples a reset corrects.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { CreateOptions, ProcessorLike } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makePatch } from '../patch/patch';
import type { OpSync, PartialOperator, Patch } from '../patch/patch';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCKS = 40;
/** The note's period in samples, and its frequency. */
const PERIOD = 128;
const PERIOD_HZ = SR / PERIOD;
/** Past the attack: from here every amplitude is held. */
const SETTLED = 4 * PERIOD;
/** Samples either side of a reset that its correction (and a wrap a sample early or late) may touch. */
const GUARD = 3;
const SERIES = 0;
const ADDITIVE = 7;
/** A cent ratio: `cents` cents up. */
const cents = (c: number): number => 2 ** (c / 1200);

/** The MIDI note (fractional) that sounds `hz`. */
const noteAt = (hz: number): number => 69 + 12 * Math.log2(hz / 440);

const HELD = { attackTime: 0.001, decayTime: 0.01, sustainLevel: 1, peakLevel: 1 };

/** Four operators over `algorithm`, each held at its level from phase 0, velocity-blind; the filter off. */
function patchOf(algorithm: number, ops: PartialOperator[]): Patch {
  return makePatch({
    algorithm,
    filter: { mode: FILTER_MODE.OFF },
    ops: [0, 1, 2, 3].map((i) => ({
      level: 0,
      velSens: 0,
      phaseFree: false,
      phase: 0,
      env: HELD,
      ...ops[i],
    })),
  });
}

/** `patch` with operator `i`'s sync set. */
function syncing(patch: Patch, i: number, sync: OpSync | string): Patch {
  const out = structuredClone(patch);
  out.ops[i]!.sync = sync as OpSync;
  return out;
}

/** The left channel of one held note at `note`. */
function play(patch: Patch, note: number, options: CreateOptions = {}): Float32Array {
  const processor = loaded.create(patch, 1, undefined, options);
  const events = [{ type: 'noteOn' as const, id: 1, note, velocity: 1, frame: 0 }];
  return render(loaded, processor, BLOCKS, events).samples.filter((_, k) => k % 2 === 0);
}

/** Whether `n` is within `GUARD` of a sample at `offsets` in each period. */
function nearReset(n: number, offsets: readonly number[]): boolean {
  const at = n % PERIOD;
  return offsets.some((o) => {
    const d = Math.abs(at - o);
    return Math.min(d, PERIOD - d) <= GUARD;
  });
}

/**
 * The largest difference between samples `lag` apart from `SETTLED`, away
 * from the resets at `offsets`, over the samples `within` admits (by their
 * place in the period; all of them by default).
 */
function lagError(
  x: Float32Array,
  lag: number,
  offsets: readonly number[] = [0],
  within: (at: number) => boolean = () => true,
): number {
  let worst = 0;
  for (let n = SETTLED; n + lag < x.length; n++) {
    if (nearReset(n, offsets) || nearReset(n + lag, offsets) || !within(n % PERIOD)) continue;
    worst = Math.max(worst, Math.abs(x[n + lag]! - x[n]!));
  }
  return worst;
}

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;

/** The largest difference between `late` one sample on and `x`, from `SETTLED`. */
function oneLate(late: Float32Array, x: Float32Array): number {
  let worst = 0;
  for (let n = SETTLED; n + 1 < x.length; n++)
    worst = Math.max(worst, Math.abs(late[n + 1]! - x[n]!));
  return worst;
}

const level = (x: Float32Array): number => Math.max(...x.subarray(SETTLED).map(Math.abs));

describe('an operator synced to the note (windsor#646)', () => {
  it('at ratio 2 is the unsynced operator a sample late, within 1e-6: its resets land where its phase is 0', () => {
    const free = patchOf(SERIES, [{ level: 1, ratio: 2 }]);
    const unsynced = play(free, 60);
    const synced = play(syncing(free, 0, 'note'), 60);
    expect(level(unsynced)).toBeGreaterThan(0.1);
    expect(oneLate(synced, unsynced)).toBeLessThan(1e-6);
  });

  it.each([
    ['sine', WAVE.SINE],
    ['saw', WAVE.SAW],
    ['square', WAVE.SQUARE],
    ['user', WAVE.USER],
  ])(
    'at ratio 2.37 repeats at the note’s period on a %s, which unsynced it does not',
    (_, wave) => {
      const free = patchOf(SERIES, [{ level: 1, ratio: 2.37, wave, userPartials: [1, 0.5, 0.3] }]);
      const synced = play(syncing(free, 0, 'note'), noteAt(PERIOD_HZ));
      expect(level(synced)).toBeGreaterThan(0.1);
      expect(lagError(synced, PERIOD)).toBeLessThan(1e-5);
      expect(lagError(play(free, noteAt(PERIOD_HZ)), PERIOD)).toBeGreaterThan(0.1);
    },
  );

  it('modulating a carrier makes the carrier repeat at the note’s period', () => {
    const free = patchOf(SERIES, [{ level: 1 }, { level: 0.5, ratio: 2.37 }]);
    const note = noteAt(PERIOD_HZ);
    expect(lagError(play(syncing(free, 1, 'note'), note), PERIOD)).toBeLessThan(1e-5);
    expect(lagError(play(free, note), PERIOD)).toBeGreaterThan(0.05);
  });

  it('keeps its feedback taps on the raw wave: with feedback, at ratio 2, still the unsynced operator a sample late', () => {
    for (const feedback of [0.6, -0.5]) {
      const free = patchOf(SERIES, [{ level: 1, ratio: 2, feedback }]);
      expect(oneLate(play(syncing(free, 0, 'note'), 60), play(free, 60))).toBeLessThan(1e-5);
    }
  });

  it('resets both of a Pulse’s reads together: it repeats at the note’s period', () => {
    const free = patchOf(SERIES, [{ level: 1, ratio: 2.37, wave: WAVE.PULSE, width: 0.3 }]);
    const synced = play(syncing(free, 0, 'note'), noteAt(PERIOD_HZ));
    expect(level(synced)).toBeGreaterThan(0.1);
    expect(lagError(synced, PERIOD)).toBeLessThan(1e-5);
  });

  it('on a Noise operator changes nothing, to the bit', () => {
    const free = patchOf(SERIES, [{ level: 1, wave: WAVE.NOISE }]);
    const unsynced = play(free, 60);
    expect(level(unsynced)).toBeGreaterThan(0.1);
    expect(sameBits(play(syncing(free, 0, 'note'), 60), unsynced)).toBe(true);
  });
});

describe('an operator synced to another (windsor#646)', () => {
  /** B, a carrier at 2.37, synced to A, silent at 1.5 and seven cents up, `fixed` or not, sounding at `PERIOD_HZ`. */
  function onSilentMaster(fixed: boolean): { patch: Patch; note: number } {
    const a: PartialOperator = fixed
      ? { fixed: true, fixedHz: PERIOD_HZ / cents(7), detune: 7 }
      : { ratio: 1.5, detune: 7 };
    const patch = patchOf(ADDITIVE, [a, { level: 1, ratio: 2.37, sync: 'A' }]);
    return { patch, note: fixed ? 60 : noteAt(PERIOD_HZ / (1.5 * cents(7))) };
  }

  it.each([
    ['on a ratio', false],
    ['in fixed-frequency mode', true],
  ])('repeats at the master’s period with the master silent, detuned and %s', (_, fixed) => {
    const { patch, note } = onSilentMaster(fixed);
    const synced = play(patch, note);
    expect(level(synced)).toBeGreaterThan(0.1);
    expect(lagError(synced, PERIOD)).toBeLessThan(1e-5);
    expect(lagError(play(syncing(patch, 1, 'off'), note), PERIOD)).toBeGreaterThan(0.1);
  });

  it('in a chain C → B → note resets C on every one of B’s resets as well as on B’s own wraps', () => {
    // B at 1.6 wraps on its own 80 samples into each period, and is reset at 128.
    const chain = patchOf(ADDITIVE, [
      {},
      { ratio: 1.6, sync: 'note' },
      { level: 1, ratio: 2.37, sync: 'B' },
    ]);
    const note = noteAt(PERIOD_HZ);
    const c = play(chain, note);
    expect(level(c)).toBeGreaterThan(0.1);
    const resets = [0, 80];
    expect(lagError(c, PERIOD, resets)).toBeLessThan(1e-5);
    // For the 48 samples from each of B's wraps C plays what it plays from each reset.
    expect(lagError(c, 80, resets, (at) => at < 48)).toBeLessThan(1e-5);
    // Without B's resets, C follows B's 80-sample period, not the note's.
    expect(lagError(play(syncing(chain, 1, 'off'), note), PERIOD, resets)).toBeGreaterThan(0.1);
  });
});

describe('a sync the normaliser turns off (windsor#646)', () => {
  const free = patchOf(SERIES, [
    { level: 1, ratio: 2.37 },
    { level: 0.4, ratio: 3 },
  ]);
  const unsynced = play(free, 60);

  it.each<[string, (p: Patch) => Patch]>([
    ['an operator synced to itself', (p) => syncing(p, 0, 'A')],
    ['a cycle A → B → A', (p) => syncing(syncing(p, 0, 'B'), 1, 'A')],
    ['an unknown master', (p) => syncing(p, 0, 'X')],
  ])('renders %s as unsynced, to the bit', (_, sync) => {
    expect(sameBits(play(sync(free), 60), unsynced)).toBe(true);
  });
});

interface SyncedVoice {
  kernel: boolean;
  sync: { synced: number; blep: number };
}

/** The bound voice after one block of `patch`. */
function voiceFor(patch: Patch): SyncedVoice {
  const processor: ProcessorLike = loaded.create(patch, 1);
  render(loaded, processor, 1, [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }]);
  return processor.voices[0] as unknown as SyncedVoice;
}

describe('the path a synced voice takes (windsor#646)', () => {
  it('leaves the kernel for the generic loop only while an operator is synced', () => {
    const free = patchOf(SERIES, [{ level: 1 }]);
    expect(voiceFor(free).kernel).toBe(true);
    expect(voiceFor(syncing(free, 0, 'note')).kernel).toBe(false);
    // A Noise operator's sync does nothing, so its voice keeps the kernel.
    expect(voiceFor(syncing(patchOf(SERIES, [{ wave: WAVE.NOISE }]), 0, 'note')).kernel).toBe(true);
  });

  it('corrects a reset on the Sine, Triangle and User waves only', () => {
    const corrected: number[] = [WAVE.SINE, WAVE.TRIANGLE, WAVE.USER];
    for (const [name, wave] of Object.entries(WAVE)) {
      const voice = voiceFor(syncing(patchOf(SERIES, [{ level: 1, wave }]), 0, 'note'));
      expect(voice.sync.synced, name).toBe(wave === WAVE.NOISE ? 0 : 1);
      expect(voice.sync.blep, name).toBe(corrected.includes(wave) ? 1 : 0);
    }
  });
});
