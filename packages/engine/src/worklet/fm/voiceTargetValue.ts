/**
 * The one voice target curve (windsor#419), for the main thread: the value a
 * `voiceTargetTables.ts` row plays for an offset over the patch's own, and a
 * step lane's value through it. The voice writes the same arithmetic out in
 * place (`voiceStepMod.ts`, `voiceOffsets.ts`), since no double crosses a
 * call on the audio thread; `fmProcessorStepMod.test.ts` holds the two
 * together, so a console showing what a step plays and the voice agree.
 *
 * Invariant: an offset of exactly 0 returns the base untouched, neither
 * floored nor clamped. Pure and import-free but for the row's type, so it
 * never touches the worklet scope. `voiceTargetValue.test.ts` pins it.
 */

import type { VoiceTargetRow } from './voiceTargetTables';

/**
 * The value `row` plays for `offset` over the patch's `base`: `base +
 * offset` (add) or `max(base, floor) × 2^offset` (ratio, octaves), clamped
 * to `min..max`. An offset of 0 is `base` exactly.
 */
function voiceTargetValue(row: VoiceTargetRow, base: number, offset: number): number {
  if (offset === 0) return base;
  const x =
    row.curve === 'ratio'
      ? (base < row.floor ? row.floor : base) * Math.pow(2, offset)
      : base + offset;
  return x < row.min ? row.min : x > row.max ? row.max : x;
}

/** The value a step lane's `v` (-1..1) plays over `base`: the offset `v × span` in the row's curve. */
function stepModValue(row: VoiceTargetRow, base: number, v: number): number {
  return voiceTargetValue(row, base, v * row.span);
}

export { stepModValue, voiceTargetValue };
