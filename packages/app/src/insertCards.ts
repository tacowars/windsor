/**
 * The Mixer tab's insert-card registry (#641): one entry per insert kind the
 * engine declares, the way `SEQUENCER_CARDS` covers the sequencer kinds.
 * `stripInserts.ts` looks an insert's card up here instead of branching on its
 * kind, so a new kind is a new card file and an appended entry, and
 * `insertCards.test.ts` fails the moment a kind arrives without one.
 */
import type { InsertKindName } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { chorusCard } from './chorusCard';
import { driveCard } from './driveCard';

/** The knobs of the insert at `index` in the part's strip. */
export type InsertCard = (ctx: AppCtx, slot: number, index: number) => HTMLElement;

export const INSERT_CARDS: Readonly<Record<InsertKindName, InsertCard>> = {
  drive: driveCard,
  chorus: chorusCard,
};
