/**
 * `MusicPlayback` on its own: a real `Scheduler` on the fake context and a
 * recording stand-in for the player. Start is a no-op before a player or while
 * muted; mute keeps the tick and stop rewinds it (#708); seek moves a halted
 * transport and refuses a running one (windsor#102); the queries forward
 * to the player and answer "nothing" without one.
 */
import { describe, expect, it, vi } from 'vitest';

import { FakeContext } from '../__fixtures__/fakeAudioContext';
import { Scheduler } from '../sequencing/scheduler';
import type { ArrangementPlayer } from '../song/arrangementPlayer';
import { MusicPlayback } from './musicPlayback';

const READOUT = { bpm: 120, root: 2, scale: 'dorian', counters: { 0: 3 } };
const REGION_STEP = { step: 1, sounding: true };

function stubPlayer() {
  return {
    releaseAll: vi.fn(),
    reset: vi.fn(),
    dispose: vi.fn(),
    readout: vi.fn(() => READOUT),
    capturePattern: vi.fn(() => [true, false]),
    stepAt: vi.fn(() => 5),
    regionStepAt: vi.fn(() => REGION_STEP),
  };
}

function rig() {
  const context = new FakeContext();
  const scheduler = new Scheduler(context.asAudioContext(), { bpm: 96 });
  const playback = new MusicPlayback(scheduler, context.asAudioContext());
  const player = stubPlayer();
  const load = (): void => playback.load(player as unknown as ArrangementPlayer);
  /** Run the transport for `seconds`, so the tick moves off 0. */
  const advance = (seconds: number): void => {
    context.currentTime += seconds;
    scheduler.update();
  };
  return { context, scheduler, playback, player, load, advance };
}

describe('MusicPlayback before a player is loaded', () => {
  it('does not start, and the queries answer nothing', () => {
    const { playback, scheduler } = rig();
    playback.start();
    expect(playback.running).toBe(false);
    expect(playback.player).toBeNull();
    expect(playback.capturePattern(0)).toBeNull();
    expect(playback.stepAt(0, 0)).toBe(-1);
    expect(playback.regionStepAt(0, 0, 0)).toBeNull();
    expect(playback.readout()).toEqual({
      bpm: scheduler.bpm,
      root: NaN,
      scale: [],
      counters: {},
      muted: false,
      running: false,
    });
  });
});

describe('MusicPlayback transport', () => {
  it('starts once loaded, and not while muted', () => {
    const { playback, load } = rig();
    load();
    playback.setMuted(true);
    playback.start();
    expect(playback.running).toBe(false);
    playback.setMuted(false);
    expect(playback.running).toBe(true);
  });

  it('mutes by stopping and releasing at the context time, keeping the tick', () => {
    const { context, scheduler, playback, player, load, advance } = rig();
    load();
    playback.start();
    advance(2);
    const tick = scheduler.transport.currentTick;
    expect(tick).toBeGreaterThan(0);
    playback.setMuted(true);
    expect(playback.isMuted).toBe(true);
    expect(playback.running).toBe(false);
    expect(player.releaseAll).toHaveBeenCalledWith(context.currentTime);
    playback.setMuted(true);
    expect(player.releaseAll).toHaveBeenCalledTimes(1);
    playback.setMuted(false);
    expect(scheduler.transport.currentTick).toBe(tick);
    expect(playback.running).toBe(true);
  });

  it('stops by releasing, rewinding to 0 and resetting the player, leaving the mute flag', () => {
    const { scheduler, playback, player, load, advance } = rig();
    load();
    playback.start();
    advance(2);
    playback.setMuted(true);
    playback.stop();
    expect(scheduler.transport.currentTick).toBe(0);
    expect(player.releaseAll).toHaveBeenCalledTimes(2);
    expect(player.reset).toHaveBeenCalledTimes(1);
    expect(playback.isMuted).toBe(true);
  });
});

describe('MusicPlayback.seek (windsor#102)', () => {
  const BAR = 96;

  it('refuses before a player is loaded', () => {
    const { playback, scheduler } = rig();
    expect(playback.seek(4 * BAR)).toBe(false);
    expect(scheduler.transport.currentTick).toBe(0);
  });

  it('moves a stopped transport, releasing and clearing the region state', () => {
    const { context, scheduler, playback, player, load } = rig();
    load();
    expect(playback.seek(4 * BAR)).toBe(true);
    expect(scheduler.transport.currentTick).toBe(4 * BAR);
    expect(scheduler.audibleTick(context.currentTime)).toBe(4 * BAR);
    expect(player.releaseAll).toHaveBeenCalledWith(context.currentTime);
    expect(player.reset).toHaveBeenCalledTimes(1);
    playback.start();
    expect(playback.running).toBe(true);
    expect(scheduler.transport.currentTick).toBe(4 * BAR);
  });

  it('moves a paused transport, and unmuting resumes from the new tick', () => {
    const { scheduler, playback, player, load, advance } = rig();
    load();
    playback.start();
    advance(2);
    playback.setMuted(true);
    const paused = scheduler.transport.currentTick;
    expect(playback.seek(BAR)).toBe(true);
    expect(playback.isMuted).toBe(true);
    expect(player.reset).toHaveBeenCalledTimes(1);
    playback.setMuted(false);
    expect(playback.running).toBe(true);
    expect(scheduler.transport.currentTick).toBe(BAR);
    expect(scheduler.transport.currentTick).not.toBe(paused);
  });

  it('refuses while playing, changing nothing', () => {
    const { scheduler, playback, player, load, advance } = rig();
    load();
    playback.start();
    advance(1);
    const tick = scheduler.transport.currentTick;
    expect(playback.seek(4 * BAR)).toBe(false);
    expect(scheduler.transport.currentTick).toBe(tick);
    expect(playback.running).toBe(true);
    expect(player.releaseAll).not.toHaveBeenCalled();
    expect(player.reset).not.toHaveBeenCalled();
  });
});

describe('MusicPlayback queries', () => {
  it("forwards to the player and adds the transport's state to its readout", () => {
    const { playback, player, load } = rig();
    load();
    expect(playback.capturePattern(2, 1)).toEqual([true, false]);
    expect(player.capturePattern).toHaveBeenCalledWith(2, 1);
    expect(playback.stepAt(2, 48)).toBe(5);
    expect(player.stepAt).toHaveBeenCalledWith(2, 48);
    expect(playback.regionStepAt(2, 1, 48)).toBe(REGION_STEP);
    expect(player.regionStepAt).toHaveBeenCalledWith(2, 1, 48);
    playback.start();
    expect(playback.readout()).toEqual({ ...READOUT, muted: false, running: true });
  });
});

describe('MusicPlayback.dispose', () => {
  it('stops the transport, disposes the player and clears the mute flag', () => {
    const { playback, player, load } = rig();
    load();
    playback.setMuted(true);
    playback.dispose();
    expect(player.dispose).toHaveBeenCalledTimes(1);
    expect(playback.player).toBeNull();
    expect(playback.isMuted).toBe(false);
    expect(playback.running).toBe(false);
  });
});
