/**
 * A part's automation lanes, normalised (windsor#342, record
 * `2026-10-01-song-automation-lanes` decisions 1–4, 14 and 15). Every case is
 * a correction, never a refusal, reported through the `arrangementFields`
 * vocabulary like every other field:
 *
 * - **The target.** A lane whose target does not parse, names an insert id
 *   the part's strip does not hold, or names a field that insert's kind does
 *   not automate, is dropped. A field the kind automates but the insert's
 *   current settings leave unread (Tape's `wear` while split) is kept, so
 *   switching the setting back brings the lane back to life.
 * - **Duplicates.** Of two surviving lanes on one target, the first wins.
 * - **Voice lanes.** At most `FM_LANES_MAX`; the extras are dropped in list
 *   order. Strip and insert lanes have no cap.
 * - **Points.** A non-finite field drops the point. A tick before 0 is
 *   clamped to 0, the value to the row's range and the bend to −1..1 (a
 *   missing bend is 0). Points are sorted by tick, stably, and a third point
 *   on one tick is dropped. Points past the song's end are fitted (below).
 * - **Empty.** A lane with no points left is dropped, and a part with no
 *   lanes has no `automation` key.
 * - **`on`.** Missing means `true`; a present `false` is kept.
 *
 * **Fitting** (decision 3): the points past the song's end are dropped and,
 * unless a point already sits on the end, one is added there with the value
 * the lane had at that tick. The segment it ends keeps its bend, and a power
 * curve cut short is the same curve (`ya + (yb − ya)·u^k` stopped at `u0` is
 * `ya + (y(u0) − ya)·v^k` over `v = u / u0`), so the lane's shape up to the
 * end is unchanged. A longer song changes nothing: the last value holds.
 * `fitTimelines` fits a part's lanes the same way.
 *
 * Deleting an insert deletes its lanes (decision 14), because normalising
 * runs after every merge. `automationNormalise.test.ts` pins each case.
 */
import { FM_LANES_MAX } from '../automation/automationTargetTables';
import type {
  AutomationLane,
  AutomationPoint,
  AutomationTargetId,
  AutomationTargetRow,
} from '../automation/automationLane';
import {
  catalogRow,
  insertTargetRow,
  parseTargetId,
  targetKind,
  targetRow,
} from '../automation/automationTargets';
import { valueAt } from '../automation/automationEvaluate';
import type { InsertKindName, InsertSpec } from '../inserts/insertRegistry';
import type { MusicPart } from './arrangement';
import type { DocumentPart } from './arrangementDocument';
import { type FieldNormaliser, isRecord, show } from './arrangementFields';

/** What a part's lanes are normalised against. */
export interface AutomationContext {
  /** The song's length: no point lies past it. */
  readonly songTicks: number;
  /** The part's normalised inserts, each with its id: an insert lane needs one of them. */
  readonly inserts: readonly InsertSpec[];
  readonly path: string;
  readonly n: FieldNormaliser;
}

const LANE_KEYS = ['target', 'on', 'points'];
const POINT_KEYS = ['tick', 'value', 'bend'];
/** A step is two points on one tick; a third says nothing more. */
const POINTS_PER_TICK_MAX = 2;
const BEND_MIN = -1;
const BEND_MAX = 1;

type InsertKindOf = (insertId: string) => InsertKindName | undefined;

/** The kind of each insert in `inserts`, by its id. */
function insertKindOf(inserts: readonly InsertSpec[]): InsertKindOf {
  const kinds = new Map<string, InsertKindName>();
  for (const spec of inserts) if (spec.id !== undefined) kinds.set(spec.id, spec.kind);
  return (insertId) => kinds.get(insertId);
}

/** A part's lanes: absent when it has none, corrected as the file's header says. */
export function normaliseAutomation(
  raw: unknown,
  context: AutomationContext,
): AutomationLane[] | undefined {
  const { path, n } = context;
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of lanes — dropped`);
    return undefined;
  }
  const kindOf = insertKindOf(context.inserts);
  const taken = new Set<string>();
  let voiceLanes = 0;
  const out: AutomationLane[] = [];
  raw.forEach((entry, i) => {
    const lanePath = `${path}[${i}]`;
    const lane = normaliseLane(entry, lanePath, context, kindOf);
    if (!lane) return;
    if (taken.has(lane.target)) {
      n.correction(`${lanePath}: an earlier lane moves ${lane.target} — lane dropped`);
      return;
    }
    if (targetKind(lane.target) === 'voice') {
      if (voiceLanes >= FM_LANES_MAX) {
        n.correction(`${lanePath}: a part has at most ${FM_LANES_MAX} voice lanes — lane dropped`);
        return;
      }
      voiceLanes++;
    }
    taken.add(lane.target);
    out.push(lane);
  });
  return out.length > 0 ? out : undefined;
}

function normaliseLane(
  raw: unknown,
  path: string,
  context: AutomationContext,
  kindOf: InsertKindOf,
): AutomationLane | undefined {
  const { n } = context;
  const o = n.section(raw, path);
  n.dropUnknown(o, LANE_KEYS, path);
  const target = laneTarget(o.target, `${path}.target`, kindOf, n);
  if (!target) return undefined;
  const points = normalisePoints(o.points, target.row, { ...context, path: `${path}.points` });
  if (points.length === 0) {
    n.correction(`${path}: no points left — lane dropped`);
    return undefined;
  }
  return { target: target.id, on: n.bool(o.on, true, `${path}.on`), points };
}

/** The lane's target and its row, or undefined (reported) when the part has no such target. */
function laneTarget(
  raw: unknown,
  path: string,
  kindOf: InsertKindOf,
  n: FieldNormaliser,
): { id: AutomationTargetId; row: AutomationTargetRow } | undefined {
  const parsed = typeof raw === 'string' ? parseTargetId(raw) : undefined;
  if (typeof raw !== 'string' || !parsed) {
    n.correction(`${path}: ${show(raw)} names no automation target — lane dropped`);
    return undefined;
  }
  const id = raw as AutomationTargetId;
  if (parsed.kind !== 'insert') return { id, row: catalogRow(raw)! };
  const kind = kindOf(parsed.insertId);
  if (kind === undefined) {
    n.correction(`${path}: the strip has no insert "${parsed.insertId}" — lane dropped`);
    return undefined;
  }
  const row = insertTargetRow(kind, parsed.field);
  if (!row) {
    n.correction(`${path}: ${kind} has no automatable "${parsed.field}" — lane dropped`);
    return undefined;
  }
  return { id, row };
}

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** One point, clamped, or undefined (reported) when a field is not a finite number. */
function readPoint(
  raw: unknown,
  row: AutomationTargetRow,
  path: string,
  n: FieldNormaliser,
): AutomationPoint | undefined {
  const o = n.section(raw, path);
  n.dropUnknown(o, POINT_KEYS, path);
  if (!finite(o.tick) || !finite(o.value) || (o.bend !== undefined && !finite(o.bend))) {
    n.correction(`${path}: ${show(raw)} is not a point — dropped`);
    return undefined;
  }
  return {
    tick: n.num(o.tick, 0, 0, Infinity, `${path}.tick`),
    value: n.num(o.value, row.min, row.min, row.max, `${path}.value`),
    bend: n.num(o.bend, 0, BEND_MIN, BEND_MAX, `${path}.bend`),
  };
}

/** A lane's points: read, sorted, at most two to a tick, and fitted to the song. */
function normalisePoints(
  raw: unknown,
  row: AutomationTargetRow,
  context: AutomationContext,
): readonly AutomationPoint[] {
  const { path, n, songTicks } = context;
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list of points`);
    return [];
  }
  const read: AutomationPoint[] = [];
  raw.forEach((entry, i) => {
    const point = readPoint(entry, row, `${path}[${i}]`, n);
    if (point) read.push(point);
  });
  // `sort` is stable: two points on one tick keep their written order, a step's direction.
  read.sort((a, b) => a.tick - b.tick);
  const stepped = read.filter(
    (point, i) => i < POINTS_PER_TICK_MAX || read[i - POINTS_PER_TICK_MAX]!.tick !== point.tick,
  );
  if (stepped.length < read.length) {
    n.correction(`${path}: more than ${POINTS_PER_TICK_MAX} points on one tick — extras dropped`);
  }
  const fitted = fitPoints(row, stepped, songTicks);
  if (fitted !== stepped) {
    n.correction(`${path}: points past the song's end (tick ${songTicks}) — fitted to it`);
  }
  return fitted;
}

/**
 * Sorted `points` cut at `songTicks` (decision 3), or `points` itself when
 * none is past it: the later ones dropped, and a point added on the end with
 * the lane's value there unless one already sits on it.
 */
export function fitPoints(
  row: AutomationTargetRow,
  points: readonly AutomationPoint[],
  songTicks: number,
): readonly AutomationPoint[] {
  const last = points[points.length - 1];
  if (last === undefined || last.tick <= songTicks) return points;
  const end = Math.min(row.max, Math.max(row.min, valueAt(row, points, songTicks)));
  const kept = points.filter((point) => point.tick <= songTicks);
  if (kept[kept.length - 1]?.tick !== songTicks)
    kept.push({ tick: songTicks, value: end, bend: 0 });
  return kept;
}

/**
 * `part` with its lanes, if it carries any, fitted to `songTicks` — what
 * `fitTimelines` runs over a merged arrangement. It never drops a lane: a
 * lane whose row it cannot find (an insert the part's strip does not list)
 * is left for the normaliser. Read tolerantly, as `fitTimelines` reads.
 */
export function withFittedAutomation<P extends MusicPart>(part: P, songTicks: number): P {
  const { automation, strip } = part as Partial<DocumentPart>;
  if (!Array.isArray(automation)) return part;
  const kindOf = insertKindOf(Array.isArray(strip?.inserts) ? strip.inserts : []);
  let changed = false;
  const fitted = automation.map((lane: unknown) => {
    if (!isRecord(lane) || typeof lane.target !== 'string' || !Array.isArray(lane.points)) {
      return lane;
    }
    const row = targetRow(lane.target, kindOf);
    const points = row ? fitPoints(row, lane.points as AutomationPoint[], songTicks) : lane.points;
    if (points === lane.points) return lane;
    changed = true;
    return { ...lane, points };
  });
  return changed ? { ...part, automation: fitted } : part;
}
