/**
 * The Roll's moving layers (windsor#602 decisions 3, 5, 6 and 8): the notes
 * and their ghost repeats, the velocity stems, the playhead with the notes
 * it lights, and the key guide on the keyboard, the corner and the chord
 * strip. The colours are the models' (`rollNoteLook.ts`, `rollHarmony.ts`).
 * A selected note (windsor#603) and its stem are ringed in ink; each note
 * carries its index in the roll's list for the gestures. A note still held
 * while Rec records (windsor#663) is drawn growing with a record-coloured
 * edge, outside the roll's list, until it is written.
 *
 * Whatever the lane shows (windsor#754, record
 * `2026-10-12-roll-note-accent-and-ratchet` decision 8), an accented note
 * has an ink top edge and a ratcheted one is cut into its hits
 * (`noteMarks`), its ghost repeats too, dimmed with them. The lane under
 * the notes draws the stems, or the Acc or Rat cells (`rollLanePaint.ts`).
 */
import { rollSharedOnsets } from '@windsor/engine';
import { noteName } from './consoleFormat';
import { el } from './dom';
import { type RollTones, tierOf } from './rollHarmony';
import { paintCells } from './rollLanePaint';
import { type RollLane, noteMarks } from './rollMarks';
import { fillPct, instanceLook, noteNamed, stemLook, stemPx, velocityOf } from './rollNoteLook';
import type { RollPanes } from './rollPanes';
import { type RollInstance, heldStart, sounding } from './rollRepeats';
import type { RollScene } from './rollScene';
import { ROLL_MARK_TEXT, ROLL_NOTE, ROLL_PANE_PX, ROLL_REC } from './rollTables';
import type { HeldNote } from './rollTake';

/** One drawn note and what it draws. */
export interface DrawnNote {
  readonly node: HTMLElement;
  readonly instance: RollInstance;
}

const px = (n: number): string => `${n}px`;

/** No chord onsets: a held note is drawn plain anyway. */
const NONE_SHARED: ReadonlySet<number> = new Set();

/** The accent's edge and the ratchet's cuts on a note drawn `w` px wide, and the title's words. */
function markNote(
  node: HTMLElement,
  scene: RollScene,
  instance: RollInstance,
  shared: ReadonlySet<number>,
): string {
  const note = scene.notes[instance.index];
  if (!note) return '';
  const marks = noteMarks(note, instance, { loopTicks: scene.loopTicks, shared });
  node.classList.toggle('accent', marks.accent);
  for (const cut of marks.cuts) {
    const line = el('span', 'roll-hit-cut');
    line.style.left = px(cut * scene.pxPerTick);
    node.appendChild(line);
  }
  const words = [marks.accent ? ROLL_MARK_TEXT.accent : ''];
  if (marks.cuts.length > 0) words.push(ROLL_MARK_TEXT.ratchet(marks.cuts.length + 1));
  return words
    .filter(Boolean)
    .map((w) => ` · ${w}`)
    .join('');
}

function noteNode(
  scene: RollScene,
  instance: RollInstance,
  sel: boolean,
  shared: ReadonlySet<number> = NONE_SHARED,
): HTMLElement | null {
  const note = scene.notes[instance.index];
  const row = note ? scene.rowByPitch.get(note.pitch) : undefined;
  if (!note || !row) return null;
  const look = instanceLook(note, instance, row, scene.place);
  const top = row.thin ? row.top : row.top + 1;
  const h = row.thin ? row.h : row.h - 1;
  const w = Math.max(ROLL_NOTE.minWPx, instance.ticks * scene.pxPerTick - 1);
  const ghost = instance.pass > 0 ? ' ghost' : '';
  const ring = sel ? ' sel' : '';
  const node = el(
    'div',
    `roll-note ${look}${ghost}${ring}`,
    noteNamed(w, h) ? noteName(note.pitch) : '',
  );
  node.dataset.index = String(instance.index);
  node.style.left = px(instance.start * scene.pxPerTick);
  node.style.top = px(top);
  node.style.width = px(w);
  node.style.height = px(h);
  node.style.setProperty('--vm', `${fillPct(velocityOf(note))}%`);
  const marked = markNote(node, scene, instance, shared);
  if (instance.parked) node.title = `${noteName(note.pitch)}: past the loop, kept and silent`;
  else if (!ghost) {
    node.title = `${noteName(note.pitch)} · vel ${velocityOf(note).toFixed(2)}${marked}`;
  }
  return node;
}

function stemNode(scene: RollScene, instance: RollInstance, sel: boolean): HTMLElement | null {
  const note = scene.notes[instance.index];
  if (!note || instance.parked || !scene.rowByPitch.has(note.pitch)) return null;
  const ghost = instance.pass > 0 ? ' ghost' : '';
  const ring = sel ? ' sel' : '';
  const stem = el('span', `roll-stem ${stemLook(note, instance, scene.place)}${ghost}${ring}`);
  stem.style.left = px(instance.start * scene.pxPerTick);
  stem.style.height = px(stemPx(velocityOf(note), ROLL_PANE_PX.vel));
  return stem;
}

/** What one paint of the notes draws: the instances in the window, the selection, the lane. */
export interface NotesPaint {
  readonly instances: readonly RollInstance[];
  readonly selected: ReadonlySet<number>;
  readonly lane: RollLane;
}

/**
 * The notes of `instances`, the ones the view's window holds
 * (`rollInstances`), the `selected` notes ringed on their own pass, and
 * under them the lane's stems or cells; returns the drawn notes and the
 * lane's playhead.
 */
export function paintNotes(
  panes: RollPanes,
  layer: HTMLElement,
  scene: RollScene,
  paint: NotesPaint,
): { drawn: DrawnNote[]; ph: HTMLElement } {
  const drawn: DrawnNote[] = [];
  const shared = rollSharedOnsets(scene.notes);
  const notes = document.createDocumentFragment();
  const stems = document.createDocumentFragment();
  for (const instance of paint.instances) {
    const sel = instance.pass === 0 && paint.selected.has(instance.index);
    const node = noteNode(scene, instance, sel, shared);
    if (!node) continue;
    notes.appendChild(node);
    drawn.push({ node, instance });
    const stem = paint.lane === 'vel' ? stemNode(scene, instance, sel) : null;
    if (stem) stems.appendChild(stem);
  }
  layer.replaceChildren(notes);
  panes.vel.dataset.lane = paint.lane;
  panes.velIn.style.width = px(scene.width + ROLL_PANE_PX.overhang);
  const ph = el('span', 'roll-ph');
  const under = paint.lane === 'vel' ? stems : paintCells(scene, paint.lane, paint);
  panes.velIn.replaceChildren(under, ph);
  return { drawn, ph };
}

/**
 * The notes Rec holds, drawn into the notes `layer` and the velocity lane
 * as they sound so far, each on the pass of the loop it was pressed in
 * (`heldStart`): no index, so no gesture takes them, and a title saying
 * they are written when they stop. Returns what it drew, for the next
 * frame to remove.
 */
export function paintHeld(
  panes: RollPanes,
  layer: HTMLElement,
  scene: RollScene,
  notes: readonly HeldNote[],
): HTMLElement[] {
  const held = { ...scene, notes };
  const drawn: HTMLElement[] = [];
  notes.forEach((note, index) => {
    const start = heldStart(note, scene);
    const instance = { index, start, ticks: note.ticks, pass: 0, parked: false };
    const node = noteNode(held, instance, false);
    // A stem only where the lane shows stems: the Acc and Rat lanes have no cell for a held note.
    const stem = panes.vel.dataset.lane === 'vel' ? stemNode(held, instance, false) : null;
    if (node) {
      delete node.dataset.index;
      node.title = `${noteName(note.pitch)} · ${ROLL_REC.held}`;
      layer.appendChild(node);
    }
    if (stem) panes.velIn.appendChild(stem);
    for (const part of [node, stem]) {
      if (!part) continue;
      part.classList.add('rec-held');
      drawn.push(part);
    }
  });
  return drawn;
}

/**
 * The playhead in every pane at `lit`'s region-local tick, hidden when
 * dark and dim as a ghost while the song is elsewhere; the notes it sounds
 * lit while it is bright.
 */
export function lightPlayhead(
  lines: readonly HTMLElement[],
  drawn: readonly DrawnNote[],
  lit: { step: number; ghost: boolean } | null,
  pxPerTick: number,
): void {
  for (const line of lines) {
    line.hidden = lit === null;
    line.classList.toggle('ghost', lit?.ghost === true);
    if (lit) line.style.left = px(lit.step * pxPerTick);
  }
  const tick = lit && !lit.ghost ? lit.step : null;
  for (const { node, instance } of drawn) {
    node.classList.toggle('on', tick !== null && sounding(instance, tick));
  }
}

/** What the guide paints on. */
export interface GuideTargets {
  readonly keys: readonly HTMLElement[];
  readonly chords: readonly HTMLElement[];
  readonly corner: HTMLElement;
}

/** What the guide shows: the tones, the chord's name and its strip block, and the bar. */
export interface GuidePaint {
  readonly tones: RollTones;
  readonly name: string;
  /** The lit block's index among the strip's, or -1. */
  readonly block: number;
  /** The guide's bar, counted from 1. */
  readonly bar: number;
}

/** Tint the keys for the guide's chord, light its block, and name it in the corner. */
export function paintGuide(targets: GuideTargets, guide: GuidePaint): void {
  for (const key of targets.keys) {
    const tier = tierOf(Number(key.dataset.pitch), guide.tones);
    key.classList.toggle('k-root', tier === 'root');
    key.classList.toggle('k-chord', tier === 'chord');
    key.classList.toggle('k-scale', tier === 'scale');
  }
  targets.chords.forEach((block, i) => block.classList.toggle('guide', i === guide.block));
  const name = el('span', 'roll-guide', guide.name);
  targets.corner.replaceChildren(name, el('span', '', `bar ${guide.bar}`));
}
