import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { makeArrangement } from '../song/arrangementDocument';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { PHASER_INSERT } from './phaserInsert';
import { DEFAULT_PHASER } from './phaserSpec';
import { PHASER_PRESETS, applyPhaserPreset, matchingPhaserPreset } from './phaserPresets';
import { PHASER_BOUNDS } from './phaserConstants';

describe('phaser insert and preset song contract', () => {
  it('normalizes junk while keeping all valid defaults', () => {
    const n = new FieldNormaliser();
    expect(PHASER_INSERT.normalise({ ...DEFAULT_PHASER }, 'fx', n)).toEqual(DEFAULT_PHASER);
    expect(n.corrections).toEqual([]);
    const fixed = PHASER_INSERT.normalise(
      {
        center: -1,
        rate: Infinity,
        feedback: 50,
        enabled: 'false',
        unknown: 'drop',
      },
      'fx',
      n,
    );
    expect(fixed).toMatchObject({
      center: PHASER_BOUNDS.center[0],
      rate: DEFAULT_PHASER.rate,
      feedback: PHASER_BOUNDS.feedback[1],
      enabled: true,
    });
    expect(n.corrections).toHaveLength(5);
  });
  it('has valid original starting points, preserving user mix/bypass on selection', () => {
    for (const preset of PHASER_PRESETS) {
      const spec = applyPhaserPreset({ ...DEFAULT_PHASER, mix: 0.17, enabled: false }, preset.id);
      const n = new FieldNormaliser();
      expect(PHASER_INSERT.normalise({ ...spec }, 'fx', n)).toEqual(spec);
      expect(n.corrections).toEqual([]);
      expect(spec).toMatchObject({ mix: 0.17, enabled: false });
      expect(matchingPhaserPreset(spec)).toBe(preset.id);
      expect(matchingPhaserPreset({ ...spec, rate: 0.123 })).toBeUndefined();
    }
  });
  it('round trips every preset as settings on both track and master, without preset-bank references', () => {
    for (const preset of PHASER_PRESETS) {
      const effect = applyPhaserPreset(DEFAULT_PHASER, preset.id);
      const raw = {
        ...FULL_ARRANGEMENT,
        version: 2,
        patches: { kick: {}, hat: {}, 'saw-arp': {}, 'drone-sqr': {} },
        parts: FULL_ARRANGEMENT.parts.map((part) => ({ ...part, strip: { inserts: [effect] } })),
        master: { inserts: [effect] },
      };
      const result = makeArrangement(raw);
      expect(result.corrections).toEqual([]);
      expect(result.document.parts[0]!.strip!.inserts).toEqual([effect]);
      expect(result.document.master!.inserts).toEqual([effect]);
      expect(makeArrangement(JSON.parse(JSON.stringify(result.document))).document).toEqual(
        result.document,
      );
    }
  });
});
