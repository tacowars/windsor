/**
 * Song controls and original DSP tuning for the Dub delay (record
 * `2026-10-17-dub-delay-regeneration`). Times are milliseconds, cutoffs Hz,
 * levels dB. Every range, default and curve here is Windsor's own.
 */
export const DELAY_NAME = 'dub-delay';
/** How the input reaches the two lines: L and R, both into the first line, or mid and side. */
export const DELAY_MODES = ['stereo', 'ping-pong', 'mid-side'] as const;
export const DELAY_MODE_IDS = { stereo: 0, 'ping-pong': 1, 'mid-side': 2 } as const;
/** The loop filter's shapes; Resonance is each one's gain at its cutoff. */
export const DELAY_FILTERS = ['lowpass', 'highpass', 'bandpass', 'peak'] as const;
export const DELAY_FILTER_IDS = { lowpass: 0, highpass: 1, bandpass: 2, peak: 3 } as const;
/** The loop's saturation: a lopsided soft curve, or a folder. */
export const DELAY_CHARACTERS = ['warm', 'fold'] as const;
export const DELAY_CHARACTER_IDS = { warm: 0, fold: 1 } as const;
/** The motion LFO's shapes. */
export const DELAY_WAVES = ['sine', 'triangle', 'random', 'drift'] as const;
export const DELAY_WAVE_IDS = { sine: 0, triangle: 1, random: 2, drift: 3 } as const;
export const DELAY_DIVISIONS = {
  '1/32': 0.125,
  '1/32T': 1 / 12,
  '1/32D': 0.1875,
  '1/16': 0.25,
  '1/16T': 1 / 6,
  '1/16D': 0.375,
  '1/8': 0.5,
  '1/8T': 1 / 3,
  '1/8D': 0.75,
  '1/4': 1,
  '1/4T': 2 / 3,
  '1/4D': 1.5,
  '1/2': 2,
  '1/2T': 4 / 3,
  '1/2D': 3,
  '1/1': 4,
} as const;
export const DELAY_BOUNDS = {
  leftMs: [1, 8000],
  rightMs: [1, 8000],
  /** The loop's gain where the filter passes; unity is the most, and sustain holds it there. */
  feedback: [0, 1],
  /** How much of each line's feedback crosses to the other: 1 alternates every repeat. */
  cross: [0, 1],
  lowCut: [20, 1000],
  cutoff: [30, 16000],
  /** The filter's gain at its cutoff (lowpass, highpass) or centre (bandpass, peak). */
  resonance: [-12, 20],
  /** Bandpass and peak width, in octaves. */
  width: [0.2, 4],
  drive: [0, 30],
  /** The high-frequency loss each pass, a cut-only shelf. */
  damping: [0, 30],
  dampingHz: [400, 16000],
  modRate: [0.05, 10],
  /** Delay-time wobble, a share of `DELAY_DSP.wowSpan`. */
  wow: [0, 1],
  /** Cutoff movement, in octaves each way. */
  sweep: [0, 4],
  mix: [0, 1],
  outputDb: [-24, 12],
} as const;
export const DELAY_DEFAULTS = {
  leftMs: 375,
  rightMs: 500,
  feedback: 0.55,
  cross: 0.2,
  lowCut: 90,
  cutoff: 2800,
  resonance: 3,
  width: 1,
  drive: 6,
  damping: 6,
  dampingHz: 3200,
  modRate: 0.6,
  wow: 0.15,
  sweep: 0,
  mix: 0.3,
  outputDb: 0,
  sustain: false,
  enabled: true,
};
export const DELAY_DSP = {
  defaultBpm: 120,
  dbBase: 10,
  dbDivisor: 20,
  // Four beats at 20 BPM. Slower imported sync times clamp; free mode has its own bound.
  maxSeconds: 12,
  secondsPerMinute: 60,
  milliseconds: 1000,
  smoothSeconds: 0.03,
  timeSmoothSeconds: 0.06,
  /** Sustain's move into and out of the held loop. */
  sustainSeconds: 0.025,
  cutoffRateRatio: 0.45,
  /** Samples between the loop filter's coefficient updates. */
  filterInterval: 16,
  /** The smallest Q the filter takes, so a deep cut stays a gentle knee. */
  minimumQ: 0.5,
  /** The time wobble's reach at Wow 1: a share of the delay time each way. */
  wowSpan: 0.025,
  /** The right side's LFO runs this share of a cycle ahead of the left's. */
  stereoPhase: 0.25,
  /** The warm curve's lean, which adds even harmonics; the low cut removes the offset it leaves. */
  warmBias: 0.18,
  /** How hard the fold's corners are rounded after the fold. */
  foldSoftness: 1.3,
  seed: 0x5eedd0b,
} as const;
/**
 * The loop's level governor: each line's saturation keeps its output's RMS at
 * its input's, and never above `ceiling`, so a loop driven past unity by its
 * resonance or held by sustain settles into a steady self-oscillation instead
 * of growing. It always runs, Drive 0 included.
 */
export const DELAY_GOVERNOR = {
  /** The RMS followers' time constant. */
  detectSeconds: 0.022,
  /** The gain's own smoothing, so the governor never ripples at audio rate. */
  gainSeconds: 0.006,
  /** The loop's RMS ceiling, linear: about −4.4 dBFS. */
  ceiling: 0.6,
  /**
   * The most the governor lifts a shape that has thinned its input, as a multiple of Drive's
   * gain: a shape scaled down by Drive needs up to that much back, and a fold through zero more.
   */
  maxGain: 4,
  /** A shaped signal this quiet in mean square has its gain held at unity. */
  quietSquare: 1e-14,
} as const;
/**
 * Sleep (windsor#793), the plate's pattern (record
 * `2026-09-15-silent-voices-and-plate-sleep-floors`) and its floors: an input
 * sample within `inputFloor` of 0 is silence, and a line write within
 * `outputFloor` is an inaudible repeat. Once no write has crossed the floor
 * for the line's whole length (`maxSeconds`, the longest time it can hold: any
 * older write has been overwritten, and a time move can reach every sample in
 * it), the lines hold nothing audible and the delay sleeps on a silent block,
 * unless its loop can hold or grow what is in it (`delayDsp.ts`'s `held`).
 */
export const DELAY_SLEEP = {
  inputFloor: 1e-9,
  outputFloor: 1e-7,
} as const;
