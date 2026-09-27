import { describe, expect, it } from 'vitest';

import { BEND_RANGE_SEMITONES } from './midiConstants';
import { decodeMidi } from './midiMessage';

describe('decodeMidi', () => {
  it('reads note-on with linear velocity, on any channel', () => {
    expect(decodeMidi([0x90, 60, 127])).toEqual({ type: 'noteOn', note: 60, velocity: 1 });
    expect(decodeMidi([0x9f, 36, 64])).toEqual({ type: 'noteOn', note: 36, velocity: 64 / 127 });
  });

  it('treats note-on at velocity 0 and 0x80 as note-off', () => {
    expect(decodeMidi([0x90, 60, 0])).toEqual({ type: 'noteOff', note: 60 });
    expect(decodeMidi([0x83, 61, 40])).toEqual({ type: 'noteOff', note: 61 });
  });

  it('reads the mod wheel and the sustain pedal threshold', () => {
    expect(decodeMidi([0xb0, 1, 127])).toEqual({ type: 'modWheel', value: 1 });
    expect(decodeMidi([0xb2, 1, 0])).toEqual({ type: 'modWheel', value: 0 });
    expect(decodeMidi([0xb0, 64, 64])).toEqual({ type: 'sustain', down: true });
    expect(decodeMidi([0xb0, 64, 63])).toEqual({ type: 'sustain', down: false });
  });

  it('reads 14-bit pitch bend: centre is rest, the extremes are the range', () => {
    expect(decodeMidi([0xe0, 0x00, 0x40])).toEqual({ type: 'bend', semitones: 0 });
    const up = decodeMidi([0xe0, 0x7f, 0x7f]);
    const down = decodeMidi([0xe0, 0x00, 0x00]);
    expect(up).toEqual({ type: 'bend', semitones: BEND_RANGE_SEMITONES });
    expect(down).toEqual({ type: 'bend', semitones: -BEND_RANGE_SEMITONES });
    expect(decodeMidi([0xe0, 0x7f, 0x7f], 12)).toEqual({ type: 'bend', semitones: 12 });
  });

  it('ignores what the console does not play', () => {
    expect(decodeMidi([0xa0, 60, 50])).toBeNull(); // poly aftertouch
    expect(decodeMidi([0xd0, 50])).toBeNull(); // channel aftertouch
    expect(decodeMidi([0xc0, 5])).toBeNull(); // program change
    expect(decodeMidi([0xb0, 7, 100])).toBeNull(); // volume CC
    expect(decodeMidi([0xf8])).toBeNull(); // clock
    expect(decodeMidi([])).toBeNull();
  });
});
