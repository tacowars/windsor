/**
 * Which stems a song exports, and how they split into render passes
 * (windsor#41). Pure, so the rules are tested without an audio context.
 *
 * A stem is one part's strip, post-fader and pre-master with its sends
 * excluded, or one return (decision 1). A part whose strip is routed
 * "Sidechain only" is silent in the master: it is the muted part decision 4
 * names (written before Windsor had mute and solo), skipped unless the
 * caller asks for it. A part muted, or soloed out by another's solo
 * (windsor#154), is listed and renders silent, as playback plays it. A
 * return is exported when a part the master hears sends to it; with no send
 * it is silence, and no file.
 *
 * A pass renders the master on channels 0–1 and its stems on the pairs after
 * (decision 2): as many as the channel limit allows, and fewer when the
 * song is long enough that a full-width context would hold more float
 * samples than `RENDER_STEM_PASS_MAX_SAMPLES`.
 */
import { RETURN_NAMES } from '../mixer/mix';
import { anySoloed, isHeard } from '../mixer/soloRule';
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

export type StemSource = PartStem | ReturnStem;

/** What a stem render hands back: the master, then each stem. */
export type Stem = { readonly kind: 'master' } | StemSource;

export interface StemChoice {
  /** Export the parts routed "Sidechain only" as well (decision 4). Off by default. */
  includeMuted?: boolean;
}

export const isSidechainOnly = (part: DocumentPart): boolean => part.strip.output === 'sidechain';

/** The stems of `document`, parts by slot, then the returns in the desk's order. */
export function stemSources(document: ArrangementDocument, choice: StemChoice = {}): StemSource[] {
  const parts = [...document.parts]
    .sort((a, b) => a.slot - b.slot)
    .filter((part) => choice.includeMuted || !isSidechainOnly(part))
    .map<PartStem>((part) => ({
      kind: 'part',
      slot: part.slot,
      name: part.name,
      muted: isSidechainOnly(part),
    }));
  // Sidechain only, mute and solo gate the sends with the dry path, so only a heard part feeds a return.
  const soloing = anySoloed(document.parts.map((part) => part.strip));
  const heard = document.parts.filter((part) => isHeard(part.strip, soloing));
  const returns = RETURN_NAMES.filter((name) =>
    heard.some((part) => (part.strip.sends[name] ?? 0) > 0),
  ).map<ReturnStem>((name) => ({ kind: 'return', name }));
  return [...parts, ...returns];
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
