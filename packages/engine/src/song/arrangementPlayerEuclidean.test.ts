/**
 * A Euclidean part kept live across its edits (#610): steps, pulses, rotate,
 * density, capture and release reconfigure the running generator — no
 * all-notes-off, no stream restart, position still the transport's — while
 * the divisor, being the subscription, still rebuilds. The engine half is
 * `euclideanSequencer.test.ts`; this is the player's transaction.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT, FULL_PARTS, FULL_SLOT } from '../__fixtures__/fullArrangement';
import { rig } from '../__fixtures__/playerRig';
import { kinds } from '../__fixtures__/recordingPart';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { DIVISORS, PPQ, TICKS_PER_BAR } from '../sequencing/scheduler';

const { kick } = FULL_SLOT;
const KICK = FULL_PARTS.kick.sequencer;
const secondsPerTick = SECONDS_PER_MINUTE / FULL_ARRANGEMENT.transport.bpm / PPQ;
const tickOf = (time: number | undefined): number => Math.round((time ?? 0) / secondsPerTick);

describe('Euclidean parts kept live (#610)', () => {
  it('steps, pulses, rotate and density edits: no all-notes-off, onsets on the transport step', () => {
    const { parts, player, run } = rig();
    run(1);
    const before = parts.kick.calls.length;
    const edits = [
      { steps: 12, pulses: { min: 2, max: 4, start: 3 } },
      { rotate: 3 },
      { density: { kind: 'walk', stepChance: 0.5 } },
      { pulses: { max: 6 } },
    ];
    for (const sequencer of edits) {
      expect(player.apply({ parts: { [kick]: { sequencer } } }, {}).ok).toBe(true);
    }
    run(2);
    const since = parts.kick.calls.slice(before);
    expect(since.filter((c) => c.kind === 'allNotesOff')).toEqual([]);
    const triggers = since.filter((c) => c.kind === 'trigger');
    expect(triggers.length).toBeGreaterThan(0);
    // Every onset after the edits sits on a lit step of the figure the player holds, 12 wide.
    const figure = player.capturePattern(kick) as readonly boolean[];
    expect(figure).toHaveLength(12);
    // The last bar's onsets: the walk may move k at a bar line, so only the bar the figure is from.
    const lastBar = triggers.filter((c) => tickOf(c.time) >= 2 * TICKS_PER_BAR);
    expect(lastBar.length).toBeGreaterThan(0);
    for (const call of lastBar) {
      const step = (tickOf(call.time) / KICK.divisor) % 12;
      expect(figure[step], `tick ${tickOf(call.time)}`).toBe(true);
    }
  });

  it('an invalid live edit is refused whole: no tempo, no arrangement, no figure change', () => {
    const { player, run } = rig();
    run(1);
    const figure = player.capturePattern(kick);
    const result = player.apply(
      { transport: { bpm: 140 }, parts: { [kick]: { sequencer: { pulses: { max: 40 } } } } },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pulses/);
    expect(player.readout().bpm).toBe(FULL_ARRANGEMENT.transport.bpm);
    expect(player.arrangement.parts[kick]?.sequencer).toEqual(KICK);
    expect(player.capturePattern(kick)).toEqual(figure);
  });

  it('a divisor change is the subscription: that one rebuilds, with an all-notes-off', () => {
    const { parts, player, run } = rig();
    run(1);
    expect(
      player.apply({ parts: { [kick]: { sequencer: { divisor: DIVISORS.eighth } } } }, {}).ok,
    ).toBe(true);
    expect(parts.kick.calls.at(-1)).toMatchObject({ kind: 'allNotesOff' });
  });

  it('a seed change rebuilds the part too: its stream restarts at once (#705)', () => {
    const { parts, player, run } = rig();
    run(1);
    const hat = parts.hat.calls.length;
    expect(player.apply({ parts: { [kick]: { sequencer: { seed: 5 } } } }, {}).ok).toBe(true);
    expect(parts.kick.calls.at(-1)).toMatchObject({ kind: 'allNotesOff' });
    expect(parts.hat.calls).toHaveLength(hat);
  });

  it('capture then release round-trips live, with no all-notes-off', () => {
    const { parts, player, run } = rig();
    run(1);
    const before = parts.kick.calls.length;
    const pattern = player.capturePattern(kick) as readonly boolean[];
    expect(player.apply({ parts: { [kick]: { sequencer: { pattern } } } }, {}).ok).toBe(true);
    run(1);
    expect(player.capturePattern(kick)).toEqual(pattern);
    expect(player.apply({ parts: { [kick]: { sequencer: { pattern: null } } } }, {}).ok).toBe(true);
    run(1);
    const since = parts.kick.calls.slice(before);
    expect(since.filter((c) => c.kind === 'allNotesOff')).toEqual([]);
    expect(kinds(parts.kick, 'trigger').length).toBeGreaterThan(0);
  });
});
