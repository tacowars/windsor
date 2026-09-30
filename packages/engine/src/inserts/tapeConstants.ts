/** REELS Lite controls, adapted from ELPHNT's CC0 device; see the tape insert decision record. */
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
};
export const TAPE_DSP = {
  weightFloor: 1e-12,
  smoothSeconds: 0.01,
  toneSeconds: 0.03,
  dcHz: 10,
  warmth: 0.1,
  punch: 0.8,
  makeup: 0.7,
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
/** Filter rows are [kind, Hz, linear gain, Q]. First three come from CC0 coll tape_models. */
export const TAPE_MODELS = [
  {
    hissDb: -4,
    eq: [
      ['low', 60, 0.7079, 0.7],
      ['high', 15000, 1.5849, 0.2],
      ['peak', 300, 1.2, 0.7],
    ],
  },
  {
    hissDb: 2,
    eq: [
      ['low', 120, 1.5849, 0.7],
      ['high', 10000, 0.3981, 0.7],
      ['peak', 500, 1.4125, 0.7],
    ],
  },
  {
    hissDb: 3,
    eq: [
      ['high', 12000, 0.3162, 0.2],
      ['low', 100, 0.5623, 0.7],
      ['peak', 500, 1.7783, 0.7],
    ],
  },
  // Original Windsor profiles: broad tape-family colors, not measured hardware emulations.
  {
    hissDb: -2,
    eq: [
      ['low', 85, 1.2589, 0.7],
      ['high', 12000, 0.7079, 0.5],
      ['peak', 70, 1.4125, 0.8],
    ],
  },
  {
    hissDb: 0,
    eq: [
      ['low', 100, 1.122, 0.7],
      ['high', 12500, 0.8913, 0.7],
      ['peak', 500, 0.9441, 0.7],
    ],
  },
  {
    hissDb: -1,
    eq: [
      ['low', 80, 1.2589, 0.7],
      ['high', 15000, 1.122, 0.7],
      ['peak', 800, 0.7943, 0.8],
    ],
  },
  {
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
