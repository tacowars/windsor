/* eslint-disable max-lines -- the player's binding tests in one file: the four-slot cases and the grid's live-reconfigure cases (#603) share the rig and the fixture line; 369 of 350, inside the #225 decision 4 margin (the Euclidean cases, #610, are their own file) */
/**
 * The binding layer, driven headlessly: a `TickTransport` on one side, fake
 * parts recording calls on the other. Onset → trigger, noteOn/noteOff →
 * noteOn/noteOffByNote, and the step sequencer's ties reach the part as
 * *silence* — no retrigger — which is the event-level half of issue #69's tie
 * criterion. Since #597 any kind sits on any slot, and a `none` part is inert.
 */
import { describe, expect, it } from 'vitest';

import {
  FULL_ARRANGEMENT,
  FULL_PARTS,
  FULL_SLOT,
  onlyParts,
  slotMap,
  withPart,
} from '../__fixtures__/fullArrangement';
import { fourParts, rig } from '../__fixtures__/playerRig';
import { kinds } from '../__fixtures__/recordingPart';
import type { Arrangement, MusicPart } from './arrangement';
import { ArrangementPlayer } from './arrangementPlayer';
import { makePatch } from '../patch/patch';
import { PRESETS } from '../patch/presets';
import { gridNote } from '../sequencing/gridSequencer';
import { DIVISORS, PPQ, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import { SECONDS_PER_MINUTE } from '../audioConstants';

const { kick, hat, arp, drone } = FULL_SLOT;

/** One sounding degree, one octave: every step-sequencer draw is the same MIDI note. */
describe('bindings', () => {
  it('takes the transport tempo from the arrangement', () => {
    const { transport } = rig();
    expect(transport.bpm).toBe(FULL_ARRANGEMENT.transport.bpm);
  });

  it('sounds all four parts within 8 bars and announces each part once', () => {
    const { parts, player, events, run } = rig();
    run(8);
    const counters = player.readout().counters;
    for (const slot of [kick, hat, arp, drone])
      expect(counters[slot], `${slot}`).toBeGreaterThan(0);
    expect(kinds(parts.kick, 'trigger').length).toBe(counters[kick]);
    expect(kinds(parts.hat, 'trigger').length).toBe(counters[hat]);
    expect(events.map((e) => e.slot).sort()).toEqual([kick, hat, arp, drone]);
  });

  it('maps a Euclidean onset to trigger with the part note, velocity and hold', () => {
    const { parts, run } = rig();
    run(2);
    for (const call of kinds(parts.kick, 'trigger')) {
      expect(call.note).toBe(FULL_PARTS.kick.sequencer.note);
      expect(call.velocity).toBe(FULL_PARTS.kick.velocity);
      expect(call.duration).toBe(FULL_PARTS.kick.sequencer.hold);
    }
  });

  it('pairs every grid noteOn with a noteOffByNote scheduled later', () => {
    const { parts, run } = rig();
    run(8);
    const ons = kinds(parts.arp, 'noteOn');
    const offs = kinds(parts.arp, 'noteOffByNote');
    expect(ons.length).toBeGreaterThan(0);
    // The last note may still be sounding when the run stops; every other one is released.
    expect(offs.length).toBeGreaterThanOrEqual(ons.length - 1);
    expect(offs.length).toBeLessThanOrEqual(ons.length);
    offs.forEach((off, i) => {
      const on = ons[i];
      expect(off.note).toBe(on?.note);
      expect(off.time ?? 0).toBeGreaterThan(on?.time ?? 0);
    });
  });

  it('holds the chord part across its step and releases it on demand', () => {
    const { parts, player, run } = rig();
    // Half of the first chord's bar: every tone is on, none is off yet.
    run(0.5);
    const ons = kinds(parts.drone, 'noteOn');
    expect(ons.length).toBeGreaterThan(0);
    expect(kinds(parts.drone, 'noteOffByNote')).toHaveLength(0);
    player.releaseAll(1.25);
    const offs = kinds(parts.drone, 'noteOffByNote');
    expect(offs).toHaveLength(ons.length);
    expect(offs.every((off) => off.time === 1.25)).toBe(true);
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

  it('plays only the parts the arrangement lists (issue #75)', () => {
    const { parts, player, run } = rig(onlyParts(FULL_ARRANGEMENT, 'kick'));
    run(4);
    expect(player.readout().counters[kick]).toBeGreaterThan(0);
    expect(Object.keys(player.readout().counters)).toEqual([String(kick)]);
    expect(parts.hat.calls).toEqual([]);
    expect(parts.arp.calls).toEqual([]);
    expect(parts.drone.calls).toEqual([]);
  });
});

describe('any sequencer on any slot (#597)', () => {
  /** Four grid lines, one per slot: each skips on its own seed's stream (#705) — slot 2 keeps the fixture's. */
  const seedOf = (slot: number): number =>
    slot === arp ? FULL_PARTS.arp.sequencer.seed : 100 + slot;
  const FOUR_ARPS: Arrangement = {
    ...FULL_ARRANGEMENT,
    parts: [kick, hat, arp, drone].map((slot): MusicPart => ({
      ...FULL_PARTS.arp,
      slot,
      name: `arp ${slot}`,
      sequencer: { ...FULL_PARTS.arp.sequencer, seed: seedOf(slot) },
    })),
  };

  it('plays four grid lines, each on its own seed’s stream (#705)', () => {
    const { parts, run } = rig(FOUR_ARPS);
    run(4);
    const streams = Object.values(parts).map((p) => JSON.stringify(kinds(p, 'noteOn')));
    for (const stream of streams) expect(stream).not.toBe('[]');
    expect(new Set(streams).size).toBe(4);
    // Slot 2's line is the fixture's exactly: the seed, not the slot, is the stream.
    const bed = rig();
    bed.run(4);
    expect(kinds(parts.arp, 'noteOn')).toEqual(kinds(bed.parts.arp, 'noteOn'));
    // Two slots sharing a seed share a stream.
    const shared = rig({
      ...FOUR_ARPS,
      parts: FOUR_ARPS.parts.map((part) =>
        part.slot === kick ? { ...part, sequencer: { ...FULL_PARTS.arp.sequencer } } : part,
      ),
    });
    shared.run(4);
    expect(kinds(shared.parts.kick, 'noteOn')).toEqual(kinds(bed.parts.arp, 'noteOn'));
  });

  it('plays three Euclidean parts and one chord part', () => {
    const mixed: Arrangement = {
      ...FULL_ARRANGEMENT,
      parts: [
        FULL_PARTS.kick,
        FULL_PARTS.hat,
        {
          ...FULL_PARTS.kick,
          slot: arp,
          name: 'rim',
          sequencer: { ...FULL_PARTS.hat.sequencer, note: 37 },
        },
        FULL_PARTS.drone,
      ],
    };
    const { parts, run } = rig(mixed);
    run(4);
    expect(kinds(parts.arp, 'trigger').length).toBeGreaterThan(0);
    expect(kinds(parts.arp, 'trigger').every((c) => c.note === 37)).toBe(true);
    expect(kinds(parts.drone, 'noteOn').length).toBeGreaterThan(0);
  });

  it('keeps a part’s stream when another part is removed or the list is reordered', () => {
    const bed = rig();
    const without = rig(onlyParts(FULL_ARRANGEMENT, 'hat', 'drone', 'arp'));
    const reordered = rig({ ...FULL_ARRANGEMENT, parts: [...FULL_ARRANGEMENT.parts].reverse() });
    for (const r of [bed, without, reordered]) r.run(4);
    expect(kinds(without.parts.arp, 'noteOn')).toEqual(kinds(bed.parts.arp, 'noteOn'));
    expect(kinds(reordered.parts.arp, 'noteOn')).toEqual(kinds(bed.parts.arp, 'noteOn'));
    expect(kinds(reordered.parts.hat, 'trigger')).toEqual(kinds(bed.parts.hat, 'trigger'));
  });

  it('leaves a none part inert and every other part’s notes unchanged', () => {
    const bed = rig();
    const inert = rig(withPart(FULL_ARRANGEMENT, 'drone', { sequencer: { kind: 'none' } }));
    for (const r of [bed, inert]) r.run(8);
    expect(inert.parts.drone.calls).toEqual([]);
    expect(inert.player.readout().counters[drone]).toBe(0);
    expect(inert.player.capturePattern(drone)).toBeNull();
    for (const id of ['kick', 'hat', 'arp'] as const) {
      expect(inert.parts[id].calls, id).toEqual(bed.parts[id].calls);
    }
    inert.player.releaseAll();
    expect(kinds(inert.parts.drone, 'allNotesOff')).toHaveLength(1);
  });
});

describe('the preset table (#435)', () => {
  it('resolves a part against the table it was given, document patches first', () => {
    const parts = fourParts();
    const lead = makePatch({ name: 'lead' });
    const arrangement = withPart(FULL_ARRANGEMENT, 'arp', { preset: 'lead' });
    expect(
      () => new ArrangementPlayer(new TickTransport(), slotMap(parts), arrangement, PRESETS),
    ).toThrow('part 2 ("arp"): unknown audio preset "lead"');
    const player = new ArrangementPlayer(new TickTransport(), slotMap(parts), arrangement, {
      ...PRESETS,
      lead,
    });
    expect(player.apply({ parts: { [drone]: { preset: 'lead' } } }).ok).toBe(true);
    expect(parts.drone.calls.at(-1)).toEqual({ kind: 'setPatch', patch: 'lead' });
  });

  it('a patches partial merges over the table entry and pushes to the parts playing it', () => {
    const parts = fourParts();
    const player = new ArrangementPlayer(
      new TickTransport(),
      slotMap(parts),
      FULL_ARRANGEMENT,
      PRESETS,
    );
    expect(player.apply({}, { kick: { volume: 0.2 }, junk: 4 })).toEqual({
      ok: true,
      ignored: ['patches.junk'],
    });
    expect(parts.kick.calls).toEqual([{ kind: 'setPatch', patch: PRESETS.kick?.name }]);
    expect(parts.hat.calls).toEqual([]);
    // The merged patch is the table's from now on: a switch away and back keeps the edit.
    expect(player.apply({ parts: { [kick]: { preset: 'hat' } } }).ok).toBe(true);
    expect(player.apply({ parts: { [kick]: { preset: 'kick' } } }).ok).toBe(true);
    expect(kinds(parts.kick, 'setPatch')).toHaveLength(3);
  });

  it('takes a preset switch and the patch it names in one partial (review finding 1)', () => {
    const parts = fourParts();
    const player = new ArrangementPlayer(
      new TickTransport(),
      slotMap(parts),
      FULL_ARRANGEMENT,
      PRESETS,
    );
    const result = player.apply(
      { parts: { [arp]: { preset: 'fresh' } } },
      { fresh: { volume: 0.2 } },
    );
    expect(result).toEqual({ ok: true, ignored: [] });
    expect(kinds(parts.arp, 'setPatch')).toEqual([{ kind: 'setPatch', patch: 'fresh' }]);
  });

  it('changes neither the table nor the arrangement when the merged arrangement is refused', () => {
    const parts = fourParts();
    const player = new ArrangementPlayer(
      new TickTransport(),
      slotMap(parts),
      FULL_ARRANGEMENT,
      PRESETS,
    );
    expect(player.apply({ transport: { bpm: -1 } }, { fresh: { volume: 0.2 } }).ok).toBe(false);
    expect(parts.arp.calls).toEqual([]);
    // The staged patch was discarded with the refused partial.
    expect(player.apply({ parts: { [arp]: { preset: 'fresh' } } }).ok).toBe(false);
  });

  it('never resolves an inherited object name as a preset', () => {
    const parts = fourParts();
    const player = new ArrangementPlayer(
      new TickTransport(),
      slotMap(parts),
      FULL_ARRANGEMENT,
      PRESETS,
    );
    expect(player.apply({ parts: { [arp]: { preset: 'constructor' } } })).toMatchObject({
      ok: false,
      error: 'part 2 ("arp"): unknown audio preset "constructor"',
    });
  });
});

describe('grid parts (#602)', () => {
  /** The fixture's drone slot driven by a written line: root, accented seventh, tie, rest, slid third. */
  const LINE: Arrangement = {
    ...FULL_ARRANGEMENT,
    // C minor (pitch class 0); the line's register octave 3 puts its root on C3 = 48.
    harmony: { ...FULL_ARRANGEMENT.harmony, root: 0, scale: 'naturalMinor' },
    parts: FULL_ARRANGEMENT.parts.map((part): MusicPart =>
      part.slot === drone
        ? {
            ...part,
            velocity: 0.7,
            sequencer: {
              kind: 'grid',
              divisor: DIVISORS.quarter,
              steps: [
                gridNote(0),
                gridNote(6, { accent: true }),
                { kind: 'tie' },
                { kind: 'rest' },
                gridNote(2, { slide: true }),
                gridNote(4, { slide: true }),
              ],
              length: 6,
              skipChance: 0,
              accentVelocity: 0.2,
              accentMod: 1,
              register: { octave: 3 },
              // The skip-edit case below turns skipChance to 0.01: this seed's stream skips nothing in bar 2.
              seed: 204,
            },
          }
        : part,
    ),
  };

  it('passes the event’s velocity, mod and slide to the part', () => {
    const { parts, run } = rig(LINE);
    run(2);
    const calls = parts.drone.calls.slice(0, 7);
    expect(calls).toEqual([
      { kind: 'noteOn', note: 48, velocity: 0.7, time: expect.any(Number) },
      { kind: 'noteOffByNote', note: 48, time: expect.any(Number) },
      {
        kind: 'noteOn',
        note: 58,
        velocity: expect.closeTo(0.9, 6),
        time: expect.any(Number),
        extras: { mod: 1, slide: false },
      },
      { kind: 'noteOffByNote', note: 58, time: expect.any(Number) },
      // The slid step after the rest has nothing held, so it is a plain note.
      { kind: 'noteOn', note: 51, velocity: 0.7, time: expect.any(Number) },
      // A real slide: the new note-on, flagged, before the old note's off.
      {
        kind: 'noteOn',
        note: 55,
        velocity: 0.7,
        time: expect.any(Number),
        extras: { mod: 0, slide: true },
      },
      { kind: 'noteOffByNote', note: 51, time: expect.any(Number) },
    ]);
    // The tie held the seventh through step 2; the rest released it at step 3.
    expect(calls[3]!.time).toBeCloseTo(
      3 * DIVISORS.quarter * (SECONDS_PER_MINUTE / LINE.transport.bpm / PPQ),
      9,
    );
  });

  it('a scale change re-pitches the line without an explicit part rebuild', () => {
    const { parts, player, run } = rig(LINE);
    run(1);
    expect(
      kinds(parts.drone, 'noteOn')
        .map((c) => c.note)
        .slice(0, 2),
    ).toEqual([48, 58]);
    const before = parts.drone.calls.length;
    expect(player.apply({ harmony: { scale: 'pentatonicMinor' } }, {}).ok).toBe(true);
    run(1);
    // The six-step line runs four steps to a bar, so bar 2 opens on steps 4
    // and 5 (degrees 2 and 4: 53, 58 in five degrees) before wrapping to the
    // root and the seventh — which in five degrees is degree 1 an octave up,
    // 48 + 3 + 12.
    expect(
      parts.drone.calls
        .slice(before)
        .filter((c) => c.kind === 'noteOn')
        .map((c) => c.note)
        .slice(0, 4),
    ).toEqual([53, 58, 48, 63]);
  });

  it('a skip, step or accent edit reconfigures the grid live: no all-notes-off, no stream restart', () => {
    const { parts, player, run, transport } = rig(LINE);
    run(1);
    const before = parts.drone.calls.length;
    expect(player.apply({ parts: { [drone]: { sequencer: { skipChance: 0.01 } } } }, {}).ok).toBe(
      true,
    );
    expect(player.apply({ parts: { [drone]: { sequencer: { accentMod: 0.5 } } } }, {}).ok).toBe(
      true,
    );
    const steps = [gridNote(1), gridNote(3), gridNote(5), gridNote(1), gridNote(3), gridNote(5)];
    expect(player.apply({ parts: { [drone]: { sequencer: { steps } } } }, {}).ok).toBe(true);
    expect(parts.drone.calls.slice(before).filter((c) => c.kind === 'allNotesOff')).toEqual([]);
    // Bar 2 opens on steps 4 and 5 of the new line (the line is six quarters), then wraps.
    run(1);
    const notes = parts.drone.calls
      .slice(before)
      .filter((c) => c.kind === 'noteOn')
      .map((c) => c.note);
    expect(notes.slice(0, 4)).toEqual([48 + 5, 48 + 8, 48 + 2, 48 + 5]);
    expect(transport.currentTick).toBe(2 * TICKS_PER_BAR);

    // A divisor change is the subscription: that one rebuilds, with an all-notes-off.
    expect(
      player.apply({ parts: { [drone]: { sequencer: { divisor: DIVISORS.eighth } } } }, {}).ok,
    ).toBe(true);
    expect(parts.drone.calls.at(-1)).toMatchObject({ kind: 'allNotesOff' });
  });

  it('an invalid live grid edit is refused whole: no tempo, no arrangement, no generator change', () => {
    const { parts, player, run } = rig(LINE);
    run(1);
    const before = parts.drone.calls.length;
    const result = player.apply(
      { transport: { bpm: 140 }, parts: { [drone]: { sequencer: { length: 0 } } } },
      {},
    );
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/length/);
    expect(player.readout().bpm).toBe(LINE.transport.bpm);
    run(1);
    // The line plays on as written: six quarters, bar 2 opens on steps 4 and 5.
    const notes = parts.drone.calls
      .slice(before)
      .filter((c) => c.kind === 'noteOn')
      .map((c) => c.note);
    expect(notes.slice(0, 2)).toEqual([51, 55]);
  });

  it('a root change re-pitches the grid live, without an all-notes-off', () => {
    const { parts, player, run } = rig(LINE);
    run(1);
    const before = parts.drone.calls.length;
    // #705: the root is a pitch class — D.
    expect(player.apply({ harmony: { root: 2 } }, {}).ok).toBe(true);
    expect(player.readout().root).toBe(2);
    run(1);
    const since = parts.drone.calls.slice(before);
    expect(since.filter((c) => c.kind === 'allNotesOff')).toEqual([]);
    expect(
      since
        .filter((c) => c.kind === 'noteOn')
        .map((c) => c.note)
        .slice(0, 2),
    ).toEqual([50 + 3, 50 + 7]);
  });

  it('a seed change rebuilds that part alone: its stream restarts at once (#705)', () => {
    const { parts, player, run } = rig(LINE);
    run(1);
    const others = (['kick', 'hat', 'arp'] as const).map((id) => parts[id].calls.length);
    expect(player.apply({ parts: { [drone]: { sequencer: { seed: 9 } } } }, {}).ok).toBe(true);
    expect(parts.drone.calls.at(-1)).toMatchObject({ kind: 'allNotesOff' });
    (['kick', 'hat', 'arp'] as const).forEach((id, i) => {
      expect(kinds(parts[id], 'allNotesOff'), id).toEqual([]);
      expect(parts[id].calls.length, id).toBe(others[i]);
    });
    expect(player.arrangement.parts.find((p) => p.slot === drone)?.sequencer).toMatchObject({
      seed: 9,
    });
  });

  it('a transport stop releases a grid part’s held note', () => {
    const { parts, player, run } = rig(LINE);
    run(1);
    player.releaseAll();
    expect(parts.drone.calls.at(-1)).toMatchObject({ kind: 'allNotesOff' });
  });
});
