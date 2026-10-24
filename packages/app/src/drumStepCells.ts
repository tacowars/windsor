/**
 * The Drum's step cells (windsor#951; the approved mockup
 * `docs/design/drum-device-mockup.html`, record `2026-10-24-drum-device`),
 * held at the top of a step column, top down:
 *
 * - **the hit pad**, 32 px square (decision 6): a 12 px dot in the part's
 *   accent for a hit, dimmed under velocity 0.5 (decision 3), an empty ring
 *   for a rest; a click toggles, and a new hit plays at 1;
 * - **the Vel bar**, the Figure's (`figureCells.ts`): the value written on
 *   it, a fill across to it (decision 5), faint and unfilled at 1; a
 *   vertical drag previews it and writes it on release, a double-click puts
 *   it back to 1;
 * - **Pitch**, the played note's name (decision 1), faint at offset 0, the
 *   signed offset in its tooltip; a vertical drag moves it a semitone per
 *   8 px within ±24, previewed and written on release, and a double-click
 *   puts it back to the part's note;
 * - **A** and **the ratchet**, the Arp's.
 *
 * A rest keeps the column's height with blank cells and a grey, inert
 * ratchet. A gesture hands the strip an edit of the step, which it writes
 * to the step as the document holds it now; the rules are `drumGridModel.ts`
 * and `drumModel.ts`.
 */
import type { DrumStep } from '@windsor/engine';
import {
  cycleHitRatchet,
  hitRatchet,
  hitVelocity,
  isGhost,
  setHitVelocity,
  toggleHit,
  toggleHitAccent,
} from './drumGridModel';
import { dragPitch, hitPitch, pitchLabel, pitchTitle, setHitPitch } from './drumModel';
import { DRUM_PITCH_DRAG, DRUM_TEXT } from './drumTables';
import { capturePointer } from './figureCells';
import { FIGURE_VEL } from './figureConstants';
import { dragVelocity, velocityLabel } from './figureModel';
import { ratchetCell } from './ratchetCell';
import { stripCell as cell } from './stepStrip';

/** Apply `edit` to the column's step as the document holds it, and write it back. */
export type DrumStepEdit = (edit: (step: DrumStep) => DrumStep) => void;

/** What one column's cells draw: the step, the part's note, and where an edit goes. */
export interface DrumCellsSpec {
  readonly index: number;
  readonly step: DrumStep;
  /** The part's base note, which the Pitch cell names the played note over. */
  readonly note: number;
  readonly edit: DrumStepEdit;
}

/** A vertical drag on a cell: from a value, the value a drag reaches, its preview and its write. */
interface VerticalDrag {
  readonly from: number;
  readonly thresholdPx: number;
  reach(from: number, dy: number): number;
  paint(value: number): void;
  write(value: number): void;
}

/** Preview a vertical drag on `node` and write it once, on release; a click writes nothing. */
function wireVerticalDrag(node: HTMLElement, drag: VerticalDrag): void {
  let press: { id: number; y: number; moved: boolean; value: number } | null = null;
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    press = { id: e.pointerId, y: e.clientY, moved: false, value: drag.from };
    capturePointer(node, e.pointerId);
  });
  node.addEventListener('pointermove', (e) => {
    if (!press || e.pointerId !== press.id) return;
    const dy = e.clientY - press.y;
    if (!press.moved && Math.abs(dy) < drag.thresholdPx) return;
    press.moved = true;
    press.value = drag.reach(drag.from, dy);
    drag.paint(press.value);
  });
  const end = (commit: boolean): void => {
    const done = press;
    press = null;
    if (!done) return;
    if (commit && done.moved && done.value !== drag.from) drag.write(done.value);
    else drag.paint(drag.from);
  };
  node.addEventListener('pointerup', () => end(true));
  node.addEventListener('pointercancel', () => end(false));
  node.addEventListener('lostpointercapture', () => end(true));
}

function hitCell({ index, step, edit }: DrumCellsSpec): HTMLElement {
  const hit = step.kind === 'hit';
  const node = cell('', hit ? `note drum-hit${isGhost(step) ? ' ghost' : ''}` : 'drum-hit rest');
  node.appendChild(document.createElement('i'));
  node.title = hit ? DRUM_TEXT.hitTitle : DRUM_TEXT.restTitle;
  node.setAttribute('aria-label', `Step ${index + 1}: ${step.kind}`);
  node.onclick = (): void => edit(toggleHit);
  return node;
}

/** Draw the Vel bar at `velocity`: the fill and the value, faint at full. */
function paintVelocity(node: HTMLElement, velocity: number): void {
  const fill = node.querySelector<HTMLElement>('i');
  const text = node.querySelector<HTMLElement>('span');
  if (fill) fill.style.width = `${velocity * FIGURE_VEL.fullPct}%`;
  if (text) text.textContent = velocityLabel(velocity);
  node.classList.toggle('full', velocity >= 1);
  node.setAttribute('aria-valuenow', String(velocity));
  node.title = `velocity ${velocity.toFixed(2)}: drag up or down, double-click for 1`;
}

function velocityCell({ index, step, edit }: DrumCellsSpec): HTMLElement {
  if (step.kind !== 'hit') return cell('', 'vel blank');
  const node = cell('', 'vel');
  node.append(document.createElement('i'), document.createElement('span'));
  node.setAttribute('role', 'slider');
  node.setAttribute('aria-label', `Step ${index + 1} velocity`);
  node.setAttribute('aria-valuemin', '0');
  node.setAttribute('aria-valuemax', '1');
  const velocity = hitVelocity(step);
  paintVelocity(node, velocity);
  const write = (v: number): void => edit((s) => setHitVelocity(s, v));
  wireVerticalDrag(node, {
    from: velocity,
    thresholdPx: FIGURE_VEL.thresholdPx,
    reach: dragVelocity,
    paint: (v) => paintVelocity(node, v),
    write,
  });
  node.addEventListener('dblclick', () => write(1));
  return node;
}

/** Draw the Pitch cell at offset `pitch` over `note`: the played note, faint at 0. */
function paintPitch(node: HTMLElement, note: number, pitch: number): void {
  node.textContent = pitchLabel(note, pitch);
  node.title = pitchTitle(note, pitch);
  node.classList.toggle('note', pitch !== 0);
  node.classList.toggle('flat', pitch === 0);
}

function pitchCell(spec: DrumCellsSpec): HTMLElement {
  const { index, step, note, edit } = spec;
  if (step.kind !== 'hit') return cell('', 'blank');
  const node = cell('', 'pitch');
  node.setAttribute('aria-label', `Step ${index + 1} pitch`);
  const pitch = hitPitch(step);
  paintPitch(node, note, pitch);
  const write = (p: number): void => edit((s) => setHitPitch(s, p));
  wireVerticalDrag(node, {
    from: pitch,
    thresholdPx: DRUM_PITCH_DRAG.thresholdPx,
    reach: (from, dy) => dragPitch(from, dy),
    paint: (p) => paintPitch(node, note, p),
    write,
  });
  node.addEventListener('dblclick', () => write(0));
  return node;
}

function accentCell({ step, edit }: DrumCellsSpec): HTMLElement {
  if (step.kind !== 'hit') return cell('', 'blank');
  const node = cell('A');
  node.title = DRUM_TEXT.accent;
  node.setAttribute('aria-pressed', String(step.accent));
  node.onclick = (): void => edit(toggleHitAccent);
  return node;
}

function ratchet({ index, step, edit }: DrumCellsSpec): HTMLElement {
  const node = ratchetCell({
    step: index,
    roll: hitRatchet(step),
    takes: step.kind === 'hit',
    cycle: () => edit((s) => cycleHitRatchet(s)),
  });
  if (step.kind !== 'hit') {
    node.title = DRUM_TEXT.restRatchetTitle;
    node.setAttribute('aria-label', `Step ${index + 1} ratchet: none on a rest`);
  }
  return node;
}

/** Step `index`'s held cells, top down: the hit pad, Vel, Pitch, A and the ratchet. */
export const drumStepCells = (spec: DrumCellsSpec): HTMLElement[] => [
  hitCell(spec),
  velocityCell(spec),
  pitchCell(spec),
  accentCell(spec),
  ratchet(spec),
];
