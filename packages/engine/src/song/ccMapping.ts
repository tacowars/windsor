/**
 * A MIDI CC mapping (windsor#780, record `2026-10-13-midi-cc-mapping`): which
 * controller knob moves which of one part's targets, over what range, and the
 * pure shaping between a CC value and the target's value. Nothing here plays:
 * the console's router applies the value, and the song saves the mapping.
 *
 * - **The target** (decision 1) is a row of the automation catalog, by the
 *   lane target id it already has: the strip's four rows, an insert's
 *   continuous field, a voice row or a macro. An insert's switch rows, its
 *   enum and stepped fields (which the catalog never lists) and the
 *   sequencer's `seq.` rows are not mappable (`isCcMappableTarget`). Whether
 *   the part holds that insert, or a patch's macro already maps that voice
 *   target, is the part's to say.
 * - **The shaping** (decisions 3 and 5): `x = cc / 127`, or `1 − cc / 127`
 *   inverted, spreads across min..max in the knob's own scale, through the
 *   lane's display space (`automationDisplay.ts`): geometrically on a log,
 *   octaves or dB row, linearly on a linear one. A range wider than the row is
 *   clamped to it, and its two ends map exactly.
 * - **Under a log row's floor** display space is flat, so the value always
 *   stays inside the mapping's own range: a range wholly under the floor
 *   (the Echo's 5–10 ms) spreads linearly in the row's units instead, and a
 *   range straddling it is clamped into its ends.
 * - **`min` equal to `max`** sets that one value for every CC, and has no
 *   pickup position (the record's boundary case).
 *
 * `ccMapping.test.ts` pins the record's worked examples and the round trip.
 */
import { fromDisplay, toDisplay } from '../automation/automationDisplay';
import { insertKindFields } from '../automation/automationInsertFields';
import { INSERT_AUTOMATION_FIELDS } from '../automation/automationInsertTables';
import type {
  AutomationTargetRow,
  InsertTargetId,
  StripTargetId,
  VoiceTargetId,
} from '../automation/automationLane';
import { parseTargetId } from '../automation/automationTargets';
import type { InsertKindName } from '../inserts/insertRegistry';
import { CC_DATA_MAX } from './ccMappingTables';

/** What a mapping may move: the catalog's part targets less the sequencer's (decision 1). */
export type CcTargetId = StripTargetId | InsertTargetId | VoiceTargetId;

/** Where a mapping listens (decision 1). */
export interface CcSource {
  /** The input's name, as the MIDI selector matches it, or null for Any. */
  readonly device: string | null;
  /** 1–16, or null for Any. */
  readonly channel: number | null;
  /** The controller number, 0–127. */
  readonly cc: number;
}

/** A mapping's range and direction, in the target's own units (decision 5). */
export interface CcRange {
  readonly min: number;
  readonly max: number;
  readonly inverted: boolean;
}

/** One knob on one of a part's targets (decision 1). */
export interface CcMapping extends CcRange {
  readonly source: CcSource;
  readonly target: CcTargetId;
}

/**
 * Each insert field some kind automates, and whether all its rows are
 * continuous. A field is a switch on every kind that has it (`enabled`,
 * bloom's `freeze`, and the two under `slot.`), so all-or-nothing is exact.
 */
const INSERT_FIELD_CONTINUOUS: ReadonlyMap<string, boolean> = (() => {
  const continuous = new Map<string, boolean>();
  for (const kind of Object.keys(INSERT_AUTOMATION_FIELDS) as InsertKindName[]) {
    for (const row of insertKindFields(kind)) {
      continuous.set(row.target, (continuous.get(row.target) ?? true) && row.scale !== 'switch');
    }
  }
  return continuous;
})();

/**
 * Whether a CC may be mapped to `id` (decision 1): a strip row, a voice row or
 * macro, or an insert's continuous field. Never a switch, nor a `seq.` row.
 */
export function isCcMappableTarget(id: string): id is CcTargetId {
  const parsed = parseTargetId(id);
  if (parsed === undefined || parsed.kind === 'seq') return false;
  if (parsed.kind !== 'insert') return true;
  return INSERT_FIELD_CONTINUOUS.get(parsed.field) === true;
}

/** A new mapping's range: the target's full range (decision 5). */
export function ccDefaultRange(row: AutomationTargetRow): Pick<CcRange, 'min' | 'max'> {
  return { min: row.min, max: row.max };
}

const clampTo = (value: number, lo: number, hi: number): number =>
  value < lo ? lo : value > hi ? hi : value;

/** The mapping's two ends, CC 0's first un-inverted, each clamped into the row. */
function rangeEnds(row: AutomationTargetRow, range: CcRange): readonly [number, number] {
  return [clampTo(range.min, row.min, row.max), clampTo(range.max, row.min, row.max)];
}

/** Whether both ends sit at one display height though they differ: both under a log row's floor. */
const collapsed = (a: number, b: number, from: number, to: number): boolean =>
  a === b && from !== to;

/**
 * The target's value at controller value `cc` (decisions 3 and 5): `x` is
 * `cc / ccMax`, or `1 − cc / ccMax` inverted, clamped to 0..1, and the value
 * is the display-space blend of the range's ends at `x`, held inside them.
 * When both ends share a display height (the collapsed case) the blend is
 * linear in the row's units.
 */
export function ccValue(
  row: AutomationTargetRow,
  range: CcRange,
  cc: number,
  ccMax = CC_DATA_MAX,
): number {
  const [from, to] = rangeEnds(row, range);
  const ratio = clampTo(cc / ccMax, 0, 1);
  const x = range.inverted ? 1 - ratio : ratio;
  if (from === to || x <= 0) return from;
  if (x >= 1) return to;
  const a = toDisplay(row, from);
  const b = toDisplay(row, to);
  if (collapsed(a, b, from, to)) return from + x * (to - from);
  return clampTo(fromDisplay(row, a + x * (b - a)), Math.min(from, to), Math.max(from, to));
}

/**
 * Where on the controller, a real number in 0..`ccMax`, the mapping plays
 * `value`: the inverse of `ccValue`, with `value` first clamped into the
 * mapping's range (the record's "pickup outside the range" case), linear in
 * the collapsed case. A value between a straddling range's end and the row's
 * floor, which the display curve steps over, picks up at that end. Null only
 * when `min === max`: there is no width to cross, so no pickup.
 */
export function ccPosition(
  row: AutomationTargetRow,
  range: CcRange,
  value: number,
  ccMax = CC_DATA_MAX,
): number | null {
  const [from, to] = rangeEnds(row, range);
  if (from === to) return null;
  const held = clampTo(value, Math.min(from, to), Math.max(from, to));
  const a = toDisplay(row, from);
  const b = toDisplay(row, to);
  const x = collapsed(a, b, from, to)
    ? (held - from) / (to - from)
    : clampTo((toDisplay(row, held) - a) / (b - a), 0, 1);
  return (range.inverted ? 1 - x : x) * ccMax;
}
