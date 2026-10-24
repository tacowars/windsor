/**
 * A rolled note-on as its part plays it (windsor#366): every hit of a
 * ratcheted varied step plays the step's varied velocity (windsor#945
 * decision 3), the first hit sliding and the later ones not.
 */
import { describe, expect, it } from 'vitest';

import type { NoteOnEvent } from '../sequencing/noteEvent';
import { playPitched, type RollTarget } from './pitchedRoll';
import type { RollHit } from './rollSpan';

/** A part that writes down each hit's velocity and whether it slid. */
function recorder(): RollTarget & { hits: { velocity: number; slide: boolean }[] } {
  const hits: { velocity: number; slide: boolean }[] = [];
  const write = (velocity = 1, slide = false): number => hits.push({ velocity, slide });
  return {
    hits,
    noteOn: (_note, velocity, _time, extras) => write(velocity, extras?.slide),
    trigger: (_note, velocity, _duration, _time, extras) => write(velocity, extras?.slide),
  };
}

const HITS: readonly RollHit[] = [0, 1, 2].map((j) => ({ offset: j * 0.05, held: 0.04 }));

describe('playPitched', () => {
  it('plays every hit of a ratcheted varied step at the step’s varied velocity', () => {
    const event: NoteOnEvent = {
      kind: 'noteOn',
      tick: 0,
      time: 0,
      note: 48,
      degree: 0,
      velocityOffset: 0.15,
      slide: true,
      roll: { hits: 3, ticks: 6, secondsPerTick: 0.025, gate: 1, open: true },
    };
    const part = recorder();
    playPitched(part, event, HITS, 0.6);
    expect(part.hits.map((hit) => hit.velocity)).toEqual(
      [0.75, 0.75, 0.75].map((v) => expect.closeTo(v, 12) as number),
    );
    expect(part.hits.map((hit) => hit.slide)).toEqual([true, false, false]);
  });
});
