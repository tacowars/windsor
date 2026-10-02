/**
 * The Shape popover's placement while the Song panel is hidden (PR #398's
 * round 1): a hide, resize and show measures nothing while hidden and places
 * once on the first shown frame.
 */
import { describe, expect, it } from 'vitest';
import { shapePlacer } from './songShapePlacer';

function rig(): {
  placer: ReturnType<typeof shapePlacer>;
  placed: () => number;
  pending: () => number;
  frame: () => void;
  setShown: (on: boolean) => void;
} {
  let shown = true;
  let placed = 0;
  let next = 1;
  const frames = new Map<number, () => void>();
  const placer = shapePlacer({
    shown: () => shown,
    place: () => void placed++,
    nextFrame: (cb) => {
      frames.set(next, cb);
      return next++;
    },
    cancelFrame: (id) => void frames.delete(id),
  });
  const frame = (): void => {
    const due = [...frames.values()];
    frames.clear();
    for (const cb of due) cb();
  };
  return {
    placer,
    placed: () => placed,
    pending: () => frames.size,
    frame,
    setShown: (on) => void (shown = on),
  };
}

describe('placing the Shape popover', () => {
  it('places at once while the Song panel is shown', () => {
    const r = rig();
    r.placer.request();
    expect(r.placed()).toBe(1);
    expect(r.pending()).toBe(0);
  });

  it('hide, resize, show: nothing measured while hidden, one placement on the first shown frame', () => {
    const r = rig();
    r.placer.request();
    r.setShown(false);
    r.placer.request();
    r.placer.request();
    expect(r.placed()).toBe(1);
    expect(r.pending()).toBe(1);
    r.frame();
    r.frame();
    expect(r.placed()).toBe(1);
    expect(r.pending()).toBe(1);
    r.setShown(true);
    r.frame();
    expect(r.placed()).toBe(2);
    expect(r.pending()).toBe(0);
  });

  it('a request once shown again places and drops the waiting frame', () => {
    const r = rig();
    r.setShown(false);
    r.placer.request();
    r.setShown(true);
    r.placer.request();
    expect(r.placed()).toBe(1);
    expect(r.pending()).toBe(0);
  });

  it('stop ends a waiting placement', () => {
    const r = rig();
    r.setShown(false);
    r.placer.request();
    r.placer.stop();
    r.setShown(true);
    r.frame();
    expect(r.placed()).toBe(0);
    expect(r.pending()).toBe(0);
  });
});
