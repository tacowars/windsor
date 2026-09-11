/**
 * The live desk: a document's `mix` and `returns` partials landing on the
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
  MIX_LEVEL_MAX,
  RETURN_LEVEL_MAX,
  REVERB_SPACE_RANGES,
} from './audioConstants';
import type { PartStrip } from './channelStrip';
import type { ReturnBus } from './returnBus';
import type { ReverbSpace } from './reverbSpace';

const STRIP_KEYS = ['level', 'pan', 'sends'];
const RETURN_KEYS = ['kind', 'level', 'space', 'delayTime', 'feedback', 'damp'];

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `mix` partials onto the live strips, by part name. */
export function applyMixLive(strips: ReadonlyMap<string, PartStrip>, mix: unknown): string[] {
  const ignored: string[] = [];
  if (!isRecord(mix)) return ['mix'];
  for (const [name, raw] of Object.entries(mix)) {
    if (raw === undefined) continue;
    const strip = strips.get(name);
    if (!strip || !isRecord(raw)) {
      ignored.push(`mix.${name}`);
      continue;
    }
    for (const key of Object.keys(raw)) {
      if (!STRIP_KEYS.includes(key)) ignored.push(`mix.${name}.${key}`);
    }
    if (isNumber(raw.level)) strip.setLevel(clamp(raw.level, 0, MIX_LEVEL_MAX));
    else if (raw.level !== undefined) ignored.push(`mix.${name}.level`);
    if (isNumber(raw.pan)) strip.setPan(clamp(raw.pan, -1, 1));
    else if (raw.pan !== undefined) ignored.push(`mix.${name}.pan`);
    if (raw.sends !== undefined) applySends(strip, name, raw.sends, ignored);
  }
  return ignored;
}

function applySends(strip: PartStrip, name: string, sends: unknown, ignored: string[]): void {
  if (!isRecord(sends)) {
    ignored.push(`mix.${name}.sends`);
    return;
  }
  for (const [ret, amount] of Object.entries(sends)) {
    if (!strip.sends.has(ret) || !isNumber(amount)) {
      ignored.push(`mix.${name}.sends.${ret}`);
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
  for (const key of ['delayTime', 'feedback', 'damp']) {
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
  const delay: { delayTime?: number; feedback?: number; damp?: number } = {};
  if (isNumber(raw.delayTime)) delay.delayTime = clamp(raw.delayTime, 0, DELAY_MAX_SECONDS);
  else if (raw.delayTime !== undefined) ignored.push(`${path}.delayTime`);
  if (isNumber(raw.feedback)) delay.feedback = clamp(raw.feedback, 0, DELAY_FEEDBACK_MAX);
  else if (raw.feedback !== undefined) ignored.push(`${path}.feedback`);
  if (isNumber(raw.damp)) delay.damp = clamp(raw.damp, DELAY_DAMP_MIN_HZ, DELAY_DAMP_MAX_HZ);
  else if (raw.damp !== undefined) ignored.push(`${path}.damp`);
  bus.setDelay(delay);
}
