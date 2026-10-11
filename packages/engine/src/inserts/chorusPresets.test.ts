/**
 * The chorus's presets (#695 decision 4): each applies, is matched back,
 * keeps the user's Mix and on switch, reads Custom after an edit, and sits
 * inside the kind's ranges, so a normalised song keeps it exactly.
 */
import { describe, expect, it } from 'vitest';

import { FieldNormaliser } from '../song/arrangementFields';
import { CHORUS_INSERT, DEFAULT_CHORUS } from './chorusInsert';
import { CHORUS_PRESETS, applyChorusPreset, matchingChorusPreset } from './chorusPresets';

describe('CHORUS_PRESETS', () => {
  it('names the three Juno-60 modes, each from its measured source', () => {
    expect(CHORUS_PRESETS.map((p) => p.id)).toEqual(['slow', 'fast', 'both']);
    for (const preset of CHORUS_PRESETS) {
      expect(preset.source.urls.length, preset.id).toBeGreaterThan(0);
      expect(preset.source.measured, preset.id).toBe(true);
    }
  });

  it.each(CHORUS_PRESETS.map((p) => p.id))('%s applies, is matched back and keeps Mix', (id) => {
    const user = { ...DEFAULT_CHORUS, mix: 0.37, enabled: false };
    const applied = applyChorusPreset(user, id);
    expect(applied.mix).toBe(user.mix);
    expect(applied.enabled).toBe(false);
    expect(matchingChorusPreset(applied)).toBe(id);
    const saved = CHORUS_INSERT.normalise({ ...applied }, 'x', new FieldNormaliser());
    expect(saved).toEqual(applied);
    expect(matchingChorusPreset({ ...applied, depth: applied.depth + 0.01 })).toBeUndefined();
  });

  it('runs Both mono and Slow, Fast wide, and leaves an unknown id alone', () => {
    const byId = Object.fromEntries(CHORUS_PRESETS.map((p) => [p.id, p.settings]));
    expect(byId.both?.spread).toBe(0);
    expect(byId.slow?.spread).toBe(1);
    expect(applyChorusPreset(DEFAULT_CHORUS, 'nope')).toBe(DEFAULT_CHORUS);
    expect(matchingChorusPreset(DEFAULT_CHORUS)).toBeUndefined();
  });
});
