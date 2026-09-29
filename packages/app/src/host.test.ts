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

import { TICKS_PER_BAR, makeArrangement } from '@windsor/engine';
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

class FakeAudioContext {
  state = 'suspended';
  destination = node();
  audioWorklet = {
    addModule: (url: string | URL): Promise<void> => {
      loaded.push(String(url).split('/').pop() ?? '');
      return Promise.reject(new Error('worklet modules are refused on this origin'));
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

  it('is the top of the song with no tick, or a bar past the end of the song being built', () => {
    expect(resumeTick(undefined, SONG)).toBe(0);
    expect(resumeTick(SONG, SONG)).toBe(0);
    expect(resumeTick(10 * BAR + 5, SONG)).toBe(0);
    expect(resumeTick(Number.NaN, SONG)).toBe(0);
  });
});
