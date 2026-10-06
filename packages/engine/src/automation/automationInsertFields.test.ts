import { describe, expect, it } from 'vitest';
import type { AdvancedDriveSpec, DriveStageSpec } from '../inserts/advancedDriveSpec';
import type { DelaySpec } from '../inserts/delaySpec';
import type { EqBand, EqSpec } from '../inserts/eqSpec';
import { INSERT_KINDS, INSERT_KIND_NAMES, type InsertSpec } from '../inserts/insertRegistry';
import type { RetroReverbSpec } from '../inserts/retroReverbSpec';
import type { TapeSpec } from '../inserts/tapeSpec';
import { automatableInsertFields, insertKindFields } from './automationInsertFields';
import { INSERT_AUTOMATION_FIELDS, INSERT_SWITCH_ROW } from './automationInsertTables';

const fields = (spec: InsertSpec): string[] => automatableInsertFields(spec).map((r) => r.target);
const defaults = <S extends InsertSpec>(kind: S['kind']): S => INSERT_KINDS[kind].defaults as S;

describe('insertKindFields', () => {
  it('appends the switch, On on a switch scale, to all thirteen kinds', () => {
    expect(INSERT_KIND_NAMES).toHaveLength(13);
    expect(INSERT_SWITCH_ROW).toMatchObject({ target: 'enabled', label: 'On', min: 0, max: 1 });
    expect(INSERT_SWITCH_ROW.scale).toBe('switch');
    for (const kind of INSERT_KIND_NAMES) {
      expect(insertKindFields(kind), kind).toEqual([
        ...INSERT_AUTOMATION_FIELDS[kind],
        INSERT_SWITCH_ROW,
      ]);
    }
  });

  it('lists no switch in the continuous table', () => {
    for (const rows of Object.values(INSERT_AUTOMATION_FIELDS)) {
      expect(rows.some((r) => r.target === 'enabled' || r.scale === 'switch')).toBe(false);
    }
  });
});

describe('automatableInsertFields', () => {
  it("keeps the catalog's order and only its rows, the switch last", () => {
    for (const kind of INSERT_KIND_NAMES) {
      const all = insertKindFields(kind).map((r) => r.target);
      const kept = fields(INSERT_KINDS[kind].defaults);
      expect(kept, kind).toEqual(all.filter((t) => kept.includes(t)));
      expect(kept.at(-1), kind).toBe('enabled');
    }
  });

  it('offers the switch while the insert is off', () => {
    for (const kind of INSERT_KIND_NAMES) {
      const off = { ...INSERT_KINDS[kind].defaults, enabled: false } as InsertSpec;
      expect(fields(off), kind).toContain('enabled');
    }
  });

  it('offers every row on the kinds no switch gates', () => {
    for (const kind of [
      'drive',
      'chorus',
      'compressor',
      'phaser',
      'ensemble',
      'plate',
      'echo',
    ] as const) {
      expect(fields(defaults(kind)), kind).toHaveLength(insertKindFields(kind).length);
    }
  });

  it("offers Tape's wear unsplit and its three motions split", () => {
    const tape = defaults<TapeSpec>('tape');
    const unsplit = fields({ ...tape, split: false });
    expect(unsplit).toContain('wear');
    for (const f of ['wow', 'flutter', 'dropouts']) expect(unsplit).not.toContain(f);
    const split = fields({ ...tape, split: true });
    expect(split).not.toContain('wear');
    for (const f of ['wow', 'flutter', 'dropouts']) expect(split).toContain(f);
    for (const spec of [unsplit, split]) {
      for (const f of ['drive', 'bias', 'wowRate', 'flutterRate', 'hiss', 'trim', 'mix']) {
        expect(spec).toContain(f);
      }
    }
  });

  it("offers a delay side's time only while it runs free", () => {
    const delay = defaults<DelaySpec>('delay');
    expect(fields({ ...delay, leftSync: false, rightSync: false })).toEqual(
      expect.arrayContaining(['leftMs', 'rightMs']),
    );
    const synced = fields({ ...delay, leftSync: true, rightSync: false });
    expect(synced).not.toContain('leftMs');
    expect(synced).toContain('rightMs');
    expect(fields({ ...delay, leftSync: false, rightSync: true })).not.toContain('rightMs');
  });

  it("offers Retro Reverb's tank in reverb mode and its gate time outside it", () => {
    const retro = defaults<RetroReverbSpec>('retro-reverb');
    const reverb = fields({ ...retro, mode: 'reverb' });
    expect(reverb).toEqual(expect.arrayContaining(['decay', 'size']));
    expect(reverb).not.toContain('duration');
    for (const mode of ['gated', 'reverse'] as const) {
      const finite = fields({ ...retro, mode });
      expect(finite).toContain('duration');
      expect(finite).not.toContain('decay');
      expect(finite).not.toContain('size');
      expect(finite).toEqual(expect.arrayContaining(['tone', 'diffusion', 'preDelay', 'mix']));
    }
  });

  describe('Advanced Drive', () => {
    const drive = defaults<AdvancedDriveSpec>('advanced-drive');
    const stage = (over: Partial<DriveStageSpec> = {}): DriveStageSpec => ({
      ...drive.stages[0]!,
      enabled: true,
      shaping: true,
      filtering: true,
      filter: 'peak',
      ...over,
    });
    const spec = (over: Partial<AdvancedDriveSpec>): AdvancedDriveSpec => ({
      ...drive,
      sync: false,
      stages: [stage(), stage(), stage()],
      ...over,
    });

    it('plays the stages its route plays', () => {
      const played = { single: 1, serial: 2, parallel: 2, multiband: 3, 'mid-side': 2 } as const;
      for (const [route, count] of Object.entries(played)) {
        const kept = fields(spec({ route: route as AdvancedDriveSpec['route'] }));
        for (let i = 0; i < 3; i++) {
          expect(kept.includes(`stages.${i}.level`), `${route} ${i}`).toBe(i < count);
        }
      }
    });

    it('offers the split on multiband, blend on serial and parallel, rate unsynced', () => {
      const multi = fields(spec({ route: 'multiband' }));
      expect(multi).toEqual(expect.arrayContaining(['low', 'high', 'rate']));
      expect(multi).not.toContain('blend');
      for (const route of ['serial', 'parallel'] as const) {
        expect(fields(spec({ route }))).toContain('blend');
        expect(fields(spec({ route }))).not.toContain('low');
      }
      expect(fields(spec({ route: 'single', sync: true }))).not.toContain('rate');
    });

    it("gates a stage's fields on its own switches", () => {
      const off = fields(spec({ route: 'single', stages: [stage({ enabled: false })] }));
      expect(off.filter((f) => f.startsWith('stages.'))).toEqual([]);
      const unshaped = fields(spec({ route: 'single', stages: [stage({ shaping: false })] }));
      for (const f of ['amount', 'bias', 'envAmount', 'envBias', 'lfoAmount', 'lfoBias']) {
        expect(unshaped).not.toContain(`stages.0.${f}`);
      }
      expect(unshaped).toContain('stages.0.frequency');
      const unfiltered = fields(spec({ route: 'single', stages: [stage({ filtering: false })] }));
      for (const f of ['frequency', 'resonance', 'peak', 'envCutoff', 'lfoCutoff']) {
        expect(unfiltered).not.toContain(`stages.0.${f}`);
      }
      expect(unfiltered).toContain('stages.0.amount');
      const lowpass = fields(spec({ route: 'single', stages: [stage({ filter: 'lowpass' })] }));
      expect(lowpass).not.toContain('stages.0.peak');
      expect(lowpass).toContain('stages.0.resonance');
    });
  });

  it('offers an EQ band only while it is on, its gain on bells and shelves, its Q unless a 6 dB cut', () => {
    const eq = defaults<EqSpec>('eq');
    const band = (over: Partial<EqBand>): EqBand => ({ ...eq.bands[0]!, on: true, ...over });
    const at = (b: EqBand): string[] =>
      fields({ ...eq, bands: eq.bands.map((x, i) => (i === 0 ? b : { ...x, on: false })) });
    expect(at(band({ on: false })).filter((f) => f.startsWith('bands.'))).toEqual([]);
    expect(at(band({ type: 'bell' }))).toEqual(
      expect.arrayContaining(['bands.0.freq', 'bands.0.gain', 'bands.0.q']),
    );
    expect(at(band({ type: 'notch' }))).not.toContain('bands.0.gain');
    const sixDb = at(band({ type: 'lowcut', slope: 6 }));
    expect(sixDb).toContain('bands.0.freq');
    expect(sixDb).not.toContain('bands.0.gain');
    expect(sixDb).not.toContain('bands.0.q');
    expect(at(band({ type: 'highcut', slope: 24 }))).toContain('bands.0.q');
    expect(at(band({ type: 'bell' }))).toEqual(expect.arrayContaining(['scale', 'output']));
  });
});
