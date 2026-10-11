/**
 * The clip envelopes' tunables (windsor#701, epic windsor#699): the cap on
 * an envelope's points and the row its points are read on. Data only, and
 * import-free, so the Roll's config stays on the generators' pure side
 * (`generatorBoundary.test.ts`).
 */

/**
 * The most points one envelope holds: one per sixteenth across the longest
 * loop (`ROLL_LOOP_TICKS_MAX` / 6 ticks). Song lanes carry no cap of their
 * own, so this one is the roll's; `rollEnvelope.test.ts` pins the sum.
 */
export const ROLL_ENVELOPE_POINTS_MAX = 4096;

/**
 * The row an envelope is read and drawn on, an `AutomationTargetRow`: a
 * linear −1..1, 0 being the patch's own setting (epic windsor#699 decision
 * 2). The song lanes' evaluator, display space and shape stamps take it as
 * a lane's row, so a bend bows an envelope's segment as it bows a linear
 * lane's.
 */
export const ROLL_ENVELOPE_ROW = {
  target: '',
  label: '',
  min: -1,
  max: 1,
  scale: 'linear',
  unit: '',
} as const;
