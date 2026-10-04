/**
 * The engine host's enable path (#617), over a fake `AudioContext` whose
 * worklet loader refuses every module — the shape of the failure the real
 * console hits on a `file://` origin, which is why `enable` has a data-URL
 * retry in the first place.
 *
 * What is under test is the state the host is left in when both attempts
 * fail. It used to keep the context it had already created, with `system`
 * still null, so `enable`'s early return fired on every later click and
 * awaited `undefined`: a power button that did nothing, said nothing and
 * could not be retried without a reload. The success path is not reachable
 * without a real worklet runtime; what the second click has to do is start
 * the same attempt over, and that is what is asserted here.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { TICKS_PER_BAR, makeArrangement, songTicksOf } from '@windsor/engine';
import { EngineHost } from './host';

const param = (): { value: number } => ({ value: 0 });
const node = (): Record<string, unknown> => ({
  gain: param(),
  threshold: param(),
  knee: param(),
  ratio: param(),
  attack: param(),
  release: param(),
  connect: (): void => undefined,
  disconnect: (): void => undefined,
});

const loaded: string[] = [];
let contexts = 0;
let closed = 0;
/** Set to hold each module load until the test calls `refusals`. */
let deferModules = false;
const refusals: (() => void)[] = [];
/** Every context the host has made, newest last. */
const made: FakeAudioContext[] = [];

class FakeAudioContext {
  state = 'suspended';
  onstatechange: (() => void) | null = null;
  destination = node();
  audioWorklet = {
    addModule: (url: string | URL): Promise<void> => {
      loaded.push(String(url).split('/').pop() ?? '');
      const refusal = new Error('worklet modules are refused on this origin');
      if (!deferModules) return Promise.reject(refusal);
      // A build held mid-initialisation until the test refuses it.
      return new Promise<void>((_resolve, reject) => void refusals.push(() => reject(refusal)));
    },
  };
  constructor() {
    contexts++;
    made.push(this);
  }
  createGain = node;
  createDynamicsCompressor = node;
  createAnalyser = (): Record<string, unknown> => ({ fftSize: 0, ...node() });
  close = (): Promise<void> => {
    closed++;
    return Promise.resolve();
  };
  resume = (): Promise<void> => {
    this.state = 'running';
    return Promise.resolve();
  };
}

const globals = globalThis as unknown as Record<string, unknown>;
const saved = { AudioContext: globals['AudioContext'] };
globals['AudioContext'] = FakeAudioContext;
afterAll(() => {
  globals['AudioContext'] = saved.AudioContext;
});

describe('EngineHost.enable when the DSP will not load', () => {
  const song = makeArrangement({}).document;
  let log: string[];
  let host: EngineHost;

  beforeEach(() => {
    loaded.length = 0;
    contexts = 0;
    closed = 0;
    log = [];
    host = new EngineHost((line) => void log.push(line));
  });

  it("loads the engine's own worklet URL and reports the failure", async () => {
    await expect(host.enable(song)).rejects.toThrow('refused');
    // One attempt, on one context, at the FM module the engine names.
    expect(loaded).toEqual(['fm-processor.js']);
    expect(log).toHaveLength(1);
    expect(log[0]).toContain('audio could not be enabled');
    expect(log[0]).toContain('retry');
  });

  it('leaves nothing half-built: no system, and every call into it a no-op', async () => {
    await expect(host.enable(song)).rejects.toThrow();
    expect(host.enabled).toBe(false);
    // `rebuild` drops the system as it disposes it, so a throwing `init`
    // cannot leave these calling into a disposed one.
    expect(host.apply({ transport: { bpm: 90 } })).toBeNull();
    expect(host.capturePattern(0)).toBeNull();
    expect(host.part(0)).toBeNull();
    expect(() => host.update()).not.toThrow();
    // The context it opened is closed again.
    expect(contexts).toBe(1);
    expect(closed).toBe(1);
  });

  it('retries on the next click instead of returning early for ever', async () => {
    await expect(host.enable(song)).rejects.toThrow();
    loaded.length = 0;
    contexts = 0;

    // The second click on the power button. Before #617 this resolved
    // silently against the context the failed run had left behind.
    await expect(host.enable(song)).rejects.toThrow('refused');
    expect(loaded).toEqual(['fm-processor.js']);
    expect(contexts).toBe(1);
  });

  it('keeps one enable in flight rather than opening a context per click', async () => {
    const first = host.enable(song);
    const second = host.enable(song);
    await expect(first).rejects.toThrow();
    await expect(second).resolves.toBeUndefined();
    expect(contexts).toBe(1);
  });
});

describe("the context's state, for the audio gate (windsor#578)", () => {
  const song = makeArrangement({}).document;

  it('is heard on the live context, and dropped with a discarded one', async () => {
    const host = new EngineHost(() => undefined);
    let heard = 0;
    host.onAudioState(() => void heard++);
    expect(host.audioRunning).toBe(false);
    // The context exists from the press on; this one's build will fail.
    const enabling = host.enable(song);
    const first = made.at(-1)!;
    first.state = 'running';
    first.onstatechange?.();
    expect([host.audioRunning, heard]).toEqual([true, 1]);
    await expect(enabling).rejects.toThrow();
    // Discarded: no longer heard, and its going is heard once.
    expect(first.onstatechange).toBeNull();
    expect([host.audioRunning, heard]).toEqual([false, 2]);
    // The retry's context is the one followed.
    const retry = host.enable(song);
    const second = made.at(-1)!;
    expect(second).not.toBe(first);
    second.state = 'suspended';
    second.onstatechange?.();
    expect([host.audioRunning, heard]).toEqual([false, 3]);
    await expect(retry).rejects.toThrow();
  });
});

describe('an undo landing while a rebuild initialises (windsor#132)', () => {
  const BAR = TICKS_PER_BAR;
  const empty = makeArrangement({}).document;
  const song = { ...empty, transport: { ...empty.transport, bars: 8 } };

  afterAll(() => {
    deferModules = false;
  });

  /** Let the queued build reach its first held module load. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  it('reads the bar the pending build resumes from, until a non-undo build takes over', async () => {
    deferModules = true;
    const host = new EngineHost(() => undefined);
    // A build is in flight, held in initialisation: no system is live.
    const enabling = host.enable(song);
    await settle();
    expect(refusals).toHaveLength(1);
    expect(host.isBuilding).toBe(true);
    expect(host.transport.position()).toBe(0);
    // The first undo, read mid-bar 5, queues a build resuming from bar 5.
    const undos = [host.build(song, { resumeAt: 4 * BAR + BAR / 2 })];
    expect(host.transport.position()).toBe(4 * BAR);
    // A second undo before initialisation resolves reads that bar, not 0,
    // so the build that wins still resumes there.
    undos.push(host.build(song, { resumeAt: host.transport.position() % songTicksOf(song) }));
    expect(host.transport.position()).toBe(4 * BAR);
    // An import or New song queued behind them starts from the top.
    undos.push(host.build(song));
    expect(host.transport.position()).toBe(0);
    refusals.splice(0).forEach((refuse) => refuse());
    await expect(enabling).rejects.toThrow('refused');
    await settle();
    refusals.splice(0).forEach((refuse) => refuse());
    await Promise.allSettled(undos);
  });

  it("keeps the undo's bar through an edit re-synced mid-build; an import still starts from the top (windsor#141)", async () => {
    deferModules = true;
    const host = new EngineHost(() => undefined);
    const enabling = host.enable(song);
    await settle();
    const builds = [host.build(song, { resumeAt: 4 * BAR + BAR / 2 })];
    // A knob turned while the undo's build is in flight queues a re-sync,
    // which wins with its document and keeps the undo's bar.
    const edited = { ...song, transport: { ...song.transport, bpm: 100 } };
    builds.push(host.build(edited, { keepPendingResume: true }));
    expect(host.transport.pendingResume).toBe(4 * BAR);
    expect(host.transport.position()).toBe(4 * BAR);
    // The bar is checked against the re-synced song: past its end is the top.
    const shorter = { ...edited, transport: { ...edited.transport, bars: 4 } };
    builds.push(host.build(shorter, { keepPendingResume: true }));
    expect(host.transport.pendingResume).toBe(0);
    builds.push(host.build(song, { resumeAt: 4 * BAR }), host.build(song));
    // An import queued behind the undo starts from the top, as does a re-sync after it.
    expect(host.transport.pendingResume).toBeUndefined();
    builds.push(host.build(edited, { keepPendingResume: true }));
    expect(host.transport.pendingResume).toBeUndefined();
    expect(host.transport.position()).toBe(0);
    refusals.splice(0).forEach((refuse) => refuse());
    await expect(enabling).rejects.toThrow('refused');
    await settle();
    refusals.splice(0).forEach((refuse) => refuse());
    await Promise.allSettled(builds);
  });

  it('drops the pending bar when the resuming build fails, or has no audio to build', async () => {
    deferModules = false;
    const host = new EngineHost(() => undefined);
    // Before audio there is nothing to build: the resume ends with the build.
    const before = host.build(song, { resumeAt: 4 * BAR });
    expect(host.transport.position()).toBe(4 * BAR);
    await before;
    expect(host.transport.position()).toBe(0);
    // An undo queued behind an enable whose DSP will not load: the failed
    // enable takes the context down, and the undo leaves no bar behind it.
    deferModules = true;
    const enabling = host.enable(song);
    await settle();
    const undo = host.build(song, { resumeAt: 4 * BAR });
    expect(host.transport.position()).toBe(4 * BAR);
    refusals.splice(0).forEach((refuse) => refuse());
    await expect(enabling).rejects.toThrow('refused');
    await undo;
    expect(host.transport.position()).toBe(0);
  });
});
