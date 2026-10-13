/**
 * The wave sets a patch reads, built on the main thread and sent ahead of it
 * (windsor#795), against the shipped bundle: the sender sends each set once,
 * the 2× sets of a synced patch and a 32-partial User wave among them, and
 * builds each Tone step once; a set built here is the processor's own to the
 * byte; a processor sent its sets builds nothing at the patch and renders
 * what it renders when it builds them itself.
 */
import { describe, expect, it } from 'vitest';

import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { makePatch, WAVE } from '../patch/patch';
import type { Patch } from '../patch/patch';
import { waveSetBuildCount, waveSetFor } from '../worklet/fm/waveTables';
import { WaveSetSender, waveSetSenderFor, wavesTransfer } from './waveSetSender';
import type { WaveSetEntry } from './workletMessages';

const RATE = 48000;

/** A User wave of 32 partials. */
const USER_32 = Array.from({ length: 32 }, (_, i) => (i % 3 === 2 ? 0 : 1 / (i + 1)));

/** A synced saw over a User wave at Tone 0.63 (its sets at 0.65), and two sines. */
const SYNCED: Patch = makePatch({
  tone: 0.63,
  ops: [
    { wave: WAVE.SAW, ratio: 2.37, sync: 'note' },
    { wave: WAVE.USER, userPartials: USER_32 },
  ],
});

/** Four saws. */
const SAWS = Array.from({ length: 4 }, () => ({ wave: WAVE.SAW }));

/** The keys of the sets in a message. */
const keysOf = (sets: readonly WaveSetEntry[]): string[] => sets.map((set) => set.key);

/** The processor's wave sets, as `PartWaveSets` holds them. */
const wavesOf = (p: ProcessorLike) =>
  (p as unknown as { waves: { sets: Float32Array[][]; sets2x: Float32Array[][] } }).waves;

/** A table's bytes. */
const bytes = (t: Float32Array): Uint8Array => new Uint8Array(t.buffer, t.byteOffset, t.byteLength);

describe('the main thread’s wave sets (windsor#795)', () => {
  it('sends each set a patch reads once, its 2× sets and a 32-partial User wave’s among them', () => {
    const sender = new WaveSetSender(RATE);
    // The warm-up's sets (sines at Tone 1) are never sent.
    expect(sender.setsFor(makePatch())).toEqual([]);
    const sets = sender.setsFor(SYNCED);
    expect(keysOf(sets)).toEqual([
      `${WAVE.SAW}|0.65|48000|`,
      `${WAVE.SAW}|0.65|96000/48000|`,
      `${WAVE.USER}|0.65|48000|[${USER_32.join(',')}]`,
      `${WAVE.USER}|0.65|96000/48000|[${USER_32.join(',')}]`,
      `${WAVE.SINE}|0.65|48000|`,
      `${WAVE.SINE}|0.65|96000/48000|`,
    ]);
    expect(sender.setsFor(SYNCED)).toEqual([]);
    // Copies, transferred whole: the main thread's cache keeps its own arrays.
    const own = waveSetFor(WAVE.SAW, RATE, 0.63, null);
    expect(sets[0]!.mips[0]).not.toBe(own.mips[0]);
    expect(sets[0]!.mips).toEqual(own.mips);
    expect(wavesTransfer(sets)).toHaveLength(sets.length * 13);
  });

  it('builds each Tone step once through a drag across all twenty, and back', () => {
    const sender = new WaveSetSender(RATE);
    const before = waveSetBuildCount();
    const sweep = (from: number, to: number): string[] => {
      const keys: string[] = [];
      for (let i = 0; i <= 240; i++) {
        const tone = from + ((to - from) * i) / 240;
        keys.push(...keysOf(sender.setsFor(makePatch({ tone, ops: SAWS }))));
      }
      return keys;
    };
    const there = sweep(0, 1);
    // The 21 steps from 0.02, less Tone 1, which the warm-up built.
    expect(there).toHaveLength(20);
    expect(new Set(there).size).toBe(20);
    expect(waveSetBuildCount() - before).toBeLessThanOrEqual(20);
    const built = waveSetBuildCount();
    expect(sweep(1, 0)).toEqual([]);
    expect(waveSetBuildCount()).toBe(built);
  });

  it('gives an offline context, or one with no rate, no sender, and a live one its own', () => {
    const live = { sampleRate: RATE } as BaseAudioContext;
    expect(waveSetSenderFor(live)).toBe(waveSetSenderFor(live));
    expect(waveSetSenderFor({ sampleRate: RATE, startRendering: () => {} } as never)).toBeNull();
    expect(waveSetSenderFor({ sampleRate: 0 } as BaseAudioContext)).toBeNull();
  });
});

describe('a processor sent its wave sets (windsor#795)', () => {
  it('builds the same bytes as the main thread for the same key', () => {
    const loaded = loadProcessor();
    const waves = wavesOf(loaded.create(SYNCED));
    for (let i = 0; i < 2; i++) {
      const { wave, userPartials } = SYNCED.ops[i]!;
      const once = waveSetFor(wave, RATE, SYNCED.tone, userPartials);
      const twice = waveSetFor(wave, 2 * RATE, SYNCED.tone, userPartials, RATE);
      for (let k = 0; k < once.mips.length; k++) {
        expect(bytes(waves.sets[i]![k]!)).toEqual(bytes(once.mips[k]!));
        expect(bytes(waves.sets2x[i]![k]!)).toEqual(bytes(twice.mips[k]!));
      }
    }
  });

  it('installs them and builds nothing at the patch, and renders as one that built its own', () => {
    const notes: ScheduledEvent[] = [
      { type: 'noteOn', id: 1, note: 45, velocity: 0.9, frame: 0 },
      { type: 'noteOn', id: 2, note: 57, velocity: 0.7, frame: 300 },
      { type: 'noteOff', id: 1, frame: 9000 },
    ];
    const play = (send: boolean) => {
      const loaded = loadProcessor();
      const p = loaded.create(makePatch());
      const before = loaded.waveSetBuilds();
      const sets = new WaveSetSender(loaded.sampleRate).setsFor(SYNCED);
      if (send) p.inbox({ type: 'waves', sets } as unknown as ScheduledEvent);
      p.inbox({ type: 'patch', patch: structuredClone(SYNCED) } as unknown as ScheduledEvent);
      const built = loaded.waveSetBuilds() - before;
      if (send) expect(wavesOf(p).sets[0]).toBe(sets[0]!.mips);
      return { built, samples: render(loaded, p, 120, notes).samples };
    };
    const sent = play(true);
    const own = play(false);
    expect(sent.built).toBe(0);
    expect(own.built).toBe(6);
    expect(Buffer.from(sent.samples.buffer).equals(Buffer.from(own.samples.buffer))).toBe(true);
  });
});
