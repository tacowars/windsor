/**
 * The Euclid card's Pattern page (windsor#356, decision 2 of the issue;
 * fitted to the 244 px device by windsor#393, decisions 4 and 5, look
 * `docs/research/2026-09-30-sequencer-rack/euclid.html`). Two sections:
 *
 * - **Play**, its controls in columns: Note, Steps and Rotate (the value
 *   boxes, `euclidStepper.ts`); the divisor and Capture / Release; then,
 *   behind a rule, Vel, Acc vel and Acc mod, and Hold (`EUCLID_KNOB_COLUMNS`).
 * - **Rows**, its label carrying the full cycle: one vertical scroller
 *   holding the stack of rows (`euclidRows.ts`), the ratchet row, the
 *   trigger row and the Lanes rule (+ Lane at its left, the lane count at
 *   its right) held at its top while the lanes scroll under them.
 *
 * The sizes are the `--euclid-*` entries of `SEQUENCER_DEVICE_PX`.
 */
import { PERC_COLOR } from './consoleColors';
import { el } from './dom';
import type { EuclidCard } from './euclidCardState';
import { EUCLID_KNOB_COLUMNS } from './euclidConstants';
import { type LaneChoice, addLaneRow, laneChoices } from './euclidLaneModel';
import { partPatch } from './stepModLane';
import { stepperBox } from './euclidStepper';
import { EUCLID_STEPPERS } from './euclidStepperModel';
import { divisorPicker, tableKnob } from './seqFields';
import {
  EUCLID_ACCENT_KNOBS,
  EUCLID_KNOBS,
  EUCLID_NOTE_STEPPER,
  EUCLID_ROTATE_KNOB,
  EUCLID_STEPS_KNOB,
} from './sequencerKnobTables';

/** The page and the parts the card's loop keeps current. */
export interface PatternPage {
  readonly root: HTMLElement;
  /** Holds every row: what the card rebuilds around the Lanes rule. */
  readonly rows: HTMLElement;
  /** The Lanes rule: + Lane, the dashed line, the lane count. Built once, never moved. */
  readonly rule: HTMLElement;
  /** The Rows label's note: the full cycle. */
  readonly cycle: HTMLElement;
  /** The rule's lane count. */
  readonly count: HTMLElement;
  readonly picker: HTMLSelectElement;
  readonly captureButton: HTMLButtonElement;
}

/** Note, Steps and Rotate: the value boxes, each label from its table. */
function steppers(card: EuclidCard): Record<keyof typeof EUCLID_STEPPERS, HTMLElement> {
  return {
    note: stepperBox(card, {
      label: EUCLID_NOTE_STEPPER.label,
      model: EUCLID_STEPPERS.note,
      less: 'Note down a semitone',
      more: 'Note up a semitone',
    }),
    steps: stepperBox(card, {
      label: EUCLID_STEPS_KNOB.label,
      model: EUCLID_STEPPERS.steps,
      less: 'Fewer steps',
      more: 'More steps',
    }),
    rotate: stepperBox(card, {
      label: EUCLID_ROTATE_KNOB.label,
      model: EUCLID_STEPPERS.rotate,
      less: 'Rotate left',
      more: 'Rotate right',
    }),
  };
}

function captureButton(card: EuclidCard): HTMLButtonElement {
  const button = el('button', 'btn seq-btn', card.spec()?.pattern ? 'Release' : 'Capture');
  const node = button as HTMLButtonElement;
  node.type = 'button';
  node.onclick = (): void => card.capture(card.spec()?.pattern != null ? null : card.figure());
  return node;
}

function column(className: string, nodes: readonly HTMLElement[]): HTMLElement {
  const col = el('div', `seq-col ${className}`);
  col.append(...nodes);
  return col;
}

/** The knob strip behind its rule: Vel, Acc vel and Acc mod, then Hold. */
function knobStrip(card: EuclidCard): HTMLElement {
  const { ctx, slot, region } = card;
  const entries = [...EUCLID_KNOBS, ...EUCLID_ACCENT_KNOBS];
  const knob = (field: string): HTMLElement[] => {
    const entry = entries.find((e) => e.f === field);
    return entry ? [tableKnob(ctx, slot, entry, PERC_COLOR, region)] : [];
  };
  const strip = el('div', 'euclid-knobs');
  strip.append(...EUCLID_KNOB_COLUMNS.map((fields) => column('k3', fields.flatMap(knob))));
  return strip;
}

/** The Play section in the mockup's columns: the value boxes, Step and Capture, the knob strip. */
function playSection(card: EuclidCard, capture: HTMLButtonElement): HTMLElement {
  const { ctx, slot, region } = card;
  const boxes = steppers(card);
  const body = el('div', 'seq-sec-body');
  body.append(
    column('wide euclid-fields', [boxes.note, boxes.steps, boxes.rotate]),
    column('wide euclid-fields', [divisorPicker(ctx, slot, region), capture]),
    knobStrip(card),
  );
  const section = el('div', 'seq-section play');
  section.append(el('div', 'seq-sec-label', 'Play'), body);
  return section;
}

/** Refill the Add lane picker: Accent and Pitch once each, the sound lanes up to their limit. */
export function fillPicker(picker: HTMLSelectElement, choices: readonly LaneChoice[]): void {
  picker.replaceChildren(new Option('+ Lane', ''));
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
    const patch = partPatch(card.ctx, card.slot);
    const fields = spec && addLaneRow(spec, picker.value, spec.steps, patch);
    if (!fields || !card.write(fields)) card.refresh();
  };
  const spec = card.spec();
  if (spec) fillPicker(picker, laneChoices(spec, partPatch(card.ctx, card.slot)));
  return picker;
}

/** The Lanes rule: the + Lane picker at its left, the dashed line, the lane count at its right. */
function lanesRule(picker: HTMLSelectElement, count: HTMLElement): HTMLElement {
  const rule = el('div', 'euclid-lanes-rule');
  const corner = el('div', 'euclid-rule-corner');
  corner.appendChild(picker);
  rule.append(corner, el('hr'), count);
  return rule;
}

/** The Rows section: its label with the cycle, then the one scroller holding every row. */
function rowsSection(rows: HTMLElement, cycle: HTMLElement): HTMLElement {
  const scroll = el('div', 'euclid-scroll');
  scroll.appendChild(rows);
  const label = el('div', 'seq-sec-label', 'Rows');
  label.appendChild(cycle);
  const body = el('div', 'seq-sec-body');
  body.appendChild(scroll);
  const section = el('div', 'seq-section euclid-rows-section');
  section.append(label, body);
  return section;
}

/** The Pattern page for the card's part and region; the card fills its rows. */
export function patternPage(card: EuclidCard): PatternPage {
  const root = el('div', 'euclid-page euclid-pattern');
  const capture = captureButton(card);
  const rows = el('div', 'euclid-rows');
  rows.setAttribute('role', 'group');
  rows.setAttribute('aria-label', 'Euclid rows');
  const picker = lanePicker(card);
  const count = el('span', 'seq-meas euclid-lane-count');
  const rule = lanesRule(picker, count);
  rows.appendChild(rule);
  const cycle = el('em', 'euclid-cycle');
  root.append(playSection(card, capture), rowsSection(rows, cycle));
  return { root, rows, rule, cycle, count, picker, captureButton: capture };
}
