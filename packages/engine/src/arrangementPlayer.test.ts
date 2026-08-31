/**
 * The binding layer, driven headlessly: a `TickTransport` on one side, fake
 * parts recording calls on the other. Onset → trigger, noteOn/noteOff →
 * noteOn/noteOffByNote, and the drone's ties reach the part as *silence* —
 * no retrigger — which is the event-level half of issue #69's tie criterion.
 */
import { describe, expect, it } from 'vitest';

import { FULL_ARRANGEMENT } from './__fixtures__/fullArrangement';
import type { Arrangement } from './arrangement';
import { ArrangementPlayer, type MusicPartId, type PlayablePart } from './arrangementPlayer';
import type { Patch } from './patch';
import { TICKS_PER_BAR, TickTransport } from './scheduler';

interface Call {
  kind: 'trigger' | 'noteOn' | 'noteOffByNote' | 'setPatch' | 'allNotesOff';
  note?: number | undefined;
  velocity?: number | undefined;
  duration?: number | undefined;
  time?: number | undefined;
  patch?: string | undefined;
}

type RecordingPart = PlayablePart & { calls: Call[] };

function fakePart(): RecordingPart {
  const calls: Call[] = [];
  return {
    calls,
    noteOn(note, velocity, time) {
      calls.push({ kind: 'noteOn', note, velocity, time });
      return calls.length;
    },
    noteOffByNote(note, time) {
      calls.push({ kind: 'noteOffByNote', note, time });
    },
    trigger(note, velocity, duration, time) {
      calls.push({ kind: 'trigger', note, velocity, duration, time });
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
  events: Array<{ part: MusicPartId; tick: number }>;
  run(bars: number): void;
}

function rig(arrangement: Arrangement = FULL_ARRANGEMENT): Rig {
  const transport = new TickTransport(120);
  const parts = { kick: fakePart(), hat: fakePart(), arp: fakePart(), drone: fakePart() };
  const events: Rig['events'] = [];
  const player = new ArrangementPlayer(transport, parts, arrangement, (part, tick) =>
    events.push({ part, tick }),
  );
  const run = (bars: number): void => {
    for (let i = 0; i < bars * TICKS_PER_BAR; i++) transport.advance(transport.transportSeconds);
  };
  return { transport, parts, player, events, run };
}

const kinds = (part: RecordingPart, kind: Call['kind']): Call[] =>
  part.calls.filter((c) => c.kind === kind);

/** One sounding degree, one octave: every drone draw is the same MIDI note. */
const TIED: Arrangement = {
  ...FULL_ARRANGEMENT,
  key: { root: 48, scale: [0], weights: [1] },
};

describe('bindings', () => {
  it('takes the transport tempo from the arrangement', () => {
    const { transport } = rig();
    expect(transport.bpm).toBe(FULL_ARRANGEMENT.bpm);
  });

  it('sounds all four parts within 8 bars and announces each part once', () => {
    const { parts, player, events, run } = rig();
    run(8);
    const counters = player.readout().counters;
    for (const id of ['kick', 'hat', 'arp', 'drone'] as const) {
      expect(counters[id], id).toBeGreaterThan(0);
    }
    expect(kinds(parts.kick, 'trigger').length).toBe(counters.kick);
    expect(kinds(parts.hat, 'trigger').length).toBe(counters.hat);
    expect(events.map((e) => e.part).sort()).toEqual(['arp', 'drone', 'hat', 'kick']);
  });

  it('maps a percussion onset to trigger with the arrangement note, velocity and hold', () => {
    const { parts, run } = rig();
    run(2);
    for (const call of kinds(parts.kick, 'trigger')) {
      expect(call.note).toBe(FULL_ARRANGEMENT.kick.note);
      expect(call.velocity).toBe(FULL_ARRANGEMENT.kick.velocity);
      expect(call.duration).toBe(FULL_ARRANGEMENT.kick.hold);
    }
  });

  it('pairs every arp noteOn with a noteOffByNote scheduled later', () => {
    const { parts, run } = rig();
    run(8);
    const ons = kinds(parts.arp, 'noteOn');
    const offs = kinds(parts.arp, 'noteOffByNote');
    expect(ons.length).toBeGreaterThan(0);
    expect(offs.length).toBe(ons.length);
    ons.forEach((on, i) => {
      const off = offs[i];
      expect(off?.note).toBe(on.note);
      expect(off?.time ?? 0).toBeGreaterThan(on.time ?? 0);
    });
  });

  it('ties the drone: one noteOn across bars, no retrigger, released on demand', () => {
    const { parts, player, run } = rig(TIED);
    run(4);
    expect(kinds(parts.drone, 'noteOn')).toHaveLength(1);
    expect(kinds(parts.drone, 'noteOffByNote')).toHaveLength(0);
    player.releaseAll(1.25);
    const offs = kinds(parts.drone, 'noteOffByNote');
    expect(offs).toHaveLength(1);
    expect(offs[0]?.time).toBe(1.25);
    expect(kinds(parts.drone, 'allNotesOff').length).toBeGreaterThan(0);
  });

  it('feeds no sequencer output back anywhere: parts only ever receive calls', () => {
    // The player's inputs are the transport and plain data; its only outputs
    // are the part calls above. This guard documents the one-way flow of
    // CLAUDE.md invariant 1 — nothing here reads or writes simulation state.
    const { parts, run } = rig();
    run(1);
    const allKinds = new Set(Object.values(parts).flatMap((p) => p.calls.map((c) => c.kind)));
    for (const kind of allKinds) {
      expect(['trigger', 'noteOn', 'noteOffByNote']).toContain(kind);
    }
  });

  it('plays only the parts the arrangement defines (issue #75)', () => {
    const kickOnly: Arrangement = {
      seed: FULL_ARRANGEMENT.seed,
      bpm: FULL_ARRANGEMENT.bpm,
      key: FULL_ARRANGEMENT.key,
      kick: FULL_ARRANGEMENT.kick,
    };
    const { parts, player, run } = rig(kickOnly);
    run(4);
    expect(player.readout().counters.kick).toBeGreaterThan(0);
    expect(parts.hat.calls).toEqual([]);
    expect(parts.arp.calls).toEqual([]);
    expect(parts.drone.calls).toEqual([]);
  });
});
