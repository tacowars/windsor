/** An automation target's value as it reads, in its catalog row's units (windsor#348, windsor#424). */
import { describe, expect, it } from 'vitest';
import { catalogRow, type AutomationTargetRow } from '@windsor/engine';
import { readout } from './automationReadout';

const row = (target: string): AutomationTargetRow => catalogRow(target)!;

describe('the readout', () => {
  it('reads a level in dB, -∞ at the floor', () => {
    expect(readout(row('strip.level'), 1)).toBe('+0.0 dB');
    // A gain a hair under 1, as a round trip through display space leaves it, still reads +0.0.
    expect(readout(row('strip.level'), 0.9999999999999998)).toBe('+0.0 dB');
    expect(readout(row('strip.level'), 0.5)).toBe('-6.0 dB');
    expect(readout(row('strip.level'), 0)).toBe('-∞ dB');
  });

  it('reads pan as L, C and R', () => {
    expect(readout(row('strip.pan'), 0)).toBe('C');
    expect(readout(row('strip.pan'), -0.5)).toBe('L50');
    expect(readout(row('strip.pan'), 0.25)).toBe('R25');
  });

  it('reads each unit', () => {
    expect(readout(row('voice.filter.cutoff'), 2400)).toBe('2.40 kHz');
    expect(readout(row('voice.filter.cutoff'), 440)).toBe('440 Hz');
    expect(readout(row('voice.lfo.rate'), 0.5)).toBe('0.50 Hz');
    expect(readout(row('voice.filter.env.decayTime'), 0.25)).toBe('250 ms');
    expect(readout(row('voice.filter.env.decayTime'), 1.5)).toBe('1.50 s');
    expect(readout(row('voice.filter.envAmount'), 1.5)).toBe('+1.5 oct');
    expect(readout(row('voice.pitchEnvAmount'), -12)).toBe('-12.0 st');
    expect(readout(row('voice.filter.vowel'), 0)).toBe('a');
    expect(readout(row('voice.filter.vowel'), 0.5)).toBe('a→e 50%');
    expect(readout(row('voice.filter.vowel'), 3.25)).toBe('o→u 25%');
    expect(readout(row('voice.filter.vowel'), 4)).toBe('u');
    expect(readout(row('strip.send.a'), 0.3)).toBe('0.30');
    expect(readout({ ...row('strip.send.a'), unit: '%' }, 25)).toBe('25%');
  });
});
