/**
 * The FM worklet's tunables (#644): table size, mip count, the control-rate
 * interval, the dormancy floors, the modulation and feedback depths, the
 * shortest envelope segment and the width ramp's snap. Data, not logic: every
 * other module under `fm/` imports what it needs from here, and none of these
 * is read by the main thread. A change here changes every render; `fmProcessorGolden.test.ts`
 * says so, and `fmProcessorKernel.test.ts` pins `MOD_INDEX_SCALE` against the
 * bank it was authored at (#543).
 */

/* ------------------------------------------------------------------ *
 * Tunables
 * ------------------------------------------------------------------ */

const TABLE_BITS = 11;
const TABLE_SIZE = 1 << TABLE_BITS; // 2048
const TABLE_MASK = TABLE_SIZE - 1;

const MIP_COUNT = 12; // one per octave from MIP_BASE_HZ
const MIP_BASE_HZ = 16.352; // C0

const CTRL_INTERVAL = 32; // samples between control-rate updates
/*
 * Dormancy (#547). A held note whose carriers have all decayed to a sustain of
 * 0 renders nothing but still costs four operators, a filter and a voice slot
 * until its note-off. Below these it is treated as silent: its carrier
 * amplitudes are within DORMANT_AMP of 0 and, when a filter is on, the SVF
 * integrator states are within DORMANT_FILTER_STATE (about -180 dB), so a
 * resonant ring still sounding after the carriers stop is never cut.
 */
const DORMANT_AMP = 1e-9;
const DORMANT_FILTER_STATE = 1e-9;
/*
 * Modulation depth at operator amplitude 1.0, in cycles of phase -- the unit
 * `phase` is kept in, so the radian index is 2*pi times this: 4 cycles is
 * ~25.1 rad (#543). The old 8 meant ~50 rad, past Nyquist for the sidebands of
 * anything but a low note on an engine that does not oversample, so the top
 * third of the Level knob was aliasing rather than timbre. 4 keeps the DX-era
 * ~4*pi useful maximum inside the knob and still reaches noise at the top.
 * Amplitude is level^2 x envelope x velocity x key scale x LFO, so a modulator
 * at Level 1 with its envelope open is the full 4 cycles.
 */
const MOD_INDEX_SCALE = 4.0;
/*
 * Self-feedback depth at |feedback| = 1, in cycles of phase (#529). Positive
 * feedback runs sin(phase + beta*y): sine towards a sawtooth, clean to ~1.25
 * rad and noise past ~2.5. Negative runs sin(phase + beta*y^2), whose half-wave
 * symmetry keeps only odd harmonics: sine towards a square, clean to ~2.0 rad.
 * Measured on A2 and A5 in #529; beyond these the one-sample loop turns chaotic.
 */
const FEEDBACK_SAW_CYCLES = 1.25 / (2 * Math.PI);
const FEEDBACK_SQUARE_CYCLES = 2.0 / (2 * Math.PI);
const MIN_SEG_TIME = 0.0005; // shortest envelope segment, seconds
/*
 * A segment's curve control of ±1 maps to a shaping constant of exp(±steepness)
 * (`envelope.ts`'s `segmentLevel`, which the console's display draws with): 0
 * is linear, positive bows the segment down, negative bows it up.
 */
const ENVELOPE_CURVE_STEEPNESS = 3;
/*
 * Operator width's ramp (#55) lands exactly on its target once the two are
 * this close, so a width that returns to 1 takes the plain wave's path again
 * rather than creeping at a float32 ulp for the rest of the note. The value
 * the loops ramp is at most 1 / WIDTH_RANGE.min = 20, where a float32 ulp is
 * about 2e-6; a step of 1e-5 in it moves the read phase by 1e-5 of a cycle.
 */
const WIDTH_SNAP = 1e-5;
/*
 * The part's event queue is sized for this many events from its constructor
 * (windsor#270), its queued and its posted slots alike, so neither grows on
 * the audio thread in ordinary use, a fresh part's first notes included. The
 * figure: the scheduler keeps 0.12 s posted ahead
 * (`SCHEDULER_LOOK_AHEAD_SECONDS`), and at 180 BPM a 32nd-note step lasts
 * about 42 ms, so a window holds three steps; a chord on every step over all
 * 16 voices (`PART_MAX_VOICES_DEFAULT`) is 16 note-ons and 16 note-offs a
 * step, 96 events, which is also what one wake of the scheduler can post
 * between two quanta. 128 leaves room above that for about 3 KB a part.
 * Past it the queue still grows, by doubling, as the rare fallback: an
 * allocation on the audio thread, only at a new most events at once.
 */
const EVENT_QUEUE_CAPACITY = 128;

export {
  TABLE_SIZE,
  TABLE_MASK,
  MIP_COUNT,
  MIP_BASE_HZ,
  CTRL_INTERVAL,
  DORMANT_AMP,
  DORMANT_FILTER_STATE,
  MOD_INDEX_SCALE,
  FEEDBACK_SAW_CYCLES,
  FEEDBACK_SQUARE_CYCLES,
  MIN_SEG_TIME,
  ENVELOPE_CURVE_STEEPNESS,
  WIDTH_SNAP,
  EVENT_QUEUE_CAPACITY,
};
