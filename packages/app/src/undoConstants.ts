/**
 * The undo history's tunables (windsor#124; epic windsor#112 decision 5):
 * how deep it goes. Record `2026-09-29-undo-history`.
 */

/** Steps the history keeps; recording one more drops the oldest. */
export const UNDO_DEPTH = 100;
