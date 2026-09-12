import { afterEach, describe, expect, it, vi } from 'vitest';
import { DecodedSnapshot } from '@aotearoa/shared';
import { GameplaySfx, type GameplaySfxDeps } from './gameplaySfx';
import { ABSENT_ENEMY_Y } from '../horde/hordeConstants';
import { SFX_LIMITS } from './sfxConstants';

describe('gameplay SFX event consumption', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('skips historical hits at join, plays each new hit once, and drops stale history', () => {
    vi.stubGlobal('document', { hidden: false });
    const snap = new DecodedSnapshot(1);
    snap.serverTick = 10;
    snap.local.playerId = 1;
    snap.local.hitPoints = 100;
    snap.hitCount = 1;
    snap.hits[0] = { source: 'player', sourceIndex: 1, target: 'player', targetIndex: 1 };
    const entry = { snap, slotMap: new Int32Array([-1]) };
    let estimated = snap.serverTick;
    const tickRate = 20;
    const play = vi.fn((_kind: string) => true);
    const deps = {
      ring: {
        newest: () => entry,
        resolve: () => null,
        forEachAfter: (tick: number, visit: (e: typeof entry) => void) => {
          if (snap.serverTick > tick) visit(entry);
        },
      },
      clock: { estimate: () => estimated, tickRate },
      local: () => ({ id: 1, x: 0, y: 0, z: 0, grounded: true, alive: true }),
      camera: { getWorldMatrix: () => ({ decompose: () => true }) },
      height: () => 0,
    } as unknown as GameplaySfxDeps;
    const system = new GameplaySfx(
      { play, setListener: vi.fn(), setVolume: vi.fn(), dispose: vi.fn() },
      deps,
    );
    const frame = { dt: 0.1, now: 0 };
    system.update(frame);
    expect(play).not.toHaveBeenCalled();
    snap.serverTick++;
    estimated++;
    system.update(frame);
    system.update(frame);
    expect(play.mock.calls.map((call) => call[0])).toEqual(['impact', 'weapon']);
    snap.serverTick++;
    estimated = snap.serverTick + (SFX_LIMITS.staleSeconds + 1) * tickRate;
    system.update(frame);
    estimated = snap.serverTick;
    system.update(frame);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('plays killing-hit impacts at retained corpse positions, but skips unseen targets', () => {
    vi.stubGlobal('document', { hidden: false });
    const snap = new DecodedSnapshot(1);
    snap.serverTick = 10;
    snap.hitCount = 0;
    const entry = { snap, slotMap: new Int32Array([-1]) };
    const state = { count: 1, x: [4], y: [2], z: [6] };
    const play = vi.fn((_kind: string, _position: { x: number; y: number; z: number }) => true);
    const deps = {
      ring: {
        newest: () => entry,
        resolve: () => null,
        forEachAfter: (tick: number, visit: (e: typeof entry) => void) => {
          if (snap.serverTick > tick) visit(entry);
        },
      },
      horde: () => state,
      clock: { estimate: () => snap.serverTick, tickRate: 20 },
      local: () => ({ id: 1, x: 0, y: 0, z: 0, grounded: true, alive: true }),
      camera: { getWorldMatrix: () => ({ decompose: () => true }) },
      height: () => 0,
    } as unknown as GameplaySfxDeps;
    const system = new GameplaySfx(
      { play, setListener: vi.fn(), setVolume: vi.fn(), dispose: vi.fn() },
      deps,
    );
    const frame = { dt: 0.1, now: 0 };
    system.update(frame);
    snap.serverTick++;
    snap.hitCount = 1;
    snap.hits[0] = { source: 'enemy', sourceIndex: 0, target: 'enemy', targetIndex: 0 };
    system.update(frame);
    expect(play).toHaveBeenCalledExactlyOnceWith('impact', { x: 4, y: 2, z: 6 });
    state.y[0] = ABSENT_ENEMY_Y;
    snap.serverTick++;
    system.update(frame);
    expect(play).toHaveBeenCalledTimes(1);
  });
});
