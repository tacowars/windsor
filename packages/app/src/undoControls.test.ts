import { describe, expect, it } from 'vitest';

import { undoButtonStates } from './undoControls';

describe('the Undo and Redo buttons (windsor#131)', () => {
  it('are both disabled with an empty history, as after an Import or New song', () => {
    const states = undoButtonStates({
      canUndo: false,
      canRedo: false,
      undoLabel: null,
      redoLabel: null,
    });
    expect(states.undo).toEqual({ disabled: true, title: 'Nothing to undo' });
    expect(states.redo).toEqual({ disabled: true, title: 'Nothing to redo' });
  });

  it('name the step: after a Cutoff edit, Undo reads "Undo Cutoff"', () => {
    const states = undoButtonStates({
      canUndo: true,
      canRedo: false,
      undoLabel: 'Cutoff',
      redoLabel: null,
    });
    expect(states.undo).toEqual({ disabled: false, title: 'Undo Cutoff' });
    expect(states.redo.disabled).toBe(true);
  });

  it('enable Redo after an undo, named for the step it makes again', () => {
    const states = undoButtonStates({
      canUndo: false,
      canRedo: true,
      undoLabel: null,
      redoLabel: 'Cutoff',
    });
    expect(states.undo.disabled).toBe(true);
    expect(states.redo).toEqual({ disabled: false, title: 'Redo Cutoff' });
  });
});
