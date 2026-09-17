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

/* ------------------------------ the music ------------------------------- */

/** The committed `arrangements/<name>.json` the game plays unless `?music=<name>` says otherwise. */
export const DEFAULT_ARRANGEMENT_NAME = 'bed-01';

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
/** A document's document-format version (#597: parts are a slot list). */
export const ARRANGEMENT_VERSION = 2;
/** How many parts a song may have, and so the highest slot (#597). */
export const MUSIC_PARTS_MAX = 8;
export const MUSIC_SLOT_MAX = MUSIC_PARTS_MAX - 1;
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
/** A return's gain into the master: 0..1, never a boost. */
export const RETURN_LEVEL_MAX = 1;
/** The delay return's damping lowpass, in hertz — the biquad's usable band. */
export const DELAY_DAMP_MIN_HZ = 10;
export const DELAY_DAMP_MAX_HZ = 20000;
/**
 * The plate's parameter ranges, `[min, max]` per `ReverbSpace` field —
 * restated from `worklet/reverb-processor.js` `parameterDescriptors`, which
 * must stay import-free; `reverbSpace.test.ts` asserts the two agree. What a
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
 * enough that the overlay and the bench's per-frame column track the music
 * rather than the whole run.
 */
export const AUDIO_LOAD_REPORT_SECONDS = 1;

/**
 * A processor whose last report is older than this has stopped reporting —
 * disposed, or an audio thread that has stalled outright — and drops out of
 * the readout rather than freezing its last number on the overlay. Three
 * report intervals: one missed post is jitter, three in a row is gone.
 */
export const AUDIO_LOAD_STALE_MS = 3 * AUDIO_LOAD_REPORT_SECONDS * 1000;

/**
 * How long a consumer waits after a measured window closes before reading
 * `AudioContext.playbackStats` for the closing snapshot (#275 decision 6).
 *
 * The counters are not live: probed on the target box they refreshed about
 * once a second, and after a burst of overload they kept rising for a further
 * second — the `overload` probe gained 80 events in the second *after* the
 * load stopped, and had settled by +3 s
 * (`docs/research/2026-09-14-275-playbackstats-probe/`). A window read at the
 * instant it closes therefore under-counts its own tail. Three seconds is the
 * box's settled figure; the floor the decision sets is 1000 ms.
 */
export const AUDIO_STATS_SETTLE_MS = 3000;

/**
 * The rolling window the main-thread audio scheduling cost reports its mean
 * and p95 over (#275 decision 7), in seconds. The same second the worklets
 * report their load over, so the overlay's two audio numbers describe the
 * same slice of wall time rather than two different ones.
 */
export const AUDIO_SCHED_WINDOW_SECONDS = AUDIO_LOAD_REPORT_SECONDS;

/**
 * Hard cap on per-frame scheduling samples held for that window. One second
 * at 60 fps is 60 samples and at 240 fps is 240; the cap only bites if frames
 * arrive faster than that or the clock stops advancing, and it is what keeps
 * a wedged page from growing the buffer without bound.
 */
export const AUDIO_SCHED_MAX_SAMPLES = 1024;

/**
 * The quantile the scheduling cost is reported at, as a fraction — the p95
 * `docs/design/audio-architecture.md` §7 states its criterion in. The same
 * value as the bench's `QUANTILES.p95` (`bench/benchConstants.ts`), and
 * `schedCost.test.ts` pins the two equal rather than importing the bench's
 * table into the audio graph.
 */
export const AUDIO_SCHED_QUANTILE = 0.95;

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
