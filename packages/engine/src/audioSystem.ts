/**
 * The audio system: constructed by `main.ts`, updated by the render loop.
 *
 * Audio observes; it never decides. Simulation events flow one way -- the sim
 * emits, this subscribes and makes noise. Nothing here may feed back into
 * simulation state, or the determinism guarantee in CLAUDE.md invariant 1 stops
 * meaning anything: a dropped or late sound must be invisible to the server.
 */
import type { AudioBus } from './audioBus';
import type { AudioPart } from './audioPart';
import { FmEngine } from './fmEngine';
import { SPACES } from './reverbSpace';
import { Scheduler } from './scheduler';

export interface AudioSystemOptions {
  /** Start suspended and wait for a gesture. Always true in a real page. */
  autoUnlock?: boolean;
}

export class AudioSystem {
  readonly engine: FmEngine;
  readonly scheduler: Scheduler;

  private musicBus: AudioBus | null = null;
  private started = false;

  constructor(engine?: FmEngine) {
    this.engine = engine ?? new FmEngine();
    this.scheduler = new Scheduler(this.engine.context, { bpm: 96 });
  }

  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Load the worklet and build the standing buses. Safe to call before a user
   * gesture; nothing sounds until `unlock()`.
   */
  async init(): Promise<void> {
    if (this.started) return;
    await this.engine.init();
    this.musicBus = this.engine.createBus({
      reverb: 0.3,
      reverbSpace: SPACES.hall,
      delayTime: 0.28,
      feedback: 0.3,
      delayMix: 0.18,
      filter: { type: 'highpass', frequency: 30 },
    });
    this.started = true;
  }

  /** Call from a click or key handler. */
  async unlock(): Promise<void> {
    await this.engine.unlock();
  }

  /** Create a part routed to the music bus. */
  createMusicPart(name: string, preset: string, maxVoices = 12): AudioPart {
    if (!this.musicBus) throw new Error('AudioSystem.init() must be awaited first');
    return this.engine.createPart(name, {
      preset,
      maxVoices,
      destination: this.musicBus.input,
    });
  }

  /** Create a part routed dry to the master, for UI and close-up SFX. */
  createSfxPart(name: string, preset: string, maxVoices = 8): AudioPart {
    return this.engine.createPart(name, { preset, maxVoices });
  }

  /**
   * Driven by the render loop. Only pumps the look-ahead queue -- the times it
   * emits come from the audio clock, so a long frame delays the check, never
   * the note.
   */
  update(_dt: number): void {
    if (!this.started) return;
    this.scheduler.update();
  }

  dispose(): void {
    this.scheduler.stop();
    this.engine.dispose();
    this.musicBus = null;
    this.started = false;
  }
}
