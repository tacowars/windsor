/**
 * Per-step parameter modulation in the worklet (windsor#17, windsor#419): a
 * note-on's offsets become the voice's own values for the note's life, every
 * voice target moves its value and the render, per operator, a note
 * without offsets plays the patch, a slide takes the new step's offsets but
 * for the `slideKeeps` rows, and a live retune keeps them over the new patch.
 * All-zero offsets render exactly as none; the goldens pin none.
 */
import { describe, expect, it } from 'vitest';

import type {
  LoadedProcessor,
  ProcessorLike,
  ScheduledEvent,
} from '../__fixtures__/workletHarness';
import { loadProcessor, render } from '../__fixtures__/workletHarness';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import type { VoiceTargetPath } from '../worklet/fm/voiceTargetTables';
import {
  VOICE_TARGET_COUNT,
  VOICE_TARGET_PATHS,
  VOICE_TARGET_TABLE,
  voiceTargetRow,
} from '../worklet/fm/voiceTargetTables';
import { stepModValue } from '../worklet/fm/voiceTargetValue';

const loaded: LoadedProcessor = loadProcessor();
const BLOCKS = 30;
const NOTE = 57;
const ADDITIVE = 7;

interface EnvelopeInternals {
  decayTime: number;
  decayCurve: number;
}

interface VoiceInternals {
  active: boolean;
  voiceId: number;
  liveValues: Float64Array;
  filtEnv: EnvelopeInternals;
  ampEnv: EnvelopeInternals[];
}

const voiceOf = (processor: ProcessorLike, id: number): VoiceInternals => {
  const voices = processor.voices as unknown as VoiceInternals[];
  const found = voices.find((v) => v.active && v.voiceId === id);
  if (!found) throw new Error(`no active voice for note ${id}`);
  return found;
};

/** Four saw carriers, a low-pass, both LFOs and a pitch envelope: every target but the vowel audible. */
const PATCH: Patch = makePatch({
  lfo: { rate: 3, amount: 0.5, toPitch: 0.5 },
  lfo2: { rate: 5, amount: 0.5, toOp: [0.3, 0.3, 0.3, 0.3] },
  pitchEnv: makeEnvelope({ attackTime: 0, decayTime: 0.05, sustainLevel: 0 }),
  pitchEnvAmount: 5,
  algorithm: ADDITIVE,
  ops: [1, 2, 3, 4].map((ratio) => ({
    wave: WAVE.SAW,
    ratio,
    level: 0.5,
    feedback: 0.2,
    width: 0.7,
    env: makeEnvelope({ attackTime: 0.002, decayTime: 0.08, decayCurve: 0.3, sustainLevel: 0.4 }),
  })),
  filter: {
    mode: FILTER_MODE.LOWPASS,
    cutoff: 1200,
    resonance: 2,
    envAmount: 2,
    env: makeEnvelope({ attackTime: 0.002, decayTime: 0.08, sustainLevel: 0 }),
  },
});

/** The same in the Formant mode, where the vowel is heard. */
const FORMANT: Patch = {
  ...PATCH,
  filter: { ...PATCH.filter, mode: FILTER_MODE.FORMANT, vowel: 1.2 },
};

/** The patch a parameter is heard on. */
const patchFor = (param: VoiceTargetPath): Patch => (param === 'filter.vowel' ? FORMANT : PATCH);

/** The patch's own value at a parameter's path. */
function base(patch: Patch, param: VoiceTargetPath): number {
  let at: unknown = patch;
  for (const key of param.split('.')) at = (at as Record<string, unknown>)[key];
  return at as number;
}

/** The voice's value for a parameter: what the control update, the envelopes and the loops read. */
function played(v: VoiceInternals, param: VoiceTargetPath): number {
  const live = v.liveValues[VOICE_TARGET_PATHS.indexOf(param)]!;
  if (param === 'filter.env.decayTime') expect(v.filtEnv.decayTime).toBe(live);
  const op = /^ops\.(\d)\.env\.(decayTime|decayCurve)$/.exec(param);
  if (op) expect(v.ampEnv[Number(op[1])]![op[2] as 'decayTime' | 'decayCurve']).toBe(live);
  return live;
}

/** A dense offset array with `value` at `param`'s slot. */
function offsets(param: VoiceTargetPath, value: number): number[] {
  const out = new Array<number>(VOICE_TARGET_COUNT).fill(0);
  out[VOICE_TARGET_PATHS.indexOf(param)] = value;
  return out;
}

const noteOn = (
  id: number,
  frame: number,
  extra: Partial<ScheduledEvent> = {},
): ScheduledEvent => ({
  type: 'noteOn',
  id,
  note: NOTE,
  velocity: 1,
  frame,
  ...extra,
});

/** Deliver `events` (all at frame 0) through one rendered block. */
function play(processor: ProcessorLike, ...events: ScheduledEvent[]): void {
  render(loaded, processor, 1, events);
}

function renderWith(stepMod?: readonly number[], specialise = true, patch = PATCH): Float32Array {
  const processor = loaded.create(patch, 4, undefined, { specialise });
  return render(loaded, processor, BLOCKS, [noteOn(1, 0, stepMod ? { stepMod } : {})]).samples;
}

describe('step offsets in the voice (windsor#17)', () => {
  it('all-zero offsets render sample for sample as none', () => {
    expect(renderWith(new Array<number>(VOICE_TARGET_COUNT).fill(0))).toEqual(renderWith());
  });

  it.each(VOICE_TARGET_PATHS.map((p) => [p]))('%s moves its target and the render', (param) => {
    const row = voiceTargetRow(param)!;
    const patch = patchFor(param);
    const plain = renderWith(undefined, true, patch);
    for (const value of [0.5, -0.5]) {
      const processor = loaded.create(patch, 4);
      play(processor, noteOn(1, 0, { stepMod: offsets(param, value) }));
      const got = played(voiceOf(processor, 1), param);
      expect(got, `${param} at ${value}`).toBe(stepModValue(row, base(patch, param), value));
      expect(got).not.toBe(base(patch, param));
      expect(renderWith(offsets(param, value), true, patch)).not.toEqual(plain);
    }
  });

  it('the kernel and the generic loop agree to the bit with offsets', () => {
    const all = VOICE_TARGET_TABLE.map((_, s) => (s % 2 === 0 ? 0.4 : -0.3));
    expect(renderWith(all, true)).toEqual(renderWith(all, false));
  });

  it('a cutoff of +0.5 raises only its note by half the span in octaves', () => {
    const span = voiceTargetRow('filter.cutoff')!.span;
    const processor = loaded.create(PATCH, 4);
    play(processor, noteOn(1, 0, { stepMod: offsets('filter.cutoff', 0.5) }));
    const cutoff = (id: number): number => played(voiceOf(processor, id), 'filter.cutoff');
    expect(Math.log2(cutoff(1) / PATCH.filter.cutoff)).toBeCloseTo(span / 2, 12);
    play(processor, { type: 'noteOff', id: 1, frame: 0 }, noteOn(2, 0));
    expect(cutoff(2)).toBe(PATCH.filter.cutoff);
  });

  it('a positive level offset is louder, a negative one quieter', () => {
    const rms = (x: Float32Array): number => Math.sqrt(x.reduce((a, s) => a + s * s, 0) / x.length);
    const plain = rms(renderWith());
    const louder = VOICE_TARGET_PATHS.filter((p) => p.endsWith('.level')).map((p) => offsets(p, 1));
    const up = louder.reduce((a, o) => a.map((x, s) => x + o[s]!));
    expect(rms(renderWith(up))).toBeGreaterThan(plain);
    expect(rms(renderWith(up.map((x) => -x)))).toBeLessThan(plain);
  });
});

describe('step offsets across a slide and a live retune (windsor#17)', () => {
  const MONO: Patch = { ...PATCH, mono: true };
  const everywhere = (value: number): number[] => new Array<number>(VOICE_TARGET_COUNT).fill(value);

  it('a slide takes the new step’s offsets, but keeps the decay curve’s and feedback’s', () => {
    const processor = loaded.create(MONO, 4, undefined, { slideSeconds: 0.02 });
    play(processor, noteOn(1, 0, { stepMod: everywhere(0.25) }));
    play(processor, { ...noteOn(2, 0, { stepMod: everywhere(-0.5), slide: true }), note: 60 });
    const v = voiceOf(processor, 2);
    for (const row of VOICE_TARGET_TABLE) {
      const want = stepModValue(row, base(MONO, row.path), row.slideKeeps ? 0.25 : -0.5);
      expect(played(v, row.path), row.path).toBe(want);
    }
  });

  it('a live retune keeps the note’s offsets over the new patch’s values', () => {
    const processor = loaded.create(PATCH, 4);
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    play(processor, noteOn(1, 0, { stepMod: offsets('filter.cutoff', 0.5) }));
    const retuned = { ...PATCH, filter: { ...PATCH.filter, cutoff: 600 } };
    processor.inbox({ type: 'patch', patch: retuned } as unknown as ScheduledEvent);
    play(processor);
    const row = voiceTargetRow('filter.cutoff')!;
    expect(played(voiceOf(processor, 1), 'filter.cutoff')).toBe(stepModValue(row, 600, 0.5));
  });
});
