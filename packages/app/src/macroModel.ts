/**
 * The Macros card's rules (windsor#561, record `2026-10-04-patch-macro-knobs`
 * decisions 2–6 and 11), pure over a patch's `macros`: every list edit
 * returns a new `Macro[]`, which the card writes into the working patch and
 * pushes whole, since a merge replaces an array wholesale. Also what the
 * target picker offers, what a mapping plays at the macro's value, and which
 * Parts-tab knob a mapping holds.
 *
 * The shaping arithmetic is the app's own copy of the record's decision 4,
 * pinned by `macroModel.test.ts` to values worked from that decision and to
 * the voice's own (`worklet/fm/voiceMacros.ts`, windsor#560) over a sweep.
 * The voice's compiles only under the worklet's flags, so the engine's index
 * cannot export it to the main thread.
 */
import type {
  Macro,
  MacroMapping,
  VoiceAutomationRow,
  VoiceTargetPath,
  VoiceTargetRow,
} from '@windsor/engine';
import {
  MACRO_CURVE,
  MACRO_MAPPINGS_MAX,
  MACROS_MAX,
  OP_NAMES,
  VOICE_AUTOMATION_ROWS,
  makeMacro,
  makeMacroMapping,
  macroTargetProblem,
  voiceTargetRow,
} from '@windsor/engine';
import { MACRO_NAME_PREFIX, PICKER_GROUP_PREFIX } from './macroTables';
import { voiceGroupLabel } from './songAutomationTables';

/** The voice target row of macro `index`'s value: what its knob and a lane on it address. */
export const macroValuePath = (index: number): string => `macros.${index}.value`;

/**
 * The name a new macro takes: `Macro <n>` at its place in the row, or at the
 * lowest `n` no macro has where a macro already holds that name.
 */
export function nextMacroName(macros: readonly Macro[], prefix = MACRO_NAME_PREFIX): string {
  const names = new Set(macros.map((macro) => macro.name.trim()));
  const free = (n: number): boolean => !names.has(`${prefix} ${n}`);
  let n = macros.length + 1;
  if (!free(n)) n = Array.from({ length: n }, (_, i) => i + 1).find(free) ?? n;
  return `${prefix} ${n}`;
}

/** Whether another macro fits: fewer than `MACROS_MAX`. */
export const canAddMacro = (macros: readonly Macro[]): boolean => macros.length < MACROS_MAX;

/** Whether macro `index` takes another mapping: fewer than `MACRO_MAPPINGS_MAX`. */
export const canAddMapping = (macros: readonly Macro[], index: number): boolean =>
  (macros[index]?.mappings.length ?? MACRO_MAPPINGS_MAX) < MACRO_MAPPINGS_MAX;

/** The list with a new macro at its end, named `Macro <n>` at value 0; unchanged when full. */
export function addMacro(macros: readonly Macro[]): Macro[] {
  if (!canAddMacro(macros)) return [...macros];
  return [...macros, makeMacro({ name: nextMacroName(macros), value: 0 })];
}

/** The list without macro `index` and its mappings. */
export const removeMacro = (macros: readonly Macro[], index: number): Macro[] =>
  macros.filter((_, i) => i !== index);

/** Macro `index` replaced by `edit` of it. */
const editMacro = (
  macros: readonly Macro[],
  index: number,
  edit: (macro: Macro) => Macro,
): Macro[] => macros.map((macro, i) => (i === index ? edit(macro) : macro));

/** Macro `index` renamed; a name that trims to nothing keeps the previous one. */
export function renameMacro(macros: readonly Macro[], index: number, name: string): Macro[] {
  const trimmed = name.trim();
  if (trimmed === '') return [...macros];
  return editMacro(macros, index, (macro) => ({ ...macro, name: trimmed }));
}

/** Macro `index` at `value`. */
export const setMacroValue = (macros: readonly Macro[], index: number, value: number): Macro[] =>
  editMacro(macros, index, (macro) => ({ ...macro, value }));

/** Every target a mapping of the patch covers, with the macro that maps it. */
export function mappedTargets(macros: readonly Macro[]): Map<string, string> {
  const taken = new Map<string, string>();
  macros.forEach((macro, i) => {
    for (const mapping of macro.mappings) {
      if (!taken.has(mapping.target)) taken.set(mapping.target, macroLabel(macro, i));
    }
  });
  return taken;
}

/** A macro's name as the card and a locked knob show it; a blank one is its row's `Macro <n>`. */
export const macroLabel = (macro: Macro, index: number): string =>
  macro.name.trim() || `${MACRO_NAME_PREFIX} ${index + 1}`;

/** A macro tile's accessible names: its value knob's and its remove button's. */
export interface MacroTileNames {
  readonly knob: string;
  readonly remove: string;
}

/** Macro `index`'s tile names, re-read on a rename so neither keeps the old name. */
export function macroTileNames(macro: Macro, index: number): MacroTileNames {
  const label = macroLabel(macro, index);
  return { knob: label, remove: `Remove macro ${label}` };
}

/**
 * Macro `index` with a mapping onto `target` that starts with `min` and `max`
 * at `current`, the target's value in the patch, `Linear` and not inverted,
 * so adding it changes nothing until a knob moves. Unchanged when the macro
 * is full, or the target is a macro's row, unknown or already mapped.
 */
export function addMapping(
  macros: readonly Macro[],
  index: number,
  target: VoiceTargetPath,
  current: number,
): Macro[] {
  const taken = new Set(mappedTargets(macros).keys());
  if (!canAddMapping(macros, index) || macroTargetProblem(target, taken) !== undefined) {
    return [...macros];
  }
  const mapping = makeMacroMapping({
    target,
    min: current,
    max: current,
    curve: MACRO_CURVE.LINEAR,
    inverted: false,
  });
  return editMacro(macros, index, (macro) => ({
    ...macro,
    mappings: [...macro.mappings, mapping],
  }));
}

/** Macro `index` without its mapping `at`. */
export const removeMapping = (macros: readonly Macro[], index: number, at: number): Macro[] =>
  editMacro(macros, index, (macro) => ({
    ...macro,
    mappings: macro.mappings.filter((_, j) => j !== at),
  }));

/** The fields of a mapping the card edits. */
export type MappingField = 'min' | 'max' | 'curve' | 'inverted';

/** Macro `index`'s mapping `at` with `field` set to `value`. */
export function setMappingField<F extends MappingField>(
  macros: readonly Macro[],
  index: number,
  at: number,
  field: F,
  value: MacroMapping[F],
): Macro[] {
  return editMacro(macros, index, (macro) => ({
    ...macro,
    mappings: macro.mappings.map((m, j) => (j === at ? { ...m, [field]: value } : m)),
  }));
}

/** One target the picker lists: its path, its name in its group, and the macro holding it, if one does. */
export interface MappingOption {
  readonly path: VoiceTargetPath;
  readonly label: string;
  readonly takenBy?: string;
}

/** One group of the picker: Filter, Op A … Op D, LFO, Pitch. */
export interface MappingGroup {
  readonly label: string;
  readonly options: readonly MappingOption[];
}

/** A row's name in its picker group: an operator's drops its `Op A ` (the group says it). */
const optionLabel = (row: VoiceAutomationRow): string => {
  if (row.section.kind !== 'operator') return row.label;
  const prefix = `Op ${OP_NAMES[row.section.op] ?? ''} `;
  return row.label.startsWith(prefix) ? row.label.slice(prefix.length) : row.label;
};

/** A voice row's group, as the lane picker labels it: `Voice · Op A`. */
export const mappingGroupLabel = (row: VoiceAutomationRow): string =>
  voiceGroupLabel(row.section, OP_NAMES);

/**
 * The target picker (decision 4): the lane picker's voice groups in the
 * catalog's order, without the macro rows, each target a mapping already
 * covers named with the macro that maps it, so the card can grey it.
 */
export function mappingPickerGroups(
  macros: readonly Macro[],
  rows: readonly VoiceAutomationRow[] = VOICE_AUTOMATION_ROWS,
): MappingGroup[] {
  const taken = mappedTargets(macros);
  const groups = new Map<string, MappingOption[]>();
  for (const row of rows) {
    if (row.section.kind === 'macro') continue;
    const label = mappingGroupLabel(row).replace(PICKER_GROUP_PREFIX, '');
    const by = taken.get(row.path);
    const option = { path: row.path, label: optionLabel(row), ...(by ? { takenBy: by } : {}) };
    groups.set(label, [...(groups.get(label) ?? []), option]);
  }
  return [...groups].map(([label, options]) => ({ label, options }));
}

/** The macro's travel `x` (0..1) through a curve: inverted first, then Linear, Exp, Log or S. */
export function shapeMacro(x: number, curve: number, inverted: boolean): number {
  const clamped = Math.min(1, Math.max(0, x));
  const t = inverted ? 1 - clamped : clamped;
  switch (curve) {
    case MACRO_CURVE.EXP:
      return t * t * t;
    case MACRO_CURVE.LOG: {
      const u = 1 - t;
      return 1 - u * u * u;
    }
    case MACRO_CURVE.S:
      // x²(3 − 2x), written as x²(1 + 2(1 − x)).
      return t * t * (1 + 2 * (1 - t));
    default:
      return t;
  }
}

/**
 * What `mapping` plays at macro value `x` on its target's `row`: `min..max`
 * clamped to the row's bounds, a ratio row's ends raised to its floor, then
 * interpolated by the shaped travel, geometrically on a ratio row (a cutoff
 * sweeps in octaves) and linearly on an add row.
 */
export function mappedValue(mapping: MacroMapping, x: number, row: VoiceTargetRow): number {
  const t = shapeMacro(x, mapping.curve, mapping.inverted);
  const bound = (v: number): number => Math.min(row.max, Math.max(row.min, v));
  let lo = bound(mapping.min);
  let hi = bound(mapping.max);
  if (row.curve === 'ratio') {
    lo = Math.max(lo, row.floor);
    hi = Math.max(hi, row.floor);
    if (lo > 0 && hi > 0) return lo * Math.exp(t * Math.log(hi / lo));
  }
  return lo + t * (hi - lo);
}

/** What `mapping` plays at macro value `x`, or undefined for a target the voice table lacks. */
export function mappingPlays(mapping: MacroMapping, x: number): number | undefined {
  const row = voiceTargetRow(mapping.target);
  return row ? mappedValue(mapping, x, row) : undefined;
}

/** What holds a mapped knob: the macro's name and the value the mapping plays now. */
export interface MappedKnob {
  readonly macro: string;
  readonly value: number;
}

/**
 * The mapping holding the knob at `path`, if one does (decision 6): the name
 * of its macro and what it plays at the macro's value, `live(index)` where a
 * lane holds the macro, else the patch's.
 */
export function mappedKnob(
  macros: readonly Macro[],
  path: string,
  live: (index: number) => number | undefined = () => undefined,
): MappedKnob | undefined {
  for (let i = 0; i < macros.length; i++) {
    const macro = macros[i];
    const mapping = macro?.mappings.find((m) => m.target === path);
    if (!macro || !mapping) continue;
    const value = mappingPlays(mapping, live(i) ?? macro.value);
    return value === undefined ? undefined : { macro: macroLabel(macro, i), value };
  }
  return undefined;
}
