/**
 * The Drum's pattern bank (windsor#950, record `2026-10-24-drum-sequencer`):
 * thirty one-bar rhythm presets in six groups, what applying one does to a
 * Drum config, and which one a line still is. The patterns are tables, one
 * file per group (`drumPatternTables*.ts`), in the row notation
 * `drumPatternTables.ts` describes; `expandDrumRows` turns a pattern's rows
 * into steps.
 *
 * Pure: data and arithmetic over the Drum's step type.
 */
import { RATCHET_MAX } from '../audioConstants';
import type { DrumSequencerConfig } from './drumSequencer';
import {
  DRUM_PATTERN_NOTATION,
  DRUM_PATTERN_STEPS,
  type DrumPatternNotation,
  type DrumPatternRows,
} from './drumPatternTables';
import { DRUM_PATTERNS_CLAP } from './drumPatternTablesClap';
import { DRUM_PATTERNS_HAT } from './drumPatternTablesHat';
import { DRUM_PATTERNS_KICK } from './drumPatternTablesKick';
import { DRUM_PATTERNS_OPEN_HAT } from './drumPatternTablesOpenHat';
import { DRUM_PATTERNS_PERC } from './drumPatternTablesPerc';
import { DRUM_PATTERNS_SNARE } from './drumPatternTablesSnare';
import { DRUM_REST, drumHit, type DrumStep } from './drumSteps';

/** The picker's groups, in its order. */
export const DRUM_PATTERN_GROUPS = ['Kick', 'Snare', 'Clap', 'Hat', 'Open hat', 'Perc'] as const;
export type DrumPatternGroup = (typeof DRUM_PATTERN_GROUPS)[number];

export interface DrumPattern {
  readonly id: string;
  readonly name: string;
  readonly group: DrumPatternGroup;
  /** Exactly `DRUM_PATTERN_STEPS`, each a hit's velocity, pitch and ratchet keyed only off their defaults. */
  readonly steps: readonly DrumStep[];
}

/** The mark at step `i` of an optional row, checked against the bar's length; blank when the row is absent. */
function markAt(row: string | undefined, i: number, name: string, blank: string): string {
  if (row === undefined) return blank;
  if (row.length !== DRUM_PATTERN_STEPS) {
    throw new RangeError(`${name} row must be ${DRUM_PATTERN_STEPS} characters, got ${row.length}`);
  }
  return row[i]!;
}

/** A velocity character, and its half mark, as a hit's velocity in (0, 1]. */
function hitVelocity(
  char: string,
  half: boolean,
  at: string,
  notation: DrumPatternNotation,
): number {
  if (char === notation.full) {
    if (half) throw new RangeError(`${at}: a half mark cannot raise a full hit`);
    return 1;
  }
  const digit = Number(char);
  if (!(Number.isInteger(digit) && digit >= 1 && digit < notation.tenths)) {
    throw new RangeError(
      `${at}: velocity ${char} is not ${notation.blank}, 1–9 or ${notation.full}`,
    );
  }
  return (2 * digit + (half ? 1 : 0)) / (2 * notation.tenths);
}

/** One step of a pattern from its rows' marks at `i`. */
function expandStep(rows: DrumPatternRows, i: number, notation: DrumPatternNotation): DrumStep {
  const { blank } = notation;
  const at = `${rows.id} step ${i + 1}`;
  const half = markAt(rows.half, i, 'half', blank);
  const accent = markAt(rows.accent, i, 'accent', blank);
  const ratchetMark = markAt(rows.ratchet, i, 'ratchet', blank);
  const pitch = rows.pitch?.[i] ?? 0;
  if (half !== blank && half !== notation.half) throw new RangeError(`${at}: half mark ${half}`);
  if (accent !== blank && accent !== notation.accent) {
    throw new RangeError(`${at}: accent ${accent}`);
  }
  const ratchet = ratchetMark === blank ? 1 : Number(ratchetMark);
  const rolls = Number.isInteger(ratchet) && ratchet >= 2 && ratchet <= RATCHET_MAX;
  if (ratchetMark !== blank && !rolls) {
    throw new RangeError(`${at}: ratchet ${ratchetMark} is not ${blank} or 2–${RATCHET_MAX}`);
  }
  const char = rows.velocity[i]!;
  if (char === blank) {
    const marked = half !== blank || accent !== blank || ratchet !== 1 || pitch !== 0;
    if (marked) throw new RangeError(`${at}: a rest carries a mark`);
    return DRUM_REST;
  }
  const velocity = hitVelocity(char, half !== blank, at, notation);
  return drumHit({
    accent: accent !== blank,
    ...(velocity !== 1 && { velocity }),
    ...(pitch !== 0 && { pitch }),
    ...(ratchet !== 1 && { ratchet }),
  });
}

/**
 * A pattern's rows as its steps: a rest at each blank, else a hit at the
 * row's velocity, accented, rolled and pitched where its rows mark it. A
 * velocity of 1, a pitch of 0 and a ratchet of 1 leave no key, as the
 * normaliser writes a step. Refuses a row of the wrong length, an unknown
 * character and a mark on a rest.
 */
export function expandDrumRows(
  rows: DrumPatternRows,
  notation: DrumPatternNotation = DRUM_PATTERN_NOTATION,
): DrumStep[] {
  if (rows.velocity.length !== DRUM_PATTERN_STEPS) {
    throw new RangeError(`${rows.id}: velocity row must be ${DRUM_PATTERN_STEPS} characters`);
  }
  if (rows.pitch && rows.pitch.length !== DRUM_PATTERN_STEPS) {
    throw new RangeError(`${rows.id}: pitch row must hold ${DRUM_PATTERN_STEPS} offsets`);
  }
  return Array.from({ length: DRUM_PATTERN_STEPS }, (_, i) => expandStep(rows, i, notation));
}

const GROUP_ROWS: Record<DrumPatternGroup, readonly DrumPatternRows[]> = {
  Kick: DRUM_PATTERNS_KICK,
  Snare: DRUM_PATTERNS_SNARE,
  Clap: DRUM_PATTERNS_CLAP,
  Hat: DRUM_PATTERNS_HAT,
  'Open hat': DRUM_PATTERNS_OPEN_HAT,
  Perc: DRUM_PATTERNS_PERC,
};

/** The bank, group by group in the picker's order. */
export const DRUM_PATTERNS: readonly DrumPattern[] = DRUM_PATTERN_GROUPS.flatMap((group) =>
  GROUP_ROWS[group].map((rows) => ({
    id: rows.id,
    name: rows.name,
    group,
    steps: expandDrumRows(rows),
  })),
);

type DrumLine = Pick<DrumSequencerConfig, 'steps' | 'length'>;

/**
 * The config with the pattern `id` written in: its steps, and a loop of
 * all of them. Every other field (note, gate, divisor, variation, seed,
 * lanes) is kept; the normaliser fits the lanes to the new steps.
 */
export function applyDrumPattern<C extends DrumLine>(
  config: C,
  id: string,
  patterns: readonly DrumPattern[] = DRUM_PATTERNS,
): C {
  const pattern = patterns.find((p) => p.id === id);
  if (!pattern) throw new RangeError(`no drum pattern ${id}`);
  return { ...config, steps: [...pattern.steps], length: pattern.steps.length };
}

/** Two steps that play alike: the kind, and a hit's accent, velocity, pitch and ratchet, an absent key read as its default. */
function sameStep(a: DrumStep, b: DrumStep): boolean {
  if (a.kind !== 'hit' || b.kind !== 'hit') return a.kind === b.kind;
  return (
    a.accent === b.accent &&
    (a.velocity ?? 1) === (b.velocity ?? 1) &&
    (a.pitch ?? 0) === (b.pitch ?? 0) &&
    (a.ratchet ?? 1) === (b.ratchet ?? 1)
  );
}

/**
 * The id of the pattern a line still is: a loop of `DRUM_PATTERN_STEPS`
 * whose steps equal the pattern's hit for hit and field for field. Steps
 * past the loop are not played and not compared. Two patterns that write
 * the same line (`hat-offbeats` and `open-offbeats`) give the earlier.
 * Null, what the picker shows as Custom, for any other line.
 */
export function drumPatternOf(
  steps: readonly DrumStep[],
  length = steps.length,
  patterns: readonly DrumPattern[] = DRUM_PATTERNS,
): string | null {
  if (length !== DRUM_PATTERN_STEPS || steps.length < length) return null;
  const match = patterns.find(
    (p) => p.steps.length === length && p.steps.every((step, i) => sameStep(step, steps[i]!)),
  );
  return match?.id ?? null;
}
