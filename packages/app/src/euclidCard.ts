/**
 * The Sequencers tab's Euclidean card (#610): the knobs the old card had —
 * Note, Vel, Hold, Steps, Rotate, the `k` bounds, the divisor, the density
 * modulator — and the figure strip: one cell per step, the onsets lit, the
 * playhead on the audible tick, a `k / n` readout, repainted the frame the
 * player's figure changes, so a modulator moving `k` on a bar line is seen
 * the bar it happens and a Steps turn resizes the strip at once. Clicking a
 * cell flips that step and freezes the figure (the capture path); Release
 * lets the modulator back in. Every edit goes through `ctx.change` and, since
 * the engine reconfigures a Euclidean part live, none restarts the sequencer.
 * The operations are `euclidModel.ts`.
 */
import type { EuclideanSpec } from '../../../packages/client/src/audio/index-for-editor';
import { partAt } from '../../../packages/client/src/audio/index-for-editor';
import { PERC_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el } from './dom';
import {
  countOnsets,
  figureKey,
  playheadStep,
  previewFigure,
  pulsesChange,
  rotateChange,
  stepsChange,
  stepsPerBeat,
  toggleStep,
  type Figure,
  type PulseField,
} from './euclidModel';
import { makeKnob, type KnobElement } from './knob';
import { densityControls, divisorPicker, knobRow as tableKnobRow } from './seqFields';
import {
  EUCLID_KNOBS,
  EUCLID_ROTATE_KNOB,
  EUCLID_STEPS_KNOB,
  euclidPulseKnob,
} from './sequencerKnobTables';

const HINT =
  'Lit cells are the onsets of the figure the player holds; the ring is the playhead. ' +
  'Click a cell to flip it — the figure freezes and the row reads Release, which lets the ' +
  'modulator back in. Steps resizes the strip at once and carries the k bounds along. ' +
  'Nothing here restarts the sequencer; only the divisor rebuilds it.';

const PULSE_FIELDS: readonly PulseField[] = ['min', 'max', 'start'];

function specOf(ctx: AppCtx, slot: number): EuclideanSpec | null {
  const sequencer = partAt(ctx.model.doc, slot)?.sequencer;
  return sequencer?.kind === 'euclidean' ? sequencer : null;
}

/** The strip and what every cell needs to write a figure and redraw. */
interface Card {
  ctx: AppCtx;
  slot: number;
  strip: HTMLElement;
  readout: HTMLElement;
  captureButton: HTMLButtonElement;
  /** The figure the cells show, as `x.` text; repainted when it differs. */
  key: string;
  /** The cell the playhead sits on, or -1; reapplied after every repaint. */
  playing: number;
  /** The knobs a Steps turn can move (the `k` bounds, Rotate): re-read after it commits. */
  dependents: KnobElement[];
}

/** The figure the player holds, or the document's preview while nothing plays. */
function figureOf(card: Card): Figure {
  const live = card.ctx.host.capturePattern(card.slot);
  if (Array.isArray(live) && typeof live[0] === 'boolean') return live as Figure;
  const spec = specOf(card.ctx, card.slot);
  return spec ? previewFigure(spec) : [];
}

function commitPattern(card: Card, pattern: Figure | null): void {
  const result = card.ctx.change(partChange(card.slot, { sequencer: { pattern } }));
  if (!result.ok) return;
  card.captureButton.textContent = pattern ? 'Release' : 'Capture';
  card.ctx.status(
    pattern
      ? `part ${card.slot}: captured — the figure is a literal array in the document`
      : `part ${card.slot}: released back to the modulator`,
  );
}

function cell(card: Card, index: number): HTMLButtonElement {
  const node = el('button', 'ecell') as HTMLButtonElement;
  node.type = 'button';
  node.title = `step ${index + 1}`;
  node.setAttribute('aria-label', `step ${index + 1}`);
  node.onclick = (): void => commitPattern(card, toggleStep(figureOf(card), index));
  return node;
}

/** Rebuild the cells when the figure's length changed, else relight them; then the playhead. */
function paintStrip(card: Card, figure: Figure): void {
  const divisor = specOf(card.ctx, card.slot)?.divisor ?? 0;
  const group = stepsPerBeat(divisor);
  if (card.strip.children.length !== figure.length) {
    card.strip.innerHTML = '';
    figure.forEach((_, i) => card.strip.appendChild(cell(card, i)));
  }
  [...card.strip.children].forEach((node, i) => {
    node.classList.toggle('on', figure[i] === true);
    node.classList.toggle('beat', group > 1 && i > 0 && i % group === 0);
    node.setAttribute('aria-pressed', String(figure[i] === true));
  });
  card.key = figureKey(figure);
  markPlaying(card, card.playing);
}

function markPlaying(card: Card, playing: number): void {
  card.playing = playing;
  [...card.strip.children].forEach((node, i) => node.classList.toggle('playing', i === playing));
}

function readoutText(card: Card, figure: Figure): string {
  const fixed = specOf(card.ctx, card.slot)?.pattern != null;
  return `k ${countOnsets(figure)} / n ${figure.length} · ${fixed ? 'captured' : 'generative'}`;
}

/**
 * Per frame while the card is on screen: the figure (repainted only when it
 * changed — a modulator moving `k`, a knob turn, a capture), the readout,
 * and the playhead from the audible tick while the transport runs.
 */
function watch(card: Card): void {
  const tick = (): void => {
    if (!card.strip.isConnected) return;
    requestAnimationFrame(tick);
    const figure = figureOf(card);
    if (figureKey(figure) !== card.key) paintStrip(card, figure);
    const text = readoutText(card, figure);
    if (card.readout.textContent !== text) card.readout.textContent = text;
    const system = card.ctx.host.system;
    const spec = specOf(card.ctx, card.slot);
    let current = -1;
    if (system && spec && figure.length > 0 && system.scheduler.isRunning) {
      const audible = system.scheduler.audibleTick(system.engine.context.currentTime);
      current = playheadStep(audible, spec.divisor, figure.length);
    }
    if (current !== card.playing) markPlaying(card, current);
  };
  requestAnimationFrame(tick);
}

function stepsKnob(card: Card): HTMLElement {
  return makeKnob({
    ...EUCLID_STEPS_KNOB,
    color: PERC_COLOR,
    get: () => specOf(card.ctx, card.slot)?.steps ?? EUCLID_STEPS_KNOB.def,
    set: (v) => {
      const spec = specOf(card.ctx, card.slot);
      if (!spec) return;
      if (card.ctx.change(partChange(card.slot, { sequencer: stepsChange(spec, v) })).ok) {
        card.dependents.forEach((knob) => knob.refresh());
      }
    },
  });
}

function rotateKnob(card: Card): HTMLElement {
  const knob = makeKnob({
    ...EUCLID_ROTATE_KNOB,
    color: PERC_COLOR,
    get: () => specOf(card.ctx, card.slot)?.rotate ?? EUCLID_ROTATE_KNOB.def,
    set: (v) => {
      const spec = specOf(card.ctx, card.slot);
      if (!spec) return;
      card.ctx.change(partChange(card.slot, { sequencer: { rotate: rotateChange(spec, v) } }));
    },
  });
  card.dependents.push(knob);
  return knob;
}

/** The three `k` knobs; a turn on one may drag another, so all three re-read after a commit. */
function pulsesRow(card: Card): HTMLElement {
  const row = el('div', 'knob-row');
  const knobs = card.dependents;
  for (const field of PULSE_FIELDS) {
    const spec = euclidPulseKnob(field);
    const knob = makeKnob({
      ...spec,
      color: PERC_COLOR,
      get: () => specOf(card.ctx, card.slot)?.pulses[field] ?? spec.def,
      set: (v) => {
        const spec = specOf(card.ctx, card.slot);
        if (!spec) return;
        const pulses = pulsesChange(spec, field, v);
        if (card.ctx.change(partChange(card.slot, { sequencer: { pulses } })).ok) {
          knobs.forEach((k) => k.refresh());
        }
      },
    });
    knobs.push(knob);
    row.appendChild(knob);
  }
  return row;
}

function knobRow(card: Card): HTMLElement {
  const row = tableKnobRow(card.ctx, card.slot, EUCLID_KNOBS, PERC_COLOR);
  row.appendChild(stepsKnob(card));
  row.appendChild(rotateKnob(card));
  return row;
}

/** Capture freezes the figure the strip shows into the document; Release lets go. */
function captureRow(card: Card): HTMLElement {
  const wrap = el('div', 'capture-row');
  card.captureButton.type = 'button';
  card.captureButton.className = 'btn';
  card.captureButton.style.borderColor = PERC_COLOR;
  card.captureButton.textContent = specOf(card.ctx, card.slot)?.pattern ? 'Release' : 'Capture';
  card.captureButton.onclick = (): void => {
    const fixed = specOf(card.ctx, card.slot)?.pattern != null;
    commitPattern(card, fixed ? null : figureOf(card));
  };
  wrap.appendChild(divisorPicker(card.ctx, card.slot));
  wrap.appendChild(card.captureButton);
  return wrap;
}

/** The card body for a Euclidean part: knobs, the k bounds, the strip and readout, the modulator, the hint. */
export function euclidCard(ctx: AppCtx, slot: number): HTMLElement {
  const body = el('div');
  const card: Card = {
    ctx,
    slot,
    strip: el('div', 'euclid-strip'),
    readout: el('div', 'euclid-readout'),
    captureButton: document.createElement('button'),
    key: '',
    playing: -1,
    dependents: [],
  };
  card.strip.setAttribute('role', 'group');
  card.strip.setAttribute('aria-label', 'figure');
  body.appendChild(knobRow(card));
  body.appendChild(pulsesRow(card));
  body.appendChild(card.strip);
  body.appendChild(card.readout);
  body.appendChild(captureRow(card));
  body.appendChild(densityControls(ctx, slot));
  body.appendChild(el('p', 'hint', HINT));
  const figure = figureOf(card);
  paintStrip(card, figure);
  card.readout.textContent = readoutText(card, figure);
  watch(card);
  return body;
}
