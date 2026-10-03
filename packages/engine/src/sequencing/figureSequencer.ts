/**
 * The Figure's config (windsor#484, epic windsor#483; record
 * `2026-10-03-figure-sequencer`): a written line of 1–32 cells over the
 * current chord. A cell names a chord tone (`harmony/figureTones.ts`), an
 * octave, a velocity, accent, slide and ratchet, or is a rest or a tie. On
 * the line sit three optional processes: a length `schedule` (additive
 * growth), a rotation `drift`, and a canon `source` (another Figure part's
 * cells, late and transposed).
 *
 * This file is the field set, its defaults, the check every constructor
 * and live edit runs, and the performer (windsor#485); the normaliser is
 * `song/figureNormalise.ts`. The schedule and the drift (windsor#486) are
 * `figureLine.ts`.
 *
 * **The performer.** `FigureSequencer` hears its region gate at every local
 * tick and plays one cell per `divisor` ticks: `cellAt(step)`, the cell the
 * line's stage and rotation put at that step (`figureLine.ts`), which is
 * `step mod length` with neither process. The bar it counts in is the
 * gate's local bar in the song's meter; the meter's bar length is handed at
 * build and read again off every tick past the first bar, so a live meter
 * edit reaches the playhead too. A schedule or drift edit takes effect at
 * the next bar line after the last tick heard.
 *
 * A note cell voices the chord the gate hands over at the cell's onset:
 * `figureNote(chord.stack, tone, rootNote(register)) + 12·octave`, dropped
 * outside MIDI 0–127 (it plays as a rest), never clamped. A sounding note
 * never moves on a chord change, so a tie across one keeps its pitch. A
 * tick with no chord plays nothing and releases nothing.
 *
 * What a cell does to the note held into it is the Arp's cell rule
 * (`arpCellPlay.ts`: the Grid's slide, tie and rest, plus a gate). A note
 * releases at `gate` of its cell unless a tie or slide follows; at gate 1
 * it runs to the next onset, as a Grid note does. Accents, step-mod lanes
 * and ratchets ride on the note-on as the Grid's do, and the player rolls
 * them through `rollSpan.ts` and `pitchedRoll.ts`. A cell's `velocity`
 * rides on the note-on too and scales the part's velocity before the
 * accent adds its bump (`partNoteOn`). `skipChance` draws once per note
 * cell, before the roll, from the part's stream per region
 * (`hashSeed(seed, regionIndex)`). A skipped cell, a cell at velocity 0 and
 * a dropped note are rests that still advance the stream.
 *
 * **The canon** (windsor#487). With a `source`, the part plays its leader's
 * resolved cell at `step − offset`: the leader's `cellAt` over the leader's
 * own cells, so a chain resolves one level and a negative step reads the
 * line cyclically. The step is the follower's own, counted from its own
 * region's entry; the leader's clock and regions play no part. The
 * follower's `cells`, `length`, `schedule` and `drift` are ignored; its
 * divisor, gate, register, `skipChance` and stream are its own. The note is
 * the leader's cell over the chord at the follower's onset, at the
 * follower's register, plus `transpose` semitones. The leader is found at
 * every onset by slot through the player's resolver (`figureOf`), so a
 * leader's live edit is heard on the next step, and a slot that holds no
 * Figure (an empty slot, a kind changed live) plays a rest: the follower
 * goes silent at once, as the next normalise will make it. `stepAt` is the
 * leader's cell the follower plays, -1 with no leader.
 */
import {
  ACCENT_MOD_DEFAULT,
  ACCENT_VELOCITY_DEFAULT,
  ARP_GATE_DEFAULT,
  ARP_REGISTER_OCTAVE_DEFAULT,
  FIGURE_DRIFT_STEPS_MAX,
  FIGURE_SCHEDULE_BARS_MAX,
  FIGURE_TONE_MAX,
  FIGURE_TRANSPOSE_MAX,
  GRID_DEFAULT_STEP_COUNT,
  GRID_STEPS_MAX,
  GRID_STEP_OCTAVE_MAX,
  MIDI_NOTE_MAX,
  MUSIC_SLOT_MAX,
  REGISTER_OCTAVE_MAX,
  REGISTER_OCTAVE_MIN,
} from '../audioConstants';
import { figureNote } from '../harmony/figureTones';
import type { HarmonyChord } from '../harmony/harmonyTimeline';
import { playArpCell, type ArpCellOutcome } from './arpCellPlay';
import { rollOutcome } from './arpeggiator';
import type { ArpStep } from './arpSteps';
import { FigureLine } from './figureLine';
import { streamRng, type Rng } from './generatorSeed';
import { assertRatchet } from './gridSequencer';
import { defaultStepCount } from './meter';
import type { Meter } from './meterTables';
import type { NoteEvent, NoteHandler, NoteOnEvent } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { SEMITONES_PER_OCTAVE, type ScaleSampler } from './scaleSampler';
import { DIVISORS, TICKS_PER_BAR, isNoteDivisor, type Unsubscribe } from './scheduler';
import { assertStepModLanes, type StepModLane } from './stepModLanes';

export interface FigureNoteCell {
  readonly kind: 'note';
  /** Index into the chord's stack, ±`FIGURE_TONE_MAX`, wrapping with octave carry. */
  readonly tone: number;
  /** Octaves above the part's register octave, ±`GRID_STEP_OCTAVE_MAX`. */
  readonly octave: number;
  /** Scales the part's velocity, 0–1; absent is 1. */
  readonly velocity?: number;
  readonly accent: boolean;
  readonly slide: boolean;
  /** Hits the cell's roll plays, 1 to `RATCHET_MAX` (windsor#366); absent is one. */
  readonly ratchet?: number;
}

export type FigureCell = { readonly kind: 'rest' } | { readonly kind: 'tie' } | FigureNoteCell;

/** One stage of the length schedule: the first `length` cells, for `bars` bars. */
export interface FigureStage {
  readonly length: number;
  readonly bars: number;
}

/** The rotation drift: every `everyBars` bars the line slips `steps` cells. */
export interface FigureDrift {
  readonly steps: number;
  readonly everyBars: number;
}

/** A canon: the part on `slot`'s cells, `offset` steps late and `transpose` semitones up. */
export interface FigureSource {
  readonly slot: number;
  readonly offset: number;
  readonly transpose: number;
}

export interface FigureSequencerConfig {
  /** Ticks per cell: a note value that divides the whole note. */
  divisor: number;
  /** 1–`GRID_STEPS_MAX` written cells; the line loops over the first `length`. */
  cells: readonly FigureCell[];
  /** The loop length, 1..`cells.length`, as the Grid's. */
  length: number;
  /** A note's length as a fraction of its cell, in (0, 1]. */
  gate: number;
  /** The absolute MIDI octave the key root sits at. */
  register: { octave: number };
  /** Chance a note cell rests instead, drawn from the part's stream. */
  skipChance: number;
  /** The bump an accented cell adds to the part's velocity. */
  accentVelocity: number;
  /** The per-note mod an accented cell sends; a plain cell sends 0. */
  accentMod: number;
  /** Step modulation lanes, one value per cell, as the Grid's. */
  lanes: readonly StepModLane[];
  /** The part's own seed; the stream per region is `hashSeed(seed, regionIndex)`. */
  seed: number;
  /** The length schedule, cycling; absent (or empty) plays every cell of `length`. */
  schedule?: readonly FigureStage[];
  /** The rotation drift; absent is none. */
  drift?: FigureDrift;
  /** The canon source; absent plays the part's own cells. */
  source?: FigureSource;
}

/** Finds the live Figure on a slot, which a canon reads at each onset; null when the slot holds none. */
export type FigureResolver = (slot: number) => FigureSequencer | null;

const NO_FIGURE: FigureResolver = () => null;

/** The optional keys, which a live edit may add to a Figure that lacks them. */
export const FIGURE_OPTIONAL_KEYS = ['schedule', 'drift', 'source'] as const;

/** A plain note cell: the root at the register octave, full velocity. */
export function figureNoteCell(
  tone = 0,
  over: Partial<Omit<FigureNoteCell, 'kind'>> = {},
): FigureNoteCell {
  return { kind: 'note', tone, octave: 0, accent: false, slide: false, ...over };
}

/** The Glass broken chord the default line cycles: root, third, fifth, third. */
const DEFAULT_TONES: readonly number[] = [0, 1, 2, 1];

/** One bar of sixteenths in the song's meter (16 in 4/4, 14 in 7/8, 24 in 12/8), tones 0, 1, 2, 1. */
export function defaultFigureCells(meter?: Meter): FigureCell[] {
  return Array.from({ length: defaultStepCount(meter, DIVISORS.sixteenth) }, (_, i) =>
    figureNoteCell(DEFAULT_TONES[i % DEFAULT_TONES.length] ?? 0),
  );
}

export const DEFAULT_FIGURE_CONFIG: FigureSequencerConfig = {
  divisor: DIVISORS.sixteenth,
  cells: defaultFigureCells(),
  length: GRID_DEFAULT_STEP_COUNT,
  gate: ARP_GATE_DEFAULT,
  register: { octave: ARP_REGISTER_OCTAVE_DEFAULT },
  skipChance: 0,
  accentVelocity: ACCENT_VELOCITY_DEFAULT,
  accentMod: ACCENT_MOD_DEFAULT,
  lanes: [],
  seed: 0,
};

const isIntIn = (value: number, min: number, max: number): boolean =>
  Number.isInteger(value) && value >= min && value <= max;

const isUnit = (value: number): boolean => value >= 0 && value <= 1;

function assertCell(cell: FigureCell, index: number): void {
  if (cell.kind !== 'note') return;
  const at = `cells[${index}]`;
  if (!isIntIn(cell.tone, -FIGURE_TONE_MAX, FIGURE_TONE_MAX)) {
    throw new RangeError(`${at}.tone must be an integer within ±${FIGURE_TONE_MAX}`);
  }
  if (!isIntIn(cell.octave, -GRID_STEP_OCTAVE_MAX, GRID_STEP_OCTAVE_MAX)) {
    throw new RangeError(`${at}.octave must be an integer within ±${GRID_STEP_OCTAVE_MAX}`);
  }
  if (cell.velocity !== undefined && !isUnit(cell.velocity)) {
    throw new RangeError(`${at}.velocity must be in [0, 1], got ${cell.velocity}`);
  }
  assertRatchet(cell.ratchet, at);
}

/** The schedule, drift and source, each when present. */
function assertProcesses(config: FigureSequencerConfig): void {
  const cells = config.cells.length;
  config.schedule?.forEach((stage, i) => {
    if (!isIntIn(stage.length, 1, cells) || !isIntIn(stage.bars, 1, FIGURE_SCHEDULE_BARS_MAX)) {
      throw new RangeError(
        `schedule[${i}] must be a length 1..${cells} for 1..${FIGURE_SCHEDULE_BARS_MAX} bars`,
      );
    }
  });
  const { drift, source } = config;
  if (
    drift &&
    !(
      isIntIn(drift.steps, -FIGURE_DRIFT_STEPS_MAX, FIGURE_DRIFT_STEPS_MAX) &&
      isIntIn(drift.everyBars, 1, FIGURE_SCHEDULE_BARS_MAX)
    )
  ) {
    throw new RangeError(
      `drift must be ±${FIGURE_DRIFT_STEPS_MAX} steps every 1..${FIGURE_SCHEDULE_BARS_MAX} bars`,
    );
  }
  if (
    source &&
    !(
      isIntIn(source.slot, 0, MUSIC_SLOT_MAX) &&
      isIntIn(source.offset, -GRID_STEPS_MAX, GRID_STEPS_MAX) &&
      isIntIn(source.transpose, -FIGURE_TRANSPOSE_MAX, FIGURE_TRANSPOSE_MAX)
    )
  ) {
    throw new RangeError(
      `source must be a slot 0..${MUSIC_SLOT_MAX}, an offset within ±${GRID_STEPS_MAX} and a transpose within ±${FIGURE_TRANSPOSE_MAX}`,
    );
  }
}

/** Every constructor and `reconfigure` check; the player runs it inside `plan`. */
export function assertFigureConfig(config: FigureSequencerConfig): void {
  if (!isNoteDivisor(config.divisor)) {
    throw new RangeError(`divisor must divide the bar, got ${config.divisor}`);
  }
  const cells = config.cells.length;
  if (cells < 1 || cells > GRID_STEPS_MAX) {
    throw new RangeError(`cells must hold 1..${GRID_STEPS_MAX} entries, got ${cells}`);
  }
  config.cells.forEach(assertCell);
  if (!isIntIn(config.length, 1, cells)) {
    throw new RangeError(`length must be 1..${cells}, got ${config.length}`);
  }
  if (!(config.gate > 0 && config.gate <= 1)) {
    throw new RangeError(`gate must be in (0, 1], got ${config.gate}`);
  }
  const { octave } = config.register;
  if (!isIntIn(octave, REGISTER_OCTAVE_MIN, REGISTER_OCTAVE_MAX)) {
    throw new RangeError(`register.octave must be ${REGISTER_OCTAVE_MIN}..${REGISTER_OCTAVE_MAX}`);
  }
  for (const key of ['skipChance', 'accentVelocity', 'accentMod'] as const) {
    if (!isUnit(config[key])) throw new RangeError(`${key} must be in [0, 1], got ${config[key]}`);
  }
  if (!Number.isSafeInteger(config.seed)) throw new RangeError('seed must be a safe integer');
  assertStepModLanes(config.lanes);
  assertProcesses(config);
}

/** What a Figure voices its cells with: the key's root note at a register. */
export type FigurePitchSource = Pick<ScaleSampler, 'rootNote'>;

/** A rest, a Figure cell and an Arp cell alike: what a skipped, silent or dropped note plays. */
const REST = { kind: 'rest' } as const;

/**
 * The MIDI note `cell` names over `chord`, `transpose` semitones away (a
 * canon's), or null outside 0–`MIDI_NOTE_MAX` (dropped, not clamped).
 */
export function figureCellNote(
  cell: FigureNoteCell,
  chord: HarmonyChord,
  rootNote: number,
  transpose = 0,
): number | null {
  const tone = figureNote(chord.stack, cell.tone, rootNote);
  if (tone === null) return null;
  const note = tone + SEMITONES_PER_OCTAVE * cell.octave + transpose;
  return note >= 0 && note <= MIDI_NOTE_MAX ? note : null;
}

/** Whether a note held into `cell` runs on to its onset: a tie or a slide. */
const holdsInto = (cell: FigureCell | undefined): boolean =>
  cell?.kind === 'tie' || (cell?.kind === 'note' && cell.slide);

/** The cell a step reads, and its index in the line it comes from: the part's own, or its leader's. */
interface ReadCell {
  readonly index: number;
  readonly cell: FigureCell;
}

/** What a canon whose source slot holds no Figure reads: a rest, at no position. */
const NO_CELL: ReadCell = { index: -1, cell: REST };

/** A cell's velocity onto the note-on it struck, when it is not the full 1. */
function markVelocity(outcome: ArpCellOutcome, velocity: number | undefined): void {
  if (velocity === undefined || velocity === 1) return;
  const on = outcome.events.find((e): e is NoteOnEvent => e.kind === 'noteOn');
  if (on) on.velocity = velocity;
}

export class FigureSequencer {
  onNote: NoteHandler | null = null;

  private current: FigureSequencerConfig;
  private pitch: FigurePitchSource;
  private rng: Rng;
  /** The note sounding into the next onset, if any. */
  private held: number | null = null;
  /** The local tick a gated note's off goes out on; null while it runs to the next onset. */
  private releaseTick: number | null = null;
  /** Where the schedule and the drift put the line. */
  private readonly line: FigureLine;
  /** The song meter's bar in ticks: handed at build, pushed again on a live meter change. */
  private barTicks: number;
  /** The last local tick heard since the entry; null before the first. Its bar is read in the current meter. */
  private heardTick: number | null = null;

  /** Where a canon finds its leader, by slot, at every onset. */
  private readonly figureOf: FigureResolver;

  constructor(
    pitch: FigurePitchSource,
    config: FigureSequencerConfig,
    barTicks = TICKS_PER_BAR,
    figureOf: FigureResolver = NO_FIGURE,
  ) {
    assertFigureConfig(config);
    this.pitch = pitch;
    this.current = config;
    this.rng = streamRng(config.seed, 0);
    this.line = new FigureLine(config);
    this.barTicks = barTicks;
    this.figureOf = figureOf;
  }

  get config(): FigureSequencerConfig {
    return this.current;
  }

  get heldNote(): number | null {
    return this.held;
  }

  /** The region gate entered `regionIndex` from outside: the skip stream and both counters restart. */
  enter(regionIndex: number): void {
    this.rng = streamRng(this.current.seed, regionIndex);
    this.line.restart(this.current);
    this.heardTick = null;
  }

  /**
   * Take every field but the divisor and the seed live, and optionally a new
   * key: the held note plays on and the stream carries on. A schedule or
   * drift edit takes effect at the next bar line, its counters carried on. A
   * divisor or seed change rebuilds the part, as the Grid's does.
   */
  reconfigure(config: FigureSequencerConfig, pitch: FigurePitchSource = this.pitch): void {
    assertFigureConfig(config);
    if (config.divisor !== this.current.divisor || config.seed !== this.current.seed) {
      throw new RangeError('a divisor or seed change rebuilds the sequencer, not a live edit');
    }
    this.current = config;
    this.pitch = pitch;
    const nextBar = this.heardTick === null ? 0 : Math.floor(this.heardTick / this.barTicks) + 1;
    this.line.edit(config, nextBar);
  }

  /** The song's meter changed live: the stage and the rotation count bars of `barTicks` from now. */
  setBarTicks(barTicks: number): void {
    this.barTicks = barTicks;
  }

  /** The cell a local step (since the region entry) sounds, after the stage and the rotation; a canon's is its leader's. */
  stepAt(localStep: number): number {
    return this.read(localStep).index;
  }

  /**
   * The written cell of this part's own line a local step resolves to,
   * which a canon of this part reads (windsor#487). A negative step, a
   * canon's before its offset is used up, reads the line the entry plays,
   * cyclically: no stage or rotation runs before the entry.
   */
  cellAt(localStep: number): number {
    return this.lineCell(localStep, Math.max(0, this.barOf(localStep)));
  }

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(1, (event) => this.handleTick(event));
  }

  /** One local tick: the gate's release when due, then the cell on an onset. A chordless tick releases nothing. */
  handleTick(event: PartTickEvent): NoteEvent[] {
    const { divisor } = this.current;
    this.heardTick = event.tick;
    const due = this.releaseTick !== null && event.tick >= this.releaseTick;
    const gateEnded = due && event.chord !== null;
    const events = gateEnded ? this.releaseHeld(event.tick, event.time) : [];
    if (event.tick % divisor === 0) events.push(...this.onset(event, event.tick / divisor));
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** Release the held note at the given tick: a transport stop or a region end. */
  release(tick: number, time: number): NoteEvent[] {
    const events = this.releaseHeld(tick, time);
    for (const e of events) this.onNote?.(e);
    return events;
  }

  private onset(event: PartTickEvent, step: number): NoteEvent[] {
    const { skipChance } = this.current;
    const { index, cell: written } = this.read(step, event.bar);
    // One draw per note cell, whatever it plays, so neither a rest nor the chord moves the stream.
    const skipped = written.kind === 'note' && skipChance > 0 && this.rng() < skipChance;
    const { chord } = event;
    if (!chord) return [];
    const { cell, pitch } = this.played(written, skipped, chord);
    const outcome = playArpCell(
      {
        tick: event.tick,
        time: event.time,
        degree: chord.event.degree,
        cell,
        index,
        pitch,
        held: this.held,
        holdsOn: holdsInto(this.read(step + 1).cell),
      },
      this.current,
    );
    // A tie holds the voice to the next non-tie onset, as the Grid's does, whatever the gate.
    if (cell.kind === 'tie') return this.settle({ ...outcome, releaseTick: null });
    if (cell.kind !== 'note' || written.kind !== 'note') return this.settle(outcome);
    markVelocity(outcome, written.velocity);
    const hits = cell.ratchet ?? 1;
    return this.settle(hits > 1 ? rollOutcome(outcome, hits, this.current, event) : outcome);
  }

  /** The cell as it plays: a note at its pitch over `chord`, or a rest when skipped, silent or dropped. */
  private played(
    written: FigureCell,
    skipped: boolean,
    chord: HarmonyChord,
  ): { cell: ArpStep; pitch: number } {
    if (written.kind !== 'note') return { cell: written, pitch: 0 };
    const { register, source } = this.current;
    const root = this.pitch.rootNote(register.octave);
    const note =
      skipped || written.velocity === 0
        ? null
        : figureCellNote(written, chord, root, source?.transpose);
    // The pitch carries the cell's octave already, so the Arp's rule shifts it by none.
    return note === null
      ? { cell: REST, pitch: 0 }
      : { cell: { ...written, octave: 0 }, pitch: note };
  }

  /**
   * The cell local `step`, in local `bar`, reads: the part's own line's, or
   * with a source its leader's at `step − offset`, the leader looked up now.
   */
  private read(step: number, bar = this.barOf(step)): ReadCell {
    const { source, cells } = this.current;
    if (!source) {
      const index = this.lineCell(step, bar);
      return { index, cell: cells[index] ?? REST };
    }
    const leader = this.figureOf(source.slot);
    if (!leader) return NO_CELL;
    const index = leader.cellAt(step - source.offset);
    return { index, cell: leader.config.cells[index] ?? REST };
  }

  /** The local bar a local step's onset falls in, in the song's meter. */
  private barOf(step: number): number {
    return Math.floor((step * this.current.divisor) / this.barTicks);
  }

  /** The cell of the part's own line local `step` in local `bar` sounds. */
  private lineCell(step: number, bar: number): number {
    const { cells, length, divisor } = this.current;
    return this.line.cellAt(step, bar, {
      cells: cells.length,
      length,
      divisor,
      barTicks: this.barTicks,
    });
  }

  /** Keep what an onset leaves sounding, and hand back what it emitted. */
  private settle(outcome: ArpCellOutcome): NoteEvent[] {
    this.held = outcome.held;
    this.releaseTick = outcome.releaseTick;
    return outcome.events;
  }

  private releaseHeld(tick: number, time: number): NoteEvent[] {
    this.releaseTick = null;
    if (this.held === null) return [];
    const off: NoteEvent = { kind: 'noteOff', tick, time, note: this.held };
    this.held = null;
    return [off];
  }
}
