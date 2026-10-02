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
 *   divisor, the bar the song's meter's (windsor#429), the clock's `time`
 *   and `seconds` untouched, plus the chord the
 *   harmony timeline holds at the transport tick (`chordAt`) — so a chord
 *   change never restarts anything and a hit voices whatever is current.
 *
 * One gate serves one part: its entry tracking is per gate, not per
 * subscription. Since windsor#74 a part may hold one generator per region
 * (each region playing its own pattern), all behind the part's one gate:
 * a subscription may name the regions it plays (`accepts`), and a tick is
 * forwarded only to the subscriptions that accept the live region. The gate
 * holds one subscription on the transport however many it serves, so each
 * tick reads the regions once and the entry and leave hooks fire once,
 * before any subscriber hears the tick. `reconfigure` swaps regions, song
 * length, harmony and meter live; the next tick re-evaluates. Pure: no audio
 * graph, no clock of its own.
 */
import { chordAt, type Harmony, type HarmonyChord } from '../harmony/harmonyTimeline';
import { regionPhase, regionState, type Region, type RegionState } from './regionClock';
import { ticksPerBar } from './meter';
import type { Meter } from './meterTables';
import type { TickEvent, TickSource, Unsubscribe } from './scheduler';

/** A transport tick as a part's generator sees it: local position plus the current chord. */
export interface PartTickEvent extends TickEvent {
  /** The chord the harmony timeline holds at this transport tick; null with no events. */
  readonly chord: HarmonyChord | null;
  /** The region the part is live in. */
  readonly regionIndex: number;
}

export type PartTickHandler = (event: PartTickEvent) => void;

/** Which regions a subscription plays, by index; a subscription without one plays them all. */
export type RegionFilter = (regionIndex: number) => boolean;

interface GateSubscriber {
  readonly divisor: number;
  readonly handler: PartTickHandler;
  readonly accepts: RegionFilter | null;
}

/** What a generator attaches to. A `RegionGate` is one; a test may fake one. */
export interface PartTickSource {
  subscribe(divisor: number, handler: PartTickHandler): Unsubscribe;
}

export interface RegionGateConfig {
  readonly regions: readonly Region[];
  readonly songTicks: number;
  readonly harmony: Harmony;
  /** The song's meter (windsor#429): the bar `bar` and `tickInBar` count. 4/4 when absent. */
  readonly meter?: Meter | undefined;
}

export interface RegionGateHooks {
  /** The playhead entered `regionIndex` from outside: the generator restarts its stream. */
  onEnter?(regionIndex: number, entryTick: number): void;
  /** The part stopped being live, or re-entered: whatever it holds is released on this tick. */
  onLeave?(tick: number, time: number): void;
}

export class RegionGate implements PartTickSource {
  private config: RegionGateConfig;
  /** The meter's bar in ticks, read once per config rather than per tick. */
  private barLength: number;
  /** The entry tick of the region the last forwarded tick was in; null while silent. */
  private entryTick: number | null = null;
  /** Replaced, never mutated, on (un)subscribe, so a tick in flight walks a stable list. */
  private subscribers: readonly GateSubscriber[] = [];
  /** The gate's one subscription on the transport, held while anyone subscribes. */
  private unsubscribeSource: Unsubscribe | null = null;

  constructor(
    private readonly source: TickSource,
    config: RegionGateConfig,
    private readonly hooks: RegionGateHooks = {},
  ) {
    this.config = config;
    this.barLength = ticksPerBar(config.meter);
  }

  /** Regions, song length, harmony and meter take effect on the next tick; nothing restarts. */
  reconfigure(config: RegionGateConfig): void {
    this.config = config;
    this.barLength = ticksPerBar(config.meter);
  }

  /** Forget the region the last tick was in (#708's ■): the next live tick is an entry, so the stream restarts. */
  reset(): void {
    this.entryTick = null;
  }

  /** The part's state at a transport tick — what `ArrangementPlayer.stepAt` folds a playhead through. */
  stateAt(tick: number): RegionState {
    return regionState(this.config.regions, this.config.songTicks, tick);
  }

  /** Region `index`'s own local tick at a transport tick, live or not (`regionPhase`, windsor#97). */
  phaseAt(index: number, tick: number): number | null {
    return regionPhase(this.config.regions, this.config.songTicks, index, tick);
  }

  /** The chord at a transport tick, for a caller auditioning the current harmony. */
  chordAt(tick: number): HarmonyChord | null {
    return chordAt(this.config.harmony, this.config.songTicks, tick);
  }

  /**
   * Hear the part's live ticks at `divisor`, or, with `accepts`, only the
   * ticks of the regions it accepts (windsor#74: one generator per region).
   */
  subscribe(
    divisor: number,
    handler: PartTickHandler,
    accepts: RegionFilter | null = null,
  ): Unsubscribe {
    if (!Number.isInteger(divisor) || divisor < 1) {
      throw new RangeError(`divisor must be a positive integer of ticks, got ${divisor}`);
    }
    const entry: GateSubscriber = { divisor, handler, accepts };
    this.subscribers = [...this.subscribers, entry];
    this.unsubscribeSource ??= this.source.subscribe(1, (event) => this.forward(event));
    return () => {
      this.subscribers = this.subscribers.filter((s) => s !== entry);
      if (this.subscribers.length > 0 || !this.unsubscribeSource) return;
      this.unsubscribeSource();
      this.unsubscribeSource = null;
    };
  }

  private forward(event: TickEvent): void {
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
    const { localTick, index } = state;
    const subscribers = this.subscribers;
    for (let i = 0; i < subscribers.length; i++) {
      const { divisor, handler, accepts } = subscribers[i] as GateSubscriber;
      if (localTick % divisor !== 0 || (accepts !== null && !accepts(index))) continue;
      handler({
        ...event,
        tick: localTick,
        step: localTick / divisor,
        bar: Math.floor(localTick / this.barLength),
        tickInBar: localTick % this.barLength,
        chord: this.chordAt(event.tick),
        regionIndex: index,
      });
    }
  }
}
