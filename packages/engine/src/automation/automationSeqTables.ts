/**
 * The sequencer rows of the automation catalog (windsor#488): a lane that
 * moves a part's sequencer, `seq.<field>`, read by the region gate on the
 * tick it issues rather than played on the graph. Which fields a part offers
 * depends on its sequencer kind; a kind left out offers none. The lookups
 * are `automationTargets.ts`, the read `automationSeqLanes.ts`.
 *
 * The Grid offers `skipChance` alone: it has no gate (a Grid note holds to
 * the next note or rest), so a gate lane would have nothing to move.
 */
import { GATE_MIN } from '../audioConstants';
import type { SequencerKind } from '../song/arrangement';
import type { SeqField } from '../sequencing/regionGate';
import type { AutomationTargetRow, SeqTargetId } from './automationLane';

/** The three sequencer rows, each a field the generators read on their onset. */
export const SEQ_AUTOMATION_ROWS: readonly (AutomationTargetRow & {
  readonly target: SeqTargetId;
  readonly field: SeqField;
})[] = [
  {
    target: 'seq.gate',
    field: 'gate',
    label: 'Gate',
    // The Gate knob's floor (windsor#514), so a lane reaches every value the knob does.
    min: GATE_MIN,
    max: 1,
    scale: 'linear',
    unit: '',
  },
  {
    target: 'seq.skipChance',
    field: 'skipChance',
    label: 'Skip',
    min: 0,
    max: 1,
    scale: 'linear',
    unit: '',
  },
  {
    target: 'seq.density',
    field: 'density',
    label: 'Density',
    min: 0,
    max: 1,
    scale: 'linear',
    unit: '',
  },
];

/** The sequencer fields each kind offers a lane, in the picker's order. */
export const SEQ_AUTOMATION_FIELDS: Readonly<Partial<Record<SequencerKind, readonly SeqField[]>>> =
  {
    figure: ['gate', 'skipChance'],
    grid: ['skipChance'],
    arp: ['gate', 'skipChance'],
    bass: ['gate', 'density'],
  };
