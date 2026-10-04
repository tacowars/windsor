/**
 * The Macros card's rules (windsor#561, record `2026-10-04-patch-macro-knobs`
 * decisions 2–6 and 11), pure over a patch's `macros`: every list edit
 * returns a new `Macro[]`, which the card writes into the working patch and
 * pushes whole, since a merge replaces an array wholesale. Also what the
 * target picker offers, what a mapping plays at the macro's value, and which
 * Parts-tab knob a mapping holds.
 *
 * What a mapping plays is the engine's `macroMappedValue` (windsor#566), the
 * voice's own shaping as one scalar, so the card and the voice agree.
 */
import type { Macro, MacroMapping, VoiceAutomationRow, VoiceTargetPath } from '@windsor/engine';
import {
  MACRO_CURVE,
  MACRO_MAPPINGS_MAX,
  MACROS_MAX,
  OP_NAMES,
  VOICE_AUTOMATION_ROWS,
  makeMacro,
  makeMacroMapping,
  macroMappedValue,
  macroTargetProblem,
  voiceTargetRow,
} from '@windsor/engine';
import { readout } from './automationReadout';
import { MACRO_NAME_PREFIX, PICKER_GROUP_PREFIX, floorSeedNotice } from './macroTables';
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
 * Where a new mapping onto `target` starts: `current`, the target's value in
 * the patch, or the row's floor where a `ratio` row's value sits below it (a
 * decay time at 0, an LFO rate at 0). A mapping's endpoint below the floor
 * plays the floor (decision 4), so seeding there shows what plays (windsor#568).
 */
export function mappingSeed(target: VoiceTargetPath, current: number): number {
  const row = voiceTargetRow(target);
  return row?.curve === 'ratio' && current < row.floor ? row.floor : current;
}

/**
 * The notice when a new mapping onto `target` starts at its row's floor
 * rather than at `current` (windsor#568), or undefined when it starts at
 * `current`: `Op A Decay is at 0, which a macro cannot reach; the mapping starts at 1 ms.`
 */
export function floorSeedNote(target: VoiceTargetPath, current: number): string | undefined {
  const seed = mappingSeed(target, current);
  const row = VOICE_AUTOMATION_ROWS.find((r) => r.path === target);
  return seed !== current && row ? floorSeedNotice(row.label, readout(row, seed)) : undefined;
}

/**
 * Macro `index` with a mapping onto `target` that starts with `min` and `max`
 * at `mappingSeed(target, current)`, `Linear` and not inverted, so adding it
 * changes nothing until a knob moves, except a target below its floor, which
 * starts at the floor. Unchanged when the macro is full, or the target is a
 * macro's row, unknown or already mapped.
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
    min: mappingSeed(target, current),
    max: mappingSeed(target, current),
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

/** What `mapping` plays at macro value `x`, or undefined for a target the voice table lacks. */
export function mappingPlays(mapping: MacroMapping, x: number): number | undefined {
  const row = voiceTargetRow(mapping.target);
  return row ? macroMappedValue(row, mapping, x) : undefined;
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
