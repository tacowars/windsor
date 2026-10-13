import { describe, expect, it } from 'vitest';

import { WAVE as MAIN_WAVE } from '../../patch/patch';
import { MIP_BASE_HZ, MIP_COUNT, MIP_TABLE_RATIO, TABLE_SIZE, TABLE_SIZE_MAX } from './fmConstants';
import { WAVE } from './waveIds';
// The module reads no worklet scope at load: the main thread imports it too (windsor#795).
import {
  cachedWaveSet,
  getMips,
  installWaveSet,
  KIND_NOISE,
  KIND_PULSE,
  KIND_SAW_D,
  KIND_TABLE,
  mipIndex,
  SIN_TAB,
  WAVE_BUILT_LIMIT,
  WAVE_SENT_LIMIT,
  waveKind,
  waveSetFor,
  waveSetKey,
} from './waveTables';

describe('the wave tables', () => {
  it('are the ids the main thread re-exports (#656)', () => {
    expect(MAIN_WAVE).toBe(WAVE);
  });

  it('hold an exact sine', () => {
    expect(SIN_TAB).toHaveLength(TABLE_SIZE);
    expect(SIN_TAB[TABLE_SIZE / 4]).toBeCloseTo(1, 6);
    expect(SIN_TAB[TABLE_SIZE / 2]).toBeCloseTo(0, 6);
  });

  it('build one guarded table per octave, once, and share it across callers', () => {
    const mips = getMips(WAVE.SAW, 48000, 1, null);
    expect(mips).toHaveLength(MIP_COUNT);
    for (const t of mips) expect(t[t.length - 1]).toBe(t[0]);
    expect(getMips(WAVE.SAW, 48000, 1, null)).toBe(mips);
    expect(getMips(WAVE.SAW, 48000, 0.5, null)).not.toBe(mips);
  });

  it('size each octave’s table to the harmonics it holds, from TABLE_SIZE to TABLE_SIZE_MAX', () => {
    const sizes = (tone: number) => getMips(WAVE.SAW, 48000, tone, null).map((t) => t.length - 1);
    expect(sizes(1)).toEqual([16384, 8192, 4096, ...Array<number>(9).fill(2048)]);
    expect(sizes(0.5)).toEqual([8192, 4096, ...Array<number>(10).fill(2048)]);
    for (let k = 0; k < MIP_COUNT; k++) {
      const harmonics = Math.floor(24000 / (MIP_BASE_HZ * 2 ** (k + 1)));
      const size = sizes(1)[k]!;
      expect(size >= MIP_TABLE_RATIO * harmonics || size === TABLE_SIZE_MAX).toBe(true);
    }
    // A sine holds one harmonic: every octave stays at TABLE_SIZE, as before.
    for (const t of getMips(WAVE.SINE, 48000, 1, null)) expect(t).toHaveLength(TABLE_SIZE + 1);
  });

  it('build a long table, by the inverse FFT, as the sum of its harmonics', () => {
    const t = getMips(WAVE.SAW, 48000, 1, null)[0]!;
    const n = t.length - 1;
    const harmonics = Math.floor(24000 / (MIP_BASE_HZ * 2));
    const sum = new Float64Array(n);
    for (let h = 1; h <= harmonics; h++) {
      for (let i = 0; i < n; i++) sum[i] += Math.sin((2 * Math.PI * h * i) / n) / h;
    }
    const peak = sum.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
    let err = 0;
    for (let i = 0; i < n; i++) err = Math.max(err, Math.abs(t[i]! - sum[i]! / peak));
    expect(err).toBeLessThan(1e-5);
  });

  it('quantise the 4-bit sine to nine levels each side of zero', () => {
    const levels = new Set(getMips(WAVE.SINE_4BIT, 48000, 1, null)[0]);
    expect(levels.size).toBeLessThanOrEqual(17);
    for (const v of levels) expect(v * 8).toBe(Math.round(v * 8));
  });

  it('pick the octave table by frequency', () => {
    expect(mipIndex(10)).toBe(0);
    expect(mipIndex(16.352 * 8 + 1)).toBe(3);
    expect(mipIndex(1e6)).toBe(MIP_COUNT - 1);
  });

  it('map raw and noise waves to their render kinds', () => {
    expect(waveKind(WAVE.NOISE)).toBe(KIND_NOISE);
    expect(waveKind(WAVE.SAW_D)).toBe(KIND_SAW_D);
    expect(waveKind(WAVE.SINE)).toBe(KIND_TABLE);
    expect(waveKind(WAVE.USER)).toBe(KIND_TABLE);
    expect(waveKind(WAVE.PULSE)).toBe(KIND_PULSE);
  });

  describe('at twice the rate, for a synced note (windsor#656)', () => {
    /** A table's harmonic `h`, read from `TABLE_SIZE` points at its own stride. */
    const harmonicOf = (t: Float32Array, h: number): number => {
      const n = t.length - 1;
      let acc = 0;
      for (let k = 0; k < n; k++) acc += t[k]! * Math.sin((2 * Math.PI * h * k) / n);
      return (2 * acc) / n;
    };

    it('build a set of their own, once, keyed by the rate', () => {
      const twice = getMips(WAVE.SAW, 96000, 1, null, 48000);
      expect(twice).not.toBe(getMips(WAVE.SAW, 48000, 1, null));
      expect(getMips(WAVE.SAW, 96000, 1, null, 48000)).toBe(twice);
      expect(getMips(WAVE.PULSE, 96000, 1, null, 48000)).toBe(twice);
    });

    it('size each table by the same rule over the doubled rate’s harmonics', () => {
      const sizes = getMips(WAVE.SAW, 96000, 1, null, 48000).map((t) => t.length - 1);
      for (let k = 0; k < MIP_COUNT; k++) {
        const harmonics = Math.min(
          TABLE_SIZE / 2,
          Math.floor(48000 / (MIP_BASE_HZ * 2 ** (k + 1))),
        );
        let want = TABLE_SIZE;
        while (want < MIP_TABLE_RATIO * harmonics && want < TABLE_SIZE_MAX) want *= 2;
        expect(sizes[k], `octave ${k}`).toBe(want);
      }
    });

    it.each([
      ['saw', WAVE.SAW, null],
      ['square', WAVE.SQUARE, null],
      ['triangle', WAVE.TRIANGLE, null],
      ['user with no fundamental', WAVE.USER, [0, 0.5, 0.25, 0.1]],
    ] as const)(
      'play the %s’s harmonics at the part’s table’s level, not their own peak’s',
      (_, wave, partials) => {
        const user = partials ? [...partials] : null;
        const once = getMips(wave, 48000, 1, user);
        const twice = getMips(wave, 96000, 1, user, 48000);
        const h = partials ? 2 : 1;
        for (let k = 0; k < MIP_COUNT; k++) {
          // An octave whose part's table holds none of it (past its Nyquist) has no level to keep.
          const b = harmonicOf(once[k]!, h);
          if (Math.abs(b) < 1e-6) continue;
          expect(harmonicOf(twice[k]!, h) / b, `octave ${k}`).toBeCloseTo(1, 5);
        }
      },
    );
  });

  describe('the cache both threads key alike (windsor#795)', () => {
    /** A set no build would make, to install. */
    const stub = () => ({ mips: [new Float32Array(2)], gains: new Float64Array(MIP_COUNT) });

    it('keys a set by its wave, its Tone’s twentieth, its rates and a User wave’s partials', () => {
      expect(waveSetKey(WAVE.SAW, 48000, 0.73, null)).toBe('1|0.75|48000|');
      expect(waveSetKey(WAVE.PULSE, 48000, 0.73, null)).toBe(
        waveSetKey(WAVE.SAW, 48000, 0.75, null),
      );
      expect(waveSetKey(WAVE.SAW, 96000, 0, null, 48000)).toBe('1|0.02|96000/48000|');
      expect(waveSetKey(WAVE.USER, 48000, 1, [1, 0.5])).toBe(`${WAVE.USER}|1|48000|[1,0.5]`);
      expect(waveSetKey(WAVE.USER, 48000, 1, null)).not.toBe(waveSetKey(WAVE.USER, 48000, 1, []));
      const set = waveSetFor(WAVE.SAW, 48000, 0.73, null);
      expect(cachedWaveSet(waveSetKey(WAVE.SAW, 48000, 0.75, null))).toBe(set);
    });

    it('installs a set under its key as handed over', () => {
      const sent = stub();
      installWaveSet(waveSetKey(WAVE.TRIANGLE, 48000, 0.35, null), sent);
      expect(waveSetFor(WAVE.TRIANGLE, 48000, 0.35, null)).toBe(sent);
    });

    it('holds WAVE_SENT_LIMIT installs, drops the oldest first, and moves one installed again to newest', () => {
      const keys = Array.from({ length: WAVE_SENT_LIMIT + 1 }, (_, i) => `fifo|${i}`);
      const first = stub();
      for (const key of keys.slice(0, WAVE_SENT_LIMIT))
        installWaveSet(key, key === keys[0] ? first : stub());
      // Installed again, the oldest keeps its set and becomes the newest, so the next drops the second.
      installWaveSet(keys[0]!, stub());
      installWaveSet(keys[WAVE_SENT_LIMIT]!, stub());
      expect(cachedWaveSet(keys[0]!)).toBe(first);
      expect(cachedWaveSet(keys[1]!)).toBeNull();
      for (const key of keys.slice(2)) expect(cachedWaveSet(key)).not.toBeNull();
    });

    it('keeps the sets it builds apart, so no build evicts an install', () => {
      const sent = stub();
      installWaveSet('apart|sent', sent);
      for (let i = 0; i <= WAVE_BUILT_LIMIT; i++) waveSetFor(WAVE.USER, 48000, 1, [1, i / 64]);
      expect(cachedWaveSet('apart|sent')).toBe(sent);
      expect(cachedWaveSet(waveSetKey(WAVE.USER, 48000, 1, [1, 0]))).toBeNull();
    });
  });

  it('give PULSE the saw’s own tables, one copy in the cache (#55)', () => {
    expect(getMips(WAVE.PULSE, 48000, 1, null)).toBe(getMips(WAVE.SAW, 48000, 1, null));
    expect(getMips(WAVE.PULSE, 48000, 0.5, null)).toBe(getMips(WAVE.SAW, 48000, 0.5, null));
  });
});
