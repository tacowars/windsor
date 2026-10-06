/**
 * The Filter insert's bundle beyond its filter (windsor#622 decisions 4–6):
 * the bypass and the mix's ends to the bit, the sweep's glide, the resets on
 * a mode change and a re-enable (at the start of the switch's fade-in,
 * windsor#630), and the rest on silence. That the filter
 * itself is the voice's, bit for bit, is `worklet/filter/filterBundle.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { filterNoise, filterParams, loadFilter, runFilter } from '../__fixtures__/filterHarness';
import type { FilterProcessorLike } from '../__fixtures__/filterHarness';
import { FILTER_MODES } from './filterConstants';
import { INSERT_SWITCH_FADE_S } from './insertConstants';
import type { FilterSpec } from './filterSpec';

const joined = (noise: Float32Array[][], channel: number): Float32Array => {
  const out = new Float32Array(noise.length * 128);
  noise.forEach((quantum, q) => out.set(quantum[channel]!, q * 128));
  return out;
};

/** `spec`'s params written into `params` in place, as the stage's writes reach the processor. */
function write(params: Record<string, Float32Array>, spec: Partial<FilterSpec>): void {
  for (const [key, value] of Object.entries(filterParams(spec))) params[key]![0] = value[0]!;
}

/** The cutoff each `setCoeffs` on the left `svfA` was handed, from now on. */
function watchTuning(processor: FilterProcessorLike): number[] {
  const seen: number[] = [];
  const section = processor.dsp.svfA[0]!;
  const tune = section.setCoeffs.bind(section);
  section.setCoeffs = (rate: number): void => {
    seen.push(section.cutoffHz);
    tune(rate);
  };
  return seen;
}

describe('the Filter insert, around its filter', () => {
  const noise = filterNoise(24);

  it('copies the input to the bit when off, and at Mix 0', () => {
    for (const spec of [{ enabled: false }, { mix: 0 }, { mix: 0, mode: 'acid' as const }]) {
      const params = filterParams({ cutoff: 300, resonance: 8, ...spec });
      const [left, right] = runFilter(loadFilter(48000, params), noise, params);
      expect(left).toEqual(joined(noise, 0));
      expect(right).toEqual(joined(noise, 1));
    }
  });

  it('mixes the dry and the wet signal in between', () => {
    const wetParams = filterParams({ cutoff: 400 });
    const [wet] = runFilter(loadFilter(48000, wetParams), noise, wetParams);
    const halfParams = filterParams({ cutoff: 400, mix: 0.25 });
    const [half] = runFilter(loadFilter(48000, halfParams), noise, halfParams);
    const dry = joined(noise, 0);
    for (let i = 0; i < dry.length; i += 37)
      expect(half[i]).toBeCloseTo(0.75 * dry[i]! + 0.25 * wet[i]!, 6);
  });

  it('snaps the first quantum, then glides a step over the next four pieces', () => {
    const params = filterParams({ cutoff: 200 });
    const processor = loadFilter(48000, params);
    const seen = watchTuning(processor);
    runFilter(processor, noise.slice(0, 1), params);
    expect(seen.map((hz) => Math.fround(hz))).toEqual([200, 200, 200, 200]);
    write(params, { cutoff: 8000 });
    runFilter(processor, noise.slice(1, 2), params);
    const ratio = 40 ** 0.25;
    expect(seen.length).toBe(8);
    seen.slice(4, 7).forEach((hz, j) => expect(hz).toBeCloseTo(200 * ratio ** (j + 1), 6));
    expect(seen[7]).toBe(8000);
    runFilter(processor, noise.slice(2, 3), params);
    expect(seen.slice(8)).toEqual([8000, 8000, 8000, 8000]);
  });

  it.each([
    ['lowpass', 'highpass'],
    ['lowpass', 'acid'],
    ['acid', 'bandpass'],
    ['notch', 'notch'],
  ] as const)('starts %s → %s from rest, as a fresh filter would', (from, to) => {
    const before = noise.slice(0, 8),
      after = noise.slice(8);
    const params = filterParams({ mode: from, cutoff: 700, resonance: 5 });
    const processor = loadFilter(48000, params);
    // Through `to` and back, so the incoming path has run and must be reset.
    runFilter(processor, before.slice(0, 4), params);
    write(params, { mode: to, cutoff: 700, resonance: 5 });
    runFilter(processor, before.slice(4, 6), params);
    write(params, { mode: from, cutoff: 700, resonance: 5, slope24: from === to });
    runFilter(processor, before.slice(6), params);
    write(params, { mode: to, cutoff: 700, resonance: 5 });
    const switched = runFilter(processor, after, params);
    const freshParams = filterParams({ mode: to, cutoff: 700, resonance: 5 });
    expect(switched).toEqual(runFilter(loadFilter(48000, freshParams), after, freshParams));
  });

  it('starts from rest when turned back on, fading in over the switch', () => {
    const params = filterParams({ cutoff: 500, resonance: 6, slope24: true });
    const processor = loadFilter(48000, params);
    runFilter(processor, noise.slice(0, 6), params);
    write(params, { cutoff: 500, resonance: 6, slope24: true, enabled: false });
    runFilter(processor, noise.slice(6, 8), params);
    write(params, { cutoff: 500, resonance: 6, slope24: true });
    const fresh = filterParams({ cutoff: 500, resonance: 6, slope24: true });
    const after = noise.slice(8);
    const [left, right] = runFilter(processor, after, params);
    const [freshLeft, freshRight] = runFilter(loadFilter(48000, fresh), after, fresh);
    // The fade-in: a fresh filter's output, crossfaded linearly from the dry.
    const fade = INSERT_SWITCH_FADE_S * 48000;
    const dry = joined(after, 0);
    for (let s = 0; s < fade; s++) {
      const g = (s + 1) / fade;
      expect(left[s]).toBeCloseTo(dry[s]! + g * (freshLeft[s]! - dry[s]!), 6);
    }
    // Then the fresh filter's output to the bit.
    expect(left.subarray(fade)).toEqual(freshLeft.subarray(fade));
    expect(right.subarray(fade)).toEqual(freshRight.subarray(fade));
  });

  it('turns round mid fade-out with the states it has', () => {
    const params = filterParams({ cutoff: 500, resonance: 6 });
    const processor = loadFilter(48000, params);
    runFilter(processor, noise.slice(0, 6), params);
    write(params, { cutoff: 500, resonance: 6, enabled: false });
    runFilter(processor, noise.slice(6, 7), params);
    write(params, { cutoff: 500, resonance: 6 });
    const [left] = runFilter(processor, noise.slice(7), params);
    const steady = filterParams({ cutoff: 500, resonance: 6 });
    const [never] = runFilter(loadFilter(48000, steady), noise, steady);
    // Back to the never-switched filter once the fade has climbed back: no reset happened.
    expect(left.subarray(128)).toEqual(never.subarray(8 * 128));
  });

  it.each(FILTER_MODES)('%s: rests on silence once its states settle, and writes zeros', (mode) => {
    const silent = [[new Float32Array(128), new Float32Array(128)]];
    const params = filterParams({ mode, cutoff: 2000, resonance: 3, slope24: true });
    const processor = loadFilter(48000, params);
    runFilter(processor, silent, params);
    expect(processor.dsp.resting, 'silent from the start').toBe(true);
    runFilter(processor, noise.slice(0, 4), params);
    expect(processor.dsp.resting).toBe(false);
    let quanta = 0;
    while (!processor.dsp.resting && quanta < 2000) {
      runFilter(processor, silent, params);
      quanta++;
    }
    expect(processor.dsp.resting, `rests within ${quanta} quanta`).toBe(true);
    const [left, right] = runFilter(processor, silent, params);
    expect(processor.dsp.resting).toBe(true);
    expect([...left, ...right].every((x) => x === 0)).toBe(true);
    runFilter(processor, noise.slice(4, 5), params);
    expect(processor.dsp.resting, 'wakes on input').toBe(false);
  });
});
