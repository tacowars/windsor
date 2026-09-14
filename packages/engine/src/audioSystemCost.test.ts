/**
 * What the audio system reports about its own cost (#275).
 *
 * Two claims are pinned here, on the headless graph stand-in rather than in a
 * browser:
 *
 *  1. `update()` times the scheduler pump it runs every frame. That call is
 *     the system's whole per-frame main-thread cost — everything else audio
 *     does happens on the audio thread or on an event — and it has been
 *     inside every milestone reading taken so far, unattributed (the
 *     2026-09-05 audit's finding C13).
 *  2. `costReadout()` composes the three measurements without merging them,
 *     and reports `playback: null` on a context with no `playbackStats`
 *     rather than substituting the worklets' estimate (#275 decision 5). The
 *     stand-in has no such API, which makes it exactly the Mac-Chrome case.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { FakeContext, installFakeAudioWorklet } from './__fixtures__/fakeAudioContext';
import { AudioSystem } from './audioSystem';
import { FmEngine } from './fmEngine';

const restore = installFakeAudioWorklet();
afterAll(() => restore());

/** A system on a clock the test drives: every `now()` call advances it by `step` ms. */
async function rig(step: number): Promise<AudioSystem> {
  let t = 0;
  const context = new FakeContext();
  const system = new AudioSystem(new FmEngine(context.asAudioContext()), {
    now: () => {
      const at = t;
      t += step;
      return at;
    },
  });
  await system.init();
  return system;
}

describe('AudioSystem.update (#275 decision 7)', () => {
  it('times the scheduler pump and reports mean, p95 and the last frame', async () => {
    const system = await rig(0.25);
    system.update(0.016);
    system.update(0.016);
    const { sched } = system.costReadout();
    expect(sched.frames).toBe(2);
    expect(sched.lastMs).toBeCloseTo(0.25, 9);
    expect(sched.meanMs).toBeCloseTo(0.25, 9);
    expect(sched.p95Ms).toBeCloseTo(0.25, 9);
  });

  it('times nothing before the system has started', async () => {
    const context = new FakeContext();
    const system = new AudioSystem(new FmEngine(context.asAudioContext()), { now: () => 0 });
    system.update(0.016);
    expect(system.costReadout().sched.frames).toBe(0);
  });

  it('forgets its samples when disposed', async () => {
    const system = await rig(0.25);
    system.update(0.016);
    system.dispose();
    expect(system.costReadout().sched.frames).toBe(0);
  });
});

describe('AudioSystem.costReadout (#275 decisions 3 and 5)', () => {
  it('keeps the three measurements apart, and says nothing it cannot measure', async () => {
    const system = await rig(0);
    const readout = system.costReadout();
    // The worklets' estimate is its own field and is never the playbackStats
    // figure; the stand-in context has no playbackStats at all.
    expect(readout.load.underruns).toBe(0);
    expect(readout.playback).toBeNull();
    expect(readout.sched.frames).toBe(0);
  });

  it('snapshots playbackStats where the context has it, rather than holding the live object', async () => {
    const system = await rig(0);
    const live = {
      underrunDuration: 0,
      underrunEvents: 0,
      totalDuration: 1,
      averageLatency: 0.0319,
      minimumLatency: 0,
      maximumLatency: 0.0372,
    };
    Object.assign(system.engine.context, { playbackStats: live });
    const before = system.costReadout().playback;
    live.underrunEvents = 7;
    expect(before?.underrunEvents).toBe(0);
    expect(system.costReadout().playback?.underrunEvents).toBe(7);
  });
});
