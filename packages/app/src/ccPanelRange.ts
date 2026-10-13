/**
 * A Range end in the MIDI CC panel (windsor#784, the mockup's `.cc-val`):
 * dragged like a knob, up to raise it and Shift for fine, as one undo step,
 * or double-clicked to type a value in the target's units. The values are
 * `ccPanelRangeModel.ts`'s; the edit is the panel's.
 */
import type { CcRangeEnd } from './ccPanelEdits';
import type { CcRowView } from './ccPanelModel';
import { draggedValue, parseRangeText } from './ccPanelRangeModel';
import { readout } from './automationReadout';
import { el } from './dom';
import { dragGesture } from './gestureHooks';

/** What a Range end asks of the panel. */
export interface RangeCellActions {
  /** Set `end` of the row's mapping to `value`: inside the drag's undo step while one is open. */
  rangeEnd(row: CcRowView, end: CcRangeEnd, value: number): void;
  /** A drag or a typed value holds the panel's redraw, which would replace this cell; false lets it go. */
  hold(on: boolean): void;
}

/** The undo step's name for a range drag. */
const RANGE_STEP = 'MIDI CC range';

/** Drag the end: one undo step from press to release. */
function wireDrag(
  value: HTMLElement,
  view: CcRowView,
  end: CcRangeEnd,
  actions: RangeCellActions,
): void {
  value.onpointerdown = (e): void => {
    const { row, mapping } = view;
    if (e.button !== 0 || !row || !mapping) return;
    e.preventDefault();
    const start = mapping[end];
    const y0 = e.clientY;
    const gesture = dragGesture(RANGE_STEP);
    actions.hold(true);
    value.setPointerCapture(e.pointerId);
    value.onpointermove = (move): void => {
      const next = draggedValue(row, start, move.clientY - y0, move.shiftKey);
      actions.rangeEnd(view, end, next);
      value.textContent = readout(row, next);
    };
    const release = (): void => {
      value.onpointermove = null;
      value.onpointerup = null;
      value.onpointercancel = null;
      gesture.close();
      actions.hold(false);
    };
    value.onpointerup = release;
    value.onpointercancel = release;
  };
}

/** Type the end: Enter or leaving the field commits, Escape puts the value back. */
function wireTyping(
  value: HTMLElement,
  view: CcRowView,
  end: CcRangeEnd,
  actions: RangeCellActions,
): void {
  value.ondblclick = (): void => {
    const { row } = view;
    if (!row) return;
    const input = document.createElement('input');
    input.className = 'field cc-val-input';
    input.setAttribute('aria-label', `${view.name} range ${end}`);
    input.value = value.textContent ?? '';
    let done = false;
    const finish = (commit: boolean): void => {
      if (done) return;
      done = true;
      const typed = commit ? parseRangeText(row, input.value) : undefined;
      input.replaceWith(value);
      actions.hold(false);
      if (typed !== undefined) actions.rangeEnd(view, end, typed);
    };
    input.onkeydown = (e): void => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') {
        e.stopPropagation();
        finish(false);
      }
    };
    input.onblur = (): void => finish(true);
    actions.hold(true);
    value.replaceWith(input);
    input.focus();
    input.select();
  };
}

/** One end of a mapping's range, `text` its value as the target reads it. */
export function rangeValue(
  view: CcRowView,
  end: CcRangeEnd,
  text: string,
  actions: RangeCellActions,
): HTMLElement {
  const value = el('span', 'cc-val', text);
  if (!view.mapping) return value;
  value.tabIndex = 0;
  value.title = 'Drag, Shift-drag for fine; double-click to type';
  value.setAttribute('aria-label', `${view.name} range ${end}`);
  wireDrag(value, view, end, actions);
  wireTyping(value, view, end, actions);
  return value;
}
