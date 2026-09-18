/**
 * The chord picker (#607): the key's diatonic chords as chips — name over
 * Roman numeral — at the picker's size (triads or sevenths), the part's
 * voicing, and a Rest tile. Pressing a chip sounds it through the chord part
 * the card belongs to (epic #605 decision 8); dragging it, or the Rest tile,
 * carries a ghost onto a step of the card's strip. The press-and-drag
 * behaviour is `chordDrag.ts`'s state machine; this file is its DOM.
 */
import type {
  ArrangementKey,
  AudioPart,
  ChordSize,
  ChordSpec,
  ChordVoicingId,
} from '../../../packages/client/src/audio/index-for-editor';
import {
  CHORD_SIZE_SEVENTH,
  CHORD_SIZE_TRIAD,
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
import {
  REST_CHIP,
  auditionNotes,
  pickerChips,
  type Chip,
  type ChordPayload,
} from './chordStepModel';
import { el, escapeHtml, html, seg, select } from './dom';
import { PITCH_COLOR } from './consoleColors';

export interface PickerHost {
  key(): ArrangementKey;
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
  /** Redraw the chips from the host's key; the size and voicing controls stay. */
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
      : 'Press to hear, drag onto a step to place';
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

/** What a payload reads on the ghost, from the chips drawn for the current key. */
function labelFor(payload: ChordPayload, chips: readonly Chip[]): string {
  if (payload.kind === 'rest') return REST_CHIP.name;
  const chip = chips.find((c) => c.payload.kind === 'chord' && c.payload.degree === payload.degree);
  return chip ? `${chip.name} ${chip.numeral}` : `degree ${payload.degree + 1}`;
}

/* ---------------------------------------------------------------- the picker */

const SIZE_OPTIONS = [
  { value: String(CHORD_SIZE_TRIAD), label: 'Triads' },
  { value: String(CHORD_SIZE_SEVENTH), label: '7ths' },
];

const VOICING_OPTIONS = CHORD_VOICING_IDS.map((id) => ({
  value: id,
  label: CHORD_VOICINGS[id].label,
}));

/** The engine side of a chip press: which notes to sound through the chord part, and letting them go. */
function auditionHost(host: PickerHost): Pick<ChordDragHost, 'audition' | 'silence'> {
  let sounding: { part: AudioPart; ids: number[] } | null = null;
  return {
    audition(payload) {
      const part = host.part();
      const spec = host.spec();
      if (!part || !spec) return;
      const notes = auditionNotes(host.key(), payload, spec.voicing, spec.register.octave);
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
  let size: ChordSize = CHORD_SIZE_TRIAD;
  let chips: Chip[] = [];

  const drag = createChordDrag({
    ...auditionHost(host),
    targetAt: (x, y) => host.targetAt(x, y),
    paint(state) {
      host.highlight(state?.over ?? null);
      document.body.classList.toggle('chord-dragging', state !== null);
      paintGhost(state, state ? labelFor(state.payload, chips) : '');
    },
    apply: (payload, index) => host.drop(payload, index),
  });
  bindKeys();

  const chipRow = el('div', 'chord-picker');
  const repaint = (): void => {
    chips = pickerChips(host.key(), size);
    chipRow.innerHTML = '';
    for (const chip of [...chips, REST_CHIP]) {
      const node = chipButton(chip);
      bindChip(node, chip.payload, drag);
      chipRow.appendChild(node);
    }
  };

  const controls = el('div', 'chord-picker-controls');
  controls.appendChild(
    seg(
      SIZE_OPTIONS,
      () => String(size),
      (value) => {
        size = Number(value) === CHORD_SIZE_SEVENTH ? CHORD_SIZE_SEVENTH : CHORD_SIZE_TRIAD;
        repaint();
      },
      PITCH_COLOR,
    ),
  );
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
