/**
 * The audio area's numbers: tempo and MIDI ranges, the arrangement schema's
 * clamp bounds, the graph's fixed node settings, and the two tables the
 * synth reads (the scales and the FM algorithms).
 *
 * Data separate from logic (#225 decision 8, #246 decision 2): a file here is
 * what a tuning ticket edits; the files that import it are what a behaviour
 * ticket edits. The generator presets stay in `presets*.ts` — those are
 * authored patches, not tunables.
 */

/* ---------------------------- tempo and time ---------------------------- */

/** The transport's tempo when a document or a scheduler does not name one. */
export const DEFAULT_BPM = 120;
/** Tempo bounds a normalised arrangement document may take. */
export const BPM_MIN = 20;
export const BPM_MAX = 300;

export const SECONDS_PER_MINUTE = 60;
/** Milliseconds per second: the ramp and smoothing times are written in ms. */
export const MS_PER_SECOND = 1000;

/** Notes of each value in one bar — the denominators of `DIVISORS`. */
export const NOTES_PER_BAR = {
  quarter: 4,
  eighth: 8,
  sixteenth: 16,
  thirtySecond: 32,
} as const;

/** The look-ahead window the scheduler keeps filled, in seconds. */
export const SCHEDULER_LOOK_AHEAD_SECONDS = 0.12;
/** How far ahead of the clock the first tick is placed when the transport starts. */
export const SCHEDULER_START_DELAY_SECONDS = 0.06;

/* -------------------------------- pitch --------------------------------- */

/** The MIDI note range: 0..127. */
export const MIDI_NOTE_MAX = 127;
/** MIDI 60 — the default root and the default percussion note. */
export const MIDI_MIDDLE_C = 60;
/** A hand-written scale offset is capped at four octaves either way. */
export const SCALE_OFFSET_MAX = 48;

/** Scales as semitone offsets from the root, one entry per degree. */
export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  naturalMinor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  pentatonicMajor: [0, 2, 4, 7, 9],
  pentatonicMinor: [0, 3, 5, 7, 10],
} as const satisfies Record<string, readonly number[]>;

/* --------------------- arrangement document bounds ---------------------- */

/** A part's note velocity when the document does not name one. */
export const VELOCITY_DEFAULT = 0.8;
/** How long a percussion note is held, in seconds. */
export const HOLD_DEFAULT = 0.1;
export const HOLD_MIN = 0.005;
export const HOLD_MAX = 10;
/** A Euclidean driver's step count. */
export const EUCLID_STEPS_MAX = 64;
/** A Euclid lane's length in steps (windsor#355): each lane is 1 to this long, its own polymeter. */
export const EUCLID_LANE_STEPS_MAX = 32;
/** A Euclid pitch lane's reach, in semitones either way of the part's `note`. */
export const EUCLID_PITCH_LANE_MAX = 24;
/**
 * A step's ratchet: the most hits one step's roll may split into (1 is a
 * plain hit). Euclid, Grid and Arp steps share it (windsor#355, windsor#366).
 */
export const RATCHET_MAX = 4;
/** A Euclid step's ratchet ceiling: `RATCHET_MAX`, aliased so the two cannot drift. */
export const EUCLID_RATCHET_MAX = RATCHET_MAX;
/** Chance a `walk` density modulator steps at all on a given bar. */
export const WALK_CHANCE = 0.5;
/** A free-running density LFO's rate, in hertz. */
export const LFO_HZ_DEFAULT = 0.1;
export const LFO_HZ_MAX = 20;
/** A bar-locked density LFO's period, in bars. */
export const LFO_BARS_DEFAULT = 8;
export const LFO_BARS_MIN = 0.25;
export const LFO_BARS_MAX = 256;
/** A gate is a fraction of the step; zero would sound nothing. */
export const GATE_MIN = 0.01;
/** A register's octave offset from the root. */
export const OCTAVE_MAX = 8;
/* ------------------------ the grid sequencer (#602) ---------------------- */

/** A grid line is 1–32 written steps. */
export const GRID_STEPS_MAX = 32;
/** A grid step's octave offset from the part's register octave. */
export const GRID_STEP_OCTAVE_MAX = 2;
/**
 * A grid step's scale degree. Any non-negative integer resolves (a degree past
 * the scale's end wraps with octave carry), so this only bounds junk.
 */
export const GRID_DEGREE_MAX = 48;
/** The steps a grid part starts with when its kind is chosen: one bar of sixteenths on the root. */
export const GRID_DEFAULT_STEP_COUNT = 16;
/** The bump an accented grid step adds to the part velocity, and the mod value it sends. */
export const ACCENT_VELOCITY_DEFAULT = 0.2;
export const ACCENT_MOD_DEFAULT = 1;
/**
 * Seconds a slid note takes to reach its pitch when the patch's own `glide`
 * is 0 — the 303's fixed slide, near enough. A patch with `glide` set uses
 * that instead.
 */
export const SLIDE_SECONDS_DEFAULT = 0.06;
/**
 * Slack, in ticks, when reading the audible tick off the queue's accumulated
 * stamps (#603): a stamp reached by repeated addition can sit a few ulps past
 * the clock time that names it, and the playhead must not show the tick before.
 */
export const TICK_STAMP_EPSILON = 1e-6;
/* ----------------------- the chord sequencer (#606) ---------------------- */

/** A chord progression is 0–32 written steps; an empty list is silent. */
export const CHORD_STEPS_MAX = 32;
/** How many times in a row one step plays, retriggered each time. */
export const CHORD_REPEAT_MAX = 8;
export const CHORD_REPEAT_DEFAULT = 1;
/** A step's duration multiplier when the document names none: one base step. */
export const CHORD_DURATION_DEFAULT = 1;
/**
 * A step's inversion: 0–3 as written. Past the chord's tone count it wraps
 * with octave carry (inversion 3 of a triad is root position an octave up).
 */
export const CHORD_INVERSION_MAX = 3;
/** A step's octave offset from the part's register octave. */
export const CHORD_STEP_OCTAVE_MAX = 2;
/** A step's chromatic shift of the whole chord; an octave is the octave dial. */
export const CHORD_SEMITONE_MAX = 11;
/** Triads and sevenths — the tones stacked in thirds over the scale. */
export const CHORD_SIZE_TRIAD = 3;
export const CHORD_SIZE_SEVENTH = 4;
/** A voicing never sends more notes than this, whatever it doubles. */
export const CHORD_VOICING_NOTES_MAX = 6;
/** A chord's length as a fraction of its step; 1 holds it to the next onset. */
export const CHORD_GATE_DEFAULT = 1;
/* ------------- the song: transport bars, harmony timeline, regions (#705) ------------- */

/** Song length in bars (`transport.bars`, epic #703 decision 5); `songTicks = bars × TICKS_PER_BAR`. */
export const BARS_MIN = 1;
export const BARS_MAX = 256;
export const DEFAULT_BARS = 4;
/** The key root is a pitch class (decision 11): 0 = C … 11 = B. */
export const PITCH_CLASS_MAX = 11;
/**
 * A part's register octave is absolute MIDI octave numbering (decision 11):
 * `noteFor(degree, octave) = 12 × (octave + 1) + root + offset`, so octave 3
 * at root 0 is C3 = 48. -1 is MIDI's lowest octave, 9 its highest.
 */
export const REGISTER_OCTAVE_MIN = -1;
export const REGISTER_OCTAVE_MAX = 9;
/** Where each pitched kind opens: bass lines low, pads in the middle, arps above. */
export const GRID_REGISTER_OCTAVE_DEFAULT = 2;
export const CHORD_REGISTER_OCTAVE_DEFAULT = 3;
export const ARP_REGISTER_OCTAVE_DEFAULT = 4;
export const BASS_REGISTER_OCTAVE_DEFAULT = 1;
/** A harmony event's scale degree; like the grid's, only bounds junk. */
export const HARMONY_DEGREE_MAX = 48;
/** The arpeggiator (#706) spans 1–4 octaves of the voiced chord. */
export const ARP_OCTAVES_MIN = 1;
export const ARP_OCTAVES_MAX = 4;
export const ARP_GATE_DEFAULT = 0.5;
/** The bass (#707): its chance to sound a step, and how far it leans on the chord root. */
export const BASS_DENSITY_DEFAULT = 1;
export const BASS_ROOT_BIAS_DEFAULT = 0.7;
export const BASS_GATE_DEFAULT = 0.8;
/**
 * A document's document-format version: 6 since windsor#300 (the embedded
 * patches are patch format 3, the drive out of the filter). Version 5
 * (windsor#224: Tape's Drive feeds the magnetic core) upgrades to 6 through
 * `SONG_MIGRATIONS`; versions 2 to 4 are refused (record
 * `2026-09-28-format-versions-refuse-never-destroy`).
 */
export const ARRANGEMENT_VERSION = 6;
/** How many parts a song may have, and so the highest slot (#597; 16 since windsor#335). */
export const MUSIC_PARTS_MAX = 16;
export const MUSIC_SLOT_MAX = MUSIC_PARTS_MAX - 1;
/** A mix strip's linear level: 1 is unity, 4 is +12 dB of headroom to spare. */
export const MIX_LEVEL_MAX = 4;
/** The most group buses a song holds (windsor#284; record `2026-10-01-group-buses` §2). */
export const MAX_GROUPS = 8;
/**
 * A strip's low cut, in hertz (#640). The floor is the resting value and reads
 * as off: below the music bus's own 30 Hz highpass, so nothing audible moves.
 */
export const LOW_CUT_MIN_HZ = 20;
export const LOW_CUT_MAX_HZ = 500;

/* --------------------------- the audio graph ---------------------------- */

/** Hard left or right is a quarter turn: a centred source lands fully on one side. */
export const PAN_ANGLE_MAX = Math.PI / 4;

/** A bus filter's cutoff when the caller names none. */
export const BUS_FILTER_FREQUENCY_HZ = 12000;
/**
 * The Butterworth response as a Web Audio `lowpass` / `highpass` `Q`, which
 * the spec reads in dB (α = sin ω₀ / (2·10^(Q/20))): 20·log₁₀(1/√2), flat to
 * the cutoff and −3 dB at it. A linear 0.707 there is a +1.7 dB peak (#647).
 */
export const BUTTERWORTH_Q_DB = 20 * Math.log10(Math.SQRT1_2);
/** The delay return's buffer length, in seconds; the ceiling on `delayTime`. */
export const DELAY_MAX_SECONDS = 5;
/**
 * Feedback's ceiling. Below 1, the loop decays wherever the damping filter is
 * flat; the filter's resonance lifts the loop gain above 1 at the damping
 * frequency, the wanted runaway the loop's soft clip bounds (#647).
 */
export const DELAY_FEEDBACK_MAX = 0.95;
/**
 * The echo's damping resonance, as the biquad's `Q` in dB (#647). The floor
 * is Butterworth — flat, so repeats always decay below feedback 1 — and the
 * default is Web Audio's own `Q`, what the echo ran at before it had a knob.
 */
export const DELAY_RESONANCE_MIN_DB = BUTTERWORTH_Q_DB;
export const DELAY_RESONANCE_MAX_DB = 12;
export const DELAY_RESONANCE_DEFAULT_DB = 1;
/**
 * The soft clip inside the echo's loop (#647): `ceiling·tanh(x / ceiling)`,
 * transparent well below the ceiling. The curve covers ±`RANGE` × the
 * ceiling, past which the spec holds its end value; an odd point count puts
 * an exact 0 in the middle.
 */
export const DELAY_CLIP_CEILING = 1;
export const DELAY_CLIP_RANGE = 8;
export const DELAY_CLIP_CURVE_POINTS = 4097;
/** A return's gain into the master: 0..1, never a boost. */
export const RETURN_LEVEL_MAX = 1;
/** The delay return's damping lowpass, in hertz — the biquad's usable band. */
export const DELAY_DAMP_MIN_HZ = 10;
export const DELAY_DAMP_MAX_HZ = 20000;
/**
 * The plate's parameter ranges, `[min, max]` per `ReverbSpace` field —
 * restated from `parameterDescriptors` in `worklet/reverb/reverbProcessor.ts`
 * (bundled to `worklet/generated/reverb-processor.js`), which the main thread
 * does not import; `reverbSpace.test.ts` asserts the two agree. What a
 * document's `returns` section is clamped into.
 */
export const REVERB_SPACE_RANGES = {
  preDelay: [0, 1],
  inputLowCut: [10, 1000],
  inputHighCut: [200, 20000],
  diffusionIn1: [0, 1],
  diffusionIn2: [0, 1],
  size: [0.05, 4],
  decay: [0, 1],
  diffusionTank1: [0, 0.8],
  diffusionTank2: [0, 0.8],
  tankLowCut: [10, 1000],
  tankHighCut: [200, 20000],
  modRate: [0, 8],
  modDepth: [0, 4],
} as const satisfies Record<string, readonly [number, number]>;
/** Voices a music part allocates, and the FM engine's own default. */
export const MUSIC_PART_MAX_VOICES = 12;
export const PART_MAX_VOICES_DEFAULT = 16;
/** Chance a `walk` density modulator steps down rather than up. */
export const WALK_DOWN_CHANCE = 0.5;

/* ------------------------- the audio-load readout ------------------------ */

/**
 * Frames in one AudioWorklet render quantum. Fixed by the Web Audio spec
 * rather than a dial — it is here because the quantum *budget*
 * (`RENDER_QUANTUM_FRAMES / sampleRate` seconds) is what `audioLoad.ts`
 * expresses a load as a percentage of, and `docs/design/audio-architecture.md`
 * §7 quotes it.
 */
export const RENDER_QUANTUM_FRAMES = 128;

/**
 * How often a reporting processor posts its accumulated load, in seconds of
 * audio time (#445). The processor counts quanta, so the main thread converts
 * with the live sample rate. A whole second is long enough for the duty-cycle
 * sampler in `audioLoad.ts` to hold a useful number of samples, and short
 * enough that a readout tracks the music rather than the whole run.
 */
export const AUDIO_LOAD_REPORT_SECONDS = 1;

/**
 * A processor whose last report is older than this has stopped reporting —
 * disposed, or an audio thread that has stalled outright — and drops out of
 * the readout rather than freezing its last number on screen. Three
 * report intervals: one missed post is jitter, three in a row is gone.
 */
export const AUDIO_LOAD_STALE_MS = 3 * AUDIO_LOAD_REPORT_SECONDS * 1000;

/* --------------------------- FM algorithms ------------------------------ */

/**
 * Operators per voice — the length of `OP_NAMES` in `patch.ts`. It lives with
 * the patch defaults the worklet fills from (`worklet/fm/patchDefaults.ts`,
 * #670) and is re-exported here for every main-thread reader.
 */
export { OPERATOR_COUNT } from './worklet/fm/patchDefaults';

/**
 * The 11 algorithms and their type live with the worklet that renders them
 * (`worklet/fm/algorithms.ts`, #656) and are re-exported here for every
 * main-thread reader; one table, so the console's picker and the operator
 * cannot disagree.
 */
export { ALGORITHMS } from './worklet/fm/algorithms';
export type { Algorithm } from './worklet/fm/algorithms';

/* ----------------------------- the envelope ----------------------------- */

/** The envelope curve's steepness lives with the curve (`worklet/fm/fmConstants.ts`, #656). */
export { ENVELOPE_CURVE_STEEPNESS } from './worklet/fm/fmConstants';
