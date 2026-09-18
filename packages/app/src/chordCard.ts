/**
 * The Sequencers tab's chord card (#607): the picker above, the progression
 * below as one column per step — the chord's name over its numeral, then the
 * Oct, Inv, Semi, Dur and Rep dials (click up, shift-click down) — an append
 * column that takes a drop or a click, a delete-last-step button, the part
 * velocity, gate and base-step controls, and a playhead on the audible tick.
 * Every edit goes through `ctx.change` as a whole `steps` list (arrays
 * replace wholesale in the merge); the step operations are
 * `chordStepModel.ts`. The strip's cells, columns, lighting and
 * playhead loop are `stepStrip.ts` (#619), shared with the grid (#603) and
 * Euclidean (#610) cards.
 */
import type { ChordSpec, ChordStep } from '../../../packages/client/src/audio/index-for-editor';
import { CHORD_DIVISORS, partAt } from '../../../packages/client/src/audio/index-for-editor';
import { CHORD_AUDITION_VELOCITY } from './chordConstants';
import { chordPicker, type Picker } from './chordPicker';
import {
  CHORD_STEPS_MAX,
  type StepDial,
  appendStep,
  dialLabel,
  dropOn,
  removeLast,
  stepLabel,
  stepNotes,
  turnDial,
  withStep,
} from './chordStepModel';
import type { AppCtx } from './context';
import { partChange } from './context';
import { PITCH_COLOR } from './consoleColors';
import { el, escapeHtml, select } from './dom';
import { keySignature } from './gridModel';
import { knobRow } from './seqFields';
import { DIVISOR_OPTIONS } from './sequencerConstants';
import { CHORD_KNOBS } from './sequencerKnobTables';
import {
  type Strip,
  commitSteps,
  markStep,
  paintStrip,
  playheadAt,
  specOf,
  stripCell,
  stripColumn,
  watchPlayhead,
} from './stepStrip';

const HINT =
  'Press a chip to hear it through this part; drag it, or Rest, onto a step or the + column. ' +
  'Press a step to hear it as written. Dials: click up, shift-click down — Oct and Semi shift the ' +
  'chord, Inv inverts it, Dur is a multiple of the base step, Rep plays the step that many times. ' +
  'Voicing applies to the whole progression.';

const DIALS: ReadonlyArray<{ dial: StepDial; title: string }> = [
  { dial: 'octave', title: 'octave: click up, shift-click down' },
  { dial: 'inversion', title: 'inversion: click to cycle, shift-click back' },
  { dial: 'semitone', title: 'semitone shift: click up, shift-click down' },
  { dial: 'duration', title: 'duration × base step: click longer, shift-click shorter' },
  { dial: 'repeat', title: 'repeat: click more, shift-click fewer' },
];

/** This card's strip: one column per step of a `chord` progression, plus its picker. */
type ChordStrip = Strip<ChordSpec> & { picker: Picker | null };

const commit = (strip: ChordStrip, edit: (spec: ChordSpec) => readonly ChordStep[]): void =>
  commitSteps(strip, edit);

/**
 * Pressing a step's tile sounds the step as the sequencer would play it, until
 * release. A second press while one sounds (a second finger) releases the
 * first before it starts, so no handle is ever left unreleased.
 */
function bindTileAudition(strip: ChordStrip, node: HTMLElement, step: ChordStep): void {
  let sounding: { part: { noteOff(id: number): void }; ids: number[] } | null = null;
  const stop = (): void => {
    if (!sounding) return;
    for (const id of sounding.ids) sounding.part.noteOff(id);
    sounding = null;
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stop();
    const part = strip.ctx.host.part(strip.slot);
    const spec = strip.spec();
    if (!part || !spec) return;
    node.setPointerCapture(e.pointerId);
    const notes = stepNotes(strip.ctx.model.doc.key, step, spec.voicing, spec.register.octave);
    sounding = { part, ids: notes.map((n) => part.noteOn(n, CHORD_AUDITION_VELOCITY)) };
  });
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
}

function tileCell(strip: ChordStrip, index: number, spec: ChordSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step) return stripCell('', 'blank');
  const label = stepLabel(step, strip.ctx.model.doc.key);
  const node = stripCell('', step.kind === 'chord' ? 'chord' : 'rest');
  node.innerHTML = `${escapeHtml(label.name)}<small>${escapeHtml(label.numeral)}</small>`;
  node.title = step.kind === 'chord' ? `degree ${step.degree + 1}: press to hear` : 'rest';
  bindTileAudition(strip, node, step);
  return node;
}

function dialCell(strip: ChordStrip, index: number, spec: ChordSpec, dial: StepDial): HTMLElement {
  const step = spec.steps[index];
  if (!step) return stripCell('', 'blank');
  const label = dialLabel(step, dial);
  if (label === '') return stripCell('', 'blank');
  const node = stripCell(label);
  node.title = DIALS.find((d) => d.dial === dial)?.title ?? dial;
  node.onclick = (event: MouseEvent): void =>
    commit(strip, (s) =>
      withStep(s.steps, index, turnDial(s.steps[index] ?? step, dial, event.shiftKey ? -1 : 1)),
    );
  return node;
}

function column(strip: ChordStrip, index: number, spec: ChordSpec): HTMLElement {
  const col = stripColumn(index, true, [
    tileCell(strip, index, spec),
    ...DIALS.map(({ dial }) => dialCell(strip, index, spec, dial)),
  ]);
  col.dataset.chordSlot = String(strip.slot);
  col.dataset.chordStep = String(index);
  return col;
}

/** The last column: `+` appends a copy of the last step, and a drop here appends the chip. */
function appendColumn(strip: ChordStrip, spec: ChordSpec): HTMLElement {
  const full = spec.steps.length >= CHORD_STEPS_MAX;
  const plus = stripCell(full ? '' : '+', full ? 'blank' : 'append');
  plus.title = 'append a step (a copy of the last); drop a chip here to append it';
  plus.onclick = (): void => commit(strip, (s) => appendStep(s.steps));
  const col = stripColumn(spec.steps.length, !full, [plus]);
  col.classList.add('append');
  col.dataset.chordSlot = String(strip.slot);
  col.dataset.chordStep = String(spec.steps.length);
  return col;
}

/** Redraw every column from the document, then the append column and the picker. */
function repaint(strip: ChordStrip): void {
  paintStrip(strip, (spec) => [
    ...spec.steps.map((_, index) => column(strip, index, spec)),
    appendColumn(strip, spec),
  ]);
  strip.picker?.repaint();
}

/**
 * Per frame while the card is on screen: the playhead (the engine's own step
 * for the audible tick, durations and repeats included), and a repaint when
 * the Harmony tab's root or scale has changed since the labels were drawn — a
 * root knob goes through `ctx.change` alone, which re-renders nothing.
 */
function watch(strip: ChordStrip): void {
  let keySig = keySignature(strip.ctx.model.doc.key);
  watchPlayhead({
    attached: () => strip.root.isConnected,
    shown: () => strip.root.closest('[hidden]') === null,
    playheadAt: () => playheadAt(strip.ctx, strip.slot),
    mark: markStep(strip),
    repaintIf: () => {
      const sig = keySignature(strip.ctx.model.doc.key);
      if (sig === keySig) return;
      keySig = sig;
      strip.repaint();
    },
  });
}

const BASE_STEP_OPTIONS = DIVISOR_OPTIONS.filter((o) => CHORD_DIVISORS.includes(Number(o.value)));

function controls(strip: ChordStrip): HTMLElement {
  return knobRow(strip.ctx, strip.slot, CHORD_KNOBS, PITCH_COLOR);
}

function tools(strip: ChordStrip): HTMLElement {
  const { ctx, slot } = strip;
  const row = el('div', 'capture-row');
  row.appendChild(
    select('Base step', BASE_STEP_OPTIONS, String(strip.spec()?.divisor ?? ''), (v) => {
      if (ctx.change(partChange(slot, { sequencer: { divisor: Number(v) } })).ok) strip.repaint();
    }),
  );
  const minus = el('button', 'btn', 'Delete last step') as HTMLButtonElement;
  minus.type = 'button';
  minus.style.borderColor = PITCH_COLOR;
  minus.title = 'delete the last step of the progression';
  minus.onclick = (): void => commit(strip, (s) => removeLast(s.steps));
  row.appendChild(minus);
  return row;
}

/** The column under a client point, if it belongs to this card: its step index. */
function targetAt(strip: ChordStrip, x: number, y: number): number | null {
  const under = document.elementFromPoint(x, y);
  const col = under?.closest<HTMLElement>('[data-chord-step]');
  if (!col || col.dataset.chordSlot !== String(strip.slot)) return null;
  const index = Number(col.dataset.chordStep);
  return Number.isInteger(index) ? index : null;
}

function highlight(strip: ChordStrip, index: number | null): void {
  [...strip.root.children].forEach((col, i) => col.classList.toggle('drop-target', i === index));
}

/** The card body for a `chord` part: controls, the picker, the step strip, the hint. */
export function chordCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  const strip: ChordStrip = {
    ctx,
    slot,
    root: el('div', 'grid-strip chord-strip'),
    picker: null,
    playing: -1,
    spec: () => specOf(ctx, slot, 'chord'),
    repaint: () => repaint(strip),
  };
  strip.picker = chordPicker({
    key: () => ctx.model.doc.key,
    spec: () => strip.spec(),
    part: () => ctx.host.part(slot),
    setVoicing: (voicing) => {
      if (ctx.change(partChange(slot, { sequencer: { voicing } })).ok) strip.repaint();
    },
    targetAt: (x, y) => targetAt(strip, x, y),
    highlight: (index) => highlight(strip, index),
    drop: (payload, index) => commit(strip, (s) => dropOn(s.steps, index, payload)),
  });
  body.appendChild(controls(strip));
  body.appendChild(tools(strip));
  body.appendChild(strip.picker.root);
  body.appendChild(strip.root);
  body.appendChild(
    el(
      'p',
      'hint',
      `${HINT} Chips sound through ${partAt(ctx.model.doc, slot)?.name ?? 'this part'}.`,
    ),
  );
  repaint(strip);
  watch(strip);
  return body;
}
