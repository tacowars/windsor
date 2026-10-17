/**
 * Spectre's preset bank (record `2026-10-17-spectre-drawn-cells` decision
 * 12): twenty-four presets numbered in the picker's order, four groups,
 * unique names that repeat none of Windsor's other banks; each preset's
 * settings survive the normaliser silently, so the picker matches them back;
 * a pick keeps the user's Mix, Output, Freeze switch and on/off; and the
 * default Spectre is the default preset.
 */
import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { SPECTRE_CELLS, SPECTRE_PRESET_DEFAULT } from './spectreConstants';
import {
  SPECTRE_PRESET_GROUPS,
  SPECTRE_PRESETS,
  applySpectrePreset,
  matchingSpectrePreset,
} from './spectrePresets';
import { DEFAULT_SPECTRE, normaliseSpectre } from './spectreSpec';
import { REVERB_PRESETS } from './reverbPresets';
import { RETRO_REVERB_PRESETS } from './retroReverbPresets';

describe('the Spectre preset bank', () => {
  it('numbers twenty-four presets 1 to 24 in order, grouped in the picker’s order, names unique', () => {
    expect(SPECTRE_PRESETS.map((p) => p.number)).toEqual(
      Array.from({ length: 24 }, (_, i) => i + 1),
    );
    const groups = SPECTRE_PRESETS.map((p) => SPECTRE_PRESET_GROUPS.indexOf(p.group));
    expect(groups).toEqual([...groups].sort((a, b) => a - b));
    expect(new Set(groups).size).toBe(SPECTRE_PRESET_GROUPS.length);
    const names = SPECTRE_PRESETS.map((p) => p.label);
    expect(new Set(names).size).toBe(names.length);
  });

  it('repeats no name from the reverbs’ banks', () => {
    const taken = new Set([...REVERB_PRESETS, ...RETRO_REVERB_PRESETS].map((p) => p.label));
    for (const preset of SPECTRE_PRESETS) expect(taken.has(preset.label), preset.label).toBe(false);
  });

  it.each(SPECTRE_PRESETS.map((p) => [p.label, p] as const))(
    '%s survives the normaliser silently and is matched back',
    (_, preset) => {
      const spec = applySpectrePreset(DEFAULT_SPECTRE, preset.number);
      const n = new FieldNormaliser();
      const read = normaliseSpectre(JSON.parse(JSON.stringify(spec)), 's', n);
      expect(n.corrections).toEqual([]);
      expect(read).toEqual(spec);
      expect(matchingSpectrePreset(read)).toBe(preset.number);
      for (const curve of Object.values(spec.curves))
        expect(curve.left).toHaveLength(SPECTRE_CELLS);
    },
  );

  it('keeps the user’s Mix, Output, Freeze switch and on/off, and clears the selection', () => {
    const user = {
      ...DEFAULT_SPECTRE,
      mix: 0.8,
      outputDb: -3,
      freeze: true,
      enabled: false,
      selection: [[3, 9]] as const,
    };
    const picked = applySpectrePreset(user, 20);
    expect([picked.mix, picked.outputDb, picked.freeze, picked.enabled]).toEqual([
      0.8,
      -3,
      true,
      false,
    ]);
    expect(picked.selection).toEqual([]);
    expect(picked.freezeMode).toBe('carve');
  });

  it('starts a new Spectre as the default preset, half wet', () => {
    expect(matchingSpectrePreset(DEFAULT_SPECTRE)).toBe(SPECTRE_PRESET_DEFAULT);
    expect(DEFAULT_SPECTRE.mix).toBe(0.5);
  });

  it('matches nothing once a cell is drawn', () => {
    const drawn = {
      ...DEFAULT_SPECTRE,
      curves: {
        ...DEFAULT_SPECTRE.curves,
        gain: {
          ...DEFAULT_SPECTRE.curves.gain,
          left: DEFAULT_SPECTRE.curves.gain.left.map((v, i) => (i === 7 ? 0.5 : v)),
        },
      },
    };
    expect(matchingSpectrePreset(drawn)).toBeUndefined();
  });
});
