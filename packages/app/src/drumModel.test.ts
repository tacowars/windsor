/**
 * The Drum device's pitch rules (windsor#951, record `2026-10-24-drum-device`
 * decision 1): the Pitch cell names the note the engine plays, and its
 * gestures and the Note box stay inside their ranges.
 */
import { DRUM_PITCH_MAX, drumHit } from '@windsor/engine';
import { describe, expect, it } from 'vitest';
import {
  dragPitch,
  noteStep,
  noteText,
  pitchLabel,
  pitchTitle,
  playedNote,
  setHitPitch,
} from './drumModel';

describe('the played note', () => {
  it('is the note plus the offset, moved by octaves back into MIDI', () => {
    expect(playedNote(60, 3)).toBe(63);
    expect(playedNote(60, -2)).toBe(58);
    expect(playedNote(120, 12)).toBe(120);
    expect(playedNote(5, -10)).toBe(7);
  });

  it('reads as the Roll names a note, the offset in the tooltip', () => {
    expect(pitchLabel(60, 0)).toBe('C4');
    expect(pitchLabel(60, 3)).toBe('D#4');
    expect(pitchLabel(60, -2)).toBe('A#3');
    expect(pitchTitle(60, 3)).toBe('D#4 (+3 from Note): drag up or down, double-click for C4');
    expect(pitchTitle(60, 0)).toBe('C4 (0 from Note): drag up or down, double-click for C4');
  });
});

describe('the Pitch cell', () => {
  it('drags a semitone per 8 px, up raising it, within ±24', () => {
    expect(dragPitch(0, -8)).toBe(1);
    expect(dragPitch(0, 16)).toBe(-2);
    expect(dragPitch(3, -4)).toBe(4);
    expect(dragPitch(20, -400)).toBe(DRUM_PITCH_MAX);
    expect(dragPitch(-20, 400)).toBe(-DRUM_PITCH_MAX);
  });

  it('writes the offset on a hit, none at 0, and leaves a rest alone', () => {
    expect(setHitPitch(drumHit(), 5)).toEqual({ kind: 'hit', accent: false, pitch: 5 });
    expect(setHitPitch(drumHit({ pitch: 5 }), 0)).toEqual({ kind: 'hit', accent: false });
    expect(setHitPitch(drumHit(), 99)).toEqual({ kind: 'hit', accent: false, pitch: 24 });
    expect(setHitPitch({ kind: 'rest' }, 3)).toEqual({ kind: 'rest' });
  });
});

describe('the Note box', () => {
  it('reads name and number, and steps a semitone within MIDI', () => {
    expect(noteText(60)).toBe('C4 · 60');
    expect(noteStep(60, 1)).toBe(61);
    expect(noteStep(60, -1)).toBe(59);
    expect(noteStep(0, -1)).toBeNull();
    expect(noteStep(127, 1)).toBeNull();
  });
});
