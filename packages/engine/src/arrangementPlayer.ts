/* eslint-disable max-lines -- the binding layer in one file: #629 adds the live roster (a slot added or removed) to the same plan/commit transaction the rebuilds and reconfigures run through; 373 of 350, inside the #225 decision 4 margin, and a split would put half the transaction in a second file */
/**
 * The binding layer (issue #69): generators emit onsets and note events on the
 * tick grid; this maps them onto parts. It is the seam of record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §2 — the sequencers
 * know nothing about audio, and everything that does know lives here.
 *
 *   transport ─▶ EuclideanSequencer ─ onset ─▶ part.trigger
 *            ─▶ Arpeggiator        ─ noteOn/noteOff ─▶ part.noteOn / noteOffByNote
 *            ─▶ StepSequencer      ─ ties: no event, the held note continues
 *
 * Since #597 any part carries any of those, or none: a part is found by its
 * slot, a `none` part builds no generator and is never touched here beyond
 * `releaseAll`, and a part's slot is its generator index, so removing or
 * reordering one part cannot move another's stream. Since #629 a part is
 * added and removed live too: a whole part at a free slot asks the
 * `PartHost` for its `AudioPart` and joins the transport where it is, `null`
 * at a slot releases that part and hands it back, and no other slot is
 * touched by either. A fragment naming an absent slot is still ignored and
 * reported.
 *
 * `apply()` is the live tuning path (refinement decision 3): a deep partial is
 * merged over the current arrangement, validated, and committed — bpm straight
 * to the transport, a preset change via `setPatch`, and only the generators
 * whose config (or shared key/seed) actually changed are rebuilt, so tuning
 * one part cannot reset another's stream. A merged arrangement that fails
 * validation changes nothing and is reported, never half-applied.
 */
import { Arpeggiator } from './arpeggiator';
import type {
  ArpDriver,
  Arrangement,
  ArrangementPartial,
  ChordDriver,
  EuclideanDriver,
  GridDriver,
  MusicPart,
  SequencerSpec,
  StepDriver,
} from './arrangement';
import { driverOf, mergeArrangement } from './arrangement';
import { BarRecorder, type NotePattern } from './capturedPattern';
import { EuclideanSequencer, assertEuclideanConfig, type OnsetEvent } from './euclideanSequencer';
import type { NoteEvent } from './noteEvent';
import type { PresetTable } from './arrangementValidate';
import {
  lookupPreset,
  partLabel,
  presetFor,
  validateArrangement,
  validatePartialSlots,
} from './arrangementValidate';
import type { Patch } from './patch';
import { clonePatch, makePatch, mergePatch, type PartialPatch } from './patch';
import { ScaleSampler } from './scaleSampler';
import type { TickSource, Unsubscribe } from './scheduler';
import { StepSequencer } from './stepSequencer';
import { GridSequencer, assertGridConfig } from './gridSequencer';
import { ChordSequencer, assertChordConfig } from './chordSequencer';
import type { NoteExtras } from './audioPart';

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

type Generator = EuclideanSequencer | Arpeggiator | StepSequencer | GridSequencer | ChordSequencer;

interface Built {
  sampler: ScaleSampler;
  /** By slot; `null` for a `none` part. */
  generators: ReadonlyMap<number, Generator | null>;
}

interface Plan {
  built: Built;
  rebuilt: ReadonlySet<number>;
  /**
   * Grid, chord and Euclidean parts kept live (#603, #606, #610): each entry
   * applies the validated config to its generator after the commit, against
   * the sampler the commit installs.
   */
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
 * What builds a part's generator: its kind and driver, never its note, hold or
 * velocity. A grid (#603) or a Euclidean part (#610) rebuilds only on its kind
 * or divisor and a chord progression only on its kind (#606, it subscribes at
 * every tick): every other field reconfigures the live generator, so an edit
 * never cuts the held note or restarts the stream.
 */
const generatorSig = (spec: SequencerSpec): string => {
  if (spec.kind === 'grid' || spec.kind === 'euclidean') return sig([spec.kind, spec.divisor]);
  if (spec.kind === 'chord') return sig([spec.kind]);
  return sig([spec.kind, driverOf(spec)]);
};

/** Draws from the shared sampler on a rebuild; a key change rebuilds these two. */
const isPitched = (spec: SequencerSpec): boolean => spec.kind === 'arp' || spec.kind === 'step';

/** Kept live across edits (#603, #606, #610): reconfigured after a commit, never rebuilt for one. */
const isLive = (spec: SequencerSpec): boolean =>
  spec.kind === 'grid' || spec.kind === 'chord' || spec.kind === 'euclidean';

/**
 * A grid, chord or Euclidean part kept live is validated here, inside the
 * transaction: a bad edit (a length past its steps, a pulse bound past the
 * figure) is refused before the tempo, the patches or the arrangement change,
 * exactly as a rebuild's constructor would be. What comes back runs after the
 * commit, against `built.sampler`.
 */
function liveReconfigurations(
  merged: Arrangement,
  rebuilt: ReadonlySet<number>,
  built: Built,
): Array<() => void> {
  const out: Array<() => void> = [];
  for (const part of merged.parts) {
    const { sequencer } = part;
    if (rebuilt.has(part.slot) || !isLive(sequencer)) continue;
    const generator = built.generators.get(part.slot);
    const stream = { seed: merged.seed, generatorIndex: part.slot };
    if (sequencer.kind === 'grid' && generator instanceof GridSequencer) {
      const config = { ...(driverOf(sequencer) as GridDriver), ...stream };
      assertGridConfig(config);
      out.push(() => generator.reconfigure(config, built.sampler));
    } else if (sequencer.kind === 'chord' && generator instanceof ChordSequencer) {
      const config = { ...(driverOf(sequencer) as ChordDriver), ...stream };
      assertChordConfig(config);
      out.push(() => generator.reconfigure(config, built.sampler));
    } else if (sequencer.kind === 'euclidean' && generator instanceof EuclideanSequencer) {
      const config = { ...(driverOf(sequencer) as EuclideanDriver), ...stream };
      assertEuclideanConfig(config);
      out.push(() => generator.reconfigure(config));
    }
  }
  return out;
}

export class ArrangementPlayer {
  private current: Arrangement;
  private bySlot = new Map<number, MusicPart>();
  private built: Built;
  /** What each pitched part actually sounded, for capture (issue #70), by slot. */
  private readonly recorders = new Map<number, BarRecorder | null>();
  private readonly subs = new Map<number, Unsubscribe>();
  private readonly counters = new Map<number, number>();
  private readonly announced = new Set<number>();
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
    this.current = structuredClone(arrangement);
    validateArrangement(this.current, this.presets);
    this.index();
    this.built = this.buildAll(this.current);
    this.transport.bpm = this.current.bpm;
    this.attach(new Set(this.current.parts.map((part) => part.slot)));
  }

  /** The live arrangement, as data — what `readout` and #70's console read. */
  get arrangement(): Arrangement {
    return structuredClone(this.current);
  }

  readout(): ArrangementReadout {
    const { scale } = this.current.key;
    const counters: Record<string, number> = {};
    for (const { slot } of this.current.parts) counters[slot] = this.counters.get(slot) ?? 0;
    return {
      bpm: this.transport.bpm,
      root: this.current.key.root,
      scale: typeof scale === 'string' ? scale : [...scale],
      counters,
    };
  }

  /**
   * The sounding pattern of a part as a literal array (issue #70, record §6):
   * a Euclidean part's figure now playing, or the last bar a pitched part
   * completed — `null` before one exists, and always for a `none` part or an
   * absent slot. What the console freezes into the sequencer's `pattern`.
   */
  capturePattern(slot: number): readonly boolean[] | NotePattern | null {
    const kind = this.bySlot.get(slot)?.sequencer.kind;
    const generator = this.built.generators.get(slot) ?? null;
    if (kind === 'euclidean' && generator instanceof EuclideanSequencer) {
      return [...generator.currentPattern];
    }
    const recorder = this.recorders.get(slot);
    if (!recorder || !kind || kind === 'none') return null;
    const step = kind === 'step' && generator instanceof StepSequencer ? generator : null;
    return recorder.capture(step !== null, step?.heldNote ?? null);
  }

  /**
   * The step the part on `slot` is sounding at transport tick `tick`, or -1
   * when the part has no position to show — an absent slot, a `none` or
   * unbuilt part, an empty chord progression (#619 decision 2).
   *
   * Each generator's own `stepAt` answers, so the console's playhead *is* the
   * engine's rule rather than a second copy of it: a grid or Euclidean part
   * divides the tick by the divisor it subscribed at and folds that into its
   * loop, and a chord part's segments carry its per-step durations.
   */
  stepAt(slot: number, tick: number): number {
    const generator = this.built.generators.get(slot) ?? null;
    if (generator instanceof ChordSequencer) return generator.stepAt(tick)?.step ?? -1;
    if (generator instanceof GridSequencer || generator instanceof EuclideanSequencer) {
      return generator.stepAt(Math.floor(tick / generator.config.divisor));
    }
    return -1;
  }

  /**
   * Merge a partial over the arrangement and commit it (refinement decision
   * 3). A `patches` partial (#435) is staged into the preset table first, so
   * a preset switch and the patch it names can arrive together; the
   * arrangement is validated against the staged table, and on failure
   * neither the table nor the arrangement changes.
   */
  apply(partial: ArrangementPartial, patches: Readonly<Record<string, unknown>> = {}): ApplyResult {
    const { merged, ignored } = mergeArrangement(this.current, partial);
    const staged = stagePatches(this.presets, patches, ignored);
    let plan: Plan;
    try {
      validatePartialSlots(partial);
      plan = this.plan(merged, staged);
    } catch (error) {
      return { ok: false, ignored, error: error instanceof Error ? error.message : String(error) };
    }
    this.transport.bpm = merged.bpm;
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
    return { ok: true, ignored };
  }

  /** Release everything sounding — step parts' held notes included. Mute and teardown call this. */
  releaseAll(time = 0): void {
    for (const generator of this.built.generators.values()) {
      if (
        generator instanceof StepSequencer ||
        generator instanceof GridSequencer ||
        generator instanceof ChordSequencer
      ) {
        generator.release(0, time);
      }
    }
    for (const { slot } of this.current.parts) this.parts.get(slot)?.allNotesOff();
  }

  dispose(): void {
    for (const unsubscribe of this.subs.values()) unsubscribe();
    this.subs.clear();
    this.releaseAll();
  }

  /**
   * A part leaving the arrangement live (#629): its held note released, its
   * subscription and bookkeeping dropped, everything sounding cut, and the
   * part handed back to the host to dispose. Nothing else is touched.
   */
  private detach(slot: number): void {
    const generator = this.built.generators.get(slot);
    if (
      generator instanceof StepSequencer ||
      generator instanceof GridSequencer ||
      generator instanceof ChordSequencer
    ) {
      generator.release(0, 0);
    }
    this.subs.get(slot)?.();
    this.subs.delete(slot);
    this.recorders.delete(slot);
    this.counters.delete(slot);
    this.announced.delete(slot);
    this.parts.get(slot)?.allNotesOff();
    this.parts.remove?.(slot);
  }

  private index(): void {
    this.bySlot = new Map(this.current.parts.map((part) => [part.slot, part]));
  }

  private buildAll(arrangement: Arrangement): Built {
    const sampler = new ScaleSampler(arrangement.key);
    const generators = new Map<number, Generator | null>();
    for (const part of arrangement.parts) {
      generators.set(part.slot, this.build(part, sampler, arrangement.seed));
    }
    return { sampler, generators };
  }

  /** The part's slot is its generator index (#597): its stream is its own. */
  private build(part: MusicPart, sampler: ScaleSampler, seed: number): Generator | null {
    const stream = { seed, generatorIndex: part.slot };
    const driver = driverOf(part.sequencer);
    switch (part.sequencer.kind) {
      case 'euclidean':
        return new EuclideanSequencer({ ...(driver as EuclideanDriver), ...stream });
      case 'arp':
        return new Arpeggiator(sampler, { ...(driver as ArpDriver), ...stream });
      case 'step':
        return new StepSequencer(sampler, { ...(driver as StepDriver), ...stream });
      case 'grid':
        return new GridSequencer(sampler, { ...(driver as GridDriver), ...stream });
      case 'chord':
        return new ChordSequencer(sampler, { ...(driver as ChordDriver), ...stream });
      default:
        return null;
    }
  }

  /** Everything `apply` will change, validated and constructed before anything is touched. */

  private plan(merged: Arrangement, presets: Record<string, Patch>): Plan {
    validateArrangement(merged, presets);
    const seedChanged = merged.seed !== this.current.seed;
    const keyChanged = seedChanged || sig(merged.key) !== sig(this.current.key);

    // A part on a slot the arrangement lacked is built like a rebuilt one
    // (#629): same seed, same generator index, so its stream is the one a
    // rebuild would have made (#597). It needs a host that can create parts.
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
      const changed = generatorSig(next.sequencer) !== generatorSig(before.sequencer);
      // An inert part only rebuilds when its kind leaves or enters `none`;
      // a seed or key change has no stream of its to reset.
      // A grid or chord part takes a new sampler live (`reconfigure`), so a key change does not rebuild it.
      const reseeded =
        next.sequencer.kind !== 'none' &&
        (seedChanged || (isPitched(next.sequencer) && keyChanged));
      if (changed || reseeded) rebuilt.add(next.slot);
    }

    const fresh = rebuilt.size > 0 || keyChanged ? this.buildAll(merged) : this.built;
    const generators = new Map<number, Generator | null>();
    for (const { slot } of merged.parts) {
      const source = rebuilt.has(slot) ? fresh : this.built;
      generators.set(slot, source.generators.get(slot) ?? null);
    }
    const built: Built = { sampler: keyChanged ? fresh.sampler : this.built.sampler, generators };

    const reconfigured = liveReconfigurations(merged, rebuilt, built);

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

  /** (Re)subscribe the named slots' generators and point their events at the parts. */
  private attach(slots: ReadonlySet<number>): void {
    for (const [slot, generator] of this.built.generators) {
      if (generator instanceof EuclideanSequencer) {
        generator.onOnset = (e): void => this.percussion(slot, e);
      } else if (generator) {
        generator.onNote = (e): void => this.pitched(slot, e);
      }
    }
    for (const { slot, sequencer } of this.current.parts) {
      if (!slots.has(slot)) continue;
      this.subs.get(slot)?.();
      this.subs.delete(slot);
      const generator = this.built.generators.get(slot);
      if (generator) this.subs.set(slot, generator.attach(this.transport));
      // A rebuilt pitched part gets a fresh recorder: its divisor may have
      // changed, and the bars recorded under the old generator are history.
      const pitched = sequencer.kind === 'arp' || sequencer.kind === 'step';
      this.recorders.set(slot, pitched ? new BarRecorder(sequencer.divisor) : null);
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
      this.recorders.get(slot)?.record(event.tick, event.note);
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
