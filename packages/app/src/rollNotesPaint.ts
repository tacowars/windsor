/**
 * The Roll's moving layers (windsor#602 decisions 3, 5, 6 and 8): the notes
 * and their ghost repeats, the velocity stems, the playhead with the notes
 * it lights, and the key guide on the keyboard, the corner and the chord
 * strip. The colours are the models' (`rollNoteLook.ts`, `rollHarmony.ts`).
 * A selected note (windsor#603) and its stem are ringed in ink; each note
 * carries its index in the roll's list for the gestures.
 */
import { noteName } from './consoleFormat';
import { el } from './dom';
import { type RollTones, tierOf } from './rollHarmony';
import { fillPct, instanceLook, noteNamed, stemLook, stemPx, velocityOf } from './rollNoteLook';
import type { RollPanes } from './rollPanes';
import { type RollInstance, sounding } from './rollRepeats';
import type { RollScene } from './rollScene';
import { ROLL_NOTE, ROLL_PANE_PX } from './rollTables';

/** One drawn note and what it draws. */
export interface DrawnNote {
  readonly node: HTMLElement;
  readonly instance: RollInstance;
}

const px = (n: number): string => `${n}px`;

function noteNode(scene: RollScene, instance: RollInstance, sel: boolean): HTMLElement | null {
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
  if (instance.parked) node.title = `${noteName(note.pitch)}: past the loop, kept and silent`;
  else if (!ghost) node.title = `${noteName(note.pitch)} · vel ${velocityOf(note).toFixed(2)}`;
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

/**
 * The notes and the stems of `instances`, the ones the view's window holds
 * (`rollInstances`), the `selected` notes ringed on their own pass;
 * returns the drawn notes and the lane's playhead.
 */
export function paintNotes(
  panes: RollPanes,
  layer: HTMLElement,
  scene: RollScene,
  paint: { readonly instances: readonly RollInstance[]; readonly selected: ReadonlySet<number> },
): { drawn: DrawnNote[]; ph: HTMLElement } {
  const drawn: DrawnNote[] = [];
  const notes = document.createDocumentFragment();
  const stems = document.createDocumentFragment();
  for (const instance of paint.instances) {
    const sel = instance.pass === 0 && paint.selected.has(instance.index);
    const node = noteNode(scene, instance, sel);
    if (!node) continue;
    notes.appendChild(node);
    drawn.push({ node, instance });
    const stem = stemNode(scene, instance, sel);
    if (stem) stems.appendChild(stem);
  }
  layer.replaceChildren(notes);
  panes.velIn.style.width = px(scene.width + ROLL_PANE_PX.overhang);
  const ph = el('span', 'roll-ph');
  panes.velIn.replaceChildren(stems, ph);
  return { drawn, ph };
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
