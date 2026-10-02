/**
 * The Shape tool's popover (windsor#350 decision 3; record
 * `2026-10-01-song-automation-lanes` decision 13; the mockup's panel A in
 * `docs/design/automation-lanes-mockup.html`): the shape buttons, the Rate,
 * Top, Bottom, Phase and Duty sliders, the readout, and Cancel and Apply.
 *
 * It only shows a draft and reports edits: every slider and button hands the
 * whole clamped draft to `change`, and the caller redraws the preview and
 * calls `show` again. Top and Bottom move in display space and read in the
 * lane's own units. Rate and Phase are disabled for Ramp and S-curve, and
 * Duty for every shape but the square. Where it sits, and what closes it, is
 * `songShapeRange.ts`.
 */
import type { AutomationShapeSpec, AutomationTargetRow } from '@windsor/engine';
import { fromDisplay } from '@windsor/engine';
import { el } from './dom';
import { readout } from './automationReadout';
import { clampDraft, dutyLabel, phaseLabel, rateIndex, shapeControls } from './songShapeModel';
import { SHAPE_CHOICES, SHAPE_LIMITS, SHAPE_RATES } from './songShapeTables';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ICON_VIEWBOX = '0 0 30 16';

/** What the popover reports. */
export interface ShapePopoverHandlers {
  change(draft: AutomationShapeSpec): void;
  apply(): void;
  cancel(): void;
}

/** What the popover shows besides the draft: the lane's name and row, and the readout. */
export interface ShapeShown {
  readonly name: string;
  readonly row: AutomationTargetRow;
  readonly readout: string;
}

export interface ShapePopover {
  readonly element: HTMLElement;
  show(draft: AutomationShapeSpec, shown: ShapeShown): void;
  /** Focus the pressed shape button, for the keyboard. */
  focus(): void;
}

type Field = 'rate' | 'top' | 'bottom' | 'phase' | 'duty';

interface Slider {
  readonly label: HTMLLabelElement;
  readonly input: HTMLInputElement;
  readonly output: HTMLOutputElement;
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', ICON_VIEWBOX);
  svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(SVG_NS, 'path');
  line.setAttribute('d', path);
  svg.appendChild(line);
  return svg;
}

function slider(field: Field, text: string, range: readonly [number, number, number]): Slider {
  const input = document.createElement('input');
  input.type = 'range';
  input.id = `shape-${field}`;
  input.name = `shape-${field}`;
  [input.min, input.max, input.step] = range.map(String) as [string, string, string];
  const label = el('label', '', text) as HTMLLabelElement;
  label.htmlFor = input.id;
  const output = document.createElement('output');
  output.htmlFor.add(input.id);
  return { label, input, output };
}

function button(text: string, className: string): HTMLButtonElement {
  const node = el('button', className, text) as HTMLButtonElement;
  node.type = 'button';
  return node;
}

/** The popover's element, wired to `handlers`. */
// eslint-disable-next-line max-lines-per-function -- the panel's controls, their wiring and their sync read top to bottom as one form
export function shapePopover(handlers: ShapePopoverHandlers): ShapePopover {
  const { phaseSteps, dutyMin, dutyMax, dutyStep, heightStep } = SHAPE_LIMITS;
  const root = el('div', 'shape-pop');
  root.setAttribute('role', 'dialog');
  const title = el('h3', '', 'Shape');
  const range = el('div', 'shape-range');
  const head = el('div', 'shape-head');
  head.append(title, range);

  const kinds = el('div', 'shape-kinds');
  kinds.setAttribute('role', 'group');
  kinds.setAttribute('aria-label', 'Shape');
  const kindButtons = SHAPE_CHOICES.map((choice) => {
    const node = button('', 'shape-kind');
    node.dataset['kind'] = choice.kind;
    node.append(icon(choice.icon), el('span', '', choice.label));
    kinds.appendChild(node);
    return node;
  });

  const sliders: Record<Field, Slider> = {
    rate: slider('rate', 'Rate', [0, SHAPE_RATES.length - 1, 1]),
    top: slider('top', 'Top', [0, 1, heightStep]),
    bottom: slider('bottom', 'Bottom', [0, 1, heightStep]),
    phase: slider('phase', 'Phase', [0, 1, 1 / phaseSteps]),
    duty: slider('duty', 'Duty', [dutyMin, dutyMax, dutyStep]),
  };
  const grid = el('div', 'shape-grid');
  for (const s of Object.values(sliders)) grid.append(s.label, s.input, s.output);

  const cancel = button('Cancel', 'btn');
  const apply = button('Apply', 'btn primary');
  const actions = el('div', 'shape-actions');
  actions.append(
    el('span', 'shape-note', 'Vertical edges get a short de-click ramp.'),
    cancel,
    apply,
  );
  // The body scrolls when the panel is capped to a short window; the actions stay pinned below it.
  const body = el('div', 'shape-body');
  body.append(head, kinds, grid);
  root.append(body, actions);

  let draft: AutomationShapeSpec | null = null;
  const report = (edit: Partial<AutomationShapeSpec>): void => {
    if (draft) handlers.change(clampDraft({ ...draft, ...edit }));
  };
  for (const node of kindButtons) {
    node.onclick = (): void =>
      report({ kind: node.dataset['kind'] as AutomationShapeSpec['kind'] });
  }
  const value = (field: Field): number => Number(sliders[field].input.value);
  sliders.rate.input.oninput = (): void =>
    report({ rateTicks: SHAPE_RATES[value('rate')]?.ticks ?? draft?.rateTicks ?? 0 });
  sliders.top.input.oninput = (): void => report({ top: value('top') });
  sliders.bottom.input.oninput = (): void => report({ bottom: value('bottom') });
  sliders.phase.input.oninput = (): void => report({ phase: value('phase') });
  sliders.duty.input.oninput = (): void => report({ duty: value('duty') });
  cancel.onclick = (): void => handlers.cancel();
  apply.onclick = (): void => handlers.apply();

  const set = (field: Field, at: number, text: string, enabled = true): void => {
    const s = sliders[field];
    s.input.value = String(at);
    s.input.disabled = !enabled;
    s.output.textContent = enabled ? text : '—';
    for (const node of [s.label, s.input, s.output]) node.classList.toggle('dis', !enabled);
  };

  return {
    element: root,
    show(next, shown) {
      draft = next;
      title.textContent = `Shape · ${shown.name}`;
      root.setAttribute('aria-label', `Shape · ${shown.name}`);
      range.textContent = shown.readout;
      for (const node of kindButtons) {
        node.setAttribute('aria-pressed', String(node.dataset['kind'] === next.kind));
      }
      const on = shapeControls(next.kind);
      const rate = rateIndex(next.rateTicks);
      set('rate', rate, SHAPE_RATES[rate]!.label, on.rate);
      set('top', next.top, readout(shown.row, fromDisplay(shown.row, next.top)));
      set('bottom', next.bottom, readout(shown.row, fromDisplay(shown.row, next.bottom)));
      set('phase', next.phase, phaseLabel(next.phase), on.phase);
      set('duty', next.duty, dutyLabel(next.duty), on.duty);
    },
    focus() {
      kindButtons
        .find((b) => b.getAttribute('aria-pressed') === 'true')
        ?.focus({ preventScroll: true });
    },
  };
}
