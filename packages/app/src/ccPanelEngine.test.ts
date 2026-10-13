/**
 * The CC router's engine over the document and the host (windsor#784): a
 * target's row and own value as its knob shows it, a lane that is on, and
 * what a value the engine plays or refuses leaves held.
 */
import { makeArrangement } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import type { PerformanceHost } from './ccPanelEngine';
import { DocumentCcEngine } from './ccPanelEngine';
import { mergeDocument } from './documentModel';
import type { PerformanceResult } from './host';
import { newSong } from './songParts';

const doc = makeArrangement(
  mergeDocument(makeArrangement(newSong()).document, {
    parts: {
      0: {
        strip: { level: 0.5 },
        automation: [{ target: 'strip.pan', on: true, points: [{ tick: 0, value: 0, bend: 0 }] }],
      },
    },
  }),
).document;

function engine(result: PerformanceResult | null) {
  const host: PerformanceHost = { setPerformance: () => result, clearPerformance: () => {} };
  return new DocumentCcEngine(() => doc, host);
}

describe('DocumentCcEngine', () => {
  it("reads a target's row and own value from the document, and its lane", () => {
    const e = engine('applied');
    expect(e.target(0, 'strip.level')).toMatchObject({ own: 0.5, row: { target: 'strip.level' } });
    expect(e.target(0, 'insert.none.mix')).toBeUndefined();
    expect(e.target(5, 'strip.level')).toBeUndefined();
    expect([e.automated(0, 'strip.pan'), e.automated(0, 'strip.level')]).toEqual([true, false]);
  });

  it('holds what it applies until cleared; a full voice holds nothing', () => {
    const e = engine('applied');
    expect(e.apply(0, 'strip.level', 0.8)).toBe('applied');
    expect(e.heldValue(0, 'strip.level')).toBe(0.8);
    e.clear(0, 'strip.level');
    expect(e.heldValue(0, 'strip.level')).toBeUndefined();
    const full = engine('no-slot');
    expect(full.apply(0, 'voice.ops.0.level', 0.8)).toBe('noSlot');
    expect(full.heldValue(0, 'voice.ops.0.level')).toBeUndefined();
  });

  it('passes a refusal through and holds nothing: inert, automated, and audio off', () => {
    const cases = [
      ['inert', 'inert'],
      ['automated', 'automated'],
      [null, 'off'],
    ] as const;
    for (const [result, applied] of cases) {
      const e = engine(result);
      expect(e.apply(0, 'insert.t.wear', 0.8)).toBe(applied);
      expect(e.heldValue(0, 'insert.t.wear')).toBeUndefined();
    }
  });
});
