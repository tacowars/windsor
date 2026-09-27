/**
 * The engine host's tunables (#618). `host.ts` and `main.ts` belong to the
 * core-cleanup ticket (#620); this table is where the number the composition
 * file configures lives, per CLAUDE.md "Code structure".
 */

/** How often the console's timer pumps the scheduler's look-ahead queue (`AudioSystem.update`). */
export const HOST_PUMP_INTERVAL_MS = 25;
