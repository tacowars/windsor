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
import { EngineHost, HostTransport, resumeTick, type TransportSystem } from './host';

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

class FakeAudioContext {
  state = 'suspended';
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

describe('the console transport (#708): ▶ ■ ‖ over the live system', () => {
  interface FakeSystem {
    calls: string[];
    muted: boolean;
    running: boolean;
    tick: number;
  }
  const fakeSystem = (): FakeSystem & TransportSystem => {
    const sys = {
      calls: [] as string[],
      muted: false,
      running: false,
      tick: 0,
      startMusic(): void {
        sys.calls.push('start');
        if (!sys.muted) sys.running = true;
      },
      stopMusic(): void {
        sys.calls.push('stop');
        sys.running = false;
        sys.tick = 0;
      },
      seekMusic(tick: number): boolean {
        sys.calls.push(`seek ${tick}`);
        if (sys.running) return false;
        sys.tick = tick;
        return true;
      },
      setMuted(muted: boolean): void {
        sys.calls.push(muted ? 'mute' : 'unmute');
        sys.muted = muted;
        if (muted) sys.running = false;
      },
      get musicRunning(): boolean {
        return sys.running;
      },
      scheduler: { audibleTick: (): number => sys.tick },
      engine: { context: { currentTime: 0 } },
    };
    return sys as unknown as FakeSystem & TransportSystem;
  };

  it('does nothing before audio, and reads position 0', () => {
    const transport = new HostTransport(() => null);
    expect(transport.play()).toBe(false);
    transport.pause();
    transport.stop();
    expect(transport.state).toBe('idle');
    expect(transport.position()).toBe(0);
    expect(transport.running).toBe(false);
  });

  it('▶ unmutes and starts, ‖ is the mute, ■ is stopMusic', () => {
    const system = fakeSystem();
    const transport = new HostTransport(() => system);
    expect(transport.play()).toBe(true);
    expect(transport.state).toBe('playing');
    expect(transport.running).toBe(true);
    system.tick = 200;
    transport.pause();
    expect(transport.state).toBe('paused');
    expect(transport.position()).toBe(200);
    transport.play();
    expect(transport.state).toBe('playing');
    transport.stop();
    expect(transport.state).toBe('idle');
    expect(transport.position()).toBe(0);
    expect(system.calls).toEqual(['unmute', 'start', 'mute', 'unmute', 'start', 'stop']);
  });

  it('seek (windsor#102) is the engine seek, keeping the state; refused while playing or before audio', () => {
    expect(new HostTransport(() => null).seek(96)).toBe(false);
    const system = fakeSystem();
    const transport = new HostTransport(() => system);
    expect(transport.seek(192)).toBe(true);
    expect(transport.position()).toBe(192);
    expect(transport.state).toBe('idle');
    transport.play();
    expect(transport.seek(96)).toBe(false);
    transport.pause();
    expect(transport.seek(96)).toBe(true);
    expect(transport.state).toBe('paused');
    expect(transport.position()).toBe(96);
    expect(system.calls).toEqual(['seek 192', 'unmute', 'start', 'seek 96', 'mute', 'seek 96']);
  });

  it('‖ on an idle transport neither mutes nor changes state', () => {
    const system = fakeSystem();
    const transport = new HostTransport(() => system);
    transport.pause();
    expect(transport.state).toBe('idle');
    expect(system.calls).toEqual([]);
  });

  it('a rebuilt system starts only while ▶ is pressed; otherwise the transport is idle', () => {
    const system = fakeSystem();
    const transport = new HostTransport(() => system);
    transport.adopt(system);
    expect(system.calls).toEqual([]);
    transport.play();
    const rebuilt = fakeSystem();
    transport.adopt(rebuilt);
    expect(rebuilt.calls).toEqual(['start']);
    transport.pause();
    transport.adopt(fakeSystem());
    expect(transport.state).toBe('idle');
  });

  it('a ‖ pressed mid-rebuild, with no system yet, keeps the rebuilt system from starting', () => {
    let live: TransportSystem | null = fakeSystem();
    const transport = new HostTransport(() => live);
    transport.play();
    live = null;
    transport.pause();
    expect(transport.state).toBe('paused');
    const rebuilt = fakeSystem();
    live = rebuilt;
    transport.adopt(rebuilt);
    expect(rebuilt.calls).toEqual([]);
    expect(transport.state).toBe('idle');
  });

  it('an undo rebuild while ▶ is pressed seeks the new system to the bar, then starts it (windsor#132)', () => {
    let live: TransportSystem | null = fakeSystem();
    const transport = new HostTransport(() => live);
    transport.play();
    const rebuilt = fakeSystem();
    live = rebuilt;
    transport.adopt(rebuilt, 4 * TICKS_PER_BAR);
    expect(rebuilt.calls).toEqual([`seek ${4 * TICKS_PER_BAR}`, 'start']);
    expect(transport.state).toBe('playing');
    expect(transport.position()).toBe(4 * TICKS_PER_BAR);
  });

  it('reads the pending resume tick while a rebuilt system is live but not yet adopted (init, unlock)', () => {
    const BAR = TICKS_PER_BAR;
    let live: TransportSystem | null = fakeSystem();
    const transport = new HostTransport(() => live);
    transport.play();
    // The first undo, mid-bar 5, requests a build resuming from bar 5.
    transport.buildPending(4 * BAR);
    // `rebuild` assigns the new system before its `init` and `unlock`
    // resolve: it is live, at rest at tick 0, and not adopted.
    const rebuilt = fakeSystem();
    live = rebuilt;
    expect(transport.position()).toBe(4 * BAR);
    // A second undo in that window reads bar 5, not the rest position.
    transport.buildPending(transport.position());
    expect(transport.position()).toBe(4 * BAR);
    transport.adopt(rebuilt, 4 * BAR);
    expect(rebuilt.calls).toEqual([`seek ${4 * BAR}`, 'start']);
    // Adopted, the transport reads the system again.
    rebuilt.tick = 4 * BAR + 7;
    expect(transport.position()).toBe(4 * BAR + 7);
  });

  it('a pending resume ends with the build abandoned, and a build with none reads the live system', () => {
    const system = fakeSystem();
    system.tick = 96;
    const transport = new HostTransport(() => system);
    transport.buildPending(TICKS_PER_BAR);
    expect(transport.position()).toBe(TICKS_PER_BAR);
    transport.buildAbandoned();
    expect(transport.position()).toBe(96);
    transport.buildPending(TICKS_PER_BAR);
    transport.buildPending(undefined);
    expect(transport.position()).toBe(96);
  });

  it('a resume at 0 seeks a rebuilt system resting at a later loop start; no resume leaves it there', () => {
    const LOOP_START = 4 * TICKS_PER_BAR;
    let live: TransportSystem | null = fakeSystem();
    const transport = new HostTransport(() => live);
    transport.play();
    // `initMusic` rewound the fresh system to the active bars 5–9 loop.
    const resumed = fakeSystem();
    resumed.tick = LOOP_START;
    live = resumed;
    transport.adopt(resumed, 0);
    expect(resumed.calls).toEqual(['seek 0', 'start']);
    expect(transport.position()).toBe(0);
    // An import or New song (no resume) starts where the system rests.
    const imported = fakeSystem();
    imported.tick = LOOP_START;
    live = imported;
    transport.adopt(imported);
    expect(imported.calls).toEqual(['start']);
    expect(transport.position()).toBe(LOOP_START);
  });

  it('a paused or stopped transport adopts a resuming rebuild idle, without a seek', () => {
    let live: TransportSystem | null = fakeSystem();
    const transport = new HostTransport(() => live);
    transport.play();
    transport.pause();
    const paused = fakeSystem();
    live = paused;
    transport.adopt(paused, 4 * TICKS_PER_BAR);
    expect(paused.calls).toEqual([]);
    expect(transport.state).toBe('idle');
    transport.stop();
    const stopped = fakeSystem();
    transport.adopt(stopped, 4 * TICKS_PER_BAR);
    expect(stopped.calls).toEqual([]);
    expect(transport.state).toBe('idle');
  });
});

describe('resumeTick (windsor#132): where a rebuilt system starts', () => {
  const BAR = TICKS_PER_BAR;
  const SONG = 8 * BAR;

  it('is the start of the bar the tick is in', () => {
    expect(resumeTick(4 * BAR + BAR / 2, SONG)).toBe(4 * BAR);
    expect(resumeTick(4 * BAR, SONG)).toBe(4 * BAR);
    expect(resumeTick(BAR - 1, SONG)).toBe(0);
  });

  it('is no resume at all with no tick, told apart from a resume at the top', () => {
    expect(resumeTick(undefined, SONG)).toBeUndefined();
    expect(resumeTick(0, SONG)).toBe(0);
  });

  it('is the top of the song for a bar past the end of the song being built', () => {
    expect(resumeTick(SONG, SONG)).toBe(0);
    expect(resumeTick(10 * BAR + 5, SONG)).toBe(0);
    expect(resumeTick(Number.NaN, SONG)).toBe(0);
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
