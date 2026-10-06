/**
 * The switch as the params read it (windsor#629): its fade continues from
 * where it had got to when the switch turns back mid-fade, the feed stays
 * open until a fade out has finished, a button press fades from the moment
 * it is noted, and pruning forgets nothing a later time reads.
 */
import { describe, expect, it } from 'vitest';

import { SwitchTimeline } from './switchTimeline';

const FADE = 0.01;

describe('SwitchTimeline', () => {
  it('turns back mid-fade from where the fade had got to', () => {
    const t = new SwitchTimeline(() => 1, FADE);
    t.schedule(0, 1, 'set');
    t.schedule(1, 1.004, 'set');
    const fade = t.view('fade');
    expect(fade.at(1)).toBe(1);
    expect(fade.at(1.004)).toBeCloseTo(0.6, 12);
    expect(fade.at(1.009)).toBeCloseTo(0.8, 12);
    expect(fade.at(1.014)).toBe(1);
    // Never closed: the feed stays open throughout.
    const open = t.view('open');
    for (const time of [1, 1.004, 1.01, 1.014]) expect(open.at(time)).toBe(1);
  });

  it('opens the feed at the switch on and closes it once the fade out ends', () => {
    let knob = 1;
    const t = new SwitchTimeline(() => knob, FADE);
    knob = 0;
    t.noteKnob(2);
    const open = t.view('open');
    expect(t.view('fade').at(2 + FADE / 2)).toBeCloseTo(0.5, 12);
    expect(open.approaching(2 + FADE)).toBe(1);
    expect(open.at(2 + FADE)).toBe(0);
    knob = 1;
    t.noteKnob(3);
    expect(open.approaching(3)).toBe(0);
    expect(open.at(3)).toBe(1);
    expect(t.view('fade').at(3)).toBe(0);
  });

  it('prunes only once settled, and reads the same after', () => {
    const t = new SwitchTimeline(() => 1, FADE);
    t.schedule(0, 1, 'set');
    t.schedule(1, 2, 'set');
    const fade = t.view('fade');
    const later = [2.5, 3];
    const before = later.map((time) => fade.at(time));
    t.prune(2.005);
    expect(fade.times()).toEqual([1, 1 + FADE, 2, 2 + FADE]);
    t.prune(2.5);
    expect(fade.times()).toEqual([]);
    expect(later.map((time) => fade.at(time))).toEqual(before);
  });

  it('settled, finishes each off and opens only once the effect is empty, across prunes', () => {
    const SETTLE = 0.1;
    const t = new SwitchTimeline(() => 1, FADE);
    const fade = t.view('fade', () => SETTLE);
    const open = t.view('open', () => SETTLE);
    // On again mid-fade-out: the off runs to its end, and the on waits.
    t.schedule(0, 1, 'set');
    t.schedule(1, 1.004, 'set');
    const offEnd = 1 + FADE;
    const opens = offEnd + SETTLE;
    expect(fade.at(1.004)).toBeCloseTo(0.6, 12);
    expect(fade.times()).toEqual([1, offEnd, opens, opens + FADE]);
    expect(open.at(offEnd)).toBe(0);
    expect(open.approaching(opens)).toBe(0);
    expect(open.at(opens)).toBe(1);
    t.prune(1.05);
    expect(fade.times()).toEqual([1, offEnd, opens, opens + FADE]);
    // An off before the waiting on begins cancels it; the next on waits from that off's end.
    t.schedule(0, 1.06, 'set');
    expect(fade.times()).toEqual([1, offEnd]);
    t.prune(1.08);
    expect(fade.times()).toEqual([]);
    t.schedule(1, 1.1, 'set');
    const reopens = 1.06 + FADE + SETTLE;
    expect(fade.times()).toEqual([reopens, reopens + FADE]);
    // The plain fade still turns back at once.
    expect(t.view('fade').times()).toEqual([1.1, 1.1 + FADE]);
  });
});
