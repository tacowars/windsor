/**
 * The engine host's tunables (#618). `host.ts` and `main.ts` belong to the
 * core-cleanup ticket (#620); this table is where the number the composition
 * file configures lives, per CLAUDE.md "Code structure".
 */

/** The look-ahead pump the game's render loop provides; in the console, a timer. */
export const HOST_PUMP_INTERVAL_MS = 25;
