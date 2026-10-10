/**
 * A part's `patchSource` through `makeArrangement` (windsor#669, record
 * `2026-10-10-each-part-owns-its-patch` decision 3): a non-empty string is
 * kept and round-trips, absent stays absent, and anything else is dropped
 * with a report. Nothing that plays reads it.
 */
import { describe, expect, it } from 'vitest';

import { makeArrangement } from './arrangementDocument';
import { ARRANGEMENT_VERSION } from '../audioConstants';

const part = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  slot: 0,
  name: 'Bell',
  preset: 'bell-2',
  sequencer: { kind: 'none' },
  regions: [],
  ...extra,
});

const song = (parts: unknown[]): Record<string, unknown> => ({
  version: ARRANGEMENT_VERSION,
  patches: { 'bell-2': {} },
  parts,
});

describe("a part's patchSource (windsor#669)", () => {
  it('keeps a library id, and an export imports back with it', () => {
    const first = makeArrangement(song([part({ patchSource: 'bell' })]));
    expect(first.corrections).toEqual([]);
    expect(first.document.parts[0]?.patchSource).toBe('bell');
    const again = makeArrangement(JSON.parse(JSON.stringify(first.document)));
    expect(again.corrections).toEqual([]);
    expect(again.document).toEqual(first.document);
  });

  it('stays absent when the part has none', () => {
    const { document, corrections } = makeArrangement(song([part()]));
    expect(corrections).toEqual([]);
    expect(document.parts[0] && 'patchSource' in document.parts[0]).toBe(false);
  });

  it.each([
    [7, 'parts[0].patchSource: 7 is not a library id — dropped'],
    ['', 'parts[0].patchSource: "" is not a library id — dropped'],
  ])('drops %j with a report', (raw, line) => {
    const { document, corrections } = makeArrangement(song([part({ patchSource: raw })]));
    expect(corrections).toEqual([line]);
    expect(document.parts[0] && 'patchSource' in document.parts[0]).toBe(false);
    expect(document.parts[0]?.preset).toBe('bell-2');
  });
});
