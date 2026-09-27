/**
 * The ensemble's presets (#695 decision 9): each applies, is matched back,
 * keeps the user's Width, Mix and on switch, reads Custom after an edit, sits
 * inside the bounds, and cites a public source. The kind's defaults are the
 * Solina preset.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from '../song/arrangementFields';
import { ENSEMBLE_INSERT } from './ensembleInsert';
import { DEFAULT_ENSEMBLE } from './ensembleSpec';
import { ENSEMBLE_PRESETS, applyEnsemblePreset, matchingEnsemblePreset } from './ensemblePresets';

describe('ENSEMBLE_PRESETS', () => {
  it('cites a public source for every preset, and none is generic', () => {
    expect(ENSEMBLE_PRESETS.length).toBeGreaterThan(0);
    for (const preset of ENSEMBLE_PRESETS) {
      expect(preset.source.urls.length, preset.id).toBeGreaterThan(0);
      for (const url of preset.source.urls) expect(url).toMatch(/^https?:\/\/[^\s]+$/);
    }
    const ids = ENSEMBLE_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(ENSEMBLE_PRESETS.map((p) => p.id))(
    '%s applies, is matched back and keeps the user’s',
    (id) => {
      const user = { ...DEFAULT_ENSEMBLE, width: 0.4, mix: 0.6, enabled: false, tone: 3000 };
      const applied = applyEnsemblePreset(user, id);
      expect([applied.width, applied.mix, applied.enabled]).toEqual([0.4, 0.6, false]);
      expect(matchingEnsemblePreset(applied)).toBe(id);
      const saved = ENSEMBLE_INSERT.normalise({ ...applied }, 'x', new FieldNormaliser());
      expect(saved).toEqual(applied);
      expect(
        matchingEnsemblePreset({ ...applied, slowRate: applied.slowRate + 0.01 }),
      ).toBeUndefined();
    },
  );

  it('starts a new ensemble on the Solina', () => {
    expect(matchingEnsemblePreset(DEFAULT_ENSEMBLE)).toBe('solina');
  });
});
