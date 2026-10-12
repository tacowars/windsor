/**
 * The plate's Build (windsor#761): the onset follows it, Build 0 is at least
 * as snappy as the plate before it, the tail's length and the level do not
 * move with it, it moves live without a step, HOLD still holds, and its tap
 * times are seconds at any rate. The sweep behind these points, the whole
 * box and the CPU figures are in `docs/research/2026-10-12-plate-build/`,
 * whose `buildRig.mjs` reads the onset the same way.
 *
 * Each click waits half a second, so the plate has glided to its Size, and
 * every figure is read from the end of the pre-delay.
 */
import { describe, expect, it } from 'vitest';

import type { Automate, Feed } from '../__fixtures__/reverbHarness';
import {
  channel,
  impulseAt,
  internals,
  loadReverb,
  renderReverb,
  spaceParams,
  t30,
} from '../__fixtures__/reverbHarness';
import type { ReverbSpace } from './reverbSpace';
import { SPACES } from './reverbSpace';

const loaded = loadReverb();
const SR = loaded.sampleRate;
const BLOCK = 128;
const blockAt = (seconds: number): number => Math.round((seconds * SR) / BLOCK);
const SETTLE = blockAt(0.5);
const WINDOW = Math.round(0.01 * SR);
const BUILDS = Array.from({ length: 11 }, (_, i) => i / 10);

/**
 * `main` at 509eb0c, the plate before Build, measured by the research note's
 * `onset.mjs` at 48 kHz: first arrival (ms), energy in the first 20 ms, and
 * wet RMS over the first second, for one click.
 */
const MAIN = {
  hall: { firstMs: 12.5, e20: 0.009838, rms1s: 0.0033324 },
  plate: { firstMs: 4.4583, e20: 0.031386, rms1s: 0.0029222 },
};

interface Onset {
  firstMs: number;
  riseMs: number;
  e20: number;
  rms1s: number;
}

/**
 * One click's onset at `space` and `build`: the first sample above −40 dB of
 * the wet peak; the time to the peak, the first 10 ms window at which the
 * wet envelope (each window's energy averaged with the two either side)
 * comes within 1 dB of its peak, since a long tail plateaus within ±1 dB
 * and its single loudest window wanders; the energy in the first 20 ms; and
 * the wet RMS over the first second.
 */
function onset(space: ReverbSpace, build: number): Onset {
  const { samples } = renderReverb(
    loaded,
    0.5 + space.preDelay + 1.1,
    impulseAt(SETTLE),
    spaceParams({ ...space, build }),
    { collectSamples: true },
  );
  const from = SETTLE * BLOCK + Math.round(space.preDelay * SR);
  const left = channel(samples, 0, from);
  const right = channel(samples, 1, from);
  const power = (i: number): number => left[i]! ** 2 + right[i]! ** 2;
  let peak = 0;
  for (let i = 0; i < left.length; i++) peak = Math.max(peak, power(i));
  let first = 0;
  while (power(first) <= peak * 1e-4) first++;
  const sum = (to: number): number => {
    let e = 0;
    for (let i = 0; i < to; i++) e += power(i);
    return e;
  };
  const windows = Array.from({ length: 100 }, (_, w) => sum((w + 1) * WINDOW) - sum(w * WINDOW));
  const envelope = windows.map((_, w) => {
    const near = windows.slice(Math.max(0, w - 2), w + 3);
    return near.reduce((s, e) => s + e, 0) / near.length;
  });
  const top = Math.max(...envelope);
  return {
    firstMs: (first / SR) * 1000,
    riseMs: envelope.findIndex((e) => e >= top * 10 ** -0.1) * 10,
    e20: sum(Math.round(0.02 * SR)),
    rms1s: Math.sqrt(sum(SR) / (2 * SR)),
  };
}

describe('the onset follows Build', () => {
  it.each(['hall', 'plate'] as const)(
    'the time to the peak rises with Build on %s, never falling by more than one window',
    (name) => {
      const rise = BUILDS.map((build) => onset(SPACES[name], build).riseMs);
      for (let i = 1; i < rise.length; i++)
        expect(rise[i], `${rise}`).toBeGreaterThanOrEqual(rise[i - 1]! - 10);
      expect(rise.at(-1)! - rise[0]!, `${rise}`).toBeGreaterThanOrEqual(100);
    },
    60_000,
  );

  it.each(['hall', 'plate'] as const)(
    'Build 0 arrives no later than main and with at least its early energy on %s',
    (name) => {
      const at0 = onset(SPACES[name], 0);
      expect(at0.firstMs).toBeLessThanOrEqual(MAIN[name].firstMs);
      expect(at0.e20).toBeGreaterThanOrEqual(MAIN[name].e20);
    },
  );

  it.each([0, 0.5, 1])(
    'keeps the default space within 3 dB of main over the first second at Build %f',
    (build) => {
      const { rms1s } = onset(SPACES.hall, build);
      expect(Math.abs(20 * Math.log10(rms1s / MAIN.hall.rms1s))).toBeLessThan(3);
    },
  );
});

/**
 * Decay 2 s at Size 4 reads short of Decay on `main` already (−9.8 % at
 * Build 0 at d627d18): its 0.6 s lines lose 18 dB a pass, so few passes span
 * the fit. Since windsor#763 a centred click reaches the two halves through
 * different diffusers and reads −9.4 % to −10.4 % there (record
 * `2026-10-12-plate-stereo-input`); a hard-left one reads −4 %. Where the
 * output taps sit along the loop moves this cell too: windsor#766's table was
 * chosen to hold it, and reads −9.8 % to −9.9 % (record
 * `2026-10-12-plate-output-taps`).
 */
const T30_TOLERANCE = (decay: number, size: number): number =>
  decay === 2 && size === 4 ? 0.11 : 0.1;

describe('the tail is unchanged in length', () => {
  const cases = [2, 10].flatMap((decay) =>
    [0.25, 1, 4].flatMap((size) => [0, 0.5, 1].map((build) => ({ decay, size, build }))),
  );
  it.each(cases)(
    'T30 within 10 % of Decay $decay s at Size $size, Build $build (11 % at Decay 2 s, Size 4)',
    (space) => {
      const params = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, ...space };
      const { samples } = renderReverb(loaded, 1.5 * space.decay + 3.5, impulseAt(SETTLE), params, {
        collectSamples: true,
      });
      const from = SETTLE * BLOCK;
      const measured = t30(channel(samples, 0, from), channel(samples, 1, from));
      expect(Math.abs(measured / space.decay - 1)).toBeLessThan(
        T30_TOLERANCE(space.decay, space.size),
      );
    },
    60_000,
  );
});

/** A steady 220 Hz tone at 0.3, the signal a step is judged against. */
const tone: Feed = (block, left, right) => {
  for (let i = 0; i < left.length; i++) {
    left[i] = right[i] = Math.sin((2 * Math.PI * 220 * (block * BLOCK + i)) / SR) * 0.3;
  }
};

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

/** Build from 0 at 1 s to 1 over `span` seconds and back; `span` 0 steps it in one block at 2 s and back at 3 s. */
const moveBuild =
  (span: number): Automate =>
  (block, values) => {
    const t = (block * BLOCK) / SR;
    if (span === 0) values.build![0] = t >= 2 && t < 3 ? 1 : 0;
    else {
      const at = Math.min(Math.max(t - 1, 0), 2 * span);
      values.build![0] = (at < span ? at : 2 * span - at) / span;
    }
  };
const holdAt =
  (build: number): Automate =>
  (block, values) => {
    values.build![0] = build;
    values.hold![0] = block >= blockAt(2) && block < blockAt(4) ? 1 : 0;
  };
const seconds = (span: number): number => (span === 0 ? 4 : 2 * span + 2);

/** The largest left-channel step from 1 s on, where the moves start. */
function stepFrom1s(feed: Feed, automate: Automate, length: number): number {
  const { samples } = renderReverb(loaded, length, feed, {}, { automate, collectSamples: true });
  const left = channel(samples, 0, SR);
  let step = 0;
  for (let i = 1; i < left.length; i++) step = Math.max(step, Math.abs(left[i]! - left[i - 1]!));
  return step;
}

describe('live moves (record 2026-08-31-dattorro-reverb-not-plateau §3)', () => {
  const moves: [string, Automate, number][] = [
    ...[1, 4, 8].map((span): [string, Automate, number] => [
      `Build swept over ${span} s each way`,
      moveBuild(span),
      seconds(span),
    ]),
    ['Build stepped 0 to 1 in one block, and back', moveBuild(0), 4],
    ['HOLD on and off at Build 0', holdAt(0), 6],
    ['HOLD on and off at Build 1', holdAt(1), 6],
  ];

  it.each(moves)(
    '%s steps no further than a steady tone slews',
    (_, automate, length) => {
      const result = renderReverb(loaded, length, tone, {}, automate);
      expect(result.nonFinite).toBe(0);
      expect(result.maxStep).toBeLessThan(((2 * Math.PI * 220) / SR) * result.peak * 3);
    },
    60_000,
  );

  /** The drum loop's largest step through the plate held at Build 0 or at Build 1. */
  let still = 0;
  const stillStep = (): number =>
    (still ||= Math.max(
      ...[0, 1].map((build) => stepFrom1s(drums(), (_, values) => (values.build![0] = build), 18)),
    ));

  it.each(moves)(
    '%s steps no further than a drum loop through a still plate',
    (_, automate, length) => {
      expect(stepFrom1s(drums(), automate, length)).toBeLessThanOrEqual(stillStep());
    },
    60_000,
  );

  it('keeps a held tail ringing at Build 1, as at 0', () => {
    for (const build of [0, 1]) {
      const held = renderReverb(loaded, 10, tone, {}, (block, values) => {
        values.build![0] = build;
        values.hold![0] = block >= blockAt(1) ? 1 : 0;
      });
      const late = held.trace.at(-1)!;
      expect(late, `Build ${build}`).toBeGreaterThan(held.trace[blockAt(2)]! * 0.5);
    }
  });
});

describe('the tap times are seconds at any rate', () => {
  it.each([44100, 48000, 96000])(
    'at %i Hz, within a sample, in a line that never wraps short',
    (rate) => {
      const plate = loadReverb(rate);
      const processor = plate.create();
      const values: Record<string, Float32Array> = {};
      for (const d of plate.descriptors) values[d.name] = new Float32Array([d.defaultValue]);
      values.build![0] = 1;
      const silence = [new Float32Array(BLOCK), new Float32Array(BLOCK)];
      for (let b = 0; b < Math.round(rate / BLOCK); b++) {
        processor.process([silence], [[new Float32Array(BLOCK), new Float32Array(BLOCK)]], values);
      }
      const { _buildTime, _buildLine } = internals(processor);
      const { buildTapTime, buildSpread } = plate.topology;
      for (let t = 0; t < buildTapTime.length; t++) {
        expect(Math.abs(_buildTime[t]! - buildTapTime[t]! * rate)).toBeLessThanOrEqual(1);
      }
      expect(Math.max(...buildTapTime)).toBe(buildSpread);
      expect(Math.max(..._buildTime) + 2).toBeLessThanOrEqual(_buildLine.length);
    },
  );
});

describe('the sample loop (worklet rule 6)', () => {
  it('writes the Build reads out, with no call but Math.floor', () => {
    const prototype = Object.getPrototypeOf(loaded.create()) as { _renderBlock: unknown };
    const render = String(prototype._renderBlock);
    const loop = render.slice(render.indexOf('for (let i = 0; i < 128; i++) {'));
    expect(loop).toContain('buildLine[buildWrite] =');
    expect(loop).toContain('buildLine[whole + 1 & buildMask]');
    expect(loop).not.toMatch(/configureBuild\(/);
  });
});
