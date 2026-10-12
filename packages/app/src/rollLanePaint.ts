/**
 * The Acc and Rat faces of the lane under the notes (windsor#754; record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 7, the mockup's
 * `.acc-cell` and `.rat-cell`). Acc draws a square under each note's onset,
 * the Grid's A cell, lit in the note's harmony colour when accented; Rat a
 * cell as wide as the note, holding its count and one bar per hit, lit past
 * one hit, and drawn disabled on a note too short for a ratchet. A chord's
 * notes, parked notes and repeats drawn as runs get no cell (`cellState`).
 * A ghost repeat's cell is dimmed and takes no click; a live cell carries
 * its note's index for the click (`rollLaneGestures.ts`).
 */
import type { RollNote } from '@windsor/engine';
import { rollSharedOnsets } from '@windsor/engine';
import { noteName } from './consoleFormat';
import { el } from './dom';
import { type MarkLane, cellBox, cellState, ratchetOf } from './rollMarks';
import { stemLook } from './rollNoteLook';
import type { RollInstance } from './rollRepeats';
import type { RollScene } from './rollScene';
import { ROLL_MARK_TEXT, ROLL_NOTE } from './rollTables';

const px = (n: number): string => `${n}px`;

/** One Acc cell's face. */
function accFace(cell: HTMLElement, note: RollNote, live: boolean): void {
  const on = note.accent === true;
  cell.classList.toggle('on', on);
  cell.textContent = ROLL_MARK_TEXT.accCell;
  if (live) {
    cell.title = `${noteName(note.pitch)}: ${on ? ROLL_MARK_TEXT.accOn : ROLL_MARK_TEXT.accOff}`;
  }
}

/** One Rat cell's face: its count, then a bar per hit. */
function ratFace(cell: HTMLElement, note: RollNote, live: boolean, disabled: boolean): void {
  const hits = ratchetOf(note);
  cell.classList.toggle('on', hits > 1);
  cell.classList.toggle('disabled', disabled);
  const bars = el('span', 'roll-hits');
  for (let k = 0; k < hits; k++) bars.appendChild(el('i'));
  cell.append(el('b', '', `×${hits}`), bars);
  if (disabled) cell.title = `${noteName(note.pitch)}: ${ROLL_MARK_TEXT.ratShort}`;
  else if (live) cell.title = `${noteName(note.pitch)}: ${ROLL_MARK_TEXT.ratTitle(hits)}`;
}

/** The `lane` cell under `instance`, or null where none is drawn. */
function cellNode(
  scene: RollScene,
  instance: RollInstance,
  at: { readonly lane: MarkLane; readonly shared: ReadonlySet<number>; readonly sel: boolean },
): HTMLElement | null {
  const note = scene.notes[instance.index];
  if (!note || !scene.rowByPitch.has(note.pitch)) return null;
  const state = cellState(at.lane, note, instance, at.shared);
  if (state === 'none') return null;
  const ghost = instance.pass > 0;
  const widthPx = Math.max(ROLL_NOTE.minWPx, instance.ticks * scene.pxPerTick - 1);
  const box = cellBox(at.lane, { leftPx: instance.start * scene.pxPerTick, widthPx });
  const tier = stemLook(note, instance, scene.place);
  const cell = el(
    'span',
    `roll-${at.lane}-cell ${tier}${ghost ? ' ghost' : ''}${at.sel ? ' sel' : ''}`,
  );
  cell.style.left = px(box.left);
  cell.style.width = px(box.width);
  const live = !ghost && state === 'live';
  if (live) cell.dataset.index = String(instance.index);
  if (at.lane === 'acc') accFace(cell, note, live);
  else ratFace(cell, note, live, state === 'disabled');
  return cell;
}

/**
 * The `lane` cells for `instances`, the `selected` notes' ringed on their
 * own pass, as one fragment for the lane's layer.
 */
export function paintCells(
  scene: RollScene,
  lane: MarkLane,
  paint: { readonly instances: readonly RollInstance[]; readonly selected: ReadonlySet<number> },
): DocumentFragment {
  const shared = rollSharedOnsets(scene.notes);
  const cells = document.createDocumentFragment();
  for (const instance of paint.instances) {
    const sel = instance.pass === 0 && paint.selected.has(instance.index);
    const cell = cellNode(scene, instance, { lane, shared, sel });
    if (cell) cells.appendChild(cell);
  }
  return cells;
}
