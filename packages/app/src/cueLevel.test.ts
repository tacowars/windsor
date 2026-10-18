import { describe, expect, it } from 'vitest';

import { parseCueLevel, readCueLevel, writeCueLevel, type CueStorage } from './cueLevel';
import { CUE_LEVEL } from './cueLevelTables';

function memory(): CueStorage & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (k) => items.get(k) ?? null,
    setItem: (k, v) => void items.set(k, v),
  };
}

describe('the Cue level preference', () => {
  it('reads unity from empty storage', () => {
    const store = memory();
    expect(readCueLevel(() => store)).toBe(1);
  });

  it('reads back what it wrote, the bottom stop and the top included', () => {
    for (const gain of [0, 0.25, 1, CUE_LEVEL.max]) {
      const store = memory();
      writeCueLevel(gain, () => store);
      expect(readCueLevel(() => store)).toBe(gain);
    }
  });

  it('reads unity from garbage or out of range', () => {
    for (const text of ['', ' ', 'loud', 'NaN', 'Infinity', '-0.5', '3', '{"gain":1}']) {
      expect(parseCueLevel(text), text).toBeNull();
      const store = memory();
      store.items.set('k', text);
      expect(
        readCueLevel(() => store, 'k'),
        text,
      ).toBe(1);
    }
  });

  it('reads unity and writes nothing, without throwing, when storage refuses', () => {
    const refusing = (): CueStorage => {
      throw new Error('SecurityError');
    };
    const throwing: CueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
    };
    expect(readCueLevel(refusing)).toBe(1);
    expect(readCueLevel(() => throwing)).toBe(1);
    expect(() => writeCueLevel(0.5, refusing)).not.toThrow();
    expect(() => writeCueLevel(0.5, () => throwing)).not.toThrow();
  });
});
