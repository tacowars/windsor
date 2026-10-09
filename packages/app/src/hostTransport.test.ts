/**
 * The console transport over the live system (#708) and where a rebuilt
 * system resumes (windsor#132): `HostTransport` and `resumeTick` over a fake
 * system, with no audio context. The host's build queue that drives them is
 * `host.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { TICKS_PER_BAR } from '@windsor/engine';
import { HostTransport, resumeTick, type TransportSystem } from './host';

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

  it('tells its halt listeners before ‖ and ■ halt, while the position still reads the tick heard', () => {
    const system = fakeSystem();
    const transport = new HostTransport(() => system);
    const heard: string[] = [];
    transport.onBeforeHalt(() => heard.push(`${transport.position()} ${system.calls.length}`));
    transport.play();
    system.tick = 200;
    transport.pause();
    transport.play();
    system.tick = 300;
    transport.stop();
    expect(heard).toEqual(['200 2', '300 5']);
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
    expect(transport.pendingResume).toBe(TICKS_PER_BAR);
    transport.buildAbandoned();
    expect(transport.position()).toBe(96);
    expect(transport.pendingResume).toBeUndefined();
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
