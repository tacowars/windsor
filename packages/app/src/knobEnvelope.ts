/**
 * Which Roll clip envelope, if any, moves a patch knob (windsor#725, epic
 * windsor#699): the pure half of the knob's env ring. A song lane is
 * absolute and locks its knob (`knobAutomation.ts`); a clip envelope is
 * relative, an offset over the patch's own value, so its knob stays live and
 * a second ring shows the value playing now (`knob.ts`, `knobLock.ts`).
 *
 * The ring shows exactly what the engine plays, by asking the engine's own
 * decisions, never restating them:
 * - an envelope plays when `envelopeHeard` says so, over its roll's loop;
 * - of a roll's envelopes, only those `admittedEnvelopes` gives a voice slot
 *   sound, in the roll's order, after the part's song lanes have theirs, and
 *   only on a target the patch lets an offset move (`voiceTargetSounds`: no
 *   macro maps it, and the patch has a value there);
 * - the transport tick is placed in a region, and at its local tick, by
 *   `regionState`, the rule the roll's performer and its envelopes play by.
 *
 * A knob shows the ring while any of its part's rolls (`part.sequencer`, or
 * a region's own `pattern` as `regionPattern` reads it) admits an envelope on
 * its target. While the transport runs inside a region whose roll admits it,
 * the playing value is the centre with the envelope's offset at the region's
 * loop tick worked through the target's row (`stepModValue`), as the
 * engine's voice applies it; otherwise it is the centre itself.
 *
 * The centre is the patch's value, or, under a song lane on the same target
 * that is on, the lane's value at the song tick: the lane's lock wins the
 * knob, and the engine adds the envelope's offset over the lane's
 * (`clipEnvelopeWindow.ts`).
 *
 * The knob asks again on every frame of the playhead's loop. What a part's
 * rolls hold on each target is worked out once per part object, and what
 * they admit once per part and patch (a patch edit commits a new document,
 * so a new part); the answer is written into the caller's `out`.
 */
import type {
  AutomationLane,
  AutomationTargetRow,
  DocumentPart,
  Patch,
  RollEnvelope,
  SequencerSpec,
  VoiceTargetRow,
} from '@windsor/engine';
import {
  FM_LANES_MAX,
  admittedEnvelopes,
  catalogRow,
  envelopeHeard,
  envelopeValueAt,
  macroMapsTarget,
  regionPattern,
  regionState,
  stepModValue,
  valueAt,
  voicePathOf,
  voiceTargetId,
  voiceTargetRow,
  voiceTargetSounds,
} from '@windsor/engine';
import { songTickOf } from './transportModel';

/** What an env-ringed knob shows: the centre the envelope moves around, and the value playing now. */
export interface KnobEnvelope {
  base: number;
  playing: number;
}

/** A fresh answer for `knobEnvelopeAt` to fill: one per knob, reused frame after frame. */
export const emptyKnobEnvelope = (): KnobEnvelope => ({ base: 0, playing: 0 });

/** What a knob's envelope is read against: the part, the patch it plays and the clock. */
export interface KnobEnvelopeQuery {
  /** The selected part. */
  part: DocumentPart | undefined;
  /** The working patch: its macros and values decide what an envelope can move. */
  patch: Patch;
  /** The knob's patch path (`filter.cutoff`, `macros.2.value`). */
  path: string;
  /** The working patch's value at `path`: the centre, under no lane. */
  base: number;
  /** The transport's tick (`ConsoleTransport.position`), running or not. */
  tick: number;
  /** Whether the transport runs: stopped or paused, the ring rests at the centre. */
  running: boolean;
  /** The song's length in ticks (`songTicksOf`). */
  songTicks: number;
}

/** A roll's envelopes and its loop. */
interface Roll {
  readonly envelopes: readonly RollEnvelope[];
  readonly loopTicks: number;
}

/** What a part's rolls hold on one target, worked out once per part. */
interface TargetEnvelopes {
  readonly row: VoiceTargetRow;
  /** Per region of the part, the envelope its roll plays on the target, or null. */
  readonly regions: readonly (RollEnvelope | null)[];
  /** The part's song lane on the target while it is on, and its row. */
  readonly lane: AutomationLane | undefined;
  readonly laneRow: AutomationTargetRow | undefined;
}

/** What a part's rolls hold, worked out once per part object. */
export interface PartEnvelopes {
  /** Per region, the roll it plays when that roll has an envelope that plays; null otherwise. */
  readonly rolls: readonly (Roll | null)[];
  /** The part's own roll, which no region may play. */
  readonly own: Roll | null;
  /** The part's song lanes on voice targets that are on: the slots they hold. */
  readonly lanes: readonly AutomationLane[];
  /** Only the targets a roll's envelope plays on. */
  readonly targets: ReadonlyMap<string, TargetEnvelopes>;
}

/** The roll `spec` plays when it has an envelope that plays; null otherwise. */
function heardRoll(spec: SequencerSpec): Roll | null {
  if (spec.kind !== 'roll') return null;
  const envelopes = spec.envelopes ?? [];
  return envelopes.some((e) => envelopeHeard(e, spec.loopTicks))
    ? { envelopes, loopTicks: spec.loopTicks }
    : null;
}

/** The envelope `roll` plays on `path`, or null. */
const playedOn = (roll: Roll | null, path: string): RollEnvelope | null =>
  roll?.envelopes.find((e) => e.target === path && envelopeHeard(e, roll.loopTicks)) ?? null;

/** Whether `lane` is on with a point: the song lanes the automation player plays. */
const laneOn = (lane: AutomationLane): boolean => lane.on && lane.points.length > 0;

/** What the part's rolls hold, target by target: only the targets one of them plays. */
export function partEnvelopeTargets(part: DocumentPart): PartEnvelopes {
  const rolls = part.regions.map((_, i) => heardRoll(regionPattern(part, i)));
  const own = heardRoll(part.sequencer);
  const lanes = (part.automation ?? []).filter(
    (lane) => laneOn(lane) && voicePathOf(lane.target) !== undefined,
  );
  const paths = new Set<string>();
  for (const roll of [own, ...rolls]) {
    for (const e of roll?.envelopes ?? []) if (playedOn(roll, e.target)) paths.add(e.target);
  }
  const targets = new Map<string, TargetEnvelopes>();
  for (const path of paths) {
    const row = voiceTargetRow(path);
    if (!row) continue;
    const lane = lanes.find((l) => l.target === voiceTargetId(path));
    targets.set(path, {
      row,
      regions: rolls.map((roll) => playedOn(roll, path)),
      lane,
      laneRow: lane ? catalogRow(lane.target) : undefined,
    });
  }
  return { rolls, own, lanes, targets };
}

/** What `patch` lets a part's rolls play: per region, and anywhere. */
interface Admitted {
  readonly patch: Patch;
  /** Per region, the targets its roll's envelopes take a voice slot on. */
  readonly regions: readonly (readonly string[])[];
  /** The targets any of the part's rolls takes a slot on. */
  readonly shown: ReadonlySet<string>;
}

/** The targets `roll`'s envelopes take a voice slot on under `patch`, from a fresh start. */
function admittedIn(roll: Roll | null, lanes: readonly AutomationLane[], patch: Patch): string[] {
  if (!roll) return [];
  return admittedEnvelopes({
    lanes,
    held: [],
    envelopes: roll.envelopes,
    loopTicks: roll.loopTicks,
    slots: FM_LANES_MAX,
    sounds: (path) => voiceTargetSounds(patch, path),
  });
}

/** What the part's rolls admit under `patch`. */
function admittedBy(held: PartEnvelopes, patch: Patch): Admitted {
  // A lane on a target a macro maps has no handle, and holds no slot.
  const lanes = held.lanes.filter((lane) => !macroMapsTarget(patch, voicePathOf(lane.target)!));
  const regions = held.rolls.map((roll) => admittedIn(roll, lanes, patch));
  const shown = new Set([...regions.flat(), ...admittedIn(held.own, lanes, patch)]);
  return { patch, regions, shown };
}

interface Cached {
  readonly held: PartEnvelopes;
  admitted: Admitted | null;
}

const CACHE = new WeakMap<DocumentPart, Cached>();

/** `partEnvelopeTargets` once per part object, and what it admits once per patch. */
function cachedFor(part: DocumentPart, patch: Patch, build: typeof partEnvelopeTargets): Cached {
  let cached = CACHE.get(part);
  if (!cached) CACHE.set(part, (cached = { held: build(part), admitted: null }));
  if (cached.admitted?.patch !== patch) cached.admitted = admittedBy(cached.held, patch);
  return cached;
}

/**
 * The envelope's value (−1..1) the part plays on `path` at transport tick
 * `tick`: in the region `regionState` places the tick in, at its local tick
 * mod its roll's loop, when that roll's envelope there takes a slot; 0
 * otherwise.
 */
function envelopeValueNow(query: KnobEnvelopeQuery, cached: Cached, held: TargetEnvelopes): number {
  const { part, path, songTicks, tick } = query;
  const state = regionState(part!.regions, songTicks, tick);
  if (!state.live || !cached.admitted!.regions[state.index]!.includes(path)) return 0;
  const envelope = held.regions[state.index];
  const roll = cached.held.rolls[state.index];
  if (!envelope || !roll) return 0;
  return envelopeValueAt(envelope, state.localTick % roll.loopTicks, roll.loopTicks);
}

/**
 * The env ring of the knob `query` names, written into `out`: null when no
 * roll of the part takes a voice slot on its target.
 */
export function knobEnvelopeAt(
  query: KnobEnvelopeQuery,
  out: KnobEnvelope = emptyKnobEnvelope(),
  build: typeof partEnvelopeTargets = partEnvelopeTargets,
): KnobEnvelope | null {
  const { part, path, tick, songTicks } = query;
  if (!part) return null;
  const cached = cachedFor(part, query.patch, build);
  const held = cached.held.targets.get(path);
  if (!held || !cached.admitted!.shown.has(path)) return null;
  const { lane, laneRow } = held;
  const base =
    lane && laneRow ? valueAt(laneRow, lane.points, songTickOf(tick, songTicks)) : query.base;
  const value = query.running ? envelopeValueNow(query, cached, held) : 0;
  out.base = base;
  out.playing = stepModValue(held.row, base, value);
  return out;
}
