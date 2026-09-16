/**
 * The desk: which returns exist, and where every part sits.
 *
 * A mix and a sound are different objects. `Patch` owns what an instrument
 * *is* -- timbre, designed loudness, how its voices spread. This table owns
 * where it sits tonight: level, placement, how much room. One file, readable in
 * one screen, diffable, typed, inside `npm run verify`.
 * Decision: docs/log/2026-08-31-mixer-sends-returns-and-channel-strips.md §2.
 *
 * Everything here is exported plain data with an exported type. The arrangement
 * console (#70) reads it to populate controls, so nothing tunable may hide in a
 * constructor call or a private field.
 */
import type { ReverbSpace } from './reverbSpace';
import { SPACES } from './reverbSpace';

/** A plate, 100% wet, fed by sends. `level` is how loud the room is. */
export interface ReverbReturn {
  readonly kind: 'reverb';
  readonly space: ReverbSpace;
  /** Return gain, 0..1. */
  readonly level: number;
}

/** A feedback delay with a damping lowpass in the loop. */
export interface DelayReturn {
  readonly kind: 'delay';
  /** Seconds. */
  readonly delayTime: number;
  /** 0..0.95; the return clamps above that. */
  readonly feedback: number;
  /** Hz. Lowpass in the feedback loop, so repeats darken. */
  readonly damp: number;
  /** Return gain, 0..1. */
  readonly level: number;
}

export type ReturnSpec = ReverbReturn | DelayReturn;

/**
 * The returns. The routing supports any number; exactly one plate is created
 * until a mix demands a second, because no unmeasured DSP runs for nothing
 * (record §6). Adding a return is one entry here plus the sends that name it.
 */
export const RETURNS = {
  room: { kind: 'reverb', space: SPACES.hall, level: 0.9 },
  echo: { kind: 'delay', delayTime: 0.28, feedback: 0.3, damp: 3200, level: 0.6 },
} satisfies Record<string, ReturnSpec>;

export type ReturnName = keyof typeof RETURNS;

export const RETURN_NAMES = Object.keys(RETURNS) as ReturnName[];

/**
 * One strip shape for every part, SFX included (record §8). `R` is the set of
 * return names a strip may send to; the shipped `MIX` is checked against
 * `RETURNS` at compile time, while the routing code accepts any string.
 */
export interface ChannelStrip<R extends string = string> {
  /** The mix fader, 0..4: sets the part's k-rate `gain` param (record §3). */
  readonly level: number;
  /** -1 (hard left) .. 1 (hard right): a rotation by pan·π/4 (record §4). */
  readonly pan: number;
  /** Send amount per return, 0..1; an absent return sends nothing (record §7). */
  readonly sends: Readonly<Partial<Record<R, number>>>;
}

/** Unity, centred, dry. What a part not named in the mix gets. */
export const DEFAULT_STRIP: ChannelStrip = { level: 1, pan: 0, sends: {} };

/**
 * Where each SFX part sits, keyed by strip name — the strips `createSfxPart`
 * reaches for. Music parts are not here: since #597 each music part carries
 * its own strip in the song document, so a song's mix travels with the song.
 */
export const MIX = {
  place: { level: 0.9, pan: 0.3, sends: { room: 0.08 } },
  ui: { level: 0.7, pan: 0, sends: {} },
} satisfies Record<string, ChannelStrip<ReturnName>>;

export type PartName = keyof typeof MIX;

/** The strip for a part, or `DEFAULT_STRIP` when the mix does not name it. */
export function stripFor(mix: Readonly<Record<string, ChannelStrip>>, name: string): ChannelStrip {
  return mix[name] ?? DEFAULT_STRIP;
}
