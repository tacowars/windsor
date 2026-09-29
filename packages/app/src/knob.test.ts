/**
 * A knob's gestures as undo steps (windsor#130 decisions 2–4), driven through
 * `attachKnobInput` over a stand-in element and window: a drag is one step
 * from press to release, it still closes when the knob never hears the
 * release, and arrow presses less than `UNDO_MERGE_MS` apart are one step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentPartial } from '@windsor/engine';
import { FakeElement, fire, openGestureConsole } from './__fixtures__/gestureConsole';
import { partChange } from './context';
import { settleGestures } from './gestureHooks';
import { attachKnobInput, continuesKeySteps } from './knob';
import type { KnobSpec, Scale } from './knob';

const level = (value: number): DocumentPartial => partChange(0, { strip: { level: value } });
const LINEAR: Scale = { toNorm: (v) => v, fromNorm: (n) => Math.min(1, Math.max(0, n)) };

type Ctx = ReturnType<typeof openGestureConsole>;
const levelOf = (ctx: Ctx): number => ctx.model.doc.parts[0]?.strip.level ?? NaN;

let win: EventTarget;
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.useFakeTimers();
});
afterEach(() => {
  settleGestures();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** A Level knob on part 0's strip, attached to a stand-in element. */
function levelKnob(ctx: Ctx): FakeElement {
  const node = new FakeElement();
  const spec: KnobSpec = {
    label: 'Level',
    min: 0,
    max: 1,
    def: 0.5,
    step: 0.01,
    get: () => levelOf(ctx),
    set: (v) => void ctx.change(level(v)),
  };
  attachKnobInput(node as unknown as HTMLElement, spec, LINEAR, (v) => spec.set(v));
  return node;
}

/** Press at y 100 and move down in 10 px steps: a drag of many moves. */
function dragDown(node: FakeElement, moves: number): void {
  fire(node, 'pointerdown', { clientY: 100 });
  for (let i = 1; i <= moves; i++) fire(node, 'pointermove', { clientY: 100 + i * 10 });
}

describe('a knob drag', () => {
  it('is one step: undo gives the value before the press, redo the value at release', () => {
    const ctx = openGestureConsole();
    const before = levelOf(ctx);
    const node = levelKnob(ctx);
    dragDown(node, 8);
    fire(node, 'pointerup');
    const released = levelOf(ctx);
    expect(released).not.toBe(before);
    expect(ctx.undoLabel).toBe('Level');
    expect(ctx.undo()).toBe(true);
    expect(levelOf(ctx)).toBe(before);
    expect(ctx.canUndo).toBe(false);
    expect(ctx.redo()).toBe(true);
    expect(levelOf(ctx)).toBe(released);
  });

  it.each(['pointerup', 'blur'])(
    'closes on the window’s %s when the knob never hears one (removed mid-drag)',
    (type) => {
      const ctx = openGestureConsole();
      const node = levelKnob(ctx);
      dragDown(node, 4);
      fire(win, type);
      // The knob follows the cursor no further, and the next edit is its own step.
      const ended = levelOf(ctx);
      fire(node, 'pointermove', { clientY: 400 });
      expect(levelOf(ctx)).toBe(ended);
      ctx.change(level(0.9));
      expect(ctx.undo()).toBe(true);
      expect(levelOf(ctx)).toBe(ended);
      expect(ctx.undo()).toBe(true);
      expect(ctx.canUndo).toBe(false);
    },
  );

  it('ends when a move finds the button up, and the next drag is a step of its own', () => {
    const ctx = openGestureConsole();
    const node = levelKnob(ctx);
    dragDown(node, 3);
    fire(node, 'pointermove', { clientY: 0, buttons: 0 });
    dragDown(node, 2);
    fire(node, 'pointerup');
    expect(ctx.undo()).toBe(true);
    expect(ctx.undo()).toBe(true);
    expect(ctx.canUndo).toBe(false);
  });
});

describe('arrow keys on a knob', () => {
  const arrow = (node: FakeElement, key = 'ArrowDown'): void => fire(node, 'keydown', { key });

  it('makes three presses within 500 ms one step', () => {
    const ctx = openGestureConsole();
    const before = levelOf(ctx);
    const node = levelKnob(ctx);
    for (let i = 0; i < 3; i++) {
      arrow(node);
      vi.advanceTimersByTime(150);
    }
    vi.advanceTimersByTime(500);
    expect(levelOf(ctx)).not.toBe(before);
    expect(ctx.undoLabel).toBe('Level');
    expect(ctx.undo()).toBe(true);
    expect(levelOf(ctx)).toBe(before);
    expect(ctx.canUndo).toBe(false);
  });

  it('makes two presses 600 ms apart two steps', () => {
    const ctx = openGestureConsole();
    const node = levelKnob(ctx);
    arrow(node);
    vi.advanceTimersByTime(600);
    arrow(node, 'ArrowLeft');
    vi.advanceTimersByTime(600);
    expect(ctx.undo()).toBe(true);
    expect(ctx.undo()).toBe(true);
    expect(ctx.canUndo).toBe(false);
  });

  it('closes the step when the knob loses focus', () => {
    const ctx = openGestureConsole();
    const node = levelKnob(ctx);
    arrow(node);
    fire(node, 'blur');
    arrow(node);
    vi.advanceTimersByTime(500);
    expect(ctx.undo()).toBe(true);
    expect(ctx.undo()).toBe(true);
  });

  it('continues on another arrow on the knob or a modifier, and on nothing else', () => {
    const node = new FakeElement();
    const other = new FakeElement();
    const seen = (target: EventTarget, type: string, key?: string): boolean => {
      let result = false;
      target.addEventListener(type, (e) => (result = continuesKeySteps(e, node)), { once: true });
      fire(target, type, { key });
      return result;
    };
    expect(seen(node, 'keydown', 'ArrowLeft')).toBe(true);
    expect(seen(other, 'keydown', 'Shift')).toBe(true);
    expect(seen(other, 'keydown', 'ArrowLeft')).toBe(false);
    expect(seen(node, 'keydown', 'z')).toBe(false);
    expect(seen(node, 'pointerdown')).toBe(false);
  });
});
