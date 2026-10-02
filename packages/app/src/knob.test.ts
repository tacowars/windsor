/**
 * A knob's gestures as undo steps (windsor#130 decisions 2–4), driven through
 * `attachKnobInput` over a stand-in element and window: a drag is one step
 * from press to release, it still closes when the knob never hears the
 * release, and arrow presses less than `UNDO_MERGE_MS` apart are one step.
 * A knob a lane holds (windsor#351) takes none of them, and a press says why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DocumentPartial } from '@windsor/engine';
import { FakeElement, fire, openGestureConsole } from './__fixtures__/gestureConsole';
import { partChange } from './context';
import { settleGestures } from './gestureHooks';
import { KNOB_PAD_PX, KNOB_R } from './knobConstants';
import { attachKnobInput, continuesKeySteps, knobGeometry, scaleFor } from './knob';
import type { KnobSpec, Scale } from './knob';
import type { KnobAutomation } from './knobAutomation';
import { ENVELOPE_KNOBS } from './patchKnobTables';
import { notify } from './toast';

vi.mock('./toast', () => ({ notify: vi.fn() }));

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

/** A Level knob on part 0's strip, attached to a stand-in element; `lock` says what holds it. */
function levelKnob(ctx: Ctx, lock?: () => KnobAutomation | null): FakeElement {
  const node = new FakeElement();
  const spec: KnobSpec = {
    label: 'Level',
    min: 0,
    max: 1,
    def: 0.5,
    step: 0.01,
    get: () => levelOf(ctx),
    set: (v) => void ctx.change(level(v)),
    ...(lock ? { automation: lock } : {}),
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

/**
 * The Attack knob over a plain value, with `makeKnob`'s clamp as its commit:
 * a zero-end log knob (windsor#324 fix round 2), whose old minimum, 0.5 ms,
 * many library patches ship.
 */
function attackKnob(start: number): { node: FakeElement; value: () => number } {
  const o = ENVELOPE_KNOBS.find((k) => k.f === 'attackTime')!.o;
  let value = start;
  const spec: KnobSpec = {
    ...o,
    label: 'Attack',
    def: 0.002,
    get: () => value,
    set: (v) => (value = v),
  };
  const commit = (v: number): void => spec.set(Math.min(o.max, Math.max(o.min, v)));
  const node = new FakeElement();
  attachKnobInput(node as unknown as HTMLElement, spec, scaleFor(o), commit);
  return { node, value: () => value };
}

describe('a zero-distance drag on a zero-end knob (windsor#324)', () => {
  it('commits the old minimum unchanged on a press with sideways jitter', () => {
    const knob = attackKnob(0.0005);
    fire(knob.node, 'pointerdown', { clientX: 50, clientY: 100 });
    fire(knob.node, 'pointermove', { clientX: 53, clientY: 100 });
    fire(knob.node, 'pointermove', { clientX: 47, clientY: 100 });
    fire(knob.node, 'pointerup', { clientY: 100 });
    expect(knob.value()).toBe(0.0005);
  });

  it('puts the value back when a drag returns to where it started', () => {
    const knob = attackKnob(0.0005);
    fire(knob.node, 'pointerdown', { clientY: 100 });
    fire(knob.node, 'pointermove', { clientY: 140 });
    expect(knob.value()).toBe(0);
    fire(knob.node, 'pointermove', { clientY: 100 });
    fire(knob.node, 'pointerup', { clientY: 100 });
    expect(knob.value()).toBe(0.0005);
  });

  it('steps from 0 up to the old minimum and back down to 0, one press each', () => {
    const knob = attackKnob(0);
    fire(knob.node, 'keydown', { key: 'ArrowUp' });
    expect(knob.value()).toBe(0.0005);
    fire(knob.node, 'keydown', { key: 'ArrowDown' });
    expect(knob.value()).toBe(0);
  });
});

describe('a knob double-click', () => {
  it('resets as one step named after the knob, after the clicks’ own empty drags', () => {
    const ctx = openGestureConsole();
    const node = levelKnob(ctx);
    ctx.change(level(0.9));
    const before = levelOf(ctx);
    for (let i = 0; i < 2; i++) {
      fire(node, 'pointerdown', { clientY: 100 });
      fire(node, 'pointerup', { clientY: 100 });
    }
    fire(node, 'dblclick');
    expect(levelOf(ctx)).toBe(0.5);
    expect(ctx.undoLabel).toBe('Level');
    expect(ctx.undo()).toBe(true);
    expect(levelOf(ctx)).toBe(before);
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

describe('a knob a lane holds (windsor#351)', () => {
  const held = { color: 'var(--modulator)', value: 0.8 };

  it('ignores a drag, the keys and a double-click, and a press says why', () => {
    const ctx = openGestureConsole();
    const before = levelOf(ctx);
    vi.mocked(notify).mockClear();
    const node = levelKnob(ctx, () => held);
    dragDown(node, 6);
    fire(node, 'pointerup');
    fire(node, 'keydown', { key: 'ArrowUp' });
    fire(node, 'dblclick');
    vi.advanceTimersByTime(600);
    expect(levelOf(ctx)).toBe(before);
    expect(ctx.canUndo).toBe(false);
    expect(notify).toHaveBeenCalledWith(
      'Level is automated in the song. Switch its lane off to edit it.',
    );
  });

  it('moves again once the lane lets go', () => {
    const ctx = openGestureConsole();
    const before = levelOf(ctx);
    let lock: KnobAutomation | null = held;
    const node = levelKnob(ctx, () => lock);
    fire(node, 'keydown', { key: 'ArrowDown' });
    expect(levelOf(ctx)).toBe(before);
    lock = null;
    vi.mocked(notify).mockClear();
    dragDown(node, 4);
    fire(node, 'pointerup');
    expect(levelOf(ctx)).not.toBe(before);
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('the compact knob (windsor#157)', () => {
  it('keeps the full dial as it was and draws a smaller one when compact', () => {
    expect(knobGeometry({})).toEqual({ r: KNOB_R, size: KNOB_R * 2 + KNOB_PAD_PX });
    const compact = knobGeometry({ compact: true });
    expect(compact.r).toBeLessThan(KNOB_R);
    expect(compact.size).toBeLessThan(knobGeometry({}).size);
  });
});

describe("the insert rack's dials (windsor#173)", () => {
  it("draws the mockup's 30 px dial and its 42 px big one", () => {
    expect(knobGeometry({ dial: 'rack' }).size).toBe(30);
    expect(knobGeometry({ dial: 'rack-big' }).size).toBe(42);
    expect(knobGeometry({ dial: 'rack' }).r).toBeLessThan(knobGeometry({}).r);
  });
});
