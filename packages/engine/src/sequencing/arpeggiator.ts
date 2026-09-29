/**
 * The Arpeggiator (#706, epic #703 decisions 12, 13, 16): one note per step
 * of the part's divisor, drawn from the active chord's tones.
 *
 * **The list.** At each onset the chord the region gate hands over is voiced
 * once by `voiceChord` — the Chord Player's own path, the same voicing enum,
 * at the part's register, with the six-note cap lifted — then duplicated up
 * `octaves − 1` octaves, and the result kept ascending without duplicates and
 * clipped to MIDI once, after the expansion. That ordered list `n[0..L−1]` is what the style walks. It is
 * rebuilt at an onset only, so a held note is never retuned (epic decision 2).
 *
 * **The walk** (the issue's decisions 1–4), over the traversal index `i` —
 * the part's local step minus the step the traversal last restarted on:
 * `up` / `down` cycle; `upDown` / `downUp` bounce without repeating the ends
 * (for L ≤ 2 they are `up` / `down`); `converge` is outside-in, `diverge` its
 * reverse; `conDiverge` is the `upDown` bounce run through converge's order,
 * outside-in then back out, the centre and the edge not repeated (for L ≤ 2
 * it is `converge`, windsor#121); `random` is a uniform draw, `randomOther` a
 * uniform draw over the notes other than the previous one, `randomOnce` one
 * shuffle repeated until the list changes or a retrigger.
 *
 * **Restarts.** Region entry (`enter`) restarts the walk and mints the stream
 * from `hashSeed(seed, regionIndex)`; a chord change restarts the walk only
 * with `retrigger` on, and never the stream (decisions 5, 6). With it off the
 * index carries on modulo the new list's length.
 *
 * **The step grid** (windsor#129, epic windsor#126): each onset is shaped by
 * cell `(step − base) mod arpCycleLength(style, L)`, the traversal index over
 * the current list's cycle, so the cell restarts wherever the walk does and
 * with `retrigger` off carries on modulo the new cycle. What a cell does —
 * octave, accent, slide, tie, rest, the lanes, the gate's look-ahead and
 * skip chance — is `arpCellPlay.ts`. The walk advances and a random style
 * draws at every onset whatever its cell plays, so a rest, a tie or a skip
 * never moves the pitches of the cells after it; skip chance draws from its
 * own stream, minted beside the walk's at region entry.
 *
 * **The gate's look-ahead across a chord change.** The gate is decided at
 * the onset, and it reads the next cell in the current list's cycle
 * (`holdsToNext(steps, i, cycle)`). The arp can't see the chord at its next
 * onset: the region gate hands it the chord at the current tick only. So
 * when the next onset changes the chord, the look-ahead can name a cell
 * other than the one that onset plays. With `retrigger` on, that onset plays
 * cell 0. With it off, it plays the next index modulo the new cycle. Nothing
 * is held into it unless the old cycle's next cell was a tie or a slide.
 * The other way round, a tie or slide in the old cycle holds the note to
 * the change, and the cell played there releases it or carries it on as its
 * own kind says. At a boundary that falls on the cycle's end, the two cells
 * are the same.
 *
 * **Cell 0 at a retrigger reset** (decided by tacowars, windsor#129). When a
 * chord change with `retrigger` on restarts the walk at cell 0, and cell 0
 * is a tie or a slide, it plays as a plain note: the walked pitch with the
 * cell's octave shift, its accent and its lanes, but no tie and no slide
 * (`strikeCell`). So every chord change starts on a sounding note, whatever
 * was held into it. This applies only at a retrigger reset: a tie or slide
 * on cell 0 when the cycle wraps with no chord change plays as written, and
 * with `retrigger` off a tie or slide at the change plays as written too
 * (with nothing held, a tie plays nothing and a slide a plain note, epic
 * decision 4).
 *
 * **Rhythm.** Every step is an onset while a chord is active — density is
 * the bass's, not the arp's. A note lasts `gate` of the last step it covers;
 * at gate 1 it runs to the next onset, which releases and restrikes it. A
 * new arp's cells are all plain notes, so it plays exactly as it did before
 * the grid.
 *
 * Pure: it reads the chord and local tick the gate forwards, never the
 * transport, and emits note events on the tick grid.
 */
import { MIDI_NOTE_MAX } from '../audioConstants';
import { chordTones } from '../harmony/chordTheory';
import { voiceChord } from '../harmony/chordVoicing';
import type { HarmonyChord } from '../harmony/harmonyTimeline';
import {
  arpCellIndex,
  arpSkipRng,
  holdsToNext,
  playArpCell,
  shiftOctave,
  skipCell,
  strikeCell,
} from './arpCellPlay';
import { assertArpConfig, type ArpSequencerConfig, type ArpStyle } from './arpSequencer';
import { arpCycleLength, arpNote } from './arpSteps';
import { streamRng, type Rng } from './generatorSeed';
import type { NoteEvent, NoteHandler } from './noteEvent';
import type { PartTickEvent, PartTickSource } from './regionGate';
import { SEMITONES_PER_OCTAVE, type ScaleSampler } from './scaleSampler';
import type { Unsubscribe } from './scheduler';

/** What the arp voices a chord with: the key's offsets and its root note at a register. */
export type ArpPitchSource = Pick<ScaleSampler, 'offsets' | 'rootNote'>;

/**
 * The ordered note list for `chord`: voiced once at the part's register with
 * the part's voicing (no inversion, no step octave — those are the Chord
 * Player's), the cap lifted, duplicated up, ascending and unique.
 */
export function arpNoteList(
  pitch: ArpPitchSource,
  config: Pick<ArpSequencerConfig, 'voicing' | 'octaves' | 'register'>,
  chord: HarmonyChord,
): number[] {
  const stack = chordTones(pitch.offsets, chord.event.degree, chord.event.size);
  // Voice unclipped at the real register — a folded degree carries octaves
  // and a downward voicing reaches below the root, so no single lift keeps the
  // stack in range — expand, then clip 0–127 once at the end (#714 review).
  const voiced = voiceChord(
    stack,
    {
      inversion: 0,
      voicing: config.voicing,
      octave: 0,
      maxNotes: Number.POSITIVE_INFINITY,
      clip: false,
    },
    pitch.rootNote(config.register.octave),
  );
  const notes: number[] = [];
  for (let k = 0; k < config.octaves; k++) {
    for (const note of voiced) notes.push(note + k * SEMITONES_PER_OCTAVE);
  }
  const inMidi = notes.filter((n) => n >= 0 && n <= MIDI_NOTE_MAX);
  return [...new Set(inMidi)].sort((a, b) => a - b);
}

/** Position `k` of one converge cycle over `length`: 0, L−1, 1, L−2, … */
const convergeAt = (k: number, length: number): number =>
  k % 2 === 0 ? k / 2 : length - 1 - (k - 1) / 2;

/** Position `i` of the up-then-down bounce over `length` > 2, the ends not repeated. */
function bounceAt(i: number, length: number): number {
  const period = 2 * length - 2;
  const pos = i % period;
  return pos < length ? pos : period - pos;
}

/** The styles that draw nothing: the list index at traversal index `i`. */
export type OrderedArpStyle = Exclude<ArpStyle, 'random' | 'randomOther' | 'randomOnce'>;

/** The list index an ordered style plays at traversal index `i` ≥ 0 over a list of `length` ≥ 1. */
export function orderedIndex(style: OrderedArpStyle, i: number, length: number): number {
  const cycle = i % length;
  const last = length - 1;
  switch (style) {
    case 'up':
      return cycle;
    case 'down':
      return last - cycle;
    case 'upDown':
      return length <= 2 ? cycle : bounceAt(i, length);
    case 'downUp':
      return length <= 2 ? last - cycle : last - bounceAt(i, length);
    case 'converge':
      return convergeAt(cycle, length);
    case 'diverge':
      return convergeAt(last - cycle, length);
    case 'conDiverge':
      return length <= 2 ? convergeAt(cycle, length) : convergeAt(bounceAt(i, length), length);
  }
}

/**
 * The pitch cell `k` of the cycle plays over `list`, its `octave` shift
 * applied (`shiftOctave`), when the walk alone decides it: an ordered style,
 * whose traversal repeats with the cycle, or any style over a one-note list.
 * Null for a random style over more notes, whose pitch the run draws. The
 * Arp card reads it to tell a slide onto a new pitch from one onto the
 * pitch already held (windsor#137).
 */
export function arpCellPitch(
  style: ArpStyle,
  k: number,
  list: readonly number[],
  octave: number,
): number | null {
  if (list.length === 0) return null;
  const ordered = style !== 'random' && style !== 'randomOther' && style !== 'randomOnce';
  if (!ordered && list.length > 1) return null;
  const at = ordered ? orderedIndex(style, k, list.length) : 0;
  return shiftOctave(list[at] as number, octave);
}

/** A Fisher–Yates shuffle of `0..length−1` from the stream: `length − 1` draws. */
export function shuffledIndices(length: number, rng: Rng): number[] {
  const order = Array.from({ length }, (_, k) => k);
  for (let k = length - 1; k > 0; k--) {
    const j = Math.floor(rng() * (k + 1));
    [order[k], order[j]] = [order[j] as number, order[k] as number];
  }
  return order;
}

/** A uniform draw over the list, skipping the index holding `previous` when it is there. */
export function otherIndex(list: readonly number[], previous: number | null, rng: Rng): number {
  const skip = previous === null ? -1 : list.indexOf(previous);
  if (skip < 0) return Math.floor(rng() * list.length);
  if (list.length === 1) return 0;
  const draw = Math.floor(rng() * (list.length - 1));
  return draw >= skip ? draw + 1 : draw;
}

const PLAIN_CELL = arpNote();

/** What identifies "the chord changed" for a retrigger: its degree and size, not its event. */
const chordKey = (chord: HarmonyChord): string => `${chord.event.degree}:${chord.event.size}`;

export class Arpeggiator {
  onNote: NoteHandler | null = null;

  private current: ArpSequencerConfig;
  private pitch: ArpPitchSource;
  private rng: Rng;
  /** The local step the traversal index counts from: 0 at entry, the chord change's step on a retrigger. */
  private base = 0;
  /** The chord and list of the last onset; null since entry. */
  private lastChord: string | null = null;
  private lastList: string | null = null;
  /** `randomOnce`'s order, drawn at the first onset over a list and kept until it changes. */
  private shuffle: number[] | null = null;
  /** The last note played since entry, which `randomOther` steps away from. */
  private previous: number | null = null;
  private held: number | null = null;
  /** The local tick a gated note's off goes out on; null while it runs to the next onset. */
  private releaseTick: number | null = null;
  /** Skip chance's own stream (`arpSkipRng`), minted with the walk's and never drawn by it. */
  private skipRng: Rng;
  /** The length of the list the last onset walked: 0 since entry, with no chord, or over an empty list. */
  private listLength = 0;

  constructor(pitch: ArpPitchSource, config: ArpSequencerConfig) {
    assertArpConfig(config);
    this.pitch = pitch;
    this.current = config;
    this.rng = streamRng(config.seed, 0);
    this.skipRng = arpSkipRng(config.seed, 0);
  }

  get config(): ArpSequencerConfig {
    return this.current;
  }

  get heldNote(): number | null {
    return this.held;
  }

  /**
   * Take a new style, gate, octaves, voicing, retrigger or register, and
   * optionally a new key, live: the held note plays on to its own end, and
   * the list is rebuilt at the next onset. Divisor and seed rebuild the part.
   */
  reconfigure(config: ArpSequencerConfig, pitch: ArpPitchSource = this.pitch): void {
    assertArpConfig(config);
    this.current = config;
    this.pitch = pitch;
  }

  /** The region gate entered a region: the walk restarts and the stream is minted afresh. */
  enter(regionIndex: number): void {
    this.rng = streamRng(this.current.seed, regionIndex);
    this.skipRng = arpSkipRng(this.current.seed, regionIndex);
    this.base = 0;
    this.listLength = 0;
    this.lastChord = null;
    this.lastList = null;
    this.shuffle = null;
    this.previous = null;
  }

  /**
   * The cell a local step plays over the current list's cycle — the card's
   * playhead — or −1 while no chord is active or the list is empty.
   */
  stepAt(localStep: number): number {
    if (this.listLength === 0) return -1;
    return arpCellIndex(localStep - this.base, arpCycleLength(this.current.style, this.listLength));
  }

  /**
   * The cell local step `localStep` lands on counted from an entry into
   * `chord`, with no onset needed: the walk restarts at entry, so it is the
   * step itself over the cycle of the list `chord` voices now. A region
   * that isn't sounding shows this as its ghost (windsor#137), since
   * `stepAt` reads the last onset's list, which another region or an
   * earlier visit left, or none before the first. −1 with no chord or an
   * empty list.
   */
  entryStepAt(localStep: number, chord: HarmonyChord | null): number {
    if (!chord) return -1;
    const length = arpNoteList(this.pitch, this.current, chord).length;
    if (length === 0) return -1;
    return arpCellIndex(localStep, arpCycleLength(this.current.style, length));
  }

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(1, (event) => this.handleTick(event));
  }

  /** One local tick. Returns the events it emitted; most ticks emit none. */
  handleTick(event: PartTickEvent): NoteEvent[] {
    const { divisor } = this.current;
    const gateEnded = this.releaseTick !== null && event.tick >= this.releaseTick;
    const events = gateEnded ? this.releaseHeld(event.tick, event.time) : [];
    if (event.tick % divisor === 0) events.push(...this.onset(event, event.tick / divisor));
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** Release the held note at the given tick — what a transport stop or a region end calls. */
  release(tick: number, time: number): NoteEvent[] {
    const events = this.releaseHeld(tick, time);
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** One onset: walk the list, then play the cell for this step over what is held. */
  private onset(event: PartTickEvent, step: number): NoteEvent[] {
    const { chord } = event;
    const list = chord ? arpNoteList(this.pitch, this.current, chord) : [];
    // Track before the empty-pool return: a chord clipped to nothing is still a chord change (#714 review).
    const reset = chord ? this.track(step, chord, list) : false;
    this.listLength = list.length;
    if (!chord || list.length === 0) return this.releaseHeld(event.tick, event.time);
    const i = step - this.base;
    // The walk draws whatever the cell plays, so a rest never moves a later pitch.
    const pitch = list[this.pick(i, list)] as number;
    this.previous = pitch;
    const { steps, skipChance } = this.current;
    const cycle = arpCycleLength(this.current.style, list.length);
    const index = arpCellIndex(i, cycle);
    // Every cycle fits the stored cells (`ARP_STEPS_MAX`); a plain note stands in for safety.
    const written = steps[index] ?? PLAIN_CELL;
    const played = skipCell(written, skipChance, this.skipRng);
    const outcome = playArpCell(
      {
        tick: event.tick,
        time: event.time,
        degree: chord.event.degree,
        // A retrigger reset starts on a sounding note: a tie or slide on cell 0 strikes plain.
        cell: reset ? strikeCell(played) : played,
        index,
        pitch,
        held: this.held,
        holdsOn: holdsToNext(steps, i, cycle),
      },
      this.current,
    );
    this.held = outcome.held;
    this.releaseTick = outcome.releaseTick;
    return outcome.events;
  }

  /**
   * Apply decision 5: a chord change retriggers when asked; a new list or a
   * retrigger reshuffles. Returns whether this onset reset the walk.
   */
  private track(step: number, chord: HarmonyChord, list: readonly number[]): boolean {
    const key = chordKey(chord);
    const listKey = list.join(',');
    const reset = this.lastChord !== null && key !== this.lastChord && this.current.retrigger;
    if (reset) {
      this.base = step;
      this.shuffle = null;
    }
    if (listKey !== this.lastList) this.shuffle = null;
    this.lastChord = key;
    this.lastList = listKey;
    return reset;
  }

  private pick(i: number, list: readonly number[]): number {
    const { style } = this.current;
    switch (style) {
      case 'random':
        return Math.floor(this.rng() * list.length);
      case 'randomOther':
        return otherIndex(list, this.previous, this.rng);
      case 'randomOnce':
        this.shuffle ??= shuffledIndices(list.length, this.rng);
        return this.shuffle[i % list.length] as number;
      default:
        return orderedIndex(style, i, list.length);
    }
  }

  private releaseHeld(tick: number, time: number): NoteEvent[] {
    const note = this.held;
    this.held = null;
    this.releaseTick = null;
    return note === null ? [] : [{ kind: 'noteOff', tick, time, note }];
  }
}
