import { describe, expect, it } from 'vitest';
import { DEFAULT_TRANSIENT, INSERT_KINDS, TRANSIENT_BOUNDS } from '@windsor/engine';
import { EMPTY_METER_WINDOW, meterKey, meterShare, stepMeterWindow } from './transientMeterModel';
import { fmtPercent, fmtSignedDb, TRANSIENT_KNOBS } from './transientTables';

describe('the Transient card’s knobs', () => {
  it('covers every setting on the engine’s bounds and defaults', () => {
    const fields = ['kind', 'enabled', ...TRANSIENT_KNOBS.map((k) => k.f)];
    expect(fields.sort()).toEqual([...INSERT_KINDS.transient.fields].sort());
    for (const { f, o } of TRANSIENT_KNOBS) {
      expect(o.def, f).toBe(DEFAULT_TRANSIENT[f]);
      expect([o.min, o.max], f).toEqual(TRANSIENT_BOUNDS[f as keyof typeof TRANSIENT_BOUNDS]);
    }
  });

  it('reads signed dB with its unit, and Mix in percent', () => {
    expect(fmtSignedDb(3)).toBe('+3.0 dB');
    expect(fmtSignedDb(-24)).toBe('-24.0 dB');
    expect(fmtSignedDb(0)).toBe('0.0 dB');
    expect(fmtSignedDb(-0.04)).toBe('0.0 dB');
    expect(fmtPercent(1)).toBe('100%');
    expect(fmtPercent(0.255)).toBe('26%');
  });
});

describe('the Transient meter model', () => {
  it('fills each half by its share of ±24 dB, held at the ends', () => {
    expect(meterShare(12)).toBe(0.5);
    expect(meterShare(-6)).toBe(0.25);
    expect(meterShare(39)).toBe(1);
    expect(meterShare(0)).toBe(0);
  });

  it('keys two readings alike only when they draw alike', () => {
    expect(meterKey({ boost: 3.01, cut: -2 })).toBe(meterKey({ boost: 2.99, cut: -2.04 }));
    expect(meterKey({ boost: 3, cut: 0 })).not.toBe(meterKey({ boost: 0, cut: -3 }));
    expect(meterKey({ boost: 0, cut: 0 })).toBe(0);
  });

  it('holds each window’s largest boost and cut, shown when the next window opens', () => {
    let step = stepMeterWindow(EMPTY_METER_WINDOW, { boost: 4, cut: -1 }, 10);
    expect(step.shown).toBeNull();
    step = stepMeterWindow(step.window, { boost: 9, cut: 0 }, 200);
    step = stepMeterWindow(step.window, { boost: 2, cut: -12 }, 400);
    expect(step.shown).toBeNull();
    step = stepMeterWindow(step.window, { boost: 1, cut: 0 }, 600);
    expect(step.shown).toEqual({ boost: 9, cut: -12 });
    expect(step.window).toEqual({ index: 1, boost: 1, cut: 0 });
  });
});
