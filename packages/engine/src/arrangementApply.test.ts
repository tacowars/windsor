/**
 * `ArrangementPlayer.apply` (issue #69, refinement decision 3): bpm reaches
 * the transport live, only the generators whose config actually changed are
 * rebuilt, presets swap via setPatch, and a merged arrangement that fails
 * validation changes nothing.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from './__fixtures__/fullArrangement';
import type { Arrangement, DeepPartial } from './arrangement';
import { ArrangementPlayer, type MusicPartId, type PlayablePart } from './arrangementPlayer';
import type { Patch } from './patch';
import { TICKS_PER_BAR, TickTransport } from './scheduler';

interface Call {
  kind: string;
  note?: number | undefined;
  time?: number | undefined;
  patch?: string | undefined;
}

type RecordingPart = PlayablePart & { calls: Call[] };

function fakePart(): RecordingPart {
  const calls: Call[] = [];
  return {
    calls,
    noteOn(note, _velocity, time) {
      calls.push({ kind: 'noteOn', note, time });
      return calls.length;
    },
    noteOffByNote(note, time) {
      calls.push({ kind: 'noteOffByNote', note, time });
    },
    trigger(note, _velocity, _duration, time) {
      calls.push({ kind: 'trigger', note, time });
      return calls.length;
    },
    setPatch(patch: Patch) {
      calls.push({ kind: 'setPatch', patch: patch.name });
    },
    allNotesOff() {
      calls.push({ kind: 'allNotesOff' });
    },
  };
}

interface Rig {
  transport: TickTransport;
  parts: Record<MusicPartId, RecordingPart>;
  player: ArrangementPlayer;
  run(bars: number): void;
}

function rig(arrangement: Arrangement = FULL_ARRANGEMENT): Rig {
  const transport = new TickTransport(120);
  const parts = { kick: fakePart(), hat: fakePart(), arp: fakePart(), drone: fakePart() };
  const player = new ArrangementPlayer(transport, parts, arrangement);
  const run = (bars: number): void => {
    for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
  };
  return { transport, parts, player, run };
}

describe('apply', () => {
  it('changes the transport bpm live without resetting counters', () => {
    const { transport, player, run } = rig();
    run(2);
    const before = player.readout().counters;
    const result = player.apply({ bpm: 90 });
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(transport.bpm).toBe(90);
    expect(player.readout().bpm).toBe(90);
    expect(player.readout().counters).toEqual(before);
  });

  it('reports unknown keys and applies the rest', () => {
    const { player } = rig();
    const partial = { bpm: 90, wat: 1 } as DeepPartial<Arrangement>;
    const result = player.apply(partial);
    expect(result.ok).toBe(true);
    expect(result.ignored).toEqual(['wat']);
    expect(player.readout().bpm).toBe(90);
  });

  it('leaves untouched generators mid-stream: a kick-only change never moves the arp', () => {
    const a = rig();
    const b = rig();
    a.run(2);
    b.run(2);
    expect(a.player.apply({ kick: { driver: { rotate: 1 } } }).ok).toBe(true);
    a.run(2);
    b.run(2);
    expect(a.parts.arp.calls).toEqual(b.parts.arp.calls);
    expect(a.parts.hat.calls).toEqual(b.parts.hat.calls);
    expect(a.parts.drone.calls).toEqual(b.parts.drone.calls);
  });

  it('applies a driver change live: skipChance 0 plays every arp step', () => {
    const { player, parts, run } = rig();
    run(1);
    expect(player.apply({ arp: { driver: { skipChance: 0 } } }).ok).toBe(true);
    const before = parts.arp.calls.filter((c) => c.kind === 'noteOn').length;
    run(4);
    const after = parts.arp.calls.filter((c) => c.kind === 'noteOn').length;
    // 96 / divisor 6 = 16 steps per bar, none skipped.
    expect(after - before).toBe(4 * (TICKS_PER_BAR / FULL_ARRANGEMENT.arp.driver.divisor));
  });

  it('swaps a preset via setPatch without rebuilding that part', () => {
    const { player, parts } = rig();
    expect(player.apply({ arp: { preset: 'pad-drift' } }).ok).toBe(true);
    const patches = parts.arp.calls.filter((c) => c.kind === 'setPatch');
    expect(patches).toEqual([{ kind: 'setPatch', patch: 'Drift Pad' }]);
    expect(parts.arp.calls.filter((c) => c.kind === 'allNotesOff')).toHaveLength(0);
    expect(player.arrangement.arp?.preset).toBe('pad-drift');
  });

  it('refuses an unknown preset and changes nothing', () => {
    const { player } = rig();
    const result = player.apply({ arp: { preset: 'nope' } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/unknown audio preset "nope"/);
    expect(player.arrangement.arp?.preset).toBe(FULL_ARRANGEMENT.arp.preset);
  });

  it('refuses a live part rename', () => {
    const { player } = rig();
    const result = player.apply({ kick: { part: 'boom' } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/renamed/);
  });

  it('refuses an invalid key and keeps playing on the old one', () => {
    const { player, parts, run } = rig();
    const result = player.apply({ key: { weights: [0, 0, 0, 0, 0, 0, 0] } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/zero/);
    expect(player.arrangement.key).toEqual(FULL_ARRANGEMENT.key);
    run(2);
    expect(parts.arp.calls.filter((c) => c.kind === 'noteOn').length).toBeGreaterThan(0);
  });

  it('rebuilds the pitched parts when the key changes', () => {
    const { player, parts, run } = rig();
    // One degree pinned to the root: every note after the change is known.
    expect(player.apply({ key: { root: 48, scale: [0], weights: [1] } }).ok).toBe(true);
    parts.arp.calls.length = 0;
    run(4);
    const notes = new Set(parts.arp.calls.filter((c) => c.kind === 'noteOn').map((c) => c.note));
    for (const note of notes) expect((note! - 48) % 12).toBe(0);
  });

  it('keeps the density union clean across a kind swap', () => {
    const { player } = rig();
    expect(
      player.apply({ hat: { driver: { density: { kind: 'walk', stepChance: 0.5 } } } }).ok,
    ).toBe(true);
    expect(player.arrangement.hat?.driver.density).toEqual({ kind: 'walk', stepChance: 0.5 });
  });

  it('reseeds every stream on a seed change', () => {
    const { player } = rig();
    expect(player.apply({ seed: 999 }).ok).toBe(true);
    expect(player.arrangement.seed).toBe(999);
  });
});
