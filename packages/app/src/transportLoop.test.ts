/**
 * The transport strip's loop button (windsor#30 decision 1): the partials it
 * writes, and a loop that survives an export and a re-import. Split from
 * `transportModel.test.ts`, which holds the rest of the strip's rules.
 */
import { beforeAll, describe, expect, it } from 'vitest';

import { ARRANGEMENT_VERSION, TICKS_PER_BAR } from '@windsor/engine';
import { loadBuiltIns } from './builtInLibrary';
import { DocumentModel } from './documentModel';
import { barsChange, loopIsOn, loopToggle } from './transportModel';

describe('the loop button (windsor#30 decision 1)', () => {
  // The document round trip reads the built-in library, which loads on demand.
  beforeAll(() => loadBuiltIns());
  const BAR = TICKS_PER_BAR;

  it('turns on over bars 1–4 when the song has no loop', () => {
    expect(loopIsOn({})).toBe(false);
    expect(loopToggle({ bars: 8 })).toEqual({
      transport: { loop: { start: 0, end: 4 * BAR, on: true } },
    });
  });

  it('clamps the new loop to a song shorter than four bars', () => {
    expect(loopToggle({ bars: 2 })).toEqual({
      transport: { loop: { start: 0, end: 2 * BAR, on: true } },
    });
  });

  it('flips on and off, keeping the range', () => {
    const on = { start: 2 * BAR, end: 6 * BAR, on: true };
    expect(loopIsOn({ loop: on })).toBe(true);
    expect(loopToggle({ bars: 8, loop: on })).toEqual({
      transport: { loop: { start: 2 * BAR, end: 6 * BAR, on: false } },
    });
    expect(loopToggle({ bars: 8, loop: { ...on, on: false } })).toEqual({
      transport: { loop: { start: 2 * BAR, end: 6 * BAR, on: true } },
    });
  });

  it('lights on, keeps the range off, and survives an export and a re-import', () => {
    const model = new DocumentModel({ version: ARRANGEMENT_VERSION });
    model.merge(barsChange(8));
    expect(model.doc.transport.bars).toBe(8);
    expect(model.doc.transport.loop).toBeUndefined();
    model.merge(loopToggle(model.doc.transport));
    expect(model.doc.transport.loop).toEqual({ start: 0, end: 4 * BAR, on: true });
    expect(loopIsOn(model.doc.transport)).toBe(true);
    model.merge(loopToggle(model.doc.transport));
    expect(model.doc.transport.loop).toEqual({ start: 0, end: 4 * BAR, on: false });
    const reopened = new DocumentModel(JSON.parse(model.toJson()));
    expect(reopened.doc.transport.loop).toEqual({ start: 0, end: 4 * BAR, on: false });
    reopened.merge(loopToggle(reopened.doc.transport));
    const again = new DocumentModel(JSON.parse(reopened.toJson()));
    expect(again.doc.transport.loop).toEqual({ start: 0, end: 4 * BAR, on: true });
  });
});
