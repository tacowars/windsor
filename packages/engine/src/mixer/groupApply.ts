/**
 * A `groups` partial on the live desk (windsor#285; record
 * `2026-10-01-group-buses`): the partial read into what it adds, removes and
 * edits, before anything changes, and the edits landing on the live group
 * buses beside `applyReturnsLive`. Groups are keyed by id, as the app's
 * merge keys them: `null` at a live id removes that group, a whole group (its
 * `id` naming its key) at a free id adds one, and anything else at a live id
 * edits only the fields it names. Numbers are clamped into the ranges the
 * document's normaliser uses (`groupNormalise.ts`), so the live path and the
 * committed one agree, and junk is reported by path.
 */
import { MAX_GROUPS, MIX_LEVEL_MAX } from '../audioConstants';
import type { InsertSpec } from '../inserts/insertRegistry';
import { FieldNormaliser } from '../song/arrangementFields';
import { normaliseBusInserts } from '../song/deskNormalise';
import { normaliseGroups } from '../song/groupNormalise';
import { clamp, isNumber, isRecord, liveInserts } from './deskApply';
import type { GroupBus } from './groupBus';
import type { GroupSpec } from './mix';

const GROUP_KEYS = ['id', 'name', 'level', 'pan', 'mute', 'solo', 'inserts'];

/** A normaliser correction that only moved a number into range. */
const CLAMP = /: clamped /;

/** What a `groups` partial does, read before anything changes. */
export interface GroupsPlan {
  /** Whole groups at free ids, normalised. */
  readonly added: readonly GroupSpec[];
  /** Live ids the partial sets to `null`. */
  readonly removed: readonly number[];
  /** Field edits by live id. */
  readonly edits: ReadonlyMap<number, Readonly<Record<string, unknown>>>;
  /** Paths that changed nothing. */
  readonly ignored: readonly string[];
  /** Set when the partial is refused whole: nothing of it may land. */
  readonly error?: string;
}

const EMPTY: GroupsPlan = { added: [], removed: [], edits: new Map(), ignored: [] };

/** The id a partial's key names, or null for a key that is not a non-negative integer. */
function idOf(key: string): number | null {
  const id = Number(key);
  return Number.isSafeInteger(id) && id >= 0 && String(id) === key ? id : null;
}

/**
 * Read `overlay` against the live group ids. A partial that would leave the
 * song with more than `MAX_GROUPS` groups is refused with an error.
 */
export function planGroupsLive(live: ReadonlySet<number>, overlay: unknown): GroupsPlan {
  if (overlay === undefined) return EMPTY;
  if (!isRecord(overlay)) return { ...EMPTY, ignored: ['groups'] };
  const added: GroupSpec[] = [];
  const removed: number[] = [];
  const edits = new Map<number, Readonly<Record<string, unknown>>>();
  const ignored: string[] = [];
  for (const [key, raw] of Object.entries(overlay)) {
    if (raw === undefined) continue;
    const id = idOf(key);
    const path = `groups.${key}`;
    if (id !== null && live.has(id) && raw === null) removed.push(id);
    else if (id !== null && live.has(id) && isRecord(raw)) edits.set(id, raw);
    else if (id !== null && !live.has(id) && isRecord(raw) && raw.id === id) {
      added.push(newGroup(raw, path, ignored));
    } else ignored.push(path);
  }
  if (live.size - removed.length + added.length > MAX_GROUPS) {
    return { ...EMPTY, error: `groups: a song holds at most ${MAX_GROUPS} groups` };
  }
  return { added, removed, edits, ignored };
}

/** A whole new group, read by the document's own normaliser; what it dropped or replaced is reported under `path`. */
function newGroup(raw: Record<string, unknown>, path: string, ignored: string[]): GroupSpec {
  const n = new FieldNormaliser();
  const [spec] = normaliseGroups([raw], n)!;
  for (const message of n.corrections) {
    if (CLAMP.test(message)) continue;
    ignored.push(path + message.slice('groups[0]'.length, message.indexOf(': ')));
  }
  return spec!;
}

/**
 * Field edits onto the live groups, by id: name, level, pan, mute, solo and
 * a whole chain, which lands as a send bus's does. Mute and solo land as the
 * group's flags; the caller re-resolves the roster.
 */
export function applyGroupsLive(
  groups: ReadonlyMap<number, GroupBus>,
  edits: GroupsPlan['edits'],
): string[] {
  const ignored: string[] = [];
  for (const [id, raw] of edits) {
    const bus = groups.get(id);
    const path = `groups.${id}`;
    if (!bus) {
      ignored.push(path);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!GROUP_KEYS.includes(key)) ignored.push(`${path}.${key}`);
    }
    applyFields(bus, raw, path, ignored);
  }
  return ignored;
}

function applyFields(
  bus: GroupBus,
  raw: Readonly<Record<string, unknown>>,
  path: string,
  ignored: string[],
): void {
  if (raw.id !== undefined && raw.id !== bus.id) ignored.push(`${path}.id`);
  if (typeof raw.name === 'string') bus.setName(raw.name);
  else if (raw.name !== undefined) ignored.push(`${path}.name`);
  if (isNumber(raw.level)) bus.setLevel(clamp(raw.level, 0, MIX_LEVEL_MAX));
  else if (raw.level !== undefined) ignored.push(`${path}.level`);
  if (isNumber(raw.pan)) bus.setPan(clamp(raw.pan, -1, 1));
  else if (raw.pan !== undefined) ignored.push(`${path}.pan`);
  if (typeof raw.mute === 'boolean') bus.setMute(raw.mute);
  else if (raw.mute !== undefined) ignored.push(`${path}.mute`);
  if (typeof raw.solo === 'boolean') bus.setSolo(raw.solo);
  else if (raw.solo !== undefined) ignored.push(`${path}.solo`);
  if (raw.inserts === undefined) return;
  const read = (list: unknown, at: string, n: FieldNormaliser): InsertSpec[] =>
    normaliseBusInserts(list, at, n, bus.spec.inserts, 'a group');
  const specs = liveInserts(`${path}.inserts`, raw.inserts, ignored, read);
  if (specs) bus.setInserts(specs);
}
