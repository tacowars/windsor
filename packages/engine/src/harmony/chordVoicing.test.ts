import { describe, expect, it } from 'vitest';

import { CHORD_VOICING_NOTES_MAX, SCALES } from '../audioConstants';
import { CHORD_VOICING_IDS, type ChordVoicingId } from './chordTables';
import { chordTones } from './chordTheory';
import { invertStack, voiceChord, type VoiceOptions } from './chordVoicing';

const MAJ = chordTones(SCALES.major, 0, 3);
const MAJ7 = chordTones(SCALES.major, 0, 4);
const at = (over: Partial<VoiceOptions> = {}): VoiceOptions => ({
  inversion: 0,
  voicing: 'close',
  octave: 0,
  semitone: 0,
  ...over,
});

describe('chordVoicing', () => {
  it('C maj close from 60 is the triad, and inversions rotate with octave carry', () => {
    expect(voiceChord(MAJ, at(), 60)).toEqual([60, 64, 67]);
    expect(voiceChord(MAJ, at({ inversion: 1 }), 60)).toEqual([64, 67, 72]);
    expect(voiceChord(MAJ, at({ inversion: 2 }), 60)).toEqual([67, 72, 76]);
    expect(voiceChord(MAJ, at({ inversion: 3 }), 60)).toEqual([72, 76, 79]);
    expect(invertStack([], 2)).toEqual([]);
  });

  it('voices a seventh: drop2, drop3, spread, shell', () => {
    expect(voiceChord(MAJ7, at({ voicing: 'drop2' }), 60)).toEqual([55, 60, 64, 71]);
    expect(voiceChord(MAJ7, at({ voicing: 'drop3' }), 60)).toEqual([52, 60, 67, 71]);
    expect(voiceChord(MAJ7, at({ voicing: 'spread' }), 60)).toEqual([48, 55, 64, 71]);
    expect(voiceChord(MAJ7, at({ voicing: 'shell' }), 60)).toEqual([60, 64, 71]);
  });

  it('octaves & 3rds doubles the root and third an octave up; shell on a triad is close', () => {
    expect(voiceChord(MAJ, at({ voicing: 'octaves3rds' }), 60)).toEqual([60, 64, 72, 76]);
    expect(voiceChord(MAJ, at({ voicing: 'shell' }), 60)).toEqual([60, 64, 67]);
    expect(voiceChord(MAJ, at({ voicing: 'drop3' }), 60)).toEqual([48, 64, 67]);
  });

  it('octave and semitone shift every note', () => {
    expect(voiceChord(MAJ, at({ octave: 1 }), 60)).toEqual([72, 76, 79]);
    expect(voiceChord(MAJ, at({ semitone: 1 }), 60)).toEqual([61, 65, 68]);
    expect(voiceChord(MAJ, at({ octave: -1, semitone: -11 }), 60)).toEqual([37, 41, 44]);
  });

  it('drops notes outside the MIDI range and keeps the rest', () => {
    expect(voiceChord(MAJ, at({ octave: 5 }), 60)).toEqual([120, 124, 127]);
    expect(voiceChord(MAJ, at({ octave: 6 }), 60)).toEqual([]);
    expect(voiceChord(MAJ7, at({ voicing: 'spread', octave: -5 }), 60)).toEqual([4, 11]);
  });

  it('clip: false keeps the notes outside the MIDI range, still ascending and unique', () => {
    expect(voiceChord(MAJ, at({ octave: 6, clip: false }), 60)).toEqual([132, 136, 139]);
    expect(voiceChord(MAJ, at({ octave: -6, clip: false }), 60)).toEqual([-12, -8, -5]);
    expect(voiceChord(MAJ, at({ octave: 6, clip: true }), 60)).toEqual([]);
  });

  it('never exceeds the note cap, dedupes, and voices a one-note stack', () => {
    for (const voicing of CHORD_VOICING_IDS) {
      expect(voiceChord(MAJ7, at({ voicing }), 60).length).toBeLessThanOrEqual(
        CHORD_VOICING_NOTES_MAX,
      );
    }
    expect(voiceChord([0, 0, 0], at({ voicing: 'octaves3rds' }), 60)).toEqual([60, 72]);
    expect(voiceChord([0], at({ voicing: 'drop2' }), 60)).toEqual([60]);
    expect(voiceChord(MAJ, at({ voicing: 'nope' as ChordVoicingId }), 60)).toEqual([60, 64, 67]);
  });
});
