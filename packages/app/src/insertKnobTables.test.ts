/**
 * Bloom's Key and Scale pickers (windsor#728) read as the transport's do:
 * Key is the transport's note names, which are also what Bloom stores, and
 * Scale is `chromatic` alone, then the transport's groups, so every scale
 * Windsor has is offered once, under the transport's lower-case name.
 */
import {
  CHORD_NOTE_NAMES,
  DEFAULT_BLOOM,
  DEFAULT_ECHO,
  DELAY_DIVISIONS,
  SCALE_NAMES,
} from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import {
  BLOOM_KEY_ITEMS,
  BLOOM_SCALE_OFF_ITEMS,
  ECHO_DIVISION_KNOB,
  ECHO_DIVISIONS,
  echoDivisionTitle,
} from './insertKnobTables';
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

describe("the synced Echo's Time (windsor#816)", () => {
  const { o, codec } = ECHO_DIVISION_KNOB;

  it('steps through every note value, shortest to longest', () => {
    expect([...ECHO_DIVISIONS].sort()).toEqual(Object.keys(DELAY_DIVISIONS).sort());
    expect(ECHO_DIVISIONS).toEqual([
      '1/32T',
      '1/32',
      '1/16T',
      '1/32D',
      '1/16',
      '1/8T',
      '1/16D',
      '1/8',
      '1/4T',
      '1/8D',
      '1/4',
      '1/2T',
      '1/4D',
      '1/2',
      '1/2D',
      '1/1',
    ]);
    expect(o.steps).toEqual(ECHO_DIVISIONS.map((_, i) => i));
    expect([o.min, o.max]).toEqual([0, ECHO_DIVISIONS.length - 1]);
  });

  it('reads the note value, starting at the dotted eighth', () => {
    expect(o.fmt!(o.def)).toBe('1/8D');
    expect(ECHO_DIVISIONS[o.def]).toBe(DEFAULT_ECHO.division);
    expect(ECHO_DIVISIONS.map((_, i) => o.fmt!(i))).toEqual(ECHO_DIVISIONS);
  });

  it('reads and writes the note value, and nothing else', () => {
    const spec = { ...DEFAULT_ECHO, delayTime: 0.61 };
    const quarter = ECHO_DIVISIONS.indexOf('1/4');
    expect(codec!.read(spec)).toBe(o.def);
    expect(codec!.write(spec, quarter)).toEqual({ ...spec, division: '1/4' });
  });

  it("titles the note value with its length at the song's bpm", () => {
    expect(echoDivisionTitle('1/8D', 120)).toBe('1/8D = 375 ms at 120 bpm');
    expect(echoDivisionTitle('1/4', 100)).toBe('1/4 = 600 ms at 100 bpm');
  });
});
