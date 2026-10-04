/**
 * Which macro rows a part's pickers offer, and under what name (windsor#559,
 * record `2026-10-04-patch-macro-knobs` decision 10). The catalog holds a
 * row per macro slot, labelled `Macro <i + 1>`; a picker offers one only
 * when the part's patch defines that macro, and then under the patch's name
 * for it. A target one of the patch's macros maps is not offered
 * (windsor#560): the macro sets its base, and a lane on it is inert. Every
 * other voice row is offered as it is. A lane already on an undefined macro
 * keeps the catalog's label (record decision 7).
 */
import type { Macro, Patch } from '@windsor/engine';
import { macroIndexOf, macroMapsTarget } from '@windsor/engine';

/** The macro of `patch` whose row is `path`, or undefined for any other path or an undefined macro. */
const macroAt = (patch: Patch | undefined, path: string): Macro | undefined => {
  const index = macroIndexOf(path);
  return index < 0 ? undefined : patch?.macros[index];
};

/**
 * Whether a picker on a part playing `patch` offers the voice target at
 * `path`: not a macro the patch does not define, and not a target one of
 * its macros maps, which a lane could not move (record decision 6).
 */
export const offersVoicePath = (patch: Patch | undefined, path: string): boolean =>
  macroIndexOf(path) < 0 ? !macroMapsTarget(patch, path) : macroAt(patch, path) !== undefined;

/** The patch's name for the macro at `path`, or undefined where the catalog's label stands. */
export function macroName(patch: Patch | undefined, path: string): string | undefined {
  const name = macroAt(patch, path)?.name.trim();
  return name ? name : undefined;
}
