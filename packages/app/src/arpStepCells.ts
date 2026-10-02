/**
 * The Arp's step cells (windsor#137; the device, windsor#370), held at the
 * top of a step column: `♪ — ·` (click for note → tie → rest), Oct (click
 * up, shift-click down), A, S and the ratchet. The Arp draws them over its
 * cycle and Basslead over its strip (windsor#371, record
 * `2026-10-01-sequencer-rack-devices` decision 9), since a Basslead step is
 * the Arp's cell (`BassStep` is `ArpStep`). A rest or a tie keeps the
 * column's height with blank cells and a grey, inert ratchet.
 *
 * A click hands the card an edit of the step, and the card writes it to
 * the step as the document holds it now: the cell edits are
 * `gridModel.ts`'s, the kind cycle `arpGridModel.ts`'s, the ratchet's
 * `ratchetModel.ts`'s.
 */
import type { ArpStep } from '@windsor/engine';
import { arpKindLabel, arpOctaveLabel, nextArpKind } from './arpGridModel';
import { cycleOctave, toggleFlag } from './gridModel';
import { ratchetCell } from './ratchetCell';
import { cycleStepRatchet, stepRatchet, takesRatchet } from './ratchetModel';
import { stripCell as cell } from './stepStrip';

/** Apply `edit` to the column's step as the document holds it, and write it back. */
export type StepEdit = (edit: (step: ArpStep) => ArpStep) => void;

function kindCell(step: ArpStep, edit: StepEdit): HTMLElement {
  const node = cell(arpKindLabel(step), step.kind === 'note' ? 'note' : '');
  node.title = `${step.kind}: click for note → tie → rest`;
  node.onclick = (): void => edit(nextArpKind);
  return node;
}

function octaveCell(step: ArpStep, edit: StepEdit): HTMLElement {
  if (step.kind !== 'note') return cell('', 'blank');
  const node = cell(arpOctaveLabel(step.octave), step.octave === 0 ? 'oct dim' : 'oct');
  node.title = 'octave shift: click up, shift-click down';
  node.onclick = (event: MouseEvent): void => edit((s) => cycleOctave(s, event.shiftKey ? -1 : 1));
  return node;
}

function flagCell(step: ArpStep, edit: StepEdit, flag: 'accent' | 'slide'): HTMLElement {
  if (step.kind !== 'note') return cell('', 'blank');
  const node = cell(flag === 'accent' ? 'A' : 'S');
  node.title = flag;
  node.setAttribute('aria-pressed', String(step[flag]));
  node.onclick = (): void => edit((s) => toggleFlag(s, flag));
  return node;
}

/** Step `index`'s held cells, top down: `♪ — ·`, Oct, A, S, then the ratchet. */
export function arpStepCells(index: number, step: ArpStep, edit: StepEdit): HTMLElement[] {
  return [
    kindCell(step, edit),
    octaveCell(step, edit),
    flagCell(step, edit, 'accent'),
    flagCell(step, edit, 'slide'),
    ratchetCell({
      step: index,
      roll: stepRatchet(step),
      takes: takesRatchet(step),
      cycle: () => edit(cycleStepRatchet),
    }),
  ];
}
