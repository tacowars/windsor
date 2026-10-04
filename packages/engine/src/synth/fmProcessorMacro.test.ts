/**
 * Macros on the voice (windsor#560, record `2026-10-04-patch-macro-knobs`):
 * a macro's live value, shaped by each mapping, is the base of the target
 * it maps. A macro patch plays its mappings from its first note, from
 * construction; a song lane on the macro moves every mapped target on a
 * ringing voice, a step on it moves one note, a mapping on a decay time
 * reshapes a running decay and plays 1 ms at a `min` of 0, a lane on an
 * unmapped macro is silent, and a held voice keeps its note-on patch's
 * mappings through a swap with live retune off, its mapped target deaf to a
 * direct lane. `voiceMacros.test.ts` pins the arithmetic.
 */
import { describe, expect, it } from 'vitest';

import {
  ACCENT_CUTOFF,
  ACCENT_LEVEL,
  MACRO_PLAIN,
  driveMacroPart,
  macroPatch,
  mappedValue,
  voiceOf,
} from '../__fixtures__/macroPatch';
import { voiceLaneOffset } from '../__fixtures__/voiceLaneOffset';
import type { ScheduledEvent } from '../__fixtures__/workletHarness';
import { loadProcessor, render } from '../__fixtures__/workletHarness';
import { MACRO_CURVE, makeEnvelope, type Patch } from '../patch/patch';
import { VOICE_TARGET_COUNT, voiceTargetCode } from '../worklet/fm/voiceTargetTables';

const loaded = loadProcessor();
const BLOCKS = 40;
/** The block a lane starts moving a held note on. */
const FROM = 20;
const NOTE = 57;
const LEVEL = voiceTargetCode('ops.0.level');
const CUTOFF = voiceTargetCode('filter.cutoff');
const DECAY = voiceTargetCode('ops.0.env.decayTime');
const MACRO = 'macros.0.value';

const noteOn = (id: number, frame = 0, extra: Partial<ScheduledEvent> = {}): ScheduledEvent => ({
  type: 'noteOn',
  id,
  note: NOTE + id,
  velocity: 1,
  frame,
  ...extra,
});
const held = [noteOn(1)];

/** `patch` with the lead carrier's level and the cutoff set to the given numbers. */
const plainWith = (level: number, cutoff: number, patch: Patch = MACRO_PLAIN): Patch => ({
  ...patch,
  ops: patch.ops.map((op, i) => (i === 0 ? { ...op, level } : op)),
  filter: { ...patch.filter, cutoff },
});

/** A step array with `value` at the macro's row. */
const macroStep = (value: number): number[] => {
  const step = new Array<number>(VOICE_TARGET_COUNT).fill(0);
  step[voiceTargetCode(MACRO)] = value;
  return step;
};

/** Slot 0 at the offset that holds `path` at `value` over `patch`, from block `from`. */
const laneFrom =
  (patch: Patch, path: string, value: number, from = 0) =>
  (b: number, slots: Float32Array[]): void => {
    slots[0]![0] = b >= from ? voiceLaneOffset(patch, path, value) : 0;
  };

describe('a macro patch from construction (decision 10a)', () => {
  it.each([0, 0.5, 1])('at %s renders as the plain patch at the mapped values', (value) => {
    const processor = loaded.create(macroPatch(value), 4);
    const got = render(loaded, processor, BLOCKS, held).samples;
    const live = voiceOf(processor, 1).liveValues;
    expect(live[LEVEL]).toBeCloseTo(mappedValue(ACCENT_LEVEL, false, value), 12);
    expect(live[CUTOFF]).toBeCloseTo(mappedValue(ACCENT_CUTOFF, true, value), 9);
    const plain = loaded.create(plainWith(live[LEVEL]!, live[CUTOFF]!), 4);
    expect(got).toEqual(render(loaded, plain, BLOCKS, held).samples);
    const generic = loaded.create(macroPatch(value), 4, undefined, { specialise: false });
    expect(render(loaded, generic, BLOCKS, held).samples).toEqual(got);
  });
});

describe('a macro moved live', () => {
  const patch = macroPatch(0.25);

  it('a song lane on the macro moves every mapped target on a ringing voice (10b)', () => {
    let live: Float64Array = new Float64Array(0);
    const lane = driveMacroPart(loaded, {
      patch,
      slots: [MACRO],
      events: held,
      blocks: BLOCKS,
      each: laneFrom(patch, MACRO, 1, FROM),
      after: (b, processor) => {
        if (b === BLOCKS - 1) live = voiceOf(processor, 1).liveValues;
      },
    });
    const plain = driveMacroPart(loaded, { patch, events: held, blocks: BLOCKS });
    const at = FROM * 128 * 2;
    expect(lane.subarray(0, at)).toEqual(plain.subarray(0, at));
    expect(lane.subarray(at)).not.toEqual(plain.subarray(at));
    const top = loaded.create(macroPatch(1), 4);
    render(loaded, top, 1, held);
    expect(live[LEVEL]).toBe(voiceOf(top, 1).liveValues[LEVEL]);
    expect(live[CUTOFF]).toBe(voiceOf(top, 1).liveValues[CUTOFF]);
    // From the first sample, the lane plays as the patch's macro moved there.
    const whole = driveMacroPart(loaded, {
      patch,
      slots: [MACRO],
      events: held,
      blocks: BLOCKS,
      each: laneFrom(patch, MACRO, 1),
    });
    expect(whole).toEqual(
      driveMacroPart(loaded, { patch: macroPatch(1), events: held, blocks: BLOCKS }),
    );
  });

  it('a step on the macro moves its note and not the ringing neighbour (10c)', () => {
    const processor = loaded.create(patch, 4);
    render(loaded, processor, 4, [noteOn(1), noteOn(2, 128, { stepMod: macroStep(0.5) })]);
    const cutoff = (id: number): number => voiceOf(processor, id).liveValues[CUTOFF]!;
    expect(cutoff(1)).toBeCloseTo(mappedValue(ACCENT_CUTOFF, true, 0.25), 9);
    expect(cutoff(2)).toBeCloseTo(mappedValue(ACCENT_CUTOFF, true, 0.75), 9);
  });

  it("a step pushes from where the macro's lane holds it, and the bases follow", () => {
    const processor = loaded.create(patch, 4, undefined, { voiceSlots: [MACRO] });
    const slot = new Float32Array([voiceLaneOffset(patch, MACRO, 0.5)]);
    const params = {
      pitchBend: new Float32Array(1),
      modWheel: new Float32Array(1),
      gain: new Float32Array([1]),
      voiceSlot0: slot,
    };
    const out = [[new Float32Array(128), new Float32Array(128)]];
    processor.inbox(noteOn(1, 0, { stepMod: macroStep(0.25) }));
    loaded.setFrame(0);
    processor.process([], out, params);
    expect(voiceOf(processor, 1).liveValues[CUTOFF]).toBeCloseTo(
      mappedValue(ACCENT_CUTOFF, true, 0.75),
      9,
    );
  });

  it.each([
    ['Linear', MACRO_CURVE.LINEAR, false, 0.25],
    ['Exp inverted', MACRO_CURVE.EXP, true, 0.421875],
    ['Log', MACRO_CURVE.LOG, false, 0.578125],
    ['S inverted', MACRO_CURVE.S, true, 0.84375],
  ])('%s at 0.25 is its shape on the voice (10d)', (_name, curve, inverted, want) => {
    const processor = loaded.create(
      macroPatch(0.25, [{ target: 'ops.0.level', min: 0, max: 1, curve, inverted }]),
      4,
    );
    render(loaded, processor, 1, held);
    expect(voiceOf(processor, 1).liveValues[LEVEL]).toBe(want);
  });
});

describe('a macro on a decay time', () => {
  const decaying = (value: number, min: number, max: number): Patch =>
    macroPatch(value, [{ target: 'ops.0.env.decayTime', min, max }], {
      ...MACRO_PLAIN,
      ops: MACRO_PLAIN.ops.map((op, i) =>
        i === 0
          ? { ...op, env: makeEnvelope({ attackTime: 0.002, decayTime: 0.4, sustainLevel: 0 }) }
          : op,
      ),
    });

  it('reshapes a running decay when a lane moves the macro (10e)', () => {
    const patch = decaying(0.5, 0.05, 2);
    let time = NaN;
    const lane = driveMacroPart(loaded, {
      patch,
      slots: [MACRO],
      events: held,
      blocks: BLOCKS,
      each: laneFrom(patch, MACRO, 0, FROM),
      after: (b, processor) => {
        if (b === FROM) time = voiceOf(processor, 1).ampEnv[0]!.decayTime;
      },
    });
    const plain = driveMacroPart(loaded, { patch, events: held, blocks: BLOCKS });
    const at = FROM * 128 * 2;
    expect(lane.subarray(0, at)).toEqual(plain.subarray(0, at));
    expect(lane.subarray(at)).not.toEqual(plain.subarray(at));
    expect(time).toBe(0.05);
  });

  it.each([
    [0, 0.001],
    [0.5, Math.sqrt(0.001 * 2)],
    [1, 2],
  ])('with min 0, at %s plays %s s, never NaN (10g)', (value, want) => {
    const processor = loaded.create(decaying(value, 0, 2), 4);
    const { samples, nonFinite } = render(loaded, processor, BLOCKS, held);
    const v = voiceOf(processor, 1);
    expect(v.liveValues[DECAY]).toBeCloseTo(want, 9);
    expect(v.ampEnv[0]!.decayTime).toBe(v.liveValues[DECAY]);
    expect(nonFinite).toBe(0);
    expect(samples.some((s) => s !== 0)).toBe(true);
  });
});

describe('a lane the macros make silent', () => {
  it.each(['macros.0.value', 'macros.1.value'])(
    'a lane on %s, which maps nothing, changes nothing (10f)',
    (path) => {
      const patch: Patch = {
        ...macroPatch(0.5, []),
        macros: [{ name: 'Empty', value: 0.5, mappings: [] }],
      };
      const lane = driveMacroPart(loaded, {
        patch,
        slots: [path],
        events: held,
        blocks: BLOCKS,
        each: (_b, slots) => (slots[0]![0] = 0.5),
      });
      expect(lane).toEqual(driveMacroPart(loaded, { patch, events: held, blocks: BLOCKS }));
    },
  );

  it('a direct lane on a mapped target moves nothing on its voice', () => {
    const patch = macroPatch(0.5);
    const lane = driveMacroPart(loaded, {
      patch,
      slots: ['filter.cutoff'],
      events: held,
      blocks: BLOCKS,
      each: (_b, slots) => (slots[0]![0] = 2),
    });
    expect(lane).toEqual(driveMacroPart(loaded, { patch, events: held, blocks: BLOCKS }));
  });
});

describe('a held voice through a preset swap, live retune off (10h)', () => {
  it('keeps its mappings, deaf to a lane on its mapped target, while a new note follows the lane', () => {
    const mapped = macroPatch(0.5);
    const cutoffs: number[] = [];
    driveMacroPart(loaded, {
      patch: mapped,
      slots: ['filter.cutoff'],
      events: [noteOn(1), noteOn(2, 12 * 128)],
      blocks: 16,
      each: (b, slots, processor) => {
        if (b === 4) processor.inbox({ type: 'patch', patch: MACRO_PLAIN } as never);
        slots[0]![0] = b >= 8 ? voiceLaneOffset(MACRO_PLAIN, 'filter.cutoff', 4800) : 0;
      },
      after: (b, processor) => {
        if (b === 6 || b === 10 || b === 15)
          cutoffs.push(voiceOf(processor, 1).liveValues[CUTOFF]!);
        if (b === 15) cutoffs.push(voiceOf(processor, 2).liveValues[CUTOFF]!);
      },
    });
    const own = mappedValue(ACCENT_CUTOFF, true, 0.5);
    expect(cutoffs[0]).toBeCloseTo(own, 9);
    expect(cutoffs[1]).toBe(cutoffs[0]);
    expect(cutoffs[2]).toBe(cutoffs[0]);
    expect(cutoffs[3]).toBeCloseTo(4800, 9);
  });
});
