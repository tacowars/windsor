/**
 * The edit that sets the built bundle's synced voices at the part's rate
 * (windsor#656), for `voice2x.mjs` and `interleaved2x.mjs`. Research only.
 */
import { replaceOnce } from '../2026-10-09-sync-antialias-study/candidates.mjs';

/** The built bundle with every voice at the part's rate: its `syncOversample` switch off. */
export function at1x(text) {
  return replaceOnce(
    text,
    'this.syncOversample = opts.syncOversample !== false;',
    'this.syncOversample = false;',
  );
}
