/**
 * What a document edit means to the CC router (windsor#784, record
 * `2026-10-13-midi-cc-mapping` decisions 2 and 7): a mapped target's own value
 * moved, or its lane let go.
 */
import { type ArrangementDocument, type CcTargetId, makeArrangement } from '@windsor/engine';
import { describe, expect, it } from 'vitest';

import { ccDocumentEvents, songCcMappings } from './ccPanelSync';
import { mergeDocument } from './documentModel';
import { newSong } from './songParts';

const STRIP: CcTargetId = 'strip.level';
const PAN: CcTargetId = 'strip.pan';

const mapped = (target: CcTargetId) => ({
  source: { device: null, channel: null, cc: 7 },
  target,
  min: 0,
  max: 1,
  inverted: false,
});

const edit = (doc: ArrangementDocument, partial: unknown): ArrangementDocument =>
  makeArrangement(mergeDocument(doc, partial)).document;

const lane = (target: CcTargetId, on: boolean) => ({
  target,
  on,
  points: [{ tick: 0, value: 0.5, bend: 0 }],
});

describe('ccDocumentEvents', () => {
  const base = edit(makeArrangement(newSong()).document, {
    parts: { 0: { ccMappings: [mapped(STRIP), mapped(PAN)], automation: [lane(PAN, true)] } },
  });

  it('lists every mapping by part', () => {
    expect(songCcMappings(base).map((m) => [m.part, m.mapping.target])).toEqual([
      [0, STRIP],
      [0, PAN],
    ]);
  });

  it('reports a mapped target whose own value moved, and a lane switched off, and nothing else', () => {
    const after = edit(base, {
      parts: { 0: { strip: { level: 0.2 }, automation: [lane(PAN, false)] } },
    });
    expect(ccDocumentEvents(base, after)).toEqual({
      edited: [{ part: 0, target: STRIP }],
      released: [{ part: 0, target: PAN }],
    });
    expect(ccDocumentEvents(base, edit(base, { transport: { bpm: 140 } }))).toEqual({
      edited: [],
      released: [],
    });
  });
});
