/**
 * A take's finished notes written into the song (windsor#663; record
 * `2026-10-09-roll-recording` decisions 4, 7 and 9): each region's notes
 * merged into the roll it plays through `mergeTake`, every region in one
 * partial, so a write that reaches two regions is one change. A region with
 * no pattern of its own takes a copy of the part's roll first, as the
 * device's own edits do (`regionPatternChange`).
 */
import type { ArrangementDocument, DocumentPartial } from '@windsor/engine';
import { partAt, regionPattern } from '@windsor/engine';
import { partChange } from './context';
import { patternCopy } from './partEdits';
import { type TakeWrite, mergeTake } from './rollTake';

/**
 * The partial that writes `writes` into part `slot`'s regions, or null when
 * the part is gone or none of the regions named is still a roll. A region
 * index the part no longer has gets no write.
 */
export function takeWriteChange(
  doc: ArrangementDocument,
  slot: number,
  writes: readonly TakeWrite[],
): DocumentPartial | null {
  const part = partAt(doc, slot);
  if (!part) return null;
  const notesOf = new Map(writes.map((write) => [write.regionIndex, write.notes]));
  let wrote = false;
  const regions = part.regions.map((region, index) => {
    const notes = notesOf.get(index);
    const roll = regionPattern(part, index);
    if (!notes || roll.kind !== 'roll') return region;
    wrote = true;
    const { config } = mergeTake({ loopTicks: roll.loopTicks, notes: roll.notes }, notes);
    return { ...region, pattern: { ...patternCopy(part, index), notes: config.notes } };
  });
  return wrote ? partChange(slot, { regions }) : null;
}
