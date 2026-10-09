/**
 * An operator's ratio as a target and an LFO destination (windsor#646,
 * record `2026-10-09-operator-hard-sync` decisions 9 and 10), read off the
 * shipped worklet's voice: a step of +1 on `ops.<i>.ratio` moves the
 * operator's frequency by the row's span in octaves, held to the row's
 * bounds; a macro mapped to the row and a song lane on it move it; LFO 1's
 * and LFO 2's `toRatio` sweep it a depth in octaves either side; and a
 * fixed-frequency operator ignores all of them, as it ignores its ratio.
 * The rows' insertion moves no lane or mapping off its target: a lane on
 * `lfo.rate` and a mapping onto `lfo2.amount`, both past the new rows, move
 * what they always moved.
 */
import { describe, expect, it } from 'vitest';

import { voiceLaneOffset } from '../__fixtures__/voiceLaneOffset';
import { loadProcessor } from '../__fixtures__/workletHarness';
import type { CreateOptions, ScheduledEvent } from '../__fixtures__/workletHarness';
import { FILTER_MODE, makePatch } from '../patch/patch';
import type { PartialPatch, Patch } from '../patch/patch';
import {
  VOICE_TARGET_COUNT,
  VOICE_TARGET_SPAN,
  voiceTargetCode,
} from '../worklet/fm/voiceTargetTables';
import { voiceSlotParamName } from './audioPart';

const loaded = loadProcessor();
const BLOCK = 128;
const SLOTS = 8;
const NOTE = 60;
/** The played note's frequency at A4 = 440 Hz. */
const NOTE_HZ = 440 * 2 ** ((NOTE - 69) / 12);
const B_RATIO = 'ops.1.ratio';

interface RatioVoice {
  active: boolean;
  opFreq: Float64Array;
  lfoLevel: number;
  lfo2Level: number;
  lfo: { rate: number };
  liveValues: Float64Array;
}

/** B, a carrier at `ratio` (or fixed at 300 Hz), beside a silent A, with `over` on the patch. */
function patchB(ratio: number, over: PartialPatch = {}, fixed = false): Patch {
  return makePatch({
    algorithm: 7,
    filter: { mode: FILTER_MODE.OFF },
    ...over,
    ops: [{ level: 0 }, { level: 1, ratio, fixed, fixedHz: 300 }, {}, {}],
  });
}

interface Run {
  patch: Patch;
  blocks?: number;
  stepMod?: number[];
  options?: CreateOptions;
  /** Slot 0's offset for block `b`. */
  offset?: (b: number) => number;
  /** After block `b` renders, with the sounding voice. */
  after?: (b: number, voice: RatioVoice) => void;
}

/** One held note, block by block; the voice after the last block. */
function run(r: Run): RatioVoice {
  const processor = loaded.create(r.patch, 1, undefined, r.options ?? {});
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  const out = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
  const note: ScheduledEvent = { type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 };
  if (r.stepMod) note.stepMod = r.stepMod;
  let voice: RatioVoice | undefined;
  for (let b = 0; b < (r.blocks ?? 1); b++) {
    loaded.setFrame(b * BLOCK);
    if (b === 0) processor.inbox(note);
    params.voiceSlot0![0] = r.offset?.(b) ?? 0;
    processor.process([], [out], params);
    voice = (processor.voices as unknown as RatioVoice[]).find((v) => v.active);
    r.after?.(b, voice!);
  }
  return voice!;
}

/** A note-on's step array with `value` at `path`. */
function stepAt(path: string, value: number): number[] {
  const step = new Array<number>(VOICE_TARGET_COUNT).fill(0);
  step[voiceTargetCode(path)] = value;
  return step;
}

const SPAN = VOICE_TARGET_SPAN[voiceTargetCode(B_RATIO)]!;

describe('a step on an operator’s ratio (windsor#646)', () => {
  it('moves its frequency by the row’s span in octaves a step of 1, and by half that a step of 0.5', () => {
    expect(run({ patch: patchB(0.5) }).opFreq[1]).toBeCloseTo(NOTE_HZ * 0.5, 9);
    for (const step of [1, 0.5, -0.25]) {
      const voice = run({ patch: patchB(0.5), stepMod: stepAt(B_RATIO, step) });
      expect(Math.log2(voice.opFreq[1]! / (NOTE_HZ * 0.5)), `step ${step}`).toBeCloseTo(
        step * SPAN,
        9,
      );
    }
  });

  it('holds the ratio to the console’s range, 1/16 to 24', () => {
    const down = run({ patch: patchB(0.5), stepMod: stepAt(B_RATIO, -1) });
    expect(down.opFreq[1]).toBeCloseTo(NOTE_HZ * 0.0625, 9);
    const up = run({ patch: patchB(4), stepMod: stepAt(B_RATIO, 1) });
    expect(up.opFreq[1]).toBeCloseTo(NOTE_HZ * 24, 9);
  });

  it('leaves a fixed-frequency operator where it is', () => {
    const voice = run({ patch: patchB(0.5, {}, true), stepMod: stepAt(B_RATIO, 1) });
    expect(voice.opFreq[1]).toBe(300);
  });
});

describe('a macro on an operator’s ratio (windsor#646)', () => {
  it('sets the ratio its value maps, and a fixed-frequency operator ignores it', () => {
    const macros = [{ value: 1, mappings: [{ target: B_RATIO, min: 1, max: 3 }] }];
    expect(run({ patch: patchB(0.5, { macros } as PartialPatch) }).opFreq[1]).toBeCloseTo(
      NOTE_HZ * 3,
      9,
    );
    const half = [{ value: 0.5, mappings: [{ target: B_RATIO, min: 1, max: 4 }] }];
    // A ratio row maps geometrically: half way from 1 to 4 is 2.
    expect(run({ patch: patchB(0.5, { macros: half } as PartialPatch) }).opFreq[1]).toBeCloseTo(
      NOTE_HZ * 2,
      9,
    );
    const fixed = run({ patch: patchB(0.5, { macros } as PartialPatch, true) });
    expect(fixed.opFreq[1]).toBe(300);
  });
});

describe('a song lane on an operator’s ratio (windsor#646)', () => {
  it('sweeps the ratio through the values the main thread sends', () => {
    const patch = patchB(1);
    const values = [1, 1.5, 2.37, 4, 0.25];
    const heard: number[] = [];
    run({
      patch,
      blocks: values.length * 4,
      options: { voiceSlots: [B_RATIO] },
      offset: (b) => voiceLaneOffset(patch, B_RATIO, values[Math.floor(b / 4)]!),
      after: (b, voice) => {
        if (b % 4 === 3) heard.push(voice.opFreq[1]! / NOTE_HZ);
      },
    });
    // The offset reaches the worklet as a 32-bit parameter value.
    values.forEach((v, i) => expect(heard[i], `value ${v}`).toBeCloseTo(v, 6));
  });
});

describe('an LFO on an operator’s ratio (windsor#646)', () => {
  it.each([
    ['LFO 1', 'lfo', 'lfoLevel'],
    ['LFO 2', 'lfo2', 'lfo2Level'],
  ] as const)(
    'sweeps it ±1 octave at a depth of 1 on %s, and a fixed operator not at all',
    (_, lfo, level) => {
      const settings = { rate: 2, amount: 1, retrigger: true, toRatio: [0, 1, 0, 0] };
      const octaves: number[] = [];
      run({
        patch: patchB(1.5, { [lfo]: settings }),
        blocks: 400,
        after: (_b, voice) => {
          const heard = Math.log2(voice.opFreq[1]! / (NOTE_HZ * 1.5));
          expect(heard).toBeCloseTo(voice[level], 9);
          octaves.push(heard);
        },
      });
      expect(Math.max(...octaves)).toBeGreaterThan(0.99);
      expect(Math.min(...octaves)).toBeLessThan(-0.99);
      run({
        patch: patchB(1.5, { [lfo]: settings }, true),
        blocks: 40,
        after: (_b, voice) => expect(voice.opFreq[1]).toBe(300),
      });
    },
  );
});

describe('the targets past the new rows (windsor#646)', () => {
  it('a lane on the LFO rate still moves the LFO rate, and a mapping onto LFO 2’s amount LFO 2’s amount', () => {
    const patch = makePatch({
      lfo: { rate: 3 },
      macros: [{ value: 1, mappings: [{ target: 'lfo2.amount', min: 0, max: 0.75 }] }],
    });
    const voice = run({
      patch,
      options: { voiceSlots: ['lfo.rate'] },
      offset: () => voiceLaneOffset(patch, 'lfo.rate', 6),
    });
    expect(voice.lfo.rate).toBeCloseTo(6, 9);
    expect(voice.liveValues[voiceTargetCode('lfo2.amount')]).toBe(0.75);
  });
});
