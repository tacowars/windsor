/**
 * Spectre's tunables (record `2026-10-16-spectre-insert`): a spectral delay
 * that splits each channel into frequency bands with a short-time Fourier
 * transform, then gives every band its own gain, delay and feedback, read
 * off three drawn curves over a log-frequency axis. An input modulation
 * stage reshapes the bands first, and an LFO moves the curves. Read by the
 * main thread (spec, card, automation) and by `worklet/spectre/`, so it
 * imports nothing but the delay's divisions, which are data too.
 */
import { DELAY_DIVISIONS } from './delayConstants';

/** The processor's registered name. */
export const SPECTRE_NAME = 'spectre-insert';

/**
 * The analysis resolution: the bands a frame splits into at 48 kHz. A frame
 * is twice as many samples; at 88.2 kHz and up the frame doubles again, so a
 * setting keeps its sound across rates (`spectreFrameSize`).
 */
export const SPECTRE_BANDS = ['128', '256', '512', '1024', '2048'] as const;
export type SpectreBands = (typeof SPECTRE_BANDS)[number];

/** Frames per window: how far apart frames start, as a share of a frame (1×: none overlap). */
export const SPECTRE_OVERLAPS = ['1x', '2x', '4x'] as const;
export type SpectreOverlap = (typeof SPECTRE_OVERLAPS)[number];
export const SPECTRE_OVERLAP_FACTORS: Readonly<Record<SpectreOverlap, number>> = {
  '1x': 1,
  '2x': 2,
  '4x': 4,
};

/**
 * The analysis and synthesis window. Each side applies the square root of the
 * shape, so the pair multiplies to the shape itself: `smooth` is a raised
 * cosine, `triangle` a tent, and `hard` none at all, whose frame edges grind.
 */
export const SPECTRE_WINDOWS = ['smooth', 'triangle', 'hard'] as const;
export type SpectreWindow = (typeof SPECTRE_WINDOWS)[number];

/**
 * The input modulation stage: what reshapes the bands before the curves.
 * Each reads three generic amounts, `modA` to `modC`, whose meaning is the
 * algorithm's (`SPECTRE_MOD_LABELS`).
 */
export const SPECTRE_MODS = [
  'off',
  'blur',
  'holes',
  'invert',
  'shift',
  'comb',
  'gate',
  'pulse',
  'scatter',
  'phase',
  'swell',
  'smudge',
] as const;
export type SpectreMod = (typeof SPECTRE_MODS)[number];

/** Each algorithm's three amounts, by name; an empty name is an amount it ignores. */
export const SPECTRE_MOD_LABELS: Readonly<Record<SpectreMod, readonly [string, string, string]>> = {
  off: ['', '', ''],
  blur: ['Amount', 'Width', 'Jitter'],
  holes: ['Depth', 'Density', 'Length'],
  invert: ['Threshold', 'Amount', ''],
  shift: ['Shift', '', ''],
  comb: ['Depth', 'Spacing', 'Offset'],
  gate: ['Threshold', 'Depth', 'Invert'],
  pulse: ['Rate', 'Width', 'Feedback'],
  scatter: ['Distance', 'Rate', ''],
  phase: ['Amount', 'Rate', ''],
  swell: ['Depth', 'Speed', 'Spread'],
  smudge: ['Position', 'Span', ''],
};

export const SPECTRE_LFO_SHAPES = ['sine', 'triangle', 'saw', 'square', 'random'] as const;
export type SpectreLfoShape = (typeof SPECTRE_LFO_SHAPES)[number];

/** The tempo divisions the synced time, the grid and the synced LFO pick from. */
export const SPECTRE_DIVISIONS = Object.keys(DELAY_DIVISIONS) as (keyof typeof DELAY_DIVISIONS)[];
export type SpectreDivision = keyof typeof DELAY_DIVISIONS;
/** The grid a band's delay snaps to: off, or a division. */
export const SPECTRE_GRIDS = ['off', ...SPECTRE_DIVISIONS] as const;
export type SpectreGrid = 'off' | SpectreDivision;

/** The three drawn curves, in the order their cells are laid out (record `2026-10-17-spectre-drawn-cells`). */
export const SPECTRE_CURVES = ['gain', 'delay', 'feedback'] as const;
export type SpectreCurve = (typeof SPECTRE_CURVES)[number];

/**
 * Cells a curve holds across the log-frequency axis, each the same share of
 * it: about 18 an octave over the axis's ten.
 */
export const SPECTRE_CELLS = 180;
/** Where a curve rests: what Erase writes and a new lane starts at. Gain whole, no delay, no feedback. */
export const SPECTRE_REST: Readonly<Record<SpectreCurve, number>> = {
  gain: 1,
  delay: 0,
  feedback: 0,
};
/** A cell's value is stored to this many steps of 1, so a song's round trip is exact. */
export const SPECTRE_CELL_STEPS = 1000;

/**
 * What the selection follows (record `2026-10-17-spectre-drawn-cells`
 * decision 4): only what is drawn (`off`), or the cells nearest the song
 * key's notes or the harmony track's chord, in every octave, within what is
 * drawn (or everywhere, when nothing is).
 */
export const SPECTRE_FOLLOWS = ['off', 'key', 'chord'] as const;
export type SpectreFollow = (typeof SPECTRE_FOLLOWS)[number];
/** Every pitch class, as the 12-bit mask a key or chord is handed in. */
export const SPECTRE_PITCHES_ALL = 0xfff;

/** Freeze's modes: Hold loops every band at full feedback; Carve keeps the drawn feedback, so a band drawn low decays. */
export const SPECTRE_FREEZE_MODES = ['hold', 'carve'] as const;
export type SpectreFreezeMode = (typeof SPECTRE_FREEZE_MODES)[number];

/**
 * Where each LFO slot reaches: a curve's Shift (by `lfoShiftOctaves` at
 * depth 1), Offset or Select, or the modulation's first amount.
 */
export const SPECTRE_LFO_DESTS = [
  'gainShift',
  'delayShift',
  'feedbackShift',
  'gainOffset',
  'delayOffset',
  'feedbackOffset',
  'gainSelect',
  'delaySelect',
  'feedbackSelect',
  'modA',
] as const;
export type SpectreLfoDest = (typeof SPECTRE_LFO_DESTS)[number];

/** The continuous fields: the spec's ranges, the automation rows' and the knobs'. */
export const SPECTRE_BOUNDS = {
  /** The delay curve's full scale when not synced, in ms. */
  timeMs: [20, 8000],
  /** Each curve slid along the frequency axis, in octaves: up moves the shape to higher bands. */
  gainShift: [-4, 4],
  delayShift: [-4, 4],
  feedbackShift: [-4, 4],
  /** Each curve's values moved up or down, as a share of its full scale. */
  gainOffset: [-1, 1],
  delayOffset: [-1, 1],
  feedbackOffset: [-1, 1],
  /** A fixed random delay per band, as a share of full scale, added before the grid. */
  scatter: [0, 1],
  /** The right channel's curves slid this many octaves from the left's, half each way. */
  spread: [-2, 2],
  /** The input modulation's three amounts. */
  modA: [0, 1],
  modB: [0, 1],
  modC: [0, 1],
  /** The LFO's rate when not synced, in Hz. */
  lfoHz: [0.02, 20],
  /** Each curve's selected cells moved up or down, as a share of its full scale. */
  gainSelect: [-1, 1],
  delaySelect: [-1, 1],
  feedbackSelect: [-1, 1],
  /** Each LFO slot's depth into its destination. */
  lfoDepth1: [-1, 1],
  lfoDepth2: [-1, 1],
  lfoDepth3: [-1, 1],
  mix: [0, 1],
  outputDb: [-24, 12],
} as const;

export const SPECTRE_DEFAULTS = {
  timeMs: 1000,
  gainShift: 0,
  delayShift: 0,
  feedbackShift: 0,
  gainOffset: 0,
  delayOffset: 0,
  feedbackOffset: 0,
  scatter: 0,
  spread: 0,
  modA: 0.5,
  modB: 0.5,
  modC: 0.5,
  lfoHz: 0.25,
  gainSelect: 0,
  delaySelect: 0,
  feedbackSelect: 0,
  lfoDepth1: 0,
  lfoDepth2: 0,
  lfoDepth3: 0,
  mix: 0.5,
  outputDb: 0,
};

/** A new Spectre's choices: middling resolution, frames half overlapped, a 1/16 grid under two beats. */
export const SPECTRE_CHOICES = {
  bands: '512' as SpectreBands,
  overlap: '2x' as SpectreOverlap,
  window: 'smooth' as SpectreWindow,
  sync: true,
  division: '1/2' as SpectreDivision,
  grid: '1/16' as SpectreGrid,
  mod: 'off' as SpectreMod,
  lfoShape: 'sine' as SpectreLfoShape,
  lfoSync: false,
  lfoDivision: '1/1' as SpectreDivision,
  lfoDest1: 'delayOffset' as SpectreLfoDest,
  lfoDest2: 'gainShift' as SpectreLfoDest,
  lfoDest3: 'modA' as SpectreLfoDest,
  freeze: false,
  freezeMode: 'hold' as SpectreFreezeMode,
  follow: 'off' as SpectreFollow,
};

/** The preset a new Spectre starts as (`spectrePresetBank.ts`): Bleep Test. */
export const SPECTRE_PRESET_DEFAULT = 1;

/**
 * The signal path's fixed tuning (`worklet/spectre/`). The axis spans the
 * audible decades; a band below or above it reads the curve's end.
 */
export const SPECTRE_DSP = {
  /** A switch param's value at and above which it reads as on. */
  switchOn: 0.5,
  /** The tempo a stage assumes before the registry hands it the song's. */
  defaultBpm: 120,
  axisLowHz: 20,
  axisHighHz: 20000,
  /** The gain curve's floor: its value 0 is silence, and just above it this many dB. */
  gainRangeDb: 60,
  /** The longest delay the memory holds, in seconds: a synced time past it clamps. */
  maxSeconds: 8,
  /** The rate a frame size is stated at; a rate this many times it or more doubles the frame. */
  referenceRate: 48000,
  rateDoubling: 1.75,
  /** The processor's `timeMs`, `gridMs` and `lfoHz` param ranges, tempo folded in. */
  timeParamMs: [1, 8000],
  gridParamMs: [0, 8000],
  lfoParamHz: [0.001, 40],
  /** Continuous controls glide over this long, a frame at a time. */
  smoothSeconds: 0.03,
  /** A discrete change (resolution, overlap, window) silences the output this long, then rebuilds. */
  transitionSeconds: 0.008,
  /** The gain curve's shift at LFO depth 1 and the LFO's peak, in octaves. */
  lfoShiftOctaves: 2,
  /** A cell follows a note when its centre is within this many semitones of it. */
  toneSemitones: 0.4,
  /** The most scope reports a second the processor posts while the workbench is open. */
  scopeHz: 30,
  /** Freeze's glide into and out of the held loop. */
  freezeSeconds: 0.05,
  /** Frames the scatter modulation can push a band ahead (a power of two), and the smudge's memory. */
  scatterFrames: 32,
  smudgeFrames: 64,
  /** Points in the sine table that turns phases and shapes the modulations (a power of two). */
  turnPoints: 1024,
  /** The seed of the per-band scatter and every algorithm's draws: a render is reproducible. */
  seed: 0x5eed5bec,
} as const;

/**
 * The input modulations' ranges (`worklet/spectre/spectreMods*.ts`): what an
 * amount of 1 reaches. An amount of 0 is each range's other end.
 */
export const SPECTRE_MOD_TUNING = {
  /** blur: the bands each side its average spans. */
  blurWidthBands: 16,
  /** blur's jitter and phase's turn: the largest turn, as a share of a cycle each way. */
  maxTurn: 0.5,
  /** holes: the share of bands holed at Density 1, and the frames a draw lasts at Length 1. */
  holeShare: 0.5,
  holeFrames: 64,
  /** shift: the amount that moves nothing, and the bands moved at either end, as a share of the bands. */
  centre: 0.5,
  shiftShare: 0.25,
  /** comb: the widest spacing between kept bands. */
  combSpacing: 32,
  /** gate: the threshold's range below the frame's loudest band, in dB. */
  gateRangeDb: 60,
  /** pulse: the longest period in frames, and the feedback at Feedback 1. */
  pulseFrames: 64,
  pulseFeedback: 0.95,
  /** swell: the slowest rate in Hz, the octaves above it at Speed 1, and the cycles across the axis at Spread 1. */
  swellLowHz: 0.05,
  swellOctaves: 9,
  swellCycles: 4,
} as const;

/**
 * Sleep (windsor#793), the delay's pattern: an input sample within
 * `inputFloor` is silence, and a frame whose every band writes within
 * `outputFloor` into the memory is an inaudible repeat. Once no write has
 * crossed it for the memory's whole length, nothing it holds can be heard,
 * and a silent block puts it to sleep, unless feedback or Freeze could hold
 * up what it carries.
 */
export const SPECTRE_SLEEP = {
  inputFloor: 1e-9,
  outputFloor: 1e-7,
} as const;
