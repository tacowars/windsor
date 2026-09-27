import { describe, expect, it } from 'vitest';

import { ALL_INPUTS, inputOptions, listeningLabel, listensTo } from './midiInputs';

const keys = { name: 'KeyLab 61', connected: true };
const pads = { name: 'MPD218', connected: true };
const gone = { name: 'KeyLab 61', connected: false };

describe('MIDI input selection', () => {
  it('All inputs hears every connected device, a name hears only that device', () => {
    expect(listensTo(keys, ALL_INPUTS)).toBe(true);
    expect(listensTo(pads, ALL_INPUTS)).toBe(true);
    expect(listensTo(keys, 'KeyLab 61')).toBe(true);
    expect(listensTo(pads, 'KeyLab 61')).toBe(false);
    expect(listensTo(gone, 'KeyLab 61')).toBe(false);
    expect(listensTo(gone, ALL_INPUTS)).toBe(false);
  });

  it('offers all, each connected device once, and keeps a remembered absent one visible', () => {
    expect(inputOptions([keys, pads], ALL_INPUTS)).toEqual([
      { value: ALL_INPUTS, label: 'All inputs' },
      { value: 'KeyLab 61', label: 'KeyLab 61' },
      { value: 'MPD218', label: 'MPD218' },
    ]);
    expect(inputOptions([pads, gone], 'KeyLab 61')).toEqual([
      { value: ALL_INPUTS, label: 'All inputs' },
      { value: 'MPD218', label: 'MPD218' },
      { value: 'KeyLab 61', label: 'KeyLab 61 (disconnected)' },
    ]);
    // Two ports with one name (a device exposing a second port) list once.
    expect(inputOptions([keys, { ...keys }], 'KeyLab 61')).toHaveLength(2);
  });

  it('says what it is hearing, or what it is waiting for', () => {
    expect(listeningLabel([keys, pads], ALL_INPUTS)).toBe('MIDI: KeyLab 61, MPD218');
    expect(listeningLabel([keys, pads], 'MPD218')).toBe('MIDI: MPD218');
    expect(listeningLabel([pads, gone], 'KeyLab 61')).toBe('MIDI: waiting for KeyLab 61');
    expect(listeningLabel([], ALL_INPUTS)).toBe('MIDI: no inputs connected');
  });
});
