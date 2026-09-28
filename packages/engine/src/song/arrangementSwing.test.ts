/**
 * `transport.swing` in the song document (windsor#14, record
 * `2026-09-28-song-swing-in-the-transport`): absent stays absent and plays
 * straight, present round-trips, out-of-range clamps, and the player hands
 * it to the one clock at build and on a live partial.
 */
import { describe, expect, it } from 'vitest';

import { makeArrangement } from './arrangementDocument';
import { ArrangementPlayer } from './arrangementPlayer';
import { TickTransport } from '../sequencing/scheduler';
import { STRAIGHT_SWING } from '../sequencing/swingTables';
import { KICK, patchesOf, silentPart, song } from '../__fixtures__/documentCases';

const roundTrip = (raw: unknown): ReturnType<typeof makeArrangement> =>
  makeArrangement(JSON.parse(JSON.stringify(raw)));

describe('transport.swing in the document', () => {
  it('leaves a song without swing without one: it imports and exports unchanged', () => {
    const first = makeArrangement(song([KICK], { transport: { bpm: 100, bars: 4 } }));
    expect(first.corrections).toEqual([]);
    expect(first.document.transport).toEqual({ bpm: 100, bars: 4 });
    expect('swing' in first.document.transport).toBe(false);
    const again = roundTrip(first.document);
    expect(JSON.stringify(again.document)).toBe(JSON.stringify(first.document));
  });

  it('round-trips a song with swing, correction-free', () => {
    const swing = { amount: 66.7, grid: 8 };
    const first = makeArrangement(song([KICK], { transport: { bpm: 100, bars: 4, swing } }));
    expect(first.corrections).toEqual([]);
    expect(first.document.transport.swing).toEqual(swing);
    const again = roundTrip(first.document);
    expect(again.document).toEqual(first.document);
    expect(again.corrections).toEqual([]);
  });

  it('clamps the amount into 50–75 and reports it', () => {
    const high = makeArrangement(song([KICK], { transport: { swing: { amount: 90, grid: 16 } } }));
    expect(high.document.transport.swing).toEqual({ amount: 75, grid: 16 });
    expect(high.corrections).toEqual(['transport.swing.amount: clamped 90 to 75']);
    const low = makeArrangement(song([KICK], { transport: { swing: { amount: 12 } } }));
    expect(low.document.transport.swing).toEqual({ amount: 50, grid: 16 });
    expect(low.corrections).toEqual(['transport.swing.amount: clamped 12 to 50']);
  });

  it('makes an invalid swing straight, reported field by field', () => {
    const grid = makeArrangement(song([KICK], { transport: { swing: { amount: 60, grid: 4 } } }));
    expect(grid.document.transport.swing).toEqual({ amount: 60, grid: 16 });
    expect(grid.corrections).toEqual(['transport.swing.grid: 4 is not one of 8|16 — using 16']);
    const junk = makeArrangement(song([KICK], { transport: { swing: 'hard' } }));
    expect(junk.document.transport.swing).toEqual(STRAIGHT_SWING);
    expect(junk.corrections).toEqual(['transport.swing: "hard" is not an object — using defaults']);
    const extra = makeArrangement(song([KICK], { transport: { swing: { amount: 55, feel: 1 } } }));
    expect(extra.document.transport.swing).toEqual({ amount: 55, grid: 16 });
    expect(extra.corrections).toEqual(['transport.swing.feel: unknown key dropped']);
  });
});

describe('the player hands the swing to the clock', () => {
  const build = (transportRaw: Record<string, unknown>) => {
    const { document } = makeArrangement(song([KICK], { transport: transportRaw }));
    const transport = new TickTransport();
    const parts = new Map(document.parts.map((p) => [p.slot, silentPart()]));
    const player = new ArrangementPlayer(transport, parts, document, patchesOf(document));
    return { transport, player };
  };

  it('plays a song without swing straight, and one with swing swung', () => {
    expect(build({ bpm: 100 }).transport.swing).toEqual(STRAIGHT_SWING);
    const swing = { amount: 70, grid: 8 };
    expect(build({ bpm: 100, swing }).transport.swing).toEqual(swing);
  });

  it('takes a live swing partial, either field alone, even on a song that had none', () => {
    const { transport, player } = build({ bpm: 100 });
    const amount = player.apply({ transport: { swing: { amount: 62 } } });
    expect(amount).toEqual({ ok: true, ignored: [] });
    expect(transport.swing).toEqual({ amount: 62, grid: 16 });
    player.apply({ transport: { swing: { grid: 8 } } });
    expect(transport.swing).toEqual({ amount: 62, grid: 8 });
    player.apply({ transport: { bpm: 90 } });
    expect(transport.swing).toEqual({ amount: 62, grid: 8 });
  });

  it('clamps a live amount the clock cannot play', () => {
    const { transport, player } = build({ bpm: 100 });
    player.apply({ transport: { swing: { amount: 99 } } });
    expect(transport.swing).toEqual({ amount: 75, grid: 16 });
  });
});
