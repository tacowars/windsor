/**
 * The harmony card (#709 decision 2; windsor#332): the detail pane's editor
 * for one chord event, built to the approved mockup
 * (`docs/research/2026-10-02-harmony-card/harmony.html`). Top to bottom: a ▶
 * over each degree chip, the seven chips (numeral and pitch name in the
 * key), Accidental ♭ ♮ ♯ | Triad | Seventh | Quality, then the info bubble,
 * the Duration dial in bars (beats under Shift) and Delete. Every edit is the
 * pure `harmonyLaneModel.ts` written as one live partial through the view;
 * the dial writes the lanes only, so it survives its own drag, and reads its
 * value back from the document. A ▶ held sounds a chord on the audition aux
 * part and writes nothing (`docs/log/2026-10-02-harmony-card-audition.md`).
 */
import type { ChordSize, NamedQuality } from '@windsor/engine';
import {
  CHORD_QUALITIES,
  CHORD_SIZE_SEVENTH,
  CHORD_SIZE_TRIAD,
  PPQ,
  QUALITY_LABELS,
  TICKS_PER_BAR,
} from '@windsor/engine';
import { PITCH_COLOR } from './consoleColors';
import { el, html, seg, select } from './dom';
import {
  AuditionHold,
  auditionChord,
  type AuditionSource,
  type AuditionToken,
} from './harmonyAuditionModel';
import { HARMONY_AUDITION_VELOCITY } from './harmonyAuditionTables';
import {
  degreeChips,
  durationLabel,
  eventLabel,
  maxEventDuration,
  removeEvent,
  setAccidental,
  setDegree,
  setEventDuration,
  setQuality,
  setSize,
  type EventLabel,
} from './harmonyLaneModel';
import { makeKnob } from './knob';
import type { SongView } from './songTab';

const SIZE_OPTIONS = [
  { value: String(CHORD_SIZE_TRIAD), label: 'Triad' },
  { value: String(CHORD_SIZE_SEVENTH), label: 'Seventh' },
];

const ACCIDENTAL_OPTIONS = [
  { value: '-1', label: '♭', title: 'flat: the whole chord a semitone down' },
  { value: '0', label: '♮', title: "natural: the chord on the scale's degree" },
  { value: '1', label: '♯', title: 'sharp: the whole chord a semitone up' },
];

const NAMED_QUALITIES = CHORD_QUALITIES.filter((q): q is NamedQuality => q !== 'other');

/** `''` is the scale's own chord; the rest are the twelve named qualities, in table order. */
const QUALITY_OPTIONS = [
  { value: '', label: "Scale's own" },
  ...NAMED_QUALITIES.map((q) => ({ value: q, label: QUALITY_LABELS[q].name })),
];

const PLAY_ICON =
  '<svg width="8" height="10" viewBox="0 0 8 10" aria-hidden="true"><path d="M0 0l8 5-8 5z"/></svg>';

const sizeOf = (value: string): ChordSize =>
  Number(value) === CHORD_SIZE_SEVENTH ? CHORD_SIZE_SEVENTH : CHORD_SIZE_TRIAD;

const accidentalOf = (value: string): -1 | 0 | 1 => {
  const n = Number(value);
  return n === -1 || n === 1 ? n : 0;
};

const qualityOf = (value: string): NamedQuality | null =>
  NAMED_QUALITIES.find((q) => q === value) ?? null;

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

/** The read-only readout: the selected block's chord, or the one a held ▶ sounds. */
interface InfoBubble {
  readonly node: HTMLElement;
  show(label: EventLabel, sounding: boolean): void;
}

function infoBubble(label: EventLabel): InfoBubble {
  const node = el('span', 'info');
  node.title = "the selected block's chord, or the one sounding";
  const name = el('b');
  const sub = el('small');
  node.append(name, sub);
  const show = (shown: EventLabel, sounding: boolean): void => {
    name.textContent = shown.name;
    sub.textContent = `${shown.numeral} · ${shown.sizeTag}`;
    node.classList.toggle('sounding', sounding);
  };
  show(label, false);
  return { node, show };
}

/**
 * The one chord a ▶ holds, across every card: a second press releases the
 * first, and a card repainted mid-hold cannot strand it. `hold` says which
 * press owns it, so only that press's own up ends it, and a part arriving
 * after its press was let go sounds nothing.
 */
const hold = new AuditionHold();
let held: { release(): void } | null = null;

function releaseHeld(): void {
  const was = held;
  held = null;
  hold.clear();
  was?.release();
}

/** End the hold if this up event (a pointer's id, or null for a key) belongs to the press that owns it. */
function endPress(token: AuditionToken | null, pointerId: number | null): void {
  if (token && hold.releases(token, pointerId)) releaseHeld();
}

/**
 * Sound degree `degree`'s chord until `releaseHeld`; nothing before audio,
 * nothing committed. `detach` runs when the hold ends, superseded or not.
 */
function pressPlay(
  view: SongView,
  index: number,
  degree: number,
  ui: PlayUi,
  press: { source: AuditionSource; detach?: () => void },
): AuditionToken | null {
  releaseHeld();
  const { host, model } = view.ctx;
  const event = model.doc.harmony.events[index];
  if (!host.enabled || !event) return null;
  const chord = auditionChord(model.doc.harmony, event, degree);
  const token = hold.press(press.source);
  let notes: { part: { noteOff(id: number): void }; ids: number[] } | null = null;
  ui.button.classList.add('on');
  ui.bubble.show(chord.label, true);
  held = {
    release: (): void => {
      press.detach?.();
      ui.button.classList.remove('on');
      const selected = view.ctx.model.doc.harmony.events[index];
      if (selected) ui.bubble.show(eventLabel(view.ctx.model.doc.harmony, selected), false);
      if (notes) for (const id of notes.ids) notes.part.noteOff(id);
      notes = null;
    },
  };
  void host
    .auditionPart()
    .then((part) => {
      if (!part || !hold.owns(token)) return;
      notes = { part, ids: chord.notes.map((n) => part.noteOn(n, HARMONY_AUDITION_VELOCITY)) };
    })
    .catch(() => undefined);
  return token;
}

interface PlayUi {
  readonly button: HTMLElement;
  readonly bubble: InfoBubble;
}

const ACTIVATE_KEYS = new Set([' ', 'Enter']);

/** Hold to hear (decision 4): pointer down to up or cancel, with capture; Space or Enter held on focus. */
function bindPlay(view: SongView, index: number, degree: number, ui: PlayUi): void {
  const { button } = ui;
  button.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let token: AuditionToken | null = null;
    const onUp = (up: PointerEvent): void => endPress(token, up.pointerId);
    const detach = (): void => {
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    const source = { kind: 'pointer', pointerId: e.pointerId } as const;
    token = pressPlay(view, index, degree, ui, { source, detach });
    if (!token) return;
    button.setPointerCapture(e.pointerId);
    // On the window too: a repaint mid-hold detaches the button, and its capture with it.
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
  let keyToken: AuditionToken | null = null;
  button.addEventListener('keydown', (e) => {
    if (!ACTIVATE_KEYS.has(e.key)) return;
    // Stopped here: the transport strip's window Space handler would also start or pause the song.
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) keyToken = pressPlay(view, index, degree, ui, { source: { kind: 'key' } });
  });
  button.addEventListener('keyup', (e) => {
    if (!ACTIVATE_KEYS.has(e.key)) return;
    // Stopped for the same reason as keydown: the key belongs to this ▶, not the transport.
    e.preventDefault();
    e.stopPropagation();
    endPress(keyToken, null);
  });
  button.addEventListener('blur', () => endPress(keyToken, null));
}

/** The play row: a ▶ over each chip, on the chips' grid. */
function plays(view: SongView, index: number, bubble: InfoBubble): HTMLElement {
  const { harmony } = view.ctx.model.doc;
  const row = el('div', 'plays');
  for (const chip of degreeChips(harmony, CHORD_SIZE_TRIAD)) {
    const button = html('button', 'play', PLAY_ICON) as HTMLButtonElement;
    button.type = 'button';
    button.title = `hold to hear ${chip.numeral}'s chord`;
    button.setAttribute('aria-label', `Play degree ${chip.degree + 1}`);
    bindPlay(view, index, chip.degree, { button, bubble });
    row.appendChild(button);
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

/** A control under its field label. */
function field(label: string, control: HTMLElement): HTMLElement {
  const wrap = el('div', 'fld');
  wrap.appendChild(el('span', 'field-label', label));
  wrap.appendChild(control);
  return wrap;
}

/** Accidental, Size and Quality (decision 2), each one pure edit committed with the pane. */
function fieldRow(view: SongView, index: number): HTMLElement {
  const events = (): typeof view.ctx.model.doc.harmony.events => view.ctx.model.doc.harmony.events;
  const write = (next: ReturnType<typeof events>): void => {
    view.commit({ harmony: { events: next } }, true);
  };
  const row = el('div', 'bar-row');
  const accidental = seg(
    ACCIDENTAL_OPTIONS,
    () => String(events()[index]?.accidental ?? 0),
    (value) => write(setAccidental(events(), index, accidentalOf(value))),
    PITCH_COLOR,
  );
  accidental.classList.add('acc');
  [...accidental.children].forEach((b, i) => {
    (b as HTMLElement).title = ACCIDENTAL_OPTIONS[i]?.title ?? '';
  });
  row.appendChild(field('Accidental', accidental));
  const size = seg(
    SIZE_OPTIONS,
    () => String(events()[index]?.size ?? CHORD_SIZE_TRIAD),
    (value) => write(setSize(events(), index, sizeOf(value))),
    PITCH_COLOR,
  );
  row.appendChild(field('Size', size));
  row.appendChild(
    select('Quality', QUALITY_OPTIONS, events()[index]?.quality ?? '', (value) =>
      write(setQuality(events(), index, qualityOf(value))),
    ),
  );
  return row;
}

/** The info bubble, the Duration dial (or the last event's hint), and Delete at the right end. */
function bottomRow(view: SongView, index: number, bubble: InfoBubble): HTMLElement {
  const { doc } = view.ctx.model;
  const row = el('div', 'bar-row center');
  row.appendChild(bubble.node);
  const event = doc.harmony.events[index];
  if (index < doc.harmony.events.length - 1) row.appendChild(durationDial(view, index));
  else if (event) {
    row.appendChild(el('span', 'hint', `holds to the song end · ${durationLabel(event.duration)}`));
  }
  const remove = el('button', 'btn push', 'Delete') as HTMLButtonElement;
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
  return row;
}

/** The card for the event at `index`. */
export function harmonyCard(view: SongView, index: number): HTMLElement {
  const root = el('div', 'harmony-card');
  const { harmony } = view.ctx.model.doc;
  const event = harmony.events[index];
  if (!event) return root;
  const bubble = infoBubble(eventLabel(harmony, event));
  root.appendChild(el('span', 'field-label', 'Degree'));
  root.appendChild(plays(view, index, bubble));
  root.appendChild(chips(view, index));
  root.appendChild(fieldRow(view, index));
  root.appendChild(bottomRow(view, index, bubble));
  return root;
}
