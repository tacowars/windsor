/** windsor#290: the declared experiment that qualifies the shipped Tape core's continuous
 * control domain for user knobs. Every value the run reads is here. Research only: the
 * core, its oversampler, its control smoothing and its constants are the shipped engine
 * sources, imported unchanged; nothing from the GPL research core is reachable from here.
 */
export const CONTROL = {
  /** Run order within a part: rate-major 48,000, 44,100, 96,000. */
  rates: [48000, 44100, 96000],
  /** The shipped oversampling factors (`TAPE_OVERSAMPLING`). */
  factors: [2, 4],
  /** The render quantum: knob targets are read and the stage configured once per block. */
  block: 128,
  /** The research row appended to the bundled `TAPE_MODELS` copy; the stage reads it. */
  researchModel: 'research',
  /**
   * The field program, in seconds, 10 s long. `level` is the declared domain |H| <= 4.
   * Tones: `bins` at bin x referenceRate / period Hz (99.6, 1013.7 and 7974.6 Hz) at
   * every rate, equal amplitude, sum / 3, peaking together at exactly `level`.
   */
  level: 4,
  tones: { bins: [17, 173, 1361], period: 8192, referenceRate: 48000 },
  seconds: 10,
  segments: [
    { name: 'ramp', start: 0, end: 1 },
    { name: 'tones', start: 1, end: 2 },
    { name: 'dc', start: 2, end: 5 },
    { name: 'opposite', start: 5, end: 7 },
    { name: 'spikes', start: 7, end: 9 },
    { name: 'silence', start: 9, end: 10 },
  ],
  /** Level changes [start s, value], each a raised-cosine `edge` from the value before it.
   * The first crossfades from the tones, so the field is continuous everywhere. */
  levels: [
    [2, 4],
    [3.5, -4],
    [4.995, 0],
    [5, 4],
    [5.5, -4],
    [6, 0],
  ],
  edge: 0.005,
  /** A `width`-long raised-cosine bump of +-level every `every` s from `start`, + first. */
  spike: { start: 7, end: 9, width: 0.001, every: 0.25 },
  /** Remanence: mean output (and M) over this many seconds before each segment's end. */
  remanence: 0.1,

  /** Part A: the width axis at the drive/saturation extremes, before the box is chosen. */
  width: {
    extremes: [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    /** The configure-only grid: susceptibility and gain from the shipped `configure`. */
    gridStep: 0.01,
    /** The rendered widths, under the program at 48 kHz at both factors. */
    rendered: [
      0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8,
      0.85, 0.9, 0.95, 0.99, 1,
    ],
    renderedRates: [48000],
    /** Rule (i): susceptibility at least `margin` x `TAPE_MAGNETIC.susceptibilityFloor`. */
    margin: 2,
    /** Rule (ii): the normalisation gain at most this multiple of its width-0 value. */
    relativeGain: 2,
  },

  /** Part B: the box drive [0,1] x width [0, wMax] x saturation [0,1]. */
  interior: {
    count: 256,
    /** Roberts' R3 additive recurrence: x_n = frac(shift + n / g^(1..3)), g^4 = g + 1. */
    g: 1.2207440846057596,
    /** The Cranley-Patterson shift: three draws of the engine's mulberry32 at this seed. */
    seed: 290,
  },
  /** Each control end to end and back (a triangle from its low end) in `periods` s, the
   * other two at each of their four corners, for the whole program. */
  sweep: { periods: [0.05, 1] },
  /** All three at once: `glide` moves linearly to a new uniform point in the box every
   * `hold` s; `jump` sets one every `hold` s. Each kind at every seed (mulberry32). */
  walks: {
    kinds: [
      { name: 'glide-1s', mode: 'glide', hold: 1 },
      { name: 'glide-50ms', mode: 'glide', hold: 0.05 },
      { name: 'jump-50ms', mode: 'jump', hold: 0.05 },
    ],
    seeds: [2901, 2902, 2903, 2904],
  },

  /** Worker processes (half the machine's 8 cores) and the hard wall-clock bound. */
  workers: 4,
  budgetMs: 1800000,
  /** `--check` re-renders these trials and compares their records exactly. */
  spotChecks: [
    'static/centre/48000/2',
    'sweep/width/1:-:1/0.05/96000/4',
    'walk/jump-50ms/2901/44100/2',
  ],
};
export type Control = typeof CONTROL;
export type Triple = [number, number, number];
