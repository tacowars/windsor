/**
 * Tape's controls and tables. The controls, EQ rows and motion are adapted from ELPHNT's CC0 REELS
 * Lite (`docs/log/2026-09-30-reels-inspired-tape-insert.md`); the saturation stage is Windsor's
 * magnetic core (`docs/log/2026-09-30-tape-magnetic-integration.md`), whose tunables are in
 * `tapeMagneticConstants.ts`.
 */
export const TAPE_NAME = 'tape';
export const TAPE_TYPES = [
  'studio',
  'ferric',
  'vintage',
  'studio15',
  'chrome',
  'metal',
  'vhs',
] as const;
export const TAPE_LABELS = [
  '30ips Studio',
  'Ferric',
  'Vintage',
  '15ips Studio',
  'Chrome',
  'Metal',
  'VHS',
] as const;
export const TAPE_BOUNDS = {
  drive: [-32, 32],
  bias: [-100, 100],
  wear: [0, 100],
  wow: [0, 100],
  flutter: [0, 100],
  dropouts: [0, 100],
  wowRate: [0.05, 3],
  flutterRate: [1, 20],
  hiss: [-70, -16],
  trim: [-24, 24],
  mix: [0, 1],
  seed: [0, 16777215],
} as const;
/**
 * The magnetic core's three controls as a song may set them (windsor#291, the Tape card's Advanced
 * section): the box qualified at 2× and 4× and 44.1, 48 and 96 kHz, every trial without a reset
 * (`docs/research/2026-10-01-tape-control-domain/` and `…-control-domain-2x/`, windsor#290 and
 * #295). A song's `core` is clamped into it on load, and it is each core parameter's range. The
 * model rows lie inside it but for two widths, Vintage's 0.83 and VHS's 0.77, which are sampled
 * points of the dynamic-survival record (design decision 6) above the box's width maximum.
 */
export const TAPE_CORE_BOUNDS = {
  drive: [0, 1],
  width: [0.05, 0.62],
  saturation: [0, 1],
} as const;
/** The core's controls in `TAPE_CORE_BOUNDS`' order: drive, width, saturation, as a model row. */
export const TAPE_CORE_CONTROLS = ['drive', 'width', 'saturation'] as const;
/**
 * The processor's parameters for a song's `core`: `core` is 1 while one is set and 0 while the
 * insert follows its model's row, and each control has its own k-rate parameter.
 */
export const TAPE_CORE_PARAMS = {
  flag: 'core',
  drive: 'coreDrive',
  width: 'coreWidth',
  saturation: 'coreSaturation',
} as const;
/** The oversampling factors the magnetic core is built at, lowest first (design decision 1). */
export const TAPE_OVERSAMPLING = [2, 4] as const;
export type TapeOversampling = (typeof TAPE_OVERSAMPLING)[number];
export const TAPE_DEFAULTS = {
  drive: 0,
  bias: 0,
  wear: 0,
  wow: 0,
  flutter: 0,
  dropouts: 0,
  wowRate: 1,
  flutterRate: 7,
  split: false,
  hiss: -70,
  trim: 0,
  mix: 1,
  seed: 1,
  enabled: true,
  /** The magnetic core's oversampling factor, one of `TAPE_OVERSAMPLING`: a product setting (2026-10-01), not a knob. */
  oversampling: 2 as TapeOversampling,
};
export const TAPE_DSP = {
  weightFloor: 1e-12,
  smoothSeconds: 0.01,
  /**
   * The magnetic controls' glide (a model switch) ends this close to the row: about 16 time
   * constants, and a final step that moves the core's output gain by about a millionth or less.
   */
  magneticSnap: 1e-7,
  toneSeconds: 0.03,
  dcHz: 10,
  dbScale: 20,
  dbBase: 10,
  percent: 100,
  maxFrequencyRatio: 0.45,
  maxDelaySeconds: 0.025,
  wowHz: 1,
  flutterHz: 7,
  flutterMinHz: 2,
  flutterMaxHz: 10,
  wowSmoothSeconds: 0.226757,
  flutterSmoothSeconds: 0.113379,
  dropoutInterval: 0.1,
  dropoutChance: 0.2,
  dropoutSeconds: 0.4,
  dropoutSmoothSeconds: 3000 / 44100,
  hissHighpassHz: 300,
  hissLowpassHz: 9000,
  biasLowQ: 0.3,
  biasHighQ: 0.5,
  toneFilters: 5,
  biasLowHz: 300,
  biasHighHz: 600,
  biasDb: 10,
  millisecondsPerSecond: 1000,
};
/**
 * Filter rows are [kind, Hz, linear gain, Q]. First three come from CC0 coll tape_models.
 * `magnetic` is the core's fixed [drive, width, saturation], each in [0, 1] (design decision 6; a
 * song's `core` overrides it per insert, windsor#291):
 * each row is one of the dynamic-survival record's seeded interior points, written as the double
 * `mulberry32(204)` drew (`docs/log/2026-10-01-tape-per-model-magnetic-rows.md`, windsor#289), and
 * `worklet/tape/tapeMagneticRows.ts` refuses a row whose origin susceptibility is not above
 * `TAPE_MAGNETIC.susceptibilityFloor` when the DSP loads.
 */
export const TAPE_MODELS = [
  {
    magnetic: [0.15938492002896965, 0.2784419672098011, 0.32353375502862036],
    hissDb: -4,
    eq: [
      ['low', 60, 0.7079, 0.7],
      ['high', 15000, 1.5849, 0.2],
      ['peak', 300, 1.2, 0.7],
    ],
  },
  {
    magnetic: [0.7231755261309445, 0.5094192686956376, 0.5937485755421221],
    hissDb: 2,
    eq: [
      ['low', 120, 1.5849, 0.7],
      ['high', 10000, 0.3981, 0.7],
      ['peak', 500, 1.4125, 0.7],
    ],
  },
  {
    magnetic: [0.74230687180534, 0.8311155559495091, 0.5280546580906957],
    hissDb: 3,
    eq: [
      ['high', 12000, 0.3162, 0.2],
      ['low', 100, 0.5623, 0.7],
      ['peak', 500, 1.7783, 0.7],
    ],
  },
  // Original Windsor profiles: broad tape-family colors, not measured hardware emulations.
  {
    magnetic: [0.5451831214595586, 0.5887099420651793, 0.5555956494063139],
    hissDb: -2,
    eq: [
      ['low', 85, 1.2589, 0.7],
      ['high', 12000, 0.7079, 0.5],
      ['peak', 70, 1.4125, 0.8],
    ],
  },
  {
    magnetic: [0.3361578288022429, 0.1319972772616893, 0.5640697486232966],
    hissDb: 0,
    eq: [
      ['low', 100, 1.122, 0.7],
      ['high', 12500, 0.8913, 0.7],
      ['peak', 500, 0.9441, 0.7],
    ],
  },
  {
    magnetic: [0.33866089140065014, 0.48996011330746114, 0.13382563437335193],
    hissDb: -1,
    eq: [
      ['low', 80, 1.2589, 0.7],
      ['high', 15000, 1.122, 0.7],
      ['peak', 800, 0.7943, 0.8],
    ],
  },
  {
    magnetic: [0.8362328263465315, 0.7688039047643542, 0.9715575405862182],
    hissDb: 5,
    eq: [
      ['low', 130, 1.4125, 0.7],
      ['high', 6500, 0.2512, 0.5],
      ['peak', 1100, 1.1885, 0.7],
    ],
  },
] as const;
export const TAPE_RANDOM = {
  driveMax: 32,
  drivePower: 1.8,
  wearMax: 50,
  wearPower: 2.5,
  wowRateMin: 0.2,
  wowRateMax: 1.2,
  flutterRateMin: 4,
  flutterRateMax: 12,
  hissMin: -70,
  hissMax: -30,
  hissPower: 1.5,
};
