/**
 * Keyboard fold on the Roll device (windsor#922, record
 * `2026-10-18-keyboard-fold` decision 2): every device shows the played
 * part's fold, and only the played part's device can change it.
 */
import { describe, expect, it } from 'vitest';

import { DocumentModel } from './documentModel';
import { partFoldChange } from './keyboardFoldEdits';
import { keyboardFoldLook } from './rollKeyboardFold';
import { newSong } from './songParts';

describe('Keyboard fold on a Roll device', () => {
  const model = new DocumentModel(newSong());
  const partial = partFoldChange(model.doc, 0, 'chord');
  if (partial) model.merge(partial);

  it('is live, showing its part’s fold, on the part the keyboard plays', () => {
    expect(keyboardFoldLook(model.doc, 0, 0)).toEqual({ fold: 'chord', live: true });
  });

  it('is disabled on any other part, still showing the played part’s fold', () => {
    expect(keyboardFoldLook(model.doc, 0, 3)).toEqual({ fold: 'chord', live: false });
  });

  it('shows Off when the played part is gone', () => {
    expect(keyboardFoldLook(model.doc, 9, 0)).toEqual({ fold: 'off', live: false });
  });
});
