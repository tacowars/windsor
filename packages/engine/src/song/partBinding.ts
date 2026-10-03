/**
 * One part's generators behind its region gate (windsor#74, epic windsor#70;
 * record `2026-09-29-each-region-plays-its-own-pattern`).
 *
 * Every region plays `regionPattern(part, i)`. The regions without a pattern
 * of their own share one generator built from `part.sequencer`, the base:
 * exactly the one generator a part had before region patterns, so a song
 * without them plays as it did. Each region with its own pattern has its
 * own generator. All of them subscribe to the part's one `RegionGate`, each
 * accepting only the regions it plays, so a tick reaches the live region's
 * generator alone. The gate's entry hook makes that generator the active
 * one and restarts its stream (`enter(regionIndex)`); its leave hook
 * releases what the active one holds, on the tick the region ends.
 *
 * A live edit (`plan`) maps the new regions onto the generators running,
 * matching a region by its start (regions never overlap, so a start names
 * one). A generator whose `generatorSig` still holds is kept and
 * reconfigured live; any other is built afresh. The live region keeps the
 * generator it is sounding through when it can, so the first edit that
 * gives a playing region its own pattern hands it the running generator
 * rather than cutting it. When it cannot (a divisor or kind change), or when
 * nothing is kept at all (a seed edit), the part restarts: the player cuts
 * it and the gate re-enters, as a rebuild always did. A generator that is not
 * live is replaced silently: the gate enters it before it plays, and `enter`
 * mints its stream afresh.
 *
 * The active generator is released by whatever ends its region, never by
 * the edit that drops it: an edit that removes or moves the sounding region
 * without a restart unsubscribes its generator but keeps it active, so the
 * next tick's leave releases it on that tick, as a region end does, and
 * every other release (a loop's jump back, a stop, a removal) reaches it
 * too until one of them has let it go.
 */
import type { MusicPart, SequencerSpec } from './arrangement';
import { Arpeggiator } from '../sequencing/arpeggiator';
import { EuclideanSequencer, type OnsetEvent } from '../sequencing/euclideanSequencer';
import { FigureSequencer } from '../sequencing/figureSequencer';
import { ticksPerBar } from '../sequencing/meter';
import type { NoteEvent } from '../sequencing/noteEvent';
import { RegionGate, type PartTickSource, type RegionGateConfig } from '../sequencing/regionGate';
import type { ScaleSampler } from '../sequencing/scaleSampler';
import type { TickSource, Unsubscribe } from '../sequencing/scheduler';
import {
  buildGenerator,
  buildsNoGenerator,
  generatorSig,
  generatorStepAt,
  isPitched,
  liveReconfiguration,
  type Generator,
} from './partGenerators';
import { regionPattern } from './regionPattern';

/** Where a part's generators send what they play. */
export interface PartOutput {
  /** A pitched generator's note-on or note-off. */
  note(event: NoteEvent): void;
  /** A Euclidean onset, with the spec that played it (its `note` and `hold`). */
  onset(event: OnsetEvent, spec: SequencerSpec): void;
}

/**
 * Where one region's pattern is at a transport tick (windsor#97): the step
 * its generator plays there, and whether the playhead is in that region.
 * Out of it, `step` is the step the pattern would be on had it run on from
 * the region's last start (`regionPhase`).
 */
export interface RegionStep {
  readonly step: number;
  /** True while the tick is inside the region: `step` is then what `stepAt` answers. */
  readonly live: boolean;
  /**
   * A Euclidean part's local step (windsor#355): the steps its trigger has
   * counted since the region's entry, at the region's phase while it is not
   * sounding. It is the lanes' clock, so a lane of length `L` is on
   * `laneStep(localStep, L)` and the card draws each lane's playhead at its
   * own length; `step` is `localStep mod steps`. Absent for every other kind.
   */
  readonly localStep?: number;
}

/** What `PartBinding.plan` hands the player: validated and built, committed later. */
export interface BindingChange {
  /**
   * The live region's generator, or every generator, is replaced: the
   * player cuts what the part sounds, and the commit makes the next live
   * tick an entry.
   */
  readonly restart: boolean;
  commit(): void;
}

/** One generator and the spec it plays: the base, or one region's own pattern. */
interface Bound {
  readonly generator: Generator;
  spec: SequencerSpec;
  unsubscribe: Unsubscribe | null;
}

/**
 * True when region `index` plays a pattern of its own: it holds one of the
 * part's kind, the rule `regionPattern` falls back on. Read from the
 * region, never by comparing what `regionPattern` returns with
 * `part.sequencer`: a chord pattern (no seed) comes back as itself, and a
 * document may hold the very object the sequencer is.
 */
const ownsPattern = (part: MusicPart, index: number): boolean =>
  part.regions[index]?.pattern?.kind === part.sequencer.kind;

export class PartBinding {
  private readonly gate: RegionGate;
  /** What every region without its own pattern plays: `part.sequencer`'s generator. */
  private base: Bound;
  /** Region index → the generator it plays, the base or its own. */
  private byRegion: readonly Bound[];
  /** Each region's start, to find a region again across an edit. */
  private starts: readonly number[];
  /** The generator the gate last entered, which a region end releases; null while silent. */
  private active: Bound | null = null;
  private activeIndex: number | null = null;
  /** The song meter's bar in ticks, which a Figure counts its schedule and drift in (windsor#486). */
  private barTicks: number;

  /** The part's binding, or null for a kind that builds no generator. Builds and validates; subscribes nothing until `attach`. */
  static create(
    source: TickSource,
    part: MusicPart,
    config: RegionGateConfig,
    sampler: ScaleSampler,
    output: PartOutput,
  ): PartBinding | null {
    return buildsNoGenerator(part.sequencer.kind)
      ? null
      : new PartBinding(source, part, config, sampler, output);
  }

  private constructor(
    source: TickSource,
    part: MusicPart,
    config: RegionGateConfig,
    sampler: ScaleSampler,
    private readonly output: PartOutput,
  ) {
    this.barTicks = ticksPerBar(config.meter);
    this.gate = new RegionGate(source, config, {
      onEnter: (index) => this.enter(index),
      onLeave: (tick, time) => this.leave(tick, time),
    });
    const base = this.build(part.sequencer, sampler);
    this.base = base;
    this.byRegion = part.regions.map((_, i) =>
      ownsPattern(part, i) ? this.build(regionPattern(part, i), sampler) : base,
    );
    this.starts = part.regions.map((region) => region.start);
  }

  /** Subscribe every generator to the gate. */
  attach(): void {
    for (const bound of this.bounds()) this.subscribe(bound);
  }

  /** Unsubscribe every generator; the part's gate leaves the transport with the last one. */
  dispose(): void {
    for (const bound of this.bounds()) {
      bound.unsubscribe?.();
      bound.unsubscribe = null;
    }
  }

  /** Regions, song length, harmony and meter take effect on the next tick; a Figure's bar length at once. */
  reconfigureGate(config: RegionGateConfig): void {
    this.barTicks = ticksPerBar(config.meter);
    this.gate.reconfigure(config);
    for (const { generator } of this.bounds()) {
      if (generator instanceof FigureSequencer) generator.setBarTicks(this.barTicks);
    }
  }

  /**
   * Release what every pitched generator holds: a stop, a teardown, a
   * removal, a loop's jump. The active generator is among them even when an
   * edit has dropped it, so its notes never outlive their region.
   */
  release(tick: number, time: number): void {
    const holders = this.bounds();
    if (this.active) holders.add(this.active);
    for (const { generator } of holders) {
      if (isPitched(generator)) generator.release(tick, time);
    }
  }

  /** Forget the live region, so the next live tick is an entry (#708's ■). */
  reset(): void {
    this.gate.reset();
    this.active = null;
    this.activeIndex = null;
  }

  /** The loop's jump back (windsor#15): what is held is released on the new tick, which is an entry. */
  jump(tick: number, time: number): void {
    this.release(tick, time);
    this.reset();
  }

  /**
   * The step the part sounds at transport tick `tick`: the generator of the
   * region that tick falls in answers, at its own divisor; -1 outside the
   * regions or with nothing to show (#619 decision 2).
   */
  stepAt(tick: number): number {
    const state = this.gate.stateAt(tick);
    if (!state.live) return -1;
    const bound = this.byRegion[state.index] ?? this.base;
    return generatorStepAt(bound.generator, state.localTick);
  }

  /**
   * Region `index`'s step at transport tick `tick`, sounding or not: its
   * own generator at the region's phase (`RegionGate.phaseAt`), at its own
   * divisor. Inside the region this is `stepAt`'s answer; null for an index
   * naming no region.
   */
  regionStepAt(index: number, tick: number): RegionStep | null {
    const bound = this.byRegion[index];
    const local = this.gate.phaseAt(index, tick);
    if (!bound || local === null) return null;
    const state = this.gate.stateAt(tick);
    const live = state.live && state.index === index;
    const { generator } = bound;
    const step = live
      ? generatorStepAt(generator, local)
      : this.ghostStepAt(generator, index, local);
    if (!(generator instanceof EuclideanSequencer)) return { step, live };
    return { step, live, localStep: Math.floor(local / generator.config.divisor) };
  }

  /**
   * Region `index`'s step at its phase `local` while it isn't sounding. An
   * arp's `stepAt` reads the list its last onset walked, which is none
   * before the region first plays and otherwise what another region or an
   * earlier visit left, so its ghost counts afresh from an entry into the
   * region's first chord (windsor#137), the chord the Arp card's strip
   * shows there. Every other generator's step needs no onset.
   */
  private ghostStepAt(generator: Generator, index: number, local: number): number {
    if (!(generator instanceof Arpeggiator)) return generatorStepAt(generator, local);
    const chord = this.gate.chordAt(this.starts[index] ?? 0);
    return generator.entryStepAt(Math.floor(local / generator.config.divisor), chord);
  }

  /**
   * The Euclidean figure region `regionIndex` sounds (the base's with no
   * index, or an index naming no region); null for another kind.
   */
  capture(regionIndex?: number): readonly boolean[] | null {
    const bound = (regionIndex === undefined ? null : this.byRegion[regionIndex]) ?? this.base;
    const { generator } = bound;
    return generator instanceof EuclideanSequencer ? [...generator.currentPattern] : null;
  }

  /**
   * The same part after a live edit, its kind unchanged: every generator
   * that can be kept is reconfigured, every other built, all validated
   * here, so a bad edit throws before anything commits.
   */
  plan(next: MusicPart, sampler: ScaleSampler): BindingChange {
    const live = this.liveIndexIn(next);
    const taken = new Set<Bound>();
    const kept: Array<() => void> = [];
    const built: Bound[] = [];
    const take = (candidate: Bound | null, spec: SequencerSpec): Bound => {
      if (candidate && !taken.has(candidate)) {
        taken.add(candidate);
        if (generatorSig(candidate.spec) === generatorSig(spec)) {
          const reconfigure = liveReconfiguration(candidate.generator, spec, sampler);
          kept.push(() => {
            candidate.spec = spec;
            reconfigure?.();
          });
          return candidate;
        }
      }
      const bound = this.build(spec, sampler);
      built.push(bound);
      return bound;
    };

    // The live region first: it keeps the generator it is sounding through if it can.
    const liveBound = live === null ? null : take(this.active, regionPattern(next, live));
    const liveOwns = live !== null && ownsPattern(next, live);
    const base = liveBound && !liveOwns ? liveBound : take(this.base, next.sequencer);
    const byRegion = next.regions.map((region, i) => {
      if (i === live && liveBound) return liveBound;
      return ownsPattern(next, i) ? take(this.ownAt(region.start), regionPattern(next, i)) : base;
    });

    const restart = (liveBound !== null && liveBound !== this.active) || kept.length === 0;
    const commit = (): void => {
      const before = this.bounds();
      this.base = base;
      this.byRegion = byRegion;
      this.starts = next.regions.map((region) => region.start);
      const after = this.bounds();
      // Subscribe the new before dropping the old, so the gate keeps its place on the transport.
      for (const bound of built) this.subscribe(bound);
      for (const bound of before) {
        if (after.has(bound)) continue;
        bound.unsubscribe?.();
        bound.unsubscribe = null;
      }
      for (const reconfigure of kept) reconfigure();
      // A restart is cut by the player. Otherwise a dropped active generator
      // stays active, unsubscribed, until a leave or a release lets it go.
      if (restart) this.reset();
      else this.activeIndex = live;
    };
    return { restart, commit };
  }

  /** The generator region `index` plays, which the gate restarts on entry. */
  private enter(index: number): void {
    const bound = this.byRegion[index] ?? this.base;
    this.active = bound;
    this.activeIndex = index;
    bound.generator.enter(index);
  }

  /** The live region ended, or is re-entered: what its generator holds is released on this tick. */
  private leave(tick: number, time: number): void {
    const bound = this.active;
    this.active = null;
    this.activeIndex = null;
    if (bound && isPitched(bound.generator)) bound.generator.release(tick, time);
  }

  /** The live region's index in the edited regions, found by its start; null when silent or gone. */
  private liveIndexIn(next: MusicPart): number | null {
    if (this.activeIndex === null || !this.active) return null;
    const start = this.starts[this.activeIndex];
    const index = next.regions.findIndex((region) => region.start === start);
    return index >= 0 ? index : null;
  }

  /** The own generator of the region that started on `start` before the edit, if it had one. */
  private ownAt(start: number): Bound | null {
    const bound = this.byRegion[this.starts.indexOf(start)];
    return bound && bound !== this.base ? bound : null;
  }

  /** Every distinct generator the part holds: the base and each region's own. */
  private bounds(): Set<Bound> {
    return new Set([this.base, ...this.byRegion]);
  }

  private build(spec: SequencerSpec, sampler: ScaleSampler): Bound {
    const generator = buildGenerator(spec, sampler, this.barTicks);
    if (!generator) throw new Error(`a ${spec.kind} spec builds no generator`);
    const bound: Bound = { generator, spec, unsubscribe: null };
    if (generator instanceof EuclideanSequencer) {
      generator.onOnset = (event): void => this.output.onset(event, bound.spec);
    } else {
      generator.onNote = (event): void => this.output.note(event);
    }
    return bound;
  }

  /** The generator hears the gate's ticks only in the regions it plays. */
  private subscribe(bound: Bound): void {
    const source: PartTickSource = {
      subscribe: (divisor, handler) =>
        this.gate.subscribe(divisor, handler, (index) => this.byRegion[index] === bound),
    };
    bound.unsubscribe = bound.generator.attach(source);
  }
}
