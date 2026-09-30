import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { makeArrangement } from '../song/arrangementDocument';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { ADVANCED_DRIVE_INSERT } from './advancedDriveInsert';
import { DEFAULT_ADVANCED_DRIVE } from './advancedDriveSpec';
import {
  ADVANCED_DRIVE_PRESETS,
  applyAdvancedDrivePreset,
  matchingAdvancedDrivePreset,
} from './advancedDrivePresets';

describe('advancedDrive insert and preset song contract', () => {
  it('normalises malformed fields, crossovers and stage objects without sharing defaults', () => {
    const n = new FieldNormaliser();
    const spec = ADVANCED_DRIVE_INSERT.normalise(
      {
        low: 4000,
        high: 200,
        stages: [{ amount: 99, bias: NaN, filtering: 'yes', alien: 2 }, null, {}, {}],
      },
      'fx',
      n,
    );
    expect(spec.low).toBe(4000);
    expect(spec.high).toBeGreaterThan(spec.low);
    expect(spec.stages).toHaveLength(3);
    expect(spec.stages[0]).toMatchObject({ amount: 1, bias: 0, filtering: false });
    expect(spec.stages[1]).not.toBe(spec.stages[2]);
    expect(n.corrections.length).toBeGreaterThan(4);
    const untouched = new FieldNormaliser();
    expect(ADVANCED_DRIVE_INSERT.normalise({ ...DEFAULT_ADVANCED_DRIVE }, 'fx', untouched)).toEqual(
      DEFAULT_ADVANCED_DRIVE,
    );
    expect(untouched.corrections).toEqual([]);
  });
  it('has valid original starting points, preserving user mix/bypass on selection', () => {
    for (const preset of ADVANCED_DRIVE_PRESETS) {
      const spec = applyAdvancedDrivePreset(
        { ...DEFAULT_ADVANCED_DRIVE, mix: 0.17, output: -8, enabled: false },
        preset.id,
      );
      const n = new FieldNormaliser();
      expect(ADVANCED_DRIVE_INSERT.normalise({ ...spec }, 'fx', n)).toEqual(spec);
      expect(n.corrections).toEqual([]);
      expect(spec).toMatchObject({ mix: 0.17, output: -8, enabled: false });
      expect(matchingAdvancedDrivePreset(spec)).toBe(preset.id);
      expect(matchingAdvancedDrivePreset({ ...spec, rate: 0.123 })).toBeUndefined();
    }
  });
  it('round trips every preset as settings on both track and master, without preset-bank references', () => {
    for (const preset of ADVANCED_DRIVE_PRESETS) {
      const effect = applyAdvancedDrivePreset(DEFAULT_ADVANCED_DRIVE, preset.id);
      const raw = {
        ...FULL_ARRANGEMENT,
        version: ARRANGEMENT_VERSION,
        patches: { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} },
        parts: FULL_ARRANGEMENT.parts.map((part) => ({ ...part, strip: { inserts: [effect] } })),
        master: { inserts: [effect] },
      };
      const result = makeArrangement(raw);
      expect(result.corrections).toEqual([]);
      expect(result.document.parts[0]!.strip!.inserts).toEqual([
        { ...effect, id: expect.any(String) },
      ]);
      expect(result.document.master!.inserts).toEqual([{ ...effect, id: expect.any(String) }]);
      expect(makeArrangement(JSON.parse(JSON.stringify(result.document))).document).toEqual(
        result.document,
      );
    }
  });
});
