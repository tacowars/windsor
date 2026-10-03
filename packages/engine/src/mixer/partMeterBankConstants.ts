/**
 * The part meter bank (windsor#540): one worklet node with an input per
 * music part, reporting every part in one packed message. Its ballistics and
 * report rate are the strip meter's (`PEAK_METER`); this is only its name and
 * its message's layout. Import-free, so the processor's bundle carries
 * nothing else.
 */
export const PART_METER_BANK_NAME = 'windsor-part-meter-bank';

/**
 * Where each field of a part's report sits in its stretch of the message, in
 * `PeakReport`'s order. Overload is 0 or 1.
 */
export const PART_METER_FIELD = {
  left: 0,
  right: 1,
  holdLeft: 2,
  holdRight: 3,
  overload: 4,
} as const;

/** Floats per part: part `k`'s report is `[k * PART_METER_FIELDS, (k + 1) * PART_METER_FIELDS)`. */
export const PART_METER_FIELDS = 5;

/**
 * The message is `parts * PART_METER_FIELDS` floats, then one more: the
 * sequence number of the last `reset` or `clear` the processor had handled
 * when it posted, at this index. The main thread
 * ignores a slot's report from before its own latest one, so a report in
 * flight cannot put a removed part's clip latch back on its slot's new part.
 */
export function partMeterAckIndex(parts: number): number {
  return parts * PART_METER_FIELDS;
}

/** What the main thread posts to the bank's processor. */
export type PartMeterBankMessage =
  | { type: 'stop' }
  /** The clip latch and the held peaks of `slot` back to zero, as the strip meter's `reset`. */
  | { type: 'reset'; slot: number; seq: number }
  /** Everything of `slot` back to zero: its part was detached. */
  | { type: 'clear'; slot: number; seq: number };
