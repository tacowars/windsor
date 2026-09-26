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

import { makeArrangement } from '../../../packages/client/src/audio/index-for-editor';
import { EngineHost, HostTransport, type TransportSystem } from './host';

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
    addModule: (url: string): Promise<void> => {
      loaded.push(url.slice(0, url.indexOf(':') + 1));
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
const saved = {
  window: globals['window'],
  AudioContext: globals['AudioContext'],
  createObjectURL: URL.createObjectURL,
};
globals['window'] = { __A204_DSP__: { fm: '// fm', reverb: '// reverb' } };
globals['AudioContext'] = FakeAudioContext;
URL.createObjectURL = (): string => 'blob:fake-dsp';
afterAll(() => {
  globals['window'] = saved.window;
  globals['AudioContext'] = saved.AudioContext;
  URL.createObjectURL = saved.createObjectURL;
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

  it('tries the blob URLs, then the data URLs, and reports the failure', async () => {
    await expect(host.enable(song)).rejects.toThrow('refused');
    // One module attempt per context: the blob attempt and the data-URL retry.
    expect(loaded).toEqual(['blob:', 'data:']);
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
    // Both contexts it opened are closed again.
    expect(contexts).toBe(2);
    expect(closed).toBe(2);
  });

  it('retries on the next click instead of returning early for ever', async () => {
    await expect(host.enable(song)).rejects.toThrow();
    loaded.length = 0;
    contexts = 0;

    // The second click on the power button. Before #617 this resolved
    // silently against the context the failed run had left behind.
    await expect(host.enable(song)).rejects.toThrow('refused');
    expect(loaded).toEqual(['blob:', 'data:']);
    expect(contexts).toBe(2);
  });

  it('keeps one enable in flight rather than opening a context per click', async () => {
    const first = host.enable(song);
    const second = host.enable(song);
    await expect(first).rejects.toThrow();
    await expect(second).resolves.toBeUndefined();
    expect(contexts).toBe(2);
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
});
