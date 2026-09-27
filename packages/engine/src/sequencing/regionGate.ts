/**
 * The region gate (#705): the tick source one part's sequencer subscribes to.
 *
 * It sits between the transport and the generator and applies the restart
 * rule (`regionClock.ts`, epic #703 decision 2) so the generator never reads
 * the transport tick, the regions or the seed directly:
 *
 * - a tick outside the part's regions is swallowed; on the first such tick
 *   after a live one `onLeave` fires, which is where the player releases the
 *   part's held notes — a region's end is a note-off on that tick;
 * - a tick that enters a region from outside (a different `entryTick` than
 *   the last live tick's) fires `onLeave` for what was held, then `onEnter`
 *   with the region's index — the generator mints its stream from
 *   `hashSeed(seed, index)` there; the single ∞ region enters once, at the
 *   first live tick, and never again;
 * - a live tick is forwarded with `tick`, `step`, `bar` and `tickInBar`
 *   rebased onto `localTick` (ticks since the entry) at the subscriber's
 *   divisor, the clock's `time` and `seconds` untouched, plus the chord the
 *   harmony timeline holds at the transport tick (`chordAt`) — so a chord
 *   change never restarts anything and a hit voices whatever is current.
 *
 * One gate serves one generator: its entry tracking is per gate, not per
 * subscription. `reconfigure` swaps regions, song length and harmony live;
 * the next tick re-evaluates. Pure: no audio graph, no clock of its own.
 */
import { chordAt, type Harmony, type HarmonyChord } from '../harmony/harmonyTimeline';
import { regionState, type Region, type RegionState } from './regionClock';
import { TICKS_PER_BAR, type TickEvent, type TickSource, type Unsubscribe } from './scheduler';

/** A transport tick as a part's generator sees it: local position plus the current chord. */
export interface PartTickEvent extends TickEvent {
  /** The chord the harmony timeline holds at this transport tick; null with no events. */
  readonly chord: HarmonyChord | null;
  /** The region the part is live in. */
  readonly regionIndex: number;
}

export type PartTickHandler = (event: PartTickEvent) => void;

/** What a generator attaches to. A `RegionGate` is one; a test may fake one. */
export interface PartTickSource {
  subscribe(divisor: number, handler: PartTickHandler): Unsubscribe;
}

export interface RegionGateConfig {
  readonly regions: readonly Region[];
  readonly songTicks: number;
  readonly harmony: Harmony;
}

export interface RegionGateHooks {
  /** The playhead entered `regionIndex` from outside: the generator restarts its stream. */
  onEnter?(regionIndex: number, entryTick: number): void;
  /** The part stopped being live, or re-entered: whatever it holds is released on this tick. */
  onLeave?(tick: number, time: number): void;
}

export class RegionGate implements PartTickSource {
  private config: RegionGateConfig;
  /** The entry tick of the region the last forwarded tick was in; null while silent. */
  private entryTick: number | null = null;

  constructor(
    private readonly source: TickSource,
    config: RegionGateConfig,
    private readonly hooks: RegionGateHooks = {},
  ) {
    this.config = config;
  }

  /** Regions, song length and harmony take effect on the next tick; nothing restarts. */
  reconfigure(config: RegionGateConfig): void {
    this.config = config;
  }

  /** Forget the region the last tick was in (#708's ■): the next live tick is an entry, so the stream restarts. */
  reset(): void {
    this.entryTick = null;
  }

  /** The part's state at a transport tick — what `ArrangementPlayer.stepAt` folds a playhead through. */
  stateAt(tick: number): RegionState {
    return regionState(this.config.regions, this.config.songTicks, tick);
  }

  /** The chord at a transport tick, for a caller auditioning the current harmony. */
  chordAt(tick: number): HarmonyChord | null {
    return chordAt(this.config.harmony, this.config.songTicks, tick);
  }

  subscribe(divisor: number, handler: PartTickHandler): Unsubscribe {
    if (!Number.isInteger(divisor) || divisor < 1) {
      throw new RangeError(`divisor must be a positive integer of ticks, got ${divisor}`);
    }
    return this.source.subscribe(1, (event) => this.forward(event, divisor, handler));
  }

  private forward(event: TickEvent, divisor: number, handler: PartTickHandler): void {
    const state = this.stateAt(event.tick);
    if (!state.live) {
      if (this.entryTick !== null) {
        this.entryTick = null;
        this.hooks.onLeave?.(event.tick, event.time);
      }
      return;
    }
    if (state.entryTick !== this.entryTick) {
      if (this.entryTick !== null) this.hooks.onLeave?.(event.tick, event.time);
      this.entryTick = state.entryTick;
      this.hooks.onEnter?.(state.index, state.entryTick);
    }
    const { localTick } = state;
    if (localTick % divisor !== 0) return;
    handler({
      ...event,
      tick: localTick,
      step: localTick / divisor,
      bar: Math.floor(localTick / TICKS_PER_BAR),
      tickInBar: localTick % TICKS_PER_BAR,
      chord: this.chordAt(event.tick),
      regionIndex: state.index,
    });
  }
}
