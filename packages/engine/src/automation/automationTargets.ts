/**
 * The automation catalog's lookups (windsor#341, record
 * `2026-10-01-song-automation-lanes` decision 2): target ids taken apart and
 * put together, and the row behind each one. The rows are data in
 * `automationTargetTables.ts` and `automationInsertTables.ts`; this file puts
 * each voice look under its target id, so the id format is spelled here only.
 *
 * A target id is relative to the part that owns the lane:
 * - `strip.level`, `strip.pan`, `strip.send.a`, `strip.send.b`;
 * - `insert.<insertId>.<field>`, the insert's stable id (`inserts/insertIds.ts`)
 *   and a field one of the kinds automates, `bands.3.freq` among them;
 * - `voice.<patch path>`, one of the 30 voice rows.
 *
 * An insert id is any non-empty string, dots included, so an insert target is
 * read from its end: the field is the longest field some kind automates that
 * ends the id after a dot and leaves a non-empty insert id before it, and the
 * insert id is everything between `insert.` and that field
 * (`insert.echo.main.mix` is `echo.main`'s `mix`). Where that reading would
 * give a different target, an id ending in `.stages.0` with the field `bias`,
 * say, or where the id holds a `%`, the id is written escaped, `%` as `%25` and
 * `.` as `%2E`, so every id round-trips; a generated id never needs it.
 *
 * Whether an insert id names an insert of a kind that has the field is the
 * part's to say: `insertTargetRow` takes the kind. `automationTargets.test.ts`
 * round-trips every id.
 */
import type { InsertKindName } from '../inserts/insertRegistry';
import { INSERT_AUTOMATION_FIELDS } from './automationInsertTables';
import { VOICE_TARGET_TABLE } from '../worklet/fm/voiceTargetTables';
import type {
  AutomationTargetId,
  AutomationTargetKind,
  AutomationTargetRow,
  ParsedTarget,
  VoiceTargetId,
} from './automationLane';
import {
  STRIP_AUTOMATION_ROWS,
  voiceRowOf,
  type VoiceAutomationRow,
} from './automationTargetTables';

const STRIP_PREFIX = 'strip.';
const INSERT_PREFIX = 'insert.';
/** A voice target id's prefix; `VoiceTargetId` is typed from it. */
export const VOICE_PREFIX = 'voice.';

/** The voice target id of a patch path (`filter.cutoff` → `voice.filter.cutoff`), unchecked. */
export function voiceTargetId(path: string): VoiceTargetId {
  return `${VOICE_PREFIX}${path}`;
}

/** The patch path a voice target id names, or undefined for an id that is not a voice one. */
export function voicePathOf(id: string): string | undefined {
  return id.startsWith(VOICE_PREFIX) ? id.slice(VOICE_PREFIX.length) : undefined;
}

/**
 * The voice's 30 rows (decision 2, windsor#406), one per row of the voice
 * target table and in its order (windsor#419): the filter's four and the
 * Formant vowel, each operator's five, LFO 1 and LFO 2 amount and rate, and
 * the pitch-envelope amount. Each carries its patch path and its section
 * (windsor#436).
 */
export const VOICE_AUTOMATION_ROWS: readonly VoiceAutomationRow[] = VOICE_TARGET_TABLE.map(
  (row, code) => ({ target: voiceTargetId(row.path), ...voiceRowOf(row, code) }),
);

const byTarget = (rows: readonly AutomationTargetRow[]): ReadonlyMap<string, AutomationTargetRow> =>
  new Map(rows.map((row) => [row.target, row]));

const STRIP_ROWS = byTarget(STRIP_AUTOMATION_ROWS);
const VOICE_ROWS = byTarget(VOICE_AUTOMATION_ROWS);
const INSERT_ROWS = new Map(
  Object.entries(INSERT_AUTOMATION_FIELDS).map(([kind, rows]) => [kind, byTarget(rows)]),
);
/** Every field some insert kind automates, longest first, so `bands.3.freq` wins over a `freq`. */
const INSERT_FIELDS_LONGEST_FIRST: readonly string[] = [
  ...new Set(
    Object.values(INSERT_AUTOMATION_FIELDS).flatMap((rows) => rows.map((row) => row.target)),
  ),
].sort((a, b) => b.length - a.length);
const INSERT_FIELDS: ReadonlySet<string> = new Set(INSERT_FIELDS_LONGEST_FIRST);

/** An escaped insert id's two escapes: `%` first, so a written `%2E` survives. */
const ESCAPED_PERCENT = '%25';
const ESCAPED_DOT = '%2E';
const escapeInsertId = (insertId: string): string =>
  insertId.replaceAll('%', ESCAPED_PERCENT).replaceAll('.', ESCAPED_DOT);
const unescapeInsertId = (written: string): string =>
  written.replace(/%25|%2E/g, (escape) => (escape === ESCAPED_DOT ? '.' : '%'));

/** Every strip target id, in the mixer's order. */
export const STRIP_TARGET_IDS: readonly AutomationTargetId[] = STRIP_AUTOMATION_ROWS.map(
  (row) => row.target,
);

/** Every voice target id, in the catalog's order. */
export const VOICE_TARGET_IDS: readonly AutomationTargetId[] = VOICE_AUTOMATION_ROWS.map(
  (row) => row.target,
);

/** Which family a target belongs to, by its prefix. */
export function targetKind(id: AutomationTargetId): AutomationTargetKind {
  if (id.startsWith(STRIP_PREFIX)) return 'strip';
  if (id.startsWith(INSERT_PREFIX)) return 'insert';
  return 'voice';
}

/**
 * `rest`, an insert target after `insert.`, as its written id and its field:
 * the longest field that ends it after a dot with something before the dot.
 */
function splitInsertTarget(rest: string): readonly [string, string] | undefined {
  for (const field of INSERT_FIELDS_LONGEST_FIRST) {
    if (rest.length > field.length + 1 && rest.endsWith(`.${field}`)) {
      return [rest.slice(0, rest.length - field.length - 1), field];
    }
  }
  return undefined;
}

/** An insert target's id: the insert id as it is where that reads back, escaped where not. */
function insertTargetId(insertId: string, field: string): AutomationTargetId {
  const plain = `${insertId}.${field}`;
  const back = insertId.includes('%') ? undefined : splitInsertTarget(plain);
  const reads = back !== undefined && back[0] === insertId && back[1] === field;
  return `${INSERT_PREFIX}${reads ? insertId : escapeInsertId(insertId)}.${field}`;
}

/** `id` taken apart, or undefined when the catalog has no such target. */
export function parseTargetId(id: string): ParsedTarget | undefined {
  if (id.startsWith(STRIP_PREFIX)) {
    return STRIP_ROWS.has(id) ? { kind: 'strip', field: id.slice(STRIP_PREFIX.length) } : undefined;
  }
  const path = voicePathOf(id);
  if (path !== undefined) return VOICE_ROWS.has(id) ? { kind: 'voice', path } : undefined;
  if (!id.startsWith(INSERT_PREFIX)) return undefined;
  const split = splitInsertTarget(id.slice(INSERT_PREFIX.length));
  if (!split) return undefined;
  const insertId = unescapeInsertId(split[0]);
  const field = split[1];
  // One spelling per target: an escape where none is needed, or a stray `%`, is not one.
  if (insertTargetId(insertId, field) !== id) return undefined;
  return { kind: 'insert', insertId, field };
}

/** A parsed target as its id. Throws on a target the catalog does not hold. */
export function formatTargetId(target: ParsedTarget): AutomationTargetId {
  const id: AutomationTargetId =
    target.kind === 'strip'
      ? (`${STRIP_PREFIX}${target.field}` as AutomationTargetId)
      : target.kind === 'voice'
        ? voiceTargetId(target.path)
        : target.insertId.length > 0 && INSERT_FIELDS.has(target.field)
          ? insertTargetId(target.insertId, target.field)
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
