/** The output scope's tunables (#618; its three views, windsor#586). */

/** A peak above this paints the trace hot: the master is about to clip. */
export const SCOPE_CLIP_PEAK = 0.99;
export const SCOPE_TRACE_WIDTH = 1.4;

/**
 * Scope's window, in samples: the trace draws this many from a rising zero
 * crossing found in the same many before them, and its clip peak reads both.
 * It reads the newest `2 × SCOPE_WINDOW` samples of the analyser, however
 * large the analyser's buffer is.
 */
export const SCOPE_WINDOW = 1024;

/** The views a tap on the display cycles through, in order, and the title's label for each. */
export const SCOPE_VIEWS = ['scope', 'cycle', 'spectrum'] as const;
export type ScopeView = (typeof SCOPE_VIEWS)[number];
export const SCOPE_VIEW_LABELS: Readonly<Record<ScopeView, string>> = {
  scope: 'Scope',
  cycle: 'Cycle',
  spectrum: 'Spectrum',
};

/**
 * Cycle's period detection (`scopePeriod.ts`): a YIN difference function,
 * searched on a decimated copy and refined at the full rate.
 */
export const SCOPE_PERIOD = {
  /** The lowest and highest fundamentals it looks for, Hz. */
  minHz: 30,
  maxHz: 4000,
  /**
   * The coarse search runs on every `decimation` samples, each the mean of
   * that many: it keeps the search's cost bounded at about 160k
   * multiply-adds a frame at 48 kHz.
   */
  decimation: 4,
  /** The first lag whose cumulative-mean-normalised difference falls below this is the period. */
  threshold: 0.12,
  /**
   * The refined period counts only if one period apart the signal matches
   * itself this well (1 − difference / energy, 1 for a perfect repeat).
   */
  clarity: 0.95,
  /**
   * A coarse period shorter than this frequency's is searched again at the
   * full rate (about 150k multiply-adds at 48 kHz), where the coarse lag grid
   * is too rough for a bright high tone.
   */
  fineMinHz: 125,
  /** Below this mean square (about −80 dBFS RMS) the input is silence and has no period. */
  silence: 1e-8,
} as const;

/** Cycle's drawing. */
export const SCOPE_CYCLE = {
  /** How many periods fill the width. */
  periods: 2,
  /** The auto-gain brings the peak to this share of the half-height... */
  fill: 0.9,
  /** ...but never multiplies by more than this, so a quiet tail stays quiet. */
  maxGain: 12,
} as const;

/** Spectrum's peak labels (`scopePeaks.ts`) and drawing. */
export const SCOPE_PEAKS = {
  /** At most this many peaks are labelled, loudest first. */
  count: 3,
  /** A peak quieter than this, dBFS, is never labelled. */
  floorDb: -60,
  /** A local maximum within this many semitones of a louder peak is part of it... */
  semitones: 1,
  /** ...as is one within this many bins, where a semitone is narrower than the window's main lobe. */
  minBins: 4,
  /** The lowest frequency a peak may sit at, Hz: below it is DC and rumble. */
  minHz: 20,
} as const;

/** Concert pitch, for naming a peak's note: A4 is MIDI note 69 at 440 Hz. */
export const SCOPE_TUNING = { a4Midi: 69, a4Hz: 440 } as const;

export const SCOPE_SPECTRUM = {
  /** The filled area's opacity under the curve's line. */
  fillAlpha: 0.3,
  lineWidth: 1,
  labelFont: '9px "IBM Plex Mono", monospace',
  /** A label reads its frequency to this, Hz (`peakLabel`'s one decimal). */
  labelResolutionHz: 0.1,
  /** The labels' rows, px: the first baseline, and the step between rows. */
  labelTop: 10,
  labelRow: 11,
  /** A label keeps this far inside the canvas's edges, and this far right of its peak's marker. */
  labelInset: 2,
  labelGap: 3,
  /** The peak's marker. */
  markerRadius: 1.5,
} as const;
