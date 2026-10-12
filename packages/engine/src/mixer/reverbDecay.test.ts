/**
 * The plate's Decay is an RT60 in seconds (windsor#748): the measured T30
 * lands on it whatever the Size and the tank diffusion, the converted spaces
 * ring as long as they did when Decay was a feedback gain, and the longest
 * corner of the box still dies away. The full sweep behind these points, and
 * the cases it reports without fitting, is in
 * `docs/research/2026-10-12-plate-decay-seconds/`.
 *
 * Each impulse waits half a second: a plate starts at Size 1 and glides to
 * the asked Size, and the T30 is read from the impulse on.
 */
import { describe, expect, it } from 'vitest';

import {
  channel,
  impulseAt,
  internals,
  loadReverb,
  noiseBurst,
  renderReverb,
  rmsAt,
  spaceParams,
  t30,
} from '../__fixtures__/reverbHarness';
import { REVERB_SPACE_RANGES } from '../audioConstants';
import { SPACE_ROWS } from '../__fixtures__/reverbSpaceFixtures';
import { DEFAULT_SPACE } from './reverbSpace';
import type { ReverbSpace } from './reverbSpace';

const loaded = loadReverb();
const BLOCK = 128;
/** Quanta at the asked Size before the impulse. */
const SETTLE = Math.round((0.5 * loaded.sampleRate) / BLOCK);
/** Damping open and modulation off: the conditions Decay is measured in. */
const OPEN = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, lowDecay: 1 };

/** The broadband T30 of an impulse into the plate at `params`, rendered for `seconds` after it. */
function measure(params: Partial<ReverbSpace>, seconds: number): number {
  const { samples } = renderReverb(loaded, seconds + 0.5, impulseAt(SETTLE), spaceParams(params), {
    collectSamples: true,
  });
  const from = SETTLE * BLOCK;
  return t30(channel(samples, 0, from), channel(samples, 1, from));
}

describe('Decay in seconds', () => {
  it.each([
    { size: 0.05, decay: 2, diffusionTank1: 0.8, diffusionTank2: 0.8 },
    { size: 1, decay: 5, diffusionTank1: 0, diffusionTank2: 0 },
    { size: 4, decay: 60, diffusionTank1: 0.8, diffusionTank2: 0 },
    // The top at the smallest Size, where the measured correction is largest.
    // At tank diffusion 2 of 0.8 this cell runs up to 11 % long, and at 44.1 kHz
    // up to 25 % short: the research note has the sweep.
    { size: 0.05, decay: 60, diffusionTank1: 0.8, diffusionTank2: 0 },
  ])(
    'measures a T30 within 10 % of Decay: %j',
    (space) => {
      const measured = measure({ ...OPEN, ...space }, 1.5 * space.decay + 3);
      expect(Math.abs(measured / space.decay - 1)).toBeLessThan(0.1);
    },
    60_000,
  );
});

/**
 * Each space's broadband T30 before windsor#748, when Decay was a feedback
 * gain: the impulse after half a second at the space's Size, 48 kHz. `wash`
 * is left out: at its old T30 of 31.4 s its 200 Hz tank low cut and 5 kHz
 * high cut leave it 26 % short, and tacowars ruled it gets no further tuning
 * (record `2026-10-12-plate-decay-in-seconds`).
 */
const BEFORE: Record<string, number> = {
  default: 3.366,
  plate: 1.24,
  room: 0.421,
  hall: 6.336,
  shimmer: 4.355,
  cathedral: 30.376,
};

describe('the converted spaces', () => {
  it.each(Object.keys(BEFORE))(
    '%s rings within 10 % of its old T30',
    (name) => {
      const space =
        name === 'default' ? DEFAULT_SPACE : SPACE_ROWS[name as keyof typeof SPACE_ROWS];
      const before = BEFORE[name]!;
      const measured = measure(
        { ...space, wet: 1, dry: 0 } as Partial<ReverbSpace>,
        2 * before + 2,
      );
      expect(Math.abs(measured / before - 1)).toBeLessThan(0.1);
    },
    60_000,
  );
});

describe('the longest corner', () => {
  /**
   * Every gain point, and the low band's gain at DC on it (the shelf's
   * largest), stays under 1 on every block: the all-passes and the damping
   * never gain, so no loop round the tank can either. At Size 0.05 the band's
   * 240 s is past what the tank can ring at all (its ceiling, 73.9 s), so its
   * correction is the table's largest: the closest the gains come to 1.
   */
  it.each(REVERB_SPACE_RANGES.size.slice().reverse())(
    'dies away: Decay 60 × lowDecay 4 at tank diffusion 0.8 and Size %f, after 3 × 240 s',
    (size) => {
      const longest = REVERB_SPACE_RANGES.decay[1] * REVERB_SPACE_RANGES.lowDecay[1];
      let largest = 0;
      const afterBlock = (_block: number, processor: Parameters<typeof internals>[0]): void => {
        const plate = internals(processor);
        for (let p = 0; p < plate._gain.length; p++) {
          largest = Math.max(largest, plate._gain[p]!, plate._gain[p]! + plate._lowExtra[p]!);
        }
      };
      const result = renderReverb(
        loaded,
        3 * longest + 1,
        noiseBurst(1),
        {
          decay: REVERB_SPACE_RANGES.decay[1],
          lowDecay: REVERB_SPACE_RANGES.lowDecay[1],
          lowCross: REVERB_SPACE_RANGES.lowCross[1],
          size,
          diffusionTank1: REVERB_SPACE_RANGES.diffusionTank1[1],
          diffusionTank2: REVERB_SPACE_RANGES.diffusionTank2[1],
          tankLowCut: 10,
          tankHighCut: 20000,
        },
        { afterBlock },
      );
      expect(largest).toBeLessThan(1);
      expect(result.nonFinite).toBe(0);
      const firstSecond = Math.max(...result.trace.slice(0, Math.round(loaded.sampleRate / BLOCK)));
      expect(rmsAt(result, 3 * longest)).toBeLessThan(firstSecond * 1e-3);
    },
    120_000,
  );
});
