/**
 * The audio system: constructed by `main.ts`, updated by the render loop.
 *
 * Audio observes; it never decides. Simulation events flow one way -- the sim
 * emits, this subscribes and makes noise. Nothing here may feed back into
 * simulation state, or the determinism guarantee in CLAUDE.md invariant 1 stops
 * meaning anything: a dropped or late sound must be invisible to the server.
 *
 * The standing graph, per docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md:
 *
 *   part.output ─┬─ [rotate θ] ─▶ musicBus ─▶ [highpass] ─▶ master ─▶ limiter ─▶ out
 *                ├─ send ─▶ return "room" (plate, 100% wet) ─▶ master
 *                └─ send ─▶ return "echo" (delay)           ─▶ master
 *
 * SFX parts get the same strip with the master as their dry destination, so
 * they skip the music bus's inserts but still have a real pan and a send.
 */
import type { Arrangement, DeepPartial } from './arrangement';
import { ARRANGEMENT } from './arrangement';
import type { ApplyResult, ArrangementReadout, MusicEventHandler } from './arrangementPlayer';
import { ArrangementPlayer } from './arrangementPlayer';
import type { AudioBus } from './audioBus';
import type { AudioPart } from './audioPart';
import type { PartStrip } from './channelStrip';
import { routePart } from './channelStrip';
import { FmEngine } from './fmEngine';
import type { ChannelStrip, ReturnSpec } from './mix';
import { MIX, RETURNS, stripFor } from './mix';
import type { ReturnBus } from './returnBus';
import { createReturns } from './returnBus';
import { Scheduler } from './scheduler';

export interface AudioSystemOptions {
  /** Start suspended and wait for a gesture. Always true in a real page. */
  autoUnlock?: boolean;
  /** The desk. Defaults to `MIX`; a test or the console (#70) may hand in its own. */
  mix?: Readonly<Record<string, ChannelStrip>>;
  /** The returns to build. Defaults to `RETURNS`. */
  returns?: Readonly<Record<string, ReturnSpec>>;
}

/** `__a204.audio.readout()` (issue #69): the arrangement's state plus the system's. */
export interface MusicReadout extends ArrangementReadout {
  muted: boolean;
  running: boolean;
}

export class AudioSystem {
  readonly engine: FmEngine;
  readonly scheduler: Scheduler;

  private readonly mix: Readonly<Record<string, ChannelStrip>>;
  private readonly returnSpecs: Readonly<Record<string, ReturnSpec>>;
  private musicBus: AudioBus | null = null;
  private returns: Readonly<Record<string, ReturnBus>> | null = null;
  private readonly strips = new Map<string, PartStrip>();
  private started = false;
  private player: ArrangementPlayer | null = null;
  private muted = false;

  constructor(engine?: FmEngine, options: AudioSystemOptions = {}) {
    this.engine = engine ?? new FmEngine();
    this.scheduler = new Scheduler(this.engine.context, { bpm: 96 });
    this.mix = options.mix ?? MIX;
    this.returnSpecs = options.returns ?? RETURNS;
  }

  get isStarted(): boolean {
    return this.started;
  }

  /**
   * Load the worklets and build the standing bus and returns. Safe to call
   * before a user gesture; nothing sounds until `unlock()`.
   */
  async init(): Promise<void> {
    if (this.started) return;
    await this.engine.init();
    this.musicBus = this.engine.createBus({ filter: { type: 'highpass', frequency: 30 } });
    this.returns = createReturns(this.engine.context, this.returnSpecs, this.engine.master);
    this.started = true;
  }

  /** Call from a click or key handler. */
  async unlock(): Promise<void> {
    await this.engine.unlock();
  }

  /** Create a part on its strip, dry into the music bus. */
  createMusicPart(name: string, preset: string, maxVoices = 12): AudioPart {
    const { musicBus } = this.standing();
    return this.route(name, preset, maxVoices, musicBus.input);
  }

  /** Create a part on its strip, dry into the master, for UI and close-up SFX. */
  createSfxPart(name: string, preset: string, maxVoices = 8): AudioPart {
    this.standing();
    return this.route(name, preset, maxVoices, this.engine.master);
  }

  /**
   * Build the four music parts on their strips and bind the generators to the
   * transport (issue #69). Idempotent. Nothing sounds until `startMusic()`;
   * under `?music=0` main.ts builds this but never starts the transport, so
   * the whole graph exists on a silent page (refinement decision 2).
   */
  initMusic(arrangement: Arrangement = ARRANGEMENT, onEvent?: MusicEventHandler): void {
    if (this.player) return;
    const parts = {
      kick: this.createMusicPart(arrangement.kick.part, arrangement.kick.preset),
      hat: this.createMusicPart(arrangement.hat.part, arrangement.hat.preset),
      arp: this.createMusicPart(arrangement.arp.part, arrangement.arp.preset),
      drone: this.createMusicPart(arrangement.drone.part, arrangement.drone.preset),
    };
    this.player = new ArrangementPlayer(this.scheduler, parts, arrangement, onEvent);
  }

  /** Start (or resume) the transport. Called at the unlock gesture; a no-op while muted. */
  startMusic(): void {
    if (!this.player || this.muted) return;
    this.scheduler.start(this.scheduler.transport.currentTick);
  }

  get musicRunning(): boolean {
    return this.scheduler.isRunning;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /**
   * Mute stops the transport and releases everything held, so tails ring out
   * rather than cutting; unmute resumes at the tick the transport stopped on,
   * which keeps the bar phase every regeneration hangs off.
   */
  setMuted(muted: boolean): void {
    if (this.muted === muted) return;
    this.muted = muted;
    if (muted) {
      this.scheduler.stop();
      this.player?.releaseAll(this.engine.context.currentTime);
    } else {
      this.startMusic();
    }
  }

  /** The M key's toggle (main.ts). Returns the new muted state. */
  toggleMute(): boolean {
    this.setMuted(!this.muted);
    return this.muted;
  }

  /** Live tuning (refinement decision 3): merge a partial arrangement over the current one. */
  apply(partial: DeepPartial<Arrangement>): ApplyResult {
    if (!this.player) return { ok: false, ignored: [], error: 'music is not initialised' };
    return this.player.apply(partial);
  }

  readout(): MusicReadout {
    const base: ArrangementReadout = this.player?.readout() ?? {
      bpm: this.scheduler.bpm,
      root: NaN,
      scale: [],
      counters: { kick: 0, hat: 0, arp: 0, drone: 0 },
    };
    return { ...base, muted: this.muted, running: this.scheduler.isRunning };
  }

  /** The live strip of a part this system created. */
  strip(name: string): PartStrip | undefined {
    return this.strips.get(name);
  }

  /** A return by name, once `init()` has built them. */
  returnBus(name: string): ReturnBus | undefined {
    return this.returns?.[name];
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
    this.player?.dispose();
    this.player = null;
    this.muted = false;
    for (const strip of this.strips.values()) strip.dispose();
    this.strips.clear();
    if (this.returns) for (const bus of Object.values(this.returns)) bus.dispose();
    this.engine.dispose();
    this.musicBus = null;
    this.returns = null;
    this.started = false;
  }

  private standing(): { musicBus: AudioBus; returns: Readonly<Record<string, ReturnBus>> } {
    if (!this.musicBus || !this.returns) {
      throw new Error('AudioSystem.init() must be awaited first');
    }
    return { musicBus: this.musicBus, returns: this.returns };
  }

  private route(name: string, preset: string, maxVoices: number, dry: AudioNode): AudioPart {
    const { returns } = this.standing();
    const part = this.engine.createPart(name, { preset, maxVoices, destination: null });
    this.strips.set(name, routePart(part, stripFor(this.mix, name), returns, dry));
    return part;
  }
}
