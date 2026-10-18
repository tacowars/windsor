/**
 * The Transient's card (record `2026-10-18-transient-insert` decision 9):
 * one page on the compressor card's row. Attack and Sustain in a column of
 * two, Output beside them, Mix at the rack's big dial, then the bipolar gain
 * meter in a column of its own. Every knob commits the complete insert list
 * into the song; the on/off switch is the rack's rail.
 */
import { transientMeter } from './transientMeter';
import { TRANSIENT_KNOBS } from './transientTables';
import type { InsertCard } from './insertCards';
import { bigInsertKnobs, insertKnobs, pickKnobs } from './insertKnobs';
import { insertColumn, insertPage } from './insertLayout';

export const transientCard: InsertCard = (ctx, slot, index) => [
  {
    name: 'Transient',
    build: () =>
      insertPage(
        ...insertKnobs(
          ctx,
          slot,
          index,
          pickKnobs(TRANSIENT_KNOBS, ['attack', 'sustain', 'output']),
        ),
        ...bigInsertKnobs(ctx, slot, index, pickKnobs(TRANSIENT_KNOBS, ['mix'])),
        insertColumn(transientMeter(ctx, slot, index)),
      ),
  },
];
