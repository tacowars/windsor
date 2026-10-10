/** Original vintage-reverb tunables (#682); no factory microcode or delay tables. */
export const RETRO_REVERB_NAME = 'retro-reverb';
export const RETRO_REVERB_MODES = ['reverb', 'gated', 'reverse'] as const;
/** The converter's model: today's fixed quantiser, or a gain-ranging one (RV-6). */
export const RETRO_REVERB_CONVERTERS = ['linear', 'ranging'] as const;
export const RETRO_REVERB_BOUNDS = {
  decay: [0.2, 20],
  size: [0.25, 3],
  tone: [800, 9000],
  diffusion: [0, 1],
  preDelay: [0, 0.25],
  character: [0, 1],
  mix: [0, 1],
  duration: [0.1, 0.6],
  // RV-0 adds these at neutral defaults (below); each is read by the item that ships it.
  early: [0, 1],
  driftRate: [0.05, 5],
  driftDepth: [0, 1],
  density: [0, 1],
  lowDecay: [0.25, 4],
  lowCross: [80, 2000],
} as const;
export const RETRO_REVERB_DEFAULTS = {
  decay: 1.4,
  size: 1,
  tone: 4200,
  diffusion: 0.7,
  preDelay: 0,
  character: 0.65,
  mix: 0.3,
  enabled: true,
  duration: 0.3,
  // Neutral: at these values the reverb sounds as it did before the fields existed.
  early: 0,
  driftRate: 0.5,
  driftDepth: 0,
  density: 0,
  lowDecay: 1,
  lowCross: 300,
};
export const RETRO_REVERB_DSP = {
  rate: 23437.5,
  bandwidth: 9000,
  smoothSeconds: 0.05,
  // Independently chosen, unequal lengths; seconds, never ROM offsets.
  tankSeconds: [0.0311, 0.0377, 0.0433, 0.0539],
  diffuserSeconds: [0.0031, 0.0053, 0.0097],
  maxDiffusion: 0.65,
  inputTrim: 0.25,
  outputTrim: 0.6,
  stateLimit: 4,
  silenceFloor: 1e-12,
  converterSteps: 2048,
  reflectionCount: 192,
  reflectionSeed: 682,
  reflectionTrim: 0.55,
  reflectionJitterStart: 0.2,
  reflectionJitterSpan: 0.6,
  reflectionSparseStride: 4,
  reflectionEdgeFraction: 0.02,
  // Early reflections (RV-1), Windsor's own: per channel, seconds at Size 1 after the pre-delay
  // point. The first tap sits within 5 ms of it (the slap); the last lands before the shortest
  // tank line's first return (tankSeconds[0] × Size), so the reflections fill the gap ahead of
  // the bloom. Each gain falls as the cube root of its time (gentler than spherical spreading, so
  // the later taps still read); L and R differ in time and in the signs of the later taps.
  earlySecondsLeft: [0.0029, 0.0097, 0.0173, 0.0269],
  earlySecondsRight: [0.0043, 0.0121, 0.0211, 0.0293],
  earlyGainsLeft: [1, -0.67, 0.55, -0.48],
  earlyGainsRight: [0.88, 0.62, -0.52, -0.46],
  // The times follow Size within these bounds: the first tap never closer than about 1.5 ms (a
  // comb colour, not a reflection), the last never past about 120 ms (a separate echo pattern).
  earlyScaleMin: 0.5,
  earlyScaleMax: 4,
  // Measured, not estimated: an impulse at Size 1, Decay 1.4 and Character 0 gives the taps at
  // Early 0.5 the same energy as the whole tank response, so Early 1 sits 6 dB above it.
  earlyTrim: 0.58,
  filterSections: 2,
  filterPoleDivisor: 8,
  hostBandwidthRatio: 0.4,
  decayTarget: 0.001,
  // Drift (RV-2), Windsor's own values. A line's read moves up to `driftExcursion` seconds either
  // way at depth 1, times its signed share in `driftLineDepths`. A mode at f Hz moves
  // f × excursion of its line's mode spacing, whatever the line's length, so 0.5 ms moves the
  // modes at 1 kHz half a spacing each way at any Size. The shares sum to zero, so the network's
  // mean delay holds still while the lines move against one another, and no two are in a simple
  // ratio, so no two move in step.
  driftExcursion: 0.0005,
  driftLineDepths: [1, -0.77, 0.61, -0.84],
  // Each wet output reads a short line swept 0..2 × this (seconds) at depth 1, L and R in
  // opposite directions: a triangle at r Hz detunes each side by ±4 r × this, about ±3.5 cents
  // at 0.5 Hz and ±14 cents at 2 Hz.
  detuneExcursion: 0.001,
  millisecondsPerSecond: 1000,
} as const;
