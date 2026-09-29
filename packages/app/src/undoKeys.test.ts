import { describe, expect, it } from 'vitest';

import { undoKeyAction, type UndoKeyFacts } from './undoKeys';

const z: UndoKeyFacts = {
  key: 'z',
  ctrl: false,
  meta: false,
  shift: false,
  alt: false,
  editing: false,
  inDialog: false,
};

describe('the undo and redo keys (windsor#131)', () => {
  it('undoes on Cmd+Z and Ctrl+Z', () => {
    expect(undoKeyAction({ ...z, meta: true })).toBe('undo');
    expect(undoKeyAction({ ...z, ctrl: true })).toBe('undo');
  });

  it('redoes on Shift+Cmd+Z and Shift+Ctrl+Z, whichever case the key reports', () => {
    for (const key of ['z', 'Z']) {
      expect(undoKeyAction({ ...z, key, meta: true, shift: true })).toBe('redo');
      expect(undoKeyAction({ ...z, key, ctrl: true, shift: true })).toBe('redo');
    }
  });

  it('redoes on Ctrl+Y', () => {
    expect(undoKeyAction({ ...z, key: 'y', ctrl: true })).toBe('redo');
  });

  it('leaves plain Z, Shift+Z and Alt+Z alone', () => {
    expect(undoKeyAction(z)).toBeNull();
    expect(undoKeyAction({ ...z, key: 'Z', shift: true })).toBeNull();
    expect(undoKeyAction({ ...z, alt: true })).toBeNull();
  });

  it('leaves Z with Alt added to Cmd or Ctrl alone', () => {
    expect(undoKeyAction({ ...z, meta: true, alt: true })).toBeNull();
    expect(undoKeyAction({ ...z, ctrl: true, alt: true })).toBeNull();
  });

  it('leaves plain Y and Cmd+Y alone', () => {
    expect(undoKeyAction({ ...z, key: 'y' })).toBeNull();
    expect(undoKeyAction({ ...z, key: 'y', meta: true })).toBeNull();
  });

  it('leaves the keys to a text field, so its own text undo works', () => {
    expect(undoKeyAction({ ...z, meta: true, editing: true })).toBeNull();
    expect(undoKeyAction({ ...z, ctrl: true, shift: true, editing: true })).toBeNull();
    expect(undoKeyAction({ ...z, key: 'y', ctrl: true, editing: true })).toBeNull();
  });

  it('leaves the keys alone inside an open dialog', () => {
    expect(undoKeyAction({ ...z, ctrl: true, inDialog: true })).toBeNull();
  });

  it('ignores other keys with Cmd or Ctrl', () => {
    expect(undoKeyAction({ ...z, key: 's', meta: true })).toBeNull();
    expect(undoKeyAction({ ...z, key: 'x', ctrl: true })).toBeNull();
  });
});
