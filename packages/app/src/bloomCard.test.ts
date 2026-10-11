/**
 * Bloom's Song key (windsor#717): Scale offers `song key` in its own group
 * before Windsor's scales, so every choice the engine takes is offered once,
 * and on it Key shows the song's key as the transport names it, disabled,
 * while the bloom's own key comes back on any other scale.
 */
import { DEFAULT_BLOOM, SCALE_NAMES } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { BLOOM_SCALE_GROUPS, bloomKeyShown } from './bloomCard';
import { BLOOM_SCALE_OFF_ITEMS } from './insertKnobTables';
import { KEY_OPTIONS, SCALE_OPTION_GROUPS } from './transportTables';

describe("Bloom's Song key", () => {
  it("offers chromatic, then song key alone, then the transport's groups", () => {
    expect(BLOOM_SCALE_GROUPS[0]).toEqual({
      group: 'Song',
      options: [{ value: 'song', label: 'song key' }],
    });
    expect(BLOOM_SCALE_GROUPS.slice(1)).toEqual(SCALE_OPTION_GROUPS);
    const values = [
      ...BLOOM_SCALE_OFF_ITEMS.map(([value]) => value),
      ...BLOOM_SCALE_GROUPS.flatMap((g) => g.options.map((o) => o.value)),
    ];
    expect(values).toEqual([
      'chromatic',
      'song',
      ...SCALE_OPTION_GROUPS.flatMap((g) => g.options.map((o) => o.value)),
    ]);
    expect([...values].sort()).toEqual(['chromatic', 'song', ...SCALE_NAMES].sort());
  });

  it("shows the song's key, disabled, on song key, and the bloom's own key otherwise", () => {
    const own = { ...DEFAULT_BLOOM, key: 'F' as const };
    expect(bloomKeyShown({ ...own, scale: 'major' }, 2)).toEqual({ value: 'F', disabled: false });
    expect(bloomKeyShown({ ...own, scale: 'chromatic' }, 2)).toEqual({
      value: 'F',
      disabled: false,
    });
    for (const { value, label } of KEY_OPTIONS) {
      expect(bloomKeyShown({ ...own, scale: 'song' }, Number(value))).toEqual({
        value: label,
        disabled: true,
      });
    }
  });
});
