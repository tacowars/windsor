/**
 * The `music` console command (#119), registered by the system that owns the
 * mute. The `M` key and the command are one setter, so the test asserts they
 * log the same `music` event and that the command is registered even under
 * `?music=0`, where it reports a suppressed transport rather than going
 * missing.
 *
 * The audio system is a stand-in with the four members the controls touch:
 * `AudioSystem` itself builds an `AudioContext`, which is exactly what does
 * not exist in vitest's `node` environment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../debug/console/commandRegistry.js';
import type { AudioSystem } from './audioSystem';
import { installMusicControls, type MusicLog } from './musicControls';

/** The stand-in's own state, readable in the test; `AudioSystem` keeps its private. */
interface FakeState {
  muted: boolean;
  running: boolean;
  suppressed: boolean;
}

function fakeAudio(): { system: AudioSystem; state: FakeState } {
  const a = {
    muted: false,
    running: false,
    suppressed: false,
    suppressMusic(): void {
      a.suppressed = true;
      a.running = false;
    },
    initMusic(): void {},
    unlock: async (): Promise<void> => {},
    startMusic(): void {
      if (!a.muted && !a.suppressed) a.running = true;
    },
    get musicRunning(): boolean {
      return a.running;
    },
    get isMuted(): boolean {
      return a.muted;
    },
    setMuted(muted: boolean): void {
      if (a.muted === muted) return;
      a.muted = muted;
      if (muted) a.running = false;
      else a.startMusic();
    },
    readout: () => ({ bpm: 100, root: 0, scale: 'minor' }),
  };
  return { system: a as unknown as AudioSystem, state: a };
}

describe('installMusicControls', () => {
  let log: ReturnType<typeof vi.fn<MusicLog>>;
  const listeners: ((event: KeyboardEvent) => void)[] = [];
  const addEventListener = vi.fn((type: string, handler: unknown) => {
    if (type === 'keydown') listeners.push(handler as (event: KeyboardEvent) => void);
  });
  const press = (code: string, repeat = false): void => {
    for (const l of [...listeners]) l({ code, repeat } as KeyboardEvent);
  };

  beforeEach(() => {
    log = vi.fn<MusicLog>();
    listeners.length = 0;
    addEventListener.mockClear();
    vi.stubGlobal('window', { addEventListener });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('registers nothing when no registry is passed', () => {
    installMusicControls(fakeAudio().system, true, log);
    expect(new CommandRegistry().has('music')).toBe(false);
  });

  it('reports the mute and the transport without an argument', () => {
    const { system } = fakeAudio();
    const commands = new CommandRegistry();
    installMusicControls(system, true, log, commands);
    system.startMusic();
    expect(commands.run('music')).toEqual(['music on — transport running']);
  });

  it('mutes and unmutes, logging what the `M` key logs', () => {
    const { system } = fakeAudio();
    const commands = new CommandRegistry();
    installMusicControls(system, true, log, commands);
    system.startMusic();
    log.mockClear();
    expect(commands.run('music off')).toEqual(['music off — transport stopped']);
    expect(system.isMuted).toBe(true);
    expect(log).toHaveBeenCalledWith({ state: 'muted' });
    log.mockClear();
    press('KeyM');
    expect(system.isMuted).toBe(false);
    expect(log).toHaveBeenCalledWith({ state: 'unmuted' });
  });

  it('logs nothing when the argument is what it already is', () => {
    const commands = new CommandRegistry();
    installMusicControls(fakeAudio().system, true, log, commands);
    log.mockClear();
    commands.run('music on');
    expect(log).not.toHaveBeenCalled();
  });

  it('is registered under ?music=0 and reports the suppressed transport', () => {
    const { system, state } = fakeAudio();
    const commands = new CommandRegistry();
    installMusicControls(system, false, log, commands);
    expect(state.suppressed).toBe(true);
    expect(commands.run('music')).toEqual(['music on — transport stopped']);
  });

  it('prints the parse error rather than reading a typo as off', () => {
    const commands = new CommandRegistry();
    installMusicControls(fakeAudio().system, true, log, commands);
    expect(commands.run('music mayb')).toEqual(['music: expected on or off (got "mayb")']);
  });
});
