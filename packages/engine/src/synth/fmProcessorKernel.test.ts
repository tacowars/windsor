/**
 * The fixed-index voice kernel (#548) renders the same bits as the generic
 * loop. Every "before" is the same part built with `specialise: false` and
 * rendered in the same test -- never a literal measured today.
 */
import { describe, expect, it } from 'vitest';

import beforeLevels from '../__fixtures__/modDepthLevels.json';
import { loadProcessor, render } from '../__fixtures__/workletHarness';
import type { ProcessorLike, ScheduledEvent } from '../__fixtures__/workletHarness';
import { makePatch, WAVE } from '../patch/patch';
import type { PartialPatch, Patch } from '../patch/patch';
import { PRESET_NAMES, PRESETS } from '../patch/presets';

const loaded = loadProcessor();
const SR = loaded.sampleRate;
const BLOCK_FRAMES = 128;
const blocksFor = (seconds: number): number => Math.ceil((seconds * SR) / BLOCK_FRAMES);

/** The voice fields these tests read and set; the worklet is untyped JS. */
interface KernelVoice {
  active: boolean;
  kernel: boolean;
  amp: Float32Array;
  ampInc: Float32Array;
  fb1: Float32Array;
  render(outL: Float32Array, outR: Float32Array, off: number, n: number): void;
}

const voicesOf = (processor: ProcessorLike): KernelVoice[] =>
  processor.voices as unknown as KernelVoice[];

const HOLD_S = 0.6;
const TAIL_S = 1.2;
/**
 * A chord whose events land off block and control boundaries, so the part
 * renders chunks of odd lengths, down to one sample.
 */
const CHORD: ScheduledEvent[] = [
  { type: 'noteOn', id: 1, note: 43, velocity: 0.95, frame: 0 },
  { type: 'noteOn', id: 2, note: 60, velocity: 0.6, frame: 1 },
  { type: 'noteOn', id: 3, note: 79, velocity: 0.3, frame: 2 * BLOCK_FRAMES + 33 },
  { type: 'noteOff', id: 2, frame: blocksFor(HOLD_S / 2) * BLOCK_FRAMES + 7 },
];
const RELEASE: ScheduledEvent[] = [
  { type: 'noteOff', id: 1, frame: 1 },
  { type: 'noteOff', id: 3, frame: 65 },
];

const sameBits = (a: Float32Array, b: Float32Array): boolean =>
  a.length === b.length && Buffer.compare(Buffer.from(a.buffer), Buffer.from(b.buffer)) === 0;

/** The chord held, then released through its tail, as one sample buffer. */
function renderChord(
  patch: Patch,
  specialise: boolean,
): { samples: Float32Array; kernel: boolean } {
  const processor = loaded.create(patch, 16, undefined, { specialise });
  const held = render(loaded, processor, blocksFor(HOLD_S), CHORD);
  const kernel = voicesOf(processor).some((v) => v.active && v.kernel);
  const tail = render(loaded, processor, blocksFor(TAIL_S), RELEASE);
  const samples = new Float32Array(held.samples.length + tail.samples.length);
  samples.set(held.samples);
  samples.set(tail.samples, held.samples.length);
  return { samples, kernel };
}

describe('the factory bank through the kernel', () => {
  it('runs at half the modulation-index scale the bank was authored against', () => {
    // #543 rescaled the bank (levels x sqrt(2), engine scale / 2) and #561 froze
    // the result as patches/*.json. The library files are authored against
    // this constant, so the engine cannot move it without every level moving
    // with it -- the one lasting check of the retired modDepth.test.ts.
    expect(loaded.modIndexScale).toBe(beforeLevels.modIndexScale / 2);
  });

  it.each(PRESET_NAMES)('%s renders bit-identical to the generic loop', (name) => {
    const patch = PRESETS[name]!;
    const generic = renderChord(patch, false);
    const kernel = renderChord(patch, true);
    expect(generic.kernel).toBe(false);
    expect(kernel.kernel).toBe(true);
    expect(generic.samples.some((s) => s !== 0)).toBe(true);
    expect(sameBits(kernel.samples, generic.samples)).toBe(true);
  });
});

/** The patches the routing rules below are read on, each with a bound voice. */
function boundVoice(o: PartialPatch): KernelVoice {
  const processor = loaded.create(makePatch(o), 4);
  render(loaded, processor, 1, [{ type: 'noteOn', id: 1, note: 60, velocity: 1, frame: 0 }]);
  return voicesOf(processor).find((v) => v.active)!;
}

const NOISE = { wave: WAVE.NOISE, level: 0.5 };

describe('which voices take the kernel', () => {
  it('takes every algorithm', () => {
    for (let algorithm = 0; algorithm < loaded.algorithms.length; algorithm++) {
      expect(boundVoice({ algorithm }).kernel, `algorithm ${algorithm}`).toBe(true);
    }
  });

  it('takes two noise operators only where the generic loop draws them D..A', () => {
    // Algorithm 0 (D>C>B>A) evaluates D, C, B, A in both loops; algorithm 7
    // (A|B|C|D) evaluates A first in the generic loop, so its noise draws would
    // land on different operators.
    expect(boundVoice({ algorithm: 0, ops: [NOISE, NOISE] }).kernel).toBe(true);
    expect(boundVoice({ algorithm: 7, ops: [NOISE, NOISE] }).kernel).toBe(false);
    expect(boundVoice({ algorithm: 7, ops: [{}, {}, NOISE, NOISE] }).kernel).toBe(false);
    expect(boundVoice({ algorithm: 7, ops: [NOISE] }).kernel).toBe(true);
    // windsor#382: only the Noise operators' order counts. Algorithm 6
    // (D>C | B | A) evaluates A, B, D, C, so C and D draw D first, as the
    // kernel does; algorithm 9 (D>C>(B,A)) evaluates D, C, A, B.
    expect(boundVoice({ algorithm: 6, ops: [{}, {}, NOISE, NOISE] }).kernel).toBe(true);
    expect(boundVoice({ algorithm: 6, ops: [NOISE, {}, NOISE] }).kernel).toBe(false);
    expect(boundVoice({ algorithm: 9, ops: [NOISE, {}, NOISE, NOISE] }).kernel).toBe(true);
    expect(boundVoice({ algorithm: 9, ops: [NOISE, NOISE] }).kernel).toBe(false);
  });

  it.each([
    ['two noise operators, series', { algorithm: 0, ops: [NOISE, {}, {}, NOISE] }],
    ['two noise operators, additive (generic fallback)', { algorithm: 7, ops: [NOISE, NOISE] }],
    ['two noise operators, a stack and two sines', { algorithm: 6, ops: [{}, {}, NOISE, NOISE] }],
    [
      'three noise operators, a split branch, one coloured',
      { algorithm: 9, ops: [NOISE, {}, { ...NOISE, noiseHp: 2000 }, NOISE] },
    ],
    [
      'a noise operator at level 0 beside a sounding one, one to three',
      { algorithm: 5, ops: [NOISE, {}, {}, { ...NOISE, level: 0 }] },
    ],
    [
      'a noise operator at level 0 beside a sounding one',
      { algorithm: 0, ops: [NOISE, {}, {}, { ...NOISE, level: 0 }] },
    ],
    [
      'feedback on every operator, both signs',
      {
        algorithm: 10,
        ops: [
          { feedback: 0.4 },
          { feedback: -0.6 },
          { feedback: 0.9, level: 0 },
          { feedback: -0.2 },
        ],
      },
    ],
    ['raw waves', { algorithm: 5, ops: [{ wave: WAVE.SAW_D }, { wave: WAVE.SQUARE_D }, {}, {}] }],
  ] as [string, PartialPatch][])('%s renders bit-identical to the generic loop', (_name, o) => {
    const patch = makePatch(o);
    expect(sameBits(renderChord(patch, true).samples, renderChord(patch, false).samples)).toBe(
      true,
    );
  });
});

/** Two parts, generic and kernel, driven through the same steps; returns both renders. */
function inStep(
  patch: Patch,
  steps: (processor: ProcessorLike) => Float32Array[],
): [Float32Array[], Float32Array[]] {
  const run = (specialise: boolean): Float32Array[] => {
    const processor = loaded.create(patch, 8, undefined, { specialise });
    processor.inbox({ type: 'liveRetune', enabled: true } as unknown as ScheduledEvent);
    return steps(processor);
  };
  return [run(false), run(true)];
}

const retune = (processor: ProcessorLike, o: PartialPatch): void =>
  processor.inbox({ type: 'patch', patch: makePatch(o) } as unknown as ScheduledEvent);

describe('rebinding a sounding voice', () => {
  it('matches the generic loop as an idle operator wakes, sleeps and the algorithm changes', () => {
    const idleB = { algorithm: 0, ops: [{}, { level: 0, feedback: 0.7 }, { level: 0.4 }] };
    const wokenB = { algorithm: 0, ops: [{}, { level: 0.8, feedback: 0.7 }, { level: 0.4 }] };
    const [generic, kernel] = inStep(makePatch(idleB), (p) => {
      const note: ScheduledEvent = { type: 'noteOn', id: 1, note: 57, velocity: 0.8, frame: 0 };
      const renders = [render(loaded, p, 20, [note]).samples];
      retune(p, wokenB);
      renders.push(render(loaded, p, 20).samples);
      retune(p, idleB);
      renders.push(render(loaded, p, 40).samples);
      retune(p, { ...wokenB, algorithm: 9 });
      renders.push(render(loaded, p, 20).samples);
      return renders;
    });
    expect(kernel.every((r, i) => sameBits(r, generic[i]!))).toBe(true);
  });

  it('leaves the feedback history the generic loop would after a one-sample idle call', () => {
    const patch = makePatch({ algorithm: 0, ops: [{}, { level: 0.8, feedback: 0.9 }] });
    const [generic, kernel] = inStep(patch, (p) => {
      const renders = [
        render(loaded, p, 4, [{ type: 'noteOn', id: 1, note: 50, velocity: 1, frame: 0 }]).samples,
      ];
      const voice = voicesOf(p).find((v) => v.active)!;
      // Operator B has fed back for four blocks; silence it for exactly one sample.
      expect(voice.fb1[1]).not.toBe(0);
      voice.amp[1] = 0;
      voice.ampInc[1] = 0;
      const one = new Float32Array(1);
      voice.render(one, new Float32Array(1), 0, 1);
      renders.push(one);
      renders.push(render(loaded, p, 8).samples);
      return renders;
    });
    expect(kernel.every((r, i) => sameBits(r, generic[i]!))).toBe(true);
  });
});
