/**
 * The FM worklet's tunables (#644): table size, mip count, the control-rate
 * intervals and when a voice takes the long one (windsor#326), the dormancy floors, the modulation and feedback depths, the
 * shortest envelope segment, the amplitude envelope's breaks per block
 * (windsor#301), the width ramp's snap, the feedback ramp's step
 * (windsor#346), the drive stage's
 * shape constants and tone curve (windsor#300), a Noise operator's
 * colour filters' ceiling and damping (windsor#362), and the Formant
 * filter's Q scale, cap and makeup (windsor#331), the Acid Ladder's
 * circuit, feedback, level and solver (windsor#573) and its output mix
 * (windsor#577), and the steal fade and
 * reserve (windsor#410). Data, not logic: every
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

const CTRL_INTERVAL = 32; // samples between control-rate updates: the fine interval
/*
 * Each voice chooses its control interval at each control boundary
 * (windsor#326, `voiceControlInterval.ts`): CTRL_INTERVAL while anything
 * fast is happening, CTRL_INTERVAL_LONG while nothing is. Fast is a running
 * envelope segment shorter than CTRL_LONG_MIN_SEGMENT_SECONDS (after key
 * scaling), a looping amplitude envelope, a glide under that time, an
 * LFO that reaches anything at CTRL_LONG_MAX_LFO_HZ or faster (or at any
 * rate in a shape that jumps), or a song
 * lane ramping an operator's feedback, which the render loops time in fine
 * blocks (FEEDBACK_RAMP_STEP). 128 is one
 * render quantum: the control update and the kernel's prologue run once
 * where they ran four times. The record is
 * `docs/log/2026-10-03-adaptive-control-interval.md`.
 */
const CTRL_INTERVAL_LONG = 128;
const CTRL_LONG_MIN_SEGMENT_SECONDS = 0.1;
const CTRL_LONG_MAX_LFO_HZ = 8;
/*
 * A song lane's feedback is ramped across each control block (windsor#346,
 * `voiceOffsets.ts`): sample `s` of the block reads `from + (to − from) · t`
 * with `t = s × FEEDBACK_RAMP_STEP`, exact for a power-of-two block. The
 * loops count `s` from CTRL_INTERVAL, so a voice whose feedback ramps keeps
 * the fine interval (windsor#326).
 */
const FEEDBACK_RAMP_STEP = 1 / CTRL_INTERVAL;
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
const MIN_SEG_TIME = 0.0005; // shortest filter or pitch envelope segment, seconds
/*
 * An operator's amplitude envelope keeps its segment ends at their own
 * samples (windsor#301, `envelope.ts`'s `advanceExact`): a segment may end
 * inside a control block, and the amplitude ramp turns there. A block records
 * at most ENVELOPE_BREAKS_MAX of those ends, each a knot the ramp passes
 * through; an end past that count is still timed, and the block's last ramp
 * runs straight to the block-end level across it. Four holds an attack, a
 * decay and a release in one block with one to spare. A block walks at most
 * ENVELOPE_PASSES_MAX segments, so a looping envelope whose attack and decay
 * are both 0 cannot spin: it stops where the count runs out.
 */
const ENVELOPE_BREAKS_MAX = 4;
const ENVELOPE_PASSES_MAX = 64;
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
/*
 * The voice drive's shapes (windsor#300, `voiceDrive.ts`). `tube` and `diode`
 * are Advanced Drive's curves (`inserts/advancedDriveConstants.ts`'s
 * `tubeEven` and `diodeKnee`, which `voiceDrive.test.ts` pins these to), in
 * arithmetic that gives the same bits on every platform. The diode is
 * x / (1 + |x|^order)^(1/order) with order = 2 / knee: below 2^-20 its
 * denominator rounds to 1 in a double, and from 2^20 the quotient rounds to
 * ±1, so the stage takes the shortcut either side and the portable powers
 * only ever see exponents inside their table.
 */
const DRIVE_TUBE_EVEN = 0.18;
const DRIVE_DIODE_KNEE = 0.65;
const DRIVE_DIODE_ORDER = 2 / DRIVE_DIODE_KNEE;
const DRIVE_DIODE_ROOT = DRIVE_DIODE_KNEE / 2;
const DRIVE_DIODE_LINEAR_BELOW = 1 / 1048576; // 2^-20
const DRIVE_DIODE_UNITY_FROM = 1048576; // 2^20
/*
 * The drive's tone: a one-pole lowpass after the shaper, its cutoff
 * DRIVE_TONE_MIN_HZ * 2^(tone * DRIVE_TONE_OCTAVES), so about 1 kHz at 0 and
 * about 19 kHz just below 1; at 1 exactly the pole is bypassed. The pole is
 * the TPT (trapezoidal) form with g = pi * fc / sampleRate, not prewarped:
 * within 0.2 % of the analog cutoff at 1 kHz, and the top of the knob is an
 * air trim rather than a tuned corner. One coefficient per control block.
 */
const DRIVE_TONE_MIN_HZ = 1000;
const DRIVE_TONE_OCTAVES = 4.25;
/*
 * A Noise operator's colour (windsor#362): its two filters are two-pole TPT
 * state-variable sections, Butterworth (damping k = sqrt 2, Q 0.707), tuned by
 * g = tan(pi * fc / sampleRate) in portable arithmetic. A cutoff that is on is
 * held between the patch's floor (`NOISE_COLOUR_FLOOR_HZ`) and this fraction of
 * the sample rate, where tan stays finite and the prewarp well inside Nyquist
 * (the windsor#361 prototype's ceiling).
 */
const NOISE_COLOUR_CEILING = 0.45;
const NOISE_COLOUR_DAMPING = Math.SQRT2;
/*
 * The Formant filter mode (windsor#331, `voiceFormant.ts`): three bandpass
 * peaks share one Q, FORMANT_Q_PER_RESONANCE per unit of the patch's
 * `resonance` (the default 0.707 is Q 5.66), capped at FORMANT_Q_MAX (reached
 * at resonance 5). Each peak's gain is its vowel level x FORMANT_MAKEUP / Q,
 * so it peaks at its level whatever the Q (an SVF bandpass peaks at Q).
 * FORMANT_MAKEUP is measured, not chosen: white noise through the vowel "a"
 * at the default resonance sits at the RMS of white noise through the
 * Bandpass mode at the same resonance and a 1 kHz cutoff
 * (`docs/research/2026-10-02-formant-filter/`, `makeup.mjs`).
 */
const FORMANT_Q_PER_RESONANCE = 8;
const FORMANT_Q_MAX = 40;
const FORMANT_MAKEUP = 1.787;
/*
 * The Acid Ladder filter mode (windsor#573, `ladder.ts`, record
 * `2026-10-04-acid-ladder-filter-mode`): the TB-303's four-stage diode
 * ladder, its bottom capacitor LADDER_BOTTOM_CAP of the others (the
 * schematic's 18 nF under 33 nF, Stinchcombe's half). Resonance is the
 * output fed back into the input pair through a one-pole high-pass at
 * LADDER_FEEDBACK_HP_HZ (a one-pole image of the hardware's return, a
 * tunable and not a component value: Open303's calibration is 150 Hz, the
 * ACB comparison of windsor#574 set 100 and windsor#577's fit with the
 * output mix 150), times a gain k =
 * LADDER_FEEDBACK_MAX x p, p the Reso knob's place on its log scale,
 * log2(reso / LADDER_RESONANCE_FLOOR) / log2(LADDER_RESONANCE_SPAN), 0 at
 * 0.5 and 1 at 12. The linear self-oscillation threshold is k = 17, so
 * 16.5 stays short of it, as the stock unit does. The carrier sum enters
 * times LADDER_INPUT_SCALE (the model's 2 V_T unit) and leaves divided by
 * it (0.25 since windsor#577: the voice's full level, the drive's ceiling,
 * is a quarter of a 2 V_T unit, so the input pair compresses the resonance
 * less; windsor#574 had set 1 before the output mix). The cutoff is held
 * between LADDER_CUTOFF_MIN_HZ and LADDER_CUTOFF_MAX_HZ, and below LADDER_CUTOFF_CEILING of the sample rate
 * at a low rate. The solver (decision 6): LADDER_NEWTON_STEPS Newton steps
 * a sample on the trapezoidal step, at LADDER_OVERSAMPLE times the sample
 * rate. The shipped candidate is 1x with four steps and the cutoff capped
 * at 10 kHz; the other, 2x with three steps and no cap, stays selectable
 * here for the research bench (`docs/research/2026-10-04-acid-ladder-filter/`).
 * The output is the ladder's plus the TB-303's second resonance path
 * (windsor#577): the Reso pot's wiper into the VCA beside the ladder's own
 * output, LADDER_MIX_GAIN x p times the output through a one-pole
 * high-pass at LADDER_MIX_HP_HZ, so the level with resonance is the
 * circuit's two paths. The schematic gives 2.2 (220 kOhm / 100 kOhm) and
 * 159 Hz (10 nF into 100 kOhm); the ACB comparison's fit ships 2.6 and
 * 400 Hz, where its lift and bass loss both meet the references.
 * Last, a makeup gain (windsor#587), a product choice and not the
 * circuit's: the output times (1 + k)^LADDER_MAKEUP_POWER, 1 at the Reso
 * knob's bottom and sqrt(17.5), +12.4 dB, at its top. The loop takes about
 * 1 / (1 + k) of the passband, so the power is the fraction of that loss,
 * in dB, given back at every place of the knob: 0 is the circuit's level,
 * 1 full compensation (25 dB more peak and self-oscillation at the top),
 * 0.5 half of it, so a performed Reso sweep holds its loudness while low
 * resonance stays where it was.
 * Each value is tacowars's to set by ear.
 */
const LADDER_BOTTOM_CAP = 0.5;
const LADDER_FEEDBACK_HP_HZ = 150;
const LADDER_FEEDBACK_MAX = 16.5;
const LADDER_RESONANCE_FLOOR = 0.5;
const LADDER_RESONANCE_SPAN = 24;
const LADDER_INPUT_SCALE = 0.25;
const LADDER_MIX_GAIN = 2.6;
const LADDER_MIX_HP_HZ = 400;
const LADDER_MAKEUP_POWER = 0.5;
const LADDER_CUTOFF_MIN_HZ = 20;
const LADDER_CUTOFF_MAX_HZ = 10000;
const LADDER_CUTOFF_CEILING = 0.45;
const LADDER_NEWTON_STEPS = 4;
const LADDER_OVERSAMPLE = 1;

/*
 * Voice stealing (windsor#410, `voiceSteal.ts`). A voice a full part steals
 * fades out over STEAL_FADE_SECONDS from the level it plays at: 4 ms popped
 * on a loud pad tail, and 30 ms sits inside the 10 to 50 ms other synths use
 * (`docs/research/2026-10-02-voice-stealing/`). The pool holds the sounding
 * limit plus a reserve of at least the limit and at least STEAL_RESERVE_MIN,
 * an eight-note chord with `spread`'s two voices a note, so a chord that
 * steals every voice it plays still finds a free slot for each. The first
 * STEAL_STREAMED_RESERVE reserve slots are the four the pool had before:
 * they seed from the part's random stream, and the slots past them from a
 * stream of their own, so every seeded render that never steals is unchanged.
 */
const STEAL_FADE_SECONDS = 0.03;
const STEAL_RESERVE_MIN = 16;
const STEAL_STREAMED_RESERVE = 4;

export {
  TABLE_SIZE,
  TABLE_MASK,
  MIP_COUNT,
  MIP_BASE_HZ,
  CTRL_INTERVAL,
  CTRL_INTERVAL_LONG,
  CTRL_LONG_MIN_SEGMENT_SECONDS,
  CTRL_LONG_MAX_LFO_HZ,
  FEEDBACK_RAMP_STEP,
  DORMANT_AMP,
  DORMANT_FILTER_STATE,
  MOD_INDEX_SCALE,
  FEEDBACK_SAW_CYCLES,
  FEEDBACK_SQUARE_CYCLES,
  MIN_SEG_TIME,
  ENVELOPE_BREAKS_MAX,
  ENVELOPE_PASSES_MAX,
  ENVELOPE_CURVE_STEEPNESS,
  WIDTH_SNAP,
  EVENT_QUEUE_CAPACITY,
  DRIVE_TUBE_EVEN,
  DRIVE_DIODE_KNEE,
  DRIVE_DIODE_ORDER,
  DRIVE_DIODE_ROOT,
  DRIVE_DIODE_LINEAR_BELOW,
  DRIVE_DIODE_UNITY_FROM,
  DRIVE_TONE_MIN_HZ,
  DRIVE_TONE_OCTAVES,
  NOISE_COLOUR_CEILING,
  NOISE_COLOUR_DAMPING,
  FORMANT_Q_PER_RESONANCE,
  FORMANT_Q_MAX,
  FORMANT_MAKEUP,
  LADDER_BOTTOM_CAP,
  LADDER_FEEDBACK_HP_HZ,
  LADDER_FEEDBACK_MAX,
  LADDER_RESONANCE_FLOOR,
  LADDER_RESONANCE_SPAN,
  LADDER_INPUT_SCALE,
  LADDER_MIX_GAIN,
  LADDER_MIX_HP_HZ,
  LADDER_MAKEUP_POWER,
  LADDER_CUTOFF_MIN_HZ,
  LADDER_CUTOFF_MAX_HZ,
  LADDER_CUTOFF_CEILING,
  LADDER_NEWTON_STEPS,
  LADDER_OVERSAMPLE,
  STEAL_FADE_SECONDS,
  STEAL_RESERVE_MIN,
  STEAL_STREAMED_RESERVE,
};
