/**
 * The Envelopes tab's writes (windsor#707 decision 7): an add, a switch and
 * a delete are each one undo step named for the edit, an undo restores the
 * envelope, and the notes and the loop stay as they were.
 */
import { describe, expect, it } from 'vitest';

import type { ApplyResult, RollEnvelope } from '@windsor/engine';
import { DIVISORS, TICKS_PER_BAR } from '@windsor/engine';
import { AppContext, type ContextHost, type TabPanel } from './appContext';
import { DocumentModel } from './documentModel';
import type { EngineHost } from './host';
import { sequencerKindChange } from './partEdits';
import { switchedEnvelope, withEnvelope, withoutEnvelope } from './rollEnvelopePicker';
import { ROLL_ENVELOPE_UNDO as UNDO } from './rollEnvelopeTables';
import { envelopesOf, writeEnvelopes } from './rollEnvelopeWrite';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const CUTOFF: RollEnvelope = {
  target: 'filter.cutoff',
  on: true,
  points: [
    { tick: 0, value: -0.5, bend: 0.25 },
    { tick: BAR, value: 0.5, bend: 0 },
  ],
};
const NOTES = [{ tick: 0, ticks: DIVISORS.sixteenth, pitch: 60 }];
const ROLL = { kind: 'roll', loopTicks: 2 * BAR, notes: NOTES, envelopes: [CUTOFF] };
const PLACE = { slot: 0, region: 0 };

/** A console whose part 0 is a Roll with one region carrying `ROLL`. */
function rollConsole(): { ctx: AppContext<TabPanel>; model: DocumentModel } {
  const model = new DocumentModel(newSong());
  const partial = sequencerKindChange(model.doc, 0, 'roll', (raw) => model.preview(raw));
  if (partial) model.merge(partial);
  model.merge({ transport: { bars: 8 } });
  model.merge({ parts: { 0: { regions: [{ start: 0, duration: 4 * BAR, pattern: ROLL }] } } });
  const host: ContextHost = {
    apply: (): ApplyResult => ({ ok: true, ignored: [] }),
    build: () => Promise.resolve(),
    isBuilding: false,
    capturePattern: () => null,
    part: () => null,
  };
  const ctx = new AppContext<TabPanel>({
    host: { ...host, transport: { position: () => 0 } } as unknown as EngineHost,
    model,
    notify: () => undefined,
  });
  return { ctx, model };
}

const envelopes = (model: DocumentModel): readonly RollEnvelope[] =>
  envelopesOf(model.doc, PLACE.slot, PLACE.region);

describe("the Envelopes tab's writes (windsor#707)", () => {
  it('switches an envelope off as one undo step, and the undo switches it back on', () => {
    const { ctx, model } = rollConsole();
    const label = UNDO.on('Cutoff', false);
    expect(
      writeEnvelopes(ctx, PLACE, switchedEnvelope(envelopes(model), CUTOFF.target), label),
    ).toBe(true);
    expect(envelopes(model)).toEqual([{ ...CUTOFF, on: false }]);
    expect(ctx.undoLabel).toBe('Switch off Cutoff envelope');
    expect(ctx.undo()).toBe(true);
    expect(envelopes(model)).toEqual([CUTOFF]);
    expect(ctx.canUndo).toBe(false);
  });

  it('deletes an envelope as one undo step, and the undo restores it with its points', () => {
    const { ctx, model } = rollConsole();
    const label = UNDO.remove('Cutoff');
    expect(
      writeEnvelopes(ctx, PLACE, withoutEnvelope(envelopes(model), CUTOFF.target), label),
    ).toBe(true);
    expect(envelopes(model)).toEqual([]);
    expect(ctx.undoLabel).toBe('Delete Cutoff envelope');
    expect(ctx.undo()).toBe(true);
    expect(envelopes(model)).toEqual([CUTOFF]);
  });

  it('adds an empty envelope after the others and leaves the notes and the loop alone', () => {
    const { ctx, model } = rollConsole();
    const label = UNDO.add('Resonance');
    expect(
      writeEnvelopes(ctx, PLACE, withEnvelope(envelopes(model), 'filter.resonance'), label),
    ).toBe(true);
    expect(envelopes(model)).toEqual([
      CUTOFF,
      { target: 'filter.resonance', on: true, points: [] },
    ]);
    expect(ctx.undoLabel).toBe('Add Resonance envelope');
    const pattern = model.doc.parts[0]?.regions[0]?.pattern;
    expect(pattern).toMatchObject({ kind: 'roll', loopTicks: 2 * BAR, notes: [{ pitch: 60 }] });
  });
});
