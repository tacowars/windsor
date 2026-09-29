/**
 * A number box's drag as one undo step (windsor#130 decision 5), driven
 * through `attachDrag` over stand-in elements for the transport strip's BPM,
 * Bars and Swing boxes, with their own set and drag rules.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ArrangementDocument } from '@windsor/engine';
import { FakeElement, fire, openGestureConsole } from './__fixtures__/gestureConsole';
import type { NumberBoxSpec } from './numberDrag';
import { attachDrag, attachTyping } from './numberDrag';
import {
  barsChange,
  bpmChange,
  dragBars,
  dragBpm,
  dragSwing,
  swingChange,
  swingOf,
} from './transportModel';

type Ctx = ReturnType<typeof openGestureConsole>;

interface BoxCase {
  label: string;
  get: (doc: ArrangementDocument) => number;
  set: (ctx: Ctx, v: number) => void;
  drag: NumberBoxSpec['drag'];
}

const BOXES: BoxCase[] = [
  {
    label: 'BPM',
    get: (doc) => doc.transport.bpm,
    set: (ctx, v) => void ctx.change(bpmChange(v)),
    drag: dragBpm,
  },
  {
    label: 'Bars',
    get: (doc) => doc.transport.bars,
    set: (ctx, v) => void ctx.change(barsChange(v)),
    drag: dragBars,
  },
  {
    label: 'Swing',
    get: (doc) => swingOf(doc.transport).amount,
    set: (ctx, v) => void ctx.change(swingChange(swingOf(ctx.model.doc.transport), { amount: v })),
    drag: dragSwing,
  },
];

let win: EventTarget;
beforeEach(() => {
  win = new EventTarget();
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => vi.unstubAllGlobals());

function box(ctx: Ctx, which: BoxCase): FakeElement {
  const node = new FakeElement();
  const spec: NumberBoxSpec = {
    label: which.label,
    unit: '',
    inputMode: 'numeric',
    get: () => which.get(ctx.model.doc),
    set: (v) => which.set(ctx, v),
    format: String,
    parse: () => null,
    drag: which.drag,
  };
  const input = Object.assign(new FakeElement(), {
    focus: () => {},
    select: () => {},
  }) as unknown as HTMLInputElement;
  attachDrag(node as unknown as HTMLElement, input, spec, () => {});
  return node;
}

/** Press at y 300 and move up in 20 px steps. */
function dragUp(node: FakeElement, moves: number): void {
  fire(node, 'pointerdown', { clientY: 300 });
  for (let i = 1; i <= moves; i++) fire(node, 'pointermove', { clientY: 300 - i * 20 });
}

describe('a number box drag', () => {
  it.each(BOXES)('is one step on $label', (which) => {
    const ctx = openGestureConsole();
    const before = which.get(ctx.model.doc);
    const node = box(ctx, which);
    dragUp(node, 6);
    fire(node, 'pointerup');
    const released = which.get(ctx.model.doc);
    expect(released).not.toBe(before);
    expect(ctx.undoLabel).toBe(which.label);
    expect(ctx.undo()).toBe(true);
    expect(which.get(ctx.model.doc)).toBe(before);
    expect(ctx.canUndo).toBe(false);
    expect(ctx.redo()).toBe(true);
    expect(which.get(ctx.model.doc)).toBe(released);
  });

  it('closes on a window blur the box never hears, so the next edit is its own step', () => {
    const ctx = openGestureConsole();
    const [bpm] = BOXES;
    const node = box(ctx, bpm!);
    dragUp(node, 3);
    fire(win, 'blur');
    const ended = ctx.model.doc.transport.bpm;
    fire(node, 'pointermove', { clientY: 0 });
    expect(ctx.model.doc.transport.bpm).toBe(ended);
    ctx.change(bpmChange(90));
    expect(ctx.undo()).toBe(true);
    expect(ctx.model.doc.transport.bpm).toBe(ended);
    expect(ctx.undo()).toBe(true);
    expect(ctx.canUndo).toBe(false);
  });

  it('records nothing for a click that only focuses the box to type', () => {
    const ctx = openGestureConsole();
    const node = box(ctx, BOXES[0]!);
    fire(node, 'pointerdown', { clientY: 300 });
    fire(node, 'pointerup', { clientY: 300 });
    expect(ctx.canUndo).toBe(false);
  });
});

describe('a typed entry', () => {
  it.each(BOXES)('commits as one step named $label', (which) => {
    const ctx = openGestureConsole();
    const before = which.get(ctx.model.doc);
    const input = Object.assign(new FakeElement(), { value: '', blur: () => {} });
    const spec: NumberBoxSpec = {
      label: which.label,
      unit: '',
      inputMode: 'numeric',
      get: () => which.get(ctx.model.doc),
      set: (v) => which.set(ctx, v),
      format: String,
      parse: () => before + 1,
      drag: which.drag,
    };
    attachTyping(input as unknown as HTMLInputElement, spec, () => {});
    fire(input, 'focus');
    fire(input, 'input');
    fire(input, 'blur');
    expect(which.get(ctx.model.doc)).not.toBe(before);
    expect(ctx.undoLabel).toBe(which.label);
    expect(ctx.undo()).toBe(true);
    expect(which.get(ctx.model.doc)).toBe(before);
  });
});
