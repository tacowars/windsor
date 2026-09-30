/**
 * The transfer curve (windsor#194 decision 7): drawn from the engine's
 * `outputStageCurve` on −24 to +6 dB, with the dot on the curve at the
 * louder input peak.
 */
import { describe, expect, it } from 'vitest';
import { OUTPUT_SOFT_CLIP } from '@windsor/engine';

import {
  curveX,
  curveY,
  transferDb,
  transferDot,
  transferLabel,
  transferPath,
} from './transferCurveModel';
import { TRANSFER_CURVE } from './masterColumnTables';
import { dbToAmplitude } from './meterModel';

const { minDb, maxDb, view } = TRANSFER_CURVE;

describe('the square', () => {
  it('maps −24 dB to the bottom left and +6 dB to the top right', () => {
    expect(curveX(minDb)).toBe(0);
    expect(curveX(maxDb)).toBe(view);
    expect(curveY(minDb)).toBe(view);
    expect(curveY(maxDb)).toBe(0);
    expect(curveX(-9)).toBe(view / 2);
    expect(curveX(-60)).toBe(0);
  });
});

describe('the curves', () => {
  it('is the identity in Off', () => {
    expect(transferDb('off', -1, 3)).toBeCloseTo(3, 9);
    expect(transferPath('off', -1).startsWith('M0.0 100.0')).toBe(true);
    expect(transferPath('off', -1).endsWith('L100.0 0.0')).toBe(true);
  });

  it('settles at the ceiling in Limiter and Hard clip', () => {
    for (const mode of ['limiter', 'hard'] as const) {
      expect(transferDb(mode, -1, -6)).toBeCloseTo(-6, 9);
      expect(transferDb(mode, -1, 4)).toBeCloseTo(-1, 9);
      expect(transferPath(mode, -1).endsWith(`L100.0 ${curveY(-1).toFixed(1)}`)).toBe(true);
    }
  });

  it('bends in Soft clip from the knee below the ceiling and stays under it', () => {
    const knee = -1 - OUTPUT_SOFT_CLIP.kneeDb;
    expect(transferDb('soft', -1, knee - 1)).toBeCloseTo(knee - 1, 9);
    expect(transferDb('soft', -1, knee + 3)).toBeLessThan(knee + 3);
    expect(transferDb('soft', -1, maxDb)).toBeLessThan(-1);
  });

  it('samples every half dB across the square', () => {
    const points = transferPath('hard', -1).split(/[ML]/).filter(Boolean);
    expect(points).toHaveLength((maxDb - minDb) / TRANSFER_CURVE.stepDb + 1);
  });
});

describe('the dot', () => {
  it('sits on the flat part for a hot input through the limiter', () => {
    expect(transferDot('limiter', -1, dbToAmplitude(3))).toEqual({
      x: curveX(3),
      y: curveY(-1),
    });
  });

  it('pins an input past +6 dB to the right edge', () => {
    expect(transferDot('off', -1, dbToAmplitude(12))).toEqual({ x: view, y: 0 });
  });

  it('hides below the square and at silence', () => {
    expect(transferDot('limiter', -1, dbToAmplitude(-30))).toBeNull();
    expect(transferDot('limiter', -1, 0)).toBeNull();
  });
});

describe('transferLabel', () => {
  it('names the mode and the ceiling', () => {
    expect(transferLabel('Limiter', 'limiter', -1)).toBe(
      'Transfer curve: Limiter, ceiling -1.0 dBFS',
    );
    expect(transferLabel('Off', 'off', -1)).toBe('Transfer curve: Off, no ceiling');
  });
});
