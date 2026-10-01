/**
 * The part's frame-stamped event queue (windsor#233): its note-ons and
 * note-offs in frame order, each with the frame it lands on. Invariant:
 * allocation free up to `EVENT_QUEUE_CAPACITY` events queued or posted at
 * once, the room its constructor gives both from the start (windsor#270), so
 * a fresh part's first notes and an ordinary burst grow nothing. Past that
 * it grows, by doubling, as the rare fallback, and only in `post`, on the
 * message path: `post` keeps the room at least the events queued and
 * posted, so the render, admitting what was posted, never grows the queue
 * or allocates. The port's `onmessage` runs on the audio thread too, but
 * between quanta, not inside `process()`.
 * An event is inserted in place and taken from the front by an index;
 * `splice` returned a new array for each insert, and `shift` trimmed the
 * array that the next insert then grew again. An event at or past the last
 * queued frame is appended; any other finds its slot by an upper-bound
 * search over `frames[head, tail)`, galloping back from the tail and then
 * halving, and the later frames move up as one `copyWithin` (windsor#273).
 * The render admits a whole burst at the start of a quantum, and notes
 * arrive interleaved with their note-offs (a note-on at `t`, its note-off at
 * `t + d`), so a walk back from the tail cost O(n) comparisons an event, and
 * O(n^2) for a burst of n, before any event was due. The search reads
 * O(log n) frames an event, and fewer for one near the tail, where most
 * land; `eventQueue.test.ts` pins the reads for a reversed and an
 * interleaved burst.
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
 * A message the port delivers is first `post`ed: its reference goes into
 * `posted`, in arrival order, and nothing of it is read (windsor#270). The
 * part's render admits what was posted at the start of its next quantum,
 * reading each frame there and inserting in the same order, so the queue
 * holds what it held when `schedule` inserted directly. The reason is V8's
 * tiers: past 2^31 a message's frame is a double, and the first such
 * message changes the representation of the sender's `frame` field, which
 * deprecates the message's map and throws away the optimised code of every
 * function that read a message. A function called once a message (the old
 * `schedule`, `noteOn`) then ran in V8's baseline tier for tens of thousands
 * of quanta, where every double it read or computed was a new heap number;
 * the render, called every quantum, is optimised again within a few hundred.
 * `post` reads no field, so it costs nothing in any tier.
 *
 * A slot drops its message once the message is taken, admitted, cleared or
 * moved down (windsor#262), so a burst or a cancelled run of note-ons does
 * not stay alive until a later schedule overwrites its slots. The empty value
 * is `undefined`, written over the reference: `items` holds objects
 * (PACKED_ELEMENTS), which holds `undefined` with no elements-kind
 * transition, where `delete` or a shorter length would make it HOLEY.
 */

import type { NoteOffMessage, NoteOnMessage } from '../../synth/workletMessages';
import { EVENT_QUEUE_CAPACITY } from './fmConstants';

/** A scheduled message once queued. A note-off from an older sender may carry `note` instead of `id`. */
type QueuedEvent = NoteOnMessage | (NoteOffMessage & { note?: number });

/**
 * `capacity` slots holding `undefined`, pushed one by one so the array is
 * PACKED_ELEMENTS from the start: `new Array(n)` would be HOLEY, and an array
 * born empty is PACKED_SMI until its first message.
 */
function emptySlots(capacity: number): (QueuedEvent | undefined)[] {
  const slots: (QueuedEvent | undefined)[] = [];
  for (let i = 0; i < capacity; i++) slots.push(undefined);
  return slots;
}

class EventQueue {
  /** The events in [head, tail), in frame order; the slots outside it are free and hold `undefined`. */
  items: (QueuedEvent | undefined)[];
  /** Each event's frame, in the slot of `items` that holds it; its length is the queue's room. */
  frames: Float64Array;
  /** The frame of the event `insert` queues next: the part writes it here first. */
  incoming: Float64Array;
  head: number;
  tail: number;
  /** The messages posted since the render last admitted them, in [0, postedCount), in arrival order; the rest hold `undefined`. */
  posted: (QueuedEvent | undefined)[];
  postedCount: number;

  constructor(capacity: number = EVENT_QUEUE_CAPACITY) {
    this.items = emptySlots(capacity);
    this.frames = new Float64Array(capacity);
    this.incoming = new Float64Array(1);
    this.head = 0;
    this.tail = 0;
    this.posted = emptySlots(capacity);
    this.postedCount = 0;
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

  /**
   * Hold `event` until the render admits it, reading nothing of it. When the
   * events queued and posted would pass the room, it doubles the room here,
   * so the render's admission never has to; a move down frees no room, it
   * only gathers what there is at the front. It grows the room, or `posted`,
   * only at a new most events queued and posted at once.
   */
  post(event: QueuedEvent): void {
    const count = this.postedCount;
    if (this.tail - this.head + count === this.frames.length) this.grow();
    const posted = this.posted;
    if (count === posted.length) posted.push(event);
    else posted[count] = event;
    this.postedCount = count + 1;
  }

  /**
   * Queue `event` at the frame in `incoming`, after every event at or before
   * that frame. It never grows the queue or allocates: `event` was posted,
   * and `post` left room for it, so at the end of the room a move down
   * frees a slot.
   */
  insert(event: QueuedEvent): void {
    if (this.tail === this.frames.length) this.moveDown();
    const items = this.items;
    const frames = this.frames;
    const frame = this.incoming[0];
    const tail = this.tail;
    this.tail = tail + 1;
    if (tail === this.head || frames[tail - 1] <= frame) {
      items[tail] = event;
      frames[tail] = frame;
      return;
    }
    // Upper bound: the first slot whose frame is past this one, so a tie
    // goes after every event already queued at its frame (arrival order).
    // `frames[hi]` is past it throughout; gallop back from the tail, then
    // halve what is left.
    const head = this.head;
    let hi = tail - 1;
    let lo = head;
    for (let step = 1; hi - step >= head; step += step) {
      if (frames[hi - step] <= frame) {
        lo = hi - step + 1;
        break;
      }
      hi -= step;
    }
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (frames[mid] > frame) hi = mid;
      else lo = mid + 1;
    }
    frames.copyWithin(lo + 1, lo, tail);
    for (let i = tail; i > lo; i--) items[i] = items[i - 1];
    items[lo] = event;
    frames[lo] = frame;
  }

  /**
   * Double the room, `frames` and `items` alike, each event staying in its
   * slot and the new object slots holding `undefined`. Only `post` calls it.
   */
  grow(): void {
    const room = this.frames.length * 2;
    const grown = new Float64Array(room);
    grown.set(this.frames);
    this.frames = grown;
    const items = this.items;
    while (items.length < room) items.push(undefined);
  }

  /**
   * The queue has reached the end of its room with room free at the front,
   * as `post` ensures: move it down to the front.
   */
  moveDown(): void {
    const head = this.head;
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

  /** Drop every queued and posted event, releasing the live slots only, so a clear costs what it frees. */
  clear(): void {
    const items = this.items;
    for (let i = this.head; i < this.tail; i++) items[i] = undefined;
    this.head = this.tail = 0;
    const posted = this.posted;
    for (let i = 0; i < this.postedCount; i++) posted[i] = undefined;
    this.postedCount = 0;
  }
}

export type { QueuedEvent };
export { EventQueue };
