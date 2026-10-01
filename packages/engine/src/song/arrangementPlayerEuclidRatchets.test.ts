/**
 * A Euclid part's ratchet row through the player (windsor#355): a step's
 * roll of N hits evenly across its swung span, each held at most its slice
 * and each carrying the step's lanes; silent on a rest, rolled wherever the
 * density modulator lands a hit on it; and live edits to the rows that keep
 * the generator, its `k`, its stream and its playhead.
 */
import { describe, expect, it } from 'vitest';

import { ALL_ON, KICK_SLOT, SECONDS_PER_TICK, figure, kickSong } from '../__fixtures__/euclidSongs';
import { rig } from '../__fixtures__/playerRig';
import type { Call } from '../__fixtures__/recordingPart';
import { euclid } from '../sequencing/euclid';
import { STEP_MOD_PARAMS } from '../worklet/fm/stepModTables';

const DIVISOR = 6;
const SPAN = DIVISOR * SECONDS_PER_TICK;
const triggers = (calls: readonly Call[]): Call[] => calls.filter((c) => c.kind === 'trigger');

/** The triggers grouped by the straight step their roll starts on. */
function rolls(calls: readonly Call[]): Map<number, Call[]> {
  const out = new Map<number, Call[]>();
  for (const call of triggers(calls)) {
    const step = Math.floor((call.time ?? 0) / SPAN + 1e-9);
    out.set(step, [...(out.get(step) ?? []), call]);
  }
  return out;
}

describe('Euclid ratchets (windsor#355)', () => {
  it('×2, ×3 and ×4 roll evenly across the step, each held min(hold, slice), each with the step’s lanes', () => {
    const ratchets = Array.from({ length: 16 }, () => 1);
    ratchets[0] = 2;
    ratchets[4] = 3;
    ratchets[8] = 4;
    ratchets[2] = 4; // under a rest: silent
    const sequencer = {
      pattern: figure(0, 4, 8, 12),
      ratchets,
      hold: 0.05,
      note: 50,
      accentLane: [true],
      pitchLane: [2],
      modLanes: [{ param: 'filter.cutoff' as const, values: [0.5] }],
    };
    const { parts, run } = rig(kickSong({ sequencer, part: { velocity: 0.5 } }));
    run(1);
    const byStep = rolls(parts.kick.calls);
    expect([...byStep.keys()]).toEqual([0, 4, 8, 12]);
    const stepMod = new Array<number>(STEP_MOD_PARAMS.length).fill(0);
    stepMod[STEP_MOD_PARAMS.indexOf('filter.cutoff')] = 0.5;
    for (const [step, roll] of byStep) {
      const n = ratchets[step]!;
      expect(roll, `step ${step}`).toHaveLength(n);
      roll.forEach((hit, j) => {
        expect(hit.time).toBeCloseTo(step * SPAN + (j * SPAN) / n, 12);
        expect(hit.duration).toBe(n === 1 ? 0.05 : Math.min(0.05, SPAN / n));
        expect(hit).toMatchObject({ note: 52, velocity: 0.7, extras: { mod: 1, stepMod } });
      });
    }
    // The hold wins where it is shorter than the slice.
    expect(byStep.get(4)?.[0]?.duration).toBe(0.05);
    expect(byStep.get(8)?.[0]?.duration).toBe(SPAN / 4);
  });

  it('a density change that moves a hit onto a ratcheted step rolls it', () => {
    // k walks 1..8 over the bars: E(1, 16) leaves step 2 a rest, E(8, 16) lights it.
    expect(euclid(1, 16)[2]).toBe(false);
    expect(euclid(8, 16)[2]).toBe(true);
    const ratchets = Array.from({ length: 16 }, (_, i) => (i === 2 ? 3 : 1));
    const sequencer = {
      ratchets,
      pulses: { min: 1, max: 8, start: 1 },
      density: { kind: 'lfoBars' as const, bars: 4, shape: 'tri' as const },
    };
    const { parts, run } = rig(kickSong({ sequencer }));
    run(4);
    const byStep = rolls(parts.kick.calls);
    const onStep2 = [...byStep.keys()].filter((step) => step % 16 === 2);
    const bars = new Set(onStep2.map((step) => Math.floor(step / 16)));
    expect(bars.size).toBeGreaterThan(0);
    expect(bars.size).toBeLessThan(4);
    for (const step of onStep2) expect(byStep.get(step), `step ${step}`).toHaveLength(3);
    for (const [step, roll] of byStep) if (step % 16 !== 2) expect(roll).toHaveLength(1);
  });

  it('with swing, a roll spans from its step’s swung time to the next step’s, across the bar line', () => {
    const sequencer = { pattern: ALL_ON, ratchets: Array.from({ length: 16 }, () => 2) };
    const { parts, run } = rig(
      kickSong({ sequencer, transport: { swing: { amount: 66, grid: 16 } } }),
    );
    run(2);
    const all = triggers(parts.kick.calls);
    expect(all).toHaveLength(64);
    const starts = all.filter((_, i) => i % 2 === 0).map((c) => c.time ?? 0);
    const seconds = all.filter((_, i) => i % 2 === 1).map((c) => c.time ?? 0);
    // Steps 0..16 of bar one: the first, every swung off-beat, the last, and over the bar line.
    for (let step = 0; step <= 16; step++) {
      const span = starts[step + 1]! - starts[step]!;
      expect(seconds[step], `step ${step}`).toBeCloseTo(starts[step]! + span / 2, 12);
    }
    // The swing moved the off-beats: the pairs' spans differ.
    expect(starts[1]! - starts[0]!).not.toBeCloseTo(starts[2]! - starts[1]!, 6);
  });
});

describe('live edits to the rows (windsor#355)', () => {
  it('a lane, a ratchet or an accent amount reconfigures: no cut, k, the stream and the playhead carry on', () => {
    // Every row present at its neutral value: a part partial merges only into keys the part has.
    const neutral = {
      density: { kind: 'walk' as const, stepChance: 0.8 },
      ratchets: Array.from({ length: 16 }, () => 1),
      accentVelocity: 0.2,
      accentMod: 1,
      accentLane: [false],
      pitchLane: [0],
      modLanes: [],
    };
    const control = rig(kickSong({ sequencer: neutral }));
    const edited = rig(kickSong({ sequencer: neutral }));
    control.run(2);
    edited.run(2);
    const before = edited.parts.kick.calls.length;
    const edits = [
      { accentLane: [true, false, true] },
      { pitchLane: [0, 5] },
      { modLanes: [{ param: 'filter.cutoff' as const, values: [0.25] }] },
      { ratchets: Array.from({ length: 16 }, (_, i) => (i % 4 === 0 ? 2 : 1)) },
      { accentVelocity: 0.1, accentMod: 0.3 },
    ];
    for (const sequencer of edits) {
      const result = edited.player.apply({ parts: { [KICK_SLOT]: { sequencer } } }, {});
      expect(result, JSON.stringify(sequencer)).toEqual({ ok: true, ignored: [] });
    }
    expect(edited.player.arrangement.parts[KICK_SLOT]?.sequencer).toMatchObject({ accentMod: 0.3 });
    for (let bar = 0; bar < 6; bar++) {
      control.run(1);
      edited.run(1);
      expect(edited.player.capturePattern(KICK_SLOT)).toEqual(
        control.player.capturePattern(KICK_SLOT),
      );
      const tick = (bar + 3) * 96 - 1;
      expect(edited.player.stepAt(KICK_SLOT, tick)).toBe(control.player.stepAt(KICK_SLOT, tick));
    }
    const since = edited.parts.kick.calls.slice(before);
    expect(since.filter((c) => c.kind === 'allNotesOff')).toEqual([]);
    expect(since.some((c) => c.extras?.mod === 0.3)).toBe(true);
  });

  it('a bad row is refused whole', () => {
    const { player } = rig(kickSong({ sequencer: { ratchets: [1] } }));
    const result = player.apply({ parts: { [KICK_SLOT]: { sequencer: { ratchets: [5] } } } }, {});
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/ratchets/);
  });
});
