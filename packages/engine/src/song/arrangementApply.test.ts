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
  onlyParts,
  slotMap,
  withPart,
  type FullPartId,
} from '../__fixtures__/fullArrangement';
import { kinds, recordingPart, type RecordingPart } from '../__fixtures__/recordingPart';
import type { Arrangement, ArrangementPartial, MusicPart } from './arrangement';
import { ArrangementPlayer, type PartHost } from './arrangementPlayer';
import { TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { PRESETS } from '../patch/presets';

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

  it('applies a driver change live: skipChance 0 plays every grid step', () => {
    const { player, parts, run } = rig();
    run(1);
    expect(
      player.apply({ parts: { [arp]: { sequencer: { kind: 'grid', skipChance: 0 } } } }).ok,
    ).toBe(true);
    const before = kinds(parts.arp, 'noteOn').length;
    run(4);
    const after = kinds(parts.arp, 'noteOn').length;
    // Every step of the line is a note and none is skipped: one note-on per step.
    expect(after - before).toBe(4 * (TICKS_PER_BAR / FULL_PARTS.arp.sequencer.divisor));
  });

  it('changes a part’s sequencer kind live and rebuilds only that part (#597)', () => {
    const a = rig();
    const b = rig();
    a.run(2);
    b.run(2);
    const arpAsDriver = { ...FULL_PARTS.arp.sequencer };
    expect(a.player.apply({ parts: { [kick]: { sequencer: arpAsDriver } } }).ok).toBe(true);
    expect(a.player.arrangement.parts[kick]?.sequencer.kind).toBe('grid');
    const triggersBefore = kinds(a.parts.kick, 'trigger').length;
    a.run(2);
    b.run(2);
    // The kick part now plays the grid's notes and no more percussion triggers.
    expect(kinds(a.parts.kick, 'trigger')).toHaveLength(triggersBefore);
    expect(kinds(a.parts.kick, 'noteOn').length).toBeGreaterThan(0);
    expect(kinds(a.parts.kick, 'allNotesOff')).toHaveLength(1);
    expect(a.parts.hat.calls).toEqual(b.parts.hat.calls);
    expect(a.parts.arp.calls).toEqual(b.parts.arp.calls);
    expect(a.parts.drone.calls).toEqual(b.parts.drone.calls);
  });

  it('refuses a kind change whose sequencer is incomplete, and changes nothing', () => {
    const { player } = rig();
    const result = player.apply({ parts: { [kick]: { sequencer: { kind: 'grid' } } } });
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
    expect(player.apply({ parts: { [kick]: { name: 'boom' } } })).toEqual({
      ok: true,
      ignored: [],
    });
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
    const result = player.apply({ key: { scale: [] } });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/no degrees/);
    expect(player.arrangement.key).toEqual(FULL_ARRANGEMENT.key);
    run(2);
    expect(kinds(parts.arp, 'noteOn').length).toBeGreaterThan(0);
  });

  it('re-pitches the grid line live when the key changes', () => {
    const { player, parts, run } = rig();
    // One degree pinned to the root: every note after the change is known.
    expect(player.apply({ key: { root: 48, scale: [0] } }).ok).toBe(true);
    parts.arp.calls.length = 0;
    run(4);
    const notes = new Set(kinds(parts.arp, 'noteOn').map((c) => c.note));
    for (const note of notes) expect((note! - 48) % 12).toBe(0);
  });

  it('keeps the density union clean across a kind swap', () => {
    const { player } = rig();
    const partial = {
      parts: {
        [hat]: { sequencer: { kind: 'euclidean', density: { kind: 'walk', stepChance: 0.5 } } },
      },
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

interface LiveRig extends Rig {
  /** Parts the host created for a live add, by slot. */
  created: Map<number, RecordingPart>;
  /** Slots the host was asked to dispose. */
  removed: number[];
  ticks(n: number): void;
}

/** A rig whose host builds and disposes parts live (#629): the roster starts as the arrangement's slots. */
function liveRig(arrangement: Arrangement): LiveRig {
  const transport = new TickTransport(120);
  const parts = {
    kick: recordingPart(),
    hat: recordingPart(),
    arp: recordingPart(),
    drone: recordingPart(),
  };
  const roster = new Map(
    [...slotMap(parts)].filter(([slot]) => arrangement.parts.some((p) => p.slot === slot)),
  );
  const created = new Map<number, RecordingPart>();
  const removed: number[] = [];
  const host: PartHost = {
    get: (slot) => roster.get(slot),
    add: (part) => {
      const live = recordingPart();
      roster.set(part.slot, live);
      created.set(part.slot, live);
      return live;
    },
    remove: (slot) => {
      roster.delete(slot);
      removed.push(slot);
    },
  };
  const player = new ArrangementPlayer(transport, host, arrangement, PRESETS);
  const ticks = (n: number): void => {
    for (let i = 0; i < n; i++) transport.advance(transport.transportSeconds);
  };
  return {
    transport,
    parts,
    player,
    created,
    removed,
    ticks,
    run: (bars) => ticks(bars * TICKS_PER_BAR),
  };
}

const THREE = onlyParts(FULL_ARRANGEMENT, 'kick', 'hat', 'arp');
const KEPT: FullPartId[] = ['kick', 'hat', 'arp'];

describe('live add and removal (#629)', () => {
  it('adds a part mid-bar: the three streams untouched, the new part on the transport’s step', () => {
    const a = liveRig(THREE);
    const b = liveRig(THREE);
    a.run(2);
    b.run(2);
    a.ticks(TICKS_PER_BAR / 2);
    b.ticks(TICKS_PER_BAR / 2);
    const addedAt = a.transport.transportSeconds;
    const counters = a.player.readout().counters;
    expect(a.player.apply({ parts: { [drone]: FULL_PARTS.drone } })).toEqual({
      ok: true,
      ignored: [],
    });
    expect(a.player.arrangement.parts.map((p) => p.slot)).toEqual([kick, hat, arp, drone]);
    expect(a.player.arrangement.parts[3]).toEqual(FULL_PARTS.drone);
    expect(a.player.readout().counters).toEqual({ ...counters, [drone]: 0 });
    for (const id of KEPT) expect(kinds(a.parts[id], 'allNotesOff'), id).toHaveLength(0);
    a.run(2);
    b.run(2);
    for (const id of KEPT) expect(a.parts[id].calls, id).toEqual(b.parts[id].calls);
    const live = a.created.get(drone);
    if (!live) throw new Error('the host was not asked to build the drone');
    expect(kinds(live, 'allNotesOff')).toHaveLength(0);
    const first = kinds(live, 'noteOn')[0];
    expect(first?.time).toBeGreaterThanOrEqual(addedAt);
    expect(addedAt).toBeGreaterThan(0);
  });

  it('removes a part: that part alone is released, cut and handed back', () => {
    const a = liveRig(FULL_ARRANGEMENT);
    const b = liveRig(FULL_ARRANGEMENT);
    a.run(2);
    b.run(2);
    expect(a.player.apply({ parts: { [drone]: null } })).toEqual({ ok: true, ignored: [] });
    expect(a.removed).toEqual([drone]);
    expect(kinds(a.parts.drone, 'allNotesOff')).toHaveLength(1);
    for (const id of KEPT) expect(kinds(a.parts[id], 'allNotesOff'), id).toHaveLength(0);
    expect(a.player.arrangement.parts.map((p) => p.slot)).toEqual([kick, hat, arp]);
    expect(Object.keys(a.player.readout().counters)).toEqual([kick, hat, arp].map(String));
    expect(a.player.capturePattern(drone)).toBeNull();
    const droneCalls = a.parts.drone.calls.length;
    a.run(2);
    b.run(2);
    expect(a.parts.drone.calls).toHaveLength(droneCalls);
    for (const id of KEPT) expect(a.parts[id].calls, id).toEqual(b.parts[id].calls);
  });

  it('adds and removes in one partial, on the slot each names', () => {
    const { player, created, removed } = liveRig(FULL_ARRANGEMENT);
    const moved: MusicPart = { ...FULL_PARTS.drone, slot: 5, name: 'drone 2' };
    expect(player.apply({ parts: { [drone]: null, 5: moved } })).toEqual({ ok: true, ignored: [] });
    expect(removed).toEqual([drone]);
    expect([...created.keys()]).toEqual([5]);
    expect(player.arrangement.parts.map((p) => p.slot)).toEqual([kick, hat, arp, 5]);
  });

  it('refuses an add that is incomplete or names an unknown preset, and creates nothing', () => {
    const { player, created } = liveRig(THREE);
    const unknown = player.apply({ parts: { [drone]: { ...FULL_PARTS.drone, preset: 'nope' } } });
    expect(unknown.ok).toBe(false);
    expect(unknown.error).toMatch(/unknown audio preset "nope"/);
    const bare = { slot: drone, name: 'drone', preset: 'drone-sqr' } as MusicPart;
    const incomplete = player.apply({ parts: { [drone]: bare } });
    expect(incomplete.ok).toBe(false);
    expect(incomplete.error).toMatch(/velocity/);
    expect(created.size).toBe(0);
    expect(player.arrangement.parts).toHaveLength(3);
  });

  it('refuses the whole partial when one half fails: a removal beside a bad bpm removes nothing', () => {
    const { player, removed, transport } = liveRig(FULL_ARRANGEMENT);
    const bpm = transport.bpm;
    expect(player.apply({ bpm: -1, parts: { [drone]: null } }).ok).toBe(false);
    expect(removed).toEqual([]);
    expect(player.arrangement.parts).toHaveLength(4);
    expect(transport.bpm).toBe(bpm);
  });

  it('refuses an add on a fixed roster, and still ignores a fragment at an absent slot', () => {
    const { player } = rig(THREE);
    const add = player.apply({ parts: { [drone]: FULL_PARTS.drone } });
    expect(add.ok).toBe(false);
    expect(add.error).toMatch(/builds parts only at init/);
    expect(player.arrangement.parts).toHaveLength(3);
    expect(player.apply({ parts: { [drone]: { velocity: 0.5 } } })).toEqual({
      ok: true,
      ignored: [`parts.${drone}`],
    });
  });
});
