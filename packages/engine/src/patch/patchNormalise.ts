/**
 * The `patches` section of an arrangement document: named FM patches, every
 * one normalised against the shape `makePatch()` produces. A document patch
 * is what the console's Parts tab exports, so a song plays exactly the
 * knobs tacowars set rather than a preset that had to be hand-landed in the
 * factory bank (record `2026-09-11-music-document-carries-patches-and-returns`;
 * since #561 that bank is `patches/*.json`).
 *
 * Shape-driven, not field-driven: the template is the schema. A field takes
 * the raw value when its type matches the template's (a finite number, a
 * boolean, a string, an array of finite numbers) and the template's default
 * with a correction otherwise; unknown keys are reported and dropped. Ranges
 * are the worklet's business — `fm-processor.js` clamps every patch value it
 * reads (`num(raw.volume, 0.8)`) — so a number here is only ever checked for
 * being one.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { isRecord, show } from '../song/arrangementFields';
import type { Patch } from './patch';
import { makePatch } from './patch';

/** The `patches` section: a record of name → patch, junk entries dropped. */
export function normalisePatches(
  raw: unknown,
  n: FieldNormaliser,
): Record<string, Patch> | undefined {
  if (raw === undefined) return undefined;
  const o = n.section(raw, 'patches');
  const out: Record<string, Patch> = {};
  for (const [name, value] of Object.entries(o)) {
    if (name === '') {
      n.correction('patches: a patch needs a name — dropped');
      continue;
    }
    if (!isRecord(value)) {
      n.correction(`patches.${name}: ${show(value)} is not a patch — dropped`);
      continue;
    }
    out[name] = normalisePatch(value, n, `patches.${name}`);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/** One patch against the `makePatch()` template; the name defaults to the key. */
export function normalisePatch(
  raw: Record<string, unknown>,
  n: FieldNormaliser,
  path: string,
): Patch {
  const template = makePatch({ name: path.slice(path.lastIndexOf('.') + 1) });
  return walk(template, raw, n, path) as Patch;
}

function walk(template: unknown, raw: unknown, n: FieldNormaliser, path: string): unknown {
  if (Array.isArray(template)) return walkArray(template, raw, n, path);
  if (isRecord(template)) {
    if (!isRecord(raw)) {
      if (raw !== undefined)
        n.correction(`${path}: ${show(raw)} is not an object — using defaults`);
      return structuredClone(template);
    }
    n.dropUnknown(raw, Object.keys(template), path);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(template)) {
      out[key] = walk(value, raw[key], n, `${path}.${key}`);
    }
    return out;
  }
  return leaf(template, raw, n, path);
}

/**
 * `ops` (four operators) and `lfo.toOp` (four depths) keep the template's
 * length: an operator carries its own template, a depth is a number.
 * `userPartials` is the one field whose template is `null`: an array of
 * finite numbers, or nothing.
 */
function walkArray(
  template: readonly unknown[],
  raw: unknown,
  n: FieldNormaliser,
  path: string,
): unknown[] {
  const items = Array.isArray(raw) ? raw : [];
  if (raw !== undefined && !Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not an array — using defaults`);
  } else if (Array.isArray(raw) && raw.length !== template.length) {
    n.correction(`${path}: ${raw.length} entries for ${template.length} — resized`);
  }
  return template.map((item, i) => walk(item, items[i], n, `${path}[${i}]`));
}

function leaf(template: unknown, raw: unknown, n: FieldNormaliser, path: string): unknown {
  if (raw === undefined) return template;
  if (template === null) return partials(raw, n, path);
  if (typeof template === 'number') {
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : junk(template, raw, n, path);
  }
  if (typeof template === 'boolean') {
    return typeof raw === 'boolean' ? raw : junk(template, raw, n, path);
  }
  return typeof raw === 'string' ? raw : junk(template, raw, n, path);
}

function partials(raw: unknown, n: FieldNormaliser, path: string): number[] | null {
  if (raw === null) return null;
  if (Array.isArray(raw) && raw.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return [...(raw as number[])];
  }
  n.correction(`${path}: ${show(raw)} is not a list of partials — using none`);
  return null;
}

function junk(template: unknown, raw: unknown, n: FieldNormaliser, path: string): unknown {
  n.correction(`${path}: ${show(raw)} is not a ${typeof template} — using ${show(template)}`);
  return template;
}
