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
 * `apply()` is the live tuning path (refinement decision 3): a deep partial is
 * merged over the current arrangement, validated, and committed — bpm straight
 * to the transport, a preset change via `setPatch`, and only the generators
 * whose config (or shared key/seed) actually changed are rebuilt, so tuning
 * one part cannot reset another's stream. A merged arrangement that fails
 * validation changes nothing and is reported, never half-applied.
 */
import { Arpeggiator } from './arpeggiator';
import type { Arrangement, DeepPartial, PercussionArrangement } from './arrangement';
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
  kick: EuclideanSequencer;
  hat: EuclideanSequencer;
  arp: Arpeggiator;
  drone: StepSequencer;
}

interface Plan {
  built: Built;
  rebuilt: ReadonlySet<MusicPartId>;
  patchChanges: ReadonlyArray<readonly [MusicPartId, Patch]>;
}

const sig = (value: unknown): string => JSON.stringify(value);

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
    presetFor(id, next[id].preset);
    if (previous && next[id].part !== previous[id].part) {
      throw new Error(`${id}: a part cannot be renamed live ("${previous[id].part}")`);
    }
    if (!Number.isFinite(next[id].velocity) || next[id].velocity < 0) {
      throw new RangeError(`${id}: velocity must be >= 0, got ${next[id].velocity}`);
    }
  }
  for (const id of ['kick', 'hat'] as const) {
    const { note, hold } = next[id];
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
    private readonly parts: Readonly<Record<MusicPartId, PlayablePart>>,
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
    for (const [id, patch] of plan.patchChanges) this.parts[id].setPatch(patch);
    for (const id of plan.rebuilt) this.parts[id].allNotesOff();
    this.built = plan.built;
    this.current = merged;
    this.attach(plan.rebuilt);
    return { ok: true, ignored };
  }

  /** Release everything sounding — the drone's held note included. Mute and teardown call this. */
  releaseAll(time = 0): void {
    this.built.drone.release(0, time);
    for (const id of MUSIC_PART_IDS) this.parts[id].allNotesOff();
  }

  dispose(): void {
    for (const unsubscribe of this.subs.values()) unsubscribe();
    this.subs.clear();
    this.releaseAll();
  }

  private buildAll(arrangement: Arrangement): Built {
    const sampler = new ScaleSampler(arrangement.key);
    return {
      sampler,
      kick: this.euclidean(arrangement, 'kick'),
      hat: this.euclidean(arrangement, 'hat'),
      arp: new Arpeggiator(sampler, {
        ...arrangement.arp.driver,
        seed: arrangement.seed,
        generatorIndex: GENERATOR_INDEX.arp,
      }),
      drone: new StepSequencer(sampler, {
        ...arrangement.drone.driver,
        seed: arrangement.seed,
        generatorIndex: GENERATOR_INDEX.drone,
      }),
    };
  }

  private euclidean(arrangement: Arrangement, id: 'kick' | 'hat'): EuclideanSequencer {
    return new EuclideanSequencer({
      ...arrangement[id].driver,
      seed: arrangement.seed,
      generatorIndex: GENERATOR_INDEX[id],
    });
  }

  /** Everything `apply` will change, validated and constructed before anything is touched. */
  private plan(merged: Arrangement): Plan {
    validate(merged, this.current);
    const seedChanged = merged.seed !== this.current.seed;
    const keyChanged = seedChanged || sig(merged.key) !== sig(this.current.key);
    const driverChanged = (id: MusicPartId): boolean =>
      sig(merged[id].driver) !== sig(this.current[id].driver);

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
      if (merged[id].preset !== this.current[id].preset) {
        patchChanges.push([id, clonePatch(presetFor(id, merged[id].preset))]);
      }
    }
    return { built, rebuilt, patchChanges };
  }

  /** (Re)subscribe the named generators and point their events at the parts. */
  private attach(ids: ReadonlySet<MusicPartId>): void {
    this.built.kick.onOnset = (e): void => this.percussion('kick', e);
    this.built.hat.onOnset = (e): void => this.percussion('hat', e);
    this.built.arp.onNote = (e): void => this.pitched('arp', e);
    this.built.drone.onNote = (e): void => this.pitched('drone', e);
    for (const id of ids) {
      this.subs.get(id)?.();
      this.subs.set(id, this.generator(id).attach(this.transport));
    }
  }

  private generator(id: MusicPartId): { attach(source: TickSource): Unsubscribe } {
    return this.built[id];
  }

  private percussion(id: 'kick' | 'hat', event: OnsetEvent): void {
    const config: PercussionArrangement = this.current[id];
    this.parts[id].trigger(config.note, config.velocity, config.hold, event.time);
    this.count(id, event.tick);
  }

  private pitched(id: 'arp' | 'drone', event: NoteEvent): void {
    if (event.kind === 'noteOn') {
      this.parts[id].noteOn(event.note, this.current[id].velocity, event.time);
      this.count(id, event.tick);
    } else {
      this.parts[id].noteOffByNote(event.note, event.time);
    }
  }

  private count(id: MusicPartId, tick: number): void {
    this.counters[id]++;
    if (this.announced.has(id)) return;
    this.announced.add(id);
    this.onEvent?.(id, tick);
  }
}
