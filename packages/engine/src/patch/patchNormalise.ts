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
 * being one. `macros` (windsor#559) is the one list of any length: up to
 * `MACROS_MAX` macros, each against `makeMacro()`, and up to
 * `MACRO_MAPPINGS_MAX` mappings each against `makeMacroMapping()`; a mapping
 * whose target no macro may map (`macroTargetProblem`) is reported and dropped.
 */
import type { FieldNormaliser } from '../song/arrangementFields';
import { isRecord, show } from '../song/arrangementFields';
import { MACRO_MAPPINGS_MAX, MACROS_MAX } from '../worklet/fm/patchDefaults';
import { macroTargetProblem } from '../worklet/fm/voiceTargetTables';
import type { Macro, MacroMapping, Patch } from './patch';
import { driveOnByDefault, makeMacro, makeMacroMapping, makePatch } from './patch';

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

/**
 * One patch against the `makePatch()` template; the name defaults to the key.
 * A drive with no boolean `on` (a song saved before the switch, windsor#309)
 * takes `driveOnByDefault` of its own gain and bias, not the template's Off,
 * so it plays as it did.
 */
export function normalisePatch(
  raw: Record<string, unknown>,
  n: FieldNormaliser,
  path: string,
): Patch {
  const template = makePatch({ name: path.slice(path.lastIndexOf('.') + 1) });
  const patch = walk(template, { ...raw, macros: undefined }, n, path) as Patch;
  patch.macros = normaliseMacros(raw['macros'], n, `${path}.macros`);
  const drive = raw['drive'];
  if (!isRecord(drive) || typeof drive['on'] !== 'boolean') {
    patch.drive.on = driveOnByDefault(patch.drive.gain, patch.drive.bias);
  }
  return patch;
}

/** A list's items, the first `max` of them, with a correction for the rest; none for a non-list. */
function boundedList(raw: unknown, max: number, n: FieldNormaliser, path: string): unknown[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    n.correction(`${path}: ${show(raw)} is not a list — using none`);
    return [];
  }
  if (raw.length > max)
    n.correction(`${path}: ${raw.length} entries, at most ${max} — the rest dropped`);
  return raw.slice(0, max);
}

/** The patch's macros, each walked against `makeMacro()` with its mappings on their own. */
function normaliseMacros(raw: unknown, n: FieldNormaliser, path: string): Macro[] {
  const taken = new Set<string>();
  return boundedList(raw, MACROS_MAX, n, path).map((item, i) => {
    const at = `${path}[${i}]`;
    const fields = isRecord(item) ? { ...item, mappings: undefined } : item;
    const macro = walk(makeMacro(), fields, n, at) as Macro;
    const mappings = isRecord(item) ? item['mappings'] : undefined;
    macro.mappings = normaliseMappings(mappings, n, `${at}.mappings`, taken);
    return macro;
  });
}

/** A macro's mappings: one whose target no macro may map is reported and dropped. */
function normaliseMappings(
  raw: unknown,
  n: FieldNormaliser,
  path: string,
  taken: Set<string>,
): MacroMapping[] {
  const out: MacroMapping[] = [];
  boundedList(raw, MACRO_MAPPINGS_MAX, n, path).forEach((item, k) => {
    const at = `${path}[${k}]`;
    const target = isRecord(item) ? item['target'] : undefined;
    const problem = isRecord(item) ? macroTargetProblem(target, taken) : 'not a mapping';
    if (problem) return n.correction(`${at}: ${problem} — dropped`);
    const template = makeMacroMapping({ target: target as MacroMapping['target'] });
    out.push(walk(template, item, n, at) as MacroMapping);
    taken.add(String(target));
  });
  return out;
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
