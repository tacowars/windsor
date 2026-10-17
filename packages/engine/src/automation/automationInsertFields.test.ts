import { describe, expect, it } from 'vitest';
import type { AdvancedDriveSpec, DriveStageSpec } from '../inserts/advancedDriveSpec';
import type { ChorusSpec } from '../inserts/chorusInsert';
import type { DelaySpec } from '../inserts/delaySpec';
import type { EchoSpec } from '../inserts/echoInsert';
import type { EqBand, EqSpec } from '../inserts/eqSpec';
import { INSERT_KINDS, INSERT_KIND_NAMES, type InsertSpec } from '../inserts/insertRegistry';
import type { RetroReverbSpec } from '../inserts/retroReverbSpec';
import type { TapeSpec } from '../inserts/tapeSpec';
import { automatableInsertFields, insertKindFields } from './automationInsertFields';
import { INSERT_AUTOMATION_FIELDS, INSERT_SWITCH_ROW } from './automationInsertTables';

const fields = (spec: InsertSpec): string[] => automatableInsertFields(spec).map((r) => r.target);
const defaults = <S extends InsertSpec>(kind: S['kind']): S => INSERT_KINDS[kind].defaults as S;

describe('insertKindFields', () => {
  it('appends the switch, On on a switch scale, to all sixteen kinds', () => {
    expect(INSERT_KIND_NAMES).toHaveLength(16);
    expect(INSERT_SWITCH_ROW).toMatchObject({ target: 'enabled', label: 'On', min: 0, max: 1 });
    expect(INSERT_SWITCH_ROW.scale).toBe('switch');
    for (const kind of INSERT_KIND_NAMES) {
      expect(insertKindFields(kind), kind).toEqual([
        ...INSERT_AUTOMATION_FIELDS[kind],
        INSERT_SWITCH_ROW,
      ]);
    }
  });

  // A kind may list its own boolean fields as switch rows, set-only like the
  // appended `enabled` (record 2026-10-11-bloom-insert decision 13).
  it("lists no enabled in the table, and as switches only a kind's own booleans and a host's child's", () => {
    for (const kind of INSERT_KIND_NAMES) {
      const rows = INSERT_AUTOMATION_FIELDS[kind];
      expect(
        rows.some((r) => r.target === 'enabled'),
        kind,
      ).toBe(false);
      for (const r of rows.filter((x) => x.scale === 'switch')) {
        const owner = r.childKind
          ? INSERT_KINDS[r.childKind].defaults
          : INSERT_KINDS[kind].defaults;
        const field = r.childKind ? r.target.slice('slot.'.length) : r.target;
        expect(
          typeof (owner as unknown as Record<string, unknown>)[field],
          `${kind} ${r.target}`,
        ).toBe('boolean');
        expect([r.min, r.max], `${kind} ${r.target}`).toEqual([0, 1]);
      }
    }
    expect(
      INSERT_AUTOMATION_FIELDS.bloom.filter((r) => r.scale === 'switch' && !r.childKind),
    ).toEqual([expect.objectContaining({ target: 'freeze', label: 'Freeze' })]);
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
      'reverb',
      'echo',
    ] as const) {
      // An empty slot reads none of a host's slot rows; a free Echo reads its Time.
      const own = insertKindFields(kind).filter((r) => !r.childKind);
      const spec = kind === 'echo' ? { ...defaults<EchoSpec>(kind), sync: false } : defaults(kind);
      expect(fields(spec), kind).toEqual(own.map((r) => r.target));
    }
  });

  it("offers Echo's Time only while it is not synced (windsor#816)", () => {
    const echo = defaults<EchoSpec>('echo');
    const rest = ['feedback', 'damp', 'resonance', 'mix', 'enabled'];
    expect(fields({ ...echo, sync: true })).toEqual(rest);
    expect(fields({ ...echo, sync: false })).toEqual(['delayTime', ...rest]);
  });

  describe("a host's slot (record 2026-10-11-wet-path-slot)", () => {
    const echo = { ...defaults<EchoSpec>('echo'), sync: false };
    const ECHO_OWN = ['delayTime', 'feedback', 'damp', 'resonance', 'mix'];

    it("lists Echo's rows and exactly the live child's, slot.enabled and slot.mix among them", () => {
      const chorus = { ...defaults<ChorusSpec>('chorus'), id: 'c' };
      expect(fields({ ...echo, slot: chorus })).toEqual([
        ...ECHO_OWN,
        ...fields(chorus).map((f) => `slot.${f}`),
        'enabled',
      ]);
      expect(fields({ ...echo, slot: chorus })).toEqual(
        expect.arrayContaining(['slot.rate', 'slot.mix', 'slot.enabled']),
      );
    });

    it("lists Echo's rows alone with the slot empty, null or absent", () => {
      const bare = Object.fromEntries(
        Object.entries(echo).filter(([key]) => key !== 'slot'),
      ) as unknown as EchoSpec;
      for (const spec of [echo, { ...echo, slot: null }, bare]) {
        expect(fields(spec)).toEqual([...ECHO_OWN, 'enabled']);
      }
    });

    it("reads a child row only where the child's own settings read it", () => {
      const tape = defaults<TapeSpec>('tape');
      const split = fields({ ...echo, slot: { ...tape, split: true } });
      expect(split).toContain('slot.wow');
      expect(split).not.toContain('slot.wear');
      const unsplit = fields({ ...echo, slot: { ...tape, split: false } });
      expect(unsplit).toContain('slot.wear');
      expect(unsplit).not.toContain('slot.wow');
    });
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
    expect(reverb).toEqual(expect.arrayContaining(['decay', 'size', 'early']));
    expect(reverb).not.toContain('duration');
    for (const mode of ['gated', 'reverse'] as const) {
      const finite = fields({ ...retro, mode });
      expect(finite).toContain('duration');
      expect(finite).not.toContain('decay');
      expect(finite).not.toContain('size');
      expect(finite).not.toContain('early');
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
