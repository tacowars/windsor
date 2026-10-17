/**
 * Spectre's input modulations on the shipped bundle (record
 * `2026-10-16-spectre-insert`), with the curves transparent so only the
 * algorithm is heard: each is transparent at its null setting and changes
 * the signal at a strong one; shift moves a tone up the bands; smudge plays
 * the frames it keeps, Position × Span back; and every algorithm renders the
 * same bits twice from its seed.
 */
import { describe, expect, it } from 'vitest';
import {
  SPECTRE_TRANSPARENT,
  loadSpectre,
  runSpectre,
  spectreParams,
} from '../__fixtures__/spectreHarness';
import { SPECTRE_MODS } from './spectreConstants';
import type { SpectreMod } from './spectreConstants';
import type { SpectreSpec } from './spectreSpec';

const RATE = 48000;
const FRAMES = RATE / 2;

function noise(frames: number): Float32Array {
  let seed = 7;
  return Float32Array.from({ length: frames }, () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return 0.6 * (seed / 2 ** 32 - 0.5);
  });
}

function render(
  spec: Partial<SpectreSpec>,
  input: Float32Array,
): { out: Float32Array; latency: number } {
  const params = spectreParams({ ...SPECTRE_TRANSPARENT, ...spec });
  const processor = loadSpectre(RATE, params);
  const out = runSpectre(processor, [input, input], params).left;
  return { out, latency: processor.dsp.latency };
}

/** The largest |out[i] − input[i − latency − frames]| past the first second's quarter. */
function late(out: Float32Array, input: Float32Array, latency: number, frames = 0): number {
  let most = 0;
  for (let i = FRAMES / 4; i < out.length; i++)
    most = Math.max(most, Math.abs(out[i]! - (input[i - latency - frames] ?? 0)));
  return most;
}

/** Each algorithm's amounts that leave it transparent, and amounts that are heard. */
const SETTINGS: Record<
  Exclude<SpectreMod, 'off'>,
  [[number, number, number], [number, number, number]]
> = {
  blur: [
    [0, 0.5, 0],
    [1, 0.8, 0.5],
  ],
  holes: [
    [0, 1, 0.5],
    [1, 1, 0.2],
  ],
  invert: [
    [0.5, 0, 0],
    [0.8, 1, 0],
  ],
  shift: [
    [0.5, 0, 0],
    [0.7, 0, 0],
  ],
  comb: [
    [0, 0.5, 0],
    [1, 0.3, 0],
  ],
  gate: [
    [0.5, 0, 0],
    [0.9, 1, 0],
  ],
  pulse: [
    [0, 1, 0],
    [0.5, 0.3, 0.6],
  ],
  scatter: [
    [0.5, 0, 0],
    [0.6, 0.8, 0],
  ],
  phase: [
    [0, 1, 0],
    [1, 1, 0],
  ],
  swell: [
    [0, 0.5, 0.5],
    [1, 0.5, 0.5],
  ],
  smudge: [
    [0, 0.5, 0],
    [1, 0.5, 0],
  ],
};

describe('Spectre’s input modulations', () => {
  const input = noise(FRAMES);

  it.each(SPECTRE_MODS.filter((mod) => mod !== 'off'))(
    '%s is transparent at its null setting and heard at a strong one',
    (name) => {
      const mod = name as Exclude<SpectreMod, 'off'>;
      const [still, strong] = SETTINGS[mod];
      const [a, b, c] = still;
      const quiet = render({ mod, modA: a, modB: b, modC: c }, input);
      expect(late(quiet.out, input, quiet.latency)).toBeLessThan(1e-5);
      const [sa, sb, sc] = strong;
      const loud = render({ mod, modA: sa, modB: sb, modC: sc }, input);
      expect(late(loud.out, input, loud.latency)).toBeGreaterThan(0.05);
      const again = render({ mod, modA: sa, modB: sb, modC: sc }, input);
      expect(again.out).toEqual(loud.out);
    },
  );

  it('shift moves a tone up the bands', () => {
    const hz = 1500;
    const sine = Float32Array.from(
      { length: FRAMES },
      (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE),
    );
    // A tenth of the quarter of the bands each way: 0.6 is up a fifth of a quarter of 513 bands.
    const { out } = render({ mod: 'shift', modA: 0.6 }, sine);
    const shift = Math.round(0.1 * 2 * 0.25 * 513);
    const binHz = RATE / 1024;
    const power = (f: number): number => {
      let re = 0,
        im = 0;
      for (let i = FRAMES / 2; i < FRAMES; i++) {
        re += out[i]! * Math.cos((2 * Math.PI * f * i) / RATE);
        im += out[i]! * Math.sin((2 * Math.PI * f * i) / RATE);
      }
      return re * re + im * im;
    };
    expect(power(hz + shift * binHz)).toBeGreaterThan(100 * power(hz));
  });

  it('smudge plays its kept frames, Position × Span back', () => {
    const { out, latency } = render({ mod: 'smudge', modA: 0.5, modB: 0.5 }, input);
    // Span 2 + round(0.5 × 62) = 33 frames, back round(0.5 × 32) = 16 of them, a hop of 512.
    expect(late(out, input, latency, 16 * 512)).toBeLessThan(1e-5);
  });
});
