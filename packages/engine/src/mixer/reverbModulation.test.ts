/**
 * The plate's tank modulation (windsor#764): all four tank all-passes move,
 * each from its own seeded smoothed noise, lighter than the one sine and
 * cosine that moved two of them before. So the source never comes round
 * within ten minutes, `modDepth` 0 moves nothing, a held tank neither drains
 * nor feeds, the tail keeps its length at the deepest setting, the knobs move
 * live without a step, and an excursion is milliseconds at any rate. The
 * spread and the beat against `main` are `reverbModulationSpread.test.ts`;
 * the whole-box sweep, the figures from `main` and the CPU are in
 * `docs/research/2026-10-12-plate-modulation/`. A woken plate renders as a
 * fresh one in `reverbSleep.test.ts`, whose tail runs the sources at the
 * defaults.
 */
import { describe, expect, it } from 'vitest';

import type { Automate, Feed, ReverbProcessorLike } from '../__fixtures__/reverbHarness';
import {
  channel,
  impulseAt,
  internals,
  loadReverb,
  renderReverb,
  t30,
} from '../__fixtures__/reverbHarness';
import { DEFAULT_SPACE } from './reverbSpace';

const loaded = loadReverb();
const SR = loaded.sampleRate;
const BLOCK = 128;
const blockAt = (seconds: number): number => Math.round((seconds * SR) / BLOCK);
const { modLines, modDrawLength, modWidthMin, modDraws } = loaded.topology;
const DEEP = { modRate: 8, modDepth: 4 };
const DEFAULTS = { modRate: DEFAULT_SPACE.modRate, modDepth: DEFAULT_SPACE.modDepth };

/** A sine at 0.3 on both sides, until `until` seconds. */
const sine =
  (hz: number, until = Infinity): Feed =>
  (block, left, right) => {
    for (let i = 0; i < BLOCK; i++) {
      const at = block * BLOCK + i;
      if (at >= until * SR) return;
      left[i] = right[i] = Math.sin((2 * Math.PI * hz * at) / SR) * 0.3;
    }
  };

describe('the source', () => {
  it('never comes round within ten minutes at the top rate', () => {
    // A point takes a knot and a width a segment; a segment lasts its width
    // over twice the rate, so its draws last the sum of their widths over 16 s.
    for (let p = 0; p < modLines.length; p++) {
      let widths = 0;
      for (let i = 1; i < modDrawLength; i += 2) {
        widths += modWidthMin + modDraws[p * modDrawLength + i]!;
      }
      expect(widths / (2 * DEEP.modRate)).toBeGreaterThan(600);
    }
  });

  it('moves no line at modDepth 0, whatever the rate: the still tank, to the bit', () => {
    const render = (modRate: number): Float32Array => {
      let moved = false;
      const { samples } = renderReverb(
        loaded,
        2,
        sine(220, 0.5),
        { modRate, modDepth: 0 },
        {
          collectSamples: true,
          afterBlock: (_, processor) => {
            if (internals(processor)._modOffset.some((v) => v !== 0)) moved = true;
          },
        },
      );
      expect(moved, `modRate ${modRate}`).toBe(false);
      return samples;
    };
    expect(render(8)).toEqual(render(0));
  });
});

/** The tank's stored energy: every tank line's samples inside its length. */
function tankEnergy(processor: ReverbProcessorLike): number {
  const plate = internals(processor) as ReturnType<typeof internals> & { _mask: Int32Array };
  let energy = 0;
  for (let line = 4; line < 12; line++) {
    const buffer = plate._buffers[line]!;
    for (let k = 1; k <= Math.floor(plate._length[line]!); k++) {
      energy += buffer[(plate._write[line]! - k) & plate._mask[line]!]! ** 2;
    }
  }
  return energy;
}

/** A tone for 2 s, held from 1.9 s: the tank's energy each second from 3 s to 63 s, in dB re the first. */
function heldEnergy(hz: number, params: Record<string, number>): number[] {
  const readings: number[] = [];
  renderReverb(loaded, 63, sine(hz, 2), params, {
    automate: (block, values) => (values.hold![0] = block >= blockAt(1.9) ? 1 : 0),
    afterBlock: (block, processor) => {
      if (block >= blockAt(3) && (block - blockAt(3)) % blockAt(1) === 0) {
        readings.push(tankEnergy(processor));
      }
    },
  });
  return readings.map((e) => 10 * Math.log10(e / readings[0]!));
}

describe('a held tank (HOLD)', () => {
  /**
   * The four moving reads neither drain the loop nor feed it: at 40 and
   * 220 Hz its energy holds within ±1 dB for a minute at the default, and
   * within 1.5 dB at the deepest, fastest corner, whose 40 Hz tank wanders to
   * −1.4 dB (HOLD's own decay is 0.3 dB of it) where the sine and cosine on
   * two lines grew it by 36 dB. At 1 kHz the long lines' linear reads drain any
   * held tank, still or moving, by about 4 dB a minute (6.8 on `main`, with
   * no modulation at all): there the moving tank is held within 1 dB of the
   * still one.
   */
  it.each([
    ['the default', DEFAULTS, 1],
    ['the deepest', DEEP, 1.5],
  ])(
    'holds its energy at %s',
    (_, params, tolerance) => {
      for (const hz of [40, 220]) {
        for (const reading of heldEnergy(hz, params)) {
          expect(Math.abs(reading), `${hz} Hz`).toBeLessThan(tolerance);
        }
      }
      const still = heldEnergy(1000, { modDepth: 0 }).at(-1)!;
      expect(Math.abs(heldEnergy(1000, params).at(-1)! - still)).toBeLessThan(1);
    },
    120_000,
  );
});

/** Damping open and the low band off: the conditions Decay is measured in. */
const OPEN = { tankLowCut: 10, tankHighCut: 20000, lowDecay: 1 };

describe('the tail at the deepest modulation', () => {
  /**
   * T30 within 10 % of Decay at the deepest, fastest corner: the four reads
   * shorten each loop by half their depth on average, which a long tail in a
   * small tank feels most, so each moving all-pass's gain is cut for its
   * mean excursion (Decay 60 s at Size 0.25: −8.3 %, −11.2 % without the
   * cut). At rest (`modRate` 0) it is cut for where each source rests, at 0
   * on a fresh plate. The full sweep is in the research note.
   */
  it.each([
    { size: 0.25, decay: 60, modRate: 8 },
    { size: 1, decay: 10, modRate: 8 },
    { size: 4, decay: 2, modRate: 8 },
    { size: 0.05, decay: 10, modRate: 0 },
  ])(
    'holds Decay at Size $size, Decay $decay, $modRate Hz',
    ({ size, decay, modRate }) => {
      const settle = blockAt(0.5);
      const { samples } = renderReverb(
        loaded,
        1.5 * decay + 4,
        impulseAt(settle),
        { ...OPEN, modDepth: DEEP.modDepth, modRate, size, decay },
        { collectSamples: true },
      );
      const from = settle * BLOCK;
      const measured = t30(channel(samples, 0, from), channel(samples, 1, from));
      expect(Math.abs(measured / decay - 1)).toBeLessThan(0.1);
    },
    120_000,
  );
});

/** A steady 220 Hz tone at 0.3, the signal a step is judged against. */
const tone = sine(220);

/** A 0.4 s noise burst for a tail, then a kick every 0.5 s and a hat every 0.25 s. */
function drums(): Feed {
  let seed = 1;
  const noise = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  return (block, left, right) => {
    for (let i = 0; i < left.length; i++) {
      const t = (block * BLOCK + i) / SR;
      const beat = t % 0.5;
      let v = t < 0.4 ? noise() * 0.5 : 0;
      if (t >= 0.5) v += Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat / 0.08) * 0.8;
      if (t >= 0.5 && t % 0.25 < 0.004) v += noise() * 0.4;
      left[i] = right[i] = v;
    }
  };
}

/** `name` from `low` at 1 s to `high` over `span` seconds and back, the rest held at `held`. */
const sweep =
  (name: string, low: number, high: number, span: number, held: Record<string, number>): Automate =>
  (block, values) => {
    const at = Math.min(Math.max((block * BLOCK) / SR - 1, 0), 2 * span);
    values[name]![0] = low + ((high - low) * (at < span ? at : 2 * span - at)) / span;
    for (const [key, value] of Object.entries(held)) values[key]![0] = value;
  };
const still =
  (held: Record<string, number>): Automate =>
  (_, values) => {
    for (const [key, value] of Object.entries(held)) values[key]![0] = value;
  };

/** The largest left-channel step from 1 s on, where the moves start, and the render's peak. */
function stepFrom1s(feed: Feed, automate: Automate, seconds: number) {
  const { samples, peak } = renderReverb(
    loaded,
    seconds,
    feed,
    {},
    { automate, collectSamples: true },
  );
  const left = channel(samples, 0, SR);
  let step = 0;
  for (let i = 1; i < left.length; i++) step = Math.max(step, Math.abs(left[i]! - left[i - 1]!));
  return { step, peak };
}

type Move = [string, Automate, number, Record<string, number>[]];

describe('live moves (record 2026-08-31-dattorro-reverb-not-plateau §3)', () => {
  const moves: Move[] = [1, 8].flatMap((span): Move[] => [
    [
      `modDepth 0 to 4 and back over ${span} s each way, at 8 Hz`,
      sweep('modDepth', 0, 4, span, { modRate: 8 }),
      2 * span + 2,
      [{ modRate: 8, modDepth: 0 }, DEEP],
    ],
    [
      `modRate 0 to 8 and back over ${span} s each way, at 4 ms`,
      sweep('modRate', 0, 8, span, { modDepth: 4 }),
      2 * span + 2,
      [{ modRate: 0, modDepth: 4 }, DEEP],
    ],
  ]);
  moves.push([
    'Size 0.05 to 4 and back over 8 s each way, at the deepest',
    sweep('size', 0.05, 4, 8, DEEP),
    18,
    [
      { size: 0.05, ...DEEP },
      { size: 4, ...DEEP },
    ],
  ]);

  it.each(moves)(
    '%s steps no further than a steady tone slews, nor a drum loop through a still plate',
    (_, automate, seconds, ends) => {
      const held = stepFrom1s(tone, automate, seconds);
      expect(held.step).toBeLessThan(((2 * Math.PI * 220) / SR) * held.peak * 3);
      const stillStep = Math.max(
        ...ends.map((end) => stepFrom1s(drums(), still(end), seconds).step),
      );
      // The loudest step is a kick's, the same sample in the moving render as
      // in the still ones; a moving tail under it can lift it by a hair. Since
      // windsor#766's denser early taps more of the tail sits under each kick:
      // the 1 s `modDepth` sweep reads 1.045 of the still plate's, the others
      // 0.87 to 0.95, so 5 % is allowed (record `2026-10-12-plate-output-taps`).
      expect(stepFrom1s(drums(), automate, seconds).step).toBeLessThanOrEqual(stillStep * 1.05);
    },
    120_000,
  );
});

describe('the excursion is milliseconds at any rate', () => {
  /** A plate at `rate` fed one click, `params` held for 1 s, `read` after every block. */
  function settled(
    rate: number,
    params: Record<string, number>,
    read: (plate: ReturnType<typeof internals>) => void,
  ): void {
    const plate = loadReverb(rate);
    const processor = plate.create();
    const values: Record<string, Float32Array> = {};
    for (const d of plate.descriptors) {
      values[d.name] = new Float32Array([params[d.name] ?? d.defaultValue]);
    }
    const input = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    for (let b = 0; b < Math.round(rate / BLOCK); b++) {
      input[0]!.fill(0);
      input[1]!.fill(0);
      if (b === 0) input[0]![0] = input[1]![0] = 1;
      processor.process([input], [[new Float32Array(BLOCK), new Float32Array(BLOCK)]], values);
      read(internals(processor));
    }
  }

  it.each([44100, 48000, 96000])('at %i Hz each depth is modDepth, within a sample', (rate) => {
    let depths: number[] = [];
    settled(rate, DEEP, (plate) => (depths = [...plate._modDepth]));
    for (const depth of depths) {
      expect(Math.abs(depth - (DEEP.modDepth * rate) / 1000)).toBeLessThanOrEqual(1);
    }
  });

  it('at 96 kHz and Size 0.05 no read reaches its write head', () => {
    // The cubic read takes the sample two past its point, so the delay it
    // reads at, its line's length less the excursion, stays over three samples.
    settled(96000, { ...DEEP, size: 0.05 }, (plate) => {
      modLines.forEach((line, p) => {
        expect(plate._length[line]! - plate._modOffset[p]!).toBeGreaterThanOrEqual(3);
        expect(plate._length[line]! - plate._modDepth[p]!).toBeGreaterThanOrEqual(3);
      });
    });
  });
});
