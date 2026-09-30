/**
 * The Mixer tab's insert-card registry (#641): one entry per insert kind the
 * engine declares, the way `SEQUENCER_CARDS` covers the sequencer kinds.
 * `stripInserts.ts` looks an insert's card up here instead of branching on its
 * kind, so a new kind is a new card file and an appended entry, and
 * `insertCards.test.ts` fails the moment a kind arrives without one.
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

/** The knobs of the insert at `index` in the part's strip. */
export type InsertCard = (ctx: AppCtx, slot: InsertTarget, index: number) => HTMLElement;

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
};
