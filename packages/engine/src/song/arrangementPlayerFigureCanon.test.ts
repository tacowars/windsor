/**
 * The Figure's canon source through the player (windsor#487, record
 * `2026-10-03-figure-sequencer` decision 6), over the listen song
 * `figure-canon.json` in C major (I, vi, IV, V, four bars each). Slot 0 is
 * the leader: 12 sixteenths, drifting a cell every 4 bars, in bars 1–8 and
 * 13–16. Each follower writes one rest of its own and reads the leader:
 * slot 1 three sixteenths late for the whole song (across the leader's
 * gap), slot 2 an octave up at half the part velocity, and slot 3 an octave
 * down at the eighth, both in the leader's regions.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  currentDocument,
  type CurrentDocumentFile,
} from '../__fixtures__/arrangementDocumentFiles';
import { recordingPart, type Call, type RecordingPart } from '../__fixtures__/recordingPart';
import { SECONDS_PER_MINUTE } from '../audioConstants';
import { PPQ, TICKS_PER_BAR, TickTransport } from '../sequencing/scheduler';
import type { ArrangementPartial } from './arrangement';
import { makeArrangement } from './arrangementDocument';
import { ArrangementPlayer } from './arrangementPlayer';

const SIXTEENTH = 6;
const EIGHTH = 12;

type Played = Call & { tick: number };

interface Rig {
  player: ArrangementPlayer;
  recorders: Map<number, RecordingPart>;
  /** Play `ticks` more ticks. */
  run(ticks: number): void;
  /** A slot's note-ons and ratchet hits, at the transport tick each went out on. */
  ons(slot: number): Played[];
}

type Raw = Record<string, unknown>;

/** The song file, through `edit` if one is given, on a fresh player at tick 0. */
function rig(file: CurrentDocumentFile = 'figure-canon', edit = (raw: Raw): Raw => raw): Rig {
  const { document, corrections } = makeArrangement(edit(currentDocument(file)));
  expect(corrections).toEqual([]);
  const recorders = new Map(document.parts.map((part) => [part.slot, recordingPart()]));
  const transport = new TickTransport();
  const player = new ArrangementPlayer(transport, recorders, document, document.patches ?? {});
  const secondsPerTick = SECONDS_PER_MINUTE / document.transport.bpm / PPQ;
  return {
    player,
    recorders,
    run: (ticks) => {
      for (let i = 0; i < ticks; i++) transport.advance(transport.transportSeconds);
    },
    ons: (slot) =>
      (recorders.get(slot)?.calls ?? [])
        .filter((c) => c.kind === 'noteOn' || c.kind === 'trigger')
        .map((c) => ({ ...c, tick: Math.round((c.time ?? 0) / secondsPerTick) })),
  };
}

/** The pitch of the first note-on at `tick`, or undefined for none. */
const noteAt = (played: Played[], tick: number): number | undefined =>
  played.find((c) => c.tick === tick)?.note;

/** The song with `over` merged into its leader, slot 0. */
function withLeader(raw: Raw, over: Raw): Raw {
  const [leader, ...rest] = raw['parts'] as Raw[];
  return { ...raw, parts: [{ ...leader, ...over }, ...rest] };
}

const within = (played: Played[], fromBar: number, toBar: number): Played[] =>
  played.filter((c) => c.tick >= fromBar * TICKS_PER_BAR && c.tick < toBar * TICKS_PER_BAR);

describe('a canon (windsor#487)', () => {
  it('at offset 3 of a 12-cell leader plays the leader’s cell 9 on its step 0 and cell 0 on step 3', () => {
    const song = rig();
    expect([song.player.stepAt(1, 0), song.player.stepAt(1, 3 * SIXTEENTH)]).toEqual([9, 0]);
    song.run(TICKS_PER_BAR);
    const [leader, canon] = [song.ons(0), song.ons(1)];
    expect(noteAt(canon, 0)).toBe(noteAt(leader, 9 * SIXTEENTH));
    expect(noteAt(canon, 3 * SIXTEENTH)).toBe(noteAt(leader, 0));
  });

  it('transpose 12 doubles the leader an octave up with its velocities and ratchets, scaled by the follower’s velocity', () => {
    const song = rig();
    song.run(8 * TICKS_PER_BAR);
    // Slot 2 plays at 0.4 against the leader's 0.8.
    const shape = (c: Played, up: number, scale: number): string =>
      `${c.tick}:${(c.note ?? 0) + up}:${((c.velocity ?? 0) * scale).toFixed(6)}`;
    const leader = song.ons(0).map((c) => shape(c, 12, 0.5));
    expect(leader.some((s) => s.startsWith('39:'))).toBe(true); // cell 6's second hit
    expect(song.ons(2).map((c) => shape(c, 0, 1))).toEqual(leader);
  });

  it('is dragged by a leader’s drift { 1, 4 }: cell 5, not 4, from bar 5', () => {
    const song = rig();
    const bar5 = 4 * TICKS_PER_BAR;
    const { player } = song;
    expect([player.stepAt(0, bar5), player.stepAt(2, bar5), player.stepAt(1, bar5 + 18)]).toEqual([
      5, 5, 5,
    ]);
    song.run(8 * TICKS_PER_BAR);
    // Over vi, the canon is the leader three sixteenths late through the drifted bars.
    const late = within(song.ons(0), 4, 8).map((c) => ({ ...c, tick: c.tick + 3 * SIXTEENTH }));
    const canon = within(song.ons(1), 4, 8).filter((c) => c.tick >= bar5 + 3 * SIXTEENTH);
    const heard = (played: Played[]): string[] => played.map((c) => `${c.tick}:${c.note}`);
    expect(heard(canon)).toEqual(heard(within(late, 4, 8)));
  });

  it('at the eighth plays every cell of a leader written at the sixteenth, at half speed', () => {
    const song = rig();
    song.run(2 * TICKS_PER_BAR);
    const [leader, half] = [song.ons(0), song.ons(3)];
    const steps = Array.from({ length: 16 }, (_, k) => k);
    const down = (n: number | undefined): number | undefined => (n === undefined ? n : n - 12);
    expect(steps.map((k) => noteAt(half, k * EIGHTH))).toEqual(
      steps.map((k) => down(noteAt(leader, k * SIXTEENTH))),
    );
  });

  it('plays a live edit of the leader’s cells on its next step, with no rebuild', () => {
    const song = rig();
    song.run(TICKS_PER_BAR);
    const cells = Array.from({ length: 12 }, () => ({
      kind: 'note',
      tone: 3,
      octave: 0,
      accent: false,
      slide: false,
    }));
    const edit = { parts: { 0: { sequencer: { cells } } } } as unknown as ArrangementPartial;
    expect(song.player.apply(edit).ok).toBe(true);
    song.run(SIXTEENTH);
    // Tone 3 over a triad is the root an octave up: C5 at register 4.
    expect(noteAt(song.ons(1), TICKS_PER_BAR)).toBe(72);
    expect(song.recorders.get(1)?.calls.some((c) => c.kind === 'allNotesOff')).toBe(false);
  });

  it('goes silent when the leader becomes a Grid live, and the next normalise drops the source with a correction', () => {
    const { document, corrections } = makeArrangement(
      withLeader(currentDocument('figure-canon'), { sequencer: { kind: 'grid' } }),
    );
    expect(corrections.filter((c) => c.includes('slot 0 is a grid part'))).toHaveLength(3);
    const grid = document.parts[0]?.sequencer;
    const song = rig();
    song.run(TICKS_PER_BAR);
    const kindChange = { parts: { 0: { sequencer: grid } } } as unknown as ArrangementPartial;
    expect(song.player.apply(kindChange).ok).toBe(true);
    expect(() => song.run(2 * TICKS_PER_BAR)).not.toThrow();
    for (const slot of [1, 2, 3]) expect(within(song.ons(slot), 1, 3)).toEqual([]);
    expect(song.player.stepAt(1, TICKS_PER_BAR)).toBe(-1);
  });

  it('keeps playing through a gap in the leader’s regions, as if the leader had none, through its re-entry after a live drift edit', () => {
    const gap = rig();
    const whole = rig('figure-canon', (raw) =>
      withLeader(raw, { regions: [{ start: 0, duration: 16 * TICKS_PER_BAR }] }),
    );
    const drift = { parts: { 0: { sequencer: { drift: { steps: -1, everyBars: 2 } } } } };
    for (const song of [gap, whole]) {
      song.run(6 * TICKS_PER_BAR + SIXTEENTH);
      expect(song.player.apply(drift as unknown as ArrangementPartial).ok).toBe(true);
      song.run(10 * TICKS_PER_BAR - SIXTEENTH);
    }
    expect(within(gap.ons(0), 8, 12)).toEqual([]);
    expect(within(gap.ons(0), 12, 16).length).toBeGreaterThan(0);
    expect(within(gap.ons(1), 8, 16).length).toBeGreaterThan(0);
    // The leader's re-entry at bar 13 restarts its own line, not the line its canon reads.
    expect(within(gap.ons(1), 6, 16)).toEqual(within(whole.ons(1), 6, 16));
  });
});

describe('a Figure without a source (windsor#487)', () => {
  it('emits exactly what windsor#486 emitted', () => {
    const song = rig('figure-process');
    song.run(48 * TICKS_PER_BAR);
    song.player.dispose();
    const calls = [...song.recorders.values()].map((r) => r.calls);
    const digest = createHash('sha256').update(JSON.stringify(calls)).digest('hex');
    // Read on origin/main at windsor#486's merge (71d3bef).
    expect(digest).toBe('288a8618957e5b599b06b8117196654058fc49141bd5381650f3f1f001a8cd4e');
  });
});
