/**
 * The insert-card registry covers the engine's insert kinds (#641), as
 * `SEQUENCER_CARDS` covers the sequencer kinds: a kind added to
 * `INSERT_KINDS` without a card, a label or knobs would be an insert the
 * Mixer tab can add and not show. That fails here, and the registry carries
 * no entry the engine does not declare.
 */
import { describe, expect, it } from 'vitest';

import {
  CHORUS_DEPTH_MAX_MS,
  CHORUS_DEPTH_MIN_MS,
  CHORUS_RATE_MAX_HZ,
  CHORUS_RATE_MIN_HZ,
  DEFAULT_CHORUS,
  DEFAULT_DRIVE,
  DEFAULT_ECHO,
  DEFAULT_ENSEMBLE,
  DEFAULT_EQ,
  DEFAULT_FILTER,
  DEFAULT_PLATE_REVERB,
  DRIVE_GAIN_MAX_DB,
  DRIVE_GAIN_MIN_DB,
  DRIVE_TONE_MAX_HZ,
  DRIVE_TONE_MIN_HZ,
  ECHO_BOUNDS,
  ENSEMBLE_BOUNDS,
  FILTER_BOUNDS,
  INSERT_KINDS,
  INSERT_KIND_NAMES,
  RETURN_NAMES,
  REVERB_SPACE_RANGES,
  eqResponseDb,
} from '@windsor/engine';
import { withoutInsertIds } from '@windsor/engine/__fixtures__/insertIds';
import { fmtHz } from './consoleFormat';
import { addInsert } from './insertEdits';
import { INSERT_CARDS } from './insertCards';
import {
  CHORUS_KNOBS,
  DRIVE_KNOBS,
  ECHO_KNOBS,
  ENSEMBLE_KNOBS,
  FILTER_INSERT_KNOBS,
  INSERT_GROUPS,
  INSERT_LABELS,
  PLATE_REVERB_KNOBS,
} from './insertKnobTables';

describe('INSERT_CARDS', () => {
  it('has a card for every insert kind the engine declares, and no other', () => {
    for (const kind of INSERT_KIND_NAMES) expect(typeof INSERT_CARDS[kind], kind).toBe('function');
    expect(Object.keys(INSERT_CARDS).sort()).toEqual([...INSERT_KIND_NAMES].sort());
  });

  it('labels every kind it can add', () => {
    expect(Object.keys(INSERT_LABELS).sort()).toEqual([...INSERT_KIND_NAMES].sort());
  });

  it('puts every kind in exactly one Add group, and no other name (windsor#173)', () => {
    const grouped = INSERT_GROUPS.flatMap((group) => group.kinds);
    expect([...grouped].sort()).toEqual([...INSERT_KIND_NAMES].sort());
    expect(new Set(grouped).size).toBe(grouped.length);
  });

  it('groups the Add slot as decided: EQ, Filter, Drive, Dynamics, Modulation, Time, Space', () => {
    expect(INSERT_GROUPS.map((group) => group.label)).toEqual([
      'EQ',
      'Filter',
      'Drive',
      'Dynamics',
      'Modulation',
      'Time',
      'Space',
    ]);
  });

  it('lists Parametric EQ first, alone under EQ (windsor#199)', () => {
    expect(INSERT_GROUPS[0]).toEqual({ label: 'EQ', kinds: ['eq'] });
    expect(INSERT_LABELS.eq).toBe('Parametric EQ');
  });

  it('adds a flat EQ with bands 2–7 on, on a part, the master and both send buses', () => {
    for (const target of [0, 'master', ...RETURN_NAMES] as const) {
      const [added] = addInsert([], 'eq', target);
      expect(withoutInsertIds([added!]), String(target)).toEqual([DEFAULT_EQ]);
      if (added?.kind !== 'eq') throw new Error('not an EQ');
      expect(added.bands.map((band) => band.on)).toEqual([
        false,
        true,
        true,
        true,
        true,
        true,
        true,
        false,
      ]);
      const flat = eqResponseDb(added, [20, 100, 1000, 10000, 20000], 48000, new Float64Array(5));
      expect([...flat]).toEqual([0, 0, 0, 0, 0]);
    }
  });

  it('lists the Filter alone under Filter, after EQ (windsor#622)', () => {
    expect(INSERT_GROUPS[1]).toEqual({ label: 'Filter', kinds: ['filter'] });
    expect(INSERT_LABELS.filter).toBe('Filter');
  });

  it('calls the return-derived kinds Plate reverb and Echo (windsor#171)', () => {
    expect(INSERT_LABELS.plate).toBe('Plate reverb');
    expect(INSERT_LABELS.echo).toBe('Echo');
  });
});

describe('DRIVE_KNOBS', () => {
  it("covers every drive field but the kind, each defaulting to DEFAULT_DRIVE's", () => {
    const fields = INSERT_KINDS.drive.fields.filter((f) => f !== 'kind' && f !== 'enabled');
    expect(DRIVE_KNOBS.map((k) => k.f).sort()).toEqual([...fields].sort());
    for (const { f, o } of DRIVE_KNOBS) expect(o.def, f).toBe(DEFAULT_DRIVE[f]);
  });

  it("spans the engine's ranges", () => {
    const byField = Object.fromEntries(DRIVE_KNOBS.map((k) => [k.f, k.o]));
    expect([byField.drive?.min, byField.drive?.max]).toEqual([
      DRIVE_GAIN_MIN_DB,
      DRIVE_GAIN_MAX_DB,
    ]);
    expect([byField.tone?.min, byField.tone?.max]).toEqual([DRIVE_TONE_MIN_HZ, DRIVE_TONE_MAX_HZ]);
    expect([byField.mix?.min, byField.mix?.max]).toEqual([0, 1]);
  });
});

describe('CHORUS_KNOBS', () => {
  it("covers every chorus field but the kind, each defaulting to DEFAULT_CHORUS's (#642)", () => {
    const fields = INSERT_KINDS.chorus.fields.filter((f) => f !== 'kind' && f !== 'enabled');
    expect(CHORUS_KNOBS.map((k) => k.f).sort()).toEqual([...fields].sort());
    for (const { f, o } of CHORUS_KNOBS) expect(o.def, f).toBe(DEFAULT_CHORUS[f]);
  });

  it("spans the engine's ranges", () => {
    const byField = Object.fromEntries(CHORUS_KNOBS.map((k) => [k.f, k.o]));
    expect([byField.rate?.min, byField.rate?.max]).toEqual([
      CHORUS_RATE_MIN_HZ,
      CHORUS_RATE_MAX_HZ,
    ]);
    expect([byField.depth?.min, byField.depth?.max]).toEqual([
      CHORUS_DEPTH_MIN_MS,
      CHORUS_DEPTH_MAX_MS,
    ]);
    expect([byField.spread?.min, byField.spread?.max]).toEqual([0, 1]);
    expect([byField.mix?.min, byField.mix?.max]).toEqual([0, 1]);
  });
});

describe('ENSEMBLE_KNOBS (#695)', () => {
  it("covers every ensemble number, each spanning the engine's bounds from DEFAULT_ENSEMBLE", () => {
    const fields = INSERT_KINDS.ensemble.fields.filter((f) => f !== 'kind' && f !== 'enabled');
    expect(ENSEMBLE_KNOBS.map((k) => k.f).sort()).toEqual([...fields].sort());
    for (const { f, o } of ENSEMBLE_KNOBS) {
      expect(o.def, f).toBe(DEFAULT_ENSEMBLE[f]);
      expect([o.min, o.max], f).toEqual([...ENSEMBLE_BOUNDS[f as keyof typeof ENSEMBLE_BOUNDS]]);
    }
  });
});

describe('PLATE_REVERB_KNOBS (windsor#171)', () => {
  it("covers every plate number, spanning the plate's ranges from DEFAULT_PLATE_REVERB", () => {
    const fields = INSERT_KINDS.plate.fields.filter((f) => f !== 'kind' && f !== 'enabled');
    expect(PLATE_REVERB_KNOBS.map((k) => k.f).sort()).toEqual([...fields].sort());
    for (const { f, o } of PLATE_REVERB_KNOBS) {
      expect(o.def, f).toBe(DEFAULT_PLATE_REVERB[f]);
      const range =
        f === 'mix' ? [0, 1] : REVERB_SPACE_RANGES[f as keyof typeof REVERB_SPACE_RANGES];
      expect([o.min, o.max], f).toEqual([...range]);
    }
  });
});

describe('ECHO_KNOBS (windsor#171)', () => {
  it('covers every echo number from DEFAULT_ECHO, inside the engine bounds', () => {
    const fields = INSERT_KINDS.echo.fields.filter((f) => f !== 'kind' && f !== 'enabled');
    expect(ECHO_KNOBS.map((k) => k.f).sort()).toEqual([...fields].sort());
    for (const { f, o } of ECHO_KNOBS) {
      expect(o.def, f).toBe(DEFAULT_ECHO[f]);
      const [min, max] = ECHO_BOUNDS[f as keyof typeof ECHO_BOUNDS];
      expect(o.min, f).toBeGreaterThanOrEqual(min);
      expect(o.max, f).toBeLessThanOrEqual(max);
      expect(o.def, f).toBeGreaterThanOrEqual(o.min);
      expect(o.def, f).toBeLessThanOrEqual(o.max);
    }
  });
});

describe('FILTER_INSERT_KNOBS (windsor#622)', () => {
  it('covers every Filter number from DEFAULT_FILTER, on its bounds, Cutoff on a log sweep', () => {
    expect(FILTER_INSERT_KNOBS.map((k) => [k.f, k.label])).toEqual([
      ['cutoff', 'Cutoff'],
      ['resonance', 'Reso'],
      ['mix', 'Mix'],
    ]);
    for (const { f, o } of FILTER_INSERT_KNOBS) {
      expect(o.def, f).toBe(DEFAULT_FILTER[f]);
      expect([o.min, o.max], f).toEqual(FILTER_BOUNDS[f as keyof typeof FILTER_BOUNDS]);
    }
    expect(FILTER_INSERT_KNOBS[0]!.o.curve).toBe('log');
    expect(FILTER_INSERT_KNOBS[0]!.o.fmt).toBe(fmtHz);
  });
});
