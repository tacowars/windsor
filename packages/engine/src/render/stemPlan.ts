/**
 * Which stems a song exports, and how they split into render passes
 * (windsor#41). Pure, so the rules are tested without an audio context.
 *
 * A stem is one part's strip, post-fader and pre-master with its sends
 * excluded, one group bus, or one return (decision 1). A part whose strip is routed
 * "Sidechain only" is silent in the master: it is the muted part decision 4
 * names (written before Windsor had mute and solo), skipped unless the
 * caller asks for it. A part muted, or soloed out by another's solo
 * (windsor#154), is listed and renders silent, as playback plays it. A
 * return is exported when a part the master hears sends to it; with no send
 * it is silence, and no file.
 *
 * A group bus (windsor#286; record `2026-10-01-group-buses` decision 9) is
 * one stem, after its inserts, pan and level, and its members get none of
 * their own, whatever `includeMuted` says: the members are heard only
 * through the group, so the stems still add up to the master. Every group
 * has a stem, members or not: an empty group stays on the music bus, and an
 * insert audible from silence (Tape's hiss) reaches the master through it,
 * so its stem carries that, and is silent when the chain makes nothing. A
 * muted or soloed-out group's stem is listed, and silent, as a muted part's
 * is. A song with no parts plans no group stem: its render builds no music
 * graph (`buildSystem`), so no group bus plays, and stems play what the
 * render plays. A part naming a group the song lacks plays on Master, as the
 * live system plays it, and keeps its part stem.
 *
 * A pass renders the master on channels 0–1 and its stems on the pairs after
 * (decision 2): as many as the channel limit allows, and fewer when the
 * song is long enough that a full-width context would hold more float
 * samples than `RENDER_STEM_PASS_MAX_SAMPLES`.
 */
import { RETURN_NAMES } from '../mixer/mix';
import { groupOf, isHeard, isSoloing } from '../mixer/soloRule';
import type { ArrangementDocument, DocumentPart } from '../song/arrangementDocument';
import {
  RENDER_CHANNELS,
  RENDER_STEM_CHANNELS_MAX,
  RENDER_STEM_PASS_MAX_SAMPLES,
} from './renderConstants';

/** A part's stem: its slot, its label, and whether the master hears it. */
export interface PartStem {
  readonly kind: 'part';
  readonly slot: number;
  readonly name: string;
  /**
   * Routed "Sidechain only": silent in the master, exported only on request.
   * Not the strip's `mute` (windsor#154): a muted part's stem is listed, and silent.
   */
  readonly muted: boolean;
}

/** A send bus's stem, by bus name ("a", "b"). */
export interface ReturnStem {
  readonly kind: 'return';
  readonly name: string;
}

/** A group bus's stem: its id, its name, and its place in the song's group list, from 1. */
export interface GroupStem {
  readonly kind: 'group';
  readonly id: number;
  readonly name: string;
  readonly position: number;
}

export type StemSource = PartStem | GroupStem | ReturnStem;

/** What a stem render hands back: the master, then each stem. */
export type Stem = { readonly kind: 'master' } | StemSource;

export interface StemChoice {
  /** Export the parts routed "Sidechain only" as well (decision 4). Off by default. */
  includeMuted?: boolean;
}

export const isSidechainOnly = (part: DocumentPart): boolean => part.strip.output === 'sidechain';

/**
 * The stems of `document`: the ungrouped parts by slot, then every group in
 * the song's order, then the returns in the desk's order.
 */
export function stemSources(document: ArrangementDocument, choice: StemChoice = {}): StemSource[] {
  const groups = document.groups ?? [];
  const parts = [...document.parts]
    .sort((a, b) => a.slot - b.slot)
    .filter((part) => groupOf(part.strip, groups) === undefined)
    .filter((part) => choice.includeMuted || !isSidechainOnly(part))
    .map<PartStem>((part) => ({
      kind: 'part',
      slot: part.slot,
      name: part.name,
      muted: isSidechainOnly(part),
    }));
  // A part-less render builds no music graph, so no group bus plays to tap.
  const playedGroups = document.parts.length > 0 ? groups : [];
  const buses = playedGroups.map<GroupStem>((group, i) => ({
    kind: 'group',
    id: group.id,
    name: group.name,
    position: i + 1,
  }));
  // Sidechain only, mute and solo gate the sends with the dry path, so only a heard part feeds a return.
  // Renders play what playback plays: the live roster (`MusicRoster.resolveSolo`) reads the groups too.
  const soloing = isSoloing(
    document.parts.map((part) => part.strip),
    groups,
  );
  const heard = document.parts.filter((part) => isHeard(part.strip, soloing, groups));
  const returns = RETURN_NAMES.filter((name) =>
    heard.some((part) => (part.strip.sends[name] ?? 0) > 0),
  ).map<ReturnStem>((name) => ({ kind: 'return', name }));
  return [...parts, ...buses, ...returns];
}

export interface StemPassLimits {
  /** Channels one pass may have, the master's two included. */
  maxChannels: number;
  /** Float samples (frames × channels) one pass may hold. */
  maxSamples: number;
}

export const STEM_PASS_LIMITS: StemPassLimits = {
  maxChannels: RENDER_STEM_CHANNELS_MAX,
  maxSamples: RENDER_STEM_PASS_MAX_SAMPLES,
};

/**
 * The stems each pass renders, as index ranges into the source list, in
 * order. A song with no stem is still one pass: the master alone. Throws a
 * `RangeError` when not even one stem fits beside the master.
 */
export function planStemPasses(
  count: number,
  frames: number,
  limits: StemPassLimits = STEM_PASS_LIMITS,
): number[][] {
  const channels = Math.min(
    limits.maxChannels,
    Math.floor(limits.maxSamples / Math.max(1, frames)),
  );
  const perPass = Math.floor((channels - RENDER_CHANNELS) / RENDER_CHANNELS);
  if (count === 0) return [[]];
  if (perPass < 1) {
    throw new RangeError('a stem pass cannot hold the master and one stem at this length');
  }
  const passes: number[][] = [];
  for (let start = 0; start < count; start += perPass) {
    passes.push(Array.from({ length: Math.min(perPass, count - start) }, (_, i) => start + i));
  }
  return passes;
}

/** The channel count of a pass rendering `stems` stems beside the master. */
export const passChannels = (stems: number): number => RENDER_CHANNELS * (1 + stems);
