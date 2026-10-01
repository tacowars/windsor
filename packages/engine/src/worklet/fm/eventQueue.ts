/**
 * The part's frame-stamped event queue (windsor#233): its note-ons and
 * note-offs in frame order, each with the frame it lands on. Invariant:
 * allocation free once it has grown to the most events ever queued at once.
 * An event is inserted in place, by insertion sort from the back (events
 * usually arrive in order), and taken from the front by an index; `splice`
 * returned a new array for each insert, and `shift` trimmed the array that
 * the next insert then grew again.
 *
 * The frames sit in `frames`, a Float64Array beside `items`, slot for slot,
 * never in a field: past 2^31 (about 12 hours at 48 kHz) a frame is a
 * double, and a field first written as a small integer would be generalised
 * on the audio thread when one crossed (rule 7), as a frame stamped on the
 * message was. No frame crosses a call either: the part writes the next
 * event's frame into `incoming` before `insert`, and the render reads
 * `frames[head]` in place, since a double returned from a call V8 does not
 * inline is boxed (rule 2). `eventQueue.test.ts` and `fmProcessor.test.ts`
 * pin the order, `synth/fmProcessorAllocation.test.ts` the allocation and
 * the crossing.
 *
 * A slot drops its message once the message is taken, cleared or moved
 * down (windsor#262), so a burst or a cancelled run of note-ons does not
 * stay alive until a later schedule overwrites its slots. The empty value
 * is `undefined`, written over the reference: `items` holds objects
 * (PACKED_ELEMENTS), which holds `undefined` with no elements-kind
 * transition, where `delete` or a shorter length would make it HOLEY.
 */

import type { NoteOffMessage, NoteOnMessage } from '../../synth/workletMessages';

/** A scheduled message once queued. A note-off from an older sender may carry `note` instead of `id`. */
type QueuedEvent = NoteOnMessage | (NoteOffMessage & { note?: number });

class EventQueue {
  /** The events in [head, tail), in frame order; the slots outside it are free and hold `undefined`. */
  items: (QueuedEvent | undefined)[];
  /** Each event's frame, in the slot of `items` that holds it; its length is the queue's room. */
  frames: Float64Array;
  /** The frame of the event `insert` queues next: the part writes it here first. */
  incoming: Float64Array;
  head: number;
  tail: number;

  constructor() {
    this.items = [];
    this.frames = new Float64Array(2);
    this.incoming = new Float64Array(1);
    this.head = 0;
    this.tail = 0;
  }

  get empty(): boolean {
    return this.head === this.tail;
  }

  /** Take the first event. The queue must not be empty. */
  take(): QueuedEvent {
    const items = this.items;
    const event = items[this.head]!;
    items[this.head++] = undefined;
    if (this.head === this.tail) this.head = this.tail = 0;
    return event;
  }

  /** Queue `event` at the frame in `incoming`, after every event at or before that frame. */
  insert(event: QueuedEvent): void {
    if (this.tail === this.frames.length) this.makeRoom();
    const items = this.items;
    const frames = this.frames;
    let i = this.tail;
    if (i === items.length) items.push(event);
    this.tail = i + 1;
    while (i > this.head && frames[i - 1] > this.incoming[0]) {
      items[i] = items[i - 1];
      frames[i] = frames[i - 1];
      i--;
    }
    items[i] = event;
    frames[i] = this.incoming[0];
  }

  /**
   * The queue has reached the end of its room: move it down to the front,
   * or, when it fills the room, double the room (an allocation, only at a
   * new most events queued at once).
   */
  makeRoom(): void {
    const head = this.head;
    if (head === 0) {
      const grown = new Float64Array(this.frames.length * 2);
      grown.set(this.frames);
      this.frames = grown;
      return;
    }
    const items = this.items;
    const frames = this.frames;
    for (let i = head; i < this.tail; i++) {
      items[i - head] = items[i];
      frames[i - head] = frames[i];
    }
    for (let i = Math.max(this.tail - head, head); i < this.tail; i++) items[i] = undefined;
    this.tail -= head;
    this.head = 0;
  }

  /** Drop every queued event, releasing the live slots only, so a clear costs what it frees. */
  clear(): void {
    const items = this.items;
    for (let i = this.head; i < this.tail; i++) items[i] = undefined;
    this.head = this.tail = 0;
  }
}

export type { QueuedEvent };
export { EventQueue };
