/**
 * The undo history's tunables (windsor#124; epic windsor#112 decision 5):
 * how deep it goes. Record `2026-09-29-undo-history`.
 */

/** Steps the history keeps; recording one more drops the oldest. */
export const UNDO_DEPTH = 100;

/**
 * Arrow presses on one knob less than this many ms apart are one step
 * (windsor#130 decision 4; epic windsor#112 decision 3): the step closes this
 * long after the last press.
 */
export const UNDO_MERGE_MS = 500;
