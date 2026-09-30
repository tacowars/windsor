/**
 * Who is heard under mute and solo (windsor#154, record
 * `2026-09-30-mixer-on-the-song-tab` decision 5): the rule the live roster
 * (`MusicRoster.resolveSolo`) and the stem plan both read, so playback and a
 * render cannot disagree about which part sounds.
 *
 * Solo is additive over the music parts: while any of them has it, every one
 * without it is soloed out, dry and sends. The aux strips never take part.
 */
import type { ChannelStrip } from './mix';

/** Whether any of `strips` is soloed. */
export const anySoloed = (strips: Iterable<{ readonly solo?: boolean }>): boolean => {
  for (const strip of strips) if (strip.solo === true) return true;
  return false;
};

/** Whether a part with `solo` is silenced by the others' solo. */
export const isSoloedOut = (solo: boolean | undefined, soloing: boolean): boolean =>
  soloing && solo !== true;

/** Whether the master hears a music part's dry signal and sends. */
export const isHeard = (strip: ChannelStrip, soloing: boolean): boolean =>
  strip.output !== 'sidechain' && strip.mute !== true && !isSoloedOut(strip.solo, soloing);
