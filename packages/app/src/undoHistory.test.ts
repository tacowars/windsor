/**
 * The history model over plain values (windsor#124): the two stacks, the
 * depth, a new record emptying the redo stack, `clear`, the labels and the
 * listener. What the steps hold is opaque to it, so strings stand in for
 * documents.
 */
import { describe, expect, it } from 'vitest';

import { UNDO_DEPTH } from './undoConstants';
import { UndoHistory, stepLabel, type UndoStep } from './undoHistory';

const step = (before: string, label = before, tab: string | null = 'parts'): UndoStep<string> => ({
  before,
  label,
  tab,
});

describe('UndoHistory', () => {
  it('starts empty, with nothing to undo or redo', () => {
    const history = new UndoHistory<string>();
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
    expect([history.undoLabel, history.redoLabel]).toEqual([null, null]);
    expect([history.nextUndo, history.nextRedo]).toEqual([null, null]);
  });

  it('moves a step to the redo stack on undo, holding the document it left, and back on redo', () => {
    const history = new UndoHistory<string>();
    history.record(step('a', 'Cutoff', 'mixer'));
    expect(history.nextUndo).toEqual({ before: 'a', label: 'Cutoff', tab: 'mixer' });
    history.undone('b');
    expect(history.size).toEqual({ undo: 0, redo: 1 });
    expect(history.nextRedo).toEqual({ before: 'b', label: 'Cutoff', tab: 'mixer' });
    expect(history.redoLabel).toBe('Cutoff');
    history.redone('a');
    expect(history.size).toEqual({ undo: 1, redo: 0 });
    expect(history.nextUndo).toEqual({ before: 'a', label: 'Cutoff', tab: 'mixer' });
  });

  it('empties the redo stack on a new record', () => {
    const history = new UndoHistory<string>();
    history.record(step('a'));
    history.record(step('b'));
    history.undone('c');
    expect(history.canRedo).toBe(true);
    history.record(step('d'));
    expect(history.canRedo).toBe(false);
    expect(history.size).toEqual({ undo: 2, redo: 0 });
  });

  it(`keeps ${UNDO_DEPTH} steps, dropping the oldest for the next`, () => {
    const history = new UndoHistory<string>();
    for (let i = 0; i <= UNDO_DEPTH; i++) history.record(step(`doc ${i}`));
    expect(history.size.undo).toBe(UNDO_DEPTH);
    const befores: string[] = [];
    while (history.nextUndo) {
      befores.push(history.nextUndo.before);
      history.undone('x');
    }
    expect(befores.at(-1)).toBe('doc 1');
    expect(befores[0]).toBe(`doc ${UNDO_DEPTH}`);
  });

  it('drops the oldest past the depth when a redo returns a step to the undo stack', () => {
    const history = new UndoHistory<string>(2);
    history.record(step('a'));
    history.record(step('b'));
    history.undone('b2');
    history.record(step('c'));
    history.record(step('d'));
    expect(history.size.undo).toBe(2);
    expect(history.nextUndo?.before).toBe('d');
  });

  it('clears both stacks', () => {
    const history = new UndoHistory<string>();
    history.record(step('a'));
    history.record(step('b'));
    history.undone('c');
    history.clear();
    expect(history.size).toEqual({ undo: 0, redo: 0 });
  });

  it('tells its listeners of every change, and nothing when an empty stack is stepped', () => {
    const history = new UndoHistory<string>();
    let calls = 0;
    const off = history.onChange(() => calls++);
    history.undone('x');
    history.redone('x');
    history.clear();
    expect(calls).toBe(0);
    history.record(step('a'));
    history.undone('b');
    history.redone('a');
    history.clear();
    expect(calls).toBe(4);
    off();
    history.record(step('a'));
    expect(calls).toBe(4);
  });
});

describe('stepLabel', () => {
  it("names a one-shot edit after its partial's sections", () => {
    expect(stepLabel({ transport: { bpm: 120 } })).toBe('Transport');
    expect(stepLabel({ parts: {}, patches: {} })).toBe('Parts, patches');
    expect(stepLabel({})).toBe('Edit');
  });
});
