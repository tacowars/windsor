/**
 * The Sequencers tab's card registry (#619 decision 3): one entry per
 * `SequencerKind`, the registry pattern Aotearoa204's game loops used
 * (ADR `2026-09-05-system-registries-folder-ownership-and-data-separate-from-logic`).
 * `sequencersTab.ts` looks a part's card up here instead of branching on its
 * kind, so a new kind is a new card file and an appended entry — and
 * `sequencerCards.test.ts` fails the moment a kind arrives without one, rather
 * than the tab rendering a blank section.
 *
 * The one card that is not its own file is `none`: a part with no sequencer
 * has nothing to draw, so its entry is the sentence that says so.
 */
import type { SequencerKind } from '@windsor/engine';
import { arpCard } from './arpCard';
import { bassCard } from './bassCard';
import { chordCard } from './chordCard';
import type { AppCtx } from './context';
import { el } from './dom';
import type { CardBody } from './sequencerDevice';
import { euclidCard } from './euclidCard';
import { figureCard } from './figureCard';
import { gridCard } from './gridCard';

/**
 * What every card is: the body of one part's section, built from the
 * document. `region` names the region whose pattern the card edits
 * (windsor#75, the grid card since windsor#76); absent, the card edits the
 * part's sequencer. The Song pane frames it as a device
 * (`sequencerDevice.ts`, windsor#368): a converted card returns a
 * `DeviceBody`, one not yet converted its element.
 */
export type SequencerCard = (ctx: AppCtx, slot: number, region?: number) => CardBody;

/** A part with no sequencer: keyboard and MIDI only, so there is nothing to lay out. */
const noneCard: SequencerCard = () =>
  el('p', 'hint', 'No sequencer: this part plays only from the keyboard.');

/** A Roll part until its device lands (windsor#602): the engine loads it and plays nothing yet (windsor#599). */
const rollStandIn: SequencerCard = () =>
  el('p', 'hint', 'Roll: this part plays nothing until the Roll device lands.');

/** One card per kind. A kind added to the engine is an appended entry here. */
export const SEQUENCER_CARDS: Readonly<Record<SequencerKind, SequencerCard>> = {
  none: noneCard,
  euclidean: euclidCard,
  grid: gridCard,
  chord: chordCard,
  arp: arpCard,
  bass: bassCard,
  figure: figureCard,
  roll: rollStandIn,
};
