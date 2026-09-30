import { describe, expect, it } from 'vitest';
import { FieldNormaliser } from '../song/arrangementFields';
import { makeArrangement } from '../song/arrangementDocument';
import { FULL_ARRANGEMENT } from '../__fixtures__/fullArrangement';
import { DELAY_INSERT } from './delayInsert';
import { DEFAULT_DELAY } from './delaySpec';
import { DELAY_PRESETS, applyDelayPreset, matchingDelayPreset } from './delayPresets';
import { DELAY_BOUNDS } from './delayConstants';

describe('delay insert and preset song contract', () => {
  it('normalizes junk while keeping all valid defaults', () => {
    const n = new FieldNormaliser();
    expect(DELAY_INSERT.normalise({ ...DEFAULT_DELAY }, 'fx', n)).toEqual(DEFAULT_DELAY);
    expect(n.corrections).toEqual([]);
    const fixed = DELAY_INSERT.normalise(
      {
        lowpass: -1,
        leftMs: Infinity,
        feedback: 50,
        enabled: 'false',
        unknown: 'drop',
      },
      'fx',
      n,
    );
    expect(fixed).toMatchObject({
      lowpass: DELAY_BOUNDS.lowpass[0],
      leftMs: DEFAULT_DELAY.leftMs,
      feedback: DELAY_BOUNDS.feedback[1],
      enabled: true,
    });
    expect(n.corrections).toHaveLength(5);
  });
  it('has valid original starting points, preserving user mix/bypass on selection', () => {
    for (const preset of DELAY_PRESETS) {
      const spec = applyDelayPreset({ ...DEFAULT_DELAY, mix: 0.17, enabled: false }, preset.id);
      const n = new FieldNormaliser();
      expect(DELAY_INSERT.normalise({ ...spec }, 'fx', n)).toEqual(spec);
      expect(n.corrections).toEqual([]);
      expect(spec).toMatchObject({ mix: 0.17, enabled: false });
      expect(matchingDelayPreset(spec)).toBe(preset.id);
      expect(matchingDelayPreset({ ...spec, feedback: 0.123 })).toBeUndefined();
    }
  });
  it('round trips every preset as settings on both track and master, without preset-bank references', () => {
    for (const preset of DELAY_PRESETS) {
      const effect = applyDelayPreset(DEFAULT_DELAY, preset.id);
      const raw = {
        ...FULL_ARRANGEMENT,
        version: 3,
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
