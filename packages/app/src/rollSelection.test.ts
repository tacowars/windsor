/**
 * The Roll's selection outside the device (windsor#603): it survives a new
 * device (a re-render), comes back with the list an undo puts back, drops
 * keys that match no note, and is forgotten with its part or region. A
 * cancelled drag leaves the selection it started with.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentPartial, RollNote, RollSpec } from '@windsor/engine';
import { TICKS_PER_BAR, partAt } from '@windsor/engine';
import type { AppCtx } from './context';
import { DocumentModel } from './documentModel';
import { moveNotes } from './rollEdits';
import { RollEditor } from './rollEditor';
import { forgetGone, keepSelected, rollSelections, selectedIn } from './rollSelection';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const n = (tick: number, pitch: number): RollNote => ({ tick, ticks: 6, pitch });
const AT = { slot: 0, region: 0 };

const roll = (notes: RollNote[]): RollSpec => ({ kind: 'roll', loopTicks: BAR, notes });

/** A song whose part 0 is a roll with one region playing `notes`. */
function rollSong(notes: RollNote[]): DocumentModel {
  const model = new DocumentModel(newSong());
  const regions = [{ start: 0, duration: BAR, pattern: roll(notes) }];
  model.merge({ parts: { 0: { sequencer: roll([]), regions } } } as unknown as DocumentPartial);
  return model;
}

describe('the selection store', () => {
  it('reads back on a new list of the same notes, as a new device after a write does', () => {
    const store = rollSelections();
    keepSelected(AT, [n(0, 60), n(6, 62)], [1], store);
    expect(selectedIn(AT, [n(0, 60), n(6, 62)], store)).toEqual([1]);
    expect(selectedIn({ slot: 0, region: 1 }, [n(0, 60), n(6, 62)], store)).toEqual([]);
  });

  it('comes back with the list an undo puts back', () => {
    const store = rollSelections();
    const before = [n(0, 60), n(6, 62)];
    keepSelected(AT, before, [0], store);
    const moved = [n(6, 62), n(12, 60)];
    keepSelected(AT, moved, [1], store);
    expect(selectedIn(AT, before, store)).toEqual([0]);
    expect(selectedIn(AT, moved, store)).toEqual([1]);
  });

  it('drops a key that matches no note', () => {
    const store = rollSelections();
    keepSelected(AT, [n(0, 60), n(6, 62)], [0, 1], store);
    expect(selectedIn(AT, [n(0, 60)], store)).toEqual([0]);
    expect(selectedIn(AT, [n(0, 60), n(6, 62)], store)).toEqual([0]);
  });

  it('forgets a region that has gone and a part that is no longer a roll', () => {
    const store = rollSelections();
    const model = rollSong([n(0, 60)]);
    keepSelected(AT, [n(0, 60)], [0], store);
    keepSelected({ slot: 0, region: 3 }, [n(0, 60)], [0], store);
    forgetGone(model.doc, store);
    expect(selectedIn(AT, [n(0, 60)], store)).toEqual([0]);
    expect(selectedIn({ slot: 0, region: 3 }, [n(0, 60)], store)).toEqual([]);
    model.merge({ parts: { 0: { sequencer: { kind: 'grid' } } } } as unknown as DocumentPartial);
    forgetGone(model.doc, store);
    expect(selectedIn(AT, [n(0, 60)], store)).toEqual([]);
  });
});

describe('the editor', () => {
  beforeEach(() => vi.stubGlobal('window', { addEventListener: () => undefined }));
  afterEach(() => vi.unstubAllGlobals());

  const editorOn = (model: DocumentModel): RollEditor => {
    const ctx = {
      model,
      change: (partial: DocumentPartial) => {
        model.merge(partial);
        return { ok: true, ignored: [] };
      },
    } as unknown as AppCtx;
    const body = { isConnected: true, closest: () => null } as unknown as HTMLElement;
    const noop = (): void => undefined;
    return new RollEditor({ ctx, slot: 0, region: 0, body, previewNotes: noop, repaint: noop });
  };

  it('a cancelled drag leaves the selection as it was before it', () => {
    const editor = editorOn(rollSong([n(0, 60), n(24, 64)]));
    editor.select([1]);
    const rows = { rows: [64, 60] };
    const frame = { loop: BAR, region: BAR, snap: 6, ...rows };
    editor.preview(moveNotes(editor.current(), [1], { dTicks: 12, dRows: 0 }, frame));
    editor.cancel();
    expect(editor.selected()).toEqual([1]);
  });

  it('a new device after a move and an undo has the note selected where it was', () => {
    const model = rollSong([n(0, 60), n(24, 64)]);
    const editor = editorOn(model);
    editor.select([0]);
    const before = model.doc;
    const frame = { loop: BAR, region: BAR, snap: 6, rows: [64, 60] };
    editor.commit(moveNotes(editor.current(), [0], { dTicks: 48, dRows: 0 }, frame));
    expect(editorOn(model).selected()).toEqual([1]);
    model.replace(before);
    const undone = editorOn(model);
    expect(undone.selected()).toEqual([0]);
    expect(partAt(model.doc, 0)?.regions[0]?.pattern).toMatchObject({
      notes: [n(0, 60), n(24, 64)],
    });
  });
});
