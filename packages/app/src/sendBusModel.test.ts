import { describe, expect, it } from 'vitest';
import type { ArrangementDocument } from '@windsor/engine';
import { busSenders, busSendersLine } from './sendBusModel';

/** Only what `busSenders` reads: each part's slot, name and sends. */
const doc = {
  parts: [
    { slot: 2, name: 'Lead', strip: { sends: { a: 0.4, b: 0.2 } } },
    { slot: 0, name: 'Pad', strip: { sends: { a: 0.3 } } },
    { slot: 1, name: 'Keys', strip: { sends: { a: 0, b: 0.5 } } },
  ],
} as unknown as ArrangementDocument;

describe('busSenders (windsor#172)', () => {
  it('names the parts whose send to the bus is above zero, in slot order', () => {
    expect(busSenders(doc, 'a')).toEqual(['Pad', 'Lead']);
    expect(busSenders(doc, 'b')).toEqual(['Keys', 'Lead']);
  });

  it('says so when no part sends to the bus', () => {
    expect(busSendersLine(['Pad', 'Lead'])).toBe('Sends from Pad, Lead');
    expect(busSendersLine([])).toBe('No part sends here yet');
  });
});
