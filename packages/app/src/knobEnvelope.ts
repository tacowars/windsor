/**
 * Which Roll clip envelope, if any, moves a patch knob (windsor#725, epic
 * windsor#699): the pure half of the knob's env ring. A song lane is
 * absolute and locks its knob (`knobAutomation.ts`); a clip envelope is
 * relative, an offset over the patch's own value, so its knob stays live and
 * a second ring shows the value playing now (`knob.ts`, `knobLock.ts`).
 *
 * A knob shows the ring while any of its part's rolls (`part.sequencer`, or
 * a region's own `pattern` as `regionPattern` reads it) holds an envelope on
 * its target that is on and has a point inside that roll's loop. While the
 * transport runs inside a region whose roll plays such an envelope, the
 * playing value is the centre with the envelope's offset at the region's
 * loop tick worked through the target's row (`stepModValue`), as the
 * engine's voice applies it; otherwise it is the centre itself.
 *
 * The centre is the patch's value, or, under a song lane on the same target
 * that is on, the lane's value at the song tick: the lane's lock wins the
 * knob, and the engine adds the envelope's offset over the lane's
 * (`clipEnvelopeWindow.ts`). A target a macro mapping covers is held by its
 * macro (windsor#561), and the engine ignores an envelope there: no ring.
 *
 * The knob asks again on every frame of the playhead's loop, so nothing here
 * allocates per call: what a part's rolls hold on each target is worked out
 * once per part object (the document is immutable, so a new part is the only
 * change) and the answer is written into the caller's `out`.
 */
import type {
  AutomationLane,
  AutomationTargetRow,
  DocumentPart,
  Macro,
  RollEnvelope,
  SequencerSpec,
  VoiceTargetRow,
} from '@windsor/engine';
import {
  catalogRow,
  envelopeValueAt,
  isInfiniteRegion,
  regionPattern,
  stepModValue,
  valueAt,
  voiceTargetId,
  voiceTargetRow,
} from '@windsor/engine';
import { songTickOf } from './transportModel';

/** What an env-ringed knob shows: the centre the envelope moves around, and the value playing now. */
export interface KnobEnvelope {
  base: number;
  playing: number;
}

/** A fresh answer for `knobEnvelopeAt` to fill: one per knob, reused frame after frame. */
export const emptyKnobEnvelope = (): KnobEnvelope => ({ base: 0, playing: 0 });

/** What a knob's envelope is read against: the part, the working patch's macros and the clock. */
export interface KnobEnvelopeQuery {
  /** The selected part. */
  part: DocumentPart | undefined;
  /** The working patch's macros: a target one maps shows no ring. */
  macros: readonly Macro[];
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

/** The envelope a region's roll plays on one target, and that roll's loop. */
interface RegionEnvelope {
  readonly envelope: RollEnvelope;
  readonly loopTicks: number;
}

/** What a part's rolls hold on one target, worked out once per part. */
interface TargetEnvelopes {
  readonly row: VoiceTargetRow;
  /** Per region of the part, the envelope its roll plays on the target, or null. */
  readonly regions: readonly (RegionEnvelope | null)[];
  /** The part's song lane on the target while it is on, and its row. */
  readonly lane: AutomationLane | undefined;
  readonly laneRow: AutomationTargetRow | undefined;
}

/**
 * Whether `envelope` is heard over a loop of `loopTicks`: on, with a point
 * inside the loop. The engine's `envelopeHeard`, which its index does not
 * export; the points' ticks strictly increase, so the first is the earliest.
 */
export const envelopeHeardIn = (envelope: RollEnvelope, loopTicks: number): boolean =>
  envelope.on && envelope.points.length > 0 && envelope.points[0]!.tick < loopTicks;

/** The envelopes `spec` plays that are heard, by target, when it is a roll. */
function heardEnvelopes(spec: SequencerSpec): Map<string, RegionEnvelope> {
  const out = new Map<string, RegionEnvelope>();
  if (spec.kind !== 'roll') return out;
  for (const envelope of spec.envelopes ?? []) {
    if (envelopeHeardIn(envelope, spec.loopTicks)) {
      out.set(envelope.target, { envelope, loopTicks: spec.loopTicks });
    }
  }
  return out;
}

/** The part's song lane on `path`'s target while it is on and has points. */
function onVoiceLane(part: DocumentPart, path: string): AutomationLane | undefined {
  const target = voiceTargetId(path);
  const lane = part.automation?.find((l) => l.target === target);
  return lane?.on === true && lane.points.length > 0 ? lane : undefined;
}

/** What the part's rolls hold, target by target: only the targets one of them moves. */
export function partEnvelopeTargets(part: DocumentPart): ReadonlyMap<string, TargetEnvelopes> {
  const perRegion = part.regions.map((_, i) => heardEnvelopes(regionPattern(part, i)));
  const paths = new Set(heardEnvelopes(part.sequencer).keys());
  for (const held of perRegion) for (const path of held.keys()) paths.add(path);
  const targets = new Map<string, TargetEnvelopes>();
  for (const path of paths) {
    const row = voiceTargetRow(path);
    if (!row) continue;
    const lane = onVoiceLane(part, path);
    targets.set(path, {
      row,
      regions: perRegion.map((held) => held.get(path) ?? null),
      lane,
      laneRow: lane ? catalogRow(lane.target) : undefined,
    });
  }
  return targets;
}

const CACHE = new WeakMap<DocumentPart, ReadonlyMap<string, TargetEnvelopes>>();

/** `partEnvelopeTargets`, once per part object. */
function cachedTargets(
  part: DocumentPart,
  build: typeof partEnvelopeTargets,
): ReadonlyMap<string, TargetEnvelopes> {
  let targets = CACHE.get(part);
  if (!targets) CACHE.set(part, (targets = build(part)));
  return targets;
}

/** Whether a mapping of `macros` covers `path`: its macro holds the knob, and the engine ignores an envelope there. */
function macroMaps(macros: readonly Macro[], path: string): boolean {
  for (const macro of macros) {
    for (const mapping of macro.mappings) if (mapping.target === path) return true;
  }
  return false;
}

/** The envelope's value (−1..1) a region plays at its local tick, or 0 with none. */
const valueIn = (held: RegionEnvelope | null | undefined, localTick: number): number =>
  held ? envelopeValueAt(held.envelope, localTick % held.loopTicks, held.loopTicks) : 0;

/**
 * The envelope's value (−1..1) the part plays at transport tick `tick`:
 * the region the tick is in by `regionState`'s rule (the ∞ region free-running
 * on the transport tick, any other read from its own start in the song
 * folded by its length), at its local tick mod its roll's loop; 0 outside
 * the regions or in one whose roll plays no envelope on the target.
 */
function envelopeValueNow(
  part: DocumentPart,
  held: TargetEnvelopes,
  songTicks: number,
  tick: number,
): number {
  const { regions } = part;
  if (!(songTicks > 0)) return 0;
  if (isInfiniteRegion(regions, songTicks)) return valueIn(held.regions[0], tick);
  const songTick = songTickOf(tick, songTicks);
  for (let index = 0; index < regions.length; index++) {
    const region = regions[index]!;
    const localTick = songTick - region.start;
    if (localTick >= 0 && localTick < region.duration) {
      return valueIn(held.regions[index], localTick);
    }
  }
  return 0;
}

/**
 * The env ring of the knob `query` names, written into `out`: null when no
 * roll of the part moves its target, or a macro mapping holds it.
 */
export function knobEnvelopeAt(
  query: KnobEnvelopeQuery,
  out: KnobEnvelope = emptyKnobEnvelope(),
  build: typeof partEnvelopeTargets = partEnvelopeTargets,
): KnobEnvelope | null {
  const { part, path, tick, songTicks } = query;
  if (!part) return null;
  const held = cachedTargets(part, build).get(path);
  if (!held || macroMaps(query.macros, path)) return null;
  const { lane, laneRow } = held;
  const base =
    lane && laneRow ? valueAt(laneRow, lane.points, songTickOf(tick, songTicks)) : query.base;
  const value = query.running ? envelopeValueNow(part, held, songTicks, tick) : 0;
  out.base = base;
  out.playing = stepModValue(held.row, base, value);
  return out;
}
