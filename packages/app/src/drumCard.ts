/**
 * The Drum's card (windsor#948): a stub until the Drum device is built
 * (the plan's ticket 4/4). The engine plays a Drum part already; this keeps
 * the registry whole, so the sequencer select offers Drum and the Song pane
 * draws a sentence rather than a blank section.
 */
import { el } from './dom';
import type { SequencerCard } from './sequencerCards';

export const drumCard: SequencerCard = () => el('p', 'hint', 'The Drum device is on its way.');
