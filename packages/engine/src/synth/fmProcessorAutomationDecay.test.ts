/**
 * The nine decay lanes on the FM part (windsor#347, record
 * `2026-10-01-song-automation-lanes` decision 7): the filter's envelope
 * decay, and each operator's envelope decay and decay curve, follow a lane on
 * ringing voices through windsor#346's slots.
 *
 * - A lane from the first sample plays exactly as the patch moved to its
 *   value, in the kernel and in the generic loop.
 * - A lane moved during the attack is heard from the decay on, exactly as the
 *   moved patch; one moved during the sustain or the release leaves that note
 *   as it was, and the next note plays the lane's value.
 * - A moving lane renders the same in the kernel and the generic loop.
 * - windsor#7's line, with a square at a sixteenth's rate on each decay
 *   target, makes no click (`__fixtures__/voiceClicks.ts`).
 *
 * `fmProcessorAutomationDecayEdge.test.ts` holds the level's continuity at
 * the change, at the register's ends. The offsets are the main thread's
 * (`voiceOffset`), so the worklet and the handles are held to one sum.
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
import { voiceLaneOffset } from '../__fixtures__/voiceLaneOffset';
import { AUTOMATION_STEP_RAMP_SECONDS } from '../automation/automationConstants';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import { voiceSlotParamName } from './audioPart';

const loaded = loadProcessor();
const BLOCK = 128;
const SLOTS = 8;
const NOTE = 57;
const ADDITIVE = 7;
/** `voiceClicks.test.ts`'s: twice the largest step windsor#7's line makes on its own. */
const CLICK_THRESHOLD = 0.05;

/** The nine decay targets, by patch path. */
const DECAYS: readonly string[] = [
  'filter.env.decayTime',
  ...[0, 1, 2, 3].flatMap((i) => [`ops.${i}.env.decayTime`, `ops.${i}.env.decayCurve`]),
];

/** Four carriers and a low-pass, each envelope decaying a quarter second under its own curve. */
const decaying = (attackTime = 0.002): Patch =>
  makePatch({
    algorithm: ADDITIVE,
    ops: [0.5, -0.5, 0.25, -0.25].map((decayCurve, i) => ({
      wave: WAVE.SINE,
      ratio: i + 1,
      level: 0.5,
      env: makeEnvelope({ attackTime, decayTime: 0.25, decayCurve, sustainLevel: 0.5 }),
    })),
    filter: {
      mode: FILTER_MODE.LOWPASS,
      cutoff: 300,
      resonance: 2,
      envAmount: 4,
      env: makeEnvelope({ attackTime, decayTime: 0.25, sustainLevel: 0 }),
    },
  });
const PATCH = decaying();

/** A lane value for `path` whose offset is exact in binary: a quarter of the time, or the curve flipped. */
function laneValue(patch: Patch, path: string): number {
  const own = valueAt(patch, path);
  return path.endsWith('decayTime') ? own / 4 : -own;
}

function valueAt(patch: Patch, path: string): number {
  let at: unknown = patch;
  for (const key of path.split('.')) at = (at as Record<string, unknown>)[key];
  return at as number;
}

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
  voiceLaneOffset(patch, path, value);

interface Drive {
  patch?: Patch;
  slots?: string[];
  specialise?: boolean;
  events?: ScheduledEvent[];
  blocks?: number;
  /** Before block `b` renders: write its params. */
  each?: (b: number, params: Record<string, Float32Array>) => void;
  /** After block `b` renders. */
  after?: (b: number, processor: ProcessorLike) => void;
  /** Every control block at the fine interval, as before windsor#326. */
  fine?: boolean;
}

const held: ScheduledEvent[] = [{ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 }];

/** Render a part block by block, its params rewritten before each, as interleaved stereo. */
function drive(d: Drive = {}): Float32Array {
  const processor = loaded.create(d.patch ?? PATCH, 4, undefined, {
    specialise: d.specialise ?? true,
    ...(d.slots ? { voiceSlots: d.slots } : {}),
    ...(d.fine ? { controlIntervals: { long: loaded.ctrlInterval } } : {}),
  });
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const blocks = d.blocks ?? 120;
  const out = new Float32Array(blocks * BLOCK * 2);
  const events = d.events ?? held;
  let pending = 0;
  for (let b = 0; b < blocks; b++) {
    loaded.setFrame(b * BLOCK);
    while (pending < events.length && events[pending]!.frame < (b + 1) * BLOCK) {
      processor.inbox(events[pending++]!);
    }
    d.each?.(b, params);
    processor.process([], [[left, right]], params);
    d.after?.(b, processor);
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

describe('a decay lane on the FM part (windsor#347)', () => {
  it.each(DECAYS)('%s plays as the patch moved, from the first sample', (path) => {
    const value = laneValue(PATCH, path);
    const offset = offsetFor(path, value);
    expect(offset).not.toBe(0);
    for (const specialise of [true, false]) {
      const lane = drive({ slots: [path], specialise, each: slot0From(offset) });
      expect(lane).toEqual(drive({ patch: moved(PATCH, path, value), specialise }));
    }
  });

  it.each(DECAYS)('%s moves a held note while its decay runs', (path) => {
    const plain = drive();
    const from = 20; // 53 ms in: a quarter of the way down the decay
    const lane = drive({
      slots: [path],
      each: slot0From(offsetFor(path, laneValue(PATCH, path)), from),
    });
    const at = from * BLOCK * 2;
    expect(lane.subarray(0, at)).toEqual(plain.subarray(0, at));
    expect(lane.subarray(at)).not.toEqual(plain.subarray(at));
    expect(lane.every(Number.isFinite)).toBe(true);
  });

  it.each(DECAYS)('%s moved during the attack is heard from the decay on', (path) => {
    // A 0.1 s attack is 37.5 quanta; the lane moves at quantum 10.
    const slow = decaying(0.1);
    const value = laneValue(slow, path);
    const lane = drive({
      patch: slow,
      slots: [path],
      each: slot0From(offsetFor(path, value, slow), 10),
    });
    expect(lane).not.toEqual(drive({ patch: slow }));
    expect(lane).toEqual(drive({ patch: moved(slow, path, value) }));
  });

  // A note held into its sustain, released at quantum 120 for a quarter
  // second, and a second note at quantum 300, after the first has ended.
  const twoNotes: ScheduledEvent[] = [
    { type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 },
    { type: 'noteOff', id: 1, frame: 120 * BLOCK },
    { type: 'noteOn', id: 2, note: NOTE, velocity: 1, frame: 300 * BLOCK },
  ];
  it.each(
    DECAYS.flatMap((path) => [[path, 'sustain', 100] as const, [path, 'release', 150] as const]),
  )(
    '%s moved during the %s leaves that note alone, and the next note plays it',
    (path, _stage, from) => {
      const value = laneValue(PATCH, path);
      const blocks = 420;
      const lane = drive({
        events: twoNotes,
        blocks,
        slots: [path],
        each: slot0From(offsetFor(path, value), from),
      });
      const next = 300 * BLOCK * 2;
      const plain = drive({ events: twoNotes, blocks });
      expect(lane.subarray(0, next)).toEqual(plain.subarray(0, next));
      const movedRender = drive({ events: twoNotes, blocks, patch: moved(PATCH, path, value) });
      expect(lane.subarray(next)).toEqual(movedRender.subarray(next));
      expect(lane.subarray(next)).not.toEqual(plain.subarray(next));
    },
  );

  it("plays a decay time from its 1 ms floor where the patch's is 0, as the main thread reckons it", () => {
    const path = 'ops.0.env.decayTime';
    const patch = moved(PATCH, path, 0);
    const decays: number[] = [];
    drive({
      patch,
      slots: [path],
      blocks: 2,
      each: slot0From(offsetFor(path, 0.5, patch)),
      after: (_b, processor) => {
        const voice = processor.voices[0] as unknown as { ampEnv: { decayTime: number }[] };
        decays.push(voice.ampEnv[0]!.decayTime);
      },
    });
    expect(decays[1]).toBeCloseTo(0.5, 5);
  });

  // PR #400 round 1: a lane at or below the floor over a patch decay of 0 is
  // offset 0 on the main thread, and still plays the 1 ms floor.
  const DECAY_TIMES = DECAYS.filter((path) => path.endsWith('decayTime'));
  const zeroed = (): Patch => DECAY_TIMES.reduce((p, path) => moved(p, path, 0), PATCH);
  /** The decay time the envelope `path` names plays, after the second block. */
  function decayPlayed(path: string, slots: string[] | undefined, offset: number): number {
    let decay = NaN;
    drive({
      patch: zeroed(),
      ...(slots ? { slots } : {}),
      blocks: 2,
      each: slot0From(offset),
      after: (_b, processor) => {
        const voice = processor.voices[0] as unknown as {
          ampEnv: { decayTime: number }[];
          filtEnv: { decayTime: number };
        };
        const op = path.startsWith('filter.') ? -1 : Number(path.split('.')[1]);
        decay = op < 0 ? voice.filtEnv.decayTime : voice.ampEnv[op]!.decayTime;
      },
    });
    return decay;
  }

  it.each(DECAY_TIMES.flatMap((path) => [0, 0.001].map((lane) => [path, lane] as const)))(
    '%s held at %f over a patch decay of 0 plays the 1 ms floor',
    (path, lane) => {
      const offset = offsetFor(path, lane, zeroed());
      expect(offset).toBe(0);
      expect(decayPlayed(path, [path], offset)).toBe(0.001);
    },
  );

  /** A lane on a target with no floor, held at its patch's value. */
  const CURVE = 'ops.0.env.decayCurve';

  it.each(DECAY_TIMES)('%s of 0 still decays instantly with no lane on it', (path) => {
    expect(decayPlayed(path, undefined, 0)).toBe(0);
    expect(decayPlayed(path, [CURVE], 0)).toBe(0);
  });

  it('renders decays of 0 bit for bit with a lane on another target at offset 0', () => {
    expect(drive({ patch: zeroed(), slots: [CURVE] })).toEqual(drive({ patch: zeroed() }));
  });

  it('renders moving decay lanes the same in the kernel and the generic loop', () => {
    const slots = DECAYS.slice(0, SLOTS);
    const each = (b: number, params: Record<string, Float32Array>): void => {
      const phase = Math.sin(b / 3);
      for (let i = 0; i < slots.length; i++) params[voiceSlotParamName(i)]![0] = 0.4 * phase;
    };
    const kernel = drive({ slots, each, specialise: true });
    expect(kernel).not.toEqual(drive());
    expect(kernel).toEqual(drive({ slots, each, specialise: false }));
  });
});

describe('a square on each decay target without a click (windsor#347)', () => {
  // windsor#7's line on four audible carriers, each with its own decay, with a
  // square at a sixteenth's rate on top: at the far end for half a step, back
  // for the other half, each edge the player's 4 ms ramp or, harsher, none.
  // No sample steps past the click threshold, nor further than the line's own
  // largest with the lane held at either end. That bound is tight: it holds
  // with every control block fine, and a lane that moves a voice between the
  // fine and the long interval (windsor#326) steps up to 0.1 % past it, so
  // the bound is read with every block fine and the threshold with both.
  const patch: Patch = {
    ...CLICKS_PATCH,
    algorithm: ADDITIVE,
    ops: CLICKS_PATCH.ops.map((op, i) =>
      i === 0 ? op : { ...op, ratio: i + 1, level: 0.25, env: { ...op.env, decayCurve: -0.5 } },
    ),
  };
  const line = lineEvents(CLICKS_LINE, 2);
  const blocks = blocksFor(CLICKS_LINE.length * 2);
  const plain = drive({ patch, events: line, blocks, fine: true });
  const low = (frame: number, ramp: number): number => {
    const into = frame % STEP_FRAMES;
    const half = STEP_FRAMES / 2;
    const fall = ramp > 0 ? Math.min(1, into / ramp) : 1;
    const rise = ramp > 0 ? Math.min(1, (into - half) / ramp) : 1;
    return into < half ? fall : 1 - rise;
  };
  const RAMP_FRAMES = Math.round(AUTOMATION_STEP_RAMP_SECONDS * loaded.sampleRate);
  /** The square's far end: a decay of 50 ms, or the curve at its other extreme. */
  const far = (path: string): number => (path.endsWith('decayTime') ? 0.05 : 1);

  it.each(DECAYS)('plays a square on %s without a click', (path) => {
    const depth = offsetFor(path, far(path), patch);
    expect(depth).not.toBe(0);
    // The line with the lane held at the far end: a decay that holds a
    // carrier louder makes its wave's own steps larger, and that is no click.
    const atFar = drive({
      patch,
      events: line,
      blocks,
      slots: [path],
      each: (_b, params) => void (params.voiceSlot0![0] = depth),
      fine: true,
    });
    for (const ramp of [RAMP_FRAMES, 0]) {
      const square = (fine: boolean): Float32Array =>
        drive({
          patch,
          events: line,
          blocks,
          slots: [path],
          each: (b, params) => void (params.voiceSlot0![0] = depth * low(b * BLOCK, ramp)),
          fine,
        });
      const lane = square(true);
      expect(lane).not.toEqual(plain);
      expect(maxStep(lane)).toBeLessThan(CLICK_THRESHOLD);
      expect(maxStep(lane)).toBeLessThanOrEqual(Math.max(maxStep(plain), maxStep(atFar)));
      expect(maxStep(square(false))).toBeLessThan(CLICK_THRESHOLD);
    }
  });
});
