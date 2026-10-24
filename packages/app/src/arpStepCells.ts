/**
 * The Arp's step cells (windsor#137; the device, windsor#370), held at the
 * top of a step column: `♪ — ·` (click for note → tie → rest), Oct (click
 * up, shift-click down), the Gate bar (windsor#934), A, S and the ratchet.
 * The Arp draws them over its cycle and Basslead over its strip
 * (windsor#371, record `2026-10-01-sequencer-rack-devices` decision 9),
 * since a Basslead step is the Arp's cell (`BassStep` is `ArpStep`).
 * Basslead plays no cell gate, so it builds the cells without the Gate row
 * (windsor#934 decision 3). A rest or a tie keeps the column's height with
 * blank cells and a grey, inert ratchet.
 *
 * The Gate bar is the Figure's Vel bar (`figureCells.ts`) over the cell's
 * gate (`docs/design/arp-gate-bar-mockup.html`): its text is the cell's own
 * gate, faint at 1, and its fill the gate the cell plays, the part's Gate
 * times the cell's (`arpPlayedGateAt`), fainter at 1. A vertical drag
 * previews the value and writes it on release; a double-click puts it back
 * to 1. `paintGateFills` repaints every fill when the part's gate moves,
 * leaving the text alone.
 *
 * A click hands the card an edit of the step, and the card writes it to
 * the step as the document holds it now: the cell edits are
 * `gridModel.ts`'s, the kind cycle and the gate `arpGridModel.ts`'s, the
 * ratchet's `ratchetModel.ts`'s.
 */
import type { ArpStep } from '@windsor/engine';
import { GATE_MIN } from '@windsor/engine';
import { ARP_GATE_BAR } from './arpGridConstants';
import {
  arpCellGate,
  arpGateLabel,
  arpGateTitle,
  arpKindLabel,
  arpOctaveLabel,
  arpPlayedGateAt,
  dragArpGate,
  nextArpKind,
  setArpGate,
} from './arpGridModel';
import { capturePointer } from './figureCells';
import { cycleOctave, toggleFlag } from './gridModel';
import { ratchetCell } from './ratchetCell';
import { cycleStepRatchet, stepRatchet, takesRatchet } from './ratchetModel';
import { stripCell as cell } from './stepStrip';

/** Apply `edit` to the column's step as the document holds it, and write it back. */
export type StepEdit = (edit: (step: ArpStep) => ArpStep) => void;

/** The Gate row's option (windsor#934 decision 3): the part's gate now, which the fill multiplies. */
export interface ArpGateRow {
  readonly partGate: () => number;
}

/** The selector of every drawn Gate bar, which `paintGateFills` reaches. */
const GATE_BAR = '.gcell.gate:not(.blank)';

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

/** The fill at the gate cell gate `cellGate` plays under `partGate`, and the title that names both. */
function paintGateFill(node: HTMLElement, cellGate: number, partGate: number): void {
  const played = arpPlayedGateAt(partGate, cellGate);
  const fill = node.querySelector<HTMLElement>('i');
  if (fill) fill.style.width = `${played * ARP_GATE_BAR.fullPct}%`;
  node.title = arpGateTitle(cellGate, played);
}

/** Draw the bar at cell gate `cellGate`: the value, faint at 1, and the fill it plays at. */
function paintGate(node: HTMLElement, cellGate: number, partGate: number): void {
  const text = node.querySelector<HTMLElement>('span');
  if (text) text.textContent = arpGateLabel(cellGate);
  node.classList.toggle('full', cellGate >= 1);
  node.setAttribute('aria-valuenow', String(cellGate));
  paintGateFill(node, cellGate, partGate);
}

/** Repaint every Gate bar's fill under `root` at the part's gate `partGate`; the text stays put. */
export function paintGateFills(root: ParentNode, partGate: number): void {
  for (const node of root.querySelectorAll<HTMLElement>(GATE_BAR)) {
    paintGateFill(node, Number(node.getAttribute('aria-valuenow')), partGate);
  }
}

/** A vertical drag on the bar previews the gate and writes it once, on release. */
function wireGateDrag(
  node: HTMLElement,
  from: number,
  row: ArpGateRow,
  write: (g: number) => void,
): void {
  let press: { id: number; y: number; moved: boolean; value: number } | null = null;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    press = { id: e.pointerId, y: e.clientY, moved: false, value: from };
    capturePointer(node, e.pointerId);
  });
  node.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.abs(dy) < ARP_GATE_BAR.thresholdPx) return;
    press.moved = true;
    press.value = dragArpGate(from, dy);
    paintGate(node, press.value, row.partGate());
  });
  const end = (commit: boolean): void => {
    const done = press;
    press = null;
    if (!done) return;
    if (commit && done.moved && done.value !== from) write(done.value);
    else paintGate(node, from, row.partGate());
  };
  node.addEventListener('pointerup', () => end(true));
  node.addEventListener('pointercancel', () => end(false));
  node.addEventListener('lostpointercapture', () => end(true));
  node.addEventListener('dblclick', () => write(1));
}

function gateCell(index: number, step: ArpStep, edit: StepEdit, row: ArpGateRow): HTMLElement {
  if (step.kind !== 'note') return cell('', 'gate blank');
  const node = cell('', 'gate');
  node.append(document.createElement('i'), document.createElement('span'));
  const gate = arpCellGate(step);
  node.setAttribute('role', 'slider');
  node.setAttribute('aria-label', `Cell ${index + 1} gate`);
  node.setAttribute('aria-valuemin', String(GATE_MIN));
  node.setAttribute('aria-valuemax', '1');
  paintGate(node, gate, row.partGate());
  wireGateDrag(node, gate, row, (g) => edit((s) => setArpGate(s, g)));
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

/**
 * Step `index`'s held cells, top down: `♪ — ·`, Oct, the Gate bar when
 * `gate` is given (the Arp's; Basslead's strip has none), A, S, then the
 * ratchet.
 */
export function arpStepCells(
  index: number,
  step: ArpStep,
  edit: StepEdit,
  gate?: ArpGateRow,
): HTMLElement[] {
  return [
    kindCell(step, edit),
    octaveCell(step, edit),
    ...(gate ? [gateCell(index, step, edit, gate)] : []),
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
