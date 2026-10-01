/**
 * Switching an operator to Pulse (windsor#56 decision 2). At the default width
 * 1 a Pulse's two saws cancel to silence, so the picker seeds a square the
 * way it seeds a User wave's partials; a width already moved is kept. And
 * which operators show the noise colour knobs (windsor#362): Noise only.
 */
import { describe, expect, it } from 'vitest';

import type { Operator } from '@windsor/engine';
import { WAVE, makePatch } from '@windsor/engine';
import { ensurePulseWidth, showsNoiseColour } from './patchBays';
import { PULSE_START_WIDTH } from './patchPanelConstants';

function opOf(ops: Operator[], i: number): Operator {
  const target = ops[i];
  if (!target) throw new Error(`no operator ${i}`);
  return target;
}

describe('ensurePulseWidth', () => {
  it('seeds PULSE_START_WIDTH, a square, on an operator switched to Pulse at width 1', () => {
    const patch = makePatch();
    const target = opOf(patch.ops, 1);
    target.wave = WAVE.PULSE;
    ensurePulseWidth(patch, 1);
    expect(target.width).toBe(PULSE_START_WIDTH);
  });

  it('seeds the width it is handed in place of the shipped one', () => {
    const patch = makePatch();
    const target = opOf(patch.ops, 2);
    target.wave = WAVE.PULSE;
    ensurePulseWidth(patch, 2, 0.25);
    expect(target.width).toBe(0.25);
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
    expect(target.width).toBe(PULSE_START_WIDTH);
  });
});

describe('showsNoiseColour (windsor#362)', () => {
  it('shows Noise LP and Noise HP on a Noise operator only', () => {
    const patch = makePatch();
    expect([0, 1, 2, 3].map((i) => showsNoiseColour(patch, i))).toEqual([
      false,
      false,
      false,
      false,
    ]);
    for (const [name, wave] of Object.entries(WAVE)) {
      opOf(patch.ops, 2).wave = wave;
      expect(showsNoiseColour(patch, 2), name).toBe(wave === WAVE.NOISE);
    }
    expect(showsNoiseColour(patch, 4)).toBe(false);
  });
});
