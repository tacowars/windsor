import { describe, expect, it } from 'vitest';

import type { QueuedEvent } from './eventQueue';
import { EventQueue } from './eventQueue';

const event = (id: number): QueuedEvent => ({ type: 'noteOff', id, frame: 0 });

function insert(q: EventQueue, id: number, frame: number): void {
  q.incoming[0] = frame;
  q.insert(event(id));
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
  it('keeps events in frame order, a tie in arrival order, as it grows', () => {
    const q = new EventQueue();
    const frames = [40, 10, 30, 10, 50, 20, 30, 0, 60, 10];
    frames.forEach((frame, id) => insert(q, id, frame));
    const expected = frames
      .map((frame, id): [number, number] => [id, frame])
      .sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    expect(takeDue(q, Infinity)).toEqual(expected);
    expect(q.empty).toBe(true);
  });

  it('moves the queue down when it reaches the end of its room, keeping each frame with its event', () => {
    const q = new EventQueue();
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
    const q = new EventQueue();
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
    const q = new EventQueue();
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
