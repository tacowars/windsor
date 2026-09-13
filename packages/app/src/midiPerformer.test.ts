import { describe, expect, it } from 'vitest';

import type { MidiEvent } from './midiMessage';
import { MidiPerformer, type PerformerSink } from './midiPerformer';

function recorder(): { sink: PerformerSink; log: string[] } {
  const log: string[] = [];
  return {
    log,
    sink: {
      press: (note, velocity) => log.push(`on ${note} ${velocity}`),
      release: (note, force) => log.push(force ? `off! ${note}` : `off ${note}`),
      bend: (st) => log.push(`bend ${st}`),
      modWheel: (v) => log.push(`wheel ${v}`),
    },
  };
}

const on = (note: number, velocity = 0.5): MidiEvent => ({ type: 'noteOn', note, velocity });
const off = (note: number): MidiEvent => ({ type: 'noteOff', note });
const pedal = (down: boolean): MidiEvent => ({ type: 'sustain', down });

describe('MidiPerformer', () => {
  it('presses and releases', () => {
    const { sink, log } = recorder();
    const p = new MidiPerformer(sink);
    [on(60, 1), off(60)].forEach((e) => p.handle(e));
    expect(log).toEqual(['on 60 1', 'off 60']);
  });

  it('ignores a note-off for a key it never saw go down', () => {
    const { sink, log } = recorder();
    new MidiPerformer(sink).handle(off(60));
    expect(log).toEqual([]);
  });

  it('keeps released notes under the pedal and lets them go on pedal up, not held ones', () => {
    const { sink, log } = recorder();
    const p = new MidiPerformer(sink);
    [pedal(true), on(60), on(64), off(60), pedal(false)].forEach((e) => p.handle(e));
    expect(log).toEqual(['on 60 0.5', 'on 64 0.5', 'off 60']);
    p.handle(off(64));
    expect(log.at(-1)).toBe('off 64');
  });

  it('restarts a note struck again while the pedal keeps it', () => {
    const { sink, log } = recorder();
    const p = new MidiPerformer(sink);
    [pedal(true), on(60), off(60), on(60, 0.9), pedal(false)].forEach((e) => p.handle(e));
    // The re-strike releases the sustained voice first; pedal up then leaves
    // the held key alone.
    expect(log).toEqual(['on 60 0.5', 'off 60', 'on 60 0.9']);
  });

  it('passes bend and wheel through', () => {
    const { sink, log } = recorder();
    const p = new MidiPerformer(sink);
    p.handle({ type: 'bend', semitones: -1.5 });
    p.handle({ type: 'modWheel', value: 0.25 });
    expect(log).toEqual(['bend -1.5', 'wheel 0.25']);
  });

  it('releases held and sustained notes and rests expression when the device is lost', () => {
    const { sink, log } = recorder();
    const p = new MidiPerformer(sink);
    [pedal(true), on(60), off(60), on(67)].forEach((e) => p.handle(e));
    log.length = 0;
    p.releaseAll();
    // Forced: a lost device's notes go even while the console's Hold latch is on.
    expect(log.sort()).toEqual(['bend 0', 'off! 60', 'off! 67', 'wheel 0']);
    log.length = 0;
    p.handle(pedal(false));
    p.handle(off(67));
    expect(log).toEqual([]);
  });

  it('keeps two inputs apart when both hold the same pitch', () => {
    const a = recorder();
    const b = recorder();
    const keys = new MidiPerformer(a.sink);
    const pads = new MidiPerformer(b.sink);
    keys.handle(on(60));
    pads.handle(on(60));
    keys.handle({ type: 'sustain', down: true });
    pads.handle(off(60));
    keys.handle(off(60));
    // The pad's release is its own; the keyboard's note is held by its own pedal.
    expect(a.log).toEqual(['on 60 0.5']);
    expect(b.log).toEqual(['on 60 0.5', 'off 60']);
  });

  it('forgets after Panic without releasing again', () => {
    const { sink, log } = recorder();
    const p = new MidiPerformer(sink);
    [pedal(true), on(60)].forEach((e) => p.handle(e));
    log.length = 0;
    p.forget();
    [off(60), pedal(false)].forEach((e) => p.handle(e));
    expect(log).toEqual([]);
    p.handle(on(62));
    p.handle(off(62));
    expect(log).toEqual(['on 62 0.5', 'off 62']);
  });
});
