/**
 * The Arp device's Gate bar rules (windsor#934, the approved
 * `docs/design/arp-gate-bar-mockup.html`): a cell's gate read, written,
 * dragged and labelled, and the played gate its fill shows.
 */
import { describe, expect, it } from 'vitest';

import { GATE_MIN, arpNote } from '@windsor/engine';
import {
  arpCellGate,
  arpGateLabel,
  arpGateTitle,
  arpPlayedGateAt,
  dragArpGate,
  setArpGate,
} from './arpGridModel';

describe('the Gate bar (windsor#934)', () => {
  const note = arpNote({ octave: 1, accent: true, slide: false });

  it('reads a cell gate of 1 when none is written, and for a rest or a tie', () => {
    expect(arpCellGate(note)).toBe(1);
    expect(arpCellGate({ ...note, gate: 0.25 })).toBe(0.25);
    expect(arpCellGate({ kind: 'rest' })).toBe(1);
    expect(arpCellGate({ kind: 'tie' })).toBe(1);
  });

  it('writes a snapped gate, floored at GATE_MIN, and removes it at 1 (decision 1)', () => {
    expect(setArpGate(note, 0.52)).toEqual({ ...note, gate: 0.5 });
    expect(setArpGate(note, 0)).toEqual({ ...note, gate: GATE_MIN });
    const back = setArpGate({ ...note, gate: 0.5 }, 1);
    expect(back).toEqual(note);
    expect('gate' in back).toBe(false);
    expect(setArpGate({ kind: 'rest' }, 0.5)).toEqual({ kind: 'rest' });
    expect(setArpGate({ kind: 'tie' }, 0.5)).toEqual({ kind: 'tie' });
  });

  it('sweeps 0 to 1 over an 80 px drag in steps of 0.05, up raising it', () => {
    expect(dragArpGate(0.5, -30)).toBe(0.9);
    expect(dragArpGate(0.5, -200)).toBe(1);
    expect(dragArpGate(0.25, 200)).toBe(GATE_MIN);
    expect(dragArpGate(1, 4)).toBe(0.95);
  });

  it('fills to the played gate as the engine plays it (decision 2, the mockup’s worked cells)', () => {
    expect(arpPlayedGateAt(0.8, 0.5)).toBeCloseTo(0.4, 12);
    expect(arpPlayedGateAt(0.8, 0.01)).toBe(GATE_MIN);
    expect(arpPlayedGateAt(0.8, 1)).toBe(0.8);
  });

  it('reads the cell’s own gate as the Vel bar reads velocity, and titles both', () => {
    expect([1, 0.5, 0.25, 0.01, 0.75].map(arpGateLabel)).toEqual(['1', '.5', '.25', '.01', '.75']);
    expect(arpGateTitle(0.5, 0.4)).toBe(
      'gate 0.50 (plays 0.4): drag up or down, double-click for 1',
    );
  });
});
