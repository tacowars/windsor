/**
 * Song automation in the FM worklet (windsor#346, record
 * `2026-10-01-song-automation-lanes` decisions 7, 10, 11 and 16): the part's
 * eight slots, each mapped to a voice target, move ringing voices and new
 * ones; an offset from the first sample plays exactly as the patch moved to
 * the lane's value, a step's offset stacks on it, the kernel and the generic
 * loop agree under a moving lane, and the fader and feedback move without
 * zipper. A slot mapped at 0, or a slot unmapped, renders sample for sample
 * as none; the goldens pin a part without slots.
 *
 * The offsets are the main thread's (`voiceOffset`), so the worklet and the
 * handles are held to one sum.
 */
import { describe, expect, it } from 'vitest';

import {
  CLICKS_LINE,
  CLICKS_PATCH,
  STEP_FRAMES,
  blocksFor,
  lineEvents,
  maxStep,
} from '../__fixtures__/voiceClicks';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { loadProcessor } from '../__fixtures__/workletHarness';
import { AUTOMATION_STEP_RAMP_SECONDS } from '../automation/automationConstants';
import { catalogRow } from '../automation/automationTargets';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import { STEP_MOD_PARAMS, STEP_MOD_SLOT_COUNT } from '../worklet/fm/stepModTables';
import { voiceSlotParamName } from './audioPart';
import { voiceOffset } from './voiceAutomation';

const loaded = loadProcessor();
const BLOCK = 128;
const SLOTS = 8;
const BLOCKS = 40;
/** The block a lane starts moving a held note on. */
const FROM = 20;
const NOTE = 57;
const ADDITIVE = 7;
/** `voiceClicks.test.ts`'s: twice the largest step windsor#7's line makes on its own. */
const CLICK_THRESHOLD = 0.05;

/** Four carriers, a resonant low-pass with its envelope, both LFOs and a pitch envelope, all held. */
const PATCH: Patch = makePatch({
  algorithm: ADDITIVE,
  pitchEnvAmount: 2,
  pitchEnv: makeEnvelope({ attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.5 }),
  ops: [1, 2, 3, 4].map((ratio) => ({
    wave: WAVE.SINE,
    ratio,
    level: 0.5,
    feedback: 0.25,
    width: 0.75,
    env: makeEnvelope({ attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.75 }),
  })),
  filter: {
    mode: FILTER_MODE.LOWPASS,
    cutoff: 1200,
    resonance: 2,
    envAmount: 1,
    env: makeEnvelope({ attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.5 }),
  },
  lfo: { amount: 0.5, rate: 2, toPitch: 0.5, toOp: [0.25, 0.25, 0.25, 0.25] },
  lfo2: { amount: 0.5, rate: 3, toWidth: [0.125, 0.125, 0.125, 0.125] },
});

/** Every target a slot carries, and a lane value whose offset is exact in binary. */
const TARGETS: readonly (readonly [string, number])[] = [
  ['filter.envAmount', 2],
  ['filter.resonance', 3],
  ...[0, 1, 2, 3].flatMap((i): [string, number][] => [
    [`ops.${i}.level`, 0.75],
    [`ops.${i}.feedback`, 0.5],
    [`ops.${i}.width`, 0.5],
  ]),
  ['lfo.amount', 0.75],
  ['lfo.rate', 4],
  ['lfo2.amount', 0.25],
  ['lfo2.rate', 6],
  ['pitchEnvAmount', 4],
];

/** `patch` with the number at `path` set to `value`. */
function moved(patch: Patch, path: string, value: number): Patch {
  const copy = structuredClone(patch);
  const keys = path.split('.');
  let at = copy as unknown as Record<string, unknown>;
  for (const key of keys.slice(0, -1)) at = at[key] as Record<string, unknown>;
  at[keys.at(-1)!] = value;
  return copy;
}

const offsetFor = (path: string, value: number, patch: Patch = PATCH): number =>
  voiceOffset(patch, path, catalogRow(`voice.${path}`)!, value);

interface Drive {
  patch?: Patch;
  slots?: (string | null)[];
  specialise?: boolean;
  events?: ScheduledEvent[];
  blocks?: number;
  /** Before block `b` renders: write its params, or post to the processor. */
  each?: (b: number, params: Record<string, Float32Array>, processor: ProcessorLike) => void;
}

const held: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 }];

/** Render a part block by block, its params rewritten before each, as interleaved stereo. */
function drive(d: Drive = {}): Float32Array {
  const processor = loaded.create(d.patch ?? PATCH, 4, undefined, {
    specialise: d.specialise ?? true,
    ...(d.slots ? { voiceSlots: d.slots } : {}),
  });
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const blocks = d.blocks ?? BLOCKS;
  const out = new Float32Array(blocks * BLOCK * 2);
  const events = d.events ?? held;
  let pending = 0;
  for (let b = 0; b < blocks; b++) {
    loaded.setFrame(b * BLOCK);
    while (pending < events.length && events[pending]!.frame < (b + 1) * BLOCK) {
      processor.inbox(events[pending++]!);
    }
    d.each?.(b, params, processor);
    processor.process([], [[left, right]], params);
    for (let i = 0; i < BLOCK; i++) {
      out[(b * BLOCK + i) * 2] = left[i]!;
      out[(b * BLOCK + i) * 2 + 1] = right[i]!;
    }
  }
  return out;
}

/** Slot 0 at `offset` from block `from`. */
const slot0From =
  (offset: number, from = 0) =>
  (b: number, params: Record<string, Float32Array>): void => {
    params.voiceSlot0![0] = b >= from ? offset : 0;
  };

const PATHS = TARGETS.map(([path]) => path);

describe('the FM part with no lane playing (windsor#346)', () => {
  it.each([true, false])(
    'renders as no slot with every slot mapped at 0 (kernel %s)',
    (specialise) => {
      const slots = PATHS.slice(0, SLOTS);
      expect(drive({ slots, specialise })).toEqual(drive({ specialise }));
    },
  );

  it('reads no unmapped slot', () => {
    const each = (_b: number, params: Record<string, Float32Array>): void => {
      for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)]![0] = 0.5;
    };
    expect(drive({ each })).toEqual(drive());
  });
});

describe('a voice lane on the FM part (windsor#346)', () => {
  it.each(TARGETS)('%s plays as the patch moved, from the first sample', (path, value) => {
    const offset = offsetFor(path, value);
    expect(offset).not.toBe(0);
    for (const specialise of [true, false]) {
      const lane = drive({ slots: [path], specialise, each: slot0From(offset) });
      expect(lane).toEqual(drive({ patch: moved(PATCH, path, value), specialise }));
    }
  });

  it.each([...PATHS, 'filter.cutoff'])('%s moves a held note while it rings', (path) => {
    const plain = drive();
    const cutoff = path === 'filter.cutoff';
    const offset = cutoff ? 1 : offsetFor(path, TARGETS.find(([p]) => p === path)![1]);
    const lane = drive({
      ...(cutoff ? {} : { slots: [path] }),
      each: (b, params) => {
        if (cutoff) params.cutoffMod![0] = b >= FROM ? offset : 0;
        else slot0From(offset, FROM)(b, params);
      },
    });
    const at = FROM * BLOCK * 2;
    expect(lane.subarray(0, at)).toEqual(plain.subarray(0, at));
    expect(lane.subarray(at)).not.toEqual(plain.subarray(at));
    expect(lane.every(Number.isFinite)).toBe(true);
  });

  it("clamps the sum to the target's bounds", () => {
    const lane = drive({ slots: ['ops.1.level'], each: slot0From(2) });
    expect(lane).toEqual(drive({ patch: moved(PATCH, 'ops.1.level', 1) }));
  });

  it("stacks a step's offset on the lane's value", () => {
    const step = new Array<number>(STEP_MOD_SLOT_COUNT).fill(0);
    step[STEP_MOD_PARAMS.indexOf('ops.0.level')] = 0.5; // 0.5 + 0.5 × span 0.5 = 0.75
    const events: ScheduledEvent[] = [{ ...held[0]!, stepMod: step }];
    const lane = drive({ slots: ['ops.0.level'], events, each: slot0From(0.125) });
    expect(lane).toEqual(drive({ patch: moved(PATCH, 'ops.0.level', 0.875) }));
  });

  it('holds the absolute value across a patch edit, the offset recomputed against the new patch', () => {
    const edited = moved(PATCH, 'ops.0.level', 0.25);
    const lane = drive({
      slots: ['ops.0.level'],
      each: (b, params, processor) => {
        if (b === 0) processor.inbox({ type: 'liveRetune', enabled: true } as never);
        if (b === FROM) processor.inbox({ type: 'patch', patch: edited } as never);
        params.voiceSlot0![0] = offsetFor('ops.0.level', 0.75, b >= FROM ? edited : PATCH);
      },
    });
    const steady = drive({
      slots: ['ops.0.level'],
      each: slot0From(offsetFor('ops.0.level', 0.75)),
    });
    let worst = 0;
    for (let i = 0; i < lane.length; i++) worst = Math.max(worst, Math.abs(lane[i]! - steady[i]!));
    expect(worst).toBeLessThan(1e-6);
  });

  it('maps and frees a slot by message', () => {
    const offset = offsetFor('ops.2.level', 0.75);
    const blocks = FROM * 3;
    const lane = drive({
      blocks,
      each: (b, params, processor) => {
        params.voiceSlot3![0] = offset;
        if (b === FROM) processor.inbox(slotsMessage([null, null, null, 'ops.2.level']));
        if (b === FROM * 2) processor.inbox(slotsMessage([]));
      },
    });
    // The same lane mapped from the start, its slot at the offset only while the message had it mapped.
    const mapped = drive({
      blocks,
      slots: [null, null, null, 'ops.2.level'],
      each: (b, params) => void (params.voiceSlot3![0] = b >= FROM && b < FROM * 2 ? offset : 0),
    });
    const plain = drive({ blocks });
    const at = FROM * BLOCK * 2;
    expect(lane.subarray(0, at)).toEqual(plain.subarray(0, at));
    expect(lane.subarray(at)).not.toEqual(plain.subarray(at));
    expect(lane).toEqual(mapped);
  });

  it('renders a moving lane the same in the kernel and the generic loop', () => {
    const slots = ['ops.0.feedback', 'ops.1.level', 'ops.2.width', 'lfo.rate', 'filter.resonance'];
    const each = (b: number, params: Record<string, Float32Array>): void => {
      const phase = Math.sin(b / 3);
      for (let i = 0; i < slots.length; i++) params[voiceSlotParamName(i)]![0] = 0.2 * phase;
      params.gain![0] = 1 + 0.25 * phase;
    };
    expect(drive({ slots, each, specialise: true })).toEqual(
      drive({ slots, each, specialise: false }),
    );
  });
});

function slotsMessage(slots: (string | null)[]): ScheduledEvent {
  return { type: 'voiceSlots', slots } as unknown as ScheduledEvent;
}

describe('the fader and feedback without zipper (windsor#346 decision 4)', () => {
  it("moves the gain across the quantum, from the last quantum's to this one's", () => {
    const halved = drive({ each: (b, params) => void (params.gain![0] = b >= FROM ? 0.5 : 1) });
    const plain = drive();
    const first = FROM * BLOCK;
    const last = first + BLOCK - 1;
    expect(halved.subarray(0, first * 2)).toEqual(plain.subarray(0, first * 2));
    expect(halved[first * 2]).toBeCloseTo(plain[first * 2]! * (1 - 0.5 / BLOCK), 6);
    expect(halved[last * 2]).toBe(Math.fround(plain[last * 2]! * 0.5));
  });

  // windsor#7's line, with a square at a sixteenth's rate on top: high for
  // half a step, low for the other half, each edge the player's 4 ms ramp
  // or, harsher, none. No sample steps further than the line's own largest.
  const line = lineEvents(CLICKS_LINE, 2);
  const blocks = blocksFor(CLICKS_LINE.length * 2);
  const plain = drive({ patch: CLICKS_PATCH, events: line, blocks });
  const low = (frame: number, ramp: number): number => {
    const into = frame % STEP_FRAMES;
    const half = STEP_FRAMES / 2;
    const fall = ramp > 0 ? Math.min(1, into / ramp) : 1;
    const rise = ramp > 0 ? Math.min(1, (into - half) / ramp) : 1;
    return into < half ? fall : 1 - rise;
  };
  const RAMP_FRAMES = Math.round(AUTOMATION_STEP_RAMP_SECONDS * loaded.sampleRate);
  const SQUARES: readonly (readonly [string, string | null, number])[] = [
    ['level', 'ops.0.level', offsetFor('ops.0.level', 0.3, CLICKS_PATCH)],
    ['feedback', 'ops.0.feedback', offsetFor('ops.0.feedback', 0, CLICKS_PATCH)],
    ['gain', null, -0.75],
  ];

  it.each(SQUARES)('plays a square on %s without a click', (_name, path, depth) => {
    for (const ramp of [RAMP_FRAMES, 0]) {
      const lane = drive({
        patch: CLICKS_PATCH,
        events: line,
        blocks,
        ...(path ? { slots: [path] } : {}),
        each: (b, params) => {
          const value = depth * low(b * BLOCK, ramp);
          if (path) params.voiceSlot0![0] = value;
          else params.gain![0] = 1 + value;
        },
      });
      expect(lane).not.toEqual(plain);
      expect(maxStep(lane)).toBeLessThan(CLICK_THRESHOLD);
      expect(maxStep(lane)).toBeLessThanOrEqual(maxStep(plain));
    }
  });
});
