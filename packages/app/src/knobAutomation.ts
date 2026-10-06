/**
 * Which lane, if any, holds a knob (windsor#351; record
 * `2026-10-01-song-automation-lanes` decision 6): a knob whose parameter has
 * a lane that is on is locked, drawn in the lane's colour at the lane's value
 * at the playhead. Pure over a part of the document, so the three kinds of
 * knob resolve the same way and a test needs no DOM:
 *
 * - a strip knob (Level, Pan, a send) by its `strip.*` target;
 * - an insert knob by its insert's stable id and its field. A lane on a field
 *   its insert's settings leave unread (`automatableInsertFields`) is inert,
 *   so the knob stays free: it drives the field once the field is read again;
 * - a patch knob by its path, for the 38 voice targets only, against the
 *   selected part's lanes, so two parts sharing a patch lock independently;
 *   a knob a macro mapping covers is held by its macro first (windsor#561,
 *   record `2026-10-04-patch-macro-knobs` decision 11): a lane on the
 *   target is inert while the mapping exists;
 * - a sequencer knob (Gate, Skip, Density) by its field, while the part's
 *   sequencer kind offers that field a lane (windsor#491). Changing the kind
 *   drops the lane in the engine, so the knob frees on the next read.
 *
 * A group bus's Level, Pan and insert knobs on the Mixer tab lock under the
 * group's own lanes the same way (windsor#616 decision 4): the strip and
 * insert resolvers take any `LaneHolder`, a part or a group.
 *
 * The lock is the console's: the engine already ignores a write to a field a
 * lane holds. The knob's look and input are `knob.ts` and `knobLock.ts`.
 */
import type {
  Arrangement,
  ArrangementDocument,
  Macro,
  AutomationLane,
  AutomationTargetId,
  AutomationTargetKind,
  AutomationTargetRow,
  DocumentPart,
  InsertSpec,
  SeqField,
} from '@windsor/engine';
import {
  SEQ_AUTOMATION_FIELDS,
  SEQ_AUTOMATION_ROWS,
  VOICE_TARGET_IDS,
  automatableInsertFields,
  catalogRow,
  formatTargetId,
  partAt,
  seqTargetId,
  songTicksOf,
  targetKind,
  valueAt,
  voiceTargetId,
} from '@windsor/engine';
import { groupAt, groupIdOfKey } from './groupModel';
import type { InsertTarget } from './insertTarget';
import { macroValuePath, mappedKnob } from './macroModel';
import { LANE_KIND_COLOR } from './songAutomationTables';
import { songTickOf } from './transportModel';

/**
 * What a locked knob shows: its lane's colour and the lane's value at the
 * playhead, or, for a knob a macro mapping holds, the voice lane colour, the
 * value the mapping plays and the macro's name, which its tag reads.
 */
export interface KnobAutomation {
  readonly color: string;
  readonly value: number;
  readonly macro?: string;
}

/** The colours of the kinds a knob locks under, as `LANE_KIND_COLOR` holds them. */
export type KnobLockColors = Readonly<Record<AutomationTargetKind, string>>;

/**
 * The song tick a knob reads its lane at: the transport's `position`, which
 * counts on past the song's end, folded by the song's length as the engine's
 * automation player folds it. Every resolver below takes this tick, so a
 * knob starts its lane again where the sound does.
 */
export const knobSongTick = (doc: Arrangement, position: number): number =>
  songTickOf(position, songTicksOf(doc));

/**
 * What a knob's lanes are read from: a part, or a group bus (windsor#616),
 * whose Level, Pan and insert knobs lock under its own lanes as a part's do.
 */
export interface LaneHolder {
  readonly automation?: readonly AutomationLane[];
}

/**
 * Whose lanes hold the knobs of an insert chain: the part at a slot, the
 * group a group key (`group:3`) names, and nothing for a send bus or the
 * master, which carry no lanes.
 */
export function insertLaneHolder(
  doc: ArrangementDocument,
  target: InsertTarget,
): LaneHolder | undefined {
  if (typeof target === 'number') return partAt(doc, target);
  const id = groupIdOfKey(target);
  return id === null ? undefined : groupAt(doc, id);
}

/** The holder's lane on `target` while it is on, else undefined. */
function onLane(
  part: LaneHolder | undefined,
  target: AutomationTargetId,
): AutomationLane | undefined {
  const lane = part?.automation?.find((l) => l.target === target);
  return lane?.on === true && lane.points.length > 0 ? lane : undefined;
}

/** The lock a lane on `row` puts on its knob at `tick`, a song tick (`knobSongTick`). */
const lockOf = (
  lane: AutomationLane,
  row: AutomationTargetRow,
  color: string,
  tick: number,
): KnobAutomation => ({ color, value: valueAt(row, lane.points, tick) });

/**
 * A strip, voice or sequencer knob's lock at `tick`: null unless `part` (a
 * part, or a group for its Level and Pan) has a lane on `target` that is on.
 */
export function catalogKnobAutomation(
  part: LaneHolder | undefined,
  target: AutomationTargetId,
  tick: number,
  colors: KnobLockColors = LANE_KIND_COLOR,
): KnobAutomation | null {
  const lane = onLane(part, target);
  const row = lane ? catalogRow(target) : undefined;
  if (!lane || !row) return null;
  return lockOf(lane, row, colors[targetKind(target)], tick);
}

const VOICE_TARGETS: ReadonlySet<string> = new Set(VOICE_TARGET_IDS);

/** A patch path's voice target (`filter.cutoff` → `voice.filter.cutoff`), or null off the catalog. */
export function voiceKnobTarget(path: string): AutomationTargetId | null {
  const target = voiceTargetId(path);
  return VOICE_TARGETS.has(target) ? target : null;
}

/** A patch knob's lock at `tick`, from the lanes of `part`, the selected part. */
export function voiceKnobAutomation(
  part: DocumentPart | undefined,
  path: string,
  tick: number,
  colors: KnobLockColors = LANE_KIND_COLOR,
): KnobAutomation | null {
  const target = voiceKnobTarget(path);
  return target ? catalogKnobAutomation(part, target, tick, colors) : null;
}

/**
 * A Parts-tab knob's lock at `tick`: the macro mapping that covers `path` in
 * `macros` (the working patch's), at its macro's value or the value a lane
 * on the macro holds it at, else the lane on `path` of `part`, the selected
 * part.
 */
export function patchKnobAutomation(
  part: DocumentPart | undefined,
  macros: readonly Macro[],
  path: string,
  tick: number,
  colors: KnobLockColors = LANE_KIND_COLOR,
): KnobAutomation | null {
  const live = (index: number): number | undefined =>
    voiceKnobAutomation(part, macroValuePath(index), tick, colors)?.value;
  const mapped = mappedKnob(macros, path, live);
  if (mapped) return { color: colors.voice, value: mapped.value, macro: mapped.macro };
  return voiceKnobAutomation(part, path, tick, colors);
}

/**
 * A sequencer knob's lock at `tick`: the knob over `field` of `part`'s
 * sequencer. Null when the part's kind offers `field` no lane (a Chord's
 * Gate), or no lane on it is on.
 */
export function seqKnobAutomation(
  part: DocumentPart | undefined,
  field: SeqField,
  tick: number,
  colors: KnobLockColors = LANE_KIND_COLOR,
  fields = SEQ_AUTOMATION_FIELDS,
): KnobAutomation | null {
  if (!part || !(fields[part.sequencer.kind] ?? []).includes(field)) return null;
  return catalogKnobAutomation(part, seqTargetId(field), tick, colors);
}

/** Whether a sequencer knob's field is one a lane can hold (`gate`, `skipChance`, `density`). */
export const isSeqField = (field: string): field is SeqField =>
  SEQ_AUTOMATION_ROWS.some((row) => row.field === field);

/**
 * An insert knob's lock at `tick`: the knob over `field` of `spec`, an insert
 * in `part`'s chain (a part's strip, or a group's, `insertLaneHolder`). Null when the insert has no id, its kind does not
 * automate the field, its settings leave the field unread (the lane is
 * inert), or no lane on it is on.
 */
export function insertKnobAutomation(
  part: LaneHolder | undefined,
  spec: InsertSpec | undefined,
  field: string,
  tick: number,
  colors: KnobLockColors = LANE_KIND_COLOR,
): KnobAutomation | null {
  const insertId = spec?.id;
  if (!part?.automation?.length || !spec || !insertId) return null;
  const row = automatableInsertFields(spec).find((r) => r.target === field);
  if (!row) return null;
  const lane = onLane(part, formatTargetId({ kind: 'insert', insertId, field }));
  return lane ? lockOf(lane, row, colors.insert, tick) : null;
}

/** Whether two locks draw the same: both free, or the same colour at the same value. */
export const sameKnobAutomation = (a: KnobAutomation | null, b: KnobAutomation | null): boolean =>
  a === b ||
  (a !== null && b !== null && a.color === b.color && a.value === b.value && a.macro === b.macro);

/** What a press on a locked knob says (decision 6). */
export const lockedKnobNotice = (label: string): string =>
  `${label} is automated in the song. Switch its lane off to edit it.`;

/** What a press on a knob a macro mapping holds says (windsor#561). */
export const macroKnobNotice = (label: string, macro: string): string =>
  `${label} is driven by the macro ${macro}. Remove its mapping to edit it.`;

/** What a press on `lock`'s knob says: the macro that drives it, or its lane. */
export const lockNotice = (label: string, lock: KnobAutomation): string =>
  lock.macro === undefined ? lockedKnobNotice(label) : macroKnobNotice(label, lock.macro);

/** A locked knob's `aria-valuetext`: its readout, then ", automated". */
export const automatedValueText = (readout: string): string => `${readout}, automated`;
