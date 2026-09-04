/**
 * The audio area's numbers: tempo and MIDI ranges, the arrangement schema's
 * clamp bounds, the graph's fixed node settings, and the two tables the
 * synth reads (the scales and the FM algorithms).
 *
 * Data separate from logic (#225 decision 8, #246 decision 2): a file here is
 * what a tuning ticket edits; the files that import it are what a behaviour
 * ticket edits. The generator presets stay in `presets*.ts` — those are
 * authored patches, not tunables.
 *
 * Nothing here feeds simulation state (root invariant 4): audio observes.
 */

/* ---------------------------- tempo and time ---------------------------- */

/** The transport's tempo when a document or a scheduler does not name one. */
export const DEFAULT_BPM = 120;
/** Tempo bounds a normalised arrangement document may take. */
export const BPM_MIN = 20;
export const BPM_MAX = 300;

export const SECONDS_PER_MINUTE = 60;

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

/** A degree weight is relative, so only its magnitude is capped. */
export const WEIGHT_MAX = 1e6;
/** A part's note velocity when the document does not name one. */
export const VELOCITY_DEFAULT = 0.8;
/** How long a percussion note is held, in seconds. */
export const HOLD_DEFAULT = 0.1;
export const HOLD_MIN = 0.005;
export const HOLD_MAX = 10;
/** A Euclidean driver's step count. */
export const EUCLID_STEPS_MAX = 64;
/** Chance a `walk` density modulator steps at all on a given bar. */
export const WALK_CHANCE = 0.5;
/** A free-running density LFO's rate, in hertz. */
export const LFO_HZ_DEFAULT = 0.1;
export const LFO_HZ_MAX = 20;
/** A bar-locked density LFO's period, in bars. */
export const LFO_BARS_DEFAULT = 8;
export const LFO_BARS_MIN = 0.25;
export const LFO_BARS_MAX = 256;
/** How many notes the arpeggiator draws into its pool, and how often it redraws. */
export const POOL_SIZE_MAX = 16;
export const REFRESH_BARS_MAX = 64;
/** A gate is a fraction of the step; zero would sound nothing. */
export const GATE_MIN = 0.01;
/** A register's octave offset from the root, and the octaves it spreads over. */
export const OCTAVE_MAX = 8;
export const SPAN_MAX = 8;
/** A mix strip's linear level: 1 is unity, 4 is +12 dB of headroom to spare. */
export const MIX_LEVEL_MAX = 4;

/* --------------------------- the audio graph ---------------------------- */

/** Hard left or right is a quarter turn: a centred source lands fully on one side. */
export const PAN_ANGLE_MAX = Math.PI / 4;

/** A bus filter's cutoff and resonance when the caller names neither. */
export const BUS_FILTER_FREQUENCY_HZ = 12000;
/** 1/sqrt(2) — the Butterworth Q, flat through the passband. */
export const BUS_FILTER_Q = 0.707;
/** The delay return's buffer length, in seconds; the ceiling on `delayTime`. */
export const DELAY_MAX_SECONDS = 5;
/** Feedback is clamped below 1 so the loop always decays. */
export const DELAY_FEEDBACK_MAX = 0.95;
/** Voices a music part allocates, and the FM engine's own default. */
export const MUSIC_PART_MAX_VOICES = 12;
export const PART_MAX_VOICES_DEFAULT = 16;
/** Chance a `walk` density modulator steps down rather than up. */
export const WALK_DOWN_CHANCE = 0.5;

/* --------------------------- FM algorithms ------------------------------ */

/** Operators per voice — the length of `OP_NAMES` in `patch.ts`. */
export const OPERATOR_COUNT = 4;

export interface Algorithm {
  readonly name: string;
  readonly label: string;
  /** `mods[i]` lists the operators that modulate operator `i`. */
  readonly mods: readonly (readonly number[])[];
  /** Operators summed to the voice output. */
  readonly carriers: readonly number[];
}

/**
 * The 11 algorithms: the eight classic four-operator topologies plus three
 * parallel/tapped shapes. Index matches `ALGORITHMS` in the worklet.
 */
export const ALGORITHMS: readonly Algorithm[] = [
  { name: 'Series', label: 'D>C>B>A', mods: [[1], [2], [3], []], carriers: [0] },
  { name: 'Twin Mod', label: '(D,C)>B>A', mods: [[1], [2, 3], [], []], carriers: [0] },
  { name: 'Stack + Mod', label: 'C>B>A, D>A', mods: [[1, 3], [2], [], []], carriers: [0] },
  { name: 'Pair into A', label: 'D>C>A, B>A', mods: [[2, 1], [], [3], []], carriers: [0] },
  { name: 'Two Stacks', label: 'D>C | B>A', mods: [[1], [], [3], []], carriers: [0, 2] },
  { name: 'One to Three', label: 'D>(C,B,A)', mods: [[3], [3], [3], []], carriers: [0, 1, 2] },
  { name: 'Stack + Two', label: 'D>C | B | A', mods: [[], [], [3], []], carriers: [0, 1, 2] },
  { name: 'Additive', label: 'A|B|C|D', mods: [[], [], [], []], carriers: [0, 1, 2, 3] },
  { name: 'Series + Tap', label: 'D>C>B>A +B', mods: [[1], [2], [3], []], carriers: [0, 1] },
  { name: 'Split Branch', label: 'D>C>(B,A)', mods: [[2], [2], [3], []], carriers: [0, 1] },
  { name: 'Triple Mod', label: '(D,C,B)>A', mods: [[1, 2, 3], [], [], []], carriers: [0] },
] as const;
