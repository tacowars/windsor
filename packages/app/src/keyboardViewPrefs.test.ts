import { describe, expect, it } from 'vitest';

import { VIEW_PICK_DEFAULT } from './keyboardConstants';
import { readViewPick, writeViewPick, type PickStorage } from './keyboardViewPrefs';

function memory(): PickStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

const throwing = (): PickStorage => {
  throw new Error('storage blocked');
};

describe('the expanded keyboard’s Octaves and Rows preference', () => {
  it('is 2 octaves in 1 row when storage is empty, holds junk, or throws', () => {
    expect(VIEW_PICK_DEFAULT).toEqual({ octaves: 2, rows: 1 });
    const store = memory();
    expect(readViewPick(() => store, 'k')).toEqual(VIEW_PICK_DEFAULT);
    for (const junk of ['sideways', 'null', '{"octaves":5,"rows":1}', '{"octaves":3,"rows":2}']) {
      store.items.set('k', junk);
      expect(readViewPick(() => store, 'k')).toEqual(VIEW_PICK_DEFAULT);
    }
    expect(readViewPick(throwing)).toEqual(VIEW_PICK_DEFAULT);
  });

  it('keeps a pick across reads', () => {
    const store = memory();
    writeViewPick({ octaves: 4, rows: 2 }, () => store);
    expect(readViewPick(() => store)).toEqual({ octaves: 4, rows: 2 });
    writeViewPick({ octaves: 3, rows: 1 }, () => store);
    expect(readViewPick(() => store)).toEqual({ octaves: 3, rows: 1 });
  });

  it('swallows a storage that refuses the write', () => {
    expect(() => writeViewPick({ octaves: 1, rows: 1 }, throwing)).not.toThrow();
  });
});
