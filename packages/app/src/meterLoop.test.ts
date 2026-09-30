/**
 * The meters' paint loop (windsor#193 decision 4) over a fake frame clock, a
 * fake visibility and a fake intersection observer: each of the three gates
 * stops it with no frame left scheduled, it resumes when all three hold
 * again, it paints only on a new report, and it ends when its root leaves.
 */
import { describe, expect, it } from 'vitest';

import { type MeterPart, type ViewportEntry, createMeterLoop } from './meterLoop';

interface Rig {
  loop: ReturnType<typeof createMeterLoop<string>>;
  /** Frames requested and not yet run or cancelled. */
  pending(): number;
  /** Run every pending frame at `nowMs`. */
  frame(nowMs?: number): void;
  setTab(shown: boolean): void;
  setHidden(hidden: boolean): void;
  intersect(target: string, isIntersecting: boolean): void;
  root: { isConnected: boolean };
  revision: { value: number };
  part: MeterPart<string> & { paints: number[]; resets: number };
  /** Live subscriptions: tab, visibility, and whether the observer is connected. */
  subscriptions(): { tab: number; visibility: number; observing: boolean };
}

function rig(connected = true): Rig {
  const frames = new Map<number, (nowMs: number) => void>();
  let nextHandle = 1;
  const tabListeners = new Set<(shown: boolean) => void>();
  const visibilityListeners = new Set<() => void>();
  let tabShown = false;
  let hidden = false;
  let report: ((entries: readonly ViewportEntry<string>[]) => void) | null = null;
  let observing = true;
  const root = { isConnected: connected };
  const revision = { value: 0 };
  const part = {
    root: 'meters',
    paints: [] as number[],
    resets: 0,
    paint(nowMs: number) {
      part.paints.push(nowMs);
    },
    reset() {
      part.resets++;
    },
  };
  const loop = createMeterLoop<string>({
    root,
    revision: () => revision.value,
    onTabShown: (listener) => {
      tabListeners.add(listener);
      listener(tabShown);
      return () => void tabListeners.delete(listener);
    },
    frames: {
      request: (run) => {
        frames.set(nextHandle, run);
        return nextHandle++;
      },
      cancel: (handle) => void frames.delete(handle),
    },
    visibility: {
      hidden: () => hidden,
      subscribe: (listener) => {
        visibilityListeners.add(listener);
        return () => void visibilityListeners.delete(listener);
      },
    },
    observeViewport: (callback) => {
      report = callback;
      return {
        observe: () => undefined,
        unobserve: () => undefined,
        disconnect: () => {
          observing = false;
        },
      };
    },
  });
  loop.add(part);
  return {
    loop,
    pending: () => frames.size,
    frame(nowMs = 0) {
      const due = [...frames.values()];
      frames.clear();
      for (const run of due) run(nowMs);
    },
    setTab(shown) {
      tabShown = shown;
      for (const listener of [...tabListeners]) listener(shown);
    },
    setHidden(value) {
      hidden = value;
      for (const listener of [...visibilityListeners]) listener();
    },
    intersect(target, isIntersecting) {
      report?.([{ target, isIntersecting }]);
    },
    root,
    revision,
    part,
    subscriptions: () => ({
      tab: tabListeners.size,
      visibility: visibilityListeners.size,
      observing,
    }),
  };
}

/** A rig with all three gates open and one frame run. */
function running(): Rig {
  const r = rig();
  r.setTab(true);
  r.intersect('meters', true);
  r.frame(0);
  return r;
}

describe('the meter loop', () => {
  it('schedules nothing until the tab is shown, the page visible and a meter in view', () => {
    const r = rig();
    expect(r.pending()).toBe(0);
    r.setTab(true);
    expect(r.pending()).toBe(0);
    r.intersect('meters', true);
    expect(r.pending()).toBe(1);
    expect(r.loop.running).toBe(true);
    r.frame(16);
    expect(r.part.paints).toEqual([16]);
    expect(r.pending()).toBe(1);
  });

  const gates: Array<[string, (r: Rig, open: boolean) => void]> = [
    ['the tab', (r, open) => r.setTab(open)],
    ['the page visibility', (r, open) => r.setHidden(!open)],
    ['the viewport', (r, open) => r.intersect('meters', open)],
  ];
  for (const [name, gate] of gates) {
    it(`stops on ${name} with no frame left, resets the parts, and resumes`, () => {
      const r = running();
      gate(r, false);
      expect(r.pending()).toBe(0);
      expect(r.loop.running).toBe(false);
      expect(r.part.resets).toBe(1);
      r.revision.value++;
      r.frame(50);
      expect(r.part.paints).toEqual([0]);
      gate(r, true);
      expect(r.pending()).toBe(1);
      r.frame(66);
      expect(r.part.paints).toEqual([0, 66]);
      expect(r.part.resets).toBe(1);
    });
  }

  it('keeps one frame whatever the number of gate events', () => {
    const r = running();
    r.setTab(true);
    r.setHidden(false);
    r.intersect('meters', true);
    expect(r.pending()).toBe(1);
  });

  it('paints only when the report revision moved', () => {
    const r = running();
    r.frame(16);
    r.frame(33);
    expect(r.part.paints).toEqual([0]);
    expect(r.pending()).toBe(1);
    r.revision.value++;
    r.frame(50);
    r.frame(66);
    expect(r.part.paints).toEqual([0, 50]);
  });

  it('holds while any registered root is in view, and stops when the last leaves', () => {
    const r = running();
    const remove = r.loop.add({ root: 'bridge', paint: () => undefined, reset: () => undefined });
    r.intersect('bridge', true);
    r.intersect('meters', false);
    expect(r.pending()).toBe(1);
    remove();
    expect(r.pending()).toBe(0);
  });

  it('ends for good when its root is detached', () => {
    const r = running();
    r.root.isConnected = false;
    r.frame(16);
    expect(r.pending()).toBe(0);
    expect(r.loop.ended).toBe(true);
    expect(r.subscriptions()).toEqual({ tab: 0, visibility: 0, observing: false });
    r.root.isConnected = true;
    r.revision.value++;
    r.intersect('meters', true);
    r.frame(33);
    expect(r.pending()).toBe(0);
    expect(r.part.paints).toEqual([0]);
  });

  it('notices a detach on a gate event while idle', () => {
    const r = running();
    r.setTab(false);
    r.root.isConnected = false;
    r.setTab(true);
    expect(r.loop.ended).toBe(true);
    expect(r.pending()).toBe(0);
  });

  it('waits for a root not yet attached rather than ending', () => {
    const r = rig(false);
    r.setTab(true);
    r.intersect('meters', true);
    expect(r.loop.ended).toBe(false);
    r.root.isConnected = true;
    r.setHidden(false);
    expect(r.pending()).toBe(1);
  });
});
