/**
 * The song-lane picker and lane titles over a patch's macros (windsor#559,
 * record `2026-10-04-patch-macro-knobs` decisions 7 and 10): a part is
 * offered a Macros group holding exactly the macros its patch defines, by
 * name, after the voice's groups and before Sequencer; a part whose patch
 * defines none has no such group; and a lane on a macro reads the patch's
 * name over `Macros`, or the catalog's `Macro <i + 1>` where the patch does
 * not define it.
 */
import { describe, expect, it } from 'vitest';
import { AUTOMATION_PART } from '@windsor/engine/__fixtures__/automationSong';
import { DEFAULT_GRID_CONFIG, makePatch, type DocumentPart } from '@windsor/engine';
import { laneRow, laneTitle, pickerGroups } from './songAutomationModel';

const ACCENT_WOBBLE = makePatch({ macros: [{ name: 'Accent' }, { name: 'Wobble' }] });
const FOUR = makePatch({ macros: ['A', 'B', 'C', 'D'].map((name) => ({ name })) });
const GRID_PART: DocumentPart = {
  ...AUTOMATION_PART,
  sequencer: { kind: 'grid', ...DEFAULT_GRID_CONFIG },
};

describe('the picker over a patch with macros (windsor#559)', () => {
  it('offers a Macros group with exactly the macros the patch defines, by name', () => {
    const groups = pickerGroups(AUTOMATION_PART, ACCENT_WOBBLE);
    const macros = groups.find((g) => g.label === 'Macros');
    expect(macros?.options).toEqual([
      { target: 'voice.macros.0.value', label: 'Accent', disabled: false },
      { target: 'voice.macros.1.value', label: 'Wobble', disabled: false },
    ]);
  });

  it('lists it after the voice’s groups and before Sequencer', () => {
    const labels = pickerGroups(GRID_PART, ACCENT_WOBBLE).map((g) => g.label);
    expect(labels.slice(-3)).toEqual(['Voice · Pitch', 'Macros', 'Sequencer']);
  });

  it('offers none on a part whose patch has no macros, or no patch at all', () => {
    for (const patch of [makePatch(), undefined]) {
      const groups = pickerGroups(AUTOMATION_PART, patch);
      expect(groups.map((g) => g.label)).not.toContain('Macros');
      const targets = groups.flatMap((g) => g.options.map((o) => o.target));
      expect(targets.filter((t) => t.startsWith('voice.macros.'))).toEqual([]);
    }
  });
});

describe('a lane on a macro (windsor#559)', () => {
  it('reads the patch’s name over Macros', () => {
    expect(laneTitle(AUTOMATION_PART, 'voice.macros.1.value', ACCENT_WOBBLE)).toEqual({
      name: 'Wobble',
      kindLine: 'Macros',
      kind: 'voice',
    });
    expect(laneRow(AUTOMATION_PART, 'voice.macros.0.value', ACCENT_WOBBLE)?.label).toBe('Accent');
  });

  it('keeps the catalog’s label on a macro the patch does not define', () => {
    expect(laneTitle(AUTOMATION_PART, 'voice.macros.4.value', FOUR)).toEqual({
      name: 'Macro 5',
      kindLine: 'Macros',
      kind: 'voice',
    });
    expect(laneTitle(AUTOMATION_PART, 'voice.macros.0.value').name).toBe('Macro 1');
  });

  it('leaves every other lane’s name as it was', () => {
    expect(laneTitle(AUTOMATION_PART, 'voice.filter.cutoff', ACCENT_WOBBLE).name).toBe('Cutoff');
  });
});
