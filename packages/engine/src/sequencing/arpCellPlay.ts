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
 * - **Gate:** the note sounding after an onset releases at its played gate
 *   of this step: the part's gate (the Gate knob, or the `seq.gate` lane
 *   where one plays) times the cell's own `gate` (windsor#933), floored at
 *   `GATE_MIN` (`arpPlayedGate`). It reaches `playArpCell` on the onset, so
 *   the Figure, which plays its cells here too and sets none, keeps the
 *   part's gate. The note runs to the next onset instead when the played
 *   gate covers the step, or when the next cell in the cycle is a tie or a
 *   slide (`holdsToNext`), whatever the gate. The look-ahead reads the
 *   next cell's kind as written, so a slide that step variation silences
 *   there later is a rest that releases the note at its own onset. It
 *   reads the current cycle, so at a
 *   chord change the next onset may play another cell (`arpeggiator.ts`,
 *   "The gate's look-ahead across a chord change").
 * - **A retrigger reset** (decided by tacowars, windsor#129): when a chord
 *   change with `retrigger` on restarts the walk at cell 0 and that cell is
 *   a tie or a slide, it plays as a plain note — the walked pitch with the
 *   cell's octave shift, its accent and its lanes, but no tie and no slide
 *   (`strikeCell`). So every chord change starts on a sounding note. A tie
 *   or slide on cell 0 when the cycle wraps with no chord change plays as
 *   written.
 * - **Step variation** (windsor#935, `stepVariation.ts`) draws from a
 *   stream of its own (`arpVariationRng`), never the walk's. The
 *   arpeggiator resolves it before the cell plays: the onset arrives with
 *   the cell as it plays, its pitch and gate, and a velocity under the
 *   part's when the step varied one.
 *
 * Pure: no clock, no graph. `generatorBoundary.test.ts` holds it there.
 */
import { GATE_MIN, MIDI_NOTE_MAX } from '../audioConstants';
import type { ArpSequencerConfig } from './arpSequencer';
import { ARP_VARIATION_STREAM_SALT, UINT32_SPAN } from './arpStepConstants';
import { arpNote, type ArpStep } from './arpSteps';
import { hashSeed, streamRng, type Rng } from './generatorSeed';
import { mulberry32 } from './mulberry32';
import type { NoteEvent, NoteOnEvent } from './noteEvent';
import { SEMITONES_PER_OCTAVE } from './scaleSampler';
import { stepModAt } from './stepModLanes';
import {
  jumpOffset,
  octaveShift,
  shiftOctaveWithin,
  variedGate,
  variedVelocity,
  wrapIndex,
  type StepDraw,
} from './stepVariation';
import { STEP_VARIATION_TABLE, type StepVariationTable } from './stepVariationConstants';

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
 * The variation stream's seed for `seed` in `regionIndex`: the walk stream's
 * seed salted and put through one mulberry32 draw. Every mulberry32 stream
 * is an offset along one sequence, so a seed only added to would make the
 * variation stream the walk's (or another region's) shifted; the draw
 * scrambles that.
 */
export function arpVariationSeed(
  seed: number,
  regionIndex: number,
  salt = ARP_VARIATION_STREAM_SALT,
): number {
  return Math.floor(mulberry32(hashSeed(seed, regionIndex) ^ salt)() * UINT32_SPAN);
}

/** Step variation's stream for one arp in one region, apart from the walk's `streamRng(seed, regionIndex)`. */
export function arpVariationRng(seed: number, regionIndex: number): Rng {
  return streamRng(arpVariationSeed(seed, regionIndex), 0);
}

/** A cell as it plays at a retrigger reset: a tie or a slide becomes a plain note, keeping a note's octave and accent. */
export function strikeCell(cell: ArpStep): ArpStep {
  if (cell.kind === 'tie') return arpNote();
  if (cell.kind === 'note' && cell.slide) return { ...cell, slide: false };
  return cell;
}

/**
 * A cell as it plays once Rests sound has flipped it (windsor#935): a note
 * rests, a rest sounds as a plain note (the walked pitch, no accent, slide
 * or ratchet), and a tie never flips.
 */
export function flipCell(cell: ArpStep): ArpStep {
  if (cell.kind === 'note') return { kind: 'rest' };
  return cell.kind === 'rest' ? arpNote() : cell;
}

/** What a cell plays with once step variation has had its say: the cell, its pitch, gate and velocity. */
export interface ArpVariedCell {
  readonly cell: ArpStep;
  /** The pitch `playArpCell` shifts by the cell's octave. */
  readonly pitch: number;
  readonly gate: number;
  /** A fraction of the part's velocity; absent is 1. */
  readonly velocity?: number | undefined;
}

/** Where a cell's pitch and gate come from: the walked list and index, and the part's settings. */
export interface ArpVariationContext {
  readonly list: readonly number[];
  /** The list index the walk picked. */
  readonly at: number;
  readonly config: Pick<ArpSequencerConfig, 'gate' | 'randomness' | 'octaveMode'>;
  readonly table?: StepVariationTable;
}

/**
 * A note cell's pitch, gate and velocity on a step that varies
 * (windsor#935): a velocity under the part's, a gate moved about the played
 * one, and a pitch either moved by whole octaves of the cell's own note
 * (Octave on, the cell's shift folded into the pitch) or the list neighbour
 * a normal offset from the walked one, wrapping over the list. Any other
 * cell, or a step that plays as written (`draw` null), keeps the walked
 * pitch and the played gate.
 */
export function variedCell(
  cell: ArpStep,
  draw: StepDraw | null,
  context: ArpVariationContext,
): ArpVariedCell {
  const { list, at, config, table = STEP_VARIATION_TABLE } = context;
  const walked = list[at] as number;
  const gate = arpPlayedGate(config.gate, cell);
  if (!draw || cell.kind !== 'note') return { cell, pitch: walked, gate };
  const { randomness } = config;
  const varied = {
    gate: variedGate(gate, draw, randomness, table),
    velocity: variedVelocity(draw, randomness, table),
  };
  if (config.octaveMode) {
    const own = shiftOctave(walked, cell.octave);
    const pitch = shiftOctaveWithin(own, octaveShift(draw, randomness, table));
    return { cell: { ...cell, octave: 0 }, pitch, ...varied };
  }
  const offset = jumpOffset(draw, randomness, list.length, table.listJumpSigma);
  return { cell, pitch: list[wrapIndex(at + offset, list.length)] as number, ...varied };
}

/**
 * The gate a cell plays at (windsor#933): the part's gate times the cell's,
 * floored at `floor`. A cell with no gate plays the part's gate as it is.
 */
export function arpPlayedGate(partGate: number, cell: ArpStep, floor = GATE_MIN): number {
  if (cell.kind !== 'note' || cell.gate === undefined) return partGate;
  return Math.max(floor, partGate * cell.gate);
}

/** One onset as the arpeggiator hands it over, the walk and step variation already resolved. */
export interface ArpOnset {
  readonly tick: number;
  readonly time: number;
  /** The chord's degree, which the note-on carries. */
  readonly degree: number;
  /** The cell as it plays: a note step variation silenced arrives as a rest. */
  readonly cell: ArpStep;
  /** Its index in the cycle, which the lanes are read at. */
  readonly index: number;
  /** The pitch the walk picked, before the cell's octave. */
  readonly pitch: number;
  /** The note sounding into this onset, if any. */
  readonly held: number | null;
  /** The next cell in the cycle is a tie or a slide (`holdsToNext`). */
  readonly holdsOn: boolean;
  /** The gate the note sounding after this onset plays at (`arpPlayedGate`); absent is the config's. */
  readonly gate?: number;
  /** A varied step's velocity, a fraction of the part's (windsor#935); absent is 1. */
  readonly velocity?: number | undefined;
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

/** Where the note sounding after `onset` releases: its gate of the step, or the next onset when a tie or slide follows. */
function releaseAt(onset: ArpOnset, config: ArpCellConfig): number | null {
  const gate = onset.gate ?? config.gate;
  const gateTicks = Math.max(1, Math.round(gate * config.divisor));
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
  if (onset.velocity !== undefined) on.velocity = onset.velocity;
  if (cell.accent) on.accent = { velocity: config.accentVelocity, mod: config.accentMod };
  if (slide) on.slide = true;
  const stepMod = stepModAt(config.lanes, onset.index);
  if (stepMod) on.stepMod = stepMod;
  // Legato: the sliding note takes the voice before the held one lets go.
  const events = slide ? [on, ...offOf(onset)] : [...offOf(onset), on];
  return { events, held: note, releaseTick: releaseAt(onset, config) };
}
