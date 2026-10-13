/**
 * A knob's right-click menu (windsor#785, record `2026-10-13-midi-cc-mapping`
 * decision 12): what it offers on an unmapped and a mapped knob, where the
 * browser's menu stays, and each reason learn is refused.
 */
import {
  type CcMapping,
  type CcTargetId,
  type DocumentPart,
  FM_LANES_MAX,
  VOICE_AUTOMATION_ROWS,
  catalogRow,
  makeArrangement,
  partAt,
} from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import type { KnobCcMenuQuery } from './knobCcMenuModel';
import { NOT_A_PART_WHY, knobCcMenu, macroHeldWhy } from './knobCcMenuModel';
import { newSong } from './songParts';

const LEVEL: CcTargetId = 'voice.ops.0.level';
const WIDTH: CcTargetId = 'voice.ops.0.width';

const mapping = (target: CcTargetId, cc = 71): CcMapping => ({
  source: { device: 'Keys', channel: 1, cc },
  target,
  min: 0,
  max: 1,
  inverted: false,
});

function part(extra: Partial<DocumentPart> = {}): DocumentPart {
  const first = partAt(makeArrangement(newSong()).document, 0);
  if (!first) throw new Error('no part');
  return { ...first, ...extra };
}

const query = (at: Partial<KnobCcMenuQuery> = {}): KnobCcMenuQuery => ({
  at: { part: 0, target: LEVEL },
  part: part(),
  patch: undefined,
  lock: null,
  label: 'Level',
  ...at,
});

const labelOf = (target: CcTargetId): string => catalogRow(target)?.label ?? '';

describe('knobCcMenu', () => {
  it('offers learn alone on an unmapped knob, with the slot it would take', () => {
    const menu = knobCcMenu(query({ at: { part: 0, target: WIDTH } }));
    expect(menu?.head).toBe(labelOf(WIDTH));
    expect(menu?.items).toEqual([
      expect.objectContaining({ label: 'Learn MIDI CC…', tag: 'Voice 0/8 → 1/8', refused: null }),
    ]);
  });

  it('offers learn, edit and remove on a mapped knob, its CC in the head', () => {
    const menu = knobCcMenu(query({ part: part({ ccMappings: [mapping(LEVEL)] }) }));
    expect(menu?.head).toBe(`${labelOf(LEVEL)} · CC 71`);
    expect(menu?.items.map((i) => [i.label, i.tag, i.danger])).toEqual([
      ['Learn MIDI CC…', 'replaces CC 71', false],
      ['Edit mapping…', null, false],
      ['Remove CC 71', null, true],
    ]);
  });

  it("keeps the browser's menu off the catalog's CC targets", () => {
    expect(knobCcMenu(query({ at: { part: 0, target: 'seq.gate' as CcTargetId } }))).toBeNull();
    const absent = 'insert.nope.mix' as CcTargetId;
    expect(knobCcMenu(query({ at: { part: 0, target: absent } }))).toBeNull();
  });

  it("refuses learn on a knob no part owns: a group's, a return's, the master's", () => {
    const menu = knobCcMenu(query({ at: { part: null, target: 'strip.level' }, part: undefined }));
    expect(menu).toEqual({
      head: 'Level',
      items: [expect.objectContaining({ refused: NOT_A_PART_WHY, tag: NOT_A_PART_WHY })],
    });
  });

  it('refuses learn on a knob a macro holds, with its name', () => {
    const lock = { color: 'amber', value: 0.5, macro: 'Accent' };
    const menu = knobCcMenu(query({ lock }));
    expect(menu?.items[0]?.refused).toBe(macroHeldWhy('Accent'));
  });

  it('refuses a ninth voice slot, and keeps a target already counted open', () => {
    const rows = VOICE_AUTOMATION_ROWS.filter((row) => row.target !== WIDTH);
    const full = part({ ccMappings: rows.slice(0, FM_LANES_MAX).map((r) => mapping(r.target)) });
    const width = knobCcMenu(query({ at: { part: 0, target: WIDTH }, part: full }));
    expect(width?.items[0]?.refused).toBe('Voice slots full (8/8)');
    const lane = { target: WIDTH, on: false, points: [] };
    const shared = part({ ...full, automation: [lane] });
    expect(
      knobCcMenu(query({ at: { part: 0, target: WIDTH }, part: shared }))?.items[0]?.refused,
    ).toBeNull();
  });

  it('takes no voice slot on a strip target', () => {
    const menu = knobCcMenu(query({ at: { part: 0, target: 'strip.pan' } }));
    expect(menu?.items[0]).toMatchObject({ tag: null, refused: null });
  });
});
