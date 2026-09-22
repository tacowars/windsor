/**
 * The drive insert's card (#641): Drive, Tone and Mix. A strip's Level feeds
 * the insert, so Level changes how hard it drives; Drive is the trim.
 */
import type { InsertCard } from './insertCards';
import { DRIVE_KNOBS } from './insertKnobTables';
import { insertKnobs } from './insertKnobs';

export const driveCard: InsertCard = (ctx, slot, index) =>
  insertKnobs(ctx, slot, index, DRIVE_KNOBS);
