/**
 * A paint across the User-wave bars as one undo step (windsor#130 decision
 * 6), driven through `attachStroke` over a stand-in canvas and the context's
 * own working patch, so every push is a real `commitPatch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WAVE, makePatch, partAt } from '@windsor/engine';
import type { Patch } from '@windsor/engine';
import { FakeElement, fire, openGestureConsole } from './__fixtures__/gestureConsole';
import { attachStroke } from './harmonicEditor';
import type { PatchEditor } from './partsSession';

type Ctx = ReturnType<typeof openGestureConsole>;

let win: EventTarget;
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal('window', win);
});
afterEach(() => vi.unstubAllGlobals());

const documentPatch = (ctx: Ctx): Patch | undefined => {
  const preset = partAt(ctx.model.doc, 0)?.preset ?? '';
  return ctx.model.doc.patches?.[preset];
};

/** Operator A on a User wave, and a stroke attached to a stand-in bars canvas. */
function paintable(ctx: Ctx): FakeElement {
  ctx.parts.patch = makePatch({ ops: [{ wave: WAVE.USER }] });
  const editor: PatchEditor = {
    get patch() {
      return ctx.parts.patch;
    },
    push: () => void ctx.parts.push(),
    refresh: () => {},
  };
  const canvas = new FakeElement();
  attachStroke(editor, canvas as unknown as HTMLCanvasElement, 0, () => {});
  return canvas;
}

/** Press at the left and sweep right across the bars, a push per move. */
function paint(canvas: FakeElement, moves: number, y = 20): void {
  fire(canvas, 'pointerdown', { clientX: 2, clientY: y });
  for (let i = 1; i <= moves; i++) fire(canvas, 'pointermove', { clientX: 2 + i * 15, clientY: y });
}

describe('a harmonic paint', () => {
  it('is one step across many harmonics', () => {
    const ctx = openGestureConsole();
    const before = documentPatch(ctx);
    const canvas = paintable(ctx);
    paint(canvas, 9);
    fire(canvas, 'pointerup');
    const painted = documentPatch(ctx)?.ops[0]?.userPartials;
    expect(painted?.filter((level) => level > 0).length).toBeGreaterThan(5);
    expect(ctx.undoLabel).toBe('Harmonics');
    expect(ctx.undo()).toBe(true);
    expect(documentPatch(ctx)).toEqual(before);
    expect(ctx.canUndo).toBe(false);
    expect(ctx.redo()).toBe(true);
    expect(documentPatch(ctx)?.ops[0]?.userPartials).toEqual(painted);
  });

  it('closes on a window blur the canvas never hears, and paints no further', () => {
    const ctx = openGestureConsole();
    const canvas = paintable(ctx);
    paint(canvas, 3);
    fire(win, 'blur');
    const ended = documentPatch(ctx);
    fire(canvas, 'pointermove', { clientX: 150, clientY: 5 });
    expect(documentPatch(ctx)).toEqual(ended);
    paint(canvas, 2, 60);
    fire(canvas, 'pointerup');
    expect(ctx.undo()).toBe(true);
    expect(documentPatch(ctx)).toEqual(ended);
    expect(ctx.undo()).toBe(true);
    expect(ctx.canUndo).toBe(false);
  });
});
