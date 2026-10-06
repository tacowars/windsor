/**
 * The desk: which send buses exist, and where every part sits.
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
import { LOW_CUT_MIN_HZ } from '../audioConstants';
import type { AutomationLane } from '../automation/automationLane';
import { DEFAULT_ECHO } from '../inserts/echoInsert';
import type { InsertSpec } from '../inserts/insertRegistry';
import { DEFAULT_PLATE_REVERB } from '../inserts/plateReverbInsert';

/**
 * A send bus (windsor#172; record `2026-09-30-insert-rack-and-send-bus-chains`
 * §6): what the parts send, through an insert chain, at a level.
 *
 *   sends ─▶ input ─▶ [insert …] ─▶ level ─▶ master
 *
 * The chain is the song's, as a strip's `inserts` are. An empty chain passes
 * the sends to the master unprocessed.
 */
export interface ReturnSpec {
  /** Return gain, 0..1. */
  readonly level: number;
  /** Insert effects in signal order, at most `MAX_INSERTS`. */
  readonly inserts: readonly InsertSpec[];
}

/** The Mix a Plate reverb or an Echo starts at on a send bus: the effect alone, as the returns ran. */
export const SEND_BUS_WET_MIX = 1;

/**
 * `spec` as a send bus starts it (record §5): a Plate reverb or an Echo fully
 * wet, since the bus's level is its amount; any other kind as it is.
 */
export function onSendBus(spec: InsertSpec): InsertSpec {
  return spec.kind === 'plate' || spec.kind === 'echo' ? { ...spec, mix: SEND_BUS_WET_MIX } : spec;
}

/**
 * The send buses, Send A and Send B. Which buses exist is the code's, and a
 * document cannot add a third; what each one holds and how loud it is are
 * the song's. By default Send A is the hall plate and Send B the echo: the
 * sounds the fixed `room` and `echo` returns made before windsor#172.
 */
export const RETURNS = {
  a: { level: 0.9, inserts: [onSendBus(DEFAULT_PLATE_REVERB)] },
  b: { level: 0.6, inserts: [onSendBus(DEFAULT_ECHO)] },
} satisfies Record<string, ReturnSpec>;

export type ReturnName = keyof typeof RETURNS;

export const RETURN_NAMES = Object.keys(RETURNS) as ReturnName[];

/** Whether `name` is one of the code's send buses. */
export const isReturnName = (name: unknown): name is ReturnName =>
  typeof name === 'string' && Object.hasOwn(RETURNS, name);

/**
 * A group bus (windsor#284; record `2026-10-01-group-buses` §2–§3): a part
 * whose Output names it sends its whole dry signal here instead of to the
 * master, and the group plays to the master through its own chain.
 *
 *   members ─▶ input ─▶ [insert …] ─▶ pan ─▶ level ─▶ master
 *
 * The song owns its groups, up to `MAX_GROUPS`, in display order. The `id`
 * is what an Output names, so a rename touches nothing else; the `name` is
 * only a label. A group has no low cut and no sends. It may carry automation
 * lanes, as a part does (windsor#614).
 */
export interface GroupSpec {
  /** Stable, non-negative and unique within the song: what `{ group: id }` names. */
  readonly id: number;
  readonly name: string;
  /** The group fader, 0..`MIX_LEVEL_MAX`, as a strip's `level`. */
  readonly level: number;
  /** -1 (hard left) .. 1 (hard right), as a strip's `pan`. */
  readonly pan: number;
  /** Silences every member, dry and sends (record §6). Missing means off; a present `false` is kept. */
  readonly mute?: boolean;
  /** Counts as soloing every member (record §6). Missing means off; a present `false` is kept. */
  readonly solo?: boolean;
  /** Insert effects in signal order, at most `MAX_INSERTS`; a compressor keys from the group's input. */
  readonly inserts: readonly InsertSpec[];
  /**
   * The group's automation lanes (windsor#614, record
   * `2026-10-05-group-automation-folder-tracks` decisions 1–3): curves over
   * song time on its level, its pan and its inserts' fields, the lane type a
   * part carries. Missing means none; a partial's list replaces the whole.
   */
  readonly automation?: readonly AutomationLane[];
}

/** What a new group gets besides its id and name: unity, centred, no inserts, mute and solo absent. */
export const DEFAULT_GROUP: Omit<GroupSpec, 'id' | 'name'> = { level: 1, pan: 0, inserts: [] };

/** A strip's Output when it names a group bus by id (windsor#284). */
export interface GroupOutput {
  readonly group: number;
}

/** Whether `output` names a group: an object whose `group` is a non-negative integer. */
export const isGroupOutput = (output: unknown): output is GroupOutput =>
  typeof output === 'object' &&
  output !== null &&
  Number.isSafeInteger((output as { group?: unknown }).group) &&
  (output as GroupOutput).group >= 0;

/**
 * One strip shape for every part, aux parts included (record §8). `R` is the set of
 * bus names a strip may send to; the shipped `MIX` is checked against
 * `RETURNS` at compile time, while the routing code accepts any string.
 */
export interface ChannelStrip<R extends string = string> {
  /**
   * Missing means Master; sidechain suppresses dry and sends, preserving the
   * detector tap; `{ group: id }` plays the dry signal into that group bus
   * instead of the master, and keeps the part's own sends (windsor#284).
   */
  readonly output?: 'master' | 'sidechain' | GroupOutput;
  /**
   * Silences the part's dry signal and its sends, post-fader (windsor#154).
   * Missing means off; a present `false` is kept, as `output` keeps an
   * explicit Master. The sidechain key is tapped before it, so a muted kick
   * still ducks.
   */
  readonly mute?: boolean;
  /**
   * While any music part has it, every music part without it is silent, dry
   * and sends; the buses keep playing the soloed parts' sends (windsor#154).
   * Additive and missing means off; a present `false` is kept, as for
   * `mute`. Never applied to the aux strips.
   */
  readonly solo?: boolean;
  /** The mix fader, 0..4: sets the part's k-rate `gain` param (record §3). */
  readonly level: number;
  /** -1 (hard left) .. 1 (hard right): a rotation by pan·π/4 (record §4). */
  readonly pan: number;
  /**
   * Highpass cutoff in Hz, `LOW_CUT_MIN_HZ`..`LOW_CUT_MAX_HZ` (#640): the
   * strip's first stage, so the sends carry the cut signal too. The floor is
   * the resting value and reads as off.
   */
  readonly lowCut: number;
  /** Send amount per bus (`a`, `b`), 0..1; an absent bus is sent nothing (record §7). */
  readonly sends: Readonly<Partial<Record<R, number>>>;
  /**
   * Insert effects after the low cut, in signal order, at most `MAX_INSERTS`
   * (#641). The kinds are code-owned (`inserts/insertRegistry.ts`); which ones
   * a strip uses, and how they are set, is the song's.
   */
  readonly inserts: readonly InsertSpec[];
}

/** Unity, centred, uncut, dry, no inserts. What a part not named in the mix gets. */
export const DEFAULT_STRIP: ChannelStrip = {
  level: 1,
  pan: 0,
  lowCut: LOW_CUT_MIN_HZ,
  sends: {},
  inserts: [],
};

/**
 * Where each aux part sits, keyed by strip name — the strips `createAuxPart`
 * reaches for. Music parts are not here: since #597 each music part carries
 * its own strip in the song document, so a song's mix travels with the song.
 */
export const MIX = {
  audition: { level: 0.9, pan: 0, lowCut: LOW_CUT_MIN_HZ, sends: { a: 0.08 }, inserts: [] },
  ui: { level: 0.7, pan: 0, lowCut: LOW_CUT_MIN_HZ, sends: {}, inserts: [] },
} satisfies Record<string, ChannelStrip<ReturnName>>;

export type PartName = keyof typeof MIX;

/** The strip for a part, or `DEFAULT_STRIP` when the mix does not name it. */
export function stripFor(mix: Readonly<Record<string, ChannelStrip>>, name: string): ChannelStrip {
  return mix[name] ?? DEFAULT_STRIP;
}
