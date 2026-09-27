/**
 * The one step strip and playhead loop (#619 decision 1), driven without a
 * DOM: a fake frame source in place of `requestAnimationFrame`, a fake
 * scheduler in place of the transport, and cells that are nothing but their
 * class lists — which is all `markPlaying` reads.
 *
 * What is pinned here is the loop's contract: it asks the engine where the
 * playhead is (never deriving it), lights a step only when it moved, runs the
 * card's own per-frame check every frame, and queues no further frame once the
 * card has left the document — the leak that three hand-written copies of this
 * loop each had to get right on their own.
 */
import { describe, expect, it } from 'vitest';

import type { AppCtx } from './context';
import { HostTransport, type TransportSystem } from './host';
import { createFrameDriver, markPlaying, playheadAt, watchPlayhead } from './stepStrip';

/** A cell: its class list and a way to read what was toggled onto it. */
function fakeCell(): { classList: { toggle(token: string, on: boolean): void }; on: Set<string> } {
  const on = new Set<string>();
  return {
    on,
    classList: {
      toggle(token: string, set: boolean): void {
        if (set) on.add(token);
        else on.delete(token);
      },
    },
  };
}

const fakeStrip = (cells: number): ReturnType<typeof fakeCell>[] =>
  Array.from({ length: cells }, fakeCell);

const lit = (children: ReturnType<typeof fakeCell>[]): number[] =>
  children.flatMap((cell, i) => (cell.on.has('playing') ? [i] : []));

/** A console context with a fake transport and a fake engine `stepAt`, recording both. */
function fakeCtx(step: (tick: number) => number): {
  ctx: AppCtx;
  transport: { running: boolean; audible: number; now: number };
  asked: { slot: number; tick: number }[];
} {
  const transport = { running: true, audible: 0, now: 0 };
  const asked: { slot: number; tick: number }[] = [];
  const system = {
    get musicRunning(): boolean {
      return transport.running;
    },
    scheduler: {
      get isRunning(): boolean {
        return transport.running;
      },
      audibleTick(now: number): number {
        // The console must read the audible tick at the engine's clock time.
        expect(now).toBe(transport.now);
        return transport.audible;
      },
    },
    engine: {
      context: {
        get currentTime(): number {
          return transport.now;
        },
      },
    },
  };
  const ctx = {
    host: {
      stepAt(slot: number, tick: number): number {
        asked.push({ slot, tick });
        return step(tick);
      },
    },
    // The real transport over the fake system: its `position()` is the one clock read.
    transport: new HostTransport(() => system as unknown as TransportSystem),
    // Only `host` and `transport` are reached on this path; the tabs' full context is `main.ts`.
  } as unknown as AppCtx;
  return { ctx, transport, asked };
}

describe('markPlaying', () => {
  it('lights only the playhead’s cell, and none for -1', () => {
    const children = fakeStrip(4);
    markPlaying({ children }, 2);
    expect(lit(children)).toEqual([2]);
    markPlaying({ children }, 0);
    expect(lit(children)).toEqual([0]);
    markPlaying({ children }, -1);
    expect(lit(children)).toEqual([]);
  });

  it('lights nothing for a step past the strip, leaving the cells as they were', () => {
    const children = fakeStrip(3);
    markPlaying({ children }, children.length);
    expect(lit(children)).toEqual([]);
  });
});

describe('playheadAt', () => {
  const SLOT = 3;

  it('hands the audible tick to the engine’s stepAt and returns what it says', () => {
    const { ctx, transport, asked } = fakeCtx((tick) => tick % 4);
    transport.now = 1.5;
    transport.audible = 42;
    expect(playheadAt(ctx, SLOT)).toBe(42 % 4);
    expect(asked).toEqual([{ slot: SLOT, tick: 42 }]);
  });

  it('asks nothing while the transport is stopped', () => {
    const { ctx, transport, asked } = fakeCtx(() => 0);
    transport.running = false;
    expect(playheadAt(ctx, SLOT)).toBe(-1);
    expect(asked).toEqual([]);
  });

  it('is -1 before audio is enabled, when there is no system to ask', () => {
    const ctx = {
      host: { system: null },
      transport: new HostTransport(() => null),
    } as unknown as AppCtx;
    expect(playheadAt(ctx, SLOT)).toBe(-1);
  });
});

describe('watchPlayhead', () => {
  const SLOT = 1;
  const DIVISOR = 6;
  const STEPS = 4;
  /** Enough frames that an idling loop doing any work per frame would show it. */
  const FRAMES = 5;

  /**
   * The loop over a fake frame source: `run()` runs the frame that is queued.
   * `tracksShown` is the card that passes a `shown` check; without it the watch
   * has no `shown` at all, which is the pre-#632 shape every case below shares.
   */
  function driven(options: { tracksShown?: boolean } = {}): {
    transport: { running: boolean; audible: number; now: number };
    marks: number[];
    asked: { slot: number; tick: number }[];
    checks: number;
    attached: { value: boolean };
    shown: { value: boolean };
    run(frames: number): void;
    pending(): boolean;
  } {
    const { ctx, transport, asked } = fakeCtx((tick) => Math.floor(tick / DIVISOR) % STEPS);
    const marks: number[] = [];
    const attached = { value: true };
    const shown = { value: true };
    const state = { checks: 0 };
    let queued: (() => void) | null = null;
    watchPlayhead({
      attached: () => attached.value,
      playheadAt: () => playheadAt(ctx, SLOT),
      mark: (step) => void marks.push(step),
      repaintIf: () => void state.checks++,
      ...(options.tracksShown === true ? { shown: () => shown.value } : {}),
      frame: (next) => void (queued = next),
    });
    return {
      transport,
      marks,
      asked,
      get checks(): number {
        return state.checks;
      },
      attached,
      shown,
      run(frames: number): void {
        for (let i = 0; i < frames; i++) {
          const due = queued;
          queued = null;
          due?.();
        }
      },
      pending: () => queued !== null,
    };
  }

  it('marks a step only when the audible tick moves onto another one', () => {
    const loop = driven();
    loop.run(1);
    expect(loop.marks).toEqual([0]);
    // Still inside step 0: nothing to relight.
    loop.transport.audible = DIVISOR - 1;
    loop.run(1);
    expect(loop.marks).toEqual([0]);
    loop.transport.audible = DIVISOR;
    loop.run(1);
    expect(loop.marks).toEqual([0, 1]);
    // A loop round: the last step, then back to the first.
    loop.transport.audible = DIVISOR * (STEPS - 1);
    loop.run(1);
    loop.transport.audible = DIVISOR * STEPS;
    loop.run(1);
    expect(loop.marks).toEqual([0, 1, STEPS - 1, 0]);
  });

  it('drops the playhead when the transport stops, and picks it up again', () => {
    const loop = driven();
    loop.transport.audible = DIVISOR;
    loop.run(1);
    loop.transport.running = false;
    loop.run(1);
    expect(loop.marks).toEqual([1, -1]);
    loop.transport.running = true;
    loop.run(1);
    expect(loop.marks).toEqual([1, -1, 1]);
  });

  it('runs the card’s own check every frame, whether or not the playhead moved', () => {
    const loop = driven();
    loop.run(3);
    expect(loop.checks).toBe(3);
    expect(loop.marks).toEqual([0]);
  });

  it('stops the frame the card leaves the document: nothing queued, nothing marked', () => {
    const loop = driven();
    loop.run(2);
    expect(loop.pending()).toBe(true);
    loop.attached.value = false;
    loop.transport.audible = DIVISOR;
    loop.run(1);
    expect(loop.pending()).toBe(false);
    expect(loop.marks).toEqual([0]);
    // And it stays stopped: a later frame cannot revive it.
    loop.run(1);
    expect(loop.pending()).toBe(false);
  });

  it('idles while the panel is hidden: the frame is queued and nothing else runs', () => {
    const loop = driven({ tracksShown: true });
    loop.run(1);
    const asked = loop.asked.length;
    const checks = loop.checks;
    loop.shown.value = false;
    loop.transport.audible = DIVISOR;
    loop.run(FRAMES);
    expect(loop.asked.length).toBe(asked);
    expect(loop.checks).toBe(checks);
    expect(loop.marks).toEqual([0]);
    // Still queued, so showing the tab again needs no lifecycle event.
    expect(loop.pending()).toBe(true);
  });

  it('marks the step it moved to while hidden once, on the first shown frame', () => {
    const loop = driven({ tracksShown: true });
    loop.run(1);
    loop.shown.value = false;
    loop.transport.audible = DIVISOR * 2;
    loop.run(FRAMES);
    expect(loop.marks).toEqual([0]);
    loop.shown.value = true;
    loop.run(1);
    expect(loop.marks).toEqual([0, 2]);
    // And it stays there: the same step is not re-marked.
    loop.run(FRAMES);
    expect(loop.marks).toEqual([0, 2]);
  });

  it('ends for good when a hidden card leaves the document', () => {
    const loop = driven({ tracksShown: true });
    loop.run(1);
    loop.shown.value = false;
    loop.attached.value = false;
    loop.run(1);
    expect(loop.pending()).toBe(false);
  });

  it('works every frame for a watch with no shown check, exactly as before', () => {
    const loop = driven();
    loop.run(FRAMES);
    expect(loop.asked.length).toBe(FRAMES);
    expect(loop.checks).toBe(FRAMES);
    expect(loop.marks).toEqual([0]);
  });
});

describe('createFrameDriver (#709 decision 5)', () => {
  function driver(): {
    frame: ReturnType<typeof createFrameDriver>;
    requests: number;
    run(): void;
  } {
    let queued: (() => void) | null = null;
    const state = { requests: 0 };
    const frame = createFrameDriver((next) => {
      state.requests++;
      queued = next;
    });
    return {
      frame,
      get requests(): number {
        return state.requests;
      },
      run(): void {
        const due = queued;
        queued = null;
        due?.();
      },
    };
  }

  it('runs every watch that joined on one frame request, and the next frame on one more', () => {
    const d = driver();
    const ran: string[] = [];
    const a = (): void => {
      ran.push('a');
      d.frame(a);
    };
    const b = (): void => {
      ran.push('b');
      d.frame(b);
    };
    d.frame(a);
    d.frame(b);
    expect(d.requests).toBe(1);
    d.run();
    expect(ran).toEqual(['a', 'b']);
    expect(d.requests).toBe(2);
    d.run();
    expect(ran).toEqual(['a', 'b', 'a', 'b']);
  });

  it('requests nothing once the last watch has left', () => {
    const d = driver();
    let more = true;
    const a = (): void => {
      if (more) d.frame(a);
    };
    d.frame(a);
    d.run();
    expect(d.requests).toBe(2);
    more = false;
    d.run();
    d.run();
    expect(d.requests).toBe(2);
  });

  it('drives two playhead watches from one request each frame', () => {
    const d = driver();
    const { ctx } = fakeCtx((tick) => tick);
    const marks: number[][] = [[], []];
    for (const i of [0, 1]) {
      watchPlayhead({
        attached: () => true,
        playheadAt: () => playheadAt(ctx, i),
        mark: (step) => void marks[i]?.push(step),
        frame: d.frame,
      });
    }
    d.run();
    expect(d.requests).toBe(2);
    expect(marks).toEqual([[0], [0]]);
  });
});
