/**
 * The compressor's gain-reduction readout: the mean reduction over a fixed
 * window, so the number holds still long enough to read while the bar beside
 * it follows every frame. Pure, so it tests in Node.
 */
import { COMPRESSOR_READOUT_WINDOW_MS } from './compressorTables';

/** The window being summed: its index since time zero, and its frames so far. */
export interface GrWindow {
  index: number;
  sum: number;
  count: number;
}

export const EMPTY_GR_WINDOW: GrWindow = { index: -1, sum: 0, count: 0 };

export interface GrStep {
  window: GrWindow;
  /** The mean of the window that just closed, or null while one is still open. */
  shown: number | null;
}

/** Adds one frame's reduction at `nowMs`; a frame in a new window closes the old one. */
export function stepGrWindow(
  open: GrWindow,
  db: number,
  nowMs: number,
  windowMs = COMPRESSOR_READOUT_WINDOW_MS,
): GrStep {
  const index = Math.floor(nowMs / windowMs);
  if (index === open.index) {
    return { window: { index, sum: open.sum + db, count: open.count + 1 }, shown: null };
  }
  const shown = open.count > 0 ? open.sum / open.count : null;
  return { window: { index, sum: db, count: 1 }, shown };
}
