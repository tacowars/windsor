/** Original vintage-reverb tunables (#682); no factory microcode or delay tables. */
export const RETRO_REVERB_NAME = 'retro-reverb';
export const RETRO_REVERB_MODES = ['reverb', 'gated', 'reverse'] as const;
/** The converter's model: today's fixed quantiser, or a gain-ranging one (RV-6). */
export const RETRO_REVERB_CONVERTERS = ['linear', 'ranging'] as const;
export const RETRO_REVERB_BOUNDS = {
  decay: [0.2, 20],
  // RV-4 raised the top from 3 to 10: the tank lines reach about 540 ms. A Size keeps its meaning.
  size: [0.25, 10],
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
  // The fastest Size moves, in Size a second (RV-4). Today's widest move, 0.25 to 3, starts at
  // 2.75 / smoothSeconds = 55 a second, so no move within 0.25-3 reaches the limit and the
  // longest line's read never moves faster than it did before the range grew.
  sizeSlew: 55,
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
  // comb colour, not a reflection). Above, they follow Size to its top (RV-4), so the last still
  // lands before the shortest line's first return; held at 4, Size 10 left about 190 ms of silence
  // between the last tap (117 ms) and the bloom (311 ms). The finite field's history (0.6 s)
  // holds the last tap at Size 10, 293 ms.
  earlyScaleMin: 0.5,
  earlyScaleMax: 10,
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
  // Density (RV-3), Windsor's own values: four taps inside each tank line, as fractions of its
  // current length (so they follow Size), read beside the line ends (the output-tap idea of
  // Dattorro 1997, Part 1, applied to the four lines). Chosen by a search for the widest smallest
  // gap between the arrival times of the taps, the line ends and their sums with one more line,
  // up to 110 ms (0.13 ms at Size 1); no fraction is within 0.012 of a ratio with a denominator
  // up to 8, so a tap's echoes never fall in step with its line's. All sit between 0.2 and 0.82,
  // clear of the read Drift moves (at most 0.07 of the shortest line at the smallest Size).
  densityFractions: [
    [0.229, 0.359, 0.551, 0.812],
    [0.235, 0.482, 0.638, 0.774],
    [0.219, 0.479, 0.612, 0.815],
    [0.223, 0.416, 0.585, 0.818],
  ],
  // Each tap's sign in the left and the right sum, 0 where it plays in the other: each channel
  // takes two taps of every line, one early and one late, so L and R share none.
  densityLeft: [
    [1, 0, 1, 0],
    [0, 1, 0, -1],
    [-1, 0, 1, 0],
    [0, -1, 0, 1],
  ],
  densityRight: [
    [0, 1, 0, -1],
    [-1, 0, -1, 0],
    [0, 1, 0, -1],
    [-1, 0, 1, 0],
  ],
  // Each output's line-end sum's energy, in lines, for the loudness match (left, right). Four
  // unrelated ends at ±1 would make 4; the feedback matrix makes the left signs add up and the
  // right ones partly cancel. Measured, not estimated: with these, an impulse at Size 0.25 to 3 and
  // Decay 0.3 to 8 s plays at Density 1 within 0.4 dB of Density 0, and within 1.3 dB (Size up to
  // 10, Decay down to 0.2 s) where a short decay at a large Size leaves the first pass most of the
  // energy.
  densityEndEnergy: [5.2, 3.3],
  // The most a tap's envelope weight raises it over its line end: 6 dB. The weight, gain^(f - 1),
  // grows without bound with a pass's loss (126 dB for line 3's first tap at Size 10, Decay 0.2),
  // and the loudness match then turns the ends down to nothing at any Density above 0, so the
  // knob played as off or full. The largest weight at the auditioned settings (Size 0.5 to 3,
  // Decay 1.4 and 2 s) is 5.4 dB (Size 3, Decay 1.4, line 3's first tap), so 6 dB leaves them
  // unchanged to the bit. Measured where every tap is held (Size 10, Decay 0.2): Density 0.25
  // moves the output 52 % as far as Density 1 does, against 62 % with a 9 dB cap, 71 % with
  // 12 dB, 100 % with none, and 38 to 45 % at settings where no tap is held.
  densityMaxBoost: 10 ** (6 / 20),
  millisecondsPerSecond: 1000,
} as const;
