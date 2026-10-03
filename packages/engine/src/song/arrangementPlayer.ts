/**
 * The binding layer (issue #69): generators emit onsets and note events on the
 * tick grid; this maps them onto parts. It is the seam of record
 * `2026-08-31-generative-sequencing-transport-and-pitch` §2 — the sequencers
 * know nothing about audio, and everything that does know lives here.
 *
 *   transport ─▶ RegionGate ─▶ EuclideanSequencer ─ onset ─▶ part.trigger (× its ratchet)
 *                          ─▶ GridSequencer      ─ noteOn/noteOff ─▶ part.noteOn / noteOffByNote (a roll × its ratchet)
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
 * Since windsor#74 each region plays its own pattern (`regionPattern`): a
 * part's `PartBinding` (`partBinding.ts`) holds one generator per region
 * with a pattern of its own, plus the one `part.sequencer` builds for the
 * rest, all behind the part's gate, and the region entered is the one heard.
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
 * whose kind, divisor or seed changed are rebuilt (`generatorSig`), region
 * by region (`PartBinding.plan`); a `regions`, `transport.bars`,
 * `transport.meter` or harmony edit reaches every gate live, and a key
 * change re-pitches through the sampler. A merged arrangement that fails
 * validation changes nothing and is reported, never half-applied.
 *
 * A Figure's canon (windsor#487) finds its leader by slot through the
 * bindings in force at each onset: the leader part's base generator when it
 * is a Figure, so a leader's live edit, rebuild or kind change is read on
 * the follower's next step, and a slot without a Figure leaves it silent.
 *
 * A part's sequencer lanes (windsor#488) ride on its gate: a part plays the
 * lanes its `automation` carries until `setLanes` hands it others (the live
 * system's, which keeps lane edits out of the arrangement), and its gate
 * gets the reader of those its kind offers (`partGateConfig.ts`), which
 * every generator reads on its onset. A lane edit reaches the gate on the
 * next tick and restarts nothing; a part without such a lane gives its gate
 * no reader.
 *
 * The loop (windsor#15) is the clock's: the player hands it the song's
 * `TickLoop` at build and on every partial, and the counter jumps back from
 * the loop's end to its start. The player follows the tick, and on any jump
 * treats the new tick as every part's entry, just as the song's end is for a
 * region: held notes are released on that tick and each gate restarts its
 * stream. A loop over the whole song jumps nothing and is today's wrap.
 */
import type { Arrangement, ArrangementPartial, MusicPart, SequencerSpec } from './arrangement';
import type { AutomationLane } from '../automation/automationLane';
import { mergeArrangement } from './arrangement';
import type { OnsetEvent } from '../sequencing/euclideanSequencer';
import type { NoteEvent, NoteRoll } from '../sequencing/noteEvent';
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
import type { TickEvent, TickSource, Unsubscribe } from '../sequencing/scheduler';
import { meterBeats } from '../sequencing/meter';
import { isLoopJump } from '../sequencing/scheduler';
import { playableSwing } from '../sequencing/swing';
import type { NoteExtras } from '../synth/audioPart';
import { euclidNoteOn } from './partNoteOn';
import { PLAIN_HIT, pitchedRollShape, playPitched } from './pitchedRoll';
import { euclidHitRead } from '../sequencing/euclidLanes';
import { rollHits, type RollHit, type RollShape } from './rollSpan';
import { fitTimelines } from './timelineNormalise';
import { withFittedLoop } from './songLoop';
import { setSongClock, songTicksOf, withClockFields, type SongClock } from './songClock';
import { PartBinding, type BindingChange, type RegionStep } from './partBinding';
import { partGateConfig } from './partGateConfig';

export type { RegionStep } from './partBinding';

/** What a binding needs from a part. `AudioPart` satisfies it structurally. */
export interface PlayablePart {
  noteOn(note: number, velocity?: number, time?: number, extras?: NoteExtras): number;
  noteOffByNote(note: number, time?: number): void;
  /** A note of fixed length; `extras` ride on its note-on (a Euclid hit's lanes, windsor#355). */
  trigger(
    note: number,
    velocity?: number,
    duration?: number,
    time?: number,
    extras?: NoteExtras,
  ): number;
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
export interface MusicTransport extends TickSource, SongClock {}

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

interface Built {
  sampler: ScaleSampler;
  /** By slot; `null` for a `none` part. */
  bindings: ReadonlyMap<number, PartBinding | null>;
}

interface Plan {
  built: Built;
  /** Bindings built whole (a part added, or its kind changed): attached after the commit. */
  fresh: readonly PartBinding[];
  /** The bindings those replaced: disposed. */
  retired: readonly PartBinding[];
  /** Parts kept: each change reconfigures or rebuilds its region generators after the commit. */
  changes: readonly BindingChange[];
  /** Parts already sounding that restart: cut before anything is attached. */
  cut: ReadonlySet<number>;
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

export class ArrangementPlayer {
  private current: Arrangement;
  private bySlot = new Map<number, MusicPart>();
  private built: Built;
  private readonly counters = new Map<number, number>();
  /** The lanes `setLanes` handed each part, by slot, in place of its `automation` (windsor#488). */
  private readonly lanes = new Map<number, readonly AutomationLane[]>();
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
    this.current = withFittedLoop(withClockFields(structuredClone(arrangement)));
    validateArrangement(this.current, this.presets);
    this.index();
    this.built = this.buildAll(this.current);
    setSongClock(this.transport, this.current);
    // Subscribed before any gate, so a jump is seen before a part hears the tick.
    this.unfollow = this.transport.subscribe(1, (event) => this.follow(event));
    for (const binding of this.built.bindings.values()) binding?.attach();
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
   * `pattern`: region `regionIndex`'s (windsor#74), or with no index the
   * one `part.sequencer` plays. `null` for any other kind or an absent slot.
   */
  capturePattern(slot: number, regionIndex?: number): readonly boolean[] | null {
    return this.built.bindings.get(slot)?.capture(regionIndex) ?? null;
  }

  /**
   * The step the part on `slot` is sounding at transport tick `tick`, or -1
   * when the part has no position to show — an absent slot, a `none` or
   * unbuilt part, a tick outside the part's regions, an empty Chord Player
   * (#619 decision 2). The tick goes through the part's gate first, so the
   * playhead and the performer agree on the local position (#705), and the
   * region it falls in answers with its own pattern's step (windsor#74).
   */
  stepAt(slot: number, tick: number): number {
    return this.built.bindings.get(slot)?.stepAt(tick) ?? -1;
  }

  /**
   * Where region `region` of the part on `slot` is at transport tick `tick`
   * (windsor#97), whether the playhead is in it or not: its own generator's
   * step at the region's phase, counted from the region's last start on the
   * song's cycle, and whether that tick is inside it. Null for an absent
   * slot, a `none` part or an index naming no region.
   */
  regionStepAt(slot: number, region: number, tick: number): RegionStep | null {
    return this.built.bindings.get(slot)?.regionStepAt(region, tick) ?? null;
  }

  /**
   * The part on `slot` plays `lanes` from the next tick (windsor#488): its
   * gate reads the sequencer lanes among them its kind offers, and a lane
   * turned off or gone hands the config's value back. Nothing restarts; the
   * other lanes are the automation player's. A slot the song lacks is ignored.
   */
  setLanes(slot: number, lanes: readonly AutomationLane[]): void {
    const part = this.bySlot.get(slot);
    if (!part || this.lanes.get(slot) === lanes) return;
    this.lanes.set(slot, lanes);
    this.built.bindings.get(slot)?.reconfigureGate(partGateConfig(this.current, part, lanes));
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
    setSongClock(this.transport, merged);
    this.presets = plan.presets;
    for (const [slot, patch] of plan.patchChanges) this.parts.get(slot)?.setPatch(patch);
    for (const slot of plan.removed) this.detach(slot);
    // Only a part that was already sounding is cut; a part just added has nothing to cut.
    for (const slot of plan.cut) this.parts.get(slot)?.allNotesOff();
    for (const binding of plan.retired) binding.dispose();
    for (const [part, patch] of plan.added) this.parts.add?.(part, patch);
    this.built = plan.built;
    this.current = merged;
    this.index();
    for (const binding of plan.fresh) binding.attach();
    // The meter first, so a part edit in the same partial counts bars of the new one.
    for (const binding of this.built.bindings.values()) binding?.setMeter(merged.transport.meter);
    for (const change of plan.changes) change.commit();
    // Regions, song length and harmony are live on every gate (#705): the next tick reads them.
    for (const part of merged.parts) {
      const config = partGateConfig(merged, part, this.lanes.get(part.slot));
      this.built.bindings.get(part.slot)?.reconfigureGate(config);
    }
    return { ok: true, ignored };
  }

  /** Release everything sounding — every pitched part's held notes included. Mute and teardown call this. */
  releaseAll(time = 0): void {
    for (const binding of this.built.bindings.values()) binding?.release(0, time);
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
    for (const binding of this.built.bindings.values()) binding?.reset();
  }

  dispose(): void {
    this.unfollow();
    for (const binding of this.built.bindings.values()) binding?.dispose();
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
    for (const binding of this.built.bindings.values()) binding?.jump(event.tick, event.time);
  }

  /**
   * A part leaving the arrangement live (#629): its held note released, its
   * subscription and bookkeeping dropped, everything sounding cut, and the
   * part handed back to the host to dispose. Nothing else is touched.
   */
  private detach(slot: number): void {
    const binding = this.built.bindings.get(slot);
    binding?.release(0, 0);
    binding?.dispose();
    this.counters.delete(slot);
    this.announced.delete(slot);
    this.lanes.delete(slot);
    this.parts.get(slot)?.allNotesOff();
    this.parts.remove?.(slot);
  }

  private index(): void {
    this.bySlot = new Map(this.current.parts.map((part) => [part.slot, part]));
  }

  private buildAll(arrangement: Arrangement): Built {
    const sampler = new ScaleSampler(arrangement.harmony);
    const bindings = new Map<number, PartBinding | null>();
    for (const part of arrangement.parts) {
      bindings.set(part.slot, this.bind(arrangement, part, sampler));
    }
    return { sampler, bindings };
  }

  /** The part's generators behind its gate, their events pointed at the part on its slot. */
  private bind(
    arrangement: Arrangement,
    part: MusicPart,
    sampler: ScaleSampler,
  ): PartBinding | null {
    const { slot } = part;
    const config = partGateConfig(arrangement, part, this.lanes.get(slot));
    return PartBinding.create(this.transport, part, config, sampler, {
      note: (event) => this.pitched(slot, event),
      onset: (event, spec) => this.percussion(slot, spec, event),
      figureOf: (leader) => this.built.bindings.get(leader)?.figure() ?? null,
    });
  }

  /** Everything `apply` will change, validated and constructed before anything is touched. */
  private plan(merged: Arrangement, presets: Record<string, Patch>): Plan {
    validateArrangement(merged, presets);
    const keyChanged =
      sig([merged.harmony.root, merged.harmony.scale]) !==
      sig([this.current.harmony.root, this.current.harmony.scale]);
    const sampler = keyChanged ? new ScaleSampler(merged.harmony) : this.built.sampler;

    const removed = new Set<number>();
    for (const { slot } of this.current.parts) {
      if (!merged.parts.some((part) => part.slot === slot)) removed.add(slot);
    }
    const bindings = new Map<number, PartBinding | null>();
    const fresh: PartBinding[] = [];
    const retired: PartBinding[] = [];
    const changes: BindingChange[] = [];
    const cut = new Set<number>();
    const added: Array<readonly [MusicPart, Patch]> = [];
    for (const next of merged.parts) {
      const before = this.bySlot.get(next.slot);
      const current = this.built.bindings.get(next.slot) ?? null;
      if (before && before.sequencer.kind === next.sequencer.kind) {
        // The kind holds: the binding keeps what it can, region by region.
        bindings.set(next.slot, current);
        const change = current?.plan(next, sampler);
        if (change) changes.push(change);
        if (change?.restart) cut.add(next.slot);
        continue;
      }
      if (before) {
        cut.add(next.slot);
        if (current) retired.push(current);
      } else {
        // A part on a slot the arrangement lacked (#629) is built like a
        // rebuilt one; it needs a host that can create parts.
        if (!this.parts.add) {
          throw new Error(`${partLabel(next)}: this host builds parts only at init`);
        }
        added.push([next, clonePatch(presetFor(presets, partLabel(next), next.preset))]);
      }
      const binding = this.bind(merged, next, sampler);
      bindings.set(next.slot, binding);
      if (binding) fresh.push(binding);
    }
    const built: Built = { sampler, bindings };
    const patchChanges = this.patchChanges(merged, presets);
    return { built, fresh, retired, changes, cut, patchChanges, added, removed, presets };
  }

  /** A part takes a fresh patch when its preset switched, or when the patch it plays was edited in this partial. */
  private patchChanges(
    merged: Arrangement,
    presets: Record<string, Patch>,
  ): Array<readonly [number, Patch]> {
    const changes: Array<readonly [number, Patch]> = [];
    for (const next of merged.parts) {
      const before = this.bySlot.get(next.slot);
      if (!before) continue;
      const switched = next.preset !== before.preset;
      const edited = lookupPreset(presets, next.preset) !== lookupPreset(this.presets, next.preset);
      if (switched || edited) {
        changes.push([next.slot, clonePatch(presetFor(presets, partLabel(next), next.preset))]);
      }
    }
    return changes;
  }

  /**
   * A Euclidean onset, at the note and hold of the spec that played it: its
   * region's (windsor#74). Its lanes give it an accent, a pitch and offsets,
   * and its step's ratchet splits it into a roll of hits spaced evenly
   * across the step's swung span, each held at most its spacing. Where its
   * region ends or the loop jumps inside the step, the hits from there on
   * drop and no hold crosses it (windsor#355, `rollSpan.ts`). A plain hit is
   * one `trigger` at the spec's note and hold, as before.
   */
  private percussion(slot: number, spec: SequencerSpec, event: OnsetEvent): void {
    const config = this.bySlot.get(slot);
    const part = this.parts.get(slot);
    if (!config || !part || spec.kind !== 'euclidean') return;
    const read = euclidHitRead(spec, event.step, event.localStep);
    const { note, velocity, extras } = euclidNoteOn(read, spec.note, config.velocity);
    const { divisor, hold } = spec;
    const { ratchet } = read;
    const plain = [{ offset: 0, held: hold }];
    const hits = ratchet > 1 ? this.rollHits(config, { divisor, hold, ratchet }, event) : plain;
    for (const { offset, held } of hits) {
      part.trigger(note, velocity, held, event.time + offset, extras);
      this.count(config, event.tick);
    }
  }

  /**
   * A roll's hits, Euclid's, Grid's or Arp's, cut where the part's region
   * ends or the loop jumps inside the step (`rollSpan.ts`). The swing's
   * phase is the transport tick's and the gate hands a generator only its
   * local tick, so the tick read is `follow`'s, which hears every tick first.
   */
  private rollHits(part: MusicPart, roll: RollShape, clock: OnsetEvent | NoteRoll): RollHit[] {
    return rollHits({
      ...roll,
      tick: this.lastTick ?? 0,
      regions: part.regions,
      songTicks: songTicksOf(this.current),
      loop: this.transport.loop ?? null,
      secondsPerTick: clock.secondsPerTick,
      swing: playableSwing(this.transport.swing),
      beats: meterBeats(this.current.transport.meter),
    });
  }

  /**
   * A pitched note-on, its accent, slide (#602) and step's offsets
   * (windsor#17) riding in as extras; a ratcheted Grid or Arp step's rolls
   * across the step (windsor#366, `pitchedRoll.ts`).
   */
  private pitched(slot: number, event: NoteEvent): void {
    const config = this.bySlot.get(slot);
    const part = this.parts.get(slot);
    if (!config || !part) return;
    if (event.kind === 'noteOff') return part.noteOffByNote(event.note, event.time);
    const { roll } = event;
    const hits = roll ? this.rollHits(config, pitchedRollShape(roll), roll) : PLAIN_HIT;
    playPitched(part, event, hits, config.velocity);
    this.count(config, event.tick, hits.length);
  }

  private count(part: MusicPart, tick: number, notes = 1): void {
    this.counters.set(part.slot, (this.counters.get(part.slot) ?? 0) + notes);
    if (this.announced.has(part.slot)) return;
    this.announced.add(part.slot);
    this.onEvent?.(part, tick);
  }
}
