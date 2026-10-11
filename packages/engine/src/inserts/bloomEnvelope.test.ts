/**
 * bloom's envelope levers, through the shipped bundle: Swell's onset time,
 * Sustain's hold time and the pitch a held band keeps, a held band coming
 * back to its input, Freeze holding for ever and ignoring new input, and no
 * click when any of them moves. That the defaults are neutral to the bit is
 * `bloomGolden.test.ts`'s; here, a lever switched off returns to the
 * defaults' render to the bit once nothing holds.
 *
 * Every render is the generated layer alone (Mix 100 %). Lines are read over
 * windows of whole periods. 250 Hz sits 21 cents above its band's centre
 * (B3) and 225 Hz 39 cents above A3's, so a held band that drifted to its
 * centre, as a ring-down does, would show.
 */
// reads-by-path: packages/engine/src/worklet/generated/**, packages/engine/src/__fixtures__/**
import { describe, expect, it } from 'vitest';
import { bloomRig, noise, renderBloom, tone } from '../__fixtures__/bloomHarness';
import type { BloomProcessorLike, BloomRender, BloomSource } from '../__fixtures__/bloomHarness';
import type { BloomSpec } from './bloomSpec';

const RATE = 48000;
const LEVEL = 0.25;
const at = (s: number): number => Math.round(s * RATE);
const WET: Partial<BloomSpec> = { mix: 1 };

interface EnvelopeInternals {
  engaged: boolean;
  soundingCount: number;
  lock: Float64Array;
  level: Float64Array;
}
const envelopeOf = (p: BloomProcessorLike): EnvelopeInternals =>
  (p.dsp as unknown as { envelope: EnvelopeInternals }).envelope;

/** The complex amplitude of `hz` over [from, to). */
function line(data: Float32Array, hz: number, from: number, to: number): [number, number] {
  let re = 0,
    im = 0;
  for (let i = from; i < to; i++) {
    const phase = (2 * Math.PI * hz * i) / RATE;
    re += data[i]! * Math.cos(phase);
    im -= data[i]! * Math.sin(phase);
  }
  return [(2 * re) / (to - from), (2 * im) / (to - from)];
}
/** `hz`'s level over [from, to) in dB re `LEVEL`. */
const levelDb = (data: Float32Array, hz: number, from: number, to: number): number =>
  20 * Math.log10(Math.hypot(...line(data, hz, from, to)) / LEVEL);
/** The frequency near `hz` over [from, to), from its line's phase advance window to window. */
function frequency(
  data: Float32Array,
  hz: number,
  from: number,
  to: number,
  win = at(0.1),
): number {
  let turn = 0,
    count = 0,
    last = NaN;
  for (let s = from; s + win <= to; s += win, count++) {
    const [re, im] = line(data, hz, s, s + win);
    const phase = Math.atan2(im, re);
    if (count > 0) turn += Math.atan2(Math.sin(phase - last), Math.cos(phase - last));
    last = phase;
  }
  return hz + (turn / (count - 1) / (2 * Math.PI)) * (RATE / win);
}
const cents = (f: number, g: number): number => 1200 * Math.log2(f / g);
/** The largest sample-to-sample step over [from, to): a click shows as a step the waveform never takes. */
function maxStep(data: Float32Array, from: number, to: number): number {
  let largest = 0;
  for (let i = from + 1; i < to; i++)
    largest = Math.max(largest, Math.abs(data[i]! - data[i - 1]!));
  return largest;
}
/** A switch's or knob's params set at frame `when` (rounded to its block). */
const setAt =
  (changes: [number, string, number][]) =>
  (frame: number, params: Record<string, Float32Array>): void => {
    for (const [when, name, value] of changes)
      if (frame === Math.floor(when / 128) * 128) params[name]![0] = value;
  };

describe('Swell', () => {
  it.each([0.5, 2, 5])(
    'brings a 250 Hz band to 90 %% of its level in about %s s',
    (swell) => {
      const seconds = 4 * swell + 1;
      const out = renderBloom({ ...WET, swell }, { seconds, source: tone(250, LEVEL, RATE) }).left;
      const win = at(0.04); // ten periods
      const settled = Math.hypot(...line(out, 250, out.length - 5 * win, out.length));
      let t90 = NaN;
      for (let s = 0; s + win <= out.length; s += win / 4) {
        if (Math.hypot(...line(out, 250, s, s + win)) >= 0.9 * settled) {
          t90 = (s + win / 2) / RATE;
          break;
        }
      }
      expect(Math.abs(t90 / swell - 1)).toBeLessThan(0.12);
    },
    30_000,
  );

  it('at 0 starts as the defaults do', () => {
    const source = tone(250, LEVEL, RATE);
    expect(renderBloom({ ...WET, swell: 0 }, { seconds: 0.3, source }).left).toEqual(
      renderBloom(WET, { seconds: 0.3, source }).left,
    );
  });
});

describe('Sustain', { timeout: 30_000 }, () => {
  const STOP = at(1);
  const held = (spec: Partial<BloomSpec>, hz: number, seconds: number): BloomRender =>
    renderBloom({ ...WET, ...spec }, { seconds, source: tone(hz, LEVEL, RATE, 0, STOP) });

  it.each([1, 4])('falls 60 dB in about Sustain = %i s once the input stops', (sustain) => {
    const out = held({ sustain }, 250, 1 + 0.9 * sustain).left;
    const win = at(0.04);
    const before = levelDb(out, 250, STOP - 5 * win, STOP);
    // The slope between a quarter and three quarters of Sustain after the stop.
    const early = levelDb(out, 250, STOP + at(sustain / 4), STOP + at(sustain / 4) + win);
    const late = levelDb(
      out,
      250,
      STOP + at((3 * sustain) / 4),
      STOP + at((3 * sustain) / 4) + win,
    );
    expect(Math.abs(early - late - 30)).toBeLessThan(3);
    // So it holds about Sustain: at its quarter mark it is still within 20 dB of the note.
    expect(before - early).toBeLessThan(20);
  });

  it('at 0 rings down as the defaults do: the layer is gone 0.5 s after the input', () => {
    const out = held({ sustain: 0 }, 250, 1.6).left;
    const before = levelDb(out, 250, STOP - at(0.2), STOP);
    expect(levelDb(out, 250, STOP + at(0.5), STOP + at(0.6)) - before).toBeLessThan(-80);
  });

  it.each([225, 250, 1250])(
    'a held %i Hz band keeps the input’s pitch within a cent (a ring-down drifts towards the centre)',
    (hz) => {
      const out = held({ sustain: 8 }, hz, 2.6).left;
      expect(Math.abs(cents(frequency(out, hz, STOP + at(0.3), STOP + at(1.5)), hz))).toBeLessThan(
        1,
      );
    },
  );

  it('the natural ring-down, by contrast, drifts', () => {
    const out = held({ sustain: 0 }, 225, 1.2).left;
    const drift = cents(frequency(out, 225, STOP + at(0.01), STOP + at(0.13), at(0.02)), 225);
    expect(Math.abs(drift)).toBeGreaterThan(5);
  });

  it('holds a note through a legato step to the next semitone, which sounds too', () => {
    const source: BloomSource = (f, c) =>
      tone(220, LEVEL, RATE, 0, STOP)(f, c) + tone(233.0819, LEVEL, RATE, at(1.2), at(3))(f, c);
    const out = renderBloom({ ...WET, sustain: 8 }, { seconds: 2.5, source }).left;
    const before = levelDb(out, 220, STOP - at(0.2), STOP);
    // 8 s for 60 dB is 7.5 dB a second: about 9 dB down 1.2 s after the stop.
    expect(Math.abs(levelDb(out, 220, at(2), at(2.4)) - before + 9)).toBeLessThan(2);
    expect(levelDb(out, 233.0819, at(2), at(2.4))).toBeGreaterThan(before - 3);
  });

  it('a held band its input comes back to follows the new pitch, without a click', () => {
    const rig = bloomRig({ ...WET, sustain: 4 });
    const back = at(1.5);
    const source: BloomSource = (f, c) =>
      tone(225, LEVEL, RATE, 0, STOP)(f, c) +
      (f >= back ? LEVEL * Math.sin((2 * Math.PI * 216 * f) / RATE + 1.3) : 0);
    const out = rig.render(at(3), source).left;
    expect(Math.abs(cents(frequency(out, 216, at(2), at(3)), 216))).toBeLessThan(1);
    expect(envelopeOf(rig.processor).lock[16]).toBe(1);
    const steady = Math.max(maxStep(out, at(0.5), STOP), maxStep(out, at(2), at(3)));
    expect(maxStep(out, back - 128, back + at(0.2))).toBeLessThan(1.1 * steady);
  });
});

describe('Freeze', { timeout: 60_000 }, () => {
  const FREEZE = at(0.8),
    NEW = at(1.2),
    THAW = at(10);
  const source: BloomSource = (f, c) =>
    tone(220, LEVEL, RATE, 0, at(1))(f, c) + tone(330, LEVEL, RATE, NEW, at(12))(f, c);
  const frozen = (mix: number): { out: Float32Array; asleep: boolean } => {
    const rig = bloomRig({ mix });
    const onBlock = setAt([
      [FREEZE, 'freeze', 1],
      [THAW, 'freeze', 0],
    ]);
    const out = rig.render(at(10.5), source, { onBlock }).left;
    return { out, asleep: rig.processor.dsp.asleep };
  };
  const wet = frozen(1);

  it('holds the chord’s level and pitch for as long as it is on, and never sleeps', () => {
    const second = (s: number): [number, number] => [at(s), at(s + 1)];
    const playing = levelDb(wet.out, 220, at(0.3), at(0.8));
    expect(Math.abs(levelDb(wet.out, 220, ...second(8.9)) - playing)).toBeLessThan(0.1);
    expect(Math.abs(cents(frequency(wet.out, 220, at(2), at(9.9), at(0.5)), 220))).toBeLessThan(
      0.1,
    );
    expect(wet.asleep).toBe(false);
  });

  it('ignores new input in the layer, which still passes dry', () => {
    const playing = levelDb(wet.out, 220, at(0.3), at(0.8));
    expect(levelDb(wet.out, 330, at(3), at(9)) - playing).toBeLessThan(-60);
    const half = frozen(0.5).out;
    expect(Math.abs(levelDb(half, 330, at(3), at(9)))).toBeLessThan(0.1);
  });

  it('lets go over about freezeSeconds, and the layer takes the new input', () => {
    const playing = levelDb(wet.out, 220, at(0.3), at(0.8));
    // 0.1 s holds whole periods of both tones, so neither leaks into the other's line.
    expect(levelDb(wet.out, 220, THAW + at(0.1), THAW + at(0.2)) - playing).toBeLessThan(-50);
    expect(levelDb(wet.out, 330, THAW + at(0.3), THAW + at(0.5)) - playing).toBeGreaterThan(-3);
  });

  it('engages and lets go without a click', () => {
    const steady = Math.max(
      maxStep(wet.out, at(0.3), at(0.79)),
      maxStep(wet.out, at(10.2), at(10.5)),
    );
    expect(maxStep(wet.out, FREEZE - 256, FREEZE + at(0.2))).toBeLessThan(1.1 * steady);
    expect(maxStep(wet.out, THAW - 256, THAW + at(0.2))).toBeLessThan(1.1 * steady);
  });
});

describe('moving the levers', { timeout: 60_000 }, () => {
  it('Swell and Sustain moved mid-note make no click, and switched off return to the defaults to the bit', () => {
    const source = tone(250, LEVEL, RATE, 0, at(1.5));
    const plain = renderBloom(WET, { seconds: 3, source }).left;
    const rig = bloomRig(WET);
    const onBlock = setAt([
      [at(0.4), 'sustain', 3],
      [at(0.6), 'swell', 1.5],
      [at(0.9), 'sustain', 0],
      [at(0.9), 'swell', 0],
    ]);
    let engagedUntil = 0;
    const out = rig.render(at(3), source, {
      onBlock,
      afterBlock: (frame, p) => {
        if (envelopeOf(p).engaged) engagedUntil = frame + 128;
      },
    }).left;
    expect(engagedUntil).toBeGreaterThan(at(0.9));
    expect(engagedUntil).toBeLessThan(at(1.5));
    expect(out.subarray(engagedUntil)).toEqual(plain.subarray(engagedUntil));
    expect(maxStep(out, at(0.35), at(1.45))).toBeLessThan(1.1 * maxStep(plain, at(0.35), at(1.45)));
  });

  it('Sustain holds every band of a staccato run at once, and lets them all go', () => {
    const rig = bloomRig({ ...WET, sustain: 30 });
    // 80 ms notes 100 ms apart, F2 to E6, then silence; Sustain back to 0 at 5 s.
    const run: BloomSource = (f) => {
      const note = Math.floor(f / at(0.1));
      const on = note < 48 && f % at(0.1) < at(0.08);
      return on ? LEVEL * Math.sin((2 * Math.PI * 87.307 * 2 ** (note / 12) * f) / RATE) : 0;
    };
    let atEnd = 0;
    rig.render(at(6), run, {
      onBlock: setAt([[at(5), 'sustain', 0]]),
      afterBlock: (frame, p) => {
        if (frame < at(4.9)) atEnd = envelopeOf(p).soundingCount;
      },
    });
    expect(atEnd).toBe(48);
    expect(envelopeOf(rig.processor).soundingCount).toBe(0);
    expect(envelopeOf(rig.processor).engaged).toBe(false);
  });

  it('Freeze holds every band noise sounded', () => {
    const rig = bloomRig(WET);
    rig.render(at(1), noise(0.5, 0, at(0.5)), { onBlock: setAt([[at(0.4), 'freeze', 1]]) });
    expect(envelopeOf(rig.processor).soundingCount).toBe(48);
  });

  it.each(['sustain', 'freeze'])(
    'a band %s holds fades within closingSeconds once Low…High leaves it out',
    (lever) => {
      const rig = bloomRig(WET);
      const out = rig.render(at(2), tone(220, LEVEL, RATE, 0, at(1)), {
        onBlock: setAt([
          [at(0.8), lever, lever === 'sustain' ? 20 : 1],
          [at(1.3), 'low', 60],
        ]),
      }).left;
      const held = levelDb(out, 220, at(1.1), at(1.3));
      expect(held).toBeGreaterThan(-6);
      expect(envelopeOf(rig.processor).level[16]).toBe(0);
      // Bands above the range's new edge may still hold the onset's faint leak.
      expect(levelDb(out, 220, at(1.4), at(1.6)) - held).toBeLessThan(-40);
      expect(maxStep(out, at(1.29), at(1.4))).toBeLessThan(1.1 * maxStep(out, at(1.1), at(1.29)));
    },
  );
});
