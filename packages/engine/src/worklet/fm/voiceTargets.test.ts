/**
 * The patch laid out by target code (windsor#419): every code holds the
 * value at its row's path, read as it is.
 */
import { describe, expect, it } from 'vitest';

import { normalisePatch } from './patchNormalise';
import { VOICE_TARGET_COUNT, VOICE_TARGET_PATHS } from './voiceTargetTables';
import { layoutVoiceTargets } from './voiceTargets';

/** The value at a dotted path. */
function at(patch: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((node, key) => (node as Record<string, unknown>)[key], patch);
}

describe('layoutVoiceTargets', () => {
  it("writes each row's patch value at its code", () => {
    // A distinct value per field, so a crossed code shows.
    let n = 0;
    const next = (): number => 0.01 + n++ * 0.007;
    const op = () => ({
      level: next(),
      feedback: next(),
      width: 0.05 + next(),
      env: { decayTime: next(), decayCurve: next() },
    });
    const patch = normalisePatch({
      filter: {
        cutoff: 1234,
        envAmount: next(),
        resonance: 1 + next(),
        vowel: 2.5,
        env: { decayTime: next(), decayCurve: 0 },
      },
      ops: [op(), op(), op(), op()],
      lfo: { amount: next(), rate: 3.3 },
      lfo2: { amount: next(), rate: 7.7 },
      pitchEnvAmount: -12.5,
    } as never);
    const out = new Float64Array(VOICE_TARGET_COUNT).fill(Number.NaN);
    layoutVoiceTargets(patch, out);
    VOICE_TARGET_PATHS.forEach((path, k) => {
      expect(out[k], path).toBe(at(patch, path));
    });
    expect(new Set(out).size).toBe(VOICE_TARGET_COUNT);
  });
});
