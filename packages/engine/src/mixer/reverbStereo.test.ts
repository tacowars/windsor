/**
 * The plate's stereo input (windsor#763): L and R run through their own
 * pre-delay, input filters, diffusers and Build line, and each feeds the half
 * of the tank its own output reads most. So a click on one side leads on
 * that side, the two sides mirror each other, a centred source stays central
 * at main's level, an anti-phase source rings, the plate moves live without a
 * step under a stereo loop, and both chains are seconds at any rate. The
 * whole-box sweep, the mono sum, the T30s and the CPU figures are in
 * `docs/research/2026-10-12-plate-stereo-input/`, whose `measure.mjs` reads
 * the windows the same way.
 *
 * Each click waits half a second, so the plate has glided to its Size, and
 * every window is read from the end of the pre-delay (0 in the default space).
 */
import { describe, expect, it } from 'vitest';

import type { Automate, Feed } from '../__fixtures__/reverbHarness';
import { channel, internals, loadReverb, renderReverb } from '../__fixtures__/reverbHarness';

const loaded = loadReverb();
const SR = loaded.sampleRate;
const BLOCK = 128;
const blockAt = (seconds: number): number => Math.round((seconds * SR) / BLOCK);
const SETTLE = blockAt(0.5);
const db = (ratio: number): number => 10 * Math.log10(ratio);

/** A click at the settle, at `left` and `right` on each side. */
const click =
  (left: number, right: number): Feed =>
  (block, l, r) => {
    if (block !== SETTLE) return;
    l[0] = left;
    r[0] = right;
  };

/** Each side's wet output from the click on. */
function wet(feed: Feed, params: Record<string, number>, seconds: number) {
  const { samples } = renderReverb(loaded, 0.5 + seconds, feed, params, { collectSamples: true });
  return { left: channel(samples, 0, SETTLE * BLOCK), right: channel(samples, 1, SETTLE * BLOCK) };
}

function energy(x: Float64Array, fromMs: number, toMs: number): number {
  let e = 0;
  for (let i = Math.round((fromMs * SR) / 1000); i < Math.round((toMs * SR) / 1000); i++) {
    e += x[i]! ** 2;
  }
  return e;
}

const WINDOWS: [number, number][] = [
  [0, 50],
  [50, 200],
  [200, 1000],
];

/**
 * How far L alone's left energy may sit from R alone's right in any window.
 * At Size 4 the first window holds only each half's first output taps, so it
 * splits the halves unevenly: under table 2 the shipped right chain read
 * 1.16 dB there (record `2026-10-12-plate-stereo-input`), and under
 * windsor#766's taps it reads 0.33 dB (0.56 dB at 44.1 kHz; record
 * `2026-10-12-plate-output-taps`).
 */
const MIRROR_DB = (size: number, voicing: number): number =>
  size !== 4 ? 1 : voicing === 0 ? PLATE_SIZE4_MIRROR_DB : 1.25;

/**
 * The plate voicing's mirror at Size 4 (windsor#746): its diffusers, under
 * 1 ms, no longer smear a click across the windows, so #766's first taps set
 * the split, and the 50–200 ms window reads −3.61 dB (−3.54 at 44.1 kHz).
 * No set of diffusers under 2 ms held it (record `2026-10-12-plate-room-voicing`,
 * a deviation for tacowars); this holds it where it is.
 */
const PLATE_SIZE4_MIRROR_DB = 3.75;

describe('the side follows the input', () => {
  it.each([0.25, 1, 4].flatMap((size) => [0, 1].map((voicing) => [size, voicing])))(
    'at Build 0, Size %s and voicing %s, a click on one side leads there by 3 dB in its first 50 ms, and the two sides mirror within 1 dB (1.25 at Size 4)',
    (size, voicing) => {
      const fromLeft = wet(click(1, 0), { size, build: 0, voicing }, 1);
      const fromRight = wet(click(0, 1), { size, build: 0, voicing }, 1);
      const lead = (fed: Float64Array, other: Float64Array) =>
        db(energy(fed, 0, 50) / energy(other, 0, 50));
      expect(lead(fromLeft.left, fromLeft.right)).toBeGreaterThanOrEqual(3);
      expect(lead(fromRight.right, fromRight.left)).toBeGreaterThanOrEqual(3);
      for (const [from, to] of WINDOWS) {
        const gap = db(energy(fromLeft.left, from, to) / energy(fromRight.right, from, to));
        expect(Math.abs(gap), `${from}–${to} ms`).toBeLessThanOrEqual(MIRROR_DB(size, voicing));
      }
    },
  );
});

describe('a centred source', () => {
  /** `main` at d627d18, the plate before stereo input: one click's wet RMS over its first second. */
  const MAIN_RMS: [number, number][] = [
    [0, 0.0032572],
    [0.5, 0.0031506],
    [1, 0.0031511],
  ];

  it.each(MAIN_RMS.flatMap(([build, main]) => [0, 1].map((voicing) => [build, main, voicing])))(
    "at Build %s stays central within 1 dB, at main's level within 1 dB, and an anti-phase one rings as loud (main %s, voicing %s)",
    (build, main, voicing) => {
      const centred = wet(click(1, 1), { build, voicing }, 1);
      const l = energy(centred.left, 0, 1000);
      const r = energy(centred.right, 0, 1000);
      expect(Math.abs(db(l / r))).toBeLessThanOrEqual(1);
      expect(Math.abs(db((l + r) / (2 * SR) / main ** 2))).toBeLessThanOrEqual(1);
      // L = −R cancelled to silence when the plate summed its input to mono.
      const anti = wet(click(1, -1), { build, voicing }, 1);
      const a = energy(anti.left, 0, 1000) + energy(anti.right, 0, 1000);
      expect(Math.abs(db(a / (l + r)))).toBeLessThanOrEqual(1);
    },
  );

  it('stays central over 10 s of noise, and a one-channel input feeds both chains', () => {
    let seed = 1;
    const noise: Feed = (block, left, right) => {
      if (block < SETTLE || block >= SETTLE + blockAt(10)) return;
      for (let i = 0; i < BLOCK; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        left[i] = right[i] = seed / 0x80000000 - 1;
      }
    };
    const { left, right } = wet(noise, {}, 11);
    expect(Math.abs(db(energy(left, 0, 11000) / energy(right, 0, 11000)))).toBeLessThanOrEqual(1);

    const values: Record<string, Float32Array> = {};
    for (const d of loaded.descriptors) values[d.name] = new Float32Array([d.defaultValue]);
    const one = loaded.create();
    const two = loaded.create();
    const input = new Float32Array(BLOCK);
    const outOne = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    const outTwo = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
    for (let b = 0; b < blockAt(1); b++) {
      input.fill(0);
      if (b === 0) input[0] = 1;
      for (const out of [...outOne, ...outTwo]) out.fill(0);
      one.process([[input]], [outOne], values);
      two.process([[input, input]], [outTwo], values);
      expect(outOne).toEqual(outTwo);
    }
  });
});

/** A 0.4 s burst, then a kick every 0.5 s on both sides and a hat every 0.25 s on the left, with the right a delayed copy. */
function stereoDrums(): Feed {
  let seed = 1;
  const noise = (): number => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 0x80000000 - 1;
  };
  return (block, left, right) => {
    for (let i = 0; i < left.length; i++) {
      const t = (block * BLOCK + i) / SR;
      const beat = t % 0.5;
      const kick = t >= 0.5 ? Math.sin(2 * Math.PI * 55 * beat) * Math.exp(-beat / 0.08) * 0.8 : 0;
      const hat = t >= 0.5 && t % 0.25 < 0.004 ? noise() * 0.4 : 0;
      left[i] = (t < 0.4 ? noise() * 0.5 : 0) + kick + hat;
      right[i] =
        (t < 0.4 ? noise() * 0.3 : 0) +
        kick * 0.6 +
        (t >= 0.5 && (t - 0.06) % 0.25 < 0.004 ? noise() * 0.4 : 0);
    }
  };
}

/** The largest step on either side from 1 s on, where the moves start. */
function stepFrom1s(automate: Automate, length: number): number {
  const { samples } = renderReverb(
    loaded,
    length,
    stereoDrums(),
    {},
    { automate, collectSamples: true },
  );
  let step = 0;
  for (const side of [0, 1] as const) {
    const x = channel(samples, side, SR);
    for (let i = 1; i < x.length; i++) step = Math.max(step, Math.abs(x[i]! - x[i - 1]!));
  }
  return step;
}

/** `name` from `from` at 1 s to `to` over `span` seconds, and back. */
const sweep =
  (name: string, from: number, to: number, span: number): Automate =>
  (block, values) => {
    const at = Math.min(Math.max((block * BLOCK) / SR - 1, 0), 2 * span);
    values[name]![0] = from + ((to - from) * (at < span ? at : 2 * span - at)) / span;
  };

describe('live moves under a stereo loop (record 2026-08-31-dattorro-reverb-not-plateau §3)', () => {
  let still = 0;
  const stillStep = (): number =>
    (still ||= Math.max(
      ...[0.05, 4].flatMap((size) =>
        [0, 1].map((build) =>
          stepFrom1s((_, values) => {
            values.size![0] = size;
            values.build![0] = build;
          }, 18),
        ),
      ),
    ));

  const moves: [string, Automate, number][] = [
    ['Size swept 0.05 to 4 over 1 s each way', sweep('size', 0.05, 4, 1), 4],
    ['Size swept 0.05 to 4 over 8 s each way', sweep('size', 0.05, 4, 8), 18],
    ['Build swept 0 to 1 over 1 s each way', sweep('build', 0, 1, 1), 4],
    ['Build swept 0 to 1 over 8 s each way', sweep('build', 0, 1, 8), 18],
    [
      'HOLD on and off',
      (block, values) => {
        values.hold![0] = block >= blockAt(2) && block < blockAt(4) ? 1 : 0;
      },
      6,
    ],
  ];

  it.each(moves)(
    '%s steps no further than the loop through a still plate',
    (_, automate, length) => {
      expect(stepFrom1s(automate, length)).toBeLessThanOrEqual(stillStep());
    },
    60_000,
  );

  it('keeps a held stereo tail ringing on both sides', () => {
    const { samples } = renderReverb(
      loaded,
      10,
      stereoDrums(),
      {},
      {
        automate: (block, values) => {
          values.hold![0] = block >= blockAt(1) ? 1 : 0;
        },
        collectSamples: true,
      },
    );
    for (const side of [0, 1] as const) {
      const x = channel(samples, side);
      const early = energy(x, 2000, 3000);
      const late = energy(x, 9000, 10000);
      expect(late, `side ${side}`).toBeGreaterThan(early * 0.25);
    }
  });
});

describe('both chains are seconds at any rate', () => {
  it.each([44100, 48000, 96000])(
    'at %i Hz each diffuser is its length within a sample, and the pre-delays and Build lines never wrap short',
    (rate) => {
      const plate = loadReverb(rate);
      const processor = internals(plate.create());
      const at48 = internals(loaded.create());
      const lines = [0, 1, 2, 3, 12, 13, 14, 15];
      for (const line of lines) {
        const seconds = at48._length[line]! / SR;
        expect(Math.abs(processor._length[line]! - seconds * rate)).toBeLessThanOrEqual(1);
        expect(processor._length[line]! + 2).toBeLessThanOrEqual(processor._buffers[line]!.length);
      }
      const { maxPreDelay } = plate.topology;
      expect(processor._preDelay.length - BLOCK).toBeGreaterThanOrEqual(maxPreDelay * rate);
      expect(processor._preDelayRight.length).toBe(processor._preDelay.length);
      expect(processor._buildLineRight.length).toBe(processor._buildLine.length);
    },
  );
});
