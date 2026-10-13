import { describe, expect, it } from 'vitest';

import { readTakeover, writeTakeover, type TakeoverStorage } from './ccTakeover';

function memory(): TakeoverStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => void items.set(key, value),
  };
}

const throwing = (): TakeoverStorage => {
  throw new Error('storage blocked');
};

describe('the CC takeover preference', () => {
  it('is Pickup when storage is empty, holds junk, or throws', () => {
    const store = memory();
    expect(readTakeover(() => store)).toBe('pickup');
    store.items.set('k', 'sideways');
    expect(readTakeover(() => store, 'k')).toBe('pickup');
    expect(readTakeover(throwing)).toBe('pickup');
  });

  it('keeps Jump and Pickup across reads', () => {
    const store = memory();
    writeTakeover('jump', () => store);
    expect(readTakeover(() => store)).toBe('jump');
    writeTakeover('pickup', () => store);
    expect(readTakeover(() => store)).toBe('pickup');
  });

  it('swallows a storage that refuses the write', () => {
    expect(() => writeTakeover('jump', throwing)).not.toThrow();
  });
});
