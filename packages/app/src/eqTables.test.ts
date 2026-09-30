/**
 * The Parametric EQ card's tables state no engine rule again (windsor#199):
 * every knob spans the engine's `EQ_BOUNDS` and resets to `DEFAULT_EQ`, every
 * band type has a name, a glyph and a role, and the plot's grid lies inside
 * the engine's frequency range.
 */
import { describe, expect, it } from 'vitest';

import { DEFAULT_EQ, EQ_BAND_TYPES, EQ_BOUNDS, INSERT_KINDS } from '@windsor/engine';
import {
  EQ_DEFAULT_VIEW,
  EQ_GLOBAL_KNOBS,
  EQ_GRID_DB,
  EQ_GRID_HZ,
  EQ_GRID_LABELS,
  EQ_RANGES,
  EQ_TYPE_GLYPHS,
  EQ_TYPE_LABELS,
  EQ_TYPE_ROLE,
  eqBandKnob,
} from './eqTables';

describe('the EQ knobs', () => {
  it("span the engine's bounds for every band field, and reset to that band's default", () => {
    DEFAULT_EQ.bands.forEach((band, i) => {
      for (const field of ['freq', 'gain', 'q'] as const) {
        const knob = eqBandKnob(field, i);
        expect([knob.min, knob.max], `${field} ${i}`).toEqual([...EQ_BOUNDS[field]]);
        expect(knob.def, `${field} ${i}`).toBe(band[field]);
      }
    });
    expect(eqBandKnob('freq', 0).curve).toBe('log');
    expect(eqBandKnob('q', 0).curve).toBe('log');
  });

  it("cover Scale and Output with the engine's bounds and DEFAULT_EQ's values", () => {
    const fields = INSERT_KINDS.eq.fields.filter((f) => !['kind', 'enabled', 'bands'].includes(f));
    expect(EQ_GLOBAL_KNOBS.map((k) => k.f).sort()).toEqual([...fields].sort());
    for (const { f, o } of EQ_GLOBAL_KNOBS) {
      expect([o.min, o.max], f).toEqual([...EQ_BOUNDS[f as 'scale' | 'output']]);
      expect(o.def, f).toBe(DEFAULT_EQ[f as 'scale' | 'output']);
    }
    expect(EQ_GLOBAL_KNOBS[0]!.o.fmt?.(1.5)).toBe('150%');
  });
});

describe('the band types', () => {
  it('each has a name, a glyph and a role, and no other type does', () => {
    for (const table of [EQ_TYPE_LABELS, EQ_TYPE_GLYPHS, EQ_TYPE_ROLE])
      expect(Object.keys(table).sort()).toEqual([...EQ_BAND_TYPES].sort());
  });

  it('read the height as gain for the bell and shelves, Q for the cuts', () => {
    expect(EQ_BAND_TYPES.filter((t) => EQ_TYPE_ROLE[t] === 'gain').sort()).toEqual([
      'bell',
      'highshelf',
      'lowshelf',
    ]);
    expect(EQ_BAND_TYPES.filter((t) => EQ_TYPE_ROLE[t] === 'cut').sort()).toEqual([
      'highcut',
      'lowcut',
    ]);
  });
});

describe('the plot', () => {
  it('draws its grid inside the frequency range, labelling only lines it draws', () => {
    for (const hz of EQ_GRID_HZ) {
      expect(hz).toBeGreaterThan(EQ_BOUNDS.freq[0]);
      expect(hz).toBeLessThan(EQ_BOUNDS.freq[1]);
    }
    for (const hz of EQ_GRID_LABELS.keys()) expect(EQ_GRID_HZ).toContain(hz);
  });

  it('views ±12 or ±24 dB, each grid step dividing its range', () => {
    expect([...EQ_RANGES]).toEqual([12, 24]);
    for (const range of EQ_RANGES) expect(range % EQ_GRID_DB[range]).toBe(0);
  });

  it('starts on a band the EQ has, in a range it offers', () => {
    expect(EQ_DEFAULT_VIEW.band).toBeLessThan(DEFAULT_EQ.bands.length);
    expect(EQ_RANGES).toContain(EQ_DEFAULT_VIEW.range);
  });
});
