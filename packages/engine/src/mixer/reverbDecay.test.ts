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
  loadReverb,
  noiseBurst,
  renderReverb,
  rmsAt,
  t30,
} from '../__fixtures__/reverbHarness';
import { REVERB_SPACE_RANGES } from '../audioConstants';
import { DEFAULT_SPACE, SPACES } from './reverbSpace';
import type { ReverbSpace } from './reverbSpace';

const loaded = loadReverb();
const BLOCK = 128;
/** Quanta at the asked Size before the impulse. */
const SETTLE = Math.round((0.5 * loaded.sampleRate) / BLOCK);
/** Damping open and modulation off: the conditions Decay is measured in. */
const OPEN = { tankLowCut: 10, tankHighCut: 20000, modDepth: 0, lowDecay: 1 };

/** The broadband T30 of an impulse into the plate at `params`, rendered for `seconds` after it. */
function measure(params: Partial<ReverbSpace>, seconds: number): number {
  const { samples } = renderReverb(loaded, seconds + 0.5, impulseAt(SETTLE), params, {
    collectSamples: true,
  });
  const from = SETTLE * BLOCK;
  return t30(channel(samples, 0, from), channel(samples, 1, from));
}

describe('Decay in seconds', () => {
  it.each([
    { size: 0.05, decay: 2, diffusionTank1: 0.8, diffusionTank2: 0.8 },
    { size: 1, decay: 5, diffusionTank1: 0, diffusionTank2: 0 },
    { size: 4, decay: 20, diffusionTank1: 0.8, diffusionTank2: 0 },
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
 * gain: the impulse after half a second at the space's Size, 48 kHz.
 */
const BEFORE: Record<string, number> = {
  default: 3.366,
  plate: 1.24,
  room: 0.421,
  hall: 6.336,
  shimmer: 4.355,
};

describe('the converted spaces', () => {
  it.each(Object.keys(BEFORE))(
    '%s rings within 10 % of its old T30',
    (name) => {
      const space = name === 'default' ? DEFAULT_SPACE : SPACES[name as keyof typeof SPACES];
      const before = BEFORE[name]!;
      const measured = measure(
        { ...space, wet: 1, dry: 0 } as Partial<ReverbSpace>,
        2 * before + 2,
      );
      expect(Math.abs(measured / before - 1)).toBeLessThan(0.1);
    },
    60_000,
  );

  it('holds cathedral and wash, which rang about 30 s, at the 20 s ceiling', () => {
    expect(SPACES.cathedral.decay).toBe(REVERB_SPACE_RANGES.decay[1]);
    expect(SPACES.wash.decay).toBe(REVERB_SPACE_RANGES.decay[1]);
  });
});

describe('the longest corner', () => {
  it('dies away: Decay 20 × lowDecay 4 at tank diffusion 0.8 and Size 4, after 3 × 80 s', () => {
    const longest = REVERB_SPACE_RANGES.decay[1] * REVERB_SPACE_RANGES.lowDecay[1];
    const result = renderReverb(loaded, 3 * longest + 1, noiseBurst(1), {
      decay: REVERB_SPACE_RANGES.decay[1],
      lowDecay: REVERB_SPACE_RANGES.lowDecay[1],
      lowCross: REVERB_SPACE_RANGES.lowCross[1],
      size: REVERB_SPACE_RANGES.size[1],
      diffusionTank1: REVERB_SPACE_RANGES.diffusionTank1[1],
      diffusionTank2: REVERB_SPACE_RANGES.diffusionTank2[1],
      tankLowCut: 10,
      tankHighCut: 20000,
    });
    expect(result.nonFinite).toBe(0);
    const firstSecond = Math.max(...result.trace.slice(0, Math.round(loaded.sampleRate / BLOCK)));
    expect(rmsAt(result, 3 * longest)).toBeLessThan(firstSecond * 1e-3);
  }, 120_000);
});
