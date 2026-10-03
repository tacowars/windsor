/**
 * The Figure device's Process page (windsor#490, the mockup's; record
 * `2026-10-03-figure-sequencer` decisions 4–6): three sections.
 *
 * - **Schedule** (`figureSchedule.ts`): the stage chips and the cycle.
 * - **Drift**: Steps −4..4 and Every 1..64 bars, and the readout. Every is
 *   dim while Steps is 0, which plays as no drift.
 * - **Source**: the part picker, "Own cells" then the song's other Figure
 *   parts by name, with Offset and Transpose, a readout and the hint that a
 *   chain follows one level (windsor#487 decision 5). Choosing a leader
 *   greys the Cells strip and draws the leader's cells there.
 *
 * Schedule, drift and source are pattern fields, written through
 * `changePattern`; going back to the own cells drops `source`, which a
 * merge cannot, so that write is the region's whole pattern. The page
 * repaints its readouts, chips and picker every frame from the document
 * (`paint`), never rebuilding a knob under a drag.
 */
import type { FigureSource, FigureSpec } from '@windsor/engine';
import { DEFAULT_FIGURE_CONFIG, partAt } from '@windsor/engine';
import { PITCH_COLOR } from './consoleColors';
import type { AppCtx } from './context';
import { partChange } from './context';
import { el } from './dom';
import {
  OWN_CELLS,
  SOURCE_HINT,
  driftChange,
  driftReadout,
  scheduleReadout,
  sourceChange,
  sourceChoice,
  sourceOptions,
  sourceReadout,
  withoutSource,
} from './figureProcessModel';
import { type ScheduleChips, scheduleChips } from './figureSchedule';
import { makeKnob } from './knob';
import { changePattern, patternCopy } from './partEdits';
import { FIGURE_PROCESS_KNOBS } from './sequencerKnobTables';
import { specOf } from './stepStrip';

/** The page's root and its per-frame paint, with the stage in play. */
export interface ProcessPage {
  readonly root: HTMLElement;
  paint(stage: number): void;
}

/** The part, the region whose pattern the page edits, and the strip's repaint. */
interface Target {
  readonly ctx: AppCtx;
  readonly slot: number;
  readonly region: number | undefined;
  readonly repaint: () => void;
}

const spec = ({ ctx, slot, region }: Target): FigureSpec =>
  specOf(ctx, slot, 'figure', region) ?? { kind: 'figure', ...DEFAULT_FIGURE_CONFIG };

function write(target: Target, fields: Record<string, unknown>): void {
  if (changePattern(target.ctx, target.slot, target.region, fields)) target.repaint();
}

/** Back to the own cells: the region's whole pattern without its source. */
function dropSource(target: Target): void {
  const { ctx, slot, region } = target;
  const part = partAt(ctx.model.doc, slot);
  if (!part || region === undefined || !part.regions[region]) return;
  const pattern = withoutSource(patternCopy(part, region));
  const regions = part.regions.map((r, i) => (i === region ? { ...r, pattern } : r));
  if (ctx.change(partChange(slot, { regions })).ok) target.repaint();
}

function section(
  label: string,
  note: string,
  className: string,
): { root: HTMLElement; body: HTMLElement } {
  const head = el('div', 'seq-sec-label', label);
  if (note) head.appendChild(el('em', '', note));
  const body = el('div', 'figure-stack');
  const wrap = el('div', 'seq-sec-body');
  wrap.appendChild(body);
  const root = el('div', `seq-section ${className}`);
  root.append(head, wrap);
  return { root, body };
}

/** Set an element's text only when it changed: the paint runs every frame. */
function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function scheduleSection(target: Target): {
  root: HTMLElement;
  chips: ScheduleChips;
  readout: HTMLElement;
} {
  const chips = scheduleChips({
    read: () => {
      const now = spec(target);
      return { stages: now.schedule ?? [], cells: now.cells.length };
    },
    write: (schedule) => write(target, { schedule }),
  });
  const readout = el('span', 'figure-readout');
  const { root, body } = section('Schedule', 'length × bars', 'figure-schedule');
  body.append(chips.root, readout);
  return { root, chips, readout };
}

function driftSection(target: Target): {
  root: HTMLElement;
  every: HTMLElement;
  readout: HTMLElement;
} {
  const knob = (field: 'steps' | 'everyBars'): HTMLElement =>
    makeKnob({
      ...FIGURE_PROCESS_KNOBS[field === 'steps' ? 'steps' : 'every'],
      color: PITCH_COLOR,
      get: () =>
        spec(target).drift?.[field] ??
        FIGURE_PROCESS_KNOBS[field === 'steps' ? 'steps' : 'every'].def,
      set: (v) => write(target, { drift: driftChange(spec(target).drift, field, v) }),
    });
  const every = knob('everyBars');
  const row = el('div', 'figure-row');
  row.append(knob('steps'), every);
  const readout = el('span', 'figure-readout');
  const { root, body } = section('Drift', '', 'figure-drift');
  body.append(row, readout);
  return { root, every, readout };
}

interface SourceParts {
  readonly root: HTMLElement;
  readonly picker: HTMLSelectElement;
  readonly knobs: HTMLElement;
  readonly readout: HTMLElement;
}

function sourceKnob(target: Target, field: 'offset' | 'transpose'): HTMLElement {
  return makeKnob({
    ...FIGURE_PROCESS_KNOBS[field],
    color: PITCH_COLOR,
    get: () => spec(target).source?.[field] ?? 0,
    set: (v) => {
      const source = spec(target).source;
      if (source) write(target, { source: sourceChange(source, field, v) });
    },
  });
}

function sourceSection(target: Target): SourceParts {
  const picker = document.createElement('select');
  picker.className = 'field';
  picker.name = 'figure-source';
  picker.setAttribute('aria-label', 'Source part');
  picker.title = SOURCE_HINT;
  picker.onchange = (): void => {
    const choice: FigureSource | null = sourceChoice(picker.value, spec(target).source);
    if (choice) write(target, { source: choice });
    else dropSource(target);
  };
  const field = el('div', 'figure-source-field');
  field.append(el('span', 'field-label', 'Part'), picker);
  const knobs = el('div', 'figure-row');
  knobs.append(sourceKnob(target, 'offset'), sourceKnob(target, 'transpose'));
  const readout = el('span', 'figure-readout');
  const { root, body } = section('Source', '', 'figure-source');
  body.append(field, knobs, readout, el('span', 'figure-hint', SOURCE_HINT));
  return { root, picker, knobs, readout };
}

/** Refill the picker when the song's Figure parts changed, and show the source held now. */
function paintPicker(
  target: Target,
  picker: HTMLSelectElement,
  source: FigureSource | undefined,
): void {
  const options = sourceOptions(target.ctx.model.doc, target.slot);
  const key = JSON.stringify(options);
  if (picker.dataset.options !== key) {
    picker.dataset.options = key;
    picker.replaceChildren(...options.map((o) => new Option(o.label, o.value)));
  }
  const value = source ? String(source.slot) : OWN_CELLS;
  if (picker.value !== value) picker.value = value;
}

/** The Process page for region `region` of the Figure on `slot`; `repaint` redraws the strip. */
export function figureProcessPage(
  ctx: AppCtx,
  slot: number,
  region: number | undefined,
  repaint: () => void,
): ProcessPage {
  const target: Target = { ctx, slot, region, repaint };
  const schedule = scheduleSection(target);
  const drift = driftSection(target);
  const source = sourceSection(target);
  const root = el('div', 'figure-page figure-process');
  root.append(schedule.root, drift.root, source.root);
  const paint = (stage: number): void => {
    const now = spec(target);
    schedule.chips.paint(stage);
    setText(schedule.readout, scheduleReadout(now.schedule, now.length));
    setText(drift.readout, driftReadout(now.drift, now.length));
    drift.every.classList.toggle('dim', !now.drift || now.drift.steps === 0);
    paintPicker(target, source.picker, now.source);
    source.knobs.classList.toggle('dim', !now.source);
    const names = now.source
      ? [partAt(ctx.model.doc, now.source.slot)?.name ?? '']
      : sourceOptions(ctx.model.doc, slot)
          .slice(1)
          .map((o) => o.label);
    setText(source.readout, sourceReadout(now.source, names));
  };
  paint(-1);
  return { root, paint };
}
