/**
 * The desk sections of an arrangement document — each part's `strip` (over
 * `DEFAULT_STRIP`, #597) and `returns`, the send buses (over the code's
 * `RETURNS`, windsor#172) — normalised the same way: only the fields the
 * document names change, the base supplies the rest, and the result is the
 * complete strip or bus spec the graph is built from. A name the code does
 * not define is dangling, never invented: which strips and buses exist stays
 * code-owned (Send A and Send B), what they hold and how they are set is the
 * document's (record `2026-09-11-music-document-carries-patches-and-returns`).
 */
import type { FieldNormaliser } from './arrangementFields';
import { LOW_CUT_MAX_HZ, LOW_CUT_MIN_HZ, MIX_LEVEL_MAX, RETURN_LEVEL_MAX } from '../audioConstants';
import type { InsertSpec } from '../inserts/insertRegistry';
import type { ChannelStrip, ReturnSpec } from '../mixer/mix';
import { withInsertIds } from '../inserts/insertIds';
import { normaliseInserts } from '../inserts/insertRegistry';
import { DEFAULT_STRIP, RETURNS, isGroupOutput, isReturnName } from '../mixer/mix';

/**
 * A part's own strip (#597): level, pan, low cut (#640), sends and inserts
 * (#641), over `DEFAULT_STRIP` — unity, centred, uncut, dry, no inserts. A send to a bus the code
 * does not define is dangling.
 */
export function normaliseStrip(raw: unknown, path: string, n: FieldNormaliser): ChannelStrip {
  const base = DEFAULT_STRIP;
  const o = n.section(raw, path);
  n.dropUnknown(o, ['level', 'pan', 'lowCut', 'sends', 'inserts', 'output', 'mute', 'solo'], path);
  const output = stripOutput(o.output, `${path}.output`, n);
  return {
    ...(output === undefined ? {} : { output }),
    ...switchedOn('mute', o.mute, path, n),
    ...switchedOn('solo', o.solo, path, n),
    level: n.num(o.level, base.level, 0, MIX_LEVEL_MAX, `${path}.level`),
    pan: n.num(o.pan, base.pan, -1, 1, `${path}.pan`),
    lowCut: n.num(o.lowCut, base.lowCut, LOW_CUT_MIN_HZ, LOW_CUT_MAX_HZ, `${path}.lowCut`),
    sends: sends(o.sends, base.sends, `${path}.sends`, n),
    inserts: normaliseInserts(o.inserts, `${path}.inserts`, n),
  };
}

/**
 * A strip's Output: absent stays absent, `'master'` and `'sidechain'` are
 * kept, and so is `{ group: id }` with a non-negative integer id
 * (windsor#284). Whether the song has that group is checked once every
 * group is read (`normaliseGroupOutputs`). Anything else is Master.
 */
function stripOutput(raw: unknown, path: string, n: FieldNormaliser): ChannelStrip['output'] {
  if (raw === undefined || raw === 'master' || raw === 'sidechain') return raw;
  if (isGroupOutput(raw)) {
    n.dropUnknown(raw as unknown as Record<string, unknown>, ['group'], path);
    return { group: raw.group };
  }
  n.correction(`${path}: invalid output — Master`);
  return 'master';
}

/**
 * `mute` or `solo` (windsor#154), kept exactly the way `output` is: an absent
 * key stays absent, and a `true` or a `false` that is present is kept as it
 * is, so normalising a normalised document changes nothing. A value that is
 * not a boolean is corrected to an explicit `false`, the way a junk `output`
 * becomes `'master'`: `documentDiffLive` probes a removed key with junk and
 * sends what comes back, and the engine skips an absent key, so undoing a
 * mute must read back as `false` to reach the live strip.
 */
export function switchedOn(
  key: 'mute' | 'solo',
  raw: unknown,
  path: string,
  n: FieldNormaliser,
): { mute?: boolean; solo?: boolean } {
  if (raw === undefined) return {};
  return { [key]: n.bool(raw, false, `${path}.${key}`) };
}

/** Sends overlay the base per bus — set a send to 0 to silence it — the
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
    if (!isReturnName(name)) {
      n.dangling.push(`${path}.${name}: no send bus "${name}" is defined`);
      n.correction(`${path}.${name}: dropped`);
      continue;
    }
    out[name] = n.num(amount, 0, 0, 1, `${path}.${name}`);
  }
  return out;
}

/**
 * The send buses over `RETURNS`, by name (windsor#172): each one's level and
 * its insert chain. A bus the document leaves out is the code's; a name
 * other than `a` or `b` is dangling and dropped.
 */
export function normaliseReturns(
  raw: unknown,
  n: FieldNormaliser,
): Record<string, ReturnSpec> | undefined {
  if (raw === undefined) return undefined;
  const o = n.section(raw, 'returns');
  const out: Record<string, ReturnSpec> = {};
  for (const [name, value] of Object.entries(o)) {
    if (!isReturnName(name)) {
      n.dangling.push(`returns.${name}: no send bus "${name}" is defined`);
      n.correction(`returns.${name}: dropped`);
      continue;
    }
    const base = RETURNS[name];
    const path = `returns.${name}`;
    const section = n.section(value, path);
    n.dropUnknown(section, ['level', 'inserts'], path);
    out[name] = {
      level: n.num(section.level, base.level, 0, RETURN_LEVEL_MAX, `${path}.level`),
      inserts: normaliseBusInserts(section.inserts, `${path}.inserts`, n, base.inserts),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * A bus's chain: a strip's list, read the same way, with two differences.
 * An absent list is the code's chain `base`, with the ids normalising gives
 * it (windsor#186), and so is junk, since that is
 * what the bus plays without one; an empty list is kept, and passes the
 * sends through. A compressor keys from the bus's own input: an external
 * sidechain is not offered on a bus, so one in the document is corrected
 * to internal. `bus` names the kind of bus in that correction: a send bus,
 * or a group (windsor#285).
 */
export function normaliseBusInserts(
  raw: unknown,
  path: string,
  n: FieldNormaliser,
  base: readonly InsertSpec[],
  bus = 'a send bus',
): InsertSpec[] {
  if (raw === undefined) return withInsertIds(base);
  if (!Array.isArray(raw)) {
    n.correction(`${path}: not a list — using the bus's default chain`);
    return withInsertIds(base);
  }
  return normaliseInserts(raw, path, n).map((spec, i) => {
    if (spec.kind !== 'compressor' || spec.sidechain === undefined) return spec;
    if (spec.sidechain === 'internal') return spec;
    n.correction(`${path}[${i}].sidechain: ${bus} keys from its own input — internal`);
    return { ...spec, sidechain: 'internal' };
  });
}
