/**
 * Every worklet insert's on/off switch is click-free (windsor#630): the
 * shipped bundles of Filter, the compressor, Phaser, Delay, Tape, Advanced
 * Drive, Retro Reverb and EQ, each switched off and back on under a steady
 * sine, crossfade dry and wet linearly over `INSERT_SWITCH_FADE_S`.
 *
 * - **No click:** no sample-to-sample step across either switch is larger
 *   than the steady output's own largest step (the sine through the insert
 *   on, and the sine alone off) plus `STEP_TOLERANCE`. A hard switch steps
 *   by the whole difference between dry and wet, which each setting here
 *   holds well above that tolerance (`expect(jump)` below).
 * - **The fade's length:** the last sample that differs from the dry copy
 *   comes `INSERT_SWITCH_FADE_S` after the switch off, to within a quantum.
 * - **Off is a copy:** past the fade, the output is the input to the bit
 *   (Tape's dry is late by its core's fixed latency, on or off).
 *
 * - **The tail is cut, never resumed:** after an impulse, a full fade off and
 *   back on in silence, every kind plays exact zeros, where the same run left
 *   on still rings. Nothing an insert held before the switch is heard after
 *   it (record 2026-10-06-insert-switch-lanes).
 * - **A switch-on from fully off starts the wet path from rest:** a steady
 *   tone, and separately an impulse, played while the insert is fully off,
 *   then silence from the switch-on: every kind plays exact zeros from the
 *   switch-on (Tape's from its dry latency on, the dry copy of the tone being
 *   late). The compressor holds no audio: its envelope may carry the level it
 *   read while off into the fade-in, but its output is its input times a gain,
 *   so silence in is silence out.
 */
import { describe, expect, it } from 'vitest';
import { advancedDriveParams, loadAdvancedDrive } from '../__fixtures__/advancedDriveHarness';
import { compressorParams, loadCompressor } from '../__fixtures__/compressorHarness';
import { delayParams, loadDelay } from '../__fixtures__/delayHarness';
import { eqParams, loadEq } from '../__fixtures__/eqHarness';
import { filterParams, loadFilter } from '../__fixtures__/filterHarness';
import { loadPhaser, phaserParams } from '../__fixtures__/phaserHarness';
import { loadRetro, retroParams } from '../__fixtures__/retroReverbHarness';
import { loadTape, tapeParams } from '../__fixtures__/tapeHarness';
import { DEFAULT_EQ } from './eqSpec';
import { INSERT_SWITCH_FADE_S } from './insertConstants';
import { TAPE_MAGNETIC } from './tapeMagneticConstants';

const RATE = 48000;
const QUANTUM = 128;
const FADE = Math.round(INSERT_SWITCH_FADE_S * RATE);
/** The sine: low enough that its own step is small, loud enough that the wet differs. */
const HZ = 220;
const AMPLITUDE = 0.25;
/**
 * How much a switch's steps may exceed the steady output's: a fade of FADE
 * samples over a dry/wet difference up to full scale moves 1/240 a sample.
 */
const STEP_TOLERANCE = 0.006;
/** The quanta the switch goes off and comes back on at, and the run's length. */
const OFF = 150;
const ON = 200;
const QUANTA = 260;
/** The tail case: the impulse at frame 0, the switch off and back on, and the run's length. */
const TAIL_OFF = 4;
const TAIL_ON = 8;
const TAIL_QUANTA = 200;
/**
 * The off-stretch case: the switch goes off ahead of the first quantum, the
 * impulse comes once the fade has landed, and the switch comes back on, with
 * the input silent from there, at RESTART.
 */
const OFF_IMPULSE = 4;
const RESTART = 40;

type Params = Record<string, Float32Array>;
interface Processor {
  process(inputs: Float32Array[][], outputs: Float32Array[][], params: Params): boolean;
}
interface Kind {
  name: string;
  load(): { processor: Processor; params: Params };
  /** How late the dry path is, in samples. */
  latency: number;
  /** Whether an impulse leaves a tail to cut; the compressor's output is its input times a gain. */
  rings: boolean;
}

const KINDS: Kind[] = [
  {
    name: 'filter',
    load: () => {
      const params = filterParams({ cutoff: 300, resonance: 4 });
      return { processor: loadFilter(RATE, params), params };
    },
    latency: 0,
    rings: true,
  },
  {
    name: 'compressor',
    load: () => {
      const params = compressorParams({ threshold: -30, ratio: 8, makeup: 6 });
      return { processor: loadCompressor(RATE, params), params };
    },
    latency: 0,
    rings: false,
  },
  {
    name: 'phaser',
    load: () => {
      const params = phaserParams({ mix: 1, feedback: 0.5 });
      return { processor: loadPhaser(RATE, params), params };
    },
    latency: 0,
    rings: true,
  },
  {
    name: 'delay',
    load: () => {
      const params = delayParams({ mix: 0.5, feedback: 0.4 });
      return { processor: loadDelay(RATE, params), params };
    },
    latency: 0,
    rings: true,
  },
  {
    name: 'tape',
    load: () => {
      const params = tapeParams({ drive: 12 });
      return { processor: loadTape(RATE, params), params };
    },
    latency: TAPE_MAGNETIC.span,
    rings: true,
  },
  {
    name: 'advanced drive',
    load: () => {
      const params = advancedDriveParams();
      return { processor: loadAdvancedDrive(RATE, params), params };
    },
    latency: 0,
    rings: true,
  },
  {
    name: 'retro reverb',
    load: () => {
      const params = retroParams({ mix: 0.5 });
      return { processor: loadRetro(RATE, params), params };
    },
    latency: 0,
    rings: true,
  },
  {
    name: 'eq',
    load: () => {
      const bands = DEFAULT_EQ.bands.map((b, i) =>
        i === 2 ? { ...b, type: 'bell' as const, freq: HZ, gain: 9, q: 1, on: true } : b,
      );
      return { processor: loadEq(RATE), params: eqParams({ ...DEFAULT_EQ, bands }) };
    },
    latency: 0,
    rings: true,
  },
];

function sineInput(quanta: number): Float32Array {
  const out = new Float32Array(quanta * QUANTUM);
  for (let i = 0; i < out.length; i++) out[i] = AMPLITUDE * Math.sin((2 * Math.PI * HZ * i) / RATE);
  return out;
}

/** `input` on both channels through `processor`, `before` running ahead of each quantum; the left output. */
function render(
  processor: Processor,
  params: Params,
  input: Float32Array,
  before: (q: number) => void,
): Float32Array {
  const out = new Float32Array(input.length);
  const left = new Float32Array(QUANTUM),
    right = new Float32Array(QUANTUM);
  for (let q = 0; q * QUANTUM < input.length; q++) {
    before(q);
    const block = input.subarray(q * QUANTUM, (q + 1) * QUANTUM);
    processor.process([[block, block]], [[left, right]], params);
    out.set(left, q * QUANTUM);
  }
  return out;
}

/** The largest |x[i] − x[i − 1]| over [from, to). */
function largestStep(x: Float32Array, from: number, to: number): number {
  let most = 0;
  for (let i = from; i < to; i++) most = Math.max(most, Math.abs(x[i]! - x[i - 1]!));
  return most;
}

/** The largest |x[i]| over [from, to). */
function largest(x: Float32Array, from: number, to: number): number {
  let most = 0;
  for (let i = from; i < to; i++) most = Math.max(most, Math.abs(x[i]!));
  return most;
}

/** The first frame from which `out` is `input` delayed by `latency`, to the bit, up to `to`. */
function copyFrom(out: Float32Array, input: Float32Array, latency: number, to: number): number {
  let at = to;
  while (at > latency && out[at - 1] === input[at - 1 - latency]) at--;
  return at;
}

describe.each(KINDS)('the $name switch', (kind) => {
  const input = sineInput(QUANTA);
  const run = (): Float32Array => {
    const { processor, params } = kind.load();
    return render(processor, params, input, (q) => {
      if (q === OFF) params.enabled![0] = 0;
      if (q === ON) params.enabled![0] = 1;
    });
  };
  const out = run();
  const off = OFF * QUANTUM,
    on = ON * QUANTUM;

  it('steps no further than the steady output, plus the stated tolerance', () => {
    // Steady: well before the switch off, and the dry copy once it has faded.
    const steady = Math.max(
      largestStep(out, off - 40 * QUANTUM, off),
      largestStep(out, off + FADE + QUANTUM, on),
    );
    expect(largestStep(out, off - QUANTUM, off + FADE + QUANTUM)).toBeLessThanOrEqual(
      steady + STEP_TOLERANCE,
    );
    expect(largestStep(out, on - QUANTUM, on + FADE + QUANTUM)).toBeLessThanOrEqual(
      steady + STEP_TOLERANCE,
    );
    // A hard switch would jump by the whole dry/wet difference, far past the tolerance.
    let jump = 0;
    for (let i = off - QUANTUM; i < off; i++)
      jump = Math.max(jump, Math.abs(out[i]! - input[i - kind.latency]!));
    expect(jump).toBeGreaterThan(4 * STEP_TOLERANCE);
  });

  it('fades for INSERT_SWITCH_FADE_S, then copies the input to the bit', () => {
    const copied = copyFrom(out, input, kind.latency, on);
    expect(Math.abs(copied - off - FADE)).toBeLessThanOrEqual(QUANTUM);
    expect(copied).toBeLessThan(on);
  });
});

describe.each(KINDS)('the $name tail', (kind) => {
  it('is cut by the switch and never resumed: back on in silence plays exact zeros', () => {
    const input = new Float32Array(TAIL_QUANTA * QUANTUM);
    input[0] = 1;
    const tail = (switched: boolean): number => {
      const { processor, params } = kind.load();
      const out = render(processor, params, input, (q) => {
        if (switched && q === TAIL_OFF) params.enabled![0] = 0;
        if (switched && q === TAIL_ON) params.enabled![0] = 1;
      });
      return largest(out, TAIL_ON * QUANTUM, out.length);
    };
    if (kind.rings) expect(tail(false)).toBeGreaterThan(0);
    expect(tail(true)).toBe(0);
  });
});

describe.each(KINDS)('the $name switch-on from fully off', (kind) => {
  const length = TAIL_QUANTA * QUANTUM;
  it.each([
    {
      name: 'a steady tone',
      input: (): Float32Array => sineInput(TAIL_QUANTA).fill(0, RESTART * QUANTUM),
    },
    {
      name: 'an impulse',
      input: (): Float32Array => {
        const input = new Float32Array(length);
        input[OFF_IMPULSE * QUANTUM] = 1;
        return input;
      },
    },
  ])('starts from rest after $name played while off: exact zeros', ({ input }) => {
    const { processor, params } = kind.load();
    const out = render(processor, params, input(), (q) => {
      if (q === 0) params.enabled![0] = 0;
      if (q === RESTART) params.enabled![0] = 1;
    });
    expect(largest(out, RESTART * QUANTUM + kind.latency, length)).toBe(0);
  });
});
