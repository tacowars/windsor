/**
 * Select's undo steps on Spectre's workbench (windsor#852): a double-click's
 * first press and its clear are one step, back to the selection from before
 * it, while a press, a drag, Shift-add and Alt-remove stay one step each.
 * The canvas is a stand-in that is its own window, so every event fired on it
 * reaches the gesture's listeners with the canvas as its target; the history
 * is a stand-in that records a step at each outermost gesture end that
 * changed the spec, as `AppContext` does. Every pointer event carries
 * `detail` 0, as a browser sends it, so a second press is told apart by its
 * place and time alone; only `click` and `dblclick` count clicks.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_SPECTRE } from '@windsor/engine';
import type { SpectreSpec } from '@windsor/engine';
import { FakeElement, fire } from './__fixtures__/gestureConsole';
import { setGestureHook } from './gestureHooks';
import { benchLayout, cellWidth, xOfCell } from './spectreBenchModel';
import { wireSpectreBench } from './spectreBenchInput';
import type { SpectreTool } from './spectreBenchTables';
import { UNDO_MERGE_MS } from './undoConstants';

class FakeCanvas extends FakeElement {
  focus(): void {}
}

const layout = benchLayout(1000, 600);
const laneY = layout.lanes[0]!.top + 10;
const xAt = (cell: number): number => xOfCell(layout, cell) + cellWidth(layout) / 2;

function bench(selection: SpectreSpec['selection']) {
  const canvas = new FakeCanvas();
  let spec: SpectreSpec = { ...DEFAULT_SPECTRE, selection };
  const steps: SpectreSpec[] = [];
  let depth = 0;
  let before: SpectreSpec | null = null;
  setGestureHook({
    begin: () => {
      if (depth++ === 0) before = spec;
    },
    end: () => {
      if (--depth > 0) return;
      if (before && JSON.stringify(before) !== JSON.stringify(spec)) steps.push(before);
      before = null;
    },
  });
  wireSpectreBench(
    {
      canvas: canvas as unknown as HTMLCanvasElement,
      layout: () => layout,
      spec: () => spec,
      commit: (next) => {
        spec = next;
      },
      tool: (): SpectreTool => 'select',
      width: () => 1,
      levels: () => 0,
      snap: () => false,
      grid: () => 0,
      channel: () => 0,
      hover: () => {},
      setFocus: () => {},
    },
    canvas,
  );
  const at = (cell: number) => ({ clientX: xAt(cell), clientY: laneY });
  return {
    steps,
    selection: () => spec.selection,
    /** Undo the last step, as the history would. */
    undo: () => {
      spec = steps.pop()!;
    },
    /** One press at `cell` dragged to `to`, released, and its click (the `clicks`th in a row). */
    press(cell: number, to = cell, fields: Record<string, unknown> = {}, clicks = 1) {
      fire(canvas, 'pointerdown', { ...at(cell), detail: 0, ...fields });
      if (to !== cell) fire(canvas, 'pointermove', { ...at(to), detail: 0 });
      fire(canvas, 'pointerup', { ...at(to), buttons: 0, detail: 0 });
      fire(canvas, 'click', { ...at(to), detail: clicks });
    },
    /** A double-click's second press at `cell`, and its `dblclick`. */
    secondPress(cell: number) {
      this.press(cell, cell, {}, 2);
      fire(canvas, 'dblclick', { ...at(cell), detail: 2 });
    },
    doubleClick(cell: number) {
      this.press(cell);
      this.secondPress(cell);
    },
    key: () => fire(canvas, 'keydown', { key: 'z' }),
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  setGestureHook(null);
});

describe('Select on the workbench', () => {
  it('clears on a double-click in one step, which undoes to the selection before it', () => {
    const b = bench([[20, 41]]);
    b.doubleClick(70);
    expect(b.selection()).toEqual([]);
    expect(b.steps).toHaveLength(1);
    b.undo();
    expect(b.selection()).toEqual([[20, 41]]);
  });

  it('makes a still press, a drag, Shift-add and Alt-remove one step each', () => {
    const b = bench([]);
    b.press(10);
    vi.advanceTimersByTime(UNDO_MERGE_MS);
    b.press(20, 40);
    b.press(60, 70, { shiftKey: true });
    b.press(30, 35, { altKey: true });
    b.press(90);
    b.key();
    expect(b.selection()).toEqual([[90, 91]]);
    expect(b.steps.map((s) => s.selection)).toEqual([
      [],
      [[10, 11]],
      [[20, 41]],
      [
        [20, 41],
        [60, 71],
      ],
      [
        [20, 30],
        [36, 41],
        [60, 71],
      ],
    ]);
  });

  it('clears as a step of its own when the second press comes after the held step closed', () => {
    const b = bench([[20, 41]]);
    b.press(70);
    vi.advanceTimersByTime(UNDO_MERGE_MS);
    b.secondPress(70);
    expect(b.selection()).toEqual([]);
    expect(b.steps.map((s) => s.selection)).toEqual([[[20, 41]], [[70, 71]]]);
  });

  it('starts a fresh stroke on a press at the same cell once the window has passed', () => {
    const b = bench([]);
    b.press(70);
    vi.advanceTimersByTime(UNDO_MERGE_MS);
    b.press(70, 75);
    expect(b.selection()).toEqual([[70, 76]]);
    expect(b.steps.map((s) => s.selection)).toEqual([[], [[70, 71]]]);
  });

  it('starts a fresh step on a press at another cell inside the double-click window', () => {
    const b = bench([[20, 41]]);
    b.press(70);
    b.press(10);
    b.key();
    expect(b.selection()).toEqual([[10, 11]]);
    expect(b.steps.map((s) => s.selection)).toEqual([[[20, 41]], [[70, 71]]]);
  });
});
