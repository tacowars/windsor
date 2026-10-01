/**
 * An Arp cell's ratchet through the player (windsor#366, record
 * `2026-10-01-sequencer-rack-devices` decision 6): a roll of N hits of the
 * walked note evenly across the step, each held the gate times its slice;
 * the last hit held open into a tie, or to the next onset at gate 1; one
 * walk and one skip draw per step, so the pitches and the skipped steps are
 * those of the same arp without ratchets; and the hits past a region end
 * dropped.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { Arrangement, ArpSpec, Harmony, PartRegion } from './arrangement';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DEFAULT_ARP_CONFIG } from '../sequencing/arpSequencer';
import { arpNote, type ArpStep } from '../sequencing/arpSteps';
import { DIVISORS, PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';

const BPM = 120;
const TICK = SECONDS_PER_MINUTE / BPM / PPQ;
const SIXTEENTH = DIVISORS.sixteenth;
const SPAN = SIXTEENTH * TICK;
const TIE: ArpStep = { kind: 'tie' };
const REST: ArpStep = { kind: 'rest' };
/** C natural minor, i for the whole song: a three-note list, a three-cell cycle. */
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [{ start: 0, duration: 4 * TICKS_PER_BAR, degree: 0, size: 3 }],
};

/** Every cell `cells[k mod length]`. */
const steps = (...cells: ArpStep[]): ArpStep[] =>
  DEFAULT_ARP_CONFIG.steps.map((_, k) => cells[k % cells.length] as ArpStep);

function song(over: Partial<ArpSpec>, regions?: readonly PartRegion[]): Arrangement {
  const sequencer: ArpSpec = { kind: 'arp', ...DEFAULT_ARP_CONFIG, divisor: SIXTEENTH, ...over };
  const base = {
    ...FULL_ARRANGEMENT,
    transport: { ...FULL_ARRANGEMENT.transport, bpm: BPM },
    harmony: HARMONY,
  };
  return withPart(base, 'arp', { sequencer, ...(regions ? { regions } : {}) });
}

function play(arrangement: Arrangement, bars = 1): Call[] {
  const r = rig(arrangement);
  r.run(bars);
  return r.parts.arp.calls;
}

/** A call as `[kind, start tick, held ticks]`, ticks rounded to a thousandth. */
const at = (c: Call): [string, number, number | undefined] => [
  c.kind,
  Math.round(((c.time ?? 0) / TICK) * 1000) / 1000,
  c.duration === undefined ? undefined : Math.round((c.duration / TICK) * 1000) / 1000,
];

const stepOf = (c: Call): number => Math.floor((c.time ?? 0) / SPAN + 1e-9);
const sounding = (calls: readonly Call[]): Call[] =>
  calls.filter((c) => c.kind === 'noteOn' || c.kind === 'trigger');

describe('Arp ratchets through the player (windsor#366)', () => {
  it('×2 at gate 0.5 holds each hit a quarter of the step, and leaves nothing held', () => {
    const calls = play(song({ gate: 0.5, steps: steps(arpNote({ ratchet: 2 })) }));
    const plain = sounding(play(song({ gate: 0.5 })));
    expect(calls.every((c) => c.kind === 'trigger')).toBe(true);
    expect(calls).toHaveLength(32);
    calls.forEach((hit, j) => {
      const step = Math.floor(j / 2);
      expect(at(hit), `hit ${j}`).toEqual(['trigger', step * SIXTEENTH + (j % 2) * 3, 1.5]);
      expect(hit.note).toBe(plain[step]?.note);
    });
  });

  it('a tie after it holds the last hit open, to the tie’s gate', () => {
    const calls = play(song({ gate: 0.5, steps: steps(arpNote({ ratchet: 2 }), TIE, REST) }));
    expect(calls.slice(0, 3).map(at)).toEqual([
      ['trigger', 0, 1.5],
      ['noteOn', 3, undefined],
      ['noteOffByNote', SIXTEENTH + 3, undefined],
    ]);
    expect(calls[1]?.note).toBe(calls[0]?.note);
    expect(calls[2]?.note).toBe(calls[0]?.note);
  });

  it('at gate 1 the last hit runs to the next onset, which releases it', () => {
    const calls = play(song({ gate: 1, steps: steps(arpNote({ ratchet: 2 })) }));
    expect(calls.slice(0, 4).map(at)).toEqual([
      ['trigger', 0, 3],
      ['noteOn', 3, undefined],
      ['noteOffByNote', SIXTEENTH, undefined],
      ['trigger', SIXTEENTH, 3],
    ]);
  });

  it('walks and skips exactly as without ratchets, and a skipped cell plays no hit', () => {
    const over = { gate: 0.5, skipChance: 0.5, style: 'random' as const, seed: 3 };
    const without = sounding(play(song(over), 4));
    const withRatchets = sounding(
      play(song({ ...over, steps: steps(arpNote({ ratchet: 3 })) }), 4),
    );
    expect(without.length).toBeGreaterThan(16);
    expect(without.length).toBeLessThan(48);
    const firstHits = withRatchets.filter((_, j) => j % 3 === 0);
    expect(firstHits.map(stepOf)).toEqual(without.map(stepOf));
    expect(firstHits.map((c) => c.note)).toEqual(without.map((c) => c.note));
    expect(withRatchets).toHaveLength(3 * without.length);
  });

  it('a region end inside a roll drops the hits past it, and no hold crosses it', () => {
    const regions = [{ start: 0, duration: SIXTEENTH + 3 }];
    const calls = play(song({ gate: 0.5, steps: steps(arpNote({ ratchet: 4 })) }, regions));
    expect(calls.map(at)).toEqual([
      ['trigger', 0, 0.75],
      ['trigger', 1.5, 0.75],
      ['trigger', 3, 0.75],
      ['trigger', 4.5, 0.75],
      ['trigger', 6, 0.75],
      ['trigger', 7.5, 0.75],
    ]);
  });
});
