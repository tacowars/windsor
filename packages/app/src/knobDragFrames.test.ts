/**
 * A knob drag at a 240 Hz pointer (windsor#795), through `attachKnobInput`
 * over a stand-in element and a frame source the test runs: the knob's
 * commit, which is what lands on the document and posts the patch to the
 * engine, runs at most once a frame with the last move's value, and the
 * release commits what waits at once, inside the drag's undo step, however
 * the drag ends.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { partChange } from './context';
import { FakeElement, fire, openGestureConsole } from './__fixtures__/gestureConsole';
import { settleGestures } from './gestureHooks';
import { attachKnobInput } from './knob';
import type { KnobSpec, Scale } from './knob';
import { DRAG_RANGE_PX } from './knobConstants';
import type { FrameSource } from './stepStrip';

const LINEAR: Scale = { toNorm: (v) => v, fromNorm: (n) => Math.min(1, Math.max(0, n)) };

/** The frames the drag asked for, run by `runFrame`. */
const frames: (() => void)[] = [];
const frame: FrameSource = (run) => void frames.push(run);
const runFrame = (): void => {
  for (const run of frames.splice(0)) run();
};

let win: EventTarget;
beforeEach(() => {
  frames.length = 0;
  win = new EventTarget();
  vi.stubGlobal('window', win);
});
afterEach(() => {
  settleGestures();
  vi.unstubAllGlobals();
});

/** A knob at 0.5 whose commits land in `commits`, dragged from y 100. */
function knobAt(commit: (v: number) => void): FakeElement {
  const spec: KnobSpec = { label: 'Tone', min: 0, max: 1, def: 1, get: () => 0.5, set: commit };
  const node = new FakeElement();
  attachKnobInput(node as unknown as HTMLElement, spec, LINEAR, commit, frame);
  fire(node, 'pointerdown', { clientY: 100 });
  return node;
}

/** The value a move to `y` reaches: the sweep from 0.5 at y 100. */
const at = (y: number): number => LINEAR.fromNorm(0.5 - (y - 100) / DRAG_RANGE_PX);

describe('a knob drag at 240 Hz (windsor#795)', () => {
  it('commits at most once a frame, the last move’s value, and its release at once', () => {
    const commits: number[] = [];
    const node = knobAt((v) => commits.push(v));
    let y = 100;
    for (let f = 1; f <= 10; f++) {
      // Four moves to a 60 Hz frame.
      for (let m = 0; m < 4; m++) fire(node, 'pointermove', { clientY: (y += 3) });
      runFrame();
      expect(commits).toHaveLength(f);
      expect(commits.at(-1)).toBe(at(y));
    }
    fire(node, 'pointermove', { clientY: (y += 3) });
    fire(node, 'pointermove', { clientY: (y += 3) });
    fire(node, 'pointerup');
    expect(commits).toHaveLength(11);
    expect(commits.at(-1)).toBe(at(y));
    runFrame();
    expect(commits).toHaveLength(11);
  });

  it('commits the waiting move inside the drag’s one step when the window ends it', () => {
    const ctx = openGestureConsole();
    const level = (): number => ctx.model.doc.parts[0]?.strip.level ?? NaN;
    const before = level();
    const node = knobAt((v) => void ctx.change(partChange(0, { strip: { level: v } })));
    fire(node, 'pointermove', { clientY: 130 });
    fire(node, 'pointermove', { clientY: 160 });
    fire(win, 'pointerup');
    expect(level()).toBe(at(160));
    runFrame();
    expect(ctx.undo()).toBe(true);
    expect(level()).toBe(before);
    expect(ctx.canUndo).toBe(false);
  });
});
