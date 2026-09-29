/**
 * The sequencer cards' region playhead (windsor#97, windsor#101), driven
 * without a DOM: a fake transport and a fake engine answering
 * `regionStepAt`, and cells that are nothing but their class lists.
 *
 * Pinned here: the playhead is the engine's answer (bright in the region, a
 * ghost outside it), dark only while the transport is not running, and the
 * lighting puts one of the two classes on one column or cell and clears the
 * rest. `regionPlayheadCards.test.ts` drives it through the real player.
 */
import { describe, expect, it } from 'vitest';

import type { RegionStep } from '@windsor/engine';
import type { AppCtx } from './context';
import { DARK, ghostOf, lightPlayhead, readPlayhead, regionPlayheadAt } from './regionPlayhead';

function fakeCtx(answer: (tick: number) => RegionStep | null): {
  ctx: AppCtx;
  transport: { running: boolean; tick: number };
  asked: Array<{ slot: number; region: number; tick: number }>;
} {
  const transport = { running: true, tick: 0 };
  const asked: Array<{ slot: number; region: number; tick: number }> = [];
  const ctx = {
    host: {
      regionStepAt(slot: number, region: number, tick: number): RegionStep | null {
        asked.push({ slot, region, tick });
        return answer(tick);
      },
      stepAt: (_slot: number, tick: number): number => tick % 4,
    },
    transport: {
      get running(): boolean {
        return transport.running;
      },
      position: (): number => transport.tick,
    },
  } as unknown as AppCtx;
  return { ctx, transport, asked };
}

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

const classes = (children: ReturnType<typeof fakeCell>[]): string[] =>
  children.map((cell) => [...cell.on].sort().join('+'));

describe('the playhead number', () => {
  it('reads back a bright step, a ghost step, and dark', () => {
    expect(readPlayhead(3)).toEqual({ step: 3, ghost: false });
    expect(readPlayhead(0)).toEqual({ step: 0, ghost: false });
    expect(readPlayhead(ghostOf(0))).toEqual({ step: 0, ghost: true });
    expect(readPlayhead(ghostOf(5))).toEqual({ step: 5, ghost: true });
    expect(readPlayhead(DARK)).toBeNull();
  });

  it('never gives a ghost the number of a bright step or of dark', () => {
    for (let step = 0; step < 32; step++) {
      expect(ghostOf(step)).toBeLessThan(DARK);
    }
  });
});

describe('regionPlayheadAt', () => {
  it('hands the audible tick to the engine and lights its step bright inside the region', () => {
    const { ctx, transport, asked } = fakeCtx(() => ({ step: 2, live: true }));
    transport.tick = 42;
    expect(regionPlayheadAt(ctx, 1, 0)).toBe(2);
    expect(asked).toEqual([{ slot: 1, region: 0, tick: 42 }]);
  });

  it('is the ghost of the engine’s step while the region does not play', () => {
    const { ctx } = fakeCtx(() => ({ step: 5, live: false }));
    expect(readPlayhead(regionPlayheadAt(ctx, 1, 0))).toEqual({ step: 5, ghost: true });
  });

  it('is dark while the transport is paused or stopped, asking nothing', () => {
    const { ctx, transport, asked } = fakeCtx(() => ({ step: 1, live: true }));
    transport.running = false;
    expect(regionPlayheadAt(ctx, 1, 0)).toBe(DARK);
    expect(asked).toEqual([]);
  });

  it('is dark when the engine has no position for the region', () => {
    expect(regionPlayheadAt(fakeCtx(() => null).ctx, 1, 0)).toBe(DARK);
    expect(regionPlayheadAt(fakeCtx(() => ({ step: -1, live: false })).ctx, 1, 0)).toBe(DARK);
  });

  it('with no region named, is the part’s own step', () => {
    const { ctx, transport } = fakeCtx(() => null);
    transport.tick = 7;
    expect(regionPlayheadAt(ctx, 1)).toBe(7 % 4);
  });
});

describe('lightPlayhead', () => {
  it('lights one column bright or ghost, clears the rest, and nothing for dark', () => {
    const children = Array.from({ length: 4 }, fakeCell);
    lightPlayhead({ children }, 2);
    expect(classes(children)).toEqual(['', '', 'playing', '']);
    lightPlayhead({ children }, ghostOf(1));
    expect(classes(children)).toEqual(['', 'ghost', '', '']);
    lightPlayhead({ children }, 1);
    expect(classes(children)).toEqual(['', 'playing', '', '']);
    lightPlayhead({ children }, DARK);
    expect(classes(children)).toEqual(['', '', '', '']);
  });

  it('lights nothing for a step past the strip', () => {
    const children = Array.from({ length: 2 }, fakeCell);
    lightPlayhead({ children }, ghostOf(2));
    expect(classes(children)).toEqual(['', '']);
  });
});
