/**
 * A patch with macros, and a part to play it on, for the macro tests
 * (windsor#560, record `2026-10-04-patch-macro-knobs`): a sustaining patch
 * whose carrier level and low-pass cutoff are heard, the 303-style "Accent"
 * macro that maps both, and a block-by-block render that writes the part's
 * slot params before each block, as the automation tests drive a lane.
 */
import type { MacroMapping, Patch, PartialMacroMapping } from '../patch/patch';
import { FILTER_MODE, WAVE, makeEnvelope, makeMacro, makePatch } from '../patch/patch';
import type { LoadedProcessor, ProcessorLike, ScheduledEvent } from './workletHarness';

const BLOCK = 128;
const SLOTS = 8;
const ADDITIVE = 7;

const HELD = makeEnvelope({ attackTime: 0.002, decayTime: 0.3, sustainLevel: 0.6 });

/** Two saw carriers held at sustain through a resonant low-pass: level and cutoff are both heard. */
export const MACRO_PLAIN: Patch = makePatch({
  algorithm: ADDITIVE,
  ops: [
    { wave: WAVE.SAW, ratio: 1, level: 0.5, env: HELD },
    { wave: WAVE.SAW, ratio: 2, level: 0.5, env: HELD },
    { level: 0 },
    { level: 0 },
  ],
  filter: { mode: FILTER_MODE.LOWPASS, cutoff: 1200, resonance: 2 },
});

/** The Accent macro's mappings: the lead carrier's level and the cutoff (decision 10a). */
export const ACCENT_LEVEL = { target: 'ops.0.level', min: 0.2, max: 0.8 } as const;
export const ACCENT_CUTOFF = { target: 'filter.cutoff', min: 200, max: 2000 } as const;
export const ACCENT_MAPPINGS: readonly PartialMacroMapping[] = [ACCENT_LEVEL, ACCENT_CUTOFF];

/** `base` with one macro, Accent, at `value` over `mappings`. */
export const macroPatch = (
  value: number,
  mappings: readonly PartialMacroMapping[] = ACCENT_MAPPINGS,
  base: Patch = MACRO_PLAIN,
): Patch => ({ ...base, macros: [makeMacro({ name: 'Accent', value, mappings: [...mappings] })] });

/** A mapping's value at macro `x` (Linear, not inverted), in its row's curve: the arithmetic decision 2 states. */
export const mappedValue = (
  m: Pick<MacroMapping, 'min' | 'max'>,
  ratio: boolean,
  x: number,
): number => (ratio ? m.min * 2 ** (Math.log2(m.max / m.min) * x) : m.min + (m.max - m.min) * x);

/** What a voice exposes to these tests. */
export interface MacroVoice {
  active: boolean;
  voiceId: number;
  liveValues: Float64Array;
  ampEnv: { decayTime: number; decayCurve: number }[];
}

/** The active voice playing note id `id`. */
export function voiceOf(processor: ProcessorLike, id: number): MacroVoice {
  const voices = processor.voices as unknown as MacroVoice[];
  const found = voices.find((v) => v.active && v.voiceId === id);
  if (!found) throw new Error(`no active voice for note ${id}`);
  return found;
}

export interface MacroDrive {
  patch: Patch;
  slots?: (string | null)[];
  events: ScheduledEvent[];
  blocks: number;
  /** Before block `b` renders: write its slot params, or post to the processor. */
  each?: (b: number, slots: Float32Array[], processor: ProcessorLike) => void;
  /** After block `b` renders. */
  after?: (b: number, processor: ProcessorLike) => void;
}

/** Render a part block by block, its slots rewritten before each, as interleaved stereo. */
export function driveMacroPart(loaded: LoadedProcessor, d: MacroDrive): Float32Array {
  const processor = loaded.create(d.patch, 4, undefined, d.slots ? { voiceSlots: d.slots } : {});
  const slots = Array.from({ length: SLOTS }, () => new Float32Array([0]));
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  slots.forEach((slot, i) => (params[`voiceSlot${i}`] = slot));
  const left = new Float32Array(BLOCK);
  const right = new Float32Array(BLOCK);
  const out = new Float32Array(d.blocks * BLOCK * 2);
  let pending = 0;
  for (let b = 0; b < d.blocks; b++) {
    loaded.setFrame(b * BLOCK);
    while (pending < d.events.length && d.events[pending]!.frame < (b + 1) * BLOCK) {
      processor.inbox(d.events[pending++]!);
    }
    d.each?.(b, slots, processor);
    processor.process([], [[left, right]], params);
    d.after?.(b, processor);
    for (let i = 0; i < BLOCK; i++) {
      out[(b * BLOCK + i) * 2] = left[i]!;
      out[(b * BLOCK + i) * 2 + 1] = right[i]!;
    }
  }
  return out;
}
