/**
 * A part's keyboard fold through `makeArrangement` (windsor#918, record
 * `2026-10-18-keyboard-fold` decision 1): `scale` and `chord` are kept and
 * round-trip, a song without one reads as `off`, and anything else is `off`
 * with a report. The field is additive and bumps nothing.
 */
import { describe, expect, it } from 'vitest';

import { makeArrangement } from './arrangementDocument';
import { ARRANGEMENT_VERSION } from '../audioConstants';

const part = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  slot: 0,
  name: 'Keys',
  preset: 'keys',
  sequencer: { kind: 'none' },
  regions: [],
  ...extra,
});

const song = (parts: unknown[]): Record<string, unknown> => ({
  version: ARRANGEMENT_VERSION,
  patches: { keys: {} },
  parts,
});

describe("a part's fold", () => {
  it.each(['scale', 'chord', 'off'] as const)(
    'keeps %s, and an export imports back with it',
    (fold) => {
      const first = makeArrangement(song([part({ fold })]));
      expect(first.corrections).toEqual([]);
      expect(first.document.parts[0]?.fold).toBe(fold);
      const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
      expect(again.corrections).toEqual([]);
      expect(again.document).toEqual(first.document);
    },
  );

  it('reads a song without one as off, with no report', () => {
    const { document, corrections } = makeArrangement(song([part()]));
    expect(corrections).toEqual([]);
    expect(document.parts[0]?.fold).toBe('off');
  });

  it.each([
    ['Scale', 'parts[0].fold: "Scale" is not a fold — using "off"'],
    [1, 'parts[0].fold: 1 is not a fold — using "off"'],
    [null, 'parts[0].fold: null is not a fold — using "off"'],
  ])('reads %j as off, with a report', (raw, line) => {
    const { document, corrections } = makeArrangement(song([part({ fold: raw })]));
    expect(corrections).toEqual([line]);
    expect(document.parts[0]?.fold).toBe('off');
    expect(document.parts[0]?.preset).toBe('keys');
  });
});
