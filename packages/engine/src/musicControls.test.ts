/**
 * The music transport's two dev and startup paths, after #521 removed the `M`
 * key: the `music` console command (#119), registered by the system that owns
 * the transport mute, and the autoplay-unlock branch that starts the music at
 * the first gesture. The command is registered even under `?music=0`, where
 * it reports a suppressed transport rather than going missing.
 *
 * `KeyM` gets a test of its own (#521 decision 1) — a press must change
 * neither the mute nor the transport — because the key is free now and the
 * only player-facing music mute is the Settings panel's.
 *
 * The audio system is a stand-in with the four members the controls touch:
 * `AudioSystem` itself builds an `AudioContext`, which is exactly what does
 * not exist in vitest's `node` environment.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CommandRegistry } from '../debug/console/commandRegistry.js';
import type { AudioSystem } from './audioSystem';
import { FALLBACK_ARRANGEMENT } from './arrangement';
import bed01 from './arrangements/bed-01.json';
import { installMusicControls, type MusicChoice, type MusicLog } from './musicControls';

const ON: MusicChoice = { enabled: true, name: 'bed-01', raw: bed01 };
const OFF: MusicChoice = { enabled: false, name: 'bed-01', raw: bed01 };

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
    initMusic(document: unknown): void {
      a.document = document;
    },
    document: null as unknown,
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
  /** The unlock branch resolves a promise before it starts the transport. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    log = vi.fn<MusicLog>();
    listeners.length = 0;
    addEventListener.mockClear();
    vi.stubGlobal('window', { addEventListener });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('registers nothing when no registry is passed', () => {
    installMusicControls(fakeAudio().system, ON, log);
    expect(new CommandRegistry().has('music')).toBe(false);
  });

  it('reports the mute and the transport without an argument', () => {
    const { system } = fakeAudio();
    const commands = new CommandRegistry();
    installMusicControls(system, ON, log, commands);
    system.startMusic();
    expect(commands.run('music')).toEqual(['music on — transport running']);
  });

  it('stops and restarts the transport from the command, logging each move', () => {
    const { system } = fakeAudio();
    const commands = new CommandRegistry();
    installMusicControls(system, ON, log, commands);
    system.startMusic();
    log.mockClear();
    expect(commands.run('music off')).toEqual(['music off — transport stopped']);
    expect(system.isMuted).toBe(true);
    expect(log).toHaveBeenCalledWith({ state: 'muted' });
    log.mockClear();
    expect(commands.run('music on')).toEqual(['music on — transport running']);
    expect(system.isMuted).toBe(false);
    expect(log).toHaveBeenCalledWith({ state: 'unmuted' });
  });

  it('does nothing on `KeyM` — the panel owns the player mute now (#521 decision 1)', async () => {
    const { system } = fakeAudio();
    const commands = new CommandRegistry();
    installMusicControls(system, ON, log, commands);
    commands.run('music off');
    log.mockClear();

    press('KeyM');
    await settle();

    expect(system.isMuted).toBe(true);
    expect(system.musicRunning).toBe(false);
    expect(log).not.toHaveBeenCalledWith({ state: 'unmuted' });
    // Held or not, the key is inert: no listener reads it at all.
    press('KeyM', true);
    await settle();
    expect(system.isMuted).toBe(true);
    expect(log).not.toHaveBeenCalledWith({ state: 'unmuted' });
  });

  it('still starts the music at the first gesture (the unlock path)', async () => {
    const { system } = fakeAudio();
    installMusicControls(system, ON, log);

    press('KeyM');
    await settle();

    // Even the freed key is a gesture: unlock is bound to any `keydown`.
    expect(system.musicRunning).toBe(true);
    expect(log).toHaveBeenCalledWith({
      state: 'started',
      bpm: 100,
      root: 0,
      scale: 'minor',
    });
  });

  it('starts nothing at the first gesture under ?music=0', async () => {
    const { system, state } = fakeAudio();
    installMusicControls(system, OFF, log);

    press('KeyW');
    await settle();

    expect(state.suppressed).toBe(true);
    expect(system.musicRunning).toBe(false);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'started' }));
  });

  it('starts nothing at the first gesture while the transport is stopped', async () => {
    const { system } = fakeAudio();
    const commands = new CommandRegistry();
    installMusicControls(system, ON, log, commands);
    commands.run('music off');

    press('KeyW');
    await settle();

    expect(system.musicRunning).toBe(false);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'started' }));
  });

  it('logs nothing when the argument is what it already is', () => {
    const commands = new CommandRegistry();
    installMusicControls(fakeAudio().system, ON, log, commands);
    log.mockClear();
    commands.run('music on');
    expect(log).not.toHaveBeenCalled();
  });

  it('is registered under ?music=0 and reports the suppressed transport', () => {
    const { system, state } = fakeAudio();
    const commands = new CommandRegistry();
    installMusicControls(system, OFF, log, commands);
    expect(state.suppressed).toBe(true);
    expect(commands.run('music')).toEqual(['music on — transport stopped']);
  });

  it('plays the fallback click and logs the miss for a name no committed file carries', () => {
    const { system, state } = fakeAudio();
    installMusicControls(system, { enabled: true, name: 'bed-99', raw: undefined }, log);
    expect((state as { document?: unknown }).document).toEqual(FALLBACK_ARRANGEMENT);
    expect(log).toHaveBeenCalledWith({
      state: 'arrangement',
      name: 'bed-99',
      usable: false,
      corrections: expect.stringContaining('no committed arrangements/bed-99.json') as string,
    });
  });

  it('logs nothing about a clean committed document', () => {
    installMusicControls(fakeAudio().system, ON, log);
    expect(log).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'arrangement' }));
  });

  it('prints the parse error rather than reading a typo as off', () => {
    const commands = new CommandRegistry();
    installMusicControls(fakeAudio().system, ON, log, commands);
    expect(commands.run('music mayb')).toEqual(['music: expected on or off (got "mayb")']);
  });
});
