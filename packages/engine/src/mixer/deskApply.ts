/**
 * The live desk: a part's `strip` and the document's `returns` partials landing on the
 * running graph — the strips `routePart` built and the send buses `createReturns`
 * built. Only the fields a partial names change, junk and unknown names are
 * reported by path in the returned `ignored` list, and every number is
 * clamped into the same range `deskNormalise.ts` clamps a document into, so
 * the live path and the committed path cannot disagree about a value
 * (`AudioSystem.apply`, refinement decision 3).
 */
import { LOW_CUT_MAX_HZ, LOW_CUT_MIN_HZ, MIX_LEVEL_MAX, RETURN_LEVEL_MAX } from '../audioConstants';
import { FieldNormaliser } from '../song/arrangementFields';
import { normaliseBusInserts } from '../song/deskNormalise';
import type { PartStrip } from './channelStrip';
import { normaliseInserts } from '../inserts/insertRegistry';
import type { InsertSpec } from '../inserts/insertRegistry';
import type { ReturnBus } from './returnBus';

const STRIP_KEYS = ['level', 'pan', 'lowCut', 'sends', 'inserts', 'output', 'mute', 'solo'];
const RETURN_KEYS = ['level', 'inserts'];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** A part's `strip` partial onto its live strip (#597); `path` prefixes what is reported. */
export function applyStripLive(strip: PartStrip, raw: unknown, path: string): string[] {
  const ignored: string[] = [];
  if (!isRecord(raw)) return [path];
  for (const key of Object.keys(raw)) {
    if (!STRIP_KEYS.includes(key)) ignored.push(`${path}.${key}`);
  }
  if (isNumber(raw.level)) strip.setLevel(clamp(raw.level, 0, MIX_LEVEL_MAX));
  else if (raw.level !== undefined) ignored.push(`${path}.level`);
  if (isNumber(raw.pan)) strip.setPan(clamp(raw.pan, -1, 1));
  else if (raw.pan !== undefined) ignored.push(`${path}.pan`);
  if (isNumber(raw.lowCut)) strip.setLowCut(clamp(raw.lowCut, LOW_CUT_MIN_HZ, LOW_CUT_MAX_HZ));
  else if (raw.lowCut !== undefined) ignored.push(`${path}.lowCut`);
  if (raw.output === 'master' || raw.output === 'sidechain') strip.setOutput(raw.output);
  else if (raw.output !== undefined) ignored.push(`${path}.output`);
  // Solo lands as this strip's flag; the caller re-resolves the roster (windsor#154).
  if (typeof raw.mute === 'boolean') strip.setMute(raw.mute);
  else if (raw.mute !== undefined) ignored.push(`${path}.mute`);
  if (typeof raw.solo === 'boolean') strip.setSolo(raw.solo);
  else if (raw.solo !== undefined) ignored.push(`${path}.solo`);
  if (raw.sends !== undefined) applySends(strip, path, raw.sends, ignored);
  if (raw.inserts !== undefined) {
    const specs = liveInserts(`${path}.inserts`, raw.inserts, ignored, normaliseInserts);
    if (specs) strip.setInserts(specs);
  }
  return ignored;
}

/**
 * A whole `inserts` list (#641; a list replaces wholesale, like every array
 * in a partial), read by the document's own normaliser `read`, so the live
 * chain and the committed one cannot disagree. A clamp is silent, as it is
 * for every live number; anything the normaliser dropped or replaced is
 * reported by its path. Null when `raw` is not a list: nothing lands.
 */
function liveInserts(
  path: string,
  raw: unknown,
  ignored: string[],
  read: (raw: unknown, path: string, n: FieldNormaliser) => InsertSpec[],
): InsertSpec[] | null {
  const n = new FieldNormaliser();
  const specs = read(raw, path, n);
  for (const message of n.corrections) {
    if (!CLAMP.test(message)) ignored.push(message.slice(0, message.indexOf(': ')));
  }
  return Array.isArray(raw) ? specs : null;
}

/** A normaliser correction that only moved a number into range. */
const CLAMP = /: clamped /;

function applySends(strip: PartStrip, path: string, sends: unknown, ignored: string[]): void {
  if (!isRecord(sends)) {
    ignored.push(`${path}.sends`);
    return;
  }
  for (const [ret, amount] of Object.entries(sends)) {
    if (!strip.sends.has(ret) || !isNumber(amount)) {
      ignored.push(`${path}.sends.${ret}`);
      continue;
    }
    strip.setSend(ret, clamp(amount, 0, 1));
  }
}

/**
 * `returns` partials onto the live send buses, by bus name (windsor#172): a
 * level, and a whole chain, which lands as a strip's does. The rest of the
 * desk keeps playing while one bus's chain re-wires.
 */
export function applyReturnsLive(
  returns: Readonly<Record<string, ReturnBus>>,
  overlay: unknown,
): string[] {
  const ignored: string[] = [];
  if (!isRecord(overlay)) return ['returns'];
  for (const [name, raw] of Object.entries(overlay)) {
    if (raw === undefined) continue;
    const bus = Object.hasOwn(returns, name) ? returns[name] : undefined;
    if (!bus || !isRecord(raw)) {
      ignored.push(`returns.${name}`);
      continue;
    }
    const path = `returns.${name}`;
    for (const key of Object.keys(raw)) {
      if (!RETURN_KEYS.includes(key)) ignored.push(`${path}.${key}`);
    }
    if (isNumber(raw.level)) bus.setLevel(clamp(raw.level, 0, RETURN_LEVEL_MAX));
    else if (raw.level !== undefined) ignored.push(`${path}.level`);
    if (raw.inserts === undefined) continue;
    const read = (list: unknown, at: string, n: FieldNormaliser): InsertSpec[] =>
      normaliseBusInserts(list, at, n, bus.spec.inserts);
    const specs = liveInserts(`${path}.inserts`, raw.inserts, ignored, read);
    if (specs) bus.setInserts(specs);
  }
  return ignored;
}
