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
 *   before the event after it.
 * - **The take** opens at the first press that can record (Rec on, the
 *   transport running, the selected part a Roll part, no other edit's drag
 *   open), reading the part's regions then. It ends, every held note cut at
 *   the last tick heard and written, at a transport stop, Rec off, a part
 *   switch, and before any other song edit, an undo, a redo or a switch of
 *   song (`close`, which the context calls first): the take so far closes
 *   as its own step, and the next note written opens a new take.
 * - **Writes.** A note is written when it stops sounding or when the take
 *   ends, through `takeWriteChange` and the host's `write`, which folds
 *   every write of one take into one undo step.
 */
import type { ArrangementDocument, AudioPart, DocumentPartial } from '@windsor/engine';
import { songTicksOf, tickLoopOf } from '@windsor/engine';
import { type TapReading, TapClock } from './rollRecClock';
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
  /** Close a merged edit waiting on its timer; false while another edit's drag is still open. */
  settle(): boolean;
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

export class RollRecorder implements NoteTap {
  private armed = false;
  private take: RollTake | null = null;
  /** The slot the open take records into. */
  private slot = -1;
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
    const take = this.take;
    if (!take) return;
    if (!this.host.running() || this.host.selected() !== this.slot) this.close();
    else this.observe(take);
  }

  press(
    part: AudioPart,
    source: string,
    pitch: number,
    velocity: number,
    timeStamp?: number,
  ): void {
    if (!this.armed || part !== this.host.livePart()) return;
    this.sync();
    if (!this.host.running() || !this.host.settle()) return;
    const take = this.take ?? this.open();
    const tick = this.host.stamp(timeStamp);
    if (take && tick !== null) take.press(source, pitch, velocity, tick);
  }

  release(_part: AudioPart, source: string, pitch: number, timeStamp?: number): void {
    this.sync();
    const take = this.take;
    if (!take) return;
    const tick = this.host.stamp(timeStamp) ?? this.last;
    if (tick === null) return;
    take.release(source, pitch, tick);
    this.flush(take);
  }

  /** Panic: every held note ends at the tick heard, and the take runs on. */
  panic(): void {
    this.sync();
    const take = this.take;
    if (!take || this.last === null) return;
    take.end(this.last);
    this.flush(take);
  }

  /**
   * The take's end (a stop, Rec off, a part switch, and before any other
   * edit, an undo or a switch of song): every held note cut at the last
   * tick heard and written, and the undo step closed.
   */
  close(): void {
    const take = this.take;
    if (!take) return;
    if (this.host.running()) this.observe(take);
    this.take = null;
    if (this.last !== null) take.end(this.last);
    this.flush(take);
    this.host.closeStep();
    this.clock.reset();
    this.last = null;
  }

  /** A new take on the selected part, at the tick heard now; null when it is not a Roll part. */
  private open(): RollTake | null {
    const { host } = this;
    const doc = host.doc();
    const slot = host.selected();
    if (!recPlace(doc, slot, host.position()).roll) return null;
    const take = new RollTake(songTicksOf(doc), takeRegions(doc, slot));
    this.take = take;
    this.slot = slot;
    this.clock.reset();
    this.observe(take);
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

  /** Write what the take has finished. */
  private flush(take: RollTake): void {
    const writes = take.drain();
    if (writes.length === 0) return;
    const partial = takeWriteChange(this.host.doc(), this.slot, writes);
    if (partial) this.host.write(partial);
  }
}
