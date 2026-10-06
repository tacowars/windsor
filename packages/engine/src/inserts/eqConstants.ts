/**
 * The Parametric EQ's controls, ids and DSP tunables (windsor#198, record
 * `2026-09-30-parametric-eq-insert`). The ranges are written here and nowhere
 * else: the normaliser, the AudioParam descriptors, the coefficient module and
 * the console all read them from this table.
 */
export const EQ_NAME = 'eq';
export const EQ_BAND_COUNT = 8;

/** A band's filter types; a type's numeric id (its AudioParam value) is its index here. */
export const EQ_BAND_TYPES = [
  'lowcut',
  'lowshelf',
  'bell',
  'notch',
  'highshelf',
  'highcut',
] as const;
export type EqBandType = (typeof EQ_BAND_TYPES)[number];
export const EQ_TYPE_ID = {
  lowcut: 0,
  lowshelf: 1,
  bell: 2,
  notch: 3,
  highshelf: 4,
  highcut: 5,
} as const satisfies Record<EqBandType, number>;

/** A cut's slopes in dB/oct; a slope's numeric id (its AudioParam value) is its index here. */
export const EQ_SLOPES = [6, 12, 24, 48] as const;
export type EqSlope = (typeof EQ_SLOPES)[number];

export const EQ_BOUNDS = {
  freq: [10, 22000],
  gain: [-24, 24],
  q: [0.1, 18],
  scale: [0, 2],
  output: [-24, 24],
} as const;

/** √½: a new band's Q, and the Q at which a cut is maximally flat. */
export const EQ_FLAT_Q = Math.SQRT1_2;

/** A new EQ is flat: bands 2–7 on at 0 dB, the two cuts off. */
export const EQ_DEFAULT_BANDS = [
  { on: false, type: 'lowcut', slope: 12, freq: 30, gain: 0, q: EQ_FLAT_Q },
  { on: true, type: 'lowshelf', slope: 12, freq: 100, gain: 0, q: EQ_FLAT_Q },
  { on: true, type: 'bell', slope: 12, freq: 250, gain: 0, q: EQ_FLAT_Q },
  { on: true, type: 'bell', slope: 12, freq: 800, gain: 0, q: EQ_FLAT_Q },
  { on: true, type: 'bell', slope: 12, freq: 2500, gain: 0, q: EQ_FLAT_Q },
  { on: true, type: 'bell', slope: 12, freq: 6000, gain: 0, q: EQ_FLAT_Q },
  { on: true, type: 'highshelf', slope: 12, freq: 10000, gain: 0, q: EQ_FLAT_Q },
  { on: false, type: 'highcut', slope: 12, freq: 18000, gain: 0, q: EQ_FLAT_Q },
] as const;
export const EQ_DEFAULTS = { enabled: true, scale: 1, output: 0 };

/** A 6 dB/oct cut is one first-order section, and ignores Q. */
export const EQ_FIRST_ORDER_SLOPE = 6;
/**
 * The second-order sections of every steeper cut, as the Qs of a maximally
 * flat (Butterworth) cut: 1 / (2 cos((2k − 1)π / 2n)) for k = 1…n/2, lowest
 * first. The last (highest) is multiplied by the band's q / √½, so √½ is
 * maximally flat and more Q adds a bump at the corner; 12 dB/oct is one
 * section at the band's own Q.
 */
export const EQ_CUT_SECTION_Q: Readonly<Record<12 | 24 | 48, readonly number[]>> = {
  12: [EQ_FLAT_Q],
  24: [0.541196100146197, 1.3065629648763766],
  48: [0.5097955791041592, 0.6013448869350453, 0.8999762231364156, 2.5629154477415055],
};

export const EQ_DSP = {
  /** The design holds every frequency below this fraction of the running sample rate. */
  maxFrequencyRatio: 0.49,
  /** Frequency, gain and Q glide on a one-pole of this time constant (frequency and Q in log). */
  smoothSeconds: 0.02,
  /** Coefficients are recomputed every this many samples, only while a band moves. */
  refreshFrames: 16,
  /** A type, slope or on change fades the band out, switches, and fades in: this long each way. */
  bandFadeSeconds: 0.005,
  /** Filter state below this is flushed to zero once per render quantum. */
  flushThreshold: 1e-20,
  /** A glide is settled (and snaps to its target) once within this, in log units or dB. */
  settleLog: 1e-6,
  settleDb: 1e-5,
  settleGain: 1e-7,
  /** The most second-order sections a band runs (a 48 dB/oct cut). */
  maxSections: 4,
  /** b0, b1, b2, a1, a2 per section. */
  coefficientsPerSection: 5,
  /** Two TDF-II state words per section per channel, stereo. */
  statePerSection: 4,
  /** The work buffers' length; a longer render quantum is processed in pieces of this. */
  blockFrames: 128,
  /** The longest render quantum a missing input is read as silence for. */
  maxQuantumFrames: 4096,
  /** A switch-like parameter (on, enabled) is on at or above this. */
  switchThreshold: 0.5,
  millisecondsPerSecond: 1000,
} as const;

/**
 * Listen on drag (windsor#200, record decision 9): while the console holds a
 * band, the EQ plays only a band-pass at that band's frequency and Q. Live
 * only, never in the spec or the song.
 */
export const EQ_LISTEN = {
  /** `listen(off)`: the full EQ again. */
  off: -1,
  /** The band-pass's Q never falls below this, so a wide band still sounds like a band. */
  minQ: 0.5,
  /** Listening fades in, out, and from one band to the next over this long. */
  fadeSeconds: 0.01,
} as const;

/**
 * The output spectrum's analyser (windsor#200): on a tap after the EQ's
 * output, never in the program path, and connected only while the card asks.
 */
export const EQ_SPECTRUM = {
  fftSize: 4096,
  /** The analyser's `smoothingTimeConstant`: how slowly a bin falls between reads. */
  smoothing: 0.8,
} as const;

/**
 * Where a section's coefficients (b0, b1, b2, a1, a2; a0 = 1) sit in its
 * `coefficientsPerSection`, and its TDF-II state (two words per channel) in
 * its `statePerSection`.
 */
export const EQ_SECTION = {
  b0: 0,
  b1: 1,
  b2: 2,
  a1: 3,
  a2: 4,
  left1: 0,
  left2: 1,
  right1: 2,
  right2: 3,
} as const;

/**
 * The matched shelf's third fitting point sits at the analog prototype's zero
 * frequency, but never closer to the corner than this ratio: at a small gain
 * the two points would coincide and the fit lose its precision.
 */
export const EQ_SHELF_MIN_SEPARATION = 1.02;

export const EQ_MATH = {
  decimal: 10,
  /** dB = 20 log10(amplitude). */
  dbPerDecade: 20,
  /** dB = 10 log10(power). */
  powerDbPerDecade: 10,
  /** A = 10^(dB / 40): the cookbook's amplitude for bells and shelves. */
  shelfDbPerDecade: 40,
  half: 0.5,
  three: 3,
  four: 4,
  /** The floor of a power ratio before its logarithm (−240 dB). */
  powerFloor: 1e-24,
} as const;
