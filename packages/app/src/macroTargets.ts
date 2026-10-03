/**
 * Which macro rows a part's pickers offer, and under what name (windsor#559,
 * record `2026-10-04-patch-macro-knobs` decision 10). The catalog holds a
 * row per macro slot, labelled `Macro <i + 1>`; a picker offers one only
 * when the part's patch defines that macro, and then under the patch's name
 * for it. Every other voice row is offered as it is. A lane already on an
 * undefined macro keeps the catalog's label (record decision 7).
 */
import type { Macro, Patch } from '@windsor/engine';
import { macroIndexOf } from '@windsor/engine';

/** The macro of `patch` whose row is `path`, or undefined for any other path or an undefined macro. */
const macroAt = (patch: Patch | undefined, path: string): Macro | undefined => {
  const index = macroIndexOf(path);
  return index < 0 ? undefined : patch?.macros[index];
};

/** Whether a picker on a part playing `patch` offers the voice target at `path`. */
export const offersVoicePath = (patch: Patch | undefined, path: string): boolean =>
  macroIndexOf(path) < 0 || macroAt(patch, path) !== undefined;

/** The patch's name for the macro at `path`, or undefined where the catalog's label stands. */
export function macroName(patch: Patch | undefined, path: string): string | undefined {
  const name = macroAt(patch, path)?.name.trim();
  return name ? name : undefined;
}
