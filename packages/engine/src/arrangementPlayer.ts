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
import type { Arrangement, DeepPartial, EuclideanDriver } from './arrangement';
import { mergeArrangement } from './arrangement';
import { EuclideanSequencer, type OnsetEvent } from './euclideanSequencer';
import type { NoteEvent } from './noteEvent';
import type { Patch } from './patch';
import { clonePatch } from './patch';
import { PRESETS } from './presets';
import { ScaleSampler } from './scaleSampler';
import type { TickSource, Unsubscribe } from './scheduler';
import { StepSequencer } from './stepSequencer';

export type MusicPartId = 'kick' | 'hat' | 'arp' | 'drone';
export const MUSIC_PART_IDS: readonly MusicPartId[] = ['kick', 'hat', 'arp', 'drone'];

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

function presetFor(id: MusicPartId, name: string): Patch {
  const preset = PRESETS[name];
  if (!preset) throw new Error(`${id}: unknown audio preset "${name}"`);
  return preset;
}

function validate(next: Arrangement, previous: Arrangement | null): void {
  if (!Number.isFinite(next.bpm) || next.bpm <= 0) {
    throw new RangeError(`bpm must be a positive number, got ${next.bpm}`);
  }
  for (const id of MUSIC_PART_IDS) {
    const section = next[id];
    if (!section) continue;
    presetFor(id, section.preset);
    const before = previous?.[id];
    if (previous && before && section.part !== before.part) {
      throw new Error(`${id}: a part cannot be renamed live ("${before.part}")`);
    }
    if (!Number.isFinite(section.velocity) || section.velocity < 0) {
      throw new RangeError(`${id}: velocity must be >= 0, got ${section.velocity}`);
    }
  }
  for (const id of ['kick', 'hat'] as const) {
    const section = next[id];
    if (!section) continue;
    const { note, hold } = section;
    if (!Number.isFinite(note)) throw new RangeError(`${id}: note must be finite, got ${note}`);
    if (!Number.isFinite(hold) || hold <= 0) {
      throw new RangeError(`${id}: hold must be > 0 seconds, got ${hold}`);
    }
  }
}

export class ArrangementPlayer {
  private current: Arrangement;
  private built: Built;
  private readonly subs = new Map<MusicPartId, Unsubscribe>();
  private readonly counters: Record<MusicPartId, number> = { kick: 0, hat: 0, arp: 0, drone: 0 };
  private readonly announced = new Set<MusicPartId>();

  constructor(
    private readonly transport: MusicTransport,
    private readonly parts: Readonly<Partial<Record<MusicPartId, PlayablePart>>>,
    arrangement: Arrangement,
    private readonly onEvent?: MusicEventHandler,
  ) {
    this.current = structuredClone(arrangement);
    validate(this.current, null);
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
    validate(merged, this.current);
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
        patchChanges.push([id, clonePatch(presetFor(id, next.preset))]);
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
