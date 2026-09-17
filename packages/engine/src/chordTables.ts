/**
 * The chord sequencer's tables (#606, record
 * `2026-09-17-606-chord-sequencer-degrees-per-part-voicing`): the base steps
 * it may run at, the duration multipliers a step may take, the voicings, and
 * the quality vocabulary the theory classifies into and the names read from.
 * Data, not logic — `chordTheory.ts`, `chordNames.ts`, `chordVoicing.ts` and
 * `chordSequencer.ts` take these as parameters defaulting to the shipped ones.
 */
import { DIVISORS } from './scheduler';

/**
 * The base steps a chord part may run at: the four for which every entry of
 * `CHORD_DURATIONS` lands on a whole tick (an eighth is 12 ticks; a quarter of
 * it is 3). A sixteenth would put ×0.25 on a tick and a half.
 */
export const CHORD_DIVISORS: readonly number[] = [
  DIVISORS.bar,
  DIVISORS.half,
  DIVISORS.quarter,
  DIVISORS.eighth,
];

/** A step's length as a multiple of the part's base step. */
export const CHORD_DURATIONS: readonly number[] = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];

/**
 * How a chord's tones are classified from the intervals above its root, in
 * semitones: the close-stacked third and fifth, and the seventh when there is
 * one. Anything the table does not name is `other`.
 */
export const CHORD_QUALITIES = [
  'maj',
  'min',
  'dim',
  'aug',
  'maj7',
  'dom7',
  'min7',
  'mMaj7',
  'halfDim7',
  'dim7',
  'augMaj7',
  'aug7',
  'other',
] as const;
export type ChordQuality = (typeof CHORD_QUALITIES)[number];

export type NamedQuality = Exclude<ChordQuality, 'other'>;

/** Interval sets keyed by quality; the theory looks a stack's intervals up here. */
export const QUALITY_INTERVALS: Readonly<Record<NamedQuality, readonly number[]>> = {
  maj: [4, 7],
  min: [3, 7],
  dim: [3, 6],
  aug: [4, 8],
  maj7: [4, 7, 11],
  dom7: [4, 7, 10],
  min7: [3, 7, 10],
  mMaj7: [3, 7, 11],
  halfDim7: [3, 6, 10],
  dim7: [3, 6, 9],
  augMaj7: [4, 8, 11],
  aug7: [4, 8, 10],
};

export interface QualityLabel {
  /** What follows the root's note name: `C min`, `G 7`, `A# maj7`. */
  readonly name: string;
  /** What follows the Roman numeral: `ii°`, `V7`, `viiø7`. */
  readonly suffix: string;
  /** Upper-case numeral (major and augmented) or lower (minor and diminished). */
  readonly upper: boolean;
}

export const QUALITY_LABELS: Readonly<Record<NamedQuality, QualityLabel>> = {
  maj: { name: 'maj', suffix: '', upper: true },
  min: { name: 'min', suffix: '', upper: false },
  dim: { name: 'dim', suffix: '°', upper: false },
  aug: { name: 'aug', suffix: '+', upper: true },
  maj7: { name: 'maj7', suffix: 'maj7', upper: true },
  dom7: { name: '7', suffix: '7', upper: true },
  min7: { name: 'min7', suffix: '7', upper: false },
  mMaj7: { name: 'mMaj7', suffix: 'mMaj7', upper: false },
  halfDim7: { name: 'm7b5', suffix: 'ø7', upper: false },
  dim7: { name: 'dim7', suffix: '°7', upper: false },
  augMaj7: { name: 'augMaj7', suffix: '+maj7', upper: true },
  aug7: { name: 'aug7', suffix: '+7', upper: true },
};

/** Roman numeral glyphs by value, largest first; degrees are small, so tens suffice. */
export const ROMAN_GLYPHS: ReadonlyArray<readonly [number, string]> = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** The console's note spelling: sharps only (epic #605 decision 11). */
export const CHORD_NOTE_NAMES: readonly string[] = [
  'C',
  'C#',
  'D',
  'D#',
  'E',
  'F',
  'F#',
  'G',
  'G#',
  'A',
  'A#',
  'B',
];

/**
 * A voicing is a transform of the inverted close stack (ascending semitones).
 * Each is total over any stack length, so a triad and a seventh both voice,
 * and `voiceChord` sorts, dedupes and caps what comes back.
 */
export interface ChordVoicing {
  readonly label: string;
  readonly voice: (stack: readonly number[]) => number[];
}

const OCTAVE = 12;
const dropNth = (stack: readonly number[], fromTop: number): number[] => {
  if (stack.length < fromTop) return [...stack];
  const index = stack.length - fromTop;
  return stack.map((n, i) => (i === index ? n - OCTAVE : n));
};

export const CHORD_VOICINGS = {
  close: { label: 'Close', voice: (stack) => [...stack] },
  drop2: { label: 'Drop 2', voice: (stack) => dropNth(stack, 2) },
  drop3: { label: 'Drop 3', voice: (stack) => dropNth(stack, 3) },
  spread: {
    label: 'Spread',
    voice: (stack) => stack.map((n, i) => (i % 2 === 0 ? n - OCTAVE : n)),
  },
  octaves3rds: {
    label: 'Octaves & 3rds',
    voice: (stack) => {
      const pair = stack.slice(0, 2);
      return [...pair, ...pair.map((n) => n + OCTAVE)];
    },
  },
  shell: {
    label: 'Shell',
    voice: (stack) => {
      if (stack.length <= 3) return [...stack];
      return [stack[0]!, stack[1]!, stack[stack.length - 1]!];
    },
  },
} as const satisfies Record<string, ChordVoicing>;

export type ChordVoicingId = keyof typeof CHORD_VOICINGS;
export const CHORD_VOICING_IDS = Object.keys(CHORD_VOICINGS) as readonly ChordVoicingId[];
export const CHORD_VOICING_DEFAULT: ChordVoicingId = 'close';
