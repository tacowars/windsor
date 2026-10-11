/**
 * The bloom insert's controls: names, ranges, defaults and the enum lists,
 * stated once for the processor's descriptors, the spec's normaliser, the
 * automation rows and the console's knobs.
 * Also the route's own tunables (`BLOOM_DSP`): smoothing, sleep and the
 * switch. Each DSP module's tunables live in its own constants file
 * (`bloomBandsConstants.ts`, `bloomDynamicsConstants.ts`,
 * `bloomEnvelopeConstants.ts`, `bloomGeneratorConstants.ts`,
 * `bloomOutputConstants.ts`), so each lever is tuned in one place.
 *
 * bloom's DSP is its own, from published models (complex band-pass filters,
 * a peak compressor, additive sawtooth synthesis); its defaults are the
 * design's target response.
 */
export const BLOOM_NAME = 'bloom';

/** The Octave control's intervals, in semitones (a stepped knob). */
export const BLOOM_OCTAVES = [-12, 0, 7, 12, 19, 24] as const;

/**
 * Key and Scale reach the processor as one pitch set (windsor#728, record
 * `2026-10-11-bloom-follows-the-song`): a 12-bit mask, bit p set when pitch
 * class p (C = 0) is allowed. Every class allowed is chromatic, the default;
 * the processor reads an empty set as every class. The lists Key and Scale
 * pick from are Windsor's own (`bloomPitches.ts`), worked out on the main
 * thread, so the worklet holds no scale table.
 */
export const BLOOM_PITCH_CLASSES = 12;
export const BLOOM_PITCHES_ALL = (1 << BLOOM_PITCH_CLASSES) - 1;

/**
 * Shape's corners, in order along its 0..4 morph (a continuous waveform
 * sweep): sine, triangle, saw (the default), square, then a pulse narrowing
 * towards its end.
 */
export const BLOOM_SHAPES = ['sine', 'triangle', 'saw', 'square', 'pulse'] as const;

/** The lowest and highest band as MIDI notes: F2 and E6 (A440). */
export const BLOOM_LOWEST_NOTE = 41;
export const BLOOM_HIGHEST_NOTE = 88;

/**
 * Continuous (and stepped numeric) controls as `[min, max]`: 0..1 for
 * Amount, Mix, Spread and Density; seconds for Swell and Sustain; Shape
 * 0 sine … 4 pulse; Bright in dB per octave; Low and High as MIDI notes; Focus
 * as a factor on every band's width; Octave in semitones (one of
 * `BLOOM_OCTAVES`).
 */
export const BLOOM_BOUNDS = {
  amount: [0, 1],
  mix: [0, 1],
  swell: [0, 10],
  sustain: [0, 30],
  spread: [0, 1],
  shape: [0, 4],
  bright: [-12, 6],
  focus: [0.5, 2],
  density: [0, 1],
  low: [BLOOM_LOWEST_NOTE, BLOOM_HIGHEST_NOTE],
  high: [BLOOM_LOWEST_NOTE, BLOOM_HIGHEST_NOTE],
  octave: [-12, 24],
} as const;

export type BloomNumber = keyof typeof BLOOM_BOUNDS;

/**
 * The defaults are the design's target response: the full layer at Mix
 * 50 % (`x + E`), every lever neutral, and Density at 1 − 1/1.8, the shared
 * compressor's 1.8:1 as the fraction of full levelling (1 − 1/ratio).
 */
export const BLOOM_DEFAULTS = {
  amount: 1,
  mix: 0.5,
  swell: 0,
  sustain: 0,
  spread: 0,
  shape: 2,
  bright: 0,
  focus: 1,
  density: 1 - 1 / 1.8,
  low: BLOOM_LOWEST_NOTE,
  high: BLOOM_HIGHEST_NOTE,
  octave: 0,
  freeze: false,
  enabled: true,
};

/** Key's and Scale's defaults: C, and `chromatic`, Scale's off (every pitch class). */
export const BLOOM_KEY_DEFAULT = 'C';
export const BLOOM_SCALE_DEFAULT = 'chromatic';
/**
 * Scale's Song key (windsor#717): the song's harmony root and scale, resolved
 * in the stage from the harmony the registry hands it, never in the spec.
 */
export const BLOOM_SCALE_SONG = 'song';
/**
 * Scale's Song chord (windsor#729): the pitch classes of the chord the
 * harmony track is on, scheduled on the transport (`bloomChordFollower.ts`)
 * and held by the stage, never in the spec.
 */
export const BLOOM_SCALE_CHORD = 'chord';

/** The route's tunables (`worklet/bloom/bloomDsp.ts`). */
export const BLOOM_DSP = {
  /** One-pole smoothing of the continuous controls, per block. */
  smoothSeconds: 0.02,
  /** A smoothed control this close to its target lands on it, so the smoother goes idle. */
  snapFloor: 1e-6,
  /** Input under this is silence, for sleep. */
  sleepInputFloor: 1e-9,
  /** The generated layer under this for a whole block is silent, for sleep. */
  sleepOutputFloor: 1e-7,
  /** How long the input must stay silent before bloom may sleep (past the detector's hold). */
  sleepWaitSeconds: 0.3,
  /**
   * The analysis (bands, dynamics, envelope, pitch) runs at the host rate
   * over the largest power of two that keeps it at or above this, Hz: 11.025
   * or 12 kHz at 44.1/48 kHz (÷4) and 88.2/96 kHz (÷8). The bands stop at
   * 1.41 kHz and the detector at 1.7 kHz, so this leaves room for the
   * decimator; the synthesis runs at the host rate.
   */
  analysisHz: 11025,
  /**
   * The synthesis renders segments of about 1/segmentHz s (whole analysis
   * steps: 8 host samples at 44.1/48 kHz, 16 at 88.2/96 kHz): each band's
   * level, phase and darkening are set once a segment and ramped across it.
   * Band signals are under 100 Hz wide, so a 6 kHz update loses nothing,
   * and the per-segment corrections' sidebands stay at least 6 kHz from
   * each partial, under −80 dB (16 samples at 44.1 kHz put them 2.8 kHz out
   * and over it). The layer is one segment late.
   */
  segmentHz: 6000,
  /** The decimator is this many cascaded boxcars of the factor's length (sinc^order): its nulls sit on the images. */
  decimatorOrder: 4,
};

/**
 * The processor's outputs and its `split` param, for the wet-path slot
 * (record `2026-10-11-bloom-insert`, E2). Output 0 is bloom's whole output,
 * or only the dry share once `split` is 1; output 1 is the layer after
 * Amount, before Mix (stereo); output 2 is the gain the slot's return takes
 * (Mix's wet share × the switch), a mono signal into a native gain's `gain`.
 * `split` is a-rate: the stage's `route` ramps it over `INSERT_FADE_SECONDS`
 * with `fadeRamp`, on the same timeline as the child's own fade, and the
 * processor applies it sample by sample. The stage always builds all three.
 */
export const BLOOM_SLOT = {
  splitParam: 'split',
  outputs: 3,
  outputChannelCount: [2, 2, 1],
  mixOutput: 0,
  wetOutput: 1,
  wetGainOutput: 2,
} as const;
