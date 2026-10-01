/**
 * One field's own value over time (windsor#345): Web Audio's reading of the
 * events a lane put on it, the knob's value where none holds it, and a list
 * that stays as short as the look-ahead.
 */
import { describe, expect, it } from 'vitest';

import { FieldTimeline } from './fieldTimeline';

describe('FieldTimeline', () => {
  it('is the knob with no events, and follows the knob live', () => {
    let knob = 3;
    const field = new FieldTimeline(() => knob);
    expect(field.at(5)).toBe(3);
    knob = 4;
    expect(field.approaching(5)).toBe(4);
  });

  it('holds after a set, runs straight into a ramp, and tells both sides of a step', () => {
    const field = new FieldTimeline(() => 0);
    field.hold(1, 0);
    field.schedule(3, 2, 'ramp');
    field.schedule(3, 4, 'set');
    field.schedule(5, 4.5, 'ramp');
    expect(field.at(1)).toBe(2);
    expect(field.at(3)).toBe(3);
    expect(field.approaching(4)).toBe(3);
    expect(field.at(4.25)).toBe(4);
    expect(field.at(9)).toBe(5);
    expect(field.jumpsAt(4)).toBe(true);
    expect(field.jumpsAt(2)).toBe(false);
  });

  it('drops events from a cancel on, so a ramp in flight is gone', () => {
    const field = new FieldTimeline(() => 0);
    field.hold(1, 0);
    field.schedule(3, 2, 'ramp');
    field.cancelFrom(1);
    expect(field.at(1.5)).toBe(1);
    expect(field.lastBefore(5)).toBe(0);
  });

  it('is the knob from a release on, read when asked', () => {
    let knob = 7;
    const field = new FieldTimeline(() => knob);
    field.hold(1, 0);
    field.release(2);
    expect(field.at(1)).toBe(1);
    expect(field.approaching(2)).toBe(1);
    expect(field.at(2)).toBe(7);
    knob = 8;
    expect(field.at(3)).toBe(8);
    expect(field.jumpsAt(2)).toBe(true);
  });

  it('keeps one event at or before now, however long it plays', () => {
    const field = new FieldTimeline(() => 0);
    field.hold(0, 0);
    for (let tick = 1; tick <= 1000; tick++) {
      field.prune(tick - 3);
      field.schedule(tick % 7, tick, 'ramp');
    }
    expect(field.times()).toEqual([997, 998, 999, 1000]);
    expect(field.at(997.5)).toBe((997 % 7) + 0.5);
  });
});
