import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { makeArrangement } from '../song/arrangementDocument';
import { ARRANGEMENT_VERSION } from '../audioConstants';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { RETRO_REVERB_INSERT } from './retroReverbInsert';
import { DEFAULT_RETRO_REVERB } from './retroReverbSpec';
import { RETRO_REVERB_PRESETS, applyRetroPreset, matchingRetroPreset } from './retroReverbPresets';
import { RETRO_REVERB_BOUNDS } from './retroReverbConstants';

describe('retro insert and preset song contract', () => {
  it('normalizes junk while keeping all valid defaults', () => {
    const n = new FieldNormaliser();
    expect(RETRO_REVERB_INSERT.normalise({ ...DEFAULT_RETRO_REVERB }, 'fx', n)).toEqual(
      DEFAULT_RETRO_REVERB,
    );
    expect(n.corrections).toEqual([]);
    const fixed = RETRO_REVERB_INSERT.normalise(
      {
        mode: 'unknown',
        size: -1,
        decay: Infinity,
        duration: 50,
        enabled: 'false',
        converter: 'tube',
        rom: 'not allowed',
      },
      'fx',
      n,
    );
    expect(fixed).toMatchObject({
      mode: 'reverb',
      size: RETRO_REVERB_BOUNDS.size[0],
      decay: DEFAULT_RETRO_REVERB.decay,
      duration: RETRO_REVERB_BOUNDS.duration[1],
      enabled: true,
      converter: 'linear',
    });
    expect(n.corrections).toHaveLength(7);
  });
  it('has all 63 approximation starting points, preserving user mix/bypass on selection', () => {
    expect(RETRO_REVERB_PRESETS.map((p) => p.number)).toEqual(
      Array.from({ length: 63 }, (_, i) => i + 1),
    );
    for (const preset of RETRO_REVERB_PRESETS) {
      const spec = applyRetroPreset(
        { ...DEFAULT_RETRO_REVERB, mix: 0.17, enabled: false },
        preset.number,
      );
      const n = new FieldNormaliser();
      expect(RETRO_REVERB_INSERT.normalise({ ...spec }, 'fx', n)).toEqual(spec);
      expect(n.corrections).toEqual([]);
      expect(spec).toMatchObject({ mix: 0.17, enabled: false });
      expect(matchingRetroPreset(spec)).toBe(preset.number);
      expect(matchingRetroPreset({ ...spec, preDelay: 0.123 })).toBeUndefined();
      expect(matchingRetroPreset({ ...spec, early: 0.5 })).toBeUndefined();
      expect(matchingRetroPreset({ ...spec, converter: 'ranging' })).toBeUndefined();
    }
    const moved = { ...DEFAULT_RETRO_REVERB, early: 1, lowDecay: 2, converter: 'ranging' as const };
    expect(applyRetroPreset(moved, 1)).toMatchObject({
      early: DEFAULT_RETRO_REVERB.early,
      lowDecay: DEFAULT_RETRO_REVERB.lowDecay,
      converter: DEFAULT_RETRO_REVERB.converter,
    });
  });
  it('round trips every preset as settings on both track and master, without preset-bank references', () => {
    for (const preset of RETRO_REVERB_PRESETS) {
      const effect = applyRetroPreset(DEFAULT_RETRO_REVERB, preset.number);
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
