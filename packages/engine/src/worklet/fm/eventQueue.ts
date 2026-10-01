/**
 * The part's frame-stamped event queue (windsor#233): its note-ons and
 * note-offs in frame order, a message once stamped with the frame it lands
 * on. Invariant: allocation free once its array has grown to the most events
 * ever queued at once. An event is inserted in place, by insertion sort from
 * the back (events usually arrive in order), and taken from the front by an
 * index; `splice` returned a new array for each insert, and `shift` trimmed
 * the array that the next insert then grew again. `fmProcessor.test.ts` pins
 * the order, `synth/fmProcessorAllocation.test.ts` the allocation.
 */

import type { NoteOffMessage, NoteOnMessage } from '../../synth/workletMessages';

/** A scheduled message once queued: frame-stamped. A note-off from an older sender may carry `note` instead of `id`. */
type QueuedEvent = (NoteOnMessage | (NoteOffMessage & { note?: number })) & { _frame: number };

class EventQueue {
  /** The events in [head, tail), in frame order; the slots outside it are free. */
  items: QueuedEvent[];
  head: number;
  tail: number;

  constructor() {
    this.items = [];
    this.head = 0;
    this.tail = 0;
  }

  get empty(): boolean {
    return this.head === this.tail;
  }

  /** The first event's frame. The queue must not be empty. */
  get firstFrame(): number {
    return this.items[this.head]._frame;
  }

  /** Take the first event. The queue must not be empty. */
  take(): QueuedEvent {
    const event = this.items[this.head++];
    if (this.head === this.tail) this.head = this.tail = 0;
    return event;
  }

  /** Queue `event` after every event at or before its frame. */
  insert(event: QueuedEvent): void {
    const items = this.items;
    if (this.tail === items.length && this.head > 0) {
      // The array is full to its end: move the queue down to the front first.
      const head = this.head;
      for (let i = head; i < this.tail; i++) items[i - head] = items[i];
      this.tail -= head;
      this.head = 0;
    }
    let i = this.tail;
    if (i === items.length) items.push(event);
    this.tail = i + 1;
    while (i > this.head && items[i - 1]._frame > event._frame) {
      items[i] = items[i - 1];
      i--;
    }
    items[i] = event;
  }

  /** Drop every queued event. */
  clear(): void {
    this.head = this.tail = 0;
  }
}

export type { QueuedEvent };
export { EventQueue };
