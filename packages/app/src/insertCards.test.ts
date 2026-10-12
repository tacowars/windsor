/**
 * The insert-card registry covers the engine's insert kinds (#641), as
 * `SEQUENCER_CARDS` covers the sequencer kinds: a kind added to
 * `INSERT_KINDS` without a card, a label or knobs would be an insert the
 * Mixer tab can add and not show. That fails here, and the registry carries
 * no entry the engine does not declare.
 */
import { describe, expect, it } from 'vitest';

import {
  BLOOM_BOUNDS,
  BLOOM_OCTAVES,
  CHORUS_DEPTH_MAX_MS,
  CHORUS_DEPTH_MIN_MS,
  CHORUS_RATE_MAX_HZ,
  CHORUS_RATE_MIN_HZ,
  DEFAULT_BLOOM,
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
  INSERT_AUTOMATION_FIELDS,
  INSERT_KINDS,
  INSERT_KIND_NAMES,
  RETURN_NAMES,
  REVERB_SPACE_RANGES,
  eqResponseDb,
} from '@windsor/engine';
import { withoutInsertIds } from '@windsor/engine/__fixtures__/insertIds';
import { fmtHz } from './consoleFormat';
import { addPickerGroups } from './insertAddPicker';
import { addInsert } from './insertEdits';
import { INSERT_CARDS } from './insertCards';
import {
  BLOOM_KNOBS,
  CHORUS_KNOBS,
  DRIVE_KNOBS,
  ECHO_KNOBS,
  ENSEMBLE_KNOBS,
  FILTER_INSERT_KNOBS,
  INSERT_GROUPS,
  INSERT_LABELS,
  PLATE_REVERB_KNOBS,
  fmtBloomDensity,
  bloomBandLimit,
  fmtBloomShape,
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

  it('offers a host’s slot every Add group less the host’s own kind (windsor#692)', () => {
    const groups = addPickerGroups('echo');
    expect(groups.find((group) => group.label === 'Time')?.kinds).toEqual(['delay']);
    expect(groups.flatMap((group) => group.kinds)).toHaveLength(INSERT_KIND_NAMES.length - 1);
    expect(addPickerGroups('eq').map((group) => group.label)[0]).toBe('Filter');
  });

  it('groups the Add slot as decided: EQ, Filter, Drive, Dynamics, Modulation, Time, Space, Generate', () => {
    expect(INSERT_GROUPS.map((group) => group.label)).toEqual([
      'EQ',
      'Filter',
      'Drive',
      'Dynamics',
      'Modulation',
      'Time',
      'Space',
      'Generate',
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
    // The voicing (windsor#746) is a switch, not a number.
    const notKnobs = ['kind', 'enabled', 'voicing'];
    const fields = INSERT_KINDS.plate.fields.filter((f) => !notKnobs.includes(f));
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
    // The slot (record 2026-10-11-wet-path-slot) holds a child insert, not a number.
    const notKnobs = ['kind', 'enabled', 'slot'];
    const fields = INSERT_KINDS.echo.fields.filter((f) => !notKnobs.includes(f));
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

describe('BLOOM_KNOBS (windsor#712)', () => {
  it("covers every Bloom number from DEFAULT_BLOOM, on Bloom's bounds", () => {
    // Freeze, Key and Scale are not numbers, and the slot is the child's.
    const notKnobs = ['kind', 'enabled', 'freeze', 'key', 'scale', 'slot'];
    const fields = INSERT_KINDS.bloom.fields.filter((f) => !notKnobs.includes(f));
    expect(BLOOM_KNOBS.map((k) => k.f).sort()).toEqual([...fields].sort());
    for (const { f, o } of BLOOM_KNOBS) {
      expect(o.def, f).toBe(DEFAULT_BLOOM[f]);
      expect([o.min, o.max], f).toEqual([...BLOOM_BOUNDS[f as keyof typeof BLOOM_BOUNDS]]);
    }
  });

  it("takes a lane's field's scale and floor from its automation row", () => {
    const byField = Object.fromEntries(BLOOM_KNOBS.map((k) => [k.f, k.o]));
    const own = INSERT_AUTOMATION_FIELDS.bloom.filter((r) => !r.childKind);
    for (const row of own.filter((r) => r.scale !== 'switch')) {
      const o = byField[row.target]!;
      expect(o.curve, row.target).toBe(row.scale === 'log' ? 'log' : undefined);
      expect(o.logFloor, row.target).toBe(row.floor);
    }
    expect(byField.swell?.logFloor).toBeGreaterThan(0);
    expect([byField.low?.step, byField.high?.step]).toEqual([1, 1]);
    expect(byField.octave?.steps).toEqual([...BLOOM_OCTAVES]);
  });

  it('reads as the approved mockup does (windsor#711)', () => {
    const fmt = Object.fromEntries(BLOOM_KNOBS.map((k) => [k.f, k.o.fmt!]));
    expect([0, 2, 2.4, 3.996, 4].map(fmtBloomShape)).toEqual([
      'sine',
      'saw',
      'saw→square',
      'pulse',
      'pulse',
    ]);
    expect(fmt.bright!(0)).toBe('+0.0dB/oct');
    expect([-12, 0, 12].map(fmt.octave!)).toEqual(['-12st', '0st', '+12st']);
    expect([0, DEFAULT_BLOOM.density, 1 - 1 / 12, 1].map(fmtBloomDensity)).toEqual([
      '1.0:1',
      '1.8:1',
      '12:1',
      '∞:1',
    ]);
    expect([fmt.amount!(1), fmt.spread!(0), fmt.mix!(0.5)]).toEqual(['1.00', '0.00', '0.50']);
  });

  it('stops Low and High at each other', () => {
    const spec = { ...DEFAULT_BLOOM, low: 50, high: 60 };
    expect([bloomBandLimit('low', 70, spec), bloomBandLimit('low', 45, spec)]).toEqual([60, 45]);
    expect([bloomBandLimit('high', 40, spec), bloomBandLimit('high', 80, spec)]).toEqual([50, 80]);
    const limited = Object.fromEntries(BLOOM_KNOBS.map((k) => [k.f, k.limit?.(70, spec)]));
    expect([limited.low, limited.high, limited.mix]).toEqual([60, 70, undefined]);
  });

  it('is called Bloom, alone in a Generate group after Space', () => {
    expect(INSERT_LABELS.bloom).toBe('Bloom');
    expect(INSERT_GROUPS.at(-1)).toEqual({ label: 'Generate', kinds: ['bloom'] });
  });
});
