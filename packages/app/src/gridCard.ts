/**
 * The Sequencers tab's grid card (#603): one column per written step of a
 * `grid` part — the top cell cycles note → tie → rest, a note's degree comes
 * from a picker holding only the current scale, Oct cycles the step octave,
 * A and S toggle accent and slide — plus the loop length, the divisor, skip
 * and the two accent knobs, and a playhead that follows the audible tick.
 * Every edit goes through `ctx.change` as a whole `steps` list (arrays
 * replace wholesale in the merge); the step operations are `gridModel.ts`.
 */
import type { GridSpec } from '../../../packages/client/src/audio/index-for-editor';
import { partAt } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el, fmt0, fmt2 } from './dom';
import {
  GRID_STEPS_MAX,
  cycleKind,
  cycleOctave,
  degreeOptions,
  foldedView,
  setDegree,
  stepLabel,
  stepsForLength,
  toggleFlag,
  withStep,
} from './gridModel';
import { makeKnob } from './knob';
import { PITCH_COLOR, divisorPicker, driverKnob, sectionKnob } from './seqFields';

const HINT =
  'Top cell cycles note → tie → rest. Pick the degree from the key — a red border means the ' +
  'written degree folded into the current scale. Oct: click up, shift-click down. ' +
  'A accent, S slide. Steps past Length stay written, greyed.';

function specOf(ctx: AppCtx, slot: number): GridSpec | null {
  const sequencer = partAt(ctx.model.doc, slot)?.sequencer;
  return sequencer?.kind === 'grid' ? sequencer : null;
}

/** The strip and what every cell needs to write a step and redraw. */
interface Strip {
  ctx: AppCtx;
  slot: number;
  root: HTMLElement;
  repaint(): void;
}

function commit(strip: Strip, edit: (spec: GridSpec) => GridSpec['steps']): void {
  const spec = specOf(strip.ctx, strip.slot);
  if (!spec) return;
  const result = strip.ctx.change(partChange(strip.slot, { sequencer: { steps: edit(spec) } }));
  if (result.ok) strip.repaint();
}

function cell(label: string, className = ''): HTMLButtonElement {
  const node = el('button', `gcell ${className}`.trim(), label) as HTMLButtonElement;
  node.type = 'button';
  return node;
}

function kindCell(strip: Strip, index: number, spec: GridSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step) return cell('', 'blank');
  const key = strip.ctx.model.doc.key;
  const folded = step.kind === 'note' && foldedView(step.degree, key).folded;
  const node = cell(stepLabel(step, key), step.kind === 'note' ? 'note' : '');
  if (folded) node.classList.add('folded');
  node.title = step.kind === 'note' ? `degree ${step.degree + 1}` : step.kind;
  node.onclick = (): void =>
    commit(strip, (s) => withStep(s.steps, index, cycleKind(s.steps[index] ?? step)));
  return node;
}

function degreeSelect(strip: Strip, index: number, spec: GridSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step || step.kind !== 'note') return cell('', 'blank');
  const key = strip.ctx.model.doc.key;
  const sel = document.createElement('select');
  sel.className = 'gsel';
  sel.setAttribute('aria-label', `step ${index + 1} degree`);
  for (const option of degreeOptions(key)) sel.add(new Option(option.label, option.value));
  const view = foldedView(step.degree, key);
  if (view.folded) {
    // The stored degree is past the scale: show it folded, and keep it as written.
    const shown = degreeOptions(key)[view.degree]?.label ?? '?';
    sel.add(new Option(`${step.degree + 1} → ${shown} ↑${view.carry}`, String(step.degree)));
    sel.classList.add('folded');
  }
  sel.value = String(step.degree);
  sel.onchange = (): void =>
    commit(strip, (s) =>
      withStep(s.steps, index, setDegree(s.steps[index] ?? step, Number(sel.value))),
    );
  return sel;
}

function octaveCell(strip: Strip, index: number, spec: GridSpec): HTMLElement {
  const step = spec.steps[index];
  if (!step || step.kind !== 'note') return cell('', 'blank');
  const label = step.octave === 0 ? 'oct' : step.octave > 0 ? `+${step.octave}` : `${step.octave}`;
  const node = cell(label);
  node.title = 'octave: click up, shift-click down';
  node.onclick = (event: MouseEvent): void =>
    commit(strip, (s) =>
      withStep(s.steps, index, cycleOctave(s.steps[index] ?? step, event.shiftKey ? -1 : 1)),
    );
  return node;
}

function flagCell(
  strip: Strip,
  index: number,
  spec: GridSpec,
  flag: 'accent' | 'slide',
): HTMLElement {
  const step = spec.steps[index];
  if (!step || step.kind !== 'note') return cell('', 'blank');
  const node = cell(flag === 'accent' ? 'A' : 'S');
  node.title = flag;
  node.setAttribute('aria-pressed', String(step[flag]));
  node.onclick = (): void =>
    commit(strip, (s) => withStep(s.steps, index, toggleFlag(s.steps[index] ?? step, flag)));
  return node;
}

function column(strip: Strip, index: number, spec: GridSpec): HTMLElement {
  const col = el('div', index < spec.length ? 'grid-col' : 'grid-col off');
  col.appendChild(el('div', 'grid-idx', String(index + 1)));
  col.appendChild(kindCell(strip, index, spec));
  col.appendChild(degreeSelect(strip, index, spec));
  col.appendChild(octaveCell(strip, index, spec));
  col.appendChild(flagCell(strip, index, spec, 'accent'));
  col.appendChild(flagCell(strip, index, spec, 'slide'));
  return col;
}

/** Redraw every column from the document, keeping the horizontal scroll where it was. */
function paintStrip(strip: Strip): void {
  const spec = specOf(strip.ctx, strip.slot);
  const scrollLeft = strip.root.scrollLeft;
  strip.root.innerHTML = '';
  if (!spec) return;
  spec.steps.forEach((_, index) => strip.root.appendChild(column(strip, index, spec)));
  strip.root.scrollLeft = scrollLeft;
}

/** The playhead: the column of the audible tick, while the card is on screen and the transport runs. */
function startPlayhead(strip: Strip): void {
  let shown = -1;
  const tick = (): void => {
    if (!strip.root.isConnected) return;
    requestAnimationFrame(tick);
    const system = strip.ctx.host.system;
    const spec = specOf(strip.ctx, strip.slot);
    let current = -1;
    if (system && spec && system.scheduler.isRunning) {
      const audible = system.scheduler.audibleTick(system.engine.context.currentTime);
      current = Math.floor(audible / spec.divisor) % spec.length;
    }
    if (current === shown) return;
    shown = current;
    [...strip.root.children].forEach((col, i) => col.classList.toggle('playing', i === current));
  };
  requestAnimationFrame(tick);
}

function lengthKnob(strip: Strip): HTMLElement {
  return makeKnob({
    label: 'Length',
    min: 1,
    max: GRID_STEPS_MAX,
    def: 16,
    step: 1,
    color: PITCH_COLOR,
    fmt: fmt0,
    get: () => specOf(strip.ctx, strip.slot)?.length ?? 1,
    set: (v) => {
      const spec = specOf(strip.ctx, strip.slot);
      if (!spec) return;
      const length = Math.round(v);
      const change = { sequencer: { length, steps: stepsForLength(spec.steps, length) } };
      if (strip.ctx.change(partChange(strip.slot, change)).ok) strip.repaint();
    },
  });
}

function controls(strip: Strip): HTMLElement {
  const { ctx, slot } = strip;
  const row = el('div', 'knob-row');
  const knob = (field: string, label: string, def: number): HTMLElement =>
    driverKnob(ctx, slot, field, { label, min: 0, max: 1, def, color: PITCH_COLOR, fmt: fmt2 });
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
  row.appendChild(lengthKnob(strip));
  row.appendChild(knob('skipChance', 'Skip', 0));
  row.appendChild(knob('accentVelocity', 'Acc vel', 0.2));
  row.appendChild(knob('accentMod', 'Acc mod', 1));
  return row;
}

/** The card body for a `grid` part: controls, the step strip, the hint. */
export function gridCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  const strip: Strip = {
    ctx,
    slot,
    root: el('div', 'grid-strip'),
    repaint: () => paintStrip(strip),
  };
  body.appendChild(controls(strip));
  body.appendChild(divisorPicker(ctx, slot));
  body.appendChild(strip.root);
  body.appendChild(el('p', 'hint', HINT));
  paintStrip(strip);
  startPlayhead(strip);
  return body;
}
