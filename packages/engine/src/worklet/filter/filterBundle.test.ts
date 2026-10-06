/**
 * The Filter insert runs the voice's filter, not a copy (windsor#622
 * decision 1): the shipped bundle's output equals, to the bit, the same
 * noise through `Svf` / `tuneSvfSections` and `Ladder` / `tuneLadder`
 * imported here straight from `worklet/fm/`, in every mode and both slopes;
 * and no filter arithmetic lives under `worklet/filter/`.
 */
// reads-by-path: packages/engine/src/worklet/filter/**
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { filterNoise, filterParams, loadFilter, runFilter } from '../../__fixtures__/filterHarness';
import { FILTER_MODE_VOICE_IDS, FILTER_MODES } from '../../inserts/filterConstants';
import type { FilterMode } from '../../inserts/filterConstants';
import { CTRL_INTERVAL } from '../fm/fmConstants';
import { Ladder } from '../fm/ladder';
import { tuneLadder } from '../fm/ladderTune';
import { FILT_LADDER } from '../fm/modeIds';
import { Svf, tuneSvfSections } from '../fm/svf';

const RATE = 48000;
const QUANTA = 48;

/** One channel of `input` through the voice's own sections, tuned every `CTRL_INTERVAL` frames as the insert does. */
function reference(
  input: Float32Array,
  mode: FilterMode,
  slope24: boolean,
  cutoff: number,
  resonance: number,
): Float32Array {
  const id = FILTER_MODE_VOICE_IDS[FILTER_MODES.indexOf(mode)]!;
  const out = new Float32Array(input.length);
  const a = new Svf(),
    b = new Svf(),
    ladder = new Ladder();
  for (let s = 0; s < input.length; s++) {
    if (s % CTRL_INTERVAL === 0) {
      if (id === FILT_LADDER) {
        ladder.cutoffHz = cutoff;
        ladder.resonance = resonance;
        tuneLadder(ladder, RATE);
      } else {
        a.cutoffHz = cutoff;
        a.q = resonance;
        tuneSvfSections(a, b, slope24, RATE);
      }
    }
    if (id === FILT_LADDER) {
      ladder.point = input[s];
      ladder.process();
      out[s] = ladder.point;
    } else {
      let y = a.process(input[s], id);
      if (slope24) y = b.process(y, id);
      out[s] = y;
    }
  }
  return out;
}

/** `quanta` of noise's channels joined end to end. */
const joined = (noise: Float32Array[][], channel: number): Float32Array => {
  const out = new Float32Array(noise.length * 128);
  noise.forEach((quantum, q) => out.set(quantum[channel]!, q * 128));
  return out;
};

describe('the Filter bundle against the voice filter', () => {
  const noise = filterNoise(QUANTA);
  const cases = FILTER_MODES.flatMap((mode) =>
    [false, true].map((slope24) => ({
      mode,
      slope24,
      cutoff: mode === 'acid' ? 900 : 1500,
      resonance: mode === 'acid' ? 7 : 4,
    })),
  );
  it.each(cases)('$mode, 24 dB $slope24: the same bits', ({ mode, slope24, cutoff, resonance }) => {
    const params = filterParams({ mode, slope24, cutoff, resonance });
    const [left, right] = runFilter(loadFilter(RATE, params), noise, params);
    expect(left).toEqual(reference(joined(noise, 0), mode, slope24, cutoff, resonance));
    expect(right).toEqual(reference(joined(noise, 1), mode, slope24, cutoff, resonance));
    // And the filter did something: the output is not the input.
    expect(left).not.toEqual(joined(noise, 0));
  });
});

describe('worklet/filter/ holds no filter of its own', () => {
  const dir = new URL('./', import.meta.url);
  const sources = readdirSync(dir)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => [file, readFileSync(new URL(file, dir), 'utf8')] as const);

  it('imports the voice filter and its tuning from fm/', () => {
    const dsp = sources.find(([file]) => file === 'filterDsp.ts')![1];
    expect(dsp).toContain("import { Ladder } from '../fm/ladder';");
    expect(dsp).toContain("import { tuneLadder } from '../fm/ladderTune';");
    expect(dsp).toContain("import { Svf, tuneSvfSections } from '../fm/svf';");
  });

  it.each([
    ['a TPT step', /\bic[12]\b|\ba[123]\b\s*\*/],
    ['a prewarp', /Math\.tan|tanInPlace/],
    ['a ladder solve or saturator', /satIn|saturate|Jacobian|LADDER_/],
    ['a Reso curve or makeup', /log2InPlace|exp2InPlace|makeup|1 \/ Math\.max/],
  ])('has no %s', (_, pattern) => {
    for (const [file, text] of sources) expect(text, file).not.toMatch(pattern);
  });
});
