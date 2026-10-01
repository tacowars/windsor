/**
 * Who is heard under mute and solo (windsor#154, record
 * `2026-09-30-mixer-on-the-song-tab` decision 5): the rule the live roster
 * (`MusicRoster.resolveSolo`) and the stem plan both read, so playback and a
 * render cannot disagree about which part sounds.
 *
 * Solo is additive over the music parts: while any of them has it, every one
 * without it is soloed out, dry and sends. The aux strips never take part.
 *
 * Group buses (windsor#284; record `2026-10-01-group-buses` decision 6) take
 * part too: muting a group silences its members, soloing a group counts as
 * soloing every member, and soloing a member keeps its group open.
 */
import type { ChannelStrip, GroupSpec } from './mix';
import { isGroupOutput } from './mix';

/** What the rule reads of a group: its id, and its two switches. */
export type GroupSwitches = Pick<GroupSpec, 'id' | 'mute' | 'solo'>;

/** Whether any of `strips` is soloed. */
export const anySoloed = (strips: Iterable<{ readonly solo?: boolean }>): boolean => {
  for (const strip of strips) if (strip.solo === true) return true;
  return false;
};

/** Whether the song is soloing: any part or any group has solo. */
export const isSoloing = (
  strips: Iterable<{ readonly solo?: boolean }>,
  groups: Iterable<{ readonly solo?: boolean }> = [],
): boolean => anySoloed(strips) || anySoloed(groups);

/** Whether a part with `solo` is silenced by the others' solo. */
export const isSoloedOut = (solo: boolean | undefined, soloing: boolean): boolean =>
  soloing && solo !== true;

/** The group `strip`'s Output names, or undefined: Master, Sidechain, or a group `groups` lacks. */
export function groupOf<G extends GroupSwitches>(
  strip: ChannelStrip,
  groups: readonly G[],
): G | undefined {
  const output = strip.output;
  if (!isGroupOutput(output)) return undefined;
  return groups.find((group) => group.id === output.group);
}

/**
 * Whether the master hears a music part's dry signal and sends: its Output
 * isn't Sidechain, neither it nor its group is muted, and either nothing is
 * soloed, or it is, or its group is. `soloing` is `isSoloing` over the
 * song's parts and `groups`.
 */
export function isHeard(
  strip: ChannelStrip,
  soloing: boolean,
  groups: readonly GroupSwitches[],
): boolean {
  if (strip.output === 'sidechain' || strip.mute === true) return false;
  const group = groupOf(strip, groups);
  if (group?.mute === true) return false;
  return !soloing || strip.solo === true || group?.solo === true;
}

/**
 * Whether a group plays to the master: it isn't muted, and either nothing
 * is soloed, or it is, or one of its members is. `strips` are the song's
 * parts' strips; a member is one whose Output names the group.
 */
export function isGroupOpen(
  group: GroupSwitches,
  strips: Iterable<ChannelStrip>,
  soloing: boolean,
): boolean {
  if (group.mute === true) return false;
  if (!soloing || group.solo === true) return true;
  for (const strip of strips) {
    if (strip.solo === true && isGroupOutput(strip.output) && strip.output.group === group.id) {
      return true;
    }
  }
  return false;
}
