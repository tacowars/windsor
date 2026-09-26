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
 * reverse; `random` is a uniform draw, `randomOther` a uniform draw over the
 * notes other than the previous one, `randomOnce` one shuffle repeated until
 * the list changes or a retrigger.
 *
 * **Restarts.** Region entry (`enter`) restarts the walk and mints the stream
 * from `hashSeed(seed, regionIndex)`; a chord change restarts the walk only
 * with `retrigger` on, and never the stream (decisions 5, 6). With it off the
 * index carries on modulo the new list's length.
 *
 * **Rhythm.** Every step sounds while a chord is active — density is the
 * bass's, not the arp's — and a note lasts `gate` of its step; at gate 1 it
 * runs to the next onset, which releases and restrikes it (no tie rule).
 *
 * Pure: it reads the chord and local tick the gate forwards, never the
 * transport, and emits note events on the tick grid.
 */
import { MIDI_NOTE_MAX } from '../audioConstants';
import { chordTones } from '../harmony/chordTheory';
import { voiceChord } from '../harmony/chordVoicing';
import type { HarmonyChord } from '../harmony/harmonyTimeline';
import { assertArpConfig, type ArpSequencerConfig, type ArpStyle } from './arpSequencer';
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
  }
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

  constructor(pitch: ArpPitchSource, config: ArpSequencerConfig) {
    assertArpConfig(config);
    this.pitch = pitch;
    this.current = config;
    this.rng = streamRng(config.seed, 0);
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
    this.base = 0;
    this.lastChord = null;
    this.lastList = null;
    this.shuffle = null;
    this.previous = null;
  }

  /** No playhead: the card draws no strip (the issue's decision 7). */
  stepAt(_localStep: number): number {
    return -1;
  }

  attach(source: PartTickSource): Unsubscribe {
    return source.subscribe(1, (event) => this.handleTick(event));
  }

  /** One local tick. Returns the events it emitted; most ticks emit none. */
  handleTick(event: PartTickEvent): NoteEvent[] {
    const { divisor } = this.current;
    const onsetTick = event.tick % divisor === 0;
    const gateEnded = this.releaseTick !== null && event.tick >= this.releaseTick;
    const events = onsetTick || gateEnded ? this.releaseHeld(event.tick, event.time) : [];
    if (onsetTick && event.chord) {
      const on = this.onset(event, event.tick / divisor, event.chord);
      if (on) events.push(on);
    }
    for (const e of events) this.onNote?.(e);
    return events;
  }

  /** Release the held note at the given tick — what a transport stop or a region end calls. */
  release(tick: number, time: number): NoteEvent[] {
    const events = this.releaseHeld(tick, time);
    for (const e of events) this.onNote?.(e);
    return events;
  }

  private onset(event: PartTickEvent, step: number, chord: HarmonyChord): NoteEvent | null {
    const list = arpNoteList(this.pitch, this.current, chord);
    if (list.length === 0) return null;
    this.track(step, chord, list);
    const note = list[this.pick(step - this.base, list)] as number;
    const gateTicks = Math.max(1, Math.round(this.current.gate * this.current.divisor));
    this.held = note;
    this.previous = note;
    this.releaseTick = gateTicks >= this.current.divisor ? null : event.tick + gateTicks;
    return { kind: 'noteOn', tick: event.tick, time: event.time, note, degree: chord.event.degree };
  }

  /** Apply decision 5: a chord change retriggers when asked; a new list or a retrigger reshuffles. */
  private track(step: number, chord: HarmonyChord, list: readonly number[]): void {
    const key = chordKey(chord);
    const listKey = list.join(',');
    if (this.lastChord !== null && key !== this.lastChord && this.current.retrigger) {
      this.base = step;
      this.shuffle = null;
    }
    if (listKey !== this.lastList) this.shuffle = null;
    this.lastChord = key;
    this.lastList = listKey;
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
