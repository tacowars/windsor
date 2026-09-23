/**
 * The live desk: a part's `strip` and the document's `returns` partials landing on the
 * running graph — the strips `routePart` built and the returns `createReturns`
 * built. Only the fields a partial names change, junk and unknown names are
 * reported by path in the returned `ignored` list, and every number is
 * clamped into the same range `deskNormalise.ts` clamps a document into, so
 * the live path and the committed path cannot disagree about a value
 * (`AudioSystem.apply`, refinement decision 3).
 */
import {
  DELAY_DAMP_MAX_HZ,
  DELAY_DAMP_MIN_HZ,
  DELAY_FEEDBACK_MAX,
  DELAY_MAX_SECONDS,
  DELAY_RESONANCE_MAX_DB,
  DELAY_RESONANCE_MIN_DB,
  LOW_CUT_MAX_HZ,
  LOW_CUT_MIN_HZ,
  MIX_LEVEL_MAX,
  RETURN_LEVEL_MAX,
  REVERB_SPACE_RANGES,
} from '../audioConstants';
import { FieldNormaliser } from '../song/arrangementFields';
import type { PartStrip } from './channelStrip';
import { normaliseInserts } from '../inserts/insertRegistry';
import type { ReturnBus } from './returnBus';
import type { ReverbSpace } from './reverbSpace';

const STRIP_KEYS = ['level', 'pan', 'lowCut', 'sends', 'inserts'];
const DELAY_KEYS = ['delayTime', 'feedback', 'damp', 'resonance'];
const RETURN_KEYS = ['kind', 'level', 'space', ...DELAY_KEYS];

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
  if (raw.sends !== undefined) applySends(strip, path, raw.sends, ignored);
  if (raw.inserts !== undefined) applyInserts(strip, `${path}.inserts`, raw.inserts, ignored);
  return ignored;
}

/**
 * A strip's whole `inserts` list (#641; a list replaces wholesale, like every
 * array in a partial). It goes through the document's own normaliser, so the
 * live chain and the committed one cannot disagree. A clamp is silent, as it
 * is for every live number; anything the normaliser dropped or replaced is
 * reported by its path.
 */
function applyInserts(strip: PartStrip, path: string, raw: unknown, ignored: string[]): void {
  const n = new FieldNormaliser();
  const specs = normaliseInserts(raw, path, n);
  for (const message of n.corrections) {
    if (!CLAMP.test(message)) ignored.push(message.slice(0, message.indexOf(': ')));
  }
  if (Array.isArray(raw)) strip.setInserts(specs);
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

/** `returns` partials onto the live return buses, by return name. */
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
    if (raw.kind !== undefined && raw.kind !== bus.spec.kind) ignored.push(`${path}.kind`);
    if (isNumber(raw.level)) bus.setLevel(clamp(raw.level, 0, RETURN_LEVEL_MAX));
    else if (raw.level !== undefined) ignored.push(`${path}.level`);
    if (bus.spec.kind === 'reverb') applySpace(bus, raw, path, ignored);
    else applyDelay(bus, raw, path, ignored);
  }
  return ignored;
}

function applySpace(
  bus: ReturnBus,
  raw: Record<string, unknown>,
  path: string,
  ignored: string[],
): void {
  for (const key of DELAY_KEYS) {
    if (raw[key] !== undefined) ignored.push(`${path}.${key}`);
  }
  if (raw.space === undefined) return;
  if (!isRecord(raw.space)) {
    ignored.push(`${path}.space`);
    return;
  }
  const space: Partial<ReverbSpace> = {};
  for (const [field, value] of Object.entries(raw.space)) {
    const range = REVERB_SPACE_RANGES[field as keyof ReverbSpace] as
      readonly [number, number] | undefined;
    if (!range || !isNumber(value)) {
      ignored.push(`${path}.space.${field}`);
      continue;
    }
    space[field as keyof ReverbSpace] = clamp(value, range[0], range[1]);
  }
  bus.setSpace(space);
}

function applyDelay(
  bus: ReturnBus,
  raw: Record<string, unknown>,
  path: string,
  ignored: string[],
): void {
  if (raw.space !== undefined) ignored.push(`${path}.space`);
  const delay: { delayTime?: number; feedback?: number; damp?: number; resonance?: number } = {};
  if (isNumber(raw.delayTime)) delay.delayTime = clamp(raw.delayTime, 0, DELAY_MAX_SECONDS);
  else if (raw.delayTime !== undefined) ignored.push(`${path}.delayTime`);
  if (isNumber(raw.feedback)) delay.feedback = clamp(raw.feedback, 0, DELAY_FEEDBACK_MAX);
  else if (raw.feedback !== undefined) ignored.push(`${path}.feedback`);
  if (isNumber(raw.damp)) delay.damp = clamp(raw.damp, DELAY_DAMP_MIN_HZ, DELAY_DAMP_MAX_HZ);
  else if (raw.damp !== undefined) ignored.push(`${path}.damp`);
  if (isNumber(raw.resonance)) {
    delay.resonance = clamp(raw.resonance, DELAY_RESONANCE_MIN_DB, DELAY_RESONANCE_MAX_DB);
  } else if (raw.resonance !== undefined) ignored.push(`${path}.resonance`);
  bus.setDelay(delay);
}
