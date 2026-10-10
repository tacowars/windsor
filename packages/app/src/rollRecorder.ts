/**
 * The console's Roll recorder (windsor#663; record `2026-10-09-roll-recording`
 * decisions 1–9): the Rec switch's state, and the tap the audition
 * `Keyboard` plays through, feeding one take (`rollTake.ts`) at a time and
 * writing its finished notes into the song as one undo step.
 *
 * - **The tap.** The keyboard calls `press` where it starts a note on the
 *   part and `release` where a voice actually stops (a key let go, the
 *   sustain pedal or Hold letting it go, a forced lift), each with the
 *   input event's `timeStamp`, and `panic` at Panic, where every voice
 *   stops at once. The Roll's own Audition never reaches it.
 * - **Ordering.** Before the take is handed a press or a release it is
 *   advanced to the tick heard now (`TapClock`), so a loop's jump is seen
 *   before the event after it. An event stamped past the tick heard now was
 *   played before a loop's jump it arrives after (a stamp never runs ahead
 *   of the playhead): the take is advanced to its stamp, handed it, then
 *   advanced through the loop's end and on to now, in stamp order.
 * - **The take** opens at the first press that can record (Rec on, the
 *   transport running, the selected part a Roll part), reading the part's
 *   regions then. It ends, every held note cut at the last tick heard and
 *   written, at a transport stop, Rec off, a part switch and a switch of
 *   song (`close`).
 * - **Another edit splits it** (`split`, which the context calls before
 *   any other song edit, gesture, undo or redo): the notes the take has
 *   written close as its own step, and the notes still held are not cut.
 *   They carry into the next take (`RollTake.handOver`, at the next press,
 *   release or reading, over the regions as the edit left them), keep
 *   growing, and are written on release into that take's step.
 * - **Writes.** A note is written when it stops sounding or when the take
 *   ends, through `takeWriteChange` and the host's `write`, which folds
 *   every write of one take into one undo step. While another control's
 *   gesture is open (a drag), its step takes every change, so the take
 *   writes nothing: notes played then are recorded and held back, and
 *   written when the gesture ends (`gestureEnded`), as a step of their own
 *   after the gesture's.
 */
import type { ArrangementDocument, AudioPart, DocumentPartial, TickLoop } from '@windsor/engine';
import { songTicksOf, tickLoopOf } from '@windsor/engine';
import { type TapReading, TapClock, nextLoopEnd } from './rollRecClock';
import {
  type RecLook,
  type RecPlace,
  canArm,
  recLook,
  recPlace,
  takeRegions,
} from './rollRecState';
import { takeWriteChange } from './rollRecWrite';
import { type HeldNote, RollTake } from './rollTake';

/** What the recorder reads of the console and writes to it; the tests fake it. */
export interface RecorderHost {
  doc(): ArrangementDocument;
  /** The selected part's slot. */
  selected(): number;
  /** The live part the selected slot plays: what the keyboard strikes. */
  livePart(): AudioPart | null;
  running(): boolean;
  /** The transport tick the console draws the playhead at, for the switch's look. */
  position(): number;
  /** The tick heard now and the context time it was heard at; null with no live system. */
  now(): TapReading | null;
  /** The tick heard at an input event's `timeStamp` (now, without one); null with no live system. */
  stamp(timeStamp: number | undefined): number | null;
  /** The seconds one tick lasts at the running tempo. */
  secondsPerTick(): number;
  /** Another control's gesture is open (a drag, or presses merging): a write would fold into its step. */
  editOpen(): boolean;
  /** Write a take's partial into its undo step; false when nothing landed. */
  write(partial: DocumentPartial): boolean;
  /** The take's undo step is closed: the next write opens a new one. */
  closeStep(): void;
}

/** The tap the audition keyboard plays through (`Keyboard.tap`). */
export interface NoteTap {
  press(part: AudioPart, source: string, pitch: number, velocity: number, timeStamp?: number): void;
  release(part: AudioPart, source: string, pitch: number, timeStamp?: number): void;
  panic(): void;
}

/** A loop the transport wraps in, as `TapClock` judges one: not empty, inverted or the whole song. */
const wraps = (loop: TickLoop | null): loop is TickLoop =>
  loop !== null && loop.end > loop.start && loop.end - loop.start < loop.songTicks;

export class RollRecorder implements NoteTap {
  private armed = false;
  private take: RollTake | null = null;
  /** The slot the open take records into. */
  private slot = -1;
  /** An edit landed since the take opened: its regions are read again at its next use (`current`). */
  private stale = false;
  /** Takes that ended while a gesture was open, with their slots: written when it ends. */
  private readonly backlog: Array<{ readonly take: RollTake; readonly slot: number }> = [];
  private readonly clock = new TapClock();
  /** The last tick heard while the take ran. */
  private last: number | null = null;

  constructor(private readonly host: RecorderHost) {}

  /** Rec is on. */
  get on(): boolean {
    return this.armed;
  }

  /** Where the selected part is at the playhead. */
  place(): RecPlace {
    const { host } = this;
    return recPlace(host.doc(), host.selected(), host.position());
  }

  /** The switch's look. */
  look(): RecLook {
    return recLook({ armed: this.armed, running: this.host.running(), place: this.place() });
  }

  /** Turn Rec on (only where it can arm) or off (anywhere, ending the take). */
  setOn(on: boolean): void {
    if (on === this.armed || (on && !canArm(this.place()))) return;
    if (!on) this.close();
    this.armed = on;
  }

  /** The notes still sounding in part `slot`'s take, each with its length so far. */
  held(slot: number): HeldNote[] {
    return this.take && this.slot === slot ? this.take.held() : [];
  }

  /** The playhead: the take ends at a stop or a part switch, and otherwise follows it. */
  sync(): void {
    const take = this.live();
    if (take) this.observe(take);
  }

  press(
    part: AudioPart,
    source: string,
    pitch: number,
    velocity: number,
    timeStamp?: number,
  ): void {
    if (!this.armed || part !== this.host.livePart()) return;
    const live = this.live();
    if (!this.host.running()) return;
    const take = live ?? this.open();
    const tick = this.host.stamp(timeStamp);
    if (take && tick !== null)
      this.order(take, tick, () => take.press(source, pitch, velocity, tick));
  }

  release(_part: AudioPart, source: string, pitch: number, timeStamp?: number): void {
    const take = this.live();
    if (!take) return;
    const stamp = this.host.stamp(timeStamp);
    this.order(take, stamp, () => {
      const tick = stamp ?? this.last;
      if (tick !== null) take.release(source, pitch, tick);
    });
    this.flush(take);
  }

  /** Panic: every held note ends at the tick heard, and the take runs on. */
  panic(): void {
    this.sync();
    const take = this.current();
    if (!take || this.last === null) return;
    take.end(this.last);
    this.flush(take);
  }

  /**
   * The take's end (a stop, Rec off, a part switch, a switch of song):
   * every held note cut at the last tick heard and written, and the undo
   * step closed. Written when the open gesture ends, if one is open.
   */
  close(): void {
    if (!this.take) return;
    const take = this.current();
    this.take = null;
    if (take) {
      if (this.host.running()) this.observe(take);
      if (this.last !== null) take.end(this.last);
      this.flush(take);
      if (this.host.editOpen()) this.backlog.push({ take, slot: this.slot });
    }
    this.host.closeStep();
    this.clock.reset();
    this.last = null;
  }

  /**
   * Before any other edit, an undo or a redo (decision 8): what the take
   * has written closes as its own step, and the notes still held carry
   * into the next take, read over the regions as the edit leaves them.
   */
  split(): void {
    const take = this.take;
    if (!take) return;
    if (this.host.running()) this.observe(take);
    this.flush(take);
    this.host.closeStep();
    this.stale = true;
  }

  /** Another control's gesture ended: write what was held back during it, as a step after its own. */
  gestureEnded(): void {
    for (const { take, slot } of this.backlog.splice(0)) this.flush(take, slot);
    if (this.take) {
      this.flush(this.take);
      this.stale = true;
    }
  }

  /** The open take, unread: ended first at a stop or a part switch. */
  private live(): RollTake | null {
    if (!this.take) return null;
    if (this.host.running() && this.host.selected() === this.slot) return this.current();
    this.close();
    return null;
  }

  /** The open take, its held notes handed to a new take first if an edit landed since it opened. */
  private current(): RollTake | null {
    const take = this.take;
    if (!take || !this.stale) return take;
    this.stale = false;
    const doc = this.host.doc();
    const roll = recPlace(doc, this.slot, this.host.position()).roll;
    const next = roll ? new RollTake(songTicksOf(doc), takeRegions(doc, this.slot)) : null;
    if (next) take.handOver(next);
    this.take = next;
    return next;
  }

  /** A new take on the selected part, not yet advanced; null when it is not a Roll part. */
  private open(): RollTake | null {
    const { host } = this;
    const doc = host.doc();
    const slot = host.selected();
    if (!recPlace(doc, slot, host.position()).roll) return null;
    const take = new RollTake(songTicksOf(doc), takeRegions(doc, slot));
    this.take = take;
    this.slot = slot;
    this.clock.reset();
    this.last = null;
    return take;
  }

  /** Advance the take to the tick heard now, through the loop's end when it wrapped unseen. */
  private observe(take: RollTake): void {
    const now = this.host.now();
    if (!now) return;
    const loop = tickLoopOf(this.host.doc().transport);
    for (const tick of this.clock.observe(now, loop, this.host.secondsPerTick())) {
      take.advance(tick);
    }
    this.last = now.tick;
  }

  /**
   * Hand the take an event stamped at `stamp` (`apply`) in its place against
   * the playhead heard now: after the ticks up to now, or, when the stamp
   * lies past now's tick in a loop that wraps and the take has not yet been
   * advanced through that jump, ahead of the jump it was played before.
   */
  private order(take: RollTake, stamp: number | null, apply: () => void): void {
    const now = this.host.now();
    if (!now) return apply();
    const loop = tickLoopOf(this.host.doc().transport);
    const ticks = this.clock.observe(now, loop, this.host.secondsPerTick());
    const last = this.last;
    this.last = now.tick;
    const unseen = last === null || last > now.tick || ticks.length > 1;
    if (stamp === null || !wraps(loop) || stamp <= now.tick || !unseen) {
      for (const tick of ticks) take.advance(tick);
      return apply();
    }
    if (last === null || stamp > last) take.advance(stamp);
    apply();
    take.advance(nextLoopEnd(stamp, loop));
    take.advance(now.tick);
  }

  /** Write what the take has finished into part `slot`; held back while another gesture is open. */
  private flush(take: RollTake, slot = this.slot): void {
    if (this.host.editOpen()) return;
    const writes = take.drain();
    if (writes.length === 0) return;
    const partial = takeWriteChange(this.host.doc(), slot, writes);
    if (partial) this.host.write(partial);
  }
}
