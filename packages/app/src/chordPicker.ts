/**
 * The chord picker (#607, #705): one Hit tile — named for the chord the
 * harmony timeline holds under the playhead — one Rest tile, and the part's
 * voicing. Pressing the Hit tile sounds the current chord through the chord
 * part the card belongs to (epic #605 decision 8); dragging it, or the Rest
 * tile, carries a ghost onto a step of the card's strip. The press-and-drag
 * behaviour is `chordDrag.ts`'s state machine; this file is its DOM.
 */
import type {
  AudioPart,
  ChordSpec,
  ChordVoicingId,
  Harmony,
  HarmonyChord,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  CHORD_VOICINGS,
  CHORD_VOICING_IDS,
} from '../../../packages/client/src/audio/index-for-editor';
import { CHORD_AUDITION_VELOCITY, CHORD_GHOST_OFFSET } from './chordConstants';
import {
  type ChordDragController,
  type ChordDragHost,
  type ChordDragPaint,
  createChordDrag,
} from './chordDrag';
import { REST_CHIP, auditionNotes, hitChip, type Chip, type ChordPayload } from './chordStepModel';
import { el, escapeHtml, html, select } from './dom';

export interface PickerHost {
  harmony(): Harmony;
  /** The chord under the playhead now: what the Hit tile names and sounds. */
  currentChord(): HarmonyChord | null;
  spec(): ChordSpec | null;
  /** The engine part the chips sound through: the chord part itself. */
  part(): AudioPart | null;
  setVoicing(voicing: ChordVoicingId): void;
  /** The step index under a client point, the list's length for the append zone, or null. */
  targetAt(x: number, y: number): number | null;
  /** Light the column a drag is over, or none. */
  highlight(index: number | null): void;
  drop(payload: ChordPayload, index: number): void;
}

export interface Picker {
  readonly root: HTMLElement;
  /** Redraw the tiles for the current chord; the voicing control stays. */
  repaint(): void;
}

/** One `.chip`: the chord's name over its numeral, or the Rest tile. */
export function chipButton(chip: Chip): HTMLButtonElement {
  const node = html(
    'button',
    chip.payload.kind === 'rest' ? 'chip rest' : 'chip',
    `<span class="chip-name">${escapeHtml(chip.name)}</span><span class="chip-num">${escapeHtml(chip.numeral)}</span>`,
  ) as HTMLButtonElement;
  node.type = 'button';
  node.title =
    chip.payload.kind === 'rest'
      ? 'Drag onto a step to make it a rest'
      : 'Press to hear the current chord, drag onto a step to place a hit';
  return node;
}

/* ---------------------------------------------------------------- the ghost */

let ghost: HTMLElement | null = null;

function paintGhost(state: ChordDragPaint | null, label: string): void {
  if (!state) {
    if (ghost) ghost.style.display = 'none';
    return;
  }
  if (!ghost) {
    ghost = el('div', 'chord-ghost');
    document.body.appendChild(ghost);
  }
  ghost.textContent = label;
  ghost.style.display = 'block';
  ghost.style.transform = `translate(${state.x + CHORD_GHOST_OFFSET.x}px, ${state.y + CHORD_GHOST_OFFSET.y}px)`;
}

/** What a payload reads on the ghost. */
function labelFor(payload: ChordPayload): string {
  return payload.kind === 'rest' ? REST_CHIP.name : 'Hit';
}

/* ---------------------------------------------------------------- the picker */

const VOICING_OPTIONS = CHORD_VOICING_IDS.map((id) => ({
  value: id,
  label: CHORD_VOICINGS[id].label,
}));

/** The engine side of a tile press: the current chord's notes through the chord part, and letting them go. */
function auditionHost(host: PickerHost): Pick<ChordDragHost, 'audition' | 'silence'> {
  let sounding: { part: AudioPart; ids: number[] } | null = null;
  return {
    audition(payload) {
      const part = host.part();
      const spec = host.spec();
      if (!part || !spec) return;
      const notes = auditionNotes(host.harmony(), host.currentChord(), payload, spec);
      sounding = { part, ids: notes.map((note) => part.noteOn(note, CHORD_AUDITION_VELOCITY)) };
    },
    silence() {
      if (!sounding) return;
      for (const id of sounding.ids) sounding.part.noteOff(id);
      sounding = null;
    },
  };
}

/**
 * Escape cancels the drag in progress. One window listener for the page,
 * bound once, pointing at whichever picker's controller last took a press —
 * a listener per picker would keep every discarded card alive, since the
 * tabs re-render by replacing their DOM.
 */
let active: ChordDragController | null = null;
let keysBound = false;

function bindKeys(): void {
  if (keysBound) return;
  keysBound = true;
  window.addEventListener('keydown', (e) => {
    if (active?.dragging && e.key === 'Escape') active.cancel();
  });
}

/** Pointer capture on one chip, routed into the drag state machine. */
function bindChip(node: HTMLElement, payload: ChordPayload, drag: ChordDragController): void {
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    node.setPointerCapture(e.pointerId);
    // A press in another picker takes the key over; the drag it interrupts is cancelled, not orphaned.
    if (active && active !== drag) active.cancel();
    active = drag;
    drag.down(payload, e.clientX, e.clientY);
  });
  node.addEventListener('pointermove', (e) => drag.move(e.clientX, e.clientY));
  node.addEventListener('pointerup', (e) => {
    if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
    drag.up(e.clientX, e.clientY);
    if (active === drag) active = null;
  });
  node.addEventListener('pointercancel', () => {
    drag.cancel();
    if (active === drag) active = null;
  });
}

export function chordPicker(host: PickerHost): Picker {
  const root = el('div', 'chord-picker-wrap');

  const drag = createChordDrag({
    ...auditionHost(host),
    targetAt: (x, y) => host.targetAt(x, y),
    paint(state) {
      host.highlight(state?.over ?? null);
      document.body.classList.toggle('chord-dragging', state !== null);
      paintGhost(state, state ? labelFor(state.payload) : '');
    },
    apply: (payload, index) => host.drop(payload, index),
  });
  bindKeys();

  const chipRow = el('div', 'chord-picker');
  const repaint = (): void => {
    const chips: Chip[] = [hitChip(host.harmony(), host.currentChord()), REST_CHIP];
    chipRow.innerHTML = '';
    for (const chip of chips) {
      const node = chipButton(chip);
      bindChip(node, chip.payload, drag);
      chipRow.appendChild(node);
    }
  };

  const controls = el('div', 'chord-picker-controls');
  controls.appendChild(
    select('Voicing', VOICING_OPTIONS, host.spec()?.voicing ?? CHORD_VOICING_IDS[0]!, (value) =>
      host.setVoicing(value as ChordVoicingId),
    ),
  );
  root.appendChild(controls);
  root.appendChild(chipRow);
  repaint();
  return { root, repaint };
}
