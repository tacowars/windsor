/**
 * Bounce to Roll's Euclid holds (windsor#740, record
 * `2026-10-11-bounce-to-roll` decision 4): a hold in seconds released
 * through the clock's inverse warp at the transport's phase (the issue's
 * decision 1), and a tail past the region's end cut there. The worked
 * examples, then the parity the record's Consequences ask for against
 * the hits `ArrangementPlayer` plays.
 */
import { describe, expect, it } from 'vitest';

import { bounceSong, playRegion, render, span } from '../__fixtures__/bounceRig';
import type { Call } from '../__fixtures__/recordingPart';
import type { EuclideanSpec, PartRegion, Transport } from './arrangement';
import { DEFAULT_EUCLIDEAN_CONFIG } from '../sequencing/euclideanSequencer';
import type { TickTransport } from '../sequencing/scheduler';

const SWUNG: Partial<Transport> = { swing: { amount: 75, grid: 16 } };
/** Seconds per straight tick at the rig's 120 bpm. */
const SPT = 60 / 120 / 24;
const KICK = 36;

/** A 16-step Euclid at 1/16 hitting the steps named, held `holdTicks` straight ticks. */
function euclid(hits: readonly number[], holdTicks: number): EuclideanSpec {
  const pattern = Array.from({ length: 16 }, (_, i) => hits.includes(i));
  return {
    kind: 'euclidean',
    ...DEFAULT_EUCLIDEAN_CONFIG,
    note: KICK,
    hold: holdTicks * SPT,
    pattern,
  };
}

const song = (
  spec: EuclideanSpec,
  regions: readonly PartRegion[],
  transport: Partial<Transport> = {},
) => bounceSong(spec, { regions, transport, preset: 'kick' });

const triggers = (calls: readonly Call[]): Call[] =>
  calls.filter((call) => call.kind === 'trigger');

/**
 * Whether the written release `end` (a transport tick) is the tick that
 * sounds nearest the played release at `warped` straight ticks.
 */
function nearest(transport: TickTransport, end: number, warped: number): boolean {
  const distance = (tick: number): number => Math.abs(transport.swungTicks(tick) - warped);
  return distance(end) <= distance(end - 1) && distance(end) <= distance(end + 1);
}

describe('a Euclid hold under 75% sixteenth swing, as the record works it', () => {
  const bar = [{ start: 0, duration: 96 }];

  it('a hold of six straight ticks from the downbeat is written 0–4, nothing rounded', () => {
    const { notes, counts } = render(song(euclid([0], 6), bar, SWUNG));
    expect(notes.map(span)).toEqual([[0, 4, KICK]]);
    expect(counts.ticksRounded).toBe(0);
  });

  it('a hold of four straight ticks is written 0–3, one tick rounded', () => {
    const { notes, counts } = render(song(euclid([0], 4), bar, SWUNG));
    expect(notes.map(span)).toEqual([[0, 3, KICK]]);
    expect(counts.ticksRounded).toBe(1);
  });

  it('straight, both holds convert at the tempo and round nothing', () => {
    expect(render(song(euclid([0], 6), bar)).notes.map(span)).toEqual([[0, 6, KICK]]);
    expect(render(song(euclid([0], 4), bar)).notes.map(span)).toEqual([[0, 4, KICK]]);
  });

  it('in a region starting on the off-beat (tick 6), a hit held six straight ticks ends on local tick 8', () => {
    const { notes, counts } = render(song(euclid([0], 6), [{ start: 6, duration: 90 }], SWUNG));
    expect(notes[0] && span(notes[0])).toEqual([0, 8, KICK]);
    expect(counts.ticksRounded).toBe(0);
  });
});

describe('a Euclid tail at the region’s end, as the record works it', () => {
  it('a step-16 hit held 12 ticks in a one-bar region is written 90–96 and counted', () => {
    const { notes, counts } = render(song(euclid([15], 12), [{ start: 0, duration: 96 }]));
    expect(notes.map(span)).toEqual([[90, 96, KICK]]);
    expect(notes[0]?.marks.tailCut).toBe(true);
    expect(counts.euclidTailsCut).toBe(1);
  });

  it('in a longer region each earlier bar’s tail is trimmed by the next bar’s step 1; only the last is cut', () => {
    const { notes, counts } = render(song(euclid([0, 15], 12), [{ start: 0, duration: 384 }]));
    expect(notes.filter((note) => note.tick % 96 === 90).map(span)).toEqual([
      [90, 96, KICK],
      [186, 192, KICK],
      [282, 288, KICK],
      [378, 384, KICK],
    ]);
    expect(counts).toMatchObject({ repeatsTrimmed: 3, euclidTailsCut: 1 });
  });
});

describe('Euclid hits against the played part (the record’s Consequences)', () => {
  it('a last-step hit whose hold crosses the region’s end rang past it; the bounce cuts it there', () => {
    const tail = song(euclid([15], 12), [{ start: 0, duration: 96 }]);
    const [hit] = triggers(playRegion(tail).calls);
    expect((hit!.time! + hit!.duration!) / SPT).toBeCloseTo(102, 9);
    expect(render(tail).notes.map(span)).toEqual([[90, 96, KICK]]);
  });

  it('a swung hit’s written release sounds at the hold’s end, to the nearest tick', () => {
    for (const holdTicks of [3, 4, 5, 6, 7, 9, 10.5]) {
      const swung = song(euclid([0, 3, 6, 11], holdTicks), [{ start: 0, duration: 96 }], SWUNG);
      const { notes } = render(swung);
      const { calls, transport } = playRegion(swung);
      const hits = triggers(calls);
      expect(hits).toHaveLength(notes.length);
      hits.forEach((hit, i) => {
        const note = notes[i]!;
        expect(transport.swungTicks(note.tick) * SPT).toBeCloseTo(hit.time!, 12);
        const end = note.tick + note.ticks;
        expect(nearest(transport, end, (hit.time! + hit.duration!) / SPT)).toBe(true);
      });
    }
  });

  it('a swung region starting on the off-beat releases where the engine did, at the absolute phase', () => {
    const offBeat = song(euclid([0, 5], 6), [{ start: 6, duration: 90 }], SWUNG);
    const { notes } = render(offBeat);
    const { calls, transport } = playRegion(offBeat);
    triggers(calls).forEach((hit, i) => {
      const note = notes[i]!;
      expect(transport.swungTicks(6 + note.tick) * SPT).toBeCloseTo(hit.time!, 12);
      const release = transport.swungTicks(6 + note.tick + note.ticks) * SPT;
      expect(release).toBeCloseTo(hit.time! + hit.duration!, 12);
    });
  });
});
