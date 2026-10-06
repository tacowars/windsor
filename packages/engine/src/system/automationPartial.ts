/**
 * A part's or a group's `automation` in a live partial is the automation
 * player's (windsor#344, windsor#614; `songAutomation.ts`), not the
 * arrangement player's or the group desk's: `AudioSystem.apply` takes the key
 * out of each slot's and each group's partial before the merge or the group
 * plan, which would otherwise report it as unknown, and hands the whole
 * partial to the automation once everything else has landed.
 */
import type { DocumentPartial } from '../song/arrangementDocument';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Each entry of `section` without its `automation`; anything else, a removal or junk included, as it came. */
function withoutLanes<S>(section: S): S {
  if (!isRecord(section)) return section;
  return Object.fromEntries(
    Object.entries(section).map(([key, entry]) => {
      if (!isRecord(entry) || !('automation' in entry)) return [key, entry];
      const rest = { ...entry };
      delete rest.automation;
      return [key, rest];
    }),
  ) as S;
}

/** `parts` with no slot's `automation`; anything else, a removal or junk included, as it came. */
export function withoutAutomation(parts: DocumentPartial['parts']): DocumentPartial['parts'] {
  return withoutLanes(parts);
}

/** `groups` with no group's `automation`, a whole group added included (windsor#614). */
export function withoutGroupAutomation(
  groups: DocumentPartial['groups'],
): DocumentPartial['groups'] {
  return withoutLanes(groups);
}
