/**
 * The FM part's lane offsets at the ends of their range (windsor#346, fix
 * round 1 of PR #385): the cutoff lane's octaves reach from one end of the
 * catalog's cutoff to the other without Web Audio clipping them at
 * `cutoffMod`'s declared range, every voice lane's widest offset fits the
 * parameter it is written to, and
 * a live retune that switches an operator between PULSE and another wave
 * keeps the width its lane sets, with no ramp from the patch's width.
 *
 * Web Audio clamps a k-rate value to its descriptor's range before the
 * processor reads it; the harness does not, so `clipped` does it here.
 */
import { describe, expect, it } from 'vitest';

import type { ProcessorLike } from '../__fixtures__/workletHarness';
import { loadProcessor } from '../__fixtures__/workletHarness';
import { VOICE_AUTOMATION_ROWS } from '../automation/automationTargetTables';
import { catalogRow } from '../automation/automationTargets';
import { FILTER_MODE, WAVE, makeEnvelope, makePatch, type Patch } from '../patch/patch';
import { voiceSlotParamName } from './audioPart';
import { voiceOffset } from './voiceAutomation';

const loaded = loadProcessor();
const BLOCK = 128;
const SLOTS = 8;
/** Middle C: key tracking, were it on, adds nothing. */
const NOTE = 60;
const CUTOFF = 'filter.cutoff';
const WIDTH = 'ops.0.width';

/** The internals these tests read off a voice. */
interface VoiceView {
  active: boolean;
  width: Float32Array | Float64Array;
  widthInc: Float32Array | Float64Array;
  svfA: { cutoffHz: number };
}

/** The part of an `AudioParamDescriptor` Web Audio clamps by. */
interface Descriptor {
  name: string;
  minValue?: number;
  maxValue?: number;
}

const descriptorsOf = (processor: ProcessorLike): Descriptor[] =>
  (processor.constructor as unknown as { parameterDescriptors: Descriptor[] }).parameterDescriptors;

/** What Web Audio hands the processor for `value` on the parameter `name`. */
function clipped(processor: ProcessorLike, name: string, value: number): number {
  const d = descriptorsOf(processor).find((p) => p.name === name)!;
  const min = Math.fround(d.minValue ?? -3.4028234663852886e38);
  const max = Math.fround(d.maxValue ?? 3.4028234663852886e38);
  const v = Math.fround(value);
  return v < min ? min : v > max ? max : v;
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

const offsetFor = (patch: Patch, path: string, value: number): number =>
  voiceOffset(patch, path, catalogRow(`voice.${path}`)!, value);

function freshParams(): Record<string, Float32Array> {
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    cutoffMod: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < SLOTS; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  return params;
}

interface Run {
  patch: Patch;
  slots?: (string | null)[];
  blocks: number;
  /** Frames a call renders: a quantum, or one control block to see each. */
  frames?: number;
  /** Before block `b` renders. */
  each: (b: number, params: Record<string, Float32Array>, processor: ProcessorLike) => void;
  /** After block `b` renders, with the held note's voice. */
  after: (b: number, voice: VoiceView) => void;
}

/** A held note, block by block. */
function run(r: Run): void {
  const processor = loaded.create(r.patch, 4, undefined, r.slots ? { voiceSlots: r.slots } : {});
  const params = freshParams();
  const frames = r.frames ?? BLOCK;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  processor.inbox({ type: 'noteOn', id: 1, note: NOTE, velocity: 1, frame: 0 });
  for (let b = 0; b < r.blocks; b++) {
    loaded.setFrame(b * frames);
    r.each(b, params, processor);
    processor.process([], [[left, right]], params);
    const voice = (processor.voices as unknown as VoiceView[]).find((v) => v.active)!;
    r.after(b, voice);
  }
}

const held = (): ReturnType<typeof makeEnvelope> =>
  makeEnvelope({ attackTime: 0.002, decayTime: 0.05, sustainLevel: 0.75 });

/** One sine carrier through a low-pass at `cutoff`, nothing else on the filter. */
const filtered = (cutoff: number): Patch =>
  makePatch({
    algorithm: 7,
    ops: [{ wave: WAVE.SINE, level: 0.5, env: held() }],
    filter: { mode: FILTER_MODE.LOWPASS, cutoff, resonance: 0.707, env: held() },
  });

describe("the cutoff lane across the catalog's whole range (windsor#346)", () => {
  const row = catalogRow(`voice.${CUTOFF}`)!;

  it.each([
    [row.min, row.max],
    [row.max, row.min],
  ])('takes a %s Hz patch to %s Hz on a held voice', (from, to) => {
    const patch = filtered(from);
    const offset = offsetFor(patch, CUTOFF, to);
    expect(Math.abs(offset)).toBeCloseTo(Math.log2(row.max / row.min), 12);
    const seen: number[] = [];
    run({
      patch,
      blocks: 12,
      each: (b, params, processor) => {
        params.cutoffMod![0] = b >= 6 ? clipped(processor, 'cutoffMod', offset) : 0;
      },
      after: (b, voice) => void seen.push(voice.svfA.cutoffHz),
    });
    expect(seen[5]).toBe(from);
    expect(seen[11]! / to).toBeCloseTo(1, 6);
  });
});

describe("every voice lane's offset fits its parameter (windsor#346)", () => {
  const processor = loaded.create(makePatch(), 4);
  // Each voice row a handle plays (the decay rows since windsor#347), and the
  // parameter its offsets go to: the cutoff's `cutoffMod`, the rest a slot.
  const rows = VOICE_AUTOMATION_ROWS.map((r): readonly [string, string] => {
    const path = r.target.slice('voice.'.length);
    return [path, path === CUTOFF ? 'cutoffMod' : voiceSlotParamName(0)];
  });

  it.each(rows)(
    '%s: a lane from one end of its row to the other passes %s unclipped',
    (path, param) => {
      const row = catalogRow(`voice.${path}`)!;
      for (const [from, to] of [
        [row.min, row.max],
        [row.max, row.min],
      ] as const) {
        // The patch at one end, the lane at the other: the widest offset the
        // main thread sends for this row.
        const offset = offsetFor(moved(makePatch(), path, from), path, to);
        expect(offset).not.toBe(0);
        expect(clipped(processor, param, offset)).toBe(Math.fround(offset));
      }
    },
  );
});

describe('a wave switch under a width lane (windsor#346)', () => {
  /** Op 0 at the patch's width 0.75 on `wave`, no LFO on it, held. */
  const base = (wave: number): Patch =>
    makePatch({ algorithm: 7, ops: [{ wave, level: 0.5, width: 0.75, env: held() }] });
  const LANE = 0.5;

  // One control block a call, so the block after each switch is seen alone.
  it('holds the lane width across PULSE and sine, with no ramp from the patch width', () => {
    const sine = base(WAVE.SINE);
    const pulse = base(WAVE.PULSE);
    const offset = offsetFor(sine, WIDTH, LANE);
    expect(offset).toBe(offsetFor(pulse, WIDTH, LANE));
    const toPulse = 4;
    const toSine = 8;
    run({
      patch: sine,
      slots: [WIDTH],
      blocks: 12,
      frames: loaded.ctrlInterval,
      each: (b, params, processor) => {
        if (b === 0) processor.inbox({ type: 'liveRetune', enabled: true } as never);
        if (b === toPulse) processor.inbox({ type: 'patch', patch: pulse } as never);
        if (b === toSine) processor.inbox({ type: 'patch', patch: sine } as never);
        params.voiceSlot0![0] = offset;
      },
      after: (b, voice) => {
        const pulsing = b >= toPulse && b < toSine;
        expect(voice.width[0]).toBe(pulsing ? LANE : 1 / LANE);
        expect(voice.widthInc[0]).toBe(0);
      },
    });
  });
});
