/**
 * The Sequencers tab's grid card (#603): one column per written step of a
 * `grid` part — the top cell cycles note → tie → rest, a note's degree comes
 * from a picker holding only the current scale, Oct cycles the step octave,
 * A and S toggle accent and slide — plus the loop length, the divisor, skip
 * and the two accent knobs, and a playhead that follows the audible tick.
 * Every edit goes through `ctx.change` as a whole `steps` list (arrays
 * replace wholesale in the merge); the step operations are `gridModel.ts`.
 *
 * The strip itself — its cells and columns, the lighting, the playhead loop
 * and where the playhead is — is `stepStrip.ts` (#619), shared with the chord
 * (#607) and Euclidean (#610) cards.
 */
import type { GridSpec } from '../../../packages/client/src/audio/index-for-editor';
import { scaleOffsets } from '../../../packages/client/src/audio/index-for-editor';
import type { AppCtx } from './context';
import { partChange } from './context';
import { PITCH_COLOR } from './consoleColors';
import { el } from './dom';
import {
  cycleKind,
  cycleOctave,
  degreeOptions,
  foldedView,
  keySignature,
  randomSteps,
  rotateSteps,
  setDegree,
  stepLabel,
  stepsForLength,
  toggleFlag,
  withStep,
} from './gridModel';
import { makeKnob } from './knob';
import { divisorPicker, tableKnob } from './seqFields';
import { GRID_KNOBS, GRID_LENGTH_KNOB, GRID_ROTATE_KNOB } from './sequencerKnobTables';
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
  'Top cell cycles note → tie → rest. Pick the degree from the key — a red border means the ' +
  'written degree folded into the current scale. Oct: click up, shift-click down. ' +
  'A accent, S slide. Steps past Length stay written, greyed. Randomize rewrites every step; ' +
  'Rotate turns the loop.';

/** This card's strip: one column per written step of a `grid` spec. */
type GridStrip = Strip<GridSpec>;

const cell = stripCell;

const commit = (strip: GridStrip, edit: (spec: GridSpec) => GridSpec['steps']): void =>
  commitSteps(strip, edit);

function kindCell(strip: GridStrip, index: number, spec: GridSpec): HTMLElement {
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

function degreeSelect(strip: GridStrip, index: number, spec: GridSpec): HTMLElement {
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

function octaveCell(strip: GridStrip, index: number, spec: GridSpec): HTMLElement {
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
  strip: GridStrip,
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

function column(strip: GridStrip, index: number, spec: GridSpec): HTMLElement {
  return stripColumn(index, index < spec.length, [
    kindCell(strip, index, spec),
    degreeSelect(strip, index, spec),
    octaveCell(strip, index, spec),
    flagCell(strip, index, spec, 'accent'),
    flagCell(strip, index, spec, 'slide'),
  ]);
}

/** Redraw every column from the document, keeping the horizontal scroll where it was. */
const repaint = (strip: GridStrip): void =>
  paintStrip(strip, (spec) => spec.steps.map((_, index) => column(strip, index, spec)));

/**
 * Per frame while the card is on screen: the playhead (the engine's own step
 * for the audible tick), and a repaint when the Harmony tab's root or scale
 * has changed since the labels were drawn — a root knob goes through
 * `ctx.change` alone, which re-renders nothing.
 */
function watch(strip: GridStrip): void {
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

function lengthKnob(strip: GridStrip): HTMLElement {
  return makeKnob({
    ...GRID_LENGTH_KNOB,
    color: PITCH_COLOR,
    get: () => strip.spec()?.length ?? 1,
    set: (v) => {
      const spec = strip.spec();
      if (!spec) return;
      const length = Math.round(v);
      const change = { sequencer: { length, steps: stepsForLength(spec.steps, length) } };
      if (strip.ctx.change(partChange(strip.slot, change)).ok) strip.repaint();
    },
  });
}

/** Rotate applies the turn since its last value, so the document holds the rotated steps and no offset. */
function rotateKnob(strip: GridStrip): HTMLElement {
  let turned = 0;
  return makeKnob({
    ...GRID_ROTATE_KNOB,
    color: PITCH_COLOR,
    get: () => turned,
    set: (v) => {
      const target = Math.round(v);
      const by = target - turned;
      if (by === 0) return;
      turned = target;
      commit(strip, (spec) => rotateSteps(spec.steps, by, spec.length));
    },
  });
}

function randomizeButton(strip: GridStrip): HTMLElement {
  const button = el('button', 'btn', 'Randomize') as HTMLButtonElement;
  button.type = 'button';
  button.style.borderColor = PITCH_COLOR;
  button.title = 'Every step: a random degree from the key, octave, accent and slide';
  button.onclick = (): void =>
    commit(strip, (spec) =>
      randomSteps(
        spec.steps.length,
        scaleOffsets(strip.ctx.model.doc.key.scale).length,
        Math.random,
      ),
    );
  return button;
}

/** Vel first, Length second, then the rest of the table, then Rotate: the row order the card had. */
function controls(strip: GridStrip): HTMLElement {
  const { ctx, slot } = strip;
  const [velocity, ...rest] = GRID_KNOBS;
  const row = el('div', 'knob-row');
  if (velocity) row.appendChild(tableKnob(ctx, slot, velocity, PITCH_COLOR));
  row.appendChild(lengthKnob(strip));
  for (const entry of rest) row.appendChild(tableKnob(ctx, slot, entry, PITCH_COLOR));
  row.appendChild(rotateKnob(strip));
  return row;
}

/** The card body for a `grid` part: controls, the step strip, the hint. */
export function gridCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  const strip: GridStrip = {
    ctx,
    slot,
    root: el('div', 'grid-strip'),
    playing: -1,
    spec: () => specOf(ctx, slot, 'grid'),
    repaint: () => repaint(strip),
  };
  body.appendChild(controls(strip));
  const tools = el('div', 'capture-row');
  tools.appendChild(divisorPicker(ctx, slot));
  tools.appendChild(randomizeButton(strip));
  body.appendChild(tools);
  body.appendChild(strip.root);
  body.appendChild(el('p', 'hint', HINT));
  repaint(strip);
  watch(strip);
  return body;
}
