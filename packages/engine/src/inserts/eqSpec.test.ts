import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { EQ_BOUNDS } from './eqConstants';
import { DEFAULT_EQ, normaliseEq } from './eqSpec';
import type { EqBand } from './eqSpec';

const run = (raw: Record<string, unknown>) => {
  const n = new FieldNormaliser();
  return { spec: normaliseEq(raw, 'fx', n), corrections: n.corrections };
};
const Q = Math.SQRT1_2;

describe('normaliseEq', () => {
  it('makes a new EQ flat, as the record lists it', () => {
    const { spec, corrections } = run({ kind: 'eq' });
    expect(corrections).toEqual([]);
    expect(spec).toEqual(DEFAULT_EQ);
    expect(spec).toEqual({
      kind: 'eq',
      enabled: true,
      scale: 1,
      output: 0,
      bands: [
        { on: false, type: 'lowcut', slope: 12, freq: 30, gain: 0, q: Q },
        { on: true, type: 'lowshelf', slope: 12, freq: 100, gain: 0, q: Q },
        { on: true, type: 'bell', slope: 12, freq: 250, gain: 0, q: Q },
        { on: true, type: 'bell', slope: 12, freq: 800, gain: 0, q: Q },
        { on: true, type: 'bell', slope: 12, freq: 2500, gain: 0, q: Q },
        { on: true, type: 'bell', slope: 12, freq: 6000, gain: 0, q: Q },
        { on: true, type: 'highshelf', slope: 12, freq: 10000, gain: 0, q: Q },
        { on: false, type: 'highcut', slope: 12, freq: 18000, gain: 0, q: Q },
      ],
    });
  });

  it('keeps a valid spec as it is, through JSON too', () => {
    const edited = {
      ...DEFAULT_EQ,
      enabled: false,
      scale: 1.5,
      output: -3,
      bands: DEFAULT_EQ.bands.map((band, i) => ({ ...band, gain: i - 3, slope: 48 as const })),
    };
    const { spec, corrections } = run(
      JSON.parse(JSON.stringify(edited)) as Record<string, unknown>,
    );
    expect(corrections).toEqual([]);
    expect(spec).toEqual(edited);
  });

  it('clamps every number at both ends', () => {
    for (const end of [0, 1] as const) {
      const far = end === 0 ? -1e9 : 1e9;
      const band = { freq: far, gain: far, q: far };
      const { spec, corrections } = run({
        scale: far,
        output: far,
        bands: DEFAULT_EQ.bands.map((b) => ({ ...b, ...band })),
      });
      expect(spec.scale).toBe(EQ_BOUNDS.scale[end]);
      expect(spec.output).toBe(EQ_BOUNDS.output[end]);
      for (const b of spec.bands) {
        expect(b.freq).toBe(EQ_BOUNDS.freq[end]);
        expect(b.gain).toBe(EQ_BOUNDS.gain[end]);
        expect(b.q).toBe(EQ_BOUNDS.q[end]);
      }
      expect(corrections).toHaveLength(2 + 3 * 8);
      expect(corrections[0]).toMatch(/^fx\.scale: clamped/);
      expect(corrections).toContain(`fx.bands[7].q: clamped ${far} to ${EQ_BOUNDS.q[end]}`);
    }
  });

  it('falls back to the band default for an unknown type or slope, and reports it', () => {
    const bands: unknown[] = DEFAULT_EQ.bands.map((b) => ({ ...b }));
    bands[2] = { ...DEFAULT_EQ.bands[2], type: 'tilt' };
    bands[7] = { ...DEFAULT_EQ.bands[7], slope: 18 };
    const { spec, corrections } = run({ bands });
    expect(spec.bands[2]!.type).toBe('bell');
    expect(spec.bands[7]!.slope).toBe(12);
    expect(corrections).toEqual([
      'fx.bands[2].type: "tilt" is not one of lowcut|lowshelf|bell|notch|highshelf|highcut — using bell',
      'fx.bands[7].slope: 18 is not one of 6|12|24|48 — using 12',
    ]);
  });

  it('fills a short band list from the defaults and truncates a long one, and reports both', () => {
    const lowcut: EqBand = { ...DEFAULT_EQ.bands[0]!, on: true, freq: 80 };
    const short = run({ bands: [lowcut] });
    expect(short.spec.bands).toEqual([lowcut, ...DEFAULT_EQ.bands.slice(1)]);
    expect(short.corrections).toEqual([
      'fx.bands: 1 bands for an 8-band EQ — filled from the defaults',
    ]);
    const long = run({ bands: [...DEFAULT_EQ.bands, lowcut, lowcut] });
    expect(long.spec.bands).toEqual(DEFAULT_EQ.bands);
    expect(long.corrections).toEqual(['fx.bands: 10 bands for an 8-band EQ — truncated']);
  });

  it('drops unknown keys, and replaces junk with defaults', () => {
    const bands: unknown[] = DEFAULT_EQ.bands.map((b) => ({ ...b }));
    bands[1] = { ...DEFAULT_EQ.bands[1], listen: true };
    bands[4] = 'bell';
    const { spec, corrections } = run({ enabled: 'yes', mode: 'stereo', bands });
    expect(spec).toEqual(DEFAULT_EQ);
    expect(corrections).toEqual([
      'fx.mode: unknown key dropped',
      'fx.enabled: "yes" is not a boolean — using true',
      'fx.bands[1].listen: unknown key dropped',
      'fx.bands[4]: "bell" is not an object — using defaults',
    ]);
    expect(run({ bands: 'flat' }).corrections).toEqual([
      'fx.bands: "flat" is not a list of bands — using defaults',
    ]);
  });
});
