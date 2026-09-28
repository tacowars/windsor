/**
 * Per-step parameter modulation in the worklet (windsor#17): a note-on's
 * offsets become the voice's own values for the note's life, every
 * first-cut parameter moves its target and the render, per operator, a note
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
import type { StepModParam } from '../worklet/fm/stepModTables';
import { STEP_MOD_PARAMS, STEP_MOD_SLOT_COUNT, STEP_MOD_TABLE } from '../worklet/fm/stepModTables';
import { stepModValue } from '../worklet/fm/stepModValue';

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
  envAmount: number;
  cutoff: number;
  resonance: number;
  opLevel: Float64Array;
  opFeedback: Float32Array;
  opWidth: Float64Array;
  filtEnv: EnvelopeInternals;
  ampEnv: EnvelopeInternals[];
}

const voiceOf = (processor: ProcessorLike, id: number): VoiceInternals => {
  const voices = processor.voices as unknown as VoiceInternals[];
  const found = voices.find((v) => v.active && v.voiceId === id);
  if (!found) throw new Error(`no active voice for note ${id}`);
  return found;
};

/** Four saw carriers and a low-pass, every first-cut parameter audible. */
const PATCH: Patch = makePatch({
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

/** The patch's own value at a parameter's path. */
function base(patch: Patch, param: StepModParam): number {
  let at: unknown = patch;
  for (const key of param.split('.')) at = (at as Record<string, unknown>)[key];
  return at as number;
}

/** The voice's value for a parameter: what the control update and the loops read. */
function played(v: VoiceInternals, param: StepModParam): number {
  const [head, index, ...rest] = param.split('.');
  if (head === 'filter') {
    if (param === 'filter.env.decayTime') return v.filtEnv.decayTime;
    return v[index as 'envAmount' | 'cutoff' | 'resonance'];
  }
  const i = Number(index);
  switch (rest.join('.')) {
    case 'level':
      return v.opLevel[i]!;
    case 'env.decayTime':
      return v.ampEnv[i]!.decayTime;
    case 'env.decayCurve':
      return v.ampEnv[i]!.decayCurve;
    case 'feedback':
      return v.opFeedback[i]!;
    default:
      return v.opWidth[i]!;
  }
}

/** A dense offset array with `value` at `param`'s slot. */
function offsets(param: StepModParam, value: number): number[] {
  const out = new Array<number>(STEP_MOD_SLOT_COUNT).fill(0);
  out[STEP_MOD_PARAMS.indexOf(param)] = value;
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

function renderWith(stepMod?: readonly number[], specialise = true): Float32Array {
  const processor = loaded.create(PATCH, 4, undefined, { specialise });
  return render(loaded, processor, BLOCKS, [noteOn(1, 0, stepMod ? { stepMod } : {})]).samples;
}

describe('step offsets in the voice (windsor#17)', () => {
  it('all-zero offsets render sample for sample as none', () => {
    expect(renderWith(new Array<number>(STEP_MOD_SLOT_COUNT).fill(0))).toEqual(renderWith());
  });

  it.each(STEP_MOD_PARAMS.map((p) => [p]))('%s moves its target and the render', (param) => {
    const row = STEP_MOD_TABLE.find((r) => r.param === param)!;
    const plain = renderWith();
    for (const value of [0.5, -0.5]) {
      const processor = loaded.create(PATCH, 4);
      play(processor, noteOn(1, 0, { stepMod: offsets(param, value) }));
      const want = stepModValue(row, base(PATCH, param), value);
      const got = played(voiceOf(processor, 1), param);
      expect(got, `${param} at ${value}`).toBe(
        param.endsWith('feedback') ? Math.fround(want) : want,
      );
      expect(got).not.toBe(base(PATCH, param));
      expect(renderWith(offsets(param, value))).not.toEqual(plain);
    }
  });

  it('the kernel and the generic loop agree to the bit with offsets', () => {
    const all = STEP_MOD_TABLE.map((_, s) => (s % 2 === 0 ? 0.4 : -0.3));
    expect(renderWith(all, true)).toEqual(renderWith(all, false));
  });

  it('a cutoff of +0.5 raises only its note by half the span in octaves', () => {
    const span = STEP_MOD_TABLE.find((r) => r.param === 'filter.cutoff')!.span;
    const processor = loaded.create(PATCH, 4);
    play(processor, noteOn(1, 0, { stepMod: offsets('filter.cutoff', 0.5) }));
    expect(Math.log2(voiceOf(processor, 1).cutoff / PATCH.filter.cutoff)).toBeCloseTo(span / 2, 12);
    play(processor, { type: 'noteOff', id: 1, frame: 0 }, noteOn(2, 0));
    expect(voiceOf(processor, 2).cutoff).toBe(PATCH.filter.cutoff);
  });

  it('a positive level offset is louder, a negative one quieter', () => {
    const rms = (x: Float32Array): number => Math.sqrt(x.reduce((a, s) => a + s * s, 0) / x.length);
    const plain = rms(renderWith());
    const louder = STEP_MOD_PARAMS.filter((p) => p.endsWith('.level')).map((p) => offsets(p, 1));
    const up = louder.reduce((a, o) => a.map((x, s) => x + o[s]!));
    expect(rms(renderWith(up))).toBeGreaterThan(plain);
    expect(rms(renderWith(up.map((x) => -x)))).toBeLessThan(plain);
  });
});

describe('step offsets across a slide and a live retune (windsor#17)', () => {
  const MONO: Patch = { ...PATCH, mono: true };
  const everywhere = (value: number): number[] =>
    new Array<number>(STEP_MOD_SLOT_COUNT).fill(value);

  it('a slide takes the new step’s offsets, but keeps the decay curve’s and feedback’s', () => {
    const processor = loaded.create(MONO, 4, undefined, { slideSeconds: 0.02 });
    play(processor, noteOn(1, 0, { stepMod: everywhere(0.25) }));
    play(processor, { ...noteOn(2, 0, { stepMod: everywhere(-0.5), slide: true }), note: 60 });
    const v = voiceOf(processor, 2);
    for (const row of STEP_MOD_TABLE) {
      const want = stepModValue(row, base(MONO, row.param), row.slideKeeps ? 0.25 : -0.5);
      const exact = row.param.endsWith('feedback') ? Math.fround(want) : want;
      expect(played(v, row.param), row.param).toBe(exact);
    }
  });

  it('a live retune keeps the note’s offsets over the new patch’s values', () => {
    const processor = loaded.create(PATCH, 4);
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    play(processor, noteOn(1, 0, { stepMod: offsets('filter.cutoff', 0.5) }));
    const retuned = { ...PATCH, filter: { ...PATCH.filter, cutoff: 600 } };
    processor.inbox({ type: 'patch', patch: retuned } as unknown as ScheduledEvent);
    const row = STEP_MOD_TABLE.find((r) => r.param === 'filter.cutoff')!;
    expect(voiceOf(processor, 1).cutoff).toBe(stepModValue(row, 600, 0.5));
  });
});
