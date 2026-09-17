/**
 * The Sequencers tab's chord card (#607): the picker above, the progression
 * below as one column per step — the chord's name over its numeral, then the
 * Oct, Inv, Semi, Dur and Rep dials (click up, shift-click down) — an append
 * column that takes a drop or a click, a delete-last-step button, the part
 * velocity, gate and base-step controls, and a playhead on the audible tick.
 * Every edit goes through `ctx.change` as a whole `steps` list (arrays
 * replace wholesale in the merge); the step operations are
 * `chordStepModel.ts`. The strip's cells and columns are the grid card's
 * builders, so the console has one step-column layout.
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
  stepAtTick,
  stepLabel,
  stepNotes,
  turnDial,
  withStep,
} from './chordStepModel';
import type { AppCtx } from './context';
import { partChange } from './context';
import { DIVISOR_OPTIONS, el, escapeHtml, fmt2, select } from './dom';
import { markPlaying, stripCell, stripColumn } from './gridCard';
import { keySignature } from './gridModel';
import { PITCH_COLOR, driverKnob, sectionKnob } from './seqFields';

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

function specOf(ctx: AppCtx, slot: number): ChordSpec | null {
  const sequencer = partAt(ctx.model.doc, slot)?.sequencer;
  return sequencer?.kind === 'chord' ? sequencer : null;
}

/** The strip and what every cell needs to write a step and redraw. */
interface Strip {
  ctx: AppCtx;
  slot: number;
  root: HTMLElement;
  picker: Picker | null;
  /** The column the playhead sits on, or -1; reapplied after every repaint. */
  playing: number;
  repaint(): void;
}

function commit(strip: Strip, edit: (spec: ChordSpec) => readonly ChordStep[]): void {
  const spec = specOf(strip.ctx, strip.slot);
  if (!spec) return;
  const result = strip.ctx.change(partChange(strip.slot, { sequencer: { steps: edit(spec) } }));
  if (result.ok) strip.repaint();
}

/** Pressing a step's tile sounds the step as the sequencer would play it, until release. */
function bindTileAudition(strip: Strip, node: HTMLElement, step: ChordStep): void {
  let sounding: { part: { noteOff(id: number): void }; ids: number[] } | null = null;
  const stop = (): void => {
    if (!sounding) return;
    for (const id of sounding.ids) sounding.part.noteOff(id);
    sounding = null;
  };
  node.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const part = strip.ctx.host.part(strip.slot);
    const spec = specOf(strip.ctx, strip.slot);
    if (!part || !spec) return;
    node.setPointerCapture(e.pointerId);
    const notes = stepNotes(strip.ctx.model.doc.key, step, spec.voicing, spec.register.octave);
    sounding = { part, ids: notes.map((n) => part.noteOn(n, CHORD_AUDITION_VELOCITY)) };
  });
  node.addEventListener('pointerup', stop);
  node.addEventListener('pointercancel', stop);
}

function tileCell(strip: Strip, index: number, spec: ChordSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step) return stripCell('', 'blank');
  const label = stepLabel(step, strip.ctx.model.doc.key);
  const node = stripCell('', step.kind === 'chord' ? 'chord' : 'rest');
  node.innerHTML = `${escapeHtml(label.name)}<small>${escapeHtml(label.numeral)}</small>`;
  node.title = step.kind === 'chord' ? `degree ${step.degree + 1}: press to hear` : 'rest';
  bindTileAudition(strip, node, step);
  return node;
}

function dialCell(strip: Strip, index: number, spec: ChordSpec, dial: StepDial): HTMLElement {
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

function column(strip: Strip, index: number, spec: ChordSpec): HTMLElement {
  const col = stripColumn(index, true, [
    tileCell(strip, index, spec),
    ...DIALS.map(({ dial }) => dialCell(strip, index, spec, dial)),
  ]);
  col.dataset.chordSlot = String(strip.slot);
  col.dataset.chordStep = String(index);
  return col;
}

/** The last column: `+` appends a copy of the last step, and a drop here appends the chip. */
function appendColumn(strip: Strip, spec: ChordSpec): HTMLElement {
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

/** Redraw every column from the document, keeping the horizontal scroll where it was. */
function paintStrip(strip: Strip): void {
  const spec = specOf(strip.ctx, strip.slot);
  const scrollLeft = strip.root.scrollLeft;
  strip.root.innerHTML = '';
  if (!spec) return;
  spec.steps.forEach((_, index) => strip.root.appendChild(column(strip, index, spec)));
  strip.root.appendChild(appendColumn(strip, spec));
  strip.root.scrollLeft = scrollLeft;
  markPlaying(strip.root, strip.playing);
  strip.picker?.repaint();
}

/**
 * Per frame while the card is on screen: the playhead (the step of the
 * audible tick while the transport runs), and a repaint when the Harmony
 * tab's root or scale has changed since the labels were drawn — a root knob
 * goes through `ctx.change` alone, which re-renders nothing.
 */
function watch(strip: Strip): void {
  let keySig = keySignature(strip.ctx.model.doc.key);
  const tick = (): void => {
    if (!strip.root.isConnected) return;
    requestAnimationFrame(tick);
    const sig = keySignature(strip.ctx.model.doc.key);
    if (sig !== keySig) {
      keySig = sig;
      strip.repaint();
    }
    const system = strip.ctx.host.system;
    const spec = specOf(strip.ctx, strip.slot);
    let current = -1;
    if (system && spec && system.scheduler.isRunning) {
      current = stepAtTick(spec, system.scheduler.audibleTick(system.engine.context.currentTime));
    }
    if (current === strip.playing) return;
    strip.playing = current;
    markPlaying(strip.root, current);
  };
  requestAnimationFrame(tick);
}

const BASE_STEP_OPTIONS = DIVISOR_OPTIONS.filter((o) => CHORD_DIVISORS.includes(Number(o.value)));

function controls(strip: Strip): HTMLElement {
  const { ctx, slot } = strip;
  const row = el('div', 'knob-row');
  row.appendChild(
    sectionKnob(ctx, slot, 'velocity', {
      label: 'Vel',
      min: 0,
      max: 1,
      def: 0.8,
      color: PITCH_COLOR,
      fmt: fmt2,
    }),
  );
  row.appendChild(
    driverKnob(ctx, slot, 'gate', {
      label: 'Gate',
      min: 0.01,
      max: 1,
      def: 1,
      color: PITCH_COLOR,
      fmt: fmt2,
    }),
  );
  return row;
}

function tools(strip: Strip): HTMLElement {
  const { ctx, slot } = strip;
  const row = el('div', 'capture-row');
  row.appendChild(
    select('Base step', BASE_STEP_OPTIONS, String(specOf(ctx, slot)?.divisor ?? ''), (v) => {
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
function targetAt(strip: Strip, x: number, y: number): number | null {
  const under = document.elementFromPoint(x, y);
  const col = under?.closest<HTMLElement>('[data-chord-step]');
  if (!col || col.dataset.chordSlot !== String(strip.slot)) return null;
  const index = Number(col.dataset.chordStep);
  return Number.isInteger(index) ? index : null;
}

function highlight(strip: Strip, index: number | null): void {
  [...strip.root.children].forEach((col, i) => col.classList.toggle('drop-target', i === index));
}

/** The card body for a `chord` part: controls, the picker, the step strip, the hint. */
export function chordCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  const strip: Strip = {
    ctx,
    slot,
    root: el('div', 'grid-strip chord-strip'),
    picker: null,
    playing: -1,
    repaint: () => paintStrip(strip),
  };
  strip.picker = chordPicker({
    key: () => ctx.model.doc.key,
    spec: () => specOf(ctx, slot),
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
      `${HINT} Chips sound through ${escapeHtml(partAt(ctx.model.doc, slot)?.name ?? 'this part')}.`,
    ),
  );
  paintStrip(strip);
  watch(strip);
  return body;
}
