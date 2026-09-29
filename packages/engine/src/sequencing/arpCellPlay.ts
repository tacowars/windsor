/**
 * How one arp cell plays (windsor#129, epic windsor#126 decisions 1, 4–6):
 * the pure rules the Arpeggiator runs at each onset once its walk has picked
 * a pitch. The arpeggiator owns the walk, the list and the state; this file
 * owns what a cell does to the walked pitch and to the note already held.
 *
 * - **The cell** for traversal index `i` is `i mod cycle`, the cycle being
 *   `arpCycleLength(style, L)` over the current list (`arpCellIndex`).
 * - **Note:** the walked pitch shifted by `octave × 12`, or the unshifted
 *   pitch when the shift leaves MIDI 0–127. It releases the held note and
 *   strikes, carrying the part's accent and the lanes' offsets for its cell,
 *   as the grid's note-on does.
 * - **Slide:** with a note held, the note-on is flagged `slide` and goes out
 *   before the held note's off, so the voice is handed over legato; a slide
 *   to the pitch held is a tie. With nothing held it is a plain note.
 * - **Tie:** no note-on; the held note carries on through the step. With
 *   nothing held it plays nothing.
 * - **Rest:** releases the held note and plays nothing.
 * - **Gate:** the note sounding after an onset releases at `gate` of this
 *   step, unless the next cell in the cycle is a tie or a slide
 *   (`holdsToNext`); then it runs to that onset. The look-ahead reads the
 *   next cell's kind only, so a skip drawn there later is a rest that
 *   releases the note at its own onset. It reads the current cycle, so at a
 *   chord change the next onset may play another cell (`arpeggiator.ts`,
 *   "The gate's look-ahead across a chord change").
 * - **A retrigger reset** (decided by tacowars, windsor#129): when a chord
 *   change with `retrigger` on restarts the walk at cell 0 and that cell is
 *   a tie or a slide, it plays as a plain note — the walked pitch with the
 *   cell's octave shift, its accent and its lanes, but no tie and no slide
 *   (`strikeCell`). So every chord change starts on a sounding note. A tie
 *   or slide on cell 0 when the cycle wraps with no chord change plays as
 *   written.
 * - **Skip chance:** a note cell becomes a rest with probability
 *   `skipChance`, drawn from a stream of its own (`arpSkipRng`), never the
 *   walk's, and nothing is drawn at 0 (`skipCell`).
 *
 * Pure: no clock, no graph. `generatorBoundary.test.ts` holds it there.
 */
import { MIDI_NOTE_MAX } from '../audioConstants';
import type { ArpSequencerConfig } from './arpSequencer';
import { ARP_SKIP_STREAM_SALT, UINT32_SPAN } from './arpStepConstants';
import { arpNote, type ArpStep } from './arpSteps';
import { hashSeed, streamRng, type Rng } from './generatorSeed';
import { mulberry32 } from './mulberry32';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import { SEMITONES_PER_OCTAVE } from './scaleSampler';
import { stepModAt } from './stepModLanes';

/** A rest: what a written rest and a skipped note both play. */
const REST: ArpStep = { kind: 'rest' };

/** The cell traversal index `i` lands on over a cycle of `cycle` ≥ 1 cells. */
export function arpCellIndex(i: number, cycle: number): number {
  return ((i % cycle) + cycle) % cycle;
}

/** Whether the cell after traversal index `i` is a tie or a slide: the note held at `i` runs to it. */
export function holdsToNext(steps: readonly ArpStep[], i: number, cycle: number): boolean {
  const next = steps[arpCellIndex(i + 1, cycle)];
  return next?.kind === 'tie' || (next?.kind === 'note' && next.slide);
}

/** `pitch` shifted by `octave` octaves, or `pitch` itself when the shift leaves MIDI 0–127. */
export function shiftOctave(pitch: number, octave: number): number {
  const shifted = pitch + octave * SEMITONES_PER_OCTAVE;
  return shifted >= 0 && shifted <= MIDI_NOTE_MAX ? shifted : pitch;
}

/**
 * The skip stream's seed for `seed` in `regionIndex`: the walk stream's seed
 * salted and put through one mulberry32 draw. Every mulberry32 stream is an
 * offset along one sequence, so a seed only added to would make the skip
 * stream the walk's (or another region's) shifted; the draw scrambles that.
 */
export function arpSkipSeed(
  seed: number,
  regionIndex: number,
  salt = ARP_SKIP_STREAM_SALT,
): number {
  return Math.floor(mulberry32(hashSeed(seed, regionIndex) ^ salt)() * UINT32_SPAN);
}

/** The skip-chance stream for one arp in one region, apart from the walk's `streamRng(seed, regionIndex)`. */
export function arpSkipRng(seed: number, regionIndex: number): Rng {
  return streamRng(arpSkipSeed(seed, regionIndex), 0);
}

/** The cell as it plays: a note cell becomes a rest with chance `skipChance`, one draw per note cell, none at 0. */
export function skipCell(cell: ArpStep, skipChance: number, rng: Rng): ArpStep {
  if (cell.kind !== 'note' || skipChance <= 0) return cell;
  return rng() < skipChance ? REST : cell;
}

/** A cell as it plays at a retrigger reset: a tie or a slide becomes a plain note, keeping a note's octave and accent. */
export function strikeCell(cell: ArpStep): ArpStep {
  if (cell.kind === 'tie') return arpNote();
  if (cell.kind === 'note' && cell.slide) return { ...cell, slide: false };
  return cell;
}

/** One onset as the arpeggiator hands it over, the walk and the skip already resolved. */
export interface ArpOnset {
  readonly tick: number;
  readonly time: number;
  /** The chord's degree, which the note-on carries. */
  readonly degree: number;
  /** The cell as it plays: a note skip chance turned into a rest arrives as a rest. */
  readonly cell: ArpStep;
  /** Its index in the cycle, which the lanes are read at. */
  readonly index: number;
  /** The pitch the walk picked, before the cell's octave. */
  readonly pitch: number;
  /** The note sounding into this onset, if any. */
  readonly held: number | null;
  /** The next cell in the cycle is a tie or a slide (`holdsToNext`). */
  readonly holdsOn: boolean;
}

/** What an onset emits and leaves sounding: the held note and the local tick its gate releases it, null to run to the next onset. */
export interface ArpCellOutcome {
  readonly events: NoteEvent[];
  readonly held: number | null;
  readonly releaseTick: number | null;
}

export type ArpCellConfig = Pick<
  ArpSequencerConfig,
  'gate' | 'divisor' | 'accentVelocity' | 'accentMod' | 'lanes'
>;

/** Where the note sounding after `onset` releases: `gate` of its step, or the next onset when a tie or slide follows. */
function releaseAt(onset: ArpOnset, config: ArpCellConfig): number | null {
  const gateTicks = Math.max(1, Math.round(config.gate * config.divisor));
  return onset.holdsOn || gateTicks >= config.divisor ? null : onset.tick + gateTicks;
}

function offOf(onset: ArpOnset): NoteEvent[] {
  const { held, tick, time } = onset;
  return held === null ? [] : [{ kind: 'noteOff', tick, time, note: held }];
}

/** A tie, or a slide to the pitch held: nothing new sounds, and the held note's gate moves to this step. */
function sustain(onset: ArpOnset, config: ArpCellConfig): ArpCellOutcome {
  if (onset.held === null) return { events: [], held: null, releaseTick: null };
  return { events: [], held: onset.held, releaseTick: releaseAt(onset, config) };
}

/** What `onset`'s cell plays over the note held into it. */
export function playArpCell(onset: ArpOnset, config: ArpCellConfig): ArpCellOutcome {
  const { cell, held } = onset;
  if (cell.kind === 'rest') return { events: offOf(onset), held: null, releaseTick: null };
  if (cell.kind === 'tie') return sustain(onset, config);
  const note = shiftOctave(onset.pitch, cell.octave);
  const slide = cell.slide && held !== null;
  if (slide && note === held) return sustain(onset, config);

  const on: NoteOnEvent = {
    kind: 'noteOn',
    tick: onset.tick,
    time: onset.time,
    note,
    degree: onset.degree,
  };
  if (cell.accent) on.accent = { velocity: config.accentVelocity, mod: config.accentMod };
  if (slide) on.slide = true;
  const stepMod = stepModAt(config.lanes, onset.index);
  if (stepMod) on.stepMod = stepMod;
  // Legato: the sliding note takes the voice before the held one lets go.
  const events = slide ? [on, ...offOf(onset)] : [...offOf(onset), on];
  return { events, held: note, releaseTick: releaseAt(onset, config) };
}
