import { expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { DEFAULT_TAPE } from './tapeSpec';
import { TAPE_INSERT } from './tapeInsert';
import { tapeControlValue, setTapeControl } from './tapeControls';
import { TAPE_PRESETS } from './tapePresetTables';
import { applyTapePreset } from './tapePresets';

it('preserves a legacy Wear setting until the first independent edit and carries the other amounts across', () => {
  const n = new FieldNormaliser();
  const legacy = TAPE_INSERT.normalise({ kind: 'tape', wear: 47 }, 'fx', n);
  expect(n.corrections).toEqual([]);
  expect(legacy.split).toBe(false);
  for (const field of ['wow', 'flutter', 'dropouts'] as const)
    expect(tapeControlValue(legacy, field)).toBe(47);
  const edited = setTapeControl(legacy, 'flutter', 8);
  expect(edited).toMatchObject({ split: true, wear: 47, wow: 47, flutter: 8, dropouts: 47 });
  expect(setTapeControl(edited, 'wow', 0)).toMatchObject({ wow: 0, flutter: 8, dropouts: 47 });
  expect(setTapeControl(legacy, 'trim', -9)).toMatchObject({ split: false, wear: 47, trim: -9 });
  expect(legacy).toMatchObject({ split: false, wear: 47, flutter: 0 });
});

it('applies valid original starting points without overwriting level, mix, bypass or seed', () => {
  const spec = { ...DEFAULT_TAPE, trim: -8, mix: 0.4, enabled: false, seed: 99 };
  expect(new Set(TAPE_PRESETS.map((p) => p.id)).size).toBe(TAPE_PRESETS.length);
  for (const preset of TAPE_PRESETS) {
    const next = applyTapePreset(spec, preset.id),
      n = new FieldNormaliser();
    expect(next).toMatchObject({
      ...preset.settings,
      split: true,
      trim: -8,
      mix: 0.4,
      enabled: false,
      seed: 99,
    });
    expect(TAPE_INSERT.normalise({ ...next }, 'fx', n)).toEqual(next);
    expect(n.corrections).toEqual([]);
  }
  expect(applyTapePreset(spec, 'unknown')).toBe(spec);
  expect(spec).toEqual({ ...DEFAULT_TAPE, trim: -8, mix: 0.4, enabled: false, seed: 99 });
});
