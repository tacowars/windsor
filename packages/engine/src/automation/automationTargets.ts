/**
 * The automation catalog's lookups (windsor#341, record
 * `2026-10-01-song-automation-lanes` decision 2): target ids taken apart and
 * put together, and the row behind each one. The rows are data in
 * `automationTargetTables.ts` and `automationInsertTables.ts`.
 *
 * A target id is relative to the part that owns the lane:
 * - `strip.level`, `strip.pan`, `strip.send.a`, `strip.send.b`;
 * - `insert.<insertId>.<field>`, the insert's stable id (`inserts/insertIds.ts`,
 *   which holds no dot) and a field one of the kinds automates, `bands.3.freq`
 *   among them;
 * - `voice.<patch path>`, one of the 29 voice rows.
 *
 * Whether an insert id names an insert of a kind that has the field is the
 * part's to say: `insertTargetRow` takes the kind. `automationTargets.test.ts`
 * round-trips every id.
 */
import type { InsertKindName } from '../inserts/insertRegistry';
import { INSERT_AUTOMATION_FIELDS } from './automationInsertTables';
import type {
  AutomationTargetId,
  AutomationTargetKind,
  AutomationTargetRow,
  ParsedTarget,
} from './automationLane';
import { STRIP_AUTOMATION_ROWS, VOICE_AUTOMATION_ROWS } from './automationTargetTables';

const STRIP_PREFIX = 'strip.';
const INSERT_PREFIX = 'insert.';
const VOICE_PREFIX = 'voice.';

const byTarget = (rows: readonly AutomationTargetRow[]): ReadonlyMap<string, AutomationTargetRow> =>
  new Map(rows.map((row) => [row.target, row]));

const STRIP_ROWS = byTarget(STRIP_AUTOMATION_ROWS);
const VOICE_ROWS = byTarget(VOICE_AUTOMATION_ROWS);
const INSERT_ROWS = new Map(
  Object.entries(INSERT_AUTOMATION_FIELDS).map(([kind, rows]) => [kind, byTarget(rows)]),
);
/** Every field some insert kind automates. */
const INSERT_FIELDS: ReadonlySet<string> = new Set(
  Object.values(INSERT_AUTOMATION_FIELDS).flatMap((rows) => rows.map((row) => row.target)),
);

/** Every strip target id, in the mixer's order. */
export const STRIP_TARGET_IDS: readonly AutomationTargetId[] = STRIP_AUTOMATION_ROWS.map(
  (row) => row.target,
);

/** Every voice target id, in the catalog's order. */
export const VOICE_TARGET_IDS: readonly AutomationTargetId[] = VOICE_AUTOMATION_ROWS.map(
  (row) => row.target as AutomationTargetId,
);

/** Which family a target belongs to, by its prefix. */
export function targetKind(id: AutomationTargetId): AutomationTargetKind {
  if (id.startsWith(STRIP_PREFIX)) return 'strip';
  if (id.startsWith(INSERT_PREFIX)) return 'insert';
  return 'voice';
}

/** An insert id a target may carry: non-empty, no dot. */
const insertIdFits = (insertId: string): boolean => insertId.length > 0 && !insertId.includes('.');

/** `id` taken apart, or undefined when the catalog has no such target. */
export function parseTargetId(id: string): ParsedTarget | undefined {
  if (id.startsWith(STRIP_PREFIX)) {
    return STRIP_ROWS.has(id) ? { kind: 'strip', field: id.slice(STRIP_PREFIX.length) } : undefined;
  }
  if (id.startsWith(VOICE_PREFIX)) {
    return VOICE_ROWS.has(id) ? { kind: 'voice', path: id.slice(VOICE_PREFIX.length) } : undefined;
  }
  if (!id.startsWith(INSERT_PREFIX)) return undefined;
  const rest = id.slice(INSERT_PREFIX.length);
  const dot = rest.indexOf('.');
  if (dot < 0) return undefined;
  const insertId = rest.slice(0, dot);
  const field = rest.slice(dot + 1);
  if (!insertIdFits(insertId) || !INSERT_FIELDS.has(field)) return undefined;
  return { kind: 'insert', insertId, field };
}

/** A parsed target as its id. Throws on a target the catalog does not hold. */
export function formatTargetId(target: ParsedTarget): AutomationTargetId {
  const id: AutomationTargetId =
    target.kind === 'strip'
      ? (`${STRIP_PREFIX}${target.field}` as AutomationTargetId)
      : target.kind === 'voice'
        ? `${VOICE_PREFIX}${target.path}`
        : `${INSERT_PREFIX}${target.insertId}.${target.field}`;
  const back = parseTargetId(id);
  if (!back || !sameTarget(back, target)) {
    throw new RangeError(`formatTargetId: no automation target ${JSON.stringify(target)}`);
  }
  return id;
}

function sameTarget(a: ParsedTarget, b: ParsedTarget): boolean {
  if (a.kind === 'strip' && b.kind === 'strip') return a.field === b.field;
  if (a.kind === 'voice' && b.kind === 'voice') return a.path === b.path;
  if (a.kind === 'insert' && b.kind === 'insert') {
    return a.insertId === b.insertId && a.field === b.field;
  }
  return false;
}

/** A strip or voice target's row. */
export function catalogRow(id: string): AutomationTargetRow | undefined {
  return STRIP_ROWS.get(id) ?? VOICE_ROWS.get(id);
}

/** An insert kind's row for `field`, or undefined when the kind does not automate it. */
export function insertTargetRow(
  kind: InsertKindName,
  field: string,
): AutomationTargetRow | undefined {
  return INSERT_ROWS.get(kind)?.get(field);
}

/**
 * Any target's row. An insert target needs its insert's kind, which the part
 * knows: `insertKindOf` answers it from the insert's id.
 */
export function targetRow(
  id: string,
  insertKindOf?: (insertId: string) => InsertKindName | undefined,
): AutomationTargetRow | undefined {
  const parsed = parseTargetId(id);
  if (!parsed) return undefined;
  if (parsed.kind !== 'insert') return catalogRow(id);
  const kind = insertKindOf?.(parsed.insertId);
  return kind === undefined ? undefined : insertTargetRow(kind, parsed.field);
}
