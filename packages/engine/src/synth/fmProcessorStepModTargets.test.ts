/**
 * Step lanes on the targets the one voice target table opened to them
 * (windsor#419): a step on the Formant vowel, an LFO's rate or the pitch
 * envelope's amount moves only the note that carries it, from its first
 * control block to its last, while a note beside it without one plays the
 * patch; and the move reaches its application point (the Formant peaks, the
 * LFO's `rate`, the pitch). A rate step over a patch rate of 0 scales from
 * the row's 0.02 Hz floor, and the LFO it moves is heard (PR #421).
 */
import { describe, expect, it } from 'vitest';

import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { loadProcessor } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import {
  VOICE_TARGET_COUNT,
  VOICE_TARGET_PATHS,
  VOICE_TARGET_TABLE,
  type VoiceTargetPath,
} from '../worklet/fm/voiceTargetTables';
import { stepModValue } from '../worklet/fm/voiceTargetValue';

const loaded = loadProcessor();
const BLOCK = 128;
/** About a second: well past the envelopes' attack and decay, so a value held at note-on is held through them. */
const BLOCKS = 375;

interface VoiceView {
  active: boolean;
  voiceId: number;
  liveValues: Float64Array;
  lfo: { rate: number; phase: number };
  lfo2: { rate: number; phase: number };
  svfA: { cutoffHz: number };
}

/** Two saw carriers through the Formant filter, LFO 1 on the pitch, a held pitch envelope. */
const PATCH: Patch = makePatch({
  algorithm: 7,
  pitchEnvAmount: 3,
  pitchEnv: makeEnvelope({ attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.5 }),
  ops: [1, 2].map((ratio) => ({
    wave: WAVE.SAW,
    ratio,
    level: 0.5,
    env: makeEnvelope({ attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.75 }),
  })),
  filter: { mode: FILTER_MODE.FORMANT, vowel: 1.5, resonance: 2 },
  lfo: { amount: 0.5, rate: 2, toPitch: 0.5 },
});

const code = (path: VoiceTargetPath): number => VOICE_TARGET_PATHS.indexOf(path);

/** A step array with `value` at `path`'s code. */
function stepAt(path: VoiceTargetPath, value: number): number[] {
  const out = new Array<number>(VOICE_TARGET_COUNT).fill(0);
  out[code(path)] = value;
  return out;
}

const noteOn = (id: number, note: number, stepMod?: number[]): ScheduledEvent => ({
  type: 'noteOn',
  id,
  note,
  velocity: 1,
  frame: 0,
  ...(stepMod ? { stepMod } : {}),
});

const voiceOf = (processor: ProcessorLike, id: number): VoiceView =>
  (processor.voices as unknown as VoiceView[]).find((v) => v.active && v.voiceId === id)!;

/**
 * Two notes at once, the first with a step of `value` on `path`, rendered
 * block by block; `each` sees both voices after every block.
 */
function twoNotes(
  path: VoiceTargetPath,
  value: number,
  each: (stepped: VoiceView, plain: VoiceView) => void,
): void {
  const processor = loaded.create(PATCH, 4);
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  processor.inbox(noteOn(1, 57, stepAt(path, value)));
  processor.inbox(noteOn(2, 64));
  for (let b = 0; b < BLOCKS; b++) {
    loaded.setFrame(b * BLOCK);
    processor.process([], [out], params);
    each(voiceOf(processor, 1), voiceOf(processor, 2));
  }
}

/** The patch's own value at `path`. */
function base(path: VoiceTargetPath): number {
  let at: unknown = PATCH;
  for (const key of path.split('.')) at = (at as Record<string, unknown>)[key];
  return at as number;
}

describe('a step lane on a target the table opened (windsor#419)', () => {
  it.each([
    ['filter.vowel', 0.5],
    ['filter.vowel', -0.5],
    ['lfo.rate', 0.5],
    ['lfo.rate', -0.5],
    ['pitchEnvAmount', 0.25],
    ['pitchEnvAmount', -0.25],
  ] as const)('%s at %s moves only its own note, for the note’s life', (path, value) => {
    const row = VOICE_TARGET_TABLE[code(path)]!;
    const want = stepModValue(row, base(path), value);
    expect(want).not.toBe(base(path));
    let blocks = 0;
    twoNotes(path, value, (stepped, plain) => {
      expect(stepped.liveValues[code(path)]).toBe(want);
      expect(plain.liveValues[code(path)]).toBe(base(path));
      // Every other target plays the patch on both notes.
      VOICE_TARGET_PATHS.forEach((other, k) => {
        if (other === path) return;
        expect(stepped.liveValues[k], other).toBe(plain.liveValues[k]);
      });
      blocks++;
    });
    expect(blocks).toBe(BLOCKS);
  });

  it('reaches the Formant peaks: a vowel step retunes only its note’s sections', () => {
    const plainPeak: number[] = [];
    const steppedPeak: number[] = [];
    twoNotes('filter.vowel', 1, (stepped, plain) => {
      steppedPeak.push(stepped.svfA.cutoffHz);
      plainPeak.push(plain.svfA.cutoffHz);
    });
    // The vowel moves the first formant; key tracking is off, so the plain
    // note's peak is the patch vowel's whatever its pitch.
    expect(steppedPeak.at(-1)).not.toBeCloseTo(plainPeak.at(-1)!, 3);
    const unstepped: number[] = [];
    twoNotes('filter.vowel', 0, (stepped) => unstepped.push(stepped.svfA.cutoffHz));
    expect(plainPeak).toEqual(unstepped);
  });

  it('reaches the LFO: a rate step sets only its note’s rate', () => {
    const row = VOICE_TARGET_TABLE[code('lfo.rate')]!;
    twoNotes('lfo.rate', 0.5, (stepped, plain) => {
      expect(stepped.lfo.rate).toBe(stepModValue(row, 2, 0.5));
      expect(plain.lfo.rate).toBe(2);
    });
  });

  it.each(['lfo', 'lfo2'] as const)(
    'moves %s from a patch rate of 0: the step scales from the floor and is heard',
    (lfo) => {
      const path = `${lfo}.rate` as const;
      const row = VOICE_TARGET_TABLE[code(path)]!;
      const want = stepModValue(row, 0, 0.5);
      expect(want).toBeCloseTo(row.floor * 2 ** (0.5 * row.span), 12);
      const plain = stillLfoNote(lfo);
      const stepped = stillLfoNote(lfo, stepAt(path, 0.5));
      expect([plain.voice[lfo].rate, plain.voice[lfo].phase]).toEqual([0, 0]);
      expect(stepped.voice[lfo].rate).toBe(want);
      expect(stepped.voice.liveValues[code(path)]).toBe(want);
      expect(stepped.voice[lfo].phase).toBeGreaterThan(0);
      expect(stepped.out).not.toEqual(plain.out);
    },
  );
});

/** The patch with both LFOs still (rate 0) and `lfo` alone on the pitch. */
function stillLfoPatch(lfo: 'lfo' | 'lfo2'): Patch {
  const still = { amount: 0, rate: 0, toPitch: 0 };
  return makePatch({
    ...PATCH,
    lfo: { ...PATCH.lfo, ...still, ...(lfo === 'lfo' ? { amount: 0.5, toPitch: 0.5 } : {}) },
    lfo2: { ...PATCH.lfo2, ...still, ...(lfo === 'lfo2' ? { amount: 0.5, toPitch: 0.5 } : {}) },
  });
}

/** One held note on `stillLfoPatch(lfo)`, with `stepMod` if given: its output and its voice at the end. */
function stillLfoNote(
  lfo: 'lfo' | 'lfo2',
  stepMod?: number[],
): { out: number[]; voice: VoiceView } {
  const processor = loaded.create(stillLfoPatch(lfo), 4);
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  const block = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const out: number[] = [];
  processor.inbox(noteOn(1, 57, stepMod));
  for (let b = 0; b < BLOCKS; b++) {
    loaded.setFrame(b * BLOCK);
    processor.process([], [block], params);
    out.push(...block[0]!);
  }
  return { out, voice: voiceOf(processor, 1) };
}
