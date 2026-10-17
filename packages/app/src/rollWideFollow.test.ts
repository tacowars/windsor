/**
 * The region the roll open wide follows to on a pick (windsor#873
 * decision 2), over a song with two Roll parts and a part that is not one.
 */
import type { ArrangementDocument } from '@windsor/engine';
import { TICKS_PER_BAR } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import { DocumentModel } from './documentModel';
import { followedRegion } from './rollWideFollow';
import { newSong } from './songParts';

const BAR = TICKS_PER_BAR;
const roll = { kind: 'roll', loopTicks: BAR, notes: [] };
/** Bars 1–2 and 5–6: a gap over bars 3–4 and 7–8. */
const REGIONS = [
  { start: 0, duration: 2 * BAR, pattern: roll },
  { start: 4 * BAR, duration: 2 * BAR, pattern: roll },
];

/**
 * Bass and Lead are Roll parts on slots 0 and 1; Kick, on slot 2, is a
 * Euclid; Pad, on slot 3, is a Roll part with no regions.
 */
function song(): ArrangementDocument {
  const raw = newSong();
  const base = (raw.parts as Record<string, unknown>[])[0];
  const part = (
    slot: number,
    name: string,
    sequencer: object,
    regions: object[] = REGIONS,
  ): Record<string, unknown> => ({ ...base, slot, name, sequencer, regions });
  const transport = { ...(raw.transport as object), bars: 8 };
  const parts = [
    part(0, 'Bass', roll),
    part(1, 'Lead', roll),
    part(2, 'Kick', { kind: 'euclidean' }),
    part(3, 'Pad', roll, []),
  ];
  return new DocumentModel({ ...raw, transport, parts }).doc;
}

describe('followedRegion', () => {
  const doc = song();
  const bassOpen = { slot: 0, region: 0 };

  it('follows a picked Roll part to its region under the playhead', () => {
    expect(followedRegion(doc, 1, { open: bassOpen, tick: 4 * BAR + 3 })).toBe(1);
    expect(followedRegion(doc, 1, { open: bassOpen, tick: BAR })).toBe(0);
  });

  it('leaves the pane its own choice in a gap, for a part that is not a Roll, and with no roll open', () => {
    expect(followedRegion(doc, 1, { open: bassOpen, tick: 2 * BAR })).toBeNull();
    expect(followedRegion(doc, 2, { open: bassOpen, tick: 0 })).toBeNull();
    expect(followedRegion(doc, 1, { open: null, tick: 0 })).toBeNull();
  });

  it('leaves the roll on its own part for a Roll part with no regions, as for a part that is not a Roll', () => {
    // Null leaves the pane its "No regions" hint and draws no Roll card to take the view over (decision 3).
    expect(followedRegion(doc, 3, { open: bassOpen, tick: 0 })).toBeNull();
    expect(followedRegion(doc, 3, { open: bassOpen, tick: 4 * BAR })).toBeNull();
  });

  it('keeps the region the roll shows when its own part is picked back', () => {
    expect(followedRegion(doc, 0, { open: bassOpen, tick: 4 * BAR })).toBe(0);
  });
});
