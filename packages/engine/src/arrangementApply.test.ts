/**
 * `ArrangementPlayer.apply` (issue #69, refinement decision 3): bpm reaches
 * the transport live, only the generators whose config actually changed are
 * rebuilt, presets swap via setPatch, and a merged arrangement that fails
 * validation changes nothing. Parts are addressed by slot (#597).
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_PARTS,
  FULL_SLOT,
  slotMap,
  withPart,
  type FullPartId,
} from './__fixtures__/fullArrangement';
import { kinds, recordingPart, type RecordingPart } from './__fixtures__/recordingPart';
import type { Arrangement, ArrangementPartial } from './arrangement';
import { ArrangementPlayer } from './arrangementPlayer';
import { TICKS_PER_BAR, TickTransport } from './scheduler';
import { PRESETS } from './presets';

const { kick, hat, arp, drone } = FULL_SLOT;

interface Rig {
  transport: TickTransport;
  parts: Record<FullPartId, RecordingPart>;
  player: ArrangementPlayer;
  run(bars: number): void;
}

function rig(arrangement: Arrangement = FULL_ARRANGEMENT): Rig {
  const transport = new TickTransport(120);
  const parts = {
    kick: recordingPart(),
    hat: recordingPart(),
    arp: recordingPart(),
    drone: recordingPart(),
  };
  // The player resolves only against the table it is handed (#562); these
  // tests hand it the library so a preset swap has something to swap to.
  const player = new ArrangementPlayer(transport, slotMap(parts), arrangement, PRESETS);
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
    const partial = { bpm: 90, wat: 1 } as ArrangementPartial;
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
    expect(
      a.player.apply({ parts: { [kick]: { sequencer: { kind: 'euclidean', rotate: 1 } } } }).ok,
    ).toBe(true);
    a.run(2);
    b.run(2);
    expect(a.parts.arp.calls).toEqual(b.parts.arp.calls);
    expect(a.parts.hat.calls).toEqual(b.parts.hat.calls);
    expect(a.parts.drone.calls).toEqual(b.parts.drone.calls);
  });

  it('does not rebuild a Euclidean part for a note or hold change', () => {
    const a = rig();
    const b = rig();
    a.run(2);
    b.run(2);
    const partial = { parts: { [hat]: { sequencer: { kind: 'euclidean', note: 44 } } } } as const;
    expect(a.player.apply(partial).ok).toBe(true);
    a.run(2);
    b.run(2);
    // Same onsets, new note: the stream was not reset.
    expect(kinds(a.parts.hat, 'allNotesOff')).toHaveLength(0);
    expect(kinds(a.parts.hat, 'trigger').map((c) => c.time)).toEqual(
      kinds(b.parts.hat, 'trigger').map((c) => c.time),
    );
    expect(kinds(a.parts.hat, 'trigger').at(-1)?.note).toBe(44);
  });

  it('applies a driver change live: skipChance 0 plays every arp step', () => {
    const { player, parts, run } = rig();
    run(1);
    expect(player.apply({ parts: { [arp]: { sequencer: { kind: 'arp', skipChance: 0 } } } }).ok).toBe(
      true,
    );
    const before = kinds(parts.arp, 'noteOn').length;
    run(4);
    const after = kinds(parts.arp, 'noteOn').length;
    // 96 / divisor 6 = 16 steps per bar, none skipped.
    expect(after - before).toBe(4 * (TICKS_PER_BAR / FULL_PARTS.arp.sequencer.divisor));
  });

  it('changes a part’s sequencer kind live and rebuilds only that part (#597)', () => {
    const a = rig();
    const b = rig();
    a.run(2);
    b.run(2);
    const arpAsDriver = { ...FULL_PARTS.arp.sequencer };
    expect(a.player.apply({ parts: { [kick]: { sequencer: arpAsDriver } } }).ok).toBe(true);
    expect(a.player.arrangement.parts[kick]?.sequencer.kind).toBe('arp');
    const triggersBefore = kinds(a.parts.kick, 'trigger').length;
    a.run(2);
    b.run(2);
    // The kick part now plays arpeggio notes and no more percussion triggers.
    expect(kinds(a.parts.kick, 'trigger')).toHaveLength(triggersBefore);
    expect(kinds(a.parts.kick, 'noteOn').length).toBeGreaterThan(0);
    expect(kinds(a.parts.kick, 'allNotesOff')).toHaveLength(1);
    expect(a.parts.hat.calls).toEqual(b.parts.hat.calls);
    expect(a.parts.arp.calls).toEqual(b.parts.arp.calls);
    expect(a.parts.drone.calls).toEqual(b.parts.drone.calls);
  });

  it('refuses a kind change whose sequencer is incomplete, and changes nothing', () => {
    const { player } = rig();
    const result = player.apply({ parts: { [kick]: { sequencer: { kind: 'step' } } } });
    expect(result.ok).toBe(false);
    expect(player.arrangement.parts[kick]?.sequencer).toEqual(FULL_PARTS.kick.sequencer);
  });

  it('swaps a preset via setPatch without rebuilding that part', () => {
    const { player, parts } = rig();
    expect(player.apply({ parts: { [arp]: { preset: 'pad-drift' } } }).ok).toBe(true);
    expect(kinds(parts.arp, 'setPatch')).toEqual([{ kind: 'setPatch', patch: 'Drift Pad' }]);
    expect(kinds(parts.arp, 'allNotesOff')).toHaveLength(0);
    expect(player.arrangement.parts[arp]?.preset).toBe('pad-drift');
  });

  it('refuses an unknown preset and changes nothing', () => {
    const { player } = rig();
    const result = player.apply({ parts: { [arp]: { preset: 'nope' } } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/part 2 \("arp"\): unknown audio preset "nope"/);
    expect(player.arrangement.parts[arp]?.preset).toBe(FULL_PARTS.arp.preset);
  });

  it('renames a part live: the name is a label (#597)', () => {
    const { player, parts } = rig();
    expect(player.apply({ parts: { [kick]: { name: 'boom' } } })).toEqual({ ok: true, ignored: [] });
    expect(player.arrangement.parts[kick]?.name).toBe('boom');
    expect(parts.kick.calls).toEqual([]);
  });

  it('refuses a live slot change and changes nothing', () => {
    const { player } = rig();
    const result = player.apply({ parts: { [kick]: { slot: 6 } } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/re-slotted live/);
    expect(player.arrangement.parts.map((p) => p.slot)).toEqual([kick, hat, arp, drone]);
  });

  it('refuses an invalid key and keeps playing on the old one', () => {
    const { player, parts, run } = rig();
    const result = player.apply({ key: { weights: [0, 0, 0, 0, 0, 0, 0] } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/zero/);
    expect(player.arrangement.key).toEqual(FULL_ARRANGEMENT.key);
    run(2);
    expect(kinds(parts.arp, 'noteOn').length).toBeGreaterThan(0);
  });

  it('rebuilds the pitched parts when the key changes', () => {
    const { player, parts, run } = rig();
    // One degree pinned to the root: every note after the change is known.
    expect(player.apply({ key: { root: 48, scale: [0], weights: [1] } }).ok).toBe(true);
    parts.arp.calls.length = 0;
    run(4);
    const notes = new Set(kinds(parts.arp, 'noteOn').map((c) => c.note));
    for (const note of notes) expect((note! - 48) % 12).toBe(0);
  });

  it('keeps the density union clean across a kind swap', () => {
    const { player } = rig();
    const partial = {
      parts: { [hat]: { sequencer: { kind: 'euclidean', density: { kind: 'walk', stepChance: 0.5 } } } },
    } as const;
    expect(player.apply(partial).ok).toBe(true);
    const sequencer = player.arrangement.parts[hat]?.sequencer;
    expect(sequencer?.kind === 'euclidean' && sequencer.density).toEqual({
      kind: 'walk',
      stepChance: 0.5,
    });
  });

  it('reseeds every stream on a seed change, and leaves a none part untouched', () => {
    const inert = withPart(FULL_ARRANGEMENT, 'drone', { sequencer: { kind: 'none' } });
    const { player, parts } = rig(inert);
    expect(player.apply({ seed: 999 }).ok).toBe(true);
    expect(player.arrangement.seed).toBe(999);
    expect(kinds(parts.arp, 'allNotesOff')).toHaveLength(1);
    // A keyboard-held note on an inert part survives a reseed.
    expect(parts.drone.calls).toEqual([]);
  });
});
