/**
 * Basslead's step strip through the player (windsor#367, record
 * `2026-10-01-sequencer-rack-devices` decisions 6 and 9): a ratchet's hits
 * placed across the step and each held the gate times its slice, one
 * density draw per step so a skipped step plays no hit, the strip's count
 * restarting at a region entry, and an accent and a lane reaching the part.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { Arrangement, BassSpec, Harmony, PartRegion } from './arrangement';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DEFAULT_BASS_CONFIG, bassNote, type BassStep } from '../sequencing/bassSequencer';
import { ScaleSampler, SEMITONES_PER_OCTAVE } from '../sequencing/scaleSampler';
import { DIVISORS, PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';

const BPM = 120;
const TICK = SECONDS_PER_MINUTE / BPM / PPQ;
const QUARTER = DIVISORS.quarter;
const BAR = TICKS_PER_BAR;
const OCTAVE = 2;
const REST: BassStep = { kind: 'rest' };
/** C natural minor, i for the whole song. */
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [{ start: 0, duration: 4 * BAR, degree: 0, size: 3 }],
};
const C2 = new ScaleSampler(HARMONY).noteFor(0, OCTAVE);
const C3 = C2 + SEMITONES_PER_OCTAVE;

/** A fixed C2 at quarters over `steps`, the loop the whole strip. */
function song(over: Partial<BassSpec>, regions?: readonly PartRegion[]): Arrangement {
  const steps = over.steps ?? DEFAULT_BASS_CONFIG.steps;
  const sequencer: BassSpec = {
    kind: 'bass',
    ...DEFAULT_BASS_CONFIG,
    pitchMode: 'fixed',
    divisor: QUARTER,
    register: { octave: OCTAVE },
    length: steps.length,
    ...over,
  };
  const base = {
    ...FULL_ARRANGEMENT,
    transport: { ...FULL_ARRANGEMENT.transport, bpm: BPM },
    harmony: HARMONY,
  };
  return withPart(base, 'drone', { sequencer, ...(regions ? { regions } : {}) });
}

function play(arrangement: Arrangement, bars = 1): Call[] {
  const r = rig(arrangement);
  r.run(bars);
  return r.parts.drone.calls;
}

/** A call as `[kind, start tick, held ticks]`, ticks rounded to a thousandth. */
const at = (c: Call): [string, number, number | undefined] => [
  c.kind,
  Math.round(((c.time ?? 0) / TICK) * 1000) / 1000,
  c.duration === undefined ? undefined : Math.round((c.duration / TICK) * 1000) / 1000,
];
const sounding = (calls: readonly Call[]): Call[] =>
  calls.filter((c) => c.kind === 'noteOn' || c.kind === 'trigger');
const stepOf = (c: Call): number => Math.floor((c.time ?? 0) / (QUARTER * TICK) + 1e-9);

describe('Basslead’s strip through the player (windsor#367)', () => {
  it('a ratchet of 3 at gate 0.5 plays three hits, each held half its slice', () => {
    const calls = play(song({ gate: 0.5, steps: [bassNote({ ratchet: 3 }), REST, REST, REST] }));
    const slice = QUARTER / 3;
    expect(calls.map(at)).toEqual([
      ['trigger', 0, slice / 2],
      ['trigger', slice, slice / 2],
      ['trigger', 2 * slice, slice / 2],
    ]);
    expect(calls.every((c) => c.note === C2)).toBe(true);
  });

  it('a density skip on a ratcheted step plays none of its hits; a struck one plays all three', () => {
    const plain = sounding(play(song({ gate: 0.5, density: 0.5, seed: 4 }), 4)).map(stepOf);
    const ratchet = [bassNote({ ratchet: 3 })];
    const calls = play(song({ gate: 0.5, density: 0.5, seed: 4, steps: ratchet }), 4);
    expect(calls.every((c) => c.kind === 'trigger')).toBe(true);
    const hits = calls.map(stepOf);
    expect(hits).toEqual(plain.flatMap((step) => [step, step, step]));
    expect(plain.length).toBeGreaterThan(0);
    expect(plain.length).toBeLessThan(16);
  });

  it('restarts the strip at a region entry', () => {
    const steps = [bassNote({ octave: 1 }), bassNote()];
    // The second region enters on transport step 5: the strip is on step 0 there, not step 1.
    const regions = [
      { start: 0, duration: 3 * QUARTER },
      { start: 5 * QUARTER, duration: 2 * QUARTER },
    ];
    const notes = sounding(play(song({ gate: 0.5, steps }, regions), 2)).map((c) => [
      stepOf(c),
      c.note,
    ]);
    expect(notes).toEqual([
      [0, C3],
      [1, C2],
      [2, C3],
      [5, C3],
      [6, C2],
    ]);
  });

  it('an accented step and a lane reach the part as the Grid’s do', () => {
    const lanes = [{ param: 'filter.cutoff' as const, values: [0.5, 0] }];
    const steps = [bassNote({ accent: true }), bassNote()];
    const [accented, plain] = sounding(
      play(song({ gate: 0.5, accentVelocity: 0.2, accentMod: 0.7, steps, lanes })),
    );
    expect(accented?.velocity).toBeGreaterThan(plain?.velocity ?? 1);
    expect(accented?.extras?.mod).toBe(0.7);
    expect(accented?.extras?.stepMod).toBeDefined();
    expect(plain?.extras).toBeUndefined();
  });
});
