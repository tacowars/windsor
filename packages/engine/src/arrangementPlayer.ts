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
 * reordering one part cannot move another's stream. A partial naming an
 * absent slot is ignored and reported — a part that was never initialised
 * has no `AudioPart` and cannot be added live.
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
  EuclideanDriver,
  GridDriver,
  MusicPart,
  SequencerSpec,
  StepDriver,
} from './arrangement';
import { driverOf, mergeArrangement } from './arrangement';
import { BarRecorder, type NotePattern } from './capturedPattern';
import { EuclideanSequencer, type OnsetEvent } from './euclideanSequencer';
import type { NoteEvent } from './noteEvent';
import type { PresetTable } from './arrangementValidate';
import { lookupPreset, partLabel, presetFor, validateArrangement } from './arrangementValidate';
import type { Patch } from './patch';
import { clonePatch, makePatch, mergePatch, type PartialPatch } from './patch';
import { ScaleSampler } from './scaleSampler';
import type { TickSource, Unsubscribe } from './scheduler';
import { StepSequencer } from './stepSequencer';
import { GridSequencer } from './gridSequencer';
import type { NoteExtras } from './audioPart';

/** What a binding needs from a part. `AudioPart` satisfies it structurally. */
export interface PlayablePart {
  noteOn(note: number, velocity?: number, time?: number, extras?: NoteExtras): number;
  noteOffByNote(note: number, time?: number): void;
  trigger(note: number, velocity?: number, duration?: number, time?: number): number;
  setPatch(patch: Patch): void;
  allNotesOff(): void;
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

type Generator = EuclideanSequencer | Arpeggiator | StepSequencer | GridSequencer;

interface Built {
  sampler: ScaleSampler;
  /** By slot; `null` for a `none` part. */
  generators: ReadonlyMap<number, Generator | null>;
}

interface Plan {
  built: Built;
  rebuilt: ReadonlySet<number>;
  patchChanges: ReadonlyArray<readonly [number, Patch]>;
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
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
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
 * velocity. A grid rebuilds only on its kind or divisor (#603): every other
 * field reconfigures the live generator, so an edit never cuts the held note.
 */
const generatorSig = (spec: SequencerSpec): string =>
  spec.kind === 'grid' ? sig([spec.kind, spec.divisor]) : sig([spec.kind, driverOf(spec)]);

/** Draws from the shared sampler, so a key change rebuilds it (the grid resolves degrees through it too). */
const isPitched = (spec: SequencerSpec): boolean =>
  spec.kind === 'arp' || spec.kind === 'step' || spec.kind === 'grid';

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
    private readonly parts: ReadonlyMap<number, PlayablePart>,
    arrangement: Arrangement,
    presets: PresetTable,
    private readonly onEvent?: MusicEventHandler,
  ) {
    this.presets = { ...presets };
    this.current = structuredClone(arrangement);
    validateArrangement(this.current, null, this.presets);
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
      plan = this.plan(merged, staged);
    } catch (error) {
      return { ok: false, ignored, error: error instanceof Error ? error.message : String(error) };
    }
    this.transport.bpm = merged.bpm;
    this.presets = plan.presets;
    for (const [slot, patch] of plan.patchChanges) this.parts.get(slot)?.setPatch(patch);
    for (const slot of plan.rebuilt) this.parts.get(slot)?.allNotesOff();
    this.built = plan.built;
    this.current = merged;
    this.index();
    this.attach(plan.rebuilt);
    this.reconfigureGrids(plan.rebuilt);
    return { ok: true, ignored };
  }

  /** Every grid part that was not rebuilt takes its merged line and the current sampler live (#603). */
  private reconfigureGrids(rebuilt: ReadonlySet<number>): void {
    for (const part of this.current.parts) {
      const generator = this.built.generators.get(part.slot);
      if (rebuilt.has(part.slot) || !(generator instanceof GridSequencer)) continue;
      const driver = driverOf(part.sequencer) as GridDriver;
      generator.reconfigure(
        { ...driver, seed: this.current.seed, generatorIndex: part.slot },
        this.built.sampler,
      );
    }
  }

  /** Release everything sounding — step parts' held notes included. Mute and teardown call this. */
  releaseAll(time = 0): void {
    for (const generator of this.built.generators.values()) {
      if (generator instanceof StepSequencer || generator instanceof GridSequencer) {
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
      default:
        return null;
    }
  }

  /** Everything `apply` will change, validated and constructed before anything is touched. */
  private plan(merged: Arrangement, presets: Record<string, Patch>): Plan {
    validateArrangement(merged, this.current, presets);
    const seedChanged = merged.seed !== this.current.seed;
    const keyChanged = seedChanged || sig(merged.key) !== sig(this.current.key);

    const rebuilt = new Set<number>();
    for (const next of merged.parts) {
      const before = this.bySlot.get(next.slot);
      if (!before) continue;
      const changed = generatorSig(next.sequencer) !== generatorSig(before.sequencer);
      // An inert part only rebuilds when its kind leaves or enters `none`;
      // a seed or key change has no stream of its to reset.
      // A grid takes a new sampler live (`reconfigure`), so a key change does not rebuild it.
      const reseeded =
        next.sequencer.kind !== 'none' &&
        (seedChanged ||
          (isPitched(next.sequencer) && next.sequencer.kind !== 'grid' && keyChanged));
      if (changed || reseeded) rebuilt.add(next.slot);
    }

    const fresh = rebuilt.size > 0 || keyChanged ? this.buildAll(merged) : this.built;
    const generators = new Map<number, Generator | null>();
    for (const { slot } of merged.parts) {
      const source = rebuilt.has(slot) ? fresh : this.built;
      generators.set(slot, source.generators.get(slot) ?? null);
    }
    const built: Built = { sampler: keyChanged ? fresh.sampler : this.built.sampler, generators };

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
    return { built, rebuilt, patchChanges, presets };
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
