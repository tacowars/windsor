/**
 * The chorus insert's card (#642): Rate (Hz), Depth (ms), Spread and Mix.
 */
import type { InsertCard } from './insertCards';
import { CHORUS_KNOBS } from './insertKnobTables';
import { insertKnobs } from './insertKnobs';

export const chorusCard: InsertCard = (ctx, slot, index) =>
  insertKnobs(ctx, slot, index, CHORUS_KNOBS);
