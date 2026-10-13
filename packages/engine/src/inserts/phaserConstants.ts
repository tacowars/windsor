/** Original four-stage phaser controls; frequencies in Hz, sweep amounts in octaves. */
export const PHASER_NAME = 'phaser';
export const PHASER_BOUNDS = {
  rate: [0.01, 8],
  center: [80, 4000],
  depth: [0, 4],
  feedback: [-0.9, 0.9],
  feedbackCut: [20, 2000],
  stereo: [0, 180],
  envelope: [-4, 4],
  bassKeep: [0, 1],
  mix: [0, 1],
} as const;
export const PHASER_DEFAULTS = {
  rate: 0.2,
  center: 900,
  depth: 2,
  feedback: 0.25,
  feedbackCut: 350,
  stereo: 0,
  envelope: 0,
  bassKeep: 0,
  mix: 0.5,
  enabled: true,
};
export const PHASER_DSP = {
  stages: 4,
  smoothSeconds: 0.03,
  attackSeconds: 0.008,
  releaseSeconds: 0.18,
  envelopeGain: 4,
  bassHz: 150,
  minHz: 20,
  maxRateRatio: 0.2,
  feedbackLimit: 2,
  degreesPerTurn: 360,
  millisecondsPerSecond: 1000,
} as const;
/**
 * Sleep (windsor#793), the plate's pattern (record
 * `2026-09-15-silent-voices-and-plate-sleep-floors`). The phaser holds no
 * delay line: everything that carries audio is the all-pass, bass and
 * feedback state, read whole at each block's end, so its tail is the
 * lattice's settle itself. Once a block's input is within `inputFloor` (the
 * plate's) and every state within `stateFloor` (the plate's output floor),
 * it sleeps. `tailSeconds` bounds that settle from the last loud sample,
 * measured on the shipped bundle at 48 kHz after full-scale noise: 0.03 s at
 * the defaults, 1.26 s at the slowest corner (Center 80 Hz, Depth 4 and
 * Envelope −4 holding the all-passes at the 20 Hz floor, Feedback ±0.9 cut at
 * 20 Hz). `phaserSleep.test.ts` holds the phaser to it.
 */
export const PHASER_SLEEP = {
  inputFloor: 1e-9,
  stateFloor: 1e-7,
  tailSeconds: 2,
} as const;
