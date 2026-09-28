/**
 * Switching an operator to Pulse (windsor#56 decision 2). At the default width
 * 1 a Pulse's two saws cancel to silence, so the picker seeds a square the
 * way it seeds a User wave's partials; a width already moved is kept.
 */
import { describe, expect, it } from 'vitest';

import type { Operator } from '@windsor/engine';
import { WAVE, makePatch } from '@windsor/engine';
import { ensurePulseWidth } from './patchBays';

function opOf(ops: Operator[], i: number): Operator {
  const target = ops[i];
  if (!target) throw new Error(`no operator ${i}`);
  return target;
}

describe('ensurePulseWidth', () => {
  it('seeds 0.5 on an operator switched to Pulse at width 1', () => {
    const patch = makePatch();
    const target = opOf(patch.ops, 1);
    target.wave = WAVE.PULSE;
    ensurePulseWidth(patch, 1);
    expect(target.width).toBe(0.5);
  });

  it('keeps a width already moved', () => {
    const patch = makePatch();
    const target = opOf(patch.ops, 0);
    target.width = 0.3;
    target.wave = WAVE.PULSE;
    ensurePulseWidth(patch, 0);
    expect(target.width).toBe(0.3);
  });

  it('leaves width alone on any other wave, and when switching away from Pulse', () => {
    const patch = makePatch();
    const target = opOf(patch.ops, 0);
    target.wave = WAVE.SAW;
    ensurePulseWidth(patch, 0);
    expect(target.width).toBe(1);
    target.wave = WAVE.PULSE;
    ensurePulseWidth(patch, 0);
    target.wave = WAVE.SINE;
    ensurePulseWidth(patch, 0);
    expect(target.width).toBe(0.5);
  });
});
