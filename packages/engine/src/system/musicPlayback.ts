/**
 * How the song plays: the arrangement player `AudioSystem.initMusic` built,
 * bound to the transport, and the rules for starting, stopping, muting
 * (#708, epic #703 decision 8) and seeking it (windsor#102), plus where it is
 * — the position queries the console's playheads read (#619 decision 2,
 * windsor#97). Before a player is loaded, `start` and `seek` do nothing and
 * the queries answer "nothing"; stop and mute still act on the transport.
 */
import type { ArrangementPlayer, ArrangementReadout, RegionStep } from '../song/arrangementPlayer';
import type { Scheduler } from '../sequencing/scheduler';

/** The arrangement's state plus the transport's. */
export interface PlaybackReadout extends ArrangementReadout {
  muted: boolean;
  running: boolean;
}

export class MusicPlayback {
  private playerValue: ArrangementPlayer | null = null;
  private muted = false;

  /** `scheduler` is the transport the player is bound to; `context` is the clock a release is timed on. */
  constructor(
    private readonly scheduler: Scheduler,
    private readonly context: BaseAudioContext,
  ) {}

  /** The loaded player, or null before `load`. */
  get player(): ArrangementPlayer | null {
    return this.playerValue;
  }

  /** Take the player `initMusic` built; from here on the transport controls drive it. */
  load(player: ArrangementPlayer): void {
    this.playerValue = player;
  }

  /** Start (or resume) the transport. A no-op while muted or before a player is loaded. */
  start(): void {
    if (!this.playerValue || this.muted) return;
    this.scheduler.start(this.scheduler.transport.currentTick);
  }

  get running(): boolean {
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
      this.playerValue?.releaseAll(this.context.currentTime);
    } else {
      this.start();
    }
  }

  /**
   * ■ (#708, epic #703 decision 8): stop the transport, release everything
   * held, then rewind to tick 0 with every part's region state cleared — the
   * next `start` plays the document from bar 1 exactly as a fresh system
   * would. The mute flag is untouched.
   */
  stop(): void {
    this.scheduler.stop();
    this.playerValue?.releaseAll(this.context.currentTime);
    this.scheduler.reset();
    this.playerValue?.reset();
  }

  /**
   * Move a stopped or paused transport to `tick` (windsor#102): the
   * scheduler's `seek`, then release everything held and clear every part's
   * region state, as ■ does, so the next `start` enters whatever region holds
   * `tick` fresh. The mute flag is untouched, so ▶ after a pause resumes from
   * here. Refused (false, nothing changed) while running, before a player is
   * loaded, or for a tick the scheduler refuses.
   */
  seek(tick: number): boolean {
    if (!this.playerValue || !this.scheduler.seek(tick)) return false;
    this.playerValue.releaseAll(this.context.currentTime);
    this.playerValue.reset();
    return true;
  }

  /** The player's readout, or the transport's tempo and no key before one is loaded. */
  readout(): PlaybackReadout {
    const base: ArrangementReadout = this.playerValue?.readout() ?? {
      bpm: this.scheduler.bpm,
      root: NaN,
      scale: [],
      counters: {},
    };
    return { ...base, muted: this.muted, running: this.scheduler.isRunning };
  }

  /** A Euclidean part's sounding figure on `slot`, region `regionIndex`'s or the part's own; null otherwise. */
  capturePattern(slot: number, regionIndex?: number): readonly boolean[] | null {
    return this.playerValue?.capturePattern(slot, regionIndex) ?? null;
  }

  /** The step the part on `slot` is sounding at transport tick `tick`, or -1. */
  stepAt(slot: number, tick: number): number {
    return this.playerValue?.stepAt(slot, tick) ?? -1;
  }

  /** Where region `region` of the part on `slot` is at transport tick `tick`, sounding or not. */
  regionStepAt(slot: number, region: number, tick: number): RegionStep | null {
    return this.playerValue?.regionStepAt(slot, region, tick) ?? null;
  }

  /** Stop the transport, dispose the player and clear the mute flag. */
  dispose(): void {
    this.scheduler.stop();
    this.playerValue?.dispose();
    this.playerValue = null;
    this.muted = false;
  }
}
