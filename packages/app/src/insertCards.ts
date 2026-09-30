/**
 * The insert-card registry (#641): one entry per insert kind the engine
 * declares, the way `SEQUENCER_CARDS` covers the sequencer kinds.
 * `stripInserts.ts` looks an insert's card up here instead of branching on its
 * kind, so a new kind is a new card file and an appended entry, and
 * `insertCards.test.ts` fails the moment a kind arrives without one.
 *
 * A card declares its pages (windsor#173, record
 * `2026-09-30-insert-rack-and-send-bus-chains` decision 3) rather than
 * building one element: the rack draws a tab per page when there are two or
 * more, and builds only the page on screen.
 */
import type { InsertTarget } from './insertTarget';
import type { InsertKindName } from '@windsor/engine';
import type { AppCtx } from './context';
import { compressorCard } from './compressorCard';
import { chorusCard } from './chorusCard';
import { advancedDriveCard } from './advancedDriveCard';
import { driveCard } from './driveCard';
import { delayCard } from './delayCard';
import { ensembleCard } from './ensembleCard';
import { tapeCard } from './tapeCard';
import { phaserCard } from './phaserCard';
import { retroReverbCard } from './retroReverbCard';
import { plateReverbCard } from './plateReverbCard';
import { echoCard } from './echoCard';
import { eqCard } from './eqCard';

/**
 * One page of an insert: its tab's name, and the body built when it is
 * shown. The rack keeps the page shown by its name, so two pages of a card
 * never share one. `title` is the tab's tooltip, when the name needs one.
 */
export interface InsertPage {
  readonly name: string;
  readonly title?: string;
  build(): HTMLElement;
}

/** The pages of the insert at `index` in the chain `slot` names, in tab order. */
export type InsertCard = (ctx: AppCtx, slot: InsertTarget, index: number) => readonly InsertPage[];

export const INSERT_CARDS: Readonly<Record<InsertKindName, InsertCard>> = {
  drive: driveCard,
  'advanced-drive': advancedDriveCard,
  chorus: chorusCard,
  compressor: compressorCard,
  'retro-reverb': retroReverbCard,
  phaser: phaserCard,
  tape: tapeCard,
  delay: delayCard,
  ensemble: ensembleCard,
  plate: plateReverbCard,
  echo: echoCard,
  eq: eqCard,
};
