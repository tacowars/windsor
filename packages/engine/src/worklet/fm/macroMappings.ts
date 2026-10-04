/**
 * The mappings the voice applies for a patch (windsor#560, record
 * `2026-10-04-patch-macro-knobs`): the one rule for which of a patch's macro
 * mappings stand. Only the first `MACROS_MAX` macros count, and in each only
 * the first `MACRO_MAPPINGS_MAX` mappings; a mapping whose target is not a
 * voice target, or is a macro row, is dropped; and a target keeps the first
 * mapping on it, across macros. `min` and `max` are clamped to the target
 * row's bounds, and a curve outside the ids is Linear.
 *
 * Invariant: the worklet's `normalisePatch` builds a patch's macros from this
 * list, and the main thread asks it which targets are mapped (the inert
 * direct lane in `synth/voiceAutomation.ts`, the app's pickers), so the two
 * sides cannot disagree. Read by the main thread too, so it touches no
 * worklet scope. Pinned by `macroMappings.test.ts`. Read at a message, never
 * in the render.
 */

import type { MacroMapping } from '../../patch/patch';
import { MACRO_LINEAR, MACRO_S } from './modeIds';
import { MACRO_MAPPING_DEFAULTS, MACRO_MAPPINGS_MAX, MACROS_MAX } from './patchDefaults';
import { macroTargetProblem, voiceTargetRow } from './voiceTargetTables';

/** One mapping the voice applies, and the index of the macro it hangs from. */
interface EffectiveMacroMapping {
  macro: number;
  mapping: MacroMapping;
}

const mappingNumber = (v: unknown, d: number): number =>
  typeof v === 'number' && isFinite(v) ? v : d;

const clampToRow = (v: number, range: { min: number; max: number }): number =>
  Math.max(range.min, Math.min(range.max, v));

/** One raw mapping, normalised, or null to drop it (and `taken` gains its target when kept). */
function effectiveMapping(raw: unknown, taken: Set<string>): MacroMapping | null {
  const o = (raw || {}) as Partial<MacroMapping>;
  const row = voiceTargetRow(o.target);
  if (!row || macroTargetProblem(o.target, taken) !== undefined) return null;
  taken.add(row.path);
  const d = MACRO_MAPPING_DEFAULTS;
  const curve = mappingNumber(o.curve, d.curve) | 0;
  return {
    target: row.path,
    min: clampToRow(mappingNumber(o.min, d.min), row),
    max: clampToRow(mappingNumber(o.max, d.max), row),
    curve: curve < MACRO_LINEAR || curve > MACRO_S ? MACRO_LINEAR : curve,
    inverted: !!o.inverted,
  };
}

/** The raw mappings of one raw macro, as a list (none when it has no array). */
const rawMappingsOf = (macro: unknown): unknown[] => {
  const mappings = ((macro || {}) as { mappings?: unknown }).mappings;
  return Array.isArray(mappings) ? (mappings as unknown[]) : [];
};

/**
 * The mappings the voice applies for `patch`, in macro order and, within a
 * macro, in the order written. Takes a full or a partial patch, or anything a
 * message carries.
 */
function effectiveMacroMappings(patch: unknown): EffectiveMacroMapping[] {
  const raw = ((patch || {}) as { macros?: unknown }).macros;
  const list = Array.isArray(raw) ? (raw as unknown[]) : [];
  const taken = new Set<string>();
  const out: EffectiveMacroMapping[] = [];
  for (let i = 0; i < list.length && i < MACROS_MAX; i++) {
    const mappings = rawMappingsOf(list[i]);
    for (let k = 0; k < mappings.length && k < MACRO_MAPPINGS_MAX; k++) {
      const mapping = effectiveMapping(mappings[k], taken);
      if (mapping) out.push({ macro: i, mapping });
    }
  }
  return out;
}

/** Whether the voice maps the target at `path` from one of `patch`'s macros. */
const macroMapsTarget = (patch: unknown, path: string): boolean =>
  effectiveMacroMappings(patch).some(({ mapping }) => mapping.target === path);

export type { EffectiveMacroMapping };
export { effectiveMacroMappings, macroMapsTarget };
