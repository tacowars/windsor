import { describe, expect, it } from 'vitest';

import type { QueuedEvent } from './eventQueue';
import { EventQueue } from './eventQueue';
import { EVENT_QUEUE_CAPACITY } from './fmConstants';

const event = (id: number, frame = 0): QueuedEvent => ({ type: 'noteOff', id, frame });

/** Admit every posted event, as the render does at the start of a quantum: its frame into `incoming`, then `insert`. */
function admit(q: EventQueue): void {
  for (let i = 0; i < q.postedCount; i++) {
    const ev = q.posted[i]!;
    q.posted[i] = undefined;
    q.incoming[0] = ev.frame;
    q.insert(ev);
  }
  q.postedCount = 0;
}

/** Post one event and admit it, as one message a quantum is. */
function insert(q: EventQueue, id: number, frame: number): void {
  q.post(event(id, frame));
  admit(q);
}

/** Take every event due at or before `frame`, as the render does, reading the frame in place. */
function takeDue(q: EventQueue, frame: number): [number, number][] {
  const taken: [number, number][] = [];
  while (!q.empty && q.frames[q.head] <= frame) {
    const at = q.frames[q.head];
    taken.push([q.take().id, at]);
  }
  return taken;
}

describe('the FM part event queue', () => {
  it('holds its capacity of events, posted at once and then queued, from the start without growing (windsor#270)', () => {
    const q = new EventQueue();
    const { items, frames, posted } = q;
    const room = [EVENT_QUEUE_CAPACITY, EVENT_QUEUE_CAPACITY, EVENT_QUEUE_CAPACITY];
    expect([items.length, frames.length, posted.length]).toEqual(room);
    for (let id = 0; id < EVENT_QUEUE_CAPACITY; id++) {
      q.post(event(id, EVENT_QUEUE_CAPACITY - id));
    }
    admit(q);
    expect(q.items).toBe(items);
    expect(q.frames).toBe(frames);
    expect(q.posted).toBe(posted);
    expect([items.length, frames.length, posted.length]).toEqual(room);
    expect(takeDue(q, Infinity)[0]).toEqual([EVENT_QUEUE_CAPACITY - 1, 1]);
  });

  it('grows for a burst past its room as the burst is posted, and never as it is admitted (windsor#270)', () => {
    const q = new EventQueue();
    const burst = EVENT_QUEUE_CAPACITY + 2;
    for (let id = 0; id < burst; id++) q.post(event(id, burst - id));
    expect(q.frames.length).toBe(2 * EVENT_QUEUE_CAPACITY);
    expect(q.items.length).toBe(2 * EVENT_QUEUE_CAPACITY);
    expect(q.posted.length).toBeGreaterThanOrEqual(burst);
    const { items, frames, posted } = q;
    const lengths = [items.length, frames.length, posted.length];
    admit(q);
    expect(q.items).toBe(items);
    expect(q.frames).toBe(frames);
    expect(q.posted).toBe(posted);
    expect([items.length, frames.length, posted.length]).toEqual(lengths);
    const taken = takeDue(q, Infinity);
    expect(taken).toHaveLength(burst);
    expect(taken[0]).toEqual([burst - 1, 1]);
    expect(taken[burst - 1]).toEqual([0, burst]);
  });

  it('counts the events already queued when a post decides to grow, and admits onto a moved-down queue without growing', () => {
    const q = new EventQueue(4);
    for (let id = 0; id < 3; id++) insert(q, id, id * 10);
    takeDue(q, 0);
    // Two queued at slots 1 and 2: two posts fill the room, a third grows it.
    q.post(event(3, 25));
    q.post(event(4, 15));
    const { items, frames } = q;
    expect(frames.length).toBe(4);
    admit(q);
    expect(q.head).toBe(0);
    expect(q.frames).toBe(frames);
    expect(q.items).toBe(items);
    q.post(event(5, 5));
    expect(q.frames.length).toBe(8);
    admit(q);
    expect(takeDue(q, Infinity)).toEqual([
      [5, 5],
      [1, 10],
      [4, 15],
      [2, 20],
      [3, 25],
    ]);
  });

  it('keeps events in frame order, a tie in arrival order, as it grows', () => {
    const q = new EventQueue(2);
    const frames = [40, 10, 30, 10, 50, 20, 30, 0, 60, 10];
    frames.forEach((frame, id) => insert(q, id, frame));
    const expected = frames
      .map((frame, id): [number, number] => [id, frame])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    expect(takeDue(q, Infinity)).toEqual(expected);
    expect(q.empty).toBe(true);
  });

  it('moves the queue down when it reaches the end of its room, keeping each frame with its event', () => {
    const q = new EventQueue(4);
    for (let id = 0; id < 4; id++) insert(q, id, id * 10);
    const room = q.frames.length;
    expect(takeDue(q, 15)).toEqual([
      [0, 0],
      [1, 10],
    ]);
    insert(q, 4, 5);
    insert(q, 5, 25);
    expect(q.frames.length).toBe(room);
    expect(takeDue(q, Infinity)).toEqual([
      [4, 5],
      [2, 20],
      [5, 25],
      [3, 30],
    ]);
  });

  it('holds frames past 2^31 exactly', () => {
    const q = new EventQueue();
    const late = 2 ** 32 + 7;
    insert(q, 0, late + 1);
    insert(q, 1, late);
    insert(q, 2, 2 ** 31 - 1);
    expect(takeDue(q, late)).toEqual([
      [2, 2 ** 31 - 1],
      [1, late],
    ]);
    expect(takeDue(q, late + 1)).toEqual([[0, late + 1]]);
  });

  it('releases a message once it is taken', () => {
    const q = new EventQueue();
    for (let id = 0; id < 3; id++) insert(q, id, id * 10);
    expect(takeDue(q, 10)).toEqual([
      [0, 0],
      [1, 10],
    ]);
    expect(q.items[0]).toBeUndefined();
    expect(q.items[1]).toBeUndefined();
    expect(q.items[2]?.id).toBe(2);
    takeDue(q, Infinity);
    expect(q.items.every((slot) => slot === undefined)).toBe(true);
  });

  it('releases every queued message on clear', () => {
    const q = new EventQueue();
    for (let id = 0; id < 5; id++) insert(q, id, 100 + id);
    takeDue(q, 100);
    q.clear();
    expect(q.empty).toBe(true);
    expect(q.items.every((slot) => slot === undefined)).toBe(true);
  });

  it('holds posted messages in arrival order, reusing its slots, until a clear releases them', () => {
    const q = new EventQueue(2);
    for (let id = 0; id < 3; id++) q.post(event(id));
    expect(q.posted.slice(0, q.postedCount).map((slot) => slot?.id)).toEqual([0, 1, 2]);
    expect(q.empty).toBe(true);
    q.clear();
    expect(q.postedCount).toBe(0);
    expect(q.posted.every((slot) => slot === undefined)).toBe(true);
    q.post(event(3));
    expect(q.posted.length).toBe(3);
    expect(q.posted[0]?.id).toBe(3);
  });

  it('releases the slots a move down vacates', () => {
    const q = new EventQueue(4);
    for (let id = 0; id < 4; id++) insert(q, id, id * 10);
    takeDue(q, 15);
    insert(q, 4, 25);
    expect(q.head).toBe(0);
    expect(q.items.slice(0, q.tail).map((slot) => slot?.id)).toEqual([2, 4, 3]);
    expect(q.items.slice(q.tail).every((slot) => slot === undefined)).toBe(true);
    takeDue(q, Infinity);
    expect(q.items.every((slot) => slot === undefined)).toBe(true);
  });
});
