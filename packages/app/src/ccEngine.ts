/**
 * What the console's CC models need from the outside world (windsor#783,
 * record `2026-10-13-midi-cc-mapping`), as types only: a controller message
 * with the input it came from, a part's mapping, and the engine as the CC
 * router reaches it. The models stay pure: the MIDI panel decodes the
 * message and implements `CcEngine` over the live system, and the tests fake
 * both.
 */
import type { AutomationTargetRow, CcMapping, CcTargetId, Patch } from '@windsor/engine';

/** One controller message, from `decodeMidi`'s `cc` event and the input that sent it. */
export interface CcMessage {
  /**
   * The input's name, as the MIDI selector matches it, or null for an input
   * with no name (Web MIDI's `name` null; `MidiAccessor.inputs()` shows the
   * unstable id instead, which a mapping must never record).
   */
  readonly device: string | null;
  /** 1–16. */
  readonly channel: number;
  /** 0–127. */
  readonly cc: number;
  /** 0–127. */
  readonly value: number;
}

/** A mapping and the part, by slot, whose target it moves (decision 1). */
export interface PartCcMapping {
  readonly part: number;
  readonly mapping: CcMapping;
}

/** A target as its part has it now: its row and the value it plays with no CC. */
export interface CcTargetNow {
  /** The target's row for this part: a voice row, the strip's, or the insert kind's field. */
  readonly row: AutomationTargetRow;
  /** The patch's, the strip's or the insert's own value, in the row's units. */
  readonly own: number;
}

/**
 * What the engine did with a CC's value: `applied`, or `noSlot` when a voice
 * target found none of the part's eight slots free (decision 8).
 */
export type CcApplyResult = 'applied' | 'noSlot';

/**
 * The engine as the CC router sees it. The MIDI panel implements it over the
 * live part, its strip and its inserts.
 */
export interface CcEngine {
  /** The target on `part` now, or undefined when the part does not hold it (no such insert). */
  target(part: number, target: CcTargetId): CcTargetNow | undefined;
  /** The patch `part` plays, whose macros decide whether a voice mapping is inert (decision 10). */
  patch(part: number): Patch | undefined;
  /** Whether a song lane that is on holds the target, so the CC is ignored (decision 3). */
  automated(part: number, target: CcTargetId): boolean;
  /** Set the target's CC base to `value`, in the row's units (decision 3). */
  apply(part: number, target: CcTargetId, value: number): CcApplyResult;
  /** Drop the target's CC base: it plays its own value again and gives back its slot. */
  clear(part: number, target: CcTargetId): void;
}
