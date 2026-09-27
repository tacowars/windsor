/**
 * The harmony card (#709 decision 2): the detail pane's editor for one
 * chord event — seven degree chips (numeral and pitch name in the key),
 * Triad | Seventh, a Duration dial in bars (beats under Shift), and Delete.
 * Every edit is the pure `harmonyLaneModel.ts` written as one live partial
 * through the view; the dial writes the lanes only, so it survives its own
 * drag, and reads its value back from the document.
 */
import type { ChordSize } from '@windsor/engine';
import { CHORD_SIZE_SEVENTH, CHORD_SIZE_TRIAD, PPQ, TICKS_PER_BAR } from '@windsor/engine';
import { PITCH_COLOR } from './consoleColors';
import { el, seg } from './dom';
import {
  degreeChips,
  durationLabel,
  maxEventDuration,
  removeEvent,
  setDegree,
  setEventDuration,
  setSize,
} from './harmonyLaneModel';
import { makeKnob } from './knob';
import type { SongView } from './songTab';

const SIZE_OPTIONS = [
  { value: String(CHORD_SIZE_TRIAD), label: 'Triad' },
  { value: String(CHORD_SIZE_SEVENTH), label: 'Seventh' },
];

const sizeOf = (value: string): ChordSize =>
  Number(value) === CHORD_SIZE_SEVENTH ? CHORD_SIZE_SEVENTH : CHORD_SIZE_TRIAD;

/** The seven chips; the pressed one is the event's degree. */
function chips(view: SongView, index: number): HTMLElement {
  const { harmony } = view.ctx.model.doc;
  const event = harmony.events[index];
  const row = el('div', 'degrees');
  for (const chip of degreeChips(harmony, event?.size ?? CHORD_SIZE_TRIAD)) {
    const b = el('button', 'dchip') as HTMLButtonElement;
    b.type = 'button';
    b.appendChild(el('b', '', chip.numeral));
    b.appendChild(el('small', '', chip.pitch));
    b.setAttribute('aria-pressed', String(chip.degree === event?.degree));
    b.onclick = (): void => {
      const events = view.ctx.model.doc.harmony.events;
      view.commit({ harmony: { events: setDegree(events, index, chip.degree) } }, true);
    };
    row.appendChild(b);
  }
  return row;
}

/**
 * The Duration dial: a bar per step, a beat with Shift. The grain is the
 * knob's own `step`, read live off the modifier the gesture started with, so
 * the knob quantizes from its press origin (a drag never reverses) and a
 * keyboard nudge moves one grain. The last event holds to the song end and
 * has no dial.
 */
function durationDial(view: SongView, index: number): HTMLElement {
  const events = (): readonly { duration: number }[] => view.ctx.model.doc.harmony.events;
  let fine = false;
  const knob = makeKnob({
    label: 'Duration',
    min: PPQ,
    max: maxEventDuration(view.ctx.model.doc.harmony.events, index, view.songTicks()),
    def: TICKS_PER_BAR,
    get step(): number {
      return fine ? PPQ : TICKS_PER_BAR;
    },
    fmt: durationLabel,
    color: PITCH_COLOR,
    get: () => events()[index]?.duration ?? 0,
    set: (v) => {
      const next = Math.max(PPQ, v);
      if (next === (events()[index]?.duration ?? 0)) return;
      const list = view.ctx.model.doc.harmony.events;
      view.commit({ harmony: { events: setEventDuration(list, index, next, view.songTicks()) } });
    },
  });
  const readModifier = (e: PointerEvent | KeyboardEvent): void => {
    fine = e.shiftKey;
  };
  knob.addEventListener('pointerdown', readModifier, true);
  knob.addEventListener('keydown', readModifier, true);
  return knob;
}

/** The card for the event at `index`. */
export function harmonyCard(view: SongView, index: number): HTMLElement {
  const root = el('div', 'harmony-card');
  const { doc } = view.ctx.model;
  const event = doc.harmony.events[index];
  if (!event) return root;
  root.appendChild(el('span', 'field-label', 'Degree'));
  root.appendChild(chips(view, index));
  const row = el('div', 'bar-row');
  const size = el('div', 'fld');
  size.appendChild(el('span', 'field-label', 'Size'));
  size.appendChild(
    seg(
      SIZE_OPTIONS,
      () => String(doc.harmony.events[index]?.size ?? CHORD_SIZE_TRIAD),
      (value) => {
        const events = view.ctx.model.doc.harmony.events;
        view.commit({ harmony: { events: setSize(events, index, sizeOf(value)) } }, true);
      },
      PITCH_COLOR,
    ),
  );
  row.appendChild(size);
  if (index < doc.harmony.events.length - 1) row.appendChild(durationDial(view, index));
  else
    row.appendChild(el('span', 'hint', `holds to the song end · ${durationLabel(event.duration)}`));
  const remove = el('button', 'btn', 'Delete') as HTMLButtonElement;
  remove.type = 'button';
  remove.title = 'remove this chord; the one before it holds through its bars';
  remove.disabled = doc.harmony.events.length <= 1;
  remove.onclick = (): void => {
    const events = view.ctx.model.doc.harmony.events;
    if (view.commit({ harmony: { events: removeEvent(events, index, view.songTicks()) } }, true)) {
      view.select(null);
    }
  };
  row.appendChild(remove);
  root.appendChild(row);
  return root;
}
