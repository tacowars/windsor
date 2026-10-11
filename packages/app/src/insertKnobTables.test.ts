/**
 * Bloom's Key and Scale pickers (windsor#728) read as the transport's do:
 * Key is the transport's note names, which are also what Bloom stores, and
 * Scale is `chromatic` alone, then the transport's groups, so every scale
 * Windsor has is offered once, under the transport's lower-case name.
 */
import { CHORD_NOTE_NAMES, DEFAULT_BLOOM, SCALE_NAMES } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { BLOOM_KEY_ITEMS, BLOOM_SCALE_OFF_ITEMS } from './insertKnobTables';
import { KEY_OPTIONS, SCALE_OPTION_GROUPS } from './transportTables';

describe("Bloom's pickers", () => {
  it("Key offers the transport's twelve names, each its own stored value", () => {
    expect(BLOOM_KEY_ITEMS.map(([value]) => value)).toEqual([...CHORD_NOTE_NAMES]);
    expect(BLOOM_KEY_ITEMS.map(([, text]) => text)).toEqual(KEY_OPTIONS.map((o) => o.label));
    expect(BLOOM_KEY_ITEMS.map(([value]) => value)).toContain(DEFAULT_BLOOM.key);
  });

  it("Scale offers chromatic first, then every Windsor scale once, by the transport's names", () => {
    expect(BLOOM_SCALE_OFF_ITEMS).toEqual([['chromatic', 'chromatic']]);
    expect(BLOOM_SCALE_OFF_ITEMS[0]![0]).toBe(DEFAULT_BLOOM.scale);
    const grouped = SCALE_OPTION_GROUPS.flatMap((g) => g.options);
    expect(grouped.map((o) => o.value).sort()).toEqual([...SCALE_NAMES].sort());
    for (const { label } of grouped) expect(label).toBe(label.toLowerCase());
    expect(grouped.map((o) => o.label)).toContain('whole tone');
  });
});
