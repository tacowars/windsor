/**
 * The Formant vowel on a song lane (windsor#406) through the shipped worklet:
 * a slot mapped to `filter.vowel` moves a ringing voice's three peaks from
 * the patch's vowel to the lane's, heard in white noise through the voice; a
 * new voice starts on the lane's value; the lane's value wins over the
 * patch's and, released, gives the voice back its patch's vowel; and a slot
 * at 0 renders as none, to the bit. The offsets are the main thread's
 * (`voiceOffset`), so the handle and the worklet are held to one sum. That
 * the kernel and the generic loop agree under a moving vowel lane is
 * `fmProcessorKernel.test.ts`; that no factory preset changed is the golden
 * test.
 */
import { describe, expect, it } from 'vitest';

import { peakNear, transfer } from '../__fixtures__/powerSpectrum';
import { voiceLaneOffset } from '../__fixtures__/voiceLaneOffset';
import { loadProcessor } from '../__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch } from '../patch/patch';
import type { Patch } from '../patch/patch';
import { FORMANT_VOWELS } from '../worklet/fm/formantTables';
import { voiceSlotParamName } from './audioPart';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK = 128;
const SLOTS = 8;
const VOWEL = 'filter.vowel';
const [A, E, , O, U] = FORMANT_VOWELS.map((v) => v.hz);

interface SectionLike {
  cutoffHz: number;
}

interface VowelVoice {
  active: boolean;
  svfA: SectionLike;
  svfB: SectionLike;
  svfC: SectionLike;
}

const held = { attackTime: 0, decayTime: 0.01, sustainLevel: 1, peakLevel: 1 };

/** A lone held Noise carrier through the Formant filter at `vowel` (or Off): white noise into it. */
function noisePatch(vowel: number, mode: number = FILTER_MODE.FORMANT): Patch {
  return makePatch({
    algorithm: 0,
    volume: 0.5,
    ops: [{ wave: WAVE.NOISE, level: 1, velSens: 0, env: held }, {}, {}, {}],
    filter: { mode, vowel, env: makeEnvelope(held) },
  });
}

/** The offset the main thread sends for a lane at `value` over `patch`. */
const offsetFor = (patch: Patch, value: number): number => voiceLaneOffset(patch, VOWEL, value);

interface Run {
  patch: Patch;
  /** Map slot 0 to the vowel; otherwise no slot is mapped. */
  slot?: boolean;
  blocks: number;
  /** The note-on's block, 0 by default. */
  noteAt?: number;
  /** Slot 0's offset for block `b`. */
  offset?: (b: number) => number;
  /** Before block `b` renders, after its offset is written. */
  each?: (b: number, processor: ProcessorLike) => void;
  /** After block `b` renders, with the sounding voice. */
  after?: (b: number, voice: VowelVoice | undefined) => void;
}

/** Render one part block by block: the left channel. */
function run(r: Run): Float32Array {
  const processor = loaded.create(r.patch, 1, undefined, r.slot ? { voiceSlots: [VOWEL] } : {});
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  const outL = new Float32Array(BLOCK);
  const outR = new Float32Array(BLOCK);
  const left = new Float32Array(r.blocks * BLOCK);
  const note: ScheduledEvent = { type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 };
  for (let b = 0; b < r.blocks; b++) {
    loaded.setFrame(b * BLOCK);
    if (b === (r.noteAt ?? 0)) processor.inbox({ ...note, frame: b * BLOCK });
    params.voiceSlot0![0] = r.offset?.(b) ?? 0;
    r.each?.(b, processor);
    processor.process([], [[outL, outR]], params);
    left.set(outL, b * BLOCK);
    const voice = (processor.voices as unknown as VowelVoice[]).find((v) => v.active);
    r.after?.(b, voice);
  }
  return left;
}

const centres = (voice: VowelVoice | undefined): number[] =>
  voice ? [voice.svfA.cutoffHz, voice.svfB.cutoffHz, voice.svfC.cutoffHz] : [];
const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;

/** Blocks in `seconds`. */
const blocksIn = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK);

describe('a part with no vowel lane playing (windsor#406)', () => {
  it('renders as no slot with the vowel slot mapped at 0, to the bit', () => {
    for (const vowel of [0, 1.37, 4]) {
      const blocks = blocksIn(0.3);
      const none = run({ patch: noisePatch(vowel), blocks });
      expect(none.some((s) => s !== 0)).toBe(true);
      expect(sameBits(run({ patch: noisePatch(vowel), slot: true, blocks }), none)).toBe(true);
    }
  });
});

describe('a vowel lane on a ringing Formant voice (windsor#406)', () => {
  /** The F2 white noise meets through the voice over `[from, to)` seconds of `left`. */
  function f2(input: Float32Array, left: Float32Array, from: number, to: number): number {
    const at = (s: number): number => Math.round(s * SR);
    const response = transfer(
      input.subarray(at(from), at(to)),
      left.subarray(at(from), at(to)),
      SR,
      8192,
    );
    return peakNear(response, 0.8 * 1040, 1.15 * 1620).hz;
  }

  it('moves F2 from the patch\'s "a" to the lane\'s "e", heard in white noise', () => {
    const patch = noisePatch(0);
    const offset = offsetFor(patch, 1);
    expect(offset).toBe(1);
    const half = blocksIn(4);
    const blocks = 2 * half;
    const input = run({ patch: noisePatch(0, FILTER_MODE.OFF), blocks });
    const lane = run({ patch, slot: true, blocks, offset: (b) => (b >= half ? offset : 0) });
    const seconds = (half * BLOCK) / SR;
    const before = f2(input, lane, 0.1, seconds);
    const after = f2(input, lane, seconds + 0.1, 2 * seconds);
    expect(Math.abs(before / 1040 - 1), `F2 at ${before} Hz`).toBeLessThan(0.02);
    expect(Math.abs(after / 1620 - 1), `F2 at ${after} Hz`).toBeLessThan(0.02);
  });

  it("retunes the three peaks in the block the lane's offset arrives", () => {
    const patch = noisePatch(0);
    const seen: number[][] = [];
    run({
      patch,
      slot: true,
      blocks: 12,
      offset: (b) => (b >= 6 ? offsetFor(patch, 3.25) : 0),
      after: (_b, voice) => void seen.push(centres(voice)),
    });
    expect(seen[5]).toEqual([...A!]);
    const morph = O!.map((hz, k) => hz + (U![k]! - hz) * 0.25);
    seen.slice(6).forEach((got) => got.forEach((hz, k) => expect(hz).toBeCloseTo(morph[k]!, 9)));
  });

  it("starts a new voice on the lane's value, as the patch moved there, from its first sample", () => {
    const patch = noisePatch(0);
    const offset = offsetFor(patch, 1);
    const first: number[][] = [];
    const lane = run({
      patch,
      slot: true,
      blocks: 20,
      noteAt: 4,
      offset: () => offset,
      after: (b, voice) => {
        if (b === 4) first.push(centres(voice));
      },
    });
    expect(first[0]).toEqual([...E!]);
    expect(sameBits(lane, run({ patch: noisePatch(1), blocks: 20, noteAt: 4 }))).toBe(true);
  });

  it("plays the lane's vowel over the patch's, and the patch's again once the lane lets go", () => {
    const patch = noisePatch(1);
    const offset = offsetFor(patch, 3);
    expect(offset).toBe(2);
    const seen: number[][] = [];
    const lane = run({
      patch,
      slot: true,
      blocks: 30,
      offset: (b) => (b < 15 ? offset : 0),
      after: (_b, voice) => void seen.push(centres(voice)),
    });
    expect(seen[14]).toEqual([...O!]);
    expect(seen[15]).toEqual([...E!]);
    const o = run({ patch: noisePatch(3), blocks: 15 });
    expect(sameBits(lane.slice(0, 15 * BLOCK), o)).toBe(true);
  });

  it('clamps the sum to 0–4: a lane at "u" over a patch at "o" plays u, not past it', () => {
    const seen: number[][] = [];
    run({
      patch: noisePatch(3),
      slot: true,
      blocks: 4,
      offset: () => 2,
      after: (_b, voice) => void seen.push(centres(voice)),
    });
    expect(seen[3]).toEqual([...U!]);
  });

  it("holds the lane's vowel across a live retune of the patch's vowel", () => {
    const patch = noisePatch(0);
    const edited = noisePatch(2);
    // The lane resyncs against the edited patch (`system/songAutomation.ts`).
    const offsets = [offsetFor(patch, 3), offsetFor(edited, 3)];
    expect(offsets).toEqual([3, 1]);
    const seen: number[][] = [];
    run({
      patch,
      slot: true,
      blocks: 12,
      offset: (b) => offsets[b < 6 ? 0 : 1]!,
      each: (b, processor) => {
        if (b === 0) processor.inbox({ type: 'liveRetune', enabled: true } as never);
        if (b === 6) processor.inbox({ type: 'patch', patch: edited } as never);
      },
      after: (_b, voice) => void seen.push(centres(voice)),
    });
    seen.slice(1).forEach((got, b) => expect(got, `block ${b + 1}`).toEqual([...O!]));
  });
});
