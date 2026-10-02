/**
 * The harmony card's size table (windsor#332): the card is a sequencer
 * device's height from the one table that owns it, every size the stylesheet
 * reads is an entry here, and the fixed rows fit the height.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { HARMONY_CARD_PX } from './harmonyCardTables';
import { SEQUENCER_DEVICE_PX } from './sequencerDeviceTables';

const px = (prop: string): number => {
  const value = HARMONY_CARD_PX[prop];
  if (value === undefined) throw new Error(`no ${prop} in HARMONY_CARD_PX`);
  return value;
};

describe('the harmony card sizes', () => {
  it('is a sequencer device high', () => {
    expect(px('--seq-h')).toBe(SEQUENCER_DEVICE_PX['--seq-h']);
  });

  it('names only its own sizes and the device height', () => {
    for (const [prop, value] of Object.entries(HARMONY_CARD_PX)) {
      expect(prop === '--seq-h' || prop.startsWith('--harmony-')).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });

  it('owns every --harmony-* size the stylesheet reads', () => {
    const css = readFileSync(new URL('./console.css', import.meta.url), 'utf8');
    const read = new Set([...css.matchAll(/var\((--harmony-[a-z-]+)\)/g)].map((m) => m[1]));
    expect(read.size).toBeGreaterThan(0);
    for (const prop of read) expect(Object.keys(HARMONY_CARD_PX)).toContain(prop);
  });

  it('fits the ▶ row, the chips, the field row and the foot in the height', () => {
    const rows =
      px('--harmony-play-h') +
      px('--harmony-play-gap') +
      px('--harmony-chip-h') +
      px('--harmony-control-h') +
      px('--harmony-foot-h');
    expect(rows).toBeLessThan(px('--seq-h'));
  });
});
