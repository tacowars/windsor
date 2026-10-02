/**
 * The Song view's automation lanes, the part that needs no DOM (windsor#348;
 * record `2026-10-01-song-automation-lanes` decisions 2–4 and 13): what the
 * "+ Add lane" picker offers a part, the lane a pick adds, the on/off and
 * delete edits, how a lane is named, whether an insert lane's field is read
 * under its insert's settings, and what its value reads at the playhead.
 *
 * Every edit returns the part's whole new list, since a merge replaces an
 * array wholesale, and `automationChange` wraps it as the partial the view
 * commits. The catalog, the display space and the evaluator are the
 * engine's; the curve's geometry is `songAutomationCurve.ts`.
 */
import type {
  AutomationLane,
  AutomationTargetId,
  AutomationTargetKind,
  AutomationTargetRow,
  DocumentPart,
  DocumentPartial,
  InsertKindName,
  InsertSpec,
  Patch,
} from '@windsor/engine';
import {
  FM_LANES_MAX,
  OP_NAMES,
  STRIP_AUTOMATION_ROWS,
  VOICE_AUTOMATION_ROWS,
  automatableInsertFields,
  formatTargetId,
  parseTargetId,
  targetKind,
  targetRow,
} from '@windsor/engine';
import { INSERT_LABELS } from './insertKnobTables';
import { getPath } from './patchPath';
import {
  INACTIVE_WHY,
  MIXER_GROUP_LABEL,
  READOUT_NUMBERS,
  VOICE_GROUPS,
  insertGroupLabel,
  type ReadoutNumbers,
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

/** A part's lanes; none when it has no `automation`. */
export const lanesOf = (part: DocumentPart): readonly AutomationLane[] => part.automation ?? [];

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

/** The insert on `part`'s strip with `insertId`. */
const insertOf = (part: DocumentPart, insertId: string): InsertSpec | undefined =>
  part.strip.inserts.find((spec) => spec.id === insertId);

/** The row behind `target` on `part`: its bounds, scale and label. */
export function laneRow(part: DocumentPart, target: string): AutomationTargetRow | undefined {
  return targetRow(target, (insertId) => insertOf(part, insertId)?.kind);
}

/**
 * The picker's groups (decision 4): Mixer, one group per insert in the chain
 * listing the fields its settings leave read (`automatableInsertFields`),
 * then the voice's groups.
 */
export function pickerGroups(part: DocumentPart): PickerGroup[] {
  const lanes = lanesOf(part);
  const used = new Set<string>(lanes.map((lane) => lane.target));
  const voiceFull = voiceLaneCount(lanes) >= FM_LANES_MAX;
  const option = (target: AutomationTargetId, label: string, full = false): PickerOption => ({
    target,
    label,
    disabled: used.has(target) || full,
  });
  const labels = insertLabels(part.strip.inserts);
  const inserts = part.strip.inserts.flatMap((spec) => {
    const insertId = spec.id;
    if (insertId === undefined) return [];
    const options = automatableInsertFields(spec).map((row) =>
      option(formatTargetId({ kind: 'insert', insertId, field: row.target }), row.label),
    );
    return [{ label: insertGroupLabel(labels.get(insertId) ?? ''), options }];
  });
  const voice = VOICE_GROUPS(OP_NAMES).map((group) => ({
    label: group.label,
    options: VOICE_AUTOMATION_ROWS.filter((row) => group.claims(voicePath(row.target))).map((row) =>
      option(row.target as AutomationTargetId, row.label, voiceFull),
    ),
  }));
  const mixer = STRIP_AUTOMATION_ROWS.map((row) => option(row.target, row.label));
  return [{ label: MIXER_GROUP_LABEL, options: mixer }, ...inserts, ...voice];
}

const VOICE_PREFIX = 'voice.';
const voicePath = (target: string): string => target.slice(VOICE_PREFIX.length);

/** A lane's name and the kind line under it (decision 2): "Cutoff" over "Voice · Filter". */
export interface LaneTitle {
  readonly name: string;
  readonly kindLine: string;
  readonly kind: AutomationTargetKind;
}

export function laneTitle(part: DocumentPart, target: AutomationTargetId): LaneTitle {
  const kind = targetKind(target);
  const name = laneRow(part, target)?.label ?? target;
  const parsed = parseTargetId(target);
  if (parsed?.kind === 'insert') {
    const kindLine = insertLabels(part.strip.inserts).get(parsed.insertId) ?? '';
    return { name, kindLine, kind };
  }
  if (parsed?.kind === 'voice') {
    const group = VOICE_GROUPS(OP_NAMES).find((g) => g.claims(parsed.path));
    return { name, kindLine: group?.label ?? '', kind };
  }
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
export function laneActivity(part: DocumentPart, target: AutomationTargetId): LaneActivity {
  const parsed = parseTargetId(target);
  if (parsed?.kind !== 'insert') return { active: true };
  const spec = insertOf(part, parsed.insertId);
  if (!spec) return { active: true };
  if (automatableInsertFields(spec).some((row) => row.target === parsed.field)) {
    return { active: true };
  }
  const label = insertLabels(part.strip.inserts).get(parsed.insertId) ?? '';
  const name = laneRow(part, target)?.label ?? parsed.field;
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
 * The parameter's value now (decision 4): from the strip, the insert's spec
 * or the part's patch, clamped to the row. A send the strip does not name is
 * silent; anything else unread is the row's minimum.
 */
export function currentValue(
  part: DocumentPart,
  patch: Patch | undefined,
  target: AutomationTargetId,
): number {
  const row = laneRow(part, target);
  const parsed = parseTargetId(target);
  if (!row || !parsed) return 0;
  let raw: unknown;
  if (parsed.kind === 'strip') {
    const [section, bus] = parsed.field.split('.');
    raw =
      section === 'send' ? (part.strip.sends[bus ?? ''] ?? 0) : getPath(part.strip, section ?? '');
  } else if (parsed.kind === 'insert') {
    raw = getPath(insertOf(part, parsed.insertId), parsed.field);
  } else {
    raw = getPath(patch, parsed.path);
  }
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

/** A number signed: "+3.0", "-1.5". */
/** `value` with its sign, a value that rounds to zero as +0 (never "-0.0"). */
const signed = (value: number, decimals: number): string => {
  const shown = Number(value.toFixed(decimals)) || 0;
  return `${shown >= 0 ? '+' : ''}${shown.toFixed(decimals)}`;
};

/** A plain number with fewer decimals as it grows. */
function plain(value: number, n: ReadoutNumbers): string {
  const size = Math.abs(value);
  if (size >= n.wholeFrom) return value.toFixed(0);
  return value.toFixed(size >= n.oneDecimalFrom ? 1 : 2);
}

function hz(value: number, n: ReadoutNumbers): string {
  if (value >= n.kiloHz) return `${(value / n.kiloHz).toFixed(2)} kHz`;
  return `${plain(value, n)} Hz`;
}

function pan(value: number, n: ReadoutNumbers): string {
  const amount = Math.round(Math.abs(value) * n.panScale);
  if (amount === 0) return 'C';
  return `${value < 0 ? 'L' : 'R'}${amount}`;
}

/** A level lane's linear gain in dB, "-∞ dB" at or under its floor. */
function gainDb(row: AutomationTargetRow, value: number, n: ReadoutNumbers): string {
  if (value <= (row.floor ?? 0)) return '-∞ dB';
  return `${signed(n.dbPerDecade * Math.log10(value), 1)} dB`;
}

/** What a lane's value reads in its mixer cell, in the row's units. */
export function readout(
  row: AutomationTargetRow,
  value: number,
  n: ReadoutNumbers = READOUT_NUMBERS,
): string {
  switch (row.unit) {
    case 'dB':
      return row.scale === 'db' ? gainDb(row, value, n) : `${signed(value, 1)} dB`;
    case 'Hz':
      return hz(value, n);
    case 's':
      return value < n.secondsAsMsBelow
        ? `${(value * n.msPerSecond).toFixed(0)} ms`
        : `${value.toFixed(2)} s`;
    case 'oct':
    case 'st':
      return `${signed(value, 1)} ${row.unit}`;
    case '%':
    case '°':
      return `${value.toFixed(0)}${row.unit}`;
    case '':
      return row.target === 'strip.pan' ? pan(value, n) : plain(value, n);
    default:
      return `${plain(value, n)} ${row.unit}`;
  }
}

/**
 * What the lanes of `part` repaint on (decision 7): its lanes, and for an
 * open part or one with lanes, which fields each insert's settings leave
 * read, so a Split switch dims a lane and refills the picker. A knob drag
 * changes neither.
 */
export function automationSignature(part: DocumentPart, open: boolean): unknown {
  const lanes = part.automation?.length ? part.automation : null;
  if (!open && lanes === null) return null;
  const inserts = part.strip.inserts.map((spec) => [
    spec.id,
    spec.kind,
    automatableInsertFields(spec)
      .map((row) => row.target)
      .join(' '),
  ]);
  return [lanes, inserts];
}
