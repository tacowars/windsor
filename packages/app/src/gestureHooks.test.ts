/**
 * The gesture hook and its brackets (windsor#130) over a real `AppContext`,
 * whose constructor sets the hook: a bracket's edits are one step, every
 * bracket closes exactly once, a drag closes when the window hears the
 * release or loses focus, and a merge closes on its timer (a fake clock), on
 * an input that does not continue it, or when another gesture opens.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentPartial } from '@windsor/engine';
import { fire, openGestureConsole } from './__fixtures__/gestureConsole';
import { partChange } from './context';
import {
  dragGesture,
  isModifierKey,
  mergedGesture,
  setGestureHook,
  settleGestures,
  withGesture,
} from './gestureHooks';
import { UNDO_MERGE_MS } from './undoConstants';

const level = (value: number): DocumentPartial => partChange(0, { strip: { level: value } });

type Ctx = ReturnType<typeof openGestureConsole>;
const levelOf = (ctx: Ctx): number | undefined => ctx.model.doc.parts[0]?.strip.level;

/** Undo every step; how many there were. */
function undoAll(ctx: Ctx): number {
  let steps = 0;
  while (ctx.undo()) steps++;
  return steps;
}

describe('withGesture', () => {
  it('makes every change inside it one step, named by the gesture', () => {
    const ctx = openGestureConsole();
    const start = levelOf(ctx);
    withGesture('Choose preset', () => {
      ctx.change(level(0.3));
      ctx.change(level(0.4));
    });
    expect(ctx.undoLabel).toBe('Choose preset');
    expect(undoAll(ctx)).toBe(1);
    expect(levelOf(ctx)).toBe(start);
  });

  it('closes when the edit throws, so the next edit is its own step', () => {
    const ctx = openGestureConsole();
    expect(() =>
      withGesture('Broken', () => {
        ctx.change(level(0.3));
        throw new Error('boom');
      }),
    ).toThrow('boom');
    ctx.change(level(0.4));
    expect(undoAll(ctx)).toBe(2);
  });

  it('is a no-op with no hook set', () => {
    const ctx = openGestureConsole();
    setGestureHook(null);
    withGesture('Nothing', () => {
      ctx.change(level(0.3));
      ctx.change(level(0.4));
    });
    expect(undoAll(ctx)).toBe(2);
  });
});

describe('dragGesture', () => {
  let win: EventTarget;
  beforeEach(() => {
    win = new EventTarget();
  });

  it('closes once, however many times it is told to', () => {
    const ctx = openGestureConsole();
    const drag = dragGesture('Cutoff', win);
    ctx.change(level(0.3));
    ctx.beginGesture('Outer');
    drag.close();
    drag.close();
    // A second close would have ended the outer gesture too and recorded it.
    ctx.change(level(0.4));
    expect(ctx.canUndo).toBe(false);
    ctx.endGesture();
    expect(undoAll(ctx)).toBe(1);
  });

  it.each(['pointerup', 'pointercancel', 'blur'])(
    'closes on the window’s %s when the control never hears its release',
    (type) => {
      const ctx = openGestureConsole();
      const drag = dragGesture('Cutoff', win);
      ctx.change(level(0.3));
      ctx.change(level(0.4));
      fire(win, type);
      expect(drag.open).toBe(false);
      ctx.change(level(0.5));
      expect(undoAll(ctx)).toBe(2);
    },
  );

  it('stops listening to the window once closed', () => {
    const ctx = openGestureConsole();
    dragGesture('Cutoff', win).close();
    ctx.beginGesture('Outer');
    ctx.change(level(0.3));
    fire(win, 'blur');
    ctx.change(level(0.4));
    ctx.endGesture();
    expect(undoAll(ctx)).toBe(1);
  });
});

describe('mergedGesture', () => {
  let win: EventTarget;
  beforeEach(() => {
    vi.useFakeTimers();
    win = new EventTarget();
  });
  afterEach(() => {
    settleGestures();
    vi.useRealTimers();
  });

  const merge = (): ReturnType<typeof mergedGesture> =>
    mergedGesture({ label: 'Cutoff', continues: isModifierKey, win });

  /** One press: the merge touched, then its edit, then `gapMs` of quiet. */
  function press(ctx: Ctx, keys: ReturnType<typeof mergedGesture>, value: number, gapMs: number) {
    keys.touch();
    ctx.change(level(value));
    vi.advanceTimersByTime(gapMs);
  }

  it('makes presses less than UNDO_MERGE_MS apart one step, closed by its timer', () => {
    const ctx = openGestureConsole();
    const start = levelOf(ctx);
    const keys = merge();
    press(ctx, keys, 0.3, 200);
    press(ctx, keys, 0.4, 200);
    press(ctx, keys, 0.5, UNDO_MERGE_MS);
    expect(ctx.undoLabel).toBe('Cutoff');
    expect(undoAll(ctx)).toBe(1);
    expect(levelOf(ctx)).toBe(start);
  });

  it('makes presses 600 ms apart two steps', () => {
    const ctx = openGestureConsole();
    const keys = merge();
    press(ctx, keys, 0.3, 600);
    press(ctx, keys, 0.4, 600);
    expect(undoAll(ctx)).toBe(2);
  });

  it('closes on an input that does not continue it, and not on one that does', () => {
    const ctx = openGestureConsole();
    const keys = merge();
    press(ctx, keys, 0.3, 0);
    fire(win, 'keydown', { key: 'Shift' });
    press(ctx, keys, 0.4, 0);
    fire(win, 'pointerdown');
    ctx.change(level(0.5));
    expect(undoAll(ctx)).toBe(2);
  });

  it('closes on close(), on a window blur, and when another gesture opens', () => {
    const ctx = openGestureConsole();
    const keys = merge();
    press(ctx, keys, 0.3, 0);
    keys.close();
    press(ctx, keys, 0.4, 0);
    fire(win, 'blur');
    press(ctx, keys, 0.5, 0);
    withGesture('Choose preset', () => ctx.change(level(0.6)));
    expect(undoAll(ctx)).toBe(4);
  });
});
