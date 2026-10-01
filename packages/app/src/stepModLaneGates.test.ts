/**
 * The lane cells' click gates (windsor#31, Codex's P1 on windsor#364): a
 * card that builds a new host on every repaint keeps one gate under its
 * `gateKey`, so a repaint between a double-click's presses still resets the
 * cell; a host with no key (the grid card's) keeps its own gate, as before.
 */
import { describe, expect, it } from 'vitest';

import type { StepModLane } from '@windsor/engine';
import type { LaneClock } from './stepModLaneClicks';
import { type GateHost, gateOf } from './stepModLaneGates';

const CUT = 'filter.cutoff' as const;

/** A clock the test moves by hand. */
function fakeClock(): LaneClock & { advance(ms: number): void } {
  let t = 0;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
  };
}

/** A card's document and the hosts its repaints build over it; `writes` names the host that wrote. */
function cardOf(gateKey?: object) {
  let lanes: readonly StepModLane[] = [{ param: CUT, values: [0, 0, 0] }];
  const writes: Array<{ by: number; values: number[] }> = [];
  let built = 0;
  const host = (): GateHost => {
    const id = built++;
    return {
      ...(gateKey ? { gateKey } : {}),
      lanes: () => lanes,
      write: (next) => {
        lanes = next;
        writes.push({ by: id, values: [...(next[0]?.values ?? [])] });
        return true;
      },
      repaint: () => undefined,
    };
  };
  return { host, writes };
}

describe('a click gate across repaints', () => {
  it('resets on a double-click whose presses straddle a repaint, under a gate key', () => {
    const clock = fakeClock();
    const card = cardOf({});
    const first = card.host();
    gateOf(first, clock).press(CUT, 1);
    gateOf(first, clock).release(CUT, 1, [0, 0.6, 0], false);
    // The write repaints the rows: the second press lands on a new host.
    const second = card.host();
    clock.advance(100);
    const gate = gateOf(second, clock);
    gate.press(CUT, 1);
    expect(gate.release(CUT, 1, [0, 0.45, 0], false)).toBe('reset');
    expect(card.writes).toEqual([
      { by: 0, values: [0, 0.6, 0] },
      { by: 1, values: [0, 0, 0] },
    ]);
  });

  it("keeps a keyless host's gate its own: the grid card's, which never changes host", () => {
    const clock = fakeClock();
    const card = cardOf();
    const host = card.host();
    expect(gateOf(host, clock)).toBe(gateOf(host, clock));
    const other = card.host();
    expect(gateOf(other, clock)).not.toBe(gateOf(host, clock));
    gateOf(host, clock).press(CUT, 1);
    gateOf(host, clock).release(CUT, 1, [0, 0.6, 0], false);
    clock.advance(100);
    gateOf(host, clock).press(CUT, 1);
    expect(gateOf(host, clock).release(CUT, 1, [0, 0.45, 0], false)).toBe('reset');
  });
});
