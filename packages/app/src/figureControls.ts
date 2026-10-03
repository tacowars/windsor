/**
 * The Figure device's Play columns (windsor#490, the mockup's; the Arp's
 * order with the Grid's Length and Rotate): Rate, Seed with Reseed beside
 * it, and Randomize; Octave, Length and Rotate; Vel, Acc vel and Acc mod;
 * Gate and Skip. Every control writes the selected region's pattern through
 * `changePattern`, the seed the part's and Vel the part's velocity.
 *
 * Length grows the cells (and the lanes) with root notes and never cuts
 * them; Rotate applies the turn since its last value, so the document holds
 * the turned cells, their velocities, ratchets and lane values with them,
 * and no offset; Randomize rerolls the line's cells over the chord's tones.
 * Length and Randomize replace what Rotate turned, so they rebase it. With
 * a source those three act on cells the part does not play, so the device
 * greys them (`.figure-own`).
 */
import type { FigureSpec } from '@windsor/engine';
import { DEFAULT_FIGURE_CONFIG } from '@windsor/engine';
import { ICON_RESEED } from './arpCard';
import { arpSeedChange, freshSeed, parseSeed } from './arpModel';
import { regionChord } from './chordRegionChord';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { divisorOptions } from './divisorLabels';
import { el, select } from './dom';
import { FIGURE_KNOB_COLUMNS, FIGURE_SUMMARY_STACK } from './figureConstants';
import { cellsForLength, randomFigureCells, rotateFigure } from './figureModel';
import { GRID_TURN_REBASED } from './gridModel';
import { octaveKnob } from './harmonyTables';
import { type KnobElement, makeKnob } from './knob';
import { changePattern } from './partEdits';
import { tableKnob } from './seqFields';
import { FIGURE_KNOBS, FIGURE_LENGTH_KNOB, FIGURE_ROTATE_KNOB } from './sequencerKnobTables';
import { railIcon, railSvg } from './sequencerRail';
import { lanesForSteps } from './stepModLaneModel';
import { specOf } from './stepStrip';

/** The part on `slot`, the region whose pattern the controls edit, and the strip's repaint. */
export interface FigureTarget {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
  readonly repaint: () => void;
}

const spec = ({ ctx, slot, region }: FigureTarget): FigureSpec =>
  specOf(ctx, slot, 'figure', region) ?? { kind: 'figure', ...DEFAULT_FIGURE_CONFIG };

/** Write pattern fields and repaint the strip when they took. */
function write(target: FigureTarget, fields: Record<string, unknown>): boolean {
  const ok = changePattern(target.ctx, target.slot, target.region, fields);
  if (ok) target.repaint();
  return ok;
}

function column(className: string, nodes: readonly HTMLElement[]): HTMLElement {
  const col = el('div', `seq-col ${className}`);
  col.append(...nodes);
  return col;
}

/** Rotate's offset from the cells it last turned, and its knob, which Length and Randomize rebase. */
interface Rotor {
  turned: number;
  knob: KnobElement | null;
}

function rebase(rotor: Rotor): void {
  rotor.turned = GRID_TURN_REBASED;
  rotor.knob?.refresh();
}

function rateField(target: FigureTarget): HTMLElement {
  const { ctx } = target;
  return select(
    'Rate',
    divisorOptions(ctx.model.doc.transport.meter),
    String(spec(target).divisor),
    (v) => {
      if (write(target, { divisor: Number(v) })) ctx.render();
    },
  );
}

/** The Seed field, and Reseed as an icon beside it, as the Arp's. */
function seedField(target: FigureTarget): HTMLElement {
  const { ctx, slot } = target;
  const field = document.createElement('input');
  field.className = 'field';
  field.name = 'figure-seed';
  field.inputMode = 'numeric';
  field.setAttribute('aria-label', 'Seed');
  field.title = 'The part’s random stream: what Skip draws from';
  field.value = String(spec(target).seed);
  field.onchange = (): void => {
    const seed = parseSeed(field.value);
    if (seed === null || !ctx.change(arpSeedChange(slot, seed)).ok) {
      field.value = String(spec(target).seed);
    }
  };
  const reseed = railIcon(
    'A new seed: the part restarts its random stream now',
    'seq-icon figure-reseed',
  );
  reseed.setAttribute('aria-label', 'Reseed');
  reseed.appendChild(railSvg(ICON_RESEED, 'seq-icon-svg seq-line-icon'));
  reseed.onclick = (): void => {
    const seed = freshSeed(spec(target).seed, Math.random);
    if (ctx.change(arpSeedChange(slot, seed)).ok) field.value = String(seed);
  };
  const row = el('div', 'figure-seed');
  row.append(field, reseed);
  const wrap = el('div');
  wrap.append(el('span', 'field-label', 'Seed'), row);
  return wrap;
}

function randomizeButton(target: FigureTarget, rotor: Rotor): HTMLElement {
  const button = el('button', 'btn seq-btn figure-own', 'Randomize') as HTMLButtonElement;
  button.type = 'button';
  button.title =
    'Reroll the line: tones over the chord, a velocity, accent, slide, an octave now and then, a tie or rest';
  button.onclick = (): void => {
    const now = spec(target);
    const size =
      regionChord(target.ctx, target.slot, target.region)?.stack.length ??
      FIGURE_SUMMARY_STACK.length;
    rebase(rotor);
    write(target, { cells: randomFigureCells(now.cells, now.length, size, Math.random) });
  };
  return button;
}

/** The pattern's register octave: where the chord's tones are voiced. */
function octave(target: FigureTarget): HTMLElement {
  return makeKnob({
    ...octaveKnob('figure'),
    color: PITCH_COLOR,
    get: () => spec(target).register.octave,
    set: (v) => {
      if (write(target, { register: { octave: v } })) target.ctx.invalidate();
    },
  });
}

function lengthKnob(target: FigureTarget, rotor: Rotor): HTMLElement {
  const knob = makeKnob({
    ...FIGURE_LENGTH_KNOB,
    color: PITCH_COLOR,
    get: () => spec(target).length,
    set: (v) => {
      const now = spec(target);
      const length = Math.round(v);
      if (length === now.length) return;
      rebase(rotor);
      const cells = cellsForLength(now.cells, length);
      write(target, { length, cells, lanes: lanesForSteps(now.lanes, cells.length) });
    },
  });
  knob.classList.add('figure-own');
  return knob;
}

function rotateKnob(target: FigureTarget, rotor: Rotor): KnobElement {
  const knob = makeKnob({
    ...FIGURE_ROTATE_KNOB,
    color: PITCH_COLOR,
    get: () => rotor.turned,
    set: (v) => {
      const to = Math.round(v);
      const by = to - rotor.turned;
      rotor.turned = to;
      if (by !== 0) write(target, rotateFigure(spec(target), by));
    },
  });
  knob.classList.add('figure-own');
  rotor.knob = knob;
  return knob;
}

/** The Play columns, with no section label: the page tabs name the page. */
export function figureControls(target: FigureTarget): HTMLElement {
  const { ctx, slot, region } = target;
  const knob = (field: string): HTMLElement[] => {
    const entry = FIGURE_KNOBS.find((e) => e.f === field);
    return entry ? [tableKnob(ctx, slot, entry, PITCH_COLOR, region)] : [];
  };
  const rotor: Rotor = { turned: GRID_TURN_REBASED, knob: null };
  const body = el('div', 'seq-sec-body');
  body.append(
    column('wide figure-fields', [
      rateField(target),
      seedField(target),
      randomizeButton(target, rotor),
    ]),
    column('k3', [octave(target), lengthKnob(target, rotor), rotateKnob(target, rotor)]),
    ...FIGURE_KNOB_COLUMNS.map((fields) => column('k3', fields.flatMap(knob))),
  );
  const section = el('div', 'seq-section play figure-play');
  section.appendChild(body);
  return section;
}
