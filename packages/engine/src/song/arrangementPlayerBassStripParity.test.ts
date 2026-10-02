/**
 * A Basslead with no `steps` plays exactly what it played before the step
 * strip (windsor#367, decision 6): a part written without the strip fields
 * goes through the normaliser, which gives it one bar of plain notes, and
 * every call it makes over four swung bars, with a chord change, a seventh
 * and a region gap, is digested. Each pitch mode is played at gate 1 and
 * gate 0.6, at a density that rests. The digests were read from `main`
 * before the strip, so any drift in what an unwritten strip plays fails here.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, withPart } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { Arrangement, Harmony, SequencerSpec } from './arrangement';
import { FieldNormaliser } from './arrangementFields';
import { normaliseSequencer } from './sequencerNormalise';
import { TICKS_PER_BAR } from '../sequencing/scheduler';

const BAR = TICKS_PER_BAR;
const BARS = 4;
const SIXTEENTH = 6;

/** C natural minor: i, then a VI seventh, then iv. */
const HARMONY: Harmony = {
  root: 0,
  scale: 'naturalMinor',
  events: [
    { start: 0, duration: BAR, degree: 0, size: 3 },
    { start: BAR, duration: 2 * BAR, degree: 5, size: 4 },
    { start: 3 * BAR, duration: BAR, degree: 3, size: 3 },
  ],
};

/** A Basslead as a song without the strip writes it, through the normaliser. */
function bass(pitchMode: string, gate: number, divisor: number): SequencerSpec {
  const n = new FieldNormaliser();
  const raw = {
    kind: 'bass',
    pitchMode,
    rootBias: 0.5,
    fixedDegree: 4,
    divisor,
    gate,
    register: { octave: 2 },
    density: 0.7,
    seed: 11,
  };
  const spec = normaliseSequencer(raw, 'parts[3].sequencer', n);
  expect(n.corrections).toEqual([]);
  return spec;
}

/** Swung, the part out for half of bar 2. */
function song(sequencer: SequencerSpec): Arrangement {
  const base: Arrangement = {
    ...FULL_ARRANGEMENT,
    harmony: HARMONY,
    transport: { ...FULL_ARRANGEMENT.transport, swing: { amount: 62, grid: 16 } },
  };
  return withPart(base, 'drone', {
    regions: [
      { start: 0, duration: BAR + BAR / 2 },
      { start: 2 * BAR, duration: 2 * BAR },
    ],
    sequencer,
  });
}

/** What the part's calls hash to, times to the nanosecond. */
function digest(calls: readonly Call[]): string {
  const rounded = calls.map((c) => ({ ...c, time: Math.round((c.time ?? 0) * 1e9) }));
  return createHash('sha256').update(JSON.stringify(rounded)).digest('hex').slice(0, 16);
}

function play(
  pitchMode: string,
  gate: number,
  divisor = SIXTEENTH,
): { count: number; digest: string } {
  const r = rig(song(bass(pitchMode, gate, divisor)));
  r.run(BARS);
  const calls = r.parts.drone.calls;
  return { count: calls.length, digest: digest(calls) };
}

describe('a Basslead with no steps plays as before (windsor#367)', () => {
  it.each([
    ['followRoot', 1, { count: 22, digest: '77c7618051555c85' }],
    ['followRoot', 0.6, { count: 94, digest: '346cbd6deb1055f7' }],
    ['followChord', 1, { count: 60, digest: 'de6329d6a9f829c9' }],
    ['followChord', 0.6, { count: 80, digest: '2a61ebdb1a5a332b' }],
    ['fixed', 1, { count: 20, digest: '662ec5614974ed88' }],
    ['fixed', 0.6, { count: 94, digest: '8c993225b3364ec8' }],
  ] as const)('%s at gate %s', (pitchMode, gate, expected) => {
    expect(play(pitchMode, gate)).toEqual(expected);
  });

  it('at quarters, four steps a bar', () => {
    expect(play('followChord', 1, 24)).toEqual({ count: 16, digest: 'e624471f9b86a127' });
  });

  it('at a divisor of 2, past the 32 steps a strip holds', () => {
    expect(play('followChord', 0.6, 2)).toEqual({ count: 246, digest: '9c7984f6d45b62bc' });
  });
});
