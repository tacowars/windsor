/**
 * The binding layer (issue #69): generators emit onsets and note events on the
 * tick grid; this maps them onto parts. It is the seam of record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §2 — the sequencers
 * know nothing about audio, and everything that does know lives here.
 *
 *   transport ─▶ EuclideanSequencer (kick, hat) ─ onset ─▶ part.trigger
 *            ─▶ Arpeggiator (arp)  ─ noteOn/noteOff ─▶ part.noteOn / noteOffByNote
 *            ─▶ StepSequencer (drone) ─ ties: no event, the held note continues
 *
 * The four part slots are optional (issue #75): an arrangement builds only the
 * generators for the parts it defines, and a partial naming an absent slot is
 * ignored and reported — a part that was never initialised has no `AudioPart`
 * and cannot be added live.
 *
 * `apply()` is the live tuning path (refinement decision 3): a deep partial is
 * merged over the current arrangement, validated, and committed — bpm straight
 * to the transport, a preset change via `setPatch`, and only the generators
 * whose config (or shared key/seed) actually changed are rebuilt, so tuning
 * one part cannot reset another's stream. A merged arrangement that fails
 * validation changes nothing and is reported, never half-applied.
 */
import { Arpeggiator } from './arpeggiator';
import type { Arrangement, DeepPartial, EuclideanDriver, MusicPartId } from './arrangement';
import { MUSIC_PART_IDS, mergeArrangement } from './arrangement';
import { BarRecorder, type NotePattern } from './capturedPattern';
import { EuclideanSequencer, type OnsetEvent } from './euclideanSequencer';
import type { NoteEvent } from './noteEvent';
import type { PresetTable } from './arrangementValidate';
import { presetFor, validateArrangement } from './arrangementValidate';
import type { Patch } from './patch';
import { clonePatch, makePatch, mergePatch, type PartialPatch } from './patch';
import { PRESETS } from './presets';
import { ScaleSampler } from './scaleSampler';
import type { TickSource, Unsubscribe } from './scheduler';
import { StepSequencer } from './stepSequencer';

export type { MusicPartId } from './arrangement';
export { MUSIC_PART_IDS } from './arrangement';

/** Fixed stream index per part (record §4); not arrangement data, so `apply` cannot corrupt it. */
export const GENERATOR_INDEX: Readonly<Record<MusicPartId, number>> = {
  kick: 0,
  hat: 1,
  arp: 2,
  drone: 3,
};

/** What a binding needs from a part. `AudioPart` satisfies it structurally. */
export interface PlayablePart {
  noteOn(note: number, velocity?: number, time?: number): number;
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
export type MusicEventHandler = (part: MusicPartId, tick: number) => void;

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
  /** Note-ons since construction, per part. Never reset by `apply`. */
  counters: Record<MusicPartId, number>;
}

interface Built {
  sampler: ScaleSampler;
  kick: EuclideanSequencer | null;
  hat: EuclideanSequencer | null;
  arp: Arpeggiator | null;
  drone: StepSequencer | null;
}

interface Plan {
  built: Built;
  rebuilt: ReadonlySet<MusicPartId>;
  patchChanges: ReadonlyArray<readonly [MusicPartId, Patch]>;
}

const sig = (value: unknown): string => JSON.stringify(value) ?? 'absent';

export class ArrangementPlayer {
  private current: Arrangement;
  private built: Built;
  /** What each pitched part actually sounded, for capture (issue #70). */
  private readonly recorders: Record<'arp' | 'drone', BarRecorder | null> = {
    arp: null,
    drone: null,
  };
  private readonly subs = new Map<MusicPartId, Unsubscribe>();
  private readonly counters: Record<MusicPartId, number> = { kick: 0, hat: 0, arp: 0, drone: 0 };
  private readonly announced = new Set<MusicPartId>();
  /** The table preset names resolve against; `applyPatches` edits it live. */
  private readonly presets: Record<string, Patch>;

  constructor(
    private readonly transport: MusicTransport,
    private readonly parts: Readonly<Partial<Record<MusicPartId, PlayablePart>>>,
    arrangement: Arrangement,
    private readonly onEvent?: MusicEventHandler,
    presets: PresetTable = PRESETS,
  ) {
    this.presets = { ...presets };
    this.current = structuredClone(arrangement);
    validateArrangement(this.current, null, this.presets);
    this.built = this.buildAll(this.current);
    this.transport.bpm = this.current.bpm;
    this.attach(new Set(MUSIC_PART_IDS));
  }

  /** The live arrangement, as data — what `readout` and #70's console read. */
  get arrangement(): Arrangement {
    return structuredClone(this.current);
  }

  readout(): ArrangementReadout {
    const { scale } = this.current.key;
    return {
      bpm: this.transport.bpm,
      root: this.current.key.root,
      scale: typeof scale === 'string' ? scale : [...scale],
      counters: { ...this.counters },
    };
  }

  /**
   * The sounding pattern of a part as a literal array (issue #70, record §6):
   * the percussion figure now playing, or the last bar a pitched part
   * completed — `null` before one exists. What the console freezes into
   * `driver.pattern`.
   */
  capturePattern(id: 'kick' | 'hat'): readonly boolean[] | null;
  capturePattern(id: 'arp' | 'drone'): NotePattern | null;
  capturePattern(id: MusicPartId): readonly boolean[] | NotePattern | null;
  capturePattern(id: MusicPartId): readonly boolean[] | NotePattern | null {
    if (id === 'kick' || id === 'hat') {
      const sequencer = this.built[id];
      return sequencer ? [...sequencer.currentPattern] : null;
    }
    const recorder = this.recorders[id];
    if (!recorder) return null;
    const held = id === 'drone' ? (this.built.drone?.heldNote ?? null) : null;
    return recorder.capture(id === 'drone', held);
  }

  /** Merge a partial over the arrangement and commit it (refinement decision 3). */
  apply(partial: DeepPartial<Arrangement>): ApplyResult {
    const { merged, ignored } = mergeArrangement(this.current, partial);
    let plan: Plan;
    try {
      plan = this.plan(merged);
    } catch (error) {
      return { ok: false, ignored, error: error instanceof Error ? error.message : String(error) };
    }
    this.transport.bpm = merged.bpm;
    for (const [id, patch] of plan.patchChanges) this.parts[id]?.setPatch(patch);
    for (const id of plan.rebuilt) this.parts[id]?.allNotesOff();
    this.built = plan.built;
    this.current = merged;
    this.attach(plan.rebuilt);
    return { ok: true, ignored };
  }

  /**
   * A document's `patches` partial, live: each named patch is merged over the
   * table's entry (or a fresh `makePatch()` for a new name) and pushed to
   * every part whose section plays it. Returns the paths it ignored — an
   * entry that is not an object. Not an arrangement change: no generator is
   * rebuilt and no stream moves.
   */
  applyPatches(patches: Readonly<Record<string, unknown>>): string[] {
    const ignored: string[] = [];
    for (const [name, raw] of Object.entries(patches)) {
      if (raw === undefined) continue;
      if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
        ignored.push(`patches.${name}`);
        continue;
      }
      const merged = mergePatch(this.presets[name] ?? makePatch({ name }), raw as PartialPatch);
      this.presets[name] = merged;
      for (const id of MUSIC_PART_IDS) {
        if (this.current[id]?.preset === name) this.parts[id]?.setPatch(clonePatch(merged));
      }
    }
    return ignored;
  }

  /** Release everything sounding — the drone's held note included. Mute and teardown call this. */
  releaseAll(time = 0): void {
    this.built.drone?.release(0, time);
    for (const id of MUSIC_PART_IDS) this.parts[id]?.allNotesOff();
  }

  dispose(): void {
    for (const unsubscribe of this.subs.values()) unsubscribe();
    this.subs.clear();
    this.releaseAll();
  }

  private buildAll(arrangement: Arrangement): Built {
    const sampler = new ScaleSampler(arrangement.key);
    const seed = arrangement.seed;
    return {
      sampler,
      kick: arrangement.kick ? this.euclidean(arrangement.kick.driver, 'kick', seed) : null,
      hat: arrangement.hat ? this.euclidean(arrangement.hat.driver, 'hat', seed) : null,
      arp: arrangement.arp
        ? new Arpeggiator(sampler, {
            ...arrangement.arp.driver,
            seed,
            generatorIndex: GENERATOR_INDEX.arp,
          })
        : null,
      drone: arrangement.drone
        ? new StepSequencer(sampler, {
            ...arrangement.drone.driver,
            seed,
            generatorIndex: GENERATOR_INDEX.drone,
          })
        : null,
    };
  }

  private euclidean(driver: EuclideanDriver, id: 'kick' | 'hat', seed: number): EuclideanSequencer {
    return new EuclideanSequencer({ ...driver, seed, generatorIndex: GENERATOR_INDEX[id] });
  }

  /** Everything `apply` will change, validated and constructed before anything is touched. */
  private plan(merged: Arrangement): Plan {
    validateArrangement(merged, this.current, this.presets);
    const seedChanged = merged.seed !== this.current.seed;
    const keyChanged = seedChanged || sig(merged.key) !== sig(this.current.key);
    const driverChanged = (id: MusicPartId): boolean =>
      sig(merged[id]?.driver) !== sig(this.current[id]?.driver);

    const rebuilt = new Set<MusicPartId>();
    for (const id of ['kick', 'hat'] as const) {
      if (seedChanged || driverChanged(id)) rebuilt.add(id);
    }
    for (const id of ['arp', 'drone'] as const) {
      if (keyChanged || driverChanged(id)) rebuilt.add(id);
    }

    const fresh = rebuilt.size > 0 || keyChanged ? this.buildAll(merged) : this.built;
    const built: Built = {
      sampler: keyChanged ? fresh.sampler : this.built.sampler,
      kick: rebuilt.has('kick') ? fresh.kick : this.built.kick,
      hat: rebuilt.has('hat') ? fresh.hat : this.built.hat,
      arp: rebuilt.has('arp') ? fresh.arp : this.built.arp,
      drone: rebuilt.has('drone') ? fresh.drone : this.built.drone,
    };

    const patchChanges: Array<readonly [MusicPartId, Patch]> = [];
    for (const id of MUSIC_PART_IDS) {
      const next = merged[id];
      const before = this.current[id];
      if (next && before && next.preset !== before.preset) {
        patchChanges.push([id, clonePatch(presetFor(this.presets, id, next.preset))]);
      }
    }
    return { built, rebuilt, patchChanges };
  }

  /** (Re)subscribe the named generators and point their events at the parts. */
  private attach(ids: ReadonlySet<MusicPartId>): void {
    if (this.built.kick) this.built.kick.onOnset = (e): void => this.percussion('kick', e);
    if (this.built.hat) this.built.hat.onOnset = (e): void => this.percussion('hat', e);
    if (this.built.arp) this.built.arp.onNote = (e): void => this.pitched('arp', e);
    if (this.built.drone) this.built.drone.onNote = (e): void => this.pitched('drone', e);
    for (const id of ids) {
      this.subs.get(id)?.();
      this.subs.delete(id);
      const generator = this.built[id];
      if (generator) this.subs.set(id, generator.attach(this.transport));
    }
    // A rebuilt pitched part gets a fresh recorder: its divisor may have
    // changed, and the bars recorded under the old generator are history.
    for (const id of ['arp', 'drone'] as const) {
      if (!ids.has(id)) continue;
      const section = this.current[id];
      this.recorders[id] = section ? new BarRecorder(section.driver.divisor) : null;
    }
  }

  private percussion(id: 'kick' | 'hat', event: OnsetEvent): void {
    const config = this.current[id];
    const part = this.parts[id];
    if (!config || !part) return;
    part.trigger(config.note, config.velocity, config.hold, event.time);
    this.count(id, event.tick);
  }

  private pitched(id: 'arp' | 'drone', event: NoteEvent): void {
    const config = this.current[id];
    const part = this.parts[id];
    if (!config || !part) return;
    if (event.kind === 'noteOn') {
      part.noteOn(event.note, config.velocity, event.time);
      this.recorders[id]?.record(event.tick, event.note);
      this.count(id, event.tick);
    } else {
      part.noteOffByNote(event.note, event.time);
    }
  }

  private count(id: MusicPartId, tick: number): void {
    this.counters[id]++;
    if (this.announced.has(id)) return;
    this.announced.add(id);
    this.onEvent?.(id, tick);
  }
}
