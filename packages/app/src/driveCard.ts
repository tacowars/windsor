/**
 * The drive insert's card (#641): Drive, then Tone and Mix, on one page. A
 * strip's Level feeds the insert, so Level changes how hard it drives;
 * Drive is the trim. Its on/off switch is the rack's rail (windsor#173).
 */
import type { InsertCard } from './insertCards';
import { DRIVE_KNOBS } from './insertKnobTables';
import { insertKnobs, pickKnobs } from './insertKnobs';
import { insertPage } from './insertLayout';

export const driveCard: InsertCard = (ctx, slot, index) => [
  {
    name: 'Drive',
    build: () =>
      insertPage(
        ...insertKnobs(ctx, slot, index, pickKnobs(DRIVE_KNOBS, ['drive'])),
        ...insertKnobs(ctx, slot, index, pickKnobs(DRIVE_KNOBS, ['tone', 'mix'])),
      ),
  },
];
