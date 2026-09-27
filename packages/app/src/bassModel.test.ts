import { describe, expect, it } from 'vitest';

import { BASS_PITCH_MODES, DEFAULT_BASS_CONFIG, SCALES, partAt } from '@windsor/engine';
import { BASS_RESEED_SPAN } from './bassConstants';
import {
  BASS_MODE_OPTIONS,
  bassControlsEnabled,
  fixedDegreeOptions,
  isBassPitchMode,
  reseedChange,
  seedFromText,
} from './bassModel';
import { partChange } from './context';
import { DocumentModel } from './documentModel';
import { newSong, setSequencerKind } from './songParts';

const C_MINOR = { root: 0, scale: 'naturalMinor' } as const;

describe('the pitch mode', () => {
  it('offers the engine’s three modes in order', () => {
    expect(BASS_MODE_OPTIONS.map((o) => o.value)).toEqual([...BASS_PITCH_MODES]);
    expect(BASS_MODE_OPTIONS.map((o) => o.label)).toEqual(['Follow Root', 'Follow Chord', 'Fixed']);
    expect(isBassPitchMode('fixed')).toBe(true);
    expect(isBassPitchMode('step')).toBe(false);
  });

  it('enables Root bias for Follow Chord only and the Fixed degree for Fixed only', () => {
    expect(bassControlsEnabled('followRoot')).toEqual({ rootBias: false, fixedDegree: false });
    expect(bassControlsEnabled('followChord')).toEqual({ rootBias: true, fixedDegree: false });
    expect(bassControlsEnabled('fixed')).toEqual({ rootBias: false, fixedDegree: true });
  });
});

describe('fixedDegreeOptions', () => {
  it('names the seven numerals of a seven-note scale with their pitches', () => {
    const options = fixedDegreeOptions(C_MINOR, 0);
    expect(options).toHaveLength(SCALES.naturalMinor.length);
    expect(options.map((o) => o.label)).toEqual([
      'I C',
      'II D',
      'III D#',
      'IV F',
      'V G',
      'VI G#',
      'VII A#',
    ]);
  });

  it('keeps a written degree past the scale, folded with its carry', () => {
    const options = fixedDegreeOptions(C_MINOR, 9);
    expect(options.at(-1)).toEqual({ value: '9', label: 'X D# +1' });
  });
});

describe('the seed', () => {
  it('accepts a typed safe integer and refuses anything else', () => {
    expect(seedFromText(' 42 ')).toBe(42);
    expect(seedFromText('-3')).toBe(-3);
    expect(seedFromText('')).toBeNull();
    expect(seedFromText('1.5')).toBeNull();
    expect(seedFromText('abc')).toBeNull();
    expect(seedFromText(String(2 ** 60))).toBeNull();
  });

  it('Reseed draws across the 32-bit span', () => {
    expect(reseedChange(() => 0)).toEqual({ seed: 0 });
    expect(reseedChange(() => 0.5)).toEqual({ seed: BASS_RESEED_SPAN / 2 });
  });

  it('Reseed writes the document', () => {
    const model = new DocumentModel(newSong());
    const slot = model.doc.parts[0]!.slot;
    model.open(setSequencerKind(model.doc, slot, 'bass'));
    const change = reseedChange(() => 0.25);
    model.merge(partChange(slot, { sequencer: change }));
    const sequencer = partAt(model.doc, slot)?.sequencer;
    expect(sequencer?.kind).toBe('bass');
    expect(sequencer && 'seed' in sequencer ? sequencer.seed : null).toBe(change.seed);
    expect(sequencer && sequencer.kind === 'bass' ? sequencer.pitchMode : null).toBe(
      DEFAULT_BASS_CONFIG.pitchMode,
    );
  });
});
