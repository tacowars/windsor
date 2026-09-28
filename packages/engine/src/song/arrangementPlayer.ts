/**
 * The binding layer (issue #69): generators emit onsets and note events on the
 * tick grid; this maps them onto parts. It is the seam of record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §2 — the sequencers
 * know nothing about audio, and everything that does know lives here.
 *
 *   transport ─▶ RegionGate ─▶ EuclideanSequencer ─ onset ─▶ part.trigger
 *                          ─▶ GridSequencer      ─ noteOn/noteOff ─▶ part.noteOn / noteOffByNote
 *                          ─▶ ChordSequencer     ─ noteOn/noteOff ─▶ part.noteOn / noteOffByNote
 *                          ─▶ Arp / Bass (#706, #707)
 *
 * Since #705 every part's generator sits behind its own `RegionGate`
 * (`sequencing/regionGate.ts`): the gate applies the part's `regions` to the
 * transport tick, hands the generator its local position and the harmony
 * timeline's current chord, restarts its stream on a region entry and, on
 * the tick a region ends, releases what the part holds through
 * `release()`. The player never reads a tick itself; `stepAt` folds the
 * console's playhead through the same gate (#619's one position rule).
 *
 * Since #597 any part carries any kind, or none: a part is found by its
 * slot, a `none` part builds no generator and is never touched here beyond
 * `releaseAll`. Since #629 a part is added and removed live too: a whole part
 * at a free slot asks the `PartHost` for its `AudioPart` and joins the
 * transport where it is, `null` at a slot releases that part and hands it
 * back, and no other slot is touched by either. A fragment naming an absent
 * slot is still ignored and reported.
 *
 * `apply()` is the live tuning path (refinement decision 3): a deep partial is
 * merged over the current arrangement, validated, and committed — bpm straight
 * to the transport, a preset change via `setPatch`, and only the generators
 * whose kind, divisor or seed changed are rebuilt (`generatorSig`); a
 * `regions`, `transport.bars` or harmony edit reaches every gate live and
 * rebuilds nothing, and a key change re-pitches through the sampler. A
 * merged arrangement that fails validation changes nothing and is reported,
 * never half-applied.
 *
 * The loop (windsor#15) is the clock's: the player hands it the song's
 * `TickLoop` at build and on every partial, and the counter jumps back from
 * the loop's end to its start. The player follows the tick, and on any jump
 * treats the new tick as every part's entry, just as the song's end is for a
 * region: held notes are released on that tick and each gate restarts its
 * stream. A loop over the whole song jumps nothing and is today's wrap.
 */
import type { Arrangement, ArrangementPartial, MusicPart } from './arrangement';
import { mergeArrangement } from './arrangement';
import { EuclideanSequencer, type OnsetEvent } from '../sequencing/euclideanSequencer';
import type { NoteEvent } from '../sequencing/noteEvent';
import type { PresetTable } from './arrangementValidate';
import {
  lookupPreset,
  partLabel,
  presetFor,
  validateArrangement,
  validatePartialSlots,
} from './arrangementValidate';
import type { Patch } from '../patch/patch';
import { clonePatch, makePatch, mergePatch, type PartialPatch } from '../patch/patch';
import { ScaleSampler } from '../sequencing/scaleSampler';
import type { TickEvent, TickLoop, TickSource, Unsubscribe } from '../sequencing/scheduler';
import { TICKS_PER_BAR, isLoopJump } from '../sequencing/scheduler';
import { STRAIGHT_SWING, type Swing } from '../sequencing/swingTables';
import { playableSwing } from '../sequencing/swing';
import { RegionGate, type RegionGateConfig } from '../sequencing/regionGate';
import type { NoteExtras } from '../synth/audioPart';
import { fitTimelines } from './timelineNormalise';
import { tickLoopOf, withFittedLoop } from './songLoop';
import {
  buildGenerator,
  generatorSig,
  generatorStepAt,
  isPitched,
  liveReconfiguration,
  type Generator,
} from './partGenerators';

/** What a binding needs from a part. `AudioPart` satisfies it structurally. */
export interface PlayablePart {
  noteOn(note: number, velocity?: number, time?: number, extras?: NoteExtras): number;
  noteOffByNote(note: number, time?: number): void;
  trigger(note: number, velocity?: number, duration?: number, time?: number): number;
  setPatch(patch: Patch): void;
  allNotesOff(): void;
}

/**
 * Where the player finds a slot's part, and — for a live add or removal
 * (#629) — who builds and disposes one. A `ReadonlyMap<number, PlayablePart>`
 * satisfies it as a fixed roster: with no `add`, a partial that adds a part
 * is refused; with no `remove`, a removed part is released and detached and
 * the host keeps whatever it holds.
 */
export interface PartHost {
  get(slot: number): PlayablePart | undefined;
  /** Create the part on `part.slot` playing `patch`; called after the plan validated the whole partial. */
  add?(part: MusicPart, patch: Patch): PlayablePart;
  /** Dispose the part on `slot` after the player has released and detached it. */
  remove?(slot: number): void;
}

/** What the player needs from the transport. `Scheduler` and `TickTransport` both satisfy it. */
export interface MusicTransport extends TickSource {
  bpm: number;
  /** The song's swing (windsor#14). Optional: a transport without it plays straight. */
  swing?: Swing;
  /** The loop the clock wraps (windsor#15). Optional: a transport without it plays through. */
  loop?: TickLoop | null;
}

/** Fired once per part, on its first note — the "it is audible" console evidence. */
export type MusicEventHandler = (part: MusicPart, tick: number) => void;

export interface ApplyResult {
  /** False when validation refused the merged arrangement; nothing changed. */
  ok: boolean;
  /** Paths in the partial that named no arrangement field; ignored (decision 3). */
  ignored: string[];
  error?: string;
}

export interface ArrangementReadout {
  bpm: number;
  root: number;
  scale: string | readonly number[];
  /** Note-ons since construction, by slot. Never reset by `apply`. */
  counters: Record<string, number>;
}

/** A part's generator behind its region gate. */
interface Bound {
  generator: Generator;
  gate: RegionGate;
}

interface Built {
  sampler: ScaleSampler;
  /** By slot; `null` for a `none` part. */
  bound: ReadonlyMap<number, Bound | null>;
}

interface Plan {
  built: Built;
  rebuilt: ReadonlySet<number>;
  /** Parts kept live: each entry applies the validated config to its generator after the commit. */
  reconfigured: ReadonlyArray<() => void>;
  patchChanges: ReadonlyArray<readonly [number, Patch]>;
  /** Parts on slots the arrangement did not hold (#629), with the patch each starts on. */
  added: ReadonlyArray<readonly [MusicPart, Patch]>;
  /** Slots that left the arrangement (#629): released, detached, handed back to the host. */
  removed: ReadonlySet<number>;
  /** The preset table after the partial's `patches`, validated against. */
  presets: Record<string, Patch>;
}

/** A `patches` partial merged over a copy of the table; junk entries reported by path. */
function stagePatches(
  presets: Readonly<Record<string, Patch>>,
  patches: Readonly<Record<string, unknown>>,
  ignored: string[],
): Record<string, Patch> {
  const staged = { ...presets };
  for (const [name, raw] of Object.entries(patches)) {
    if (raw === undefined) continue;
    if (raw === null) {
      // A removal (#629): the id leaves the table; a part still playing it
      // fails validation, so nothing is dropped from under a part.
      if (name in staged) delete staged[name];
      else ignored.push(`patches.${name}`);
      continue;
    }
    if (typeof raw !== 'object' || Array.isArray(raw)) {
      ignored.push(`patches.${name}`);
      continue;
    }
    staged[name] = mergePatch(
      lookupPreset(presets, name) ?? makePatch({ name }),
      raw as PartialPatch,
    );
  }
  return staged;
}

const sig = (value: unknown): string => JSON.stringify(value) ?? 'absent';

/**
 * The arrangement with its swing written out (windsor#14): a document may
 * leave it absent (straight), but the live copy carries it so a partial like
 * `{ transport: { swing: { amount: 60 } } }` has a field to merge into.
 */
const withSwing = (arrangement: Arrangement): Arrangement =>
  arrangement.transport.swing
    ? arrangement
    : { ...arrangement, transport: { ...arrangement.transport, swing: STRAIGHT_SWING } };

/** The song's length in ticks, from its explicit `transport.bars` (decision 5). */
export const songTicksOf = (arrangement: Arrangement): number =>
  arrangement.transport.bars * TICKS_PER_BAR;

/** What a part's gate reads: its regions over the song's length and harmony. */
function gateConfig(arrangement: Arrangement, part: MusicPart): RegionGateConfig {
  return {
    regions: part.regions,
    songTicks: songTicksOf(arrangement),
    harmony: arrangement.harmony,
  };
}

export class ArrangementPlayer {
  private current: Arrangement;
  private bySlot = new Map<number, MusicPart>();
  private built: Built;
  private readonly subs = new Map<number, Unsubscribe>();
  private readonly counters = new Map<number, number>();
  private readonly announced = new Set<number>();
  /** The last transport tick seen, to spot the loop's jump back; null after a rewind. */
  private lastTick: number | null = null;
  private readonly unfollow: Unsubscribe;
  /**
   * The table preset names resolve against — the document's own patches
   * (#562), never the library; a `patches` partial edits it live.
   */
  private presets: Record<string, Patch>;

  constructor(
    private readonly transport: MusicTransport,
    private readonly parts: PartHost,
    arrangement: Arrangement,
    presets: PresetTable,
    private readonly onEvent?: MusicEventHandler,
  ) {
    this.presets = { ...presets };
    this.current = withFittedLoop(withSwing(structuredClone(arrangement)));
    validateArrangement(this.current, this.presets);
    this.index();
    this.built = this.buildAll(this.current);
    this.transport.bpm = this.current.transport.bpm;
    this.transport.swing = playableSwing(this.current.transport.swing);
    this.transport.loop = tickLoopOf(this.current.transport);
    // Subscribed before any gate, so a jump is seen before a part hears the tick.
    this.unfollow = this.transport.subscribe(1, (event) => this.follow(event));
    this.attach(new Set(this.current.parts.map((part) => part.slot)));
  }

  /** The live arrangement, as data — what `readout` and #70's console read. */
  get arrangement(): Arrangement {
    return structuredClone(this.current);
  }

  readout(): ArrangementReadout {
    const { root, scale } = this.current.harmony;
    const counters: Record<string, number> = {};
    for (const { slot } of this.current.parts) counters[slot] = this.counters.get(slot) ?? 0;
    return {
      bpm: this.transport.bpm,
      root,
      scale: typeof scale === 'string' ? scale : [...scale],
      counters,
    };
  }

  /**
   * A Euclidean part's sounding figure as a literal array (issue #70, record
   * §6) — what the console's click-to-toggle freezes into the sequencer's
   * `pattern`. `null` for any other kind or an absent slot.
   */
  capturePattern(slot: number): readonly boolean[] | null {
    const generator = this.built.bound.get(slot)?.generator ?? null;
    return generator instanceof EuclideanSequencer ? [...generator.currentPattern] : null;
  }

  /**
   * The step the part on `slot` is sounding at transport tick `tick`, or -1
   * when the part has no position to show — an absent slot, a `none` or
   * unbuilt part, a tick outside the part's regions, an empty Chord Player
   * (#619 decision 2). The tick goes through the part's gate first, so the
   * playhead and the performer agree on the local position (#705).
   */
  stepAt(slot: number, tick: number): number {
    const bound = this.built.bound.get(slot);
    if (!bound) return -1;
    const state = bound.gate.stateAt(tick);
    return state.live ? generatorStepAt(bound.generator, state.localTick) : -1;
  }

  /**
   * Merge a partial over the arrangement and commit it (refinement decision
   * 3). A `patches` partial (#435) is staged into the preset table first, so
   * a preset switch and the patch it names can arrive together; the
   * arrangement is validated against the staged table, and on failure
   * neither the table nor the arrangement changes.
   */
  apply(partial: ArrangementPartial, patches: Readonly<Record<string, unknown>> = {}): ApplyResult {
    // The merged timelines and loop are re-fitted to the merged length, so a
    // live `transport.bars` edit plays what its normalised document will.
    const { merged: raw, ignored } = mergeArrangement(this.current, partial);
    const merged = withFittedLoop(fitTimelines(raw));
    const staged = stagePatches(this.presets, patches, ignored);
    let plan: Plan;
    try {
      validatePartialSlots(partial);
      plan = this.plan(merged, staged);
    } catch (error) {
      return { ok: false, ignored, error: error instanceof Error ? error.message : String(error) };
    }
    this.transport.bpm = merged.transport.bpm;
    this.transport.swing = playableSwing(merged.transport.swing);
    this.transport.loop = tickLoopOf(merged.transport);
    this.presets = plan.presets;
    for (const [slot, patch] of plan.patchChanges) this.parts.get(slot)?.setPatch(patch);
    for (const slot of plan.removed) this.detach(slot);
    // Only a part that was already sounding is cut; a part just added has nothing to cut.
    for (const slot of plan.rebuilt) if (this.bySlot.has(slot)) this.parts.get(slot)?.allNotesOff();
    for (const [part, patch] of plan.added) this.parts.add?.(part, patch);
    this.built = plan.built;
    this.current = merged;
    this.index();
    this.attach(plan.rebuilt);
    for (const reconfigure of plan.reconfigured) reconfigure();
    // Regions, song length and harmony are live on every gate (#705): the next tick reads them.
    for (const part of merged.parts) {
      this.built.bound.get(part.slot)?.gate.reconfigure(gateConfig(merged, part));
    }
    return { ok: true, ignored };
  }

  /** Release everything sounding — every pitched part's held notes included. Mute and teardown call this. */
  releaseAll(time = 0): void {
    for (const bound of this.built.bound.values()) {
      if (bound && isPitched(bound.generator)) bound.generator.release(0, time);
    }
    for (const { slot } of this.current.parts) this.parts.get(slot)?.allNotesOff();
  }

  /**
   * Forget every part's region state (#708, epic #703 decision 8's ■): with
   * the transport rewound to tick 0, the next tick is an entry for every live
   * part, so each generator re-mints its stream exactly as a fresh player
   * would. Call after `releaseAll`, which clears what the generators hold.
   */
  reset(): void {
    this.lastTick = null;
    for (const bound of this.built.bound.values()) bound?.gate.reset();
  }

  dispose(): void {
    this.unfollow();
    for (const unsubscribe of this.subs.values()) unsubscribe();
    this.subs.clear();
    this.releaseAll();
  }

  /**
   * Every tick, before any gate: a tick that is the loop's jump back from the
   * last one (windsor#15). Any other discontinuity, a restart at another
   * tick, is the caller's to handle, as it was before the loop. Each pitched part releases what it
   * holds on the new tick and each gate forgets its region, so the tick is an
   * entry for every live part and the pass replays from its stream's start,
   * exactly as a region is re-entered on the song's wrap.
   */
  private follow(event: TickEvent): void {
    const last = this.lastTick;
    this.lastTick = event.tick;
    if (last === null || !isLoopJump(last, event.tick, this.transport.loop ?? null)) return;
    for (const bound of this.built.bound.values()) {
      if (bound && isPitched(bound.generator)) bound.generator.release(event.tick, event.time);
      bound?.gate.reset();
    }
  }

  /**
   * A part leaving the arrangement live (#629): its held note released, its
   * subscription and bookkeeping dropped, everything sounding cut, and the
   * part handed back to the host to dispose. Nothing else is touched.
   */
  private detach(slot: number): void {
    const generator = this.built.bound.get(slot)?.generator ?? null;
    if (isPitched(generator)) generator.release(0, 0);
    this.subs.get(slot)?.();
    this.subs.delete(slot);
    this.counters.delete(slot);
    this.announced.delete(slot);
    this.parts.get(slot)?.allNotesOff();
    this.parts.remove?.(slot);
  }

  private index(): void {
    this.bySlot = new Map(this.current.parts.map((part) => [part.slot, part]));
  }

  private buildAll(arrangement: Arrangement): Built {
    const sampler = new ScaleSampler(arrangement.harmony);
    const bound = new Map<number, Bound | null>();
    for (const part of arrangement.parts)
      bound.set(part.slot, this.build(arrangement, part, sampler));
    return { sampler, bound };
  }

  /**
   * The part's generator behind its gate: the gate restarts the generator's
   * stream on a region entry and releases its held notes on a region end —
   * the note-offs go out through the same `pitched` binding as any other.
   */
  private build(arrangement: Arrangement, part: MusicPart, sampler: ScaleSampler): Bound | null {
    const generator = buildGenerator(part, sampler);
    if (!generator) return null;
    const gate = new RegionGate(this.transport, gateConfig(arrangement, part), {
      onEnter: (regionIndex) => generator.enter(regionIndex),
      onLeave: (tick, time) => {
        if (isPitched(generator)) generator.release(tick, time);
      },
    });
    return { generator, gate };
  }

  /** Everything `apply` will change, validated and constructed before anything is touched. */
  private plan(merged: Arrangement, presets: Record<string, Patch>): Plan {
    validateArrangement(merged, presets);
    const keyChanged =
      sig([merged.harmony.root, merged.harmony.scale]) !==
      sig([this.current.harmony.root, this.current.harmony.scale]);

    // A part on a slot the arrangement lacked is built like a rebuilt one
    // (#629): its stream is the one a rebuild would have made. It needs a
    // host that can create parts.
    const added: Array<readonly [MusicPart, Patch]> = [];
    const removed = new Set<number>();
    for (const { slot } of this.current.parts) {
      if (!merged.parts.some((part) => part.slot === slot)) removed.add(slot);
    }
    const rebuilt = new Set<number>();
    for (const next of merged.parts) {
      const before = this.bySlot.get(next.slot);
      if (!before) {
        if (!this.parts.add) {
          throw new Error(`${partLabel(next)}: this host builds parts only at init`);
        }
        added.push([next, clonePatch(presetFor(presets, partLabel(next), next.preset))]);
        rebuilt.add(next.slot);
        continue;
      }
      if (generatorSig(next.sequencer) !== generatorSig(before.sequencer)) rebuilt.add(next.slot);
    }

    const fresh = rebuilt.size > 0 || keyChanged ? this.buildAll(merged) : this.built;
    const bound = new Map<number, Bound | null>();
    for (const { slot } of merged.parts) {
      const source = rebuilt.has(slot) ? fresh : this.built;
      bound.set(slot, source.bound.get(slot) ?? null);
    }
    const built: Built = { sampler: keyChanged ? fresh.sampler : this.built.sampler, bound };

    const reconfigured: Array<() => void> = [];
    for (const part of merged.parts) {
      if (rebuilt.has(part.slot)) continue;
      const generator = built.bound.get(part.slot)?.generator ?? null;
      const live = liveReconfiguration(generator, part.sequencer, built.sampler);
      if (live) reconfigured.push(live);
    }

    // A part takes a fresh patch when its preset switched, or when the patch
    // it plays was edited in this partial.
    const patchChanges: Array<readonly [number, Patch]> = [];
    for (const next of merged.parts) {
      const before = this.bySlot.get(next.slot);
      if (!before) continue;
      const switched = next.preset !== before.preset;
      const edited = lookupPreset(presets, next.preset) !== lookupPreset(this.presets, next.preset);
      if (switched || edited) {
        patchChanges.push([
          next.slot,
          clonePatch(presetFor(presets, partLabel(next), next.preset)),
        ]);
      }
    }
    return { built, rebuilt, reconfigured, patchChanges, added, removed, presets };
  }

  /** (Re)subscribe the named slots' generators to their gates and point their events at the parts. */
  private attach(slots: ReadonlySet<number>): void {
    for (const [slot, bound] of this.built.bound) {
      if (!bound) continue;
      if (bound.generator instanceof EuclideanSequencer) {
        bound.generator.onOnset = (e): void => this.percussion(slot, e);
      } else {
        bound.generator.onNote = (e): void => this.pitched(slot, e);
      }
    }
    for (const { slot } of this.current.parts) {
      if (!slots.has(slot)) continue;
      this.subs.get(slot)?.();
      this.subs.delete(slot);
      const bound = this.built.bound.get(slot);
      if (bound) this.subs.set(slot, bound.generator.attach(bound.gate));
    }
  }

  private percussion(slot: number, event: OnsetEvent): void {
    const config = this.bySlot.get(slot);
    const part = this.parts.get(slot);
    if (!config || !part || config.sequencer.kind !== 'euclidean') return;
    part.trigger(config.sequencer.note, config.velocity, config.sequencer.hold, event.time);
    this.count(config, event.tick);
  }

  private pitched(slot: number, event: NoteEvent): void {
    const config = this.bySlot.get(slot);
    const part = this.parts.get(slot);
    if (!config || !part) return;
    if (event.kind === 'noteOn') {
      // A grid accent (#602) bumps the part's velocity and rides in as per-note mod.
      const accent = event.accent;
      const velocity = accent ? Math.min(1, config.velocity + accent.velocity) : config.velocity;
      const extras: NoteExtras | undefined =
        accent || event.slide ? { mod: accent?.mod ?? 0, slide: event.slide === true } : undefined;
      part.noteOn(event.note, velocity, event.time, extras);
      this.count(config, event.tick);
    } else {
      part.noteOffByNote(event.note, event.time);
    }
  }

  private count(part: MusicPart, tick: number): void {
    this.counters.set(part.slot, (this.counters.get(part.slot) ?? 0) + 1);
    if (this.announced.has(part.slot)) return;
    this.announced.add(part.slot);
    this.onEvent?.(part, tick);
  }
}
