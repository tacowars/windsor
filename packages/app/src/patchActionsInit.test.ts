/**
 * Init's starting patch (windsor#844): every operator's decay and release
 * curves start at -0.5 over the engine's +0.5 default, and the rest of
 * Init's overrides hold.
 */
import { describe, expect, it } from 'vitest';

import { makePatch } from '@windsor/engine';
import { initPatchDefaults } from './patchActions';

describe('initPatchDefaults', () => {
  it('starts all four operators decay and release curves at -0.5', () => {
    const init = initPatchDefaults();
    expect(init.ops.map((op) => [op.env.decayCurve, op.env.releaseCurve])).toEqual(
      Array(4).fill([-0.5, -0.5]),
    );
  });

  it('keeps operator 1, the filter and pitch envelopes and the volume as they were', () => {
    const init = initPatchDefaults();
    expect(init.ops[0]).toMatchObject({
      phaseFree: false,
      env: { attackTime: 0.004466565172673648 },
    });
    expect(init.filter.env).toEqual({ ...makePatch().filter.env, attackTime: 0 });
    expect(init.pitchEnv).toEqual(makePatch().pitchEnv);
    expect(init.volume).toBe(0.2296977796052631);
  });

  it('leaves the engine default curves at +0.5', () => {
    expect(makePatch().ops.map((op) => [op.env.decayCurve, op.env.releaseCurve])).toEqual(
      Array(4).fill([0.5, 0.5]),
    );
  });
});
