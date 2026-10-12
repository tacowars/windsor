/**
 * Bounce to Roll's capture (windsor#740, record `2026-10-11-bounce-to-roll`
 * decision 3, and the issue's decision 2): one region of a part played from
 * its start, offline, through the very wiring the player uses, and every
 * note the part was asked to play written down.
 *
 * A `TickTransport` takes the song's tempo, meter and swing
 * (`setSongClock`) but no loop, since a region is rendered whole, and is
 * started on the region's first tick. The part's `PartBinding` sits on it
 * as the player builds one: its generators, its region gate (whose entry
 * mints the stream from `hashSeed(seed, regionIndex)`), the sequencer lanes
 * its `automation` holds (`partGateConfig`) and the harmony. A canon's
 * leader is any Figure part, so every Figure part is bound beside it and
 * resolved as the player resolves it. What the binding emits is mapped
 * onto the part as `ArrangementPlayer` maps it, through the same pure
 * functions (`euclidNoteOn`, `rollHits`, `playPitched`), with the swing's
 * phase read from the transport tick, so a region off the swing grid is
 * swung where the player swings it.
 *
 * The tick on the region's end is issued too, for its leave alone: the
 * releases it sends are the region's, and anything it starts belongs to
 * whatever follows. An ∞ region has no leave, and what it holds stays open.
 *
 * Each note also records what the Roll needs to play it back marked
 * (windsor#755): its accent's bump and mod and its level without them, and,
 * for a hit of a roll of two or more, which roll it belongs to.
 */
import type { Arrangement, MusicPart, PartRegion } from './arrangement';
import { PartBinding, type PartOutput } from './partBinding';
import { partGateConfig } from './partGateConfig';
import { euclidNoteOn, partNoteOn, type NoteOnMarks } from './partNoteOn';
import { PLAIN_HIT, pitchedRollShape, playPitched, type RollTarget } from './pitchedRoll';
import { rollHits, type RollHit, type RollShape } from './rollSpan';
import { setSongClock, songTicksOf, withClockFields } from './songClock';
import { BOUNCE_TICK_EPSILON } from './bounceRenderTables';
import type { PlayedNote } from './bounceRenderTypes';
import { euclidHitRead } from '../sequencing/euclidLanes';
import { meterBeats } from '../sequencing/meter';
import type { MeterBeats } from '../sequencing/meterTables';
import { ScaleSampler } from '../sequencing/scaleSampler';
import { TickTransport } from '../sequencing/scheduler';
import type { Swing } from '../sequencing/swingTables';
import type { NoteExtras } from '../synth/audioPart';

/** The clock's warp, both ways: what turns a played time back into a tick. */
export interface WarpClock {
  /** Where tick position `tick` sounds, in straight ticks from 0. */
  swungTicks(tick: number): number;
  /** The tick position that sounds at `warped` straight ticks. */
  unswungTicks(warped: number): number;
}

/** What a Roll note's ratchet is spaced by, as the player spaces it (`rollHits`). */
export interface RatchetClock {
  readonly secondsPerTick: number;
  readonly swing: Swing;
  readonly beats: MeterBeats;
}

export interface RegionCapture {
  /** Every note the part was asked to play, in the order it was asked. */
  readonly notes: readonly PlayedNote[];
  /** The swing the region was played under, at the transport's phase. */
  readonly clock: WarpClock;
  /** The tempo, swing and meter the region was played under, for a ratchet's spacing. */
  readonly ratchetClock: RatchetClock;
}

/** What every hit of one note-on shares beyond its call: see `PlayedNote`. */
interface HitMark {
  readonly own: number;
  readonly plain: number;
  readonly accent: PlayedNote['accent'];
  readonly roll: number | null;
}

/** One `noteOn` (no duration) or `trigger` the part was asked for, with its note-on's marks. */
interface PartCall {
  readonly pitch: number;
  readonly velocity: number;
  readonly mark: HitMark;
  readonly time: number;
  readonly extras: NoteExtras | undefined;
  readonly duration?: number;
}

/** The part's calls, written down as played notes in straight ticks. */
class PlayLog {
  readonly notes: PlayedNote[] = [];
  /** Set for the tick on the region's end: only its releases are the region's. */
  closing = false;
  private readonly held = new Map<number, PlayedNote[]>();
  private rolls = 0;

  constructor(private readonly secondsPerTick: number) {}

  /**
   * The marks of a note-on of `hits` hits over the part's `velocity`: its
   * event's own velocity, its level unaccented, its accent, and a new roll
   * id when it plays two or more.
   */
  mark(marks: NoteOnMarks, velocity: number, hits: number): HitMark {
    return {
      own: marks.velocity ?? 1,
      plain: partNoteOn({ ...marks, accent: undefined }, velocity).velocity,
      accent: marks.accent,
      roll: hits > 1 ? this.rolls++ : null,
    };
  }

  /** A part playing the hits of one note-on marked `mark`, as `playPitched` and a Euclid hit call it. */
  target(mark: HitMark): RollTarget {
    return {
      noteOn: (pitch, velocity = 1, time = 0, extras) =>
        this.play({ pitch, velocity, mark, time, extras }),
      trigger: (pitch, velocity = 1, duration = 0, time = 0, extras) =>
        this.play({ pitch, velocity, mark, time, extras, duration }),
    };
  }

  /** A note-off: every held note of the pitch that has started by then lets go. */
  release(note: number, time: number): void {
    const at = time / this.secondsPerTick;
    const held = this.held.get(note) ?? [];
    const still = held.filter((played) => played.on >= at + BOUNCE_TICK_EPSILON);
    for (const played of held) if (!still.includes(played)) played.off = at;
    this.held.set(note, still);
  }

  private play(call: PartCall): number {
    if (this.closing) return 0;
    const { pitch, velocity, mark, time, extras, duration } = call;
    const on = time / this.secondsPerTick;
    const off = duration === undefined ? null : (time + duration) / this.secondsPerTick;
    const played: PlayedNote = {
      pitch,
      on,
      off,
      velocity,
      ...mark,
      slide: extras?.slide === true,
      stepMod: extras?.stepMod,
    };
    this.notes.push(played);
    if (off === null) this.held.set(pitch, [...(this.held.get(pitch) ?? []), played]);
    return this.notes.length;
  }
}

/** What a part's binding emits, played onto the log as `ArrangementPlayer` plays it onto a part. */
function partOutput(
  song: Arrangement,
  part: MusicPart,
  transport: TickTransport,
  log: PlayLog,
): Omit<PartOutput, 'figureOf'> {
  const beats = meterBeats(song.transport.meter);
  const songTicks = songTicksOf(song);
  const rollAt = (shape: RollShape, clock: { secondsPerTick: number }): RollHit[] =>
    rollHits({
      ...shape,
      // The swing's phase is the transport tick's: the tick the clock is issuing.
      tick: transport.currentTick,
      regions: part.regions,
      songTicks,
      loop: null,
      secondsPerTick: clock.secondsPerTick,
      swing: transport.swing,
      beats,
    });
  return {
    note: (event) => {
      if (event.kind === 'noteOff') return log.release(event.note, event.time);
      const hits = event.roll ? rollAt(pitchedRollShape(event.roll), event.roll) : PLAIN_HIT;
      const mark = log.mark(event, part.velocity, hits.length);
      playPitched(log.target(mark), event, hits, part.velocity);
    },
    onset: (event, spec) => {
      if (spec.kind !== 'euclidean') return;
      const read = euclidHitRead(spec, event.step, event.localStep);
      const { note, velocity, extras } = euclidNoteOn(read, spec.note, part.velocity);
      const { divisor, hold } = spec;
      const { ratchet } = read;
      const plain = [{ offset: 0, held: hold }];
      const hits = ratchet > 1 ? rollAt({ divisor, hold, ratchet }, event) : plain;
      const target = log.target(log.mark(read, part.velocity, hits.length));
      for (const { offset, held } of hits) {
        target.trigger(note, velocity, held, event.time + offset, extras);
      }
    },
  };
}

/**
 * The notes the part on `slot` plays in `region`, played from the region's
 * first tick through its end. Every Figure part is bound too, silent, for
 * a canon to read its leader.
 */
export function captureRegion(
  arrangement: Arrangement,
  slot: number,
  region: PartRegion,
): RegionCapture {
  const song = withClockFields(arrangement);
  const transport = new TickTransport();
  setSongClock(transport, song);
  transport.loop = null;
  const log = new PlayLog(transport.secondsPerTick);
  const sampler = new ScaleSampler(song.harmony);
  const bindings = new Map<number, PartBinding | null>();
  const figureOf: PartOutput['figureOf'] = (leader, tick) =>
    bindings.get(leader)?.figureAt(tick) ?? null;
  const silent = { note: (): void => {}, onset: (): void => {} };
  for (const part of song.parts) {
    if (part.slot !== slot && part.sequencer.kind !== 'figure') continue;
    const played = part.slot === slot ? partOutput(song, part, transport, log) : silent;
    const config = partGateConfig(song, part);
    const output = { ...played, figureOf };
    bindings.set(part.slot, PartBinding.create(transport, part, config, sampler, output));
  }
  for (const binding of bindings.values()) binding?.attach();
  transport.reset(region.start);
  const end = region.start + region.duration;
  while (transport.currentTick < end) transport.advance(transport.transportSeconds);
  log.closing = true;
  transport.advance(transport.transportSeconds);
  for (const binding of bindings.values()) binding?.dispose();
  const { secondsPerTick, swing } = transport;
  const beats = meterBeats(song.transport.meter);
  return { notes: log.notes, clock: transport, ratchetClock: { secondsPerTick, swing, beats } };
}
