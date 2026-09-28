/**
 * A pitched note-on as its part plays it (#602, windsor#17): the accent's
 * velocity bump and mod, the slide, a step's offsets, and no extras at all
 * for a plain note.
 */
import { describe, expect, it } from 'vitest';

import type { NoteOnEvent } from '../sequencing/noteEvent';
import { partNoteOn } from './partNoteOn';

const on = (over: Partial<NoteOnEvent> = {}): NoteOnEvent => ({
  kind: 'noteOn',
  tick: 0,
  time: 0,
  note: 60,
  degree: 0,
  ...over,
});

describe('partNoteOn', () => {
  it('a plain note plays at the part’s velocity with no extras', () => {
    expect(partNoteOn(on(), 0.7)).toEqual({ velocity: 0.7, extras: undefined });
  });

  it('an accent bumps the velocity, capped at 1, and sends its mod', () => {
    const played = partNoteOn(on({ accent: { velocity: 0.5, mod: 0.8 } }), 0.7);
    expect(played).toStrictEqual({ velocity: 1, extras: { mod: 0.8, slide: false } });
  });

  it('a slide is flagged with no mod', () => {
    expect(partNoteOn(on({ slide: true }), 0.7).extras).toStrictEqual({ mod: 0, slide: true });
  });

  it('a step’s offsets ride along, alone or with the accent', () => {
    const stepMod = [0, 0.5];
    expect(partNoteOn(on({ stepMod }), 0.7).extras).toStrictEqual({
      mod: 0,
      slide: false,
      stepMod,
    });
    const both = partNoteOn(on({ stepMod, accent: { velocity: 0.1, mod: 1 } }), 0.7);
    expect(both.extras).toStrictEqual({ mod: 1, slide: false, stepMod });
  });
});
