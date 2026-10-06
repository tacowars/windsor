/**
 * The Song view's automation lanes, the part that needs no DOM (windsor#348;
 * record `2026-10-01-song-automation-lanes` decisions 2–4 and 13): what the
 * "+ Add lane" picker offers a part, the lane a pick adds, the on/off and
 * delete edits, how a lane is named, whether an insert lane's field is read
 * under its insert's settings, and its value at the playhead (which reads
 * through `automationReadout.ts`).
 *
 * Every edit returns the part's whole new list, since a merge replaces an
 * array wholesale, and `automationChange` wraps it as the partial the view
 * commits. The catalog, the display space and the evaluator are the
 * engine's; the curve's geometry is `songAutomationCurve.ts`. The picker,
 * a lane's row and its title take the part's patch, so a macro is offered
 * and named only as the patch defines it (windsor#559, `macroTargets.ts`).
 *
 * Every rule takes a lane owner (windsor#616, `songAutomationOwner.ts`): a
 * part, or a group bus on its folder track, whose picker offers its Level,
 * its Pan and its own inserts' fields only (`GROUP_STRIP_TARGETS`).
 */
import type {
  AutomationLane,
  AutomationTargetId,
  AutomationTargetKind,
  AutomationTargetRow,
  DocumentPartial,
  InsertKindName,
  InsertSpec,
  Patch,
  VoiceAutomationRow,
} from '@windsor/engine';
import {
  FM_LANES_MAX,
  GROUP_STRIP_TARGETS,
  OP_NAMES,
  STRIP_AUTOMATION_ROWS,
  VOICE_AUTOMATION_ROWS,
  automatableInsertFields,
  catalogRow,
  formatTargetId,
  parseTargetId,
  seqTargetIds,
  targetKind,
  targetRow,
} from '@windsor/engine';
import { INSERT_LABELS } from './insertKnobTables';
import { macroName, offersVoicePath } from './macroTargets';
import { getPath } from './patchPath';
import type { LaneOwner } from './songAutomationOwner';
import { isGroupLaneOwner, ownerInserts, ownerLanes, ownerStrip } from './songAutomationOwner';
import {
  INACTIVE_WHY,
  MIXER_GROUP_LABEL,
  SEQ_GROUP_LABEL,
  insertGroupLabel,
  voiceGroupLabel,
} from './songAutomationTables';

/** One target the picker lists: disabled when it already has a lane, or the voice is full. */
export interface PickerOption {
  readonly target: AutomationTargetId;
  readonly label: string;
  readonly disabled: boolean;
}

/** One `<optgroup>` of the picker. */
export interface PickerGroup {
  readonly label: string;
  readonly options: readonly PickerOption[];
}

/** A part's or a group's lanes; none when it has no `automation`. */
export const lanesOf = (owner: LaneOwner): readonly AutomationLane[] => ownerLanes(owner);

/** How many of `lanes` move the voice, against `FM_LANES_MAX`. */
export const voiceLaneCount = (lanes: readonly AutomationLane[]): number =>
  lanes.filter((lane) => targetKind(lane.target) === 'voice').length;

/** The mixer cell under the picker (decision 4): "Voice 3/8". */
export const voiceCountLabel = (lanes: readonly AutomationLane[]): string =>
  `Voice ${voiceLaneCount(lanes)}/${FM_LANES_MAX}`;

/** The folded part's badge: "1 lane", "2 lanes". */
export const laneCountLabel = (count: number): string => `${count} lane${count === 1 ? '' : 's'}`;

/** Each insert's label by its id: its kind's, numbered when the chain holds the kind twice. */
export function insertLabels(inserts: readonly InsertSpec[]): ReadonlyMap<string, string> {
  const total = new Map<InsertKindName, number>();
  for (const spec of inserts) total.set(spec.kind, (total.get(spec.kind) ?? 0) + 1);
  const seen = new Map<InsertKindName, number>();
  const out = new Map<string, string>();
  for (const spec of inserts) {
    if (spec.id === undefined) continue;
    const n = (seen.get(spec.kind) ?? 0) + 1;
    seen.set(spec.kind, n);
    const label = INSERT_LABELS[spec.kind];
    out.set(spec.id, (total.get(spec.kind) ?? 0) > 1 ? `${label} ${n}` : label);
  }
  return out;
}

/** The insert in `owner`'s chain with `insertId`. */
const insertOf = (owner: LaneOwner, insertId: string): InsertSpec | undefined =>
  ownerInserts(owner).find((spec) => spec.id === insertId);

/**
 * The row behind `target` on `owner`: its bounds, scale and label, a macro's
 * label the name `patch` (the part's) gives it.
 */
export function laneRow(
  owner: LaneOwner,
  target: string,
  patch?: Patch,
): AutomationTargetRow | undefined {
  const row = targetRow(target, (insertId) => insertOf(owner, insertId)?.kind);
  const parsed = parseTargetId(target);
  const name = parsed?.kind === 'voice' ? macroName(patch, parsed.path) : undefined;
  return row && name !== undefined ? { ...row, label: name } : row;
}

type OptionOf = (target: AutomationTargetId, label: string, full?: boolean) => PickerOption;

/** One group per insert in `inserts`, each listing the fields its settings leave read. */
function insertPickerGroups(inserts: readonly InsertSpec[], option: OptionOf): PickerGroup[] {
  const labels = insertLabels(inserts);
  return inserts.flatMap((spec) => {
    const insertId = spec.id;
    if (insertId === undefined) return [];
    const options = automatableInsertFields(spec).map((row) =>
      option(formatTargetId({ kind: 'insert', insertId, field: row.target }), row.label),
    );
    return [{ label: insertGroupLabel(labels.get(insertId) ?? ''), options }];
  });
}

/** The voice's groups by section, each macro `patch` defines under its name; `full` disables them all. */
function voicePickerGroups(
  patch: Patch | undefined,
  option: OptionOf,
  full: boolean,
): PickerGroup[] {
  const voice = new Map<string, PickerOption[]>();
  for (const row of VOICE_AUTOMATION_ROWS) {
    if (!offersVoicePath(patch, row.path)) continue;
    const label = voiceGroupLabel(row.section, OP_NAMES);
    const name = macroName(patch, row.path) ?? row.label;
    voice.set(label, [...(voice.get(label) ?? []), option(row.target, name, full)]);
  }
  return [...voice].map(([label, options]) => ({ label, options }));
}

/** A group bus's strip targets: its Level and its Pan (windsor#614 decision 2). */
const GROUP_STRIP: ReadonlySet<AutomationTargetId> = new Set(GROUP_STRIP_TARGETS);

/**
 * The picker's groups (decision 4): Mixer, one group per insert in the chain
 * listing the fields its settings leave read (`automatableInsertFields`),
 * then the voice's groups, then Macros with each macro `patch` (the part's)
 * defines, under its name (windsor#559), then Sequencer with the fields the
 * part's sequencer kind offers (windsor#491); a group with nothing in it is
 * left out. A group bus (windsor#616 decision 3) is offered Mixer with its
 * Level and Pan, then its inserts' groups, and nothing else: no send, voice,
 * macro or sequencer row.
 */
export function pickerGroups(owner: LaneOwner, patch?: Patch): PickerGroup[] {
  const lanes = lanesOf(owner);
  const used = new Set<string>(lanes.map((lane) => lane.target));
  const option: OptionOf = (target, label, full = false) => ({
    target,
    label,
    disabled: used.has(target) || full,
  });
  const inserts = insertPickerGroups(ownerInserts(owner), option);
  if (isGroupLaneOwner(owner)) {
    const rows = STRIP_AUTOMATION_ROWS.filter((row) => GROUP_STRIP.has(row.target));
    return [
      { label: MIXER_GROUP_LABEL, options: rows.map((row) => option(row.target, row.label)) },
      ...inserts,
    ];
  }
  const voiceFull = voiceLaneCount(lanes) >= FM_LANES_MAX;
  const mixer = STRIP_AUTOMATION_ROWS.map((row) => option(row.target, row.label));
  const seq = seqTargetIds(owner.sequencer.kind).map((target) =>
    option(target, catalogRow(target)?.label ?? target),
  );
  return [
    { label: MIXER_GROUP_LABEL, options: mixer },
    ...inserts,
    ...voicePickerGroups(patch, option, voiceFull),
    ...(seq.length > 0 ? [{ label: SEQ_GROUP_LABEL, options: seq }] : []),
  ];
}

/** Each voice row by its target id, for the section a lane's kind line names. */
const VOICE_ROWS = new Map<string, VoiceAutomationRow>(
  VOICE_AUTOMATION_ROWS.map((row) => [row.target, row]),
);

/** A lane's name and the kind line under it (decision 2): "Cutoff" over "Voice · Filter". */
export interface LaneTitle {
  readonly name: string;
  readonly kindLine: string;
  readonly kind: AutomationTargetKind;
}

export function laneTitle(owner: LaneOwner, target: AutomationTargetId, patch?: Patch): LaneTitle {
  const kind = targetKind(target);
  const name = laneRow(owner, target, patch)?.label ?? target;
  const parsed = parseTargetId(target);
  if (parsed?.kind === 'insert') {
    const kindLine = insertLabels(ownerInserts(owner)).get(parsed.insertId) ?? '';
    return { name, kindLine, kind };
  }
  if (parsed?.kind === 'voice') {
    const row = VOICE_ROWS.get(target);
    return { name, kindLine: row ? voiceGroupLabel(row.section, OP_NAMES) : '', kind };
  }
  if (parsed?.kind === 'seq') return { name, kindLine: SEQ_GROUP_LABEL, kind };
  return { name, kindLine: MIXER_GROUP_LABEL, kind };
}

/** Whether a lane's field is read, and when not, why (windsor#341's fix round). */
export type LaneActivity = { readonly active: true } | { readonly active: false; why: string };

type WhyOf = (spec: InsertSpec, field: string) => string | undefined;

/**
 * An insert lane on a field its insert's settings leave unread (Tape's
 * `wear` while split) is inactive: the song keeps it, drawn dimmed. Strip
 * and voice lanes are always active.
 */
export function laneActivity(owner: LaneOwner, target: AutomationTargetId): LaneActivity {
  const parsed = parseTargetId(target);
  if (parsed?.kind !== 'insert') return { active: true };
  const spec = insertOf(owner, parsed.insertId);
  if (!spec) return { active: true };
  if (automatableInsertFields(spec).some((row) => row.target === parsed.field)) {
    return { active: true };
  }
  const label = insertLabels(ownerInserts(owner)).get(parsed.insertId) ?? '';
  const name = laneRow(owner, target)?.label ?? parsed.field;
  // The table pairs each kind with a function over that kind's spec, and `spec` is of its own kind.
  const clause = (INACTIVE_WHY[spec.kind] as WhyOf | undefined)?.(spec, parsed.field);
  const why = clause
    ? `${name} is inactive while ${clause}`
    : `${name} is inactive under ${label}'s current settings`;
  return { active: false, why };
}

const clampTo = (row: AutomationTargetRow, value: number): number =>
  Math.min(row.max, Math.max(row.min, value));

/**
 * The parameter's value now (decision 4): from the strip (a group's own
 * level and pan, windsor#616), the insert's spec, the part's sequencer
 * (windsor#488) or its patch, clamped to the row. An insert's switch reads
 * its `enabled` as 1 or 0 (windsor#631), so its lane starts at the state the
 * insert is in. A send the strip does not name is silent; anything else
 * unread is the row's minimum.
 */
export function currentValue(
  owner: LaneOwner,
  patch: Patch | undefined,
  target: AutomationTargetId,
): number {
  const row = laneRow(owner, target);
  const parsed = parseTargetId(target);
  if (!row || !parsed) return 0;
  const part = isGroupLaneOwner(owner) ? undefined : owner;
  let raw: unknown;
  if (parsed.kind === 'strip') {
    const [section, bus] = parsed.field.split('.');
    raw =
      section === 'send'
        ? (part?.strip.sends[bus ?? ''] ?? 0)
        : getPath(ownerStrip(owner), section ?? '');
  } else if (parsed.kind === 'insert') {
    raw = getPath(insertOf(owner, parsed.insertId), parsed.field);
  } else if (parsed.kind === 'seq') {
    raw = getPath(part?.sequencer, parsed.field);
  } else {
    raw = getPath(patch, parsed.path);
  }
  if (typeof raw === 'boolean') return raw ? row.max : row.min;
  return typeof raw === 'number' && Number.isFinite(raw) ? clampTo(row, raw) : row.min;
}

/** A new lane (decision 4): on, flat at `value` from tick 0 to the song's end. */
export function newLane(
  target: AutomationTargetId,
  value: number,
  songTicks: number,
): AutomationLane {
  return {
    target,
    on: true,
    points: [
      { tick: 0, value, bend: 0 },
      { tick: songTicks, value, bend: 0 },
    ],
  };
}

/** `lanes` with `lane` appended, or unchanged when its target already has one. */
export const withLane = (
  lanes: readonly AutomationLane[],
  lane: AutomationLane,
): AutomationLane[] =>
  lanes.some((l) => l.target === lane.target) ? [...lanes] : [...lanes, lane];

/** `lanes` with the lane on `target` switched on or off. */
export const toggledLane = (
  lanes: readonly AutomationLane[],
  target: AutomationTargetId,
): AutomationLane[] => lanes.map((l) => (l.target === target ? { ...l, on: !l.on } : l));

/** `lanes` without the lane on `target`. */
export const withoutLane = (
  lanes: readonly AutomationLane[],
  target: AutomationTargetId,
): AutomationLane[] => lanes.filter((l) => l.target !== target);

/** The partial that sets `slot`'s lanes to `lanes`, whole. */
export const automationChange = (slot: number, lanes: AutomationLane[]): DocumentPartial => ({
  parts: { [slot]: { automation: lanes } },
});

/**
 * What the lanes of `owner`, a part or a group, repaint on (decision 7): its
 * lanes, and for an open owner or one with lanes, which fields each insert's
 * settings leave read, so a Split switch dims a lane and refills the picker.
 * A knob drag changes neither.
 */
export function automationSignature(owner: LaneOwner, open: boolean): unknown {
  const lanes = owner.automation?.length ? owner.automation : null;
  if (!open && lanes === null) return null;
  const inserts = ownerInserts(owner).map((spec) => [
    spec.id,
    spec.kind,
    automatableInsertFields(spec)
      .map((row) => row.target)
      .join(' '),
  ]);
  return [lanes, inserts];
}
