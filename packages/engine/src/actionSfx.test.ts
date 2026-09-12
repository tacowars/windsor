import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_TERRAIN,
  pieceTransform,
  type InteractionCompletedMessage,
  type PlacedMessage,
} from '@aotearoa/shared';
import { ActionSfx, type ActionSfxDeps } from './actionSfx';
import type { ServerClock } from '../net/serverClock';
import { SFX_LIMITS } from './sfxConstants';

const placement = { cx: 0, cy: 0, cz: 0, slot: 'wallW' } as const;
const local = { x: 2, y: 3, z: 4 };
function setup() {
  vi.stubGlobal('document', { hidden: false });
  const deps = {
    session: { playerId: 1, appliedWorldRevision: 10 },
    terrain: DEFAULT_TERRAIN,
    nodes: { count: 1, x: [5], y: [6], z: [7] },
  } as unknown as ActionSfxDeps;
  const play = vi.fn((_kind: string, _position: { x: number; y: number; z: number }) => true);
  let tick = 10;
  const clock = { estimate: () => tick, tickRate: 20 } as unknown as ServerClock;
  const system = new ActionSfx(deps, clock, play);
  return {
    deps,
    play,
    system,
    advance: (n: number) => {
      tick += n;
    },
    receive: (m: PlacedMessage | InteractionCompletedMessage) => deps.session.onActionSound?.(m),
    update: () => system.update(0, local),
  };
}
const placed = (revision = 11): PlacedMessage => ({
  type: 'placed',
  action: 'place',
  placement,
  revision,
  tick: 10,
  playerId: 1,
});
const harvested = (playerId = 1): InteractionCompletedMessage => ({
  type: 'interaction-completed',
  playerId,
  tick: 10,
  target: { kind: 'node', index: 0 },
  materialGained: 1,
  depleted: false,
});

describe('live action sounds', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('skips baseline revisions and removal, plays placement exactly once at its actual transform', () => {
    const c = setup();
    c.receive(placed(10));
    c.receive({ ...placed(), action: 'remove' });
    c.receive(placed(12));
    c.receive(placed(12));
    c.update();
    c.update();
    const [x, y, z] = pieceTransform(placement, DEFAULT_TERRAIN).position;
    expect(c.play.mock.calls).toEqual([['build', { x, y, z }]]);
  });
  it('plays nearby mining/depletion once, with acquisition only for the local player', () => {
    const c = setup();
    const m = { ...harvested(), depleted: true };
    c.receive(m);
    c.receive(m);
    c.receive(harvested(2));
    c.update();
    expect(c.play.mock.calls.map((row) => row[0])).toEqual(['mine', 'deplete', 'pickup', 'mine']);
    expect(c.play.mock.calls[2]?.[1]).toEqual(local);
  });
  it('suppresses acquisition when the inventory received nothing', () => {
    const c = setup();
    c.receive({ ...harvested(), materialGained: 0 });
    c.update();
    expect(c.play.mock.calls.map((row) => row[0])).toEqual(['mine']);
  });
  it('plays repair at the piece', () => {
    const c = setup();
    c.receive({ ...harvested(), target: { kind: 'piece', placement }, materialGained: 0 });
    c.update();
    expect(c.play.mock.calls[0]?.[0]).toBe('repair');
  });
  it('discards stale and hidden events permanently', () => {
    const c = setup();
    c.receive(placed());
    c.advance((SFX_LIMITS.staleSeconds + 1) * 20);
    c.update();
    vi.stubGlobal('document', { hidden: true });
    c.receive(harvested());
    vi.stubGlobal('document', { hidden: false });
    c.update();
    expect(c.play).not.toHaveBeenCalled();
  });
  it('drops startup history and detaches on disposal', () => {
    const c = setup();
    c.update();
    expect(c.play).not.toHaveBeenCalled();
    c.system.dispose();
    c.receive(placed());
    c.update();
    expect(c.play).not.toHaveBeenCalled();
  });
  it('bounds queued work by dropping the oldest confirmations', () => {
    const c = setup();
    for (let i = 0; i < SFX_LIMITS.pendingActions + 1; i++) c.receive(placed(11 + i));
    c.update();
    expect(c.play).toHaveBeenCalledTimes(SFX_LIMITS.pendingActions);
  });
});
