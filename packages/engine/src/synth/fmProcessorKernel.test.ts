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
import { LADDER_FEEDBACK_MAX, LADDER_OVERSAMPLE } from '../worklet/fm/fmConstants';
import { voiceSlotParamName } from './audioPart';

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

  it('takes any number of noise operators on any algorithm', () => {
    // windsor#389: both loops draw a sample's noise D..A, so Additive
    // (A|B|C|D), which evaluates A first in the generic loop, takes the
    // kernel with two Noise operators as Series (D>C>B>A) does.
    expect(boundVoice({ algorithm: 0, ops: [NOISE, NOISE] }).kernel).toBe(true);
    expect(boundVoice({ algorithm: 7, ops: [NOISE, NOISE] }).kernel).toBe(true);
    expect(boundVoice({ algorithm: 7, ops: [NOISE, NOISE, NOISE, NOISE] }).kernel).toBe(true);
    expect(boundVoice({ algorithm: 9, ops: [NOISE, NOISE] }).kernel).toBe(true);
  });

  it.each([
    ['two noise operators, series', { algorithm: 0, ops: [NOISE, {}, {}, NOISE] }],
    ['two noise operators, additive', { algorithm: 7, ops: [NOISE, NOISE] }],
    ['two noise operators, a stack and two sines', { algorithm: 6, ops: [{}, {}, NOISE, NOISE] }],
    [
      'three noise operators, a split branch, one coloured',
      { algorithm: 9, ops: [NOISE, {}, { ...NOISE, opHp: 2000 }, NOISE] },
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
    [
      'the Formant filter, a vowel between two rows, swept by its envelope (windsor#331)',
      {
        algorithm: 4,
        ops: [{ wave: WAVE.SAW, feedback: 0.3 }, { level: 0.5 }, { level: 0.7 }, NOISE],
        filter: { mode: 5, vowel: 1.37, resonance: 1.3, envAmount: 0.8, keyTrack: 0.4 },
      },
    ],
    [
      'the Formant filter at its Q cap, slope24 set and ignored (windsor#331)',
      {
        algorithm: 7,
        ops: [NOISE, {}],
        filter: { mode: 5, vowel: 3, resonance: 9, slope24: true },
      },
    ],
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

  it('matches the generic loop as live edits sweep the Formant vowel and switch the mode (windsor#331)', () => {
    const formant = (vowel: number, mode = 5): PartialPatch => ({
      algorithm: 1,
      ops: [{}, { level: 0.6 }, { level: 0.4, ratio: 2 }],
      filter: { mode, vowel, resonance: 0.9 },
    });
    const [generic, kernel] = inStep(makePatch(formant(0)), (p) => {
      const note: ScheduledEvent = { type: 'noteOn', id: 1, note: 52, velocity: 0.9, frame: 0 };
      const renders = [render(loaded, p, 10, [note]).samples];
      for (const [vowel, mode] of [[0.6], [2.25], [4], [1.5, 1], [3.75]] as [number, number?][]) {
        retune(p, formant(vowel, mode));
        renders.push(render(loaded, p, 10).samples);
      }
      return renders;
    });
    expect(generic.flatMap((r) => [...r]).some((s) => s !== 0)).toBe(true);
    expect(kernel.every((r, i) => sameBits(r, generic[i]!))).toBe(true);
  });

  // The Acid scenario: a saw through the drive into the ladder on its 2×
  // solver at k 17.2 (windsor#593), its envelope and key track moving the
  // cutoff, live edits sweeping the cutoff past the top and switching to
  // Lowpass (3100) and back.
  it('matches the generic loop on an Acid saw at 2× and k 17.2 as live edits sweep its cutoff and switch the mode to Lowpass and back (windsor#573)', () => {
    expect([LADDER_OVERSAMPLE, LADDER_FEEDBACK_MAX]).toEqual([2, 17.2]);
    const moved = { resonance: 12, envAmount: 2.5, keyTrack: 0.6 };
    const acid = (cutoff: number): PartialPatch => ({
      algorithm: 1,
      ops: [{ wave: WAVE.SAW }, { level: 0.5 }, { level: 0.3, ratio: 3 }],
      drive: { gain: 3, on: true },
      filter: { mode: cutoff === 3100 ? 1 : 6, cutoff, ...moved },
    });
    const [generic, kernel] = inStep(makePatch(acid(300)), (p) => {
      const note: ScheduledEvent = { type: 'noteOn', id: 1, note: 45, velocity: 0.9, frame: 0 };
      const renders = [render(loaded, p, 10, [note]).samples];
      for (const cutoff of [650, 1400.5, 3100, 9000, 22000, 180]) {
        retune(p, acid(cutoff));
        renders.push(render(loaded, p, 10).samples);
      }
      return renders;
    });
    expect(generic.flatMap((r) => [...r]).some((s) => s !== 0)).toBe(true);
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

/**
 * The chord on a Formant patch with a song lane on its vowel (windsor#406):
 * slot 0 mapped to `filter.vowel`, its offset ramping from 0 to 4 a step a
 * block, so the peaks retune on ringing voices every block; held, then
 * released through its tail.
 */
function renderVowelLane(patch: Patch, specialise: boolean): Float32Array {
  const processor = loaded.create(patch, 16, undefined, {
    specialise,
    voiceSlots: ['filter.vowel'],
  });
  const params: Record<string, Float32Array> = {
    pitchBend: new Float32Array([0]),
    modWheel: new Float32Array([0]),
    gain: new Float32Array([1]),
  };
  for (let i = 0; i < 8; i++) params[voiceSlotParamName(i)] = new Float32Array([0]);
  const blocks = blocksFor(HOLD_S + TAIL_S);
  const events = [
    ...CHORD,
    ...RELEASE.map((e) => ({ ...e, frame: e.frame + blocksFor(HOLD_S) * BLOCK_FRAMES })),
  ];
  const outL = new Float32Array(BLOCK_FRAMES);
  const outR = new Float32Array(BLOCK_FRAMES);
  const out = new Float32Array(blocks * BLOCK_FRAMES * 2);
  let pending = 0;
  for (let b = 0; b < blocks; b++) {
    loaded.setFrame(b * BLOCK_FRAMES);
    while (pending < events.length && events[pending]!.frame < (b + 1) * BLOCK_FRAMES) {
      processor.inbox(events[pending++]!);
    }
    params.voiceSlot0![0] = Math.min(4, (4 * b) / blocksFor(HOLD_S));
    processor.process([], [[outL, outR]], params);
    out.set(outL, b * BLOCK_FRAMES * 2);
    out.set(outR, b * BLOCK_FRAMES * 2 + BLOCK_FRAMES);
  }
  return out;
}

describe('a vowel lane moving (windsor#406)', () => {
  it('renders bit-identical to the generic loop as the lane sweeps a to u', () => {
    const patch = makePatch({
      algorithm: 4,
      ops: [{ wave: WAVE.SAW, feedback: 0.3 }, { level: 0.5 }, { level: 0.7 }, NOISE],
      filter: { mode: 5, vowel: 0, resonance: 1.3, envAmount: 0.8, keyTrack: 0.4 },
    });
    const kernel = renderVowelLane(patch, true);
    expect(kernel.some((s) => s !== 0)).toBe(true);
    expect(sameBits(kernel, renderVowelLane(patch, false))).toBe(true);
  });
});

/**
 * Operators A..D Noise where `mask` has their bit (A is 1), each at its own
 * level, the others sines at 0.3. Two Noise carriers at one level sum to the
 * same bits whichever draw each takes, so a swapped draw would go unseen;
 * distinct levels put every draw where it is heard.
 */
function noiseOps(mask: number): NonNullable<PartialPatch['ops']> {
  return [0, 1, 2, 3].map((i) =>
    (mask & (1 << i)) !== 0 ? { wave: WAVE.NOISE, level: 0.35 + 0.15 * i } : { level: 0.3 },
  );
}

const setName = (mask: number): string =>
  [...'ABCD'].filter((_, i) => (mask & (1 << i)) !== 0).join('');
/** Every algorithm with every set of two or more Noise operators: 11 x 11. */
const NOISE_SETS: [string, number, number][] = [];
for (let algorithm = 0; algorithm < loaded.algorithms.length; algorithm++) {
  for (let mask = 3; mask < 16; mask++) {
    if ((mask & (mask - 1)) === 0) continue;
    NOISE_SETS.push([`${algorithm}, Noise on ${setName(mask)},`, algorithm, mask]);
  }
}

const withOp = (ops: PartialPatch['ops'] & object, i: number, o: object) =>
  ops.map((op, j) => (j === i ? { ...op, ...o } : op));

describe('noise drawn D..A in both loops (windsor#389)', () => {
  it('covers the 121 sets', () => {
    expect(NOISE_SETS).toHaveLength(121);
  });

  it.each(NOISE_SETS)('algorithm %s takes the kernel, bit-identical', (_n, algorithm, mask) => {
    const patch = makePatch({ algorithm, ops: noiseOps(mask) });
    const generic = renderChord(patch, false);
    const kernel = renderChord(patch, true);
    expect(kernel.kernel).toBe(true);
    expect(generic.samples.some((s) => s !== 0)).toBe(true);
    expect(sameBits(kernel.samples, generic.samples)).toBe(true);
  });

  const allFour = noiseOps(15);
  it.each([
    ['no Noise operator, additive', { algorithm: 7, ops: noiseOps(0) }],
    ['one Noise operator on A, additive', { algorithm: 7, ops: noiseOps(1) }],
    ['one Noise operator on C, stack + two', { algorithm: 6, ops: noiseOps(4) }],
    ['all four Noise, two stacks', { algorithm: 4, ops: allFour }],
    [
      'all four Noise, additive, two coloured',
      { algorithm: 7, ops: withOp(withOp(allFour, 0, { opLp: 3000 }), 2, { opHp: 900 }) },
    ],
    [
      'a Noise operator at level 0 between two, additive',
      { algorithm: 7, ops: withOp(noiseOps(13), 2, { level: 0 }) },
    ],
  ] as [string, PartialPatch][])('%s renders bit-identical to the generic loop', (_n, o) => {
    const patch = makePatch(o);
    const kernel = renderChord(patch, true);
    expect(kernel.kernel).toBe(true);
    expect(sameBits(kernel.samples, renderChord(patch, false).samples)).toBe(true);
  });

  it('matches as a Noise operator falls to level 0 and comes back, on additive', () => {
    const awake = { algorithm: 7, ops: noiseOps(5) };
    const asleep = { algorithm: 7, ops: withOp(noiseOps(5), 2, { level: 0 }) };
    const [generic, kernel] = inStep(makePatch(awake), (p) => {
      const note: ScheduledEvent = { type: 'noteOn', id: 1, note: 48, velocity: 0.9, frame: 0 };
      const renders = [render(loaded, p, 20, [note]).samples];
      retune(p, asleep);
      renders.push(render(loaded, p, 20).samples);
      retune(p, awake);
      renders.push(render(loaded, p, 20).samples);
      return renders;
    });
    expect(kernel.every((r, i) => sameBits(r, generic[i]!))).toBe(true);
  });

  it('matches as a two-Noise voice goes dormant, draws nothing, and wakes', () => {
    // Every carrier decays to sustain 0, so the held voice goes dormant (#547)
    // and the part skips it in both paths; a retune raising the sustain wakes it.
    const shaped = (sustainLevel: number): PartialPatch => ({
      algorithm: 7,
      ops: noiseOps(6).map((op) => ({ ...op, env: { decayTime: 0.05, sustainLevel } })),
    });
    const dormant: boolean[] = [];
    const [generic, kernel] = inStep(makePatch(shaped(0)), (p) => {
      const note: ScheduledEvent = { type: 'noteOn', id: 1, note: 52, velocity: 1, frame: 0 };
      const renders = [render(loaded, p, blocksFor(0.6), [note]).samples];
      const voices = p.voices as unknown as { active: boolean; dormant: boolean }[];
      dormant.push(voices.find((v) => v.active)!.dormant);
      retune(p, shaped(0.6));
      renders.push(render(loaded, p, blocksFor(0.3)).samples);
      return renders;
    });
    expect(dormant).toEqual([true, true]);
    expect(kernel[1]!.some((s) => s !== 0)).toBe(true);
    expect(kernel.every((r, i) => sameBits(r, generic[i]!))).toBe(true);
  });
});
