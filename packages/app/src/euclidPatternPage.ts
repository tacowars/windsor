/**
 * The Euclid card's Pattern page (windsor#356, decision 2 of the issue): the
 * Play knobs (Note, Vel, Hold, Steps, Rotate, the divisor and Capture /
 * Release as they were, and Acc vel and Acc mod for the accent amounts),
 * the stack of rows (`euclidRows.ts`) in a sideways scroller, and under it
 * the Add lane picker, the hover readout and the full cycle.
 */
import { PERC_COLOR } from './consoleColors';
import { el } from './dom';
import type { EuclidCard } from './euclidCardState';
import { EUCLID_READOUT_HINT } from './euclidConstants';
import { type LaneChoice, addLaneRow, laneChoices } from './euclidLaneModel';
import { rotateChange, stepsChange } from './euclidModel';
import { makeKnob } from './knob';
import { divisorPicker, knobRow as tableKnobRow } from './seqFields';
import {
  EUCLID_ACCENT_KNOBS,
  EUCLID_KNOBS,
  EUCLID_ROTATE_KNOB,
  EUCLID_STEPS_KNOB,
} from './sequencerKnobTables';

/** The page and the parts the card's loop keeps current. */
export interface PatternPage {
  readonly root: HTMLElement;
  /** Holds every row: what the card rebuilds. */
  readonly rows: HTMLElement;
  readonly readout: HTMLElement;
  readonly cycle: HTMLElement;
  readonly picker: HTMLSelectElement;
  readonly captureButton: HTMLButtonElement;
}

function stepsKnob(card: EuclidCard): HTMLElement {
  return makeKnob({
    ...EUCLID_STEPS_KNOB,
    color: PERC_COLOR,
    get: () => card.spec()?.steps ?? EUCLID_STEPS_KNOB.def,
    set: (v) => {
      const spec = card.spec();
      if (spec && card.write(stepsChange(spec, v))) card.dependents.forEach((k) => k.refresh());
    },
  });
}

function rotateKnob(card: EuclidCard): HTMLElement {
  const knob = makeKnob({
    ...EUCLID_ROTATE_KNOB,
    color: PERC_COLOR,
    get: () => card.spec()?.rotate ?? EUCLID_ROTATE_KNOB.def,
    set: (v) => {
      const spec = card.spec();
      if (spec) card.write({ rotate: rotateChange(spec, v) });
    },
  });
  card.dependents.push(knob);
  return knob;
}

function captureButton(card: EuclidCard): HTMLButtonElement {
  const button = el('button', 'btn', card.spec()?.pattern ? 'Release' : 'Capture');
  const node = button as HTMLButtonElement;
  node.type = 'button';
  node.style.borderColor = PERC_COLOR;
  node.onclick = (): void => card.capture(card.spec()?.pattern != null ? null : card.figure());
  return node;
}

/** The Play knobs, the divisor and Capture, then the accent amounts. */
function playKnobs(card: EuclidCard, capture: HTMLButtonElement): HTMLElement {
  const { ctx, slot, region } = card;
  const row = tableKnobRow(ctx, slot, EUCLID_KNOBS, PERC_COLOR, region);
  row.append(stepsKnob(card), rotateKnob(card));
  const fixed = el('div', 'capture-row');
  fixed.append(divisorPicker(ctx, slot, region), capture);
  row.appendChild(fixed);
  row.append(...tableKnobRow(ctx, slot, EUCLID_ACCENT_KNOBS, PERC_COLOR, region).children);
  return row;
}

/** Refill the Add lane picker: Accent and Pitch once each, the sound lanes up to their limit. */
export function fillPicker(picker: HTMLSelectElement, choices: readonly LaneChoice[]): void {
  picker.replaceChildren(new Option('Add lane…', ''));
  for (const choice of choices) {
    const option = new Option(choice.label, choice.value);
    option.disabled = choice.disabled;
    picker.add(option);
  }
  picker.value = '';
}

function lanePicker(card: EuclidCard): HTMLSelectElement {
  const picker = document.createElement('select');
  picker.className = 'field euclid-add';
  picker.setAttribute('aria-label', 'Add a lane');
  picker.onchange = (): void => {
    const spec = card.spec();
    const fields = spec && addLaneRow(spec, picker.value, spec.steps);
    if (!fields || !card.write(fields)) card.refresh();
  };
  const spec = card.spec();
  if (spec) fillPicker(picker, laneChoices(spec));
  return picker;
}

/** The Pattern page for the card's part and region; the card fills its rows. */
export function patternPage(card: EuclidCard): PatternPage {
  const root = el('div', 'euclid-page euclid-pattern');
  const capture = captureButton(card);
  const rows = el('div', 'euclid-rows');
  rows.setAttribute('role', 'group');
  rows.setAttribute('aria-label', 'Euclid rows');
  const scroll = el('div', 'euclid-scroll');
  scroll.appendChild(rows);
  const picker = lanePicker(card);
  const readout = el('div', 'euclid-readout', EUCLID_READOUT_HINT);
  readout.setAttribute('aria-live', 'polite');
  const cycle = el('div', 'euclid-cycle');
  const under = el('div', 'euclid-under');
  under.append(picker, readout, cycle);
  root.append(playKnobs(card, capture), scroll, under);
  return { root, rows, readout, cycle, picker, captureButton: capture };
}
