/**
 * The Grid device's step column (#603; the device, windsor#368): row for
 * row, the note cell (note → tie → rest), the degree picker holding only the
 * current scale, Oct (click up, shift-click down), A and S, then the ratchet
 * (`ratchetCell.ts`), all held at the top of the strip, and under them one
 * cell per modulation lane (`stepModLane.ts`). A rest or a tie keeps the
 * column's height with blank cells and a grey ratchet. Every click writes
 * the region's whole step list through `commitSteps`; the step operations
 * are `gridModel.ts` and `ratchetModel.ts`.
 */
import type { GridSpec } from '@windsor/engine';
import {
  cycleKind,
  cycleOctave,
  degreeOptions,
  foldedView,
  setDegree,
  stepLabel,
  toggleFlag,
  withStep,
} from './gridModel';
import { ratchetCell } from './ratchetCell';
import { cycleStepRatchet, stepRatchet, takesRatchet } from './ratchetModel';
import { type LaneHost, laneCells } from './stepModLane';
import { type Strip, commitSteps, stripCell as cell, stripHeadColumn } from './stepStrip';

type GridStrip = Strip<GridSpec>;

function kindCell(strip: GridStrip, index: number, spec: GridSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step) return cell('', 'blank');
  const key = strip.ctx.model.doc.harmony;
  const folded = step.kind === 'note' && foldedView(step.degree, key).folded;
  const node = cell(stepLabel(step, key), step.kind === 'note' ? 'note' : '');
  if (folded) node.classList.add('folded');
  node.title =
    step.kind === 'note'
      ? `degree ${step.degree + 1}: click for tie, rest, note`
      : `${step.kind}: click for the next of note, tie, rest`;
  node.onclick = (): void =>
    commitSteps(strip, (s) => withStep(s.steps, index, cycleKind(s.steps[index] ?? step)));
  return node;
}

function degreeSelect(strip: GridStrip, index: number, spec: GridSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step || step.kind !== 'note') return cell('', 'blank');
  const key = strip.ctx.model.doc.harmony;
  const sel = document.createElement('select');
  sel.className = 'gsel';
  sel.setAttribute('aria-label', `step ${index + 1} degree`);
  sel.title = 'Degree from the key; a red border means it folded into the current scale';
  for (const option of degreeOptions(key)) sel.add(new Option(option.label, option.value));
  const view = foldedView(step.degree, key);
  if (view.folded) {
    // The stored degree is past the scale: show it folded, and keep it as written.
    const shown = degreeOptions(key)[view.degree]?.label ?? '?';
    sel.add(new Option(`${step.degree + 1} → ${shown} ↑${view.carry}`, String(step.degree)));
    sel.classList.add('folded');
  }
  sel.value = String(step.degree);
  sel.onchange = (): void =>
    commitSteps(strip, (s) =>
      withStep(s.steps, index, setDegree(s.steps[index] ?? step, Number(sel.value))),
    );
  return sel;
}

function octaveCell(strip: GridStrip, index: number, spec: GridSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step || step.kind !== 'note') return cell('', 'blank');
  const label = step.octave === 0 ? 'oct' : step.octave > 0 ? `+${step.octave}` : `${step.octave}`;
  const node = cell(label, step.octave === 0 ? 'oct dim' : 'oct');
  node.title = 'octave: click up, shift-click down';
  node.onclick = (event: MouseEvent): void =>
    commitSteps(strip, (s) =>
      withStep(s.steps, index, cycleOctave(s.steps[index] ?? step, event.shiftKey ? -1 : 1)),
    );
  return node;
}

function flagCell(
  strip: GridStrip,
  index: number,
  spec: GridSpec,
  flag: 'accent' | 'slide',
): HTMLElement {
  const step = spec.steps[index];
  if (!step || step.kind !== 'note') return cell('', 'blank');
  const node = cell(flag === 'accent' ? 'A' : 'S');
  node.title = flag;
  node.setAttribute('aria-pressed', String(step[flag]));
  node.onclick = (): void =>
    commitSteps(strip, (s) => withStep(s.steps, index, toggleFlag(s.steps[index] ?? step, flag)));
  return node;
}

function ratchet(strip: GridStrip, index: number, spec: GridSpec): HTMLElement {
  const step = spec.steps[index];
  return ratchetCell({
    step: index,
    roll: stepRatchet(step),
    takes: takesRatchet(step),
    cycle: () =>
      commitSteps(strip, (s) => {
        const now = s.steps[index];
        return now ? withStep(s.steps, index, cycleStepRatchet(now)) : s.steps;
      }),
  });
}

/** Step `index`'s column: the held step rows, then its lane cells; greyed past the loop. */
export function gridColumn(
  strip: GridStrip,
  lanes: LaneHost,
  index: number,
  spec: GridSpec,
): HTMLElement {
  const head = [
    kindCell(strip, index, spec),
    degreeSelect(strip, index, spec),
    octaveCell(strip, index, spec),
    flagCell(strip, index, spec, 'accent'),
    flagCell(strip, index, spec, 'slide'),
    ratchet(strip, index, spec),
  ];
  const sounds = spec.steps[index]?.kind === 'note';
  return stripHeadColumn(index, index < spec.length, head, laneCells(lanes, index, sounds));
}
