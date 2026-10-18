import { describe, expect, it } from 'vitest';

import { type MetronomeStorage, readMetronomeOn, writeMetronomeOn } from './rollMetronomePrefs';

function memory(): MetronomeStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

const throwing = (): MetronomeStorage => {
  throw new Error('storage blocked');
};

describe('the Roll metronome preference', () => {
  it('is off when storage is empty, holds junk, or throws', () => {
    const store = memory();
    expect(readMetronomeOn(() => store, 'k')).toBe(false);
    for (const junk of ['true', '1', 'ON', '']) {
      store.items.set('k', junk);
      expect(readMetronomeOn(() => store, 'k')).toBe(false);
    }
    expect(readMetronomeOn(throwing)).toBe(false);
  });

  it('keeps on and off across reads', () => {
    const store = memory();
    writeMetronomeOn(true, () => store);
    expect(readMetronomeOn(() => store)).toBe(true);
    writeMetronomeOn(false, () => store);
    expect(readMetronomeOn(() => store)).toBe(false);
  });

  it('swallows a storage that refuses the write', () => {
    expect(() => writeMetronomeOn(true, throwing)).not.toThrow();
  });
});
