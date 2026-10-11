/**
 * The envelope readout (windsor#708 decision 4): the offset a value pushes,
 * worked through the voice target's row as the engine applies it (`value ×
 * span`), on a ratio row, an add row with and without units, and a macro
 * row; and where the drag readout sits.
 */
import { describe, expect, it } from 'vitest';

import type { RollEnvelope } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { dragReading, envelopeOffsetText } from './rollEnvelopeReadout';

const BAR = TICKS_PER_BAR;

describe('the offset an envelope value reads as', () => {
  it('reads octaves on a ratio row: Cutoff spans 4.5', () => {
    expect(envelopeOffsetText('filter.cutoff', 1 / 6)).toBe('+0.75 oct');
    expect(envelopeOffsetText('filter.cutoff', -1)).toBe('-4.50 oct');
    expect(envelopeOffsetText('filter.cutoff', 0)).toBe('+0.00 oct');
  });

  it("reads the target's own units on an add row, one decimal from 10 up", () => {
    expect(envelopeOffsetText('pitchEnvAmount', 0.5)).toBe('+24.0 st');
    expect(envelopeOffsetText('filter.envAmount', 0.25)).toBe('+1.50 oct');
    expect(envelopeOffsetText('filter.resonance', -0.25)).toBe('-1.50');
  });

  it("reads a macro's value as a plain signed offset", () => {
    expect(envelopeOffsetText('macros.0.value', 0.5)).toBe('+0.50');
    expect(envelopeOffsetText('macros.0.value', -0.0001)).toBe('+0.00');
  });
});

describe('the drag readout', () => {
  const envelope: RollEnvelope = {
    target: 'filter.cutoff',
    on: true,
    points: [
      { tick: 0, value: -1, bend: 0 },
      { tick: BAR, value: 1, bend: 0 },
    ],
  };
  const start = envelope.points;

  it('sits on the point a drag moves', () => {
    const draft = [start[0]!, { tick: BAR / 2, value: 0.5, bend: 0 }];
    expect(dragReading(envelope, { start, draft }, 3 * BAR, 2 * BAR)).toEqual({
      tick: BAR / 2,
      value: 0.5,
    });
  });

  it('else reads the curve under the pointer, inside the loop', () => {
    expect(dragReading(envelope, { start, draft: start }, BAR / 2, 2 * BAR)).toEqual({
      tick: BAR / 2,
      value: 0,
    });
    expect(dragReading(envelope, { start, draft: start }, 5 * BAR, 2 * BAR).tick).toBe(2 * BAR - 1);
  });
});
