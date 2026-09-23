/**
 * The desk sections of an arrangement document — each part's `strip` (over
 * `DEFAULT_STRIP`, #597) and `returns` (overlays over the code's `RETURNS`) —
 * normalised the same way: only the fields the document names change, the
 * base supplies the rest, and the result is the complete strip or return
 * spec the graph is built from. A name the code does not define is dangling,
 * never invented: which strips and returns exist stays code-owned (one
 * plate, one delay — no unmeasured DSP runs for nothing), what they are set
 * to is the document's (record
 * `2026-09-11-music-document-carries-patches-and-returns`).
 */
import type { FieldNormaliser } from './arrangementFields';
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
import type { ChannelStrip, DelayReturn, ReturnSpec, ReverbReturn } from '../mixer/mix';
import { normaliseInserts } from '../inserts/insertRegistry';
import { DEFAULT_STRIP, RETURNS } from '../mixer/mix';
import type { ReverbSpace } from '../mixer/reverbSpace';

/**
 * A part's own strip (#597): level, pan, low cut (#640), sends and inserts
 * (#641), over `DEFAULT_STRIP` — unity, centred, uncut, dry, no inserts. A send to a return the code
 * does not define is dangling.
 */
export function normaliseStrip(raw: unknown, path: string, n: FieldNormaliser): ChannelStrip {
  const base = DEFAULT_STRIP;
  const o = n.section(raw, path);
  n.dropUnknown(o, ['level', 'pan', 'lowCut', 'sends', 'inserts'], path);
  return {
    level: n.num(o.level, base.level, 0, MIX_LEVEL_MAX, `${path}.level`),
    pan: n.num(o.pan, base.pan, -1, 1, `${path}.pan`),
    lowCut: n.num(o.lowCut, base.lowCut, LOW_CUT_MIN_HZ, LOW_CUT_MAX_HZ, `${path}.lowCut`),
    sends: sends(o.sends, base.sends, `${path}.sends`, n),
    inserts: normaliseInserts(o.inserts, `${path}.inserts`, n),
  };
}

/** Sends overlay the base per return — set a send to 0 to silence it — the
 * same only-named-fields semantics `AudioSystem.apply` uses live. */
function sends(
  raw: unknown,
  base: ChannelStrip['sends'],
  path: string,
  n: FieldNormaliser,
): ChannelStrip['sends'] {
  if (raw === undefined) return { ...base };
  const o = n.section(raw, path);
  const out: Record<string, number> = {};
  for (const [name, amount] of Object.entries(base)) {
    if (amount !== undefined) out[name] = amount;
  }
  for (const [name, amount] of Object.entries(o)) {
    if (!Object.hasOwn(RETURNS, name)) {
      n.dangling.push(`${path}.${name}: no return "${name}" is defined`);
      n.correction(`${path}.${name}: dropped`);
      continue;
    }
    out[name] = n.num(amount, 0, 0, 1, `${path}.${name}`);
  }
  return out;
}

/**
 * Return overlays over `RETURNS`, by name. The kind is the code's: a
 * document cannot turn the plate into a delay, only set what the plate is.
 */
export function normaliseReturns(
  raw: unknown,
  n: FieldNormaliser,
): Record<string, ReturnSpec> | undefined {
  if (raw === undefined) return undefined;
  const o = n.section(raw, 'returns');
  const out: Record<string, ReturnSpec> = {};
  for (const [name, value] of Object.entries(o)) {
    const base: ReturnSpec | undefined = Object.hasOwn(RETURNS, name)
      ? RETURNS[name as keyof typeof RETURNS]
      : undefined;
    if (!base) {
      n.dangling.push(`returns.${name}: no return "${name}" is defined`);
      n.correction(`returns.${name}: dropped`);
      continue;
    }
    const path = `returns.${name}`;
    const section = n.section(value, path);
    if (section.kind !== undefined && section.kind !== base.kind) {
      n.correction(`${path}.kind: ${section.kind as string} is not the code's ${base.kind} — kept`);
    }
    out[name] =
      base.kind === 'reverb'
        ? reverbReturn(section, base, path, n)
        : delayReturn(section, base, path, n);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function reverbReturn(
  o: Record<string, unknown>,
  base: ReverbReturn,
  path: string,
  n: FieldNormaliser,
): ReverbReturn {
  n.dropUnknown(o, ['kind', 'level', 'space'], path);
  return {
    kind: 'reverb',
    level: n.num(o.level, base.level, 0, RETURN_LEVEL_MAX, `${path}.level`),
    space: space(o.space, base.space, `${path}.space`, n),
  };
}

/** Every plate parameter, clamped to the worklet's declared range. */
export function space(
  raw: unknown,
  base: ReverbSpace,
  path: string,
  n: FieldNormaliser,
): ReverbSpace {
  const o = n.section(raw, path);
  n.dropUnknown(o, Object.keys(REVERB_SPACE_RANGES), path);
  const out = { ...base };
  for (const [field, [min, max]] of Object.entries(REVERB_SPACE_RANGES)) {
    const key = field as keyof ReverbSpace;
    out[key] = n.num(o[key], base[key], min, max, `${path}.${key}`);
  }
  return out;
}

function delayReturn(
  o: Record<string, unknown>,
  base: DelayReturn,
  path: string,
  n: FieldNormaliser,
): DelayReturn {
  n.dropUnknown(o, ['kind', 'level', 'delayTime', 'feedback', 'damp', 'resonance'], path);
  return {
    kind: 'delay',
    level: n.num(o.level, base.level, 0, RETURN_LEVEL_MAX, `${path}.level`),
    delayTime: n.num(o.delayTime, base.delayTime, 0, DELAY_MAX_SECONDS, `${path}.delayTime`),
    feedback: n.num(o.feedback, base.feedback, 0, DELAY_FEEDBACK_MAX, `${path}.feedback`),
    damp: n.num(o.damp, base.damp, DELAY_DAMP_MIN_HZ, DELAY_DAMP_MAX_HZ, `${path}.damp`),
    resonance: n.num(
      o.resonance,
      base.resonance,
      DELAY_RESONANCE_MIN_DB,
      DELAY_RESONANCE_MAX_DB,
      `${path}.resonance`,
    ),
  };
}
